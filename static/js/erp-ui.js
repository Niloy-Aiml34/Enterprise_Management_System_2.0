/* SarvaDaksh — shared UI helpers
   - theme switcher (Day / Night / Midnight)
   - button ripple coordinates
   - global page loader
   - smooth nav transitions
*/
(function () {
  /* ── Theme system (synced across pages via localStorage) ───── */
  const THEME_KEY = "sarvadaksh-theme";
  const VALID = ["day", "night", "midnight"];
  // Aliases for backwards compatibility with the analyst page's old keys
  const ALIAS = { dark: "night", light: "day" };

  function readSavedTheme() {
    let t = localStorage.getItem(THEME_KEY) || localStorage.getItem("da-theme");
    if (ALIAS[t]) t = ALIAS[t];
    return VALID.includes(t) ? t : "night";
  }

  function applyTheme(theme) {
    if (ALIAS[theme]) theme = ALIAS[theme];
    if (!VALID.includes(theme)) theme = "night";
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem(THEME_KEY, theme);
    document.querySelectorAll("[data-erp-theme-switcher] .erp-theme-btn, [data-erp-theme-switcher] .theme-btn").forEach((b) => {
      b.classList.toggle("active", b.dataset.theme === theme);
    });
  }

  // Apply saved theme as early as possible (before paint)
  applyTheme(readSavedTheme());

  // Wire up clicks on any theme switcher widget
  document.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-erp-theme-switcher] .erp-theme-btn, [data-erp-theme-switcher] .theme-btn");
    if (!btn || !btn.dataset.theme) return;
    applyTheme(btn.dataset.theme);
  });

  // Sync if another tab/page changes the theme
  window.addEventListener("storage", (e) => {
    if (e.key === THEME_KEY && e.newValue) applyTheme(e.newValue);
  });

  // Expose for external callers
  window.ErpTheme = { apply: applyTheme, read: readSavedTheme };

  /* ── Button ripple ─────────────────────────────────────────── */
  document.addEventListener("pointerdown", (e) => {
    const btn = e.target.closest(".btn, .erp-btn");
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    btn.style.setProperty("--rx", ((e.clientX - rect.left) / rect.width) * 100 + "%");
    btn.style.setProperty("--ry", ((e.clientY - rect.top) / rect.height) * 100 + "%");
  });

  // Global page loader
  function ensureLoader() {
    let el = document.getElementById("erpLoader");
    if (el) return el;
    var logoSrc = (window.ERP_LOGO_ICON) || "/static/images/sarvadaksh-icon.png";
    el = document.createElement("div");
    el.id = "erpLoader";
    el.className = "erp-loader";
    el.innerHTML =
      '<div class="erp-loader-logo" aria-hidden="true">' +
        '<img src="' + logoSrc + '" alt="SarvaDaksh">' +
      '</div>' +
      '<div class="erp-loader-ring" aria-hidden="true" style="width:36px;height:36px;border-width:2px"></div>' +
      '<div class="erp-loader-text">Loading…</div>';
    document.body.appendChild(el);
    return el;
  }

  window.ErpUI = {
    showLoader(text) {
      const el = ensureLoader();
      el.querySelector(".erp-loader-text").textContent = text || "Loading…";
      requestAnimationFrame(() => el.classList.add("show"));
    },
    hideLoader() {
      const el = document.getElementById("erpLoader");
      if (el) el.classList.remove("show");
    },
  };

  // Show loader on internal navigation clicks
  document.addEventListener("click", (e) => {
    const a = e.target.closest("a[href]");
    if (!a) return;
    const href = a.getAttribute("href");
    if (!href || href.startsWith("#") || a.target === "_blank" || a.hasAttribute("download")) return;
    if (a.dataset.noLoader !== undefined) return;
    if (/^https?:/i.test(href) && !href.startsWith(location.origin)) return;
    window.ErpUI.showLoader("Loading…");
  });

  // Hide loader if user comes back via bfcache
  window.addEventListener("pageshow", () => window.ErpUI.hideLoader());
})();
