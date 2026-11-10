/**
 * Runtime smoke test for the play engine's pure helpers.
 *
 * The engine is a browser service-worker script, so it cannot be imported normally. This harness
 * stubs the few Chrome APIs it touches at load time, evaluates `action-specs.js` and `engine.js`
 * in the CURRENT context (so their top-level function declarations become globals) and then calls
 * the helpers directly.
 *
 * Why it exists: a run once died before its first step with "Cannot access 'runOnServer' before
 * initialization" — a temporal-dead-zone error that `node --check` cannot see because it is a
 * runtime property, not a syntax error. Loading the file for real catches that class of bug and
 * gives the loop-back budget (condition-node `loopBackLimit`) a regression test.
 *
 * Run: node tools/test-engine-loopback.cjs
 */
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.join(__dirname, "..");

// --- Chrome API stub ---------------------------------------------------------------------------
// Only the surface the engine touches while it is being PARSED/EVALUATED is needed; no run is
// started here, so every async result can be a resolved empty value.
const noop = () => {};
const resolved = (value) => () => Promise.resolve(value);
const event = { addListener: noop, removeListener: noop, hasListener: () => false };
const area = { get: resolved({}), set: resolved(), remove: resolved(), clear: resolved() };

globalThis.chrome = {
  runtime: {
    onMessage: event,
    onInstalled: event,
    onStartup: event,
    onConnect: event,
    onSuspend: event,
    getURL: (p) => `chrome-extension://stub/${p}`,
    getManifest: () => ({ version: "0.0.0-test" }),
    sendMessage: resolved({}),
    connect: () => ({ postMessage: noop, disconnect: noop, onMessage: event, onDisconnect: event }),
    lastError: null
  },
  storage: { local: area, session: area, sync: area, onChanged: event },
  tabs: {
    query: resolved([]),
    get: resolved({}),
    create: resolved({ id: 1 }),
    update: resolved({}),
    remove: resolved(),
    sendMessage: resolved({}),
    onUpdated: event,
    onRemoved: event,
    onActivated: event,
    onCreated: event
  },
  scripting: { executeScript: resolved([]), insertCSS: resolved() },
  cookies: { get: resolved(null), getAll: resolved([]) },
  webNavigation: { onCommitted: event, onCompleted: event, getAllFrames: resolved([]) },
  alarms: { create: noop, clear: noop, onAlarm: event },
  action: { setBadgeText: resolved(), setBadgeBackgroundColor: resolved(), setTitle: resolved() },
  contextMenus: { create: noop, removeAll: resolved(), onClicked: event },
  sidePanel: { setPanelBehavior: resolved(), open: resolved() },
  windows: { create: resolved({ id: 1 }), update: resolved({}), get: resolved({}), onRemoved: event },
  debugger: { attach: resolved(), detach: resolved(), sendCommand: resolved({}) },
  downloads: { download: resolved(1), onChanged: event },
  permissions: { contains: resolved(true) },
  notifications: { create: resolved() }
};
globalThis.importScripts = (...files) => {
  for (const f of files) {
    const p = path.join(root, "extension-global", "player", path.basename(f));
    if (fs.existsSync(p)) vm.runInThisContext(fs.readFileSync(p, "utf8"), { filename: p });
  }
};
globalThis.self = globalThis;

// --- Load the engine ---------------------------------------------------------------------------
const specsPath = path.join(root, "extension-global", "player", "action-specs.js");
const enginePath = path.join(root, "extension-global", "player", "engine.js");
vm.runInThisContext(fs.readFileSync(specsPath, "utf8"), { filename: specsPath });
vm.runInThisContext(fs.readFileSync(enginePath, "utf8"), { filename: enginePath });

if (typeof resolveLoopBackLimits !== "function") {
  console.error("FAIL: engine did not expose resolveLoopBackLimits");
  process.exit(1);
}

// --- Assertions --------------------------------------------------------------------------------
let failed = 0;
function check(name, actual, expected) {
  const ok = Object.is(actual, expected) || JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name} -> ${JSON.stringify(actual)}${ok ? "" : ` (expected ${JSON.stringify(expected)})`}`);
}

check("clamp: 0 falls back to default", clampLoopBackLimit(0), 100);
check("clamp: negative falls back to default", clampLoopBackLimit(-5), 100);
check("clamp: large value is kept (no ceiling)", clampLoopBackLimit(5000), 5000);
check("clamp: fraction is floored", clampLoopBackLimit("12.9"), 12);
check("clamp: missing value uses explicit fallback", clampLoopBackLimit(undefined, 250), 250);
check("clamp: bad fallback uses 100", clampLoopBackLimit(undefined, "x"), 100);

const graph = {
  nodes: [
    { id: "s", kind: "start" },
    { id: "c1", kind: "condition", loopBackLimit: 500 },
    { id: "c2", kind: "condition" },
    { id: "a1", kind: "action" }
  ],
  edges: []
};

const limits = resolveLoopBackLimits(graph);
check("limits: no legacy start value -> default 100", limits.defaultLimit, 100);
check("limits: largest condition budget wins", limits.maxLimit, 500);
check("limits: condition keeps its own budget", loopBackLimitFor(graph.nodes[1], limits), 500);
check("limits: bare condition uses default", loopBackLimitFor(graph.nodes[2], limits), 100);
check("limits: plain step gets the largest budget", loopBackLimitFor(graph.nodes[3], limits), 500);

const legacyGraph = {
  nodes: [
    { id: "s", kind: "start", loopBackLimit: 300 },
    { id: "c1", kind: "condition" }
  ],
  edges: []
};
const legacy = resolveLoopBackLimits(legacyGraph);
check("legacy: start value becomes the fallback", legacy.defaultLimit, 300);
check("legacy: condition without value inherits it", loopBackLimitFor(legacyGraph.nodes[1], legacy), 300);

// --- Walk test: the loop-back budget is PER LOOP INSTANCE -------------------------------------
//
// The shape below is the one that broke: a group repeating twice, each iteration running a
// condition loop that needs 3 rounds. With one counter for the whole walk the second iteration
// started at round 4 and the run stopped with "more than 3 visits" even though the loop never
// exceeded its own limit. The condition exits on round 3, so a per-loop counter finishes with
// 6 evaluations and no error.
const walkGraph = {
  // A gap large enough that paceLoopBack's 500 ms floor has nothing left to add, so the test
  // does not spend seconds sleeping.
  stepDelayMs: 600,
  nodes: [
    { id: "s", kind: "start", stepDelayMs: 600 },
    { id: "g", kind: "group", title: "گروه" },
    { id: "gs", kind: "start", groupNodeId: "g", repeatSourceType: "Loops", loopCount: 2 },
    { id: "c", kind: "condition", groupNodeId: "g", loopBackLimit: 3, title: "شرط" },
    { id: "a", kind: "action", groupNodeId: "g", actionType: "Click", title: "کار" },
    { id: "e", kind: "end" }
  ],
  edges: [
    { from: "s", to: "g", kind: "next" },
    { from: "g", to: "e", kind: "next" },
    { from: "gs", to: "c", kind: "next" },
    // The loop: fail goes to a step whose `next` returns to the condition; success leaves to the end.
    { from: "c", to: "a", kind: "fail" },
    { from: "a", to: "c", kind: "next" },
    { from: "c", to: "e", kind: "success" }
  ]
};

async function main() {
  let condCalls = 0;
  let round = 0;
  // Stub the page-side check: false twice, then true (round 3), resetting for the next iteration.
  globalThis.evaluateCondition = async () => {
    condCalls += 1;
    round += 1;
    if (round >= 3) { round = 0; return true; }
    return false;
  };
  // The loop body is a plain step; the walker is what is under test, not the page action.
  globalThis.runOneAction = async () => ({ ok: true });
  playStatus.lastError = null;
  playStatus.results = [];
  await executeFlow(1, walkGraph, "s", 0, 1, 1, {});
  if (process.env.DEBUG_WALK) playLogs.forEach((l) => console.log(`  [${l.level}] ${l.text}`));
  check("walk: two group iterations finish without hitting the budget", playStatus.lastError, null);
  check("walk: each iteration counts its own 3 rounds", condCalls, 6);
}

main().then(() => {
  if (failed) {
    console.error(`\n${failed} check(s) failed`);
    process.exit(1);
  }
  console.log("\nengine helpers OK");
  process.exit(0);
});
