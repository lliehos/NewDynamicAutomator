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
    opt.textContent = (t.title || "تب") + (t.active ? " [فعال]" : "");
    sel.appendChild(opt);
  }
  if (prev && [...sel.options].some((o) => o.value === prev)) sel.value = prev;
}

async function refresh() {
  const session = await chrome.runtime.sendMessage({ type: "session" }).catch(() => ({
    userName: "test", version: "?"
  }));
  const state = await chrome.runtime.sendMessage({ type: "getState" }).catch(() => ({
    recordPhase: "idle", count: 0
  }));
  const el = document.getElementById("status");
  const idleBox = document.getElementById("idle-box");
  const recBox = document.getElementById("rec-box");
  const reviewBox = document.getElementById("review-box");
  const phase = state.recordPhase || "idle";

  idleBox.hidden = phase !== "idle";
  recBox.hidden = phase !== "recording";
  reviewBox.hidden = phase !== "review";

  if (phase === "recording") el.textContent = `در حال ضبط — ${state.count} اکشن`;
  else if (phase === "review") el.textContent = `اتمام ضبط — ${state.count} اکشن آماده`;
  else el.textContent = `ضبط v${session?.version || chrome.runtime.getManifest().version} · ${session?.userName || "test"}`;

  if (phase === "idle") await loadRecordTabs();
}

document.getElementById("refresh").addEventListener("click", refresh);
document.getElementById("record").addEventListener("click", async () => {
  const tabVal = document.getElementById("record-tab")?.value;
  const payload = { type: "startRecordSession" };
  if (tabVal) payload.tabId = Number(tabVal);
  const res = await chrome.runtime.sendMessage(payload);
  document.getElementById("status").textContent = res?.ok
    ? (res.reused ? "ضبط روی تب انتخاب‌شده شروع شد." : "تب خالی باز شد.")
    : (res?.error || "خطا");
  await refresh();
});
document.getElementById("finish").addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "finishRecord" });
  await refresh();
});
document.getElementById("upload").addEventListener("click", async () => {
  const title = document.getElementById("title").value.trim() || "فرآیند ضبط‌شده";
  const res = await chrome.runtime.sendMessage({ type: "saveDraft", payload: { newTaskTitle: title } });
  document.getElementById("status").textContent = res?.ok
    ? `ذخیره محلی — #${res.result?.taskId}`
    : (res?.error || "خطا");
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
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "openTabsChanged") loadRecordTabs(message);
  if (message.type === "recordingChanged") refresh();
});
refresh();
