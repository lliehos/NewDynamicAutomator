/** Portal bridge — Selector role. postMessage across isolated world ↔ page. */
(function () {
  const ROLE = "selector";
  const PAGE = "da-editor";
  const EXT = "da-selector-ext";
  const MEM_KEY = "da_copied_selector";

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

  function writeLocal(text) {
    if (!text) return;
    try { localStorage.setItem(MEM_KEY, text); } catch { /* ignore */ }
  }

  function replyCopied(detail) {
    const d = detail || { ok: false };
    if (d.ok && d.text) writeLocal(d.text);
    try {
      window.postMessage({ source: EXT, type: "copied-selector", ok: !!d.ok, payload: d.payload, text: d.text || "", error: d.error }, "*");
    } catch { /* ignore */ }
    try {
      window.dispatchEvent(new CustomEvent("da-copied-selector", { detail: d }));
    } catch { /* ignore */ }
  }

  function replyStored(detail) {
    const d = detail || { ok: false };
    if (d.ok && d.text) writeLocal(d.text);
    try {
      window.postMessage({ source: EXT, type: "stored-selector", ok: !!d.ok, payload: d.payload, text: d.text || "", error: d.error }, "*");
    } catch { /* ignore */ }
    try {
      window.dispatchEvent(new CustomEvent("da-stored-selector", { detail: d }));
    } catch { /* ignore */ }
  }

  function fetchCopied() {
    chrome.runtime.sendMessage({ type: "getCopiedSelector" })
      .then((res) => replyCopied(res || { ok: false }))
      .catch(() => replyCopied({ ok: false, error: "bridge" }));
  }

  function storeCopied(payload, text) {
    chrome.runtime.sendMessage({ type: "setCopiedSelector", payload, text })
      .then((res) => replyStored(res || { ok: false }))
      .catch(() => replyStored({ ok: false, error: "bridge" }));
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
    if (message?.type === "ping") {
      sendResponse({ ok: true, extension: true, role: ROLE, version: chrome.runtime.getManifest().version });
      return true;
    }
    if (message?.type === "copiedSelectorUpdated") {
      writeLocal(message.text || "");
      replyCopied({ ok: true, payload: message.payload, text: message.text });
      sendResponse({ ok: true });
      return true;
    }
    return false;
  });

  window.addEventListener("message", (ev) => {
    if (ev.source !== window) return;
    const d = ev.data;
    if (!d || d.source !== PAGE) return;
    if (d.type === "request-copied-selector") fetchCopied();
    else if (d.type === "store-copied-selector") storeCopied(d.payload, d.text);
  });

  window.addEventListener("da-request-copied-selector", fetchCopied);
  window.addEventListener("da-store-copied-selector", (ev) => {
    const d = ev.detail || {};
    storeCopied(d.payload, d.text);
  });
})();
