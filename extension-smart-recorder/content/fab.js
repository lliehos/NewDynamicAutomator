/** Smart Recorder FAB — only when a smart session is active (injected by background). */
(async function initSmartFab() {
  if (window !== window.top) return;
  if (window.__daSmartFabInit || document.getElementById("da-smart-fab")) return;

  try {
    const { portalBase } = await chrome.storage.local.get("portalBase");
    const base = String(portalBase || "https://localhost:7201").replace(/\/$/, "");
    if (base && location.href.startsWith(base)) return;
  } catch { /* continue */ }

  // Do not mount on ordinary play/record pages — only during an active smart session.
  const boot = await chrome.runtime.sendMessage({ type: "getSmartState" }).catch(() => ({}));
  if (!boot?.active && !boot?.learningComplete) return;

  window.__daSmartFabInit = true;

  const markUrl = chrome.runtime.getURL("icons/mark.svg");
  const root = document.createElement("div");
  root.className = "da-smart-root";
  root.id = "da-smart-fab";
  root.hidden = true;
  root.innerHTML = `
    <button type="button" class="da-smart-save" id="da-smart-save" title="Save" aria-label="Save" hidden>
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M17 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V7l-4-4zm-5 16a3 3 0 1 1 0-6 3 3 0 0 1 0 6zm3-10H5V5h10v4z"/></svg>
    </button>
    <button type="button" class="da-smart-logo-btn" id="da-smart-toggle" title="Stop thinking" aria-label="Stop thinking">
      <img src="${markUrl}" width="56" height="56" alt="Morobot" />
    </button>
  `;
  document.documentElement.appendChild(root);
  Object.assign(root.style, {
    position: "fixed", left: "18px", right: "auto", bottom: "18px", top: "auto",
    zIndex: "2147483647"
  });

  const logoBtn = root.querySelector("#da-smart-toggle");
  const saveBtn = root.querySelector("#da-smart-save");

  async function refresh() {
    const state = await chrome.runtime.sendMessage({ type: "getSmartState" }).catch(() => ({}));
    const active = !!state.active;
    const learningComplete = !!state.learningComplete;
    root.hidden = !active && !learningComplete;
    logoBtn.classList.toggle("thinking", active && !learningComplete);
    logoBtn.classList.toggle("save-ready", learningComplete);
    logoBtn.title = learningComplete ? "Learning complete" : "Stop thinking";
    logoBtn.setAttribute("aria-label", logoBtn.title);
    if (learningComplete) {
      saveBtn.hidden = false;
      saveBtn.classList.add("show");
    } else {
      saveBtn.hidden = true;
      saveBtn.classList.remove("show");
    }
  }

  logoBtn.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    await chrome.runtime.sendMessage({ type: "stopSmartThinking" }).catch(() => {});
    await refresh();
  });

  saveBtn.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    await chrome.runtime.sendMessage({ type: "saveSmartResult" }).catch(() => {});
    await refresh();
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "smartStateChanged") refresh();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && (changes.smartActive || changes.smartLearningComplete || changes.smartSessionId)) {
      refresh();
    }
  });

  refresh();
})();
