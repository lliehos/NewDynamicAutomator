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
  // V2 FormRecord: Start creates an empty Group; events append Steps to the last Group.
  await checkSession();
  const { playing } = await chrome.storage.local.get("playing");
  if (playing) return { ok: false, error: "هنگام پخش نمی‌توان ضبط کرد." };

  let recordingGroups = [];
  if (message.newGroup && !message.rerecord) {
    // Like V2 Pause→Start: another empty group in the same session
    const prev = await chrome.storage.local.get("recordingGroups");
    recordingGroups = Array.isArray(prev.recordingGroups) ? prev.recordingGroups.slice() : [];
  }
  recordingGroups.push({
    id: `group-${recordingGroups.length + 1}`,
    title: message.groupTitle || "گروه ضبط",
    steps: []
  });

  await chrome.storage.local.set({
    recording: true,
    recordPhase: "recording",
    draft: flattenGroupSteps(recordingGroups),
    recordingGroups,
    recordTabId: null,
    lastNavUrl: null
  });

  const tab = await chrome.tabs.create({ url: "about:blank", active: true });
  if (tab?.id) {
    await chrome.storage.local.set({ recordTabId: tab.id });
  }
  await broadcastRecordState();
  return { ok: true, tabId: tab?.id, startUrl: "about:blank", groupCount: recordingGroups.length };
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
  return { ok: true, count: countRecordedSteps(recordingGroups, draft), ...state };
}

async function discardRecord() {
  await chrome.storage.local.set({
    recording: false,
    recordPhase: "idle",
    draft: [],
    recordingGroups: [],
    recordTabId: null,
    lastNavUrl: null
  });
  return broadcastRecordState();
}

async function getState() {
  const data = await chrome.storage.local.get([
    "recording", "draft", "recordingGroups", "token", "playing", "recordPhase", "recordTabId", "localUser"
  ]);
  const play = getPlayStatus();
  const count = countRecordedSteps(data.recordingGroups, data.draft);
  const phase = data.recording
    ? "recording"
    : (data.recordPhase || (count ? "review" : "idle"));
  return {
    ok: true,
    recording: !!data.recording,
    recordPhase: phase,
    playing: !!data.playing || !!play.playing,
    count,
    groupCount: Array.isArray(data.recordingGroups) ? data.recordingGroups.length : 0,
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
    framePath,
    recordedAt: new Date().toISOString()
  };

  const last = groups[groups.length - 1];
  last.steps = (last.steps || []).concat(item);
  const draft = flattenGroupSteps(groups);
  await chrome.storage.local.set({ recordingGroups: groups, draft });
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
  const { draft, recordingGroups } = await chrome.storage.local.get(["draft", "recordingGroups"]);
  let groups = Array.isArray(recordingGroups) ? recordingGroups : [];
  // Legacy flat draft → one group
  if (!groups.length && Array.isArray(draft) && draft.length) {
    groups = [{ id: "group-1", title: payload?.groupTitle || "ضبط‌شده", steps: draft }];
  }
  // V2: Start always created a Group — allow save of empty group
  if (!groups.length) {
    groups = [{ id: "group-1", title: payload?.groupTitle || "گروه خالی", steps: [] }];
  }

  const title = (payload?.newTaskTitle || "").trim() || `ضبط ${new Date().toLocaleString("fa-IR")}`;
  const id = Number(`${Date.now() % 1e9}${Math.floor(Math.random() * 90 + 10)}`);
  const graph = buildGraphFromRecordingGroups(id, title, groups);
  const stepCount = flattenGroupSteps(groups).length;
  const tasks = await loadUserTasks();
  tasks.push({
    id,
    title,
    designOrigin: "Recorded",
    groupCount: groups.length,
    stepCount,
    createdAt: new Date().toISOString(),
    graph
  });
  await saveUserTasks(tasks);
  await chrome.storage.local.set({
    recording: false,
    recordPhase: "idle",
    draft: [],
    recordingGroups: [],
    recordTabId: null,
    lastNavUrl: null
  });
  await pushTasksToPortalTabs(tasks);
  await broadcastRecordState();
  return { ok: true, result: { taskId: id, groupId: 1, stepCount, groupCount: groups.length } };
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
      moveLoop: false
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
        kind: "step",
        entityId: stepEntity,
        title: `${a.actionType || "Click"} ${i + 1}`,
        groupNodeId: gid,
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
    framePath: [],
    recordedAt: new Date().toISOString()
  };
  const last = groups[groups.length - 1];
  last.steps = (last.steps || []).concat(item);
  await chrome.storage.local.set({
    recordingGroups: groups,
    draft: flattenGroupSteps(groups),
    lastNavUrl: url
  });
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

/** Dev/local auto-reload: portal syncs files to LocalAppData; we reload when stamp changes. */
const DEV_POLL_MS = 2500;
const DEV_STAMP_URLS = [
  "https://localhost:7201/extension/dev-stamp",
  "http://localhost:5201/extension/dev-stamp"
];

async function pollDevReload() {
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
      if (devStamp && devStamp !== data.stamp) {
        await chrome.storage.local.set({
          devStamp: data.stamp,
          portalBase: new URL(url).origin,
          installPath: data.path || null
        });
        console.info("[DA] extension updated → reload", data.version || "", data.path || "");
        chrome.runtime.reload();
        return;
      }
      await chrome.storage.local.set({
        devStamp: data.stamp,
        portalBase: new URL(url).origin,
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
