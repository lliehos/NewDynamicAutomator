function tabOptionLabel(t) {
  const title = (t.title || "بدون عنوان").trim();
  let host = "";
  try {
    if (t.url && /^https?:/i.test(t.url)) host = new URL(t.url).host;
    else if (t.isBlank) host = "خالی";
  } catch {
    /* ignore */
  }
  const mark = t.active ? " [فعال]" : "";
  return host ? `${title}${mark} — ${host}` : `${title}${mark}`;
}

async function loadRecordTabs(fromBroadcast) {
  const sel = document.getElementById("record-tab");
  if (!sel) return;
  const prev = sel.value;
  const res = fromBroadcast?.tabs
    ? { ok: true, tabs: fromBroadcast.tabs }
    : await chrome.runtime.sendMessage({ type: "listOpenTabs" }).catch(() => null);
  sel.innerHTML = `<option value="">تب جدید (خالی)</option>`;
  if (!res?.ok || !Array.isArray(res.tabs)) return;
  for (const t of res.tabs) {
    if (t.isPortal) continue;
    const opt = document.createElement("option");
    opt.value = String(t.id);
    opt.textContent = tabOptionLabel(t);
    sel.appendChild(opt);
  }
  if (prev && [...sel.options].some((o) => o.value === prev)) sel.value = prev;
  else {
    const active = (res.tabs || []).find((t) => t.active && !t.isPortal);
    if (active) sel.value = String(active.id);
  }
}

async function refresh() {
  const session = await chrome.runtime.sendMessage({ type: "session" }).catch(() => ({
    signedIn: true, userName: "test", local: true
  }));
  const state = await chrome.runtime.sendMessage({ type: "getState" }).catch(() => ({
    recordPhase: "idle", count: 0, playing: false
  }));
  const el = document.getElementById("status");
  const playBtn = document.getElementById("play");
  const stopBtn = document.getElementById("stop");
  const recordBtn = document.getElementById("record");
  const idleBox = document.getElementById("idle-box");
  const recBox = document.getElementById("rec-box");
  const reviewBox = document.getElementById("review-box");
  const playing = !!(state.playing || state.play?.playing);
  const phase = state.recordPhase || "idle";
  const user = session?.userName || "test";

  idleBox.hidden = phase !== "idle" || playing;
  recBox.hidden = phase !== "recording";
  reviewBox.hidden = phase !== "review";
  if (playing) {
    idleBox.hidden = false;
    recBox.hidden = true;
    reviewBox.hidden = true;
  }

  playBtn.disabled = playing || phase === "recording" || phase === "review";
  recordBtn.disabled = playing;
  stopBtn.hidden = !playing;

  if (playing && state.play) {
    el.textContent = `پخش ${state.play.stepIndex}/${state.play.stepTotal}` +
      (state.play.lastError ? ` — ${state.play.lastError}` : "");
  } else if (phase === "recording") {
    el.textContent = `در حال ضبط — ${state.count} اکشن (موقت)`;
  } else if (phase === "review") {
    el.textContent = `اتمام ضبط — ${state.count} اکشن آماده`;
  } else {
    const ver = session?.version || chrome.runtime.getManifest().version;
    el.textContent = `v${ver} · محلی: ${user}`;
  }

  await loadTasks();
  if (phase === "idle" && !playing) await loadRecordTabs();
}

async function loadTasks() {
  const sel = document.getElementById("task");
  const prev = sel.value;
  const res = await chrome.runtime.sendMessage({ type: "listTasks" }).catch(() => null);
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

document.getElementById("record").addEventListener("click", async () => {
  const tabVal = document.getElementById("record-tab")?.value;
  const payload = { type: "startRecordSession" };
  if (tabVal) payload.tabId = Number(tabVal);
  const res = await chrome.runtime.sendMessage(payload);
  if (!res.ok) document.getElementById("status").textContent = res.error || "خطا";
  else {
    document.getElementById("status").textContent = res.reused
      ? "ضبط روی تب انتخاب‌شده شروع شد."
      : "تب خالی باز شد — آدرس را تایپ کنید.";
  }
  await refresh();
});

document.getElementById("finish").addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "finishRecord" });
  await refresh();
});

document.getElementById("upload").addEventListener("click", async () => {
  const title = document.getElementById("title").value.trim() || "فرآیند ضبط‌شده";
  const res = await chrome.runtime.sendMessage({
    type: "saveDraft",
    payload: { newTaskTitle: title }
  });
  document.getElementById("status").textContent = res.ok
    ? `ذخیره محلی — وظیفه #${res.result?.taskId}`
    : (res.error || "خطا");
  await refresh();
});

document.getElementById("rerecord").addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "rerecord" });
  await refresh();
});

document.getElementById("discard").addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "discardRecord" });
  await refresh();
});

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

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "openTabsChanged") {
    loadRecordTabs(message);
  }
  if (message.type === "recordingChanged" || message.type === "playStateChanged") {
    refresh();
  }
});

refresh();
