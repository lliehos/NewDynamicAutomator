/**
 * Shared extension UI strings (fa/en). Culture synced from portal `da_culture` → chrome.storage.uiCulture.
 */
(function (global) {
  const STRINGS = {
    fa: {
      "rec.title": "ضبط — مروبات",
      "rec.panel": "پنل ضبط",
      "rec.resize": "تغییر اندازه",
      "rec.stop": "توقف",
      "rec.save": "ذخیره",
      "rec.resume": "ادامه ضبط",
      "rec.end": "بستن ضبط و تب",
      "rec.trackInputClicks": "ترک کلیک در فیلد ورودی",
      "rec.trackMouse": "ترک عملیات موس",
      "rec.logHead": "لاگ ضبط",
      "rec.reviewHead": "انتخاب برای ذخیره",
      "rec.items": "{n} مورد",
      "rec.logEmpty": "هنوز عملیاتی ترک نشده",
      "rec.reviewEmpty": "موردی برای ذخیره نیست",
      "rec.recordingMeta": "در حال ضبط — {n} مورد",
      "rec.reviewMeta": "بازبینی — {n} مورد",
      "rec.statusReview": "موارد را انتخاب کنید و ذخیره بزنید — یا ادامه / پایان جلسه",
      "rec.saved": "ذخیره شد — گروه #{n} · می‌توانید ادامه دهید",
      "rec.saveError": "خطا در ذخیره",
      "rec.groupTitlePrompt": "نام گروه ضبط را وارد کنید",
      "rec.groupTitleDefault": "گروه ضبط",
      "rec.groupTitleRequired": "نام گروه لازم است",
      "rec.idleHint": "ضبط را از لیست فرآیندها در پورتال شروع کنید. فرآیند از قبل مشخص است.",
      "rec.refresh": "تازه‌سازی",
      "rec.popupSave": "ذخیره در گروه",
      "rec.popupResume": "ادامه ضبط (بدون ذخیره)",
      "rec.reviewHint": "موارد را انتخاب کنید، سپس ذخیره کنید. بعد می‌توانید ضبط را ادامه دهید.",
      "rec.process": "فرآیند #{id}",
      "rec.fallbackTitle": "ضبط",
      "play.title": "اجرا — مروبات",
      "play.panel": "پنل اجرا",
      "play.resize": "تغییر اندازه",
      "play.play": "اجرا",
      "play.pause": "پاز",
      "play.resume": "ادامه",
      "play.stop": "توقف (از اول)",
      "play.clear": "پاکسازی لاگ‌ها",
      "play.refresh": "تازه‌سازی",
      "play.noProcess": "فرآیندی برای اجرا نیست — از پورتال اجرا کنید.",
      "play.startError": "خطا در شروع",
      "play.pausedHint": "پاز — اجرا=ادامه از همین‌جا · توقف=قطع و شروع از اول",
      "play.runningHint": "در حال اجرا — پاز یا توقف",
      "play.readyRestart": "آماده · v{ver} · {user} — اجرا از اول",
      "play.readyIdle": "اجرا v{ver} · {user}",
      "play.loop": "حلقه {i} / {total}",
      "play.step": "مرحله {i} / {total}",
      "play.loopShort": "حلقه {i}/{total}",
      "play.stepShort": "مرحله {i}/{total}",
      "play.noResults": "هنوز نتیجه‌ای ثبت نشده",
      "play.noLogs": "لاگی نیست",
      "play.endedError": "پایان با خطا",
      "play.ended": "پایان · {loop} · {step}",
      "play.readyStart": "آماده شروع",
      "play.fallbackTitle": "اجرا",
      "play.process": "فرآیند #{id}",
      "play.popupHint": "اجرا بعد از پاز = ادامه · توقف سپس اجرا = از اول. اولین اجرا را از پورتال بزنید.",
      "play.checking": "در حال بررسی..."
    },
    en: {
      "rec.title": "Record — Morobot",
      "rec.panel": "Record panel",
      "rec.resize": "Resize",
      "rec.stop": "Stop",
      "rec.save": "Save",
      "rec.resume": "Continue recording",
      "rec.end": "Close recording & tab",
      "rec.trackInputClicks": "Track clicks in input fields",
      "rec.trackMouse": "Track mouse actions",
      "rec.logHead": "Record log",
      "rec.reviewHead": "Select to save",
      "rec.items": "{n} items",
      "rec.logEmpty": "No actions tracked yet",
      "rec.reviewEmpty": "Nothing to save",
      "rec.recordingMeta": "Recording — {n} items",
      "rec.reviewMeta": "Review — {n} items",
      "rec.statusReview": "Select items and save — or continue / end session",
      "rec.saved": "Saved — group #{n} · you can continue",
      "rec.saveError": "Save failed",
      "rec.groupTitlePrompt": "Enter a name for the recorded group",
      "rec.groupTitleDefault": "Recorded group",
      "rec.groupTitleRequired": "Group name is required",
      "rec.idleHint": "Start recording from the process list in the portal. The process is already selected.",
      "rec.refresh": "Refresh",
      "rec.popupSave": "Save to group",
      "rec.popupResume": "Continue without saving",
      "rec.reviewHint": "Select items, then save. You can record again afterward.",
      "rec.process": "Process #{id}",
      "rec.fallbackTitle": "Record",
      "play.title": "Play — Morobot",
      "play.panel": "Play panel",
      "play.resize": "Resize",
      "play.play": "Play",
      "play.pause": "Pause",
      "play.resume": "Resume",
      "play.stop": "Stop (from start)",
      "play.clear": "Clear logs",
      "play.refresh": "Refresh",
      "play.noProcess": "No process to run — start from the portal.",
      "play.startError": "Failed to start",
      "play.pausedHint": "Paused — Play=resume here · Stop=abort and restart",
      "play.runningHint": "Running — pause or stop",
      "play.readyRestart": "Ready · v{ver} · {user} — play from start",
      "play.readyIdle": "Play v{ver} · {user}",
      "play.loop": "Loop {i} / {total}",
      "play.step": "Step {i} / {total}",
      "play.loopShort": "Loop {i}/{total}",
      "play.stepShort": "Step {i}/{total}",
      "play.noResults": "No results yet",
      "play.noLogs": "No logs",
      "play.endedError": "Ended with error",
      "play.ended": "Done · {loop} · {step}",
      "play.readyStart": "Ready to start",
      "play.fallbackTitle": "Play",
      "play.process": "Process #{id}",
      "play.popupHint": "Play after pause = resume · Stop then Play = from start. First run from the portal.",
      "play.checking": "Checking..."
    }
  };

  let culture = "fa";
  const listeners = new Set();

  function normalize(c) {
    c = String(c || "").toLowerCase();
    return c === "en" ? "en" : "fa";
  }

  function t(key, vars) {
    const pack = STRINGS[culture] || STRINGS.fa;
    let text = pack[key] ?? STRINGS.fa[key] ?? key;
    if (vars && typeof vars === "object") {
      Object.keys(vars).forEach((k) => {
        text = text.replace(new RegExp("\\{" + k + "\\}", "g"), vars[k] == null ? "" : String(vars[k]));
      });
    }
    return text;
  }

  function dir() {
    return culture === "en" ? "ltr" : "rtl";
  }

  function getCulture() {
    return culture;
  }

  function setCulture(next) {
    const n = normalize(next);
    if (n === culture) return;
    culture = n;
    listeners.forEach((fn) => {
      try { fn(culture); } catch { /* ignore */ }
    });
  }

  function onChange(fn) {
    if (typeof fn === "function") listeners.add(fn);
    return () => listeners.delete(fn);
  }

  function applyRoot(el) {
    if (!el) return;
    el.setAttribute("dir", dir());
    el.setAttribute("lang", culture);
  }

  async function init() {
    try {
      const data = await chrome.storage.local.get("uiCulture");
      culture = normalize(data.uiCulture);
    } catch {
      culture = "fa";
    }
    try {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== "local" || !changes.uiCulture) return;
        setCulture(changes.uiCulture.newValue);
      });
    } catch { /* ignore */ }
    return culture;
  }

  global.DaExtI18n = { t, init, getCulture, setCulture, dir, applyRoot, onChange, normalize };
})(typeof globalThis !== "undefined" ? globalThis : window);
