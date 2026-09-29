/** Portal handshake — Smart Recorder role. */
(function () {
  if (window.DaPortalDetect && !DaPortalDetect.isMorobotPortalPage()) return;

  const ROLE = "smart";

  function readCookie(name) {
    const m = document.cookie.match(new RegExp("(?:^|;\\s*)" + name + "=([^;]*)"));
    return m ? decodeURIComponent(m[1]) : "";
  }

  /** The portal publishes its language as cookie/localStorage `da_culture`; mirror it for the extension UI. */
  function currentCulture() {
    try {
      const raw = (readCookie("da_culture") || localStorage.getItem("da_culture") || "fa").toLowerCase();
      return raw === "en" ? "en" : "fa";
    } catch {
      return "fa";
    }
  }

  function publishCulture() {
    try {
      chrome.storage.local.set({ uiCulture: currentCulture() });
    } catch { /* ignore */ }
  }

  function mark() {
    try {
      const version = chrome.runtime.getManifest().version;
      document.documentElement.dataset.daSmartExtension = "1";
      document.documentElement.dataset.daSmartVersion = version;
      document.documentElement.dataset.daSmartCulture = currentCulture();
      window.dispatchEvent(new CustomEvent("da-extension-ready", {
        detail: { version, role: ROLE }
      }));
      window.dispatchEvent(new CustomEvent("da-smart-ready", {
        detail: { version }
      }));
    } catch { /* ignore */ }
  }

  try {
    /*
     * This write is what made two servers interfere.
     *
     * `portalBase` is one key in shared extension storage, so every portal page load repointed the
     * whole extension at itself: opening the local portal while a session ran against the published
     * one silently moved that session's requests to localhost (and the reverse). A session pinned to
     * its own portal by `DaSessionScope.bindSession` was still overridden here on the next page load.
     *
     * A session in progress therefore must not be repointed. The base is only updated when there is
     * no session, and the session's own binding takes precedence in the background regardless — this
     * stops the shared value from being rewritten out from under it.
     */
    chrome.storage.local.get(["smartActive", "smartSessionId"]).then((st) => {
      const inSession = !!(st && (st.smartActive || st.smartSessionId));
      const patch = {
        extensionRole: ROLE,
        uiCulture: currentCulture()
      };
      if (!inSession) {
        patch.portalBase = location.origin;
        patch.apiBase = location.origin;
      }
      chrome.storage.local.set(patch);
      // The session sync runs after the write: it resolves which portal it is talking to from the
      // same storage, so firing it first would have it read the previous value.
      chrome.runtime.sendMessage({ type: "syncPortalSession" }).catch(() => {});
    }).catch(() => {
      chrome.runtime.sendMessage({ type: "syncPortalSession" }).catch(() => {});
    });
  } catch { /* ignore */ }

  mark();

  // Keep the extension language in step if the user switches it in the portal.
  document.addEventListener("da:locale", (ev) => {
    const c = ev?.detail?.culture;
    try {
      chrome.storage.local.set({ uiCulture: c ? (c === "en" ? "en" : "fa") : currentCulture() });
    } catch { /* ignore */ }
  });
  window.addEventListener("storage", (ev) => {
    if (ev.key === "da_culture") publishCulture();
  });

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
