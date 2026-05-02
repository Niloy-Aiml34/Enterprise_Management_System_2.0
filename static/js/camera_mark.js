// camera_mark.js — live face recognition + attendance marking
const startMarkBtn   = document.getElementById("startMarkBtn");
const stopMarkBtn    = document.getElementById("stopMarkBtn");
const markVideo      = document.getElementById("markVideo");
const markStatus     = document.getElementById("markStatus");
const recognizedList = document.getElementById("recognizedList");
const recognizedEmpty = document.getElementById("recognizedEmpty");

let markStream = null;
let markInterval = null;
let recognizedIds = new Set();

function setStatus(text, kind) {
  markStatus.textContent = text;
  markStatus.classList.remove("success", "warn", "error");
  if (kind) markStatus.classList.add(kind);
}

startMarkBtn.addEventListener("click", async () => {
  startMarkBtn.disabled = true;
  stopMarkBtn.disabled  = false;
  startMarkBtn.innerHTML = '<span class="erp-spin"></span> Starting…';
  try {
    markStream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
    markVideo.srcObject = markStream;
    await markVideo.play();
    setStatus("Scanning…", "");
    startMarkBtn.textContent = "▶ Start";
    markInterval = setInterval(captureAndRecognize, 1200);
  } catch (err) {
    alert("Camera error: " + err.message);
    startMarkBtn.disabled = false;
    stopMarkBtn.disabled  = true;
    startMarkBtn.textContent = "▶ Start";
  }
});

stopMarkBtn.addEventListener("click", () => {
  if (markInterval) clearInterval(markInterval);
  if (markStream)   markStream.getTracks().forEach(t => t.stop());
  markVideo.srcObject = null;
  startMarkBtn.disabled = false;
  stopMarkBtn.disabled  = true;
  setStatus("Stopped", "warn");
});

async function captureAndRecognize() {
  const canvas = document.createElement("canvas");
  canvas.width  = markVideo.videoWidth  || 640;
  canvas.height = markVideo.videoHeight || 480;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(markVideo, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise(r => canvas.toBlob(r, "image/jpeg", 0.85));
  const fd = new FormData();
  fd.append("image", blob, "snap.jpg");
  try {
    const res = await fetch("/recognize_face", { method: "POST", body: fd });
    const j = await res.json();
    if (j.recognized) {
      setStatus(`✓ ${j.name} (${Math.round(j.confidence * 100)}%)`, "success");
      if (!recognizedIds.has(j.student_id)) {
        recognizedIds.add(j.student_id);
        if (recognizedEmpty) recognizedEmpty.style.display = "none";
        const li = document.createElement("li");
        li.className = "list-group-item d-flex justify-content-between align-items-center";
        li.innerHTML =
          `<span><strong>${escapeHtml(j.name)}</strong></span>` +
          `<span class="text-muted small">${new Date().toLocaleTimeString()}</span>`;
        recognizedList.prepend(li);
      }
    } else if (j.error) {
      setStatus(`Not recognized: ${j.error}`, "warn");
    } else {
      setStatus("Not recognized", "warn");
    }
  } catch (err) {
    console.error(err);
  }
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
