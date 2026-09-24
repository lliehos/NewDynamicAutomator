/** Registers Elements sidebar — title follows tenant branding when set. */
(async () => {
  let label = "مروبات سلکتور";
  try {
    const { tenantBranding: b } = await chrome.storage.local.get("tenantBranding");
    if (b?.appName) label = `${b.appName} — Selector`;
  } catch { /* ignore */ }
  chrome.devtools.panels.elements.createSidebarPane(label, (sidebar) => {
    sidebar.setPage("devtools-sidebar.html");
    sidebar.setHeight("22em");
  });
})();
