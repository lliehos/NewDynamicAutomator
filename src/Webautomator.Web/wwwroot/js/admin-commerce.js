/**
 * Commerce page: show only the price fields the chosen option kind actually uses.
 *
 * A "feature" is priced as one flat amount; a "limit" is priced per unit with an included allowance
 * and a cap. Both sets of inputs are in the form so nothing is lost when the operator flips the kind,
 * but showing all seven at once invited filling in the irrelevant ones and wondering why they had no
 * effect. This hides what the current kind ignores — it never clears a value, so switching back
 * restores exactly what was there.
 */
(function () {
  "use strict";

  var select = document.getElementById("commerce-kind");
  if (!select) return;

  var fields = document.querySelectorAll("[data-kind]");

  function apply() {
    // value 1 = Feature, 2 = Limit (mirrors PackageOptionKind).
    var want = select.value === "1" ? "feature" : "limit";
    for (var i = 0; i < fields.length; i++) {
      var f = fields[i];
      f.style.display = f.getAttribute("data-kind") === want ? "" : "none";
    }
  }

  select.addEventListener("change", apply);
  apply();
})();
