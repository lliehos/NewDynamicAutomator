/** Portal bridge — Selector role: memory for «خواندن از حافظه». */
(function () {
  const ROLE = "selector";

  function mark() {
    try {
      const version = chrome.runtime.getManifest().version;
      document.documentElement.dataset.daSelectorExtension = "1";
      document.documentElement.dataset.daSelectorVersion = version;
      window.dispatchEvent(new CustomEvent("da-extension-ready", {
        detail: { version, role: ROLE }
      }));
      window.dispatchEvent(new CustomEvent("da-selector-ready", {
        detail: { version }
      }));
    } catch {
      /* ignore */
    }
  }

  mark();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mark);
  }

  try {
    chrome.storage.local.set({
      portalBase: location.origin,
      apiBase: location.origin,
      extensionRole: ROLE
    });
  } catch {
    /* ignore */
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === "ping") {
      sendResponse({ ok: true, extension: true, role: ROLE, version: chrome.runtime.getManifest().version });
      return true;
    }
    return false;
  });

  window.addEventListener("da-request-copied-selector", () => {
    chrome.runtime.sendMessage({ type: "getCopiedSelector" }).then((res) => {
      window.dispatchEvent(new CustomEvent("da-copied-selector", { detail: res || { ok: false } }));
    }).catch(() => {
      window.dispatchEvent(new CustomEvent("da-copied-selector", { detail: { ok: false } }));
    });
  });

  window.addEventListener("da-store-copied-selector", (ev) => {
    const d = ev.detail || {};
    chrome.runtime.sendMessage({
      type: "setCopiedSelector",
      payload: d.payload,
      text: d.text
    }).then((res) => {
      window.dispatchEvent(new CustomEvent("da-stored-selector", { detail: res || { ok: false } }));
    }).catch(() => {
      window.dispatchEvent(new CustomEvent("da-stored-selector", { detail: { ok: false } }));
    });
  });
})();
