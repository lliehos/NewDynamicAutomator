/** Morobot Smart Recorder — blank tab + soft API stub (Microsoft LM later). */

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

async function portalBase() {
  const { portalBase } = await chrome.storage.local.get("portalBase");
  return portalBase || DEFAULT_PORTAL;
}

async function resolveAccessToken() {
  const portal = await portalBase();
  const urls = [portal, "https://localhost:7201", "http://localhost:7200"];
  for (const url of urls) {
    try {
      const cookie = await chrome.cookies.get({ url, name: "da_access" });
      if (cookie?.value) {
        await chrome.storage.local.set({ token: cookie.value, portalBase: new URL(url).origin });
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

/** Fetch portal API. Network / unreachable → treated as HTTP 404. */
async function apiFetch(path, options = {}) {
  const base = await portalBase();
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  const token = await resolveAccessToken();
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
  } catch {
    throw new ApiError("سرور در دسترس نیست (404).", 404);
  }
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  if (!res.ok) {
    const status = res.status === 404 ? 404 : res.status;
    const msg = status === 404
      ? "سرور در دسترس نیست (404)."
      : (data?.message || data?.error || `HTTP ${status}`);
    throw new ApiError(msg, status);
  }
  return data ?? {};
}

/** Soft ping — empty 200 when API is up. */
async function ensureServerAvailable() {
  try {
    await apiFetch("/api/smart-learning/ping", { method: "GET" });
    return { ok: true };
  } catch (err) {
    const status = err?.status || 404;
    return {
      ok: false,
      status: status === 404 ? 404 : status,
      error: err?.message || "سرور در دسترس نیست (404)."
    };
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender).then(sendResponse).catch((err) => sendResponse({
    ok: false,
    error: err.message,
    status: err.status || (String(err.message || "").includes("404") ? 404 : undefined)
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
    case "smartContext":
      return onSmartContext(message.payload, sender);
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
      files: ["content/selector.js", "content/capture.js", "content/fab.js"]
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
 * 3) If server unreachable → 404 (tab closed)
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
      status: 404,
      error: ping.error || "سرور در دسترس نیست (404)."
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
      status: err?.status || 404,
      error: err?.message || "سرور در دسترس نیست (404)."
    };
  }

  const sessionId = created?.sessionId;
  if (!sessionId) {
    if (tabId) try { await chrome.tabs.remove(tabId); } catch { /* ignore */ }
    return { ok: false, status: 404, error: "سرور در دسترس نیست (404)." };
  }

  await chrome.storage.local.set({
    smartActive: true,
    smartSessionId: sessionId,
    smartTabId: tabId,
    smartTaskId: taskId,
    smartTaskTitle: taskTitle,
    smartLearningComplete: false,
    smartStatus: "thinking",
    portalBase: await portalBase()
  });
  contextQueue = [];
  await broadcastSmartState();
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

async function flushContexts() {
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
    if (contextQueue.length) scheduleFlush();
    return { ok: true, sent: batch.length };
  } catch (err) {
    contextQueue = batch.concat(contextQueue).slice(0, 200);
    scheduleFlush();
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
  await broadcastSmartState();
  return { ok: true, learningComplete: false, tabId: smartTabId || null };
}

async function saveSmartResult() {
  // Soft stub — Microsoft LM will produce a graph later.
  const { smartSessionId } = await chrome.storage.local.get(["smartSessionId"]);
  if (!smartSessionId) return { ok: false, error: "جلسه‌ای نیست." };
  try {
    await apiFetch(`/api/smart-learning/sessions/${encodeURIComponent(smartSessionId)}/save`, {
      method: "POST",
      body: {}
    });
  } catch { /* soft empty */ }
  await chrome.storage.local.set({
    smartActive: false,
    smartSessionId: null,
    smartTabId: null,
    smartLearningComplete: false,
    smartStatus: "idle"
  });
  await broadcastSmartState();
  return { ok: true, result: {} };
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
  if (changeInfo.status === "complete") {
    injectSmartFab(tabId).catch(() => {});
  }
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const { smartTabId, smartActive } = await chrome.storage.local.get(["smartTabId", "smartActive"]);
  if (smartActive && smartTabId === tabId) {
    await stopSmartThinking();
  }
});
