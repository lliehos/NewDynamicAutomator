/** Capture rich interaction contexts while smart session is active — no local logs UI. */
let smartActive = false;
let smartTabOnly = null;

chrome.storage.local.get(["smartActive", "smartTabId"]).then((d) => {
  smartActive = !!d.smartActive;
  smartTabOnly = d.smartTabId || null;
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.smartActive) smartActive = !!changes.smartActive.newValue;
  if (changes.smartTabId) smartTabOnly = changes.smartTabId.newValue ?? null;
});

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "smartStateChanged") {
    smartActive = !!message.active;
    smartTabOnly = message.tabId ?? smartTabOnly;
  }
});

function allowed() {
  if (!smartActive || isFromSmartFab(document.documentElement)) return false;
  return true;
}

function describeElement(el) {
  if (!(el instanceof Element)) return null;
  const rect = el.getBoundingClientRect();
  const text = (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 160);
  const attrs = {};
  for (const a of Array.from(el.attributes || []).slice(0, 24)) {
    if (/^(value|src|href|id|name|type|role|aria-|data-|placeholder|title|class)/i.test(a.name)) {
      attrs[a.name] = String(a.value || "").slice(0, 200);
    }
  }
  return {
    tag: el.tagName.toLowerCase(),
    id: el.id || null,
    name: el.getAttribute("name") || null,
    type: el.getAttribute("type") || null,
    role: el.getAttribute("role") || null,
    classes: String(el.className || "").slice(0, 200),
    cssPath: cssPath(el),
    text,
    value: ("value" in el) ? String(el.value ?? "").slice(0, 500) : null,
    href: el.getAttribute("href") || null,
    attrs,
    rect: {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      w: Math.round(rect.width),
      h: Math.round(rect.height)
    },
    isVisible: !!(rect.width || rect.height) && getComputedStyle(el).visibility !== "hidden"
  };
}

function pageMeta() {
  return {
    url: location.href,
    title: document.title || "",
    origin: location.origin,
    path: location.pathname,
    hash: location.hash || "",
    referrer: document.referrer || "",
    lang: document.documentElement.lang || "",
    dir: document.documentElement.dir || "",
    viewport: { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio || 1 },
    readyState: document.readyState,
    isTopFrame: window === window.top,
    frameUrl: location.href
  };
}

function emit(kind, extra) {
  if (!allowed()) return;
  const payload = {
    kind,
    at: new Date().toISOString(),
    page: pageMeta(),
    ...extra
  };
  chrome.runtime.sendMessage({ type: "smartContext", payload }).catch(() => {});
}

document.addEventListener("click", (ev) => {
  if (!allowed() || isFromSmartFab(ev.target)) return;
  const el = ev.target instanceof Element ? ev.target : ev.target?.parentElement;
  emit("click", {
    button: ev.button,
    detail: ev.detail,
    altKey: ev.altKey,
    ctrlKey: ev.ctrlKey,
    metaKey: ev.metaKey,
    shiftKey: ev.shiftKey,
    clientX: ev.clientX,
    clientY: ev.clientY,
    target: describeElement(el)
  });
}, true);

document.addEventListener("dblclick", (ev) => {
  if (!allowed() || isFromSmartFab(ev.target)) return;
  const el = ev.target instanceof Element ? ev.target : null;
  emit("dblclick", { target: describeElement(el) });
}, true);

document.addEventListener("contextmenu", (ev) => {
  if (!allowed() || isFromSmartFab(ev.target)) return;
  const el = ev.target instanceof Element ? ev.target : null;
  emit("contextmenu", { target: describeElement(el) });
}, true);

document.addEventListener("change", (ev) => {
  if (!allowed() || isFromSmartFab(ev.target)) return;
  const el = ev.target;
  if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement)) return;
  emit("change", {
    target: describeElement(el),
    value: String(el.value ?? "").slice(0, 2000)
  });
}, true);

document.addEventListener("input", (ev) => {
  if (!allowed() || isFromSmartFab(ev.target)) return;
  const el = ev.target;
  if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return;
  // Debounce heavy input noise via background batching; still send snapshots occasionally.
  if (!el.__daSmartInputAt || Date.now() - el.__daSmartInputAt > 800) {
    el.__daSmartInputAt = Date.now();
    emit("input", {
      target: describeElement(el),
      valueLength: String(el.value ?? "").length
    });
  }
}, true);

document.addEventListener("submit", (ev) => {
  if (!allowed() || isFromSmartFab(ev.target)) return;
  const el = ev.target instanceof Element ? ev.target : null;
  emit("submit", { target: describeElement(el) });
}, true);

document.addEventListener("focusin", (ev) => {
  if (!allowed() || isFromSmartFab(ev.target)) return;
  const el = ev.target instanceof Element ? ev.target : null;
  emit("focus", { target: describeElement(el) });
}, true);

document.addEventListener("keydown", (ev) => {
  if (!allowed() || isFromSmartFab(ev.target)) return;
  // Keys only — no free-text key logging beyond specials.
  const special = ["Enter", "Tab", "Escape", "Backspace", "Delete", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];
  if (!special.includes(ev.key) && !(ev.ctrlKey || ev.metaKey || ev.altKey)) return;
  emit("keydown", {
    key: ev.key,
    code: ev.code,
    altKey: ev.altKey,
    ctrlKey: ev.ctrlKey,
    metaKey: ev.metaKey,
    shiftKey: ev.shiftKey,
    target: describeElement(ev.target instanceof Element ? ev.target : null)
  });
}, true);

let scrollTimer = null;
window.addEventListener("scroll", () => {
  if (!allowed()) return;
  if (scrollTimer) return;
  scrollTimer = setTimeout(() => {
    scrollTimer = null;
    emit("scroll", {
      scrollX: Math.round(window.scrollX),
      scrollY: Math.round(window.scrollY)
    });
  }, 400);
}, true);

window.addEventListener("popstate", () => {
  if (!allowed()) return;
  emit("navigation", { reason: "popstate" });
});

document.addEventListener("visibilitychange", () => {
  if (!allowed()) return;
  emit("visibility", { state: document.visibilityState });
});

// Initial page context when capture starts on an already-open page
setTimeout(() => {
  if (!allowed()) return;
  emit("page", { reason: "script-ready" });
}, 300);
