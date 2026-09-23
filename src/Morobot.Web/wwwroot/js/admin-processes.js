/**
 * Admin processes page — live catalog + playing indicators.
 */
(function () {
  const i18n = window.__ADMIN_I18N__ || {};
  const actions = i18n.actions || {};

  function tAction(action) {
    const key = String(action || "").toLowerCase();
    return actions[key] || action || "—";
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

  function setChangeBadge(row, action, actor) {
    const cell = row.querySelector("[data-flash='change']");
    if (!cell) return;
    const label = tAction(action);
    const who = actor ? String(actor) : "";
    cell.innerHTML = `<span class="admin-change-badge is-${String(action || "updated").toLowerCase()}">${escapeHtml(label)}</span>`
      + (who ? `<span class="admin-change-actor">${escapeHtml(formatBy(who))}</span>` : "");
    flashCell(cell);
  }

  function formatBy(user) {
    const tpl = i18n.byUser || "by {user}";
    return tpl.replace("{user}", user);
  }

  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"'`]/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;", "`": "&#96;" }[c]));
  }

  function findRow(taskId) {
    return document.querySelector(`#admin-process-rows tr[data-task-id="${CSS.escape(String(taskId))}"]`);
  }

  function setPlaying(taskId, playing, userName) {
    const row = findRow(taskId);
    if (!row) return;
    const ico = row.querySelector(".admin-play-ico");
    if (!ico) return;
    if (playing) {
      ico.hidden = false;
      ico.classList.add("is-blink");
      const tip = (i18n.playingBy || i18n.playing || "Playing")
        .replace("{user}", userName || "—");
      ico.title = tip;
      ico.setAttribute("aria-label", tip);
    } else {
      ico.hidden = true;
      ico.classList.remove("is-blink");
    }
    flashCell(row.querySelector("[data-flash='play']"));
  }

  function upsertRow(task, action, actor) {
    if (!task?.id) return;
    let row = findRow(task.id);
    const tbody = document.getElementById("admin-process-rows");
    if (!tbody) return;
    tbody.querySelector(".admin-empty-row")?.remove();

    if (!row) {
      row = document.createElement("tr");
      row.dataset.taskId = String(task.id);
      row.innerHTML = `
        <td>${escapeHtml(task.id)}</td>
        <td data-flash="title">${escapeHtml(task.title || "")}</td>
        <td>${escapeHtml(task.ownerUserName || "—")}</td>
        <td>${escapeHtml(task.designOrigin || "")}</td>
        <td data-flash="counts">${Number(task.groupCount || 0)} / ${Number(task.stepCount || 0)} / ${Number(task.dataSourceCount || 0)}</td>
        <td>${escapeHtml(task.createdAtUtc || "")}</td>
        <td class="admin-change-cell" data-flash="change"><span class="admin-change-badge is-idle">—</span></td>
        <td class="admin-play-cell" data-flash="play"><span class="admin-play-ico" hidden><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M8 5.5v13l11-6.5L8 5.5z"/></svg></span></td>
        <td></td>`;
      tbody.prepend(row);
    } else {
      const titleEl = row.querySelector("[data-flash='title']");
      if (titleEl && task.title != null) titleEl.textContent = task.title;
      const countsEl = row.querySelector("[data-flash='counts']");
      if (countsEl && (task.groupCount != null || task.stepCount != null || task.dataSourceCount != null)) {
        countsEl.textContent = `${Number(task.groupCount || 0)} / ${Number(task.stepCount || 0)} / ${Number(task.dataSourceCount || 0)}`;
      }
    }
    setChangeBadge(row, action, actor);
    flashCell(row);
    pushFeed(`${tAction(action)} #${task.id}${actor ? " — " + formatBy(actor) : ""}`);
  }

  function removeRow(taskId, actor) {
    const row = findRow(taskId);
    if (!row) return;
    setChangeBadge(row, "deleted", actor);
    row.classList.add("admin-row-gone");
    pushFeed(`${tAction("deleted")} #${taskId}${actor ? " — " + formatBy(actor) : ""}`);
    setTimeout(() => row.remove(), 1800);
  }

  function applyInitialPlaying() {
    const list = Array.isArray(window.__ADMIN_PLAYING__) ? window.__ADMIN_PLAYING__ : [];
    list.forEach((p) => setPlaying(p.taskId, true, p.userName));
  }

  async function boot() {
    applyInitialPlaying();
    if (!window.DaCatalog) {
      setLive(false, i18n.offline);
      return;
    }
    setLive(false, i18n.connecting);
    DaCatalog.on("taskChanged", (payload) => {
      if (!payload) return;
      const action = payload.action || payload.Action || "updated";
      const actor = payload.actorUserName || payload.ActorUserName || "";
      const task = payload.task || payload.Task || {};
      const id = task.id ?? task.Id;
      if (String(action).toLowerCase() === "deleted") {
        removeRow(id, actor);
        return;
      }
      upsertRow({
        id,
        title: task.title ?? task.Title,
        ownerUserName: task.ownerUserName ?? task.OwnerUserName,
        designOrigin: task.designOrigin ?? task.DesignOrigin,
        groupCount: task.groupCount ?? task.GroupCount,
        stepCount: task.stepCount ?? task.StepCount,
        dataSourceCount: task.dataSourceCount ?? task.DataSourceCount,
        createdAtUtc: task.createdAtUtc ?? task.CreatedAtUtc
      }, action, actor);
    });
    DaCatalog.on("playState", (payload) => {
      if (!payload) return;
      const taskId = payload.taskId ?? payload.TaskId;
      const playing = !!(payload.playing ?? payload.Playing);
      const userName = payload.userName ?? payload.UserName;
      setPlaying(taskId, playing, userName);
      if (playing) {
        pushFeed(`${i18n.playing || "Playing"} #${taskId}${userName ? " — " + formatBy(userName) : ""}`);
      }
    });
    const conn = await DaCatalog.ensure({ admin: true });
    setLive(!!conn, conn ? i18n.live : i18n.offline);
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
