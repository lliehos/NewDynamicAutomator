# منطق افزونهٔ اجرا (Play Engine) — مستند رفتار واقعی کد

> **نسخه سند:** 1.1 · **آخرین‌به‌روزرسانی:** 2026-09-25
> مرجع: `extension-global/player/engine.js` (تنها فایل موتور، ~۳۸۰۰ خط) و `extension-global/background.js`
> هدف: ثبت **آنچه کد واقعاً انجام می‌دهد** (نه آنچه انتظار می‌رود) تا ایرادها را بتوان دقیق نشان داد.

---

## فهرست

1. [معماری و نقطهٔ ورود](#1-معماری-و-نقطهٔ-ورود)
2. [شروع اجرا (`startPlay`)](#2-شروع-اجرا-startplay)
3. [تکرار فرآیند (`resolveProcessIterations`)](#3-تکرار-فرآیند-resolveprocessiterations)
4. [حلقهٔ اصلی (`runPlayLoop`)](#4-حلقهٔ-اصلی-runplayloop)
5. [پیمایش دیاگرام (`executeFlow`)](#5-پیمایش-دیاگرام-executeflow)
6. [اجرای یک اقدام (`runOneAction`)](#6-اجرای-یک-اقدام-runoneaction)
7. [سیاست خطا — دو سوئیچ مستقل](#7-سیاست-خطا--دو-سوئیچ-مستقل)
8. [زمان‌بندی و مکث‌ها](#8-زمانبندی-و-مکثها)
9. [ارزیابی شرط‌ها (`evaluateCondition`)](#9-ارزیابی-شرطها-evaluatecondition)
10. [اجرا داخل صفحه (`playExecuteInjected`)](#10-اجرا-داخل-صفحه-playexecuteinjected)
11. [سلکتور، فریم و حافظه](#11-سلکتور-فریم-و-حافظه)
12. [منبع داده و نوشتن سلول](#12-منبع-داده-و-نوشتن-سلول)
13. [توقف، پاز و واچ لغو](#13-توقف-پاز-و-واچ-لغو)
14. [ایرادهای مشکوک (فهرست بازبینی)](#14-ایرادهای-مشکوک-فهرست-بازبینی)

---

## 1. معماری و نقطهٔ ورود

```
manifest.json (MV3) → background.service_worker = background.js
background.js خط ۱:  importScripts("lib/branding.js", "player/engine.js", "bg-selector.js")
```

**نکتهٔ کلیدی:** تمام حلقهٔ اجرا **داخل service worker** اجرا می‌شود. تنها `setInterval` موجود در
`background.js` مربوط به `pollDevReload` است — **هیچ keepalive، offscreen document یا alarm** برای
زنده نگه‌داشتن اجرا وجود ندارد.

### نقطه‌های ورود

| مسیر | فایل | نتیجه |
|------|------|--------|
| دکمهٔ FAB روی صفحه | `content/fab-play.js:400` | `{type:"startPlay"}` |
| پورتال/ویرایشگر | `content/portal-ui.js:254` | `{type:"startPlay"}` |
| روتینگ | `background.js:198` | `startPlayWithAutoReload` |
| آماده‌سازی | `background.js:1590` | ممکن است `chrome.runtime.reload()` بزند |
| اجرای واقعی | `engine.js:1091` | `startPlay` |

### `startPlayWithAutoReload` (background.js:1590)

- `openNewTab` فقط وقتی روشن می‌شود که تب صریح نداشته باشیم و بررسی شرط نباشد.
- اگر «مهر نسخهٔ افزونه» (`playerDevStamp`) عوض شده باشد: درخواست در `pendingPlayRequest` ذخیره و
  **افزونه reload می‌شود**؛ پس از برگشت با فلگ `resumePlayAfterReload` اجرا از سر گرفته می‌شود.
- در حالت `conditionNodeId` هرگز reload نمی‌زند.

---

## 2. شروع اجرا (`startPlay`)

ترتیب کارها (خطوط 1091–1296):

1. **قفل اجرای همزمان:** اگر `playStatus.playing` باشد:
   - با `conditionNodeId` → اجرای قبلی **به‌زور متوقف** می‌شود (`playAbort=true`) و ۴۰ms صبر می‌شود.
   - در غیر این صورت → خطا: «پخش در حال اجراست.»
2. `checkSession()` — بررسی نشست پورتال.
3. اگر `recording` روشن باشد → خطا: «ابتدا ضبط را متوقف کنید.»
4. **بارگذاری گراف** از `chrome.storage.local` (کلیدهای tasks کاربر). اگر پیدا نشد، ۱۲۰ms صبر و
   **یک بار** تلاش مجدد. در غیر این صورت:
   خطا: «فرآیند در حافظهٔ محلی پیدا نشد. صفحهٔ فرآیندها را رفرش کنید و دوباره اجرا بزنید.»
   → یعنی گراف **هرگز** در لحظهٔ اجرا از سرور خوانده نمی‌شود؛ فقط از storage محلی.
5. **اعتبارسنجی:** `buildInvalidNodesError(graph)` — اگر **هر** نودی نامعتبر باشد، اجرا **قبل از شروع**
   رد می‌شود و فهرست نودهای مشکل‌دار برگردانده می‌شود.
6. **نقطهٔ ورود** (`resolvePlayEntryId`):
   `stepNodeId` → نود شروع همان گروه (`groupNodeId`) → نود شروع فرآیند (ریشه).
7. **برآورد مراحل:** `collectPlaySteps(graph)` — فقط برای نمایش «~N اقدام» در HUD (مسیر موفق).
8. **دامنهٔ اجرا** (`playScope`): `condition` → `step` → `group` → `task`.
9. **تب اجرا** (`resolveExecutionTabId`، خط 979):
   - `openNewTab` → `chrome.tabs.create({url:"about:blank"})` + فوکوس پنجره.
   - `tabId` صریح → همان تب (بدون فیلتر سخت‌گیرانه).
   - بدون تب صریح → تب فعال جاری اگر `isReusablePlayTab` باشد؛ وگرنه `null`.
   - بررسی شرط: `activateTab=false` (تب فوکوس نمی‌شود).
   - تب `chrome://newtab` → به `about:blank` تبدیل می‌شود (نیوتب اجازهٔ content script نمی‌دهد).
   - اگر تب پیدا نشد و شرط به تب نیاز **نداشته** باشد (`SourceValue`/`DriverTabs`) → `tabId=null`.
10. **حافظه:** `ensurePlayMemory(graph)` — اگر ساختار حافظه عوض شده باشد، پاک می‌شود.
11. ذخیرهٔ `lastPlayRequest` در storage (برای نمایش/بازیابی).
12. **تعیین تکرار:** اگر دامنه محدود باشد (group/step/condition) →
    همیشه `{type:"None", indices:[0], total:1}` — یعنی **فرآیند تکرار نمی‌شود**؛
    فقط در دامنهٔ `task` مقدار `resolveProcessIterations` محاسبه می‌شود.
13. ساخت `playStatus` (شامل `logs` و **`results` قبلی** — پاک نمی‌شوند).
14. `startPlayAbortWatch` + تزریق FAB (به‌جز دامنهٔ `condition`).
15. **`runPlayLoop(...)` بدون `await`** اجرا می‌شود؛ `.catch` فقط `lastError` را ست می‌کند.

**لاگ‌های شروع:** نوع تکرار، فاصلهٔ بین مراحل، وضعیت چشم‌پوشی از خطای اجرا، و نقطهٔ ورود.

---

## 3. تکرار فرآیند (`resolveProcessIterations`)

منبع: `start.repeatSourceType` یا `graph.repeatSourceType` یا `"None"`.

| نوع | تعداد | یادداشت |
|-----|-------|---------|
| `Loops` | `loopCount ?? graph.loopCount ?? graph.constantValue` (حداقل ۱) | — |
| `DataSource` | `ds.rowCount`؛ اگر ۰ بود تعداد اندیس‌های یکتای سلول‌ها؛ اگر باز ۰ → **یک‌بار** + هشدار «منبع پیش‌فرض ردیفی ندارد» | `rowCount` **یک‌بار در شروع** خوانده می‌شود |
| `None` | ۱ | «یک‌بار» |

---

## 4. حلقهٔ اصلی (`runPlayLoop`)

برای هر اندیس `li`:

```
──── حلقه li+1 / total (اندیس rowIndex) ────
```

سپس دو مسیر:

### الف) دامنهٔ تک‌نودی (`scopedSingle`)

وقتی `playScope` یکی از `step`/`condition` باشد یا `stepNodeId`/`conditionNodeId` داده شده باشد:

- **شرط:** `Promise.race(evaluateCondition, sleep(max(5000, waitBudget+4000)))`
  - اتمام مهلت → `pass=false` + هشدار «مهلت بررسی شرط ... تمام شد».
  - هر exception → `pass=false`.
  - سیگنال جدا: `notifyPortalTabs({type:"conditionCheckResult", pass, nodeId, checkId})`.
  - **هیچ یالی دنبال نمی‌شود.**
- **اقدام:** فقط `runOneAction` روی همان نود؛ **پس از آن یال بعدی دنبال نمی‌شود.**

### ب) مسیر عادی

`executeFlow(entryId, …)` — و اگر `stepFailed` برگشت، `handleStepFailureForLoop`.

### پایان (`finally`)

`playing=false`، `paused=false`، `currentNodeId=null`، پاک‌کردن polling لغو،
`unregisterPlayOnServer`، ذخیرهٔ storage، `broadcastPlayState()`.

> **نکته:** `logs` و `results` بین اجراها **پاک نمی‌شوند**؛ فقط سقف ۸۰ تایی دارند.
> اجرای جدید با خط `──────── اجرای جدید ────────` از قبلی جدا می‌شود.

---

## 5. پیمایش دیاگرام (`executeFlow`)

```js
while (cur && !playAbort && !playStatus.lastError && guard++ < 500) { ... }
```

**محدودیت ساختاری:**

1. **شمارندهٔ بازدید (`visitCounts`):** بازگشت به نود قبلی **مجاز** است (حلقه پشتیبانی می‌شود)،
   ولی هر نود سقف بازدید دارد — `resolveLoopBackLimit`، پیش‌فرض **۱۰۰** و قابل تنظیم از
   نود شروع («حداکثر بازگشت حلقه»). با رد شدن سقف، اجرا با نام آن نود متوقف می‌شود.
2. **`guard < 100000`:** سقف ایمنی برای پیمایش‌های غیرمنتظره؛ در صورت رد شدن، هیچ خطایی
   ثبت نمی‌شود (باید اصلاح شود — ایراد شمارهٔ ۳ زیر).

### رفتار به‌ازای نوع نود

| نود | رفتار |
|-----|--------|
| `start` | یال `next`. **هیچ مکثی بعد از start اعمال نمی‌شود.** |
| action | `stepOrdinal++` → `runOneAction` → یال `next` → `delayAfterNode` |
| `condition` | ارزیابی (exception → false) → لاگ + نتیجه → یال `success` یا `fail` |
| `group` | ورودی گروه → بسط تکرار → حلقهٔ درونی (بازگشتی) → یال `next` |
| ناشناخته | هشدار + `break` |

### یال شرط — نکتهٔ مهم

```js
const e = flowEdge(edges, cur, pass ? ["success", "next"] : ["fail", "next"]);
```

اگر یال `success`/`fail` وصل نباشد، **به یال `next` سقوط می‌کند**. بنابراین شرطی که فقط
شاخهٔ `success` آن سیم‌کشی شده، در حالت **ناموفق** هم همان مسیر موفق را اجرا می‌کند.

### حلقه (بازگشت به نود قبلی)

الگوی «تا وقتی شرط برقرار نشه گیر کن» با یک یال بازگشتی ساخته می‌شود:

```
شرط ──fail──> مرحله ──next──> همان شرط     ← تکرار تا برقرار شدن شرط
شرط ──success──> مرحله بعدی               ← شاخهٔ موفق
```

رفتار موتور:

| جنبه | رفتار |
|------|--------|
| بازگشت به نود قبلی | **مجاز** — شمارندهٔ بازدید بالا می‌رود و شرط دوباره ارزیابی می‌شود |
| سقف بازگشت | `loopBackLimit` روی نود شروع، پیش‌فرض **۱۰۰**، بازهٔ مجاز ۱..۱۰۰۰ |
| رد شدن سقف | توقف با پیام «… بیش از N بار اجرا شد و شرط خروج آن برقرار نشد» + نام نود |
| مکث هر بازگشت | حداقل **۵۰۰ms** (اگر «فاصله بین مراحل» بیشتر باشد، همان اعمال می‌شود) |
| لاگ هر بازگشت | `↩ بازگشت به «<عنوان>» — تکرار k از حداکثر N` |
| قابل توقف؟ | بله — `playAbort`/`pause` در هر تکرار بررسی می‌شود |

> **نتیجهٔ ضمنی:** نودی که از دو شاخه به آن می‌رسیم (join الماسی) اکنون **دو بار** اجرا می‌شود.
> این رفتار درست یک join است، ولی با نسخهٔ قبلی متفاوت است.

### گروه

```
innerEntry = نود شروع همان گروه || یال "contains" || findGroupEntryFallback
groupIters = expandGroupByRepeatSource(gStart || node)
moveLoop   = gStart?.moveLoop !== false && node.moveLoop !== false
effectiveRow = moveLoop ? gRow : parentRow
```

- تکرار گروه از تنظیمات **نود شروع همان گروه** خوانده می‌شود (`None`/`Loops`/`DataSource`/`Elements`).
- `Elements`: با `querySelectorAll` تعداد المان شمرده می‌شود؛ صفر → یک‌بار + هشدار.
- شکست یک مرحله در درون گروه، **کل تکرار جاری فرآیند** را خاتمه می‌دهد (به بالا منتقل می‌شود).
- گروه‌های تودرتو هرکدام بسط تکرار **خودشان** را دارند.

---

## 6. اجرای یک اقدام (`runOneAction`)

1. `waitIfPaused()` و بررسی `playAbort`.
2. **`step.isActive === false`** → نتیجه «غیرفعال — اجرا نشد» و بازگشت موفق (`skipped`).
   این مرحله **شمارش `stepOrdinal` را بالا می‌برد** ولی کاری نمی‌کند.
3. `runStep(...)` روی تب/فریم.
4. `failed = !ok` و `ignored = failed && step.ignoreError !== false` (خط ۱۶۴۳، پیش‌فرض **true**).
5. ثبت نتیجه (`severity`: `warn` اگر ignored، وگرنه `error`).
6. اگر `memorySet` بود → `setPlayMemoryVar` + لاگ.
7. اگر شکست:
   - `ignored` → لاگ warn و بازگشت `{ok:true, ignoredError:true}` → **جریان به یال بعدی ادامه می‌دهد**.
   - `!ignored` → بازگشت `{ok:false, stepFailed:true}` → **تکرار جاری تمام می‌شود**.
8. اگر موفق:
   - تغییر تب (`outcome.tabId`) → به‌روزرسانی `playTabId` + تزریق دوبارهٔ FAB.
   - `navigated`/`GoToUrl`/`Navigate` → تزریق دوبارهٔ FAB.
   - `outcome.waitMs` (مکث `WaitTime`) → `sleepInterruptible`.

### قوانین داخلی `runStep` (خط 2193)

| اقدام | مسیر ویژه |
|-------|-----------|
| `CloseFirstTab` / `CloseLastTab` | بستن تب پنجره و انتخاب تب ادامه |
| `NewPage` | `tabs.create` + انتظار بارگذاری |
| `GoToUrl` / `Navigate` | `tabs.update` + `waitTabComplete(resolveNavigationWaitMs)` |
| `WaitTime` | فقط `waitMs` برمی‌گرداند |
| `SetMemory` | **قبل از** منطق سلکتور/فریم return می‌کند؛ نام متغیر لازم است |
| `WaitForElement` | **قبل از** بررسی موجودیت مشترک return می‌کند (بودجهٔ انتظار خودش) |
| Capture (`TakeContent`/`SaveContent`) | `runCaptureStep` |
| بقیه | پاک‌کردن هایلایت → `playExecute` → fallback با `executeInFrame` |

---

## 7. سیاست خطا — دو سوئیچ مستقل

| سطح | منبع | پیش‌فرض |
|-----|------|---------|
| هر مرحله | `step.ignoreError` (`step.ignoreError !== false`) | **چشم‌پوشی = روشن** |
| کل فرآیند | `resolveIgnorePlayError(graph)` از نود شروع ریشه | **چشم‌پوشی = روشن** |

`handleStepFailureForLoop`:

- سطح فرآیند روشن → `lastError` **پاک** می‌شود و
  «چشم‌پوشی از خطای اجرا (نود شروع روشن) — ادامه اندیس بعدی حلقه» → `continueLoop: true`.
- سطح فرآیند خاموش → `lastError` ست و اجرا متوقف.

**اثر عملی:** با پیش‌فرض‌ها، یک مرحلهٔ ناموفق **نه** تکرار را متوقف می‌کند و **نه** اجرا را؛
بلکه بی‌صدا رد می‌شود و در پایان پیام «اجرا با موفقیت تمام شد» ثبت می‌شود. این منبع اصلی
حسِ «کاری نکرد» است.

---

## 8. زمان‌بندی و مکث‌ها

| تنظیم | منبع | اعمال |
|-------|------|-------|
| فاصلهٔ بین مراحل | `resolveStepDelayMs`: نود شروع **ریشه** `stepDelayMs` → `graph.stepDelayMs` → ۰ | `delayAfterNode` **بعد از** اقدام/شرط/گروه |
| مکث `WaitTime` | `step.contentSourceType` → `resolveStepParamAsync` | `outcome.waitMs` → `sleepInterruptible` |
| انتظار ناوبری | `resolveNavigationWaitMs`: `waitForLoad===false` → ۰؛ وگرنه `waitMaxMs` یا **۱۵۰۰۰** | `GoToUrl`/`Navigate`/`NewPage` |
| انتظار المان | `selectorWaitEnabled` + `selectorWaitMs` (پیش‌فرض ۱۰۰۰) | `waitForElement` در `runStep` |
| انتظار المان (اقدام خاص) | `WaitForElement.waitMaxMs` | حلقهٔ انتظار مستقل |

**نکات:**

- `delayAfterNode(graph, nextId)` اگر `nextId` تهی باشد **هیچ مکثی** نمی‌کند → آخرین نود مکث نمی‌گیرد.
- `resolveStepDelayMs` فقط نود شروع **ریشه** را می‌خواند؛ مقدار `stepDelayMs` روی نود شروع یک
  **گروه** نادیده گرفته می‌شود (با اینکه UI فیلد را برای هر نود شروع نشان می‌دهد).
- `sleepInterruptible` هر ۲۰۰ms `playAbort`/`playPaused` را دوباره چک می‌کند.

---

## 9. ارزیابی شرط‌ها (`evaluateCondition`)

| گروه | شرط‌ها |
|------|--------|
| نیازمند مقدار مقایسه | `Url`، `ElementValue`، `SourceValue`، `FindElements`، `DriverTabs`، `SystemDate`، `SystemTime` |
| بدون مقدار مقایسه | `HasValue` / `HasNotValue` هرگز مقدار نمی‌خواهند |
| وابسته به المان | `FindElement`، `NotFindElement`، `ElementVisible`، `ElementHidden`، `FindElements`، `ElementValue` |
| وابسته به تب | موارد المان + `Url` + `DriverTabs` |

- عملگرها (`compareConditionValues`): `equal`، `Contain`، `HasValue`، `HasNotValue`،
  `BiggerThan`، `SmallerThan`.
- `resolveConditionCompareValue` در صورت خطا **`""`** برمی‌گرداند و هرگز اجرا را نمی‌شکند.
- تاریخ/زمان سیستم با `formatSystemClock` و قالب `systemClockFormat` تولید می‌شود؛ مقدار مقایسه
  باید **دقیقاً** هم‌شکل باشد (ارقام ASCII).
- `ElementVisible`/`ElementHidden` علاوه بر وجود، **مرئی‌بودن** را هم می‌خواهند
  (`requireVisible`: نه `display:none`، نه `visibility:hidden`، نه `opacity:0`، و دارای ابعاد).

---

## 10. اجرا داخل صفحه (`playExecuteInjected`)

این تابع در **صفحهٔ هدف** تزریق می‌شود. `payload` شامل:
`actionType`, `selectorValue`, `constantValue`, `navigateUrl`, `selectBy`, `keyName`,
`highlightColor`, `waitTimeoutMs`, `requireVisible/Enabled/Clickable`.

### `waitForElement(sel, timeoutMs, stateReq)`

هر ۱۰۰ms `querySelectorAll` می‌زند و `elementMatchesState` را چک می‌کند:

- **مرئی:** `display!=none`، `visibility!=hidden`، `opacity!=0`، عرض و ارتفاع > ۰
- **فعال:** `disabled!=true`، `aria-disabled!=true`
- **قابل کلیک:** `pointerEvents!=none` + نقطهٔ مرکز داخل viewport + `elementFromPoint` خود المان باشد

### اقدام‌های داخل صفحه

| اقدام | پیاده‌سازی واقعی |
|-------|------------------|
| `Click`/`DoubleClick`/`RightClick` | `dispatchEvent` (کلیک **مصنوعی**، نه ورودی واقعی) |
| `InputContent`/`InsertContent`/`LoadContent` | native setter + `input` + `change` (**بدون** keydown/keyup/blur) |
| `TakeContent`/`SaveContent` | `value` یا `innerText` |
| `Hover` | فقط `mouseover` (بدون `mouseenter`/`pointerenter`/`mousemove`) |
| `ClearContent` | native setter به `""` + `input`/`change` |
| `FocusElement` | `el.focus()` |
| `ScrollIntoView` | `scrollIntoView({block:"center"})` |
| `SelectOption` | `Value` → `Text` → `Index`؛ اگر value نبود، متن امتحان می‌شود |
| `PressKey` | `keydown`/`keypress`/`keyup`؛ `Enter` → `form.requestSubmit()` |
| `WaitForElement` | حلقهٔ انتظار مستقل با بودجهٔ `waitMaxMs` |
| `Breakpoint` | `skipped` |

پیش از هر اقدام `clearTabPlayHighlights(tabId)` و سپس `highlightTarget(el, color)` اجرا می‌شود.

---

## 11. سلکتور، فریم و حافظه

- **سلکتور پویا:** `resolveDynamicSelectorAsync` توکن `{مقدار پویا}` را با مقدار ستون ردیف جاری
  جایگزین می‌کند؛ `appendAttributeFilter` در صورت نیاز `[attr="value"]` می‌افزاید.
- **فریم:** `framePathJson` فهرست hop است (`{value, srcHint, indexInParent}`)؛
  `resolveFramePath` مسیر را تا `frameId` می‌پیماید و `executeInFrame` داخل همان فریم تزریق می‌کند.
- **حافظه:** `PLAY_MEMORY_SCHEMA` + `memoryStructureKey(graph)`؛ اگر ساختار گراف عوض شود
  `ensurePlayMemory` کل حافظه را پاک می‌کند. متغیرها در `chrome.storage.local` (`playMemory.vars`).
- **ذخیرهٔ سلکتور در حافظه:** فرمت `DASEL:` شامل سلکتور و زنجیرهٔ فریم.

---

## 12. منبع داده و نوشتن سلول

- **خواندن:** `readServerCell` (GET سلول) با dedupe روی درخواست‌های همزمان
  (`playCellReadInflight`).
- **نوشتن (`writeServerCellWait`):**
  - زنجیرهٔ promise به ازای هر `(dataSourceId, rowIndex, columnKey)` → نوشتن‌های همزمان روی یک
    سلول **سریالی** می‌شوند.
  - `maxWaitMs` پیش‌فرض **۲۰۰۰۰**.
  - چرخه: خواندن `expectedCellRevision` (از کش محلی یا GET) → PATCH با `expectedCellRevision`.
  - **۴۰۹ (conflict):** revision و مقدار فعلی سرور **پذیرفته** و بلافاصله دوباره تلاش.
  - `res.error === "auth"` → خروج با خطای احراز هویت.
  - backoff: `min(800, 80 + elapsed/40)` میلی‌ثانیه.
  - اتمام زمان → `{ok:false, error:"cell_write_timeout"}`.
- **`cellValue`** مقدار سلول ردیف جاری را می‌خواند؛ `rowCount` فقط برای تکرار گروه و **تنبل** خوانده می‌شود.

---

## 13. توقف، پاز و واچ لغو

| عملیات | رفتار |
|--------|--------|
| `stopPlay` | `playAbort=true`، پاک‌کردن polling، `unregisterPlayOnServer`، ذخیرهٔ storage، لاگ |
| `pausePlay` | `playPaused=true`؛ حلقه در `waitIfPaused` منتظر می‌ماند |
| `resumePlay` | `playPaused=false` + `wakePlayResumeWaiters` |
| واچ لغو | `setInterval` هر **۱۵۰۰ms** (خط ۳۰۷۸) به `GET /Panel/Tasks/PlayAbort?taskId=…`؛ اگر `abort` بود → `stopPlay("canvas_changed")` |

`waitIfPaused` در ابتدای هر گره و داخل `sleepInterruptible` صدا زده می‌شود.

---

## 14. ایرادهای مشکوک (فهرست بازبینی)

این‌ها از خود کد استخراج شده‌اند؛ هر مورد با محل دقیق و رفتار مشاهده‌شده/انتظار رفته.

### الف) عمر و پایداری اجرا

1. **حلقهٔ اجرا داخل MV3 service worker است و هیچ keepalive/offscreen وجود ندارد.**
   SW می‌تواند در میانهٔ اجرا (خصوصاً در مکث‌های طولانی مثل `WaitTime` یا انتظار سلول ۲۰ ثانیه‌ای)
   معلق شود و اجرا **بی‌صدا** بایستد. تنها بازیابی موجود مسیر reload توسعه (`resumePlayAfterReload`) است.
   `engine.js:1091` / `background.js:1`.
2. ✅ **برطرف شد — بازگشت به نود قبلی (حلقه) دیگر اجرا را قطع نمی‌کند.**
   پیش‌تر `visited` Set بود و هر نود فقط **یک بار** اجرا می‌شد؛ هر یال بازگشتی با
   پیام «توقف به‌خاطر حلقهٔ تکراری» کل اجرا را می‌بست.
   اکنون `visitCounts` (شمارندهٔ بازدید) جای آن را گرفته و هر نود تا سقف
   **«حداکثر بازگشت حلقه»** (پیش‌فرض ۱۰۰، قابل تنظیم روی نود شروع) دوباره اجرا می‌شود.
   با رد شدن سقف، اجرا با پیام روشن و نام‌بردن از نود متوقف می‌شود — نه بی‌صدا.
   هنگام بازگشت، هر تکرار لاگ می‌شود و حداقل **۵۰۰ms** مکث اعمال می‌شود تا حلقه
   انتظار، صفحه را مورد حمله قرار ندهد.
   (`resolveLoopBackLimit` / `paceLoopBack` / `executeFlow`)
3. **`guard < 100000`:** اگر این سقف ایمنی رد شود، پیمایش **بی‌صدا** تمام می‌شود
   (برخلاف سقف بازگشت حلقه که پیام می‌دهد). برای گراف‌های عادی هرگز رخ نمی‌دهد.

### ب) مسیریابی و شرط

4. **سقوط شرط به یال `next`** (خط ۱۵۴۲: `pass ? ["success","next"] : ["fail","next"]`):
   شرطی که فقط `success` سیم‌کشی شده، در حالت ناموفق هم شاخهٔ موفق را اجرا می‌کند.
   انتظار: در نبود یال `fail`، اجرا باید **متوقف** یا هشدار بدهد.
5. **سیاست خطای دوگانه با پیش‌فرض «چشم‌پوشی = روشن»** (مرحله: خط ۱۶۴۳، فرآیند: خطوط ۸۱۶/۸۱۹):
   خطاها بی‌صدا رد می‌شوند و در پایان «اجرا با موفقیت تمام شد» ثبت می‌شود.
   انتظار: پیش‌فرض سخت‌گیرانه‌تر، یا حداقل تفکیک واضح «موفق» از «با چشم‌پوشی».
6. **`stepTotal` تخمینی است و در زمان اجرا بازنویسی می‌شود** (خط ۱۴۹۸):
   `if (stepOrdinal > playStatus.stepTotal) playStatus.stepTotal = stepOrdinal;`
   روی گراف شاخه‌دار، عدد «مرحله X از Y» نادرست می‌شود.

### ج) تعامل با صفحه

7. **کلیک‌ها مصنوعی‌اند** (`dispatchEvent`) و `isTrusted=false` →
   سایت‌های React/Vue با گارد `isTrusted`، `canvas`، `input[type=file]` واکنش نمی‌دهند.
   هیچ fallback با ورودی واقعی (CDP / `Input.dispatchMouseEvent`) وجود ندارد.
8. **`Hover` فقط `mouseover` می‌فرستد** (خط ۳۶۴۳) → منوهایی که به `mouseenter`/`pointerenter`/`mousemove`
   وابسته‌اند باز نمی‌شوند.
9. **`InputContent` فقط `input`+`change` می‌دهد** (خط ۳۶۱۶) — بدون `keydown`/`keyup`/`keypress`/`blur` →
   فیلدهای masked، اعتبارسنجی روی تایپ، و فرم‌های watcher-based کار نمی‌کنند.
10. **`SelectOption` (خط ۳۶۷۷) فقط `<select>` واقعی را می‌شناسد**؛ برای dropdown‌های سفارشی
    (`div`/`ul` شبیه‌سازی‌شده) هیچ پشتیبانی‌ای نیست.

### د) زمان‌بندی

11. **`stepDelayMs` فقط از نود شروع ریشه خوانده می‌شود**
    (`resolveStepDelayMs`, خط ۷۸۴) → مقدار روی نود شروع یک **گروه** نادیده گرفته می‌شود،
    در حالی که UI فیلد را برای همهٔ نودهای شروع نشان می‌دهد.
12. **آخرین نود هیچ مکثی نمی‌گیرد** (`delayAfterNode`، خط ۷۹۲ با `nextId=null` زود برمی‌گردد) —
    اگر انتظار پایانی لازم باشد، راهی وجود ندارد جز افزودن `WaitTime`.
13. **`WaitTime` با مقدار نامعتبر بی‌صدا صفر می‌شود** (خط ۲۲۴۱: `Number(v) || 0`) — هیچ خطایی داده نمی‌شود.

### ه) منبع داده

14. **تعداد تکرار یک‌بار در شروع قطعی می‌شود** (خط ۱۳۱۹: `const iters = iterations || resolveProcessIterations(graph)`
    که در `runPlayLoop` **یک بار** صدا زده می‌شود)؛ ردیف‌هایی که سرور در میانهٔ اجرا اضافه/حذف کند
    دیده نمی‌شوند. (برای گروه‌ها `ensureDataSourceRowCountMeta` تنبل خوانده می‌شود، ولی فرآیند نه.)
15. **قفل سلول به‌صورت «کندی» ظاهر می‌شود نه خطا:** تا ۲۰ ثانیه (خط ۲۸۳۴) تلاش می‌کند و در نهایت
    `cell_write_timeout` می‌دهد؛ در UI این مکث طولانی بدون توضیح است.

### و) وضعیت و گزارش

16. **`logs`/`results` بین اجراها پاک نمی‌شوند** (سقف ۸۰، خط ۸۹۰) → تشخیص «آیا این اجرا موفق بود»
    دشوار می‌شود؛ نتیجهٔ اجرای قبلی با جدید قاطی می‌شود.
17. **`collectPlaySteps` هم `seen` دارد** و مسیر «موفق» را می‌پیماید → عدد HUD و فهرست
    «اقدام‌های مسیر» با اجرای واقعی (که شاخهٔ `fail` می‌رود) هم‌خوان نیست.
18. **واچ لغو هر ۱۵۰۰ms** (خط ۳۰۷۸) است → تا ۱.۵ ثانیه پس از تغییر گراف، مراحل قدیمی هنوز اجرا می‌شوند.

### ز) اعتبارسنجی

19. **اجرا در صورت وجود هر نود نامعتبر کاملاً رد می‌شود** (خط ۱۱۲۴، تابع در خط ۶۰۴) —
    حتی اگر نود مشکل‌دار در شاخهٔ `fail` باشد و هرگز اجرا نشود. برای گراف‌های بزرگ این
    «غیرقابل اجرا» شدن زودهنگام است.

---

## پیوست: نقشهٔ توابع کلیدی

| تابع | خط | نقش |
|------|-----|-----|
| `startPlay` | 1091 | نقطهٔ ورود اجرا، اعتبارسنجی، تعیین تب/تکرار |
| `runPlayLoop` | 1315 | حلقهٔ اندیس‌ها و دامنهٔ تک‌نودی |
| `executeFlow` | 1466 | پیمایش گره‌به‌گره دیاگرام |
| `runOneAction` | 1615 | اجرای یک اقدام + سیاست خطا |
| `runStep` | 2193 | مسیریابی اقدام به تب/فریم |
| `evaluateCondition` | 1699 | ارزیابی شرط‌ها |
| `resolveProcessIterations` | 902 | تکرار سطح فرآیند |
| `expandGroupByRepeatSource` | 3303 | تکرار سطح گروه |
| `writeServerCellWait` | 2828 | نوشتن سلول با قفل/revision |
| `playExecuteInjected` | 3478 | اجرای واقعی در صفحه |
| `collectPlaySteps` | 3230 | تخمین مراحل برای HUD |
| `resolveStepDelayMs` | 784 | فاصلهٔ بین مراحل |
| `startPlayAbortWatch` | 3064 | واچ لغو ۱۵۰۰ms |
| `resolveNavigationWaitMs` | 3790 | انتظار ناوبری |
