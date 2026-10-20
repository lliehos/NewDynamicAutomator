async function refresh() {
  const state = await chrome.runtime.sendMessage({ type: "getSmartState" }).catch(() => ({}));
  const session = await chrome.runtime.sendMessage({ type: "session" }).catch(() => ({}));
  const el = document.getElementById("status");
  const stop = document.getElementById("stop");
  const ver = session?.version || chrome.runtime.getManifest().version;
  const i18n = window.DaRecI18n;

  // Which server this copy is bound to, shown so the user can confirm the deployment at a glance.
  const serverLine = document.getElementById("server-line");
  if (serverLine) {
    serverLine.textContent = state.serverBase
      ? String(state.serverBase)
      : (i18n ? i18n.t("popup.noServer") : "Server: not set");
    serverLine.title = state.serverBase ? String(state.serverBase) : "";
  }

  if (state.active) {
    el.textContent = i18n.t("popup.thinking", {
      sid: String(state.sessionId || "").slice(0, 8),
      id: state.taskId || "?"
    });
    stop.hidden = false;
  } else if (state.learningComplete) {
    el.textContent = i18n.t("popup.learningComplete");
    stop.hidden = true;
  } else {
    el.textContent = i18n.t("popup.idle", { ver });
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

(async function boot() {
  const i18n = window.DaRecI18n;
  if (i18n) {
    await i18n.init();
    i18n.applyDom(document);
    // Keep the popup in sync if the user switches language while it is open.
    i18n.onChange(() => {
      i18n.applyDom(document);
      refresh();
    });
  }
  refresh();
})();
