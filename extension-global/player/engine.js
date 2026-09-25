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

function stepIsCapture(actionType) {
  return actionType === "TakeContent" || actionType === "SaveContent";
}

function stepIsUrlAction(actionType) {
  return actionType === "GoToUrl" || actionType === "Navigate" || actionType === "NewPage";
}

function stepReceivesValue(actionType) {
  return [
    "InputContent", "InsertContent", "LoadContent",
    "WaitTime", "GoToUrl", "Navigate", "NewPage",
    "SelectOption", "SetMemory", "PressKey"
  ].includes(actionType || "");
}

/** Actions that operate on a page element and therefore need a selector. */
function stepNeedsSelector(actionType) {
  const at = actionType || "";
  if (at === "WaitTime" || at === "NoAction" || at === "Breakpoint") return false;
  if (stepIsUrlAction(at)) return false;
  // SetMemory/GetMemory only touch the variable table and DeleteRow only touches the server store,
  // so none of them acts on the page and demanding a selector would make them unauthorable.
  if (at === "SetMemory" || at === "GetMemory" || at === "DeleteRow") return false;
  return true;
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

  if (stepIsCapture(at)) {
    migrateCaptureNode(n);
    const src = normalizeStepValueSource(n);
    if (src === "Constant") {
      if (!String(n.constantValue || "").trim()) reasons.push(tv("act.constantSaveEmpty"));
    } else if (src === "Elements") {
      const v = validateSelectorBlock(n, { labelKey: "label.pageElementSelector" });
      if (!v.ok) reasons.push(v.reason);
    } else if (src === "DataSource") {
      const v = validateDataSourcePick(n);
      if (!v.ok) reasons.push(v.reason);
    } else if (src === "Memory") {
      if (!String(n.sourceMemoryVariableName || "").trim()) {
        reasons.push(tv("act.memSourceMissing"));
      }
    } else if (src === "System") {
      if (!String(n.systemValueType || "").trim()) {
        reasons.push(tv("act.sysTypeMissing"));
      }
    }
    const dest = normalizeSaveTarget(n);
    if (dest === "Memory") {
      if (!String(n.memoryVariableName || "").trim()) {
        reasons.push(tv("act.memDestMissing"));
      }
    } else {
      const saveDs = n.saveDataSourceId != null ? n.saveDataSourceId : n.dataSourceId;
      const saveCol = n.saveColumnName || (src === "DataSource" ? "" : n.dynamicSourceColumnName);
      if (src === "DataSource") {
        if (saveDs == null || saveDs === "") reasons.push(tv("act.saveDsMissing"));
        if (!String(n.saveColumnName || "").trim()) reasons.push(tv("act.saveColMissing"));
      } else {
        const v = validateDataSourcePick({
          dataSourceId: saveDs,
          dynamicSourceColumnName: saveCol || n.dynamicSourceColumnName
        }, { dsReason: tv("act.saveDsMissing"), colReason: tv("act.saveColMissing") });
        if (!v.ok) reasons.push(v.reason);
      }
    }
  } else if (stepReceivesValue(at)) {
    const src = normalizeStepValueSource(n);
    if (src === "Constant") {
      if (at === "WaitTime") {
        const ms = Number(n.constantValue);
        if (!Number.isFinite(ms) || ms < 0 || String(n.constantValue ?? "").trim() === "") {
          reasons.push(tv("act.waitMissing"));
        }
      } else if (stepIsUrlAction(at)) {
        const url = String(n.navigateUrl || n.constantValue || "").trim();
        if (!url) reasons.push(tv("act.urlEmpty"));
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
  const outs = ((graph && graph.edges) || []).filter((e) => e.from === n.id);
  const hasBranchEdges = outs.some((e) => e.kind === "success" || e.kind === "fail");
  if (hasBranchEdges) {
    if (!outs.some((e) => e.kind === "success")) reasons.push(tv("cond.noSuccessEdge"));
    if (!outs.some((e) => e.kind === "fail")) reasons.push(tv("cond.noFailEdge"));
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

async function stopPlay(reason) {
  playAbort = true;
  playPaused = false;
  playStatus.playing = false;
  playStatus.paused = false;
  wakePlayResumeWaiters();
  clearPlayCellReadInflight();
  if (playAbortPoll) {
    clearInterval(playAbortPoll);
    playAbortPoll = null;
  }
  const tid = String(playStatus.taskId || "").trim();
  if (tid) await unregisterPlayOnServer(tid);
  appendPlayLog("warn", reason === "canvas_changed"
    ? "اجرا به‌خاطر تغییر فرآیند متوقف شد"
    : "اجرا توسط کاربر متوقف شد");
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

/** آیا ارزیابی این شرط به مرورگر/تب وابسته است؟ */
function conditionNeedsBrowserTab(node) {
  if (!node) return false;
  if (conditionNeedsPageElement(node)) return true;
  const ct = node.conditionType || "None";
  // MemoryValue reads the variable table, so it must not force a tab to be open — the same reason
  // SourceValue is excluded below.
  return ct === "Url" || ct === "DriverTabs";
}

/** اولین تب http(s) بدون فوکوس — برای شرط Url بدون انتخاب تب. */
async function pickSilentHttpTabId() {
  try {
    const all = await chrome.tabs.query({});
    const hit = all.find((t) => t?.id && /^https?:\/\//i.test(String(t.url || t.pendingUrl || "")));
    return hit?.id || null;
  } catch {
    return null;
  }
}

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
      : opts.stepNodeId
        ? "step"
        : opts.groupNodeId
          ? "group"
          : "task");
  opts.playScope = playScope;
  // Never walk the full diagram for a scoped step/condition play.
  const scopedSingle = playScope === "step" || playScope === "condition"
    || !!(opts.stepNodeId || opts.conditionNodeId);
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
    // SourceValue / DriverTabs / … — بدون تب هم قابل ارزیابی است.
    tabId = null;
  } else if (!tabId && condNode && ((condNode.conditionType || "") === "Url" || (condNode.conditionType || "") === "DriverTabs")) {
    tabId = await pickSilentHttpTabId();
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
  const limited = scopedSingle || !!(opts.groupNodeId || opts.stepNodeId || opts.conditionNodeId);
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
    const failedTaskId = String(graph.taskId || taskId || "").trim();
    if (failedTaskId) await unregisterPlayOnServer(failedTaskId);
    await chrome.storage.local.set({ playing: false, playTabId: null, playPaused: false });
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

      // Single-step / single-condition scope: never continue along diagram edges.
      const scopedSingle = opts.playScope === "step" || opts.playScope === "condition"
        || !!(opts.conditionNodeId || opts.stepNodeId);
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
            appendPlayLog("warn", `خطا در بررسی شرط: ${err?.message || err}`);
            pass = false;
          }
          playStatus.lastResult = {
            ok: true,
            conditionPass: !!pass,
            nodeId: step.id,
            checkId
          };
          appendPlayLog(
            pass ? "info" : "warn",
            pass
              ? `نتیجه شرط «${title}»: برقرار (موفق)`
              : `نتیجه شرط «${title}»: برقرار نیست (ناموفق)`
          );
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
            const decision = handleStepFailureForLoop(graph, outcome.error);
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
    playStatus.currentNodeId = null;
    playPaused = false;
    wakePlayResumeWaiters();
    if (playAbortPoll) {
      clearInterval(playAbortPoll);
      playAbortPoll = null;
    }
    const finishedTaskId = String(playStatus.taskId || graph?.taskId || "").trim();
    if (finishedTaskId) await unregisterPlayOnServer(finishedTaskId);
    await chrome.storage.local.set({ playing: false, playTabId: null, playPaused: false });
    broadcastPlayState();
  }
}

function resolvePlayEntryId(graph, opts = {}) {
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
  const start = (graph?.nodes || []).find((n) => n.kind === "start" && !n.groupNodeId)
    || (graph?.nodes || []).find((n) => n.kind === "start");
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
        return { tabId: activeTabId, stepFailed: true, error: outcome.error || "خطای مرحله" };
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
            return { tabId: activeTabId, stepFailed: true, error: inner.error || "خطای مرحله" };
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

  const outcome = await runStep(tabId, graph.taskId, step, playStatus.runMode, graph, rowIndex);
  const failed = !outcome?.ok;
  const ignored = failed && step.ignoreError !== false;
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
        appendPlayLog("warn", "شرط متغیر حافظه بدون نام — شاخه fail");
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

  if (actionType === "GoToUrl" || actionType === "Navigate") {
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

  // A deliberate wait for an element to exist: no state requirements, and the wait
  // budget comes from `waitMaxMs` rather than the per-step selector timeout.
  if (actionType === "WaitForElement") {
    const frameIdForWait = await resolveFramePath(tabId, framePath).catch(() => undefined);
    const waitPayload = {
      actionType,
      selectorValue: resolvedSelector,
      waitMaxMs: Math.max(0, Number(step.waitMaxMs) || 0),
      highlightColor: resolveHighlightColor(graph)
    };
    let waited = await chrome.tabs
      .sendMessage(tabId, { type: "playExecute", payload: waitPayload }, { frameId: frameIdForWait })
      .catch(() => null);
    if (!waited) waited = await executeInFrame(tabId, frameIdForWait, waitPayload);
    if (!waited || !waited.ok) {
      return onUnexpected(runMode, {
        taskId,
        stepId: step.entityId,
        reason: waited?.reason || "wait_timeout",
        expectedSelector: resolvedSelector,
        actualUrl: waited?.url || null,
        framePathJson: step.framePathJson || JSON.stringify(framePath)
      }, waited?.error);
    }
    return { ok: true };
  }

  const cst = step.contentSourceType || "";
  const needsAsyncValue = stepUsesDataSourceValue(step)
    || cst === "Memory" || cst === "Elements" || cst === "System"
    || (actionType === "InsertContent" || actionType === "LoadContent" || actionType === "InputContent");
  let valueForAction = needsAsyncValue
    ? (await resolveStepParamAsync(step, graph, rowIndex ?? 0, { tabId, framePath }) || "")
    : (step.constantValue || "");

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
    ? Math.max(0, Number(step.selectorWaitMs) || 1000)
    : 0;
  const stateReq = selectorStateReqs(step);
  const payload = {
    actionType,
    selectorValue: resolvedSelector,
    constantValue: valueForAction,
    navigateUrl: step.navigateUrl,
    // SelectOption matches by value, label or position; PressKey needs the key name.
    selectBy: step.selectBy || "Value",
    keyName: step.keyName || "",
    highlightColor: resolveHighlightColor(graph),
    waitTimeoutMs,
    requireVisible: !!stateReq.requireVisible,
    requireEnabled: !!stateReq.requireEnabled,
    requireClickable: !!stateReq.requireClickable
  };

  let result = await (async () => {
    await clearTabPlayHighlights(tabId);
    return chrome.tabs
      .sendMessage(tabId, { type: "playExecute", payload }, { frameId })
      .catch(() => null);
  })();

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
    const resolvedSelector = await resolveDynamicSelectorAsync(step, graph, rowIndex ?? 0);
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
      ? Math.max(0, Number(step.selectorWaitMs) || 1000)
      : 0;
    const stateReq = selectorStateReqs(step);
    const payload = {
      actionType: "TakeContent",
      selectorValue: resolvedSelector,
      constantValue: "",
      highlightColor: resolveHighlightColor(graph),
      waitTimeoutMs,
      requireVisible: !!stateReq.requireVisible,
      requireEnabled: !!stateReq.requireEnabled,
      requireClickable: !!stateReq.requireClickable
    };
    let result = await (async () => {
      await clearTabPlayHighlights(tabId);
      return chrome.tabs
        .sendMessage(tabId, { type: "playExecute", payload }, { frameId })
        .catch(() => null);
    })();
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
      const val = (col && ds)
        ? ((await readDataSourceCellForPlay(ds, col, row, step, graph)) ?? "")
        : "";
      sel = sel.split(DYN_SEL_PLACEHOLDER).join(val);
    }
    if (/\{\{[^}]+\}\}/.test(sel)) {
      const parts = sel.split(/(\{\{\s*[^}]+\s*\}\})/g);
      const out = [];
      for (const part of parts) {
        const m = part.match(/^\{\{\s*([^}]+?)\s*\}\}$/);
        if (m) {
          out.push((await readDataSourceCellForPlay(ds, m[1], row, step, graph)) ?? "");
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
    attrVal = (await readDataSourceCellForPlay(ds, step[dynColKey], rowIndex ?? 0, step, graph)) ?? "";
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
    if (v != null && String(v).trim() !== "") return String(v);
    const raw = opts.preferUrl
      ? (step.navigateUrl || step.constantValue || "")
      : (step.constantValue || step.navigateUrl || "");
    return resolveDynamicTextAsync(raw, step, graph, rowIndex ?? 0);
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
      actionType: "TakeContent",
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

function playCellKey(dsId, rowIndex, columnKey) {
  return `${dsId}|${rowIndex}|${columnKey}`;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function readServerCell(dataSourceId, rowIndex, columnKey) {
  try {
    return await chrome.runtime.sendMessage({
      type: "readDataSourceCell",
      dataSourceId,
      rowIndex,
      columnKey
    });
  } catch {
    return null;
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
      // 409 conflict: adopt the server's current revision and retry immediately.
      if (res?.conflict) {
        const cur = res.body?.currentCellRevision ?? res.body?.CurrentCellRevision;
        if (cur != null) {
          expectedCellRevision = cur;
          applyCellToLocalCache(
            ds, row, col,
            res.body?.currentCellValue ?? res.body?.CurrentCellValue ?? "",
            cur,
            res.body?.currentDataRevision ?? res.body?.CurrentDataRevision
          );
          continue;
        }
      }
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

async function fetchServerCellForPlay(id, row, col, ds, graph, step) {
  const cacheKey = playCellKey(id, row, col);
  if (playCellReadInflight.has(cacheKey)) {
    return playCellReadInflight.get(cacheKey);
  }
  const work = (async () => {
    const fresh = await readServerCell(id, row, col);
    if (!fresh?.ok || !fresh.body) return null;
    const val = fresh.body.cellValue ?? fresh.body.CellValue ?? "";
    const rev = fresh.body.cellRevision ?? fresh.body.CellRevision;
    const dRev = fresh.body.dataRevision ?? fresh.body.DataRevision;
    applyCellToLocalCache(ds, row, col, val, rev, dRev);
    if (graph) {
      emitDataSourceCellEvent(graph, ds, col, row, "read", val, step?.title);
    }
    return val;
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

async function readDataSourceCellForPlay(ds, columnKey, rowIndex, step, graph) {
  if (!ds || !columnKey) return null;
  const col = String(columnKey).trim();
  const row = Number(rowIndex) || 0;
  const id = Number(ds.id) || 0;

  if (id <= 0) {
    return cellValue(ds, col, row, { emitRead: true, graph, stepTitle: step?.title });
  }

  const mirrored = cellValue(ds, col, row, { emitRead: false });
  if (mirrored != null) {
    if (graph) emitDataSourceCellEvent(graph, ds, col, row, "read", mirrored, step?.title);
    return mirrored;
  }

  return fetchServerCellForPlay(id, row, col, ds, graph, step);
}

async function portalFetch(path, opts) {
  try {
    const portal = typeof portalBase === "function" ? await portalBase().catch(() => null) : null;
    const base = String(portal || "").replace(/\/$/, "");
    if (!base) return null;
    return fetch(`${base}${path}`, {
      credentials: "omit",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      ...(opts || {})
    });
  } catch {
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
      return v != null ? String(v) : "";
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
      out.push((await readDataSourceCellForPlay(ds, m[1], rowIndex ?? 0, step, graph)) ?? "");
    } else {
      out.push(part);
    }
  }
  return out.join("");
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
    return {
      type: "DataSource",
      indices: Array.from({ length: count }, (_, i) => i),
      total: count,
      label: `منبع «${ds?.title || dsId}» × ${count}`
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
          document.querySelectorAll("#da-play-hl, .da-play-hl").forEach((n) => n.remove());
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

  function highlightTarget(el, color) {
    if (!(el instanceof Element)) return;
    const c = normalizeColor(color);
    try {
      document.querySelectorAll("#da-play-hl, .da-play-hl").forEach((n) => n.remove());
    } catch { /* ignore */ }
    try { el.scrollIntoView({ block: "center", inline: "nearest" }); } catch { /* ignore */ }
    const r = el.getBoundingClientRect();
    const box = document.createElement("div");
    box.id = "da-play-hl";
    box.className = "da-play-hl";
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

  if (!selector) return { ok: false, error: tv("run.selectorEmpty"), reason: "missing_selector" };

  // A deliberate wait for an element to exist. It must run before the shared existence
  // check below, which uses the per-step selector timeout and would report the element
  // as missing without honouring the step's own wait budget.
  if (actionType === "WaitForElement") {
    const maxMs = Math.max(0, Number(payload.waitMaxMs) || Number(waitTimeoutMs) || 0);
    const deadline = Date.now() + maxMs;
    for (;;) {
      let nodes = [];
      try { nodes = Array.from(document.querySelectorAll(selector)); } catch { nodes = []; }
      if (nodes.length) return { ok: true };
      if (Date.now() >= deadline) {
        return { ok: false, error: tv("run.waitElementTimeout", { sel: selector }), reason: "wait_timeout" };
      }
      await new Promise((r) => setTimeout(r, 100));
    }
  }

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
  if (limit === 0) return Promise.resolve();
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }, limit);

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
