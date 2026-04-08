const wsInfo = document.getElementById("wsInfo");
const authStatus = document.getElementById("authStatus");

const teacherKeyEl = document.getElementById("teacherKey");
const btnAuth = document.getElementById("btnAuth");

const classPinEl = document.getElementById("classPin");
const btnSetPin = document.getElementById("btnSetPin");

const pointsModeEl = document.getElementById("pointsMode");
const totalRoundPointsEl = document.getElementById("totalRoundPoints");

const btnApplyOptions = document.getElementById("btnApplyOptions");
const globalOptionsEl = document.getElementById("globalOptions");

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

const btnImportJson = document.getElementById("btnImportJson");
const btnExportRoundJson = document.getElementById("btnExportRoundJson");
const fileJson = document.getElementById("fileJson");

const roundsSelect = document.getElementById("roundsSelect");
const btnLoadRoundFromLibrary = document.getElementById("btnLoadRoundFromLibrary");

const btnZoomRace = document.getElementById("btnZoomRace");
const btnZoomActions = document.getElementById("btnZoomActions");
const zoomPanelStatus = document.getElementById("zoomPanelStatus");

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
    if (msg.zoomPanel) zoomPanelStatus.textContent = `Panel Zoom activo: ${msg.zoomPanel}`;
    return;
  }

  if (msg.type === "auth_ok" && msg.role === "teacher") {
    isAuthed = true;
    setStatus("Autenticado como teacher.", "ok");
    if (msg.classPin) classPinEl.value = msg.classPin;
    if (msg.round) applyRoundState(msg.round);
    if (msg.zoomPanel) zoomPanelStatus.textContent = `Panel Zoom activo: ${msg.zoomPanel}`;
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

  if (msg.type === "zoom_panel_ok") {
    zoomPanelStatus.textContent = `Panel Zoom activo: ${msg.panel}`;
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

function parseNumberFlexible(val) {
  if (typeof val !== "string") return Number(val) || 0;
  return Number(val.replace(",", ".")) || 0;
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
            <label>Opciones</label>
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
      </div>
    `);
  }
  promptsArea.innerHTML = rows.join("");

  setTimeout(() => {
    document.querySelectorAll(".p-type").forEach(sel => {
      const card = sel.closest(".card");
      const optionsInput = card.querySelector(".p-options");

      function update() {
        if (sel.value === "text") {
          optionsInput.disabled = true;
          optionsInput.style.opacity = 0.4;
        } else {
          optionsInput.disabled = false;
          optionsInput.style.opacity = 1;
        }
      }

      sel.addEventListener("change", update);
      update();
    });
  }, 0);
}

function collectRoundDraft() {
  const pointsMode = pointsModeEl.value;
  const promptCards = promptsArea.querySelectorAll(".card");
  let prompts = [];

  for (const card of promptCards) {
    const label = card.querySelector(".p-label")?.value?.trim() || "";
    const type = card.querySelector(".p-type")?.value === "text" ? "text" : "dropdown";
    const optionsRaw = card.querySelector(".p-options")?.value || "";
    const correct = card.querySelector(".p-correct")?.value || "";

    const options =
      type === "dropdown"
        ? optionsRaw.split(",").map((x) => x.trim()).filter(Boolean)
        : null;

    prompts.push({ label, type, options, correct, points: 0 });
  }

  if (pointsMode === "auto") {
    const total = parseNumberFlexible(totalRoundPointsEl.value);
    const per = prompts.length ? total / prompts.length : 0;
    prompts = prompts.map(p => ({ ...p, points: Number(per.toFixed(2)) }));
  } else {
    prompts = prompts.map((p, i) => {
      const card = promptCards[i];
      const pts = parseNumberFlexible(card.querySelector(".p-points")?.value);
      return { ...p, points: pts };
    });
  }

  const autoCloseChk = document.getElementById("autoCloseChk");
  const winnerMode = winnerModeEl.value === "allPerfect" ? "allPerfect" : "topNPerfect";
  const N = Math.max(1, Number(winnerNEl.value || 3));

  return {
    roundId: (roundIdEl.value || "").trim() || null,
    prompts,
    scoring: {
      mode: pointsMode,
      total: Number(totalRoundPointsEl.value || 0)
    },
    winnersPolicy:
      winnerMode === "allPerfect"
        ? { mode: winnerMode }
        : { mode: winnerMode, N, autoClose: !!autoCloseChk.checked },
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
          <th>#</th><th>StudentID</th><th>Time</th><th>Perfect</th><th>Score</th><th>Winner</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((r, idx) => `
          <tr class="${r.isWinner ? "winner" : ""}">
            <td class="mono">${idx + 1}</td>
            <td class="mono">${r.studentId}</td>
            <td>${fmtTime(r.serverTime)}</td>
            <td>${r.isPerfect ? "✅" : "—"}</td>
            <td class="mono">${Number(r.scoreTotal ?? 0).toFixed(2)}</td>
            <td>${r.isWinner ? "🏆" : ""}</td>
          </tr>
        `).join("")}
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

btnZoomRace.onclick = () => {
  if (!isAuthed) return setStatus("Primero autentícate.", "error");
  ws.send(JSON.stringify({ type: "teacher_switch_zoom_panel", panel: "race" }));
};

btnZoomActions.onclick = () => {
  if (!isAuthed) return setStatus("Primero autentícate.", "error");
  ws.send(JSON.stringify({ type: "teacher_switch_zoom_panel", panel: "actions" }));
};

btnApplyOptions.onclick = () => {
  const val = globalOptionsEl.value.trim();
  if (!val) return;

  document.querySelectorAll(".card").forEach(card => {
    const type = card.querySelector(".p-type")?.value;
    const input = card.querySelector(".p-options");
    if (type === "dropdown" && input) input.value = val;
  });

  setStatus("Opciones aplicadas a todas las preguntas.", "ok");
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

btnImportJson.onclick = () => fileJson.click();

fileJson.onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const text = await file.text();
  let data;
  try { data = JSON.parse(text); } catch { return setStatus("JSON inválido", "error"); }
  if (!data.prompts) return setStatus("JSON no tiene prompts", "error");
  applyRoundToUI(data);
  setStatus("JSON cargado correctamente.", "ok");
};

btnExportRoundJson.onclick = () => {
  const draft = collectRoundDraft();
  const blob = new Blob([JSON.stringify(draft, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `round-${draft.roundId || "sin-id"}.json`;
  a.click();
  setStatus("JSON de ronda exportado.", "ok");
};

btnLoadRoundFromLibrary.onclick = async () => {
  const file = roundsSelect.value;
  if (!file) return setStatus("Selecciona un archivo", "error");
  try {
    const res = await fetch(`/rounds/${file}`);
    if (!res.ok) throw new Error("No encontrado");
    const data = await res.json();
    applyRoundToUI(data);
    setStatus(`Cargado: ${file}`, "ok");
  } catch (err) {
    console.error(err);
    setStatus("Error cargando JSON", "error");
  }
};

function applyRoundToUI(data) {
  if (!data.prompts) { setStatus("JSON inválido (sin prompts)", "error"); return; }

  buildPromptsUI(data.prompts.length);
  const cards = promptsArea.querySelectorAll(".card");

  data.prompts.forEach((p, i) => {
    const card = cards[i];
    if (!card) return;
    card.querySelector(".p-label").value = p.label || "";
    card.querySelector(".p-type").value = p.type || "dropdown";
    card.querySelector(".p-options").value = (p.options || []).join(",");
    card.querySelector(".p-correct").value = p.correct || "";
    card.querySelector(".p-points").value = p.points ?? 1;
  });

  if (data.winnersPolicy) {
    winnerModeEl.value = data.winnersPolicy.mode || "topNPerfect";
    winnerNEl.value = data.winnersPolicy.N || 3;
    const autoCloseChk = document.getElementById("autoCloseChk");
    if (autoCloseChk) autoCloseChk.checked = !!data.winnersPolicy.autoClose;
  }

  if (data.roundId) roundIdEl.value = data.roundId;
}

async function loadRoundLibrary() {
  try {
    const res = await fetch("/api/rounds");
    const data = await res.json();
    const files = data.files || [];
    roundsSelect.innerHTML =
      `<option value="">— Selecciona —</option>` +
      files.map(f => `<option value="${f}">${f}</option>`).join("");
  } catch (err) {
    console.error(err);
    setStatus("No se pudo cargar biblioteca", "error");
  }
}

loadRoundLibrary();
connectWS();
buildPromptsUI(Number(numPromptsEl.value || 3));