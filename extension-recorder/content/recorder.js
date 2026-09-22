let recording = false;

chrome.storage.local.get(["recording", "recordPhase"]).then((d) => {
  recording = !!d.recording;
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.recording) {
    recording = !!changes.recording.newValue;
  }
});

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "recordingChanged") recording = !!message.recording;
});

document.addEventListener("click", onClick, true);
document.addEventListener("change", onChange, true);
document.addEventListener("submit", onSubmit, true);

function onClick(ev) {
  if (!recording || isFromFab(ev.target)) return;
  const el = ev.target instanceof Element ? ev.target : ev.target.parentElement;
  if (!el) return;
  emit({
    actionType: "Click",
    elementValue: cssPath(el),
    url: location.href
  });
}

function onChange(ev) {
  if (!recording || isFromFab(ev.target)) return;
  const el = ev.target;
  if (!(el instanceof HTMLInputElement) && !(el instanceof HTMLTextAreaElement) && !(el instanceof HTMLSelectElement))
    return;
  emit({
    actionType: "InputContent",
    elementValue: cssPath(el),
    value: el.value,
    url: location.href
  });
}

function onSubmit(ev) {
  if (!recording || isFromFab(ev.target)) return;
  const el = ev.target instanceof Element ? ev.target : null;
  if (!el) return;
  emit({
    actionType: "Click",
    elementValue: cssPath(el),
    url: location.href
  });
}

function emit(payload) {
  chrome.runtime.sendMessage({ type: "recordedEvent", payload }).catch(() => {});
}
