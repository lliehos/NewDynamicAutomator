let recording = false;
let recordOptions = { trackInputClicks: false, trackMouse: true };

if (!window.__daRecorderCaptureBound) {
  window.__daRecorderCaptureBound = true;

chrome.storage.local.get(["recording", "recordPhase", "recordOptions"]).then((d) => {
  recording = !!d.recording;
  if (d.recordOptions && typeof d.recordOptions === "object") {
    recordOptions = {
      trackInputClicks: !!d.recordOptions.trackInputClicks,
      trackMouse: d.recordOptions.trackMouse !== false
    };
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.recording) recording = !!changes.recording.newValue;
  if (changes.recordOptions?.newValue && typeof changes.recordOptions.newValue === "object") {
    recordOptions = {
      trackInputClicks: !!changes.recordOptions.newValue.trackInputClicks,
      trackMouse: changes.recordOptions.newValue.trackMouse !== false
    };
  }
});

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "recordingChanged") recording = !!message.recording;
  if (message.type === "recordOptionsChanged" && message.options) {
    recordOptions = {
      trackInputClicks: !!message.options.trackInputClicks,
      trackMouse: message.options.trackMouse !== false
    };
  }
});

document.addEventListener("click", onClick, true);
document.addEventListener("change", onChange, true);
document.addEventListener("submit", onSubmit, true);

} // __daRecorderCaptureBound

function isInputField(el) {
  if (!el || !(el instanceof Element)) return false;
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
    return true;
  }
  return !!el.closest("input, textarea, select, [contenteditable='true']");
}

/** Collapse whitespace and truncate for titles. */
function cleanLabelText(s, maxLen) {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  const max = maxLen == null ? 48 : maxLen;
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/**
 * Human-readable name for an element: own text, aria/placeholder,
 * associated <label>, or nearest nearby label text.
 */
function elementLabel(el) {
  if (!(el instanceof Element)) return "";

  // Prefer interactive / labeled target (button inside span, etc.)
  const target = el.closest(
    "button, a, [role='button'], [role='link'], [role='tab'], label, summary, input, textarea, select, [contenteditable='true']"
  ) || el;

  const attr = (name) => cleanLabelText(target.getAttribute(name) || "");

  // 1) Explicit accessible name
  const labelledBy = target.getAttribute("aria-labelledby");
  if (labelledBy) {
    const ids = String(labelledBy).split(/\s+/).filter(Boolean);
    const parts = ids.map((id) => {
      const n = document.getElementById(id);
      return n ? cleanLabelText(n.innerText || n.textContent || "") : "";
    }).filter(Boolean);
    if (parts.length) return parts.join(" ");
  }
  const aria = attr("aria-label");
  if (aria) return aria;
  const titled = attr("title");
  if (titled) return titled;

  // 2) Form controls: label[for], wrapping label, placeholder, name
  if (
    target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
    || target instanceof HTMLSelectElement
  ) {
    const id = target.id;
    if (id) {
      try {
        const lab = document.querySelector(`label[for="${CSS.escape(id)}"]`);
        const lt = cleanLabelText(lab?.innerText || lab?.textContent || "");
        if (lt) return lt;
      } catch { /* ignore */ }
    }
    const wrapLab = target.closest("label");
    if (wrapLab) {
      const clone = wrapLab.cloneNode(true);
      clone.querySelectorAll("input, textarea, select, button").forEach((n) => n.remove());
      const lt = cleanLabelText(clone.innerText || clone.textContent || "");
      if (lt) return lt;
    }
    const ph = cleanLabelText(target.getAttribute("placeholder") || "");
    if (ph) return ph;
    const nm = cleanLabelText(target.getAttribute("name") || "");
    if (nm && !/^[a-z0-9_-]{1,3}$/i.test(nm)) return nm.replace(/[_-]+/g, " ");
  }

  // 3) Visible text of buttons / links / clickable nodes
  const ownText = cleanLabelText(
    (target.innerText || target.textContent || "").replace(/\s+/g, " ")
  );
  if (ownText && ownText.length <= 48) return ownText;
  if (ownText && (target.matches("button, a, [role='button'], summary") || target.tagName === "BUTTON")) {
    return cleanLabelText(ownText, 48);
  }

  // Value on submit buttons
  if (target instanceof HTMLInputElement && /^(submit|button|reset)$/i.test(target.type || "")) {
    const v = cleanLabelText(target.value || "");
    if (v) return v;
  }

  // 4) Nearest preceding label-like sibling / parent text
  const near = nearestNearbyLabel(target);
  if (near) return near;

  // 5) Fallbacks
  const alt = attr("alt");
  if (alt) return alt;
  if (target.id) return cleanLabelText(target.id.replace(/[_-]+/g, " "));
  return "";
}

function nearestNearbyLabel(el) {
  if (!(el instanceof Element)) return "";
  let sib = el.previousElementSibling;
  for (let i = 0; i < 3 && sib; i++, sib = sib.previousElementSibling) {
    if (/^(LABEL|SPAN|P|DIV|STRONG|B|LEGEND|TH|TD|DT)$/i.test(sib.tagName)) {
      const t = cleanLabelText(sib.innerText || sib.textContent || "");
      if (t && t.length <= 48) return t;
    }
  }
  const parent = el.parentElement;
  if (parent) {
    const kids = Array.from(parent.children);
    const idx = kids.indexOf(el);
    for (let i = idx - 1; i >= Math.max(0, idx - 3); i--) {
      const n = kids[i];
      if (!n || /^(INPUT|TEXTAREA|SELECT|BUTTON|A)$/i.test(n.tagName)) continue;
      const t = cleanLabelText(n.innerText || n.textContent || "");
      if (t && t.length <= 40) return t;
    }
    const fs = el.closest("fieldset");
    const legend = fs?.querySelector(":scope > legend");
    const lt = cleanLabelText(legend?.innerText || legend?.textContent || "");
    if (lt) return lt;
  }
  return "";
}

function onClick(ev) {
  if (!recording || isFromFab(ev.target)) return;
  if (!recordOptions.trackMouse) return;
  const el = ev.target instanceof Element ? ev.target : ev.target.parentElement;
  if (!el) return;
  if (isInputField(el) && !recordOptions.trackInputClicks) return;
  const label = elementLabel(el);
  emit({
    actionType: "Click",
    elementValue: cssPath(el),
    elementLabel: label,
    url: location.href
  });
}

function onChange(ev) {
  if (!recording || isFromFab(ev.target)) return;
  const el = ev.target;
  if (!(el instanceof HTMLInputElement) && !(el instanceof HTMLTextAreaElement) && !(el instanceof HTMLSelectElement)) {
    return;
  }
  const label = elementLabel(el);
  emit({
    actionType: "InputContent",
    elementValue: cssPath(el),
    elementLabel: label,
    value: el.value,
    url: location.href
  });
}

function onSubmit(ev) {
  if (!recording || isFromFab(ev.target)) return;
  if (!recordOptions.trackMouse) return;
  const el = ev.target instanceof Element ? ev.target : null;
  if (!el) return;
  const btn = el.querySelector("button[type='submit'], input[type='submit'], button:not([type])");
  const label = elementLabel(btn || el) || "ارسال";
  emit({
    actionType: "Click",
    elementValue: cssPath(btn || el),
    elementLabel: label,
    url: location.href
  });
}

function emit(payload) {
  chrome.runtime.sendMessage({ type: "recordedEvent", payload }).catch(() => {});
}
