(function () {
  function t(key, vars) {
    if (window.DaI18n && typeof DaI18n.t === "function") return DaI18n.t(key, vars);
    return key;
  }

  function currentUser() {
    if (window.DaSecureStore) return DaSecureStore.currentUser();
    const m = document.cookie.match(/(?:^|; )da_local_user=([^;]*)/);
    const fromCookie = m ? decodeURIComponent(m[1]) : "";
    if (fromCookie) {
      localStorage.setItem("da_local_user", fromCookie);
      return fromCookie;
    }
    return localStorage.getItem("da_local_user") || "test";
  }

  function tasksKey() {
    return window.DaSecureStore ? DaSecureStore.tasksKey() : ("da_local_tasks__" + currentUser());
  }

  function readTasks() {
    if (window.DaSecureStore) return DaSecureStore.readTasks();
    try {
      return JSON.parse(localStorage.getItem(tasksKey()) || "[]");
    } catch {
      return [];
    }
  }

  function writeTasks(tasks) {
    if (window.DaSecureStore) {
      DaSecureStore.writeTasks(tasks);
      return;
    }
    localStorage.setItem(tasksKey(), JSON.stringify(tasks));
    localStorage.setItem("da_local_user", currentUser());
    window.dispatchEvent(new CustomEvent("da-local-tasks", { detail: { user: currentUser(), tasks } }));
  }

  function notify(message, type) {
    const status = document.getElementById("da-sources-status");
    if (status && message != null) status.textContent = String(message);
    if (message && typeof window.daNotify === "function") {
      window.daNotify(String(message), type || "info");
    }
  }

  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"'`]/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;", "`": "&#96;" }[c]));
  }

  /**
   * Rows requested per page. The viewer and the export both walk pages of this size, so a source
   * with more rows than one response can carry is never silently truncated.
   */
  const SOURCE_PAGE_SIZE = 500;

  const ICO_VIEW = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M12 5c5.2 0 9.3 3.4 10.7 7-1.4 3.6-5.5 7-10.7 7S2.7 15.6 1.3 12C2.7 8.4 6.8 5 12 5zm0 2.5A4.5 4.5 0 1 0 16.5 12 4.5 4.5 0 0 0 12 7.5zm0 2A2.5 2.5 0 1 1 9.5 12 2.5 2.5 0 0 1 12 9.5z"/></svg>`;
  const ICO_DL = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M12 3v10.2l3.4-3.4 1.4 1.4L12 17l-4.8-5.8 1.4-1.4L11 13.2V3h1zM5 19h14v2H5v-2z"/></svg>`;
  const ICO_CLOUD = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M17.5 19H8a5 5 0 0 1-.7-9.95A6.5 6.5 0 0 1 20 12.5a3.5 3.5 0 0 1-2.5 6.5zM12 8v6.2l2.4-2.4 1.2 1.2L12 17l-3.6-3.999 1.2-1.2L11 14.2V8h1z"/></svg>`;
  const ICO_STAR = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M12 3.6l2.4 4.9 5.4.8-3.9 3.8.9 5.4L12 16.1 7.2 18.5l.9-5.4L4.2 9.3l5.4-.8L12 3.6z"/></svg>`;
  const ICO_STAR_OUT = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.7" d="M12 3.6l2.4 4.9 5.4.8-3.9 3.8.9 5.4L12 16.1 7.2 18.5l.9-5.4L4.2 9.3l5.4-.8L12 3.6z"/></svg>`;
  const ICO_DEL = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M9 3h6l1 2h4v2H4V5h4l1-2zm1 6h2v9h-2V9zm4 0h2v9h-2V9zM7 9h2v9H7V9z"/></svg>`;
  const ICO_OPEN = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M14 3h7v7h-2V6.4l-9.3 9.3-1.4-1.4L17.6 5H14V3zM5 5h6v2H7v10h10v-4h2v6H5V5z"/></svg>`;
  const ICO_RENAME = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M4 17.5V20h2.5L18 8.5 15.5 6 4 17.5zm16.7-11.2a1 1 0 0 0 0-1.4l-2.1-2.1a1 1 0 0 0-1.4 0l-1.6 1.6 3.5 3.5 1.6-1.6z"/></svg>`;
  const ICO_RELOAD = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M12 5a7 7 0 0 1 6.5 4.4l1.9-1.1V13h-4.7l1.8-1A5 5 0 1 0 12 17v2a7 7 0 1 1 0-14z"/></svg>`;

  function iconBtn(cls, title, iconHtml, extra = "") {
    return `<button type="button" class="ds-icon-btn ${cls}" title="${escapeHtml(title)}" aria-label="${escapeHtml(title)}" ${extra}>${iconHtml}</button>`;
  }

  async function renameLibrarySource(sourceId, currentTitle) {
    const next = window.DaNotify?.prompt
      ? await DaNotify.prompt(t("sources.renamePrompt"), {
          title: t("sources.rename"),
          value: currentTitle || "",
          okText: t("common.save"),
          cancelText: t("common.cancel"),
          maxLength: 200
        })
      : (() => {
          const v = window.prompt(t("sources.renamePrompt"), currentTitle || "");
          return v == null ? null : String(v).trim() || null;
        })();
    if (next == null || next === currentTitle) return;
    try {
      const res = await fetch(`/api/datasources/${sourceId}`, {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: next })
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || t("sources.renameFail"));
      }
      notify(t("sources.renamed"), "success");
      await renderAsync();
    } catch (e) {
      notify(e.message || t("sources.renameFail"), "error");
    }
  }

  /**
   * Replace the file behind a library source without changing its id, title or process links.
   *
   * A process node binds a source *column by name*, so if the new file dropped a column that a
   * step still reads the step would break mid-play. We therefore analyse first and list the exact
   * steps before anything is written; the user can still go ahead deliberately.
   */
  async function reloadLibrarySource(sourceId, currentTitle) {
    const pick = document.createElement("input");
    pick.type = "file";
    pick.accept = ".xlsx,.xlsm,.csv";
    pick.hidden = true;
    document.body.appendChild(pick);
    const file = await new Promise((resolve) => {
      pick.addEventListener("change", () => resolve(pick.files?.[0] || null), { once: true });
      pick.click();
    });
    pick.remove();
    if (!file) return;

    let parsed;
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/Panel/Tasks/ParseExcel", {
        method: "POST",
        credentials: "same-origin",
        body: fd
      });
      if (!res.ok) throw new Error(t("sources.reloadParseFail") || "فایل اکسل خوانده نشد.");
      parsed = await res.json();
    } catch (e) {
      notify(e.message || t("sources.reloadParseFail") || "فایل اکسل خوانده نشد.", "error");
      return;
    }
    if (!parsed || !Array.isArray(parsed.columns) || !parsed.columns.length) {
      notify(t("sources.reloadNoColumns") || "فایل اکسل ستون معتبری ندارد.", "error");
      return;
    }

    const payload = {
      fileName: file.name,
      columns: parsed.columns,
      columnKeys: parsed.columnKeys || parsed.columns.map((c) => c.key),
      cells: parsed.cells || [],
      columnCount: parsed.columnCount,
      rowCount: parsed.rowCount
    };

    // Dry run first — the server tells us which steps would lose a column they read.
    let compat = null;
    try {
      const res = await fetch(`/api/datasources/${sourceId}/analyze-columns`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (res.ok) compat = await res.json();
    } catch { /* the real call re-checks server-side anyway */ }

    let force = false;
    if (compat && compat.missingColumns && compat.missingColumns.length) {
      const ok = await confirmMissingColumns(compat, currentTitle);
      if (!ok) return;
      force = true;
    } else if (!confirm((t("sources.reloadConfirm") || "محتوای منبع «{title}» با فایل «{file}» جایگزین شود؟")
      .replace("{title}", currentTitle || "").replace("{file}", file.name))) {
      return;
    }

    try {
      const res = await fetch(`/api/datasources/${sourceId}/reload`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, force })
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (body && body.compatibility && body.compatibility.missingColumns?.length) {
          await confirmMissingColumns(body.compatibility, currentTitle);
        } else {
          notify(body.message || t("sources.reloadFail") || "بارگذاری مجدد انجام نشد.", "error");
        }
        return;
      }
      notify((t("sources.reloaded") || "منبع «{title}» بازخوانی شد ({rows} ردیف).")
        .replace("{title}", body.dataSourceTitle || currentTitle || "")
        .replace("{rows}", String(body.rowCount ?? 0)), "success");
      await renderAsync();
    } catch (e) {
      notify(e.message || t("sources.reloadFail") || "بارگذاری مجدد انجام نشد.", "error");
    }
  }

  /** Precise warning: name every process + step that reads a column the new file dropped. */
  async function confirmMissingColumns(compat, title) {
    const lines = [];
    for (const miss of compat.missingColumns || []) {
      const nodes = (miss.nodes || []).map((n) => `«${n.nodeTitle}»${n.processTitle ? ` — ${n.processTitle}` : ""}`);
      lines.push(`• ستون «${miss.columnKey}» (${miss.columnTitle}) توسط: ${nodes.join("، ")}`);
    }
    const head = (t("sources.reloadMissingHead")
      || "این ستون‌ها در فایل جدید نیستند ولی گره‌های زیر به آن‌ها وابسته‌اند:");
    const foot = (t("sources.reloadMissingFoot")
      || "اگر ادامه دهید، این گره‌ها مقدار لازم را پیدا نمی‌کنند. ادامه می‌دهید؟");
    const text = `${head}\n\n${lines.join("\n")}\n\n${foot}\n(${title || ""})`;
    if (window.DaNotify?.confirm) {
      return !!(await DaNotify.confirm(text, {
        title: t("sources.reloadMissingTitle") || "ستون‌های وابسته حذف شده‌اند",
        okText: t("common.confirm") || "ادامه",
        cancelText: t("common.cancel"),
        danger: true
      }));
    }
    return confirm(text);
  }

  async function fetchLibrarySources() {
    try {
      const res = await fetch("/api/datasources", { credentials: "same-origin" });
      const list = await res.json();
      if (!Array.isArray(list)) return null;
      return list.map((d) => ({
        taskId: null,
        taskTitle: (d.linkedProcessTitles && d.linkedProcessTitles.length)
          ? d.linkedProcessTitles.join("، ")
          : (d.linkedProcessCount ? `${d.linkedProcessCount} فرآیند` : "— (کتابخانه)"),
        ds: {
          id: d.id,
          title: d.title,
          fileName: d.fileName,
          columnCount: d.columnCount,
          rowCount: d.rowCount,
          columnKeys: d.columnKeys || [],
          columns: d.columns || [],
          cells: d.cells || []
        },
        isMaster: false,
        fromLibrary: true,
        linkedProcessCount: d.linkedProcessCount || 0
      }));
    } catch {
      return null;
    }
  }

  function collectSources() {
    const tasks = readTasks();
    const rows = [];
    tasks.forEach((task) => {
      const list = Array.isArray(task.graph?.dataSources) ? task.graph.dataSources : [];
      const masterId = task.graph?.nodes?.find((n) => n.kind === "start")?.dataSourceId
        ?? task.graph?.masterDataSourceId
        ?? null;
      list.forEach((ds) => {
        rows.push({
          taskId: task.id,
          taskTitle: task.title || "بدون عنوان",
          ds,
          isMaster: masterId != null && Number(ds.id) === Number(masterId),
          fromLibrary: false
        });
      });
    });
    rows.sort((a, b) => String(a.taskTitle).localeCompare(String(b.taskTitle), "fa")
      || String(a.ds.title || a.ds.fileName || "").localeCompare(String(b.ds.title || b.ds.fileName || ""), "fa"));
    return rows;
  }

  function findEntry(taskId, sourceId) {
    const tasks = readTasks();
    const task = tasks.find((t) => String(t.id) === String(taskId));
    if (!task?.graph) return null;
    const ds = (task.graph.dataSources || []).find((d) => Number(d.id) === Number(sourceId));
    if (!ds) return null;
    return { tasks, task, ds };
  }

  function dataSourceSafeFileName(ds) {
    const raw = (ds?.fileName && String(ds.fileName).replace(/\.(xlsx|xlsm|csv)$/i, ""))
      || ds?.title
      || "data-source";
    return String(raw).replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").trim() || "data-source";
  }

  /**
   * Download name of a source, which is the source's own name (title), not the file it was
   * imported from. The imported file name is only a fallback for sources that have no title.
   */
  function dataSourceDownloadName(ds) {
    const raw = (ds?.title && String(ds.title).trim())
      || (ds?.fileName && String(ds.fileName).replace(/\.(xlsx|xlsm|csv)$/i, ""))
      || "data-source";
    return String(raw).replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").trim() || "data-source";
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
      const key = String(cell.key || cell.Key || "");
      byRow.get(idx)[key] = cell.cellValue ?? cell.CellValue ?? "";
    });
    const indexes = [...byRow.keys()].sort((a, b) => a - b);
    const rows = indexes.map((idx) => {
      const map = byRow.get(idx) || {};
      return colKeys.map((k) => map[k] ?? "");
    });
    return { headers, colKeys, columns: cols, rows, cells };
  }

  function downloadBlobFile(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  function downloadAsCsv(ds) {
    const { headers, rows } = dataSourceTableRows(ds);
    const escCsv = (v) => {
      const s = String(v ?? "");
      if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };
    const lines = [headers.map(escCsv).join(",")].concat(rows.map((r) => r.map(escCsv).join(",")));
    downloadBlobFile(new Blob(["\uFEFF" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" }), `${dataSourceSafeFileName(ds)}.csv`);
  }

  /**
   * Read a source's current content straight from the server.
   *
   * Everything that shows or exports source data must go through this. The local cache is a
   * snapshot taken when the page loaded (and the canvas list payload is a summary with no cell
   * values at all), so exporting from it could hand the user yesterday's numbers. This walks the
   * row endpoint in pages until the server says the source is exhausted, so a source larger than
   * the page size is never silently truncated either.
   */
  async function fetchSourceContent(sourceId) {
    const first = await fetch(`/api/datasources/${sourceId}/rows?from=0&count=${SOURCE_PAGE_SIZE}`,
      { credentials: "same-origin" });
    if (!first.ok) throw new Error(`rows ${first.status}`);
    const head = await first.json();

    const columns = head.columns || [];
    const columnKeys = head.columnKeys || columns.map((c) => c.key);
    const cells = [];
    const cellRevisions = {};
    const cellMeta = {};
    const mergeExtras = (page) => {
      for (const [row, cols] of Object.entries(page?.cellRevisions || {})) {
        cellRevisions[row] = Object.assign(cellRevisions[row] || {}, cols);
      }
      for (const [row, cols] of Object.entries(page?.cellMeta || {})) {
        cellMeta[row] = Object.assign(cellMeta[row] || {}, cols);
      }
    };
    const pushRows = (rows) => {
      for (const row of rows || []) {
        for (const [k, v] of Object.entries(row.values || {})) {
          cells.push({ key: k, index: row.rowIndex, cellValue: v });
        }
      }
    };
    pushRows(head.rows);
    mergeExtras(head);

    // Keep paging while the server reports more rows than we have collected.
    let got = (head.rows || []).length;
    const total = Number(head.rowCount) || got;
    while (got < total) {
      const next = await fetch(`/api/datasources/${sourceId}/rows?from=${got}&count=${SOURCE_PAGE_SIZE}`,
        { credentials: "same-origin" });
      if (!next.ok) break;
      const page = await next.json();
      const rows = page.rows || [];
      if (!rows.length) break;
      pushRows(rows);
      mergeExtras(page);
      got += rows.length;
    }

    return {
      id: Number(sourceId),
      title: head.title || "",
      fileName: head.fileName,
      columns,
      columnKeys,
      cells,
      rowCount: Math.max(total, got),
      columnCount: head.columnCount ?? columns.length,
      dataRevision: head.dataRevision,
      hexRevision: head.hexRevision,
      // Carried back so one walk serves the grid, its tooltips and its concurrency check.
      cellRevisions,
      cellMeta
    };
  }

  async function downloadSource(taskId, sourceId, btn) {
    const entry = findEntry(taskId, sourceId);
    const cached = entry?.ds || null;
    if (!entry && !(Number(sourceId) > 0)) {
      notify("منبع پیدا نشد.", "error");
      return;
    }
    if (btn) {
      btn.disabled = true;
      btn.classList.add("is-busy");
    }
    try {
      // Always export the server's current content, never the page-load snapshot.
      let fresh;
      try {
        fresh = await fetchSourceContent(sourceId);
      } catch {
        fresh = cached;
      }
      const ds = fresh || cached;
      if (!ds) {
        notify("منبع پیدا نشد.", "error");
        return;
      }

      const table = dataSourceTableRows(ds);
      if (!table.colKeys.length) {
        notify("این منبع ستونی برای دانلود ندارد.", "error");
        return;
      }
      const payload = {
        title: dataSourceDownloadName(ds),
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
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || `خطا در ساخت اکسل (کد ${res.status})`);
      }
      downloadBlobFile(await res.blob(), `${dataSourceDownloadName(ds)}.xlsx`);
      notify(`فایل «${dataSourceDownloadName(ds)}.xlsx» دانلود شد.`, "success");
    } catch (e) {
      try {
        downloadAsCsv(cached || {});
        notify(`اکسل در دسترس نبود — CSV دانلود شد. ${e.message || ""}`.trim(), "info");
      } catch (e2) {
        notify(e.message || e2.message || "دانلود ناموفق بود.", "error");
      }
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.classList.remove("is-busy");
      }
    }
  }

  function setMaster(taskId, sourceId) {
    const entry = findEntry(taskId, sourceId);
    if (!entry) return;
    const { tasks, task } = entry;
    const start = (task.graph.nodes || []).find((n) => n.kind === "start");
    if (start) {
      start.dataSourceId = Number(sourceId);
      start.repeatSourceType = "DataSource";
    }
    task.graph.masterDataSourceId = Number(sourceId);
    task.graph.repeatSourceType = "DataSource";
    writeTasks(tasks);
    notify("منبع پیش‌فرض فرآیند به‌روز شد.", "success");
    render();
  }

  async function deleteSource(taskId, sourceId) {
    const entry = findEntry(taskId, sourceId);
    // Library-mode row (no task): hard-delete from user library
    if (!entry && (taskId == null || taskId === "null" || taskId === "")) {
      const label = String(sourceId);
      if (!confirm(t("sources.delete") + ` #${label}؟`)) return;
      try {
        const res = await fetch(`/api/datasources/${sourceId}`, { method: "DELETE", credentials: "same-origin" });
        if (!res.ok) throw new Error("delete failed");
        notify(t("sources.delete"), "success");
        await renderAsync();
      } catch {
        notify("حذف ناموفق بود.", "error");
      }
      return;
    }
    if (!entry) return;
    const label = entry.ds.title || entry.ds.fileName || "منبع";
    // Detach from process only (local mirror)
    if (!confirm(`${t("sources.detach")}: «${label}» از «${entry.task.title || ""}»؟`)) return;
    const { tasks, task } = entry;
    task.graph.dataSources = (task.graph.dataSources || []).filter((d) => Number(d.id) !== Number(sourceId));
    const start = (task.graph.nodes || []).find((n) => n.kind === "start");
    if (start && Number(start.dataSourceId) === Number(sourceId)) {
      delete start.dataSourceId;
      const next = task.graph.dataSources[0];
      if (next) {
        start.dataSourceId = next.id;
        task.graph.masterDataSourceId = next.id;
      } else {
        delete task.graph.masterDataSourceId;
      }
    }
    // Keep column name fields on nodes — only clear matching DS ids
    (task.graph.nodes || []).forEach((n) => {
      if (Number(n.dataSourceId) === Number(sourceId) && n.kind !== "start") n.dataSourceId = null;
      if (Number(n.sourceId) === Number(sourceId)) n.sourceId = null;
      if (Number(n.selectorDataSourceId) === Number(sourceId)) n.selectorDataSourceId = null;
      if (Number(n.saveDataSourceId) === Number(sourceId)) n.saveDataSourceId = null;
    });
    task.dataSourceCount = (task.graph.dataSources || []).length;
    writeTasks(tasks);
    try {
      await fetch(`/api/tasks/${taskId}/datasources/${sourceId}`, { method: "DELETE", credentials: "same-origin" });
    } catch { /* local-only ok */ }
    closeViewer();
    notify(t("sources.detach"), "success");
    render();
  }

  let viewerState = {
    taskId: null,
    sourceId: null,
    connection: null,
    blinkTimers: new Map(),
    /** Source detail loaded by refreshViewer, for grids whose process is not in the local cache. */
    lastSource: null,
    /** rowIndex → columnKey → cellRevision, so concurrent writes can be detected. */
    cellRevisions: null,
    /** rowIndex → columnKey → {userId, userName, updatedAtUtc} for the cell tooltip. */
    cellMeta: null
  };

  function cellKey(row, col) {
    return `${row}:${col}`;
  }

  function setLiveStatus(on, text) {
    const el = document.getElementById("da-portal-ds-live");
    if (!el) return;
    el.classList.toggle("is-on", !!on);
    el.textContent = text || (on ? "● زنده" : "● آفلاین");
  }

  function flashCell(td, op) {
    if (!td) return;
    const cls = op === "write" ? "ds-flash-write" : "ds-flash-read";
    td.classList.remove("ds-flash-read", "ds-flash-write");
    void td.offsetWidth;
    td.classList.add(cls);
    const key = cellKey(td.dataset.row, td.dataset.col);
    const prev = viewerState.blinkTimers.get(key);
    if (prev) clearTimeout(prev);
    viewerState.blinkTimers.set(key, setTimeout(() => {
      td.classList.remove(cls);
      viewerState.blinkTimers.delete(key);
    }, 2800));
  }

  function applyCellToLocalStore(ev) {
    if (!ev) return null;
    const taskId = String(ev.taskId ?? ev.TaskId ?? viewerState.taskId ?? "");
    const sourceId = Number(ev.dataSourceId ?? ev.DataSourceId ?? ev.sourceId ?? ev.SourceId);
    if (!taskId || !Number.isFinite(sourceId)) return null;
    const entry = findEntry(taskId, sourceId);
    if (!entry) return null;
    const { tasks, task, ds } = entry;
    const col = String(ev.columnKey ?? ev.ColumnKey ?? "").trim();
    const idx = Number(ev.rowIndex ?? ev.RowIndex ?? 0) || 0;
    if (!col) return ds;
    const op = String(ev.op || ev.Op || "read").toLowerCase();
    if (op.includes("write")) {
      ds.cells = Array.isArray(ds.cells) ? ds.cells : [];
      const hit = ds.cells.find((c) =>
        (c.key === col || c.Key === col)
        && Number(c.index ?? c.Index ?? c.rowIndex) === idx
      );
      const val = ev.cellValue == null && ev.CellValue == null ? "" : String(ev.cellValue ?? ev.CellValue ?? "");
      if (hit) {
        if (hit.cellValue !== undefined) hit.cellValue = val;
        else if (hit.CellValue !== undefined) hit.CellValue = val;
        else hit.value = val;
      } else {
        ds.cells.push({ key: col, index: idx, cellValue: val });
      }
      const rc = Number(ds.rowCount) || 0;
      if (idx + 1 > rc) ds.rowCount = idx + 1;
      writeTasks(tasks);
    }
    return ds;
  }

  function handleCellEvent(ev) {
    if (!ev) return;
    const taskId = String(ev.taskId ?? ev.TaskId ?? "");
    const sid = Number(ev.dataSourceId ?? ev.DataSourceId ?? ev.sourceId ?? ev.SourceId);
    if (taskId && viewerState.taskId != null && String(viewerState.taskId) !== taskId) return;
    const modal = document.getElementById("da-portal-ds-viewer");
    const viewing = modal && !modal.hidden && Number(viewerState.sourceId) === sid;
    const ds = applyCellToLocalStore(ev);
    if (!viewing) return;
    const op = String(ev.op || ev.Op || "read").toLowerCase();
    const col = String(ev.columnKey ?? ev.ColumnKey ?? "");
    const idx = Number(ev.rowIndex ?? ev.RowIndex ?? 0) || 0;
    const table = document.getElementById("da-portal-ds-table");
    if (op.includes("write") && ds) {
      let td = table?.querySelector(`td[data-row="${idx}"][data-col="${CSS.escape(col)}"]`);
      if (!td) {
        renderViewerTable(ds);
        td = table?.querySelector(`td[data-row="${idx}"][data-col="${CSS.escape(col)}"]`);
      } else if (ev.cellValue != null || ev.CellValue != null) {
        td.textContent = String(ev.cellValue ?? ev.CellValue ?? "");
      }
      flashCell(td, "write");
      showActor(ev);
    } else {
      const td = table?.querySelector(`td[data-row="${idx}"][data-col="${CSS.escape(col)}"]`);
      flashCell(td, "read");
      showActor(ev);
    }
  }

  function showActor(ev) {
    const who = ev.userName || ev.UserName;
    if (!who) return;
    const el = document.getElementById("da-portal-ds-actor");
    if (el) {
      el.hidden = false;
      el.textContent = (window.DaI18n ? DaI18n.t("live.byUser", { user: who }) : `توسط ${who}`) || `توسط ${who}`;
    }
    if (window.daNotify) {
      const op = String(ev.op || ev.Op || "read").toLowerCase();
      daNotify(`${who}: ${op === "write" || op.includes("write") ? "نوشتن" : "خواندن"}`, op.includes("write") ? "warn" : "info", { ms: 2200 });
    }
  }

  async function ensureHub(taskId) {
    if (typeof signalR === "undefined") {
      setLiveStatus(false, "● بدون SignalR");
      return;
    }
    try {
      if (viewerState.connection) {
        await viewerState.connection.stop().catch(() => {});
        viewerState.connection = null;
      }
      const conn = new signalR.HubConnectionBuilder()
        .withUrl("/hubs/play-data")
        .withAutomaticReconnect([0, 1000, 3000, 8000])
        .configureLogging(signalR.LogLevel.None)
        .build();
      conn.on("cellEvent", handleCellEvent);
      conn.onreconnecting(() => setLiveStatus(false, "● در حال اتصال…"));
      conn.onreconnected(async () => {
        await conn.invoke("JoinTask", String(taskId)).catch(() => {});
        setLiveStatus(true, "● زنده");
      });
      conn.onclose(() => setLiveStatus(false));
      await conn.start();
      await conn.invoke("JoinTask", String(taskId));
      viewerState.connection = conn;
      setLiveStatus(true, "● زنده");
    } catch {
      setLiveStatus(false, "● قطع");
    }
  }

  function renderViewerTable(ds) {
    const table = document.getElementById("da-portal-ds-table");
    const titleEl = document.getElementById("da-portal-ds-title");
    const subEl = document.getElementById("da-portal-ds-sub");
    if (!table) return;
    const { headers, colKeys, rows } = dataSourceTableRows(ds);
    if (titleEl) titleEl.textContent = ds.title || dataSourceSafeFileName(ds);
    if (subEl) {
      subEl.textContent = `${colKeys.length} ستون · ${rows.length} ردیف${ds.fileName ? ` · ${ds.fileName}` : ""}`
        + ` — ${t("sources.inlineHint") || "دابل‌کلیک: ویرایش · راست‌کلیک: افزودن ردیف/ستون"}`;
    }
    const thead = table.querySelector("thead");
    const tbody = table.querySelector("tbody");
    thead.innerHTML = `<tr><th class="ds-row-idx">#</th>`
      + headers.map((h, ci) => `<th data-col="${escapeHtml(colKeys[ci])}" data-col-index="${ci}" title="${escapeHtml(h)}">${escapeHtml(h)}</th>`).join("")
      + `</tr>`;
    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="${headers.length + 1}" class="ds-viewer-empty">ردیفی نیست — راست‌کلیک کنید و ردیف اضافه کنید</td></tr>`;
      return;
    }
    tbody.innerHTML = rows.map((r, i) =>
      `<tr><th class="ds-row-idx" data-row-index="${i}">${i + 1}</th>${r.map((v, ci) =>
        `<td data-row="${i}" data-col="${escapeHtml(colKeys[ci])}" title="${escapeHtml(cellTooltip(i, colKeys[ci]))}">${escapeHtml(v)}</td>`
      ).join("")}</tr>`
    ).join("");
  }

  /**
   * Tooltip for one cell: who last changed it and when. Shown only in the grid — the Excel export
   * is the data itself and must not carry this change log.
   */
  function cellTooltip(rowIndex, columnKey) {
    const hint = t("sources.inlineEditHint") || "برای ویرایش دابل‌کلیک کنید";
    const meta = viewerState.cellMeta?.[rowIndex]?.[columnKey];
    const when = formatCellStamp(meta?.updatedAtUtc);
    if (!meta || (!meta.userName && !when)) {
      // An imported cell has no per-cell editor; say so rather than showing an empty tooltip.
      return when
        ? `${hint}\n${t("sources.cellMetaImported") || "وارد‌شده از فایل"} · ${when}`
        : hint;
    }
    const byUser = meta.userName ? (t("sources.cellMetaEditedBy", { user: meta.userName }) || meta.userName) : "";
    const atTime = when ? (t("sources.cellMetaEditedAt", { time: when }) || when) : "";
    return [hint, [byUser, atTime].filter(Boolean).join(" · ")].filter(Boolean).join("\n");
  }

  /**
   * Format a cell timestamp using the active UI language, so a Persian UI shows a Jalali date and
   * an English UI a Gregorian one. Falls back to the raw value if the locale data is unavailable.
   */
  function formatCellStamp(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    const lang = (typeof window !== "undefined" && window.daCurrentLang) || document.documentElement.lang || "fa";
    try {
      return new Intl.DateTimeFormat(lang === "en" ? "en-GB" : "fa-IR", {
        dateStyle: "short",
        timeStyle: "short"
      }).format(d);
    } catch {
      return d.toISOString();
    }
  }

  /** Column keys + row count of the source currently open in the viewer (from the local cache). */
  function viewerSource() {
    if (viewerState.taskId == null || viewerState.sourceId == null) return null;
    const entry = findEntry(viewerState.taskId, viewerState.sourceId);
    if (entry) return entry.ds;
    return viewerState.lastSource || null;
  }

  function cellRevisionFor(rowIndex, columnKey) {
    const revs = viewerState.cellRevisions;
    if (!revs) return undefined;
    const row = revs[rowIndex];
    if (!row) return undefined;
    return row[columnKey];
  }

  /** Record the editor stamp for one cell so a re-render (or an immediate tooltip) shows it. */
  function setCellMeta(rowIndex, columnKey, userId, userName, updatedAtUtc) {
    if (!viewerState.cellMeta) viewerState.cellMeta = {};
    viewerState.cellMeta[rowIndex] = viewerState.cellMeta[rowIndex] || {};
    viewerState.cellMeta[rowIndex][columnKey] = {
      userId: userId ?? null,
      userName: userName ?? null,
      // A write always has a server timestamp; fall back to now so the tooltip is never blank.
      updatedAtUtc: updatedAtUtc ?? new Date().toISOString()
    };
  }

  /**
   * Write one cell. The grid sends the revision it last saw so a concurrent writer produces a 409
   * we can surface, instead of silently overwriting their value.
   */
  async function saveCell(rowIndex, columnKey, value) {
    const sourceId = viewerState.sourceId;
    const source = viewerSource();
    if (sourceId == null) return false;
    try {
      const res = await fetch(`/api/datasources/${sourceId}/cells`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rowIndex,
          columnKey,
          cellValue: value,
          expectedCellRevision: cellRevisionFor(rowIndex, columnKey)
        })
      });

      if (res.status === 409) {
        const body = await res.json().catch(() => ({}));
        notify((t("sources.cellConflict") || "این سلول توسط کاربر دیگری تغییر کرده است.")
          + (body.currentCellValue != null ? ` (${body.currentCellValue})` : ""), "warn");
        // Adopt the server's value + revision so the next write succeeds.
        if (viewerState.cellRevisions) {
          viewerState.cellRevisions[rowIndex] = viewerState.cellRevisions[rowIndex] || {};
          if (body.currentCellRevision != null) viewerState.cellRevisions[rowIndex][columnKey] = body.currentCellRevision;
        }
        // The value on screen is now the other writer's, so its stamp has to come from them too —
        // leaving our own name in the tooltip would credit us for a value we did not write.
        setCellMeta(rowIndex, columnKey, body.currentCellUserId, body.currentCellUserName, body.currentCellUpdatedAtUtc);
        const td = document.querySelector(`#da-portal-ds-table td[data-row="${rowIndex}"][data-col="${CSS.escape(columnKey)}"]`);
        if (td) {
          if (body.currentCellValue != null) td.textContent = String(body.currentCellValue);
          td.title = cellTooltip(rowIndex, columnKey);
        }
        if (source) setLocalCell(source, rowIndex, columnKey, body.currentCellValue ?? "");
        return false;
      }
      if (!res.ok) throw new Error(`cell ${res.status}`);

      const body = await res.json();
      if (viewerState.cellRevisions) {
        viewerState.cellRevisions[rowIndex] = viewerState.cellRevisions[rowIndex] || {};
        if (body.cellRevision != null) viewerState.cellRevisions[rowIndex][columnKey] = body.cellRevision;
      }
      // We wrote this value, so the tooltip should now name us and the moment we wrote it.
      setCellMeta(rowIndex, columnKey, body.lastEditorUserId, body.lastEditorUserName, body.updatedAtUtc);
      if (source) setLocalCell(source, rowIndex, columnKey, value);
      notify(t("sources.cellSaved") || "سلول ذخیره شد.", "success");
      return true;
    } catch (e) {
      notify(e.message || t("sources.cellSaveFail") || "ذخیرهٔ سلول ناموفق بود.", "error");
      return false;
    }
  }

  /** Mirror a written cell into the local cache so a re-render shows it before the next fetch. */
  function setLocalCell(ds, rowIndex, columnKey, value) {
    ds.cells = Array.isArray(ds.cells) ? ds.cells : [];
    const hit = ds.cells.find((c) =>
      (c.key === columnKey || c.Key === columnKey)
      && Number(c.index ?? c.Index ?? c.rowIndex) === rowIndex);
    if (hit) {
      if (hit.cellValue !== undefined) hit.cellValue = value;
      else if (hit.CellValue !== undefined) hit.CellValue = value;
      else hit.value = value;
    } else {
      ds.cells.push({ key: columnKey, index: rowIndex, cellValue: value });
    }
    const rc = Number(ds.rowCount) || 0;
    if (rowIndex + 1 > rc) ds.rowCount = rowIndex + 1;
  }

  let editingCell = null;

  /** Double-click → swap the cell for an input; Enter/blur commits, Escape reverts. */
  function beginCellEdit(td) {
    if (!td || editingCell) return;
    const rowIndex = Number(td.dataset.row);
    const columnKey = td.dataset.col;
    if (!Number.isFinite(rowIndex) || !columnKey) return;

    const before = td.textContent ?? "";
    td.classList.add("ds-cell-editing");
    td.innerHTML = "";
    const input = document.createElement("input");
    input.type = "text";
    input.className = "ds-cell-input";
    input.value = before;
    input.autocomplete = "off";
    td.appendChild(input);
    input.focus();
    input.select();
    editingCell = { td, input, rowIndex, columnKey, before, done: false };

    const finish = async (commit) => {
      if (editingCell?.done) return;
      if (editingCell) editingCell.done = true;
      const next = input.value;
      td.classList.remove("ds-cell-editing");
      td.textContent = commit ? next : before;
      editingCell = null;
      if (!commit || next === before) return;
      const ok = await saveCell(rowIndex, columnKey, next);
      if (!ok) td.textContent = before;
    };

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); finish(true); }
      else if (e.key === "Escape") { e.preventDefault(); finish(false); }
      // Keep grid-level shortcuts (Delete, arrows) from firing while typing.
      e.stopPropagation();
    });
    input.addEventListener("blur", () => finish(true));
    input.addEventListener("dblclick", (e) => e.stopPropagation());
  }

  /** Row/column context menu for the source grid. */
  function showGridMenu(x, y, td) {
    const source = viewerSource();
    if (!source || viewerState.sourceId == null) return;
    const rowIndex = td ? Number(td.dataset.row) : null;
    const columnKey = td ? td.dataset.col : null;

    const items = [
      { id: "row-after", label: t("sources.addRowAfter") || "افزودن ردیف بعد از این" },
      { id: "row-before", label: t("sources.addRowBefore") || "افزودن ردیف قبل از این" },
      { sep: true },
      { id: "col-after", label: t("sources.addColAfter") || "افزودن ستون بعد از این" },
      { id: "col-before", label: t("sources.addColBefore") || "افزودن ستون قبل از این" }
    ];
    if (!td) {
      // Clicked a header or empty area — offer append-only actions.
      items.splice(0, items.length,
        { id: "row-append", label: t("sources.addRowAppend") || "افزودن ردیف در پایان" },
        { sep: true },
        { id: "col-append", label: t("sources.addColAppend") || "افزودن ستون در پایان" });
    }

    const menu = document.createElement("div");
    menu.className = "ds-grid-menu";
    menu.setAttribute("role", "menu");
    menu.innerHTML = items.map((it) => it.sep
      ? `<div class="ds-grid-menu-sep"></div>`
      : `<button type="button" class="ds-grid-menu-item" data-action="${it.id}">${escapeHtml(it.label)}</button>`
    ).join("");
    document.body.appendChild(menu);
    // Flip near the viewport edges so the menu is never cut off.
    const rect = menu.getBoundingClientRect();
    const left = Math.min(x, window.innerWidth - rect.width - 8);
    const top = Math.min(y, window.innerHeight - rect.height - 8);
    menu.style.left = `${Math.max(4, left)}px`;
    menu.style.top = `${Math.max(4, top)}px`;

    const close = () => {
      menu.remove();
      document.removeEventListener("mousedown", onDocDown, true);
      document.removeEventListener("keydown", onKey, true);
    };
    const onDocDown = (e) => { if (!menu.contains(e.target)) close(); };
    const onKey = (e) => { if (e.key === "Escape") close(); };
    document.addEventListener("mousedown", onDocDown, true);
    document.addEventListener("keydown", onKey, true);

    menu.addEventListener("click", async (e) => {
      const btn = e.target.closest("[data-action]");
      if (!btn) return;
      const action = btn.dataset.action;
      close();
      await runGridAction(action, rowIndex, columnKey);
    });
  }

  async function runGridAction(action, rowIndex, columnKey) {
    const sourceId = viewerState.sourceId;
    if (sourceId == null) return;
    const source = viewerSource();
    const columns = (source?.columnKeys || source?.columns || []).map((c) => String(c.key || c.Key || c));
    const rowCount = Number(source?.rowCount) || 0;

    const beforeIndexFor = (kind) => {
      if (action === `${kind}-before`) return rowIndex ?? undefined;
      if (action === `${kind}-after`) return rowIndex == null ? undefined : rowIndex + 1;
      return undefined; // append
    };

    try {
      if (action.startsWith("row-")) {
        const beforeIndex = beforeIndexFor("row");
        const res = await fetch(`/api/datasources/${sourceId}/rows/add`, {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ beforeIndex, count: 1 })
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.message || t("sources.addRowFail") || "افزودن ردیف ناموفق بود.");
        notify(t("sources.rowAdded") || "ردیف اضافه شد.", "success");
      } else {
        const beforeIndex = beforeIndexFor("col");
        // Derive a free key from the current columns, mirroring the server's generator.
        const key = nextColumnKey(columns);
        const res = await fetch(`/api/datasources/${sourceId}/columns`, {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key, title: key, beforeIndex })
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.message || t("sources.addColFail") || "افزودن ستون ناموفق بود.");
        notify(t("sources.colAdded", { key: body.addedColumnKey || key }) || `ستون «${body.addedColumnKey || key}» اضافه شد.`, "success");
      }
      await refreshViewer();
    } catch (e) {
      notify(e.message || "انجام نشد.", "error");
    }
  }

  /** First free c<n> not already used by the source. */
  function nextColumnKey(existingKeys) {
    const used = new Set((existingKeys || []).map((k) => String(k).toLowerCase()));
    let n = used.size + 1;
    while (used.has(`c${n}`)) n++;
    return `c${n}`;
  }

  /** Reload the open source from the server and repaint the grid (keeps the zoom/scroll owner). */
  async function refreshViewer() {
    const sourceId = viewerState.sourceId;
    if (sourceId == null) return;
    try {
      // One walk supplies the cells, the per-cell revisions the inline editor checks against, and
      // the per-cell editor stamps the tooltips show — so the three can never disagree.
      const fresh = await fetchSourceContent(sourceId);
      viewerState.cellRevisions = fresh.cellRevisions || null;
      viewerState.cellMeta = fresh.cellMeta || null;
      viewerState.lastSource = fresh;
      renderViewerTable(fresh);
    } catch { /* leave the grid as-is */ }
  }

  async function openViewer(taskId, sourceId) {
    viewerState.taskId = taskId;
    viewerState.sourceId = Number(sourceId);
    // Read the source straight from the server: the grid needs real cell values and the current
    // column set, which the list payload deliberately omits (it is a summary-only shape).
    await refreshViewer();
    if (!viewerState.lastSource) {
      const entry = findEntry(taskId, sourceId);
      if (!entry) {
        notify("منبع پیدا نشد.", "error");
        return;
      }
      renderViewerTable(entry.ds);
    }
    const modal = document.getElementById("da-portal-ds-viewer");
    if (modal) modal.hidden = false;
    setLiveStatus(false, "● اتصال…");
    await ensureHub(taskId);
  }

  async function closeViewer() {
    const modal = document.getElementById("da-portal-ds-viewer");
    if (modal) modal.hidden = true;
    viewerState.sourceId = null;
    viewerState.taskId = null;
    viewerState.lastSource = null;
    viewerState.cellRevisions = null;
    viewerState.cellMeta = null;
    editingCell = null;
    setLiveStatus(false);
    if (viewerState.connection) {
      try { await viewerState.connection.stop(); } catch { /* ignore */ }
      viewerState.connection = null;
    }
  }

  function actionButtons(row) {
    const tid = row.taskId != null ? escapeHtml(String(row.taskId)) : "";
    const sid = Number(row.ds.id);
    const master = row.fromLibrary
      ? ""
      : (row.isMaster
        ? iconBtn("is-master", t("sources.master"), ICO_STAR, "disabled")
        : iconBtn("js-master", t("sources.setMaster"), ICO_STAR_OUT, `data-task="${tid}" data-id="${sid}"`));
    const delLabel = row.fromLibrary ? t("sources.delete") : t("sources.detach");
    const openBtn = row.taskId != null
      ? iconBtn("js-open", t("sources.openProcess"), ICO_OPEN, `data-task="${tid}"`)
      : "";
    return `
      ${Number(sid) > 0 ? iconBtn("js-rename", t("sources.rename"), ICO_RENAME, `data-id="${sid}" data-title="${escapeHtml(row.ds.title || "")}"`) : ""}
      ${Number(sid) > 0 ? iconBtn("js-reload", t("sources.reloadFile"), ICO_RELOAD, `data-id="${sid}" data-title="${escapeHtml(row.ds.title || "")}"`) : ""}
      ${row.taskId != null ? iconBtn("js-view", t("sources.viewTable"), ICO_VIEW, `data-task="${tid}" data-id="${sid}"`) : ""}
      ${row.taskId != null ? iconBtn("js-dl", t("sources.downloadExcel"), ICO_DL, `data-task="${tid}" data-id="${sid}"`) : ""}
      ${iconBtn("js-cloud", t("sources.saveServerSoon"), ICO_CLOUD, `data-id="${sid}"`)}
      ${master}
      ${iconBtn("js-del is-danger", delLabel, ICO_DEL, `data-task="${tid}" data-id="${sid}" data-lib="${row.fromLibrary ? "1" : "0"}"`)}
      ${openBtn}
    `;
  }

  function bindActions(root) {
    if (!root) return;
    root.querySelectorAll(".js-rename").forEach((btn) => {
      btn.addEventListener("click", () => renameLibrarySource(btn.dataset.id, btn.dataset.title || ""));
    });
    root.querySelectorAll(".js-reload").forEach((btn) => {
      btn.addEventListener("click", () => reloadLibrarySource(btn.dataset.id, btn.dataset.title || ""));
    });
    root.querySelectorAll(".js-view").forEach((btn) => {
      btn.addEventListener("click", () => openViewer(btn.dataset.task, btn.dataset.id));
    });
    root.querySelectorAll(".js-dl").forEach((btn) => {
      btn.addEventListener("click", () => downloadSource(btn.dataset.task, btn.dataset.id, btn));
    });
    root.querySelectorAll(".js-cloud").forEach((btn) => {
      btn.addEventListener("click", () => notify(t("sources.saveServerSoonToast") || t("sources.libraryHint"), "info"));
    });
    root.querySelectorAll(".js-master").forEach((btn) => {
      btn.addEventListener("click", () => setMaster(btn.dataset.task, btn.dataset.id));
    });
    root.querySelectorAll(".js-del").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (btn.dataset.lib === "1") deleteSource(null, btn.dataset.id);
        else deleteSource(btn.dataset.task, btn.dataset.id);
      });
    });
    root.querySelectorAll(".js-open").forEach((btn) => {
      btn.addEventListener("click", () => {
        window.location.href = `/Panel/Tasks/Editor/${encodeURIComponent(btn.dataset.task)}`;
      });
    });
  }

  function paintRows(rows) {
    const rowsEl = document.getElementById("da-source-rows");
    const cardsEl = document.getElementById("da-source-cards");
    const status = document.getElementById("da-sources-status");
    if (status) {
      status.textContent = rows.length
        ? `${rows.length.toLocaleString("fa-IR")} منبع — ${t("sources.libraryHint")}`
        : t("sources.libraryHint");
    }
    if (rowsEl) {
      if (!rows.length) {
        rowsEl.innerHTML = `<tr><td colspan="6" class="text-center text-muted py-6">منبعی یافت نشد. از ویرایشگر فرآیند فایل اکسل اضافه کنید.</td></tr>`;
      } else {
        rowsEl.innerHTML = rows.map((r) => {
          const label = r.ds.title || r.ds.fileName || "منبع";
          const cols = (r.ds.columnCount ?? (r.ds.columnKeys || r.ds.columns || []).length) || 0;
          const rowCount = r.ds.rowCount ?? 0;
          return `<tr>
            <td>
              <div class="fw-semibold">${escapeHtml(label)}${r.isMaster ? ` <span class="ds-badge-master">پیش‌فرض</span>` : ""}</div>
            </td>
            <td>${escapeHtml(r.taskTitle)}</td>
            <td>${cols}</td>
            <td>${rowCount}</td>
            <td>${escapeHtml(r.ds.fileName || "—")}</td>
            <td class="text-nowrap"><div class="ds-actions">${actionButtons(r)}</div></td>
          </tr>`;
        }).join("");
      }
      bindActions(rowsEl);
    }
    if (cardsEl) {
      if (!rows.length) {
        cardsEl.innerHTML = `<div class="da-task-empty text-muted">منبعی نیست.</div>`;
      } else {
        cardsEl.innerHTML = rows.map((r) => {
          const label = r.ds.title || r.ds.fileName || "منبع";
          return `<div class="da-source-card card mb-2"><div class="card-body">
            <div class="fw-semibold mb-1">${escapeHtml(label)}</div>
            <div class="text-muted small mb-2">${escapeHtml(r.taskTitle)}</div>
            <div class="ds-actions">${actionButtons(r)}</div>
          </div></div>`;
        }).join("");
      }
      bindActions(cardsEl);
    }
  }

  function render() {
    paintRows(collectSources());
  }

  async function renderAsync() {
    const lib = await fetchLibrarySources();
    if (lib !== null) {
      paintRows(lib);
      return;
    }
    render();
  }

  document.querySelectorAll("[data-portal-ds-close]").forEach((el) => {
    el.addEventListener("click", () => closeViewer());
  });
  document.getElementById("da-portal-ds-refresh")?.addEventListener("click", () => {
    if (viewerState.taskId == null || viewerState.sourceId == null) return;
    refreshViewer();
  });

  // --- Grid interactions: double-click edits a cell, right-click opens the add menu ----------
  const viewerTable = document.getElementById("da-portal-ds-table");
  if (viewerTable) {
    viewerTable.addEventListener("dblclick", (e) => {
      const td = e.target.closest("td[data-row][data-col]");
      if (!td) return;
      e.preventDefault();
      beginCellEdit(td);
    });
    viewerTable.addEventListener("contextmenu", (e) => {
      const modal = document.getElementById("da-portal-ds-viewer");
      if (!modal || modal.hidden) return;
      e.preventDefault();
      const td = e.target.closest("td[data-row][data-col]");
      showGridMenu(e.clientX, e.clientY, td);
    });
  }

  document.addEventListener("keydown", (e) => {
    const modal = document.getElementById("da-portal-ds-viewer");
    if (!modal || modal.hidden) return;
    // Escape belongs to the cell editor while a cell is open — do not close the whole viewer.
    if (e.key === "Escape" && !editingCell) closeViewer();
  });

  window.addEventListener("da-local-tasks", () => {
    renderAsync();
    // The local cache is a summary shape; repainting the open grid from it would drop the real
    // cell values and any optimistic revisions, so only repaint when the server load failed.
    if (viewerState.taskId != null && viewerState.sourceId != null && !viewerState.lastSource) {
      const entry = findEntry(viewerState.taskId, viewerState.sourceId);
      if (entry) renderViewerTable(entry.ds);
    }
  });
  window.addEventListener("da-ds-cell-event", (ev) => {
    handleCellEvent(ev.detail || {});
  });

  function scheduleRender() {
    const run = () => {
      if (window.DaSecureStore && typeof DaSecureStore.whenReady === "function") {
        DaSecureStore.whenReady(() => renderAsync());
      } else {
        renderAsync();
      }
    };
    if (window.DaI18n && DaI18n.ready && typeof DaI18n.ready.then === "function") {
      DaI18n.ready.then(run).catch(run);
    } else {
      run();
    }
  }

  document.addEventListener("da:locale", () => scheduleRender());
  if (window.DaCatalog) {
    DaCatalog.ensure();
    DaCatalog.on("sourceChanged", (payload) => {
      if (!payload) return;
      const who = payload.actorUserName ? ` (${payload.actorUserName})` : "";
      const action = payload.action || "updated";
      if (window.daNotify) {
        const msg = action === "deleted"
          ? ((window.DaI18n ? DaI18n.t("live.sourceDeleted") : null) || "منبع حذف شد")
          : ((window.DaI18n ? DaI18n.t("live.sourceUpdated") : null) || "منبع به‌روز شد");
        daNotify(msg + who, action === "deleted" ? "info" : "success");
      }
      scheduleRender();

      // A source that is open in the viewer has to follow the change, not just the list. Our own
      // write already updated the grid, so re-reading on every event would fight the editor; we
      // only pull when somebody else changed the source we are looking at.
      const changedId = Number(payload.source?.id ?? payload.source?.Id ?? payload.source?.sourceId ?? payload.sourceId);
      const actor = payload.actorUserName || payload.ActorUserName || "";
      const mine = actor && actor === (window.daCurrentUserName || "");
      if (!mine && viewerState.sourceId != null && changedId === Number(viewerState.sourceId)) {
        if (action === "deleted") closeViewer();
        else refreshViewer();
      }

      setTimeout(() => {
        const tid = payload.taskId ?? payload.TaskId;
        document.querySelectorAll(`#da-source-rows tr, #da-source-cards .da-source-card`).forEach((el) => {
          const link = el.querySelector(`a[href*="/Editor/${tid}"]`) || el.querySelector(`[data-task="${tid}"]`);
          if (!link && !String(el.innerHTML || "").includes(`/Editor/${tid}`)) return;
          el.classList.add("da-row-flash");
          setTimeout(() => el.classList.remove("da-row-flash"), 1600);
        });
      }, 250);
    });
    DaCatalog.on("taskChanged", (payload) => {
      if (!payload) return;
      if (payload.action === "deleted") {
        scheduleRender();
        return;
      }
      scheduleRender();
    });
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", scheduleRender);
  } else {
    scheduleRender();
  }
})();
