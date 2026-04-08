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

const SESSION_MAX_AGE = 5 * 60 * 60 * 1000;

function isSessionAlive() {
  if (!state.sessionAlive) return false;

  const age = nowMs() - (state.sessionCreatedAt || 0);
  return age < SESSION_MAX_AGE;
}

// --- In-memory state ---
const state = {
  classPin: "PIN-DEMO",
  round: null,
  submissions: new Map(),
  clients: new Map(),
  roundsHistory: [],
  sessionAlive: true,
  sessionCreatedAt: Date.now(),
  zoomPanel: "actions", // "race" | "actions" — qué ve zoom-student.html
  actionsPanel: {
    config: null,   // { panelId, language, buttons: [{id,label,color,priority}] }
    status: "closed", // "draft" | "open" | "closed"
    clicks: [],     // [{ studentId, buttonId, time }]
  },
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
    const correct = normalizeText(String(p.correct ?? ""));
    const given = normalizeText(answersByLabel.get(label) ?? "");

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

function computeAccumulatedExtras(roundsHistory, minPoints = 1) {
  const totals = {};

  for (const round of roundsHistory) {
    for (const r of round.results || []) {
      const id = String(r.studentId);
      const pts = Number(r.scoreTotal || 0);
      totals[id] = (totals[id] || 0) + pts;
    }
  }

  return Object.fromEntries(
    Object.entries(totals).filter(([_, pts]) => pts >= minPoints)
  );
}

function getPublicActionsPanel() {
  const panel = state.actionsPanel || {};

  const summary = {};
  for (const click of panel.clicks || []) {
    summary[click.buttonId] = (summary[click.buttonId] || 0) + 1;
  }

  const studentCorrectionLevels = state.studentCorrectionLevels || {};

  console.log(`[Servidor] Enviando panel con niveles:`, studentCorrectionLevels);

  return {
    config: panel.config ? {
      panelId: panel.config.panelId,
      language: panel.config.language || "de",
      correctionLevel: Number(panel.config.correctionLevel ?? 70),
      buttons: panel.config.buttons || [],
    } : null,

    status: panel.status || "closed",
    clicks: panel.clicks || [],
    summary,
    studentCorrectionLevels: { ...studentCorrectionLevels }
  };
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
  broadcastAll({
    type: "round_state",
    round: getPublicRound(state.round),
  });
}

function broadcastLeaderboard() {
  const round = state.round;
  if (!round) return;

  const subs = listSubmissionsSorted();
  const winners = computeWinners(round);

  broadcastToRole("teacher", {
    type: "leaderboard_update",
    submissionsCount: subs.length,
    winners,
  });
}

function broadcastActionsPanelState() {
  broadcastAll({
    type: "actions_panel_state",
    panel: getPublicActionsPanel(),
  });
}

// --- Security headers (OWASP / Zoom Marketplace requirement) ---
function setSecurityHeaders(res) {
  res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' https://appssdk.zoom.us",
      "style-src 'self' 'unsafe-inline'",
      "connect-src 'self' wss: ws:",
      "img-src 'self' data:",
      "frame-ancestors 'self' https://*.zoom.us https://*.zoomdev.us",
    ].join("; ")
  );
}

// --- Static file server ---
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  let pathname = url.pathname;

  setSecurityHeaders(res);

  if (pathname === "/") pathname = "/teacher.html";

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

  if (pathname === "/api/rounds") {
    const roundsDir = path.join(PUBLIC_DIR, "rounds");

    fs.readdir(roundsDir, (err, files) => {
      if (err) {
        res.writeHead(500);
        return res.end(JSON.stringify({ error: "No se pudo leer /rounds" }));
      }

      const jsonFiles = files.filter(f => f.endsWith(".json"));

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ files: jsonFiles }));
    });

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

  // estado inicial
  send(ws, {
    type: "hello",
    serverTime: nowMs(),
    round: getPublicRound(state.round),
    zoomPanel: state.zoomPanel, // ← incluido en hello
  });

  send(ws, {
    type: "actions_panel_state",
    panel: getPublicActionsPanel(),
  });

  ws.on("message", (buf) => {
    console.log("WS RAW >>>", buf.toString("utf8"));

    const msg = safeJsonParse(buf.toString("utf8"));
    if (!msg?.type) return;

    const meta = state.clients.get(ws) || { role: "guest" };

    console.log("WS MSG:", meta.role, msg.type);

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
        zoomPanel: state.zoomPanel,
      });

      send(ws, {
        type: "actions_panel_state",
        panel: getPublicActionsPanel(),
      });

      broadcastLeaderboard();
      return;
    }

    if (msg.type === "auth_student") {
      if (!isSessionAlive()) {
        send(ws, { 
          type: "session_expired", 
          message: "La sesión ha expirado." 
        });
        return;
      }
      const studentId = normalizeText(msg.studentId);
      const classPin = normalizeText(msg.classPin);

      if (!studentId) {
        send(ws, { type: "auth_error", message: "Falta studentId." });
        return;
      }

      // Si viene con classPin, validarlo; si no (contexto Zoom), saltar validación
      if (classPin && classPin !== state.classPin) {
        send(ws, { type: "auth_error", message: "PIN incorrecto." });
        return;
      }

      state.clients.set(ws, { role: "student", studentId });

      send(ws, {
        type: "auth_ok",
        role: "student",
        studentId,
        round: getPublicRound(state.round),
        zoomPanel: state.zoomPanel,
      });

      send(ws, {
        type: "actions_panel_state",
        panel: getPublicActionsPanel(),
      });

      return;
    }

    // --- SET PIN (RESET SESIÓN) ---
    if (msg.type === "teacher_set_pin") {

      const meta = state.clients.get(ws);

      if (!meta || meta.role !== "teacher") {
        send(ws, { type: "error", message: "No autorizado." });
        return;
      }

      const newPin = normalizeText(msg.classPin);

      if (!newPin) {
        send(ws, { type: "error", message: "PIN inválido." });
        return;
      }

      state.classPin = newPin;

      state.sessionAlive = true;
      state.sessionCreatedAt = nowMs();

      state.submissions.clear();

      // RESET TOTAL DEL PANEL DE ACCIONES
      state.actionsPanel = {
        status: "close",
        config: null,
        clicks: [],
      };

      send(ws, {
        type: "pin_ok",
        classPin: state.classPin
      });

      broadcastAll({
        type: "actions_panel_state",
        panel: getPublicActionsPanel(),
      });

      return;
    }

    // --- TEACHER: SWITCH ZOOM PANEL ---
    if (meta.role === "teacher" && msg.type === "teacher_switch_zoom_panel") {
      const panel = msg.panel === "race" ? "race" : "actions";
      state.zoomPanel = panel;

      broadcastAll({
        type: "switch_zoom_panel",
        panel,
      });

      send(ws, { type: "zoom_panel_ok", panel });
      return;
    }

    // --- TEACHER ACTIONS: RACE PANEL ---

    if (meta.role === "teacher" && msg.type === "teacher_set_round") {
      const round = msg.round;

      if (!round?.prompts || !Array.isArray(round.prompts) || round.prompts.length < 1) {
        send(ws, { type: "error", message: "Ronda inválida: faltan incisos." });
        return;
      }

      const prompts = round.prompts.map((p) => {
        const label = normalizeText(p.label);
        const type = p.type === "dropdown" ? "dropdown" : "text";
        const options =
          type === "dropdown"
            ? (Array.isArray(p.options)
                ? p.options.map((x) => normalizeText(x)).filter(Boolean)
                : [])
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
        const mode =
          round.winnersPolicy?.mode === "allPerfect"
            ? "allPerfect"
            : "topNPerfect";
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
        results: rows.map((r) => ({
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

    if (meta.role === "teacher" && msg.type === "teacher_export_json") {
      const payload = {
        sessionId: msg.sessionId || "SESSION-LOCAL",
        exportedAt: nowMs(),
        rounds: state.roundsHistory,
      };

      send(ws, { type: "export_json", payload });
      return;
    }

    if (meta.role === "teacher" && msg.type === "teacher_export_extras") {
      const min = Number(msg.minPoints ?? 1);

      const extras = computeAccumulatedExtras(state.roundsHistory, min);

      send(ws, {
        type: "export_extras",
        payload: {
          sessionId: msg.sessionId || "SESSION",
          exportedAt: nowMs(),
          minPoints: min,
          extras,
        },
      });
      return;
    }

    if (meta.role === "teacher" && msg.type === "teacher_reset_submissions") {
      state.submissions.clear();
      send(ws, { type: "reset_ok" });
      broadcastLeaderboard();
      return;
    }

    // --- TEACHER ACTIONS: ACTIONS PANEL ---
    if (meta.role === "teacher" && msg.type === "teacher_set_actions_panel") {
      const panel = msg.panel;

      if (!panel?.buttons || !Array.isArray(panel.buttons) || panel.buttons.length < 1) {
        send(ws, { type: "error", message: "Panel de acciones inválido." });
        return;
      }

      const buttons = panel.buttons.map((b, idx) => ({
        id: normalizeText(b.id || `btn_${idx + 1}`),
        label: normalizeText(b.label || `Botón ${idx + 1}`),
        key: normalizeText(b.key || ""),
        color: normalizeText(b.color || "#2563eb"),
        priority: Number(b.priority ?? 0),
      }));

      state.actionsPanel.config = {
        panelId: normalizeText(panel.panelId || `AP-${nowMs()}`),
        language: normalizeText(panel.language || "de"),
        correctionLevel: Number(panel.correctionLevel ?? 70),
        buttons,
      };
      state.actionsPanel.status = "draft";
      state.actionsPanel.clicks = [];

      send(ws, {
        type: "actions_panel_saved",
        panel: getPublicActionsPanel(),
      });

      broadcastActionsPanelState();
      return;
    }

    if (meta.role === "teacher" && msg.type === "teacher_open_actions_panel") {
      if (!state.actionsPanel.config) {
        send(ws, {
          type: "error",
          message: "No hay panel de acciones configurado.",
        });
        return;
      }

      state.actionsPanel.status = "open";
      state.actionsPanel.clicks = [];

      send(ws, {
        type: "actions_panel_opened",
        panel: getPublicActionsPanel(),
      });

      broadcastActionsPanelState();
      return;
    }

    if (meta.role === "teacher" && msg.type === "teacher_close_actions_panel") {
      if (!state.actionsPanel.config) {
        send(ws, { type: "error", message: "No hay panel de acciones." });
        return;
      }

      state.actionsPanel.status = "closed";
      state.actionsPanel.clicks = [];

      send(ws, {
        type: "actions_panel_closed",
        panel: getPublicActionsPanel(),
      });

      broadcastActionsPanelState();
      return;
    }

    if (meta.role === "teacher" && msg.type === "teacher_export_actions_json") {
      const panel = state.actionsPanel;

      const summary = {};
      for (const click of panel.clicks) {
        summary[click.buttonId] = (summary[click.buttonId] || 0) + 1;
      }

      const payload = {
        sessionId: msg.sessionId || state.classPin || "SESSION",
        exportedAt: nowMs(),
        panelId: panel.config?.panelId || null,
        language: panel.config?.language || "de",
        correctionLevel: Number(panel.config?.correctionLevel ?? 70),
        status: panel.status,
        buttons: panel.config?.buttons || [],
        clicks: panel.clicks,
        summary,
      };

      send(ws, {
        type: "export_actions_json",
        payload,
      });
      return;
    }

    if (meta.role === "teacher" && msg.type === "teacher_end_session") {

      state.sessionAlive = false;

      state.actionsPanel = {
        config: null,
        status: "closed",
        clicks: [],
      };

      state.round = null;
      state.submissions.clear();

      broadcastAll({
       type: "session_end"
      });

      return;
    }

    // --- STUDENT ACTIONS: ACTIONS PANEL ---
    if (meta.role === "student" && msg.type === "student_click_action") {
      const panel = state.actionsPanel;

      if (!panel.config || panel.status !== "open") {
        send(ws, {
          type: "action_click_error",
          message: "No hay panel abierto.",
        });
        return;
      }

      const studentId = meta.studentId;
      const buttonId = normalizeText(msg.buttonId);

      const alreadyClicked = panel.clicks.some((c) => c.studentId === studentId);
      if (alreadyClicked) {
        send(ws, {
          type: "action_click_error",
          message: "Ya hiciste una selección en esta ronda.",
        });
        return;
      }

      const exists = panel.config.buttons.some((b) => b.id === buttonId);
      if (!exists) {
        send(ws, {
          type: "action_click_error",
          message: "Botón inválido.",
        });
        return;
      }

      const click = {
        studentId,
        buttonId,
        time: nowMs(),
      };

      panel.clicks.push(click);

      send(ws, { type: "action_click_ok", click });
      broadcastActionsPanelState();
      return;
    }

    // --- STUDENT CORRECTION LEVEL ---
    if (meta.role === "student" && msg.type === "student_set_correction_level") {
      const rawLevel = msg.correctionLevel;
      const level = Math.max(0, Math.min(100, Number(rawLevel) ?? 70));

      const studentId = meta.studentId;

      if (!state.studentCorrectionLevels) state.studentCorrectionLevels = {};
      state.studentCorrectionLevels[studentId] = level;

      console.log(`[Servidor] Guardado: ${studentId} = ${level}%  (recibido raw: ${rawLevel})`);

      broadcastToRole("teacher", {
        type: "student_correction_update",
        studentId,
        correctionLevel: level
      });

      broadcastActionsPanelState();

      send(ws, { type: "correction_level_ok" });
      return;
    }

    // --- STUDENT SUBMIT: RACE PANEL ---
    if (meta.role === "student" && msg.type === "student_submit") {
      const round = state.round;

      if (!round || round.status !== "open") {
        send(ws, { type: "submit_error", message: "No hay ronda abierta." });
        return;
      }

      const studentId = meta.studentId;

      if (state.submissions.has(studentId)) {
        send(ws, {
          type: "submit_error",
          message: "Ya enviaste tu respuesta en esta ronda.",
        });
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

      const { scoreTotal, isPerfect } = computeScoreAndPerfect(round, sub);
      sub.scoreTotal = scoreTotal;
      sub.isPerfect = isPerfect;

      state.submissions.set(studentId, sub);

      send(ws, {
        type: "submission_received",
        serverTime: sub.serverTime,
      });

      broadcastLeaderboard();

      // auto-close opcional al llegar a N perfectos
      if (
        round.winnersPolicy?.mode === "topNPerfect" &&
        round.winnersPolicy?.autoClose === true &&
        round.status === "open"
      ) {
        const perfectCount = [...state.submissions.values()].filter(
          (s) => s.isPerfect === true
        ).length;

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
    send(ws, {
      type: "error",
      message: "Acción no permitida o no autenticada.",
    });
  });

  ws.on("close", () => {
    state.clients.delete(ws);
  });
});

server.listen(PORT, () => {
  console.log(`Race Panel v0.0.0 running on http://localhost:${PORT}`);
  console.log(`Teacher key (env TEACHER_KEY) = ${TEACHER_KEY}`);
});