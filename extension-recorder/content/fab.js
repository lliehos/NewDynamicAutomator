/** Recorder FAB — record / review only (no play). */
(async function initFab() {
  if (window !== window.top) return;
  if (window.__daFabInit || document.getElementById("da-recorder-fab")) return;
  window.__daFabInit = true;

  try {
    const { portalBase } = await chrome.storage.local.get("portalBase");
    const base = String(portalBase || "https://localhost:7201").replace(/\/$/, "");
    if (base && location.href.startsWith(base)) {
      window.__daFabInit = false;
      return;
    }
  } catch {
    /* continue */
  }

  const root = document.createElement("div");
  root.className = "da-recorder-root";
  root.id = "da-recorder-fab";
  root.innerHTML = `
    <div class="da-fab-panel" id="da-fab-panel" hidden>
      <div class="da-fab-status" id="da-fab-status">...</div>
      <div id="da-fab-idle">
        <div class="da-fab-section">ضبط</div>
        <p class="da-fab-hint">همیشه در تب جدید خالی شروع می‌شود؛ آدرس را خودتان باز کنید.</p>
        <button type="button" id="da-fab-record" class="da-fab-rec">شروع ضبط</button>
      </div>
      <div id="da-fab-recording" hidden>
        <div class="da-fab-section">در حال ضبط</div>
        <p class="da-fab-hint">هر کلیک/ورودی و تغییر آدرس موقتاً ذخیره می‌شود.</p>
        <button type="button" id="da-fab-finish" class="da-fab-stop">اتمام ضبط</button>
      </div>
      <div id="da-fab-review" hidden>
        <div class="da-fab-section">اتمام ضبط</div>
        <p class="da-fab-hint" id="da-fab-review-count">۰ اکشن آماده است.</p>
        <input type="text" id="da-fab-title" class="da-fab-select" placeholder="عنوان فرآیند" value="فرآیند ضبط‌شده" />
        <button type="button" id="da-fab-upload" class="da-fab-play">ذخیره محلی</button>
        <button type="button" id="da-fab-rerecord" class="da-fab-rec">ضبط مجدد</button>
        <button type="button" id="da-fab-discard">انصراف</button>
      </div>
    </div>
    <button type="button" class="da-fab-btn" id="da-fab-toggle" title="ضبط">REC</button>
  `;
  document.documentElement.appendChild(root);
  Object.assign(root.style, {
    position: "fixed", left: "18px", right: "auto", bottom: "18px", top: "auto",
    zIndex: "2147483647", alignItems: "flex-start"
  });

  const panel = root.querySelector("#da-fab-panel");
  const status = root.querySelector("#da-fab-status");
  const idleBox = root.querySelector("#da-fab-idle");
  const recBox = root.querySelector("#da-fab-recording");
  const reviewBox = root.querySelector("#da-fab-review");
  const recordBtn = root.querySelector("#da-fab-record");
  const finishBtn = root.querySelector("#da-fab-finish");
  const uploadBtn = root.querySelector("#da-fab-upload");
  const rerecordBtn = root.querySelector("#da-fab-rerecord");
  const discardBtn = root.querySelector("#da-fab-discard");
  const toggleBtn = root.querySelector("#da-fab-toggle");
  const titleInp = root.querySelector("#da-fab-title");
  const reviewCount = root.querySelector("#da-fab-review-count");

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "recordingChanged" || message.type === "draftUpdated") refresh();
  });

  toggleBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    panel.hidden = !panel.hidden;
    refresh();
  });

  recordBtn.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const res = await chrome.runtime.sendMessage({ type: "startRecordSession" });
    status.textContent = res?.ok ? "تب خالی باز شد — آدرس را تایپ کنید" : (res?.error || "خطا در شروع ضبط");
    panel.hidden = false;
    await refresh();
  });

  finishBtn.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    await chrome.runtime.sendMessage({ type: "finishRecord" });
    await refresh();
  });

  uploadBtn.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const title = (titleInp?.value || "").trim() || "فرآیند ضبط‌شده";
    const res = await chrome.runtime.sendMessage({ type: "saveDraft", payload: { newTaskTitle: title } });
    status.textContent = res?.ok ? `ذخیره شد — #${res.result?.taskId}` : (res?.error || "خطا");
    await refresh();
  });

  rerecordBtn.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    await chrome.runtime.sendMessage({ type: "rerecord" });
    await refresh();
  });

  discardBtn.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    await chrome.runtime.sendMessage({ type: "discardRecord" });
    await refresh();
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && (changes.draft || changes.recording || changes.recordPhase)) refresh();
  });

  async function refresh() {
    const state = await chrome.runtime.sendMessage({ type: "getState" }).catch(() => ({
      recordPhase: "idle", count: 0
    }));
    const session = await chrome.runtime.sendMessage({ type: "session" }).catch(() => ({
      userName: "test", version: "?"
    }));
    const phase = state.recordPhase || "idle";
    const user = session?.userName || "test";
    const ver = session?.version || chrome.runtime.getManifest().version;

    idleBox.hidden = true;
    recBox.hidden = true;
    reviewBox.hidden = true;
    toggleBtn.classList.remove("recording");
    toggleBtn.hidden = false;

    if (phase === "recording") {
      recBox.hidden = false;
      toggleBtn.classList.add("recording");
      toggleBtn.textContent = "REC●";
      panel.hidden = false;
      status.textContent = `در حال ضبط — ${state.count || 0} اکشن (موقت)`;
    } else if (phase === "review") {
      reviewBox.hidden = false;
      toggleBtn.textContent = "✓";
      panel.hidden = false;
      if (reviewCount) reviewCount.textContent = `${state.count || 0} اکشن آماده ذخیره است.`;
      status.textContent = `ضبط تمام شد — ${state.count || 0} اکشن`;
    } else {
      idleBox.hidden = false;
      toggleBtn.textContent = "REC";
      status.textContent = `ضبط v${ver} · ${user}`;
    }
  }

  refresh();
})();
