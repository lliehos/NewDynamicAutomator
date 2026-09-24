/**
 * Admin sources page — live catalog + view/download Excel.
 */
(function () {
  const i18n = window.__ADMIN_I18N__ || {};
  const actions = i18n.actions || {};

  function tAction(action) {
    const key = String(action || "").toLowerCase();
    return actions[key] || action || "—";
  }

  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"'`]/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;", "`": "&#96;" }[c]));
  }

  /** Render a server UTC timestamp in the viewer's local time, or "—" when absent. */
  function fmtDate(v) {
    if (v == null || v === "") return "—";
    const d = new Date(v);
    if (isNaN(d.getTime())) return "—";
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  function setLive(on, text) {
    const dot = document.getElementById("admin-live-dot");
    const st = document.getElementById("admin-live-status");
    if (dot) {
      dot.classList.toggle("is-on", !!on);
      dot.title = on ? (i18n.live || "Live") : (i18n.offline || "Offline");
    }
    if (st) st.textContent = text || (on ? (i18n.live || "Live") : (i18n.offline || "Offline"));
  }

  function pushFeed(msg) {
    const feed = document.getElementById("admin-live-feed");
    if (!feed || !msg) return;
    feed.textContent = msg;
    feed.classList.add("is-flash");
    setTimeout(() => feed.classList.remove("is-flash"), 1200);
  }

  function flashCell(el) {
    if (!el) return;
    el.classList.remove("admin-cell-flash");
    void el.offsetWidth;
    el.classList.add("admin-cell-flash");
  }

  function formatBy(user) {
    return (i18n.byUser || "by {user}").replace("{user}", user);
  }

  function findRow(sourceId) {
    return document.querySelector(`#admin-source-rows tr[data-source-id="${CSS.escape(String(sourceId))}"]`);
  }

  function setChangeBadge(row, action, actor) {
    const cell = row.querySelector("[data-flash='change']");
    if (!cell) return;
    cell.innerHTML = `<span class="admin-change-badge is-${String(action || "updated").toLowerCase()}">${escapeHtml(tAction(action))}</span>`
      + (actor ? `<span class="admin-change-actor">${escapeHtml(formatBy(actor))}</span>` : "");
    flashCell(cell);
  }

  function upsertRow(src, action, actor) {
    const id = src.id ?? src.Id ?? src.sourceId;
    if (id == null) return;
    const tbody = document.getElementById("admin-source-rows");
    if (!tbody) return;
    tbody.querySelector(".admin-empty-row")?.remove();
    let row = findRow(id);
    const title = src.title ?? src.Title ?? "";
    const linked = src.linkedProcessTitles ?? src.LinkedProcessTitles ?? src.taskTitle ?? src.TaskTitle ?? "—";
    const owner = src.ownerUserName ?? src.OwnerUserName ?? src.owner ?? src.Owner ?? "—";
    const editor = src.lastEditorUserName ?? src.LastEditorUserName ?? src.lastEditor ?? src.LastEditor ?? owner;
    const created = fmtDate(src.createdAtUtc ?? src.CreatedAtUtc);
    const updated = fmtDate(src.updatedAtUtc ?? src.UpdatedAtUtc);
    const cols = src.columnCount ?? src.ColumnCount ?? 0;
    const rows = src.rowCount ?? src.RowCount ?? 0;

    if (!row) {
      row = document.createElement("tr");
      row.dataset.sourceId = String(id);
      row.innerHTML = `
        <td>${escapeHtml(id)}</td>
        <td data-flash="title">${escapeHtml(title)}</td>
        <td data-flash="linked">${escapeHtml(linked)}</td>
        <td>${escapeHtml(owner)}</td>
        <td>${escapeHtml(editor)}</td>
        <td class="text-nowrap">${escapeHtml(created)}</td>
        <td class="text-nowrap">${escapeHtml(updated)}</td>
        <td data-flash="cols">${escapeHtml(cols)}</td>
        <td data-flash="rows">${escapeHtml(rows)}</td>
        <td class="admin-change-cell" data-flash="change"><span class="admin-change-badge is-idle">—</span></td>
        <td class="text-nowrap">
          <button type="button" class="btn-admin secondary js-admin-ds-view" data-id="${escapeHtml(id)}">View</button>
          <button type="button" class="btn-admin js-admin-ds-dl" data-id="${escapeHtml(id)}">Excel</button>
        </td>`;
      tbody.prepend(row);
      bindRowActions(row);
    } else {
      const titleEl = row.querySelector("[data-flash='title']");
      if (titleEl && title) titleEl.textContent = title;
      const linkedEl = row.querySelector("[data-flash='linked']");
      if (linkedEl && linked) linkedEl.textContent = linked;
      const colsEl = row.querySelector("[data-flash='cols']");
      if (colsEl) colsEl.textContent = String(cols);
      const rowsEl = row.querySelector("[data-flash='rows']");
      if (rowsEl) rowsEl.textContent = String(rows);
    }
    setChangeBadge(row, action, actor);
    flashCell(row);
    if (window.AdminPager) AdminPager.refresh();
    pushFeed(`${tAction(action)} #${id}${actor ? " — " + formatBy(actor) : ""}`);
  }

  function removeRow(sourceId, actor) {
    const row = findRow(sourceId);
    if (!row) return;
    setChangeBadge(row, "deleted", actor);
    row.classList.add("admin-row-gone");
    pushFeed(`${tAction("deleted")} #${sourceId}${actor ? " — " + formatBy(actor) : ""}`);
    setTimeout(() => { row.remove(); if (window.AdminPager) AdminPager.refresh(); }, 1800);
  }

  function dataSourceTableRows(ds) {
    const keys = Array.isArray(ds?.columnKeys) && ds.columnKeys.length
      ? ds.columnKeys.map(String)
      : (ds?.columns || []).map((c) => String(c.key || c.Key || "")).filter(Boolean);
    const cols = Array.isArray(ds?.columns) && ds.columns.length
      ? ds.columns.map((c) => ({
          key: String(c.key || c.Key || ""),
          title: String(c.title || c.Title || c.key || c.Key || "")
        })).filter((c) => c.key)
      : keys.map((k) => ({ key: k, title: k }));
    const headers = cols.map((c) => c.title || c.key);
    const colKeys = cols.map((c) => c.key);
    const cells = Array.isArray(ds?.cells) ? ds.cells : [];
    const byRow = new Map();
    cells.forEach((cell) => {
      const idx = Number(cell.index ?? cell.Index ?? 0);
      if (!Number.isFinite(idx)) return;
      if (!byRow.has(idx)) byRow.set(idx, {});
      byRow.get(idx)[String(cell.key || cell.Key || "")] = cell.cellValue ?? cell.CellValue ?? "";
    });
    const indexes = [...byRow.keys()].sort((a, b) => a - b);
    const rows = indexes.map((idx) => colKeys.map((k) => (byRow.get(idx) || {})[k] ?? ""));
    return { headers, colKeys, columns: cols, rows };
  }

  function safeName(ds) {
    const raw = (ds?.fileName && String(ds.fileName).replace(/\.(xlsx|xlsm|csv)$/i, ""))
      || ds?.title || "data-source";
    return String(raw).replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").trim() || "data-source";
  }

  async function fetchDetail(id) {
    const res = await fetch(`/Admin/Sources/Detail/${encodeURIComponent(id)}`, { credentials: "same-origin" });
    if (!res.ok) throw new Error(i18n.viewFail || "load failed");
    return res.json();
  }

  function renderViewer(ds) {
    const table = document.getElementById("da-portal-ds-table");
    const titleEl = document.getElementById("da-portal-ds-title");
    const subEl = document.getElementById("da-portal-ds-sub");
    if (!table) return;
    const { headers, colKeys, rows } = dataSourceTableRows(ds);
    if (titleEl) titleEl.textContent = ds.title || safeName(ds);
    if (subEl) subEl.textContent = `${colKeys.length} · ${rows.length}${ds.fileName ? " · " + ds.fileName : ""}`;
    const thead = table.querySelector("thead");
    const tbody = table.querySelector("tbody");
    thead.innerHTML = `<tr><th class="ds-row-idx">#</th>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr>`;
    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="${headers.length + 1}" class="ds-viewer-empty">${escapeHtml(i18n.noRows || "—")}</td></tr>`;
      return;
    }
    tbody.innerHTML = rows.map((r, i) =>
      `<tr><th class="ds-row-idx">${i + 1}</th>${r.map((v) => `<td>${escapeHtml(v)}</td>`).join("")}</tr>`
    ).join("");
  }

  async function viewSource(id, btn) {
    if (btn) { btn.disabled = true; }
    try {
      const ds = await fetchDetail(id);
      renderViewer(ds);
      const modal = document.getElementById("da-portal-ds-viewer");
      if (modal) modal.hidden = false;
    } catch (e) {
      alert(e.message || i18n.viewFail || "error");
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function downloadSource(id, btn) {
    if (btn) { btn.disabled = true; btn.classList.add("is-busy"); }
    try {
      const ds = await fetchDetail(id);
      const table = dataSourceTableRows(ds);
      if (!table.colKeys.length) throw new Error(i18n.noRows || "empty");
      const payload = {
        title: safeName(ds),
        columns: table.columns.map((c) => ({ key: c.key, title: c.title })),
        columnKeys: table.colKeys,
        cells: (ds.cells || []).map((c) => ({
          key: c.key || c.Key || "",
          index: Number(c.index ?? c.Index ?? 0),
          cellValue: c.cellValue ?? c.CellValue ?? ""
        }))
      };
      const res = await fetch("/Panel/Tasks/ExportExcel", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/octet-stream" },
        body: JSON.stringify(payload),
        credentials: "same-origin"
      });
      if (!res.ok) throw new Error(i18n.downloadFail || "excel failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${safeName(ds)}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
    } catch (e) {
      alert(e.message || i18n.downloadFail || "error");
    } finally {
      if (btn) { btn.disabled = false; btn.classList.remove("is-busy"); }
    }
  }

  function bindRowActions(root) {
    root.querySelectorAll(".js-admin-ds-view").forEach((btn) => {
      btn.addEventListener("click", () => viewSource(btn.dataset.id, btn));
    });
    root.querySelectorAll(".js-admin-ds-dl").forEach((btn) => {
      btn.addEventListener("click", () => downloadSource(btn.dataset.id, btn));
    });
  }

  async function boot() {
    bindRowActions(document);
    document.querySelectorAll("[data-portal-ds-close]").forEach((el) => {
      el.addEventListener("click", () => {
        const modal = document.getElementById("da-portal-ds-viewer");
        if (modal) modal.hidden = true;
      });
    });

    if (!window.DaCatalog) {
      setLive(false, i18n.offline);
      return;
    }
    setLive(false, i18n.connecting);
    DaCatalog.on("sourceChanged", (payload) => {
      if (!payload) return;
      const action = payload.action || payload.Action || "updated";
      const actor = payload.actorUserName || payload.ActorUserName || "";
      const src = payload.source || payload.Source || {};
      const id = src.id ?? src.Id ?? src.sourceId;
      if (String(action).toLowerCase() === "deleted") {
        removeRow(id, actor);
        return;
      }
      upsertRow(src, action, actor);
    });
    const conn = await DaCatalog.ensure({ admin: true });
    setLive(!!conn, conn ? i18n.live : i18n.offline);
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
