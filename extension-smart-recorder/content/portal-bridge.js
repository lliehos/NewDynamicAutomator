/** Portal handshake — Smart Recorder role. */
(function () {
  if (window.DaPortalDetect && !DaPortalDetect.isMorobotPortalPage()) return;

  const ROLE = "smart";

  function mark() {
    try {
      const version = chrome.runtime.getManifest().version;
      document.documentElement.dataset.daSmartExtension = "1";
      document.documentElement.dataset.daSmartVersion = version;
      window.dispatchEvent(new CustomEvent("da-extension-ready", {
        detail: { version, role: ROLE }
      }));
      window.dispatchEvent(new CustomEvent("da-smart-ready", {
        detail: { version }
      }));
    } catch { /* ignore */ }
  }

  try {
    chrome.storage.local.set({
      portalBase: location.origin,
      apiBase: location.origin,
      extensionRole: ROLE
    });
    chrome.runtime.sendMessage({ type: "syncPortalSession" }).catch(() => {});
  } catch { /* ignore */ }

  mark();
  function pushTenantBranding() {
    try {
      const b = window.__MOROBOT_BRANDING;
      if (!b || !b.appName) return;
      chrome.runtime.sendMessage({ type: "applyTenantBranding", payload: b }).catch(() => {});
    } catch { /* ignore */ }
  }
  pushTenantBranding();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => { mark(); pushTenantBranding(); });
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === "portalPing") {
      sendResponse({ ok: true, extension: true, role: ROLE, version: chrome.runtime.getManifest().version });
      return true;
    }
    return false;
  });
})();
