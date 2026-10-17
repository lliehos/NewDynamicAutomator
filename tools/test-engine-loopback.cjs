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
check("clamp: above max is capped", clampLoopBackLimit(5000), 1000);
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

if (failed) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log("\nengine helpers OK");
