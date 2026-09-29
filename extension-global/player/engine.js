function isActionNode(n) {
  return !!n && (n.kind === "action" || n.kind === "step");
}

function sameNodeId(a, b) {
  if (a == null || b == null) return false;
  return String(a) === String(b);
}

function findGraphNode(graph, id) {
  if (id == null || id === "") return null;
  return (graph?.nodes || []).find((n) => sameNodeId(n.id, id)) || null;
}

/** Play-time graph validation — mirrors editor leaf rules; blocks start if any node is invalid. */
const DYN_SEL_PLACEHOLDER = "{مقدار پویا}";

function selectorHasDynPlaceholder(val) {
  const s = String(val || "");
  return s.includes(DYN_SEL_PLACEHOLDER) || /\{\{[^}]+\}\}/.test(s);
}
/**
 * The action spec table lives in `action-specs.js`, which BOTH this file and the editor page load.
 * It used to be four helpers here (`stepReceivesValue`, `stepNeedsSelector`, `stepAllowsElementValue`,
 * `stepShowsTargetSelector`) plus a second, separately-maintained copy in the editor's flow.js, and
 * the two had already drifted. One file, one set of answers.
 *
 * These thin aliases keep the rest of this file readable; they resolve at call time, so the shared
 * script only has to be loaded before the first action runs, not before this file is parsed.
 */
function actionSpec(actionType) {
  return (typeof globalThis !== "undefined" && globalThis.actionSpec)
    ? globalThis.actionSpec(actionType)
    : {};
}

function stepNeedsSelector(actionType) {
  return (typeof globalThis !== "undefined" && globalThis.stepNeedsSelector)
    ? globalThis.stepNeedsSelector(actionType)
    : false;
}

function stepReceivesValue(actionType) {
  return (typeof globalThis !== "undefined" && globalThis.stepReceivesValue)
    ? globalThis.stepReceivesValue(actionType)
    : false;
}

function stepAllowsElementValue(actionType) {
  return (typeof globalThis !== "undefined" && globalThis.stepAllowsElementValue)
    ? globalThis.stepAllowsElementValue(actionType)
    : false;
}

function stepAllowsMemoryValue(actionType) {
  return (typeof globalThis !== "undefined" && globalThis.stepAllowsMemoryValue)
    ? globalThis.stepAllowsMemoryValue(actionType)
    : false;
}

function stepAllowsSystemValue(actionType) {
  return (typeof globalThis !== "undefined" && globalThis.stepAllowsSystemValue)
    ? globalThis.stepAllowsSystemValue(actionType)
    : false;
}

function stepWritesToSource(actionType) {
  return (typeof globalThis !== "undefined" && globalThis.stepWritesToSource)
    ? globalThis.stepWritesToSource(actionType)
    : false;
}

function stepWritesToMemory(actionType) {
  return (typeof globalThis !== "undefined" && globalThis.stepWritesToMemory)
    ? globalThis.stepWritesToMemory(actionType)
    : false;
}

function stepIsUrlAction(actionType) {
  return actionType === "GoToUrl" || actionType === "NewPage";
}

function stepShowsTargetSelector(n) {
  const at = (n && n.actionType) || "";
  // A spec only says an action CAN take a selector. The two data-source actions additionally let
  // the author choose where the value comes from, and a constant/memory value needs no element.
  if (at === "LoadContent") return normalizeStepValueSource(n) === "Elements";
  return stepNeedsSelector(at);
}

/**
 * Where LoadContent puts the value it read: a page element or a memory variable.
 *
 * Kept as its own tiny helper because both the validator and the inspector must agree, and the
 * answer is not derivable from the spec alone (the spec says both destinations are allowed; this
 * says which one the author chose).
 */
function normalizeLoadTarget(n) {
  const t = n.saveTargetType || n.loadTargetType || "Elements";
  return t === "Memory" ? "Memory" : "Elements";
}

/**
 * Normalize where a step's input value comes from, and report it.
 *
 * Only sources the action's spec actually allows are kept; anything else falls back to a constant,
 * so a graph saved against an older rule set cannot quietly keep a source the action no longer
 * supports. Returns the effective source: Constant | DataSource | Elements | Memory | System.
 */
function normalizeStepValueSource(n) {
  const at = (n && n.actionType) || "";
  const spec = actionSpec(at);

  let src = n.contentSourceType;
  if (!src || src === "None") {
    src = n.valueFromSource ? "DataSource"
      : (spec.elementVal ? "Elements" : "Constant");
  }

  const allowed = new Set(["Constant"]);
  if (spec.readsCell) allowed.add("DataSource");
  if (spec.elementVal) allowed.add("Elements");
  if (spec.memoryVal) allowed.add("Memory");
  if (spec.systemVal) allowed.add("System");
  if (!allowed.has(src)) src = "Constant";

  n.contentSourceType = src;
  n.valueFromSource = src === "DataSource";
  return src;
}

function conditionNeedsCompare(ct) {
  return ["Url", "ElementValue", "SourceValue", "MemoryValue", "FindElements", "DriverTabs", "SystemDate", "SystemTime"].includes(ct);
}

function conditionNeedsCompareOperand(ct, eq) {
  if (!conditionNeedsCompare(ct)) return false;
  if (eq === "HasValue" || eq === "HasNotValue") return false;
  return true;
}

/** Allowed: YYYY-MM-DD (calendar-valid). */
function isValidUserSystemDateForPlay(v) {
  const s = String(v || "").trim();
  if (!/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

/** Allowed: HH:mm or HH:mm:ss */
function isValidUserSystemTimeForPlay(v) {
  return /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(String(v || "").trim());
}

function validateSelectorBlock(n, opts = {}) {
  const valueKey = opts.valueKey || "selectorValue";
  const dynFlag = opts.dynFlag || "selectorIsDynamic";
  const dynCol = opts.dynCol || "selectorDynamicColumn";
  const hasAttr = opts.hasAttr || "hasAttribute";
  const attrName = opts.attrName || "attributeName";
  const attrDyn = opts.attrDynFlag || "attributeValueIsDynamic";
  const attrCol = opts.attrDynCol || "attributeDynamicColumn";
  const label = selLabel(opts);

  const sel = String(n[valueKey] || "").trim();
  if (!sel) return { ok: false, reason: tv("sel.empty", { label }) };
  if (n[dynFlag] === true) {
    if (!selectorHasDynPlaceholder(sel)) {
      return { ok: false, reason: tv("sel.dynNeedsPlaceholder", { label, placeholder: DYN_SEL_PLACEHOLDER }) };
    }
    if (sel.includes(DYN_SEL_PLACEHOLDER) && !String(n[dynCol] || "").trim()) {
      return { ok: false, reason: tv("sel.dynColMissing", { label }) };
    }
  }
  if (n[hasAttr] === true) {
    if (!String(n[attrName] || "").trim()) {
      return { ok: false, reason: tv("sel.attrNameEmpty", { label }) };
    }
    if (n[attrDyn] === true && !String(n[attrCol] || "").trim()) {
      return { ok: false, reason: tv("sel.attrDynColMissing", { label }) };
    }
  }
  return { ok: true };
}

function validateDataSourcePick(n, opts = {}) {
  const dsKey = opts.dsKey || "dataSourceId";
  const colKey = opts.colKey || "dynamicSourceColumnName";
  const dsId = n[dsKey] || n.sourceId || n.dataSourceId;
  if (dsId == null || dsId === "") {
    return { ok: false, reason: opts.dsReason || tv("ds.pickMissing") };
  }
  if (!String(n[colKey] || "").trim()) {
    return { ok: false, reason: opts.colReason || tv("ds.colMissing") };
  }
  return { ok: true };
}

function validateActionNodeForPlay(n) {
  const reasons = [];
  if (n.isActive === false) return { ok: true, reasons };
  const at = n.actionType || "";
  if (!at || at === "NoAction") return { ok: true, reasons };

  if (stepShowsTargetSelector(n)) {
    const v = validateSelectorBlock(n, { labelKey: "label.targetSelector" });
    if (!v.ok) reasons.push(v.reason);
  }

  // Where the step's INPUT value comes from. Every action that takes a value is checked the same
  // way, whether it then writes that value into a page element, a source cell or a variable — the
  // old split between "capture" actions and "value" actions was the same question asked twice.
  if (stepReceivesValue(at)) {
    const src = normalizeStepValueSource(n);
    if (src === "Constant") {
      if (at === "WaitTime" || at === "Hold") {
        // Both are durations in milliseconds. Hold's default comes from the diagram when the step
        // leaves the field blank, so only a clearly invalid entry (negative, or not a number) is
        // rejected rather than an empty one.
        const raw = String(n.constantValue ?? "").trim();
        const ms = Number(raw);
        if (raw !== "" && (!Number.isFinite(ms) || ms < 0)) {
          reasons.push(tv(at === "Hold" ? "act.holdInvalid" : "act.waitMissing"));
        } else if (raw === "" && at === "WaitTime") {
          reasons.push(tv("act.waitMissing"));
        }
      } else if (stepIsUrlAction(at)) {
        const url = String(n.navigateUrl || n.constantValue || "").trim();
        if (!url) reasons.push(tv("act.urlEmpty"));
      } else if (at === "ScrollPage") {
        // A missing amount means "scroll by one screenful", which is the sensible default.
        const raw = String(n.constantValue ?? "").trim();
        if (raw !== "" && !Number.isFinite(Number(raw))) reasons.push(tv("act.scrollInvalid"));
      } else if (!String(n.constantValue || "").trim()) {
        reasons.push(tv("act.constantEmpty"));
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
        labelKey: stepIsUrlAction(at) ? "label.urlSelector" : "label.valueSourceSelector"
      });
      if (!v.ok) reasons.push(v.reason);
    } else if (src === "DataSource") {
      const v = validateDataSourcePick(n);
      if (!v.ok) reasons.push(v.reason);
    } else if (src === "Memory") {
      if (!String(n.memoryVariableName || "").trim()) {
        reasons.push(tv("act.memVarMissing"));
      }
    } else if (src === "System") {
      if (!String(n.systemValueType || "").trim()) {
        reasons.push(tv("act.sysTypeMissing"));
      }
    }
  }

  // Where the value GOES, for the actions that write somewhere other than the page element they
  // already target. LoadContent always writes to a chosen target (element or variable);
  // InsertContent and SetMemory write to a source cell / variable respectively.
  if (at === "LoadContent") {
    const dest = normalizeLoadTarget(n);
    if (dest === "Memory") {
      if (!String(n.memoryVariableName || "").trim()) reasons.push(tv("act.memDestMissing"));
    } else {
      const v = validateSelectorBlock(n, { labelKey: "label.targetSelector" });
      if (!v.ok) reasons.push(v.reason);
    }
  }
  if (stepWritesToSource(at)) {
    const dsId = n.saveDataSourceId != null ? n.saveDataSourceId : n.dataSourceId;
    const col = n.saveColumnName || n.dynamicSourceColumnName;
    const v = validateDataSourcePick(
      { dataSourceId: dsId, dynamicSourceColumnName: col },
      { dsReason: tv("act.saveDsMissing"), colReason: tv("act.saveColMissing") }
    );
    if (!v.ok) reasons.push(v.reason);
  }
  if (stepWritesToMemory(at) && at !== "LoadContent") {
    if (!String(n.memoryVariableName || "").trim()) reasons.push(tv("act.memDestMissing"));
  }

  return { ok: reasons.length === 0, reasons };
}

function validateConditionNodeForPlay(n, graph) {
  const reasons = [];
  const ct = n.conditionType || "None";
  if (!ct || ct === "None") {
    reasons.push(tv("cond.typeMissing"));
    return { ok: false, reasons };
  }
  const eq = n.equalityType || "equal";
  const src = n.contentSourceType || "Constant";

  if (["FindElement", "NotFindElement", "FindElements", "ElementValue", "ElementVisible", "ElementHidden"].includes(ct)) {
    const v = validateSelectorBlock(n, { labelKey: "label.conditionSelector" });
    if (!v.ok) reasons.push(v.reason);
  }
  if (ct === "SourceValue") {
    if (!n.sourceId && !n.dataSourceId) {
      reasons.push(tv("cond.srcDsMissing"));
    } else if (!String(n.dynamicSourceColumnName || "").trim()) {
      reasons.push(tv("cond.srcColMissing"));
    }
  }
  if (ct === "MemoryValue" && !String(n.memoryVariableName || "").trim()) {
    // Without a name the condition would compare against "" and quietly take one branch forever.
    reasons.push(tv("cond.memVarMissing"));
  }

  if (conditionNeedsCompareOperand(ct, eq)) {
    if (src === "Constant") {
      const val = ct === "Url"
        ? String(n.navigation || n.constantEqualValue || n.constantValue || "").trim()
        : String(n.constantEqualValue ?? n.constantValue ?? n.navigation ?? "").trim();
      if (ct === "FindElements" || ct === "DriverTabs") {
        if (val === "" || !Number.isFinite(Number(val))) {
          reasons.push(tv("cond.numMissing"));
        }
      } else if (!val) {
        reasons.push(tv("cond.valueEmpty"));
      }
    } else if (src === "UserSystemDate") {
      const val = String(n.constantEqualValue ?? n.userSystemDateValue ?? "").trim();
      if (!val) {
        reasons.push(tv("cond.userDateMissing"));
      } else if (!isValidUserSystemDateForPlay(val)) {
        reasons.push(tv("cond.userDateBadFormat"));
      }
    } else if (src === "UserSystemTime") {
      const val = String(n.constantEqualValue ?? n.userSystemTimeValue ?? "").trim();
      if (!val) {
        reasons.push(tv("cond.userTimeMissing"));
      } else if (!isValidUserSystemTimeForPlay(val)) {
        reasons.push(tv("cond.userTimeBadFormat"));
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
        labelKey: "label.compareSelector"
      });
      if (!v.ok) reasons.push(v.reason);
    } else if (src === "DataSource" && ct !== "SourceValue") {
      const v = validateDataSourcePick(n);
      if (!v.ok) reasons.push(v.reason);
    } else if (src === "Memory") {
      if (!String(n.memoryVariableName || n.sourceMemoryVariableName || "").trim()) {
        reasons.push(tv("cond.memCompareMissing"));
      }
    } else if (src === "System") {
      if (!String(n.systemValueType || "").trim()) {
        reasons.push(tv("cond.sysCompareMissing"));
      }
    }
  }

  // Each branch of a condition must lead somewhere. Without this the walk reaches the
  // condition, finds no edge for the branch it needs, and stops — which reads as the engine
  // giving up for no reason. Checked before the run so the author sees it up front.
  //
  // Both branches are required as soon as either one is wired, and `next` is NOT accepted as a
  // stand-in. That is deliberate, and the reason is in executeFlow: a condition falls back to
  // `next` only when it has no success/fail edge at all. Allowing a half-wired condition here
  // would let an unwired branch silently follow `next` and run the wrong path — the exact bug
  // that rule was written to stop.
  //
  // The exception is a graph that contains a terminal marker. Its presence is the author saying
  // "a path is allowed to stop", so an unwired branch means "ends here" rather than "forgotten".
  // Kept in step with validateConditionNode in the editor's flow.js — the two must agree, or the
  // editor will accept a diagram the player then refuses to run.
  const outs = ((graph && graph.edges) || []).filter((e) => e.from === n.id);
  const hasBranchEdges = outs.some((e) => e.kind === "success" || e.kind === "fail");
  if (hasBranchEdges) {
    const hasTerminal = (((graph && graph.nodes) || [])).some((x) => x.kind === "end");
    if (!hasTerminal) {
      if (!outs.some((e) => e.kind === "success")) reasons.push(tv("cond.noSuccessEdge"));
      if (!outs.some((e) => e.kind === "fail")) reasons.push(tv("cond.noFailEdge"));
    }
  } else if (!outs.some((e) => e.kind === "next")) {
    reasons.push(tv("cond.noAnyEdge"));
  }

  return { ok: reasons.length === 0, reasons };
}

function validateStartNodeForPlay(n, graph) {
  const reasons = [];
  const rst = n.repeatSourceType || (n.groupNodeId ? "None" : (graph.repeatSourceType || "None"));
  if (rst === "Loops") {
    const lc = Number(n.loopCount ?? n.constantValue);
    if (!Number.isFinite(lc) || lc < 1) reasons.push(tv("start.loopBad"));
  } else if (rst === "DataSource") {
    const id = n.dataSourceId ?? graph.dataSourceId;
    const sources = graph.dataSources || [];
    const exists = id != null && sources.some((d) => Number(d.id) === Number(id));
    if (!exists) {
      reasons.push(tv("start.dsMissing"));
    }
  } else if (rst === "Elements") {
    if (!n.groupNodeId) {
      reasons.push(tv("start.elementsOnlyInGroup"));
    } else {
      const v = validateSelectorBlock(n, { labelKey: "label.repeatSelector" });
      if (!v.ok) reasons.push(v.reason);
    }
  }
  return { ok: reasons.length === 0, reasons };
}

function validateNodeLeafForPlay(n, graph) {
  if (!n) return { ok: true, reasons: [] };
  if (isActionNode(n)) return validateActionNodeForPlay(n);
  if (n.kind === "condition") return validateConditionNodeForPlay(n, graph);
  if (n.kind === "start") return validateStartNodeForPlay(n, graph);
  return { ok: true, reasons: [] };
}

function graphHasInvalidNodesForPlay(graph) {
  return collectInvalidNodesForPlay(graph).length > 0;
}

/** UI culture for engine-generated messages (synced from the portal, defaults to fa). */
let playCulture = "fa";
function setPlayCulture(next) {
  playCulture = next === "en" ? "en" : "fa";
}
function playUiCulture() {
  return playCulture;
}

/**
 * Validation/run message catalogue. Call sites pass keys, never literals, so a language
 * switch reaches every reason string. Keys missing from a pack fall back to fa, then to
 * the key itself, so a typo degrades visibly instead of silently blanking out.
 */
const ENGINE_MSG = {
  fa: {
    "sel.empty": "{label} خالی است",
    "sel.dynNeedsPlaceholder": "{label} پویا باید «{مقدار پویا}» یا {{ستون}} داشته باشد",
    "sel.dynColMissing": "ستون {label} پویا مشخص نیست",
    "sel.attrNameEmpty": "نام اتریبیوت {label} خالی است",
    "sel.attrDynColMissing": "ستون اتریبیوت پویای {label} مشخص نیست",
    "ds.pickMissing": "منبع داده انتخاب نشده",
    "ds.colMissing": "ستون منبع داده انتخاب نشده",

    "play.dynSelectorResolved": "سلکتور پویا «{title}» (ردیف {row}) → {selector}",

    "act.constantSaveEmpty": "مقدار ثابت ذخیره خالی است",
    "act.memSourceMissing": "متغیر منبع حافظه مشخص نیست",
    "act.sysTypeMissing": "نوع مقدار پیشفرض سیستم مشخص نیست",
    "act.memDestMissing": "نام متغیر مقصد حافظه مشخص نیست",
    "act.saveDsMissing": "منبع مقصد ذخیره انتخاب نشده",
    "act.saveColMissing": "ستون مقصد ذخیره انتخاب نشده",
    "act.waitMissing": "زمان انتظار مشخص نیست",
    "act.holdInvalid": "مدت نگه‌داشتن کلیک باید عددی و بزرگ‌تر یا مساوی صفر باشد",
    "act.scrollInvalid": "میزان اسکرول باید عددی باشد",
    "act.urlEmpty": "آدرس ثابت خالی است",
    "act.constantEmpty": "مقدار ثابت خالی است",
    "act.memVarMissing": "متغیر حافظه مشخص نیست",

    "cond.typeMissing": "نوع شرط انتخاب نشده",
    "cond.srcDsMissing": "منبع مورد بررسی انتخاب نشده",
    "cond.srcColMissing": "ستون مورد بررسی انتخاب نشده",
    "cond.memVarMissing": "متغیر حافظه مورد بررسی انتخاب نشده",
    "cond.numMissing": "مقدار عددی مقایسه مشخص نیست",
    "cond.valueEmpty": "مقدار مقایسه خالی است",
    "cond.userDateMissing": "تاریخ سیستم کاربر مشخص نیست",
    "cond.userDateBadFormat": "فرمت تاریخ سیستم کاربر نامعتبر است (مجاز: YYYY-MM-DD)",
    "cond.userTimeMissing": "زمان سیستم کاربر مشخص نیست",
    "cond.userTimeBadFormat": "فرمت زمان سیستم کاربر نامعتبر است (مجاز: HH:mm یا HH:mm:ss)",
    "cond.memCompareMissing": "متغیر حافظه مقایسه مشخص نیست",
    "cond.sysCompareMissing": "نوع مقدار پیشفرض مقایسه مشخص نیست",
    "cond.noSuccessEdge": "شاخهٔ «موفق» (success) این شرط وصل نشده",
    "cond.noFailEdge": "شاخهٔ «ناموفق» (fail) این شرط وصل نشده",
    "cond.noAnyEdge": "هیچ خروجی‌ای از این شرط وصل نشده (نه success، نه fail، نه بعدی)",

    "start.loopBad": "تعداد تکرار حلقه نامعتبر است",
    "start.dsMissing": "منبع پیشفرض برای تکرار مشخص نشده",
    "start.elementsOnlyInGroup": "تکرار با المان صفحه فقط داخل گروه مجاز است",

    "run.tabNotFound": "تب فعلی پیدا نشد.",
    "run.lastTab": "فقط یک تب باز است؛ قابل بستن نیست.",
    "run.memNameEmpty": "نام متغیر خالی است.",
    "run.saveTargetMissing": "منبع/ستون مقصد ذخیره مشخص نیست.",
    "run.noResult": "بدون نتیجه",
    "run.badSelector": "سلکتور نامعتبر: {sel}",
    "run.removeNone": "المانی برای حذف پیدا نشد: {sel}",
    "run.alertNotArmed": "گوش‌دادن به پیام هشدار مرورگر برای این تب فعال نیست؛ افزونهٔ Player را دوباره بارگذاری کنید.",
    "run.alertNone": "پیام هشداری که باید تأیید شود دیده نشد.",
    "run.selectorEmpty": "سلکتور خالی است.",
    "run.unsupportedAction": "اکشن پشتیبانینشده: {action}",
    "run.notSelect": "المان انتخابی یک لیست کشویی (select) نیست.",
    "run.optionNotFound": "گزینه‌ای با مقدار «{v}» در لیست پیدا نشد.",
    "run.waitElementTimeout": "المان تا پایان مهلت ظاهر نشد: {sel}",
    "run.condNoFailBranch": "شاخهٔ «ناموفق» (fail) این شرط وصل نشده و مسیری برای ادامه وجود ندارد — اجرا متوقف شد. برای حلقه، شاخهٔ fail را به مرحلهٔ تکراری وصل کنید.",
    "run.condNoSuccessBranch": "شاخهٔ «موفق» (success) این شرط وصل نشده و مسیری برای ادامه وجود ندارد — اجرا متوقف شد.",
    "run.condMissingBranch": "شاخهٔ «{branch}» این شرط وصل نشده و مسیری برای ادامه وجود ندارد — اجرا متوقف شد.",
    "run.cellBusy": "سلول منبع هنوز آزاد نشده — چند ثانیه بعد دوباره تلاش کنید.",
    "run.cellSaveFailed": "ذخیرهٔ سلول روی سرور انجام نشد.",
    "run.sourceLimitExceeded": "امکان درج در منبع نیست: سقف مجاز ردیف/حجم منبع پر شده است. سقف را از سطح کاربری یا لایسنس افزایش دهید.",

    "label.selector": "سلکتور",
    "label.targetSelector": "سلکتور هدف",
    "label.conditionSelector": "سلکتور شرط",
    "label.compareSelector": "سلکتور مقدار مقایسه",
    "label.urlSelector": "سلکتور آدرس",
    "label.valueSourceSelector": "سلکتور منبع مقدار",
    "label.repeatSelector": "سلکتور تکرار",
    "label.pageElementSelector": "سلکتور المان صفحه"
  },
  en: {
    "sel.empty": "{label} is empty",
    "sel.dynNeedsPlaceholder": "Dynamic {label} must contain the dynamic token or a {{column}} reference",
    "sel.dynColMissing": "Dynamic {label} column is not set",
    "sel.attrNameEmpty": "{label} attribute name is empty",
    "sel.attrDynColMissing": "Dynamic {label} attribute column is not set",
    "ds.pickMissing": "No data source selected",
    "ds.colMissing": "No data source column selected",

    "play.dynSelectorResolved": "Dynamic selector \"{title}\" (row {row}) -> {selector}",

    "act.constantSaveEmpty": "Constant value to save is empty",
    "act.memSourceMissing": "Source memory variable is not set",
    "act.sysTypeMissing": "System default value type is not set",
    "act.memDestMissing": "Destination memory variable name is not set",
    "act.saveDsMissing": "No destination data source selected",
    "act.saveColMissing": "No destination column selected",
    "act.waitMissing": "Wait duration is not set",
    "act.holdInvalid": "Hold duration must be a number greater than or equal to zero",
    "act.scrollInvalid": "Scroll amount must be a number",
    "act.urlEmpty": "Constant URL is empty",
    "act.constantEmpty": "Constant value is empty",
    "act.memVarMissing": "Memory variable is not set",

    "cond.typeMissing": "Condition type is not selected",
    "cond.srcDsMissing": "No data source selected to check",
    "cond.srcColMissing": "No column selected to check",
    "cond.memVarMissing": "No memory variable selected to check",
    "cond.numMissing": "Numeric comparison value is not set",
    "cond.valueEmpty": "Comparison value is empty",
    "cond.userDateMissing": "User system date is not set",
    "cond.userDateBadFormat": "User system date format is invalid (expected YYYY-MM-DD)",
    "cond.userTimeMissing": "User system time is not set",
    "cond.userTimeBadFormat": "User system time format is invalid (expected HH:mm or HH:mm:ss)",
    "cond.memCompareMissing": "Comparison memory variable is not set",
    "cond.sysCompareMissing": "Comparison system value type is not set",
    "cond.noSuccessEdge": "This condition's \"success\" branch is not wired",
    "cond.noFailEdge": "This condition's \"fail\" branch is not wired",
    "cond.noAnyEdge": "This condition has no outgoing edge (no success, fail or next)",

    "start.loopBad": "Loop repeat count is invalid",
    "start.dsMissing": "No default data source selected for the repeat",
    "start.elementsOnlyInGroup": "Repeating by page elements is only allowed inside a group",

    "run.tabNotFound": "Current tab not found.",
    "run.lastTab": "Only one tab is open; it cannot be closed.",
    "run.memNameEmpty": "Variable name is empty.",
    "run.saveTargetMissing": "Destination source/column is not specified.",
    "run.noResult": "No result",
    "run.badSelector": "Invalid selector: {sel}",
    "run.removeNone": "No element to remove was found: {sel}",
    "run.alertNotArmed": "Dialog handling is not armed for this tab; reload the Player extension.",
    "run.alertNone": "No browser dialog was seen to accept.",
    "run.selectorEmpty": "Selector is empty.",
    "run.unsupportedAction": "Unsupported action: {action}",
    "run.notSelect": "The target element is not a dropdown (select).",
    "run.optionNotFound": "No option with the value \"{v}\" was found in the list.",
    "run.waitElementTimeout": "The element did not appear before the deadline: {sel}",
    "run.condNoFailBranch": "This condition has no \"fail\" branch wired and nowhere to continue — the run stopped. For a loop, wire the fail branch to the repeating step.",
    "run.condNoSuccessBranch": "This condition has no \"success\" branch wired and nowhere to continue — the run stopped.",
    "run.condMissingBranch": "This condition has no \"{branch}\" branch wired and nowhere to continue — the run stopped.",
    "run.cellBusy": "Source cell is still locked — try again in a few seconds.",
    "run.cellSaveFailed": "Could not save the cell on the server.",
    "run.sourceLimitExceeded": "Cannot insert into the source: its row/size ceiling is reached. Raise the plan or license ceiling.",

    "label.selector": "selector",
    "label.targetSelector": "target selector",
    "label.conditionSelector": "condition selector",
    "label.compareSelector": "comparison value selector",
    "label.urlSelector": "URL selector",
    "label.valueSourceSelector": "value source selector",
    "label.repeatSelector": "repeat selector",
    "label.pageElementSelector": "page element selector"
  }
};

/** Translate an engine message key for the active UI culture. */
function tv(key, vars) {
  const pack = ENGINE_MSG[playCulture] || ENGINE_MSG.fa;
  let text = pack[key] ?? ENGINE_MSG.fa[key] ?? key;
  if (vars && typeof vars === "object") {
    for (const k of Object.keys(vars)) {
      text = text.split("{" + k + "}").join(vars[k] == null ? "" : String(vars[k]));
    }
  }
  return text;
}

/** Selector label keys — resolved at call time so they follow the culture. */
const SEL_LABEL_KEYS = {
  target: "label.targetSelector",
  condition: "label.conditionSelector",
  compare: "label.compareSelector",
  url: "label.urlSelector",
  valueSource: "label.valueSourceSelector",
  repeat: "label.repeatSelector",
  pageElement: "label.pageElementSelector"
};

/** Resolves validateSelectorBlock's label option (accepts a key, a raw string, or nothing). */
function selLabel(opts) {
  if (opts && opts.labelKey) return tv(opts.labelKey);
  if (opts && typeof opts.label === "string" && opts.label.trim()) return opts.label;
  return tv("label.selector");
}

/** Human label for a node kind, used in validation reports. */
function nodeKindLabel(n) {
  if (!n) return "نود ناشناس";
  if (n.kind === "start") return "شروع";
  if (n.kind === "condition") return "شرط";
  if (isActionNode(n)) return "اقدام";
  if (n.kind === "group") return "گروه";
  return n.kind || "نود";
}

/** Name of the group a node belongs to (or the process scope for free nodes). */
function nodeGroupLabel(n, graph) {
  if (!n) return "—";
  // A group node's own title is the group name; a node inside a group references its parent.
  if (n.kind === "group") return n.title || "گروه بدون عنوان";
  const gid = n.groupNodeId;
  if (!gid) return "بیرون از گروه (سطح فرآیند)";
  const g = (graph?.nodes || []).find((x) => x.id === gid);
  return g ? (g.title || "گروه بدون عنوان") : `گروه نامشخص (${gid})`;
}

/**
 * Every node that would fail validation, with node name, owning group, kind and reasons.
 * Group nodes are containers only — their repeat/selector rules are validated on the group's
 * start node, so they are skipped here to avoid duplicate reports.
 */
function collectInvalidNodesForPlay(graph) {
  const out = [];
  for (const n of graph?.nodes || []) {
    if (n.kind === "group") continue;
    if (n.isActive === false) continue;
    const v = validateNodeLeafForPlay(n, graph);
    if (v.ok) continue;
    out.push({
      node: n,
      id: n.id,
      title: n.title || nodeKindLabel(n),
      kind: nodeKindLabel(n),
      group: nodeGroupLabel(n, graph),
      reasons: v.reasons?.length ? v.reasons : ["دلیل نامشخص"]
    });
  }
  return out;
}

/** Builds the detailed, user-facing validation error shown before a run starts. */
function buildInvalidNodesError(graph, lang) {
  const items = collectInvalidNodesForPlay(graph);
  if (!items.length) return "";
  const en = lang === "en";

  const lines = items.map((it, i) => {
    const head = en
      ? `${i + 1}) ${it.kind} «${it.title}» — in group: ${it.group}`
      : `${i + 1}) ${it.kind} «${it.title}» — در گروه: ${it.group}`;
    const why = it.reasons.map((r) => `   • ${r}`).join("\n");
    return `${head}\n${why}`;
  });

  const title = en
    ? `Cannot start: ${items.length} node(s) have invalid settings.`
    : `اجرا ممکن نیست: ${items.length} نود تنظیمات نامعتبر دارد.`;
  const tail = en
    ? "Fix the items above in the editor and save, then run again."
    : "موارد بالا را در ویرایشگر اصلاح و ذخیره کنید، سپس دوباره اجرا بزنید.";

  return `${title}\n\n${lines.join("\n\n")}\n\n${tail}`;
}

/** Play engine — imported by background via importScripts. */

const RunMode = { Play: 0, Learn: 1 };

let playAbort = false;
let playPaused = false;
let playResumeWaiters = [];
let playLogs = [];
let playTabId = null;
let playAbortPoll = null;
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
  currentNodeId: null,
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
  // Popup / extension pages
  chrome.runtime.sendMessage(message).catch(() => {});
  // Designer/portal tabs must get condition results (playTabId is the target page, not the editor).
  notifyPortalTabs(message);
}

/** Send a message to Morobot portal/editor tabs (localhost + stored portalBase). */
function notifyPortalTabs(message) {
  chrome.storage.local.get("portalBase").then(({ portalBase }) => {
    const base = String(portalBase || "").replace(/\/$/, "");
    return chrome.tabs.query({}).then((tabs) => {
      for (const tab of tabs) {
        if (!tab?.id || tab.id === playTabId) continue;
        const url = String(tab.url || "");
        if (!/^https?:\/\//i.test(url)) continue;
        const isPortal = (base && url.startsWith(base))
          || /:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(url);
        if (isPortal) notifyTab(tab.id, message);
      }
    });
  }).catch(() => {});
}

/** Inject pause/stop HUD on the play tab (needed for about:blank and after navigations). */
async function injectPlayFab(tabId) {
  if (!tabId) return false;
  try {
    // If HUD already mounted, just push fresh state — do not re-init (would no-op / race).
    const [{ result: existing } = {}] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => !!(window.__daFabInit && document.getElementById("da-player-fab"))
    }).catch(() => [{ result: false }]);
    if (existing) {
      notifyTab(tabId, { type: "playStateChanged", ...getPlayStatus() });
      return true;
    }

    // Never mount Player HUD over an active Recorder session on this page.
    const [{ result: blocked } = {}] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        if (document.documentElement.dataset.daMorobotMode === "record") return true;
        if (document.getElementById("da-recorder-fab")) return true;
        document.documentElement.dataset.daMorobotMode = "play";
        return false;
      }
    }).catch(() => [{ result: false }]);
    if (blocked) return false;

    await chrome.scripting.insertCSS({
      target: { tabId },
      files: ["styles/fab.css"]
    }).catch(() => {});
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["lib/ext-i18n.js", "content/fab-play.js"]
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

/** Minimum pause when a back-edge is taken, so a polling loop cannot hammer the page. */
const LOOP_BACK_MIN_PAUSE_MS = 500;

/** Hold with no duration set: a brief but perceptible press, long enough for a long-press handler. */
const HOLD_DEFAULT_MS = 500;

/** ScrollPage with no amount set: about one screenful, the usual "next page down" step. */
const SCROLL_PAGE_DEFAULT_PX = 600;

/**
 * Called just before moving to `nextId`. When that node has already run in this walk, the
 * edge being followed is a loop-back, so this logs the iteration and enforces a floor on the
 * pause. Without the floor a "wait until the condition is true" loop would re-evaluate as
 * fast as the page allows — hammering the target site and flooding the log, while also
 * giving the condition no time to become true.
 */
async function paceLoopBack(graph, nextId, visitCounts, loopBackLimit) {
  if (!nextId) return;
  const already = visitCounts.get(nextId) || 0;
  if (already <= 0) return;
  const node = findGraphNode(graph, nextId);
  const label = node?.title || node?.conditionType || node?.actionType || nextId;
  appendPlayLog("info", `↩ بازگشت به «${label}» — تکرار ${already + 1} از حداکثر ${loopBackLimit}`);
  // Never let the diagram's own inter-step gap shrink a loop below the floor.
  const gap = resolveStepDelayMs(graph);
  const remaining = LOOP_BACK_MIN_PAUSE_MS - gap;
  if (remaining > 0) await sleepInterruptible(remaining);
}

/** Process start: highlight border color for targeted elements. */
function resolveHighlightColor(graph) {
  // Process-level setting: root start only, then the graph, then the built-in default.
  const start = (graph?.nodes || []).find((n) => n.kind === "start" && !n.groupNodeId);
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
  // ONLY the process-level start owns this switch. A start node inside a group has its own repeat
  // settings (its inspector does not even show this option), so it must never be read as the
  // process-wide policy — an old graph that left a stale flag on a grouped start would otherwise
  // silently override the real setting.
  const start = (graph?.nodes || []).find((n) => n.kind === "start" && !n.groupNodeId);
  if (start && Object.prototype.hasOwnProperty.call(start, "ignorePlayError")) {
    return start.ignorePlayError !== false;
  }
  if (graph && Object.prototype.hasOwnProperty.call(graph, "ignorePlayError")) {
    return graph.ignorePlayError !== false;
  }
  return true;
}

/**
 * Is this step failure an authentication/session failure?
 *
 * background.js reports a 401/403 from any server call as `{ error: "auth" }` — a bare marker,
 * not a sentence — and every server-backed action depends on that session. Treating it like an
 * ordinary step error is wrong in a way that compounds: with the process default
 * (`ignorePlayError: true`) the run would CARRY ON against a dead session, so every later
 * server call failed too and the log filled with unrelated errors instead of one clear cause.
 *
 * Matched by exact marker first (that is what the code actually produces), then by the message
 * text so a wrapped or translated form is still caught.
 */
function isAuthFailure(outcome) {
  if (!outcome) return false;
  const reason = String(outcome.reason || "").trim().toLowerCase();
  if (reason === "auth" || reason === "unauthorized" || reason === "unauthenticated") return true;
  const err = String(outcome.error || "").trim().toLowerCase();
  if (err === "auth") return true;
  return /\b(401|403)\b/.test(err) || /unauthor|unauthentic|session expired|نشست منقضی|دسترسی ندارید/.test(err);
}

/** The message shown when the run stops because the session is gone. */
const AUTH_FAILURE_MESSAGE =
  "نشست/دسترسی به سرور معتبر نیست (خطای احراز هویت) — اجرا متوقف شد. " +
  "ورد پنل را تازه کنید و دوباره اجرا کنید.";

/** Decide after a non-ignored step failure: next loop index vs abort play. */
function handleStepFailureForLoop(graph, errorMsg, opts = {}) {
  const msg = errorMsg || "خطای اجرا";
  // An auth failure is NOT subject to the ignore policies. Those exist so a flaky step does not
  // abort a long run; an expired session is not flaky — nothing downstream can succeed, so
  // "continue" only delays the inevitable and buries the real cause under follow-on errors.
  if (opts.authFailure) {
    playStatus.lastError = AUTH_FAILURE_MESSAGE;
    appendPlayLog("error", `توقف اجرا — ${AUTH_FAILURE_MESSAGE}`);
    return { continueLoop: false, authFailure: true };
  }
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

async function stopPlay(reason) {
  playAbort = true;
  playPaused = false;
  playStatus.playing = false;
  playStatus.paused = false;
  wakePlayResumeWaiters();
  clearPlayCellReadInflight();
  clearPlayCellWriteChains();
  if (playAbortPoll) {
    clearInterval(playAbortPoll);
    playAbortPoll = null;
  }
  const tid = String(playStatus.taskId || "").trim();
  // Capture the play TAB up front: the storage write below clears playTabId, and the stamp we
  // must remove lives on that tab. (A task id is NOT a tab id — passing one silently no-ops.)
  const playingTabId = playTabId;
  appendPlayLog("warn", reason === "canvas_changed"
    ? "اجرا به‌خاطر تغییر فرآیند متوقف شد"
    : "اجرا توسط کاربر متوقف شد");
  // Publish the stopped state BEFORE the portal round-trip. unregisterPlayOnServer is a network
  // call with its own timeout; awaiting it first left the UI reporting "playing" for the whole
  // round-trip after the run had already stopped locally. Local truth first, bookkeeping after.
  await chrome.storage.local.set({ playing: false, playTabId: null, playPaused: false });
  broadcastPlayState();
  if (tid) await unregisterPlayOnServer(tid);
  // NOT `tid` — that is the TASK id. This clears a stamp on the play TAB, so capture the tab
  // before the storage write above nulls playTabId.
  await clearPlayPageMode(playingTabId);
  return getPlayStatus();
}

/**
 * Drop the `daMorobotMode="play"` stamp this run put on the target page.
 *
 * Mounting the Player HUD stamps the page's <html> so the Recorder HUD knows not to mount on
 * top of it, and vice versa. `content/fab-play.js` clears it on its own teardown, but that only
 * runs while that script is alive — a stop from the portal, an extension reload, or a tab-level
 * teardown leaves the stamp behind. A page left stamped "play" then REFUSES the Recorder FAB
 * forever (`content/fab-record.js` returns early on that value), and the Player HUD will not
 * re-init either. So the engine — which owns the stamp — must clear it on stop.
 *
 * Best-effort by design: the tab may already be gone, or be a chrome:// page we cannot script.
 */
async function clearPlayPageMode(tabId) {
  const id = tabId != null ? tabId : playTabId;
  if (id == null) return;
  try {
    await chrome.scripting.executeScript({
      target: { tabId: id },
      func: () => {
        // Only ever clear OUR value: a "record" stamp belongs to the Recorder, and wiping it
        // here would let the Player HUD mount on top of a live recording.
        if (document.documentElement.dataset.daMorobotMode === "play") {
          delete document.documentElement.dataset.daMorobotMode;
        }
      }
    });
  } catch { /* tab closed / not scriptable — nothing to clean */ }
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
  // The PROCESS start is the one with no owning group. A start node inside a group is a different
  // thing (it drives that group's repeat), so falling back to it would let a group's settings stand
  // in for the process's — the editor reads only the root start, and the two must agree.
  return (graph.nodes || []).find((n) => n.kind === "start" && !n.groupNodeId) || null;
}

/**
 * Narrow a 0-based row-index list to the configured start/end range.
 *
 * The range is inclusive at both ends and expressed 1-based in the UI, because that is how the
 * spreadsheet the rows come from is numbered — an author reading "rows 5 to 10" in Excel must
 * get rows 5 to 10 here, not 6 to 11.
 *
 * A range that is missing, reversed, or outside the data is treated as "no restriction" rather
 * than as an error: a stale range saved against a source that later shrank must not silently
 * reduce a run to nothing. An end beyond the last row is clamped, since asking for rows 5..500
 * of a 20-row source plainly means "5 to the end".
 */
function applyIndexRange(indices, fromRaw, toRaw) {
  const total = indices.length;
  if (!total) return indices;

  const toOneBased = (v) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 1 ? Math.floor(n) : null;
  };
  let from = toOneBased(fromRaw);
  let to = toOneBased(toRaw);

  // Nothing meaningful configured.
  if (from == null && to == null) return indices;

  if (from == null) from = 1;
  if (to == null) to = total;

  if (from > to) {
    // A reversed range is a typo, not an instruction to run nothing.
    const swap = from;
    from = to;
    to = swap;
  }

  const start = Math.max(1, from);
  const end = Math.min(total, to);
  if (start > end) return indices;

  return indices.slice(start - 1, end);
}

/** Resolve process-level iterations from the root start node. */
function resolveProcessIterations(graph) {
  const start = processStartNode(graph);
  const rst = start?.repeatSourceType || graph.repeatSourceType || "None";
  // The range lives on the root start node, falling back to the graph, matching how the other
  // repeat fields are read. Only DataSource repeats have rows to range over.
  const fromRaw = start?.repeatFromIndex ?? graph.repeatFromIndex;
  const toRaw = start?.repeatToIndex ?? graph.repeatToIndex;
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
    const allIndices = Array.from({ length: count }, (_, i) => i);
    const indices = applyIndexRange(allIndices, fromRaw, toRaw);
    // Only mention the range when it actually narrowed the run, so the ordinary whole-source
    // case does not grow a label that says "rows 1..N".
    const ranged = indices.length !== allIndices.length
      || (fromRaw != null || toRaw != null) && indices.length > 0;
    const rangeNote = ranged
      ? ` · ردیف ${indices.length ? allIndices.indexOf(indices[0]) + 1 : "-"} تا ${indices.length ? allIndices.indexOf(indices[indices.length - 1]) + 1 : "-"}`
      : "";
    return {
      type: "DataSource",
      indices,
      total: indices.length,
      sourceRowCount: count,
      repeatFromIndex: fromRaw ?? null,
      repeatToIndex: toRaw ?? null,
      dataSourceId: dsId,
      label: `منبع «${ds?.title || dsId}» × ${indices.length} ردیف${rangeNote}`
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
async function isReusablePlayTab(url, { allowEmpty = false } = {}) {
  if (!url) return !!allowEmpty;
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
 * اگر tabId صریح از ویرایشگر آمده باشد، همان تب را بدون فیلتر سخت‌گیرانه استفاده می‌کنیم.
 * activateTab:false → فقط شناسه را برمی‌گرداند و تب را فوکوس/فعال نمی‌کند (بررسی شرط).
 */
async function resolveExecutionTabId(preferredTabId, opts = {}) {
  if (opts.openNewTab === true) {
    const created = await chrome.tabs.create({ url: "about:blank", active: true });
    if (created?.windowId != null) {
      try {
        await chrome.windows.update(created.windowId, { focused: true });
      } catch { /* ignore */ }
    }
    return created?.id || null;
  }

  const explicitId = preferredTabId != null && preferredTabId !== ""
    ? Number(preferredTabId)
    : NaN;
  const hasExplicit = Number.isFinite(explicitId);
  const shouldActivate = opts.activateTab !== false;

  const focusWindow = async (winId) => {
    if (winId == null || !shouldActivate) return;
    try {
      await chrome.windows.update(winId, { focused: true });
    } catch { /* ignore */ }
  };

  const activate = async (tab) => {
    if (!tab?.id) return null;
    let url = tab.url || tab.pendingUrl || "";
    // New Tab page cannot run content scripts — switch to about:blank first.
    if (
      /^chrome:\/\/(newtab|new-tab-page)/i.test(url)
      || /^edge:\/\/(newtab|new-tab-page)/i.test(url)
      || url === ""
    ) {
      if (!shouldActivate) return null;
      try {
        await chrome.tabs.update(tab.id, { url: "about:blank", active: true });
      } catch {
        await chrome.tabs.update(tab.id, { active: true }).catch(() => {});
      }
      await focusWindow(tab.windowId);
      return tab.id;
    }
    if (shouldActivate) {
      await chrome.tabs.update(tab.id, { active: true }).catch(() => {});
      await focusWindow(tab.windowId);
    }
    return tab.id;
  };

  if (hasExplicit) {
    try {
      const tab = await chrome.tabs.get(explicitId);
      const id = await activate(tab);
      if (id) return id;
    } catch (err) {
      console.warn("[DA Player] explicit tab get failed", explicitId, err?.message || err);
    }
    // Fallback: search in all tabs (some Chromium builds are flaky on tabs.get)
    try {
      const all = await chrome.tabs.query({});
      const found = all.find((t) => Number(t.id) === explicitId);
      const id = await activate(found);
      if (id) return id;
    } catch (err) {
      console.warn("[DA Player] explicit tab query failed", explicitId, err?.message || err);
    }
    return null;
  }

  try {
    const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (active?.id && (await isReusablePlayTab(active.url || active.pendingUrl || ""))) {
      if (shouldActivate) {
        await chrome.tabs.update(active.id, { active: true }).catch(() => {});
      }
      return active.id;
    }
  } catch {
    /* ignore */
  }

  return null;
}

/** شرط وابسته به المان صفحه (نیاز به تب هدف برای querySelector). */
function conditionNeedsPageElement(node) {
  if (!node || node.kind !== "condition") return false;
  const ct = node.conditionType || "None";
  if (["FindElement", "NotFindElement", "FindElements", "ElementValue", "ElementVisible", "ElementHidden"].includes(ct)) return true;
  if ((node.contentSourceType || "Constant") === "Elements") return true;
  return false;
}

/**
 * آیا ارزیابی این شرط به یک تب مرورگر مشخص نیاز دارد؟
 *
 * MUST stay in step with `conditionNeedsBrowser` in the editor's flow.js. The two decide the same
 * question in two places, and when they disagreed the editor would hide the tab picker for a
 * condition the engine still insisted on running inside a tab — so the user was asked to choose a
 * tab by one half of the system and told none was needed by the other.
 *
 * Three categories:
 *   1. page-dependent      -> a tab is REQUIRED (Url, element checks)
 *   2. page-independent    -> a tab is NOT required (DriverTabs, SystemDate, SystemTime, MemoryValue)
 *   3. source-dependent    -> only when the comparison value is read from a page element
 */
function conditionNeedsBrowserTab(node) {
  if (!node) return false;
  const ct = node.conditionType || "None";

  // (1) inherently tied to the page of one tab
  if (ct === "Url") return true;
  if (["FindElement", "NotFindElement", "FindElements", "ElementValue", "ElementVisible", "ElementHidden"]
    .includes(ct)) {
    return true;
  }

  // (2) tied to no particular tab. DriverTabs only needs the LIST of tabs, which the background
  // worker can read without a target — demanding a tab there made the user pick a page the check
  // never looks at, and made a blank tab look like a valid answer.
  if (["DriverTabs", "SystemDate", "SystemTime", "MemoryValue"].includes(ct)) return false;

  // (3) everything else (SourceValue, …): only if the comparison operand comes from the page.
  return (node.contentSourceType || "Constant") === "Elements";
}

/**
 * Resolve a tab for a condition that needs one but was not given a target.
 *
 * Kept as an explicit, deliberate `null`: this used to return the first http(s) tab it could find,
 * which meant a check ran against an arbitrary page and returned a confident-looking wrong answer.
 * Callers must treat null as "no target was chosen" and ask the user, never substitute a tab.
 */
async function pickSilentHttpTabId() {
  return null;
}

/** Set synchronously by startPlay to claim the run before its first await. */
let playStarting = false;

async function startPlay(taskId, tabId, runMode, options) {
  const opts = options || {};
  // Condition re-check must not be blocked by a stuck previous run.
  if (playStatus.playing) {
    if (opts.conditionNodeId) {
      playAbort = true;
      playPaused = false;
      playStatus.playing = false;
      playStatus.paused = false;
      wakePlayResumeWaiters();
      await chrome.storage.local.set({ playing: false, playPaused: false }).catch(() => {});
      await sleep(40);
    } else {
      return { ok: false, error: "پخش در حال اجراست." };
    }
  }

  // GUARD MUST BE ATOMIC. `playStatus.playing` is only set to true far below, after several
  // awaits (checkSession, storage.get, loadUserTasks). Two starts arriving together therefore
  // both saw `playing === false`, both sailed past the check above, and both ran the graph —
  // a double-start that showed up as duplicated actions against the live page. Claim the run
  // HERE, synchronously, with no await in between, so only the first caller can proceed.
  //
  // The condition path above deliberately dropped a stale run, so it must be allowed to start:
  // it reaches this line with `playStarting` false (we never set it), and that is intended.
  if (playStarting) return { ok: false, error: "پخش در حال اجراست." };
  playStarting = true;
  // From here on every early return MUST release the claim — hence the try/finally.
  try {
    return await startPlayInner(taskId, tabId, runMode, opts);
  } finally {
    playStarting = false;
  }
}

async function startPlayInner(taskId, tabId, runMode, opts) {
  await checkSession();

  const { recording } = await chrome.storage.local.get("recording");
  if (recording) return { ok: false, error: "ابتدا ضبط را متوقف کنید." };

  const tasks = await loadUserTasks();
  let graph = tasks.find((t) => String(t.id) === String(taskId))?.graph || null;
  if (!graph) {
    // Last chance: re-read storage (portal sync may have just landed).
    await new Promise((r) => setTimeout(r, 120));
    const again = await loadUserTasks();
    graph = again.find((t) => String(t.id) === String(taskId))?.graph || null;
  }
  if (!graph) {
    return { ok: false, error: "فرآیند در حافظهٔ محلی پیدا نشد. صفحهٔ فرآیندها را رفرش کنید و دوباره اجرا بزنید." };
  }

  const validationError = buildInvalidNodesError(graph, playUiCulture());
  if (validationError) {
    return {
      ok: false,
      error: validationError,
      invalidNodes: collectInvalidNodesForPlay(graph).map((it) => ({
        id: it.id,
        title: it.title,
        kind: it.kind,
        group: it.group,
        reasons: it.reasons
      }))
    };
  }

  clearPlayCellReadInflight();

  const entryId = resolvePlayEntryId(graph, opts);
  if (!entryId) {
    return { ok: false, error: "نود شروع فرآیند پیدا نشد." };
  }
  // Estimate steps along the happy-path (success) for HUD totals; runtime may branch.
  const steps = collectPlaySteps(graph, opts);
  const singleCondRaw = opts.conditionNodeId
    ? findGraphNode(graph, opts.conditionNodeId)
    : null;
  const singleCond = singleCondRaw && singleCondRaw.kind === "condition" ? singleCondRaw : null;
  const singleStep = opts.stepNodeId
    ? findGraphNode(graph, opts.stepNodeId)
    : null;
  const playScope = opts.playScope
    || (opts.conditionNodeId || (singleStep && singleStep.kind === "condition")
      ? "condition"
      : opts.nextFromNodeId
        ? "next"
        : opts.stepNodeId
          ? "step"
          : opts.groupNodeId
            ? "group"
            : "task");
  opts.playScope = playScope;
  // Never walk the full diagram for a scoped step/condition play.
  //
  // "from this node onward" is deliberately NOT included: its whole point is to start at one node
  // and then follow the edges, so limiting it to a single visit would make it behave exactly like
  // the plain single-node run and the two menu entries would be indistinguishable.
  const scopedSingle = !opts.nextFromNodeId && (playScope === "step" || playScope === "condition"
    || !!(opts.stepNodeId || opts.conditionNodeId));
  if (steps.length === 0 && !opts.stepNodeId && !singleCond) {
    // Still allow walk — conditions/groups may expand at runtime; but warn if no actions exist at all.
    const anyAction = (graph.nodes || []).some((n) => isActionNode(n));
    if (!anyAction) return { ok: false, error: "هیچ استپی برای اجرا نیست." };
  }
  if (opts.stepNodeId && steps.length === 0) {
    // Allow condition-as-stepNodeId for «بررسی در مرورگر»
    if (!(singleStep && singleStep.kind === "condition") && !singleCond) {
      return { ok: false, error: "استپ انتخاب‌شده برای اجرا پیدا نشد." };
    }
  }
  if (opts.conditionNodeId && !singleCond) {
    return { ok: false, error: "شرط انتخاب‌شده پیدا نشد." };
  }

  // From FAB/popup on a real page → reuse that tab.
  // From portal with explicit tabId (ctx menu) → that tab (no focus for condition check).
  // From portal Start → fresh about:blank when openNewTab.
  // بررسی شرط: تب را فعال/سوییچ نکن.
  if (opts.conditionNodeId || (singleStep && singleStep.kind === "condition")) {
    opts.activateTab = false;
  }
  const requestedTabId = tabId;
  const condNode = singleCond || (singleStep && singleStep.kind === "condition" ? singleStep : null);
  tabId = await resolveExecutionTabId(tabId, opts);
  if (!tabId && condNode && !conditionNeedsBrowserTab(condNode)) {
    // DriverTabs / SystemDate / SystemTime / MemoryValue / a constant operand — evaluable with no
    // tab at all, so do not block here and do not borrow someone else's tab.
    tabId = null;
  } else if (!tabId && condNode) {
    // The condition DOES need a page, but no target was supplied. Do not guess: refusing is the only
    // honest answer, because any tab we picked could be showing a different page and the result
    // would look authoritative while being wrong.
    return {
      ok: false,
      error: "این شرط به صفحه وابسته است و نیاز به یک تب هدف دارد. در منوی راست‌کلیک یک تب انتخاب کنید."
    };
  }
  if (!tabId && !(condNode && !conditionNeedsBrowserTab(condNode))) {
    const wanted = Number(requestedTabId);
    return {
      ok: false,
      error: opts.openNewTab
        ? "تب جدید ساخته نشد."
        : (opts.stepNodeId || opts.groupNodeId || opts.conditionNodeId
          ? `تب انتخاب‌شده پیدا نشد${Number.isFinite(wanted) ? ` (#${wanted})` : ""}. تب را باز نگه دارید و دوباره انتخاب کنید.`
          : "روی صفحهٔ هدف اجرا کنید (از FAB)، یا از پورتال Start بزنید تا تب جدید باز شود.")
    };
  }
  await ensurePlayMemory(graph);

  const lastPlayRequest = {
    taskId: String(graph.taskId || taskId || ""),
    runMode: runMode === RunMode.Learn ? RunMode.Learn : RunMode.Play,
    groupNodeId: opts.groupNodeId || null,
    stepNodeId: opts.stepNodeId || null,
    conditionNodeId: opts.conditionNodeId || null,
    playScope: opts.playScope || null,
    title: graph.title || null,
    tabId: tabId != null ? tabId : null,
    openNewTab: opts.openNewTab === true
  };
  await chrome.storage.local.set({ lastPlayRequest });

  playAbort = false;
  playPaused = false;
  playResumeWaiters = [];
  // Keep prior logs/results until the user clears them.
  const hadHistory = playLogs.length > 0 || (playStatus.results || []).length > 0;
  playTabId = tabId;
  // nextFromNodeId is excluded here too: it is a full walk from a different entry point, so it keeps
  // the process-level repeat (a spreadsheet source still drives one iteration per row).
  const limited = !opts.nextFromNodeId
    && (scopedSingle || !!(opts.groupNodeId || opts.stepNodeId || opts.conditionNodeId));
  const iterations = limited
    ? { type: "None", indices: [0], total: 1, label: "اجرای محدود (بدون تکرار فرآیند)" }
    : resolveProcessIterations(graph);
  const priorResults = Array.isArray(playStatus.results) ? playStatus.results.slice() : [];
  const scopeLabel = playScope === "condition" || (singleStep && singleStep.kind === "condition")
    ? "condition"
    : playScope === "step" || opts.stepNodeId
      ? "step"
      : opts.groupNodeId
        ? "group"
        : "task";
  playStatus = {
    playing: true,
    paused: false,
    taskId: graph.taskId || taskId,
    title: graph.title,
    stepIndex: 0,
    stepTotal: scopedSingle ? 1 : Math.max(steps.length, 1),
    loopIndex: 0,
    loopTotal: iterations.total,
    repeatType: iterations.type,
    currentNodeId: null,
    lastError: null,
    lastResult: null,
    runMode: runMode === RunMode.Learn ? RunMode.Learn : RunMode.Play,
    scope: scopeLabel,
    logs: playLogs.slice(-80),
    results: priorResults
  };
  await chrome.storage.local.set({ playing: true, playTabId: tabId, playPaused: false });
  startPlayAbortWatch(String(graph.taskId || taskId));
  // HUD (pause/stop + results) on the execution tab — skip for condition-only check.
  if (scopeLabel !== "condition") {
    await injectPlayFab(tabId);
  }
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

  runPlayLoop(tabId, graph, steps, iterations, opts).catch(async (err) => {
    playStatus.lastError = err.message || String(err);
    playStatus.playing = false;
    playStatus.paused = false;
    playPaused = false;
    appendPlayLog("error", playStatus.lastError);
    if (playAbortPoll) {
      clearInterval(playAbortPoll);
      playAbortPoll = null;
    }
    // Local state first (see stopPlay): the UI must not keep claiming a run while the portal
    // round-trip is in flight — most visibly on a failure, when the user is waiting for it.
    const playingTabId = playTabId;
    await chrome.storage.local.set({ playing: false, playTabId: null, playPaused: false });
    broadcastPlayState();
    const failedTaskId = String(graph.taskId || taskId || "").trim();
    if (failedTaskId) await unregisterPlayOnServer(failedTaskId);
    await clearPlayPageMode(playingTabId);
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
      s.actionType === "GoToUrl" && (s.navigateUrl || s.constantValue));
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

      // Single-step / single-condition scope: never continue along diagram edges.
      // Same exclusion as the planner above: "from this node onward" is a full walk, so it must not
      // take the single-node branch. Guarding only the planner left this second check to strip the
      // walk out again at run time.
      const scopedSingle = !opts.nextFromNodeId
        && (opts.playScope === "step" || opts.playScope === "condition"
          || !!(opts.conditionNodeId || opts.stepNodeId));
      if (scopedSingle) {
        const nodeId = opts.conditionNodeId || opts.stepNodeId;
        const step = findGraphNode(graph, nodeId);
        if (!step) {
          playStatus.lastError = "نود پیدا نشد.";
          break;
        }
        playStatus.stepIndex = 1;
        playStatus.stepTotal = 1;
        playStatus.currentNodeId = step.id;
        broadcastPlayState();
        if (step.kind === "condition" || opts.playScope === "condition") {
          const title = step.title || step.conditionType || step.id;
          const checkId = Date.now();
          appendPlayLog("info", `بررسی شرط «${title}»…`);
          let pass = false;
          try {
            if (conditionNeedsPageElement(step) && activeTabId) {
              const ready = await pingTabScriptable(activeTabId);
              if (!ready) {
                appendPlayLog("warn", `تب #${activeTabId} برای اسکریپت آماده نشد`);
              }
            }
            const waitBudget = step.selectorWaitEnabled === true
              ? Math.max(0, Number(step.selectorWaitMs) || 1000)
              : 0;
            const evalMs = Math.max(5000, waitBudget + 4000);
            pass = await Promise.race([
              evaluateCondition(activeTabId, step, graph, rowIndex),
              sleep(evalMs).then(() => {
                appendPlayLog("warn", `مهلت بررسی شرط «${title}» تمام شد (${evalMs}ms)`);
                return false;
              })
            ]);
          } catch (err) {
            lastConditionError = err?.message || String(err);
            appendPlayLog("warn", `خطا در بررسی شرط: ${lastConditionError}`);
            pass = false;
          }
          playStatus.lastResult = {
            ok: true,
            conditionPass: !!pass,
            nodeId: step.id,
            checkId
          };
          // Distinguish "the condition is false" from "the condition could not be checked".
          // Both report a fail branch, but only the second one is an operational problem the
          // author needs to hear about — the old wording called them the same thing.
          const verdict = pass
            ? `نتیجه شرط «${title}»: برقرار (موفق)`
            : lastConditionError
              ? `نتیجه شرط «${title}»: بررسی ممکن نشد — ${lastConditionError} (شاخه fail)`
              : `نتیجه شرط «${title}»: برقرار نیست (ناموفق)`;
          appendPlayLog(pass ? "info" : "warn", verdict);
          // Mark finished before final finally so portal can show result immediately.
          playStatus.playing = false;
          broadcastPlayState();
          // Dedicated signal so editor always gets pass/fail even if a later broadcast races.
          notifyPortalTabs({
            type: "conditionCheckResult",
            pass: !!pass,
            nodeId: step.id,
            checkId,
            message: pass
              ? "نتیجه شرط: برقرار (موفق)"
              : "نتیجه شرط: برقرار نیست (ناموفق)"
          });
        } else if (isActionNode(step)) {
          appendPlayLog("info", `اجرای تک‌اقدام «${step.title || step.actionType || step.id}» (بدون ادامهٔ دیاگرام)`);
          const outcome = await runOneAction(activeTabId, graph, step, rowIndex, li + 1, iters.total, 1, 1);
          if (outcome.tabId) activeTabId = outcome.tabId;
          if (!outcome.ok) {
            const decision = handleStepFailureForLoop(graph, outcome.error, {
              authFailure: outcome.authFailure === true
            });
            if (decision.continueLoop) continue;
            break;
          }
          // Explicit stop — do not follow next/success edges after a scoped action.
        } else {
          playStatus.lastError = "این نود قابل اجرا در مرورگر نیست.";
          break;
        }
      } else {
        const entryId = resolvePlayEntryId(graph, opts);
        const walked = await executeFlow(activeTabId, graph, entryId, rowIndex, li + 1, iters.total, opts);
        activeTabId = walked.tabId || activeTabId;
        if (walked.stepFailed) {
          const decision = handleStepFailureForLoop(graph, walked.error, {
            authFailure: walked.authFailure === true
          });
          if (decision.continueLoop) continue;
          break;
        }
      }

      if (playStatus.lastError) break;
    }
    if (!playAbort && !playStatus.lastError) {
      // "Successfully finished" must not paper over steps that failed and were skipped.
      //
      // ignoreError (per step) and ignorePlayError (per process) deliberately let a run continue
      // past a failure, and each such step is already marked `ignoredError` in its own result row.
      // But the summary only counted loops, so a run in which several steps failed — and whose
      // actual work therefore never happened — announced an unqualified success. An operator
      // reading «اجرا با موفقیت تمام شد» had no way to know the run was only partly effective.
      //
      // Counted from the results we already keep, rather than a new counter, so the number cannot
      // drift from the rows the operator can inspect.
      const rows = Array.isArray(playStatus.results) ? playStatus.results : [];
      const ignoredCount = rows.filter((r) => r && r.ignoredError).length;
      if (ignoredCount > 0) {
        appendPlayLog(
          "warn",
          `اجرا تمام شد — اما ${ignoredCount} مرحله خطا داشت و طبق تنظیم «چشم‌پوشی از خطا» رد شد. ` +
          `نتیجهٔ کامل حاصل نشده است؛ جزئیات در فهرست نتایج.`
        );
      } else {
        appendPlayLog("info", `اجرا با موفقیت تمام شد (${iters.total} حلقه)`);
      }
    }
  } finally {
    playStatus.playing = false;
    playStatus.paused = false;
    playStatus.currentNodeId = null;
    playPaused = false;
    wakePlayResumeWaiters();
    if (playAbortPoll) {
      clearInterval(playAbortPoll);
      playAbortPoll = null;
    }
    // Local state first (see stopPlay): publish "finished" before the portal round-trip so the
    // HUD flips immediately instead of waiting on a network call to agree.
    const playingTabId = playTabId;
    await chrome.storage.local.set({ playing: false, playTabId: null, playPaused: false });
    broadcastPlayState();
    const finishedTaskId = String(playStatus.taskId || graph?.taskId || "").trim();
    if (finishedTaskId) await unregisterPlayOnServer(finishedTaskId);
    await clearPlayPageMode(playingTabId);
  }
}

function resolvePlayEntryId(graph, opts = {}) {
  // "from this node onward": begin at the named node and then walk the graph normally. Checked
  // before stepNodeId/groupNodeId because it is the broader scope — those two mean "only this
  // node", while this one means "this node and everything reachable from it".
  if (opts.nextFromNodeId) {
    const n = findGraphNode(graph, opts.nextFromNodeId);
    return n?.id || opts.nextFromNodeId;
  }
  if (opts.stepNodeId) {
    const n = findGraphNode(graph, opts.stepNodeId);
    return n?.id || opts.stepNodeId;
  }
  if (opts.groupNodeId) {
    const gStart = (graph.nodes || []).find((n) => n.kind === "start" && sameNodeId(n.groupNodeId, opts.groupNodeId));
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
 * How many times a single node may be re-entered during one flow walk.
 *
 * A diagram may legitimately loop back (condition → step → same condition, "wait until
 * true"), so a node cannot be limited to a single execution. But an unbounded loop would
 * hang the browser with no way out, so each node gets a budget. The value comes from the
 * root start node (`loopBackLimit`) and is clamped to a sane range; anything larger would
 * make the run effectively unkillable.
 */
function resolveLoopBackLimit(graph) {
  // Only the process-level start carries this setting — a group start has its own repeat options
  // and its inspector never shows "حداکثر بازگشت حلقه". Falling back to any start node would let a
  // stale value on a grouped start silently become the process-wide loop budget (and even override
  // the graph-level value). Mirrors the editor, which reads only the root start.
  const start = (graph?.nodes || []).find((n) => n.kind === "start" && !n.groupNodeId);
  const raw = Number(start?.loopBackLimit ?? graph?.loopBackLimit);
  if (!Number.isFinite(raw) || raw <= 0) return 100;
  return Math.min(1000, Math.max(1, Math.floor(raw)));
}

/**
 * Walk the flow diagram from entryId:
 * start → next, action → next, condition → success|fail, group → inner then next.
 *
 * Re-entering a node is allowed (a loop-back edge is a supported shape), but each node has
 * a visit budget — see resolveLoopBackLimit. Exceeding it means the loop never satisfied its
 * exit condition, which stops the run with a message naming the node rather than silently
 * ending it as a "duplicate loop" would.
 */
async function executeFlow(tabId, graph, entryId, rowIndex, loopIndex, loopTotal, opts = {}) {
  const nodes = new Map((graph.nodes || []).map((n) => [n.id, n]));
  const edges = graph.edges || [];
  let activeTabId = tabId;
  let cur = entryId;
  let guard = 0;
  let stepOrdinal = 0;
  const visitCounts = new Map();
  const loopBackLimit = resolveLoopBackLimit(graph);

  while (cur && !playAbort && !playStatus.lastError && guard++ < 100000) {
    await waitIfPaused();
    if (playAbort) break;

    const visits = (visitCounts.get(cur) || 0) + 1;
    visitCounts.set(cur, visits);
    if (visits > loopBackLimit) {
      const stuck = nodes.get(cur);
      const label = stuck?.title || stuck?.conditionType || stuck?.actionType || cur;
      appendPlayLog(
        "error",
        `«${label}» بیش از ${loopBackLimit} بار اجرا شد و شرط خروج آن برقرار نشد — اجرا متوقف شد. ` +
        `(سقف تکرار را از نود شروع → «حداکثر بازگشت حلقه» تغییر دهید)`
      );
      playStatus.lastError = `حداکثر بازگشت حلقه در نود «${label}» رد شد`;
      break;
    }

    const node = nodes.get(cur);
    if (!node) break;

    if (node.kind === "end") {
      // Terminal marker: the author has said this path stops here. It carries no work and no
      // outgoing edge, so the walk simply ends — and ends as a SUCCESS, not an error. Logged
      // explicitly because a silent return would look identical to a graph that fell off the
      // end of its edges, which is the failure mode this node exists to make deliberate.
      appendPlayLog("info", `نود «پایان» — مسیر در «${nodes.get(cur)?.title || "پایان"}» خاتمه یافت.`);
      break;
    }

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
      playStatus.currentNodeId = node.id;
      const outcome = await runOneAction(
        activeTabId, graph, node, rowIndex, loopIndex, loopTotal, stepOrdinal, playStatus.stepTotal
      );
      if (outcome.tabId) {
        activeTabId = outcome.tabId;
        playTabId = activeTabId;
      }
      if (!outcome.ok) {
        // Non-ignored step error → end this iteration (like continue); loop decides next.
        // `authFailure` travels with it so the loop's ignore policy cannot override a dead session.
        return {
          tabId: activeTabId,
          stepFailed: true,
          error: outcome.error || "خطای مرحله",
          authFailure: outcome.authFailure === true
        };
      }
      const nextId = flowEdge(edges, node.id, ["next"])?.to || null;
      // Delay after the step finished, before the next node.
      await delayAfterNode(graph, nextId);
      await paceLoopBack(graph, nextId, visitCounts, loopBackLimit);
      cur = nextId;
      continue;
    }

    if (node.kind === "condition") {
      playStatus.currentNodeId = node.id;
      broadcastPlayState();
      // Conditions never fail the run: any exception → false (fail branch).
      let pass = false;
      try {
        pass = await evaluateCondition(activeTabId, node, graph, rowIndex);
      } catch (err) {
        lastConditionError = err?.message || String(err);
        appendPlayLog("warn", `شرط «${node.title || node.id}»: اکسپشن → fail — ${lastConditionError}`);
        pass = false;
      }
      // Say WHICH kind of fail this is. A check that could not run and a check that is simply
      // false take the same branch, but only one of them means "go fix your diagram".
      appendPlayLog(
        lastConditionError ? "warn" : "info",
        lastConditionError
          ? `شرط «${node.title || node.id}»: بررسی ممکن نشد (${lastConditionError}) → شاخه fail`
          : `شرط «${node.title || node.id}»: ${pass ? "موفق (success)" : "ناموفق (fail)"}`
      );
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
      // Resolve the outgoing edge. A condition has two logical branches (success / fail)
      // and each must be wired by the author. Falling back from a missing branch to the
      // generic `next` edge is what previously let a condition take the WRONG path: an
      // unwired `fail` silently followed whatever `next` pointed at, so a failed check ran
      // the success work. A `next` edge is therefore only honoured when the condition has
      // no success/fail edges at all, which is a condition used as a plain sequential step.
      const hasBranchEdges = edges.some(
        (x) => x.from === cur && (x.kind === "success" || x.kind === "fail")
      );
      const wanted = pass ? "success" : "fail";
      const e = flowEdge(edges, cur, hasBranchEdges ? [wanted] : ["next"]);

      if (!e && hasBranchEdges) {
        // An unwired branch is only an error when the graph has no terminal marker. With an
        // `end` node present the author has declared that paths may stop, so an unwired branch
        // means "this path ends here" — treated as a clean termination and logged as such.
        // Mirrors validateConditionNodeForPlay above; the two must agree.
        const hasTerminal = ((graph && graph.nodes) || []).some((x) => x.kind === "end");
        if (hasTerminal) {
          appendPlayLog(
            "info",
            `شرط «${node.title || node.id}»: نتیجهٔ ${pass ? "موفق" : "ناموفق"} شد و شاخهٔ ` +
            `«${pass ? "موفق" : "ناموفق"}» وصل نیست — مسیر خاتمه یافت.`
          );
          break;
        }
      }

      if (!e) {
        // Nothing to follow: either the branch we need is unwired, or the condition is a
        // terminal node. Either way the run cannot continue, and ending silently is what
        // made this look like the engine "stopping for no reason".
        const label = node.title || node.id;
        if (hasBranchEdges) {
          const other = pass ? "fail" : "success";
          appendPlayLog(
            "warn",
            `شرط «${label}»: نتیجهٔ ${pass ? "موفق" : "ناموفق"} شد ولی شاخهٔ «${wanted}» وصل نشده ` +
            `(شاخهٔ «${other}» وصل است) — اجرا متوقف شد.`
          );
          playStatus.lastError = tv("run.condMissingBranch", {
            branch: pass ? "موفق" : "ناموفق"
          });
        } else {
          appendPlayLog("warn", `شرط «${label}»: ${tv(
            pass ? "run.condNoSuccessBranch" : "run.condNoFailBranch"
          )}`);
          playStatus.lastError = tv(
            pass ? "run.condNoSuccessBranch" : "run.condNoFailBranch"
          );
        }
        appendPlayResult({
          t: Date.now(),
          loop: loopIndex,
          loopTotal,
          rowIndex,
          step: stepOrdinal,
          stepTotal: playStatus.stepTotal,
          title: node.title || "شرط",
          actionType: "Condition",
          ok: false,
          severity: "error",
          detail: `شاخهٔ ${wanted} وصل نشده`
        });
        break;
      }

      const nextId = e.to || null;
      await delayAfterNode(graph, nextId);
      await paceLoopBack(graph, nextId, visitCounts, loopBackLimit);
      cur = nextId;
      continue;
    }

    if (node.kind === "group") {
      playStatus.currentNodeId = node.id;
      broadcastPlayState();
      appendPlayLog("info", `ورود به گروه «${node.title || node.id}»`);
      const innerEntry = (graph.nodes || []).find((n) => n.kind === "start" && n.groupNodeId === node.id)?.id
        || flowEdge(edges, node.id, ["contains"])?.to
        || findGroupEntryFallback(graph, node.id);
      if (innerEntry) {
        const gStart = (graph.nodes || []).find((n) => n.kind === "start" && sameNodeId(n.groupNodeId, node.id))
          || findGraphNode(graph, innerEntry);
        const groupIters = await expandGroupByRepeatSource(activeTabId, gStart || node, graph);
        const moveLoop = gStart?.moveLoop !== false && node.moveLoop !== false;
        const parentRow = rowIndex;
        for (let gi = 0; gi < groupIters.indices.length; gi++) {
          if (playAbort) break;
          await waitIfPaused();
          const gRow = groupIters.indices[gi];
          // "Dedicated row" pins the row this group works on, either to a source position (first /
          // last / an explicit index) or to a loop position (this / parent / total). When the switch
          // is off the group keeps following its loop exactly as before.
          const pinnedRow = resolveDedicatedRow(gStart, graph, {
            groupRow: gRow,
            parentRow,
            loopIndex,
            loopTotal,
            groupIndex: gi,
            groupTotal: groupIters.total
          });
          const effectiveRow = pinnedRow != null ? pinnedRow : (moveLoop ? gRow : parentRow);
          if (groupIters.total > 1) {
            appendPlayLog("info", `تکرار گروه «${node.title || node.id}» ${gi + 1}/${groupIters.total} (${groupIters.label || groupIters.type})`);
          }
          const inner = await executeFlow(activeTabId, graph, innerEntry, effectiveRow, loopIndex, loopTotal, {
            ...opts,
            _insideGroupId: node.id,
            _groupLoopIndex: gi + 1,
            _groupLoopTotal: groupIters.total
          });
          activeTabId = inner.tabId || activeTabId;
          if (inner.stepFailed) {
            return {
              tabId: activeTabId,
              stepFailed: true,
              error: inner.error || "خطای مرحله",
              authFailure: inner.authFailure === true
            };
          }
          if (playStatus.lastError) break;
        }
      } else {
        appendPlayLog("warn", `گروه «${node.title || node.id}» ورودی ندارد`);
      }
      const nextId = flowEdge(edges, node.id, ["next"])?.to || null;
      await delayAfterNode(graph, nextId);
      await paceLoopBack(graph, nextId, visitCounts, loopBackLimit);
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

  playStatus.currentNodeId = step.id;
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

  // A step that THROWS must be treated as a step that FAILED, not as a reason to kill the run.
  //
  // runStep reaches the page through chrome.scripting, evaluates author-supplied selectors
  // (including regexes), and dereferences a lot of node fields. Any of those can throw for
  // reasons the inner helpers do not catch — an invalid pattern, a rejected script injection, a
  // node shape an older graph saved. Without this guard the exception unwound straight out of
  // runOneAction and executeFlow, so the loop's own failure policy (ignoreError, "continue to the
  // next loop index", the per-step result row) was skipped entirely: one bad step ended the whole
  // run and the log showed a stack trace instead of a step error.
  //
  // Catching here gives a thrown step exactly the same treatment as one that returned
  // { ok: false } — same result row, same ignoreError handling, same loop decision.
  let outcome;
  try {
    outcome = await runStep(tabId, graph.taskId, step, playStatus.runMode, graph, rowIndex);
  } catch (err) {
    const detail = err?.stack || err?.message || String(err);
    outcome = {
      ok: false,
      error: `خطای غیرمنتظره در اجرای مرحله: ${err?.message || String(err)}`,
      reason: "step_exception"
    };
    appendPlayLog("warn", `مرحله «${label}» با اکسپشن متوقف شد — ${detail}`);
  }
  const failed = !outcome?.ok;
  // An auth failure must never be swallowed by ignoreError (step) / ignorePlayError (process).
  // See isAuthFailure(): continuing against a dead session fails everything downstream.
  const authFailure = failed && isAuthFailure(outcome);
  const ignored = failed && !authFailure && step.ignoreError !== false;
  const errMsg = authFailure
    ? AUTH_FAILURE_MESSAGE
    : (outcome?.error || "توقف به‌خاطر واگرایی");
  const reason = authFailure ? "auth" : (outcome?.reason || outcome?.unexpected?.reason || "");
  const errDetail = reason && !authFailure ? `${errMsg} [${reason}]` : errMsg;

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

  // SetMemory stores into the run's variable table rather than touching the page, so the
  // write happens here where the table lives.
  if (outcome?.memorySet) {
    await setPlayMemoryVar(outcome.memorySet.name, outcome.memorySet.value);
    appendPlayLog("ok", `مقدار «${outcome.memorySet.name}» ذخیره شد`);
  }

  if (failed) {
    if (ignored) {
      appendPlayLog("warn", `چشم‌پوشی از خطای مرحله «${label}»: ${errDetail}`);
      // Continue to next node in the diagram.
      return { ok: true, ignoredError: true, error: errDetail, tabId };
    }
    appendPlayLog("error", `خطا در مرحله «${label}»: ${errDetail}`);
    // End current iteration (caller / loop decides continue vs abort). `authFailure` rides along
    // so the loop can refuse to continue even when its own ignore policy is switched on.
    return { ok: false, stepFailed: true, error: errDetail, authFailure, tabId };
  }

  let activeTabId = tabId;
  if (outcome.tabId && outcome.tabId !== tabId) {
    activeTabId = outcome.tabId;
    playTabId = activeTabId;
    await chrome.storage.local.set({ playTabId: activeTabId });
    await injectPlayFab(activeTabId);
  } else if (outcome.navigated || step.actionType === "GoToUrl") {
    await injectPlayFab(activeTabId);
  }
  appendPlayLog("ok", `انجام شد: ${label}`);
  // Action-specific wait (e.g. WaitTime). Inter-node gap is applied by executeFlow.
  if (outcome.waitMs) await sleepInterruptible(outcome.waitMs);
  return { ok: true, tabId: activeTabId };
}

/**
 * Why the last evaluateCondition() call ended the way it did.
 *
 * A condition has only two branches, so a thrown error has to become one of them — the fail
 * branch, by long-standing design. The harm is not the branch, it is the REPORTING: an
 * exception was logged as «ناموفق (fail)» exactly like a legitimate false, so an author would
 * go and re-check a selector when the real fault was an unreachable tab or a thrown helper.
 * This side-channel lets the callers say "the check could not run" instead of "the check is
 * false", while the branch taken stays identical.
 *
 * `null` means "no error — the boolean is a real answer".
 */
let lastConditionError = null;

async function evaluateCondition(tabId, node, graph, rowIndex) {
  const ct = node.conditionType || "None";
  lastConditionError = null;
  try {
    if (ct === "None") return true;

    if (ct === "Url") {
      let actual = "";
      try {
        const tab = await chrome.tabs.get(tabId);
        actual = tab.url || "";
      } catch (err) {
        // The tab is gone (closed, or a frame we cannot reach). That is NOT "the page URL does
        // not match" — reporting it as a plain fail sent the author hunting for a wrong URL.
        lastConditionError = `تب موردنظر در دسترس نیست (${err?.message || err})`;
        appendPlayLog("warn", `شرط «آدرس صفحه»: ${lastConditionError} → شاخه fail`);
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
      } catch (err) {
        lastConditionError = `فهرست تب‌ها خوانده نشد (${err?.message || err})`;
        appendPlayLog("warn", `شرط «تعداد تب‌ها»: ${lastConditionError} → شاخه fail`);
        return false;
      }
      const expected = Number(
        node.constantEqualValue ?? node.constantValue ?? node.navigation
      ) || 0;
      return compareConditionValues(count, expected, node.equalityType || "equal");
    }

    if (ct === "FindElement" || ct === "NotFindElement" || ct === "ElementVisible" || ct === "ElementHidden") {
      const selector = (await resolveDynamicSelectorAsync(node, graph, rowIndex))
        || node.selectorValue || "";
      const negate = ct === "NotFindElement" || ct === "ElementHidden";
      if (!selector) return negate;
      const waitMs = node.selectorWaitEnabled === true
        ? Math.max(0, Number(node.selectorWaitMs) || 1000)
        : 0;
      // Visibility is the only difference from a plain existence check: "found" must
      // also be rendered and on-screen, which is what makes this useful for a page that
      // keeps a hidden copy of a node it swaps in later.
      const wantVisible = ct === "ElementVisible" || ct === "ElementHidden";
      const req = wantVisible
        ? { ...selectorStateReqs(node), requireVisible: true }
        : selectorStateReqs(node);
      const found = await elementExistsInTab(
        tabId,
        selector,
        parseFramePath(node.framePathJson),
        waitMs,
        req
      );
      return negate ? !found : !!found;
    }

    if (ct === "FindElements") {
      const selector = (await resolveDynamicSelectorAsync(node, graph, rowIndex))
        || node.selectorValue || "";
      const count = selector
        ? await elementCountInTab(tabId, selector, parseFramePath(node.framePathJson), selectorStateReqs(node))
        : 0;
      const expected = Number(
        node.constantEqualValue ?? node.constantValue ?? node.navigation
      ) || 0;
      return compareConditionValues(count, expected, node.equalityType || "equal");
    }

    if (ct === "ElementValue" || ct === "SourceValue") {
      const left = ct === "SourceValue"
        ? ((await resolveStepParamAsync(node, graph, rowIndex)) || "")
        : (await readElementText(tabId, node, graph, rowIndex));
      const right = await resolveConditionCompareValue(tabId, node, graph, rowIndex);
      return compareConditionValues(left, right, node.equalityType || "equal");
    }

    // The subject is a memory variable, so this condition needs no page and no tab: it compares
    // what an earlier step stored against the compare operand, just like SourceValue does for a
    // source cell. An unset variable is "" so a HasValue/HasNotValue check still means something.
    if (ct === "MemoryValue") {
      const name = String(node.memoryVariableName || "").trim();
      if (!name) {
        // A misconfigured node, not a legitimate false: say so.
        lastConditionError = "شرط متغیر حافظه بدون نام متغیر است";
        appendPlayLog("warn", `${lastConditionError} — شاخه fail`);
        return false;
      }
      const vars = await getPlayMemoryVars();
      const left = vars[name] != null ? String(vars[name]) : "";
      const right = await resolveConditionCompareValue(tabId, node, graph, rowIndex);
      return compareConditionValues(left, right, node.equalityType || "equal");
    }

    // System date / system time: the left operand is the machine clock formatted
    // with the condition's own format, the right operand is the compare value.
    // Formatting is explicit so a comparison is predictable regardless of the
    // UI locale (fa-IR digits would otherwise never match a stored literal).
    if (ct === "SystemDate" || ct === "SystemTime") {
      const left = formatSystemClock(ct, node.systemClockFormat);
      const right = await resolveConditionCompareValue(tabId, node, graph, rowIndex);
      return compareConditionValues(left, right, node.equalityType || "equal");
    }

    // Unknown type — take success path so flow continues.
    appendPlayLog("info", `نوع شرط پشتیبانی‌نشده: ${ct} — شاخه success`);
    return true;
  } catch (err) {
    // Never surface as a play error: an exception still means the fail branch, because a
    // condition must always resolve to a branch. What changes is that we now REMEMBER the
    // failure, so the caller can report «بررسی ممکن نشد» rather than a bare «ناموفق» — the two
    // look identical to the user otherwise, and only one of them is the author's bug.
    const detail = err?.stack || err?.message || String(err);
    lastConditionError = err?.message || String(err);
    appendPlayLog("warn", `ارزیابی شرط با خطا ممکن نشد → شاخه fail — ${detail}`);
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
    if (src === "UserSystemDate" || src === "UserSystemTime") {
      return String(node.constantEqualValue || node.constantValue || "").trim();
    }
    if (src === "Memory") {
      const name = String(node.memoryVariableName || node.sourceMemoryVariableName || "").trim();
      if (!name) return "";
      const vars = await getPlayMemoryVars();
      return vars[name] != null ? String(vars[name]) : "";
    }
    if (src === "DataSource") {
      return (await resolveStepParamAsync(node, graph, rowIndex))
        || node.constantEqualValue || node.constantValue || "";
    }
    if (src === "Elements") {
      const sel = (await resolveDynamicSelectorAsync(node, graph, rowIndex, {
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
      })) || node.equalSelectorValue || "";
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

function selectorStateReqs(step, { equal = false } = {}) {
  if (!step) return { requireVisible: false, requireEnabled: false, requireClickable: false };
  if (equal) {
    return {
      requireVisible: step.equalSelectorRequireVisible === true,
      requireEnabled: step.equalSelectorRequireEnabled === true,
      requireClickable: step.equalSelectorRequireClickable === true
    };
  }
  return {
    requireVisible: step.selectorRequireVisible === true,
    requireEnabled: step.selectorRequireEnabled === true,
    requireClickable: step.selectorRequireClickable === true
  };
}

/** Injected into pages — find first element matching CSS + optional state filters. */
function pageFindMatchingElement(sel, req) {
  const need = req || {};
  let nodes;
  try {
    nodes = Array.from(document.querySelectorAll(sel));
  } catch {
    return { ok: false, badSelector: true };
  }
  for (const el of nodes) {
    if (!(el instanceof Element)) continue;
    if (need.requireVisible || need.requireClickable) {
      const st = window.getComputedStyle(el);
      const r = el.getBoundingClientRect();
      if (st.display === "none" || st.visibility === "hidden" || Number(st.opacity) === 0) continue;
      if (!(r.width > 0 && r.height > 0)) continue;
    }
    if (need.requireEnabled) {
      if (el.disabled === true) continue;
      if (el.getAttribute("aria-disabled") === "true") continue;
      if (el.getAttribute("disabled") != null && el.getAttribute("disabled") !== "false") continue;
    }
    if (need.requireClickable) {
      const st = window.getComputedStyle(el);
      if (st.pointerEvents === "none") continue;
      const r = el.getBoundingClientRect();
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) continue;
      try {
        const top = document.elementFromPoint(x, y);
        if (top && top !== el && !el.contains(top) && !top.contains?.(el)) continue;
      } catch { /* ignore hit-test failures */ }
    }
    return { ok: true, found: true };
  }
  return { ok: true, found: false };
}

async function elementExistsInTab(tabId, selector, framePath, waitTimeoutMs = 0, stateReq = null) {
  if (!tabId || !selector) return false;
  const req = stateReq || {};
  try {
    await pingTabScriptable(tabId);
    const frameId = await resolveFramePath(tabId, framePath || []);
    const maxMs = Math.max(0, Number(waitTimeoutMs) || 0);
    const deadline = Date.now() + maxMs;
    let injectFails = 0;
    for (;;) {
      try {
        const [{ result } = {}] = await chrome.scripting.executeScript({
          target: { tabId, frameIds: [frameId] },
          func: pageFindMatchingElement,
          args: [selector, req]
        });
        injectFails = 0;
        if (result?.badSelector) return false;
        if (result?.found) return true;
      } catch (err) {
        injectFails += 1;
        console.warn("[DA Player] elementExistsInTab inject failed", tabId, err?.message || err);
        if (injectFails === 1) {
          await pingTabScriptable(tabId);
          continue;
        }
        return false;
      }
      if (Date.now() >= deadline) return false;
      await sleep(100);
    }
  } catch (err) {
    console.warn("[DA Player] elementExistsInTab", err?.message || err);
    return false;
  }
}

/**
 * Make sure the tab can run scripting without leaving the user on that tab.
 * Discarded / unresponsive tabs are woken briefly then focus is restored.
 */
async function ensureTabScriptable(tabId, opts = {}) {
  if (!tabId) return false;
  let tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch {
    return false;
  }
  const needsWake = !!(opts.force || tab.discarded || tab.status === "unloaded");
  if (!needsWake) return true;

  let prevTabId = null;
  let prevWinId = null;
  try {
    const [prev] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (prev?.id && prev.id !== tabId) {
      prevTabId = prev.id;
      prevWinId = prev.windowId;
    }
  } catch { /* ignore */ }

  try {
    await chrome.tabs.update(tabId, { active: true });
  } catch { /* ignore */ }

  const start = Date.now();
  while (Date.now() - start < 2000) {
    try {
      const t = await chrome.tabs.get(tabId);
      if (t && !t.discarded && (t.status === "complete" || t.status === "loading")) break;
    } catch { break; }
    await sleep(80);
  }
  // Give the renderer a beat after wake.
  await sleep(120);

  if (prevTabId) {
    try {
      await chrome.tabs.update(prevTabId, { active: true });
      if (prevWinId != null) {
        await chrome.windows.update(prevWinId, { focused: true }).catch(() => {});
      }
    } catch { /* ignore */ }
  }
  return true;
}

/** Probe scripting; on failure wake the tab and retry once. */
async function pingTabScriptable(tabId) {
  if (!tabId) return false;
  const probe = async () => {
    const [{ result } = {}] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => true
    });
    return !!result;
  };
  try {
    if (await probe()) return true;
  } catch {
    /* wake and retry */
  }
  await ensureTabScriptable(tabId, { force: true });
  try {
    return await probe();
  } catch (err) {
    console.warn("[DA Player] pingTabScriptable failed", tabId, err?.message || err);
    return false;
  }
}

async function elementCountInTab(tabId, selector, framePath, stateReq = null) {
  const req = stateReq || {};
  try {
    await pingTabScriptable(tabId);
    const frameId = await resolveFramePath(tabId, framePath || []);
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId, frameIds: [frameId] },
      func: (sel, need) => {
        try {
          const nodes = Array.from(document.querySelectorAll(sel));
          if (!need || !(need.requireVisible || need.requireEnabled || need.requireClickable)) {
            return nodes.length;
          }
          let n = 0;
          for (const el of nodes) {
            if (!(el instanceof Element)) continue;
            if (need.requireVisible || need.requireClickable) {
              const st = getComputedStyle(el);
              const r = el.getBoundingClientRect();
              if (st.display === "none" || st.visibility === "hidden" || Number(st.opacity) === 0) continue;
              if (!(r.width > 0 && r.height > 0)) continue;
            }
            if (need.requireEnabled) {
              if (el.disabled === true) continue;
              if (el.getAttribute("aria-disabled") === "true") continue;
            }
            if (need.requireClickable) {
              const st = getComputedStyle(el);
              if (st.pointerEvents === "none") continue;
            }
            n += 1;
          }
          return n;
        } catch {
          return 0;
        }
      },
      args: [selector, req]
    });
    return Number(result) || 0;
  } catch {
    return 0;
  }
}

async function readElementText(tabId, node, graph, rowIndex) {
  const selector = (await resolveDynamicSelectorAsync(node, graph, rowIndex))
    || node.selectorValue || "";
  if (!selector) return "";
  const req = selectorStateReqs(node);
  try {
    await pingTabScriptable(tabId);
    const frameId = await resolveFramePath(tabId, parseFramePath(node.framePathJson));
    const waitMs = node.selectorWaitEnabled === true
      ? Math.max(0, Number(node.selectorWaitMs) || 1000)
      : 0;
    const deadline = Date.now() + waitMs;
    for (;;) {
      const [{ result } = {}] = await chrome.scripting.executeScript({
        target: { tabId, frameIds: [frameId] },
        func: (sel, need) => {
          let nodes;
          try { nodes = Array.from(document.querySelectorAll(sel)); } catch { return ""; }
          for (const el of nodes) {
            if (!(el instanceof Element)) continue;
            if (need.requireVisible || need.requireClickable) {
              const st = getComputedStyle(el);
              const r = el.getBoundingClientRect();
              if (st.display === "none" || st.visibility === "hidden" || Number(st.opacity) === 0) continue;
              if (!(r.width > 0 && r.height > 0)) continue;
            }
            if (need.requireEnabled) {
              if (el.disabled === true) continue;
              if (el.getAttribute("aria-disabled") === "true") continue;
            }
            if (need.requireClickable) {
              const st = getComputedStyle(el);
              if (st.pointerEvents === "none") continue;
            }
            if (el.value != null) return String(el.value);
            return (el.textContent || "").trim();
          }
          return null;
        },
        args: [selector, req]
      });
      if (result != null) return String(result);
      if (Date.now() >= deadline) return "";
      await sleep(100);
    }
  } catch {
    return "";
  }
}

async function closeWindowTab(currentTabId, which) {
  let tab;
  try {
    tab = await chrome.tabs.get(currentTabId);
  } catch {
    return { ok: false, error: tv("run.tabNotFound"), reason: "tab_missing" };
  }
  const winId = tab.windowId;
  const tabs = await chrome.tabs.query({ windowId: winId });
  const ordered = tabs.slice().sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  if (ordered.length <= 1) {
    return { ok: false, error: tv("run.lastTab"), reason: "last_tab" };
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
  const resolvedSelector = await resolveDynamicSelectorAsync(step, graph, rowIndex ?? 0);
  const resolvedUrl = await resolveStepParamAsync(step, graph, rowIndex ?? 0, { preferUrl: true });

  logDynamicSelectorResolution(step, resolvedSelector, rowIndex ?? 0);

  if (actionType === "CloseFirstTab" || actionType === "CloseLastTab") {
    return closeWindowTab(tabId, actionType === "CloseFirstTab" ? "first" : "last");
  }

  if (actionType === "NewPage") {
    let url = resolvedUrl || "about:blank";
    const cst0 = step.contentSourceType || "";
    if (cst0 === "Memory" || cst0 === "Elements" || cst0 === "System" || cst0 === "DataSource") {
      url = (await resolveStepParamAsync(step, graph, rowIndex ?? 0, { tabId, framePath })) || "about:blank";
    }
    const created = await chrome.tabs.create({ url, active: true });
    const newId = created.id;
    if (newId) await waitTabComplete(newId, resolveNavigationWaitMs(step));
    return { ok: true, tabId: newId, navigated: true };
  }

  if (actionType === "GoToUrl") {
    let url = resolvedUrl;
    const cst0 = step.contentSourceType || "";
    if (cst0 === "Memory" || cst0 === "Elements" || cst0 === "System" || cst0 === "DataSource") {
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
    await waitTabComplete(tabId, resolveNavigationWaitMs(step));
    return { ok: true };
  }

  if (actionType === "WaitTime") {
    let ms = 0;
    const cst0 = step.contentSourceType || "";
    if (cst0 === "Memory" || cst0 === "DataSource" || cst0 === "System") {
      const v = await resolveStepParamAsync(step, graph, rowIndex ?? 0, { tabId, framePath });
      ms = Number(v) || 0;
    } else {
      ms = Number(await resolveStepParamAsync(step, graph, rowIndex ?? 0, { tabId, framePath })) || 0;
    }
    return { ok: true, waitMs: ms };
  }

  // Writes a value the flow computed into the run's variable table. There is no page
  // interaction at all, so this returns before the selector/frame plumbing below —
  // requiring a selector here would make the step impossible to author.
  if (actionType === "SetMemory") {
    const name = String(step.memoryVariableName || "").trim();
    const value = await resolveStepParamAsync(step, graph, rowIndex ?? 0, { tabId, framePath });
    const saved = await setPlayMemoryVar(name, value);
    if (!saved?.ok) {
      return onUnexpected(runMode, {
        taskId,
        stepId: step.entityId,
        reason: saved?.reason || "missing_memory_name",
        expectedSelector: null,
        actualUrl: null
      });
    }
    return { ok: true, memorySet: { name, value: value == null ? "" : String(value) } };
  }

  // Reads a variable into the step's value. Like SetMemory this never touches the page, so it
  // returns before the selector plumbing — a selector here would be meaningless.
  if (actionType === "GetMemory") {
    const name = String(step.memoryVariableName || "").trim();
    if (!name) {
      return onUnexpected(runMode, {
        taskId, stepId: step.entityId, reason: "missing_memory_name",
        expectedSelector: null, actualUrl: null
      });
    }
    const stored = await chrome.storage.local.get("playMemory").catch(() => ({}));
    const mem = stored?.playMemory;
    const vars = (mem && mem.schema === PLAY_MEMORY_SCHEMA ? mem.vars : null) || {};
    // A variable that was never written reads as empty rather than failing: "not set yet" is a
    // normal state for a first iteration, and failing here would stop a run that is otherwise fine.
    return { ok: true, memoryGet: { name, value: vars[name] == null ? "" : String(vars[name]) } };
  }

  // Removes one row from a library data source. The server owns the store, so this is a plain
  // request; the row is picked with the same pointer vocabulary the inspector offers.
  if (actionType === "DeleteRow") {
    const dsId = Number(step.dataSourceId || step.saveDataSourceId || 0);
    if (!dsId) {
      return onUnexpected(runMode, {
        taskId, stepId: step.entityId, reason: "missing_source",
        expectedSelector: null, actualUrl: null
      });
    }
    const pointer = resolveDedicatedRow({ ...step, dedicatedRow: true }, graph, {
      groupRow: rowIndex, parentRow: rowIndex, loopIndex, groupIndex: loopIndex
    });
    const targetRow = pointer != null ? pointer : (Number(rowIndex) || 0);
    const removed = await chrome.runtime.sendMessage({
      type: "deleteDataSourceRow", dataSourceId: dsId, rowIndex: targetRow
    }).catch(() => null);
    if (!removed?.ok) {
      return onUnexpected(runMode, {
        taskId, stepId: step.entityId,
        reason: removed?.limit ? "source_limit" : (removed?.error || "delete_row_failed"),
        expectedSelector: null, actualUrl: null
      }, removed?.message || null);
    }
    appendPlayLog("info", `ردیف ${targetRow} از منبع ${dsId} حذف شد`);
    return { ok: true, rowDeleted: { dataSourceId: dsId, rowIndex: targetRow } };
  }

  // LoadContent: read one source cell and write it into a page element OR a memory variable.
  // Its value comes from the source, so it never reads the step's own value plumbing.
  if (actionType === "LoadContent") {
    return runLoadContentStep(tabId, taskId, step, runMode, graph, rowIndex, framePath);
  }

  // InsertContent: write a value INTO one cell of a data source. It touches the server store and
  // the current page only as a VALUE SOURCE, so it takes no target selector.
  if (actionType === "InsertContent") {
    return runInsertContentStep(tabId, taskId, step, runMode, graph, rowIndex, framePath);
  }

  const cst = step.contentSourceType || "";
  const needsAsyncValue = stepUsesDataSourceValue(step)
    || cst === "Memory" || cst === "Elements" || cst === "System"
    || (actionType === "InputContent" || actionType === "PressKey" || actionType === "SelectOption" || actionType === "Hold");

  let valueForAction;
  if (needsAsyncValue) {
    valueForAction = await resolveStepParamAsync(step, graph, rowIndex ?? 0, { tabId, framePath }) || "";
  } else if (actionType === "Hold") {
    // A blank duration is not an error: fall back to the diagram's inter-step gap so a Hold step
    // still means something the moment it is dropped on the canvas.
    const raw = String(step.constantValue ?? "").trim();
    valueForAction = raw === "" ? String(resolveStepDelayMs(graph) || HOLD_DEFAULT_MS) : raw;
  } else if (actionType === "ScrollPage") {
    const raw = String(step.constantValue ?? "").trim();
    valueForAction = raw === "" ? String(SCROLL_PAGE_DEFAULT_PX) : raw;
  } else {
    valueForAction = step.constantValue || "";
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
    ? Math.max(0, Number(step.selectorWaitMs) || 1000)
    : 0;
  const stateReq = selectorStateReqs(step);
  const payload = {
    actionType,
    selectorValue: resolvedSelector,
    constantValue: valueForAction,
    navigateUrl: step.navigateUrl,
    // SelectOption matches by value, label or position; PressKey needs the key name; every
    // RemoveElements run needs to know whether one match or all of them go.
    selectBy: step.selectBy || "Value",
    keyName: step.keyName || "",
    removeAllMatches: step.removeAllMatches !== false,
    highlightColor: resolveHighlightColor(graph),
    waitTimeoutMs,
    requireVisible: !!stateReq.requireVisible,
    requireEnabled: !!stateReq.requireEnabled,
    requireClickable: !!stateReq.requireClickable
  };

  // ONE execution path, deliberately.
  //
  // This used to try chrome.tabs.sendMessage into a content-script engine first and fall back to
  // executeInFrame. The two engines had drifted: the content script never learned SelectOption,
  // PressKey, ClearContent, ScrollIntoView or FocusElement, so whether those actions worked
  // depended on which path won the race — the same step could succeed on one run and come back
  // "unsupported_action" on the next. The injected engine is the complete one and needs no
  // content script to be present, so it is now the only path.
  const result = await (async () => {
    await clearTabPlayHighlights(tabId);
    return executeInFrame(tabId, frameId, payload);
  })();

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

/**
 * LoadContent — read ONE cell of a data source and put it into a target.
 *
 * The target is either a page element (the cell's text is typed into it) or a memory variable
 * (the cell's text is stored). The value always comes from the source, which is why this action
 * does not read the step's own value-source plumbing — reading a cell into a cell would be
 * InsertContent with a source-to-source copy, and that is not what this action is for.
 *
 * A failed read is a step error, never a silent empty string: substituting "" here would type
 * nothing into a real form and look like it worked.
 */
async function runLoadContentStep(tabId, taskId, step, runMode, graph, rowIndex, framePath) {
  const ds = findDataSourceForValue(step, graph);
  const column = step.dynamicSourceColumnName || step.saveColumnName;
  const text = await readDataSourceCellForPlay(ds, column, rowIndex ?? 0, step, graph);
  if (text === undefined) {
    // readDataSourceCellForPlay has already logged the reason; surface it as the step error.
    return onUnexpected(runMode, {
      taskId, stepId: step.entityId, reason: "data_source_unavailable",
      expectedSelector: step.selectorValue || null, actualUrl: null,
      framePathJson: step.framePathJson
    }, dataSourceUnavailable(step, ds, column, rowIndex).message);
  }

  const target = normalizeLoadTarget(step);
  if (target === "Memory") {
    const name = String(step.memoryVariableName || "").trim();
    const saved = await setPlayMemoryVar(name, text);
    if (!saved?.ok) {
      return onUnexpected(runMode, {
        taskId, stepId: step.entityId,
        reason: saved?.reason || "missing_memory_name",
        expectedSelector: null, actualUrl: null
      });
    }
    appendPlayLog("info", `مقدار سلول «${column}» در متغیر «${name}» ذخیره شد`);
    return { ok: true, text, memorySet: { name, value: text } };
  }

  // Target is a page element: type the cell's value into it, exactly as InputContent would.
  const resolvedSelector = await resolveDynamicSelectorAsync(step, graph, rowIndex ?? 0);
  if (!resolvedSelector) {
    return onUnexpected(runMode, {
      taskId, stepId: step.entityId, reason: "missing_selector",
      expectedSelector: "", actualUrl: null, framePathJson: step.framePathJson
    }, "سلکتور المان مقصد خالی است");
  }
  let frameId;
  try {
    frameId = await resolveFramePath(tabId, framePath || []);
  } catch (err) {
    return onUnexpected(runMode, {
      taskId, stepId: step.entityId, reason: "frame_resolve_failed",
      expectedSelector: resolvedSelector, actualUrl: null, framePathJson: step.framePathJson
    }, err.message);
  }
  const waitTimeoutMs = step.selectorWaitEnabled === true
    ? Math.max(0, Number(step.selectorWaitMs) || 1000)
    : 0;
  const stateReq = selectorStateReqs(step);
  const payload = {
    // The page-side branch is InputContent's: both write a value into a field.
    actionType: "InputContent",
    selectorValue: resolvedSelector,
    constantValue: text,
    highlightColor: resolveHighlightColor(graph),
    waitTimeoutMs,
    requireVisible: !!stateReq.requireVisible,
    requireEnabled: !!stateReq.requireEnabled,
    requireClickable: !!stateReq.requireClickable
  };
  // Same single-path rule as runStep above — see the comment there.
  const result = await (async () => {
    await clearTabPlayHighlights(tabId);
    return executeInFrame(tabId, frameId, payload);
  })();
  if (!result || !result.ok) {
    return onUnexpected(runMode, {
      taskId, stepId: step.entityId,
      reason: result?.reason || "action_failed",
      expectedSelector: resolvedSelector,
      actualUrl: result?.url || null,
      framePathJson: step.framePathJson
    }, result?.error);
  }
  return { ok: true, text, captured: true };
}

/**
 * InsertContent — write the step's resolved value into ONE cell of a data source.
 *
 * The value comes from wherever the author chose (constant / page element / memory / system).
 * An empty value is written as an empty cell rather than refused: blanking a cell is a legitimate
 * thing to want, and it is the author's explicit choice.
 */
async function runInsertContentStep(tabId, taskId, step, runMode, graph, rowIndex, framePath) {
  const text = await resolveStepParamAsync(step, graph, rowIndex ?? 0, { tabId, framePath });
  const dsId = step.saveDataSourceId != null ? step.saveDataSourceId : step.dataSourceId;
  const column = step.saveColumnName || step.dynamicSourceColumnName;
  const sources = graph?.dataSources || [];
  const ds = (dsId != null && sources.find((d) => Number(d.id) === Number(dsId)))
    || findDataSourceForValue(step, graph);

  const store = await storeCapturedContent(
    { ...step, saveTargetType: "DataSource", saveColumnName: column },
    graph, text, rowIndex ?? 0
  );
  if (!store.ok) {
    return onUnexpected(runMode, {
      taskId, stepId: step.entityId,
      reason: store.reason || "capture_store_failed",
      expectedSelector: null, actualUrl: null, framePathJson: step.framePathJson
    }, store.error);
  }
  appendPlayLog("info", `مقدار در سلول «${column}» منبع ${ds?.id ?? dsId} درج شد`);
  return { ok: true, text, inserted: true };
}

/**
 * Log the selector a dynamic step actually resolved to.
 *
 * When a selector is built from data (a source cell or a captured value) the raw
 * `selectorValue` in the graph is only a template, so the play log used to show nothing
 * about which element the run really targeted. If the step then failed, there was no way
 * to tell which row's value produced the selector, or what it looked like. This logs the
 * template, the resolved selector and the row, so a failure can be traced back.
 *
 * Nothing is logged for ordinary static selectors, which are already visible in the graph.
 */
function logDynamicSelectorResolution(step, resolvedSelector, rowIndex) {
  if (!step || !resolvedSelector) return;
  const valueKey = "selectorValue";
  const raw = String(step[valueKey] || "");
  const hasLegacy = /\{\{[^}]+\}\}/.test(raw);
  const hasPh = raw.includes(DYN_SEL_PLACEHOLDER);
  if (!step.selectorIsDynamic && !hasLegacy && !hasPh) return;
  // A template that resolved to itself adds no information.
  if (raw === resolvedSelector && !step.selectorIsDynamic) return;

  const title = step.title || step.actionType || "";
  appendPlayLog("info", tv("play.dynSelectorResolved", {
    title,
    row: Number(rowIndex) + 1,
    selector: resolvedSelector
  }));
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

async function resolveDynamicSelectorAsync(step, graph, rowIndex, opts = {}) {
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
      let val = "";
      if (col && ds) {
        const got = await readDataSourceCellForPlay(ds, col, row, step, graph);
        // A selector is the most dangerous place to accept a missing value: dropping the
        // placeholder yields a selector that still PARSES but points somewhere else, so the
        // click lands on the wrong element and nothing reports a problem.
        if (got === undefined) throw dataSourceUnavailable(step, ds, col, row);
        val = got;
      }
      sel = sel.split(DYN_SEL_PLACEHOLDER).join(val);
    }
    if (/\{\{[^}]+\}\}/.test(sel)) {
      const parts = sel.split(/(\{\{\s*[^}]+\s*\}\})/g);
      const out = [];
      for (const part of parts) {
        const m = part.match(/^\{\{\s*([^}]+?)\s*\}\}$/);
        if (m) {
          const got = await readDataSourceCellForPlay(ds, m[1], row, step, graph);
          if (got === undefined) throw dataSourceUnavailable(step, ds, m[1], row);
          out.push(got);
        } else {
          out.push(part);
        }
      }
      sel = out.join("");
    }
  }
  return appendAttributeFilterAsync(sel, step, graph, rowIndex, opts);
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

async function appendAttributeFilterAsync(sel, step, graph, rowIndex, opts = {}) {
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
    // The attribute value is part of the selector, so an unavailable value would produce a
    // selector matching the wrong element (e.g. [data-id=""]). Refuse rather than guess.
    const got = await readDataSourceCellForPlay(ds, step[dynColKey], rowIndex ?? 0, step, graph);
    if (got === undefined) throw dataSourceUnavailable(step, ds, step[dynColKey], rowIndex);
    attrVal = got;
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

/**
 * Format the machine clock for the SystemDate / SystemTime condition types.
 * Kept to ASCII digits on purpose: comparing against a constant typed in the
 * editor must not depend on the browser's locale digits.
 * Supported formats — date: `yyyy-MM-dd` (default), `yyyy/MM/dd`, `dd-MM-yyyy`,
 * `yyyyMMdd`, `Timestamp`; time: `HH:mm:ss` (default), `HH:mm`, `HHmmss`.
 */
function formatSystemClock(kind, format) {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  const yyyy = String(d.getFullYear());
  const MM = p(d.getMonth() + 1);
  const dd = p(d.getDate());
  const HH = p(d.getHours());
  const mm = p(d.getMinutes());
  const ss = p(d.getSeconds());
  const fmt = String(format || "").trim();

  if (kind === "SystemDate") {
    switch (fmt) {
      case "yyyy/MM/dd": return `${yyyy}/${MM}/${dd}`;
      case "dd-MM-yyyy": return `${dd}-${MM}-${yyyy}`;
      case "yyyyMMdd": return `${yyyy}${MM}${dd}`;
      case "Timestamp": return String(d.getTime());
      case "yyyy-MM-dd":
      default: return `${yyyy}-${MM}-${dd}`;
    }
  }
  switch (fmt) {
    case "HH:mm": return `${HH}:${mm}`;
    case "HHmmss": return `${HH}${mm}${ss}`;
    case "Timestamp": return String(d.getTime());
    case "HH:mm:ss":
    default: return `${HH}:${mm}:${ss}`;
  }
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
  if (stepUsesDataSourceValue(step)) {
    const ds = findDataSourceForValue(step, graph);
    const v = await readDataSourceCellForPlay(
      ds, step.dynamicSourceColumnName, rowIndex ?? 0, step, graph
    );
    // A REAL value (including a legitimately empty one) is used as-is.
    if (v !== undefined) return String(v);
    // The value could NOT be obtained. Falling through to `constantValue` here is what made a
    // server outage indistinguishable from live data: the step silently ran on the author's
    // stored constant. Surface it instead — the caller decides (see the strict consumers).
    throw dataSourceUnavailable(step, ds, step.dynamicSourceColumnName, rowIndex);
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
    const valueSel = await resolveDynamicSelectorAsync(step, graph, rowIndex ?? 0, {
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
    const eqReq = selectorStateReqs(step, { equal: true });
    const payload = {
      // Internal verb: read an element's text as a VALUE. It is not an ActionType — reading a
      // field is a sub-step of the actions that need a value, never something the author picks.
      actionType: "ReadElementValue",
      selectorValue: valueSel,
      constantValue: "",
      waitTimeoutMs: step.equalSelectorWaitEnabled === true
        ? Math.max(0, Number(step.equalSelectorWaitMs) || 1000)
        : 0,
      requireVisible: !!eqReq.requireVisible,
      requireEnabled: !!eqReq.requireEnabled,
      requireClickable: !!eqReq.requireClickable
    };
    await clearTabPlayHighlights(tabId);
    // Same single-path rule as runStep — see the comment there.
    const result = await executeInFrame(tabId, frameId, payload);
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
  if (!key) return { ok: false, error: tv("run.memNameEmpty"), reason: "missing_memory_name" };
  const { playMemory } = await chrome.storage.local.get("playMemory");
  const mem = playMemory && playMemory.schema === PLAY_MEMORY_SCHEMA
    ? playMemory
    : { schema: PLAY_MEMORY_SCHEMA, structureKey: "", vars: {} };
  mem.vars = mem.vars || {};
  mem.vars[key] = value == null ? "" : String(value);
  await chrome.storage.local.set({ playMemory: mem });
  return { ok: true };
}

const playCellWriteChains = new Map();
/** In-flight GET /cells dedupe (same key → one network call). */
const playCellReadInflight = new Map();

function clearPlayCellReadInflight() {
  playCellReadInflight.clear();
}

/**
 * Drop the per-cell write queues at the end of a run.
 *
 * `playCellWriteChains` serialises concurrent writes to the same cell so two steps cannot
 * clobber each other's revision. The queue is keyed by (dsId,row,column) and each entry is a
 * promise chain. Nothing cleared it, so across a long browser session the map grew without
 * bound, and — worse — a NEW run could pick up a chain left over from a run that had already
 * been stopped, serialising fresh writes behind a dead run's promise.
 *
 * We only drop our references; any in-flight write still settles on its own (it is awaited by
 * its own caller, and `stopPlay` already set `playAbort`, so its retry loop will not spin on).
 */
function clearPlayCellWriteChains() {
  playCellWriteChains.clear();
}

function playCellKey(dsId, rowIndex, columnKey) {
  return `${dsId}|${rowIndex}|${columnKey}`;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Read one cell from the server.
 *
 * Returns the RAW message result so the caller can tell the three cases apart:
 *   { ok:true,  body:{ cellValue } }  — read succeeded; cellValue may legitimately be ""
 *   { ok:false, error:"…" }           — the read FAILED (network, http, auth)
 *
 * It used to collapse a failure into `null` here, which made "the server is unreachable" and
 * "the cell is empty" the same value. That is what let a run continue with the node's stored
 * constant in place of live data, with nothing in the log to say so. Keeping the failure
 * distinct is the whole point; see fetchServerCellForPlay.
 */
async function readServerCell(dataSourceId, rowIndex, columnKey) {
  try {
    return await chrome.runtime.sendMessage({
      type: "readDataSourceCell",
      dataSourceId,
      rowIndex,
      columnKey
    });
  } catch (err) {
    // The worker or the page is gone. Still a failure, not an empty cell.
    return { ok: false, error: err?.message || String(err) };
  }
}

function applyCellToLocalCache(ds, rowIndex, columnKey, value, cellRevision, dataRevision) {
  if (!ds) return;
  ds.cells = ds.cells || [];
  const idx = Number(rowIndex) || 0;
  const col = String(columnKey || "").trim();
  let hit = ds.cells.find((c) =>
    (c.key === col || c.Key === col || c.columnName === col)
    && Number(c.index ?? c.Index ?? c.rowIndex) === idx
  );
  if (hit) {
    if (hit.cellValue !== undefined) hit.cellValue = value;
    else hit.CellValue = value;
    hit.cellRevision = cellRevision;
  } else {
    ds.cells.push({ key: col, index: idx, cellValue: value, cellRevision });
  }
  if (dataRevision != null) ds.dataRevision = dataRevision;
}

/** Write one cell on server — waits (retry) until the cell lock/revision allows it. */
async function writeServerCellWait(ds, graph, rowIndex, columnKey, text, opts = {}) {
  const id = Number(ds?.id);
  if (!id) return { ok: true, local: true };
  const col = String(columnKey || "").trim();
  const row = Number(rowIndex) || 0;
  const chainKey = playCellKey(id, row, col);
  const maxMs = Number(opts.maxWaitMs) || 20000;
  const run = async () => {
    const start = Date.now();
    let expectedCellRevision = null;
    // Consecutive 409s, to distinguish a one-off optimistic-concurrency conflict (retry at once)
    // from a contended cell (must back off). Reset by any non-conflict outcome.
    let conflictStreak = 0;
    while (Date.now() - start < maxMs) {
      const localHit = (ds.cells || []).find((c) =>
        (c.key === col || c.Key === col || c.columnName === col)
        && Number(c.index ?? c.Index ?? c.rowIndex) === row
      );
      if (localHit?.cellRevision != null) {
        expectedCellRevision = localHit.cellRevision;
      } else if (localHit?.CellRevision != null) {
        expectedCellRevision = localHit.CellRevision;
      } else {
        const fresh = await readServerCell(id, row, col);
        if (fresh?.ok && fresh.body) {
          expectedCellRevision = fresh.body.cellRevision ?? fresh.body.CellRevision ?? 0;
          if (fresh.body.dataRevision != null) ds.dataRevision = fresh.body.dataRevision;
        }
      }
      let res;
      try {
        res = await chrome.runtime.sendMessage({
          type: "patchDataSourceCell",
          dataSourceId: id,
          rowIndex: row,
          columnKey: col,
          cellValue: text,
          expectedCellRevision
        });
      } catch {
        res = null;
      }
      if (res?.ok && res.body) {
        const rev = res.body.cellRevision ?? res.body.CellRevision;
        const dRev = res.body.dataRevision ?? res.body.DataRevision;
        applyCellToLocalCache(ds, row, col, text, rev, dRev);
        return { ok: true, body: res.body };
      }
      if (res?.error === "auth") return { ok: false, error: "auth" };
      // A ceiling breach is permanent for this write — retrying cannot help, so stop at once and
      // carry the server's message through instead of burning the whole wait budget.
      if (res?.limit) {
        return {
          ok: false,
          error: "source_limit",
          message: res.message || res.body?.message || res.body?.Message || null
        };
      }
      // 409 conflict: adopt the server's current revision and retry.
      //
      // The retry is NOT immediate. A persistent conflict means some other writer is actively
      // holding this cell, and an unthrottled `continue` spun as fast as the event loop allowed —
      // hammering chrome.runtime.sendMessage (and the server behind it) for the whole wait budget,
      // while starving the very writer whose lock we were waiting on. So a conflict backs off
      // like any other retry; only the FIRST one retries at once, because a single conflict is
      // the normal optimistic-concurrency case and resolves as soon as we present the new
      // revision.
      if (res?.conflict) {
        conflictStreak += 1;
        const cur = res.body?.currentCellRevision ?? res.body?.CurrentCellRevision;
        if (cur != null) {
          expectedCellRevision = cur;
          applyCellToLocalCache(
            ds, row, col,
            res.body?.currentCellValue ?? res.body?.CurrentCellValue ?? "",
            cur,
            res.body?.currentDataRevision ?? res.body?.CurrentDataRevision
          );
          if (conflictStreak > 1) {
            // Growing, capped pause: enough to let the other writer finish, short enough that a
            // quick lock turnaround is not punished.
            await sleep(Math.min(1000, 60 * conflictStreak));
          }
          continue;
        }
      }
      // Any other outcome resets the streak: the next conflict is a fresh one, not a run of them.
      conflictStreak = 0;
      await sleep(Math.min(800, 80 + Math.floor((Date.now() - start) / 40)));
    }
    return { ok: false, error: "cell_write_timeout" };
  };
  const prev = playCellWriteChains.get(chainKey) || Promise.resolve();
  const next = prev.then(run, run);
  playCellWriteChains.set(chainKey, next.catch(() => {}));
  return next;
}

async function readDataSourceMetaFromServer(dataSourceId) {
  try {
    return await chrome.runtime.sendMessage({ type: "readDataSourceMeta", dataSourceId });
  } catch {
    return null;
  }
}

/** Fetch rowCount only when group-repeat needs it (no row/cell bulk load). */
async function ensureDataSourceRowCountMeta(ds) {
  const id = Number(ds?.id);
  if (!id || Number(ds.rowCount) > 0) return;
  const res = await readDataSourceMetaFromServer(id);
  if (!res?.ok || !res.body) return;
  ds.rowCount = Number(res.body.rowCount ?? res.body.RowCount) || ds.rowCount || 0;
  if (res.body.dataRevision != null) ds.dataRevision = res.body.dataRevision;
}

/**
 * Read a cell for a run, through the in-flight dedupe cache.
 *
 * Returns a STRING on success (an empty string for a legitimately empty cell) and `undefined`
 * when the read FAILED. The distinction is the entire point of phase 3.3:
 *
 *   ""          — we asked the server and the cell is empty. A real answer.
 *   undefined   — we could NOT ask, or the ask failed. NOT an answer.
 *
 * Callers that feed live data into a page action (a selector, a typed value, a URL) must treat
 * `undefined` as a step error rather than substituting the node's stored constant, because a
 * wrong value there means clicking or typing the wrong thing on a real page. Callers that merely
 * record a value can accept the gap.
 *
 * Reporting is deliberately NOT silent any more: a failed read is logged with its reason.
 */
async function fetchServerCellForPlay(id, row, col, ds, graph, step) {
  const cacheKey = playCellKey(id, row, col);
  if (playCellReadInflight.has(cacheKey)) {
    return playCellReadInflight.get(cacheKey);
  }
  const work = (async () => {
    const fresh = await readServerCell(id, row, col);
    if (!fresh?.ok || !fresh.body) {
      const why = fresh?.error || "پاسخی از سرور نرسید";
      appendPlayLog(
        "warn",
        `خواندن سلول «${col}» (ردیف ${row + 1}) از سرور ناموفق بود — ${why}`
      );
      return undefined;
    }
    const val = fresh.body.cellValue ?? fresh.body.CellValue ?? "";
    const rev = fresh.body.cellRevision ?? fresh.body.CellRevision;
    const dRev = fresh.body.dataRevision ?? fresh.body.DataRevision;
    applyCellToLocalCache(ds, row, col, val, rev, dRev);
    if (graph) {
      emitDataSourceCellEvent(graph, ds, col, row, "read", val, step?.title);
    }
    return String(val);
  })();
  playCellReadInflight.set(cacheKey, work);
  try {
    return await work;
  } finally {
    playCellReadInflight.delete(cacheKey);
  }
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
      return { ok: false, error: tv("run.saveTargetMissing"), reason: "missing_save_target" };
    }
    const idx = Number(rowIndex) || 0;
    const id = Number(ds.id);
    if (id > 0) {
      emitDataSourceCellEvent(graph, ds, col, idx, "write", text, step?.title);
      const saved = await writeServerCellWait(ds, graph, idx, col, text);
      if (!saved.ok) {
        // A ceiling breach is not a transient failure: report the server's own message (which names
        // the row/byte cap and whether the license or the plan set it) instead of the generic
        // "could not save", and do not pretend a retry would help.
        if (saved.error === "source_limit") {
          return {
            ok: false,
            error: saved.message || tv("run.sourceLimitExceeded"),
            reason: "source_limit"
          };
        }
        return {
          ok: false,
          error: saved.error === "cell_write_timeout"
            ? tv("run.cellBusy")
            : tv("run.cellSaveFailed"),
          reason: saved.error || "cell_patch_failed"
        };
      }
      return { ok: true };
    }
    ds.cells = ds.cells || [];
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

function stepUsesDataSourceValue(step) {
  const cst = step?.contentSourceType || "";
  return cst === "DataSource" || step?.valueFromSource
    || (step?.dataSourceId && step?.dynamicSourceColumnName
      && cst !== "Memory" && cst !== "Elements" && cst !== "System");
}

/**
 * Resolve one cell's value for a run.
 *
 * Return contract (phase 3.3) — the caller's behaviour depends on telling these apart:
 *   ""          a real, empty value
 *   "text"      a real value
 *   undefined   NO VALUE AVAILABLE — the data source or column is missing, the cell is not in the
 *               local cache and the server could not supply it, or the read failed.
 *
 * `undefined` means "we could not find out", which is not the same as "the value is empty". A
 * page action must not silently proceed on it.
 */
async function readDataSourceCellForPlay(ds, columnKey, rowIndex, step, graph) {
  if (!ds || !columnKey) return undefined;
  const col = String(columnKey).trim();
  const row = Number(rowIndex) || 0;
  const id = Number(ds.id) || 0;

  if (id <= 0) {
    // Local-only source: whatever the cache holds is all there is.
    return cellValue(ds, col, row, { emitRead: true, graph, stepTitle: step?.title }) ?? undefined;
  }

  const mirrored = cellValue(ds, col, row, { emitRead: false });
  if (mirrored != null) {
    if (graph) emitDataSourceCellEvent(graph, ds, col, row, "read", mirrored, step?.title);
    return String(mirrored);
  }

  // Not cached — ask the server. This yields "" for a genuinely empty cell and `undefined`
  // when the read failed, and the two must not be conflated.
  return fetchServerCellForPlay(id, row, col, ds, graph, step);
}

/**
 * Portal housekeeping calls (register / unregister / abort-poll) with a hard ceiling.
 *
 * Plain `fetch` has NO timeout. If the portal is unreachable in a way that hangs the
 * connection instead of refusing it (VPN drop, wedged proxy, machine asleep mid-flight), the
 * promise never settles. That matters because `unregisterPlayOnServer` is awaited by
 * `stopPlay`, so a hung portal could stall the Stop path itself — the user presses Stop and
 * the run never reports as stopped. These are all bookkeeping requests that nobody waits on
 * for a result, so failing fast is strictly better than hanging.
 *
 * The abort is composed with any signal the caller supplied rather than replacing it.
 */
const PORTAL_FETCH_TIMEOUT_MS = 8000;

async function portalFetch(path, opts) {
  try {
    const portal = typeof portalBase === "function" ? await portalBase().catch(() => null) : null;
    const base = String(portal || "").replace(/\/$/, "");
    if (!base) return null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PORTAL_FETCH_TIMEOUT_MS);
    // Honour a caller's own signal too: aborting on either reason must settle the request.
    const callerSignal = opts && opts.signal;
    if (callerSignal) {
      if (callerSignal.aborted) controller.abort();
      else callerSignal.addEventListener("abort", () => controller.abort(), { once: true });
    }
    try {
      return await fetch(`${base}${path}`, {
        credentials: "omit",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        ...(opts || {}),
        signal: controller.signal
      });
    } finally {
      clearTimeout(timer);
    }
  } catch {
    // Callers already treat null / rejection as "portal unavailable" and carry on.
    return null;
  }
}

async function registerPlayOnServer(taskId) {
  const userName = (await chrome.storage.local.get("da_local_user").catch(() => ({}))).da_local_user
    || null;
  await portalFetch("/Panel/Tasks/RegisterPlay", {
    method: "POST",
    body: JSON.stringify({ taskId: String(taskId), userName })
  });
}

async function unregisterPlayOnServer(taskId) {
  await portalFetch("/Panel/Tasks/UnregisterPlay", {
    method: "POST",
    body: JSON.stringify({ taskId: String(taskId) })
  });
}

function startPlayAbortWatch(taskId) {
  if (playAbortPoll) clearInterval(playAbortPoll);
  registerPlayOnServer(taskId).catch(() => {});
  playAbortPoll = setInterval(async () => {
    if (!playStatus.playing) return;
    try {
      const res = await portalFetch(`/Panel/Tasks/PlayAbort?taskId=${encodeURIComponent(taskId)}`, { method: "GET" });
      if (!res || !res.ok) return;
      const body = await res.json().catch(() => ({}));
      if (body.abort) {
        appendPlayLog("error", "اجرا به‌خاطر تغییر فرآیند متوقف شد");
        await stopPlay("canvas_changed");
      }
    } catch { /* ignore */ }
  }, 1500);
}

async function emitDataSourceCellEvent(graph, ds, columnKey, rowIndex, op, cellValue, stepTitle) {
  try {
    const taskId = String(graph?.taskId || playStatus.taskId || "").trim();
    const dsId = Number(ds?.id || 0);
    if (!taskId || !dsId || !columnKey) return;
    let userName = null;
    try {
      const stored = await chrome.storage.local.get(["da_local_user", "da_session_user"]).catch(() => ({}));
      userName = stored.da_local_user || stored.da_session_user || null;
    } catch { /* ignore */ }
    if (!userName && typeof localStorage !== "undefined") {
      userName = localStorage.getItem("da_local_user") || localStorage.getItem("da_user") || null;
    }
    const payload = {
      taskId,
      dataSourceId: dsId,
      op: op === "write" ? "write" : "read",
      columnKey: String(columnKey),
      rowIndex: Number(rowIndex) || 0,
      cellValue: cellValue == null ? null : String(cellValue),
      stepTitle: stepTitle || null,
      userName
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

async function resolveDynamicTextAsync(text, step, graph, rowIndex) {
  if (text == null || text === "") {
    if (step?.dynamicSourceColumnName) {
      const ds = findDataSourceForValue(step, graph);
      const v = await readDataSourceCellForPlay(
        ds, step.dynamicSourceColumnName, rowIndex ?? 0, step, graph
      );
      if (v === undefined) throw dataSourceUnavailable(step, ds, step.dynamicSourceColumnName, rowIndex);
      return String(v);
    }
    return text || "";
  }
  if (typeof text !== "string") return text || "";
  if (!/\{\{[^}]+\}\}/.test(text)) return text;
  const ds = findDataSourceForValue(step, graph) || findDataSourceForStep(step, graph);
  const parts = text.split(/(\{\{\s*[^}]+\s*\}\})/g);
  const out = [];
  for (const part of parts) {
    const m = part.match(/^\{\{\s*([^}]+?)\s*\}\}$/);
    if (m) {
      const v = await readDataSourceCellForPlay(ds, m[1], rowIndex ?? 0, step, graph);
      // An unavailable placeholder must NOT vanish. Substituting "" silently truncated the
      // text — a half-built selector or a half-typed value — and the step then acted on it.
      if (v === undefined) throw dataSourceUnavailable(step, ds, m[1], rowIndex);
      out.push(v);
    } else {
      out.push(part);
    }
  }
  return out.join("");
}

/** Build the error used whenever a needed data-source value could not be read. */
function dataSourceUnavailable(step, ds, columnKey, rowIndex) {
  const why =
    `مقدار از منبع داده خوانده نشد (منبع ${ds?.id ?? "?"}، ستون «${columnKey || "?"}»، ` +
    `ردیف ${(rowIndex ?? 0) + 1})`;
  appendPlayLog("error", `${why} — از مقدار خالی/ثابت به‌جای دادهٔ واقعی استفاده نمی‌شود.`);
  const err = new Error(why);
  err.reason = "data_source_unavailable";
  return err;
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

  if (opts.conditionNodeId) {
    const n = findGraphNode(graph, opts.conditionNodeId);
    return n && n.kind === "condition" ? [] : [];
  }
  if (opts.stepNodeId) {
    const n = findGraphNode(graph, opts.stepNodeId);
    if (n && isActionNode(n)) return [n];
    // Condition via stepNodeId — handled in runPlayLoop, not as action steps
    if (n && n.kind === "condition") return [];
    return [];
  }

  // Guard: never walk the full graph when a scoped play was requested.
  if (opts.playScope === "step" || opts.playScope === "condition") {
    return [];
  }

  const entry = resolvePlayEntryId(graph, opts);
  if (entry) walk(entry, 0);

  // Last resort: if the walk found nothing and this is not a group play, fall back to every
  // action in root scope. "Every action" means every action REACHABLE from the start node,
  // not every action on the canvas: a node with no path from start is never executed by
  // executeFlow, so counting it here would promise steps that will not run.
  if (steps.length === 0 && !opts.groupNodeId) {
    const reachable = collectReachableFromStart(graph);
    for (const n of graph.nodes || []) {
      if (isActionNode(n) && !n.groupNodeId && (!reachable || reachable.has(n.id))) steps.push(n);
    }
  }
  return steps;
}

/**
 * Ids of every node reachable from the root start node, following the same edges executeFlow
 * walks (start/action → next, condition → success or next, group → inner start/contains and
 * then its own next).
 *
 * Returns null when there is no root start node, because then there is no entry point to
 * measure reachability from and the caller should keep its previous "assume everything"
 * behaviour rather than silently collecting nothing.
 */
function collectReachableFromStart(graph) {
  const nodes = new Map((graph.nodes || []).map((n) => [n.id, n]));
  const edges = graph.edges || [];
  const rootStart = (graph.nodes || []).find((n) => n.kind === "start" && !n.groupNodeId);
  if (!rootStart) return null;

  const reachable = new Set();
  const queue = [rootStart.id];
  while (queue.length) {
    const id = queue.shift();
    if (!id || reachable.has(id)) continue;
    const node = nodes.get(id);
    if (!node) continue;
    reachable.add(id);

    // Containment is a structural link, not a flow link, but a group's children are reachable
    // through the group, so it is followed here.
    for (const e of edges) {
      if (e.from !== id) continue;
      if (e.kind === "contains" || e.kind === "parent") { queue.push(e.to); continue; }
      if (node.kind === "condition") {
        // Both branches can run depending on the result.
        if (e.kind === "success" || e.kind === "fail" || e.kind === "next") queue.push(e.to);
      } else {
        if (e.kind === "next") queue.push(e.to);
      }
    }
  }
  return reachable;
}

/**
 * Resolve the row a group with "dedicated row" enabled must work on.
 *
 * Returns null when the switch is off or unusable, so the caller falls back to the normal loop-follow
 * behaviour. Every branch is deliberately tolerant: a pointer that cannot be resolved must not crash
 * a run, it just leaves the group following its loop.
 */
function resolveDedicatedRow(startNode, graph, ctx) {
  if (!startNode || startNode.dedicatedRow !== true) return null;
  const pointer = String(startNode.rowIndexType || "None");
  const { groupRow, parentRow, loopIndex, groupIndex } = ctx || {};
  switch (pointer) {
    case "CurrentLoop":
      return Number.isFinite(Number(groupRow)) ? Number(groupRow) : null;
    case "ParentLoop":
      return Number.isFinite(Number(parentRow)) ? Number(parentRow) : null;
    // "TotalLoop" is an index into the whole loop run, so it reuses the outer loop position rather
    // than the source row the group happens to be on.
    case "TotalLoop":
      return Number.isFinite(Number(loopIndex)) ? Number(loopIndex) : (Number.isFinite(Number(groupIndex)) ? Number(groupIndex) : null);
    case "FirstRow":
      return 0;
    case "LastRow": {
      const ds = findDedicatedRowSource(startNode, graph);
      const rc = Number(ds?.rowCount);
      if (Number.isFinite(rc) && rc > 0) return rc - 1;
      // Fall back to the last row we can actually see in the graph when the count is unknown.
      const idxs = (ds?.cells || [])
        .map((c) => Number(c.index ?? c.Index ?? c.rowIndex))
        .filter((x) => Number.isFinite(x));
      return idxs.length ? Math.max(...idxs) : null;
    }
    case "SpecificRow": {
      const idx = Number(startNode.specificRowIndex);
      if (!Number.isFinite(idx) || idx < 0) return null;
      // Clamp to the source so a stale index (source shrank after the graph was saved) reads the
      // nearest existing row instead of silently reading nothing.
      const ds = findDedicatedRowSource(startNode, graph);
      const rc = Number(ds?.rowCount);
      if (Number.isFinite(rc) && rc > 0 && idx > rc - 1) return rc - 1;
      return idx;
    }
    default:
      return null;
  }
}

/** The source a row pointer resolves against: the node's own pick, else the process default. */
function findDedicatedRowSource(startNode, graph) {
  const sources = graph?.dataSources || [];
  const id = startNode?.dataSourceId ?? startNode?.saveDataSourceId ?? graph?.dataSourceId;
  if (id == null || id === "") return null;
  return sources.find((d) => Number(d.id) === Number(id)) || null;
}

/** Expand group iterations from group-start repeat settings (Loops / DataSource / Elements). */
async function expandGroupByRepeatSource(tabId, groupOrStart, graph) {
  const node = groupOrStart || {};
  const type = String(node.repeatSourceType || "None");
  if (type === "None" || !type) {
    return { type: "None", indices: [0], total: 1, label: "یک‌بار" };
  }
  if (type === "Loops") {
    const n = Math.max(1, Number(node.loopCount ?? node.constantValue) || 1);
    return {
      type: "Loops",
      indices: Array.from({ length: n }, (_, i) => i),
      total: n,
      label: `تعداد ثابت × ${n}`
    };
  }
  if (type === "DataSource") {
    const dsId = node.dataSourceId;
    const ds = (graph.dataSources || []).find((d) => Number(d.id) === Number(dsId));
    if (ds) await ensureDataSourceRowCountMeta(ds);
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
      appendPlayLog("warn", "منبع گروه ردیفی ندارد؛ یک‌بار اجرا می‌شود.");
      return { type: "DataSource", indices: [0], total: 1, label: "منبع (بدون ردیف)" };
    }
    // Honour the group start's own from/to range, exactly as the process-level start does.
    // Without this a group set to repeat over rows 3..5 ran the whole source, so the two repeat
    // paths disagreed about the same fields and the editor's range box was inert for groups.
    const allIndices = Array.from({ length: count }, (_, i) => i);
    const indices = applyIndexRange(allIndices, node.repeatFromIndex, node.repeatToIndex);
    const rangeNote = (indices.length !== count)
      ? ` (ردیف ${indices[0] + 1} تا ${indices[indices.length - 1] + 1})`
      : "";
    return {
      type: "DataSource",
      indices,
      total: indices.length,
      sourceRowCount: count,
      repeatFromIndex: node.repeatFromIndex ?? null,
      repeatToIndex: node.repeatToIndex ?? null,
      label: `منبع «${ds?.title || dsId}» × ${indices.length}${rangeNote}`
    };
  }
  if (type === "Elements") {
    const css = String(node.elementValue || node.selectorValue || node.css || "").trim();
    if (!css) {
      appendPlayLog("warn", "سلکتور تکرار المان خالی است؛ یک‌بار اجرا می‌شود.");
      return { type: "Elements", indices: [0], total: 1, label: "المان (بدون سلکتور)" };
    }
    let count = 0;
    try {
      const framePath = parseFramePath(node.framePathJson || node.framePath);
      const frameId = await resolveFramePath(tabId, framePath);
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId, frameIds: [frameId] },
        func: (sel) => {
          try {
            return document.querySelectorAll(sel).length;
          } catch {
            return 0;
          }
        },
        args: [css]
      });
      count = Number(result) || 0;
    } catch (err) {
      appendPlayLog("warn", `شمارش المان‌ها ناموفق: ${err?.message || err}`);
      count = 0;
    }
    if (!count) {
      appendPlayLog("warn", "هیچ المانی برای تکرار گروه پیدا نشد؛ یک‌بار اجرا می‌شود.");
      return { type: "Elements", indices: [0], total: 1, label: "المان (۰)" };
    }
    return {
      type: "Elements",
      indices: Array.from({ length: count }, (_, i) => i),
      total: count,
      label: `المان‌ها × ${count}`
    };
  }
  return { type: "None", indices: [0], total: 1, label: "یک‌بار" };
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

async function clearTabPlayHighlights(tabId) {
  if (!tabId) return;
  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: () => {
        try {
          // The marked node is the PAGE'S OWN element, not an overlay we created — removing it would
          // delete the user's markup. Undo the outline we set and drop the marker class instead.
          document.querySelectorAll(".da-play-hl").forEach((n) => {
            n.style.removeProperty("outline");
            n.style.removeProperty("outline-offset");
            n.classList.remove("da-play-hl");
          });
          // Sweep any leftover overlay from an older build so a page is never left with a stray box.
          document.querySelectorAll("#da-play-hl").forEach((n) => n.remove());
        } catch { /* ignore */ }
      }
    });
  } catch {
    /* ignore — tab may not allow scripting */
  }
}

async function executeInFrame(tabId, frameId, payload) {
  try {
    await clearTabPlayHighlights(tabId);
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId, frameIds: [frameId] },
      func: playExecuteInjected,
      args: [payload]
    });
    return result || { ok: false, error: tv("run.noResult"), reason: "inject_empty" };
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
  const stateReq = {
    requireVisible: !!payload.requireVisible,
    requireEnabled: !!payload.requireEnabled,
    requireClickable: !!payload.requireClickable
  };

  function normalizeColor(v) {
    const s = String(v || "").trim();
    if (/^#[0-9a-fA-F]{6}$/.test(s)) return s.toLowerCase();
    if (/^#[0-9a-fA-F]{3}$/.test(s)) {
      return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`.toLowerCase();
    }
    return "#ea5455";
  }

  /**
   * Outline the element a step is about to act on.
   *
   * The highlight is applied to the element ITSELF rather than to a box drawn over it. An overlay
   * sits at fixed coordinates captured at highlight time, so anything that moves or resizes the page
   * afterwards (a lazy image, a font swap, a scroll inside a container) leaves the outline behind,
   * pointing at empty space. It also cannot follow an element inside a scrolling pane. Setting the
   * element's own outline moves with it by construction and needs no coordinates at all.
   *
   * `outline` is used rather than `border`: a border participates in layout, so adding one would
   * shift the page by its width and could reflow the very element being clicked. An outline is drawn
   * outside the box model, so nothing on the page moves.
   */
  function highlightTarget(el, color) {
    if (!(el instanceof Element)) return;
    const c = normalizeColor(color);
    try {
      document.querySelectorAll(".da-play-hl").forEach((n) => {
        // Restore whatever the element had before, so a page is never left permanently recoloured.
        n.style.removeProperty("outline");
        n.style.removeProperty("outline-offset");
        n.classList.remove("da-play-hl");
      });
    } catch { /* ignore */ }
    try { el.scrollIntoView({ block: "center", inline: "nearest" }); } catch { /* ignore */ }
    try {
      el.style.setProperty("outline", `3px solid ${c}`, "important");
      // A small positive offset keeps the ring clear of an element's own border so both stay visible.
      el.style.setProperty("outline-offset", "2px", "important");
      el.classList.add("da-play-hl");
    } catch { /* ignore */ }
  }

  function elementMatchesState(el, need) {
    if (!(el instanceof Element)) return false;
    if (need.requireVisible || need.requireClickable) {
      const st = window.getComputedStyle(el);
      const r = el.getBoundingClientRect();
      if (st.display === "none" || st.visibility === "hidden" || Number(st.opacity) === 0) return false;
      if (!(r.width > 0 && r.height > 0)) return false;
    }
    if (need.requireEnabled) {
      if (el.disabled === true) return false;
      if (el.getAttribute("aria-disabled") === "true") return false;
      if (el.getAttribute("disabled") != null && el.getAttribute("disabled") !== "false") return false;
    }
    if (need.requireClickable) {
      const st = window.getComputedStyle(el);
      if (st.pointerEvents === "none") return false;
      const r = el.getBoundingClientRect();
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) return false;
      try {
        const top = document.elementFromPoint(x, y);
        if (top && top !== el && !el.contains(top) && !(top.contains && top.contains(el))) return false;
      } catch { /* ignore */ }
    }
    return true;
  }

  async function waitForElement(sel, timeoutMs, need) {
    const deadline = Date.now() + Math.max(0, Number(timeoutMs) || 0);
    for (;;) {
      let nodes;
      try {
        nodes = Array.from(document.querySelectorAll(sel));
      } catch {
        return { ok: false, error: tv("run.badSelector", { sel }), reason: "bad_selector" };
      }
      for (const el of nodes) {
        if (elementMatchesState(el, need || {})) return { ok: true, el };
      }
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

  // ScrollPage: move the page (or the nearest scrollable ancestor) by the step's amount, in device
  // pixels down the document. It runs before the selector guard because it acts on the document,
  // not on an element — demanding a selector here would make the action unauthorable.
  if (actionType === "ScrollPage") {
    const amount = Number(value);
    const dy = Number.isFinite(amount) && amount !== 0 ? amount : SCROLL_PAGE_DEFAULT_PX;
    try {
      window.scrollBy({ top: dy, left: 0, behavior: "instant" });
    } catch {
      try { window.scrollBy(0, dy); } catch { /* a page that refuses to scroll is not a failure */ }
    }
    return { ok: true, scrolledBy: dy };
  }

  // AlertAccept: close a browser dialog by accepting it.
  //
  // This is the one action that cannot be done from injected page code. A JS dialog
  // (alert/confirm/prompt) BLOCKS the page's own script the moment it opens, so by the time any
  // injected code runs the dialog is already up and only the browser itself can dismiss it. The
  // extension dismisses it through a native dialog handler registered for the tab, so this branch
  // reports what the handler saw rather than trying to click anything.
  if (actionType === "AlertAccept") {
    if (typeof window.__daAlertTake !== "function") {
      return { ok: false, error: tv("run.alertNotArmed"), reason: "alert_not_armed" };
    }
    const seen = window.__daAlertTake();
    if (!seen) {
      // No dialog was observed. Reported as a clear outcome rather than a silent pass: this step
      // exists to clear a dialog, so finding none usually means the page changed.
      return { ok: false, error: tv("run.alertNone"), reason: "alert_not_found" };
    }
    return { ok: true, accepted: 1 };
  }

  // WaitForLoading: wait until the document reports itself complete, then return. The budget is
  // bounded here as well as in the caller, so a page that never finishes cannot hang the run.
  if (actionType === "WaitForLoading") {
    const maxMs = Math.max(0, Number(value) || 0) || 15000;
    const deadline = Date.now() + maxMs;
    // `document.readyState === "complete"` is the same condition the browser fires `load` for.
    while (document.readyState !== "complete" && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 100));
    }
    if (document.readyState !== "complete") {
      return { ok: true, timedOut: true, note: "still_loading" };
    }
    return { ok: true };
  }

  if (!selector) return { ok: false, error: tv("run.selectorEmpty"), reason: "missing_selector" };

  // A deliberate wait for an element to exist. It must run before the shared existence
  // check below, which uses the per-step selector timeout and would report the element
  const found = await waitForElement(selector, waitTimeoutMs, stateReq);
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

  // Internal verb, not an ActionType: read the element's text back as a value. The actions that
  // need a value from the page (InputContent, InsertContent, SetMemory, GoToUrl as a URL…) all
  // funnel their read through here instead of each having their own copy.
  if (actionType === "ReadElementValue") {
    let text = "";
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
      text = el.value || "";
    } else {
      text = (el.innerText || el.textContent || "").trim();
    }
    return { ok: true, text };
  }

  // One branch for every action that puts a value into a field: InputContent writes the author's
  // value, and LoadContent (which types a source cell in) reuses it by sending InputContent.
  if (actionType === "InputContent") {
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

  // Hold: press the element and keep the button down for the step's duration, then release. A page
  // that reacts to a long press listens across the whole down..up window, so a plain click (down
  // and up in the same tick) is never seen as one. Dispatching the down, waiting, then the up is
  // what makes it work; the wait happens here because only this injected context can hold the
  // press open while the page is live.
  if (actionType === "Hold") {
    const holdMs = Math.max(0, Number(value) || 0);
    const r = el.getBoundingClientRect();
    const opts = {
      bubbles: true, cancelable: true, view: window, button: 0,
      clientX: r.left + r.width / 2,
      clientY: r.top + r.height / 2
    };
    try {
      el.dispatchEvent(new MouseEvent("mousedown", opts));
      // A pointerdown too: modern long-press handlers listen for pointer events, not mouse ones.
      try { el.dispatchEvent(new PointerEvent("pointerdown", { ...opts, pointerId: 1, isPrimary: true })); } catch { /* older engines */ }
      await new Promise((res) => setTimeout(res, holdMs));
      el.dispatchEvent(new MouseEvent("mouseup", opts));
      el.click();
      try { el.dispatchEvent(new PointerEvent("pointerup", { ...opts, pointerId: 1, isPrimary: true })); } catch { /* ignore */ }
    } catch (err) {
      return { ok: false, error: String(err && err.message || err), reason: "hold_failed" };
    }
    return { ok: true, waitMs: 0, heldMs: holdMs };
  }

  // RemoveElements: delete the matched element(s) from the DOM. The page keeps whatever it does
  // with a missing node — this is a real removal, not a hide, because a hidden element still
  // occupies the layout and still answers queries, which is usually the opposite of the intent.
  if (actionType === "RemoveElements") {
    let nodes;
    try {
      nodes = Array.from(document.querySelectorAll(selector));
    } catch {
      return { ok: false, error: tv("run.badSelector", { sel: selector }), reason: "bad_selector" };
    }
    const wanted = payload.removeAllMatches !== false ? nodes : nodes.slice(0, 1);
    let removed = 0;
    for (const node of wanted) {
      try {
        if (node.parentNode) { node.parentNode.removeChild(node); removed += 1; }
      } catch { /* a node we cannot detach is skipped rather than failing the whole step */ }
    }
    if (!removed) {
      return { ok: false, error: tv("run.removeNone", { sel: selector }), reason: "element_not_found" };
    }
    return { ok: true, removed };
  }

  // A field usually has to be emptied before new text goes in: typing appends to whatever
  // is already there, so an "InputContent" over a pre-filled box concatenates silently.
  if (actionType === "ClearContent") {
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const desc = Object.getOwnPropertyDescriptor(proto, "value");
      if (desc && desc.set) desc.set.call(el, "");
      else el.value = "";
    } else if (el.isContentEditable) {
      el.textContent = "";
    }
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return { ok: true };
  }

  if (actionType === "FocusElement") {
    try { el.focus({ preventScroll: false }); } catch { /* a detached node cannot take focus */ }
    return { ok: true };
  }

  // Scrolling matters because a click on an off-screen element can land on the wrong
  // target: the page still scrolls on click, but the coordinates were measured first.
  if (actionType === "ScrollIntoView") {
    try { el.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" }); }
    catch { try { el.scrollIntoView(); } catch { /* ignore */ } }
    return { ok: true };
  }

  if (actionType === "SelectOption") {
    if (!(el instanceof HTMLSelectElement)) {
      return { ok: false, error: tv("run.notSelect"), reason: "not_select" };
    }
    const mode = payload.selectBy || "Value";
    const wanted = String(value == null ? "" : value);
    let index = -1;
    if (mode === "Index") {
      index = Number(wanted);
      if (!Number.isInteger(index) || index < 0 || index >= el.options.length) index = -1;
    } else if (mode === "Text") {
      index = Array.from(el.options).findIndex((o) => (o.textContent || "").trim() === wanted.trim());
    } else {
      index = Array.from(el.options).findIndex((o) => o.value === wanted);
      // Value is exact by design; a label written into the value field is a common
      // authoring slip, so fall back to text rather than failing outright.
      if (index < 0) index = Array.from(el.options).findIndex((o) => (o.textContent || "").trim() === wanted.trim());
    }
    if (index < 0) {
      return { ok: false, error: tv("run.optionNotFound", { v: wanted }), reason: "option_not_found" };
    }
    el.selectedIndex = index;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return { ok: true };
  }

  if (actionType === "PressKey") {
    const key = String(payload.keyName || value || "Enter");
    const target = el || document.activeElement || document.body;
    const init = { key, bubbles: true, cancelable: true };
    try {
      target.dispatchEvent(new KeyboardEvent("keydown", init));
      target.dispatchEvent(new KeyboardEvent("keypress", init));
      target.dispatchEvent(new KeyboardEvent("keyup", init));
    } catch { /* ignore */ }
    // Enter inside a form is the one key a page cannot observe from JS, so it is
    // submitted explicitly; every other key is left to the page's own handlers.
    if (key === "Enter") {
      const form = target.form || (target.closest && target.closest("form"));
      if (form && typeof form.requestSubmit === "function") {
        try { form.requestSubmit(); } catch { /* ignore */ }
      }
    }
    return { ok: true };
  }

  // A breakpoint is a marker an operator steps past, not a page interaction.
  if (actionType === "Breakpoint") return { ok: true, skipped: true };

  return { ok: false, error: tv("run.unsupportedAction", { action: actionType }), reason: "unsupported_action" };
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

/**
 * Wait for a tab's load to finish.
 * `maxMs` bounds the wait; the caller decides the value (GoToUrl uses the step's
 * `waitMaxMs`). 0 disables the wait entirely and resolves on the next tick.
 */
function waitTabComplete(tabId, maxMs) {
  const limit = maxMs == null ? 15000 : Math.max(0, Number(maxMs) || 0);
  // Already stopped: do not even arm a timer. Without this, a stop issued while a previous
  // step was still settling would leave this wait to expire on its own.
  if (playAbort) return Promise.resolve();
  if (limit === 0) return Promise.resolve();
  return new Promise((resolve) => {
    // One teardown for every exit path (load event, timeout, abort) so a stopped run cannot
    // leave this listener attached — a leaked onUpdated listener keeps firing on every tab
    // change for the rest of the browser session.
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      clearInterval(abortPoll);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    };

    const timeout = setTimeout(finish, limit);

    // This wait is the longest single blocking point in a step (up to 15 s), so it is where
    // "توقف" used to feel broken: the pause/stop was honoured only after the page finished
    // loading. Polling playAbort makes Stop take effect inside the wait, not after it.
    // The 200 ms cadence matches sleepInterruptible().
    const abortPoll = setInterval(() => {
      if (playAbort) finish();
    }, 200);

    function listener(id, info) {
      if (id === tabId && info.status === "complete") finish();
    }
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId).then((tab) => {
      if (tab.status === "complete") finish();
    }).catch(() => {});
  });
}

/** GoToUrl / NewPage: wait for load unless the step switched it off; cap by waitMaxMs. */
function resolveNavigationWaitMs(step) {
  if (!step || step.waitForLoad === false) return 0;
  const raw = Number(step.waitMaxMs);
  if (Number.isFinite(raw) && raw > 0) return raw;
  // Default keeps the historical behaviour (15 s) when no explicit cap is set.
  return 15000;
}


function notifyTab(tabId, message) {
  chrome.tabs.sendMessage(tabId, message).catch(() => {});
}
