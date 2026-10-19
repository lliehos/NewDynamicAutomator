const fs = require("fs");
const vm = require("vm");
const path = require("path");

const repo = path.resolve(__dirname, "..");
const specs = fs.readFileSync(path.join(repo, "extension-global/player/action-specs.js"), "utf8");
const engine = fs.readFileSync(path.join(repo, "extension-global/player/engine.js"), "utf8");

let nextTabId = 10;
const tabs = new Map();
function addTab(url, { active = false, windowId = 1 } = {}) {
  const id = nextTabId++;
  tabs.set(id, {
    id, url, pendingUrl: url, title: url, windowId, active,
    index: tabs.size, discarded: false, status: "complete", autoDiscardable: true
  });
  return tabs.get(id);
}

const chrome = {
  tabs: {
    async get(id) {
      const tab = tabs.get(Number(id));
      if (!tab) throw new Error("No tab with id " + id);
      return { ...tab };
    },
    async query(filter = {}) {
      let list = [...tabs.values()];
      if (filter.windowId != null) list = list.filter((t) => t.windowId === filter.windowId);
      if (filter.active === true) list = list.filter((t) => t.active);
      return list.map((t) => ({ ...t }));
    },
    async create({ url, active }) {
      const tab = addTab(url || "about:blank", { active: active === true });
      return { ...tab };
    },
    async update(id, props) {
      const tab = tabs.get(Number(id));
      if (!tab) throw new Error("No tab with id " + id);
      if (props.url != null) { tab.url = props.url; tab.pendingUrl = props.url; }
      if (props.active != null) {
        for (const other of tabs.values()) if (other.windowId === tab.windowId) other.active = false;
        tab.active = props.active;
      }
      if (props.autoDiscardable != null) tab.autoDiscardable = props.autoDiscardable;
      return { ...tab };
    },
    async remove(id) { tabs.delete(Number(id)); },
    async sendMessage() {},
    onRemoved: { addListener() {} },
    onUpdated: { addListener() {}, removeListener() {} }
  },
  windows: { async update() {} },
  storage: { local: { async get() { return {}; }, async set() {}, async remove() {} } },
  scripting: { async executeScript() { return [{}]; } },
  runtime: { sendMessage: async () => {} }
};

const context = vm.createContext({
  chrome, console, URL, setTimeout, clearTimeout, setInterval, clearInterval, Promise,
  globalThis: null
});
context.globalThis = context;

vm.runInContext(specs, context, { filename: "action-specs.js" });
vm.runInContext(engine, context, { filename: "engine.js" });

// Deterministic, side-effect-free replacements for the URL/selector plumbing.
context.resolveDynamicSelectorAsync = async () => "";
context.resolveStepParamAsync = async (step) => step.constantValue || step.navigateUrl || "";
context.logDynamicSelectorResolution = () => {};
context.waitTabComplete = async () => {};
const realAppendPlayLog = context.appendPlayLog;
context.appendPlayLog = () => {};

function assert(cond, message) {
  if (!cond) throw new Error("ASSERT: " + message);
}

(async () => {
  const main = addTab("https://a.example/login", { active: true });
  await context.resetPlayTabs(main.id);
  const aliasId = (name) => vm.runInContext(`playTabs.get(${JSON.stringify(name)})?.id`, context);
  assert(aliasId("main") === main.id, "main alias registered");

  const stepOpenB = {
    actionType: "GoToUrl", constantValue: "https://b.example/login",
    openInNewTab: true, newTabAlias: "B"
  };
  const openOutcome = await context.runStep(main.id, "1", stepOpenB, 0, { nodes: [], edges: [] }, 0);
  assert(openOutcome.ok === true, "open B succeeds: " + JSON.stringify(openOutcome));
  assert(aliasId("b"), "B alias registered");
  const bId = aliasId("b");
  assert(openOutcome.tabId === bId, "run continues in B");

  const switchMain = { actionType: "SwitchTab", switchTabTarget: "Alias", switchTabAlias: "main" };
  const back = await context.runStep(bId, "1", switchMain, 0, { nodes: [], edges: [] }, 0);
  assert(back.ok === true && back.tabId === main.id, "switch back to main");

  const switchB = { actionType: "SwitchTab", switchTabTarget: "Alias", switchTabAlias: "B" };
  const again = await context.runStep(main.id, "1", switchB, 0, { nodes: [], edges: [] }, 0);
  assert(again.ok === true && again.tabId === bId, "switch to B again keeps the same tab");

  const missing = await context.runStep(main.id, "1",
    { actionType: "SwitchTab", switchTabTarget: "Alias", switchTabAlias: "Z" },
    0, { nodes: [], edges: [] }, 0);
  assert(missing.ok === false, "unknown alias fails");

  const closeB = await context.runStep(bId, "1",
    { actionType: "CloseTab", closeTabTarget: "Alias", closeTabAlias: "B" },
    0, { nodes: [], edges: [] }, 0);
  assert(closeB.ok === true && closeB.tabId === main.id, "closing B returns to main");
  assert(!aliasId("b"), "B alias removed after close");

  const stepOpenA = {
    actionType: "GoToUrl", constantValue: "https://a.example/landing",
    openInNewTab: true, newTabAlias: "A", switchToNewTab: false
  };
  const background = await context.runStep(main.id, "1", stepOpenA, 0, { nodes: [], edges: [] }, 0);
  assert(background.ok === true && background.tabId === main.id, "background tab does not steal the run");
  assert(aliasId("a"), "A alias registered for the background tab");

  assert(context.validatePlayTabAlias("main").ok === false, "main is reserved");
  assert(context.collectPlayTabAliases({ nodes: [{ ...stepOpenB, kind: "action" }] }).has("b"), "validation knows B");

  // Log history is bounded, and the bound is what the HUD receives.
  context.appendPlayLog = realAppendPlayLog;
  for (let i = 0; i < 50; i += 1) realAppendPlayLog("info", `line ${i}`);
  assert(vm.runInContext("playLogs.length", context) === 30, "log history capped at 30");
  assert(vm.runInContext("playLogs[playLogs.length - 1].text", context) === "line 49", "newest log kept");
  assert(context.getPlayStatus().logs.length === 30, "HUD receives at most 30 logs");

  await context.finalizePlayTabs();
  console.log("named-tabs runtime test: PASS");
})().catch((err) => {
  console.error(err.stack || err);
  process.exit(1);
});
