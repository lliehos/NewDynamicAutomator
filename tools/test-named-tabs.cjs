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

// Local-run row mapping: a run that inserts in the MIDDLE must keep writing to the right SERVER row.
vm.runInContext(`
  playStatus.runOnServer = false;
  resetLocalRunWrites();
  const rowSource = { id: 7, cells: [
    { key: "c", index: 0, cellValue: "r0" },
    { key: "c", index: 1, cellValue: "r1" },
    { key: "c", index: 2, cellValue: "r2" }
  ], columnKeys: ["c"], rowCount: 3 };
  noteLocalRowShift(7, 1, true);
  applyLocalRowShift(rowSource, 1, true);
  writeServerCellWait(rowSource, {}, 2, "c", "r1-again");
`, context, { filename: "local-insert-probe.js" });

function assert(cond, message) {
  if (!cond) throw new Error("ASSERT: " + message);
}

/** The injected page-side function only touches DOM globals, so it can run outside a page. */
function makeDocument() {
  const listeners = {};
  const el = {
    id: "x",
    events: [],
    focus() { this.focused = true; },
    dispatchEvent(ev) {
      this.events.push(ev.type);
      for (const fn of listeners[ev.type] || []) fn(ev);
      return true;
    }
  };
  return {
    document: { querySelector: (sel) => (sel === "#nope" ? null : el), activeElement: el, body: el },
    el,
    listeners,
    KeyboardEvent: class { constructor(type, init) { this.type = type; Object.assign(this, init); } }
  };
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

  // Insert above an existing row: local row 2 is server row 1, so the write must sync to row 1 and
  // its base value must be the PRE-insert value (r1), not the row the insertion pushed down.
  const localWrites = vm.runInContext("collectLocalRunWrites()", context);
  assert(localWrites.length === 1, "one local write recorded");
  assert(localWrites[0].rowIndex === 1, `write maps to server row 1, got ${localWrites[0].rowIndex}`);
  assert(localWrites[0].localRowIndex === 2, "local row kept for reference");
  assert(localWrites[0].baseValue === "r1", `base value is the pre-insert value, got ${localWrites[0].baseValue}`);
  const inserted = vm.runInContext("collectLocalInsertedRows()", context);
  assert(inserted.length === 1 && inserted[0].rowIndex === 1, "inserted row reported at index 1");
  // The run keeps reading the rows it sees: local row 2 is where its value now lives.
  vm.runInContext("localRunGraph = { dataSources: [{ id: 7, cells: rowSource.cells }] }", context);
  const readBack = await vm.runInContext("readCellForRun({id:7, cells: rowSource.cells}, {}, 2, 'c')", context);
  assert(readBack.ok === true && readBack.body.cellValue === "r1-again", "run reads the copy at its own row index");

  // Delete row 0 from the copy: every remaining local row moves up one, so local row 1 is now the
  // old local row 2, and its pending write must be re-pointed at server row 1 as well.
  vm.runInContext(`
    noteLocalRowShift(7, 0, false);
    applyLocalRowShift(rowSource, 0, false);
  `, context);
  const afterDelete = vm.runInContext("collectLocalRunWrites()", context);
  assert(afterDelete.length === 1 && afterDelete[0].rowIndex === 1, "write follows the row after a local delete");
  const readAfterDelete = await vm.runInContext("readCellForRun({id:7, cells: rowSource.cells}, {}, 1, 'c')", context);
  assert(readAfterDelete.body.cellValue === "r1-again", "committed value follows the row into its new index");

  // PressKey: the injected half must fire keydown → keypress → keyup on the focused element, with
  // both the modern key names and the legacy numeric fields a page might read.
  const pressPage = makeDocument();
  context.__pressDoc = pressPage;
  const pressFn = (selector, key, info) => vm.runInContext(
    `(() => {
       const doc = globalThis.__pressDoc;
       const saved = { q: globalThis.document, a: globalThis.activeElement, K: globalThis.KeyboardEvent };
       globalThis.document = doc.document;
       globalThis.KeyboardEvent = doc.KeyboardEvent;
       try { return pressKeySelfContained(${JSON.stringify(selector)}, ${JSON.stringify(key)}, ${JSON.stringify(info)}); }
       finally { globalThis.document = saved.q; globalThis.KeyboardEvent = saved.K; }
     })()`, context);
  context.__pressDoc = pressPage;
  const pressResult = pressFn("", "Enter", vm.runInContext("keyCodeFor('Enter')", context));
  assert(pressResult.ok === true && pressResult.key === "Enter", "Enter is reported as pressed");
  assert(pressPage.el.events.join(",") === "keydown,keypress,keyup", `event order: ${pressPage.el.events}`);
  const pressTab = pressFn("", "Tab", vm.runInContext("keyCodeFor('Tab')", context));
  assert(pressTab.ok === true && pressPage.el.events.filter((e) => e === "keypress").length === 1,
    "Tab sends keydown/keyup without a keypress");
  const chord = vm.runInContext("keyCodeFor('Ctrl+A')", context);
  assert(chord.key === "A" && chord.ctrl === true && chord.keyCode === 65, `Ctrl+A maps correctly: ${JSON.stringify(chord)}`);
  const noTarget = pressFn("#nope", "Enter", vm.runInContext("keyCodeFor('Enter')", context));
  assert(noTarget.ok === false, "a missing target element fails the step");
  assert(vm.runInContext("typeof runPressKeyStep", context) === "function", "PressKey step exists");
  assert(vm.runInContext("validateActionNodeForPlay({ kind:'action', actionType:'PressKey', pressKeyName:'' }, { nodes: [] }).ok", context) === false,
    "PressKey without a key is invalid");

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
