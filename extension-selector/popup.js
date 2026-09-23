async function refresh() {
  const state = await chrome.runtime.sendMessage({ type: "getState" }).catch(() => null);
  const status = document.getElementById("status");
  const preview = document.getElementById("preview");
  const ver = state?.version || chrome.runtime.getManifest().version;
  if (state?.hasSelector) {
    const hops = Number(state.frameHops) || 0;
    status.textContent = `v${ver} · آبجکت در حافظه` + (hops ? ` · ${hops} فریم` : "");
    preview.textContent = state.selectorPreview || "—";
  } else {
    status.textContent = `v${ver} · حافظه آبجکت خالی است`;
    preview.textContent = "—";
  }
}

document.getElementById("refresh").addEventListener("click", refresh);
document.getElementById("clear").addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "clearCopiedSelector" });
  await refresh();
});
refresh();
