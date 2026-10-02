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
  if (!data.copiedSelector) return { ok: false, error: "سلکتوری در حافظه نیست." };
  const payload = normalizeAppSelector(data.copiedSelector);
  return {
    ok: true,
    payload,
    text: data.copiedSelectorText || encodeDaSelector(payload)
  };
}

async function setCopiedSelector(payload, text) {
  if (!payload || typeof payload !== "object") {
    return { ok: false, error: "payload نامعتبر است." };
  }
  const normalized = normalizeAppSelector(payload);
  if (!String(normalized.elementValue || "").trim()) {
    return { ok: false, error: "سلکتور خالی است." };
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

/** Menu label i18n keys, in display order. */
const CTX_ITEMS = [
  [CTX_U_EL, "ctx.elementUnique"],
  [CTX_U_FR, "ctx.frameUnique"],
  [CTX_U_OBJ, "ctx.objectUnique"],
  [CTX_R_EL, "ctx.elementRelative"],
  [CTX_R_FR, "ctx.frameRelative"],
  [CTX_R_OBJ, "ctx.objectRelative"]
];

/**
 * "Build element" — a SECOND top-level menu, next to the selector one.
 *
 * It appends a node to the flow that is open in an editor tab, using the element the user just
 * right-clicked. Deliberately a separate parent (the owner's choice) rather than a seventh entry
 * in the selector menu: the two do different things, and mixing them made a long list where the
 * two halves had nothing to do with each other.
 */
const CTX_BUILD_PARENT = "da-build-parent";

/**
 * The element types offered.
 *
 * Page ACTIONS and CONDITIONS only (the owner's choice). The types are the ones a node created
 * from a live page element can actually be filled with: every one of them needs a selector, and
 * that is exactly what the right-click provides. Types that need no page element (waiting, tab
 * bookkeeping, memory) are left out — offering them here would produce a node with an irrelevant
 * selector, which is worse than not offering them.
 */
const BUILD_ITEMS = [
  ["Click", "build.click"],
  ["DoubleClick", "build.doubleClick"],
  ["RightClick", "build.rightClick"],
  ["Hover", "build.hover"],
  ["Hold", "build.hold"],
  ["InputContent", "build.inputContent"],
  ["ClearContent", "build.clearContent"],
  ["SelectOption", "build.selectOption"],
  ["RemoveElements", "build.removeElements"],
  ["GoToUrl", "build.goToUrl"],
  ["FindElement", "build.findElement"],
  ["NotFindElement", "build.notFindElement"],
  ["ElementVisible", "build.visible"],
  ["ElementHidden", "build.hidden"],
  ["ElementValue", "build.elementValue"]
];
const BUILD_MENU_IDS = new Set(BUILD_ITEMS.map(([id]) => id));

/**
 * Every menu id this extension creates, used to suppress the whole menu on our own panel.
 * Built from the same source lists as the creates, so a new entry cannot be forgotten here.
 */
const ALL_MENU_IDS = [
  CTX_PARENT,
  CTX_BUILD_PARENT,
  ...CTX_ITEMS.map(([id]) => id),
  ...BUILD_ITEMS.map(([id]) => id)
];


/** Culture comes from the portal via chrome.storage.uiCulture (see content/portal-bridge.js). */
async function ctxCulture() {
  try {
    const { uiCulture } = await chrome.storage.local.get("uiCulture");
    return uiCulture === "en" ? "en" : "fa";
  } catch {
    return "fa";
  }
}

/** Minimal fa/en catalogue for the context menu — keeps bg-selector free of the HUD bundle. */
const CTX_LABELS = {
  fa: {
    "ctx.parent": "کپی سلکتور",
    "ctx.elementUnique": "سلکتور این المان (یکتا)",
    "ctx.frameUnique": "سلکتور فریم این المان (یکتا)",
    "ctx.objectUnique": "سلکتور آبجکت این المان (یکتا)",
    "ctx.elementRelative": "سلکتور این المان (نسبی)",
    "ctx.frameRelative": "سلکتور فریم این المان (نسبی)",
    "ctx.objectRelative": "سلکتور آبجکت این المان (نسبی)",
    "ctx.framePathEmpty": "فریم تودرتویی یافت نشد",
    "build.parent": "ساخت عنصر در فرآیند",
    "build.click": "کلیک روی المان",
    "build.doubleClick": "دبل‌کلیک روی المان",
    "build.rightClick": "کلیک راست روی المان",
    "build.hover": "نگه‌داشتن نشانگر روی المان",
    "build.hold": "فشردن و نگه‌داشتن المان",
    "build.inputContent": "پر کردن فیلد المان",
    "build.clearContent": "پاک کردن متن فیلد",
    "build.selectOption": "انتخاب گزینه از لیست",
    "build.removeElements": "حذف المان‌های صفحه",
    "build.goToUrl": "رفتن به آدرس",
    "build.findElement": "شرط: وجود المان",
    "build.notFindElement": "شرط: نبود المان",
    "build.visible": "شرط: نمایان بودن المان",
    "build.hidden": "شرط: پنهان بودن المان",
    "build.elementValue": "شرط: مقدار المان",
    "build.noEditor": "ابتدا ادیتور فرآیند را باز کنید.",
    "build.manyEditors": "بیش از یک ادیتور باز است؛ فقط یکی را باز بگذارید.",
    "build.locked": "این فرآیند قفل است و نود جدید نمی‌پذیرد.",
    "build.noElement": "المانی انتخاب نشده است. ابتدا روی آن راست‌کلیک کنید.",
    "build.unknownType": "این نوع اقدام پشتیبانی نمی‌شود؛ افزونه را به‌روز کنید."
  },
  en: {
    "ctx.parent": "Copy selector",
    "ctx.elementUnique": "This element's selector (unique)",
    "ctx.frameUnique": "This element's frame selector (unique)",
    "ctx.objectUnique": "This element's object selector (unique)",
    "ctx.elementRelative": "This element's selector (relative)",
    "ctx.frameRelative": "This element's frame selector (relative)",
    "ctx.objectRelative": "This element's object selector (relative)",
    "ctx.framePathEmpty": "No nested frame found",
    "build.parent": "Add element to process",
    "build.click": "Click the element",
    "build.doubleClick": "Double-click the element",
    "build.rightClick": "Right-click the element",
    "build.hover": "Hover the element",
    "build.hold": "Press and hold the element",
    "build.inputContent": "Fill the element's field",
    "build.clearContent": "Clear the field's text",
    "build.selectOption": "Select an option from the list",
    "build.removeElements": "Remove page elements",
    "build.goToUrl": "Go to URL",
    "build.findElement": "Condition: element exists",
    "build.notFindElement": "Condition: element is absent",
    "build.visible": "Condition: element is visible",
    "build.hidden": "Condition: element is hidden",
    "build.elementValue": "Condition: element value",
    "build.noEditor": "Open the process editor first.",
    "build.manyEditors": "More than one editor is open; keep only one.",
    "build.locked": "This process is locked and cannot take a new node.",
    "build.noElement": "No element selected. Right-click one first.",
    "build.unknownType": "This action type is not supported; update the extension."
  }
};

function ctxT(culture, key) {
  const pack = CTX_LABELS[culture] || CTX_LABELS.fa;
  return pack[key] ?? CTX_LABELS.fa[key] ?? key;
}

/**
 * Serialise context-menu rebuilds.
 *
 * `removeAll` is asynchronous, so two overlapping calls interleave: the second `removeAll`
 * can run *before* the first call has finished creating, and then the first call's `create`
 * runs against ids that already exist — Chrome logs "duplicate id da-selector-parent" and
 * the menu ends up half-built. Startup, install and a language change can all land at once,
 * so instead of relying on timing we chain every rebuild onto the previous one and coalesce
 * requests that arrive while a rebuild is already queued.
 */
let ctxMenuChain = Promise.resolve();
let ctxMenuQueued = false;

/**
 * The portal origin, or "" when unknown. portalBase() lives in background.js (this file is
 * evaluated in the same worker scope, but is guarded so it also loads standalone in tests).
 *
 * Prefers a live session's bound server for the same reason `portalBase()` does: the shared value
 * can be repointed by another portal tab, and a selector action belongs to the recording or play it
 * was started from rather than to whichever portal happened to load last.
 */
async function portalBaseSafe() {
  try {
    if (globalThis.DaSessionScope) {
      const bound = await DaSessionScope.recordPortalBase() || await DaSessionScope.playPortalBase();
      if (bound) return bound;
    }
    const { portalBase } = await chrome.storage.local.get("portalBase");
    return String(portalBase || "").replace(/\/$/, "");
  } catch {
    return "";
  }
}

/**
 * Is this URL our own panel?
 *
 * Same rule as isPortalTabUrl() in background.js: the configured portal origin, plus
 * localhost/127.0.0.1 which is the dev portal. Kept in sync deliberately — two different notions of
 * "our page" would show the menu on one and hide it on the other.
 */
async function isOnOurPortal(url) {
  if (!url) return false;
  const base = await portalBaseSafe();
  if (base && url.startsWith(base)) return true;
  return /:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(url);
}

function ensureContextMenus() {
  // Collapse a burst of triggers into a single rebuild.
  if (ctxMenuQueued) return ctxMenuChain;
  ctxMenuQueued = true;
  ctxMenuChain = ctxMenuChain
    .catch(() => { /* one failed rebuild must not poison the chain */ })
    .then(async () => {
      ctxMenuQueued = false;
      const culture = await ctxCulture();
      const urlPatterns = ctxMenuUrlPatterns();
      // If the API is absent there is nothing to build; bail before touching it.
      if (!chrome.contextMenus?.create) return;
      // removeAll must finish before create, otherwise Chrome throws duplicate-id errors.
      await new Promise((resolve) => chrome.contextMenus.removeAll(resolve));
      // create() can reject with "duplicate id" (or report it via lastError) if a stale
      // entry survived; retrying after another removeAll settles the state.
      try {
        chrome.contextMenus.create({
          id: CTX_PARENT,
          title: ctxT(culture, "ctx.parent"),
          contexts: ["all"],
          documentUrlPatterns: urlPatterns
        }, () => { void chrome.runtime.lastError; });
        for (const [id, key] of CTX_ITEMS) {
          chrome.contextMenus.create({
            id,
            parentId: CTX_PARENT,
            title: ctxT(culture, key),
            contexts: ["all"],
            documentUrlPatterns: urlPatterns
          }, () => { void chrome.runtime.lastError; });
        }

        // The second top-level menu. Its children ARE the element types: a context menu is a flat
        // list, so an extra nesting level would only repeat the parent's own label as a second,
        // identical entry (which is exactly the duplication the owner spotted).
        chrome.contextMenus.create({
          id: CTX_BUILD_PARENT,
          title: ctxT(culture, "build.parent"),
          contexts: ["all"],
          documentUrlPatterns: urlPatterns
        }, () => { void chrome.runtime.lastError; });
        for (const [type, key] of BUILD_ITEMS) {
          chrome.contextMenus.create({
            id: type,
            parentId: CTX_BUILD_PARENT,
            title: ctxT(culture, key),
            contexts: ["all"],
            documentUrlPatterns: urlPatterns
          }, () => { void chrome.runtime.lastError; });
        }
      } catch (err) {
        console.warn("[selector] context menu rebuild failed", err?.message || err);
      }
    });
  return ctxMenuChain;
}

// Every top-level registration is guarded. An unguarded `X.addListener(...)` on a sub-API the
// running Chrome does not expose throws while the service worker is being evaluated, and that fails
// the entire worker registration ("Service worker registration failed. Status code: 15") — one
// missing API would take the whole extension down rather than just the one feature.
if (chrome.runtime?.onInstalled?.addListener) {
  chrome.runtime.onInstalled.addListener(() => { ensureContextMenus(); });
}
if (chrome.runtime?.onStartup?.addListener) {
  chrome.runtime.onStartup.addListener(() => { ensureContextMenus(); });
}
// Rebuild whenever the portal switches language, so labels follow the user immediately.
try {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.uiCulture) ensureContextMenus();
  });
} catch { /* ignore */ }
ensureContextMenus();

/**
 * URL patterns for the menus: all ordinary web pages.
 *
 * On our own panel the operator is using the application, not aiming at a page element, so "copy
 * selector" and "add element to process" are meaningless there and only clutter the menu they
 * actually want (the browser's own).
 *
 * Chrome's pattern syntax has NO negation, so "everywhere except the portal" cannot be written as a
 * pattern — the portal is excluded by the click-time check in isOnOurPortal() instead. These
 * patterns simply keep the menu off non-web pages (chrome://, file://, the extension's own pages).
 *
 * Note on the earlier attempt: this was previously done with `contextMenus.onShown`. That was wrong
 * twice over — onShown is a recent API that may be absent, and calling addListener on it unguarded
 * threw during service-worker evaluation, failing the entire worker registration. Hence the
 * defensive guards around every top-level registration below.
 */
function ctxMenuUrlPatterns() {
  return ["http://*/*", "https://*/*"];
}

/**
 * Click-time guard, the belt to documentUrlPatterns' braces.
 *
 * Covers the case where the tab navigates between the menu opening and the click, which no URL
 * pattern can catch.
 */
if (chrome.contextMenus?.onClicked?.addListener) {
  chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    if (!tab?.id) return;

    // A tab of ANOTHER deployment is not ours to act on: copying selectors from it or building
    // nodes into its editor would mix two panels' data. Ordinary sites answer the fingerprint probe
    // with 404, so only a real Morobot server (of a different deployment) can trigger this refusal.
    if (typeof verifyOriginAgainstBinding === "function") {
      const verdict = await verifyOriginAgainstBinding(tab.url || info.pageUrl || "").catch(() => null);
      if (verdict && verdict.match === false) {
        console.info("[Morobot Global Selector] refused: tab belongs to another deployment", tab.url);
        return;
      }
    }

    // Our own panel is not a target surface: these entries mean nothing there.
    if (await isOnOurPortal(tab.url || info.pageUrl)) return;

    // "Build element": append a node to the flow open in the (single) editor tab.
    if (BUILD_MENU_IDS.has(info.menuItemId)) {
      await handleBuildElement(info, tab).catch((err) => {
        console.warn("[selector] build element failed", err?.message || err);
        notifyBuildError(tab.id, "build.noElement");
      });
      return;
    }

    if (!MENU_IDS.has(info.menuItemId)) return;
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
}

/**
 * Append a node for the right-clicked element to the flow open in the editor.
 *
 * Order of checks is deliberate — each failure has a different fix, and reporting the wrong one
 * sends the user to the wrong place:
 *   1. is an element actually captured?   (else: right-click the element first)
 *   2. is EXACTLY ONE editor open?        (else: no editor / too many editors)
 *   3. hand the node to that editor and let IT validate the graph (locked, child-of-template).
 * The editor is the only place that knows the graph shape and its write permissions, so the
 * decision to accept the node belongs there, not here.
 */
async function handleBuildElement(info, tab) {
  const frameId = info.frameId ?? 0;

  const cap = await captureLeaf(tab, frameId, true);
  if (!cap.ok) {
    notifyBuildError(tab.id, "build.noElement", cap.error);
    return;
  }

  const found = await findEditorTab();
  if (!found.ok) {
    notifyBuildError(tab.id, found.reason === "many_editors" ? "build.manyEditors" : "build.noEditor");
    return;
  }

  const payload = {
    source: "da-extension",
    type: "da-build-node",
    actionType: info.menuItemId,
    selector: cap.captured.selector,
    framePathJson: cap.captured.framePathJson || null,
    url: cap.captured.url || null,
    matchCount: cap.captured.matchCount ?? null
  };

  let res = null;
  try {
    // The editor listens in the PAGE world (see content/portal-ui.js), so the message is
    // relayed through its content script rather than posted directly from the worker.
    res = await chrome.tabs.sendMessage(found.tabId, {
      type: "relayToPage",
      payload
    });
  } catch {
    res = null;
  }

  if (res && res.ok === false) {
    notifyBuildError(tab.id, res.errorKey || "build.noElement", res.error);
  }
}

/** Tell the user why nothing happened, on the tab they right-clicked. */
function notifyBuildError(tabId, labelKey, detail) {
  if (!tabId) return;
  chrome.tabs.sendMessage(tabId, {
    type: "da-build-error",
    labelKey,
    detail: detail || ""
  }).catch(() => {});
}

async function captureLeaf(tab, frameId, unique) {  let captured = null;
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
    return { ok: false, error: captured?.error || "سلکتور دریافت نشد؛ صفحه را رفرش کنید." };
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
      preview: ctxT(await ctxCulture(), "ctx.framePathEmpty"),
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
  if (!tabId) return { ok: false, error: "tabId نامعتبر است." };
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
