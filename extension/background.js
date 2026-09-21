importScripts("player/engine.js");

/** Single-app mode: portal hosts UI + /api/* — no separate API process. */
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
    case "getTaskGraph":
      return getLocalTaskGraph(message.taskId);
    case "startPlay":
      return startPlay(message.taskId, sender.tab?.id ?? message.tabId, message.runMode, {
        groupNodeId: message.groupNodeId || null,
        stepNodeId: message.stepNodeId || null
      });
    case "stopPlay":
      return stopPlay();
    case "getPlayState":
      return getPlayStatus();
    case "startRecordSession":
      return startRecordSession(message);
    case "finishRecord":
      return finishRecord();
    case "discardRecord":
      return discardRecord();
    case "rerecord":
      return startRecordSession({ ...message, rerecord: true });
    default:
      return { ok: false, error: "unknown" };
  }
}

async function broadcastRecordState() {
  const state = await getState();
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (!tab.id) continue;
    chrome.tabs.sendMessage(tab.id, {
      type: "recordingChanged",
      recording: state.recording,
      recordPhase: state.recordPhase,
      count: state.count
    }).catch(() => {});
  }
  return state;
}

async function startRecordSession(message = {}) {
  // Local-first: no server login required.
  await checkSession();
  const { playing } = await chrome.storage.local.get("playing");
  if (playing) return { ok: false, error: "هنگام پخش نمی‌توان ضبط کرد." };

  // Always start on a blank tab — the user's address-bar navigation becomes a GoToUrl step.
  await chrome.storage.local.set({
    recording: true,
    recordPhase: "recording",
    draft: [],
    recordTabId: null,
    lastNavUrl: null
  });

  const tab = await chrome.tabs.create({ url: "about:blank", active: true });
  if (tab?.id) {
    await chrome.storage.local.set({ recordTabId: tab.id });
  }
  await broadcastRecordState();
  return { ok: true, tabId: tab?.id, startUrl: "about:blank" };
}

async function finishRecord() {
  const { recording, draft } = await chrome.storage.local.get(["recording", "draft"]);
  if (!recording && (await getState()).recordPhase !== "recording") {
    return { ok: false, error: "ضبطی در جریان نیست." };
  }
  await chrome.storage.local.set({
    recording: false,
    recordPhase: "review"
  });
  const state = await broadcastRecordState();
  return { ok: true, count: (draft || []).length, ...state };
}

async function discardRecord() {
  await chrome.storage.local.set({
    recording: false,
    recordPhase: "idle",
    draft: [],
    recordTabId: null,
    lastNavUrl: null
  });
  return broadcastRecordState();
}

async function getState() {
  const data = await chrome.storage.local.get([
    "recording", "draft", "token", "playing", "recordPhase", "recordTabId", "localUser"
  ]);
  const play = getPlayStatus();
  const phase = data.recording
    ? "recording"
    : (data.recordPhase || ((data.draft || []).length ? "review" : "idle"));
  return {
    ok: true,
    recording: !!data.recording,
    recordPhase: phase,
    playing: !!data.playing || !!play.playing,
    count: (data.draft || []).length,
    signedIn: true,
    localUser: data.localUser || "test",
    recordTabId: data.recordTabId || null,
    play
  };
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

async function onRecordedEvent(payload, sender) {
  const { recording, draft, playing } = await chrome.storage.local.get(["recording", "draft", "playing"]);
  if (!recording || playing) return { ok: true, ignored: true };

  const tabId = sender.tab?.id;
  const frameId = sender.frameId ?? 0;
  const framePath = tabId != null ? await buildFramePath(tabId, frameId) : [];

  const item = {
    actionType: payload.actionType,
    value: payload.value || null,
    url: payload.url,
    elementBy: "CssSelector",
    elementValue: payload.elementValue,
    framePath,
    recordedAt: new Date().toISOString()
  };

  const next = Array.isArray(draft) ? draft.concat(item) : [item];
  await chrome.storage.local.set({ draft: next });
  return { ok: true, count: next.length };
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

  const css = uniqueCss(el);
  return {
    by: "CssSelector",
    value: css,
    srcHint: el.getAttribute("src") || childUrl,
    indexInParent
  };

  function uniqueCss(element) {
    if (element.id) return `#${CSS.escape(element.id)}`;
    const name = element.tagName.toLowerCase();
    const parent = element.parentElement;
    if (!parent) return name;
    const same = Array.from(parent.children).filter((c) => c.tagName === element.tagName);
    const i = same.indexOf(element) + 1;
    const parentSel = parent === document.body ? "body" : uniqueCss(parent);
    return `${parentSel} > ${name}:nth-of-type(${i})`;
  }
}

async function saveDraft(payload) {
  const { draft } = await chrome.storage.local.get("draft");
  if (!draft || draft.length === 0) return { ok: false, error: "چیزی ضبط نشده." };

  const title = (payload?.newTaskTitle || "").trim() || `ضبط ${new Date().toLocaleString("fa-IR")}`;
  const id = Date.now();
  const graph = buildGraphFromDraft(id, title, draft, payload?.groupTitle || "ضبط‌شده");
  const tasks = await loadUserTasks();
  tasks.push({
    id,
    title,
    designOrigin: "Recorded",
    groupCount: 1,
    stepCount: draft.length,
    createdAt: new Date().toISOString(),
    graph
  });
  await saveUserTasks(tasks);
  await chrome.storage.local.set({
    recording: false,
    recordPhase: "idle",
    draft: [],
    recordTabId: null,
    lastNavUrl: null
  });
  await pushTasksToPortalTabs(tasks);
  await broadcastRecordState();
  return { ok: true, result: { taskId: id, groupId: 1, stepCount: draft.length } };
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
  for (const tab of tabs) {
    if (!tab.id) continue;
    chrome.tabs.sendMessage(tab.id, { type: "localTasksUpdated", user, tasks }).catch(() => {});
  }
}

function buildGraphFromDraft(taskId, title, actions, groupTitle) {
  const groupId = "group-1";
  const nodes = [
    { id: "start", kind: "start", title: "شروع", x: 40, y: 220 },
    {
      id: groupId,
      kind: "group",
      entityId: 1,
      title: groupTitle || "ضبط‌شده",
      x: 280,
      y: 80,
      repeatSourceType: "None",
      moveLoop: false
    }
  ];
  const edges = [{ id: "e-start", from: "start", to: groupId, kind: "next" }];
  let prev = null;
  (actions || []).forEach((a, i) => {
    const sid = `step-${i + 1}`;
    const isNav = String(a.actionType || "").toLowerCase() === "gotourl";
    nodes.push({
      id: sid,
      kind: "step",
      entityId: i + 1,
      title: `${a.actionType || "Click"} ${i + 1}`,
      groupNodeId: groupId,
      actionType: a.actionType || "Click",
      selectorValue: a.elementValue || "",
      constantValue: isNav ? "" : (a.value || ""),
      navigateUrl: isNav ? (a.url || a.value || "") : null,
      framePathJson: JSON.stringify(a.framePath || []),
      isActive: true,
      isConditional: false,
      x: 40,
      y: i * 90
    });
    if (prev) edges.push({ id: `e-${i}`, from: prev, to: sid, kind: "next" });
    else edges.push({ id: `e-c-${i}`, from: groupId, to: sid, kind: "contains" });
    prev = sid;
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

function isTrackableNavUrl(url) {
  if (!url) return false;
  if (url === "about:blank" || url.startsWith("about:")) return false;
  if (url.startsWith("chrome://") || url.startsWith("chrome-extension://")) return false;
  if (url.startsWith("edge://") || url.startsWith("devtools://")) return false;
  return /^https?:\/\//i.test(url);
}

async function appendNavStep(url, tabId) {
  const { recording, draft, lastNavUrl, playing } = await chrome.storage.local.get([
    "recording", "draft", "lastNavUrl", "playing"
  ]);
  if (!recording || playing) return;
  if (!isTrackableNavUrl(url)) return;
  if (lastNavUrl === url) return;

  const item = {
    actionType: "GoToUrl",
    value: url,
    url,
    elementBy: "CssSelector",
    elementValue: "",
    framePath: [],
    recordedAt: new Date().toISOString()
  };
  const next = Array.isArray(draft) ? draft.concat(item) : [item];
  await chrome.storage.local.set({ draft: next, lastNavUrl: url });
}

chrome.webNavigation.onCommitted.addListener(async (details) => {
  if (details.frameId !== 0) return;
  if (details.transitionType === "auto_subframe") return;
  const { recording, recordTabId } = await chrome.storage.local.get(["recording", "recordTabId"]);
  if (!recording || !recordTabId || details.tabId !== recordTabId) return;
  await appendNavStep(details.url, details.tabId);
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (!changeInfo.url) return;
  const { recording, recordTabId } = await chrome.storage.local.get(["recording", "recordTabId"]);
  if (!recording || !recordTabId || tabId !== recordTabId) return;
  await appendNavStep(changeInfo.url, tabId);
});
