/** Recorder FAB — HUD like player: switches, live log, stop → review → save & continue. */
(async function initFab() {
  if (window !== window.top) return;
  if (window.__daFabInit || document.getElementById("da-recorder-fab")) return;
  // Player already owns this page for playback — don't mount a second HUD.
  if (document.documentElement.dataset.daMorobotMode === "play") return;
  window.__daFabInit = true;

  try {
    const { portalBase } = await chrome.storage.local.get("portalBase");
    const base = String(portalBase || "https://localhost:7201").replace(/\/$/, "");
    if (base && location.href.startsWith(base)) {
      window.__daFabInit = false;
      return;
    }
  } catch {
    /* continue */
  }

  const I18n = globalThis.DaExtI18n;
  const t = (key, vars) => (I18n ? I18n.t(key, vars) : key);
  if (I18n) await I18n.init();

  const ICO_SAVE = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M17 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V7l-4-4zm-5 16a3 3 0 1 1 0-6 3 3 0 0 1 0 6zm3-10H5V5h10v4z"/></svg>`;
  // Copy, not a save/memory glyph. What this button really does is copy the reviewed steps into
  // extension memory so they can be pasted into a diagram later — nothing is written to the process,
  // so a floppy (or a database) would promise a save that never happens. The two-pages glyph is the
  // same one the smart recorder uses for its copy action, which keeps the two extensions consistent.
  const ICO_COPY = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M16 1H4a2 2 0 0 0-2 2v14h2V3h12V1zm3 4H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2zm0 16H8V7h11v14z"/></svg>`;
  const ICO_CLOSE = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M18.3 5.7L12 12l6.3 6.3-1.4 1.4L10.6 13.4 4.3 19.7 2.9 18.3 9.2 12 2.9 5.7 4.3 4.3l6.3 6.3 6.3-6.3z"/></svg>`;

  const root = document.createElement("div");
  root.className = "da-recorder-root";
  root.id = "da-recorder-fab";
  root.innerHTML = `
    <div class="da-fab-panel" id="da-fab-panel" hidden>
      <div class="da-fab-resize" id="da-fab-resize" title="${t("rec.resize")}" aria-label="${t("rec.resize")}"></div>
      <div class="da-fab-head" title="${t("rec.dragHint")}">
        <div class="da-fab-status" id="da-fab-status">...</div>
        <button type="button" id="da-fab-close" class="da-ico-btn da-fab-close" title="${t("rec.closeHud")}" aria-label="${t("rec.closeHud")}" hidden>${ICO_CLOSE}</button>
      </div>
      <div class="da-play-hud">
        <div class="da-play-hud-top">
          <div class="da-fab-play-title" id="da-fab-rec-title">—</div>
          <div class="da-fab-play-meta" id="da-fab-rec-meta">—</div>
        </div>
        <div class="da-fab-switches" id="da-fab-switches">
          <label class="da-fab-switch">
            <span data-i18n-label="rec.trackInputClicks">${t("rec.trackInputClicks")}</span>
            <input type="checkbox" id="da-opt-input-clicks" />
            <span class="da-fab-switch-track" aria-hidden="true"></span>
          </label>
          <label class="da-fab-switch">
            <span data-i18n-label="rec.trackMouse">${t("rec.trackMouse")}</span>
            <input type="checkbox" id="da-opt-mouse" checked />
            <span class="da-fab-switch-track" aria-hidden="true"></span>
          </label>
        </div>
        <div class="da-fab-results" id="da-fab-results" aria-live="polite"></div>
        <div class="da-fab-play-actions da-fab-play-icons" id="da-fab-actions">
          <button type="button" id="da-fab-stop" class="da-ico-btn da-fab-stop" title="${t("rec.stop")}" aria-label="${t("rec.stop")}" hidden>
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M7 7h10v10H7V7z"/></svg>
          </button>
          <button type="button" id="da-fab-save" class="da-ico-btn da-fab-play" title="${t("rec.save")}" aria-label="${t("rec.save")}" hidden>
            ${ICO_SAVE}
          </button>
          <button type="button" id="da-fab-save-end" class="da-ico-btn da-fab-mem" title="${t("rec.copyMem")}" aria-label="${t("rec.copyMem")}" hidden>
            ${ICO_COPY}
          </button>
          <button type="button" id="da-fab-resume" class="da-ico-btn da-fab-rec" title="${t("rec.resume")}" aria-label="${t("rec.resume")}" hidden>
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M12 6a6 6 0 1 1 0 12 6 6 0 0 1 0-12zm0-2a8 8 0 1 0 0 16 8 8 0 0 0 0-16z"/><circle cx="12" cy="12" r="3.2" fill="currentColor"/></svg>
          </button>
          <button type="button" id="da-fab-end" class="da-ico-btn da-fab-clear" title="${t("rec.end")}" aria-label="${t("rec.end")}" hidden>
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M18.3 5.7L12 12l6.3 6.3-1.4 1.4L10.6 13.4 4.3 19.7 2.9 18.3 9.2 12 2.9 5.7 4.3 4.3l6.3 6.3 6.3-6.3z"/></svg>
          </button>
        </div>
      </div>
    </div>
    <div class="da-fab-chip-row" id="da-fab-chip-row" hidden>
      <button type="button" class="da-fab-btn da-fab-btn-hud" id="da-fab-toggle" title="${t("rec.panel")}">☰</button>
      <button type="button" id="da-fab-close-chip" class="da-ico-btn da-fab-close da-fab-close-chip" title="${t("rec.closeHud")}" aria-label="${t("rec.closeHud")}" hidden>${ICO_CLOSE}</button>
    </div>
  `;
  if (I18n) I18n.applyRoot(root);
  document.documentElement.appendChild(root);
  Object.assign(root.style, {
    position: "fixed", left: "18px", right: "auto", bottom: "18px", top: "auto",
    zIndex: "2147483647", alignItems: "flex-start"
  });

  const panel = root.querySelector("#da-fab-panel");
  const resizeHandle = root.querySelector("#da-fab-resize");
  const status = root.querySelector("#da-fab-status");
  const titleEl = root.querySelector("#da-fab-rec-title");
  const metaEl = root.querySelector("#da-fab-rec-meta");
  const resultsEl = root.querySelector("#da-fab-results");
  const switchesEl = root.querySelector("#da-fab-switches");
  const stopBtn = root.querySelector("#da-fab-stop");
  const saveBtn = root.querySelector("#da-fab-save");
  const saveEndBtn = root.querySelector("#da-fab-save-end");
  const resumeBtn = root.querySelector("#da-fab-resume");
  const endBtn = root.querySelector("#da-fab-end");
  const toggleBtn = root.querySelector("#da-fab-toggle");
  const chipRow = root.querySelector("#da-fab-chip-row");
  const closeBtn = root.querySelector("#da-fab-close");
  const closeChipBtn = root.querySelector("#da-fab-close-chip");
  const optInputClicks = root.querySelector("#da-opt-input-clicks");
  const optMouse = root.querySelector("#da-opt-mouse");

  let userCollapsed = false;
  let userDismissed = false;

  function dismissRecorderHud() {
    userDismissed = true;
    window.__daFabInit = false;
    try {
      if (document.documentElement.dataset.daMorobotMode === "record") {
        delete document.documentElement.dataset.daMorobotMode;
      }
    } catch { /* ignore */ }
    try { root.remove(); } catch { /* ignore */ }
  }

  async function tryDismissRecorderHud() {
    const state = await chrome.runtime.sendMessage({ type: "getState" }).catch(() => ({}));
    const phase = state?.recordPhase || "idle";
    if (state?.recording || phase === "recording") {
      if (status) status.textContent = t("rec.cannotCloseWhileRecording");
      return;
    }
    dismissRecorderHud();
  }

  closeBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    tryDismissRecorderHud();
  });
  closeChipBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    tryDismissRecorderHud();
  });
  const HUD_SIZE_KEY = "daRecHudSize";
  const HUD_MIN_W = 280;
  const HUD_MIN_H = 260;
  let hudPersistTimer = null;

  function hudMaxSize() {
    return {
      w: Math.max(HUD_MIN_W, window.innerWidth - 24),
      h: Math.max(HUD_MIN_H, window.innerHeight - 24)
    };
  }

  function applyHudSize(w, h) {
    const max = hudMaxSize();
    const width = Math.min(max.w, Math.max(HUD_MIN_W, Math.round(Number(w) || HUD_MIN_W)));
    const height = Math.min(max.h, Math.max(HUD_MIN_H, Math.round(Number(h) || HUD_MIN_H)));
    panel.style.width = `${width}px`;
    panel.style.height = `${height}px`;
    panel.style.maxWidth = `${max.w}px`;
    panel.style.maxHeight = `${max.h}px`;
    panel.classList.add("is-sized");
    return { w: width, h: height };
  }

  function persistHudSize(size, immediate) {
    const payload = { w: size.w, h: size.h, at: Date.now() };
    const write = () => {
      try { chrome.storage.local.set({ [HUD_SIZE_KEY]: payload }).catch(() => {}); } catch { /* ignore */ }
    };
    if (immediate) {
      if (hudPersistTimer) clearTimeout(hudPersistTimer);
      hudPersistTimer = null;
      write();
      return;
    }
    if (hudPersistTimer) clearTimeout(hudPersistTimer);
    hudPersistTimer = setTimeout(write, 120);
  }

  async function restoreHudSize() {
    try {
      const data = await chrome.storage.local.get(HUD_SIZE_KEY);
      const saved = data?.[HUD_SIZE_KEY];
      if (saved && Number(saved.w) > 0 && Number(saved.h) > 0) applyHudSize(saved.w, saved.h);
      else {
        panel.style.maxWidth = `${hudMaxSize().w}px`;
        panel.style.maxHeight = `${hudMaxSize().h}px`;
      }
    } catch {
      panel.style.maxWidth = `${hudMaxSize().w}px`;
      panel.style.maxHeight = `${hudMaxSize().h}px`;
    }
  }

  function bindHudResize() {
    if (!resizeHandle || !panel) return;
    let dragging = false;
    let startX = 0;
    let startY = 0;
    let startW = 0;
    let startH = 0;
    let lastSize = null;

    const onMove = (e) => {
      if (!dragging) return;
      e.preventDefault();
      const dx = e.clientX - startX;
      const dy = startY - e.clientY;
      lastSize = applyHudSize(startW + dx, startH + dy);
      persistHudSize(lastSize, false);
    };
    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      panel.classList.remove("is-resizing");
      document.body.style.removeProperty("cursor");
      document.body.style.removeProperty("user-select");
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerup", onUp, true);
      window.removeEventListener("pointercancel", onUp, true);
      const rect = panel.getBoundingClientRect();
      lastSize = applyHudSize(lastSize?.w || rect.width, lastSize?.h || rect.height);
      persistHudSize(lastSize, true);
    };

    resizeHandle.addEventListener("pointerdown", (e) => {
      if (e.button != null && e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      dragging = true;
      panel.classList.add("is-resizing");
      const rect = panel.getBoundingClientRect();
      startX = e.clientX;
      startY = e.clientY;
      startW = rect.width;
      startH = rect.height;
      lastSize = { w: startW, h: startH };
      document.body.style.cursor = "nesw-resize";
      document.body.style.userSelect = "none";
      window.addEventListener("pointermove", onMove, true);
      window.addEventListener("pointerup", onUp, true);
      window.addEventListener("pointercancel", onUp, true);
      try { resizeHandle.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    });

    window.addEventListener("resize", () => {
      if (panel.hidden) return;
      if (!panel.classList.contains("is-sized")) {
        panel.style.maxWidth = `${hudMaxSize().w}px`;
        panel.style.maxHeight = `${hudMaxSize().h}px`;
        return;
      }
      const rect = panel.getBoundingClientRect();
      persistHudSize(applyHudSize(rect.width, rect.height), true);
    });
  }

  bindHudResize();
  restoreHudSize();

  /**
   * Move the recorder HUD out of the way.
   *
   * Independent of resizing: the header (or chip row) is the drag handle so the buttons inside stay
   * clickable, and the position survives navigation because it is stored per edge as a fraction —
   * a narrower window then cannot leave the HUD off-screen.
   */
  const HUD_POS_KEY = "daRecHudPos";
  const HUD_DRAG_THRESHOLD = 4;
  let hudPos = null;

  function hudViewport() {
    return {
      w: window.innerWidth || document.documentElement.clientWidth || 0,
      h: window.innerHeight || document.documentElement.clientHeight || 0
    };
  }

  function applyHudPosition(pos) {
    if (!pos || typeof pos.fx !== "number" || typeof pos.fy !== "number") return;
    const rect = root.getBoundingClientRect();
    const { w, h } = hudViewport();
    const margin = 18;
    const fx = Math.min(1, Math.max(0, pos.fx));
    const fy = Math.min(1, Math.max(0, pos.fy));
    const usableX = Math.max(0, w - (rect.width || 360) - margin * 2);
    const usableY = Math.max(0, h - (rect.height || 120) - margin * 2);
    Object.assign(root.style, {
      left: `${Math.round(margin + usableX * fx)}px`,
      top: `${Math.round(margin + usableY * fy)}px`,
      right: "auto",
      bottom: "auto"
    });
    hudPos = { fx, fy };
  }

  async function restoreHudPosition() {
    try {
      const data = await chrome.storage.local.get(HUD_POS_KEY);
      applyHudPosition(data?.[HUD_POS_KEY]);
    } catch { /* keep the default corner */ }
  }

  function bindHudDrag() {
    const handles = [root.querySelector(".da-fab-head"), chipRow].filter(Boolean);
    let state = null;

    for (const handle of handles) {
      handle.addEventListener("pointerdown", (e) => {
        if (e.button != null && e.button !== 0) return;
        // Do not start a drag from a real control (close button, switch, resize handle).
        if (e.target.closest("button, a, input, select, textarea, #da-fab-resize")) return;
        const rect = root.getBoundingClientRect();
        state = {
          pointerId: e.pointerId,
          startX: e.clientX,
          startY: e.clientY,
          originLeft: rect.left,
          originTop: rect.top,
          moved: false
        };
        handle.setPointerCapture?.(e.pointerId);
      });

      handle.addEventListener("pointermove", (e) => {
        if (!state || e.pointerId !== state.pointerId) return;
        const dx = e.clientX - state.startX;
        const dy = e.clientY - state.startY;
        if (!state.moved && Math.hypot(dx, dy) < HUD_DRAG_THRESHOLD) return;
        if (!state.moved) {
          state.moved = true;
          root.classList.add("is-dragging");
          document.body.style.userSelect = "none";
        }
        e.preventDefault();
        const { w, h } = hudViewport();
        const rect = root.getBoundingClientRect();
        const left = Math.min(Math.max(0, w - rect.width), Math.max(0, state.originLeft + dx));
        const top = Math.min(Math.max(0, h - rect.height), Math.max(0, state.originTop + dy));
        Object.assign(root.style, {
          left: `${Math.round(left)}px`,
          top: `${Math.round(top)}px`,
          right: "auto",
          bottom: "auto"
        });
      });

      const end = (e) => {
        if (!state || (e && e.pointerId !== state.pointerId)) return;
        const moved = state.moved;
        state = null;
        root.classList.remove("is-dragging");
        document.body.style.removeProperty("user-select");
        if (!moved) return;
        const rect = root.getBoundingClientRect();
        const { w, h } = hudViewport();
        const margin = 18;
        const usableX = Math.max(1, w - rect.width - margin * 2);
        const usableY = Math.max(1, h - rect.height - margin * 2);
        hudPos = {
          fx: Math.min(1, Math.max(0, (rect.left - margin) / usableX)),
          fy: Math.min(1, Math.max(0, (rect.top - margin) / usableY))
        };
        chrome.storage.local.set({ [HUD_POS_KEY]: hudPos }).catch(() => {});
        root.addEventListener("click", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
        }, { capture: true, once: true });
      };
      handle.addEventListener("pointerup", end);
      handle.addEventListener("pointercancel", end);
    }

    window.addEventListener("resize", () => {
      if (hudPos) applyHudPosition(hudPos);
    });
  }

  bindHudDrag();
  restoreHudPosition();

  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"'`]/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;", "`": "&#96;" }[c]));
  }

  function stepTitle(s) {
    if (s?.title && String(s.title).trim()) return String(s.title).trim();
    const label = String(s?.elementLabel || "").trim();
    const t = String(s?.actionType || "Action");
    const verb = t.toLowerCase() === "gotourl" ? "رفتن به"
      : t.toLowerCase() === "inputcontent" ? "متن"
        : t === "Click" ? "کلیک" : t;
    if (label) return `${verb} ${label}`;
    if (t.toLowerCase() === "gotourl") {
      try { return `${verb} ${new URL(String(s.url || s.value || "")).hostname}`; } catch { /* ignore */ }
    }
    return verb;
  }

  function stepDetail(s) {
    const t = String(s?.actionType || "").toLowerCase();
    if (t === "gotourl") return String(s.url || s.value || "").slice(0, 80);
    if (t === "inputcontent") {
      const v = String(s.value ?? "").slice(0, 40);
      const sel = String(s.elementValue || "").slice(0, 40);
      return v ? `${v} · ${sel}` : sel;
    }
    return String(s.elementValue || "").slice(0, 80);
  }

  function renderResults(state) {
    if (!resultsEl) return;
    const phase = state.recordPhase || "idle";
    const steps = Array.isArray(state.steps) ? state.steps : [];
    const headLeft = phase === "review" ? t("rec.reviewHead") : t("rec.logHead");
    const headRight = t("rec.items", { n: steps.length });

    let body;
    if (!steps.length) {
      body = `<div class="da-fab-res-empty">${escapeHtml(phase === "review" ? t("rec.reviewEmpty") : t("rec.logEmpty"))}</div>`;
    } else if (phase === "review") {
      body = steps.map((s, i) => `
        <label class="da-fab-check-line">
          <input type="checkbox" class="da-rec-step-cb" data-idx="${i}" checked />
          <span class="da-fab-check-body">
            <span class="da-fab-res-title">${escapeHtml(stepTitle(s))} · ${i + 1}</span>
            <span class="da-fab-res-detail">${escapeHtml(stepDetail(s))}</span>
          </span>
        </label>`).join("");
    } else {
      body = steps.map((s, i) => `
        <div class="da-fab-res-line da-fab-res-ok">
          <span class="da-fab-res-idx">${i + 1}</span>
          <span class="da-fab-res-title">${escapeHtml(stepTitle(s))}</span>
          <span class="da-fab-res-detail">${escapeHtml(stepDetail(s))}</span>
        </div>`).join("");
    }

    resultsEl.innerHTML = `
      <div class="da-fab-res-head">
        <div>${escapeHtml(headLeft)}</div>
        <div>${escapeHtml(headRight)}</div>
      </div>
      <div class="da-fab-res-list">${body}</div>`;
    const list = resultsEl.querySelector(".da-fab-res-list");
    if (list && phase !== "review") list.scrollTop = list.scrollHeight;
  }

  function selectedIndexes() {
    return [...resultsEl.querySelectorAll(".da-rec-step-cb:checked")]
      .map((el) => Number(el.getAttribute("data-idx")))
      .filter((n) => Number.isFinite(n));
  }

  /**
   * The indexes a save/copy will act on, in the same order the save path resolves them.
   *
   * Shared by both actions so "nothing is selected" means the same thing (and reads the same) in
   * both. The fall-back to every step is deliberate — a recording usually wants all of it, and the
   * review list can be re-rendered by an incoming `draftUpdated` between ticking a box and pressing
   * the button, which would otherwise silently drop the selection the user made.
   */
  function resolveIndexes() {
    const picked = selectedIndexes();
    if (picked.length) return picked;
    return [...resultsEl.querySelectorAll(".da-rec-step-cb")]
      .map((el) => Number(el.getAttribute("data-idx")))
      .filter((n) => Number.isFinite(n));
  }

  /**
   * Put the outcome of an action on the HUD, coloured, and mirror it as a toast.
   *
   * Every action that can fail reports through here rather than writing to `status` directly. The
   * old code wrote a bare string, which looked identical whether the action had succeeded, been
   * refused by the server, or never run at all — so a broken button and a working one with an empty
   * selection were indistinguishable. The status line also gets a class so the colour carries the
   * same information, and the message stays until the next action instead of being overwritten by
   * the next `refresh()`.
   */
  function report(text, type) {
    if (status) {
      status.textContent = text;
      status.classList.toggle("is-error", type === "error");
      status.classList.toggle("is-success", type === "success");
    }
    try {
      window.dispatchEvent(new CustomEvent("da-notify", {
        detail: { message: text, type: type === "error" ? "error" : type === "success" ? "success" : "info" }
      }));
    } catch { /* ignore */ }
  }

  /** Turn a background reply into an error the user can act on, rather than a bare failure. */
  function describeFailure(res, fallbackKey) {
    // `network` is set by the background only when the portal was never reached, so the specific
    // cause it carries (connection refused, certificate rejected, bad host) is the useful part.
    if (res?.network) return res?.error || t("rec.portalDown");
    // The server answered and refused: its own message explains why better than a generic line.
    return res?.error || t(fallbackKey);
  }

  async function pushOptions() {
    await chrome.runtime.sendMessage({
      type: "setRecordOptions",
      options: {
        trackInputClicks: !!optInputClicks?.checked,
        trackMouse: !!optMouse?.checked
      }
    }).catch(() => {});
  }

  optInputClicks?.addEventListener("change", (e) => {
    e.stopPropagation();
    pushOptions();
  });
  optMouse?.addEventListener("change", (e) => {
    e.stopPropagation();
    pushOptions();
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "recordingChanged" || message.type === "draftUpdated") {
      if (message.recording || message.recordPhase === "recording" || message.recordPhase === "review") {
        userCollapsed = false;
      }
      refresh();
    }
  });

  toggleBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    userCollapsed = false;
    panel.hidden = false;
    if (chipRow) chipRow.hidden = true;
    toggleBtn.hidden = false;
    refresh();
  });

  status.addEventListener("dblclick", (e) => {
    e.preventDefault();
    userCollapsed = true;
    panel.hidden = true;
    if (chipRow) chipRow.hidden = false;
    toggleBtn.hidden = false;
  });

  stopBtn.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    stopBtn.disabled = true;
    try {
      await chrome.runtime.sendMessage({ type: "finishRecord" });
    } finally {
      await refresh();
    }
  });

  /**
   * Save the selected review steps into the target process.
   *
   * Unlike the copy action this one keeps its name dialog: the title becomes a visible group node on
   * the canvas, so the user is the only one who can choose it. It shares the selection resolution and
   * the failure reporting with the copy path through `resolveIndexes`/`report`/`describeFailure`.
   */
  async function saveReviewedSteps({ continueRecording }) {
    // Capture selection BEFORE prompt — prompt can cause re-renders that wipe checkboxes.
    const indexes = resolveIndexes();
    if (!indexes.length) {
      report(t("rec.reviewEmpty"), "error");
      return false;
    }
    const defName = t("rec.groupTitleDefault");
    const asked = window.prompt(t("rec.groupTitlePrompt"), defName);
    if (asked == null) {
      // A dismissed dialog is a deliberate cancel, not a failure: say so instead of silently doing
      // nothing, which was indistinguishable from the button being broken.
      report(t("rec.saveCancelled"), "info");
      return false;
    }
    const groupTitle = String(asked).trim();
    if (!groupTitle) {
      report(t("rec.groupTitleRequired"), "error");
      return false;
    }

    const st = await chrome.runtime.sendMessage({ type: "getState" }).catch(() => ({}));
    const res = await chrome.runtime.sendMessage({
      type: "saveDraft",
      payload: {
        taskId: st?.targetTaskId ?? null,
        selectedIndexes: indexes,
        continueRecording,
        groupTitle
      }
    });
    if (res?.ok) {
      const n = res.result?.stepCount ?? res.result?.groupCount ?? "?";
      report(continueRecording ? t("rec.saved", { n }) : t("rec.savedEnd", { n }), "success");
      userCollapsed = false;
      if (continueRecording) {
        renderResults({ recordPhase: "recording", steps: [], count: 0 });
      }
      return true;
    }
    // A per-reason message beats a generic one: "the target process was not found in the portal" and
    // "the server refused the save" need different things from the user, and the background already
    // distinguishes them.
    report(describeFailure(res, "rec.saveError"), "error");
    return false;
  }

  /**
   * Copy the reviewed steps into extension memory, without touching the process and without asking
   * for a name.
   *
   * Split out from `saveReviewedSteps` because it shares only the *selection* half of that function
   * and must not share the prompt: the group title in `saveReviewedSteps` becomes a visible group
   * node on the canvas, so it has to be asked for — whereas nothing is written here, so a name would
   * be a question with no consequence. Routing this button through the shared path (which it used to
   * do) meant it asked for a title and then failed whenever the dialog was dismissed or left blank,
   * which is exactly the "nothing happens" the user saw.
   */
  async function copyReviewedSteps() {
    const indexes = resolveIndexes();
    if (!indexes.length) {
      report(t("rec.reviewEmpty"), "error");
      return false;
    }

    const st = await chrome.runtime.sendMessage({ type: "getState" }).catch(() => ({}));
    const res = await chrome.runtime.sendMessage({
      type: "saveMemoryDraft",
      payload: {
        taskId: st?.targetTaskId ?? null,
        selectedIndexes: indexes
      }
    }).catch((err) => ({ ok: false, error: err?.message || String(err) }));

    if (res?.ok) {
      const n = res.result?.stepCount ?? indexes.length;
      report(t("rec.copiedMem", { n }), "success");
      userCollapsed = false;
      return true;
    }
    report(describeFailure(res, "rec.copyMemError"), "error");
    return false;
  }

  saveBtn.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    saveBtn.disabled = true;
    try {
      await saveReviewedSteps({ continueRecording: true });
    } finally {
      saveBtn.disabled = false;
      await refresh();
    }
  });

  saveEndBtn.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    saveEndBtn.disabled = true;
    try {
      await copyReviewedSteps();
    } finally {
      saveEndBtn.disabled = false;
      await refresh();
    }
  });

  resumeBtn.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    await chrome.runtime.sendMessage({ type: "resumeRecord" });
    await refresh();
  });

  endBtn.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    endBtn.disabled = true;
    try {
      await chrome.runtime.sendMessage({ type: "discardRecord", closeTab: true });
    } finally {
      // Tab may be closing; hide HUD locally.
      panel.hidden = true;
      toggleBtn.hidden = true;
      await refresh().catch(() => {});
    }
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.draft || changes.recording || changes.recordPhase || changes.recordingGroups || changes.recordOptions) {
      refresh();
    }
  });

  function applyStaticI18n() {
    if (I18n) I18n.applyRoot(root);
    root.querySelectorAll("[data-i18n-label]").forEach((el) => {
      el.textContent = t(el.getAttribute("data-i18n-label"));
    });
    const resize = root.querySelector("#da-fab-resize");
    if (resize) {
      resize.title = t("rec.resize");
      resize.setAttribute("aria-label", t("rec.resize"));
    }
    stopBtn.title = t("rec.stop");
    stopBtn.setAttribute("aria-label", t("rec.stop"));
    saveBtn.title = t("rec.save");
    saveBtn.setAttribute("aria-label", t("rec.save"));
    saveEndBtn.title = t("rec.copyMem");
    saveEndBtn.setAttribute("aria-label", t("rec.copyMem"));
    resumeBtn.title = t("rec.resume");
    resumeBtn.setAttribute("aria-label", t("rec.resume"));
    endBtn.title = t("rec.end");
    endBtn.setAttribute("aria-label", t("rec.end"));
    toggleBtn.title = t("rec.panel");
    if (closeBtn) {
      closeBtn.title = t("rec.closeHud");
      closeBtn.setAttribute("aria-label", t("rec.closeHud"));
    }
    if (closeChipBtn) {
      closeChipBtn.title = t("rec.closeHud");
      closeChipBtn.setAttribute("aria-label", t("rec.closeHud"));
    }
  }

  if (I18n) I18n.onChange(() => { applyStaticI18n(); refresh(); });

  async function refresh() {
    applyStaticI18n();
    const state = await chrome.runtime.sendMessage({ type: "getState" }).catch(() => ({
      recordPhase: "idle", count: 0, steps: []
    }));
    const session = await chrome.runtime.sendMessage({ type: "session" }).catch(() => ({
      userName: "test", version: "?"
    }));
    const phase = state.recordPhase || "idle";
    const active = phase === "recording" || phase === "review";
    const ver = session?.version || chrome.runtime.getManifest().version;
    const user = session?.userName || "test";
    const pageMode = document.documentElement.dataset.daMorobotMode || "";

    // Don't fight an active Player session on this page.
    if (!active && pageMode === "play") {
      panel.hidden = true;
      toggleBtn.hidden = true;
      return;
    }

    // Claim the page so Player HUD stays hidden while we record.
    if (active) document.documentElement.dataset.daMorobotMode = "record";
    else if (pageMode === "record") delete document.documentElement.dataset.daMorobotMode;

    if (!active) {
      panel.hidden = true;
      if (chipRow) chipRow.hidden = true;
      toggleBtn.hidden = true;
      if (closeBtn) closeBtn.hidden = true;
      if (closeChipBtn) closeChipBtn.hidden = true;
      return;
    }

    const canCloseHud = phase !== "recording";

    if (userCollapsed) {
      panel.hidden = true;
      if (chipRow) chipRow.hidden = false;
      toggleBtn.hidden = false;
      toggleBtn.textContent = "☰";
      toggleBtn.classList.toggle("recording", phase === "recording");
      if (closeChipBtn) closeChipBtn.hidden = !canCloseHud;
      if (closeBtn) closeBtn.hidden = true;
      return;
    }

    panel.hidden = false;
    if (chipRow) chipRow.hidden = true;
    toggleBtn.hidden = true;
    if (closeBtn) closeBtn.hidden = !canCloseHud;
    if (closeChipBtn) closeChipBtn.hidden = true;
    if (!panel.classList.contains("is-sized")) restoreHudSize();

    const opts = state.options || {};
    if (optInputClicks) optInputClicks.checked = !!opts.trackInputClicks;
    if (optMouse) optMouse.checked = opts.trackMouse !== false;

    const title = state.targetTitle
      || (state.targetTaskId ? t("rec.process", { id: state.targetTaskId }) : t("rec.fallbackTitle"));
    if (titleEl) titleEl.textContent = title;
    if (metaEl) {
      metaEl.textContent = phase === "review"
        ? t("rec.reviewMeta", { n: state.count || 0 })
        : t("rec.recordingMeta", { n: state.count || 0 });
    }

    if (switchesEl) switchesEl.hidden = phase !== "recording";
    stopBtn.hidden = phase !== "recording";
    stopBtn.disabled = false;
    // Both save buttons belong to the review step: they act on the steps the user is reviewing.
    saveBtn.hidden = phase !== "review";
    saveBtn.disabled = false;
    saveEndBtn.hidden = phase !== "review";
    saveEndBtn.disabled = false;
    resumeBtn.hidden = phase !== "review";
    endBtn.hidden = false;

    renderResults(state);

    // A report outranks the idle status line. Every action calls `refresh()` in its `finally`, so
    // without this the success/error message just written would be replaced immediately by the
    // generic "review / recording" text and the user would never see the outcome.
    if (!status.classList.contains("is-error") && !status.classList.contains("is-success")) {
      status.textContent = phase === "review"
        ? t("rec.statusReview")
        : `${t("rec.fallbackTitle")} v${ver} · ${user}`;
    }
  }

  refresh();
})();
