(function initFab() {
  if (window !== window.top) return;
  if (document.getElementById("da-recorder-fab")) return;

  const root = document.createElement("div");
  root.className = "da-recorder-root";
  root.id = "da-recorder-fab";
  root.innerHTML = `
    <button type="button" class="da-fab-btn" id="da-fab-toggle" title="اتوماتور">DA</button>
    <div class="da-fab-panel" id="da-fab-panel" hidden>
      <div class="da-fab-status" id="da-fab-status">در حال بررسی ورود...</div>
      <div class="da-fab-section">ضبط</div>
      <button type="button" id="da-fab-record">شروع ضبط</button>
      <button type="button" id="da-fab-save">ذخیره در سرور</button>
      <button type="button" id="da-fab-clear">پاک کردن</button>
      <div class="da-fab-section">پخش</div>
      <select id="da-fab-task" class="da-fab-select">
        <option value="">— انتخاب فرآیند —</option>
      </select>
      <button type="button" id="da-fab-play" class="da-fab-play">پخش</button>
      <button type="button" id="da-fab-stop" class="da-fab-stop" hidden>توقف پخش</button>
    </div>
  `;
  document.documentElement.appendChild(root);

  const panel = root.querySelector("#da-fab-panel");
  const status = root.querySelector("#da-fab-status");
  const recordBtn = root.querySelector("#da-fab-record");
  const playBtn = root.querySelector("#da-fab-play");
  const stopBtn = root.querySelector("#da-fab-stop");
  const taskSelect = root.querySelector("#da-fab-task");

  root.querySelector("#da-fab-toggle").addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    panel.hidden = !panel.hidden;
    refresh();
  });

  recordBtn.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const res = await chrome.runtime.sendMessage({ type: "toggleRecord" });
    if (!res.ok) status.textContent = res.error || "خطا";
    else await refresh();
  });

  root.querySelector("#da-fab-save").addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const title = prompt("عنوان فرآیند", "فرآیند ضبط‌شده");
    const res = await chrome.runtime.sendMessage({
      type: "saveDraft",
      payload: { newTaskTitle: title }
    });
    status.textContent = res.ok
      ? `ذخیره شد. نمودار: https://localhost:7201/Tasks/Editor/${res.result.taskId}`
      : res.error || "خطا در ذخیره";
    await refresh();
  });

  root.querySelector("#da-fab-clear").addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    await chrome.runtime.sendMessage({ type: "clearDraft" });
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
      ? `پخش «${res.title || taskId}» — ${res.stepTotal} استپ`
      : res.error || "خطا در پخش";
    await refresh();
  });

  stopBtn.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    await chrome.runtime.sendMessage({ type: "stopPlay" });
    status.textContent = "پخش متوقف شد.";
    await refresh();
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "playStateChanged") {
      if (message.lastError) status.textContent = `خطا: ${message.lastError}`;
      else if (!message.playing) status.textContent = "پخش تمام شد.";
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

  async function refresh() {
    const state = await chrome.runtime.sendMessage({ type: "getState" });
    const session = await chrome.runtime.sendMessage({ type: "session" });
    const playing = !!(state.playing || state.play?.playing);

    if (!session.signedIn) {
      status.textContent = "ابتدا در پرتال وارد شوید.";
      recordBtn.disabled = true;
      playBtn.disabled = true;
      return;
    }

    recordBtn.disabled = playing;
    playBtn.disabled = playing || state.recording;
    stopBtn.hidden = !playing;
    playBtn.hidden = playing;

    recordBtn.textContent = state.recording ? "توقف ضبط" : "شروع ضبط";

    if (playing && state.play) {
      status.textContent = `پخش ${state.play.stepIndex}/${state.play.stepTotal}` +
        (state.play.lastError ? ` — ${state.play.lastError}` : "");
    } else if (!status.textContent.startsWith("ذخیره شد") && !status.textContent.startsWith("خطا")) {
      status.textContent = `${session.userName || ""} — ${state.count} اکشن`;
    }

    if (!taskSelect.dataset.loaded) {
      await loadTasks();
      taskSelect.dataset.loaded = "1";
    }
  }

  refresh();
})();
