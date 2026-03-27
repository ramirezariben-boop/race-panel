const wsInfo = document.getElementById("wsInfo");
const loginStatus = document.getElementById("loginStatus");

const studentIdEl = document.getElementById("studentId");
const classPinEl = document.getElementById("classPin");
const btnLogin = document.getElementById("btnLogin");

const loginCard = document.getElementById("loginCard");
const panelCard = document.getElementById("panelCard");

const panelStatusEl = document.getElementById("panelStatus");
const panelIdEl = document.getElementById("panelId");
const buttonsArea = document.getElementById("buttonsArea");
const actionStatus = document.getElementById("actionStatus");

let ws;
let isAuthed = false;

// ── Traducciones ──────────────────────────────────────────────
const ACTIVITY_LABELS = {
  listen:        { de: "Hören", en: "Listening", it: "Ascolto", pt: "Ouvir" },
  read:          { de: "Lesen", en: "Reading", it: "Lettura", pt: "Ler" },
  speak:         { de: "Sprechen", en: "Speaking", it: "Parlare", pt: "Falar" },
  write:         { de: "Schreiben", en: "Writing", it: "Scrittura", pt: "Escrever" },
  grammar:       { de: "Grammatik", en: "Grammar", it: "Grammatica", pt: "Gramática" },
  pronunciation: { de: "Aussprache", en: "Pronunciation", it: "Pronuncia", pt: "Pronúncia" },
  vocabulary:    { de: "Wortschatz", en: "Vocabulary", it: "Vocabolario", pt: "Vocabulário" },
  free_speaking: { de: "freies Sprechen", en: "Free Speaking", it: "Parlato libero", pt: "Fala livre" },
  games:         { de: "Spiele", en: "Games", it: "Giochi", pt: "Jogos" },
  dictation:     { de: "Diktat", en: "Dictation", it: "Dettato", pt: "Ditado" },
};

function resolveLabel(button, lang) {
  if (button.key && ACTIVITY_LABELS[button.key]) {
    return ACTIVITY_LABELS[button.key][lang] || button.label;
  }
  if (ACTIVITY_LABELS[button.id]) {
    return ACTIVITY_LABELS[button.id][lang] || button.label;
  }
  return button.label || button.id || "Acción";
}

// ── Slider de corrección del alumno ─────────────────────────────────────
let currentCorrectionLevel = 70;
const slider = document.getElementById("correctionLevelStudent");
const valueLabel = document.getElementById("correctionValueStudent");

if (slider && valueLabel) {
  valueLabel.textContent = slider.value + "%";
  currentCorrectionLevel = Number(slider.value);

  slider.oninput = () => {
    currentCorrectionLevel = Number(slider.value);
    valueLabel.textContent = currentCorrectionLevel + "%";

    console.log(`[Alumno] Slider cambiado a: ${currentCorrectionLevel}%`);   // ← nuevo log

    if (isAuthed && ws && ws.readyState === 1) {
      ws.send(JSON.stringify({
        type: "student_set_correction_level",
        correctionLevel: currentCorrectionLevel
      }));
      console.log(`[Alumno] Enviado al servidor: ${currentCorrectionLevel}%`);   // ← nuevo log
    }
  };
}

// Hook para cuando el profesor cambia el nivel global
window.setStudentCorrectionLevelFromTeacher = function (val) {
  const sliderEl = document.getElementById("correctionLevelStudent");
  const valueLabelEl = document.getElementById("correctionValueStudent");
  if (!sliderEl || !valueLabelEl) return;

  // Solo actualizamos si el alumno está en el valor por defecto
  if (currentCorrectionLevel === 70) {
    currentCorrectionLevel = Number(val);
    sliderEl.value = currentCorrectionLevel;
    valueLabelEl.textContent = currentCorrectionLevel + "%";
  }
};

// ── WebSocket ────────────────────────────────────────────────
function wsUrl() {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}`;
}

function setStatus(text, ok = false) {
  loginStatus.textContent = text;
  loginStatus.className = "small " + (ok ? "status-ok" : "");
}

function connectWS() {
  ws = new WebSocket(wsUrl());
  ws.onopen = () => { wsInfo.textContent = "WS: conectado"; };
  ws.onclose = () => { wsInfo.textContent = "WS: desconectado"; };
  ws.onerror = () => { wsInfo.textContent = "WS: error"; };

  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    handleMsg(msg);
  };
}

function handleMsg(msg) {
  if (msg.type === "auth_ok" && msg.role === "student") {
    isAuthed = true;
    setStatus("Autenticado.", true);
    loginCard.style.display = "none";
    panelCard.style.display = "block";
    return;
  }

  if (msg.type === "auth_error") {
    setStatus(msg.message || "Error");
    return;
  }

  if (msg.type === "actions_panel_state") {
    renderPanel(msg.panel);
    return;   // ← NO tocamos el slider aquí
  }

  if (msg.type === "action_click_ok") {
    actionStatus.textContent = "Acción enviada ✓";
    return;
  }

  if (msg.type === "action_click_error") {
    actionStatus.textContent = msg.message || "Error al enviar";
    return;
  }
}

function renderPanel(panel) {
  panelStatusEl.textContent = panel?.status || "—";
  panelIdEl.textContent = panel?.config?.panelId || "—";

  const buttons = panel?.config?.buttons || [];
  const lang = panel?.config?.language || "de";

  if (!buttons.length || panel.status !== "open") {
    buttonsArea.innerHTML = `<div class="note">Esperando panel abierto…</div>`;
    return;
  }

  buttonsArea.innerHTML = buttons.map(b => `
    <button 
      class="action-btn"
      style="background:${b.color}; color:#fff; padding:20px; margin:10px; font-size:18px; border:none; cursor:pointer; border-radius:12px;"
      data-id="${b.id}"
    >
      ${resolveLabel(b, lang)}
    </button>
  `).join("");

  document.querySelectorAll(".action-btn").forEach(btn => {
    btn.onclick = () => {
      if (!isAuthed) return;
      ws.send(JSON.stringify({
        type: "student_click_action",
        buttonId: btn.dataset.id
      }));
    };
  });
}

btnLogin.onclick = () => {
  const studentId = (studentIdEl.value || "").trim();
  const classPin = (classPinEl.value || "").trim();
  if (!studentId || !classPin) {
    return setStatus("Faltan Student ID o PIN");
  }
  ws.send(JSON.stringify({ type: "auth_student", studentId, classPin }));
};

connectWS();