/** Morobot Smart Recorder — blank tab + soft API stub (Microsoft LM later). */
importScripts("lib/branding.js", "lib/session-scope.js");

const DEFAULT_PORTAL = "https://localhost:7201";
const FLUSH_MS = 1200;
const MAX_BATCH = 40;

let contextQueue = [];
let flushTimer = null;

class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/**
 * The portal origin this extension is currently pointed at.
 *
 * Prefers a live session's own bound server over the shared `portalBase` value.
 *
 * `portalBase` is one key in `chrome.storage.local`, shared by every tab, and both
 * `content/portal-bridge.js` and the token lookup write to it. With a local server and a published
 * one both open they overwrite each other, so a request made for a recording could be sent to
 * whichever portal happened to load last — showing up as "the session does not exist" or a stray
 * 401, with nothing on screen to explain it.
 *
 * Resolving a live session's base first closes that hole for every caller at once, rather than
 * relying on each request site to opt in: one that forgot would silently keep the broken behaviour.
 */
async function portalBase() {
  const { portalBase } = await chrome.storage.local.get("portalBase");
  const globalBase = portalBase || DEFAULT_PORTAL;
  if (globalThis.DaSessionScope) {
    try {
      return await DaSessionScope.resolveBase(globalBase);
    } catch { /* fall through to the global value */ }
  }
  return globalBase;
}

async function resolveAccessToken() {
  const portal = await portalBase();
  const urls = [portal, "https://localhost:7201", "http://localhost:7200"];
  for (const url of urls) {
    try {
      const cookie = await chrome.cookies.get({ url, name: "da_access" });
      if (cookie?.value) {
        // `tokenPortalBase` records which server issued the token, so a local token is not later
        // attached to a remote request. The write to `portalBase` that used to happen here is gone:
        // this runs mid-request, and repointing global routing as a side effect of fetching a token
        // is what let one call silently move the whole extension to a different server.
        await chrome.storage.local.set({
          token: cookie.value,
          tokenPortalBase: new URL(url).origin
        });
        return cookie.value;
      }
    } catch { /* next */ }
  }
  const { token } = await chrome.storage.local.get("token");
  return token || null;
}

async function currentLocalUser() {
  const portal = await portalBase();
  try {
    const cookie = await chrome.cookies.get({ url: portal, name: "da_local_user" });
    if (cookie?.value) {
      const u = decodeURIComponent(cookie.value).trim() || "test";
      await chrome.storage.local.set({ localUser: u });
      return u;
    }
  } catch { /* ignore */ }
  const { localUser } = await chrome.storage.local.get("localUser");
  return localUser || "test";
}

/** Fetch portal API. A transport failure is reported with status 0, not 404. */
async function apiFetch(path, options = {}) {
  const base = await portalBase();
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  let token = await resolveAccessToken();
  // Drop a token that belongs to a different portal. A credential issued by the other server is
  // rejected there, which surfaces as an auth failure rather than the misrouted request it really
  // is — the least diagnosable possible symptom.
  if (token && globalThis.DaSessionScope) {
    token = await DaSessionScope.tokenForOrigin(base, await chrome.storage.local.get([
      "smartToken", "token", "tokenPortalBase"
    ]));
  }
  if (token) headers.Authorization = `Bearer ${token}`;
  const user = await currentLocalUser();
  headers["X-Da-Local-User"] = user;
  let res;
  try {
    res = await fetch(`${base}${path}`, {
      ...options,
      headers,
      body: options.body != null
        ? (typeof options.body === "string" ? options.body : JSON.stringify(options.body))
        : undefined
    });
  } catch (err) {
    // A transport failure, not an HTTP one. The reason is preserved rather than collapsed into a
    // generic message: "server is down", "the certificate was rejected" and "this host does not
    // exist" all land here, and they need different answers from the user.
    //
    // `status: 0` marks it as "never reached the server", which is what distinguishes it from a real
    // 404 — the old code reported both as 404, so a dead server and a missing route were
    // indistinguishable and the wrong message was shown for each.
    const detail = describeNetworkError(err, base);
    throw new ApiError(detail, 0);
  }
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  if (!res.ok) {
    // Only a genuine 404 says "not reachable" — and even then the route may simply be missing, which
    // is a server-version problem rather than a connection problem. Other statuses carry the server's
    // own message through untouched.
    const msg = data?.message || data?.error
      || (res.status === 404
        ? "مسیر سرویس پیدا نشد (404) — نسخهٔ سرور با افزونه هم‌خوان نیست."
        : `خطای سرور (HTTP ${res.status}).`);
    throw new ApiError(msg, res.status);
  }
  return data ?? {};
}

/**
 * Turn a `fetch` rejection into a message that says what actually went wrong.
 *
 * `fetch` rejects with a bare `TypeError: Failed to fetch` for every transport problem, so the
 * underlying cause has to be inferred from the target and the error itself. Each branch below is a
 * different user action: start the server, trust the certificate, or fix the address.
 */
function describeNetworkError(err, base) {
  const raw = String(err?.message || err || "");
  const port = (() => {
    try { return new URL(base).port || ""; } catch { return ""; }
  })();
  const where = port ? `${base} (پورت ${port})` : base;

  if (/certificate|SSL|ERR_CERT|self-signed/i.test(raw)) {
    return `گواهی امنیتی سرور پذیرفته نشد. یکبار ${base} را در مرورگر باز کنید و گواهی را بپذیرید.`;
  }
  if (/ERR_NAME_NOT_RESOLVED|ENOTFOUND|getaddrinfo/i.test(raw)) {
    return `نام سرور پیدا نشد. آدرس پورتال را بررسی کنید: ${base}`;
  }
  if (/ERR_CONNECTION_REFUSED|ECONNREFUSED|ERR_CONNECTION_RESET|ERR_CONNECTION_CLOSED|ERR_EMPTY_RESPONSE/i.test(raw)) {
    return `سرور در دسترس نیست — ${where} پاسخ نمی‌دهد. مطمئن شوید سرویس اجرا شده است.`;
  }
  if (/ERR_NETWORK|ERR_INTERNET_DISCONNECTED|ERR_ADDRESS_UNREACHABLE|ERR_TIMED_OUT|timeout/i.test(raw)) {
    return `اتصال به سرور برقرار نشد — ${where}. اتصال شبکه را بررسی کنید.`;
  }
  // Unknown transport failure: still say it never reached the server, and keep the original text so
  // the problem is diagnosable instead of being hidden behind a generic sentence.
  return `ارتباط با سرور برقرار نشد — ${where}${raw ? ` (${raw})` : ""}`;
}

/** Soft ping — empty 200 when API is up. */
async function ensureServerAvailable() {
  try {
    await apiFetch("/api/smart-learning/ping", { method: "GET" });
    return { ok: true };
  } catch (err) {
    // The status is passed through unchanged, including `0` for "never reached the server". Mapping
    // every failure to 404 here is what hid the difference between a stopped service and a missing
    // route, and it made the callers report "404" for what was actually a connection problem.
    return {
      ok: false,
      status: err?.status ?? 0,
      error: err?.message || "سرور در دسترس نیست."
    };
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender).then(sendResponse).catch((err) => sendResponse({
    ok: false,
    error: err.message,
    // Preserve the real status, including the `0` that marks a transport failure. The old
    // "contains 404" guess turned every unexpected error into a 404 report.
    status: typeof err?.status === "number" ? err.status : undefined
  }));
  return true;
});

async function handleMessage(message, sender) {
  switch (message.type) {
    case "session":
      return {
        signedIn: true,
        userName: await currentLocalUser(),
        version: chrome.runtime.getManifest().version
      };
    case "syncPortalSession":
      await currentLocalUser();
      return { ok: true };
    case "getSmartState":
      return getSmartState();
    case "startSmartSession":
      return startSmartSession(message);
    case "stopSmartThinking":
      return stopSmartThinking();
    case "saveSmartResult":
      return saveSmartResult();
    case "copySmartResult":
      return copySmartResult();
    case "smartContext":
      return onSmartContext(message.payload, sender);
    case "applyTenantBranding":
      await DaTenantBranding.persist(DaTenantBranding.normalize(message.payload || message.branding));
      return { ok: true };
    case "startRecordSession":
    case "startPlay":
      return { ok: false, error: "این افزونه فقط Smart Recorder است.", needExtension: "smart" };
    default:
      return { ok: false, error: "unknown" };
  }
}

async function getSmartState() {
  const data = await chrome.storage.local.get([
    "smartActive", "smartSessionId", "smartTabId", "smartTaskId",
    "smartTaskTitle", "smartLearningComplete", "smartStatus"
  ]);
  return {
    ok: true,
    active: !!data.smartActive,
    sessionId: data.smartSessionId || null,
    tabId: data.smartTabId || null,
    taskId: data.smartTaskId ?? null,
    taskTitle: data.smartTaskTitle || null,
    learningComplete: !!data.smartLearningComplete,
    status: data.smartStatus || "idle"
  };
}

async function broadcastSmartState() {
  const state = await getSmartState();
  const payload = {
    type: "smartStateChanged",
    active: state.active,
    sessionId: state.sessionId,
    tabId: state.tabId,
    taskId: state.taskId,
    learningComplete: state.learningComplete,
    status: state.status
  };
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (!tab.id) continue;
    chrome.tabs.sendMessage(tab.id, payload).catch(() => {});
  }
  chrome.runtime.sendMessage(payload).catch(() => {});
  return state;
}

/** Inject Smart FAB (+ capture) — required on about:blank (no content_scripts). */
async function injectSmartFab(tabId, attempt = 0) {
  if (!tabId) return false;
  try {
    await chrome.scripting.insertCSS({
      target: { tabId },
      files: ["styles/fab.css"]
    }).catch(() => {});
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["lib/rec-i18n.js", "content/selector.js", "content/capture.js", "content/fab.js"]
    });
    await broadcastSmartState();
    return true;
  } catch (err) {
    if (attempt < 8) {
      await new Promise((r) => setTimeout(r, 100 + attempt * 50));
      return injectSmartFab(tabId, attempt + 1);
    }
    console.warn("[smart] injectSmartFab failed", tabId, err?.message || err);
    return false;
  }
}

/**
 * 1) Open blank tab + HUD
 * 2) Soft-create session on portal API (empty learning payload)
 * 3) If the server cannot be reached the tab is closed and the reason is returned
 */
async function startSmartSession(message = {}) {
  const taskId = message.taskId != null && String(message.taskId).trim() !== ""
    ? String(message.taskId).trim()
    : null;
  if (!taskId) {
    return { ok: false, error: "شناسهٔ فرآیند لازم است." };
  }
  const taskTitle = message.taskTitle || null;
  const localUser = await currentLocalUser();

  const tab = await chrome.tabs.create({ url: "about:blank", active: true });
  const tabId = tab?.id || null;
  if (tabId) await injectSmartFab(tabId);

  const ping = await ensureServerAvailable();
  if (!ping.ok) {
    if (tabId) try { await chrome.tabs.remove(tabId); } catch { /* ignore */ }
    return {
      ok: false,
      status: ping.status,
      network: ping.status === 0,
      error: ping.error || "سرور در دسترس نیست."
    };
  }
  let created;
  try {
    created = await apiFetch("/api/smart-learning/sessions", {
      method: "POST",
      body: { taskId, taskTitle, localUser }
    });
  } catch (err) {
    if (tabId) try { await chrome.tabs.remove(tabId); } catch { /* ignore */ }
    return {
      ok: false,
      status: err?.status ?? 0,
      network: (err?.status ?? 0) === 0,
      error: err?.message || "سرور در دسترس نیست."
    };
  }

  const sessionId = created?.sessionId;
  if (!sessionId) {
    if (tabId) try { await chrome.tabs.remove(tabId); } catch { /* ignore */ }
    // An empty success means the API answered without a session. That is a server-side problem, not
    // a connection one, and saying otherwise would send the user to check a running server.
    return { ok: false, status: 200, error: "سرور جلسهٔ ضبط را نساخت — نسخهٔ سرور را بررسی کنید." };
  }

  // Pin this session to the portal it was created on, so opening another portal later cannot move
  // the save onto a different server. The base is read now, while the record button's own portal is
  // still the one in context, and kept for the life of the session.
  const boundBase = await portalBase();
  if (globalThis.DaSessionScope) {
    await DaSessionScope.bindSession(boundBase, await resolveAccessToken().catch(() => null));
  }

  await chrome.storage.local.set({
    smartActive: true,
    smartSessionId: sessionId,
    smartTabId: tabId,
    smartTaskId: taskId,
    smartTaskTitle: taskTitle,
    smartLearningComplete: false,
    smartStatus: "thinking",
    // Kept for the FAB's "am I on the portal page" check. The authoritative per-session copy is
    // `smartPortalBase`, written by DaSessionScope above.
    portalBase: boundBase
  });
  contextQueue = [];
  await broadcastSmartState();
  // Re-inject now that smartActive is true.
  //
  // The first injection above runs before the session exists, so fab.js sees smartActive === false
  // and correctly declines to mount. Nothing would then re-inject it on a blank tab: about:blank
  // has already reached "complete", and the user is told not to change the address, so no further
  // navigation event ever arrives. Injecting again here is what makes the FAB appear immediately.
  if (tabId) await injectSmartFab(tabId);
  return { ok: true, sessionId, tabId, taskId };
}

async function onSmartContext(payload, sender) {
  const { smartActive } = await chrome.storage.local.get(["smartActive"]);
  if (!smartActive) return { ok: true, ignored: true };
  const item = {
    ...payload,
    tabId: sender?.tab?.id ?? null,
    frameId: sender?.frameId ?? 0
  };
  contextQueue.push(item);
  scheduleFlush();
  return { ok: true, queued: contextQueue.length };
}

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushContexts().catch(() => {});
  }, FLUSH_MS);
  if (contextQueue.length >= MAX_BATCH) {
    clearTimeout(flushTimer);
    flushTimer = null;
    flushContexts().catch(() => {});
  }
}

async function flushContexts({ reschedule = true } = {}) {
  if (!contextQueue.length) return { ok: true, sent: 0 };
  const { smartActive, smartSessionId } = await chrome.storage.local.get(["smartActive", "smartSessionId"]);
  if (!smartActive || !smartSessionId) {
    contextQueue = [];
    return { ok: true, sent: 0 };
  }
  const batch = contextQueue.splice(0, MAX_BATCH);
  try {
    // Soft API — empty learning result for now.
    await apiFetch(`/api/smart-learning/sessions/${encodeURIComponent(smartSessionId)}/contexts`, {
      method: "POST",
      body: { contexts: batch }
    });
    if (reschedule && contextQueue.length) scheduleFlush();
    return { ok: true, sent: batch.length };
  } catch (err) {
    contextQueue = batch.concat(contextQueue).slice(0, 200);
    // `reschedule: false` is used by the save path. Letting a save leave a retry timer behind would
    // silently keep pushing contexts after the user was told the save had been cancelled, which
    // makes the failure report untrustworthy.
    if (reschedule) scheduleFlush();
    return { ok: false, error: err.message, status: err.status };
  }
}

async function stopSmartThinking() {
  await flushContexts().catch(() => {});
  const { smartSessionId, smartTabId } = await chrome.storage.local.get(["smartSessionId", "smartTabId"]);
  if (smartSessionId) {
    try {
      await apiFetch(`/api/smart-learning/sessions/${encodeURIComponent(smartSessionId)}/stop`, {
        method: "POST",
        body: {}
      });
    } catch { /* soft ignore */ }
  }
  await chrome.storage.local.set({
    smartActive: false,
    smartLearningComplete: false,
    smartStatus: "stopped"
  });
  // `smartSessionId` is deliberately KEPT here, and so is the session's server binding: stopping
  // only ends the learning pass, and the save that usually follows must still reach the portal this
  // session was created on. The binding is released by the save and the copy, which consume session.
  await broadcastSmartState();
  return { ok: true, learningComplete: false, tabId: smartTabId || null };
}

async function saveSmartResult() {
  const { smartSessionId } = await chrome.storage.local.get(["smartSessionId"]);
  if (!smartSessionId) return { ok: false, error: "جلسه‌ای نیست." };

  // Drain anything still queued before saving.
  //
  // Contexts are flushed on a 1200ms timer, so the last few interactions are usually still in the
  // queue when the user hits save. Without this they are dropped, and the graph is built from an
  // incomplete recording — the final steps of the very process the user just performed would be
  // missing from the saved diagram, with nothing to indicate why.
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  const flushed = await flushContexts({ reschedule: false }).catch((err) => ({
    ok: false,
    status: 0,
    error: err?.message || String(err)
  }));
  if (flushed && flushed.ok === false) {
    return {
      ok: false,
      status: flushed.status ?? 0,
      network: (flushed.status ?? 0) === 0,
      error: `تعامل‌های ضبط‌شده به سرور نرسید — ذخیره لغو شد. ${flushed.error || "ارتباط با سرور برقرار نشد."}`
    };
  }

  // Ask the server first, so an unreachable server is reported as such.
  //
  // The save below would fail anyway, but its error would be whatever `fetch` happened to throw. A
  // dedicated ping is what makes the difference between "the server is down" and "the save request
  // was refused" legible, and it is the check the recorder already uses before starting a session.
  const ping = await ensureServerAvailable();
  if (!ping.ok) {
    return {
      ok: false,
      status: ping.status,
      network: ping.status === 0,
      error: ping.error || "سرور در دسترس نیست."
    };
  }

  // The request may legitimately fail because the API itself refuses, and until now every failure was
  // swallowed and reported as `ok: true`. That is what made a dead server look like a successful
  // save: the page was told nothing, the session was cleared, and the process stayed empty.
  let res;
  try {
    res = await apiFetch(`/api/smart-learning/sessions/${encodeURIComponent(smartSessionId)}/save`, {
      method: "POST",
      body: {}
    });
  } catch (err) {
    // `status: 0` is a transport failure (never reached the server); a real code came back from it.
    return {
      ok: false,
      status: err?.status,
      network: err?.status === 0,
      error: err?.message || "ذخیرهٔ نتیجه ناموفق بود."
    };
  }

  if (!res?.ok) {
    return {
      ok: false,
      status: res?.status,
      error: res?.message || "موتور یادگیری گرافی تولید نکرد — چیزی به فرآیند اضافه نشد."
    };
  }

  // The session is only cleared once the result really landed, so a failed save leaves the
  // recording intact and the button available for a retry.
  // The server binding is released at the same time: the session is finished with, and leaving it
  // behind would let a later, unrelated request inherit the wrong portal.
  if (globalThis.DaSessionScope) await DaSessionScope.unbindSession().catch(() => {});
  await chrome.storage.local.set({
    smartActive: false,
    smartSessionId: null,
    smartTabId: null,
    smartLearningComplete: false,
    smartStatus: "idle"
  });
  await broadcastSmartState();
  return { ok: true, graph: res.graph || null, taskId: res.taskId || null };
}

/**
 * Fetch the recording as text and keep it in extension memory.
 *
 * Deliberately independent of `saveSmartResult`: the point of the button is to let the user paste
 * the recording into a diagram themselves, so it must not require the save to succeed first.
 *
 * The clipboard itself is not written here. `chrome.clipboard` does not exist outside an offscreen
 * document, and `navigator.clipboard` needs a focused, user-activated document — a service worker
 * has neither. The portal page does the clipboard write from the text returned here, which is why
 * the response carries it.
 */
async function copySmartResult() {
  const { smartSessionId } = await chrome.storage.local.get(["smartSessionId"]);
  if (!smartSessionId) return { ok: false, error: "جلسه‌ای نیست." };

  // Drain the queue first, for the same reason the save path does: the last interactions are still
  // on the 1200ms flush timer, and copying without them would hand the user a graph that is missing
  // the final steps of their own recording.
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  const flushed = await flushContexts({ reschedule: false }).catch((err) => ({
    ok: false,
    status: 0,
    error: err?.message || String(err)
  }));
  if (flushed && flushed.ok === false) {
    return {
      ok: false,
      status: flushed.status ?? 0,
      network: (flushed.status ?? 0) === 0,
      error: `تعامل‌های ضبط‌شده به سرور نرسید — کپی لغو شد. ${flushed.error || "ارتباط با سرور برقرار نشد."}`
    };
  }

  let text;
  try {
    text = await apiFetch(`/api/smart-learning/sessions/${encodeURIComponent(smartSessionId)}/copy`, {
      method: "POST",
      body: {}
    });
  } catch (err) {
    return {
      ok: false,
      status: err?.status,
      network: err?.status === 0,
      error: err?.message || "کپی در حافظه ناموفق بود."
    };
  }

  const payload = text?.text;
  if (!payload) {
    return {
      ok: false,
      error: text?.message || "موتور یادگیری گرافی تولید نکرد — چیزی برای کپی نیست."
    };
  }

  await chrome.storage.local.set({
    smartCopyText: payload,
    smartCopyAt: new Date().toISOString(),
    smartCopySessionId: smartSessionId
  });

  // Stop the session the same way a save does. The session id AND its server binding are both kept
  // here: the text can be re-read and copied again without re-recording, and that second copy must
  // still go to the portal the session was made on. `saveSmartResult` is what clears both, because
  // saving is what actually consumes the session.
  await chrome.storage.local.set({
    smartActive: false,
    smartTabId: null,
    smartLearningComplete: false,
    smartStatus: "copied"
  });
  await broadcastSmartState();
  return { ok: true, text: payload, bytes: payload.length };
}

chrome.webNavigation.onCommitted.addListener(async (details) => {
  if (details.frameId !== 0) return;
  const { smartActive, smartTabId } = await chrome.storage.local.get(["smartActive", "smartTabId"]);
  if (!smartActive || !smartTabId || details.tabId !== smartTabId) return;
  contextQueue.push({
    kind: "navigation",
    at: new Date().toISOString(),
    page: { url: details.url },
    transitionType: details.transitionType,
    tabId: details.tabId,
    frameId: 0
  });
  scheduleFlush();
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  const { smartActive, smartTabId } = await chrome.storage.local.get(["smartActive", "smartTabId"]);
  if (!smartActive || !smartTabId || tabId !== smartTabId) return;

  // "complete" only covers fully loaded documents. A blank tab never reports it again after the
  // first load, and a same-document (hash/SPA) navigation never reports it at all — which is why
  // the FAB could vanish on a page the user was told not to navigate away from. Re-inject whenever
  // the tab reports a new URL, and also on a completed load, and let fab.js dedupe.
  const urlChanged = typeof changeInfo.url === "string";
  if (changeInfo.status === "complete" || urlChanged) {
    injectSmartFab(tabId).catch(() => {});
  }
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const { smartTabId, smartActive } = await chrome.storage.local.get(["smartTabId", "smartActive"]);
  if (smartActive && smartTabId === tabId) {
    await stopSmartThinking();
  }
});

DaTenantBranding.bootstrap().catch(() => {});
