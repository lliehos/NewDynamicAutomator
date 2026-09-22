async function refresh() {
  const session = await chrome.runtime.sendMessage({ type: "session" }).catch(() => ({
    userName: "test", version: "?"
  }));
  const state = await chrome.runtime.sendMessage({ type: "getState" }).catch(() => ({
    playing: false, play: null
  }));
  const { lastPlayRequest } = await chrome.storage.local.get("lastPlayRequest").catch(() => ({}));
  const el = document.getElementById("status");
  const playPauseBtn = document.getElementById("playpause");
  const stopBtn = document.getElementById("stop");
  const playing = !!(state.playing || state.play?.playing);
  const paused = !!(state.play?.paused);
  const logs = state.play?.logs?.length || 0;
  const canStart = !!(lastPlayRequest?.taskId || state.play?.taskId);

  if (playing && !paused) {
    playPauseBtn.textContent = "پاز";
    playPauseBtn.className = "mode-pause";
    playPauseBtn.disabled = false;
  } else {
    playPauseBtn.textContent = "اجرا";
    playPauseBtn.className = "mode-play";
    playPauseBtn.disabled = playing ? false : !canStart;
  }
  stopBtn.hidden = !playing;
  stopBtn.disabled = !playing;

  if (playing && state.play) {
    el.textContent = `${paused ? "پاز" : "اجرا"} ${state.play.loopIndex || 0}/${state.play.loopTotal || 1}`
      + ` · ${state.play.stepIndex}/${state.play.stepTotal}`
      + (state.play.lastError ? ` — ${state.play.lastError}` : "");
  } else {
    el.textContent = `اجرا v${session?.version || chrome.runtime.getManifest().version} · ${session?.userName || "test"}`
      + (logs ? ` · ${logs} لاگ` : "")
      + (canStart ? " · آماده شروع از اول" : "");
  }
}

document.getElementById("refresh").addEventListener("click", refresh);

document.getElementById("playpause").addEventListener("click", async () => {
  const state = await chrome.runtime.sendMessage({ type: "getState" }).catch(() => ({}));
  const playing = !!(state.playing || state.play?.playing);
  const paused = !!(state.play?.paused);

  if (playing && !paused) {
    await chrome.runtime.sendMessage({ type: "pausePlay" });
  } else if (playing && paused) {
    await chrome.runtime.sendMessage({ type: "resumePlay" });
  } else {
    const { lastPlayRequest } = await chrome.storage.local.get("lastPlayRequest").catch(() => ({}));
    const taskId = lastPlayRequest?.taskId || state.play?.taskId;
    if (!taskId) {
      document.getElementById("status").textContent = "فرآیندی برای اجرا نیست — از پورتال اجرا کنید.";
      return;
    }
    const [active] = await chrome.tabs.query({ active: true, currentWindow: true }).catch(() => []);
    const res = await chrome.runtime.sendMessage({
      type: "startPlay",
      taskId: Number(taskId),
      runMode: lastPlayRequest?.runMode,
      groupNodeId: lastPlayRequest?.groupNodeId || null,
      stepNodeId: lastPlayRequest?.stepNodeId || null,
      tabId: active?.id || null
    }).catch((e) => ({ ok: false, error: e.message }));
    if (!res?.ok && !res?.reloading) {
      document.getElementById("status").textContent = res?.error || "خطا در شروع";
    }
  }
  await refresh();
});

document.getElementById("stop").addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "stopPlay" });
  await refresh();
});

document.getElementById("clear").addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "clearPlayLogs" });
  await refresh();
});

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "playStateChanged") refresh();
});
refresh();
