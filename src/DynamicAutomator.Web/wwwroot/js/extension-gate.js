(function () {
  const modal = document.getElementById("da-ext-modal");
  if (!modal) return;

  const titleEl = document.getElementById("da-ext-title");
  const descEl = document.getElementById("da-ext-desc");
  const pathEl = document.getElementById("da-ext-modal-path");
  const pathLabelEl = document.getElementById("da-ext-path-label");
  const hintEl = document.getElementById("da-ext-modal-hint");

  /** @type {{ recorder?: object, player?: object } | null} */
  let pathsCache = null;
  /** @type {null | { kind: string, el?: Element, detail?: object, role?: string }} */
  let pendingAction = null;
  let activeRole = "recorder";

  const COPY = {
    recorder: {
      title: "افزونهٔ ضبط لازم است",
      desc: "برای شروع یا اتمام ضبط، افزونهٔ Dynamic Automator Recorder را یک‌بار با Load unpacked نصب کنید. اگر فقط می‌خواهید اجرا کنید، به افزونهٔ Player نیاز دارید نه Recorder.",
      pathLabel: "مسیر افزونهٔ ضبط (Recorder)",
      missing: "برای ضبط، افزونهٔ Recorder لازم است.",
      stillMissing: "هنوز افزونهٔ ضبط پیدا نشد — Load unpacked را برای مسیر Recorder انجام دهید."
    },
    player: {
      title: "افزونهٔ اجرا لازم است",
      desc: "برای اجرای فرآیند، توقف یا پاز، افزونهٔ Dynamic Automator Player را یک‌بار با Load unpacked نصب کنید. اگر فقط می‌خواهید ضبط کنید، به افزونهٔ Recorder نیاز دارید نه Player.",
      pathLabel: "مسیر افزونهٔ اجرا (Player)",
      missing: "برای اجرا / توقف، افزونهٔ Player لازم است.",
      stillMissing: "هنوز افزونهٔ اجرا پیدا نشد — Load unpacked را برای مسیر Player انجام دهید."
    }
  };

  function hasRecorder() {
    return document.documentElement.dataset.daRecorderExtension === "1"
      || document.documentElement.dataset.daExtension === "1";
  }

  function hasPlayer() {
    return document.documentElement.dataset.daPlayerExtension === "1";
  }

  function hasRole(role) {
    return role === "player" ? hasPlayer() : hasRecorder();
  }

  /** Back-compat: either extension counts as "some extension". */
  function hasExtension() {
    return hasRecorder() || hasPlayer();
  }

  function roleForAction(action, el) {
    if (action === "start-record" || action === "finish-record" || action === "save-draft"
      || action === "rerecord" || action === "clear-draft" || action === "check-recorder") {
      return "recorder";
    }
    if (action === "play-task" || action === "play-group" || action === "play-step"
      || action === "stop-play" || action === "check-player") {
      return "player";
    }
    if (el && (el.id === "btn-play-task" || el.id === "btn-play-selection" || el.id === "btn-stop-play")) {
      return "player";
    }
    return "recorder";
  }

  async function ensureInstallPaths() {
    if (pathsCache?.recorder?.path && pathsCache?.player?.path) return pathsCache;
    try {
      const res = await fetch("/extension/install-path", { cache: "no-store" });
      if (!res.ok) return null;
      pathsCache = await res.json();
      return pathsCache;
    } catch {
      return null;
    }
  }

  function hideGate() {
    modal.classList.remove("open");
    modal.hidden = true;
  }

  async function showGate(role, reason) {
    activeRole = role === "player" ? "player" : "recorder";
    modal.dataset.role = activeRole;
    const copy = COPY[activeRole];
    if (titleEl) titleEl.textContent = copy.title;
    if (descEl) descEl.innerHTML = copy.desc;
    if (pathLabelEl) pathLabelEl.textContent = copy.pathLabel;
    if (hintEl) hintEl.textContent = reason || copy.missing;

    modal.hidden = false;
    modal.classList.add("open");

    const data = await ensureInstallPaths();
    const pack = activeRole === "player" ? data?.player : data?.recorder;
    if (pathEl) {
      pathEl.textContent = pack?.path
        || data?.path
        || "مسیر آماده نشد — پرتال را رفرش کنید.";
    }
  }

  /**
   * @param {{ role?: string, reason?: string, pending?: object }} opts
   */
  async function requireExtension(opts) {
    const role = opts?.role === "player" ? "player" : (opts?.role === "recorder" ? "recorder" : "recorder");
    if (hasRole(role)) {
      hideGate();
      return true;
    }
    pendingAction = opts?.pending || null;
    if (pendingAction) pendingAction.role = role;
    await showGate(role, opts?.reason || COPY[role].missing);
    return false;
  }

  window.daRequireExtension = requireExtension;
  window.daRequireRecorder = (opts) => requireExtension({ ...opts, role: "recorder" });
  window.daRequirePlayer = (opts) => requireExtension({ ...opts, role: "player" });
  window.daHasExtension = hasExtension;
  window.daHasRecorder = hasRecorder;
  window.daHasPlayer = hasPlayer;

  function dismiss() {
    hideGate();
    pendingAction = null;
  }

  async function copyPath() {
    const data = await ensureInstallPaths();
    const pack = activeRole === "player" ? data?.player : data?.recorder;
    const path = pack?.path || pathEl?.textContent?.trim() || "";
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
    const need = p.role || activeRole;
    if (!hasRole(need)) return;
    if (p.kind === "click" && p.el instanceof HTMLElement) {
      setTimeout(() => p.el.click(), 50);
      return;
    }
    if (p.kind === "da-play" && p.detail) {
      window.dispatchEvent(new CustomEvent("da-play", { detail: p.detail }));
    }
    if (p.kind === "da-stop-play") {
      window.dispatchEvent(new CustomEvent("da-stop-play"));
    }
  }

  function onRoleOk(role) {
    if (modal.classList.contains("open") && activeRole === role) {
      hideGate();
      if (hintEl) hintEl.textContent = role === "player" ? "افزونهٔ اجرا متصل شد." : "افزونهٔ ضبط متصل شد.";
    }
    if (pendingAction && (pendingAction.role || activeRole) === role) {
      retryPending();
    }
  }

  function check() {
    const role = activeRole;
    if (hasRole(role)) {
      onRoleOk(role);
      return true;
    }
    if (modal.classList.contains("open") && hintEl) {
      hintEl.textContent = COPY[role].stillMissing;
    }
    return false;
  }

  const RECORDER_ACTIONS = new Set([
    "start-record", "finish-record", "save-draft", "rerecord", "clear-draft", "check-recorder"
  ]);
  const PLAYER_ACTIONS = new Set([
    "play-task", "play-group", "play-step", "stop-play", "check-player"
  ]);

  function isPlayButton(el) {
    if (!el) return false;
    const id = el.id || "";
    return id === "btn-play-task" || id === "btn-play-selection" || id === "btn-stop-play";
  }

  document.addEventListener("click", (ev) => {
    const el = ev.target instanceof Element
      ? ev.target.closest("[data-da-action], #btn-play-task, #btn-play-selection, #btn-stop-play")
      : null;
    if (!el) return;

    const action = el.getAttribute("data-da-action");
    let role = null;
    if (action && RECORDER_ACTIONS.has(action)) role = "recorder";
    else if (action && PLAYER_ACTIONS.has(action)) role = "player";
    else if (isPlayButton(el)) role = el.id === "btn-stop-play" ? "player" : "player";
    if (!role) return;
    if (hasRole(role)) return;

    ev.preventDefault();
    ev.stopPropagation();
    pendingAction = { kind: "click", el, role };
    showGate(role, COPY[role].missing);
  }, true);

  window.addEventListener("da-recorder-ready", () => onRoleOk("recorder"));
  window.addEventListener("da-player-ready", () => onRoleOk("player"));
  window.addEventListener("da-extension-ready", (ev) => {
    const role = ev.detail?.role;
    if (role === "player") onRoleOk("player");
    else if (role === "recorder") onRoleOk("recorder");
    else {
      // Legacy mono-extension: treat as recorder; play still needs player flag.
      onRoleOk("recorder");
    }
  });
  window.addEventListener("da-extension-recheck", (ev) => {
    if (ev.detail?.role) activeRole = ev.detail.role === "player" ? "player" : "recorder";
    check();
  });

  document.getElementById("da-ext-recheck")?.addEventListener("click", check);
  document.getElementById("da-ext-dismiss")?.addEventListener("click", dismiss);
  document.getElementById("da-ext-copy-path")?.addEventListener("click", copyPath);
  document.getElementById("da-ext-guide")?.addEventListener("click", () => {
    window.location.href = "/Extension/Install";
  });

  hideGate();
  ensureInstallPaths();
})();
