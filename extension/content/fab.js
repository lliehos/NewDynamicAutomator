(function initFab() {
  if (window !== window.top) return;
  if (document.getElementById("da-recorder-fab")) return;

  const root = document.createElement("div");
  root.className = "da-recorder-root";
  root.id = "da-recorder-fab";
  root.innerHTML = `
    <div class="da-fab-panel" id="da-fab-panel" hidden>
      <div class="da-fab-status" id="da-fab-status">...</div>

      <div id="da-fab-idle">
        <div class="da-fab-section">ضبط</div>
        <p class="da-fab-hint">تب خالی باز می‌شود؛ آدرسی که تایپ کنید به‌عنوان مرحله GoToUrl ثبت می‌شود.</p>
        <button type="button" id="da-fab-record" class="da-fab-rec">شروع ضبط</button>
        <div class="da-fab-section">اجرا</div>
        <select id="da-fab-task" class="da-fab-select">
          <option value="">— انتخاب فرآیند —</option>
        </select>
        <button type="button" id="da-fab-play" class="da-fab-play">اجرای کل فرآیند</button>
        <button type="button" id="da-fab-stop" class="da-fab-stop" hidden>توقف اجرا</button>
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
  const recordBtn = root.querySelector("#da-fab-record");
  const finishBtn = root.querySelector("#da-fab-finish");
  const uploadBtn = root.querySelector("#da-fab-upload");
  const rerecordBtn = root.querySelector("#da-fab-rerecord");
  const discardBtn = root.querySelector("#da-fab-discard");
  const playBtn = root.querySelector("#da-fab-play");
  const stopBtn = root.querySelector("#da-fab-stop");
  const taskSelect = root.querySelector("#da-fab-task");
  const toggleBtn = root.querySelector("#da-fab-toggle");
  const titleInp = root.querySelector("#da-fab-title");
  const reviewCount = root.querySelector("#da-fab-review-count");

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

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "playStateChanged" || message.type === "recordingChanged" || message.type === "draftUpdated") {
      refresh();
    }
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && (changes.draft || changes.recording || changes.recordPhase)) refresh();
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

  function setPhase(phase) {
    idleBox.hidden = phase !== "idle";
    recBox.hidden = phase !== "recording";
    reviewBox.hidden = phase !== "review";
  }

  async function refresh() {
    const state = await chrome.runtime.sendMessage({ type: "getState" }).catch(() => ({
      recordPhase: "idle", count: 0, playing: false, signedIn: true
    }));
    const session = await chrome.runtime.sendMessage({ type: "session" }).catch(() => ({
      signedIn: true, userName: "test", local: true, version: "?"
    }));
    const playing = !!(state.playing || state.play?.playing);
    const phase = state.recordPhase || "idle";
    const user = session?.userName || state.localUser || "test";
    const ver = session?.version || chrome.runtime.getManifest().version;

    toggleBtn.classList.toggle("recording", phase === "recording");
    toggleBtn.textContent = phase === "recording" ? "REC●" : phase === "review" ? "✓" : "REC";

    // Local-first: never block on login — always enable record when idle.
    setPhase(playing ? "idle" : phase);
    if (playing) {
      idleBox.hidden = false;
      recBox.hidden = true;
      reviewBox.hidden = true;
    }

    recordBtn.disabled = !!playing;
    playBtn.disabled = playing || phase === "recording" || phase === "review";
    stopBtn.hidden = !playing;
    playBtn.hidden = playing;

    if (reviewCount) reviewCount.textContent = `${state.count || 0} اکشن آماده ذخیره است.`;

    if (phase === "recording" || phase === "review") {
      panel.hidden = false;
    }

    if (playing && state.play) {
      status.textContent = `اجرا ${state.play.stepIndex}/${state.play.stepTotal}` +
        (state.play.lastError ? ` — ${state.play.lastError}` : "");
    } else if (phase === "recording") {
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
