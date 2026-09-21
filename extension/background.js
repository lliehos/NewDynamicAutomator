importScripts("player/engine.js");

const DEFAULT_API = "https://localhost:7101";
const DEFAULT_PORTAL = "https://localhost:7201";

async function apiBase() {
  const { apiBase } = await chrome.storage.local.get("apiBase");
  return apiBase || DEFAULT_API;
}

async function portalBase() {
  const { portalBase } = await chrome.storage.local.get("portalBase");
  return portalBase || DEFAULT_PORTAL;
}

async function resolveAccessToken() {
  const { token } = await chrome.storage.local.get("token");
  if (token) return token;

  const portal = await portalBase();
  const api = await apiBase();
  for (const url of [portal, api, "https://localhost/", "http://localhost/"]) {
    try {
      const cookie = await chrome.cookies.get({ url, name: "da_access" });
      if (cookie?.value) {
        await chrome.storage.local.set({ token: cookie.value });
        return cookie.value;
      }
    } catch {
      /* try next */
    }
  }
  return null;
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
      return toggleRecord(sender.tab?.id);
    case "clearDraft":
      await chrome.storage.local.set({ draft: [] });
      return getState();
    case "saveDraft":
      return saveDraft(message.payload);
    case "session":
      return checkSession();
    case "recordedEvent":
      return onRecordedEvent(message.payload, sender);
    case "describeChildIframe":
      return null;
    case "listTasks":
      return listTasks();
    case "startPlay":
      return startPlay(message.taskId, sender.tab?.id ?? message.tabId, message.runMode);
    case "stopPlay":
      return stopPlay();
    case "getPlayState":
      return getPlayStatus();
    default:
      return { ok: false, error: "unknown" };
  }
}

async function getState() {
  const data = await chrome.storage.local.get(["recording", "draft", "token", "playing"]);
  const play = getPlayStatus();
  return {
    ok: true,
    recording: !!data.recording,
    playing: !!data.playing || !!play.playing,
    count: (data.draft || []).length,
    signedIn: !!data.token,
    play
  };
}

async function toggleRecord(tabId) {
  const session = await checkSession();
  if (!session.signedIn) {
    return { ok: false, error: "ابتدا در پرتال وارد شوید." };
  }
  const { playing } = await chrome.storage.local.get("playing");
  if (playing) return { ok: false, error: "هنگام پخش نمی‌توان ضبط کرد." };

  const { recording } = await chrome.storage.local.get("recording");
  const next = !recording;
  await chrome.storage.local.set({ recording: next });
  if (tabId) {
    chrome.tabs.sendMessage(tabId, { type: "recordingChanged", recording: next }).catch(() => {});
  }
  return getState();
}

async function checkSession() {
  const base = await apiBase();
  try {
    const res = await fetch(`${base}/api/auth/me`, {
      headers: await authHeaders(),
      credentials: "include"
    });
    if (!res.ok) {
      await chrome.storage.local.remove("token");
      return { signedIn: false };
    }
    const me = await res.json();
    return { signedIn: true, userName: me.userName };
  } catch {
    return { signedIn: false };
  }
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
  const session = await checkSession();
  if (!session.signedIn) return { ok: false, error: "وارد پرتال نشده‌اید." };
  const { draft } = await chrome.storage.local.get("draft");
  if (!draft || draft.length === 0) return { ok: false, error: "چیزی ضبط نشده." };

  const base = await apiBase();
  const res = await fetch(`${base}/api/recordings`, {
    method: "POST",
    headers: await authHeaders(),
    credentials: "include",
    body: JSON.stringify({
      taskId: payload?.taskId || null,
      newTaskTitle: payload?.newTaskTitle || null,
      groupTitle: payload?.groupTitle || "ضبط‌شده",
      actions: draft
    })
  });
  if (!res.ok) {
    const text = await res.text();
    return { ok: false, error: text || res.statusText };
  }
  const body = await res.json();
  await chrome.storage.local.set({ recording: false, draft: [] });
  return { ok: true, result: body };
}
