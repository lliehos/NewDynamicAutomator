/**
 * Admin table pagination.
 *
 * Progressive enhancement: every `.admin-table` is paged client-side by hiding rows, so it
 * works for server-rendered tables and for tables that grow via SignalR without any server
 * round trip. Rows added or removed later are picked up automatically because the pager
 * counts live rows each time it renders rather than caching the initial length.
 *
 * Markup contract:
 *   <div class="admin-table-wrap" data-page-size="20"> <table class="admin-table"> ... </div>
 * The pager renders its own <nav class="admin-pager"> after the table's wrapper.
 *
 * Opt out with data-no-page="1". When a table has a single page the pager stays hidden.
 */
(function () {
  "use strict";

  var DEFAULT_PAGE_SIZE = 20;
  var MIN_PAGE_SIZE = 5;
  var MAX_PAGE_SIZE = 200;

  function pageSize(wrap) {
    var raw = parseInt(wrap.getAttribute("data-page-size"), 10);
    if (!isFinite(raw)) return DEFAULT_PAGE_SIZE;
    return Math.min(MAX_PAGE_SIZE, Math.max(MIN_PAGE_SIZE, raw));
  }

  /** Live data rows of a table, skipping empty-state placeholder rows. */
  function dataRows(table) {
    var body = table.tBodies && table.tBodies[0];
    if (!body) return [];
    return Array.prototype.filter.call(body.rows, function (tr) {
      if (tr.classList.contains("admin-empty-row")) return false;
      if (tr.hasAttribute("data-no-page-row")) return false;
      return true;
    });
  }

  function label(key, fallback) {
    var dict = window.AdminI18n && window.AdminI18n.strings;
    return (dict && dict[key]) || fallback;
  }

  function buildPager(wrap, table) {
    var nav = wrap.nextElementSibling;
    if (!nav || !nav.classList || !nav.classList.contains("admin-pager")) {
      nav = document.createElement("nav");
      nav.className = "admin-pager";
      nav.setAttribute("aria-label", label("pager", "Pagination"));
      nav.innerHTML =
        '<button type="button" class="admin-pager-btn" data-pg="first" aria-label="' + label("first", "First") + '">&laquo;</button>' +
        '<button type="button" class="admin-pager-btn" data-pg="prev" aria-label="' + label("prev", "Previous") + '">&lsaquo;</button>' +
        '<span class="admin-pager-info" aria-live="polite"></span>' +
        '<button type="button" class="admin-pager-btn" data-pg="next" aria-label="' + label("next", "Next") + '">&rsaquo;</button>' +
        '<button type="button" class="admin-pager-btn" data-pg="last" aria-label="' + label("last", "Last") + '">&raquo;</button>';
      wrap.parentNode.insertBefore(nav, wrap.nextSibling);
    }
    return nav;
  }

  function Paginator(wrap) {
    this.wrap = wrap;
    this.table = wrap.querySelector("table.admin-table");
    this.nav = null;
    this.page = 1;
  }

  Paginator.prototype.totalPages = function () {
    var rows = dataRows(this.table);
    return Math.max(1, Math.ceil(rows.length / pageSize(this.wrap)));
  };

  Paginator.prototype.render = function () {
    if (!this.table) return;
    var size = pageSize(this.wrap);
    var rows = dataRows(this.table);
    var pages = Math.max(1, Math.ceil(rows.length / size));

    if (this.page > pages) this.page = pages;
    if (this.page < 1) this.page = 1;

    var from = (this.page - 1) * size;
    var to = from + size;
    for (var i = 0; i < rows.length; i++) {
      rows[i].hidden = i < from || i >= to;
    }

    this.nav = buildPager(this.wrap, this.table);
    // A pager for a single page is noise.
    this.nav.hidden = rows.length <= size;
    if (this.nav.hidden) return;

    var info = this.nav.querySelector(".admin-pager-info");
    if (info) {
      info.textContent = label("page", "Page") + " " + this.page + " / " + pages;
    }
    this.nav.querySelectorAll("[data-pg]").forEach(function (btn) {
      var go = btn.getAttribute("data-pg");
      btn.disabled =
        (go === "first" || go === "prev") ? this.page <= 1 :
        (go === "last" || go === "next") ? this.page >= pages : false;
    }, this);
  };

  Paginator.prototype.go = function (dir) {
    var pages = this.totalPages();
    if (dir === "first") this.page = 1;
    else if (dir === "last") this.page = pages;
    else if (dir === "prev") this.page = Math.max(1, this.page - 1);
    else if (dir === "next") this.page = Math.min(pages, this.page + 1);
    this.render();
  };

  var paginators = [];

  function init() {
    var wraps = document.querySelectorAll(".admin-table-wrap");
    for (var i = 0; i < wraps.length; i++) {
      var wrap = wraps[i];
      if (wrap.getAttribute("data-no-page") === "1") continue;
      if (wrap.dataset.pagerBound === "1") continue;
      if (!wrap.querySelector("table.admin-table")) continue;
      wrap.dataset.pagerBound = "1";

      var p = new Paginator(wrap);
      paginators.push(p);
      p.render();

      (function (paginator) {
        var nav = paginator.nav;
        if (!nav) return;
        nav.addEventListener("click", function (ev) {
          var btn = ev.target.closest("[data-pg]");
          if (!btn || btn.disabled) return;
          paginator.go(btn.getAttribute("data-pg"));
        });
      })(p);
    }
  }

  /**
   * Re-render every pager. Called by the catalog live handlers after rows are inserted or
   * removed so the count and page window stay correct without a full reload.
   */
  function refresh() {
    paginators.forEach(function (p) { p.render(); });
  }

  // Tables that grow asynchronously (SignalR) need a nudge after each mutation.
  document.addEventListener("admin:table-updated", refresh);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  window.AdminPager = { init: init, refresh: refresh };
})();
