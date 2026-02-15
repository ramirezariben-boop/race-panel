const wsInfo = document.getElementById("wsInfo");
const authStatus = document.getElementById("authStatus");

const teacherKeyEl = document.getElementById("teacherKey");
const btnAuth = document.getElementById("btnAuth");

const classPinEl = document.getElementById("classPin");
const btnSetPin = document.getElementById("btnSetPin");

const numPromptsEl = document.getElementById("numPrompts");
const winnerModeEl = document.getElementById("winnerMode");
const winnerNEl = document.getElementById("winnerN");
const roundIdEl = document.getElementById("roundId");

const btnBuild = document.getElementById("btnBuild");
const btnSave = document.getElementById("btnSave");
const btnOpen = document.getElementById("btnOpen");
const btnClose = document.getElementById("btnClose");
const btnGrade = document.getElementById("btnGrade");
const btnReset = document.getElementById("btnReset");
const btnExport = document.getElementById("btnExport");
const btnExportExtras = document.getElementById("btnExportExtras");

const promptsArea = document.getElementById("promptsArea");

const roundStatusEl = document.getElementById("roundStatus");
const subCountEl = document.getElementById("subCount");
const winnerIdsEl = document.getElementById("winnerIds");

const btnCopyWinners = document.getElementById("btnCopyWinners");
const resultsArea = document.getElementById("resultsArea");

let ws;
let isAuthed = false;
let currentRound = null;
let lastWinners = [];

function wsUrl() {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}`;
}

function fmtTime(ms) {
  const d = new Date(ms);
  return d.toLocaleTimeString();
}

function setStatus(text, kind = "muted") {
  authStatus.textContent = text;
  authStatus.className = "small " + (kind === "ok" ? "status-ok" : kind === "error" ? "status-error" : "");
}

function connectWS() {
  ws = new WebSocket(wsUrl());
  wsInfo.textContent = `WS: conectando…`;

  ws.onopen = () => {
    wsInfo.textContent = `WS: conectado`;
  };
  ws.onclose = () => {
    wsInfo.textContent = `WS: desconectado`;
    isAuthed = false;
    setStatus("Desconectado. Recarga para reconectar.", "error");
  };
  ws.onerror = () => {
    wsInfo.textContent = `WS: error`;
  };
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    handleMsg(msg);
  };
}

function handleMsg(msg) {
  if (msg.type === "hello") {
    if (msg.round) applyRoundState(msg.round);
    return;
  }

  if (msg.type === "auth_ok" && msg.role === "teacher") {
    isAuthed = true;
    setStatus("Autenticado como teacher.", "ok");
    if (msg.classPin) classPinEl.value = msg.classPin;
    if (msg.round) applyRoundState(msg.round);
    return;
  }

  if (msg.type === "auth_error") {
    setStatus(msg.message || "Auth error", "error");
    return;
  }

  if (msg.type === "pin_ok") {
    setStatus(`PIN guardado: ${msg.classPin}`, "ok");
    return;
  }

  if (msg.type === "round_state") {
    applyRoundState(msg.round);
    return;
  }

  if (msg.type === "round_saved") {
    applyRoundState(msg.round);
    setStatus("Ronda guardada.", "ok");
    return;
  }

  if (msg.type === "round_opened") {
    applyRoundState(msg.round);
    setStatus("Ronda abierta.", "ok");
    return;
  }

  if (msg.type === "round_closed") {
    applyRoundState(msg.round);
    setStatus("Ronda cerrada.", "ok");
    return;
  }

  if (msg.type === "leaderboard_update") {
    subCountEl.textContent = String(msg.submissionsCount ?? 0);
    lastWinners = Array.isArray(msg.winners) ? msg.winners : [];
    winnerIdsEl.textContent = lastWinners.length ? lastWinners.join(", ") : "—";
    return;
  }

  if (msg.type === "graded_results") {
    lastWinners = Array.isArray(msg.winners) ? msg.winners : [];
    winnerIdsEl.textContent = lastWinners.length ? lastWinners.join(", ") : "—";
    renderResults(msg.rows || []);
    setStatus("Calificación generada.", "ok");
    return;
  }

  if (msg.type === "reset_ok") {
    subCountEl.textContent = "0";
    winnerIdsEl.textContent = "—";
    resultsArea.innerHTML = "";
    setStatus("Envios reseteados.", "ok");
    return;
  }

  if (msg.type === "error") {
    setStatus(msg.message || "Error", "error");
    return;
  }

  if (msg.type === "export_json") {
    const blob = new Blob(
      [JSON.stringify(msg.payload, null, 2)],
      { type: "application/json" }
    );
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `race-panel-${msg.payload.sessionId}.json`;
    a.click();
    setStatus("JSON exportado.", "ok");
    return;
  }

  if (msg.type === "export_extras") {
    const blob = new Blob(
      [JSON.stringify(msg.payload, null, 2)],
      { type: "application/json" }
    );

    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `extras-${msg.payload.sessionId}.json`;
    a.click();

    setStatus("Puntos extra exportados.", "ok");
    return;
  }

}

function applyRoundState(round) {
  currentRound = round;
  roundStatusEl.textContent = round?.status ?? "—";
}

function buildPromptsUI(k) {
  const rows = [];
  for (let i = 0; i < k; i++) {
    rows.push(`
      <div class="card" style="background:#121212;">
        <div class="row">
          <div style="flex:1 1 110px;">
            <label>Label</label>
            <input class="p-label" value="${i + 1}" />
          </div>
          <div style="flex:1 1 160px;">
            <label>Tipo</label>
            <select class="p-type">
              <option value="dropdown" selected>dropdown</option>
              <option value="text">text</option>
            </select>
          </div>
          <div style="flex:2 1 220px;">
            <label>Opciones (si dropdown)</label>
            <input class="p-options" value="A,B,C,D" placeholder="A,B,C,D" />
          </div>
          <div style="flex:1 1 150px;">
            <label>Correcta</label>
            <input class="p-correct" placeholder="A" />
          </div>
          <div style="flex:1 1 130px;">
            <label>Puntos</label>
            <input class="p-points" type="number" step="0.1" value="1" />
          </div>
        </div>
        <div class="small">Tip: si es “text”, las opciones se ignoran.</div>
      </div>
    `);
  }
  promptsArea.innerHTML = rows.join("");
}

function collectRoundDraft() {
  const promptCards = promptsArea.querySelectorAll(".card");
  const prompts = [];

  for (const card of promptCards) {
    const label = card.querySelector(".p-label")?.value?.trim() || "";
    const type = card.querySelector(".p-type")?.value === "text" ? "text" : "dropdown";
    const optionsRaw = card.querySelector(".p-options")?.value || "";
    const correct = card.querySelector(".p-correct")?.value || "";
    const points = Number(card.querySelector(".p-points")?.value || 0);

    const options =
      type === "dropdown"
        ? optionsRaw
            .split(",")
            .map((x) => x.trim())
            .filter(Boolean)
        : null;

    prompts.push({
      label,
      type,
      options,
      correct,
      points,
    });
  }

  const autoCloseChk = document.getElementById("autoCloseChk");

  const mode = winnerModeEl.value === "allPerfect" ? "allPerfect" : "topNPerfect";
  const N = Math.max(1, Number(winnerNEl.value || 3));

  return {
    roundId: (roundIdEl.value || "").trim() || null,
    prompts,
    winnersPolicy:
      mode === "allPerfect"
        ? { mode }
        : { mode, N, autoClose: !!autoCloseChk.checked },
  };
}

function renderResults(rows) {
  if (!rows.length) {
    resultsArea.innerHTML = `<div class="note">No hay envíos.</div>`;
    return;
  }
  const html = `
    <table>
      <thead>
        <tr>
          <th>#</th>
          <th>StudentID</th>
          <th>Time</th>
          <th>Perfect</th>
          <th>Score</th>
          <th>Winner</th>
        </tr>
      </thead>
      <tbody>
        ${rows
          .map((r, idx) => {
            const trClass = r.isWinner ? "winner" : "";
            return `
              <tr class="${trClass}">
                <td class="mono">${idx + 1}</td>
                <td class="mono">${r.studentId}</td>
                <td>${fmtTime(r.serverTime)}</td>
                <td>${r.isPerfect ? "✅" : "—"}</td>
                <td class="mono">${Number(r.scoreTotal ?? 0).toFixed(2)}</td>
                <td>${r.isWinner ? "🏆" : ""}</td>
              </tr>
            `;
          })
          .join("")}
      </tbody>
    </table>
  `;
  resultsArea.innerHTML = html;
}

// --- UI events ---
btnAuth.onclick = () => {
  const key = (teacherKeyEl.value || "").trim() || "LOCAL_DEV";
  ws.send(JSON.stringify({ type: "auth_teacher", teacherKey: key }));
};

btnSetPin.onclick = () => {
  if (!isAuthed) return setStatus("Primero autentícate.", "error");
  ws.send(JSON.stringify({ type: "teacher_set_pin", classPin: classPinEl.value }));
};

btnBuild.onclick = () => {
  const k = Math.max(1, Number(numPromptsEl.value || 1));
  buildPromptsUI(k);
};

btnSave.onclick = () => {
  if (!isAuthed) return setStatus("Primero autentícate.", "error");
  const draft = collectRoundDraft();
  ws.send(JSON.stringify({ type: "teacher_set_round", round: draft }));
};

btnOpen.onclick = () => {
  if (!isAuthed) return setStatus("Primero autentícate.", "error");
  ws.send(JSON.stringify({ type: "teacher_open_round" }));
};

btnClose.onclick = () => {
  if (!isAuthed) return setStatus("Primero autentícate.", "error");
  ws.send(JSON.stringify({ type: "teacher_close_round" }));
};

btnGrade.onclick = () => {
  if (!isAuthed) return setStatus("Primero autentícate.", "error");
  ws.send(JSON.stringify({ type: "teacher_grade_round" }));
};

btnReset.onclick = () => {
  if (!isAuthed) return setStatus("Primero autentícate.", "error");
  ws.send(JSON.stringify({ type: "teacher_reset_submissions" }));
};

btnExport.onclick = () => {
  ws.send(JSON.stringify({
    type: "teacher_export_json",
    sessionId: classPinEl.value || "SESSION",
  }));
};

btnExportExtras.onclick = () => {
  ws.send(JSON.stringify({
    type: "teacher_export_extras",
    sessionId: classPinEl.value || "SESSION",
    minPoints: 1
  }));
};

btnCopyWinners.onclick = async () => {
  const text = lastWinners.length ? lastWinners.join(",") : "";
  try {
    await navigator.clipboard.writeText(text);
    setStatus("Ganadores copiados al portapapeles.", "ok");
  } catch {
    setStatus("No se pudo copiar (permiso del navegador).", "error");
  }
};

// boot
connectWS();
buildPromptsUI(Number(numPromptsEl.value || 3));
