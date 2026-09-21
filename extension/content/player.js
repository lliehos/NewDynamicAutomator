chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type !== "playExecute") return;
  try {
    const result = executeAction(message.payload || {});
    sendResponse(result);
  } catch (err) {
    sendResponse({ ok: false, error: err.message || String(err) });
  }
  return true;
});

function executeAction(payload) {
  const actionType = payload.actionType || "Click";
  const selector = payload.selectorValue;
  const value = payload.constantValue;
  const navigateUrl = payload.navigateUrl;

  if (actionType === "GoToUrl" || actionType === "NewPage") {
    // NewPage is handled in the play engine (chrome.tabs.create). Content script fallback:
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

  let el;
  try {
    el = document.querySelector(selector);
  } catch {
    return { ok: false, error: `سلکتور نامعتبر: ${selector}`, reason: "bad_selector" };
  }

  if (!el) {
    return {
      ok: false,
      error: `عنصر پیدا نشد: ${selector}`,
      reason: "element_not_found",
      url: location.href
    };
  }

  switch (actionType) {
    case "Click":
    case "DoubleClick":
      el.scrollIntoView({ block: "center", inline: "nearest" });
      if (actionType === "DoubleClick") {
        el.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true, view: window }));
      } else {
        el.click();
      }
      return { ok: true };

    case "InputContent":
    case "InsertContent":
    case "LoadContent": {
      el.scrollIntoView({ block: "center", inline: "nearest" });
      setElementValue(el, value == null ? "" : String(value));
      return { ok: true };
    }

    case "TakeContent":
    case "SaveContent": {
      el.scrollIntoView({ block: "center", inline: "nearest" });
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
