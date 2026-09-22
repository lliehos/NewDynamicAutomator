/** Selector-only extension — context-menu copy + portal memory bridge. */

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  let answered = false;
  const reply = (payload) => {
    if (answered) return;
    answered = true;
    try { sendResponse(payload); } catch { /* channel closed */ }
  };
  handleMessage(message, sender)
    .then(reply)
    .catch((err) => reply({ ok: false, error: err?.message || String(err) }));
  return true;
});

async function handleMessage(message) {
  switch (message?.type) {
    case "ping":
    case "getState":
      return {
        ok: true,
        role: "selector",
        version: chrome.runtime.getManifest().version,
        ...(await getCopiedSelectorPreview())
      };
    case "session":
      return {
        ok: true,
        role: "selector",
        version: chrome.runtime.getManifest().version,
        userName: "local"
      };
    case "getCopiedSelector":
      return getCopiedSelector();
    case "setCopiedSelector":
      return setCopiedSelector(message.payload, message.text);
    case "clearCopiedSelector":
      await chrome.storage.local.remove(["copiedSelector", "copiedSelectorText"]);
      return { ok: true };
    default:
      return { ok: false, error: "این افزونه فقط سلکتور است." };
  }
}

async function getCopiedSelectorPreview() {
  const data = await chrome.storage.local.get(["copiedSelector"]);
  const sel = data.copiedSelector?.selector || "";
  return {
    hasSelector: !!sel,
    selectorPreview: sel ? String(sel).slice(0, 120) : ""
  };
}

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
    tag: payload.tag || "",
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

const CTX_COPY_SELECTOR = "da-copy-selector";

function ensureContextMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: CTX_COPY_SELECTOR,
      title: "کپی سلکتور (اتوماتور پویا)",
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
      console.info("[DA Selector] copied", result.selector?.slice(0, 100));
    } else {
      console.warn("[DA Selector] failed", result.error);
    }
  } catch (err) {
    console.warn("[DA Selector] error", err?.message || err);
  }
});

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

async function buildFramePath(tabId, leafFrameId) {
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

function describeIframeInPage(childUrl, indexInParent) {
  const nodes = Array.from(document.querySelectorAll("iframe, frame"));
  let el = nodes.find((n) => {
    try {
      return n.src && childUrl && (childUrl.startsWith(n.src) || n.src === childUrl
        || childUrl.includes(n.getAttribute("src") || "___"));
    } catch {
      return false;
    }
  });
  if (!el && indexInParent >= 0 && indexInParent < nodes.length) el = nodes[indexInParent];
  if (!el) return null;

  function uniqueCss(element) {
    if (element.id) return `#${CSS.escape(element.id)}`;
    const name = element.tagName.toLowerCase();
    const parent = element.parentElement;
    if (!parent) return name;
    const same = Array.from(parent.children).filter((c) => c.tagName === element.tagName);
    const i = same.indexOf(element) + 1;
    const parentSel = parent === document.body ? "body" : uniqueCss(parent);
    return same.length > 1 ? `${parentSel} > ${name}:nth-of-type(${i})` : `${parentSel} > ${name}`;
  }

  return {
    by: "CssSelector",
    value: uniqueCss(el),
    srcHint: el.getAttribute("src") || childUrl,
    indexInParent
  };
}
