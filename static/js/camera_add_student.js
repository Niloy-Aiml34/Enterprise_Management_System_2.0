// camera_add_student.js

const saveInfoBtn    = document.getElementById("saveInfoBtn");
const startCaptureBtn = document.getElementById("startCaptureBtn");
const addStudentBtn  = document.getElementById("addStudentBtn");
const video          = document.getElementById("video");
const captureStatus  = document.getElementById("captureStatus");
const progressBar    = document.getElementById("progressBar");
const form           = document.getElementById("studentForm");
const inputs         = form.querySelectorAll("input");

// In-memory state — nothing hits the DB until Add Student is clicked
let pendingData = null;   // plain object of form values
let images      = [];     // captured blobs
let captured    = 0;
let stream      = null;
const MAX_IMAGES = 50;

// ── 1. Save Info — store data locally, lock inputs ────────────
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

  // Lock inputs so data can't be changed mid-capture
  inputs.forEach(i => i.disabled = true);
  saveInfoBtn.disabled = true;
  startCaptureBtn.disabled = false;

  showMsg("Info saved. Click Start Capture to open the camera.", false);
});

// ── 2. Start Capture — open camera, take photos ───────────────
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
    await new Promise(r => setTimeout(r, 200));
  }

  // Stop camera — images stay in memory
  stopCamera();
  addStudentBtn.disabled = false;
  showMsg(`${MAX_IMAGES} images captured. Click Add Student to save.`, false);
}

// ── 3. Add Student — save to DB then upload images ────────────
addStudentBtn.addEventListener("click", async () => {
  if (!pendingData || images.length === 0) return;

  addStudentBtn.disabled = true;
  addStudentBtn.textContent = "Saving…";
  clearMsg();

  // 3a. Save student to database
  const fd = new FormData();
  Object.entries(pendingData).forEach(([k, v]) => fd.append(k, v));

  let studentId;
  try {
    const res = await fetch("/add_student", { method: "POST", body: fd });
    const j   = await res.json();

    if (!res.ok) {
      // Validation failed — unlock inputs so user can correct the data
      showMsg(j.error || "Failed to save student.");
      unlockInputs();
      addStudentBtn.disabled = false;
      addStudentBtn.textContent = "Add Student";
      return;
    }
    studentId = j.student_id;
  } catch {
    showMsg("Network error while saving student.");
    unlockInputs();
    addStudentBtn.disabled = false;
    addStudentBtn.textContent = "Add Student";
    return;
  }

  // 3b. Upload captured images
  addStudentBtn.textContent = "Uploading images…";
  const imgForm = new FormData();
  imgForm.append("student_id", studentId);
  images.forEach((b, i) => imgForm.append("images[]", b, `img_${i}.jpg`));

  try {
    const resp = await fetch("/upload_face", { method: "POST", body: imgForm });
    if (!resp.ok) {
      showMsg("Student saved but image upload failed.");
    }
  } catch {
    showMsg("Student saved but image upload failed.");
  }

  // 3c. Success — reset everything for the next student
  showSuccessBanner();
  resetForm();
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
  saveInfoBtn.disabled    = false;
  startCaptureBtn.disabled = true;
  addStudentBtn.disabled  = true;
  addStudentBtn.textContent = "Add Student";
  clearMsg();
}

function showMsg(msg, isError = true) {
  let el = document.getElementById("formMsg");
  if (!el) {
    el = document.createElement("div");
    el.id = "formMsg";
    el.style.cssText = "margin-top:10px;padding:10px 14px;border-radius:8px;font-size:14px;font-weight:500";
    form.after(el);
  }
  el.textContent = msg;
  el.style.background = isError ? "#fee2e2" : "#dcfce7";
  el.style.color      = isError ? "#b91c1c" : "#15803d";
  el.style.border     = isError ? "1px solid #fca5a5" : "1px solid #86efac";
}

function clearMsg() {
  const el = document.getElementById("formMsg");
  if (el) el.remove();
}

function showSuccessBanner() {
  const banner = document.createElement("div");
  banner.textContent = "Student added successfully! You can add another student.";
  banner.style.cssText = [
    "position:fixed","top:20px","left:50%","transform:translateX(-50%)",
    "background:#16a34a","color:#fff","padding:12px 24px",
    "border-radius:10px","font-weight:600","z-index:9999",
    "box-shadow:0 4px 16px rgba(0,0,0,.2)","transition:opacity .4s"
  ].join(";");
  document.body.appendChild(banner);
  setTimeout(() => {
    banner.style.opacity = "0";
    setTimeout(() => banner.remove(), 400);
  }, 2800);
}
