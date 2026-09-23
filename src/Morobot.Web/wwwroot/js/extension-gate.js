(function () {
  const modal = document.getElementById("da-ext-modal");
  if (!modal) return;

  const titleEl = document.getElementById("da-ext-title");
  const descEl = document.getElementById("da-ext-desc");
  const pathEl = document.getElementById("da-ext-modal-path");
  const pathLabelEl = document.getElementById("da-ext-path-label");
  const hintEl = document.getElementById("da-ext-modal-hint");

  /** @type {{ recorder?: object, player?: object, selector?: object } | null} */
  let pathsCache = null;
  /** @type {null | { kind: string, el?: Element, detail?: object, role?: string }} */
  let pendingAction = null;
  let activeRole = "recorder";
  let selectorPromptDone = false;

  function t(key, vars) {
    if (window.DaI18n && typeof DaI18n.t === "function") return DaI18n.t(key, vars);
    return key;
  }

  function copyFor(role) {
    if (role === "player") {
      return {
        title: t("panel.extPlayerTitle"),
        desc: t("panel.extPlayerDesc"),
        pathLabel: t("panel.extPlayerPathLabel"),
        missing: t("panel.extPlayerMissing"),
        stillMissing: t("panel.extPlayerStillMissing"),
        connected: t("panel.extPlayerConnected")
      };
    }
    if (role === "selector") {
      return {
        title: t("panel.extSelectorTitle"),
        desc: t("panel.extSelectorDesc"),
        pathLabel: t("panel.extSelectorPathLabel"),
        missing: t("panel.extSelectorMissing"),
        stillMissing: t("panel.extSelectorStillMissing"),
        connected: t("panel.extSelectorConnected")
      };
    }
    if (role === "smart") {
      return {
        title: t("panel.extSmartTitle"),
        desc: t("panel.extSmartDesc"),
        pathLabel: t("panel.extSmartPathLabel"),
        missing: t("panel.extSmartMissing"),
        stillMissing: t("panel.extSmartStillMissing"),
        connected: t("panel.extSmartConnected")
      };
    }
    return {
      title: t("panel.extModalTitle"),
      desc: t("panel.extModalDesc"),
      pathLabel: t("panel.extPathLabel"),
      missing: t("panel.extMissing"),
      stillMissing: t("panel.extStillMissing"),
      connected: t("panel.extConnected")
    };
  }

  function normalizeRole(role) {
    if (role === "player" || role === "selector" || role === "smart") return role;
    return "recorder";
  }

  /** Path for the active role only — never fall back to another extension's folder. */
  function pathForRole(data, role) {
    const r = normalizeRole(role);
    const pack = data?.[r];
    let p = String(pack?.path || pack?.installPath || "").trim();
    if (p) return p;
    // Older portal builds may omit smart; derive from a sibling package path.
    if (r === "smart") {
      const sibling = data?.recorder?.path || data?.player?.path || data?.selector?.path || data?.path || "";
      if (sibling) {
        p = String(sibling)
          .replace(/extension-recorder/i, "extension-smart-recorder")
          .replace(/extension-player/i, "extension-smart-recorder")
          .replace(/extension-selector/i, "extension-smart-recorder");
        if (/extension-smart-recorder/i.test(p)) return p;
      }
    }
    return "";
  }

  function hasRecorder() {
    return document.documentElement.dataset.daRecorderExtension === "1"
      || document.documentElement.dataset.daExtension === "1";
  }

  function hasPlayer() {
    return document.documentElement.dataset.daPlayerExtension === "1";
  }

  function hasSelector() {
    return document.documentElement.dataset.daSelectorExtension === "1";
  }

  function hasSmart() {
    return document.documentElement.dataset.daSmartExtension === "1";
  }

  function hasRole(role) {
    const r = normalizeRole(role);
    if (r === "player") return hasPlayer();
    if (r === "selector") return hasSelector();
    if (r === "smart") return hasSmart();
    return hasRecorder();
  }

  /** Back-compat: either extension counts as "some extension". */
  function hasExtension() {
    return hasRecorder() || hasPlayer() || hasSelector() || hasSmart();
  }

  async function ensureInstallPaths() {
    // Always refresh when smart is missing so a newly synced package appears.
    if (pathsCache?.recorder?.path && pathsCache?.player?.path && pathsCache?.selector?.path && pathsCache?.smart?.path) {
      return pathsCache;
    }
    pathsCache = null;
    try {
      const res = await fetch("/extension/install-path", { cache: "no-store" });
      if (!res.ok) return null;
      pathsCache = await res.json();
      // If API has no smart object yet, synthesize path so the modal is usable.
      if (pathsCache && !pathsCache.smart?.path) {
        const derived = pathForRole(pathsCache, "smart");
        if (derived) {
          pathsCache.smart = {
            ...(pathsCache.smart || {}),
            role: "smart",
            path: derived,
            ok: false
          };
        }
      }
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
    activeRole = normalizeRole(role);
    modal.dataset.role = activeRole;
    const copy = copyFor(activeRole);
    // Drop static data-i18n so locale re-apply cannot overwrite role-specific copy/path.
    [titleEl, descEl, pathLabelEl, pathEl].forEach((el) => el?.removeAttribute("data-i18n"));
    if (titleEl) titleEl.textContent = copy.title;
    if (descEl) descEl.textContent = copy.desc;
    if (pathLabelEl) pathLabelEl.textContent = copy.pathLabel;
    if (hintEl) hintEl.textContent = reason || copy.missing;
    if (pathEl) pathEl.textContent = t("panel.extPathPreparing");

    modal.hidden = false;
    modal.classList.add("open");

    const data = await ensureInstallPaths();
    const path = pathForRole(data, activeRole);
    if (pathEl) {
      pathEl.textContent = path || t("editor.ds.noPathReady");
    }
  }

  /**
   * @param {{ role?: string, reason?: string, pending?: object }} opts
   */
  async function requireExtension(opts) {
    const role = normalizeRole(opts?.role);
    if (hasRole(role)) {
      hideGate();
      return true;
    }
    pendingAction = opts?.pending || null;
    if (pendingAction) pendingAction.role = role;
    await showGate(role, opts?.reason || copyFor(role).missing);
    return false;
  }

  window.daRequireExtension = requireExtension;
  window.daRequireRecorder = (opts) => requireExtension({ ...opts, role: "recorder" });
  window.daRequirePlayer = (opts) => requireExtension({ ...opts, role: "player" });
  window.daRequireSelector = (opts) => requireExtension({ ...opts, role: "selector" });
  window.daRequireSmart = (opts) => requireExtension({ ...opts, role: "smart" });
  window.daHasExtension = hasExtension;
  window.daHasRecorder = hasRecorder;
  window.daHasPlayer = hasPlayer;
  window.daHasSelector = hasSelector;
  window.daHasSmart = hasSmart;

  function dismiss() {
    hideGate();
    pendingAction = null;
  }

  function copyTextFallback(text) {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }

  async function copyPath() {
    const data = await ensureInstallPaths();
    const path = pathForRole(data, activeRole) || pathEl?.textContent?.trim() || "";
    if (!path || /آماده‌سازی|آماده نشد|Preparing|not ready|noPath/i.test(path)) {
      if (hintEl) hintEl.textContent = t("panel.extPathPreparing");
      return;
    }
    try {
      await navigator.clipboard.writeText(path);
    } catch {
      copyTextFallback(path);
    }
    // Always close after a ready path — clipboard may be blocked in some hosts.
    hideGate();
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
    const r = normalizeRole(role);
    if (modal.classList.contains("open") && activeRole === r) {
      hideGate();
      if (hintEl) hintEl.textContent = copyFor(r).connected;
    }
    if (pendingAction && normalizeRole(pendingAction.role || activeRole) === r) {
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
      hintEl.textContent = copyFor(role).stillMissing;
    }
    return false;
  }

  /** First panel load: if Selector is missing, show install modal. */
  function promptSelectorIfMissing() {
    if (selectorPromptDone) return;
    if (!location.pathname.toLowerCase().includes("/panel")) return;
    if (hasSelector()) {
      selectorPromptDone = true;
      return;
    }
    // Wait briefly for content-script handshake (document_start may still be racing).
    const tryShow = (attempt) => {
      if (hasSelector()) {
        selectorPromptDone = true;
        return;
      }
      if (attempt < 6) {
        setTimeout(() => tryShow(attempt + 1), 250);
        return;
      }
      if (selectorPromptDone || hasSelector()) return;
      if (modal.classList.contains("open")) return;
      selectorPromptDone = true;
      showGate("selector", copyFor("selector").missing);
    };
    tryShow(0);
  }

  const RECORDER_ACTIONS = new Set([
    "start-record", "finish-record", "save-draft", "rerecord", "clear-draft", "check-recorder", "resume-record"
  ]);
  const PLAYER_ACTIONS = new Set([
    "play-task", "play-task-menu", "play-group", "play-step",
    "stop-play", "pause-play", "resume-play", "check-player"
  ]);
  const SELECTOR_ACTIONS = new Set(["check-selector"]);
  const SMART_ACTIONS = new Set(["start-smart-record", "check-smart"]);

  function isPlayButton(el) {
    if (!el) return false;
    const id = el.id || "";
    return id === "btn-play-task" || id === "btn-play-selection"
      || id === "btn-stop-play" || id === "btn-play-pause";
  }

  document.addEventListener("click", (ev) => {
    const el = ev.target instanceof Element
      ? ev.target.closest("[data-da-action], #btn-play-task, #btn-play-selection, #btn-stop-play, #btn-play-pause")
      : null;
    if (!el) return;

    const action = el.getAttribute("data-da-action");
    let role = null;
    if (action && RECORDER_ACTIONS.has(action)) role = "recorder";
    else if (action && PLAYER_ACTIONS.has(action)) role = "player";
    else if (action && SELECTOR_ACTIONS.has(action)) role = "selector";
    else if (action && SMART_ACTIONS.has(action)) role = "smart";
    else if (isPlayButton(el)) role = "player";
    if (!role) return;
    if (hasRole(role)) return;

    ev.preventDefault();
    ev.stopPropagation();
    pendingAction = { kind: "click", el, role };
    showGate(role, copyFor(role).missing);
  }, true);

  document.addEventListener("da:locale", () => {
    if (modal.classList.contains("open")) showGate(activeRole);
  });

  window.addEventListener("da-recorder-ready", () => onRoleOk("recorder"));
  window.addEventListener("da-player-ready", () => onRoleOk("player"));
  window.addEventListener("da-selector-ready", () => {
    selectorPromptDone = true;
    onRoleOk("selector");
  });
  window.addEventListener("da-smart-ready", () => onRoleOk("smart"));
  window.addEventListener("da-extension-ready", (ev) => {
    const role = ev.detail?.role;
    if (role === "player") onRoleOk("player");
    else if (role === "recorder") onRoleOk("recorder");
    else if (role === "selector") {
      selectorPromptDone = true;
      onRoleOk("selector");
    } else if (role === "smart") onRoleOk("smart");
    else {
      onRoleOk("recorder");
    }
  });
  window.addEventListener("da-extension-recheck", (ev) => {
    if (ev.detail?.role) activeRole = normalizeRole(ev.detail.role);
    check();
  });

  document.getElementById("da-ext-recheck")?.addEventListener("click", check);
  document.getElementById("da-ext-dismiss")?.addEventListener("click", dismiss);
  document.getElementById("da-ext-copy-path")?.addEventListener("click", copyPath);
  document.getElementById("da-ext-guide")?.addEventListener("click", () => {
    window.location.href = "/Panel/Extension/Install";
  });

  hideGate();
  ensureInstallPaths();
  promptSelectorIfMissing();
})();
