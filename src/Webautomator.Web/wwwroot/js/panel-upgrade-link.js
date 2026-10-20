/**
 * Routes the "upgrade plan" button to wherever this deployment can actually sell.
 *
 * The destination depends on the LICENCE (a deployment that may not sell has nothing to offer), and
 * only the server knows that. Asking it at click time — rather than baking a URL into the markup —
 * means the button can never point at a page that cannot help, and the reason ("commerce is off,
 * contact your administrator") comes back with the answer instead of being guessed here.
 *
 * If the request fails for any reason the button still navigates to the paid plan page, because a
 * network hiccup should not turn a working button into a dead one.
 */
(function () {
  "use strict";

  var btn = document.getElementById("da-upgrade-plan-btn");
  if (!btn) return;

  var endpoint = btn.getAttribute("data-upgrade-endpoint");
  var fallback = "/Panel/Billing/Plans";

  btn.addEventListener("click", function (e) {
    e.preventDefault();
    if (!endpoint) {
      window.location.href = fallback;
      return;
    }

    fetch(endpoint, { credentials: "same-origin", cache: "no-store" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (d && d.url) {
          window.location.href = d.url;
          return;
        }
        var msg = (d && d.message) || "";
        if (msg && window.DaNotify && DaNotify.info) {
          DaNotify.info(msg);
        } else if (msg) {
          window.alert(msg);
        } else {
          window.location.href = fallback;
        }
      })
      .catch(function () {
        window.location.href = fallback;
      });
  });
})();
