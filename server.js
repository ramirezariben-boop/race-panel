import http from "http";
import fs from "fs";
import path from "path";
import { WebSocketServer } from "ws";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, "public");

// Teacher auth (simple)
const TEACHER_KEY = process.env.TEACHER_KEY || "LOCAL_DEV";

// --- In-memory state (v0.0.0) ---
const state = {
  classPin: "PIN-DEMO", // teacher can change
  round: null, // { roundId, status, prompts, winnersPolicy, createdAt, openedAt, closedAt }
  submissions: new Map(), // studentId -> Submission
  clients: new Map(), // ws -> { role, studentId? }
  roundsHistory: [],
};

function nowMs() {
  return Date.now();
}

function safeJsonParse(str) {
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}

function normalizeText(s) {
  // minimal normalization: trim + collapse spaces
  return String(s ?? "")
    .trim()
    .replace(/\s+/g, " ");
}

function computeScoreAndPerfect(round, submission) {
  const answersByLabel = new Map();
  for (const a of submission.answers || []) {
    answersByLabel.set(String(a.label), String(a.value));
  }

  let scoreTotal = 0;
  let isPerfect = true;

  for (const p of round.prompts) {
    const label = String(p.label);
    const correctRaw = String(p.correct ?? "");
    const correct =
      p.type === "text" ? normalizeText(correctRaw) : normalizeText(correctRaw);

    const givenRaw = answersByLabel.get(label) ?? "";
    const given =
      p.type === "text" ? normalizeText(givenRaw) : normalizeText(givenRaw);

    const ok = given === correct;
    if (ok) scoreTotal += Number(p.points ?? 0);
    if (!ok) isPerfect = false;
  }

  return { scoreTotal, isPerfect };
}

function getPublicRound(round) {
  if (!round) return null;
  return {
    roundId: round.roundId,
    status: round.status,
    prompts: round.prompts.map((p) => ({
      label: p.label,
      type: p.type,
      options: p.options ?? null,
      points: p.points,
    })),
    winnersPolicy: round.winnersPolicy,
    createdAt: round.createdAt,
    openedAt: round.openedAt ?? null,
    closedAt: round.closedAt ?? null,
  };
}

function listSubmissionsSorted() {
  const arr = [];
  for (const [studentId, sub] of state.submissions.entries()) {
    arr.push({ studentId, ...sub });
  }
  arr.sort((a, b) => a.serverTime - b.serverTime);
  return arr;
}

function computeWinners(round) {
  const subs = listSubmissionsSorted();
  const perfect = subs.filter((s) => s.isPerfect === true);

  if (round.winnersPolicy?.mode === "allPerfect") {
    return perfect.map((s) => s.studentId);
  }
  const N = Number(round.winnersPolicy?.N ?? 3);
  return perfect.slice(0, Math.max(0, N)).map((s) => s.studentId);
}

function send(ws, obj) {
  if (ws.readyState === 1) ws.send(JSON.stringify(obj));
}

function broadcastToRole(role, obj) {
  for (const [ws, meta] of state.clients.entries()) {
    if (meta?.role === role) send(ws, obj);
  }
}

function broadcastAll(obj) {
  for (const ws of state.clients.keys()) send(ws, obj);
}

function broadcastRoundState() {
  const roundPublic = getPublicRound(state.round);
  broadcastAll({ type: "round_state", round: roundPublic });
}

function broadcastLeaderboard() {
  const round = state.round;
  if (!round) return;

  const subs = listSubmissionsSorted();
  const winners = computeWinners(round);

  // minimal leaderboard payload for teacher
  broadcastToRole("teacher", {
    type: "leaderboard_update",
    submissionsCount: subs.length,
    winners,
  });
}

// --- Static file server ---
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  let pathname = url.pathname;

  if (pathname === "/") pathname = "/teacher.html"; // default
  if (pathname.includes("..")) {
    res.writeHead(400);
    res.end("Bad path");
    return;
  }

  const filePath = path.join(PUBLIC_DIR, pathname);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType =
      ext === ".html"
        ? "text/html; charset=utf-8"
        : ext === ".css"
        ? "text/css; charset=utf-8"
        : ext === ".js"
        ? "text/javascript; charset=utf-8"
        : "application/octet-stream";

    res.writeHead(200, { "Content-Type": contentType });
    res.end(data);
  });
});

// --- WebSocket server ---
const wss = new WebSocketServer({ server });

wss.on("connection", (ws) => {
console.log("WS CONNECTED ✅", new Date().toISOString());
  state.clients.set(ws, { role: "guest" });

  // send initial round state
  send(ws, { type: "hello", serverTime: nowMs(), round: getPublicRound(state.round) });

  ws.on("message", (buf) => {

    const msg = safeJsonParse(buf.toString("utf8"));
    if (!msg?.type) return;

    const meta = state.clients.get(ws) || { role: "guest" };

console.log("WS MSG:", meta?.role, msg.type);

    // --- AUTH ---
    if (msg.type === "auth_teacher") {
      const key = String(msg.teacherKey ?? "");
      if (key !== TEACHER_KEY) {
        send(ws, { type: "auth_error", message: "Teacher key inválida." });
        return;
      }
      state.clients.set(ws, { role: "teacher" });
      send(ws, {
        type: "auth_ok",
        role: "teacher",
        classPin: state.classPin,
        round: getPublicRound(state.round),
      });
      broadcastLeaderboard();
      return;
    }

    if (msg.type === "auth_student") {
      const studentId = normalizeText(msg.studentId);
      const classPin = normalizeText(msg.classPin);

      if (!studentId) {
        send(ws, { type: "auth_error", message: "Falta studentId." });
        return;
      }
      if (classPin !== state.classPin) {
        send(ws, { type: "auth_error", message: "PIN incorrecto." });
        return;
      }

      state.clients.set(ws, { role: "student", studentId });
      send(ws, {
        type: "auth_ok",
        role: "student",
        studentId,
        round: getPublicRound(state.round),
      });
      return;
    }

    // --- TEACHER ACTIONS ---
    if (meta.role === "teacher" && msg.type === "teacher_set_pin") {
      const newPin = normalizeText(msg.classPin);
      if (!newPin || newPin.length < 2) {
        send(ws, { type: "error", message: "PIN inválido." });
        return;
      }
      state.classPin = newPin;
      send(ws, { type: "pin_ok", classPin: state.classPin });
      return;
    }

    if (meta.role === "teacher" && msg.type === "teacher_set_round") {
      const round = msg.round;
      if (!round?.prompts || !Array.isArray(round.prompts) || round.prompts.length < 1) {
        send(ws, { type: "error", message: "Ronda inválida: faltan incisos." });
        return;
      }

      // sanitize prompts
      const prompts = round.prompts.map((p) => {
        const label = normalizeText(p.label);
        const type = p.type === "dropdown" ? "dropdown" : "text";
        const options =
          type === "dropdown"
            ? (Array.isArray(p.options) ? p.options.map((x) => normalizeText(x)).filter(Boolean) : [])
            : null;

        return {
          label,
          type,
          options,
          correct: normalizeText(p.correct),
          points: Number(p.points ?? 0),
        };
      });

      const winnersPolicy = (() => {
  const mode = round.winnersPolicy?.mode === "allPerfect" ? "allPerfect" : "topNPerfect";
  const N = Number(round.winnersPolicy?.N ?? 3);
  const autoClose = !!round.winnersPolicy?.autoClose;
  return mode === "allPerfect"
    ? { mode }
    : { mode, N: Math.max(1, N), autoClose };
})();

      state.round = {
        roundId: String(round.roundId || `R-${nowMs()}`),
        status: "draft",
        prompts,
        winnersPolicy,
        createdAt: nowMs(),
        openedAt: null,
        closedAt: null,
      };

      // in v0.0.0 reset submissions when changing round
      state.submissions.clear();

      send(ws, { type: "round_saved", round: getPublicRound(state.round) });
      broadcastRoundState();
      broadcastLeaderboard();
      return;
    }

    if (meta.role === "teacher" && msg.type === "teacher_open_round") {
      if (!state.round) {
        send(ws, { type: "error", message: "No hay ronda configurada." });
        return;
      }
      state.submissions.clear();
      state.round.status = "open";
      state.round.openedAt = nowMs();
      state.round.closedAt = null;

      send(ws, { type: "round_opened", round: getPublicRound(state.round) });
      broadcastRoundState();
      broadcastLeaderboard();
      return;
    }

    if (meta.role === "teacher" && msg.type === "teacher_close_round") {
      if (!state.round) {
        send(ws, { type: "error", message: "No hay ronda." });
        return;
      }
      state.round.status = "closed";
      state.round.closedAt = nowMs();

      send(ws, { type: "round_closed", round: getPublicRound(state.round) });
      broadcastRoundState();
      broadcastLeaderboard();
      return;
    }

    if (meta.role === "teacher" && msg.type === "teacher_grade_round") {
      const round = state.round;
      if (!round) {
        send(ws, { type: "error", message: "No hay ronda." });
        return;
      }

      // grade all current submissions
      for (const [studentId, sub] of state.submissions.entries()) {
        const { scoreTotal, isPerfect } = computeScoreAndPerfect(round, sub);
        sub.scoreTotal = scoreTotal;
        sub.isPerfect = isPerfect;
        state.submissions.set(studentId, sub);
      }

      round.status = "graded";

      const winners = computeWinners(round);

      const rows = listSubmissionsSorted().map((s) => ({
        studentId: s.studentId,
        serverTime: s.serverTime,
        isPerfect: !!s.isPerfect,
        scoreTotal: Number(s.scoreTotal ?? 0),
        isWinner: winners.includes(s.studentId),
      }));

	state.roundsHistory.push({
  	  roundId: round.roundId,
  	  prompts: round.prompts,
  	  winnersPolicy: round.winnersPolicy,
  	results: rows.map(r => ({
    	  studentId: r.studentId,
    	  scoreTotal: r.scoreTotal,
    	  isPerfect: r.isPerfect,
    	  isWinner: r.isWinner,
  	})),
      gradedAt: nowMs(),
     });

      send(ws, { type: "graded_results", winners, rows });
      broadcastRoundState();
      broadcastLeaderboard();
      return;
    }

//Teacher export JSON
    if (meta.role === "teacher" && msg.type === "teacher_export_json") {
  const payload = {
    sessionId: msg.sessionId || "SESSION-LOCAL",
    exportedAt: nowMs(),
    rounds: state.roundsHistory,
  };
  send(ws, { type: "export_json", payload });
  return;
}

    if (meta.role === "teacher" && msg.type === "teacher_reset_submissions") {
      state.submissions.clear();
      send(ws, { type: "reset_ok" });
      broadcastLeaderboard();
      return;
    }

    // --- STUDENT SUBMIT ---
    if (meta.role === "student" && msg.type === "student_submit") {
      const round = state.round;
      if (!round || round.status !== "open") {
        send(ws, { type: "submit_error", message: "No hay ronda abierta." });
        return;
      }

      const studentId = meta.studentId;
      if (state.submissions.has(studentId)) {
        send(ws, { type: "submit_error", message: "Ya enviaste tu respuesta en esta ronda." });
        return;
      }

      const answers = Array.isArray(msg.answers) ? msg.answers : [];
      const cleanAnswers = answers.map((a) => ({
        label: normalizeText(a.label),
        value: normalizeText(a.value),
      }));

      const sub = {
        studentId,
        answers: cleanAnswers,
        serverTime: nowMs(),
        isPerfect: null,
        scoreTotal: null,
      };

      // (Optional) compute immediately so leaderboard can show perfects live
      const { scoreTotal, isPerfect } = computeScoreAndPerfect(round, sub);
      sub.scoreTotal = scoreTotal;
      sub.isPerfect = isPerfect;

      state.submissions.set(studentId, sub);

      send(ws, { type: "submission_received", serverTime: sub.serverTime });

      // update teacher leaderboard
      broadcastLeaderboard();

	// AUTO-CLOSE AL LLEGAR A N PERFECTOS (opcional)
	if (
 	  round.winnersPolicy?.mode === "topNPerfect" &&
  	  round.winnersPolicy?.autoClose === true &&
  	  round.status === "open"
	) {
 	 const perfectCount = [...state.submissions.values()]
  	  .filter(s => s.isPerfect === true)
  	  .length;

  	if (perfectCount >= round.winnersPolicy.N) {
  	    round.status = "closed";
   	   round.closedAt = nowMs();
   	   broadcastRoundState();
    	  broadcastLeaderboard();
	  }
	}


      return;
    }

    // fallback
    send(ws, { type: "error", message: "Acción no permitida o no autenticada." });
  });

  ws.on("close", () => {
    state.clients.delete(ws);
  });
});

server.listen(PORT, () => {
  console.log(`Race Panel v0.0.0 running on http://localhost:${PORT}`);
  console.log(`Teacher key (env TEACHER_KEY) = ${TEACHER_KEY}`);
});
