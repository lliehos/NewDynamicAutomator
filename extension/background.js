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
    case "listOpenTabs":
      return listOpenTabs();
    case "getTaskGraph":
      return getLocalTaskGraph(message.taskId);
    case "startPlay":
      return startPlay(message.taskId, sender.tab?.id ?? message.tabId, message.runMode, {
        groupNodeId: message.groupNodeId || null,
        stepNodeId: message.stepNodeId || null
      });
    case "stopPlay":
      return stopPlay();
    case "pausePlay":
      return pausePlay();
    case "resumePlay":
      return resumePlay();
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
    case "getCopiedSelector":
      return getCopiedSelector();
    case "setCopiedSelector":
      return setCopiedSelector(message.payload, message.text);
    case "clearCopiedSelector":
      await chrome.storage.local.remove(["copiedSelector", "copiedSelectorText"]);
      return { ok: true };
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

  const targetTaskId = message.taskId != null && message.taskId !== ""
    ? Number(message.taskId)
    : null;
  let targetTitle = null;
  if (targetTaskId && Number.isFinite(targetTaskId)) {
    const tasks = await loadUserTasks();
    const existing = tasks.find((t) => String(t.id) === String(targetTaskId));
    targetTitle = existing?.title || null;
  }

  await chrome.storage.local.set({
    recording: true,
    recordPhase: "recording",
    draft: flattenGroupSteps(recordingGroups),
    recordingGroups,
    recordTabId: null,
    lastNavUrl: null,
    recordTargetTaskId: targetTaskId && Number.isFinite(targetTaskId) ? targetTaskId : null,
    recordTargetTitle: targetTitle
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
    tab = await chrome.tabs.create({ url: "about:blank", active: true });
  }

  if (tab?.id) {
    await chrome.storage.local.set({ recordTabId: tab.id });
    // If continuing on an open page, seed GoToUrl so playback starts there.
    const url = tab.url || tab.pendingUrl || "";
    if (reused && isTrackableNavUrl(url)) {
      await appendNavStep(url, tab.id);
    }
  }
  await broadcastRecordState();
  return {
    ok: true,
    tabId: tab?.id,
    startUrl: tab?.url || "about:blank",
    reused,
    groupCount: recordingGroups.length
  };
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

async function discardRecord() {
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
  const state = await broadcastRecordState();
  setTimeout(() => pollDevReload(), 400);
  return state;
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
  const { draft, recordingGroups, recordTargetTaskId, recordTargetTitle } = await chrome.storage.local.get([
    "draft", "recordingGroups", "recordTargetTaskId", "recordTargetTitle"
  ]);
  let groups = Array.isArray(recordingGroups) ? recordingGroups : [];
  // Legacy flat draft → one group
  if (!groups.length && Array.isArray(draft) && draft.length) {
    groups = [{ id: "group-1", title: payload?.groupTitle || "ضبط‌شده", steps: draft }];
  }
  // V2: Start always created a Group — allow save of empty group
  if (!groups.length) {
    groups = [{ id: "group-1", title: payload?.groupTitle || "گروه خالی", steps: [] }];
  }

  const tasks = await loadUserTasks();
  const targetId = payload?.taskId != null
    ? Number(payload.taskId)
    : (recordTargetTaskId != null ? Number(recordTargetTaskId) : null);
  const existingIdx = targetId && Number.isFinite(targetId)
    ? tasks.findIndex((t) => String(t.id) === String(targetId))
    : -1;

  let id;
  let title;
  let graph;
  let stepCount = flattenGroupSteps(groups).length;
  let groupCount = groups.length;

  if (existingIdx >= 0) {
    const existing = tasks[existingIdx];
    id = existing.id;
    title = (payload?.newTaskTitle || "").trim()
      || recordTargetTitle
      || existing.title
      || `ضبط ${new Date().toLocaleString("fa-IR")}`;
    graph = mergeRecordingGroupsIntoGraph(existing.graph, groups, id, title);
    const nodes = graph.nodes || [];
    stepCount = nodes.filter((n) => n.kind === "action" || n.kind === "step").length;
    groupCount = nodes.filter((n) => n.kind === "group").length;
    tasks[existingIdx] = {
      ...existing,
      title,
      designOrigin: existing.designOrigin || "Recorded",
      groupCount,
      stepCount,
      dataSourceCount: Array.isArray(graph.dataSources) ? graph.dataSources.length : 0,
      graph
    };
  } else {
    title = (payload?.newTaskTitle || "").trim() || `ضبط ${new Date().toLocaleString("fa-IR")}`;
    id = Number(`${Date.now() % 1e9}${Math.floor(Math.random() * 90 + 10)}`);
    graph = buildGraphFromRecordingGroups(id, title, groups);
    tasks.push({
      id,
      title,
      designOrigin: "Recorded",
      groupCount,
      stepCount,
      dataSourceCount: 0,
      createdAt: new Date().toISOString(),
      createdBy: await currentLocalUser(),
      sharedUsers: [],
      graph
    });
  }

  await saveUserTasks(tasks);
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
  await pushTasksToPortalTabs(tasks);
  await broadcastRecordState();
  setTimeout(() => pollDevReload(), 400);
  return { ok: true, result: { taskId: id, groupId: 1, stepCount, groupCount, merged: existingIdx >= 0 } };
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
        title: `${a.actionType || "Click"} ${i + 1}`,
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
        title: `${a.actionType || "Click"} ${i + 1}`,
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
  if (changeInfo.url || changeInfo.title || changeInfo.status === "complete" || changeInfo.status === "loading") {
    scheduleOpenTabsBroadcast(changeInfo.url ? "url" : "update");
  }
  // Keep play HUD (pause/stop + results) on the execution tab after navigations.
  if (changeInfo.status === "complete" && typeof playStatus !== "undefined" && playStatus?.playing) {
    const activePlayTab = (typeof playTabId !== "undefined" && playTabId) || null;
    if (activePlayTab && tabId === activePlayTab && typeof injectPlayFab === "function") {
      injectPlayFab(tabId).catch(() => {});
    }
  }
  if (!changeInfo.url) return;
  const { recording, recordTabId } = await chrome.storage.local.get(["recording", "recordTabId"]);
  if (!recording || !recordTabId || tabId !== recordTabId) return;
  await appendNavStep(changeInfo.url, tabId);
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
  "https://localhost:7201/extension/dev-stamp",
  "http://localhost:5201/extension/dev-stamp"
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

const CTX_COPY_SELECTOR = "da-copy-selector";

function ensureContextMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: CTX_COPY_SELECTOR,
      title: "کپی سلکتور (مروبات)",
      contexts: ["all"]
    });
  });
}

chrome.runtime.onInstalled.addListener(ensureContextMenus);
chrome.runtime.onStartup.addListener(ensureContextMenus);
ensureContextMenus();

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== CTX_COPY_SELECTOR || !tab?.id) return;
  try {
    const result = await copySelectorFromContext(info, tab);
    if (result.ok) {
      console.info("[DA] selector copied", result.selector?.slice(0, 80));
    } else {
      console.warn("[DA] copy selector failed", result.error);
    }
  } catch (err) {
    console.warn("[DA] copy selector error", err?.message || err);
  }
});

async function getCopiedSelector() {
  const data = await chrome.storage.local.get(["copiedSelector", "copiedSelectorText"]);
  if (!data.copiedSelector) return { ok: false, error: "سلکتوری در حافظه نیست." };
  return {
    ok: true,
    payload: data.copiedSelector,
    text: data.copiedSelectorText || encodeDaSelector(data.copiedSelector)
  };
}

async function setCopiedSelector(payload, text) {
  if (!payload || typeof payload !== "object") {
    return { ok: false, error: "payload نامعتبر است." };
  }
  const selector = payload.selector || payload.Selector || "";
  if (!String(selector).trim()) {
    return { ok: false, error: "سلکتور خالی است." };
  }
  const normalized = {
    v: payload.v || 1,
    kind: "da-selector",
    selector: String(selector),
    elementBy: payload.elementBy || payload.ElementBy || "CssSelector",
    framePath: payload.framePath || payload.FramePath || [],
    url: payload.url || payload.Url || "",
    copiedAt: payload.copiedAt || new Date().toISOString(),
    hasAttribute: payload.hasAttribute ?? payload.HasAttribute,
    attributeName: payload.attributeName || payload.AttributeName || "",
    attributeValueIsDynamic: payload.attributeValueIsDynamic ?? payload.AttributeValueIsDynamic,
    attributeValue: payload.attributeValue || payload.AttributeValue || "",
    attributeDynamicColumn: payload.attributeDynamicColumn || payload.AttributeDynamicColumn || "",
    attributeDataSourceId: payload.attributeDataSourceId ?? payload.AttributeDataSourceId ?? null
  };
  const encoded = text || encodeDaSelector(normalized);
  await chrome.storage.local.set({ copiedSelector: normalized, copiedSelectorText: encoded });
  return { ok: true, payload: normalized, text: encoded };
}

function encodeDaSelector(payload) {
  return "DASEL:" + JSON.stringify(payload);
}

function parseDaSelectorText(text) {
  if (!text || typeof text !== "string") return null;
  const raw = text.trim();
  if (!raw.startsWith("DASEL:")) return null;
  try {
    const obj = JSON.parse(raw.slice(6));
    if (!obj || typeof obj !== "object") return null;
    if (!obj.selector && !obj.Selector) return null;
    return {
      v: obj.v || 1,
      kind: "da-selector",
      selector: obj.selector || obj.Selector || "",
      elementBy: obj.elementBy || obj.ElementBy || "CssSelector",
      framePath: obj.framePath || obj.FramePath || [],
      url: obj.url || obj.Url || "",
      copiedAt: obj.copiedAt || null
    };
  } catch {
    return null;
  }
}

async function copySelectorFromContext(info, tab) {
  const frameId = info.frameId ?? 0;
  let captured = null;
  try {
    captured = await chrome.tabs.sendMessage(tab.id, { type: "captureContextSelector" }, { frameId });
  } catch {
    captured = null;
  }
  if (!captured?.ok || !captured.selector) {
    return { ok: false, error: captured?.error || "سلکتور گرفته نشد — صفحه را رفرش کنید." };
  }

  const framePath = await buildFramePath(tab.id, frameId);
  const payload = {
    v: 1,
    kind: "da-selector",
    selector: captured.selector,
    elementBy: "CssSelector",
    framePath,
    url: captured.url || tab.url || "",
    tag: captured.tag || "",
    copiedAt: new Date().toISOString()
  };
  const text = encodeDaSelector(payload);
  await chrome.storage.local.set({ copiedSelector: payload, copiedSelectorText: text });

  // Prefer writing clipboard in the page (user-gesture from context menu).
  let clipped = false;
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id, frameIds: [frameId] },
      func: (t) => {
        try {
          if (navigator.clipboard?.writeText) {
            return navigator.clipboard.writeText(t).then(() => true).catch(() => false);
          }
        } catch {
          /* fall through */
        }
        try {
          const ta = document.createElement("textarea");
          ta.value = t;
          ta.style.position = "fixed";
          ta.style.left = "-9999px";
          document.body.appendChild(ta);
          ta.select();
          const ok = document.execCommand("copy");
          ta.remove();
          return ok;
        } catch {
          return false;
        }
      },
      args: [text]
    });
    clipped = !!result;
  } catch {
    clipped = false;
  }

  return { ok: true, selector: payload.selector, clipped, frameHops: framePath.length };
}

