const wsInfo = document.getElementById("wsInfo");
const authStatus = document.getElementById("authStatus");

const teacherKeyEl = document.getElementById("teacherKey");
const btnAuth = document.getElementById("btnAuth");

const classPinEl = document.getElementById("classPin");
const btnSetPin = document.getElementById("btnSetPin");

const panelIdEl = document.getElementById("panelId");
const correctionLevelEl = document.getElementById("correctionLevel");
const correctionValueEl = document.getElementById("correctionValue");

const btnAddAction = document.getElementById("btnAddAction");
const btnSave = document.getElementById("btnSave");
const btnOpen = document.getElementById("btnOpen");
const btnClose = document.getElementById("btnClose");
const btnExportActions = document.getElementById("btnExportActions");

const buttonsEditor = document.getElementById("buttonsEditor");
const panelStatusEl = document.getElementById("panelStatus");
const clickCountEl = document.getElementById("clickCount");
const summaryArea = document.getElementById("summaryArea");
const clicksArea = document.getElementById("clicksArea");

let shouldReconnect = true;

let ws;
let isAuthed = false;
let studentCorrectionLevels = {};

// ==================== TRADUCCIONES ====================
const ACTIVITY_LABELS = {
  listen:        { de: "Hören",       en: "Listening",      it: "Ascolto",      pt: "Ouvir" },
  read:          { de: "Lesen",       en: "Reading",        it: "Lettura",      pt: "Ler" },
  speak:         { de: "Sprechen",    en: "Speaking",       it: "Parlare",      pt: "Falar" },
  write:         { de: "Schreiben",   en: "Writing",        it: "Scrittura",    pt: "Escrever" },
  grammar:       { de: "Grammatik",   en: "Grammar",        it: "Grammatica",   pt: "Gramática" },
  pronunciation: { de: "Aussprache",  en: "Pronunciation",  it: "Pronuncia",    pt: "Pronúncia" },
  vocabulary:    { de: "Wortschatz",  en: "Vocabulary",     it: "Vocabolario",  pt: "Vocabulário" },
  free_speaking: { de: "freies Sprechen", en: "Free Speaking", it: "Parlato libero", pt: "Fala livre" },
  games:         { de: "Spiele",      en: "Games",          it: "Giochi",       pt: "Jogos" },
  dictation:     { de: "Diktat",      en: "Dictation",      it: "Dettato",      pt: "Ditado" },
};

function getCurrentLanguage() {
  return document.getElementById("classLanguage")?.value || "de";
}

function getLabelForKey(key) {
  const lang = getCurrentLanguage();
  return ACTIVITY_LABELS[key]?.[lang] || key;
}

// ==================== WS ====================
function wsUrl() {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}`;
}

function setStatus(text, ok = false) {
  authStatus.textContent = text;
  authStatus.className = "small " + (ok ? "status-ok" : "");
}

function connectWS() {
  ws = new WebSocket(wsUrl());

  ws.onopen = () => { 
    wsInfo.textContent = "WS: conectado";
    restoreTeacherSession();
    tryAutoAuthTeacher();
  };
  ws.onclose = () => {
    if (!shouldReconnect) return;

    setTimeout(connectWS, 1500);
  };
  ws.onerror = () => { wsInfo.textContent = "WS: error"; };

  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    handleMsg(msg);
  };
}

// ==================== HANDLE MESSAGES ====================
function handleMsg(msg) {
  if (msg.type === "auth_ok" && msg.role === "teacher") {
    isAuthed = true;
    setStatus("Autenticado como teacher.", true);
    if (msg.classPin) classPinEl.value = msg.classPin;
    return;
  }

  if (msg.type === "auth_error") {
    setStatus(msg.message || "Error de auth");
    return;
  }

  if (msg.type === "pin_ok") {
    setStatus(`PIN guardado: ${msg.classPin}`, true);
    return;
  }

  if (msg.type === "actions_panel_saved" ||
      msg.type === "actions_panel_opened" ||
      msg.type === "actions_panel_closed" ||
      msg.type === "actions_panel_state") {
    
    renderPanel(msg.panel);
    
    // Actualizar niveles de alumnos de forma segura
    if (msg.panel?.studentCorrectionLevels) {
      console.log("[Profesor] Recibido studentCorrectionLevels:", msg.panel.studentCorrectionLevels);
      studentCorrectionLevels = { ...msg.panel.studentCorrectionLevels };   // copia profunda
      renderStudentCorrectionLevels(studentCorrectionLevels);
    }
    return;
  }

  if (msg.type === "session_end" || msg.type === "session_expired") {
    shouldReconnect = false;

    localStorage.removeItem("classPin");

    setStatus("Sesión finalizada.");
    resetTeacherPanelUI?.();
    if (ws) ws.close();
   
    setTimeout(() => {
      shouldReconnect = true;
      connectWS(); // 👈 clave
    }, 500);

    return;
  }

  if (msg.type === "student_correction_update") {
    console.log(`[Profesor] Update individual recibido: ${msg.studentId} → ${msg.correctionLevel}%`);
    studentCorrectionLevels[msg.studentId] = msg.correctionLevel;
    renderStudentCorrectionLevels(studentCorrectionLevels);
    return;
  }

  if (msg.type === "export_actions_json") {
    const blob = new Blob([JSON.stringify(msg.payload, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `actions-${msg.payload.sessionId}.json`;
    a.click();
    setStatus("JSON de acciones exportado.", true);
    return;
  }

  if (msg.type === "error") {
    setStatus(msg.message || "Error");
  }
}

// ==================== UI HELPERS ====================
function defaultColor(i) {
  const colors = ["#2563eb","#16a34a","#dc2626","#ca8a04","#7c3aed","#0891b2","#f97316","#db2777","#475569","#059669"];
  return colors[i % colors.length];
}

function makeIdFromLabel(label, fallback = "accion") {
  return String(label || fallback)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "") || fallback;
}

function addActionCard(defaultKey = "", index = 0) {
  const card = document.createElement("div");
  card.className = "card";
  card.style.background = "#121212";

  const lang = getCurrentLanguage();
  const allKeys = Object.keys(ACTIVITY_LABELS);
  
  const optionsHtml = allKeys.map(k => {
    const lbl = ACTIVITY_LABELS[k][lang] || k;
    return `<option value="${k}">${lbl}</option>`;
  }).join("");

  const defaultLabel = defaultKey ? getLabelForKey(defaultKey) : "";

  card.innerHTML = `
    <div class="row">
      <div style="flex:0 0 90px;">
        <label>Activa</label>
        <input type="checkbox" class="b-active" checked />
      </div>
      <div style="flex:1 1 180px;">
        <label>ID</label>
        <input class="b-id" value="${defaultKey ? makeIdFromLabel(defaultKey) : `accion_${Date.now()}`}" />
      </div>
      <div style="flex:2 1 260px;">
        <label>Texto</label>
        <input class="b-label" value="${defaultLabel}" placeholder="Nombre de la acción" />
      </div>
      <div style="flex:1 1 220px;">
        <label>Elegir predefinida</label>
        <select class="b-select">
          <option value="">-- elegir --</option>
          ${optionsHtml}
        </select>
      </div>
      <div style="flex:1 1 140px;">
        <label>Color</label>
        <input class="b-color" value="${defaultColor(index)}" type="color" />
      </div>
      <div style="flex:1 1 120px;">
        <label>Prioridad</label>
        <input class="b-priority" type="number" value="0" />
      </div>
    </div>
  `;

  // Hidden key para traducción
  const keyInput = document.createElement("input");
  keyInput.type = "hidden";
  keyInput.className = "b-key";
  keyInput.value = defaultKey || "";
  card.appendChild(keyInput);

  const labelInput = card.querySelector(".b-label");
  const idInput = card.querySelector(".b-id");
  const select = card.querySelector(".b-select");

  select.onchange = (e) => {
    const key = e.target.value;
    if (!key) return;
    labelInput.value = getLabelForKey(key);
    idInput.value = makeIdFromLabel(key);
    card.querySelector(".b-key").value = key;
  };

  buttonsEditor.appendChild(card);
}

function buildInitialActions() {
  buttonsEditor.innerHTML = "";
  const initialKeys = ["listen", "read", "speak", "write", "grammar", "pronunciation", "vocabulary"];
  initialKeys.forEach((key, i) => addActionCard(key, i));
}

function collectButtons() {
  const cards = buttonsEditor.querySelectorAll(".card");
  const buttons = [];

  cards.forEach((card) => {
    const active = card.querySelector(".b-active")?.checked;
    if (!active) return;

    const id = card.querySelector(".b-id")?.value?.trim() || "";
    const label = card.querySelector(".b-label")?.value?.trim() || "";
    const key = card.querySelector(".b-key")?.value?.trim() || "";
    const color = card.querySelector(".b-color")?.value?.trim() || "#2563eb";
    const priority = Number(card.querySelector(".b-priority")?.value || 0);

    if (!id || !label) return;

    buttons.push({ id, label, key, color, priority });
  });

  return buttons;
}

function resetTeacherPanelUI() {
  // reset slider
  correctionLevelEl.value = 70;
  correctionValueEl.textContent = "70%";

  // reset panel id
  panelIdEl.value = "";

  // reset botones
  buildInitialActions();

  // reset visual panel
  panelStatusEl.textContent = "—";
  clickCountEl.textContent = "0";
  summaryArea.innerHTML = "";
  clicksArea.innerHTML = "";

  setStatus("Nueva sesión iniciada (PIN cambiado).", true);
}

// ==================== RENDER ====================
function renderPanel(panel) {
  panelStatusEl.textContent = panel?.status || "—";
  clickCountEl.textContent = String(panel?.clicks?.length || 0);

  const summary = panel?.summary || {};
  const buttons = panel?.config?.buttons || [];
  const correctionLevel = panel?.config?.correctionLevel;

  if (typeof correctionLevel === "number") {
    correctionLevelEl.value = correctionLevel;
    correctionValueEl.textContent = `${correctionLevel}%`;
  }

  if (!buttons.length) {
    summaryArea.innerHTML = `<div class="note">No hay panel de acciones configurado.</div>`;
    clicksArea.innerHTML = "";
    return;
  }

  summaryArea.innerHTML = `
    <table>
      <thead><tr><th>Botón</th><th>ID</th><th>Clicks</th></tr></thead>
      <tbody>
        ${buttons.map(b => `
          <tr>
            <td>${b.label}</td>
            <td class="mono">${b.id}</td>
            <td class="mono">${summary[b.id] || 0}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;

  clicksArea.innerHTML = `
    <table>
      <thead><tr><th>#</th><th>StudentID</th><th>ButtonID</th><th>Time</th></tr></thead>
      <tbody>
        ${(panel.clicks || []).map((c, i) => `
          <tr>
            <td class="mono">${i + 1}</td>
            <td class="mono">${c.studentId}</td>
            <td class="mono">${c.buttonId}</td>
            <td>${new Date(c.time).toLocaleTimeString()}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

// ==================== NIVEL DE CORRECCIÓN DE ALUMNOS ====================
function createStudentCorrectionUI() {
  const area = document.createElement("div");
  area.id = "correctionStudentsArea";
  area.className = "card";
  area.style.background = "#121212";
  area.innerHTML = `
    <h3 style="margin-top:0;">Nivel de corrección de los alumnos</h3>
    <div id="studentsCorrectionList" class="small">Ningún alumno ha ajustado su nivel aún.</div>
  `;
  // Insertar después del card principal de configuración
  const mainConfigCard = document.querySelectorAll('.card')[2];
  if (mainConfigCard) mainConfigCard.after(area);
}

function renderStudentCorrectionLevels(levels) {
  console.log(`[Profesor] renderStudentCorrectionLevels llamado con:`, levels);   // ← importante

  const container = document.getElementById("studentsCorrectionList");
  if (!container) return;

  if (!levels || Object.keys(levels).length === 0) {
    container.innerHTML = `<span class="small">Ningún alumno ha ajustado su nivel aún.</span>`;
    return;
  }

  let html = `<table style="width:100%; font-size:13px; border-collapse:collapse;">
    <thead><tr><th style="text-align:left;">Alumno</th><th style="text-align:right;">Nivel</th><th>Barra</th></tr></thead>
    <tbody>`;

  for (const [studentId, level] of Object.entries(levels)) {
    const percent = Number(level);
    html += `
      <tr>
        <td style="padding:6px 0;"><strong>${studentId}</strong></td>
        <td style="padding:6px 0; text-align:right; width:70px;">${percent}%</td>
        <td style="padding:6px 0;">
          <div style="background:#333; height:10px; border-radius:999px; overflow:hidden;">
            <div style="background:#3b82f6; width:${percent}%; height:100%; transition:width 0.4s;"></div>
          </div>
        </td>
      </tr>`;
  }
  html += `</tbody></table>`;
  container.innerHTML = html;
}

// ==================== EVENTOS ====================
btnAuth.onclick = () => {
  const key = (teacherKeyEl.value || "").trim() || "LOCAL_DEV";
   localStorage.setItem("teacherKey", key);
  ws.send(JSON.stringify({ type: "auth_teacher", teacherKey: key }));
};

btnSetPin.onclick = () => {
  if (!isAuthed) return setStatus("Primero autentícate.");
  const newPin = classPinEl.value.trim();
  if (!newPin) return setStatus("PIN inválido");
  localStorage.setItem("classPin", newPin);
  ws.send(JSON.stringify({ 
    type: "teacher_set_pin", 
    classPin: newPin 
  }));
  resetTeacherPanelUI();
};

btnAddAction.onclick = () => addActionCard("", 0);

btnSave.onclick = () => {
  if (!isAuthed) return setStatus("Primero autentícate.");
  ws.send(JSON.stringify({
    type: "teacher_set_actions_panel",
    panel: {
      panelId: panelIdEl.value || null,
      language: document.getElementById("classLanguage")?.value || "de",
      correctionLevel: Number(correctionLevelEl.value || 70),
      buttons: collectButtons(),
    }
  }));
};

btnOpen.onclick = () => { if (isAuthed) ws.send(JSON.stringify({ type: "teacher_open_actions_panel" })); };
btnClose.onclick = () => { if (isAuthed) ws.send(JSON.stringify({ type: "teacher_close_actions_panel" })); };

btnExportActions.onclick = () => {
  if (!isAuthed) return setStatus("Primero autentícate.");
  ws.send(JSON.stringify({
    type: "teacher_export_actions_json",
    sessionId: classPinEl.value || "SESSION"
  }));
};

correctionLevelEl.oninput = () => {
  correctionValueEl.textContent = `${correctionLevelEl.value}%`;
};

const btnEndSession = document.getElementById("btnEndSession");

btnEndSession.onclick = () => {
  if (!isAuthed) return;

  if (!confirm("¿Seguro que quieres finalizar la sesión?")) return;

  ws.send(JSON.stringify({
    type: "teacher_end_session"
  }));
};

// =============== RESTAURAR AL CARGAR ============

function restoreTeacherSession() {
  const savedKey = localStorage.getItem("teacherKey");
  const savedPin = localStorage.getItem("classPin");

  if (savedKey) teacherKeyEl.value = savedKey;
  if (savedPin) classPinEl.value = savedPin;
}

// Auto-Auth al conectar

function tryAutoAuthTeacher() {
  const key = localStorage.getItem("teacherKey");

  if (key && ws && ws.readyState === 1) {
    console.log("[AUTOLOGIN] teacher");

    ws.send(JSON.stringify({
      type: "auth_teacher",
      teacherKey: key
    }));
  }
}

// ==================== INICIO ====================
createStudentCorrectionUI();
connectWS();
buildInitialActions();
correctionValueEl.textContent = `${correctionLevelEl.value}%`;

// Actualizar acciones al cambiar idioma
document.getElementById("classLanguage")?.addEventListener("change", buildInitialActions);