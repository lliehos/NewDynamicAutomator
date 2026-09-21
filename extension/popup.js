async function refresh() {
  const session = await chrome.runtime.sendMessage({ type: "session" });
  const state = await chrome.runtime.sendMessage({ type: "getState" });
  const el = document.getElementById("status");
  const playBtn = document.getElementById("play");
  const stopBtn = document.getElementById("stop");
  const playing = !!(state.playing || state.play?.playing);

  if (!session.signedIn) {
    el.textContent = "وارد پرتال نشده‌اید.";
    playBtn.disabled = true;
    return;
  }

  playBtn.disabled = playing || state.recording;
  stopBtn.hidden = !playing;

  if (playing && state.play) {
    el.textContent = `پخش ${state.play.stepIndex}/${state.play.stepTotal}` +
      (state.play.lastError ? ` — ${state.play.lastError}` : "");
  } else {
    el.textContent = `وارد شده: ${session.userName || ""} — ${state.count} اکشن در پیش‌نویس`;
  }

  await loadTasks();
}

async function loadTasks() {
  const sel = document.getElementById("task");
  const prev = sel.value;
  const res = await chrome.runtime.sendMessage({ type: "listTasks" });
  sel.innerHTML = `<option value="">— انتخاب فرآیند —</option>`;
  if (!res?.ok || !Array.isArray(res.tasks)) return;
  for (const t of res.tasks) {
    const opt = document.createElement("option");
    opt.value = String(t.id);
    opt.textContent = `${t.title} (#${t.id})`;
    sel.appendChild(opt);
  }
  if (prev) sel.value = prev;
}

document.getElementById("refresh").addEventListener("click", refresh);

document.getElementById("play").addEventListener("click", async () => {
  const taskId = Number(document.getElementById("task").value);
  if (!taskId) {
    document.getElementById("status").textContent = "یک فرآیند انتخاب کنید.";
    return;
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const res = await chrome.runtime.sendMessage({ type: "startPlay", taskId, tabId: tab?.id });
  document.getElementById("status").textContent = res.ok
    ? `پخش شروع شد (${res.stepTotal} استپ)`
    : res.error || "خطا";
  await refresh();
});

document.getElementById("stop").addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "stopPlay" });
  await refresh();
});

refresh();
