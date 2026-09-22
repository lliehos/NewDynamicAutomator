(async function initFab() {
  if (window !== window.top) return;
  if (window.__daFabInit || document.getElementById("da-recorder-fab")) return;
  window.__daFabInit = true;

  // Portal already has per-task ضبط/اجرا — don't show the global REC FAB there.
  try {
    const { portalBase } = await chrome.storage.local.get("portalBase");
    const base = String(portalBase || "https://localhost:7201").replace(/\/$/, "");
    if (base && location.href.startsWith(base)) {
      window.__daFabInit = false;
      return;
    }
  } catch {
    /* continue — show FAB on non-portal pages */
  }

  const root = document.createElement("div");
  root.className = "da-recorder-root";
  root.id = "da-recorder-fab";
  root.innerHTML = `
    <div class="da-fab-panel" id="da-fab-panel" hidden>
      <div class="da-fab-status" id="da-fab-status">...</div>

      <div id="da-fab-idle">
        <div class="da-fab-section">ضبط</div>
        <p class="da-fab-hint">همیشه در تب جدید خالی شروع می‌شود؛ آدرس را خودتان باز کنید.</p>
        <button type="button" id="da-fab-record" class="da-fab-rec">شروع ضبط</button>
        <div class="da-fab-section">اجرا</div>
        <select id="da-fab-task" class="da-fab-select">
          <option value="">— انتخاب فرآیند —</option>
        </select>
        <button type="button" id="da-fab-play" class="da-fab-play">اجرای کل فرآیند</button>
      </div>

      <div id="da-fab-recording" hidden>
        <div class="da-fab-section">در حال ضبط</div>
        <p class="da-fab-hint">هر کلیک/ورودی و تغییر آدرس موقتاً ذخیره می‌شود. برای اتمام از همین پنل یا آیکون افزونه استفاده کنید.</p>
        <button type="button" id="da-fab-finish" class="da-fab-stop">اتمام ضبط</button>
      </div>

      <div id="da-fab-review" hidden>
        <div class="da-fab-section">اتمام ضبط</div>
        <p class="da-fab-hint" id="da-fab-review-count">۰ اکشن آماده است.</p>
        <input type="text" id="da-fab-title" class="da-fab-select" placeholder="عنوان فرآیند" value="فرآیند ضبط‌شده" />
        <button type="button" id="da-fab-upload" class="da-fab-play">ذخیره محلی</button>
        <button type="button" id="da-fab-rerecord" class="da-fab-rec">ضبط مجدد</button>
        <button type="button" id="da-fab-discard">انصراف</button>
      </div>

      <div id="da-fab-playing" hidden>
        <div class="da-play-hud">
          <div class="da-play-hud-top">
            <div class="da-fab-play-title" id="da-fab-play-title">—</div>
            <div class="da-fab-play-meta" id="da-fab-play-progress">—</div>
          </div>
          <div class="da-fab-results" id="da-fab-results" aria-live="polite"></div>
          <div class="da-fab-play-actions da-fab-play-icons">
            <button type="button" id="da-fab-pause" class="da-ico-btn da-fab-pause" title="پاز" aria-label="پاز">
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M7 5h3v14H7V5zm7 0h3v14h-3V5z"/></svg>
            </button>
            <button type="button" id="da-fab-resume" class="da-ico-btn da-fab-play" title="ادامه" aria-label="ادامه" hidden>
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M8 5.5v13l11-6.5L8 5.5z"/></svg>
            </button>
            <button type="button" id="da-fab-stop" class="da-ico-btn da-fab-stop" title="توقف" aria-label="توقف">
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M7 7h10v10H7V7z"/></svg>
            </button>
          </div>
        </div>
      </div>
    </div>
    <button type="button" class="da-fab-btn" id="da-fab-toggle" title="ضبط / اجرا">REC</button>
  `;
  document.documentElement.appendChild(root);
  // Force physical bottom-left (extension CSS alone may stay cached until Reload).
  Object.assign(root.style, {
    position: "fixed",
    left: "18px",
    right: "auto",
    bottom: "18px",
    top: "auto",
    zIndex: "2147483647",
    alignItems: "flex-start"
  });

  const panel = root.querySelector("#da-fab-panel");
  const status = root.querySelector("#da-fab-status");
  const idleBox = root.querySelector("#da-fab-idle");
  const recBox = root.querySelector("#da-fab-recording");
  const reviewBox = root.querySelector("#da-fab-review");
  const playBox = root.querySelector("#da-fab-playing");
  const recordBtn = root.querySelector("#da-fab-record");
  const finishBtn = root.querySelector("#da-fab-finish");
  const uploadBtn = root.querySelector("#da-fab-upload");
  const rerecordBtn = root.querySelector("#da-fab-rerecord");
  const discardBtn = root.querySelector("#da-fab-discard");
  const playBtn = root.querySelector("#da-fab-play");
  const stopBtn = root.querySelector("#da-fab-stop");
  const pauseBtn = root.querySelector("#da-fab-pause");
  const resumeBtn = root.querySelector("#da-fab-resume");
  const playTitle = root.querySelector("#da-fab-play-title");
  const playProgress = root.querySelector("#da-fab-play-progress");
  const playResults = root.querySelector("#da-fab-results");
  const taskSelect = root.querySelector("#da-fab-task");
  const toggleBtn = root.querySelector("#da-fab-toggle");
  const titleInp = root.querySelector("#da-fab-title");
  const reviewCount = root.querySelector("#da-fab-review-count");

  let lastPlaySnapshot = null;

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "playStateChanged") {
      lastPlaySnapshot = message;
      refresh(message);
      return;
    }
    if (message.type === "recordingChanged" || message.type === "draftUpdated") {
      refresh();
    }
  });

  toggleBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    panel.hidden = !panel.hidden;
    refresh();
  });

  recordBtn.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const res = await chrome.runtime.sendMessage({ type: "startRecordSession" });
    if (!res?.ok) status.textContent = res?.error || "خطا در شروع ضبط";
    else {
      status.textContent = "تب خالی باز شد — آدرس را تایپ کنید";
      panel.hidden = false;
    }
    await refresh();
  });

  finishBtn.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const res = await chrome.runtime.sendMessage({ type: "finishRecord" });
    if (!res?.ok) status.textContent = res?.error || "خطا";
    else {
      status.textContent = `${res.count || 0} اکشن ضبط شد — یکی از گزینه‌ها را انتخاب کنید.`;
      panel.hidden = false;
    }
    await refresh();
  });

  uploadBtn.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const title = (titleInp.value || "").trim() || "فرآیند ضبط‌شده";
    const res = await chrome.runtime.sendMessage({
      type: "saveDraft",
      payload: { newTaskTitle: title }
    });
    const portal = (await chrome.storage.local.get("portalBase")).portalBase || "https://localhost:7201";
    if (res?.ok) {
      status.textContent = `ذخیره محلی شد. ویرایش: ${portal}/Tasks/Editor/${res.result.taskId}`;
      panel.hidden = false;
    } else {
      status.textContent = res?.error || "خطا در ارسال";
    }
    await refresh();
  });

  rerecordBtn.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const res = await chrome.runtime.sendMessage({ type: "rerecord", rerecord: true });
    if (!res?.ok) status.textContent = res?.error || "خطا";
    else status.textContent = "ضبط مجدد — تب خالی باز شد.";
    await refresh();
  });

  discardBtn.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    await chrome.runtime.sendMessage({ type: "discardRecord" });
    status.textContent = "ضبط لغو و پیش‌نویس پاک شد.";
    await refresh();
  });

  playBtn.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const taskId = Number(taskSelect.value);
    if (!taskId) {
      status.textContent = "یک فرآیند انتخاب کنید.";
      return;
    }
    const res = await chrome.runtime.sendMessage({ type: "startPlay", taskId });
    status.textContent = res.ok
      ? `اجرای «${res.title || taskId}» — ${res.stepTotal} مرحله`
      : res.error || "خطا در اجرا";
    await refresh();
  });

  stopBtn.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    await chrome.runtime.sendMessage({ type: "stopPlay" });
    status.textContent = "اجرا متوقف شد.";
    await refresh();
  });

  pauseBtn.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    await chrome.runtime.sendMessage({ type: "pausePlay" });
    await refresh();
  });

  resumeBtn.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    await chrome.runtime.sendMessage({ type: "resumePlay" });
    await refresh();
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && (changes.draft || changes.recording || changes.recordPhase || changes.playing)) {
      refresh();
    }
  });

  async function loadTasks() {
    const prev = taskSelect.value;
    const res = await chrome.runtime.sendMessage({ type: "listTasks" });
    taskSelect.innerHTML = `<option value="">— انتخاب فرآیند —</option>`;
    if (!res?.ok || !Array.isArray(res.tasks)) return;
    for (const t of res.tasks) {
      const opt = document.createElement("option");
      opt.value = String(t.id);
      opt.textContent = `${t.title} (#${t.id})`;
      taskSelect.appendChild(opt);
    }
    if (prev) taskSelect.value = prev;
  }

  function renderPlayResults(play) {
    if (!playResults) return;
    const loopLine = `حلقه ${play.loopIndex || 0} / ${play.loopTotal || 1}`
      + (play.repeatType && play.repeatType !== "None" ? ` · ${play.repeatType}` : "");
    const stepLine = `مرحله ${play.stepIndex || 0} / ${play.stepTotal || 0}`;
    const results = Array.isArray(play.results) ? play.results.slice(-30) : [];
    const logs = Array.isArray(play.logs) ? play.logs.slice(-20) : [];

    const resultHtml = results.length
      ? results.map((r) => {
          const ok = !!r.ok;
          const cls = ok ? "ok" : "err";
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
      : "";

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

  function escapeHtml(s) {
    return String(s).replace(/[&<>"'`]/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;", "`": "&#96;" }[c]));
  }

  async function refresh(playHint) {
    const state = await chrome.runtime.sendMessage({ type: "getState" }).catch(() => ({
      recordPhase: "idle", count: 0, playing: false, signedIn: true, play: null
    }));
    const session = await chrome.runtime.sendMessage({ type: "session" }).catch(() => ({
      signedIn: true, userName: "test", local: true, version: "?"
    }));

    const play = playHint?.playing != null
      ? playHint
      : (lastPlaySnapshot?.playing ? lastPlaySnapshot : (state.play || {}));
    const playing = !!(state.playing || play.playing);
    const paused = !!(play.paused || playHint?.paused);
    const phase = state.recordPhase || "idle";
    const user = session?.userName || state.localUser || "test";
    const ver = session?.version || chrome.runtime.getManifest().version;

    idleBox.hidden = true;
    recBox.hidden = true;
    reviewBox.hidden = true;
    playBox.hidden = true;
    toggleBtn.classList.remove("recording", "playing", "paused");
    toggleBtn.hidden = false;

    if (playing) {
      playBox.hidden = false;
      panel.hidden = false;
      // During play, hide the REC circle — controls are icon pause/stop.
      toggleBtn.hidden = true;
      toggleBtn.classList.add(paused ? "paused" : "playing");

      if (playTitle) playTitle.textContent = play.title || `فرآیند #${play.taskId || ""}`;
      if (playProgress) {
        const loop = `حلقه ${play.loopIndex || 0}/${play.loopTotal || 1}`;
        const step = `مرحله ${play.stepIndex || 0}/${play.stepTotal || 0}`;
        playProgress.textContent = paused
          ? `⏸ پاز — ${loop} · ${step}`
          : `▶ ${loop} · ${step}`;
      }
      renderPlayResults(play);
      pauseBtn.hidden = !!paused;
      resumeBtn.hidden = !paused;
      status.textContent = play.lastError
        ? String(play.lastError)
        : (paused ? "متوقف موقت" : "اجرا از نود شروع");
      return;
    }

    // Not playing — normal record FAB
    if (phase === "recording") {
      recBox.hidden = false;
      toggleBtn.classList.add("recording");
      toggleBtn.textContent = "REC●";
      panel.hidden = false;
    } else if (phase === "review") {
      reviewBox.hidden = false;
      toggleBtn.textContent = "✓";
      panel.hidden = false;
    } else {
      idleBox.hidden = false;
      toggleBtn.textContent = "REC";
      toggleBtn.title = "ضبط / اجرا";
    }

    if (reviewCount) reviewCount.textContent = `${state.count || 0} اکشن آماده ذخیره است.`;

    if (phase === "recording") {
      status.textContent = `در حال ضبط — ${state.count || 0} اکشن (موقت)`;
    } else if (phase === "review") {
      status.textContent = `ضبط تمام شد — ${state.count || 0} اکشن`;
    } else {
      status.textContent = `v${ver} · ${user} · آماده (محلی)`;
    }

    if (!taskSelect.dataset.loaded) {
      await loadTasks();
      taskSelect.dataset.loaded = "1";
    }
  }

  refresh();
})();
