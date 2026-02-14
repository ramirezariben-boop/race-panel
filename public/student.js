const wsInfo = document.getElementById("wsInfo");

const loginCard = document.getElementById("loginCard");
const studentIdEl = document.getElementById("studentId");
const classPinEl = document.getElementById("classPin");
const btnLogin = document.getElementById("btnLogin");
const loginStatus = document.getElementById("loginStatus");

const roundCard = document.getElementById("roundCard");
const roundIdEl = document.getElementById("roundId");
const roundStatusEl = document.getElementById("roundStatus");
const inputsArea = document.getElementById("inputsArea");
const btnSubmit = document.getElementById("btnSubmit");
const submitStatus = document.getElementById("submitStatus");

let ws;
let isAuthed = false;
let myId = null;
let round = null;
let hasSubmitted = false;

function wsUrl() {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}`;
}

function normalize(s) {
  return String(s ?? "").trim().replace(/\s+/g, " ");
}

function fmtTime(ms) {
  const d = new Date(ms);
  return d.toLocaleTimeString();
}

function setLoginStatus(text, ok = false) {
  loginStatus.textContent = text;
  loginStatus.className = "small " + (ok ? "status-ok" : "");
}

function setSubmitStatus(text, kind = "muted") {
  submitStatus.textContent = text;
  submitStatus.className =
    "small " + (kind === "ok" ? "status-ok" : kind === "error" ? "status-error" : "");
}

function connectWS() {
  ws = new WebSocket(wsUrl());
  wsInfo.textContent = `WS: conectando…`;

  ws.onopen = () => (wsInfo.textContent = `WS: conectado`);
  ws.onclose = () => {
    wsInfo.textContent = `WS: desconectado`;
    setSubmitStatus("Desconectado. Recarga la página.", "error");
  };
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    handleMsg(msg);
  };
}

function handleMsg(msg) {
  if (msg.type === "hello") {
    if (msg.round) applyRound(msg.round);
    return;
  }

  if (msg.type === "auth_ok" && msg.role === "student") {
    isAuthed = true;
    myId = msg.studentId;
    setLoginStatus(`Autenticado: ID ${myId}`, true);
    loginCard.style.display = "none";
    roundCard.style.display = "block";
    if (msg.round) applyRound(msg.round);
    return;
  }

  if (msg.type === "auth_error") {
    setLoginStatus(msg.message || "Error de autenticación", false);
    return;
  }

  if (msg.type === "round_state") {
    applyRound(msg.round);
    return;
  }

  if (msg.type === "submission_received") {
    hasSubmitted = true;
    btnSubmit.disabled = true;
    setSubmitStatus(`✅ Recibido a las ${fmtTime(msg.serverTime)} (hora del servidor).`, "ok");
    return;
  }

  if (msg.type === "submit_error") {
    setSubmitStatus(msg.message || "No se pudo enviar.", "error");
    return;
  }

  if (msg.type === "error") {
    setSubmitStatus(msg.message || "Error.", "error");
    return;
  }
}

function applyRound(r) {
  round = r;
  hasSubmitted = false; // new round state may imply new open
  const status = round?.status ?? "—";
  roundIdEl.textContent = round?.roundId ?? "—";
  roundStatusEl.textContent = status;

  if (!round) {
    inputsArea.innerHTML = `<div class="note">No hay ronda configurada.</div>`;
    btnSubmit.disabled = true;
    return;
  }

  if (status !== "open") {
    inputsArea.innerHTML = `<div class="note">No hay ronda abierta en este momento.</div>`;
    btnSubmit.disabled = true;
    return;
  }

  renderInputs(round.prompts || []);
  btnSubmit.disabled = false;
  setSubmitStatus("Ronda abierta. Envía tu respuesta (solo 1 envío).");
}

function renderInputs(prompts) {
  if (!prompts.length) {
    inputsArea.innerHTML = `<div class="note">Ronda sin incisos.</div>`;
    return;
  }

  const rows = prompts
    .map((p) => {
      const label = p.label;
      if (p.type === "dropdown" && Array.isArray(p.options) && p.options.length) {
        return `
          <div class="row" style="align-items:flex-end;">
            <div style="flex:1 1 120px;">
              <label>${label}</label>
              <select data-label="${label}">
                ${p.options.map((o) => `<option value="${o}">${o}</option>`).join("")}
              </select>
            </div>
          </div>
        `;
      }
      return `
        <div class="row" style="align-items:flex-end;">
          <div style="flex:1 1 220px;">
            <label>${label}</label>
            <input data-label="${label}" placeholder="Escribe exactamente…" />
          </div>
        </div>
      `;
    })
    .join("");

  inputsArea.innerHTML = rows;
}

function collectAnswers() {
  const fields = inputsArea.querySelectorAll("input[data-label], select[data-label]");
  const answers = [];
  fields.forEach((el) => {
    const label = el.getAttribute("data-label");
    const value = normalize(el.value);
    answers.push({ label, value });
  });
  return answers;
}

// events
btnLogin.onclick = () => {
  const studentId = normalize(studentIdEl.value);
  const classPin = normalize(classPinEl.value);
  ws.send(JSON.stringify({ type: "auth_student", studentId, classPin }));
};

btnSubmit.onclick = () => {
  if (!round || round.status !== "open") return;
  if (hasSubmitted) return;
  const answers = collectAnswers();
  ws.send(JSON.stringify({ type: "student_submit", answers }));
};

connectWS();
