(function () {
  const modal = document.getElementById("da-ext-modal");
  if (!modal) return;

  const titleEl = document.getElementById("da-ext-title");
  const descEl = document.getElementById("da-ext-desc");
  // The path element is gone on purpose: the server's own extension folder was shown here, and it
  // does not exist on the user's machine, so it could never be used. Only the download links remain.
  // Both lookups stay null-tolerant so an older cached page still runs this script without error.
  const pathEl = document.getElementById("da-ext-modal-path");
  const pathLabelEl = document.getElementById("da-ext-path-label");
  const hintEl = document.getElementById("da-ext-modal-hint");
  const versionsEl = document.getElementById("da-ext-versions");

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

  /**
   * The version the PORTAL expects, and the one the browser actually has.
   *
   * A connected-but-OUTDATED bundle is the failure mode that looks healthiest: every surface says
   * "the extension is connected", so a run starts — on code that predates the required engine.
   * That is exactly how a bug that was already fixed ("Maximum call stack size exceeded" in the
   * player) keeps happening on machines that never reloaded the extension. The fix is to say which
   * version is required, right where the user is told to install it.
   */
  function roleVersionKey(role) {
    if (role === "player") return "daPlayerVersion";
    if (role === "selector") return "daSelectorVersion";
    if (role === "smart") return "daSmartVersion";
    return "daRecorderVersion";
  }

  /** Version reported by the loaded extension (set by portal-bridge on every portal page). */
  function installedVersion(role) {
    try {
      return String(document.documentElement.dataset[roleVersionKey(normalizeRole(role))] || "").trim();
    } catch {
      return "";
    }
  }

  /** Version carried by the server's synced extension package — the one to install. */
  function requiredVersion(data, role) {
    if (!data) return "";
    if (normalizeRole(role) === "smart") return String(data.smart?.version || "").trim();
    return String(data.global?.version || data.version || "").trim();
  }

  function versionIsStale(data, role) {
    const req = requiredVersion(data, role);
    const inst = installedVersion(role);
    return !!(req && inst && req !== inst);
  }

  function staleReason(data, role) {
    return t("panel.extVersionStale", {
      have: installedVersion(role),
      need: requiredVersion(data, role)
    });
  }

  /** Renders "required X — installed Y" in the modal; returns true when they differ. */
  function renderVersions(data) {
    if (!versionsEl) return false;
    const req = requiredVersion(data, activeRole);
    const inst = installedVersion(activeRole);
    if (!req && !inst) {
      versionsEl.hidden = true;
      versionsEl.textContent = "";
      versionsEl.classList.remove("is-stale");
      return false;
    }
    const parts = [];
    if (req) parts.push(t("panel.extVersionRequired", { v: req }));
    if (inst) parts.push(t("panel.extVersionInstalled", { v: inst }));
    const key = String(data?.appInstanceKey || "").trim();
    // "default" is the internal sentinel for "no key" — never show it to a user.
    if (key && key.toLowerCase() !== "default") parts.push(t("panel.extServerKey", { v: key }));
    versionsEl.hidden = false;
    versionsEl.textContent = parts.join(" — ");
    const stale = versionIsStale(data, activeRole);
    versionsEl.classList.toggle("is-stale", stale);
    return stale;
  }

  /** Path for the active role only — never fall back to another extension's folder. */
  function pathForRole(data, role) {
    const r = normalizeRole(role);
    const globalPath = String(data?.global?.path || data?.recorder?.path || data?.player?.path || data?.selector?.path || data?.path || "").trim();
    if (r === "recorder" || r === "player" || r === "selector") {
      if (globalPath) return globalPath;
    }
    const pack = data?.[r];
    let p = String(pack?.path || pack?.installPath || "").trim();
    if (p) return p;
    if (r === "smart") {
      const sibling = globalPath || "";
      if (sibling) {
        p = String(sibling)
          .replace(/extension-global/i, "extension-smart-recorder")
          .replace(/extension-recorder/i, "extension-smart-recorder")
          .replace(/extension-player/i, "extension-smart-recorder")
          .replace(/extension-selector/i, "extension-smart-recorder");
        if (/extension-smart-recorder/i.test(p)) return p;
      }
    }
    return "";
  }

  /** Raw "an extension marked this page" flags — these may belong to ANOTHER deployment. */
  function markedRaw(role) {
    const d = document.documentElement.dataset;
    if (role === "player") return d.daPlayerExtension === "1";
    if (role === "selector") return d.daSelectorExtension === "1";
    if (role === "smart") return d.daSmartExtension === "1";
    return d.daRecorderExtension === "1" || d.daExtension === "1";
  }

  /** The fingerprint THIS page's server expects; the meta tag is authoritative, the cache a fallback. */
  function serverFingerprint() {
    const meta = document.querySelector('meta[name="da-server-fingerprint"]');
    const fromMeta = meta ? String(meta.getAttribute("content") || "").trim() : "";
    if (fromMeta) return fromMeta;
    return String(pathsCache?.fingerprint || "").trim();
  }

  function extensionFingerprint() {
    return String(document.documentElement.dataset.daExtensionFingerprint || "").trim();
  }

  /**
   * True when the extension that marked this page is THIS server's own build.
   *
   * On a machine with two panels, both extensions inject into every page, so a plain
   * "daPlayerExtension=1" only proves that SOME Morobot extension is installed — which is exactly
   * how a run could start against the wrong server. The marked bundle must name the fingerprint the
   * page expects. A marked bundle with NO fingerprint while the server has one is not ours either:
   * it is an older build, from here or from elsewhere, and pretending it is connected would let the
   * very bugs the fingerprint exists to stop. Servers too old to publish a fingerprint skip the
   * comparison entirely, preserving the previous behaviour.
   */
  function fingerprintOk() {
    const expected = serverFingerprint();
    if (!expected) return true;
    const actual = extensionFingerprint();
    return !!actual && actual === expected;
  }

  /** Marked, but by a bundle that is not this server's own. */
  function markedNotOwn(role) {
    return markedRaw(normalizeRole(role)) && !fingerprintOk();
  }

  function hasRecorder() {
    return markedRaw("recorder") && fingerprintOk();
  }

  function hasPlayer() {
    return markedRaw("player") && fingerprintOk();
  }

  function hasSelector() {
    return markedRaw("selector") && fingerprintOk();
  }

  function hasSmart() {
    // Smart Recorder is a separate bundle with its own scope; unchanged.
    return markedRaw("smart");
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

  /**
   * True when an extension is installed that belongs to a DIFFERENT server.
   *
   * The extension's own handshake stamps `daExtensionForeign` when the page's server fingerprint
   * does not match the fingerprint it was built for. A correct extension on the same machine sets
   * its normal "connected" marks, so that case must win — otherwise a page with one correct and
   * one foreign extension would claim to be unserved.
   */
  function isForeignInstalled() {
    return document.documentElement.dataset.daExtensionForeign === "1" && !hasExtension();
  }

  /** Why the role is not connected: a foreign/older bundle deserves its own explanation. */
  function missingReason(role) {
    return (isForeignInstalled() || markedNotOwn(role)) ? t("panel.extForeign") : copyFor(role).missing;
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
    if (hintEl) hintEl.textContent = reason || missingReason(activeRole);
    if (pathEl) pathEl.textContent = t("panel.extPathPreparing");

    modal.hidden = false;
    modal.classList.add("open");

    // `pathEl` only exists when the page was rendered for a LOCAL request, where the folder really is
    // on this machine and the path is useful. Remotely the markup carries download links instead and
    // there is nothing to fill in — so both outcomes are handled by the same null check.
    const data = await ensureInstallPaths();
    if (pathEl) {
      const path = pathForRole(data, activeRole);
      pathEl.textContent = path || t("editor.ds.noPathReady");
    }
    // Version line — and when the loaded bundle differs from the required one, that outranks the
    // generic "not found" hint: the fix is an update, not a fresh install.
    if (renderVersions(data)) {
      if (hintEl) hintEl.textContent = staleReason(data, activeRole);
    }
  }

  /**
   * @param {{ role?: string, reason?: string, pending?: object }} opts
   */
  async function requireExtension(opts) {
    const role = normalizeRole(opts?.role);
    if (hasRole(role)) {
      // Connected, but possibly the WRONG build: compare against the version the portal ships.
      const data = await ensureInstallPaths();
      if (versionIsStale(data, role)) {
        pendingAction = opts?.pending || null;
        if (pendingAction) pendingAction.role = role;
        await showGate(role, staleReason(data, role));
        return false;
      }
      hideGate();
      return true;
    }
    pendingAction = opts?.pending || null;
    if (pendingAction) pendingAction.role = role;
    await showGate(role, opts?.reason || missingReason(role));
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
  // Sync staleness probe for the page's own click handlers: a CONNECTED but OUTDATED bundle must
  // not be used to start a run. Reads the warm cache only — never the network — so it is safe to
  // call from a click handler.
  window.daExtensionVersionStale = (role) => versionIsStale(pathsCache, normalizeRole(role));

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
    // In local mode the path element is present and holds the real folder, so it is copied verbatim.
    // Otherwise the button copies install INSTRUCTIONS: the previous behaviour copied the server's
    // folder, which does not exist on a remote user's machine — the file was correct, the instruction
    // was not, so it sent people looking for a directory they could never find.
    const data = await ensureInstallPaths();
    let text = pathEl ? pathForRole(data, activeRole) : "";
    if (!text || /آماده‌سازی|آماده نشد|Preparing|not ready|noPath/i.test(text)) {
      text = `${t("panel.extCopyInstruction")}\n${location.origin}/Panel/Extension/Install`;
    }
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      copyTextFallback(text);
    }
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
      // The installed version may just have changed (Reload), so re-render the line first.
      renderVersions(pathsCache);
      // Still stale after a reinstall/reload? Say so instead of silently succeeding.
      if (versionIsStale(pathsCache, role)) {
        if (hintEl) hintEl.textContent = staleReason(pathsCache, role);
        return false;
      }
      onRoleOk(role);
      return true;
    }
    if (modal.classList.contains("open") && hintEl) {
      hintEl.textContent = (isForeignInstalled() || markedNotOwn(role))
        ? t("panel.extForeign")
        : copyFor(role).stillMissing;
    }
    return false;
  }

  function capabilityForRole(role) {
    const r = normalizeRole(role);
    if (r === "player") return "play";
    if (r === "selector") return "selector";
    if (r === "smart") return "smart";
    return "record";
  }

  function planAllowsRole(role) {
    const e = window.DaEntitlements ? DaEntitlements.get() : null;
    if (!e) return true;
    const r = normalizeRole(role);
    if (r === "player") return !!e.canPlay;
    if (r === "selector") return !!e.canSelector;
    if (r === "smart") return !!e.canSmart;
    return !!e.canRecord;
  }

  function blockForPlan(role) {
    if (window.DaEntitlements) DaEntitlements.showUpgrade(capabilityForRole(role));
    return false;
  }

  /** First panel load: if Selector is missing (and plan allows), show install modal. */
  function promptSelectorIfMissing() {
    if (selectorPromptDone) return;
    if (!location.pathname.toLowerCase().includes("/panel")) return;
    if (!planAllowsRole("selector")) {
      selectorPromptDone = true;
      return;
    }
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
      showGate("selector", missingReason("selector"));
    };
    tryShow(0);
  }

  const RECORDER_ACTIONS = new Set([
    "start-record", "start-record-menu", "finish-record", "save-draft", "rerecord", "clear-draft", "check-recorder", "resume-record"
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
    if (!planAllowsRole(role)) {
      ev.preventDefault();
      ev.stopPropagation();
      blockForPlan(role);
      return;
    }
    if (hasRole(role)) {
      // A click must not wait for the network, so this compares against the CACHE only; the cache is
      // warmed on load below. An up-to-date bundle returns here, exactly as before.
      if (!versionIsStale(pathsCache, role)) return;
      ev.preventDefault();
      ev.stopPropagation();
      pendingAction = { kind: "click", el, role };
      showGate(role, staleReason(pathsCache, role));
      return;
    }

    ev.preventDefault();
    ev.stopPropagation();
    pendingAction = { kind: "click", el, role };
    showGate(role, missingReason(role));
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

  // Warm the install-path cache: it carries the REQUIRED extension version, and the click gate has
  // to be able to compare versions synchronously. One request per page load.
  ensureInstallPaths().catch(() => {});
  document.getElementById("da-ext-guide")?.addEventListener("click", () => {
    window.location.href = "/Panel/Extension/Install";
  });

  hideGate();
  ensureInstallPaths();
  promptSelectorIfMissing();
})();
