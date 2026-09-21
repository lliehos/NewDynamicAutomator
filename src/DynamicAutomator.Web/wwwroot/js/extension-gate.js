(function () {
  const modal = document.getElementById("da-ext-modal");
  if (!modal) return;

  const pathEl = document.getElementById("da-ext-modal-path");
  const hintEl = document.getElementById("da-ext-modal-hint");
  let installPath = "";
  /** @type {null | { kind: string, el?: Element, detail?: object }} */
  let pendingAction = null;

  function hasExtension() {
    if (document.documentElement.dataset.daExtension === "1") return true;
    if (document.getElementById("da-recorder-fab")) return true;
    return false;
  }

  async function ensureInstallPath() {
    if (installPath) return installPath;
    try {
      const res = await fetch("/extension/install-path", { cache: "no-store" });
      if (!res.ok) return "";
      const data = await res.json();
      installPath = data.path || "";
      if (pathEl && installPath) pathEl.textContent = installPath;
      return installPath;
    } catch {
      if (pathEl) pathEl.textContent = "مسیر آماده نشد — پرتال را رفرش کنید.";
      return "";
    }
  }

  function hideGate() {
    modal.classList.remove("open");
  }

  function showGate(reason) {
    modal.classList.add("open");
    ensureInstallPath();
    if (hintEl) {
      hintEl.textContent = reason
        || "برای ضبط یا اجرا باید افزونه را یک‌بار Load unpacked کنید.";
    }
  }

  /**
   * Call before record/play. Returns true if extension is present.
   * Otherwise opens the install modal and returns false.
   */
  async function requireExtension(opts) {
    if (hasExtension()) {
      hideGate();
      return true;
    }
    pendingAction = opts?.pending || null;
    showGate(opts?.reason);
    return false;
  }

  window.daRequireExtension = requireExtension;
  window.daHasExtension = hasExtension;

  function dismiss() {
    modal.classList.remove("open");
    pendingAction = null;
  }

  async function copyPath() {
    const path = (await ensureInstallPath()) || pathEl?.textContent?.trim() || "";
    if (!path || path.includes("آماده‌سازی") || path.includes("آماده نشد")) {
      if (hintEl) hintEl.textContent = "مسیر هنوز آماده نیست.";
      return;
    }
    try {
      await navigator.clipboard.writeText(path);
      if (hintEl) hintEl.textContent = "مسیر کپی شد — در Load unpacked همان را Paste/انتخاب کنید.";
    } catch {
      if (hintEl) hintEl.textContent = "کپی نشد؛ مسیر را دستی از کادر بالا بردارید.";
    }
  }

  function retryPending() {
    const p = pendingAction;
    pendingAction = null;
    if (!p) return;
    if (p.kind === "click" && p.el instanceof HTMLElement) {
      setTimeout(() => p.el.click(), 50);
      return;
    }
    if (p.kind === "da-play" && p.detail) {
      window.dispatchEvent(new CustomEvent("da-play", { detail: p.detail }));
    }
  }

  function onExtensionOk() {
    hideGate();
    if (hintEl) hintEl.textContent = "افزونه متصل شد.";
    retryPending();
  }

  function check() {
    if (hasExtension()) {
      onExtensionOk();
      return true;
    }
    if (modal.classList.contains("open")) {
      if (hintEl) hintEl.textContent = "هنوز افزونه پیدا نشد — Load unpacked را انجام دهید و دوباره بررسی کنید.";
    }
    return false;
  }

  const EXT_ACTIONS = new Set([
    "start-record",
    "play-task",
    "play-group",
    "play-step"
  ]);

  function isPlayButton(el) {
    if (!el) return false;
    const id = el.id || "";
    return id === "btn-play-task" || id === "btn-play-selection";
  }

  document.addEventListener("click", (ev) => {
    const el = ev.target instanceof Element
      ? ev.target.closest("[data-da-action], #btn-play-task, #btn-play-selection")
      : null;
    if (!el) return;

    const action = el.getAttribute("data-da-action");
    const needs = (action && EXT_ACTIONS.has(action)) || isPlayButton(el);
    if (!needs) return;
    if (hasExtension()) return;

    ev.preventDefault();
    ev.stopPropagation();
    pendingAction = { kind: "click", el };
    showGate(action === "start-record"
      ? "برای شروع ضبط، افزونه لازم است."
      : "برای اجرای فرآیند، افزونه لازم است.");
  }, true);

  window.addEventListener("da-extension-ready", () => {
    if (modal.classList.contains("open") || pendingAction) onExtensionOk();
  });
  window.addEventListener("da-extension-recheck", check);

  document.getElementById("da-ext-recheck")?.addEventListener("click", check);
  document.getElementById("da-ext-dismiss")?.addEventListener("click", dismiss);
  document.getElementById("da-ext-copy-path")?.addEventListener("click", copyPath);
  document.getElementById("da-ext-guide")?.addEventListener("click", () => {
    window.location.href = "/Extension/Install";
  });

  hideGate();
})();
