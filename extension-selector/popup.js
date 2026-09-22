async function refresh() {
  const state = await chrome.runtime.sendMessage({ type: "getState" }).catch(() => null);
  const status = document.getElementById("status");
  const preview = document.getElementById("preview");
  const ver = state?.version || chrome.runtime.getManifest().version;
  if (state?.hasSelector) {
    status.textContent = `v${ver} · سلکتور در حافظه است`;
    preview.textContent = state.selectorPreview || "—";
  } else {
    status.textContent = `v${ver} · حافظه خالی است`;
    preview.textContent = "—";
  }
}

document.getElementById("refresh").addEventListener("click", refresh);
document.getElementById("clear").addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "clearCopiedSelector" });
  await refresh();
});
refresh();
