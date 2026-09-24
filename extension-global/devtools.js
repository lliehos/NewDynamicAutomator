/** Registers Elements sidebar — Chrome cannot inject into native Copy > selector/XPath menu. */
chrome.devtools.panels.elements.createSidebarPane("مروبات سلکتور", (sidebar) => {
  sidebar.setPage("devtools-sidebar.html");
  sidebar.setHeight("22em");
});
