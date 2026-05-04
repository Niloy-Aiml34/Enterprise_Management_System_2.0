// camera_add_student.js

const saveInfoBtn     = document.getElementById("saveInfoBtn");
const startCaptureBtn = document.getElementById("startCaptureBtn");
const addStudentBtn   = document.getElementById("addStudentBtn");
const video           = document.getElementById("video");
const captureStatus   = document.getElementById("captureStatus");
const progressBar     = document.getElementById("progressBar");
const form            = document.getElementById("studentForm");
const inputs          = form.querySelectorAll("input");

const addedSection    = document.getElementById("addedSection");
const addedTableBody  = document.getElementById("addedTableBody");
const trainBtn        = document.getElementById("trainBtn");
const trainProgressWrap = document.getElementById("trainProgressWrap");
const trainProgress   = document.getElementById("trainProgress");
const trainMsg        = document.getElementById("trainMsg");

// In-memory state
let pendingData  = null;
let images       = [];
let captured     = 0;
let stream       = null;
const MAX_IMAGES = 50;

// Session state
let addedStudents = [];   // {id, name, roll, class, sec, reg_no}
let modelTrained  = false;

// ── 1. Save Info ──────────────────────────────────────────────
form.addEventListener("submit", (e) => {
  e.preventDefault();
  clearMsg();

  const fd = new FormData(form);
  pendingData = {
    name:   fd.get("name").trim(),
    roll:   fd.get("roll").trim(),
    class:  fd.get("class").trim(),
    sec:    fd.get("sec").trim(),
    reg_no: fd.get("reg_no").trim(),
  };

  inputs.forEach(i => i.disabled = true);
  saveInfoBtn.disabled = true;
  startCaptureBtn.disabled = false;
  showMsg("Info saved. Click Start Capture to open the camera.", false);
});

// ── 2. Start Capture ──────────────────────────────────────────
startCaptureBtn.addEventListener("click", async () => {
  startCaptureBtn.disabled = true;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
    video.srcObject = stream;
    await video.play();
    captureLoop();
  } catch (err) {
    showMsg("Camera error: " + err.message);
    startCaptureBtn.disabled = false;
  }
});

async function captureLoop() {
  images   = [];
  captured = 0;
  captureStatus.innerText = `Captured 0 / ${MAX_IMAGES}`;
  progressBar.style.width = "0%";
  progressBar.textContent = `0 / ${MAX_IMAGES}`;

  const canvas = document.createElement("canvas");
  canvas.width  = video.videoWidth  || 640;
  canvas.height = video.videoHeight || 480;
  const ctx = canvas.getContext("2d");

  while (captured < MAX_IMAGES) {
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise(r => canvas.toBlob(r, "image/jpeg", 0.9));
    images.push(blob);
    captured++;
    captureStatus.innerText = `Captured ${captured} / ${MAX_IMAGES}`;
    progressBar.style.width = `${(captured / MAX_IMAGES) * 100}%`;
    progressBar.textContent = `${captured} / ${MAX_IMAGES}`;
    await new Promise(r => setTimeout(r, 200));
  }

  stopCamera();
  addStudentBtn.disabled = false;
  showMsg(`${MAX_IMAGES} images captured. Click Add Student to save.`, false);
}

// ── 3. Add Student — save to DB + upload images ───────────────
addStudentBtn.addEventListener("click", async () => {
  if (!pendingData || images.length === 0) return;

  addStudentBtn.disabled = true;
  addStudentBtn.innerHTML = '<span class="erp-spin"></span> Saving…';
  clearMsg();

  // 3a. Save student metadata
  const fd = new FormData();
  Object.entries(pendingData).forEach(([k, v]) => fd.append(k, v));

  let studentId, savedData;
  try {
    const res = await fetch("/add_student", { method: "POST", body: fd });
    const j   = await res.json();
    if (!res.ok) {
      showMsg(j.error || "Failed to save student.");
      unlockInputs();
      addStudentBtn.disabled = false;
      addStudentBtn.textContent = "＋ Add Student";
      return;
    }
    studentId = j.student_id;
    savedData = { ...pendingData, id: studentId };
  } catch {
    showMsg("Network error while saving student.");
    unlockInputs();
    addStudentBtn.disabled = false;
    addStudentBtn.textContent = "＋ Add Student";
    return;
  }

  // 3b. Upload images
  addStudentBtn.innerHTML = '<span class="erp-spin"></span> Uploading…';
  const imgForm = new FormData();
  imgForm.append("student_id", studentId);
  images.forEach((b, i) => imgForm.append("images[]", b, `img_${i}.jpg`));
  try {
    const resp = await fetch("/upload_face", { method: "POST", body: imgForm });
    if (!resp.ok) showMsg("Student saved but image upload failed.", true);
  } catch {
    showMsg("Student saved but image upload failed.", true);
  }

  // 3c. Add to session list, reset form
  addedStudents.push(savedData);
  modelTrained = false;
  renderAddedList();
  showSuccessBanner(savedData.name);
  resetForm();
  addedSection.style.removeProperty("display");
  addedSection.scrollIntoView({ behavior: "smooth", block: "nearest" });
});

// ── Recently Added — render ───────────────────────────────────
function renderAddedList() {
  addedTableBody.innerHTML = addedStudents.map((s, i) => `
    <tr>
      <td class="text-muted">${i + 1}</td>
      <td class="fw-semibold">${esc(s.name)}</td>
      <td>${esc(s.roll)}</td>
      <td>${esc(s.class)}</td>
      <td>${esc(s.sec)}</td>
      <td><code>${esc(s.reg_no)}</code></td>
      <td class="text-center">
        <button class="btn btn-sm btn-outline-warning" onclick="openEdit(${i})">Edit</button>
      </td>
    </tr>
  `).join("");
}

// ── Edit student ──────────────────────────────────────────────
const editModal     = document.getElementById("editModal");
const editCancelBtn = document.getElementById("editCancelBtn");
const editSaveBtn   = document.getElementById("editSaveBtn");
const editError     = document.getElementById("editError");
let   editingIndex  = null;

function openEdit(idx) {
  editingIndex = idx;
  const s = addedStudents[idx];
  document.getElementById("editId").value      = s.id;
  document.getElementById("editName").value    = s.name;
  document.getElementById("editRoll").value    = s.roll;
  document.getElementById("editRegNo").value   = s.reg_no;
  document.getElementById("editClass").value   = s.class;
  document.getElementById("editSec").value     = s.sec;
  editError.style.display = "none";
  editModal.style.display = "flex";
}

editCancelBtn.addEventListener("click", () => {
  editModal.style.display = "none";
});

editSaveBtn.addEventListener("click", async () => {
  const id     = document.getElementById("editId").value;
  const name   = document.getElementById("editName").value.trim();
  const roll   = document.getElementById("editRoll").value.trim();
  const reg_no = document.getElementById("editRegNo").value.trim();
  const cls    = document.getElementById("editClass").value.trim();
  const sec    = document.getElementById("editSec").value.trim();

  if (!name || !roll || !reg_no || !cls || !sec) {
    editError.textContent = "All fields are required.";
    editError.style.display = "";
    return;
  }

  editSaveBtn.disabled = true;
  editSaveBtn.textContent = "Saving…";
  editError.style.display = "none";

  try {
    const res = await fetch(`/students/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, roll, class: cls, sec, reg_no }),
    });
    const j = await res.json();
    if (!res.ok) {
      editError.textContent = j.error || "Failed to update.";
      editError.style.display = "";
      editSaveBtn.disabled = false;
      editSaveBtn.textContent = "Save Changes";
      return;
    }
    // Update local state
    addedStudents[editingIndex] = { id: parseInt(id), name, roll, class: cls, sec, reg_no };
    renderAddedList();
    editModal.style.display = "none";
  } catch {
    editError.textContent = "Network error. Please try again.";
    editError.style.display = "";
  }
  editSaveBtn.disabled = false;
  editSaveBtn.textContent = "Save Changes";
});

// ── Train Model ───────────────────────────────────────────────
trainBtn.addEventListener("click", async () => {
  trainBtn.disabled = true;
  trainBtn.innerHTML = '<span class="erp-spin"></span> Training…';
  trainProgressWrap.style.display = "";
  trainMsg.textContent = "Starting training…";
  trainProgress.style.width = "0%";
  trainProgress.textContent = "0%";

  try {
    const res = await fetch("/train_model");
    const resJson = await res.json().catch(() => ({}));

    if (res.status === 400) {
      // No training data — stop immediately
      trainProgressWrap.style.display = "none";
      trainMsg.textContent = resJson.message || "No training data found.";
      trainProgressWrap.style.display = "";
      trainProgress.style.width = "0%";
      trainProgress.textContent = "0%";
      trainMsg.textContent = resJson.message || "No students found. Add students before training.";
      trainBtn.disabled = false;
      trainBtn.textContent = "🧠 Train Model";
      return;
    }

    if (!res.ok && res.status !== 202) {
      trainMsg.textContent = "Failed to start training. Please try again.";
      trainBtn.disabled = false;
      trainBtn.textContent = "🧠 Train Model";
      return;
    }

    let trainingStarted = false;
    let pollCount = 0;
    const interval = setInterval(async () => {
      try {
        const data = await (await fetch("/train_status")).json();
        pollCount++;
        if (data.running) trainingStarted = true;

        const pct = Math.max(0, Math.min(100, data.progress || 0));
        trainProgress.style.width = pct + "%";
        trainProgress.textContent = pct + "%";
        trainMsg.textContent = data.message || "";

        // Stop when: saw running→false, OR polled 3+ times and never saw running (instant fail)
        if (!data.running && (trainingStarted || pollCount >= 3)) {
          clearInterval(interval);
          if (pct >= 100) {
            modelTrained = true;
            trainBtn.innerHTML = "✓ Training Complete";
            trainBtn.classList.replace("btn-warning", "btn-success");
            trainBtn.disabled = false;
            showSuccessTrainBanner();
            addedSection.style.transition = "opacity .6s ease";
            addedSection.style.opacity = "0";
            setTimeout(() => { addedSection.style.display = "none"; addedStudents = []; }, 650);
          } else {
            trainMsg.textContent = data.message || "Training stopped. No face data found — add students first.";
            trainBtn.disabled = false;
            trainBtn.textContent = "🧠 Retry Training";
          }
        }
      } catch { /* keep polling */ }
    }, 1500);

  } catch (err) {
    trainMsg.textContent = "Error: " + err.message;
    trainBtn.disabled = false;
    trainBtn.textContent = "🧠 Train Model";
  }
});

// ── Helpers ───────────────────────────────────────────────────
function stopCamera() {
  if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
  video.srcObject = null;
}

function unlockInputs() {
  inputs.forEach(i => i.disabled = false);
  saveInfoBtn.disabled = false;
  startCaptureBtn.disabled = true;
}

function resetForm() {
  pendingData = null;
  images      = [];
  captured    = 0;
  stopCamera();
  form.reset();
  inputs.forEach(i => i.disabled = false);
  captureStatus.innerText = `Captured 0 / ${MAX_IMAGES}`;
  progressBar.style.width = "0%";
  progressBar.textContent = `0 / ${MAX_IMAGES}`;
  saveInfoBtn.disabled     = false;
  startCaptureBtn.disabled = true;
  addStudentBtn.disabled   = true;
  addStudentBtn.textContent = "＋ Add Student";
  clearMsg();
}

function esc(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function showMsg(msg, isError = true) {
  let el = document.getElementById("formMsg");
  if (!el) {
    el = document.createElement("div");
    el.id = "formMsg";
    el.style.cssText = "margin-top:12px;padding:10px 14px;border-radius:10px;font-size:14px;font-weight:500;animation:rise .35s ease both";
    form.after(el);
  }
  el.textContent = msg;
  el.style.background = isError ? "rgba(248,113,113,.12)" : "rgba(34,197,94,.14)";
  el.style.color      = isError ? "#ffd2d2"               : "#b6f5ce";
  el.style.border     = isError ? "1px solid rgba(248,113,113,.35)" : "1px solid rgba(34,197,94,.35)";
}

function clearMsg() {
  const el = document.getElementById("formMsg");
  if (el) el.remove();
}

function showSuccessBanner(name) {
  makeBanner(`✓ ${name} added! Add another student or click Train Model.`, "linear-gradient(180deg,#22c55e,#16a34a)", "#04200d");
}

function showSuccessTrainBanner() {
  makeBanner("✓ Model trained! New students will now be recognized during attendance.", "linear-gradient(180deg,#f59e0b,#d97706)", "#1a0e00");
}

function makeBanner(text, bg, color) {
  const banner = document.createElement("div");
  banner.textContent = text;
  banner.style.cssText = [
    "position:fixed","top:24px","left:50%","transform:translate(-50%,-20px)",
    `background:${bg}`,`color:${color}`,
    "padding:12px 24px","border-radius:14px","font-weight:700","z-index:9999",
    "box-shadow:0 12px 30px rgba(0,0,0,.35)","opacity:0","max-width:90vw","text-align:center",
    "transition:opacity .35s ease, transform .35s ease"
  ].join(";");
  document.body.appendChild(banner);
  requestAnimationFrame(() => {
    banner.style.opacity = "1";
    banner.style.transform = "translate(-50%,0)";
  });
  setTimeout(() => {
    banner.style.opacity = "0";
    banner.style.transform = "translate(-50%,-20px)";
    setTimeout(() => banner.remove(), 400);
  }, 3500);
}

// ── Navigation guard ──────────────────────────────────────────
const leaveOverlay  = document.getElementById("leaveOverlay");
const overlayLeave  = document.getElementById("overlayLeaveBtn");
const overlayStay   = document.getElementById("overlayStayBtn");
let   pendingNavUrl = null;

function needsAction() {
  // Block if student(s) added but model not trained, OR unsaved capture in progress
  return (addedStudents.length > 0 && !modelTrained) || pendingData !== null || images.length > 0;
}

function showLeaveOverlay(dest) {
  pendingNavUrl = dest;
  leaveOverlay.style.display = "flex";
}

overlayLeave.addEventListener("click", () => {
  leaveOverlay.style.display = "none";
  addedStudents = [];
  pendingData   = null;
  images        = [];
  window.location.href = pendingNavUrl || "/attendance";
});

overlayStay.addEventListener("click", () => {
  leaveOverlay.style.display = "none";
  if (addedStudents.length > 0) {
    addedSection.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
});

document.getElementById("backBtn").addEventListener("click", () => {
  if (needsAction()) { showLeaveOverlay("/attendance"); }
  else { window.location.href = "/attendance"; }
});

document.querySelectorAll("a[href]").forEach(a => {
  const href = a.getAttribute("href");
  if (!href || href.startsWith("#") || href.startsWith("javascript")) return;
  a.addEventListener("click", e => {
    if (needsAction()) {
      e.preventDefault();
      showLeaveOverlay(href);
    }
  });
});

window.addEventListener("beforeunload", e => {
  if (needsAction()) {
    e.preventDefault();
    e.returnValue = "Students were added but the model hasn't been trained. Without training, they won't be recognized during attendance.";
  }
});
