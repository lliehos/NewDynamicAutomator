async function refresh() {
  const state = await chrome.runtime.sendMessage({ type: "getSmartState" }).catch(() => ({}));
  const session = await chrome.runtime.sendMessage({ type: "session" }).catch(() => ({}));
  const el = document.getElementById("status");
  const stop = document.getElementById("stop");
  const ver = session?.version || chrome.runtime.getManifest().version;
  if (state.active) {
    el.textContent = `Thinking · session ${String(state.sessionId || "").slice(0, 8)} · process #${state.taskId || "?"}`;
    stop.hidden = false;
  } else if (state.learningComplete) {
    el.textContent = `Learning complete · ready to save`;
    stop.hidden = true;
  } else {
    el.textContent = `Smart Recorder v${ver} · idle`;
    stop.hidden = true;
  }
}

document.getElementById("refresh").addEventListener("click", refresh);
document.getElementById("stop").addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "stopSmartThinking" });
  await refresh();
});
chrome.runtime.onMessage.addListener((m) => {
  if (m.type === "smartStateChanged") refresh();
});
refresh();
