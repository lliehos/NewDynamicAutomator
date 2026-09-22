function isActionNode(n) {
  return !!n && (n.kind === "action" || n.kind === "step");
}

/** Play-time graph validation — mirrors editor leaf rules; blocks start if any node is invalid. */
const DYN_SEL_PLACEHOLDER = "{مقدار پویا}";

function selectorHasDynPlaceholder(val) {
  const s = String(val || "");
  return s.includes(DYN_SEL_PLACEHOLDER) || /\{\{[^}]+\}\}/.test(s);
}

function stepIsCapture(actionType) {
  return actionType === "TakeContent" || actionType === "SaveContent";
}

function stepIsUrlAction(actionType) {
  return actionType === "GoToUrl" || actionType === "Navigate" || actionType === "NewPage";
}

function stepReceivesValue(actionType) {
  return [
    "InputContent", "InsertContent", "LoadContent",
    "WaitTime", "GoToUrl", "Navigate", "NewPage"
  ].includes(actionType || "");
}

function stepAllowsMemoryValue(actionType) {
  return stepReceivesValue(actionType) || stepIsCapture(actionType);
}

function stepAllowsElementValue(actionType) {
  if (actionType === "WaitTime") return false;
  return actionType === "InputContent" || actionType === "InsertContent" || actionType === "LoadContent"
    || stepIsUrlAction(actionType) || stepIsCapture(actionType);
}

function stepAllowsSystemValue(actionType) {
  if (actionType === "WaitTime") return false;
  return stepReceivesValue(actionType) || stepIsCapture(actionType);
}

function migrateCaptureNode(n) {
  if (!n || !stepIsCapture(n.actionType)) return;
  if (n.saveTargetType === "Memory" || n.saveTargetType === "DataSource") return;
  if (n.contentSourceType === "Memory" || n.contentSourceType === "DataSource") {
    n.saveTargetType = n.contentSourceType;
    n.contentSourceType = "Elements";
  } else {
    n.saveTargetType = "Memory";
  }
}

function normalizeSaveTarget(n) {
  migrateCaptureNode(n);
  let t = n.saveTargetType || "Memory";
  if (t !== "DataSource") t = "Memory";
  n.saveTargetType = t;
  return t;
}

function normalizeStepValueSource(n) {
  migrateCaptureNode(n);
  let src = n.contentSourceType;
  const at = n.actionType || "";
  if (!src || src === "None") {
    src = n.valueFromSource ? "DataSource"
      : (stepIsCapture(at) ? "Elements" : "Constant");
  }
  const allowed = new Set(["Constant", "DataSource"]);
  if (stepAllowsElementValue(at)) allowed.add("Elements");
  if (stepAllowsMemoryValue(at)) allowed.add("Memory");
  if (stepAllowsSystemValue(at)) allowed.add("System");
  if (!allowed.has(src)) src = stepIsCapture(at) ? "Elements" : "Constant";
  n.contentSourceType = src;
  n.valueFromSource = src === "DataSource";
  return src;
}

function stepShowsTargetSelector(n) {
  const at = (n && n.actionType) || "";
  if (stepIsUrlAction(at)) return false;
  if (at === "WaitTime" || at === "CloseFirstTab" || at === "CloseLastTab"
    || at === "Refresh" || at === "NoAction" || !at) {
    return false;
  }
  if (stepIsCapture(at)) {
    migrateCaptureNode(n);
    return normalizeStepValueSource(n) === "Elements";
  }
  return [
    "Click", "DoubleClick", "RightClick", "Hover", "Enter",
    "InputContent", "InsertContent", "LoadContent",
    "WaitForLoading"
  ].includes(at);
}

function conditionNeedsCompare(ct) {
  return ["Url", "ElementValue", "SourceValue", "FindElements", "DriverTabs"].includes(ct);
}

function conditionNeedsCompareOperand(ct, eq) {
  if (!conditionNeedsCompare(ct)) return false;
  if (eq === "HasValue" || eq === "HasNotValue") return false;
  return true;
}

function validateSelectorBlock(n, opts = {}) {
  const valueKey = opts.valueKey || "selectorValue";
  const dynFlag = opts.dynFlag || "selectorIsDynamic";
  const dynCol = opts.dynCol || "selectorDynamicColumn";
  const hasAttr = opts.hasAttr || "hasAttribute";
  const attrName = opts.attrName || "attributeName";
  const attrDyn = opts.attrDynFlag || "attributeValueIsDynamic";
  const attrCol = opts.attrDynCol || "attributeDynamicColumn";
  const label = opts.label || "سلکتور";

  const sel = String(n[valueKey] || "").trim();
  if (!sel) return { ok: false, reason: `${label} خالی است` };
  if (n[dynFlag] === true) {
    if (!selectorHasDynPlaceholder(sel)) {
      return { ok: false, reason: `${label} پویا باید «{مقدار پویا}» یا {{ستون}} داشته باشد` };
    }
    if (sel.includes(DYN_SEL_PLACEHOLDER) && !String(n[dynCol] || "").trim()) {
      return { ok: false, reason: `ستون ${label} پویا مشخص نیست` };
    }
  }
  if (n[hasAttr] === true) {
    if (!String(n[attrName] || "").trim()) {
      return { ok: false, reason: `نام اتریبیوت ${label} خالی است` };
    }
    if (n[attrDyn] === true && !String(n[attrCol] || "").trim()) {
      return { ok: false, reason: `ستون اتریبیوت پویای ${label} مشخص نیست` };
    }
  }
  return { ok: true };
}

function validateDataSourcePick(n, opts = {}) {
  const dsKey = opts.dsKey || "dataSourceId";
  const colKey = opts.colKey || "dynamicSourceColumnName";
  const dsId = n[dsKey] || n.sourceId || n.dataSourceId;
  if (dsId == null || dsId === "") return { ok: false, reason: opts.dsReason || "منبع داده انتخاب نشده" };
  if (!String(n[colKey] || "").trim()) {
    return { ok: false, reason: opts.colReason || "ستون منبع داده انتخاب نشده" };
  }
  return { ok: true };
}

function validateActionNodeForPlay(n) {
  const reasons = [];
  if (n.isActive === false) return { ok: true, reasons };
  const at = n.actionType || "";
  if (!at || at === "NoAction") return { ok: true, reasons };

  if (stepShowsTargetSelector(n)) {
    const v = validateSelectorBlock(n, { label: "سلکتور هدف" });
    if (!v.ok) reasons.push(v.reason);
  }

  if (stepIsCapture(at)) {
    migrateCaptureNode(n);
    const src = normalizeStepValueSource(n);
    if (src === "Constant") {
      if (!String(n.constantValue || "").trim()) reasons.push("مقدار ثابت ذخیره خالی است");
    } else if (src === "Elements") {
      const v = validateSelectorBlock(n, { label: "سلکتور المان صفحه" });
      if (!v.ok) reasons.push(v.reason);
    } else if (src === "DataSource") {
      const v = validateDataSourcePick(n);
      if (!v.ok) reasons.push(v.reason);
    } else if (src === "Memory") {
      if (!String(n.sourceMemoryVariableName || "").trim()) {
        reasons.push("متغیر منبع حافظه مشخص نیست");
      }
    } else if (src === "System") {
      if (!String(n.systemValueType || "").trim()) {
        reasons.push("نوع مقدار پیش‌فرض سیستم مشخص نیست");
      }
    }
    const dest = normalizeSaveTarget(n);
    if (dest === "Memory") {
      if (!String(n.memoryVariableName || "").trim()) {
        reasons.push("نام متغیر مقصد حافظه مشخص نیست");
      }
    } else {
      const saveDs = n.saveDataSourceId != null ? n.saveDataSourceId : n.dataSourceId;
      const saveCol = n.saveColumnName || (src === "DataSource" ? "" : n.dynamicSourceColumnName);
      if (src === "DataSource") {
        if (saveDs == null || saveDs === "") reasons.push("منبع مقصد ذخیره انتخاب نشده");
        if (!String(n.saveColumnName || "").trim()) reasons.push("ستون مقصد ذخیره انتخاب نشده");
      } else {
        const v = validateDataSourcePick({
          dataSourceId: saveDs,
          dynamicSourceColumnName: saveCol || n.dynamicSourceColumnName
        }, { dsReason: "منبع مقصد ذخیره انتخاب نشده", colReason: "ستون مقصد ذخیره انتخاب نشده" });
        if (!v.ok) reasons.push(v.reason);
      }
    }
  } else if (stepReceivesValue(at)) {
    const src = normalizeStepValueSource(n);
    if (src === "Constant") {
      if (at === "WaitTime") {
        const ms = Number(n.constantValue);
        if (!Number.isFinite(ms) || ms < 0 || String(n.constantValue ?? "").trim() === "") {
          reasons.push("زمان انتظار مشخص نیست");
        }
      } else if (stepIsUrlAction(at)) {
        const url = String(n.navigateUrl || n.constantValue || "").trim();
        if (!url) reasons.push("آدرس ثابت خالی است");
      } else if (!String(n.constantValue || "").trim()) {
        reasons.push("مقدار ثابت خالی است");
      }
    } else if (src === "Elements") {
      const v = validateSelectorBlock(n, {
        valueKey: "equalSelectorValue",
        dynFlag: "equalSelectorIsDynamic",
        dynCol: "equalSelectorDynamicColumn",
        hasAttr: "equalHasAttribute",
        attrName: "equalAttributeName",
        attrDynFlag: "equalAttributeValueIsDynamic",
        attrCol: "equalAttributeDynamicColumn",
        label: stepIsUrlAction(at) ? "سلکتور آدرس" : "سلکتور منبع مقدار"
      });
      if (!v.ok) reasons.push(v.reason);
    } else if (src === "DataSource") {
      const v = validateDataSourcePick(n);
      if (!v.ok) reasons.push(v.reason);
    } else if (src === "Memory") {
      if (!String(n.memoryVariableName || "").trim()) {
        reasons.push("متغیر حافظه مشخص نیست");
      }
    } else if (src === "System") {
      if (!String(n.systemValueType || "").trim()) {
        reasons.push("نوع مقدار پیش‌فرض سیستم مشخص نیست");
      }
    }
  }

  return { ok: reasons.length === 0, reasons };
}

function validateConditionNodeForPlay(n) {
  const reasons = [];
  const ct = n.conditionType || "None";
  if (!ct || ct === "None") {
    reasons.push("نوع شرط انتخاب نشده");
    return { ok: false, reasons };
  }
  const eq = n.equalityType || "equal";
  const src = n.contentSourceType || "Constant";

  if (["FindElement", "NotFindElement", "FindElements", "ElementValue"].includes(ct)) {
    const v = validateSelectorBlock(n, { label: "سلکتور شرط" });
    if (!v.ok) reasons.push(v.reason);
  }
  if (ct === "SourceValue") {
    if (!n.sourceId && !n.dataSourceId) {
      reasons.push("منبع مورد بررسی انتخاب نشده");
    } else if (!String(n.dynamicSourceColumnName || "").trim()) {
      reasons.push("ستون مورد بررسی انتخاب نشده");
    }
  }

  if (conditionNeedsCompareOperand(ct, eq)) {
    if (src === "Constant") {
      const val = ct === "Url"
        ? String(n.navigation || n.constantEqualValue || n.constantValue || "").trim()
        : String(n.constantEqualValue ?? n.constantValue ?? n.navigation ?? "").trim();
      if (ct === "FindElements" || ct === "DriverTabs") {
        if (val === "" || !Number.isFinite(Number(val))) {
          reasons.push("مقدار عددی مقایسه مشخص نیست");
        }
      } else if (!val) {
        reasons.push("مقدار مقایسه خالی است");
      }
    } else if (src === "Elements") {
      const v = validateSelectorBlock(n, {
        valueKey: "equalSelectorValue",
        dynFlag: "equalSelectorIsDynamic",
        dynCol: "equalSelectorDynamicColumn",
        hasAttr: "equalHasAttribute",
        attrName: "equalAttributeName",
        attrDynFlag: "equalAttributeValueIsDynamic",
        attrCol: "equalAttributeDynamicColumn",
        label: "سلکتور مقدار مقایسه"
      });
      if (!v.ok) reasons.push(v.reason);
    } else if (src === "DataSource" && ct !== "SourceValue") {
      const v = validateDataSourcePick(n);
      if (!v.ok) reasons.push(v.reason);
    } else if (src === "Memory") {
      if (!String(n.memoryVariableName || n.sourceMemoryVariableName || "").trim()) {
        reasons.push("متغیر حافظه مقایسه مشخص نیست");
      }
    } else if (src === "System") {
      if (!String(n.systemValueType || "").trim()) {
        reasons.push("نوع مقدار پیش‌فرض مقایسه مشخص نیست");
      }
    }
  }

  return { ok: reasons.length === 0, reasons };
}

function validateStartNodeForPlay(n, graph) {
  const reasons = [];
  const rst = n.repeatSourceType || (n.groupNodeId ? "None" : (graph.repeatSourceType || "None"));
  if (rst === "Loops") {
    const lc = Number(n.loopCount ?? n.constantValue);
    if (!Number.isFinite(lc) || lc < 1) reasons.push("تعداد تکرار حلقه نامعتبر است");
  } else if (rst === "DataSource") {
    const id = n.dataSourceId ?? graph.dataSourceId;
    const sources = graph.dataSources || [];
    const exists = id != null && sources.some((d) => Number(d.id) === Number(id));
    if (!exists) {
      reasons.push("منبع پیش‌فرض برای تکرار مشخص نشده");
    }
  } else if (rst === "Elements") {
    if (!n.groupNodeId) {
      reasons.push("تکرار با المان صفحه فقط داخل گروه مجاز است");
    } else {
      const v = validateSelectorBlock(n, { label: "سلکتور تکرار" });
      if (!v.ok) reasons.push(v.reason);
    }
  }
  return { ok: reasons.length === 0, reasons };
}

function validateNodeLeafForPlay(n, graph) {
  if (!n) return { ok: true, reasons: [] };
  if (isActionNode(n)) return validateActionNodeForPlay(n);
  if (n.kind === "condition") return validateConditionNodeForPlay(n);
  if (n.kind === "start") return validateStartNodeForPlay(n, graph);
  return { ok: true, reasons: [] };
}

function graphHasInvalidNodesForPlay(graph) {
  return (graph.nodes || []).some((n) => {
    if (n.kind === "group") return false;
    return !validateNodeLeafForPlay(n, graph).ok;
  });
}

/** Play engine — imported by background via importScripts. */

const RunMode = { Play: 0, Learn: 1 };

let playAbort = false;
let playPaused = false;
let playResumeWaiters = [];
let playLogs = [];
let playTabId = null;
let playStatus = {
  playing: false,
  paused: false,
  taskId: null,
  title: null,
  stepIndex: 0,
  stepTotal: 0,
  loopIndex: 0,
  loopTotal: 1,
  repeatType: "None",
  lastError: null,
  lastResult: null,
  runMode: RunMode.Play,
  logs: [],
  results: []
};

function getPlayStatus() {
  return {
    ok: true,
    ...playStatus,
    paused: !!playPaused,
    logs: playLogs.slice(-80),
    results: Array.isArray(playStatus.results) ? playStatus.results.slice(-80) : []
  };
}

function wakePlayResumeWaiters() {
  const waiters = playResumeWaiters.splice(0);
  for (const resolve of waiters) {
    try { resolve(); } catch { /* ignore */ }
  }
}

function appendPlayLog(level, text) {
  const entry = {
    t: Date.now(),
    level: level || "info",
    text: String(text || "")
  };
  playLogs.push(entry);
  if (playLogs.length > 400) playLogs.splice(0, playLogs.length - 400);
  playStatus.logs = playLogs.slice(-80);
  // Mirror warn/error to the player extension service-worker console.
  const msg = `[DA Player] ${entry.text}`;
  if (entry.level === "error") console.error(msg);
  else if (entry.level === "warn") console.warn(msg);
  broadcastPlayState();
}

function clearPlayLogs() {
  playLogs = [];
  playStatus.logs = [];
  playStatus.results = [];
  playStatus.lastError = null;
  playStatus.lastResult = null;
  broadcastPlayState();
  return getPlayStatus();
}

function broadcastPlayState() {
  const message = { type: "playStateChanged", ...getPlayStatus() };
  if (playTabId) notifyTab(playTabId, message);
  // Keep popup / other listeners in sync via a light fan-out.
  chrome.runtime.sendMessage(message).catch(() => {});
}

/** Inject pause/stop HUD on the play tab (needed for about:blank and after navigations). */
async function injectPlayFab(tabId) {
  if (!tabId) return false;
  try {
    await chrome.scripting.insertCSS({
      target: { tabId },
      files: ["styles/fab.css"]
    }).catch(() => {});
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content/fab.js"]
    });
    notifyTab(tabId, { type: "playStateChanged", ...getPlayStatus() });
    return true;
  } catch {
    return false;
  }
}

async function waitIfPaused() {
  while (playPaused && !playAbort) {
    await new Promise((resolve) => playResumeWaiters.push(resolve));
  }
}

async function sleepInterruptible(ms) {
  const end = Date.now() + Math.max(0, Number(ms) || 0);
  while (Date.now() < end) {
    if (playAbort) return;
    await waitIfPaused();
    if (playAbort) return;
    const left = end - Date.now();
    if (left <= 0) return;
    await sleep(Math.min(200, left));
  }
}

/** Gap after a finished node — from process start (ms). Only when there is a next node. */
function resolveStepDelayMs(graph) {
  const start = (graph?.nodes || []).find((n) => n.kind === "start" && !n.groupNodeId);
  const raw = start?.stepDelayMs ?? graph?.stepDelayMs ?? 0;
  const n = Number(raw);
  return Math.max(0, Number.isFinite(n) ? n : 0);
}

async function delayAfterNode(graph, nextId) {
  if (!nextId) return;
  const ms = resolveStepDelayMs(graph);
  if (ms <= 0) return;
  await sleepInterruptible(ms);
}

/** Process start: highlight border color for targeted elements. */
function resolveHighlightColor(graph) {
  const start = (graph?.nodes || []).find((n) => n.kind === "start" && !n.groupNodeId)
    || (graph?.nodes || []).find((n) => n.kind === "start");
  const raw = start?.highlightColor ?? graph?.highlightColor ?? "#ea5455";
  const s = String(raw || "").trim();
  if (/^#[0-9a-fA-F]{6}$/.test(s)) return s.toLowerCase();
  if (/^#[0-9a-fA-F]{3}$/.test(s)) {
    return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`.toLowerCase();
  }
  return "#ea5455";
}

/** Process start: ignorePlayError defaults to true. */
function resolveIgnorePlayError(graph) {
  const start = (graph?.nodes || []).find((n) => n.kind === "start" && !n.groupNodeId)
    || (graph?.nodes || []).find((n) => n.kind === "start");
  if (start && Object.prototype.hasOwnProperty.call(start, "ignorePlayError")) {
    return start.ignorePlayError !== false;
  }
  if (graph && Object.prototype.hasOwnProperty.call(graph, "ignorePlayError")) {
    return graph.ignorePlayError !== false;
  }
  return true;
}

/** Decide after a non-ignored step failure: next loop index vs abort play. */
function handleStepFailureForLoop(graph, errorMsg) {
  const msg = errorMsg || "خطای اجرا";
  if (resolveIgnorePlayError(graph)) {
    appendPlayLog(
      "warn",
      `چشم‌پوشی از خطای اجرا (نود شروع روشن) — ادامه اندیس بعدی حلقه: ${msg}`
    );
    playStatus.lastError = null;
    return { continueLoop: true };
  }
  playStatus.lastError = msg;
  appendPlayLog(
    "error",
    `توقف اجرا — چشم‌پوشی از خطای اجرا (نود شروع) خاموش: ${msg}`
  );
  return { continueLoop: false };
}

async function stopPlay() {
  playAbort = true;
  playPaused = false;
  playStatus.playing = false;
  playStatus.paused = false;
  wakePlayResumeWaiters();
  appendPlayLog("warn", "اجرا توسط کاربر متوقف شد");
  await chrome.storage.local.set({ playing: false, playTabId: null, playPaused: false });
  broadcastPlayState();
  return getPlayStatus();
}

async function pausePlay() {
  if (!playStatus.playing) return { ok: false, error: "اجرایی در جریان نیست." };
  if (playPaused) return getPlayStatus();
  playPaused = true;
  playStatus.paused = true;
  appendPlayLog("info", "اجرا موقتاً متوقف شد (پاز)");
  try { await chrome.storage.local.set({ playPaused: true }); } catch { /* ignore */ }
  broadcastPlayState();
  return getPlayStatus();
}

async function resumePlay() {
  if (!playStatus.playing) return { ok: false, error: "اجرایی در جریان نیست." };
  if (!playPaused) return getPlayStatus();
  playPaused = false;
  playStatus.paused = false;
  appendPlayLog("info", "ادامه اجرا");
  try { await chrome.storage.local.set({ playPaused: false }); } catch { /* ignore */ }
  wakePlayResumeWaiters();
  broadcastPlayState();
  return getPlayStatus();
}

function appendPlayResult(entry) {
  if (!Array.isArray(playStatus.results)) playStatus.results = [];
  playStatus.results.push(entry);
  if (playStatus.results.length > 80) playStatus.results.shift();
  playStatus.lastResult = entry;
  broadcastPlayState();
}

function processStartNode(graph) {
  return (graph.nodes || []).find((n) => n.kind === "start" && !n.groupNodeId)
    || (graph.nodes || []).find((n) => n.kind === "start")
    || null;
}

/** Resolve process-level iterations from the root start node. */
function resolveProcessIterations(graph) {
  const start = processStartNode(graph);
  const rst = start?.repeatSourceType || graph.repeatSourceType || "None";
  if (rst === "Loops") {
    const n = Math.max(1, Number(start?.loopCount ?? graph.loopCount ?? graph.constantValue) || 1);
    return {
      type: "Loops",
      indices: Array.from({ length: n }, (_, i) => i),
      total: n,
      label: `تعداد ثابت × ${n}`
    };
  }
  if (rst === "DataSource") {
    const dsId = start?.dataSourceId ?? graph.dataSourceId;
    const ds = (graph.dataSources || []).find((d) => Number(d.id) === Number(dsId));
    let count = Number(ds?.rowCount) || 0;
    if (!count && Array.isArray(ds?.cells) && ds.cells.length) {
      const idxs = new Set(
        ds.cells
          .map((c) => Number(c.index ?? c.Index ?? c.rowIndex))
          .filter((x) => Number.isFinite(x))
      );
      count = idxs.size || 0;
    }
    if (!count) {
      return {
        type: "DataSource",
        indices: [0],
        total: 1,
        dataSourceId: dsId,
        label: `منبع پیش‌فرض (بدون ردیف — یک‌بار)`,
        warn: "منبع پیش‌فرض ردیفی ندارد؛ یک‌بار اجرا می‌شود."
      };
    }
    return {
      type: "DataSource",
      indices: Array.from({ length: count }, (_, i) => i),
      total: count,
      dataSourceId: dsId,
      label: `منبع «${ds?.title || dsId}» × ${count} ردیف`
    };
  }
  return { type: "None", indices: [0], total: 1, label: "یک‌بار" };
}

async function listTasks() {
  // Return full task objects (including graph) so portal localStorage stays complete.
  const tasks = await loadUserTasks();
  return { ok: true, tasks };
}

/** True if this tab can host play (http(s) page, not chrome internals). */
async function isReusablePlayTab(url) {
  if (!url) return false;
  if (url.startsWith("chrome://") || url.startsWith("chrome-extension://")) return false;
  if (url.startsWith("edge://") || url.startsWith("devtools://")) return false;
  if (!/^https?:\/\//i.test(url) && url !== "about:blank") return false;
  try {
    const { portalBase } = await chrome.storage.local.get("portalBase");
    const bases = [
      String(portalBase || "").replace(/\/$/, ""),
      "http://localhost:5000",
      "https://localhost:7201",
      "http://127.0.0.1:5000"
    ].filter(Boolean);
    if (bases.some((b) => url.startsWith(b))) return false;
  } catch {
    /* ignore */
  }
  return true;
}

/**
 * تب جدید فقط وقتی از اپ خودمان (پورتال) Start زده شود (openNewTab).
 * از FAB/صفحه هدف → همان تب فعلی؛ در غیر این صورت خطا (تب جدید ساخته نمی‌شود).
 */
async function resolveExecutionTabId(preferredTabId, opts = {}) {
  if (opts.openNewTab === true) {
    const created = await chrome.tabs.create({ url: "about:blank", active: true });
    return created?.id || null;
  }

  const tryTab = async (id) => {
    if (!id) return null;
    try {
      const tab = await chrome.tabs.get(id);
      const url = tab?.url || tab?.pendingUrl || "";
      if (tab?.id && (await isReusablePlayTab(url))) {
        await chrome.tabs.update(tab.id, { active: true }).catch(() => {});
        return tab.id;
      }
    } catch {
      /* ignore */
    }
    return null;
  };

  const fromPreferred = await tryTab(preferredTabId);
  if (fromPreferred) return fromPreferred;

  try {
    const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
    const fromActive = await tryTab(active?.id);
    if (fromActive) return fromActive;
  } catch {
    /* ignore */
  }

  return null;
}

async function startPlay(taskId, tabId, runMode, options) {
  if (playStatus.playing) return { ok: false, error: "پخش در حال اجراست." };
  await checkSession();

  const { recording } = await chrome.storage.local.get("recording");
  if (recording) return { ok: false, error: "ابتدا ضبط را متوقف کنید." };

  const tasks = await loadUserTasks();
  const graph = tasks.find((t) => String(t.id) === String(taskId))?.graph || null;
  if (!graph) {
    return { ok: false, error: "فرآیند در حافظهٔ محلی پیدا نشد." };
  }

  if (graphHasInvalidNodesForPlay(graph)) {
    return { ok: false, error: "در فرایند المان نامعتبر وجود دارد" };
  }

  const opts = options || {};
  const entryId = resolvePlayEntryId(graph, opts);
  if (!entryId) {
    return { ok: false, error: "نود شروع فرآیند پیدا نشد." };
  }
  // Estimate steps along the happy-path (success) for HUD totals; runtime may branch.
  const steps = collectPlaySteps(graph, opts);
  if (steps.length === 0 && !opts.stepNodeId) {
    // Still allow walk — conditions/groups may expand at runtime; but warn if no actions exist at all.
    const anyAction = (graph.nodes || []).some((n) => isActionNode(n));
    if (!anyAction) return { ok: false, error: "هیچ استپی برای اجرا نیست." };
  }
  if (opts.stepNodeId && steps.length === 0) {
    return { ok: false, error: "استپ انتخاب‌شده برای اجرا پیدا نشد." };
  }

  // From FAB/popup on a real page → reuse that tab.
  // From portal (or no usable tab) → fresh about:blank.
  tabId = await resolveExecutionTabId(tabId, opts);
  if (!tabId) {
    return {
      ok: false,
      error: opts.openNewTab
        ? "تب جدید ساخته نشد."
        : "روی صفحهٔ هدف اجرا کنید (از FAB)، یا از پورتال Start بزنید تا تب جدید باز شود."
    };
  }
  await ensurePlayMemory(graph);

  const lastPlayRequest = {
    taskId: String(graph.taskId || taskId || ""),
    runMode: runMode === RunMode.Learn ? RunMode.Learn : RunMode.Play,
    groupNodeId: opts.groupNodeId || null,
    stepNodeId: opts.stepNodeId || null,
    title: graph.title || null
  };
  await chrome.storage.local.set({ lastPlayRequest });

  playAbort = false;
  playPaused = false;
  playResumeWaiters = [];
  // Keep prior logs/results until the user clears them.
  const hadHistory = playLogs.length > 0 || (playStatus.results || []).length > 0;
  playTabId = tabId;
  const iterations = (opts.groupNodeId || opts.stepNodeId)
    ? { type: "None", indices: [0], total: 1, label: "اجرای محدود (بدون تکرار فرآیند)" }
    : resolveProcessIterations(graph);
  const priorResults = Array.isArray(playStatus.results) ? playStatus.results.slice() : [];
  playStatus = {
    playing: true,
    paused: false,
    taskId: graph.taskId || taskId,
    title: graph.title,
    stepIndex: 0,
    stepTotal: Math.max(steps.length, 1),
    loopIndex: 0,
    loopTotal: iterations.total,
    repeatType: iterations.type,
    lastError: null,
    lastResult: null,
    runMode: runMode === RunMode.Learn ? RunMode.Learn : RunMode.Play,
    scope: opts.stepNodeId ? "step" : opts.groupNodeId ? "group" : "task",
    logs: playLogs.slice(-80),
    results: priorResults
  };
  await chrome.storage.local.set({ playing: true, playTabId: tabId, playPaused: false });
  // HUD (pause/stop + results) on the execution tab — including about:blank.
  await injectPlayFab(tabId);
  if (hadHistory) appendPlayLog("info", "──────── اجرای جدید ────────");
  appendPlayLog("info", `شروع اجرا: ${graph.title || taskId}`);
  appendPlayLog("info", `تکرار فرآیند: ${iterations.label}`);
  {
    const gap = resolveStepDelayMs(graph);
    if (gap > 0) appendPlayLog("info", `فاصله بین مراحل: ${gap}ms`);
  }
  appendPlayLog("info", resolveIgnorePlayError(graph)
    ? "چشم‌پوشی از خطای اجرا: روشن (ادامه حلقه با خطا)"
    : "چشم‌پوشی از خطای اجرا: خاموش (توقف با خطا)");
  if (iterations.warn) appendPlayLog("warn", iterations.warn);
  appendPlayLog("info", `پیمایش دیاگرام از «${entryId}» (~${steps.length} اقدام در مسیر موفق)`);

  runPlayLoop(tabId, graph, steps, iterations, opts).catch((err) => {
    playStatus.lastError = err.message || String(err);
    playStatus.playing = false;
    playStatus.paused = false;
    playPaused = false;
    appendPlayLog("error", playStatus.lastError);
    chrome.storage.local.set({ playing: false, playTabId: null, playPaused: false });
    broadcastPlayState();
  });

  return getPlayStatus();
}

async function ensurePlayTab(tabId, steps) {
  try {
    const tab = await chrome.tabs.get(tabId);
    const portal = await portalBase();
    const url = tab.url || "";
    const onPortal = url.startsWith(portal)
      || /:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//i.test(url);
    if (!onPortal) return tabId;
    const nav = steps.find((s) =>
      (s.actionType === "GoToUrl" || s.actionType === "Navigate") && (s.navigateUrl || s.constantValue));
    const target = nav?.navigateUrl || nav?.constantValue || "about:blank";
    const created = await chrome.tabs.create({ url: target, active: true });
    return created.id || tabId;
  } catch {
    return tabId;
  }
}

async function runPlayLoop(tabId, graph, steps, iterations, options) {
  let activeTabId = tabId;
  playTabId = tabId;
  const opts = options || {};
  const iters = iterations || resolveProcessIterations(graph);
  try {
    for (let li = 0; li < iters.indices.length; li++) {
      if (playAbort) break;
      const rowIndex = iters.indices[li];
      playStatus.loopIndex = li + 1;
      playStatus.loopTotal = iters.total;
      appendPlayLog("info", `──── حلقه ${li + 1} / ${iters.total} (اندیس ${rowIndex}) ────`);
      broadcastPlayState();

      // Single-step scope: run only that action.
      if (opts.stepNodeId) {
        const step = (graph.nodes || []).find((n) => n.id === opts.stepNodeId);
        if (!step || !isActionNode(step)) {
          playStatus.lastError = "استپ پیدا نشد.";
          break;
        }
        playStatus.stepIndex = 1;
        playStatus.stepTotal = 1;
        const outcome = await runOneAction(activeTabId, graph, step, rowIndex, li + 1, iters.total, 1, 1);
        if (outcome.tabId) activeTabId = outcome.tabId;
        if (!outcome.ok) {
          const decision = handleStepFailureForLoop(graph, outcome.error);
          if (decision.continueLoop) continue;
          break;
        }
      } else {
        const entryId = resolvePlayEntryId(graph, opts);
        const walked = await executeFlow(activeTabId, graph, entryId, rowIndex, li + 1, iters.total, opts);
        activeTabId = walked.tabId || activeTabId;
        if (walked.stepFailed) {
          const decision = handleStepFailureForLoop(graph, walked.error);
          if (decision.continueLoop) continue;
          break;
        }
      }

      if (playStatus.lastError) break;
    }
    if (!playAbort && !playStatus.lastError) {
      appendPlayLog("info", `اجرا با موفقیت تمام شد (${iters.total} حلقه)`);
    }
  } finally {
    playStatus.playing = false;
    playStatus.paused = false;
    playPaused = false;
    wakePlayResumeWaiters();
    await chrome.storage.local.set({ playing: false, playTabId: null, playPaused: false });
    broadcastPlayState();
  }
}

function resolvePlayEntryId(graph, opts = {}) {
  if (opts.stepNodeId) return opts.stepNodeId;
  if (opts.groupNodeId) {
    const gStart = (graph.nodes || []).find((n) => n.kind === "start" && n.groupNodeId === opts.groupNodeId);
    return gStart?.id || opts.groupNodeId;
  }
  return processStartNode(graph)?.id || null;
}

function flowEdge(edges, fromId, preferredKinds) {
  for (const kind of preferredKinds) {
    const e = edges.find((x) => x.from === fromId && x.kind === kind);
    if (e) return e;
  }
  return null;
}

/**
 * Walk the flow diagram from entryId:
 * start → next, action → next, condition → success|fail, group → inner then next.
 */
async function executeFlow(tabId, graph, entryId, rowIndex, loopIndex, loopTotal, opts = {}) {
  const nodes = new Map((graph.nodes || []).map((n) => [n.id, n]));
  const edges = graph.edges || [];
  let activeTabId = tabId;
  let cur = entryId;
  let guard = 0;
  let stepOrdinal = 0;
  const visited = new Set();

  while (cur && !playAbort && !playStatus.lastError && guard++ < 500) {
    await waitIfPaused();
    if (playAbort) break;

    if (visited.has(cur)) {
      appendPlayLog("warn", `توقف به‌خاطر حلقهٔ تکراری در نود ${cur}`);
      break;
    }
    visited.add(cur);

    const node = nodes.get(cur);
    if (!node) break;

    if (node.kind === "start") {
      const e = flowEdge(edges, cur, ["next"]);
      // No delay after start — first step runs immediately; delay is after real steps.
      cur = e?.to || null;
      continue;
    }

    if (isActionNode(node)) {
      stepOrdinal += 1;
      playStatus.stepIndex = stepOrdinal;
      if (stepOrdinal > playStatus.stepTotal) playStatus.stepTotal = stepOrdinal;
      const outcome = await runOneAction(
        activeTabId, graph, node, rowIndex, loopIndex, loopTotal, stepOrdinal, playStatus.stepTotal
      );
      if (outcome.tabId) {
        activeTabId = outcome.tabId;
        playTabId = activeTabId;
      }
      if (!outcome.ok) {
        // Non-ignored step error → end this iteration (like continue); loop decides next.
        return { tabId: activeTabId, stepFailed: true, error: outcome.error || "خطای مرحله" };
      }
      const nextId = flowEdge(edges, node.id, ["next"])?.to || null;
      // Delay after the step finished, before the next node.
      await delayAfterNode(graph, nextId);
      cur = nextId;
      continue;
    }

    if (node.kind === "condition") {
      // Conditions never fail the run: any exception → false (fail branch).
      let pass = false;
      try {
        pass = await evaluateCondition(activeTabId, node, graph, rowIndex);
      } catch (err) {
        appendPlayLog("warn", `شرط «${node.title || node.id}»: اکسپشن → fail — ${err?.message || err}`);
        pass = false;
      }
      appendPlayLog("info", `شرط «${node.title || node.id}»: ${pass ? "موفق (success)" : "ناموفق (fail)"}`);
      appendPlayResult({
        t: Date.now(),
        loop: loopIndex,
        loopTotal,
        rowIndex,
        step: stepOrdinal,
        stepTotal: playStatus.stepTotal,
        title: node.title || "شرط",
        actionType: "Condition",
        ok: true,
        detail: pass ? "شاخه success" : "شاخه fail"
      });
      const e = flowEdge(edges, cur, pass ? ["success", "next"] : ["fail", "next"]);
      const nextId = e?.to || null;
      await delayAfterNode(graph, nextId);
      cur = nextId;
      continue;
    }

    if (node.kind === "group") {
      appendPlayLog("info", `ورود به گروه «${node.title || node.id}»`);
      const innerEntry = (graph.nodes || []).find((n) => n.kind === "start" && n.groupNodeId === node.id)?.id
        || flowEdge(edges, node.id, ["contains"])?.to
        || findGroupEntryFallback(graph, node.id);
      if (innerEntry) {
        const inner = await executeFlow(activeTabId, graph, innerEntry, rowIndex, loopIndex, loopTotal, {
          ...opts,
          _insideGroupId: node.id
        });
        activeTabId = inner.tabId || activeTabId;
        if (inner.stepFailed) {
          return { tabId: activeTabId, stepFailed: true, error: inner.error || "خطای مرحله" };
        }
        if (playStatus.lastError) break;
      } else {
        appendPlayLog("warn", `گروه «${node.title || node.id}» ورودی ندارد`);
      }
      const nextId = flowEdge(edges, node.id, ["next"])?.to || null;
      await delayAfterNode(graph, nextId);
      cur = nextId;
      continue;
    }

    appendPlayLog("warn", `نود ناشناخته: ${node.kind} (${node.id})`);
    break;
  }

  return { tabId: activeTabId };
}

function findGroupEntryFallback(graph, groupId) {
  const nodes = graph.nodes || [];
  const edges = graph.edges || [];
  const kids = nodes.filter((n) =>
    n.groupNodeId === groupId && (isActionNode(n) || n.kind === "condition" || n.kind === "group")
  );
  if (!kids.length) return null;
  const kidIds = new Set(kids.map((k) => k.id));
  const targeted = new Set(
    edges
      .filter((e) => kidIds.has(e.to) && (e.kind === "next" || e.kind === "success" || e.kind === "fail"))
      .map((e) => e.to)
  );
  const entry = kids.find((k) => !targeted.has(k.id)) || kids[0];
  return entry?.id || null;
}

async function runOneAction(tabId, graph, step, rowIndex, loopIndex, loopTotal, stepIndex, stepTotal) {
  await waitIfPaused();
  if (playAbort) return { ok: false, stepFailed: true, error: "اجرا متوقف شد", tabId };

  const label = step.title || step.actionType || `مرحله ${stepIndex}`;
  appendPlayLog("step", `[حلقه ${loopIndex}] ${stepIndex}/${stepTotal} — ${label}`);
  broadcastPlayState();

  if (step.isActive === false) {
    appendPlayLog("info", `رد شد (غیرفعال): ${label}`);
    appendPlayResult({
      t: Date.now(),
      loop: loopIndex,
      loopTotal,
      rowIndex,
      step: stepIndex,
      stepTotal,
      title: label,
      actionType: step.actionType || "",
      ok: true,
      detail: "غیرفعال — اجرا نشد"
    });
    return { ok: true, skipped: true, inactive: true, tabId };
  }

  const outcome = await runStep(tabId, graph.taskId, step, playStatus.runMode, graph, rowIndex);
  const failed = !outcome?.ok;
  const ignored = failed && step.ignoreError === true;
  const errMsg = outcome?.error || "توقف به‌خاطر واگرایی";
  const reason = outcome?.reason || outcome?.unexpected?.reason || "";
  const errDetail = reason ? `${errMsg} [${reason}]` : errMsg;

  const result = {
    t: Date.now(),
    loop: loopIndex,
    loopTotal,
    rowIndex,
    step: stepIndex,
    stepTotal,
    title: label,
    actionType: step.actionType || "",
    ok: !failed,
    severity: failed ? (ignored ? "warn" : "error") : "ok",
    ignoredError: ignored,
    detail: !failed
      ? (outcome.waitMs ? `انتظار ${outcome.waitMs}ms` : "موفق")
      : (ignored ? `چشم‌پوشی از خطا: ${errDetail}` : errDetail)
  };
  appendPlayResult(result);

  if (failed) {
    if (ignored) {
      appendPlayLog("warn", `چشم‌پوشی از خطای مرحله «${label}»: ${errDetail}`);
      // Continue to next node in the diagram.
      return { ok: true, ignoredError: true, error: errDetail, tabId };
    }
    appendPlayLog("error", `خطا در مرحله «${label}»: ${errDetail}`);
    // End current iteration (caller / loop decides continue vs abort).
    return { ok: false, stepFailed: true, error: errDetail, tabId };
  }

  let activeTabId = tabId;
  if (outcome.tabId && outcome.tabId !== tabId) {
    activeTabId = outcome.tabId;
    playTabId = activeTabId;
    await chrome.storage.local.set({ playTabId: activeTabId });
    await injectPlayFab(activeTabId);
  } else if (outcome.navigated || step.actionType === "GoToUrl" || step.actionType === "Navigate") {
    await injectPlayFab(activeTabId);
  }
  appendPlayLog("ok", `انجام شد: ${label}`);
  // Action-specific wait (e.g. WaitTime). Inter-node gap is applied by executeFlow.
  if (outcome.waitMs) await sleepInterruptible(outcome.waitMs);
  return { ok: true, tabId: activeTabId };
}

async function evaluateCondition(tabId, node, graph, rowIndex) {
  const ct = node.conditionType || "None";
  try {
    if (ct === "None") return true;

    if (ct === "Url") {
      let actual = "";
      try {
        const tab = await chrome.tabs.get(tabId);
        actual = tab.url || "";
      } catch {
        return false;
      }
      const expected = await resolveConditionCompareValue(tabId, node, graph, rowIndex, { preferUrl: true });
      return compareConditionValues(actual, expected, node.equalityType || "equal");
    }

    if (ct === "DriverTabs") {
      let count = 0;
      try {
        const tabs = await chrome.tabs.query({});
        count = tabs.filter((t) => t.id).length;
      } catch {
        return false;
      }
      const expected = Number(
        node.constantEqualValue ?? node.constantValue ?? node.navigation
      ) || 0;
      return compareConditionValues(count, expected, node.equalityType || "equal");
    }

    if (ct === "FindElement" || ct === "NotFindElement") {
      const selector = resolveDynamicSelector(node, graph, rowIndex) || node.selectorValue || "";
      if (!selector) return ct === "NotFindElement";
      const waitMs = node.selectorWaitEnabled === true
        ? Math.max(0, Number(node.selectorWaitMs) || 10000)
        : 0;
      const found = await elementExistsInTab(tabId, selector, parseFramePath(node.framePathJson), waitMs);
      return ct === "FindElement" ? !!found : !found;
    }

    if (ct === "FindElements") {
      const selector = resolveDynamicSelector(node, graph, rowIndex) || node.selectorValue || "";
      const count = selector ? await elementCountInTab(tabId, selector, parseFramePath(node.framePathJson)) : 0;
      const expected = Number(
        node.constantEqualValue ?? node.constantValue ?? node.navigation
      ) || 0;
      return compareConditionValues(count, expected, node.equalityType || "equal");
    }

    if (ct === "ElementValue" || ct === "SourceValue") {
      const left = ct === "SourceValue"
        ? (resolveStepParam(node, graph, rowIndex) || "")
        : (await readElementText(tabId, node, graph, rowIndex));
      const right = await resolveConditionCompareValue(tabId, node, graph, rowIndex);
      return compareConditionValues(left, right, node.equalityType || "equal");
    }

    // Unknown type — take success path so flow continues.
    appendPlayLog("info", `نوع شرط پشتیبانی‌نشده: ${ct} — شاخه success`);
    return true;
  } catch (err) {
    // Never surface as play error: exception ≡ fail branch; details as warning only.
    const detail = err?.stack || err?.message || String(err);
    appendPlayLog("warn", `ارزیابی شرط با اکسپشن → fail — ${detail}`);
    return false;
  }
}

/** Resolve the compare operand for a condition; failures yield "" (never throw as play error). */
async function resolveConditionCompareValue(tabId, node, graph, rowIndex, opts = {}) {
  try {
    const src = node.contentSourceType || "Constant";
    if (src === "System") {
      return resolveSystemValue(node.systemValueType || "CurrentDateTime");
    }
    if (src === "Memory") {
      const name = String(node.memoryVariableName || node.sourceMemoryVariableName || "").trim();
      if (!name) return "";
      const vars = await getPlayMemoryVars();
      return vars[name] != null ? String(vars[name]) : "";
    }
    if (src === "DataSource") {
      return resolveStepParam(node, graph, rowIndex) || node.constantEqualValue || node.constantValue || "";
    }
    if (src === "Elements") {
      const sel = resolveDynamicSelector(node, graph, rowIndex, {
        valueKey: "equalSelectorValue",
        dynFlag: "equalSelectorIsDynamic",
        dynDs: "equalSelectorDataSourceId",
        dynCol: "equalSelectorDynamicColumn",
        hasAttr: "equalHasAttribute",
        attrName: "equalAttributeName",
        attrDynFlag: "equalAttributeValueIsDynamic",
        attrValue: "equalAttributeValue",
        attrDynCol: "equalAttributeDynamicColumn",
        attrDynDs: "equalAttributeDataSourceId"
      }) || node.equalSelectorValue || "";
      if (!sel) return "";
      const framePath = parseFramePath(node.framePathJson);
      try {
        const frameId = await resolveFramePath(tabId, framePath);
        const [{ result } = {}] = await chrome.scripting.executeScript({
          target: { tabId, frameIds: [frameId] },
          func: (s) => {
            try {
              const el = document.querySelector(s);
              if (!el) return "";
              if (el.value != null) return String(el.value);
              return (el.textContent || "").trim();
            } catch {
              return "";
            }
          },
          args: [sel]
        }) || [];
        return result == null ? "" : String(result);
      } catch {
        return "";
      }
    }
    if (opts.preferUrl) {
      return node.navigation || node.constantEqualValue || node.constantValue || "";
    }
    return node.constantEqualValue || node.constantValue || node.navigation || "";
  } catch {
    return "";
  }
}

function compareConditionValues(left, right, equalityType) {
  try {
    const a = left == null ? "" : String(left);
    const b = right == null ? "" : String(right);
    const eqRaw = String(equalityType || "equal").trim();
    const eq = eqRaw.toLowerCase().replace(/[_\s-]+/g, "");

    if (eq === "hasvalue") return a.trim() !== "";
    if (eq === "hasnotvalue") return a.trim() === "";

    if (eq === "notequal" || eq === "!=") return a !== b;
    if (eq === "contain" || eq === "contains") return a.includes(b);
    if (eq === "notcontain" || eq === "notcontains") return !a.includes(b);
    if (eq === "startswith") return a.startsWith(b);
    if (eq === "endswith") return a.endsWith(b);

    if (eq === "biggerthan" || eq === "gt" || eq === ">") {
      const na = Number(a);
      const nb = Number(b);
      if (Number.isNaN(na) || Number.isNaN(nb)) return false;
      return na > nb;
    }
    if (eq === "smallerthan" || eq === "lt" || eq === "<") {
      const na = Number(a);
      const nb = Number(b);
      if (Number.isNaN(na) || Number.isNaN(nb)) return false;
      return na < nb;
    }
    if (eq === "gte" || eq === ">=") {
      const na = Number(a);
      const nb = Number(b);
      if (Number.isNaN(na) || Number.isNaN(nb)) return false;
      return na >= nb;
    }
    if (eq === "lte" || eq === "<=") {
      const na = Number(a);
      const nb = Number(b);
      if (Number.isNaN(na) || Number.isNaN(nb)) return false;
      return na <= nb;
    }

    return a === b;
  } catch {
    return false;
  }
}

async function elementExistsInTab(tabId, selector, framePath, waitTimeoutMs = 0) {
  try {
    const frameId = await resolveFramePath(tabId, framePath || []);
    const maxMs = Math.max(0, Number(waitTimeoutMs) || 0);
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId, frameIds: [frameId] },
      func: async (sel, timeoutMs) => {
        const deadline = Date.now() + Math.max(0, Number(timeoutMs) || 0);
        for (;;) {
          try {
            if (document.querySelector(sel)) return true;
          } catch {
            return false;
          }
          if (Date.now() >= deadline) return false;
          await new Promise((r) => setTimeout(r, 100));
        }
      },
      args: [selector, maxMs]
    });
    return !!result;
  } catch {
    return false;
  }
}

async function elementCountInTab(tabId, selector, framePath) {
  try {
    const frameId = await resolveFramePath(tabId, framePath || []);
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId, frameIds: [frameId] },
      func: (sel) => {
        try { return document.querySelectorAll(sel).length; } catch { return 0; }
      },
      args: [selector]
    });
    return Number(result) || 0;
  } catch {
    return 0;
  }
}

async function readElementText(tabId, node, graph, rowIndex) {
  const selector = resolveDynamicSelector(node, graph, rowIndex) || node.selectorValue || "";
  if (!selector) return "";
  try {
    const frameId = await resolveFramePath(tabId, parseFramePath(node.framePathJson));
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId, frameIds: [frameId] },
      func: (sel) => {
        const el = document.querySelector(sel);
        if (!el) return "";
        if (el.value != null) return String(el.value);
        return (el.textContent || "").trim();
      },
      args: [selector]
    });
    return result == null ? "" : String(result);
  } catch {
    return "";
  }
}

async function closeWindowTab(currentTabId, which) {
  let tab;
  try {
    tab = await chrome.tabs.get(currentTabId);
  } catch {
    return { ok: false, error: "تب فعلی پیدا نشد.", reason: "tab_missing" };
  }
  const winId = tab.windowId;
  const tabs = await chrome.tabs.query({ windowId: winId });
  const ordered = tabs.slice().sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  if (ordered.length <= 1) {
    return { ok: false, error: "فقط یک تب باز است؛ قابل بستن نیست.", reason: "last_tab" };
  }
  const target = which === "first" ? ordered[0] : ordered[ordered.length - 1];
  const next = ordered.find((t) => t.id !== target.id) || ordered[0];
  await chrome.tabs.remove(target.id);
  const continueId = target.id === currentTabId ? next.id : currentTabId;
  if (continueId) {
    try { await chrome.tabs.update(continueId, { active: true }); } catch { /* ignore */ }
  }
  return { ok: true, tabId: continueId };
}

async function runStep(tabId, taskId, step, runMode, graph, rowIndex) {
  const actionType = step.actionType || "Click";
  const framePath = parseFramePath(step.framePathJson);
  const resolvedSelector = resolveDynamicSelector(step, graph, rowIndex ?? 0);
  const resolvedValue = resolveStepParam(step, graph, rowIndex ?? 0);
  const resolvedUrl = resolveStepParam(step, graph, rowIndex ?? 0, { preferUrl: true });

  if (actionType === "CloseFirstTab" || actionType === "CloseLastTab") {
    return closeWindowTab(tabId, actionType === "CloseFirstTab" ? "first" : "last");
  }

  if (actionType === "NewPage") {
    let url = resolvedUrl || "about:blank";
    const cst0 = step.contentSourceType || "";
    if (cst0 === "Memory" || cst0 === "Elements" || cst0 === "System") {
      url = (await resolveStepParamAsync(step, graph, rowIndex ?? 0, { tabId, framePath })) || "about:blank";
    }
    const created = await chrome.tabs.create({ url, active: true });
    const newId = created.id;
    if (newId) await waitTabComplete(newId);
    return { ok: true, tabId: newId, navigated: true };
  }

  if (actionType === "GoToUrl" || actionType === "Navigate") {
    let url = resolvedUrl;
    const cst0 = step.contentSourceType || "";
    if (cst0 === "Memory" || cst0 === "Elements" || cst0 === "System") {
      url = await resolveStepParamAsync(step, graph, rowIndex ?? 0, { tabId, framePath });
    }
    if (!url) {
      return onUnexpected(runMode, {
        taskId,
        stepId: step.entityId,
        reason: "missing_url",
        expectedSelector: resolvedSelector,
        actualUrl: null,
        framePathJson: step.framePathJson
      });
    }
    await chrome.tabs.update(tabId, { url });
    await waitTabComplete(tabId);
    return { ok: true };
  }

  if (actionType === "WaitTime") {
    let ms = Number(resolvedValue) || 0;
    const cst0 = step.contentSourceType || "";
    if (cst0 === "Memory" || cst0 === "DataSource" || cst0 === "System") {
      const v = await resolveStepParamAsync(step, graph, rowIndex ?? 0, { tabId, framePath });
      ms = Number(v) || 0;
    }
    return { ok: true, waitMs: ms };
  }

  // Insert/Load/Input value from Memory, Elements, or System
  let valueForAction = resolvedValue;
  const cst = step.contentSourceType || "";
  if ((actionType === "InsertContent" || actionType === "LoadContent" || actionType === "InputContent")
    && (cst === "Memory" || cst === "Elements" || cst === "System")) {
    valueForAction = await resolveStepParamAsync(step, graph, rowIndex ?? 0, { tabId, framePath });
  }

  const isCapture = actionType === "TakeContent" || actionType === "SaveContent";
  if (isCapture) {
    return runCaptureStep(tabId, taskId, step, runMode, graph, rowIndex, framePath);
  }

  let frameId;
  try {
    frameId = await resolveFramePath(tabId, framePath);
  } catch (err) {
    return onUnexpected(runMode, {
      taskId,
      stepId: step.entityId,
      reason: "frame_resolve_failed",
      expectedSelector: resolvedSelector,
      actualUrl: null,
      framePathJson: step.framePathJson || JSON.stringify(framePath)
    }, err.message);
  }

  const waitTimeoutMs = step.selectorWaitEnabled === true
    ? Math.max(0, Number(step.selectorWaitMs) || 10000)
    : 0;
  const payload = {
    actionType,
    selectorValue: resolvedSelector,
    constantValue: valueForAction,
    navigateUrl: step.navigateUrl,
    highlightColor: resolveHighlightColor(graph),
    waitTimeoutMs
  };

  let result = await chrome.tabs
    .sendMessage(tabId, { type: "playExecute", payload }, { frameId })
    .catch(() => null);

  if (!result) {
    result = await executeInFrame(tabId, frameId, payload);
  }

  if (!result || !result.ok) {
    return onUnexpected(runMode, {
      taskId,
      stepId: step.entityId,
      reason: result?.reason || "action_failed",
      expectedSelector: resolvedSelector,
      actualUrl: result?.url || null,
      framePathJson: step.framePathJson || JSON.stringify(framePath)
    }, result?.error);
  }

  if (result.navigated) await waitTabComplete(tabId);
  return result;
}

/** Capture/save: resolve value from source, then store to Memory or DataSource. */
async function runCaptureStep(tabId, taskId, step, runMode, graph, rowIndex, framePath) {
  // Migrate legacy: contentSourceType was destination.
  if (!step.saveTargetType && (step.contentSourceType === "Memory" || step.contentSourceType === "DataSource")) {
    step.saveTargetType = step.contentSourceType;
    step.contentSourceType = "Elements";
  }
  const src = step.contentSourceType || "Elements";
  let text = "";

  if (src === "Elements") {
    const resolvedSelector = resolveDynamicSelector(step, graph, rowIndex ?? 0);
    if (!resolvedSelector) {
      return onUnexpected(runMode, {
        taskId, stepId: step.entityId, reason: "missing_selector",
        expectedSelector: "", actualUrl: null, framePathJson: step.framePathJson
      }, "سلکتور المان خالی است");
    }
    let frameId;
    try {
      frameId = await resolveFramePath(tabId, framePath || []);
    } catch (err) {
      return onUnexpected(runMode, {
        taskId, stepId: step.entityId, reason: "frame_resolve_failed",
        expectedSelector: resolvedSelector, actualUrl: null,
        framePathJson: step.framePathJson
      }, err.message);
    }
    const waitTimeoutMs = step.selectorWaitEnabled === true
      ? Math.max(0, Number(step.selectorWaitMs) || 10000)
      : 0;
    const payload = {
      actionType: "TakeContent",
      selectorValue: resolvedSelector,
      constantValue: "",
      highlightColor: resolveHighlightColor(graph),
      waitTimeoutMs
    };
    let result = await chrome.tabs
      .sendMessage(tabId, { type: "playExecute", payload }, { frameId })
      .catch(() => null);
    if (!result) result = await executeInFrame(tabId, frameId, payload);
    if (!result || !result.ok) {
      return onUnexpected(runMode, {
        taskId, stepId: step.entityId,
        reason: result?.reason || "action_failed",
        expectedSelector: resolvedSelector,
        actualUrl: result?.url || null,
        framePathJson: step.framePathJson
      }, result?.error);
    }
    text = result.text != null ? String(result.text) : "";
  } else {
    text = await resolveStepParamAsync(step, graph, rowIndex ?? 0, {
      tabId,
      framePath,
      memoryNameKey: src === "Memory" ? "sourceMemoryVariableName" : "memoryVariableName"
    });
  }

  const store = await storeCapturedContent(step, graph, text, rowIndex ?? 0);
  if (!store.ok) {
    return onUnexpected(runMode, {
      taskId, stepId: step.entityId,
      reason: store.reason || "capture_store_failed",
      expectedSelector: step.selectorValue || null,
      actualUrl: null,
      framePathJson: step.framePathJson
    }, store.error);
  }
  return { ok: true, text, captured: true };
}

function resolveDynamicSelector(step, graph, rowIndex, opts = {}) {
  const valueKey = opts.valueKey || "selectorValue";
  const dynFlag = opts.dynFlag || "selectorIsDynamic";
  const dynDs = opts.dynDs || "selectorDataSourceId";
  const dynCol = opts.dynCol || "selectorDynamicColumn";

  let sel = step[valueKey] || "";
  if (!sel) return sel;
  const hasLegacy = /\{\{[^}]+\}\}/.test(sel);
  const hasPh = sel.includes(DYN_SEL_PLACEHOLDER);
  if (step[dynFlag] || hasLegacy || hasPh) {
    const sources = graph?.dataSources || [];
    let ds = null;
    if (step[dynDs] != null) {
      ds = sources.find((d) => Number(d.id) === Number(step[dynDs])) || null;
    }
    if (!ds) ds = findDataSourceForStep(step, graph);
    const row = rowIndex ?? 0;
    const col = step[dynCol];

    if (hasPh) {
      const val = (col && ds)
        ? (cellValue(ds, col, row, { emitRead: true, graph, stepTitle: step?.title }) ?? "")
        : "";
      sel = sel.split(DYN_SEL_PLACEHOLDER).join(val);
    }
    if (/\{\{[^}]+\}\}/.test(sel)) {
      sel = sel.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, key) =>
        cellValue(ds, key, row, { emitRead: true, graph, stepTitle: step?.title }) ?? "");
    }
  }
  return appendAttributeFilter(sel, step, graph, rowIndex, opts);
}

/** Appends [attr="value"] when hasAttribute (or equalHasAttribute) is on. */
function appendAttributeFilter(sel, step, graph, rowIndex, opts = {}) {
  const hasAttrKey = opts.hasAttr || "hasAttribute";
  if (!step[hasAttrKey] || !sel) return sel;
  const attrName = String(step[opts.attrName || "attributeName"] || "").trim();
  if (!attrName) return sel;

  const attrDynFlag = opts.attrDynFlag || "attributeValueIsDynamic";
  let attrVal = "";
  if (step[attrDynFlag]) {
    const dynDsKey = opts.attrDynDs || "attributeDataSourceId";
    const dynColKey = opts.attrDynCol || "attributeDynamicColumn";
    const sources = graph?.dataSources || [];
    let ds = null;
    if (step[dynDsKey] != null) {
      ds = sources.find((d) => Number(d.id) === Number(step[dynDsKey])) || null;
    }
    if (!ds) ds = findDataSourceForStep(step, graph);
    attrVal = cellValue(ds, step[dynColKey], rowIndex ?? 0, {
      emitRead: true, graph, stepTitle: step?.title
    }) ?? "";
  } else {
    attrVal = step[opts.attrValue || "attributeValue"] ?? "";
  }
  const escapedName = String(attrName).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const escapedVal = String(attrVal).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `${sel}[${escapedName}="${escapedVal}"]`;
}

function resolveSystemValue(kind) {
  const k = String(kind || "CurrentDateTime");
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  if (k === "CurrentDate") {
    try { return d.toLocaleDateString("fa-IR"); } catch { return d.toISOString().slice(0, 10); }
  }
  if (k === "CurrentTime") {
    try { return d.toLocaleTimeString("fa-IR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }); }
    catch { return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; }
  }
  if (k === "CurrentDateTime") {
    try { return d.toLocaleString("fa-IR"); } catch { return d.toISOString(); }
  }
  if (k === "Timestamp") return String(Date.now());
  if (k === "Uuid") {
    try {
      if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
    } catch { /* ignore */ }
    return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
  if (k === "RandomInt") return String(Math.floor(Math.random() * 1e9));
  return "";
}

function resolveStepParam(step, graph, rowIndex, opts = {}) {
  const cst = step.contentSourceType || "";
  if (cst === "System") {
    return resolveSystemValue(step.systemValueType || "CurrentDateTime");
  }
  if (cst === "DataSource" || step?.valueFromSource || (step?.dataSourceId && step?.dynamicSourceColumnName && cst !== "Memory" && cst !== "Elements" && cst !== "System")) {
    const ds = findDataSourceForValue(step, graph);
    const v = cellValue(ds, step.dynamicSourceColumnName, rowIndex ?? 0, {
      emitRead: true, graph, stepTitle: step?.title
    });
    if (v != null && String(v).trim() !== "") return String(v);
  }
  const raw = opts.preferUrl
    ? (step.navigateUrl || step.constantValue || "")
    : (step.constantValue || step.navigateUrl || "");
  return resolveDynamicText(raw, step, graph, rowIndex ?? 0);
}

async function resolveStepParamAsync(step, graph, rowIndex, opts = {}) {
  const cst = step.contentSourceType || "";
  if (cst === "System") {
    return resolveSystemValue(step.systemValueType || "CurrentDateTime");
  }
  if (cst === "Memory") {
    const nameKey = opts.memoryNameKey || "memoryVariableName";
    const name = String(step[nameKey] || step.memoryVariableName || "").trim();
    if (!name) return "";
    const vars = await getPlayMemoryVars();
    return vars[name] != null ? String(vars[name]) : "";
  }
  if (cst === "Elements") {
    const tabId = opts.tabId;
    if (!tabId) return "";
    const valueSel = resolveDynamicSelector(step, graph, rowIndex ?? 0, {
      valueKey: "equalSelectorValue",
      dynFlag: "equalSelectorIsDynamic",
      dynDs: "equalSelectorDataSourceId",
      dynCol: "equalSelectorDynamicColumn",
      hasAttr: "equalHasAttribute",
      attrName: "equalAttributeName",
      attrDynFlag: "equalAttributeValueIsDynamic",
      attrValue: "equalAttributeValue",
      attrDynCol: "equalAttributeDynamicColumn",
      attrDynDs: "equalAttributeDataSourceId"
    });
    if (!valueSel) return "";
    let frameId;
    try {
      frameId = await resolveFramePath(tabId, opts.framePath || []);
    } catch {
      frameId = 0;
    }
    const payload = {
      actionType: "TakeContent",
      selectorValue: valueSel,
      constantValue: "",
      waitTimeoutMs: step.equalSelectorWaitEnabled === true
        ? Math.max(0, Number(step.equalSelectorWaitMs) || 10000)
        : 0
    };
    let result = await chrome.tabs
      .sendMessage(tabId, { type: "playExecute", payload }, { frameId })
      .catch(() => null);
    if (!result) result = await executeInFrame(tabId, frameId, payload);
    return result?.text != null ? String(result.text) : "";
  }
  return resolveStepParam(step, graph, rowIndex, opts);
}

const PLAY_MEMORY_SCHEMA = 1;

function memoryStructureKey(graph) {
  const parts = (graph?.nodes || [])
    .filter((n) => isActionNode(n))
    .map((n) => [
      n.id,
      n.actionType || "",
      n.contentSourceType || "",
      n.memoryVariableName || "",
      n.dataSourceId ?? "",
      n.dynamicSourceColumnName || ""
    ].join(":"))
    .sort();
  return `${PLAY_MEMORY_SCHEMA}|${graph?.taskId || ""}|${parts.join("|")}`;
}

async function clearPlayMemory(reason) {
  await chrome.storage.local.remove("playMemory");
  if (reason) console.info("[DA] playMemory cleared:", reason);
  return { ok: true };
}

async function ensurePlayMemory(graph) {
  const key = memoryStructureKey(graph);
  const { playMemory } = await chrome.storage.local.get("playMemory");
  if (!playMemory
    || playMemory.schema !== PLAY_MEMORY_SCHEMA
    || playMemory.structureKey !== key) {
    await chrome.storage.local.set({
      playMemory: { schema: PLAY_MEMORY_SCHEMA, structureKey: key, vars: {} }
    });
    if (playMemory) console.info("[DA] playMemory reset (structure/schema change)");
  }
}

async function getPlayMemoryVars() {
  const { playMemory } = await chrome.storage.local.get("playMemory");
  return playMemory?.vars || {};
}

async function setPlayMemoryVar(name, value) {
  const key = String(name || "").trim();
  if (!key) return { ok: false, error: "نام متغیر خالی است.", reason: "missing_memory_name" };
  const { playMemory } = await chrome.storage.local.get("playMemory");
  const mem = playMemory && playMemory.schema === PLAY_MEMORY_SCHEMA
    ? playMemory
    : { schema: PLAY_MEMORY_SCHEMA, structureKey: "", vars: {} };
  mem.vars = mem.vars || {};
  mem.vars[key] = value == null ? "" : String(value);
  await chrome.storage.local.set({ playMemory: mem });
  return { ok: true };
}

async function storeCapturedContent(step, graph, text, rowIndex) {
  let dest = step.saveTargetType || "";
  if (!dest) {
    // Legacy: contentSourceType was destination before value-source split.
    dest = (step.contentSourceType === "DataSource") ? "DataSource" : "Memory";
  }
  if (dest === "DataSource") {
    const dsId = step.saveDataSourceId != null ? step.saveDataSourceId : step.dataSourceId;
    const col = step.saveColumnName || step.dynamicSourceColumnName;
    const sources = graph?.dataSources || [];
    const ds = (dsId != null && sources.find((d) => Number(d.id) === Number(dsId)))
      || findDataSourceForValue(step, graph);
    if (!ds || !col) {
      return { ok: false, error: "منبع/ستون مقصد ذخیره مشخص نیست.", reason: "missing_save_target" };
    }
    ds.cells = ds.cells || [];
    const idx = Number(rowIndex) || 0;
    const hit = ds.cells.find((c) =>
      (c.key === col || c.Key === col || c.columnName === col)
      && Number(c.index ?? c.Index ?? c.rowIndex) === idx
    );
    if (hit) {
      if (hit.cellValue !== undefined) hit.cellValue = text;
      else if (hit.CellValue !== undefined) hit.CellValue = text;
      else hit.value = text;
    } else {
      ds.cells.push({ key: col, index: idx, cellValue: text });
    }
    const rc = Number(ds.rowCount) || 0;
    if (idx + 1 > rc) ds.rowCount = idx + 1;
    emitDataSourceCellEvent(graph, ds, col, idx, "write", text, step?.title);
    persistPlayDataSources(graph).catch(() => {});
    return { ok: true };
  }
  return setPlayMemoryVar(step.memoryVariableName || step.constantValue, text);
}

function cellValue(ds, columnKey, rowIndex, opts = {}) {
  if (!ds || !columnKey) return null;
  const key = String(columnKey).trim();
  const cells = ds.cells || [];
  const hit = cells.find((c) =>
    (c.key === key || c.Key === key || c.columnName === key)
    && Number(c.index ?? c.Index ?? c.rowIndex) === Number(rowIndex)
  );
  const val = hit ? (hit.cellValue ?? hit.CellValue ?? hit.value ?? "") : null;
  if (opts.emitRead && opts.graph && val != null) {
    emitDataSourceCellEvent(opts.graph, ds, key, rowIndex, "read", val, opts.stepTitle);
  }
  return val;
}

async function emitDataSourceCellEvent(graph, ds, columnKey, rowIndex, op, cellValue, stepTitle) {
  try {
    const taskId = String(graph?.taskId || playStatus.taskId || "").trim();
    const dsId = Number(ds?.id || 0);
    if (!taskId || !dsId || !columnKey) return;
    const payload = {
      taskId,
      dataSourceId: dsId,
      op: op === "write" ? "write" : "read",
      columnKey: String(columnKey),
      rowIndex: Number(rowIndex) || 0,
      cellValue: cellValue == null ? null : String(cellValue),
      stepTitle: stepTitle || null
    };
    // Fan-out to open portal/editor tabs (fast local path).
    try {
      chrome.runtime.sendMessage({ type: "broadcastDsCellEvent", event: payload }).catch(() => {});
    } catch { /* ignore */ }
    // SignalR path via portal HTTP.
    const portal = typeof portalBase === "function"
      ? await portalBase().catch(() => null)
      : null;
    const base = String(portal || "").replace(/\/$/, "");
    if (!base) return;
    fetch(`${base}/Panel/Tasks/NotifyCellEvent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload),
      credentials: "omit"
    }).catch(() => {});
  } catch { /* ignore */ }
}

async function persistPlayDataSources(graph) {
  const taskId = String(graph?.taskId || playStatus.taskId || "").trim();
  if (!taskId || !Array.isArray(graph?.dataSources)) return;
  try {
    await chrome.runtime.sendMessage({
      type: "persistPlayDataSources",
      taskId,
      dataSources: graph.dataSources
    });
  } catch { /* ignore */ }
}

function findDataSourceForStep(step, graph) {
  const sources = graph?.dataSources || [];
  const group = step.groupNodeId
    ? (graph.nodes || []).find((n) => n.id === step.groupNodeId)
    : null;
  const start = (graph.nodes || []).find((n) => n.kind === "start");
  const sid = step.selectorDataSourceId
    || step.dataSourceId
    || group?.dataSourceId
    || start?.dataSourceId
    || graph.dataSourceId
    || null;
  if (sid != null) {
    const found = sources.find((d) => Number(d.id) === Number(sid));
    if (found) return found;
  }
  return sources[0] || null;
}

function resolveDynamicText(text, step, graph, rowIndex) {
  if (text == null || text === "") {
    // Value-from-source without embedding token in constantValue
    if (step?.dynamicSourceColumnName) {
      const ds = findDataSourceForValue(step, graph);
      const v = cellValue(ds, step.dynamicSourceColumnName, rowIndex ?? 0, {
        emitRead: true, graph, stepTitle: step?.title
      });
      return v != null ? String(v) : "";
    }
    return text || "";
  }
  if (typeof text !== "string") return text || "";
  if (!/\{\{[^}]+\}\}/.test(text)) return text;
  const ds = findDataSourceForValue(step, graph) || findDataSourceForStep(step, graph);
  return text.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, key) =>
    cellValue(ds, key, rowIndex ?? 0, { emitRead: true, graph, stepTitle: step?.title }) ?? "");
}

function findDataSourceForValue(step, graph) {
  const sources = graph?.dataSources || [];
  if (step?.dataSourceId != null) {
    const found = sources.find((d) => Number(d.id) === Number(step.dataSourceId));
    if (found) return found;
  }
  return findDataSourceForStep(step, graph);
}

/**
 * Shared hook for Play vs Learn. Phase 3: Play stops with error.
 * Learn: reserved pauseForUser stub — no learning logic yet.
 */
async function onUnexpected(runMode, state, detail) {
  const message = detail
    ? `${state.reason}: ${detail}`
    : state.reason || "unexpected";

  if (runMode === RunMode.Learn) {
    await pauseForUser(state);
    return { ok: false, error: "Learn Mode هنوز پیاده نشده است.", unexpected: state };
  }

  return { ok: false, error: message, unexpected: state };
}

/** Phase 5 reserved — do not implement learn behavior here. */
async function pauseForUser(_state) {
  // Reserved for Learn Mode UI / wait loop.
}

function collectPlaySteps(graph, opts = {}) {
  // Happy-path estimate: walk start → next, conditions → success, groups → inner.
  const nodes = new Map((graph.nodes || []).map((n) => [n.id, n]));
  const edges = graph.edges || [];
  const steps = [];
  const seen = new Set();

  function walk(nodeId, depth) {
    if (!nodeId || depth > 400 || seen.has(nodeId)) return;
    seen.add(nodeId);
    const node = nodes.get(nodeId);
    if (!node) return;

    if (node.kind === "start") {
      const e = flowEdge(edges, nodeId, ["next"]);
      if (e) walk(e.to, depth + 1);
      return;
    }
    if (isActionNode(node)) {
      steps.push(node);
      const e = flowEdge(edges, nodeId, ["next"]);
      if (e) walk(e.to, depth + 1);
      return;
    }
    if (node.kind === "condition") {
      const e = flowEdge(edges, nodeId, ["success", "next"]);
      if (e) walk(e.to, depth + 1);
      return;
    }
    if (node.kind === "group") {
      const gStart = [...nodes.values()].find((n) => n.kind === "start" && n.groupNodeId === node.id);
      const contains = flowEdge(edges, nodeId, ["contains"]);
      if (gStart) walk(gStart.id, depth + 1);
      else if (contains) walk(contains.to, depth + 1);
      else {
        const entry = findGroupEntryFallback(graph, node.id);
        if (entry) walk(entry, depth + 1);
      }
      const after = flowEdge(edges, nodeId, ["next"]);
      if (after) walk(after.to, depth + 1);
    }
  }

  if (opts.stepNodeId) {
    const n = nodes.get(opts.stepNodeId);
    if (n && isActionNode(n)) return [n];
    return [];
  }

  const entry = resolvePlayEntryId(graph, opts);
  if (entry) walk(entry, 0);

  if (steps.length === 0 && !opts.groupNodeId) {
    // Last resort: every action in root scope (no groupNodeId); inactive still counted for logs.
    for (const n of graph.nodes || []) {
      if (isActionNode(n) && !n.groupNodeId) steps.push(n);
    }
  }
  return steps;
}

/** Phase 4 hook — do not call from Play MVP yet. */
async function expandGroupByRepeatSource(_tabId, group) {
  const type = (group.repeatSourceType || "None").toLowerCase();
  if (type === "none" || !type) return [0];
  if (type === "loops") {
    const n = Math.max(1, Number(group.loopCount ?? group.constantValue) || 1);
    return Array.from({ length: n }, (_, i) => i);
  }
  // DataSource / Elements: reserved until play expands by rowCount / querySelectorAll.
  // MoveLoop=false → independent index stack (restore parent index on exit).
  return [0];
}

function parseFramePath(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map(normalizeHop);
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(normalizeHop) : [];
  } catch {
    return [];
  }
}

function normalizeHop(hop) {
  if (!hop || typeof hop !== "object") return { by: "CssSelector", value: "", srcHint: null, indexInParent: null };
  return {
    by: hop.by || hop.By || "CssSelector",
    value: hop.value || hop.Value || "",
    srcHint: hop.srcHint || hop.SrcHint || null,
    indexInParent:
      hop.indexInParent != null
        ? hop.indexInParent
        : hop.IndexInParent != null
          ? hop.IndexInParent
          : null
  };
}

async function resolveFramePath(tabId, framePath) {
  if (!framePath || framePath.length === 0) return 0;

  let currentFrameId = 0;

  for (const hop of framePath) {
    const frames = await chrome.webNavigation.getAllFrames({ tabId });
    if (!frames) throw new Error("لیست فریم‌ها در دسترس نیست.");

    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId, frameIds: [currentFrameId] },
      func: matchChildIframe,
      args: [hop]
    });
    if (!result) throw new Error(`فریم پیدا نشد: ${hop.value || hop.srcHint || hop.indexInParent}`);

    const children = frames.filter((f) => f.parentFrameId === currentFrameId);
    let child =
      (result.src &&
        children.find(
          (c) =>
            c.url === result.src ||
            c.url.startsWith(result.src) ||
            (hop.srcHint && (c.url.includes(hop.srcHint) || hop.srcHint.includes(c.url)))
        )) ||
      null;

    if (!child && result.index >= 0 && result.index < children.length) {
      child = children[result.index];
    }
    if (!child && hop.indexInParent != null && hop.indexInParent >= 0 && hop.indexInParent < children.length) {
      child = children[hop.indexInParent];
    }
    if (!child) throw new Error(`frameId برای فریم فرزند پیدا نشد (${hop.value || hop.srcHint})`);

    currentFrameId = child.frameId;
  }
  return currentFrameId;
}

async function executeInFrame(tabId, frameId, payload) {
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId, frameIds: [frameId] },
      func: playExecuteInjected,
      args: [payload]
    });
    return result || { ok: false, error: "بدون نتیجه", reason: "inject_empty" };
  } catch (err) {
    return { ok: false, error: err.message, reason: "inject_failed" };
  }
}

async function playExecuteInjected(payload) {
  const actionType = payload.actionType || "Click";
  const selector = payload.selectorValue;
  const value = payload.constantValue;
  const highlightColor = payload.highlightColor || "#ea5455";
  const waitTimeoutMs = Math.max(0, Number(payload.waitTimeoutMs) || 0);

  function normalizeColor(v) {
    const s = String(v || "").trim();
    if (/^#[0-9a-fA-F]{6}$/.test(s)) return s.toLowerCase();
    if (/^#[0-9a-fA-F]{3}$/.test(s)) {
      return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`.toLowerCase();
    }
    return "#ea5455";
  }

  function highlightTarget(el, color) {
    if (!(el instanceof Element)) return;
    const c = normalizeColor(color);
    document.getElementById("da-play-hl")?.remove();
    try { el.scrollIntoView({ block: "center", inline: "nearest" }); } catch { /* ignore */ }
    const r = el.getBoundingClientRect();
    const box = document.createElement("div");
    box.id = "da-play-hl";
    Object.assign(box.style, {
      position: "fixed",
      left: `${Math.max(0, r.left - 3)}px`,
      top: `${Math.max(0, r.top - 3)}px`,
      width: `${Math.max(2, r.width + 6)}px`,
      height: `${Math.max(2, r.height + 6)}px`,
      border: `3px solid ${c}`,
      boxShadow: `0 0 0 2px ${c}33, 0 0 14px ${c}88`,
      pointerEvents: "none",
      zIndex: "2147483646",
      boxSizing: "border-box",
      borderRadius: "4px"
    });
    document.documentElement.appendChild(box);
  }

  async function waitForElement(sel, timeoutMs) {
    const deadline = Date.now() + Math.max(0, Number(timeoutMs) || 0);
    for (;;) {
      let el;
      try {
        el = document.querySelector(sel);
      } catch {
        return { ok: false, error: `سلکتور نامعتبر: ${sel}`, reason: "bad_selector" };
      }
      if (el) return { ok: true, el };
      if (Date.now() >= deadline) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    return {
      ok: false,
      error: `عنصر پیدا نشد: ${sel}`,
      reason: "element_not_found",
      url: location.href
    };
  }

  if (actionType === "WaitTime") return { ok: true, waitMs: Number(value) || 0 };
  if (actionType === "NoAction" || actionType === "Breakpoint") return { ok: true, skipped: true };

  if (!selector) return { ok: false, error: "سلکتور خالی است.", reason: "missing_selector" };

  const found = await waitForElement(selector, waitTimeoutMs);
  if (!found.ok) return found;
  const el = found.el;

  highlightTarget(el, highlightColor);

  if (actionType === "Click" || actionType === "DoubleClick" || actionType === "RightClick") {
    if (actionType === "DoubleClick") {
      el.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true, view: window }));
    } else if (actionType === "RightClick") {
      el.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, view: window, button: 2 }));
    } else {
      el.click();
    }
    return { ok: true };
  }

  if (actionType === "InputContent" || actionType === "InsertContent" || actionType === "LoadContent") {
    const v = value == null ? "" : String(value);
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const desc = Object.getOwnPropertyDescriptor(proto, "value");
      if (desc && desc.set) desc.set.call(el, v);
      else el.value = v;
    } else if (el.tagName.toLowerCase() === "select") {
      el.value = v;
    } else if (el.isContentEditable) {
      el.textContent = v;
    }
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return { ok: true };
  }

  if (actionType === "TakeContent" || actionType === "SaveContent") {
    let text = "";
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
      text = el.value || "";
    } else {
      text = (el.innerText || el.textContent || "").trim();
    }
    return { ok: true, text };
  }

  if (actionType === "Hover") {
    el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, cancelable: true, view: window }));
    return { ok: true };
  }

  return { ok: false, error: `اکشن پشتیبانی‌نشده: ${actionType}`, reason: "unsupported_action" };
}

function matchChildIframe(hop) {
  const nodes = Array.from(document.querySelectorAll("iframe, frame"));
  let el = null;
  if (hop.value) {
    try {
      el = document.querySelector(hop.value);
    } catch {
      el = null;
    }
  }
  if (!el && hop.srcHint) {
    el = nodes.find((n) => {
      const src = n.getAttribute("src") || n.src || "";
      return src && (src === hop.srcHint || hop.srcHint.includes(src) || src.includes(hop.srcHint));
    });
  }
  if (!el && hop.indexInParent != null && hop.indexInParent >= 0 && hop.indexInParent < nodes.length) {
    el = nodes[hop.indexInParent];
  }
  if (!el) return null;
  return {
    index: nodes.indexOf(el),
    src: el.src || el.getAttribute("src") || "",
    srcHint: hop.srcHint || null
  };
}

function waitTabComplete(tabId) {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }, 15000);

    function listener(id, info) {
      if (id === tabId && info.status === "complete") {
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId).then((tab) => {
      if (tab.status === "complete") {
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }).catch(() => {});
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function notifyTab(tabId, message) {
  chrome.tabs.sendMessage(tabId, message).catch(() => {});
}
