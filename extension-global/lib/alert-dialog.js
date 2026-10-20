/**
 * Browser dialog handling for the AlertAccept action.
 *
 * WHY THIS IS NOT IN THE PLAYER'S INJECTED CODE
 * A JavaScript dialog (`alert`, `confirm`, `prompt`) blocks the page's own script the moment it
 * opens. By the time any injected script could run, the dialog is already up and the page is
 * frozen — only the browser can dismiss it. So the Player cannot answer a dialog from inside the
 * page; the extension has to do it, through `chrome.webNavigation` + `chrome.debugger`-free
 * `Page.javascriptDialogOpening`-style handling. The mechanism actually available to a normal MV3
 * extension is `chrome.webNavigation` for the event, plus `chrome.scripting` to pre-arm the page:
 * the page overrides `window.alert` / `confirm` / `prompt` so the call never reaches the native
 * dialog at all, records what was asked, and answers with the step's chosen response.
 *
 * That override is what this module installs. It is deliberately scoped and temporary:
 *   - armed only for the tab a run is executing in, never globally
 *   - armed only while a run is active, so it cannot affect normal browsing
 *   - removed when the run stops, so the page returns to its own behaviour
 *
 * The trade-off is stated plainly: overriding `window.confirm` means the page receives a boolean
 * immediately instead of blocking. That is what an automated run wants (nothing may block it), but
 * it does mean a dialog the author did NOT expect is auto-answered rather than shown. The step's
 * type field decides the answer, so the behaviour is always the one the diagram asked for.
 */

/** Tab id → the answer the armed page should give. */
const alertArming = new Map();

/**
 * Install the dialog override in one tab.
 *
 * @param {number} tabId       the tab the run executes in
 * @param {"accept"|"dismiss"} type  which way to answer
 */
async function armAlertDialog(tabId, type) {
  const mode = String(type || "Accept") === "Dismiss" ? "Dismiss"
    : String(type || "Accept") === "Prompt" ? "Prompt" : "Accept";
  alertArming.set(Number(tabId), mode);
  try {
    await chrome.scripting.executeScript({
      target: { tabId: Number(tabId) },
      // `world: "MAIN"` is required: the page's own scripts call window.alert through the page's
      // own window object. An isolated-world override would only intercept calls made by our code,
      // which is exactly the calls that do not exist — the page would keep showing real dialogs.
      world: "MAIN",
      func: (defaultMode) => {
        if (window.__daDialogArmed) return;
        window.__daDialogArmed = true;
        // Keep the originals so disarming can genuinely put the page back, not just stop answering.
        window.__daRealDialogs = {
          alert: window.alert,
          confirm: window.confirm,
          prompt: window.prompt
        };
        // One shared record of the last dialog, so the Player can report what it answered.
        window.__daLastDialog = null;
        window.__daAlertMode = defaultMode;
        window.__daAlertPromptText = "";

        window.alert = function (message) {
          window.__daLastDialog = { kind: "alert", message: String(message ?? ""), t: Date.now() };
          return undefined;
        };
        window.confirm = function (message) {
          window.__daLastDialog = { kind: "confirm", message: String(message ?? ""), t: Date.now() };
          return window.__daAlertMode !== "Dismiss";
        };
        window.prompt = function (message, defaultValue) {
          window.__daLastDialog = { kind: "prompt", message: String(message ?? ""), t: Date.now() };
          // A dismissed prompt yields null, which is what the browser itself returns on Cancel.
          if (window.__daAlertMode === "Dismiss") return null;
          // "Prompt" mode types the author's text; otherwise the page's own default stands.
          return window.__daAlertMode === "Prompt"
            ? String(window.__daAlertPromptText ?? "")
            : (defaultValue == null ? "" : String(defaultValue));
        };

        // Exposed so the Player can (a) set the answer per step and (b) report what was answered.
        window.__daDialogSetAnswer = (mode, text) => {
          window.__daAlertMode = mode;
          window.__daAlertPromptText = text == null ? "" : String(text);
        };
        window.__daDialogTake = () => {
          const seen = window.__daLastDialog;
          window.__daLastDialog = null;
          return seen;
        };
        // Report that arming actually succeeded, so a failure is visible rather than silent.
        window.__daDialogArmedReal = true;
      },
      args: [mode]
    });
    return { ok: true };
  } catch (err) {
    // A chrome:// page, a PDF viewer, or a discarded tab cannot take a MAIN-world script. The
    // caller turns this into a step error rather than pretending the dialog was handled.
    alertArming.delete(Number(tabId));
    return { ok: false, error: err?.message || String(err) };
  }
}

/** Tell an armed page which way to answer the next dialog, and what to type into a prompt. */
async function setAlertAnswer(tabId, type, promptText) {
  const mode = String(type || "Accept") === "Dismiss" ? "Dismiss"
    : String(type || "Accept") === "Prompt" ? "Prompt" : "Accept";
  alertArming.set(Number(tabId), mode);
  try {
    await chrome.scripting.executeScript({
      target: { tabId: Number(tabId) },
      world: "MAIN",
      func: (m, text) => {
        if (typeof window.__daDialogSetAnswer === "function") window.__daDialogSetAnswer(m, text);
      },
      args: [mode, promptText == null ? "" : String(promptText)]
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
}

/** Read (and clear) what the armed page last answered, so the Player can report it. */
async function readAlertResult(tabId) {
  try {
    const [{ result } = {}] = await chrome.scripting.executeScript({
      target: { tabId: Number(tabId) },
      world: "MAIN",
      func: () => {
        if (!window.__daDialogArmed) return { armed: false };
        const seen = typeof window.__daDialogTake === "function" ? window.__daDialogTake() : null;
        return { armed: true, dialog: seen };
      }
    });
    return result || { armed: false };
  } catch (err) {
    return { armed: false, error: err?.message || String(err) };
  }
}

/**
 * Remove the override and hand `window` back to the page.
 * Best-effort: the tab may be gone, or have navigated (in which case the override went with the
 * old document and there is nothing to restore).
 */
async function disarmAlertDialog(tabId) {
  alertArming.delete(Number(tabId));
  try {
    await chrome.scripting.executeScript({
      target: { tabId: Number(tabId) },
      world: "MAIN",
      func: () => {
        if (!window.__daDialogArmed) return;
        // Genuinely restore the originals, so a page left armed does not keep silently swallowing
        // dialogs after the run ends. Without this the override would outlive the run and a later
        // dialog the author expected to SEE would be answered behind their back.
        const real = window.__daRealDialogs;
        if (real) {
          window.alert = real.alert;
          window.confirm = real.confirm;
          window.prompt = real.prompt;
        }
        delete window.__daDialogArmed;
        delete window.__daDialogArmedReal;
        delete window.__daDialogSetAnswer;
        delete window.__daDialogTake;
        delete window.__daAlertMode;
        delete window.__daAlertPromptText;
        delete window.__daLastDialog;
        delete window.__daRealDialogs;
        window.__daDialogDisarmed = true;
      }
    });
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

/** Drop all arming state — used on stop, extension reload and tab close. */
function clearAllAlertArming() {
  alertArming.clear();
}

globalThis.WebautomatorAlerts = {
  armAlertDialog,
  setAlertAnswer,
  readAlertResult,
  disarmAlertDialog,
  clearAllAlertArming
};
