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
 *   readsCell  — reads a data-source cell as its input value
 *   writesSrc  — writes into a data-source cell (so it picks a destination source + column)
 *   writesMem  — writes into a memory variable (so it names the variable)
 *
 * Adding an action to the ActionType enum without an entry here is safe (an unknown action gets an
 * empty spec) but means the editor will offer it no settings and the player no validation, so every
 * new action is expected to declare itself.
 */
(function (global) {
  "use strict";

  var ACTION_SPECS = {
    // --- element interactions -------------------------------------------------
    Click:          { selector: true },
    DoubleClick:    { selector: true },
    RightClick:     { selector: true },
    Hover:          { selector: true },
    FocusElement:   { selector: true },
    ScrollIntoView: { selector: true },
    // Hold is a click held down for a while, so beyond the element it needs a duration.
    Hold:           { selector: true, value: true },
    ClearContent:   { selector: true },
    SelectOption:   { selector: true, value: true, elementVal: true, memoryVal: true, systemVal: true, readsCell: true },

    // PressKey always names a key; it may also read the key from a source.
    PressKey:       { selector: true, value: true, elementVal: true, memoryVal: true, systemVal: true, readsCell: true },

    // --- writing into a page element -----------------------------------------
    InputContent:   { selector: true, value: true, elementVal: true, memoryVal: true, systemVal: true, readsCell: true },

    // LoadContent reads one source cell and puts it into a TARGET that is either a page element or a
    // memory variable. Its value comes from the source, so it takes no separate input value.
    LoadContent:    { selector: true, readsCell: true, writesMem: true },

    // --- data source ---------------------------------------------------------
    // InsertContent writes a value INTO a source cell. The value may come from anywhere.
    InsertContent:  { value: true, elementVal: true, memoryVal: true, systemVal: true, writesSrc: true },
    DeleteRow:      {},
    SetMemory:      { value: true, elementVal: true, memoryVal: true, systemVal: true, readsCell: true, writesMem: true },
    GetMemory:      { writesMem: true },

    // --- navigation / tabs ---------------------------------------------------
    GoToUrl:        { value: true, elementVal: true, memoryVal: true, systemVal: true, readsCell: true },
    NewPage:        { value: true, elementVal: true, memoryVal: true, systemVal: true, readsCell: true },
    Refresh:        {},
    ScrollPage:     { value: true },
    CloseFirstTab:  {},
    CloseLastTab:   {},

    // --- timing / flow -------------------------------------------------------
    WaitTime:       { value: true, memoryVal: true, systemVal: true, readsCell: true },
    WaitForLoading: { value: true },
    NoAction:       {},

    // --- page surgery --------------------------------------------------------
    // RemoveElements deletes the matched element(s) from the DOM; the selector picks which ones.
    RemoveElements: { selector: true },
    // AlertAccept answers a browser dialog. It needs no selector and no value: a JS dialog blocks
    // the page, so there is no element to point at, and what it answers (accept or dismiss, plus
    // optional prompt text) comes from the step's own fields rather than the value plumbing.
    AlertAccept:    {}
  };

  /** Spec for an action, or an empty spec so an unknown action never crashes a run or a render. */
  function actionSpec(actionType) {
    return ACTION_SPECS[actionType] || {};
  }

  function stepNeedsSelector(at) { return actionSpec(at).selector === true; }
  function stepReceivesValue(at) { return actionSpec(at).value === true; }
  function stepAllowsElementValue(at) { return actionSpec(at).elementVal === true; }
  function stepAllowsMemoryValue(at) { return actionSpec(at).memoryVal === true; }
  function stepAllowsSystemValue(at) { return actionSpec(at).systemVal === true; }
  function stepWritesToSource(at) { return actionSpec(at).writesSrc === true; }
  function stepWritesToMemory(at) { return actionSpec(at).writesMem === true; }
  function stepReadsCell(at) { return actionSpec(at).readsCell === true; }
  /** The navigation actions that replace the current tab's URL. */
  function stepIsUrlAction(at) { return at === "GoToUrl" || at === "NewPage"; }

  var api = {
    ACTION_SPECS: ACTION_SPECS,
    actionSpec: actionSpec,
    stepNeedsSelector: stepNeedsSelector,
    stepReceivesValue: stepReceivesValue,
    stepAllowsElementValue: stepAllowsElementValue,
    stepAllowsMemoryValue: stepAllowsMemoryValue,
    stepAllowsSystemValue: stepAllowsSystemValue,
    stepWritesToSource: stepWritesToSource,
    stepWritesToMemory: stepWritesToMemory,
    stepReadsCell: stepReadsCell,
    stepIsUrlAction: stepIsUrlAction
  };

  global.ActionSpecs = api;
  // Also flat, so a plain function call works in either environment without the namespace.
  global.actionSpec = actionSpec;
  global.stepNeedsSelector = stepNeedsSelector;
  global.stepReceivesValue = stepReceivesValue;
  global.stepAllowsElementValue = stepAllowsElementValue;
  global.stepAllowsMemoryValue = stepAllowsMemoryValue;
  global.stepAllowsSystemValue = stepAllowsSystemValue;
  global.stepWritesToSource = stepWritesToSource;
  global.stepWritesToMemory = stepWritesToMemory;
  global.stepReadsCell = stepReadsCell;
  global.stepIsUrlAction = stepIsUrlAction;
})(typeof globalThis !== "undefined" ? globalThis : this);
