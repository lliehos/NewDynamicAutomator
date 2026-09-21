function isActionNode(n) {
  return !!n && (n.kind === "action" || n.kind === "step");
}

/** Play engine — imported by background via importScripts. */

const RunMode = { Play: 0, Learn: 1 };

let playAbort = false;
let playStatus = {
  playing: false,
  taskId: null,
  title: null,
  stepIndex: 0,
  stepTotal: 0,
  lastError: null,
  runMode: RunMode.Play
};

function getPlayStatus() {
  return { ok: true, ...playStatus };
}

async function stopPlay() {
  playAbort = true;
  playStatus.playing = false;
  await chrome.storage.local.set({ playing: false });
  return getPlayStatus();
}

async function listTasks() {
  // Return full task objects (including graph) so portal localStorage stays complete.
  const tasks = await loadUserTasks();
  return { ok: true, tasks };
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

  let steps = collectPlaySteps(graph);
  const opts = options || {};
  if (opts.groupNodeId) {
    steps = steps.filter((s) => s.groupNodeId === opts.groupNodeId);
  }
  if (opts.stepNodeId) {
    steps = steps.filter((s) => s.id === opts.stepNodeId);
  }
  if (steps.length === 0) return { ok: false, error: "هیچ استپی برای اجرا نیست." };

  // Always execute in a fresh blank tab (never reuse portal or an existing page).
  const created = await chrome.tabs.create({ url: "about:blank", active: true });
  tabId = created?.id;
  if (!tabId) return { ok: false, error: "تب جدید ساخته نشد." };
  await ensurePlayMemory(graph);

  playAbort = false;
  playStatus = {
    playing: true,
    taskId: graph.taskId || taskId,
    title: graph.title,
    stepIndex: 0,
    stepTotal: steps.length,
    lastError: null,
    runMode: runMode === RunMode.Learn ? RunMode.Learn : RunMode.Play,
    scope: opts.stepNodeId ? "step" : opts.groupNodeId ? "group" : "task"
  };
  await chrome.storage.local.set({ playing: true });

  runPlayLoop(tabId, graph, steps).catch((err) => {
    playStatus.lastError = err.message || String(err);
    playStatus.playing = false;
    chrome.storage.local.set({ playing: false });
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

async function runPlayLoop(tabId, graph, steps) {
  let activeTabId = tabId;
  try {
    for (let i = 0; i < steps.length; i++) {
      if (playAbort) break;
      playStatus.stepIndex = i + 1;
      const step = steps[i];
      const outcome = await runStep(activeTabId, graph.taskId, step, playStatus.runMode, graph, 0);
      if (!outcome.ok) {
        playStatus.lastError = outcome.error || "توقف به‌خاطر واگرایی";
        break;
      }
      if (outcome.tabId) activeTabId = outcome.tabId;
      if (outcome.waitMs) await sleep(outcome.waitMs);
      else await sleep(120);
    }
  } finally {
    playStatus.playing = false;
    await chrome.storage.local.set({ playing: false });
    notifyTab(activeTabId, { type: "playStateChanged", ...playStatus });
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
    const url = resolvedUrl || "about:blank";
    const created = await chrome.tabs.create({ url, active: true });
    const newId = created.id;
    if (newId) await waitTabComplete(newId);
    return { ok: true, tabId: newId, navigated: true };
  }

  if (actionType === "GoToUrl" || actionType === "Navigate") {
    const url = resolvedUrl;
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
    return { ok: true, waitMs: Number(resolvedValue) || 0 };
  }

  // Insert/Load/Input from Memory or Elements need async lookup
  let valueForAction = resolvedValue;
  const cst = step.contentSourceType || "";
  if ((actionType === "InsertContent" || actionType === "LoadContent" || actionType === "InputContent")
    && (cst === "Memory" || cst === "Elements")) {
    valueForAction = await resolveStepParamAsync(step, graph, rowIndex ?? 0, { tabId, framePath });
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

  const isCapture = actionType === "TakeContent" || actionType === "SaveContent";
  const payload = {
    actionType: isCapture ? "TakeContent" : actionType,
    selectorValue: resolvedSelector,
    constantValue: valueForAction,
    navigateUrl: step.navigateUrl
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

  if (isCapture) {
    const text = result.text != null ? String(result.text) : "";
    const store = await storeCapturedContent(step, graph, text, rowIndex ?? 0);
    if (!store.ok) {
      return onUnexpected(runMode, {
        taskId,
        stepId: step.entityId,
        reason: store.reason || "capture_store_failed",
        expectedSelector: resolvedSelector,
        actualUrl: null,
        framePathJson: step.framePathJson
      }, store.error);
    }
  }

  if (result.navigated) await waitTabComplete(tabId);
  return result;
}

const DYN_SEL_PLACEHOLDER = "{مقدار پویا}";

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
      const val = (col && ds) ? (cellValue(ds, col, row) ?? "") : "";
      sel = sel.split(DYN_SEL_PLACEHOLDER).join(val);
    }
    if (/\{\{[^}]+\}\}/.test(sel)) {
      sel = sel.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, key) => cellValue(ds, key, row) ?? "");
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
    attrVal = cellValue(ds, step[dynColKey], rowIndex ?? 0) ?? "";
  } else {
    attrVal = step[opts.attrValue || "attributeValue"] ?? "";
  }
  const escapedName = String(attrName).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const escapedVal = String(attrVal).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `${sel}[${escapedName}="${escapedVal}"]`;
}

function resolveStepParam(step, graph, rowIndex, opts = {}) {
  const cst = step.contentSourceType || "";
  if (cst === "DataSource" || step?.valueFromSource || (step?.dataSourceId && step?.dynamicSourceColumnName && cst !== "Memory" && cst !== "Elements")) {
    const ds = findDataSourceForValue(step, graph);
    const v = cellValue(ds, step.dynamicSourceColumnName, rowIndex ?? 0);
    if (v != null && String(v).trim() !== "") return String(v);
  }
  const raw = opts.preferUrl
    ? (step.navigateUrl || step.constantValue || "")
    : (step.constantValue || step.navigateUrl || "");
  return resolveDynamicText(raw, step, graph, rowIndex ?? 0);
}

async function resolveStepParamAsync(step, graph, rowIndex, opts = {}) {
  const cst = step.contentSourceType || "";
  if (cst === "Memory") {
    const name = String(step.memoryVariableName || "").trim();
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
    const payload = { actionType: "TakeContent", selectorValue: valueSel, constantValue: "" };
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
  const cst = step.contentSourceType || "Memory";
  if (cst === "DataSource") {
    const ds = findDataSourceForValue(step, graph);
    const col = step.dynamicSourceColumnName;
    if (!ds || !col) {
      return { ok: false, error: "منبع/ستون مقصد خواندن مشخص نیست.", reason: "missing_save_target" };
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
    return { ok: true };
  }
  return setPlayMemoryVar(step.memoryVariableName || step.constantValue, text);
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
      const v = cellValue(ds, step.dynamicSourceColumnName, rowIndex ?? 0);
      return v != null ? String(v) : "";
    }
    return text || "";
  }
  if (typeof text !== "string") return text || "";
  if (!/\{\{[^}]+\}\}/.test(text)) return text;
  const ds = findDataSourceForValue(step, graph) || findDataSourceForStep(step, graph);
  return text.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, key) => cellValue(ds, key, rowIndex ?? 0) ?? "");
}

function findDataSourceForValue(step, graph) {
  const sources = graph?.dataSources || [];
  if (step?.dataSourceId != null) {
    const found = sources.find((d) => Number(d.id) === Number(step.dataSourceId));
    if (found) return found;
  }
  return findDataSourceForStep(step, graph);
}

function cellValue(ds, columnKey, rowIndex) {
  if (!ds || !columnKey) return null;
  const key = String(columnKey).trim();
  const cells = ds.cells || [];
  const hit = cells.find((c) =>
    (c.key === key || c.Key === key || c.columnName === key)
    && Number(c.index ?? c.Index ?? c.rowIndex) === Number(rowIndex)
  );
  if (hit) return hit.cellValue ?? hit.CellValue ?? hit.value ?? "";
  // Fallback: columns-only ref without cells
  return null;
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

function collectPlaySteps(graph) {
  // MVP: linear walk of root groups → steps.
  // Reserved for phase 4: expandGroupByRepeatSource (DataSource / Elements / Loops)
  // and branch on condition success/fail edges before entering the next group.
  const nodes = new Map((graph.nodes || []).map((n) => [n.id, n]));
  const edges = graph.edges || [];
  const parentTargets = new Set(edges.filter((e) => e.kind === "parent").map((e) => e.to));
  const rootGroups = (graph.nodes || [])
    .filter((n) => n.kind === "group" && !parentTargets.has(n.id));

  const ordered = [];
  const startNext = edges.find((e) => e.from === "start" && e.kind === "next");
  if (startNext) {
    const first = nodes.get(startNext.to);
    if (first?.kind === "group") ordered.push(first);
    // Condition after start: follow success edge for Play MVP (fail path later).
    if (first?.kind === "condition") {
      const ok = edges.find((e) => e.from === first.id && e.kind === "success");
      const g = ok && nodes.get(ok.to);
      if (g?.kind === "group") ordered.push(g);
    }
  }
  for (const g of rootGroups.sort((a, b) => (a.entityId || 0) - (b.entityId || 0))) {
    if (!ordered.some((x) => x.id === g.id)) ordered.push(g);
  }

  const steps = [];
  for (const group of ordered) {
    // TODO(phase4): iterations = resolveRepeat(group.repeatSourceType, group.selectorValue, group.dataSourceId)
    const contains = edges.find((e) => e.from === group.id && e.kind === "contains");
    if (!contains) continue;
    let cur = contains.to;
    const seen = new Set();
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      const node = nodes.get(cur);
      if (!node || !isActionNode(node)) break;
      if (node.isActive !== false) steps.push(node);
      const nextStep = edges
        .filter((e) => e.from === cur && e.kind === "next")
        .map((e) => nodes.get(e.to))
        .find((n) => n && isActionNode(n));
      cur = nextStep ? nextStep.id : null;
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

function playExecuteInjected(payload) {
  const actionType = payload.actionType || "Click";
  const selector = payload.selectorValue;
  const value = payload.constantValue;

  if (actionType === "WaitTime") return { ok: true, waitMs: Number(value) || 0 };
  if (actionType === "NoAction" || actionType === "Breakpoint") return { ok: true, skipped: true };

  if (!selector) return { ok: false, error: "سلکتور خالی است.", reason: "missing_selector" };

  let el;
  try {
    el = document.querySelector(selector);
  } catch {
    return { ok: false, error: `سلکتور نامعتبر: ${selector}`, reason: "bad_selector" };
  }
  if (!el) {
    return { ok: false, error: `عنصر پیدا نشد: ${selector}`, reason: "element_not_found", url: location.href };
  }

  if (actionType === "Click" || actionType === "DoubleClick") {
    el.scrollIntoView({ block: "center", inline: "nearest" });
    if (actionType === "DoubleClick") {
      el.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true, view: window }));
    } else {
      el.click();
    }
    return { ok: true };
  }

  if (actionType === "InputContent" || actionType === "InsertContent" || actionType === "LoadContent") {
    el.scrollIntoView({ block: "center", inline: "nearest" });
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
