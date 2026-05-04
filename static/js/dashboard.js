// dashboard.js — attendance dashboard chart
document.addEventListener("DOMContentLoaded", () => {
  const trainBtn      = document.getElementById("trainBtn");
  const trainProgress = document.getElementById("trainProgress");
  const trainMsg      = document.getElementById("trainMsg");

  async function pollStatus() {
    if (!trainProgress || !trainMsg) return null;
    try {
      const res = await fetch("/train_status");
      const data = await res.json();
      const pct = Math.max(0, Math.min(100, data.progress || 0));
      trainProgress.style.width = pct + "%";
      trainProgress.innerText = pct + "%";
      trainMsg.innerText = data.message || "";
      return data;
    } catch (e) {
      console.error(e);
      return null;
    }
  }

  if (trainBtn) trainBtn.addEventListener("click", async () => {
    trainBtn.disabled = true;
    trainBtn.innerHTML = '<span class="erp-spin"></span> Starting…';
    try {
      const start = await fetch("/train_model");
      if (start.status === 400) {
        const j = await start.json().catch(() => ({}));
        if (trainMsg) trainMsg.innerText = j.message || "No students found. Add students before training.";
        if (trainProgress) { trainProgress.style.width = "0%"; trainProgress.innerText = "0%"; }
        trainBtn.disabled = false;
        trainBtn.textContent = "Start Training";
        return;
      }
      if (!start.ok && start.status !== 202) {
        if (trainMsg) trainMsg.innerText = "Failed to start training.";
        trainBtn.disabled = false;
        trainBtn.textContent = "Start Training";
        return;
      }
      if (trainMsg) trainMsg.innerText = "Training started…";
      trainBtn.innerHTML = '<span class="erp-spin"></span> Training…';
      let started = false;
      let pollCount = 0;
      const t = setInterval(async () => {
        const s = await pollStatus();
        if (!s) return;
        pollCount++;
        if (s.running) started = true;
        if (!s.running && (started || pollCount >= 3)) {
          clearInterval(t);
          trainBtn.disabled = false;
          trainBtn.textContent = "Start Training";
        }
      }, 1500);
    } catch (err) {
      trainBtn.disabled = false;
      trainBtn.textContent = "Start Training";
    }
  });

  // Chart styling — pulls colors from current theme tokens
  let chart = null;

  function readThemeColors() {
    const s = getComputedStyle(document.documentElement);
    return {
      brand:  (s.getPropertyValue("--brand")    || "#e5b340").trim(),
      navy:   (s.getPropertyValue("--accent")   || "#4f6bd1").trim(),
      text:   (s.getPropertyValue("--text")     || "#e8ecf6").trim(),
      muted:  (s.getPropertyValue("--muted")    || "#a3aec7").trim(),
      grid:   (s.getPropertyValue("--border")   || "rgba(229,179,64,.12)").trim(),
      bg:     (s.getPropertyValue("--surface")  || "#122150").trim(),
    };
  }

  function makeGradient(ctx, c) {
    const g = ctx.createLinearGradient(0, 0, 0, 320);
    g.addColorStop(0, c.brand);
    g.addColorStop(1, c.navy + "80");
    return g;
  }

  async function updateChart() {
    const res = await fetch("/attendance_stats");
    const data = await res.json();
    const ctx = document.getElementById("attendanceChart").getContext("2d");
    const c = readThemeColors();
    const grad = makeGradient(ctx, c);

    if (!chart) {
      chart = new Chart(ctx, {
        type: "bar",
        data: {
          labels: data.dates,
          datasets: [{
            label: "Attendance",
            data: data.counts,
            backgroundColor: grad,
            borderRadius: 6,
            borderSkipped: false,
            maxBarThickness: 22,
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: { duration: 700, easing: "easeOutQuart" },
          plugins: {
            legend: { labels: { color: c.text, font: { family: "Inter", weight: "600" } } },
            tooltip: {
              backgroundColor: c.bg,
              borderColor: c.brand,
              borderWidth: 1,
              titleColor: c.text,
              bodyColor: c.muted,
              padding: 10,
              cornerRadius: 8,
            }
          },
          scales: {
            x: { ticks: { color: c.muted, maxRotation: 0 }, grid: { color: c.grid } },
            y: { beginAtZero: true, ticks: { color: c.muted, precision: 0 }, grid: { color: c.grid } }
          }
        }
      });
    } else {
      chart.data.labels = data.dates;
      chart.data.datasets[0].data = data.counts;
      chart.data.datasets[0].backgroundColor = grad;
      chart.options.plugins.legend.labels.color = c.text;
      chart.options.plugins.tooltip.backgroundColor = c.bg;
      chart.options.plugins.tooltip.borderColor = c.brand;
      chart.options.plugins.tooltip.titleColor = c.text;
      chart.options.plugins.tooltip.bodyColor = c.muted;
      chart.options.scales.x.ticks.color = c.muted;
      chart.options.scales.x.grid.color = c.grid;
      chart.options.scales.y.ticks.color = c.muted;
      chart.options.scales.y.grid.color = c.grid;
      chart.update("none");
    }
  }
  updateChart();
  setInterval(updateChart, 10000);

  // Re-render when the user switches theme
  const themeObserver = new MutationObserver(() => updateChart());
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
});
