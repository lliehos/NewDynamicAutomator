async function getCopiedSelectorPreview() {
  const data = await chrome.storage.local.get(["copiedSelector", "copiedMode"]);
  const sel = data.copiedSelector?.elementValue || data.copiedSelector?.selector || "";
  const hops = Array.isArray(data.copiedSelector?.framePath) ? data.copiedSelector.framePath.length : 0;
  return {
    hasSelector: !!sel,
    selectorPreview: sel ? String(sel).slice(0, 120) : "",
    frameHops: hops,
    copiedMode: data.copiedMode || (sel ? "object" : ""),
    selectorUnique: data.copiedSelector?.unique !== false
  };
}

async function getCopiedSelector() {
  const data = await chrome.storage.local.get(["copiedSelector", "copiedSelectorText"]);
  if (!data.copiedSelector) return { ok: false, error: "????? ??????? ?? ????? ????." };
  const payload = normalizeAppSelector(data.copiedSelector);
  return {
    ok: true,
    payload,
    text: data.copiedSelectorText || encodeDaSelector(payload)
  };
}

async function setCopiedSelector(payload, text) {
  if (!payload || typeof payload !== "object") {
    return { ok: false, error: "payload ??????? ???." };
  }
  const normalized = normalizeAppSelector(payload);
  if (!String(normalized.elementValue || "").trim()) {
    return { ok: false, error: "?????? ???? ???." };
  }
  const encoded = text || encodeDaSelector(normalized);
  await chrome.storage.local.set({
    copiedSelector: normalized,
    copiedSelectorText: encoded,
    copiedMode: "object"
  });
  await pushSelectorToPortalTabs(normalized, encoded);
  return { ok: true, payload: normalized, text: encoded };
}

async function pushSelectorToPortalTabs(payload, text) {
  let tabs = [];
  try {
    tabs = await chrome.tabs.query({});
  } catch {
    return;
  }
  for (const tab of tabs) {
    if (!tab?.id || !tab.url) continue;
    if (!/^https?:\/\//i.test(tab.url)) continue;
    try {
      await chrome.tabs.sendMessage(tab.id, {
        type: "copiedSelectorUpdated",
        payload,
        text
      });
    } catch {
      /* no bridge */
    }
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: "MAIN",
        func: (key, t) => {
          try { localStorage.setItem(key, t); } catch { /* ignore */ }
        },
        args: ["da_copied_selector", text]
      });
    } catch {
      /* ignore */
    }
  }
}

function normalizeAppSelector(payload) {
  const elementValue = String(
    payload.elementValue || payload.ElementValue || payload.selector || payload.Selector || ""
  ).trim();
  const unique = payload.unique !== false && payload.Unique !== false
    && payload.mode !== "relative" && payload.Mode !== "relative";
  return {
    v: payload.v || 1,
    kind: "da-selector",
    elementBy: payload.elementBy || payload.ElementBy || "CssSelector",
    elementValue,
    selector: elementValue,
    unique: !!unique,
    mode: unique ? "unique" : "relative",
    framePath: normalizeFramePath(payload.framePath || payload.FramePath || []),
    url: payload.url || payload.Url || "",
    tag: payload.tag || "",
    copiedAt: payload.copiedAt || new Date().toISOString(),
    hasAttribute: payload.hasAttribute ?? payload.HasAttribute,
    attributeName: payload.attributeName || payload.AttributeName || "",
    attributeValueIsDynamic: payload.attributeValueIsDynamic ?? payload.AttributeValueIsDynamic,
    attributeValue: payload.attributeValue || payload.AttributeValue || "",
    attributeDynamicColumn: payload.attributeDynamicColumn || payload.AttributeDynamicColumn || "",
    attributeDataSourceId: payload.attributeDataSourceId ?? payload.AttributeDataSourceId ?? null
  };
}

function normalizeFramePath(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map((hop) => {
    if (!hop || typeof hop !== "object") {
      return { by: "CssSelector", value: "", srcHint: null, indexInParent: null };
    }
    const index =
      hop.indexInParent != null
        ? hop.indexInParent
        : hop.IndexInParent != null
          ? hop.IndexInParent
          : null;
    return {
      by: hop.by || hop.By || "CssSelector",
      value: String(hop.value || hop.Value || ""),
      srcHint: hop.srcHint || hop.SrcHint || null,
      indexInParent: index,
      unique: hop.unique !== false
    };
  }).filter((h) => h.value || h.srcHint != null || h.indexInParent != null);
}

function encodeDaSelector(payload) {
  return "DASEL:" + JSON.stringify(payload);
}

const CTX_PARENT = "da-selector-parent";
const CTX_U_EL = "da-copy-element-unique";
const CTX_U_FR = "da-copy-frame-unique";
const CTX_U_OBJ = "da-copy-object-unique";
const CTX_R_EL = "da-copy-element-relative";
const CTX_R_FR = "da-copy-frame-relative";
const CTX_R_OBJ = "da-copy-object-relative";

const MENU_IDS = new Set([CTX_U_EL, CTX_U_FR, CTX_U_OBJ, CTX_R_EL, CTX_R_FR, CTX_R_OBJ]);

function ensureContextMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: CTX_PARENT,
      title: "?????? ? ??????",
      contexts: ["all"]
    });
    const items = [
      [CTX_U_EL, "??? ?????? ????? (?????)"],
      [CTX_U_FR, "??? ???? ????? (?????)"],
      [CTX_U_OBJ, "??? ????? ?????? (?????)"],
      [CTX_R_EL, "??? ?????? ????? (????)"],
      [CTX_R_FR, "??? ???? ????? (????)"],
      [CTX_R_OBJ, "??? ????? ?????? (????)"]
    ];
    for (const [id, title] of items) {
      chrome.contextMenus.create({
        id,
        parentId: CTX_PARENT,
        title,
        contexts: ["all"]
      });
    }
  });
}

chrome.runtime.onInstalled.addListener(ensureContextMenus);
chrome.runtime.onStartup.addListener(ensureContextMenus);
ensureContextMenus();

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id || !MENU_IDS.has(info.menuItemId)) return;
  try {
    const id = info.menuItemId;
    const unique = id === CTX_U_EL || id === CTX_U_FR || id === CTX_U_OBJ;
    let result;
    if (id === CTX_U_EL || id === CTX_R_EL) {
      result = await copyElementSelector(info, tab, unique);
    } else if (id === CTX_U_FR || id === CTX_R_FR) {
      result = await copyFrameElement(info, tab, unique);
    } else {
      result = await copySelectorObject(info, tab, unique);
    }
    if (result.ok) {
      console.info("[Morobot Global Selector]", id, result.preview || result.selector || "");
    } else {
      console.warn("[Morobot Global Selector] failed", result.error);
    }
  } catch (err) {
    console.warn("[Morobot Global Selector] error", err?.message || err);
  }
});

async function captureLeaf(tab, frameId, unique) {
  let captured = null;
  try {
    captured = await chrome.tabs.sendMessage(
      tab.id,
      { type: "captureContextSelector", mode: unique ? "unique" : "relative" },
      { frameId }
    );
  } catch {
    captured = null;
  }
  if (!captured?.ok || !captured.selector) {
    return { ok: false, error: captured?.error || "?????? ????? ??? ? ???? ?? ???? ????." };
  }
  return { ok: true, captured };
}

async function copyElementSelector(info, tab, unique = true) {
  const frameId = info.frameId ?? 0;
  const cap = await captureLeaf(tab, frameId, unique);
  if (!cap.ok) return cap;
  const text = cap.captured.selector;
  const clipped = await writeClipboard(tab.id, frameId, text);
  return {
    ok: true,
    selector: text,
    preview: text,
    clipped,
    mode: unique ? "element-unique" : "element-relative",
    matchCount: cap.captured.matchCount
  };
}

async function copyFrameElement(info, tab, unique = true) {
  const frameId = info.frameId ?? 0;
  const framePath = await buildFramePath(tab.id, frameId, unique);
  if (!framePath.length) {
    const msg = "[]";
    const clipped = await writeClipboard(tab.id, frameId, msg);
    return {
      ok: true,
      selector: msg,
      preview: "??? ???? ? ????? ????",
      clipped,
      mode: unique ? "frame-unique" : "frame-relative",
      frameHops: 0
    };
  }
  const text = framePath.length === 1
    ? (framePath[0].value || JSON.stringify(framePath[0], null, 2))
    : JSON.stringify(framePath, null, 2);
  const clipped = await writeClipboard(tab.id, frameId, text);
  return {
    ok: true,
    selector: text,
    preview: text.slice(0, 120),
    clipped,
    mode: unique ? "frame-unique" : "frame-relative",
    frameHops: framePath.length
  };
}

async function copySelectorObject(info, tab, unique = true) {
  const frameId = info.frameId ?? 0;
  const cap = await captureLeaf(tab, frameId, unique);
  if (!cap.ok) return cap;

  const framePath = await buildFramePath(tab.id, frameId, unique);
  const payload = normalizeAppSelector({
    v: 1,
    kind: "da-selector",
    elementBy: "CssSelector",
    elementValue: cap.captured.selector,
    unique,
    mode: unique ? "unique" : "relative",
    framePath,
    url: cap.captured.url || tab.url || "",
    tag: cap.captured.tag || "",
    copiedAt: new Date().toISOString()
  });
  const text = encodeDaSelector(payload);
  await chrome.storage.local.set({
    copiedSelector: payload,
    copiedSelectorText: text,
    copiedMode: unique ? "object-unique" : "object-relative"
  });
  await pushSelectorToPortalTabs(payload, text);
  const clipped = await writeClipboard(tab.id, frameId, text);
  return {
    ok: true,
    selector: payload.elementValue,
    elementValue: payload.elementValue,
    preview: payload.elementValue,
    clipped,
    mode: unique ? "object-unique" : "object-relative",
    frameHops: framePath.length
  };
}

async function handleDevtoolsCopy(message) {
  const tabId = message.tabId;
  if (!tabId) return { ok: false, error: "tabId ???? ???." };
  const unique = message.unique !== false;
  const kind = message.kind || "element";
  const info = { frameId: message.frameId ?? 0 };
  const tab = { id: tabId, url: message.url || "" };
  if (kind === "element") return copyElementSelector(info, tab, unique);
  if (kind === "frame") return copyFrameElement(info, tab, unique);
  return copySelectorObject(info, tab, unique);
}

async function writeClipboard(tabId, frameId, text) {
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId, frameIds: [frameId] },
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
    return !!result;
  } catch {
    return false;
  }
}

async function buildFramePath(tabId, leafFrameId, unique = true) {
  if (!leafFrameId) return [];
  let frames;
  try {
    frames = await chrome.webNavigation.getAllFrames({ tabId });
  } catch {
    return [];
  }
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
        func: describeIframeInPage,
        args: [child.url, indexInParent, unique ? "unique" : "relative"]
      });
      if (result) path.push(result);
      else {
        path.push({
          by: "CssSelector",
          value: `iframe:nth-of-type(${indexInParent + 1}), frame:nth-of-type(${indexInParent + 1})`,
          srcHint: child.url,
          indexInParent,
          unique: !!unique
        });
      }
    } catch {
      path.push({
        by: "CssSelector",
        value: `iframe:nth-of-type(${indexInParent + 1})`,
        srcHint: child.url,
        indexInParent,
        unique: !!unique
      });
    }
  }
  return path;
}

function describeIframeInPage(childUrl, indexInParent, mode) {
  const nodes = Array.from(document.querySelectorAll("iframe, frame"));
  let el = nodes.find((n) => {
    try {
      const attrSrc = n.getAttribute("src") || "";
      const abs = n.src || "";
      return (
        (abs && childUrl && (childUrl === abs || childUrl.startsWith(abs) || abs.startsWith(childUrl)))
        || (attrSrc && childUrl && childUrl.includes(attrSrc))
      );
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
    const title = element.getAttribute("title");
    if (title) {
      const sel = `${tag}[title="${esc(title)}"]`;
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

  function relativeCss(element) {
    const tag = element.tagName.toLowerCase();
    const frameName = element.getAttribute("name");
    if (frameName) return `${tag}[name="${esc(frameName)}"]`;
    const title = element.getAttribute("title");
    if (title) return `${tag}[title="${esc(title)}"]`;
    const src = element.getAttribute("src");
    if (src) {
      const short = src.length > 60 ? src.slice(0, 60) : src;
      return `${tag}[src*="${esc(short)}"]`;
    }
    return tag;
  }

  const relative = mode === "relative";
  return {
    by: "CssSelector",
    value: relative ? relativeCss(el) : uniqueCss(el),
    srcHint: el.getAttribute("src") || el.src || childUrl || null,
    indexInParent,
    unique: !relative
  };
}
