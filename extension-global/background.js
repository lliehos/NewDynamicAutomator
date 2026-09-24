importScripts("player/engine.js", "bg-selector.js");

/** Morobot Global extension — record, play, and selector in one package. */
const DEFAULT_PORTAL = "https://localhost:7201";

async function portalBase() {
  const { portalBase } = await chrome.storage.local.get("portalBase");
  return portalBase || DEFAULT_PORTAL;
}

/** All server calls go to the portal origin. */
async function apiBase() {
  return portalBase();
}

async function resolveAccessToken() {
  const portal = await portalBase();
  const urls = [
    portal,
    "https://localhost:7801",
    "http://localhost:7800",
    "https://localhost:7701",
    "http://localhost:7700",
    "https://localhost:7601",
    "http://localhost:7600",
    "https://localhost:7501",
    "http://localhost:7500",
    "https://localhost:7401",
    "http://localhost:7400",
    "https://localhost:7201",
    "http://localhost:7200",
    "https://localhost/",
    "http://localhost/"
  ];
  for (const url of urls) {
    try {
      const cookie = await chrome.cookies.get({ url, name: "da_access" });
      if (cookie?.value) {
        await chrome.storage.local.set({ token: cookie.value, portalBase: new URL(url).origin, apiBase: new URL(url).origin });
        return cookie.value;
      }
    } catch {
      /* try next */
    }
  }

  const { token } = await chrome.storage.local.get("token");
  return token || null;
}

async function authHeaders() {
  const headers = { "Content-Type": "application/json" };
  const access = await resolveAccessToken();
  if (access) headers.Authorization = `Bearer ${access}`;
  return headers;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender).then(sendResponse).catch((err) => sendResponse({ ok: false, error: err.message }));
  return true;
});

async function handleMessage(message, sender) {
  switch (message.type) {
    case "getState":
      return getState();
    case "toggleRecord":
      // legacy: if recording → finish; else → start
      return (await getState()).recording ? finishRecord() : startRecordSession(message);
    case "clearDraft":
      return discardRecord();
    case "saveDraft":
      return saveDraft(message.payload);
    case "session":
      return checkSession();
    case "syncPortalSession":
      return syncPortalSession();
    case "recordedEvent":
      return onRecordedEvent(message.payload, sender);
    case "describeChildIframe":
      return null;
    case "listTasks":
      return listTasks();
    case "getLocalTasks":
      return listTasks();
    case "listOpenTabs":
      return listOpenTabs();
    case "getTaskGraph":
      return getLocalTaskGraph(message.taskId);
    case "startPlay":
      return startPlayWithAutoReload(message, sender);
    case "stopPlay":
      return stopPlay();
    case "pausePlay":
      return pausePlay();
    case "resumePlay":
      return resumePlay();
    case "getPlayState":
      return getPlayStatus();
    case "clearPlayLogs":
      return clearPlayLogs();
    case "persistPlayDataSources":
      return persistPlayDataSourcesMessage(message);
    case "broadcastDsCellEvent":
      return broadcastDsCellEventMessage(message);
    case "reloadPlayerNow":
      return reloadPlayerNow(message.pendingPlay || null);
    case "getCopiedSelector":
      return getCopiedSelector();
    case "setCopiedSelector":
      return setCopiedSelector(message.payload, message.text);
    case "clearCopiedSelector":
      await chrome.storage.local.remove(["copiedSelector", "copiedSelectorText", "copiedMode"]);
      return { ok: true };
    case "devtoolsCopy":
      return handleDevtoolsCopy(message);
    case "ping":
      return {
        ok: true,
        role: "global",
        version: chrome.runtime.getManifest().version,
        ...(await getCopiedSelectorPreview())
      };
    case "startRecordSession":
      return startRecordSession(message);
    case "finishRecord":
      return finishRecord();
    case "discardRecord":
      return discardRecord({ closeTab: message.closeTab !== false });
    case "resumeRecord":
      return resumeRecord();
    case "syncTasksFromPortal":
      return syncTasksFromPortal(message);
    case "setRecordOptions":
      return setRecordOptions(message.options);
    case "rerecord":
      return resumeRecord();
    default:
      return { ok: false, error: "unknown" };
  }
}

async function broadcastRecordState() {
  const state = await getState();
  const payload = {
    type: "recordingChanged",
    recording: state.recording,
    recordPhase: state.recordPhase,
    count: state.count,
    steps: state.steps,
    options: state.options,
    targetTaskId: state.targetTaskId,
    targetTitle: state.targetTitle
  };
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (!tab.id) continue;
    chrome.tabs.sendMessage(tab.id, payload).catch(() => {});
  }
  chrome.runtime.sendMessage(payload).catch(() => {});
  return state;
}

async function broadcastDraftUpdated() {
  const state = await getState();
  const payload = {
    type: "draftUpdated",
    recording: state.recording,
    recordPhase: state.recordPhase,
    count: state.count,
    steps: state.steps
  };
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (!tab.id) continue;
    chrome.tabs.sendMessage(tab.id, payload).catch(() => {});
  }
  chrome.runtime.sendMessage(payload).catch(() => {});
  return state;
}

function defaultRecordOptions(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  return {
    trackInputClicks: !!src.trackInputClicks,
    trackMouse: src.trackMouse !== false
  };
}

async function setRecordOptions(options) {
  const next = defaultRecordOptions(options);
  await chrome.storage.local.set({ recordOptions: next });
  const tabs = await chrome.tabs.query({});
  const msg = { type: "recordOptionsChanged", options: next };
  for (const tab of tabs) {
    if (!tab.id) continue;
    chrome.tabs.sendMessage(tab.id, msg).catch(() => {});
  }
  return { ok: true, options: next };
}

function currentStepsFromStorage(recordingGroups, draft) {
  const groups = Array.isArray(recordingGroups) ? recordingGroups : [];
  const flat = flattenGroupSteps(groups);
  if (flat.length) return flat;
  return Array.isArray(draft) ? draft.slice() : [];
}

async function isPortalTabUrl(url) {
  if (!url) return false;
  const portal = await portalBase();
  try {
    if (url.startsWith(portal)) return true;
  } catch {
    /* ignore */
  }
  return /:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(url);
}

async function listOpenTabs() {
  const tabs = await chrome.tabs.query({});
  const items = [];
  for (const t of tabs) {
    if (!t.id) continue;
    const url = t.url || t.pendingUrl || "";
    const isNewBlank =
      !url
      || url === "about:blank"
      || /^chrome:\/\/(newtab|new-tab-page)/i.test(url)
      || /^edge:\/\/(newtab|new-tab-page)/i.test(url);
    if (
      !isNewBlank
      && (
        url.startsWith("chrome://")
        || url.startsWith("chrome-extension://")
        || url.startsWith("edge://")
        || url.startsWith("devtools://")
      )
    ) {
      continue;
    }
    const portal = !isNewBlank && (await isPortalTabUrl(url));
    const title = isNewBlank
      ? (t.title && t.title !== "New Tab" && t.title !== "برگهٔ جدید" ? t.title : "تب جدید / خالی")
      : (t.title || "بدون عنوان");
    items.push({
      id: t.id,
      title: String(title).slice(0, 80),
      url: (url || "about:blank").slice(0, 220),
      active: !!t.active,
      windowId: t.windowId,
      isPortal: !!portal,
      isBlank: !!isNewBlank
    });
  }
  // Prefer non-portal tabs first; active tabs near the top within each group.
  items.sort((a, b) => {
    if (a.isPortal !== b.isPortal) return a.isPortal ? 1 : -1;
    if (a.active !== b.active) return a.active ? -1 : 1;
    return 0;
  });
  return { ok: true, tabs: items };
}

let openTabsBroadcastTimer = null;
function scheduleOpenTabsBroadcast(reason) {
  if (openTabsBroadcastTimer) clearTimeout(openTabsBroadcastTimer);
  openTabsBroadcastTimer = setTimeout(() => {
    openTabsBroadcastTimer = null;
    broadcastOpenTabsChanged(reason).catch(() => {});
  }, 180);
}

async function broadcastOpenTabsChanged(reason) {
  const list = await listOpenTabs();
  const payload = { type: "openTabsChanged", reason: reason || "update", tabs: list.tabs };
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (!tab.id) continue;
    chrome.tabs.sendMessage(tab.id, payload).catch(() => {});
  }
  // Popup / other extension pages listening on runtime
  chrome.runtime.sendMessage(payload).catch(() => {});
  return list;
}

async function pullTasksFromPortalTabs() {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (!tab.id) continue;
    const url = tab.url || "";
    if (!(await isPortalTabUrl(url))) continue;
    try {
      const res = await chrome.tabs.sendMessage(tab.id, { type: "requestPortalTasks" });
      if (res?.ok && Array.isArray(res.tasks) && res.tasks.length) {
        if (res.user) await chrome.storage.local.set({ localUser: res.user });
        await saveUserTasks(res.tasks);
        return res.tasks;
      }
    } catch {
      /* tab may not have bridge yet */
    }
  }
  return null;
}

/** Portal pushes its task list into the extension before record/save. */
async function syncTasksFromPortal(message = {}) {
  const tasks = Array.isArray(message.tasks) ? message.tasks : null;
  if (!tasks || !tasks.length) {
    // Keep whatever we already have — empty push used to wipe a good session.
    const existing = await loadUserTasks();
    if (existing.length) {
      if (message.user) await chrome.storage.local.set({ localUser: String(message.user) });
      return { ok: true, count: existing.length, keptExisting: true };
    }
    return {
      ok: false,
      error: "لیست فرآیند از پورتال خالی است. صفحهٔ فرآیندها را رفرش کنید یا یک فرآیند بسازید."
    };
  }
  if (message.user) await chrome.storage.local.set({ localUser: String(message.user) });
  await saveUserTasks(tasks);
  return { ok: true, count: tasks.length };
}

function findTaskIndex(tasks, targetId) {
  if (targetId == null || targetId === "") return -1;
  const key = String(targetId);
  return (tasks || []).findIndex((t) => String(t.id) === key);
}

/** Process ids are UUID/string (not always numeric). Never Number()-coerce. */
function normalizeTaskId(value) {
  if (value == null || value === "") return null;
  const s = String(value).trim();
  return s || null;
}

async function startRecordSession(message = {}) {
  // Record ONLY appends into an existing portal process — never creates one.
  await checkSession();
  const { playing, recordOptions: prevOpts } = await chrome.storage.local.get(["playing", "recordOptions"]);
  if (playing) return { ok: false, error: "هنگام پخش نمی‌توان ضبط کرد." };

  const targetTaskId = normalizeTaskId(message.taskId);
  if (!targetTaskId) {
    return { ok: false, error: "ضبط فقط روی فرآیند موجود — از دکمهٔ ضبط همان فرآیند شروع کنید." };
  }

  // Prefer tasks just pushed from portal; otherwise pull.
  let tasks = await loadUserTasks();
  let existing = tasks.find((t) => String(t.id) === String(targetTaskId));
  if (!existing) {
    const pulled = await pullTasksFromPortalTabs().catch(() => null);
    if (pulled) tasks = pulled;
    existing = tasks.find((t) => String(t.id) === String(targetTaskId));
  }
  if (!existing) {
    return {
      ok: false,
      error: "فرآیند هدف در پورتال پیدا نشد. ضبط فرآیند جدید نمی‌سازد — فقط به فرآیند موجود اقدام اضافه می‌کند."
    };
  }

  const targetTitle = existing.title || message.taskTitle || `فرآیند #${targetTaskId}`;
  const recordingGroups = [{
    id: "group-1",
    title: message.groupTitle || "گروه ضبط",
    steps: []
  }];

  await chrome.storage.local.set({
    recording: true,
    recordPhase: "recording",
    draft: [],
    recordingGroups,
    recordTabId: null,
    lastNavUrl: null,
    recordTargetTaskId: targetTaskId,
    recordTargetTitle: targetTitle,
    recordOptions: defaultRecordOptions(prevOpts)
  });

  const requestedTabId = message.tabId != null && message.tabId !== ""
    ? Number(message.tabId)
    : null;
  let tab = null;
  let reused = false;

  if (requestedTabId && Number.isFinite(requestedTabId)) {
    try {
      tab = await chrome.tabs.get(requestedTabId);
      await chrome.tabs.update(requestedTabId, { active: true });
      if (tab.windowId != null) {
        await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
      }
      reused = true;
    } catch {
      await chrome.storage.local.set({ recording: false, recordPhase: "idle", recordingGroups: [], draft: [] });
      return { ok: false, error: "تب انتخاب‌شده پیدا نشد یا بسته شده است." };
    }
  } else {
    // Extension blank page — FAB loads immediately (about:blank cannot run content scripts).
    tab = await chrome.tabs.create({ url: chrome.runtime.getURL("blank.html"), active: true });
  }

  if (tab?.id) {
    await chrome.storage.local.set({ recordTabId: tab.id });
    const url = tab.url || tab.pendingUrl || "";
    if (reused && isTrackableNavUrl(url)) {
      await appendNavStep(url, tab.id);
    }
    // blank.html embeds FAB; inject again as safety for reused http(s) tabs.
    await injectRecordFab(tab.id).catch(() => false);
  }
  await broadcastRecordState();
  return {
    ok: true,
    tabId: tab?.id,
    startUrl: tab?.url || chrome.runtime.getURL("blank.html"),
    reused,
    groupCount: recordingGroups.length,
    targetTaskId,
    targetTitle
  };
}

/** Inject recorder HUD (+ capture scripts) into a tab — works on about:blank / http(s). */
async function injectRecordFab(tabId, attempt = 0) {
  if (!tabId) return false;
  try {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    const url = tab?.url || "";
    // blank.html already loads scripts via <script> tags.
    if (url.startsWith("chrome-extension://") && url.includes("/blank.html")) {
      await broadcastRecordState();
      return true;
    }
    // Mark page as recording BEFORE scripts so Player content-script skips its HUD.
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => { document.documentElement.dataset.daMorobotMode = "record"; }
    }).catch(() => {});
    await chrome.scripting.insertCSS({
      target: { tabId },
      files: ["styles/fab.css"]
    }).catch(() => {});
    await chrome.scripting.executeScript({
      target: { tabId },
      files: [
        "lib/ext-i18n.js",
        "content/selector.js",
        "content/frames.js",
        "content/recorder.js",
        "content/fab-record.js"
      ]
    });
    await broadcastRecordState();
    return true;
  } catch (err) {
    if (attempt < 8) {
      await new Promise((r) => setTimeout(r, 100 + attempt * 50));
      return injectRecordFab(tabId, attempt + 1);
    }
    console.warn("[recorder] injectRecordFab failed", tabId, err?.message || err);
    return false;
  }
}

function flattenGroupSteps(groups) {
  return (groups || []).flatMap((g) => g.steps || []);
}

function countRecordedSteps(groups, draft) {
  const fromGroups = flattenGroupSteps(groups).length;
  if (fromGroups) return fromGroups;
  return Array.isArray(draft) ? draft.length : 0;
}

async function finishRecord() {
  const { recording, draft, recordingGroups } = await chrome.storage.local.get([
    "recording", "draft", "recordingGroups"
  ]);
  if (!recording && (await getState()).recordPhase !== "recording") {
    return { ok: false, error: "ضبطی در جریان نیست." };
  }
  await chrome.storage.local.set({
    recording: false,
    recordPhase: "review"
  });
  const state = await broadcastRecordState();
  setTimeout(() => pollDevReload(), 400);
  return { ok: true, count: countRecordedSteps(recordingGroups, draft), ...state };
}

async function discardRecord(opts = {}) {
  const closeTab = opts.closeTab !== false;
  const { recordTabId } = await chrome.storage.local.get(["recordTabId"]);
  await chrome.storage.local.set({
    recording: false,
    recordPhase: "idle",
    draft: [],
    recordingGroups: [],
    recordTabId: null,
    lastNavUrl: null,
    recordTargetTaskId: null,
    recordTargetTitle: null
  });
  if (closeTab && recordTabId) {
    try { await chrome.tabs.remove(recordTabId); } catch { /* already closed */ }
  }
  const state = await broadcastRecordState();
  setTimeout(() => pollDevReload(), 400);
  return state;
}

/** Discard current batch and continue recording on the same process/tab. */
async function resumeRecord() {
  const data = await chrome.storage.local.get([
    "recordTargetTaskId", "recordTargetTitle", "recordTabId", "recordOptions"
  ]);
  if (data.recordTargetTaskId == null && !data.recordTabId) {
    return discardRecord();
  }
  const recordingGroups = [{
    id: "group-1",
    title: "گروه ضبط",
    steps: []
  }];
  await chrome.storage.local.set({
    recording: true,
    recordPhase: "recording",
    draft: [],
    recordingGroups,
    lastNavUrl: null,
    recordOptions: defaultRecordOptions(data.recordOptions)
  });
  return broadcastRecordState();
}

async function getState() {
  const data = await chrome.storage.local.get([
    "recording", "draft", "recordingGroups", "token", "playing", "recordPhase",
    "recordTabId", "localUser", "recordOptions", "recordTargetTaskId", "recordTargetTitle"
  ]);
  const steps = currentStepsFromStorage(data.recordingGroups, data.draft);
  const count = steps.length;
  const phase = data.recording
    ? "recording"
    : (data.recordPhase || (count ? "review" : "idle"));
  return {
    ok: true,
    recording: !!data.recording,
    recordPhase: phase,
    playing: false,
    count,
    steps,
    options: defaultRecordOptions(data.recordOptions),
    groupCount: Array.isArray(data.recordingGroups) ? data.recordingGroups.length : 0,
    signedIn: true,
    localUser: data.localUser || "test",
    recordTabId: data.recordTabId || null,
    targetTaskId: data.recordTargetTaskId ?? null,
    targetTitle: data.recordTargetTitle || null,
    play: { playing: false }
  };
}

async function listTasks() {
  const tasks = await loadUserTasks();
  return { ok: true, tasks };
}

async function toggleRecord(tabId) {
  const state = await getState();
  if (state.recording) return finishRecord();
  return startRecordSession({});
}

async function checkSession() {
  const portal = await portalBase();
  let user = "test";
  try {
    const cookie = await chrome.cookies.get({ url: portal, name: "da_local_user" });
    if (cookie?.value) user = decodeURIComponent(cookie.value).trim() || "test";
  } catch {
    /* ignore */
  }
  if (user === "test") {
    const { localUser } = await chrome.storage.local.get("localUser");
    if (localUser) user = localUser;
  }
  await chrome.storage.local.set({
    token: "local-test",
    localUser: user,
    portalBase: portal,
    apiBase: portal
  });
  // Local-first: always signed in (no portal JWT required for record/play).
  return { signedIn: true, userName: user, local: true, version: chrome.runtime.getManifest().version };
}

async function syncPortalSession() {
  return checkSession();
}

/** Persian verb for recorded action types (short form for titles). */
function recordedActionVerbFa(actionType) {
  const t = String(actionType || "Click");
  switch (t) {
    case "Click": return "کلیک";
    case "DoubleClick": return "دبل‌کلیک";
    case "RightClick": return "کلیک‌راست";
    case "Hover": return "هاور";
    case "InputContent":
    case "InsertContent":
    case "LoadContent": return "متن";
    case "TakeContent":
    case "SaveContent": return "خواندن";
    case "GoToUrl":
    case "Navigate": return "رفتن به";
    case "NewPage": return "تب جدید";
    case "Refresh": return "رفرش";
    case "WaitTime": return "انتظار";
    case "WaitForLoading": return "انتظار لود";
    default: return t;
  }
}

function cleanRecordedLabel(s, maxLen) {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  const max = maxLen == null ? 40 : maxLen;
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/**
 * e.g. Click + "ورود" → "کلیک ورود"
 *      InputContent + "نام کاربری" → "متن نام کاربری"
 *      GoToUrl → "رفتن به example.com"
 */
function buildRecordedActionTitle(step, index) {
  if (!step) return `اقدام ${Number(index) + 1 || 1}`;
  if (step.title && String(step.title).trim()) return String(step.title).trim();

  const at = step.actionType || "Click";
  const verb = recordedActionVerbFa(at);
  const label = cleanRecordedLabel(step.elementLabel || "");

  if (String(at).toLowerCase() === "gotourl" || at === "Navigate") {
    let host = "";
    try {
      host = new URL(String(step.url || step.value || "")).hostname || "";
    } catch { /* ignore */ }
    const short = host || cleanRecordedLabel(step.url || step.value || "", 36);
    return short ? `${verb} ${short}` : verb;
  }

  if (label) return `${verb} ${label}`;
  const n = (Number(index) >= 0 ? Number(index) : 0) + 1;
  return `${verb} ${n}`;
}

async function onRecordedEvent(payload, sender) {
  const { recording, playing, recordingGroups } = await chrome.storage.local.get([
    "recording", "playing", "recordingGroups"
  ]);
  if (!recording || playing) return { ok: true, ignored: true };

  // V2: ensure at least one group exists (Start creates empty Group).
  let groups = Array.isArray(recordingGroups) ? recordingGroups.slice() : [];
  if (!groups.length) {
    groups.push({ id: "group-1", title: "گروه ضبط", steps: [] });
  }

  const tabId = sender.tab?.id;
  const frameId = sender.frameId ?? 0;
  const framePath = tabId != null ? await buildFramePath(tabId, frameId) : [];

  const item = {
    actionType: payload.actionType,
    value: payload.value || null,
    url: payload.url,
    elementBy: "CssSelector",
    elementValue: payload.elementValue,
    elementLabel: String(payload.elementLabel || "").trim() || null,
    title: null,
    framePath,
    recordedAt: new Date().toISOString()
  };
  item.title = buildRecordedActionTitle(item);

  const last = groups[groups.length - 1];
  last.steps = (last.steps || []).concat(item);
  const draft = flattenGroupSteps(groups);
  await chrome.storage.local.set({ recordingGroups: groups, draft });
  await broadcastDraftUpdated();
  return { ok: true, count: draft.length, groupCount: groups.length };
}

async function buildFramePath(tabId, leafFrameId) {
  if (!leafFrameId) return [];
  const frames = await chrome.webNavigation.getAllFrames({ tabId });
  if (!frames) return [];

  const byId = new Map(frames.map((f) => [f.frameId, f]));
  const chain = [];
  let current = byId.get(leafFrameId);
  while (current && current.parentFrameId >= 0) {
    chain.unshift(current);
    current = byId.get(current.parentFrameId);
  }

  const path = [];
  for (const child of chain) {
    const parentId = child.parentFrameId;
    const siblings = frames.filter((f) => f.parentFrameId === parentId);
    const indexInParent = siblings.findIndex((f) => f.frameId === child.frameId);
    try {
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId, frameIds: [parentId] },
        func: describeIframe,
        args: [child.url, indexInParent]
      });
      if (result) path.push(result);
      else {
        path.push({
          by: "CssSelector",
          value: `iframe:nth-of-type(${indexInParent + 1}), frame:nth-of-type(${indexInParent + 1})`,
          srcHint: child.url,
          indexInParent
        });
      }
    } catch {
      path.push({
        by: "CssSelector",
        value: `iframe:nth-of-type(${indexInParent + 1})`,
        srcHint: child.url,
        indexInParent
      });
    }
  }
  return path;
}

function describeIframe(childUrl, indexInParent) {
  const nodes = Array.from(document.querySelectorAll("iframe, frame"));
  let el = nodes.find((n) => {
    try {
      return n.src && childUrl && (childUrl.startsWith(n.src) || n.src === childUrl || childUrl.includes(n.getAttribute("src") || "___"));
    } catch {
      return false;
    }
  });
  if (!el && indexInParent >= 0 && indexInParent < nodes.length) el = nodes[indexInParent];
  if (!el) return null;

  const esc = (s) => {
    try { return CSS.escape(String(s)); } catch {
      return String(s).replace(/([^\w-])/g, "\\$1");
    }
  };
  const count = (sel) => {
    try { return document.querySelectorAll(sel).length; } catch { return 0; }
  };

  function uniqueCss(element) {
    if (element.id) {
      const sel = `#${esc(element.id)}`;
      if (count(sel) === 1) return sel;
    }
    const tag = element.tagName.toLowerCase();
    const frameName = element.getAttribute("name");
    if (frameName) {
      const sel = `${tag}[name="${esc(frameName)}"]`;
      if (count(sel) === 1) return sel;
    }
    const parts = [];
    let node = element;
    let guard = 0;
    while (node && node.nodeType === 1 && guard++ < 64) {
      if (node.id && count(`#${esc(node.id)}`) === 1) {
        parts.unshift(`#${esc(node.id)}`);
        break;
      }
      const t = node.tagName.toLowerCase();
      if (t === "body" || t === "html") {
        parts.unshift(t);
        break;
      }
      const parent = node.parentElement;
      if (!parent) {
        parts.unshift(t);
        break;
      }
      const same = Array.from(parent.children).filter((c) => c.tagName === node.tagName);
      parts.unshift(`${t}:nth-of-type(${same.indexOf(node) + 1})`);
      node = parent;
    }
    return parts.join(" > ");
  }

  const css = uniqueCss(el);
  return {
    by: "CssSelector",
    value: css,
    srcHint: el.getAttribute("src") || childUrl,
    indexInParent,
    unique: true
  };
}

async function saveDraft(payload) {
  const {
    draft,
    recordingGroups,
    recordTargetTaskId,
    recordTargetTitle,
    recordTabId,
    recordOptions
  } = await chrome.storage.local.get([
    "draft", "recordingGroups", "recordTargetTaskId", "recordTargetTitle", "recordTabId", "recordOptions"
  ]);

  let allSteps = currentStepsFromStorage(recordingGroups, draft);
  const indexes = Array.isArray(payload?.selectedIndexes) ? payload.selectedIndexes : null;
  if (indexes != null) {
    if (!indexes.length) {
      return { ok: false, error: "هیچ موردی برای ذخیره انتخاب نشده است." };
    }
    const pick = new Set(indexes.map(Number).filter((n) => Number.isFinite(n)));
    allSteps = allSteps.filter((_, i) => pick.has(i));
  }
  if (!allSteps.length) {
    return { ok: false, error: "هیچ موردی برای ذخیره انتخاب نشده است." };
  }

  const groupTitle = (payload?.groupTitle || "").trim();
  if (!groupTitle) {
    return { ok: false, error: "نام گروه ضبط لازم است." };
  }

  // Refresh from portal, then require the EXISTING process — never create a new one.
  let pulled = await pullTasksFromPortalTabs().catch(() => null);
  let tasks = (pulled && pulled.length) ? pulled : await loadUserTasks();

  const targetId = normalizeTaskId(payload?.taskId) || normalizeTaskId(recordTargetTaskId);

  if (!targetId) {
    return {
      ok: false,
      error: "فرآیند هدف مشخص نیست. ضبط را از دکمهٔ ضبط همان فرآیند در پورتال شروع کنید."
    };
  }

  let existingIdx = findTaskIndex(tasks, targetId);
  // One more pull if target missing (portal tab may have finished decrypting late).
  if (existingIdx < 0) {
    await new Promise((r) => setTimeout(r, 250));
    pulled = await pullTasksFromPortalTabs().catch(() => null);
    if (pulled && pulled.length) {
      tasks = pulled;
      existingIdx = findTaskIndex(tasks, targetId);
    }
  }
  if (existingIdx < 0) {
    return {
      ok: false,
      error: "فرآیند هدف در پورتال پیدا نشد. تب پورتال را باز نگه دارید، لیست فرآیندها را رفرش کنید و دوباره ذخیره کنید."
    };
  }

  const existing = tasks[existingIdx];
  if (!existing.graph || typeof existing.graph !== "object") {
    return {
      ok: false,
      error: "گراف فرآیند هدف خالی/نامعتبر است. ابتدا فرآیند را در ویرایشگر باز کنید."
    };
  }

  const existingGroups = (existing.graph?.nodes || []).filter((n) => n.kind === "group");
  const nextGroupOrdinal = existingGroups.length + 1;
  const groups = [{ id: `group-${nextGroupOrdinal}`, title: groupTitle, steps: allSteps }];

  const id = existing.id;
  const title = existing.title || recordTargetTitle || `فرآیند #${id}`;
  const graph = mergeRecordingGroupsIntoGraph(existing.graph, groups, id, title);
  const nodes = graph.nodes || [];
  const stepCount = nodes.filter((n) => n.kind === "action" || n.kind === "step").length;
  const groupCount = nodes.filter((n) => n.kind === "group").length;

  tasks[existingIdx] = {
    ...existing,
    title,
    designOrigin: existing.designOrigin || "Recorded",
    groupCount,
    stepCount,
    dataSourceCount: Array.isArray(graph.dataSources) ? graph.dataSources.length : 0,
    graph
  };

  const beforeSteps = (existing.graph?.nodes || []).filter((n) => n.kind === "action" || n.kind === "step").length;
  if (stepCount < beforeSteps + allSteps.length) {
    console.warn("[recorder] merge produced fewer steps than expected", { beforeSteps, stepCount, added: allSteps.length });
  }
  if (stepCount <= beforeSteps) {
    return {
      ok: false,
      error: "گروه جدید به فرآیند اضافه نشد. تب پورتال را رفرش کنید و دوباره ذخیره کنید."
    };
  }

  await saveUserTasks(tasks);
  const pushed = await pushTasksToPortalTabs(tasks);
  if (!pushed) {
    return {
      ok: false,
      error: "ذخیره در افزونه انجام شد ولی پورتال به‌روز نشد — تب پورتال را باز نگه دارید و دوباره ذخیره کنید."
    };
  }

  const continueRecording = payload?.continueRecording !== false;
  if (continueRecording) {
    await chrome.storage.local.set({
      recording: true,
      recordPhase: "recording",
      draft: [],
      recordingGroups: [{ id: "group-1", title: "گروه ضبط", steps: [] }],
      lastNavUrl: null,
      recordTabId: recordTabId || null,
      recordTargetTaskId: id,
      recordTargetTitle: title,
      recordOptions: defaultRecordOptions(recordOptions)
    });
  } else {
    await chrome.storage.local.set({
      recording: false,
      recordPhase: "idle",
      draft: [],
      recordingGroups: [],
      recordTabId: null,
      lastNavUrl: null,
      recordTargetTaskId: null,
      recordTargetTitle: null
    });
    setTimeout(() => pollDevReload(), 400);
  }

  await broadcastRecordState();
  await broadcastDraftUpdated();
  return {
    ok: true,
    result: {
      taskId: id,
      groupId: nextGroupOrdinal,
      groupTitle,
      stepCount,
      groupCount,
      merged: true,
      continued: continueRecording,
      pushed: true
    }
  };
}

/** Append newly recorded groups/steps onto an existing task graph. */
function mergeRecordingGroupsIntoGraph(existingGraph, groups, taskId, title) {
  const base = existingGraph && typeof existingGraph === "object"
    ? existingGraph
    : { nodes: [], edges: [], dataSources: [], viewport: { x: 40, y: 40, zoom: 1 } };
  const nodes = Array.isArray(base.nodes) ? base.nodes.slice() : [];
  const edges = Array.isArray(base.edges) ? base.edges.slice() : [];
  if (!nodes.some((n) => n.id === "start" || n.kind === "start")) {
    nodes.unshift({ id: "start", kind: "start", title: "شروع", x: 40, y: 220 });
  }

  const stamp = Date.now();
  let maxEntity = 0;
  for (const n of nodes) {
    if (n.entityId != null && Number(n.entityId) > maxEntity) maxEntity = Number(n.entityId);
  }

  // Tip of the root "next" chain (start → …)
  let tip = nodes.find((n) => n.kind === "start")?.id || "start";
  const seen = new Set();
  while (tip && !seen.has(tip)) {
    seen.add(tip);
    const next = edges.find((e) => e.from === tip && e.kind === "next");
    if (!next) break;
    tip = next.to;
  }

  const list = Array.isArray(groups) && groups.length
    ? groups
    : [{ id: "group-1", title: "گروه ضبط", steps: [] }];

  list.forEach((g, gi) => {
    maxEntity += 1;
    const gid = `group-rec-${stamp}-${gi + 1}`;
    nodes.push({
      id: gid,
      kind: "group",
      entityId: maxEntity,
      title: g.title || `گروه ضبط ${gi + 1}`,
      x: 280 + gi * 280,
      y: 80 + (nodes.filter((n) => n.kind === "group").length * 20),
      repeatSourceType: "None",
      moveLoop: true
    });
    edges.push({ id: `e-rec-${stamp}-g-${gi}`, from: tip, to: gid, kind: "next" });
    tip = gid;

    let prevStep = null;
    (g.steps || []).forEach((a, i) => {
      maxEntity += 1;
      const sid = `${gid}-step-${i + 1}`;
      const isNav = String(a.actionType || "").toLowerCase() === "gotourl";
      nodes.push({
        id: sid,
        kind: "action",
        entityId: maxEntity,
        title: buildRecordedActionTitle(a, i),
        groupNodeId: gid,
        actionType: a.actionType || "Click",
        selectorValue: a.elementValue || "",
        constantValue: isNav ? "" : (a.value || ""),
        navigateUrl: isNav ? (a.url || a.value || "") : null,
        framePathJson: JSON.stringify(a.framePath || []),
        ignoreError: true,
        isActive: true,
        x: 40,
        y: i * 90
      });
      if (prevStep) edges.push({ id: `e-rec-${stamp}-${gi}-${i}`, from: prevStep, to: sid, kind: "next" });
      else edges.push({ id: `e-rec-c-${stamp}-${gi}-${i}`, from: gid, to: sid, kind: "contains" });
      prevStep = sid;
    });
  });

  return {
    ...base,
    taskId,
    title,
    canModify: true,
    designOrigin: base.designOrigin || "Recorded",
    viewport: base.viewport || { x: 40, y: 40, zoom: 1 },
    nodes,
    edges,
    dataSources: Array.isArray(base.dataSources) ? base.dataSources : []
  };
}

async function currentLocalUser() {
  const { localUser } = await chrome.storage.local.get("localUser");
  return localUser || "test";
}

async function loadUserTasks() {
  const user = await currentLocalUser();
  const key = `localTasks__${user}`;
  const data = await chrome.storage.local.get([key, "localTasks"]);
  if (Array.isArray(data[key])) return data[key];
  // One-time migrate shared legacy bucket into THIS user only, then delete shared key
  // so other users do not inherit the same tasks.
  if (Array.isArray(data.localTasks) && data.localTasks.length) {
    await chrome.storage.local.set({ [key]: data.localTasks });
    await chrome.storage.local.remove("localTasks");
    return data.localTasks;
  }
  return [];
}

async function saveUserTasks(tasks) {
  const user = await currentLocalUser();
  const key = `localTasks__${user}`;
  // Never write a shared localTasks key — that leaked tasks across users.
  await chrome.storage.local.set({ [key]: tasks });
  await chrome.storage.local.remove("localTasks");
}

async function getLocalTaskGraph(taskId) {
  const tasks = await loadUserTasks();
  const task = tasks.find((t) => String(t.id) === String(taskId));
  if (!task?.graph) return { ok: false, error: "فرآیند محلی پیدا نشد." };
  return { ok: true, graph: task.graph };
}

async function pushTasksToPortalTabs(tasks) {
  const user = await currentLocalUser();
  const tabs = await chrome.tabs.query({});
  let ok = false;
  for (const tab of tabs) {
    if (!tab.id) continue;
    const url = tab.url || "";
    if (!(await isPortalTabUrl(url))) continue;
    try {
      const res = await chrome.tabs.sendMessage(tab.id, { type: "localTasksUpdated", user, tasks });
      if (res?.ok) ok = true;
    } catch {
      /* portal tab without bridge */
    }
    // MAIN-world write — content-script isolated world cannot touch page DaSecureStore.
    try {
      const [{ result } = {}] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: "MAIN",
        func: (u, list) => {
          try {
            if (window.DaSecureStore && typeof DaSecureStore.writeTasks === "function") {
              DaSecureStore.writeTasks(list, u);
              return true;
            }
            window.postMessage({ source: "da-ext-bridge", type: "write-tasks", user: u, tasks: list }, "*");
            return true;
          } catch {
            return false;
          }
        },
        args: [user, tasks]
      });
      if (result) ok = true;
    } catch {
      /* scripting may fail on restricted pages */
    }
  }
  return ok;
}

/** V2 FormRecord: one graph Group per record Group; Steps only inside their Group. No spare empty group. */
function buildGraphFromRecordingGroups(taskId, title, groups) {
  const list = Array.isArray(groups) && groups.length
    ? groups
    : [{ id: "group-1", title: "گروه خالی", steps: [] }];

  const nodes = [{ id: "start", kind: "start", title: "شروع", x: 40, y: 220 }];
  const edges = [];
  let prevNode = "start";
  let stepEntity = 0;

  list.forEach((g, gi) => {
    const gid = g.id || `group-${gi + 1}`;
    nodes.push({
      id: gid,
      kind: "group",
      entityId: gi + 1,
      title: g.title || `گروه ${gi + 1}`,
      x: 280 + gi * 280,
      y: 80,
      repeatSourceType: "None",
      moveLoop: true
    });
    edges.push({ id: `e-g-${gi}`, from: prevNode, to: gid, kind: "next" });
    prevNode = gid;

    let prevStep = null;
    (g.steps || []).forEach((a, i) => {
      stepEntity += 1;
      const sid = `${gid}-step-${i + 1}`;
      const isNav = String(a.actionType || "").toLowerCase() === "gotourl";
      nodes.push({
        id: sid,
        kind: "action",
        entityId: stepEntity,
        title: buildRecordedActionTitle(a, i),
        groupNodeId: gid,
        actionType: a.actionType || "Click",
        selectorValue: a.elementValue || "",
        constantValue: isNav ? "" : (a.value || ""),
        navigateUrl: isNav ? (a.url || a.value || "") : null,
        framePathJson: JSON.stringify(a.framePath || []),
        ignoreError: true,
        isActive: true,
        x: 40,
        y: i * 90
      });
      if (prevStep) edges.push({ id: `e-${gid}-${i}`, from: prevStep, to: sid, kind: "next" });
      else edges.push({ id: `e-c-${gid}-${i}`, from: gid, to: sid, kind: "contains" });
      prevStep = sid;
    });
  });

  return {
    taskId,
    title,
    canModify: true,
    designOrigin: "Recorded",
    viewport: { x: 40, y: 40, zoom: 1 },
    nodes,
    edges,
    dataSources: []
  };
}

function buildGraphFromDraft(taskId, title, actions, groupTitle) {
  return buildGraphFromRecordingGroups(taskId, title, [
    { id: "group-1", title: groupTitle || "ضبط‌شده", steps: actions || [] }
  ]);
}

function isTrackableNavUrl(url) {
  if (!url) return false;
  if (url === "about:blank" || url.startsWith("about:")) return false;
  if (url.startsWith("chrome://") || url.startsWith("chrome-extension://")) return false;
  if (url.startsWith("edge://") || url.startsWith("devtools://")) return false;
  return /^https?:\/\//i.test(url);
}

async function appendNavStep(url, tabId) {
  const { recording, lastNavUrl, playing, recordingGroups } = await chrome.storage.local.get([
    "recording", "lastNavUrl", "playing", "recordingGroups"
  ]);
  if (!recording || playing) return;
  if (!isTrackableNavUrl(url)) return;
  if (lastNavUrl === url) return;

  let groups = Array.isArray(recordingGroups) ? recordingGroups.slice() : [];
  if (!groups.length) {
    groups.push({ id: "group-1", title: "گروه ضبط", steps: [] });
  }

  const item = {
    actionType: "GoToUrl",
    value: url,
    url,
    elementBy: "CssSelector",
    elementValue: "",
    elementLabel: null,
    framePath: [],
    recordedAt: new Date().toISOString()
  };
  item.title = buildRecordedActionTitle(item);
  const last = groups[groups.length - 1];
  last.steps = (last.steps || []).concat(item);
  await chrome.storage.local.set({
    recordingGroups: groups,
    draft: flattenGroupSteps(groups),
    lastNavUrl: url
  });
  await broadcastDraftUpdated();
}

chrome.webNavigation.onCommitted.addListener(async (details) => {
  if (details.frameId !== 0) return;
  if (details.transitionType === "auto_subframe") return;
  const { recording, recordTabId } = await chrome.storage.local.get(["recording", "recordTabId"]);
  if (!recording || !recordTabId || details.tabId !== recordTabId) return;
  await appendNavStep(details.url, details.tabId);
});

/** Re-mount play HUD after refresh/navigation (storage-aware; retries for blank tabs). */
async function reinjectPlayHudForTab(tabId, reason) {
  if (!tabId) return;
  try {
    let playing = !!(typeof playStatus !== "undefined" && playStatus?.playing);
    let activePlayTab = (typeof playTabId !== "undefined" && playTabId) || null;
    if (!playing || !activePlayTab) {
      const st = await chrome.storage.local.get(["playing", "playTabId"]);
      if (st.playing && st.playTabId) {
        if (!playing) {
          await chrome.storage.local.set({ playing: false, playTabId: null, playPaused: false });
          if (typeof playStatus !== "undefined") {
            playStatus.playing = false;
            playStatus.paused = false;
            playStatus.lastError = "اجرا قطع شد (ریستارت افزونه). دوباره اجرا کنید.";
          }
          if (typeof broadcastPlayState === "function") broadcastPlayState();
          return;
        }
        activePlayTab = Number(st.playTabId) || activePlayTab;
      }
    }
    if (!playing || !activePlayTab || Number(tabId) !== Number(activePlayTab)) return;
    if (typeof injectPlayFab !== "function") return;
    for (let i = 0; i < 4; i++) {
      const ok = await injectPlayFab(tabId);
      if (ok) {
        if (typeof notifyTab === "function" && typeof getPlayStatus === "function") {
          notifyTab(tabId, { type: "playStateChanged", ...getPlayStatus() });
        }
        return;
      }
      await new Promise((r) => setTimeout(r, 150 + i * 120));
    }
  } catch (err) {
    console.warn("[Morobot Global] reinjectPlayHudForTab", reason, err?.message || err);
  }
}

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (changeInfo.url || changeInfo.title || changeInfo.status === "complete" || changeInfo.status === "loading") {
    scheduleOpenTabsBroadcast(changeInfo.url ? "url" : "update");
  }
  if (changeInfo.status === "complete") {
    reinjectPlayHudForTab(tabId, "tabs.onUpdated").catch(() => {});
  }
  const { recording, recordTabId } = await chrome.storage.local.get(["recording", "recordTabId"]);
  if (!recording || !recordTabId || tabId !== recordTabId) return;
  if (changeInfo.status === "complete") {
    injectRecordFab(tabId).catch(() => {});
  }
  if (changeInfo.url) {
    await appendNavStep(changeInfo.url, tabId);
  }
});

chrome.webNavigation.onCompleted.addListener((details) => {
  if (details.frameId !== 0) return;
  reinjectPlayHudForTab(details.tabId, "webNavigation.onCompleted").catch(() => {});
});

chrome.tabs.onCreated.addListener(() => scheduleOpenTabsBroadcast("created"));
chrome.tabs.onRemoved.addListener(() => scheduleOpenTabsBroadcast("removed"));
chrome.tabs.onActivated.addListener(() => scheduleOpenTabsBroadcast("activated"));
chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId !== chrome.windows.WINDOW_ID_NONE) scheduleOpenTabsBroadcast("focus");
});

/** Dev/local auto-reload: only when portal (app) is open and not recording/playing.
 *  Refreshing a recorded external page must NOT reload the extension. */
const DEV_POLL_MS = 2500;
const DEV_STAMP_URLS = [
  "https://localhost:7201/extension/dev-stamp/recorder",
  "http://localhost:5201/extension/dev-stamp/recorder",
  "http://localhost:5000/extension/dev-stamp/recorder"
];

function isPortalAppUrl(url) {
  if (!url || typeof url !== "string") return false;
  try {
    const u = new URL(url);
    const host = (u.hostname || "").toLowerCase();
    if (host !== "localhost" && host !== "127.0.0.1") return false;
    // Extension sync endpoints alone don't count as "using the app"
    if (u.pathname.startsWith("/extension/")) return false;
    return true;
  } catch {
    return false;
  }
}

async function hasOpenPortalAppTab() {
  try {
    const portal = await portalBase().catch(() => DEFAULT_PORTAL);
    let origin;
    try { origin = new URL(portal).origin; } catch { origin = null; }
    const tabs = await chrome.tabs.query({});
    return tabs.some((t) => {
      const url = t.url || "";
      if (origin && url.startsWith(origin) && isPortalAppUrl(url)) return true;
      return isPortalAppUrl(url);
    });
  } catch {
    return false;
  }
}

async function pollDevReload() {
  const { recording, playing, pendingDevReload, pendingDevStamp } =
    await chrome.storage.local.get(["recording", "playing", "pendingDevReload", "pendingDevStamp"]);

  // Never tear down the service worker mid-record / mid-play (page refresh on target site is fine).
  if (recording || playing) {
    // Still detect updates and queue them for after finish.
    await detectDevStampChange({ queueOnly: true });
    return;
  }

  // Outside recording: only apply reload when user has the app open — not while browsing/recording targets.
  const appOpen = await hasOpenPortalAppTab();
  if (!appOpen) {
    if (pendingDevReload && pendingDevStamp) {
      // Keep stamp queued; apply next time app is open.
      return;
    }
    await detectDevStampChange({ queueOnly: true });
    return;
  }

  if (pendingDevReload && pendingDevStamp) {
    await chrome.storage.local.set({
      devStamp: pendingDevStamp,
      pendingDevReload: false,
      pendingDevStamp: null
    });
    console.info("[DA] applying deferred extension reload (app open, idle)");
    chrome.runtime.reload();
    return;
  }

  await detectDevStampChange({ queueOnly: false });
}

async function detectDevStampChange({ queueOnly }) {
  const portal = await portalBase().catch(() => DEFAULT_PORTAL);
  const urls = [`${portal}/extension/dev-stamp`, ...DEV_STAMP_URLS];
  const seen = new Set();
  for (const url of urls) {
    if (seen.has(url)) continue;
    seen.add(url);
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) continue;
      const data = await res.json();
      if (!data?.stamp) continue;
      const { devStamp } = await chrome.storage.local.get("devStamp");
      const origin = new URL(url).origin;
      if (devStamp && devStamp !== data.stamp) {
        if (queueOnly) {
          await chrome.storage.local.set({
            pendingDevReload: true,
            pendingDevStamp: data.stamp,
            portalBase: origin,
            installPath: data.path || null
          });
          console.info("[DA] extension update queued (recording/play or no app tab)", data.version || "");
          return;
        }
        await chrome.storage.local.set({
          devStamp: data.stamp,
          pendingDevReload: false,
          pendingDevStamp: null,
          portalBase: origin,
          installPath: data.path || null
        });
        console.info("[DA] extension updated → reload", data.version || "", data.path || "");
        chrome.runtime.reload();
        return;
      }
      await chrome.storage.local.set({
        devStamp: data.stamp,
        portalBase: origin,
        installPath: data.path || null
      });
      return;
    } catch {
      /* portal not up yet */
    }
  }
}

pollDevReload();
setInterval(pollDevReload, DEV_POLL_MS);

// Context-menu selector copy lives in extension-selector (dedicated package).

