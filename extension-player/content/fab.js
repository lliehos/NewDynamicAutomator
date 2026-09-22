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

  function setPlayPauseMode(mode) {
    // mode: "play" | "pause"
    playPauseBtn.dataset.mode = mode;
    playPauseBtn.classList.toggle("da-fab-play", mode === "play");
    playPauseBtn.classList.toggle("da-fab-pause", mode === "pause");
    playPauseBtn.classList.remove("da-fab-start", "da-fab-resume");
    if (mode === "pause") {
      playPauseBtn.title = "پاز";
      playPauseBtn.setAttribute("aria-label", "پاز");
      playPauseBtn.innerHTML = ICO_PAUSE;
    } else {
      playPauseBtn.title = "اجرا";
      playPauseBtn.setAttribute("aria-label", "اجرا");
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
    playPauseBtn.disabled = true;
    try {
      const state = await chrome.runtime.sendMessage({ type: "getState" }).catch(() => ({}));
      const playing = !!(state.playing || state.play?.playing);
      const paused = !!(state.play?.paused);

      if (playing && !paused) {
        // Running → pause
        await chrome.runtime.sendMessage({ type: "pausePlay" });
      } else if (playing && paused) {
        // Paused → resume (continue)
        await chrome.runtime.sendMessage({ type: "resumePlay" });
      } else {
        // Stopped / idle → start from beginning
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
    } finally {
      await refresh();
    }
  });

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
          const cls = r.ok ? "ok" : "err";
          return `<div class="da-fab-res-line da-fab-res-${cls}">`
            + `<span class="da-fab-res-idx">L${r.loop}/${r.loopTotal} · S${r.step}</span>`
            + `<span class="da-fab-res-title">${escapeHtml(r.title || r.actionType || "—")}</span>`
            + `<span class="da-fab-res-detail">${escapeHtml(r.detail || "")}</span>`
            + `</div>`;
        }).join("")
      : `<div class="da-fab-res-empty">هنوز نتیجه‌ای ثبت نشده</div>`;
    const logHtml = logs.length
      ? `<div class="da-fab-log">${logs.map((entry) =>
          `<div class="da-fab-log-line da-fab-log-${entry.level || "info"}">${escapeHtml(entry.text || "")}</div>`
        ).join("")}</div>`
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

    // One toggle: Pause while running; Play when paused or stopped.
    // Stop ends the run; next Play starts from the beginning.
    if (playing && !paused) {
      setPlayPauseMode("pause");
      playPauseBtn.disabled = false;
    } else {
      setPlayPauseMode("play");
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
