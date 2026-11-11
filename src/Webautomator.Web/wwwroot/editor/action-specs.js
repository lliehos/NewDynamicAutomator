/**
 * The action spec table — the single authority on what each ActionType needs and accepts.
 *
 * Loaded by BOTH halves of the system: the editor page (`Areas/Panel/Views/Tasks/Editor.cshtml`)
 * and the Player extension (`extension-global/player/engine.js`, via importScripts). Keeping it in
 * one file is the point: the editor used to carry its own copy of these rules and the two copies
 * had already drifted, so a step could be valid in one half and invalid in the other — the editor
 * demanded a selector for ClearContent and SelectOption that the player never required.
 *
 * Flags, all optional and defaulting to false:
 *   selector   — acts on a page element, so a target selector is required
 *   value      — takes an input value (constant / source cell / memory / page element / system)
 *   elementVal — may read that input value from a page element
 *   memoryVal  — may read that input value from a memory variable
 *   systemVal  — may use a system-generated value (date / time / guid / random)
 *   pageUrlVal — may use the current page URL as its input value
 *   readsCell  — reads a data-source cell as its input value
 *   writesSrc  — writes into a data-source cell (so it picks a destination source + column)
 *   writesMem  — writes into a memory variable (so it names the variable)
 *   browser    — acts on the page of a tab, so the run must ALREADY own a tab when it starts.
 *                GoToUrl is deliberately NOT marked: it is what opens/creates the run's tab, which
 *                is exactly how a run that starts with no target tab (startWithoutTab) begins.
 *
 * Adding an action to the ActionType enum without an entry here is safe (an unknown action gets an
 * empty spec) but means the editor will offer it no settings and the player no validation, so every
 * new action is expected to declare itself.
 */
(function (global) {
  "use strict";

  var ACTION_SPECS = {
    // --- element interactions -------------------------------------------------
    Click:          { selector: true, browser: true },
    DoubleClick:    { selector: true, browser: true },
    RightClick:     { selector: true, browser: true },
    Hover:          { selector: true, browser: true },
    // Hold is a click held down for a while, so beyond the element it needs a duration.
    Hold:           { selector: true, value: true, browser: true },
    ClearContent:   { selector: true, browser: true },
    SelectOption:   { selector: true, value: true, elementVal: true, memoryVal: true, systemVal: true, readsCell: true, browser: true },

    // --- writing into a page element -----------------------------------------
    // InputContent fills a page element. It also carries a typing mode (all at once, or one key at a
    // time) which the page-side code reads from the same payload.
    InputContent:   { selector: true, value: true, elementVal: true, memoryVal: true, systemVal: true, readsCell: true, browser: true },

    // LoadContent reads one source cell and puts it into a TARGET that is either a page element or a
    // memory variable. Its value comes from the source, so it takes no separate input value.
    LoadContent:    { selector: true, readsCell: true, writesMem: true },

    // --- data source ---------------------------------------------------------
    // InsertContent writes a value INTO a source cell. The value may come from a constant, a page
    // element, a memory variable, the system or the current page URL — but NOT from a data source:
    // writing a cell by reading another cell of the same table is a copy, which this action does not
    // offer.
    InsertContent:  { value: true, elementVal: true, memoryVal: true, systemVal: true, pageUrlVal: true, writesSrc: true },
    // Which row is chosen on the step (first / last / the loop's row), so no value and no selector.
    DeleteRow:      {},
    // Adds a blank row at a chosen position. The columns come from the source, so nothing to pick.
    InsertRow:      {},
    SetMemory:      { value: true, elementVal: true, memoryVal: true, systemVal: true, readsCell: true, writesMem: true },

    // --- navigation / tabs ---------------------------------------------------
    // GoToUrl navigates the run's current tab by default. Its own fields can instead send it to a
    // named NEW tab (`openInNewTab` + `newTabAlias`), which stays alive for later SwitchTab steps.
    GoToUrl:        { value: true, elementVal: true, memoryVal: true, systemVal: true, readsCell: true },
    GoBack:         { browser: true },
    GoForward:      { browser: true },
    Refresh:        { browser: true },
    // ScrollPage's selector only applies when its type is "to element", so the editor asks
    // stepShowsTargetSelector, which narrows this by the step's own scrollType.
    ScrollPage:     { value: true, selector: true, browser: true },
    // Which tab to close is a step field, not a value and not a selector.
    CloseTab:       { browser: true },
    // SwitchTab only changes which live tab the run works on. The target (alias / URL / title /
    // positional) is chosen on the step, so it needs neither a selector nor a value. It is not a
    // plain page step: an alias/URL/title target finds a live tab and can therefore SUPPLY one
    // (see stepOpensTabTarget), while a positional target is measured from the run's current tab.
    SwitchTab:      { browser: true },
    // PressKey sends a keyboard event. Its key is a step field (`pressKeyName`), not a value — the
    // value plumbing would let it read a source cell, which makes no sense for "press Enter". The
    // selector is optional: with none it acts on whatever is focused.
    PressKey:       { browser: true },

    // --- timing / flow -------------------------------------------------------
    WaitTime:       { value: true, memoryVal: true, systemVal: true, readsCell: true },
    WaitForLoading: { value: true, browser: true },
    NoAction:       {},

    // --- page surgery --------------------------------------------------------
    // RemoveElements deletes the matched element(s) from the DOM; the selector picks which ones.
    RemoveElements: { selector: true, browser: true },
    // AlertAccept answers a browser dialog. It needs no selector and no value: a JS dialog blocks
    // the page, so there is no element to point at, and what it answers (accept or dismiss, plus
    // optional prompt text) comes from the step's own fields rather than the value plumbing.
    AlertAccept:    { browser: true }
  };

  /** Spec for an action, or an empty spec so an unknown action never crashes a run or a render. */
  function actionSpec(actionType) {
    return ACTION_SPECS[actionType] || {};
  }

  /**
   * Does running this action require a browser tab that the run ALREADY owns?
   *
   * Used by the "start with no target tab" validation: such a run begins with no tab at all, so a
   * page action before the first GoToUrl could only fail. GoToUrl is not browser-dependent — it is
   * the step that creates/navigates the run's tab. LoadContent is special: it only touches the page
   * when its destination is an element (a Memory destination is pure bookkeeping). And any action
   * that takes its VALUE from a page element needs the page even if it writes elsewhere.
   */
  function stepNeedsBrowser(at, step) {
    if (at === "GoToUrl") return false;
    if (at === "LoadContent") {
      var dest = String((step && (step.saveTargetType || step.loadTargetType)) || "Elements");
      return dest !== "Memory";
    }
    var spec = actionSpec(at);
    if (spec.browser === true) return true;
    // A value read from a page element (SetMemory / InsertContent) still needs the page, and so
    // does the current page URL (InsertContent's «آدرس صفحه» value source).
    var cst = String((step && step.contentSourceType) || "");
    return (spec.elementVal === true && cst === "Elements")
      || (spec.pageUrlVal === true && cst === "PageUrl");
  }

  /**
   * Does this action itself give the run a usable tab?
   *
   * GoToUrl always does: with "new tab" it creates the alias tab, with "current tab" the engine
   * creates the run's main tab on demand. SwitchTab does too when it names its target (alias / URL /
   * title) because that lookup returns a real live tab; a POSITIONAL switch is measured from the
   * run's current tab and therefore cannot be the first step of a tab-less run.
   */
  function stepOpensTabTarget(at, step) {
    if (at === "GoToUrl") return true;
    if (at !== "SwitchTab") return false;
    var target = String((step && step.switchTabTarget) || "Alias");
    return ["Alias", "Url", "Title"].indexOf(target) >= 0;
  }

  function stepNeedsSelector(at) { return actionSpec(at).selector === true; }
  function stepReceivesValue(at) { return actionSpec(at).value === true; }
  function stepAllowsElementValue(at) { return actionSpec(at).elementVal === true; }
  function stepAllowsMemoryValue(at) { return actionSpec(at).memoryVal === true; }
  function stepAllowsSystemValue(at) { return actionSpec(at).systemVal === true; }
  function stepAllowsPageUrlValue(at) { return actionSpec(at).pageUrlVal === true; }
  function stepWritesToSource(at) { return actionSpec(at).writesSrc === true; }
  function stepWritesToMemory(at) { return actionSpec(at).writesMem === true; }
  function stepReadsCell(at) { return actionSpec(at).readsCell === true; }
  /** Actions whose whole job is a browser navigation, so they take a URL rather than a value. */
  function stepIsUrlAction(at) { return at === "GoToUrl"; }

  var api = {
    ACTION_SPECS: ACTION_SPECS,
    actionSpec: actionSpec,
    stepNeedsSelector: stepNeedsSelector,
    stepReceivesValue: stepReceivesValue,
    stepAllowsElementValue: stepAllowsElementValue,
    stepAllowsMemoryValue: stepAllowsMemoryValue,
    stepAllowsSystemValue: stepAllowsSystemValue,
    stepAllowsPageUrlValue: stepAllowsPageUrlValue,
    stepWritesToSource: stepWritesToSource,
    stepWritesToMemory: stepWritesToMemory,
    stepReadsCell: stepReadsCell,
    stepIsUrlAction: stepIsUrlAction,
    stepNeedsBrowser: stepNeedsBrowser,
    stepOpensTabTarget: stepOpensTabTarget
  };

  global.ActionSpecs = api;
  // Also flat, so a plain function call works in either environment without the namespace.
  global.actionSpec = actionSpec;
  global.stepNeedsSelector = stepNeedsSelector;
  global.stepReceivesValue = stepReceivesValue;
  global.stepAllowsElementValue = stepAllowsElementValue;
  global.stepAllowsMemoryValue = stepAllowsMemoryValue;
  global.stepAllowsSystemValue = stepAllowsSystemValue;
  global.stepAllowsPageUrlValue = stepAllowsPageUrlValue;
  global.stepWritesToSource = stepWritesToSource;
  global.stepWritesToMemory = stepWritesToMemory;
  global.stepReadsCell = stepReadsCell;
  global.stepIsUrlAction = stepIsUrlAction;
  global.stepNeedsBrowser = stepNeedsBrowser;
  global.stepOpensTabTarget = stepOpensTabTarget;
})(typeof globalThis !== "undefined" ? globalThis : this);
