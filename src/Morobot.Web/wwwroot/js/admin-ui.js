(function () {
  document.querySelectorAll("[data-auto-submit]").forEach((input) => {
    input.addEventListener("change", () => {
      const form = input.closest("form");
      if (form) form.requestSubmit ? form.requestSubmit() : form.submit();
    });
  });

  // "All" switch above a checkbox list (migration pages). Bound by container id + row selector.
  function bindSelectAll(masterId, rowSelector) {
    const master = document.getElementById(masterId)?.querySelector('input[type="checkbox"]');
    if (!master) return;
    const rows = () => Array.from(document.querySelectorAll(rowSelector));
    const syncMaster = () => {
      const list = rows();
      if (!list.length) return;
      master.indeterminate = list.some((x) => x.checked) && list.some((x) => !x.checked);
      master.checked = list.every((x) => x.checked);
    };
    master.addEventListener("change", () => {
      rows().forEach((cb) => { cb.checked = master.checked; });
    });
    rows().forEach((cb) => cb.addEventListener("change", syncMaster));
    syncMaster();
  }

  bindSelectAll("migrate-select-all", ".js-migrate-user-cb");
  bindSelectAll("migrate-tasks-select-all", ".js-migrate-task-cb");
})();
