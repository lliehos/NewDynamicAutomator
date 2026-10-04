(function () {
  document.querySelectorAll("[data-auto-submit]").forEach((input) => {
    input.addEventListener("change", () => {
      const form = input.closest("form");
      if (form) form.requestSubmit ? form.requestSubmit() : form.submit();
    });
  });

  const selectAll = document.getElementById("migrate-select-all");
  if (selectAll) {
    const master = selectAll.querySelector('input[type="checkbox"]');
    const rows = () => Array.from(document.querySelectorAll(".js-migrate-user-cb"));
    const syncMaster = () => {
      const list = rows();
      if (!list.length || !master) return;
      master.indeterminate = list.some((x) => x.checked) && list.some((x) => !x.checked);
      master.checked = list.length > 0 && list.every((x) => x.checked);
    };
    master?.addEventListener("change", () => {
      rows().forEach((cb) => { cb.checked = master.checked; });
    });
    rows().forEach((cb) => cb.addEventListener("change", syncMaster));
    syncMaster();
  }
})();
