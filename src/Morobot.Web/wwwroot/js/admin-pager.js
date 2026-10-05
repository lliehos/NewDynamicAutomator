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
 * Opt out with data-no-page="1". The pager shows a rows-per-page picker and stays hidden while the
 * table fits on one page at its smallest offered size — but once the admin picks a size it stays
 * visible, so the choice can always be changed back.
 */
(function () {
  "use strict";

  var DEFAULT_PAGE_SIZE = 20;
  var MIN_PAGE_SIZE = 5;
  var MAX_PAGE_SIZE = 200;
  // Offered in the per-page picker. A table's own data-page-size is added when it is not on the
  // list, so a page configured for, say, 25 does not lose that choice when the picker renders.
  var PAGE_SIZE_OPTIONS = [10, 20, 50, 100, 200];

  function pageSize(wrap) {
    var raw = parseInt(wrap.getAttribute("data-page-size"), 10);
    if (!isFinite(raw)) return DEFAULT_PAGE_SIZE;
    return Math.min(MAX_PAGE_SIZE, Math.max(MIN_PAGE_SIZE, raw));
  }

  function sizesWith(current) {
    var sizes = PAGE_SIZE_OPTIONS.slice();
    if (sizes.indexOf(current) < 0) sizes.push(current);
    sizes.sort(function (a, b) { return a - b; });
    return sizes;
  }

  /** The pager stays visible while the size picker could still split the rows. */
  function hasPageSizeChoice(rowCount, current) {
    var smallest = sizesWith(current)[0];
    return rowCount > smallest;
  }

  /**
   * Remember the chosen size per table so the pick survives a reload. Keyed on the table id when
   * there is one (several tables share a path) and otherwise on the page path.
   */
  function storageKey(wrap, table) {
    var id = (table && table.id) || wrap.getAttribute("data-page-key") || "";
    return "admin.pagesize:" + (id || location.pathname);
  }

  /** @returns true when a previously chosen size was applied. */
  function readStoredSize(wrap, table) {
    try {
      var raw = parseInt(window.localStorage.getItem(storageKey(wrap, table)), 10);
      if (isFinite(raw) && raw >= MIN_PAGE_SIZE && raw <= MAX_PAGE_SIZE) {
        wrap.setAttribute("data-page-size", String(raw));
        return true;
      }
    } catch (e) { /* storage unavailable — fall back to the markup's size */ }
    return false;
  }

  function storeSize(wrap, table, size) {
    try {
      window.localStorage.setItem(storageKey(wrap, table), String(size));
    } catch (e) { /* storage unavailable — the choice just will not survive the reload */ }
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
        '<label class="admin-pager-size"><span class="admin-pager-size-label">' + label("perPage", "Rows per page") + '</span>' +
        '<select class="admin-pager-size-select" aria-label="' + label("perPage", "Rows per page") + '"></select></label>' +
        '<button type="button" class="admin-pager-btn" data-pg="first" aria-label="' + label("first", "First") + '">&laquo;</button>' +
        '<button type="button" class="admin-pager-btn" data-pg="prev" aria-label="' + label("prev", "Previous") + '">&lsaquo;</button>' +
        '<span class="admin-pager-info" aria-live="polite"></span>' +
        '<button type="button" class="admin-pager-btn" data-pg="next" aria-label="' + label("next", "Next") + '">&rsaquo;</button>' +
        '<button type="button" class="admin-pager-btn" data-pg="last" aria-label="' + label("last", "Last") + '">&raquo;</button>';
      wrap.parentNode.insertBefore(nav, wrap.nextSibling);
    }
    return nav;
  }

  function fillSizeOptions(select, current) {
    var html = "";
    sizesWith(current).forEach(function (size) {
      html += '<option value="' + size + '"' + (size === current ? " selected" : "") + '>' + size + '</option>';
    });
    // Rewriting the options resets the control, so only touch the DOM when they actually changed.
    if (select.innerHTML !== html) select.innerHTML = html;
    if (select.value !== String(current)) select.value = String(current);
  }

  function Paginator(wrap) {
    this.wrap = wrap;
    this.table = wrap.querySelector("table.admin-table");
    this.nav = null;
    this.page = 1;
    this.sizeChosen = readStoredSize(wrap, this.table);
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
    // A pager for a single page is noise — unless the size picker could still split those rows, or
    // the admin has already picked a size, in which case hiding it would strand the choice. The
    // second case matters because a chosen size larger than the row count would otherwise hide the
    // control that undoes it.
    this.nav.hidden = !this.sizeChosen && !hasPageSizeChoice(rows.length, size);
    if (this.nav.hidden) return;

    var select = this.nav.querySelector(".admin-pager-size-select");
    if (select) fillSizeOptions(select, size);

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
        // Delegated on the nav because the options are re-rendered with the page window.
        nav.addEventListener("change", function (ev) {
          var select = ev.target.closest(".admin-pager-size-select");
          if (!select) return;
          var size = parseInt(select.value, 10);
          if (!isFinite(size)) return;
          paginator.wrap.setAttribute("data-page-size", String(size));
          paginator.sizeChosen = true;
          storeSize(paginator.wrap, paginator.table, size);
          // Row 1 of the old size would be somewhere in the middle of the new one.
          paginator.page = 1;
          paginator.render();
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
