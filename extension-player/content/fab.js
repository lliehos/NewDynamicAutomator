/** Player FAB — start / pause / resume / stop / clear logs + results. */
(async function initFab() {
  if (window !== window.top) return;
  if (window.__daFabInit || document.getElementById("da-player-fab") || document.getElementById("da-recorder-fab")) return;
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

  const root = document.createElement("div");
  root.className = "da-recorder-root";
  root.id = "da-player-fab";
  root.innerHTML = `
    <div class="da-fab-panel" id="da-fab-panel" hidden>
      <div class="da-fab-resize" id="da-fab-resize" title="تغییر اندازه" aria-label="تغییر اندازه پنل"></div>
      <div class="da-fab-status" id="da-fab-status">...</div>
      <div class="da-play-hud">
        <div class="da-play-hud-top">
          <div class="da-fab-play-title" id="da-fab-play-title">—</div>
          <div class="da-fab-play-meta" id="da-fab-play-progress">—</div>
        </div>
        <div class="da-fab-results" id="da-fab-results" aria-live="polite"></div>
        <div class="da-fab-play-actions da-fab-play-icons">
          <button type="button" id="da-fab-playpause" class="da-ico-btn da-fab-play" title="اجرا" aria-label="اجرا" data-mode="play">
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M8 5.5v13l11-6.5L8 5.5z"/></svg>
          </button>
          <button type="button" id="da-fab-stop" class="da-ico-btn da-fab-stop" title="توقف (از اول)" aria-label="توقف" hidden>
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M7 7h10v10H7V7z"/></svg>
          </button>
          <button type="button" id="da-fab-clear-logs" class="da-ico-btn da-fab-clear" title="پاکسازی لاگ‌ها" aria-label="پاکسازی لاگ‌ها">
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M6 7h12v2H6V7zm2 3h8l-1 10H9L8 10zm3-5h2l1 2h4v2H6V7h4l1-2z"/></svg>
          </button>
        </div>
      </div>
    </div>
    <button type="button" class="da-fab-btn da-fab-btn-hud" id="da-fab-toggle" title="پنل اجرا" hidden>☰</button>
  `;
  document.documentElement.appendChild(root);
  Object.assign(root.style, {
    position: "fixed", left: "18px", right: "auto", bottom: "18px", top: "auto",
    zIndex: "2147483647", alignItems: "flex-start"
  });

  const panel = root.querySelector("#da-fab-panel");
  const resizeHandle = root.querySelector("#da-fab-resize");
  const status = root.querySelector("#da-fab-status");
  const playPauseBtn = root.querySelector("#da-fab-playpause");
  const stopBtn = root.querySelector("#da-fab-stop");
  const clearBtn = root.querySelector("#da-fab-clear-logs");
  const playTitle = root.querySelector("#da-fab-play-title");
  const playProgress = root.querySelector("#da-fab-play-progress");
  const playResults = root.querySelector("#da-fab-results");
  const toggleBtn = root.querySelector("#da-fab-toggle");

  const ICO_PLAY = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M8 5.5v13l11-6.5L8 5.5z"/></svg>`;
  const ICO_PAUSE = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M7 5h3v14H7V5zm7 0h3v14h-3V5z"/></svg>`;

  let lastPlaySnapshot = null;
  let userCollapsed = false;

  const HUD_SIZE_KEY = "daPlayHudSize";
  const HUD_MIN_W = 280;
  const HUD_MIN_H = 220;
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
      try {
        chrome.storage.local.set({ [HUD_SIZE_KEY]: payload }).catch(() => {});
      } catch { /* ignore */ }
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
      if (saved && Number(saved.w) > 0 && Number(saved.h) > 0) {
        applyHudSize(saved.w, saved.h);
      } else {
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
      // Panel anchored bottom-left: drag top-right corner → grow right / up
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
      const size = applyHudSize(rect.width, rect.height);
      persistHudSize(size, true);
    });
  }

  bindHudResize();
  restoreHudSize();
  // Re-apply after first show in case panel was hidden during restore
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes[HUD_SIZE_KEY]) return;
    const saved = changes[HUD_SIZE_KEY].newValue;
    if (saved?.w && saved?.h && !panel.classList.contains("is-resizing")) {
      applyHudSize(saved.w, saved.h);
    }
  });

  function setPlayPauseMode(mode, { paused = false } = {}) {
    // mode: "play" | "pause"  — pause icon = currently running (click to pause)
    playPauseBtn.dataset.mode = mode;
    playPauseBtn.classList.toggle("da-fab-play", mode === "play");
    playPauseBtn.classList.toggle("da-fab-pause", mode === "pause");
    playPauseBtn.classList.remove("da-fab-start", "da-fab-resume");
    if (mode === "pause") {
      playPauseBtn.title = "پاز";
      playPauseBtn.setAttribute("aria-label", "پاز");
      playPauseBtn.innerHTML = ICO_PAUSE;
    } else {
      const label = paused ? "ادامه" : "اجرا";
      playPauseBtn.title = label;
      playPauseBtn.setAttribute("aria-label", label);
      playPauseBtn.innerHTML = ICO_PLAY;
    }
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "playStateChanged") {
      lastPlaySnapshot = message;
      if (message.playing) userCollapsed = false;
      refresh(message);
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

  playPauseBtn.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (playPauseBtn.disabled) return;
    playPauseBtn.disabled = true;
    try {
      // Prefer button mode (what UI shows) over a possibly stale getState.
      const mode = playPauseBtn.dataset.mode || "play";
      if (mode === "pause") {
        const res = await chrome.runtime.sendMessage({ type: "pausePlay" })
          .catch((err) => ({ ok: false, error: err?.message || String(err) }));
        if (res?.ok === false && res?.error) {
          status.textContent = res.error;
        } else {
          setPlayPauseMode("play");
          playPauseBtn.title = "ادامه";
          playPauseBtn.setAttribute("aria-label", "ادامه");
          if (playProgress) {
            playProgress.textContent = playProgress.textContent.replace(/^▶/, "⏸ پاز —");
          }
          status.textContent = "پاز — اجرا=ادامه از همین‌جا · توقف=قطع و شروع از اول";
        }
      } else {
        const state = await chrome.runtime.sendMessage({ type: "getState" }).catch(() => ({}));
        const playing = !!(state.playing || state.play?.playing || lastPlaySnapshot?.playing);
        const paused = !!(state.play?.paused || lastPlaySnapshot?.paused || playPausedHint());

        if (playing && paused) {
          const res = await chrome.runtime.sendMessage({ type: "resumePlay" })
            .catch((err) => ({ ok: false, error: err?.message || String(err) }));
          if (res?.ok === false && res?.error) status.textContent = res.error;
          else {
            setPlayPauseMode("pause");
            status.textContent = "در حال اجرا — پاز یا توقف";
          }
        } else if (playing && !paused) {
          // Safety: UI said play but engine still running → pause
          await chrome.runtime.sendMessage({ type: "pausePlay" }).catch(() => null);
        } else {
          const { lastPlayRequest } = await chrome.storage.local.get("lastPlayRequest");
          const taskId = lastPlayRequest?.taskId || lastPlaySnapshot?.taskId || state.play?.taskId;
          if (!taskId) {
            status.textContent = "فرآیندی برای اجرا نیست — از پورتال اجرا کنید.";
            return;
          }
          const res = await chrome.runtime.sendMessage({
            type: "startPlay",
            taskId: Number(taskId),
            runMode: lastPlayRequest?.runMode,
            groupNodeId: lastPlayRequest?.groupNodeId || null,
            stepNodeId: lastPlayRequest?.stepNodeId || null
          }).catch((err) => ({ ok: false, error: err?.message || String(err) }));
          if (!res?.ok && !res?.reloading) {
            status.textContent = res?.error || "خطا در شروع";
          }
        }
      }
    } finally {
      await refresh();
    }
  });

  function playPausedHint() {
    return playPauseBtn.dataset.mode === "play"
      && !!(lastPlaySnapshot?.playing)
      && !!lastPlaySnapshot?.paused;
  }

  stopBtn.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    stopBtn.disabled = true;
    try {
      await chrome.runtime.sendMessage({ type: "stopPlay" });
    } finally {
      await refresh();
    }
  });

  clearBtn.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const res = await chrome.runtime.sendMessage({ type: "clearPlayLogs" }).catch(() => null);
    lastPlaySnapshot = res || { playing: false, logs: [], results: [] };
    await refresh(lastPlaySnapshot);
  });

  status.addEventListener("dblclick", (e) => {
    e.preventDefault();
    userCollapsed = true;
    panel.hidden = true;
    toggleBtn.hidden = false;
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && (changes.playing || changes.lastPlayRequest)) refresh();
  });

  function escapeHtml(s) {
    return String(s).replace(/[&<>"'`]/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;", "`": "&#96;" }[c]));
  }

  function hasHistory(play) {
    return (Array.isArray(play?.logs) && play.logs.length > 0)
      || (Array.isArray(play?.results) && play.results.length > 0)
      || !!play?.title
      || !!play?.taskId
      || !!play?.lastError;
  }

  function renderPlayResults(play) {
    if (!playResults) return;
    const loopLine = `حلقه ${play.loopIndex || 0} / ${play.loopTotal || 1}`
      + (play.repeatType && play.repeatType !== "None" ? ` · ${play.repeatType}` : "");
    const stepLine = `مرحله ${play.stepIndex || 0} / ${play.stepTotal || 0}`;
    const results = Array.isArray(play.results) ? play.results.slice(-40) : [];
    const logs = Array.isArray(play.logs) ? play.logs.slice(-40) : [];
    const resultHtml = results.length
      ? results.map((r) => {
          const cls = r.severity === "warn" || r.ignoredError
            ? "warn"
            : (r.ok ? "ok" : "err");
          return `<div class="da-fab-res-line da-fab-res-${cls}">`
            + `<span class="da-fab-res-idx">L${r.loop}/${r.loopTotal} · S${r.step}</span>`
            + `<span class="da-fab-res-title">${escapeHtml(r.title || r.actionType || "—")}</span>`
            + `<span class="da-fab-res-detail">${escapeHtml(r.detail || "")}</span>`
            + `</div>`;
        }).join("")
      : `<div class="da-fab-res-empty">هنوز نتیجه‌ای ثبت نشده</div>`;
    const logHtml = logs.length
      ? `<div class="da-fab-log">${logs.map((entry) => {
          const lv = entry.level || "info";
          const safe = ["error", "warn", "ok", "step", "info"].includes(lv) ? lv : "info";
          return `<div class="da-fab-log-line da-fab-log-${safe}">${escapeHtml(entry.text || "")}</div>`;
        }).join("")}</div>`
      : `<div class="da-fab-log"><div class="da-fab-res-empty">لاگی نیست</div></div>`;
    playResults.innerHTML = `
      <div class="da-fab-res-head">
        <div>${escapeHtml(loopLine)}</div>
        <div>${escapeHtml(stepLine)}</div>
      </div>
      <div class="da-fab-res-list">${resultHtml}</div>
      ${logHtml}
    `;
    const list = playResults.querySelector(".da-fab-res-list");
    if (list) list.scrollTop = list.scrollHeight;
    const logEl = playResults.querySelector(".da-fab-log");
    if (logEl) logEl.scrollTop = logEl.scrollHeight;
  }

  async function refresh(playHint) {
    const state = await chrome.runtime.sendMessage({ type: "getState" }).catch(() => ({
      playing: false, play: null
    }));
    const session = await chrome.runtime.sendMessage({ type: "session" }).catch(() => ({
      userName: "test", version: "?"
    }));
    const { lastPlayRequest } = await chrome.storage.local.get("lastPlayRequest").catch(() => ({}));

    const play = playHint && (playHint.logs != null || playHint.playing != null || playHint.paused != null)
      ? { ...(state.play || {}), ...playHint }
      : (lastPlaySnapshot || state.play || {});

    const playing = !!(state.playing || state.play?.playing || (playHint && playHint.playing));
    const paused = !!(state.play?.paused || play.paused);
    const ver = session?.version || chrome.runtime.getManifest().version;
    const user = session?.userName || "test";
    const canRestart = !!(lastPlayRequest?.taskId || play.taskId);
    const showHud = playing || hasHistory(play) || canRestart;

    if (!showHud) {
      panel.hidden = true;
      toggleBtn.hidden = true;
      return;
    }

    if (userCollapsed && !playing) {
      panel.hidden = true;
      toggleBtn.hidden = false;
      toggleBtn.textContent = "☰";
      return;
    }

    panel.hidden = false;
    toggleBtn.hidden = true;
    // Ensure saved size is applied when HUD becomes visible
    if (!panel.classList.contains("is-sized")) restoreHudSize();

    const title = play.title || lastPlayRequest?.title || (play.taskId ? `فرآیند #${play.taskId}` : "اجرا");
    if (playTitle) playTitle.textContent = title;
    if (playProgress) {
      const loop = `حلقه ${play.loopIndex || 0}/${play.loopTotal || 1}`;
      const step = `مرحله ${play.stepIndex || 0}/${play.stepTotal || 0}`;
      if (playing) {
        playProgress.textContent = paused ? `⏸ پاز — ${loop} · ${step}` : `▶ ${loop} · ${step}`;
      } else {
        playProgress.textContent = play.lastError ? "پایان با خطا" : (hasHistory(play) ? `پایان · ${loop} · ${step}` : "آماده شروع");
      }
    }
    renderPlayResults(play);

    // One toggle: Pause while running; Play/Resume when paused or stopped.
    if (playing && !paused) {
      setPlayPauseMode("pause");
      playPauseBtn.disabled = false;
    } else {
      setPlayPauseMode("play", { paused: !!(playing && paused) });
      playPauseBtn.disabled = playing ? false : !canRestart;
    }
    stopBtn.hidden = !playing;
    stopBtn.disabled = !playing;

    status.textContent = play.lastError && !playing
      ? String(play.lastError)
      : (playing
        ? (paused
          ? "پاز — اجرا=ادامه از همین‌جا · توقف=قطع و شروع از اول"
          : "در حال اجرا — پاز یا توقف")
        : (canRestart
          ? `آماده · v${ver} · ${user} — اجرا از اول`
          : `اجرا v${ver} · ${user}`));
  }

  refresh();
})();
