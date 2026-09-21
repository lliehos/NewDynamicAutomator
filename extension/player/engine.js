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

  if (!tabId) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    tabId = tab?.id;
  }
  if (!tabId) return { ok: false, error: "تب فعال پیدا نشد." };

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

  tabId = await ensurePlayTab(tabId, steps);

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
  try {
    for (let i = 0; i < steps.length; i++) {
      if (playAbort) break;
      playStatus.stepIndex = i + 1;
      const step = steps[i];
      const outcome = await runStep(tabId, graph.taskId, step, playStatus.runMode);
      if (!outcome.ok) {
        playStatus.lastError = outcome.error || "توقف به‌خاطر واگرایی";
        break;
      }
      if (outcome.waitMs) await sleep(outcome.waitMs);
      else await sleep(120);
    }
  } finally {
    playStatus.playing = false;
    await chrome.storage.local.set({ playing: false });
    notifyTab(tabId, { type: "playStateChanged", ...playStatus });
  }
}

async function runStep(tabId, taskId, step, runMode) {
  const actionType = step.actionType || "Click";
  const framePath = parseFramePath(step.framePathJson);

  if (actionType === "GoToUrl" || actionType === "NewPage") {
    const url = step.navigateUrl || step.constantValue;
    if (!url) {
      return onUnexpected(runMode, {
        taskId,
        stepId: step.entityId,
        reason: "missing_url",
        expectedSelector: step.selectorValue,
        actualUrl: null,
        framePathJson: step.framePathJson
      });
    }
    await chrome.tabs.update(tabId, { url });
    await waitTabComplete(tabId);
    return { ok: true };
  }

  if (actionType === "WaitTime") {
    return { ok: true, waitMs: Number(step.constantValue) || 0 };
  }

  let frameId;
  try {
    frameId = await resolveFramePath(tabId, framePath);
  } catch (err) {
    return onUnexpected(runMode, {
      taskId,
      stepId: step.entityId,
      reason: "frame_resolve_failed",
      expectedSelector: step.selectorValue,
      actualUrl: null,
      framePathJson: step.framePathJson || JSON.stringify(framePath)
    }, err.message);
  }

  const payload = {
    actionType,
    selectorValue: step.selectorValue,
    constantValue: step.constantValue,
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
      expectedSelector: step.selectorValue,
      actualUrl: result?.url || null,
      framePathJson: step.framePathJson || JSON.stringify(framePath)
    }, result?.error);
  }

  if (result.navigated) await waitTabComplete(tabId);
  return result;
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
      if (!node || node.kind !== "step") break;
      if (node.isActive !== false) steps.push(node);
      const nextStep = edges
        .filter((e) => e.from === cur && e.kind === "next")
        .map((e) => nodes.get(e.to))
        .find((n) => n && n.kind === "step");
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
    const n = Math.max(1, Number(group.constantValue) || 1);
    return Array.from({ length: n }, (_, i) => i);
  }
  // DataSource / Elements: reserved — return single pass until implemented.
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
