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

  const root = document.createElement("div");
  root.className = "da-recorder-root";
  root.id = "da-recorder-fab";
  root.innerHTML = `
    <div class="da-fab-panel" id="da-fab-panel" hidden>
      <div class="da-fab-resize" id="da-fab-resize" title="${t("rec.resize")}" aria-label="${t("rec.resize")}"></div>
      <div class="da-fab-status" id="da-fab-status">...</div>
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
          <button type="button" id="da-fab-resume" class="da-ico-btn da-fab-rec" title="${t("rec.resume")}" aria-label="${t("rec.resume")}" hidden>
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M12 6a6 6 0 1 1 0 12 6 6 0 0 1 0-12zm0-2a8 8 0 1 0 0 16 8 8 0 0 0 0-16z"/><circle cx="12" cy="12" r="3.2" fill="currentColor"/></svg>
          </button>
          <button type="button" id="da-fab-end" class="da-ico-btn da-fab-clear" title="${t("rec.end")}" aria-label="${t("rec.end")}" hidden>
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M18.3 5.7L12 12l6.3 6.3-1.4 1.4L10.6 13.4 4.3 19.7 2.9 18.3 9.2 12 2.9 5.7 4.3 4.3l6.3 6.3 6.3-6.3z"/></svg>
          </button>
        </div>
      </div>
    </div>
    <button type="button" class="da-fab-btn da-fab-btn-hud" id="da-fab-toggle" title="${t("rec.panel")}" hidden>☰</button>
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
  const resumeBtn = root.querySelector("#da-fab-resume");
  const endBtn = root.querySelector("#da-fab-end");
  const toggleBtn = root.querySelector("#da-fab-toggle");
  const optInputClicks = root.querySelector("#da-opt-input-clicks");
  const optMouse = root.querySelector("#da-opt-mouse");

  let userCollapsed = false;
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
    toggleBtn.hidden = true;
    refresh();
  });

  status.addEventListener("dblclick", (e) => {
    e.preventDefault();
    userCollapsed = true;
    panel.hidden = true;
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

  saveBtn.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    // Capture selection BEFORE prompt — prompt can cause re-renders that wipe checkboxes.
    let indexes = selectedIndexes();
    if (!indexes.length) {
      const all = [...resultsEl.querySelectorAll(".da-rec-step-cb")]
        .map((el) => Number(el.getAttribute("data-idx")))
        .filter((n) => Number.isFinite(n));
      indexes = all;
    }
    if (!indexes.length) {
      status.textContent = t("rec.reviewEmpty");
      return;
    }
    const defName = t("rec.groupTitleDefault");
    const asked = window.prompt(t("rec.groupTitlePrompt"), defName);
    if (asked == null) return;
    const groupTitle = String(asked).trim();
    if (!groupTitle) {
      status.textContent = t("rec.groupTitleRequired");
      return;
    }
    saveBtn.disabled = true;
    try {
      const res = await chrome.runtime.sendMessage({
        type: "saveDraft",
        payload: {
          selectedIndexes: indexes,
          continueRecording: true,
          groupTitle
        }
      });
      if (res?.ok) {
        status.textContent = t("rec.saved", { n: res.result?.groupCount || "?" });
        userCollapsed = false;
        // Force empty log UI then re-sync from storage (should be empty draft).
        if (resultsEl) {
          resultsEl.innerHTML = `
            <div class="da-fab-res-head">
              <div>${escapeHtml(t("rec.logHead"))}</div>
              <div>${escapeHtml(t("rec.items", { n: 0 }))}</div>
            </div>
            <div class="da-fab-res-list">
              <div class="da-fab-res-empty">${escapeHtml(t("rec.logEmpty"))}</div>
            </div>`;
        }
      } else {
        status.textContent = res?.error || t("rec.saveError");
        saveBtn.disabled = false;
      }
    } finally {
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
    resumeBtn.title = t("rec.resume");
    resumeBtn.setAttribute("aria-label", t("rec.resume"));
    endBtn.title = t("rec.end");
    endBtn.setAttribute("aria-label", t("rec.end"));
    toggleBtn.title = t("rec.panel");
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
      toggleBtn.hidden = true;
      return;
    }

    if (userCollapsed) {
      panel.hidden = true;
      toggleBtn.hidden = false;
      toggleBtn.textContent = "☰";
      toggleBtn.classList.toggle("recording", phase === "recording");
      return;
    }

    panel.hidden = false;
    toggleBtn.hidden = true;
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
    saveBtn.hidden = phase !== "review";
    saveBtn.disabled = false;
    resumeBtn.hidden = phase !== "review";
    endBtn.hidden = false;

    renderResults(state);

    status.textContent = phase === "review"
      ? t("rec.statusReview")
      : `${t("rec.fallbackTitle")} v${ver} · ${user}`;
  }

  refresh();
})();
