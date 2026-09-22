chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type !== "playExecute") return;
  (async () => {
    try {
      const result = await executeAction(message.payload || {});
      sendResponse(result);
    } catch (err) {
      sendResponse({ ok: false, error: err.message || String(err) });
    }
  })();
  return true;
});

function normalizeHighlightColor(v) {
  const s = String(v || "").trim();
  if (/^#[0-9a-fA-F]{6}$/.test(s)) return s.toLowerCase();
  if (/^#[0-9a-fA-F]{3}$/.test(s)) {
    return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`.toLowerCase();
  }
  return "#ea5455";
}

/** Draw a colored border overlay around the targeted element. */
function highlightTarget(el, color) {
  if (!(el instanceof Element)) return;
  const c = normalizeHighlightColor(color);
  document.getElementById("da-play-hl")?.remove();
  try {
    el.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" in Element.prototype ? "instant" : "auto" });
  } catch {
    try { el.scrollIntoView({ block: "center", inline: "nearest" }); } catch { /* ignore */ }
  }
  const place = () => {
    const r = el.getBoundingClientRect();
    if (!r.width && !r.height) return;
    const box = document.createElement("div");
    box.id = "da-play-hl";
    box.setAttribute("aria-hidden", "true");
    Object.assign(box.style, {
      position: "fixed",
      left: `${Math.max(0, r.left - 3)}px`,
      top: `${Math.max(0, r.top - 3)}px`,
      width: `${Math.max(2, r.width + 6)}px`,
      height: `${Math.max(2, r.height + 6)}px`,
      border: `3px solid ${c}`,
      borderRadius: "4px",
      boxShadow: `0 0 0 2px ${c}33, 0 0 14px ${c}88`,
      pointerEvents: "none",
      zIndex: "2147483646",
      boxSizing: "border-box",
      transition: "opacity 0.2s ease"
    });
    document.documentElement.appendChild(box);
  };
  place();
  requestAnimationFrame(place);
}

/**
 * Poll until selector matches or timeout.
 * timeoutMs <= 0 → single attempt (immediate not-found if missing).
 */
async function waitForElement(selector, timeoutMs) {
  const maxMs = Math.max(0, Number(timeoutMs) || 0);
  const deadline = Date.now() + maxMs;
  const poll = 100;
  for (;;) {
    let el;
    try {
      el = document.querySelector(selector);
    } catch {
      return { ok: false, error: `سلکتور نامعتبر: ${selector}`, reason: "bad_selector" };
    }
    if (el) return { ok: true, el };
    if (Date.now() >= deadline) break;
    await new Promise((r) => setTimeout(r, poll));
  }
  return {
    ok: false,
    error: `عنصر پیدا نشد: ${selector}`,
    reason: "element_not_found",
    url: location.href
  };
}

async function executeAction(payload) {
  const actionType = payload.actionType || "Click";
  const selector = payload.selectorValue;
  const value = payload.constantValue;
  const navigateUrl = payload.navigateUrl;
  const highlightColor = payload.highlightColor;
  const waitTimeoutMs = Math.max(0, Number(payload.waitTimeoutMs) || 0);

  if (actionType === "GoToUrl" || actionType === "NewPage") {
    const url = navigateUrl || value;
    if (!url) return { ok: false, error: "آدرس ناوبری خالی است." };
    if (actionType === "NewPage") {
      window.open(url, "_blank");
      return { ok: true, navigated: true };
    }
    location.href = url;
    return { ok: true, navigated: true };
  }

  if (actionType === "Refresh") {
    location.reload();
    return { ok: true, navigated: true };
  }

  if (actionType === "WaitTime") {
    return { ok: true, waitMs: Number(value) || 0 };
  }

  if (actionType === "NoAction" || actionType === "Breakpoint") {
    return { ok: true, skipped: true };
  }

  if (!selector) {
    return { ok: false, error: "سلکتور خالی است.", reason: "missing_selector" };
  }

  const found = await waitForElement(selector, waitTimeoutMs);
  if (!found.ok) return found;
  const el = found.el;

  highlightTarget(el, highlightColor);

  switch (actionType) {
    case "Click":
    case "DoubleClick":
    case "RightClick":
      if (actionType === "DoubleClick") {
        el.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true, view: window }));
      } else if (actionType === "RightClick") {
        el.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, view: window, button: 2 }));
      } else {
        el.click();
      }
      return { ok: true };

    case "InputContent":
    case "InsertContent":
    case "LoadContent": {
      setElementValue(el, value == null ? "" : String(value));
      return { ok: true };
    }

    case "TakeContent":
    case "SaveContent": {
      const text = readElementText(el);
      return { ok: true, text };
    }

    case "Hover":
      el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, cancelable: true, view: window }));
      el.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true, cancelable: true, view: window }));
      return { ok: true };

    case "Enter":
      el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }));
      el.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", code: "Enter", bubbles: true }));
      return { ok: true };

    case "WaitForLoading":
      return { ok: true };

    case "AlertAccept":
      return { ok: true, note: "alert accept is best-effort in content script" };

    default:
      return { ok: false, error: `اکشن پشتیبانی‌نشده در فاز ۳: ${actionType}`, reason: "unsupported_action" };
  }
}

function setElementValue(el, value) {
  const tag = el.tagName.toLowerCase();
  if (tag === "select") {
    el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return;
  }

  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    const proto =
      el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, "value");
    if (desc && desc.set) desc.set.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return;
  }

  if (el.isContentEditable) {
    el.textContent = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    return;
  }

  el.click();
}

function readElementText(el) {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
    return el.value || "";
  }
  return (el.innerText || el.textContent || "").trim();
}
