const I18n = globalThis.DaExtI18n;
const t = (key, vars) => (I18n ? I18n.t(key, vars) : key);

function applyDomI18n() {
  if (I18n) {
    document.documentElement.setAttribute("lang", I18n.getCulture());
    document.documentElement.setAttribute("dir", I18n.dir());
  }
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    if (el.id === "playpause" || el.id === "status") return;
    const key = el.getAttribute("data-i18n");
    if (key) el.textContent = t(key);
  });
}

async function refresh() {
  applyDomI18n();
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
  const ver = session?.version || chrome.runtime.getManifest().version;
  const user = session?.userName || "test";

  if (playing && !paused) {
    playPauseBtn.textContent = t("play.pause");
    playPauseBtn.className = "mode-pause";
    playPauseBtn.dataset.mode = "pause";
    playPauseBtn.disabled = false;
  } else {
    playPauseBtn.textContent = (playing && paused) ? t("play.resume") : t("play.play");
    playPauseBtn.className = "mode-play";
    playPauseBtn.dataset.mode = "play";
    playPauseBtn.disabled = playing ? false : !canStart;
  }
  stopBtn.hidden = !playing;
  stopBtn.disabled = !playing;
  stopBtn.textContent = t("play.stop");

  if (playing && state.play) {
    el.textContent = `${paused ? t("play.pause") : t("play.play")} ${state.play.loopIndex || 0}/${state.play.loopTotal || 1}`
      + ` · ${state.play.stepIndex}/${state.play.stepTotal}`
      + (state.play.lastError ? ` — ${state.play.lastError}` : "");
  } else {
    el.textContent = canStart
      ? t("play.readyRestart", { ver, user }) + (logs ? ` · ${logs}` : "")
      : t("play.readyIdle", { ver, user });
  }
}

(async function boot() {
  if (I18n) {
    await I18n.init();
    I18n.onChange(() => refresh());
  }

  document.getElementById("refresh").addEventListener("click", refresh);

  document.getElementById("playpause").addEventListener("click", async () => {
    const btn = document.getElementById("playpause");
    const mode = btn.dataset.mode || (btn.classList.contains("mode-pause") ? "pause" : "play");

    if (mode === "pause") {
      const res = await chrome.runtime.sendMessage({ type: "pausePlay" })
        .catch((err) => ({ ok: false, error: err?.message || String(err) }));
      if (res?.ok === false && res?.error) {
        document.getElementById("status").textContent = res.error;
      }
    } else {
      const state = await chrome.runtime.sendMessage({ type: "getState" }).catch(() => ({}));
      const playing = !!(state.playing || state.play?.playing);
      const paused = !!(state.play?.paused);

      if (playing && paused) {
        await chrome.runtime.sendMessage({ type: "resumePlay" });
      } else if (playing && !paused) {
        await chrome.runtime.sendMessage({ type: "pausePlay" });
      } else {
        const { lastPlayRequest } = await chrome.storage.local.get("lastPlayRequest").catch(() => ({}));
        const taskId = lastPlayRequest?.taskId || state.play?.taskId;
        if (!taskId) {
          document.getElementById("status").textContent = t("play.noProcess");
          return;
        }
        const [active] = await chrome.tabs.query({ active: true, currentWindow: true }).catch(() => []);
        const res = await chrome.runtime.sendMessage({
          type: "startPlay",
          taskId: String(taskId),
          runMode: lastPlayRequest?.runMode,
          groupNodeId: lastPlayRequest?.groupNodeId || null,
          stepNodeId: lastPlayRequest?.stepNodeId || null,
          conditionNodeId: lastPlayRequest?.conditionNodeId || null,
          playScope: lastPlayRequest?.playScope || null,
          tabId: active?.id || null
        }).catch((e) => ({ ok: false, error: e.message }));
        if (!res?.ok && !res?.reloading) {
          document.getElementById("status").textContent = res?.error || t("play.startError");
        }
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
  await refresh();
})();
