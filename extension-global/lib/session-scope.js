/**
 * Session-scoped server binding.
 *
 * The extension talks to whichever portal it last saw. `portalBase` is a single key in
 * `chrome.storage.local`, and that storage is shared by every tab and every portal the user opens,
 * so a locally running server and a remote one overwrite each other's entry.
 *
 * The interference is not theoretical. Two writers compete:
 *
 *   1. `content/portal-bridge.js` writes `portalBase` on every portal page it loads, so opening the
 *      local portal silently repoints the extension away from the server, and vice versa.
 *   2. `background.js` `resolveAccessToken()` writes `portalBase` *while a request is being made*,
 *      to the first host in a hardcoded list that happens to have a `da_access` cookie. With both a
 *      local and a remote session signed in, that can pick the wrong one mid-flight.
 *
 * The result is a request meant for the server going to localhost (or the reverse), which reads as
 * "the session does not exist" or a stray 401 - with no visible cause, because the base URL is
 * never shown anywhere.
 *
 * The fix is to stop treating the server as global state and bind it to the recording instead. A
 * recording is created against one specific portal, so that portal is stored with it; every request
 * that belongs to the session resolves its base from the session first and only falls back to the
 * global value when there is no session. Opening another portal can then no longer move a
 * recording in progress onto a different server.
 *
 * This file is loaded before `background.js` (see the manifest's service worker imports), so the
 * helpers below are available to it.
 */
(function (global) {
  /** Keys that describe WHERE a session lives, as opposed to what it contains. */
  const SESSION_KEYS = [
    "recordPortalBase",
    "recordToken",
    "playPortalBase",
    "playToken"
  ];

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
   * The portal a recording belongs to, or "" when no recording is in progress.
   *
   * A session with no recorded base is treated as unbound rather than as "unknown": older sessions
   * predate this field, and pretending they are bound would break them. Callers fall back to the
   * global base in that case, which is exactly the old behaviour and no worse.
   */
  async function recordPortalBase() {
    try {
      const st = await chrome.storage.local.get(["recording", "recordPortalBase"]);
      if (!st.recording) return "";
      return normalizeBase(st.recordPortalBase);
    } catch {
      return "";
    }
  }

  /** The portal a running play belongs to, or "" when nothing is playing. */
  async function playPortalBase() {
    try {
      const st = await chrome.storage.local.get(["playing", "playPortalBase"]);
      if (!st.playing) return "";
      return normalizeBase(st.playPortalBase);
    } catch {
      return "";
    }
  }

  /**
   * The base URL a request should use, preferring the live session's own server.
   *
   * `kind` selects which session to consult: "record", "play", or anything else for "no session".
   * The global base stays the final fallback so behaviour is unchanged when no session is open.
   */
  async function resolveBase(kind, globalBase) {
    if (kind === "record") {
      const bound = await recordPortalBase();
      if (bound) return bound;
    } else if (kind === "play") {
      const bound = await playPortalBase();
      if (bound) return bound;
    }
    return normalizeBase(globalBase) || String(globalBase || "");
  }

  /**
   * Record the portal a session belongs to, at the moment the session starts.
   *
   * Called with the base that was actually in use when the session began, so the binding reflects
   * the server the user was looking at rather than whatever the global value drifts to later.
   */
  async function bindSession(kind, base, token) {
    const origin = normalizeBase(base);
    if (!origin) return;
    const patch = {};
    if (kind === "record") {
      patch.recordPortalBase = origin;
      if (token) patch.recordToken = token;
    } else if (kind === "play") {
      patch.playPortalBase = origin;
      if (token) patch.playToken = token;
    }
    if (!Object.keys(patch).length) return;
    try {
      await chrome.storage.local.set(patch);
    } catch { /* ignore */ }
  }

  /** Drop a session's binding when the session ends, so a later request cannot inherit it. */
  async function unbindSession(kind) {
    const patch = {};
    if (kind === "record") {
      patch.recordPortalBase = null;
      patch.recordToken = null;
    } else if (kind === "play") {
      patch.playPortalBase = null;
      patch.playToken = null;
    }
    if (!Object.keys(patch).length) return;
    try {
      await chrome.storage.local.set(patch);
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
  async function tokenForOrigin(kind, origin, globals) {
    const originNorm = normalizeBase(origin);
    const st = globals || await chrome.storage.local.get(SESSION_KEYS.concat(["token"]));
    const sessionToken = kind === "record"
      ? st.recordToken
      : kind === "play"
        ? st.playToken
        : null;
    if (sessionToken) return sessionToken;

    const globalToken = st.token || null;
    if (!globalToken || !originNorm) return globalToken;

    // Keep the global token only when it was actually issued for this origin. The stored
    // `portalBaseItBelongsTo` is written alongside the token when it is discovered.
    const owner = normalizeBase(st.tokenPortalBase);
    if (!owner || owner === originNorm) return globalToken;
    return null;
  }

  global.DaSessionScope = {
    recordPortalBase,
    playPortalBase,
    resolveBase,
    bindSession,
    unbindSession,
    tokenForOrigin,
    normalizeBase,
    SESSION_KEYS
  };
})(typeof globalThis !== "undefined" ? globalThis : self);
