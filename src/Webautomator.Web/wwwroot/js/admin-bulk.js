/**
 * Admin bulk selection.
 *
 * A toolbar (`.admin-bulk-bar[data-bulk-for="#<tbody id>"]`) sits above a table and owns the
 * "delete selected" flow. The checkbox column itself is rendered by the view, so selection works
 * for the server-rendered rows; this script only keeps the header checkbox, the selected count and
 * the submit button in sync — including for rows that arrive later over SignalR, which is why the
 * selection listeners are delegated and the counts recomputed whenever the body mutates.
 *
 * The ids of the ticked rows are written into hidden inputs just before the form is submitted, so
 * the whole flow is a plain POST + redirect (antiforgery token included in the markup) rather than
 * a fetch that would have to reimplement the redirect.
 */
(function () {
  "use strict";

  var dict = (window.AdminI18n && window.AdminI18n.strings && window.AdminI18n.strings.bulk) || {};

  function t(key, fallback) {
    return dict[key] || fallback;
  }

  function fmt(text, count) {
    return String(text).replace("{count}", String(count));
  }

  var bars = [];

  function Bar(bar) {
    this.bar = bar;
    this.tbody = document.querySelector(bar.getAttribute("data-bulk-for"));
    this.table = this.tbody && this.tbody.closest("table");
    this.headerAll = this.table && this.table.querySelector("thead .admin-bulk-all");
    this.countEl = bar.querySelector("[data-bulk-count]");
    this.form = bar.querySelector("form[data-bulk-form]");
    this.deleteBtns = bar.querySelectorAll("[data-bulk-delete]");
  }

  Bar.prototype.rows = function () {
    return this.tbody ? Array.prototype.slice.call(this.tbody.querySelectorAll(".admin-bulk-check")) : [];
  };

  Bar.prototype.selected = function () {
    return this.rows().filter(function (cb) { return cb.checked; });
  };

  Bar.prototype.render = function () {
    if (!this.tbody) return;
    var rows = this.rows();
    var picked = this.selected();
    var total = rows.length;
    var count = picked.length;

    if (this.countEl) {
      this.countEl.textContent = count > 0
        ? fmt(t("selected", "{count} selected"), count)
        : t("noneSelected", "No rows selected");
    }

    this.deleteBtns.forEach(function (btn) { btn.disabled = count === 0; });

    if (this.headerAll) {
      this.headerAll.checked = total > 0 && count === total;
      this.headerAll.indeterminate = count > 0 && count < total;
      this.headerAll.disabled = total === 0;
    }
  };

  Bar.prototype.bind = function () {
    var self = this;

    if (this.headerAll) {
      this.headerAll.addEventListener("change", function () {
        self.rows().forEach(function (cb) { cb.checked = self.headerAll.checked; });
        self.render();
      });
    }

    // Delegated on the table so a row added later is covered without rebinding.
    if (this.table) {
      this.table.addEventListener("change", function (ev) {
        if (ev.target && ev.target.classList && ev.target.classList.contains("admin-bulk-check")) {
          self.render();
        }
      });
    }

    if (this.form) {
      this.form.addEventListener("submit", function (ev) {
        var picked = self.selected();
        if (!picked.length) {
          ev.preventDefault();
          return;
        }
        if (!confirm(fmt(t("confirm", "Delete {count} selected row(s)? This cannot be undone."), picked.length))) {
          ev.preventDefault();
          return;
        }
        // Drop ids from an earlier attempt before writing this selection.
        self.form.querySelectorAll("input.admin-bulk-id").forEach(function (el) { el.remove(); });
        picked.forEach(function (cb) {
          var input = document.createElement("input");
          input.type = "hidden";
          input.className = "admin-bulk-id";
          input.name = "ids";
          input.value = cb.value;
          self.form.appendChild(input);
        });
      });
    }

    // SignalR inserts and removes rows outside the pager's control; keep the header checkbox and
    // the count honest without waiting for a reload.
    if (this.tbody && window.MutationObserver) {
      new MutationObserver(function () { self.render(); })
        .observe(this.tbody, { childList: true });
    }
  };

  function init() {
    var list = document.querySelectorAll(".admin-bulk-bar[data-bulk-for]");
    for (var i = 0; i < list.length; i++) {
      if (list[i].dataset.bulkBound === "1") continue;
      list[i].dataset.bulkBound = "1";
      var bar = new Bar(list[i]);
      bars.push(bar);
      bar.bind();
      bar.render();
    }
  }

  function refresh() {
    bars.forEach(function (bar) { bar.render(); });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  window.AdminBulk = { init: init, refresh: refresh };
})();
