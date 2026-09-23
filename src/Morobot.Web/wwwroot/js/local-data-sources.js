(function () {
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

  const ICO_VIEW = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M12 5c5.2 0 9.3 3.4 10.7 7-1.4 3.6-5.5 7-10.7 7S2.7 15.6 1.3 12C2.7 8.4 6.8 5 12 5zm0 2.5A4.5 4.5 0 1 0 16.5 12 4.5 4.5 0 0 0 12 7.5zm0 2A2.5 2.5 0 1 1 9.5 12 2.5 2.5 0 0 1 12 9.5z"/></svg>`;
  const ICO_DL = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M12 3v10.2l3.4-3.4 1.4 1.4L12 17l-4.8-5.8 1.4-1.4L11 13.2V3h1zM5 19h14v2H5v-2z"/></svg>`;
  const ICO_CLOUD = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M17.5 19H8a5 5 0 0 1-.7-9.95A6.5 6.5 0 0 1 20 12.5a3.5 3.5 0 0 1-2.5 6.5zM12 8v6.2l2.4-2.4 1.2 1.2L12 17l-3.6-3.999 1.2-1.2L11 14.2V8h1z"/></svg>`;
  const ICO_STAR = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M12 3.6l2.4 4.9 5.4.8-3.9 3.8.9 5.4L12 16.1 7.2 18.5l.9-5.4L4.2 9.3l5.4-.8L12 3.6z"/></svg>`;
  const ICO_STAR_OUT = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.7" d="M12 3.6l2.4 4.9 5.4.8-3.9 3.8.9 5.4L12 16.1 7.2 18.5l.9-5.4L4.2 9.3l5.4-.8L12 3.6z"/></svg>`;
  const ICO_DEL = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M9 3h6l1 2h4v2H4V5h4l1-2zm1 6h2v9h-2V9zm4 0h2v9h-2V9zM7 9h2v9H7V9z"/></svg>`;
  const ICO_OPEN = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M14 3h7v7h-2V6.4l-9.3 9.3-1.4-1.4L17.6 5H14V3zM5 5h6v2H7v10h10v-4h2v6H5V5z"/></svg>`;

  function iconBtn(cls, title, iconHtml, extra = "") {
    return `<button type="button" class="ds-icon-btn ${cls}" title="${escapeHtml(title)}" aria-label="${escapeHtml(title)}" ${extra}>${iconHtml}</button>`;
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
          isMaster: masterId != null && Number(ds.id) === Number(masterId)
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

  async function downloadSource(taskId, sourceId, btn) {
    const entry = findEntry(taskId, sourceId);
    if (!entry) {
      notify("منبع پیدا نشد.", "error");
      return;
    }
    const { ds } = entry;
    const table = dataSourceTableRows(ds);
    if (!table.colKeys.length) {
      notify("این منبع ستونی برای دانلود ندارد.", "error");
      return;
    }
    if (btn) {
      btn.disabled = true;
      btn.classList.add("is-busy");
    }
    try {
      const payload = {
        title: dataSourceSafeFileName(ds),
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
      downloadBlobFile(await res.blob(), `${dataSourceSafeFileName(ds)}.xlsx`);
      notify(`فایل «${dataSourceSafeFileName(ds)}.xlsx» دانلود شد.`, "success");
    } catch (e) {
      try {
        downloadAsCsv(ds);
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

  function deleteSource(taskId, sourceId) {
    const entry = findEntry(taskId, sourceId);
    if (!entry) return;
    const label = entry.ds.title || entry.ds.fileName || "منبع";
    if (!confirm(`منبع «${label}» از فرآیند «${entry.task.title || ""}» حذف شود؟`)) return;
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
    task.dataSourceCount = (task.graph.dataSources || []).length;
    writeTasks(tasks);
    closeViewer();
    notify(`منبع «${label}» حذف شد.`, "success");
    render();
  }

  let viewerState = { taskId: null, sourceId: null, connection: null, blinkTimers: new Map() };

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
    } else {
      const td = table?.querySelector(`td[data-row="${idx}"][data-col="${CSS.escape(col)}"]`);
      flashCell(td, "read");
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
        + " — هنگام اجرا خواندن/نوشتن زنده به‌روز می‌شود";
    }
    const thead = table.querySelector("thead");
    const tbody = table.querySelector("tbody");
    thead.innerHTML = `<tr><th class="ds-row-idx">#</th>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr>`;
    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="${headers.length + 1}" class="ds-viewer-empty">ردیفی نیست</td></tr>`;
      return;
    }
    tbody.innerHTML = rows.map((r, i) =>
      `<tr><th class="ds-row-idx">${i + 1}</th>${r.map((v, ci) =>
        `<td data-row="${i}" data-col="${escapeHtml(colKeys[ci])}">${escapeHtml(v)}</td>`
      ).join("")}</tr>`
    ).join("");
  }

  async function openViewer(taskId, sourceId) {
    const entry = findEntry(taskId, sourceId);
    if (!entry) {
      notify("منبع پیدا نشد.", "error");
      return;
    }
    viewerState.taskId = taskId;
    viewerState.sourceId = Number(sourceId);
    renderViewerTable(entry.ds);
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
    setLiveStatus(false);
    if (viewerState.connection) {
      try { await viewerState.connection.stop(); } catch { /* ignore */ }
      viewerState.connection = null;
    }
  }

  function actionButtons(row) {
    const tid = escapeHtml(String(row.taskId));
    const sid = Number(row.ds.id);
    const master = row.isMaster
      ? iconBtn("is-master", "منبع پیش‌فرض", ICO_STAR, "disabled")
      : iconBtn("js-master", "تنظیم به‌عنوان پیش‌فرض", ICO_STAR_OUT, `data-task="${tid}" data-id="${sid}"`);
    return `
      ${iconBtn("js-view", "مشاهده جدول", ICO_VIEW, `data-task="${tid}" data-id="${sid}"`)}
      ${iconBtn("js-dl", "دانلود اکسل", ICO_DL, `data-task="${tid}" data-id="${sid}"`)}
      ${iconBtn("js-cloud", "ذخیره در سرور (به‌زودی)", ICO_CLOUD, `data-task="${tid}" data-id="${sid}"`)}
      ${master}
      ${iconBtn("js-del is-danger", "حذف منبع", ICO_DEL, `data-task="${tid}" data-id="${sid}"`)}
      ${iconBtn("js-open", "باز کردن فرآیند", ICO_OPEN, `data-task="${tid}"`)}
    `;
  }

  function bindActions(root) {
    if (!root) return;
    root.querySelectorAll(".js-view").forEach((btn) => {
      btn.addEventListener("click", () => openViewer(btn.dataset.task, btn.dataset.id));
    });
    root.querySelectorAll(".js-dl").forEach((btn) => {
      btn.addEventListener("click", () => downloadSource(btn.dataset.task, btn.dataset.id, btn));
    });
    root.querySelectorAll(".js-cloud").forEach((btn) => {
      btn.addEventListener("click", () => notify("ذخیره در سرور به‌زودی فعال می‌شود.", "info"));
    });
    root.querySelectorAll(".js-master").forEach((btn) => {
      btn.addEventListener("click", () => setMaster(btn.dataset.task, btn.dataset.id));
    });
    root.querySelectorAll(".js-del").forEach((btn) => {
      btn.addEventListener("click", () => deleteSource(btn.dataset.task, btn.dataset.id));
    });
    root.querySelectorAll(".js-open").forEach((btn) => {
      btn.addEventListener("click", () => {
        window.location.href = `/Panel/Tasks/Editor/${encodeURIComponent(btn.dataset.task)}`;
      });
    });
  }

  function render() {
    const rowsEl = document.getElementById("da-source-rows");
    const cardsEl = document.getElementById("da-source-cards");
    const status = document.getElementById("da-sources-status");
    const rows = collectSources();
    if (status) {
      status.textContent = rows.length
        ? `${rows.length.toLocaleString("fa-IR")} منبع در فرآیندهای شما`
        : "هنوز منبعی به فرآیندها پیوست نشده است.";
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
            <td><a href="/Panel/Tasks/Editor/${encodeURIComponent(r.taskId)}">${escapeHtml(r.taskTitle)}</a></td>
            <td>${Number(cols).toLocaleString("fa-IR")}</td>
            <td>${Number(rowCount).toLocaleString("fa-IR")}</td>
            <td class="text-muted small">${escapeHtml(r.ds.fileName || "—")}</td>
            <td><div class="ds-actions da-source-actions">${actionButtons(r)}</div></td>
          </tr>`;
        }).join("");
      }
      bindActions(rowsEl);
    }
    if (cardsEl) {
      if (!rows.length) {
        cardsEl.innerHTML = `<div class="da-task-empty text-muted">منبعی یافت نشد. از ویرایشگر فرآیند فایل اکسل اضافه کنید.</div>`;
      } else {
        cardsEl.innerHTML = rows.map((r) => {
          const label = r.ds.title || r.ds.fileName || "منبع";
          const cols = (r.ds.columnCount ?? (r.ds.columnKeys || r.ds.columns || []).length) || 0;
          const rowCount = r.ds.rowCount ?? 0;
          return `<article class="da-task-card da-source-card">
            <div class="da-task-card-top">
              <h3 class="da-task-card-title">${escapeHtml(label)}${r.isMaster ? ` <span class="ds-badge-master">پیش‌فرض</span>` : ""}</h3>
            </div>
            <ul class="da-task-card-meta">
              <li><i class="ti ti-git-branch"></i>${escapeHtml(r.taskTitle)}</li>
              <li><i class="ti ti-file"></i>${escapeHtml(r.ds.fileName || "بدون فایل")}</li>
            </ul>
            <div class="da-task-stats">
              <div class="da-task-stat"><b>${Number(cols).toLocaleString("fa-IR")}</b><span>ستون</span></div>
              <div class="da-task-stat"><b>${Number(rowCount).toLocaleString("fa-IR")}</b><span>ردیف</span></div>
            </div>
            <div class="da-source-card-actions ds-actions">${actionButtons(r)}</div>
          </article>`;
        }).join("");
      }
      bindActions(cardsEl);
    }
  }

  document.querySelectorAll("[data-portal-ds-close]").forEach((el) => {
    el.addEventListener("click", () => closeViewer());
  });
  document.getElementById("da-portal-ds-refresh")?.addEventListener("click", () => {
    if (viewerState.taskId == null || viewerState.sourceId == null) return;
    const entry = findEntry(viewerState.taskId, viewerState.sourceId);
    if (entry) renderViewerTable(entry.ds);
  });
  document.addEventListener("keydown", (e) => {
    const modal = document.getElementById("da-portal-ds-viewer");
    if (e.key === "Escape" && modal && !modal.hidden) closeViewer();
  });

  window.addEventListener("da-local-tasks", () => {
    render();
    if (viewerState.taskId != null && viewerState.sourceId != null) {
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
        DaSecureStore.whenReady(render);
      } else {
        render();
      }
    };
    if (window.DaI18n && DaI18n.ready && typeof DaI18n.ready.then === "function") {
      DaI18n.ready.then(run).catch(run);
    } else {
      run();
    }
  }

  document.addEventListener("da:locale", () => scheduleRender());
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", scheduleRender);
  } else {
    scheduleRender();
  }
})();
