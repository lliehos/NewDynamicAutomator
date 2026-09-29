/*
 * da-switch.js — turn every plain checkbox in the app into a switch.
 *
 * Why a runtime upgrade instead of editing each view:
 *   - checkboxes appear in Razor views, in JS-rendered template strings and in
 *     dynamically built modals; a single hook covers all three
 *   - new checkboxes added later are upgraded automatically
 *   - the markup and the form semantics stay exactly the same (`<input
 *     type="checkbox" name=... value=...>` still posts the same fields)
 *
 * Opt-outs — set `data-da-switch="off"` on the input or on any ancestor:
 *   - table "select all"/row selectors and checkbox grids, where a switch would
 *     misrepresent multi-selection
 *   - the admin `_AdminSwitch` partial, which renders its own switch chrome
 *
 * Selection surfaces are detected heuristically so existing pages get the right
 * behaviour without any markup change: an input whose name/class suggests
 * "select all"/"check all", or which lives in a `thead`, or which is the only
 * checkbox inside a table cell that also renders a header checkbox, is skipped.
 */
(function () {
  "use strict";

  var ATTR = "daSwitched";
  var OPT_OUT = 'input[type="checkbox"][data-da-switch="off"], [data-da-switch="off"] input[type="checkbox"]';

  /** Checkbox that lives in a table header / select-all column → multi-select, not a toggle. */
  function looksLikeSelectionBox(el) {
    if (el.closest("thead")) return true;
    var cls = " " + (el.className || "") + " ";
    if (/ (dt-checkboxes|dt-checkboxes-select-all|select-all|check-all|selectall|checkall|admin-select|row-check) /.test(cls)) {
      return true;
    }
    var name = (el.getAttribute("name") || "") + " " + (el.id || "");
    if (/select.?all|check.?all|selectall|checkall/i.test(name)) return true;
    // A checkbox inside a cell whose class marks it as the selection column.
    var cell = el.closest("td, th");
    if (cell && / (select-checkbox|dt-checkboxes-cell|row-select) /.test(" " + (cell.className || "") + " ")) {
      return true;
    }
    return false;
  }

  function switched(el) {
    if (el.classList.contains("da-sw")) return true;
    if (el.closest(OPT_OUT)) return true;
    if (looksLikeSelectionBox(el)) return true;
    return false;
  }

  function upgrade(el) {
    if (!el || el.tagName !== "INPUT" || el.type !== "checkbox") return;
    if (el.getAttribute(ATTR) === "1") return;
    el.setAttribute(ATTR, "1");
    if (switched(el)) return;

    el.classList.add("da-sw");

    // Dense contexts (tables, toolbars, inline chips) get the compact track so
    // the switch does not blow up the row height.
    if (el.closest("table, .admin-table-wrap, .insp-field, .da-share-perms, td, th, .toolbar, .form-check")) {
      el.classList.add("da-sw-sm");
    }

    // Bootstrap/form-check wrappers style the native box; neutralise the wrapper
    // padding/margin only — keep the element and its label association intact.
    var wrap = el.closest(".form-check");
    if (wrap) wrap.classList.add("da-sw-wrap");
  }

  /** Upgrade one root (document, or a subtree after dynamic render). */
  function upgradeAll(root) {
    var scope = root && root.querySelectorAll ? root : document;
    var list = scope.querySelectorAll ? scope.querySelectorAll('input[type="checkbox"]') : [];
    for (var i = 0; i < list.length; i++) upgrade(list[i]);
    // A node inserted directly as an <input> (not wrapped) is not returned by
    // querySelectorAll on itself, so handle it explicitly.
    if (scope.tagName === "INPUT") upgrade(scope);
  }

  var scheduled = false;

  /**
   * Coalesce many mutation records into one pass.
   *
   * The sweep always covers the DOCUMENT, never the subtree a record happened to name. A subtree is
   * the obvious scope to keep — it is smaller — but it is not safe, and the share modal is where
   * that showed: it rebuilds its permission row with `innerHTML`, so the nodes named by the record
   * are detached by the very next line. Sweeping that detached subtree upgrades nodes nobody can see
   * and leaves the live ones as plain checkboxes, which is the bug where an existing grant's
   * permissions render as checkboxes instead of switches.
   *
   * A document sweep has no such failure mode: whatever is in the page at the moment the pass runs is
   * what gets upgraded, and `upgrade()` is idempotent (`daSwitched`), so re-covering already-handled
   * nodes costs nothing.
   */
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    var run = function () {
      scheduled = false;
      upgradeAll(document);
    };
    if (window.requestAnimationFrame) window.requestAnimationFrame(run);
    else window.setTimeout(run, 0);
  }

  function init() {
    upgradeAll(document);

    // Dynamic content: JS templates, modals, SignalR row inserts, editor inspector.
    if (window.MutationObserver) {
      var obs = new MutationObserver(function (records) {
        for (var i = 0; i < records.length; i++) {
          var added = records[i].addedNodes;
          if (!added || !added.length) continue;
          for (var j = 0; j < added.length; j++) {
            var node = added[j];
            if (node.nodeType !== 1) continue;
            if (node.tagName === "INPUT" && node.type === "checkbox") {
              // A bare input appears in no querySelectorAll on itself, so upgrade it directly. This
              // is safe even if it is later detached, because it is the node itself that matters.
              upgrade(node);
            } else if (node.querySelector && node.querySelector('input[type="checkbox"]')) {
              schedule();
            }
          }
        }
      });
      obs.observe(document.documentElement, { childList: true, subtree: true });
    }

    // Expose for template-rendering code that wants an immediate, synchronous pass.
    window.DaSwitch = { refresh: function (root) { upgradeAll(root || document); } };
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
