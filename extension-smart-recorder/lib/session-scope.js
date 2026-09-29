/**
 * Session-scoped server binding.
 *
 * The extension talks to whichever portal it last saw. `portalBase` is a single key in
 * `chrome.storage.local`, and that storage is shared by every tab and every portal the user opens,
 * so a locally running server and a published one overwrite each other's entry.
 *
 * Two writers compete for that key:
 *
 *   1. `content/portal-bridge.js` writes `portalBase` on every portal page it loads, so merely
 *      opening the local portal repoints the extension away from the server, and vice versa.
 *   2. `background.js` `resolveAccessToken()` writes it *while a request is being made*, to the first
 *      host in a hardcoded list that happens to have a `da_access` cookie. With both portals signed
 *      in, that can pick the wrong one mid-flight.
 *
 * The visible result is a request meant for the server arriving at localhost (or the reverse), which
 * reads as "the session does not exist" or a stray 401 - with no clue as to the cause, because the
 * base URL is never shown anywhere.
 *
 * The fix is to stop treating the server as global state and bind it to the recording instead. A
 * smart session is created against one specific portal, so that portal is stored with it, and every
 * request that belongs to the session resolves its base from the session first. Opening another
 * portal can then no longer move a recording in progress onto a different server.
 *
 * This file is loaded by `background.js` via `importScripts`, before it resolves any base.
 */
(function (global) {
  /** Keys that describe WHERE a session lives, as opposed to what it contains. */
  const SESSION_KEYS = ["smartPortalBase", "smartToken"];

  function normalizeBase(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    try {
      return new URL(raw).origin;
    } catch {
      return "";
    }
  }

  /**
   * The portal a smart session belongs to, or "" when no session is in progress.
   *
   * A session with no recorded base is treated as unbound rather than "unknown": it predates this
   * field, and pretending it is bound would break it. Callers then fall back to the global value,
   * which is the old behaviour and no worse.
   */
  async function sessionPortalBase() {
    try {
      const st = await chrome.storage.local.get(["smartActive", "smartSessionId", "smartPortalBase"]);
      // A session outlives `smartActive` between "learning complete" and the actual save, so the
      // session id is what marks it as still open. Checking only `smartActive` would drop the binding
      // exactly when the user goes to save.
      if (!st.smartActive && !st.smartSessionId) return "";
      return normalizeBase(st.smartPortalBase);
    } catch {
      return "";
    }
  }

  /**
   * The base URL a request should use, preferring the live session's own server.
   *
   * The global base stays the final fallback so behaviour is unchanged when no session is open.
   */
  async function resolveBase(globalBase) {
    const bound = await sessionPortalBase();
    if (bound) return bound;
    return normalizeBase(globalBase) || String(globalBase || "");
  }

  /**
   * Record the portal a session belongs to, at the moment the session starts.
   *
   * Called with the base actually in use when the session began, so the binding reflects the server
   * the user was looking at rather than whatever the global value drifts to later.
   */
  async function bindSession(base, token) {
    const origin = normalizeBase(base);
    if (!origin) return;
    const patch = { smartPortalBase: origin };
    if (token) patch.smartToken = token;
    try {
      await chrome.storage.local.set(patch);
    } catch { /* ignore */ }
  }

  /** Drop the binding when the session ends, so a later request cannot inherit it. */
  async function unbindSession() {
    try {
      await chrome.storage.local.set({ smartPortalBase: null, smartToken: null });
    } catch { /* ignore */ }
  }

  /**
   * A token that belongs to the given origin.
   *
   * The global `token` key has the same problem as `portalBase`: one slot for two servers. A token
   * issued by the remote portal is meaningless locally and produces a 401 that looks like an auth
   * bug rather than a misrouted request. The session's own token is therefore preferred, and the
   * global one is only used when it cannot be proven to belong to another origin.
   */
  async function tokenForOrigin(origin, globals) {
    const originNorm = normalizeBase(origin);
    const st = globals || await chrome.storage.local.get(SESSION_KEYS.concat(["token", "tokenPortalBase"]));
    if (st.smartToken) return st.smartToken;

    const globalToken = st.token || null;
    if (!globalToken || !originNorm) return globalToken;

    const owner = normalizeBase(st.tokenPortalBase);
    if (!owner || owner === originNorm) return globalToken;
    return null;
  }

  global.DaSessionScope = {
    sessionPortalBase,
    resolveBase,
    bindSession,
    unbindSession,
    tokenForOrigin,
    normalizeBase,
    SESSION_KEYS
  };
})(typeof globalThis !== "undefined" ? globalThis : self);
