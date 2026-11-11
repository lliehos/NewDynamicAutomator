using System.Text.RegularExpressions;
using Webautomator.Player.Models;
using OpenQA.Selenium;
using OpenQA.Selenium.Interactions;
using OpenQA.Selenium.Support.UI;

namespace Webautomator.Player.Services;

/// <summary>Outcome of one action, in the same shape the engine uses.</summary>
/// <param name="Retryable">
/// The step found nothing to act on, so nothing ran and a retry is safe. Only a MISS is retried —
/// an action that already executed must never be dispatched twice by the wait loop.
/// </param>
public sealed record StepOutcome(
    bool Ok, string? Error = null, string? Value = null, bool Navigated = false, bool Retryable = false)
{
    public static readonly StepOutcome Success = new(true);
    public static StepOutcome Fail(string error, bool retryable = false) => new(false, error, Retryable: retryable);
    public static StepOutcome Read(string value) => new(true, Value: value);
}

/// <summary>
/// Executes a single action node against the browser via WebDriver.
/// </summary>
/// <remarks>
/// This mirrors the extension's action layer, not its whole engine. The engine's job splits cleanly:
/// deciding WHICH action runs and in what order is graph walking, which lives in
/// <see cref="LocalRunEngine"/>; performing one action against one element is this class. Keeping
/// them apart is what makes the port reviewable — each action here can be compared against its
/// counterpart in engine.js on its own.
///
/// The value-source indirection (reading a source cell, a memory value) is resolved by the caller
/// before an action is invoked, so this class only ever deals with concrete text.
/// </remarks>
public sealed class ActionExecutor
{
    private readonly RunTabs _tabs;

    public ActionExecutor(RunTabs tabs) => _tabs = tabs;

    /// <summary>
    /// Run one action. <paramref name="value"/> is the already-resolved value for actions that take
    /// one; the caller resolves source/memory indirection.
    /// </summary>
    public async Task<StepOutcome> RunAsync(
        IWebDriver driver, GraphNode step, string? value, CancellationToken ct)
    {
        var action = step.ActionType ?? "";
        try
        {
            switch (action)
            {
                case "NoAction":
                    return StepOutcome.Success;

                case "WaitTime":
                    await Task.Delay(Math.Max(0, step.WaitMs ?? 0), ct);
                    return StepOutcome.Success;

                case "GoToUrl":
                    return DoGoToUrl(driver, step, value, _tabs);

                case "GoBack":
                    driver.Navigate().Back();
                    return new StepOutcome(true, Navigated: true);

                case "GoForward":
                    driver.Navigate().Forward();
                    return new StepOutcome(true, Navigated: true);

                case "Refresh":
                    driver.Navigate().Refresh();
                    return new StepOutcome(true, Navigated: true);

                case "PressKey":
                    return DoPressKey(driver, step);

                case "SwitchTab":
                    return DoSwitchTab(driver, step);

                case "CloseTab":
                    return DoCloseTab(driver, step);

                case "Click":
                case "DoubleClick":
                case "RightClick":
                    return DoClick(driver, step, action);

                case "Hover":
                    return DoHover(driver, step);

                case "Hold":
                    return await DoHoldAsync(driver, step, value ?? "", ct);

                case "InputContent":
                case "LoadContent":
                    // LoadContent types a source cell into the target, exactly as InputContent does;
                    // the extension sends it through the same page-side branch for that reason.
                    return await DoInputAsync(driver, step, value ?? "", ct);

                case "ClearContent":
                    return DoClear(driver, step);

                case "SelectOption":
                    return DoSelectOption(driver, step, value ?? "");

                case "ScrollPage":
                    return DoScroll(driver, step, value);

                case "AlertAccept":
                    return await DoAlertAcceptAsync(driver, step, ct);

                case "WaitForLoading":
                    return await DoWaitForLoadingAsync(driver, step, ct);

                case "RemoveElements":
                    return DoRemoveElements(driver, step);

                default:
                    // An action this runner does not implement must stop the step rather than be
                    // skipped: silently continuing would run the rest of the process against a page
                    // state the missing action never produced.
                    return StepOutcome.Fail($"اقدام «{action}» در اجراکننده محلی پشتیبانی نمی‌شود.");
            }
        }
        catch (NoSuchElementException)
        {
            // A miss is the one failure the caller's wait loop may repeat: nothing was done.
            return StepOutcome.Fail("المنت موردنظر در صفحه پیدا نشد.", retryable: true);
        }
        catch (WebDriverTimeoutException)
        {
            return StepOutcome.Fail("مهلت انتظار برای المنات تمام شد.");
        }
        catch (WebDriverException ex)
        {
            return StepOutcome.Fail($"خطای مرورگر: {Shorten(ex.Message)}");
        }
        catch (OperationCanceledException)
        {
            return StepOutcome.Fail("اجرا متوقف شد.");
        }
        catch (Exception ex)
        {
            return StepOutcome.Fail(Shorten(ex.Message));
        }
    }

    // ---- Selectors ------------------------------------------------------------------------------

    /// <summary>
    /// Build a WebDriver locator from the step's selector.
    /// </summary>
    /// <remarks>
    /// The editor records CSS by default; XPath is supported because a recorded step may carry one.
    /// A bare selector with no recorded type is treated as CSS, which is what the recorder writes.
    /// An EMPTY selector is refused here rather than handed to the browser: WebDriver would answer
    /// with an opaque "Document.querySelector: '' is not a valid selector" that says nothing about
    /// the actual problem (the node has no target element recorded).
    /// </remarks>
    private static By BuildBy(GraphNode step, bool valueSide = false)
    {
        var selector = (valueSide ? (step.EqualSelector ?? step.Selector) : step.Selector)?.Trim() ?? "";
        if (selector.Length == 0)
            throw new InvalidOperationException(
                valueSide
                    ? "سلکتور عنصر منبع مقدار برای این مرحله تنظیم نشده است."
                    : "سلکتور المان هدف برای این مرحله تنظیم نشده است؛ در ویرایشگر نود، المان را انتخاب کنید.");
        var type = (step.SelectorType ?? "").Trim();
        if (type.Equals("XPath", StringComparison.OrdinalIgnoreCase)) return By.XPath(selector);
        if (type.Equals("Id", StringComparison.OrdinalIgnoreCase)) return By.Id(selector);
        if (type.Equals("Name", StringComparison.OrdinalIgnoreCase)) return By.Name(selector);
        if (selector.StartsWith("//") || selector.StartsWith("(/")) return By.XPath(selector);
        return By.CssSelector(selector);
    }

    /// <summary>Find the element with ONE lookup, honouring an optional index.</summary>
    /// <remarks>
    /// Deliberately single-attempt: the caller owns the wait budget and retries "resolve the frame
    /// chain + look up the element" every 200ms, which is the extension's contract. Waiting here
    /// instead would hide a late IFRAME (the frame itself may not exist at the first attempt) and
    /// would make a retry unable to re-resolve it.
    /// </remarks>
    private static IWebElement FindElement(IWebDriver driver, GraphNode step, bool valueSide = false)
    {
        var by = BuildBy(step, valueSide);
        var index = step.SelectorIndex ?? 0;
        // The visible / enabled / clickable filters are part of the author's selector: a page can
        // carry a hidden template copy before the real row, and acting on the template "works"
        // while doing nothing.
        return ElementState.FindFirst(driver, by, ElementRequirements.For(step, valueSide), index);
    }

    // ---- Actions --------------------------------------------------------------------------------

    private static StepOutcome DoClick(IWebDriver driver, GraphNode step, string action)
    {
        var el = FindElement(driver, step);
        try
        {
            // Scroll first: a click on an element that is out of view is a common, confusing failure.
            ((IJavaScriptExecutor)driver).ExecuteScript("arguments[0].scrollIntoView({block:'center'});", el);
        }
        catch { /* scrolling is a courtesy; the click below is the real attempt */ }

        try
        {
            // RealMouse replays a full pointer/mouse press-release pair instead of a bare click —
            // the bypass for frameworks that ignore a single synthetic click. Selenium's native
            // click already carries real coordinates, so the mode only changes WHICH native gesture
            // is sent.
            var realMouse = string.Equals(
                step.ReadExtraString("clickMode"), "RealMouse", StringComparison.OrdinalIgnoreCase);

            switch (action)
            {
                case "DoubleClick":
                    new Actions(driver).DoubleClick(el).Perform();
                    break;
                case "RightClick":
                    new Actions(driver).ContextClick(el).Perform();
                    break;
                default:
                    if (realMouse) new Actions(driver).MoveToElement(el).Click().Perform();
                    else el.Click();
                    break;
            }
            return StepOutcome.Success;
        }
        catch (ElementClickInterceptedException)
        {
            // Selenium's native click is refused when something overlaps the element. The
            // element-level click bypasses the overlap check, which is exactly what a human would do
            // by clicking the visible part.
            ((IJavaScriptExecutor)driver).ExecuteScript("arguments[0].click();", el);
            return StepOutcome.Success;
        }
    }

    /// <summary>
    /// Send a key to the step's element, or to the focused element when it names none.
    /// </summary>
    /// <remarks>
    /// WebDriver's SendKeys produces a REAL key event, so unlike the extension's synthetic one it
    /// also performs the browser's default action (Tab moves focus, Enter submits). That makes the
    /// two players agree on what the step means, which is what matters to a process that runs on
    /// either.
    /// </remarks>
    private static StepOutcome DoPressKey(IWebDriver driver, GraphNode step)
    {
        var name = step.ReadExtraString("pressKeyName");
        if (string.IsNullOrWhiteSpace(name))
            return StepOutcome.Fail("کلید موردنظر مشخص نیست.");

        var keys = TranslateKey(name, out var isChord);
        if (keys is null) return StepOutcome.Fail($"کلید «{name}» شناخته نشد.");

        try
        {
            if (!string.IsNullOrWhiteSpace(step.Selector))
            {
                var el = FindElement(driver, step);
                try { el.SendKeys(keys); }
                catch (ElementNotInteractableException)
                {
                    // A readonly/hidden target cannot take SendKeys; a key event is still meaningful.
                    ((IJavaScriptExecutor)driver).ExecuteScript(
                        "const el=arguments[0];el.focus&&el.focus();" +
                        "const init={key:arguments[1],bubbles:true,cancelable:true};" +
                        "el.dispatchEvent(new KeyboardEvent('keydown',init));" +
                        "el.dispatchEvent(new KeyboardEvent('keyup',init));",
                        el, name);
                }
                return StepOutcome.Success;
            }

            var body = driver.FindElement(By.TagName("body"));
            body.SendKeys(keys);
            return StepOutcome.Success;
        }
        catch (WebDriverException ex)
        {
            return StepOutcome.Fail($"فشردن کلید ناموفق بود: {Shorten(ex.Message)}");
        }
    }

    /// <summary>
    /// Map an author's key name onto Selenium's key sequences.
    /// </summary>
    /// <remarks>
    /// A chord ("Ctrl+A", "Shift+Tab") becomes one sequence of modifier-down, key, modifier-up —
    /// Selenium holds a modifier only until the next key in the same SendKeys call.
    /// </remarks>
    private static string? TranslateKey(string raw, out bool isChord)
    {
        isChord = false;
        var parts = raw.Split('+', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        if (parts.Length == 0) return null;
        var keyPart = parts[^1];
        var mods = string.Join("+", parts[..^1]).ToLowerInvariant();
        var prefix = "";
        if (mods.Contains("ctrl") || mods.Contains("control")) prefix += Keys.Control;
        if (mods.Contains("shift")) prefix += Keys.Shift;
        if (mods.Contains("alt")) prefix += Keys.Alt;
        if (mods.Contains("meta") || mods.Contains("cmd") || mods.Contains("win")) prefix += Keys.Meta;
        isChord = prefix.Length > 0;

        var named = keyPart.ToLowerInvariant() switch
        {
            "enter" or "return" => Keys.Enter,
            "tab" => Keys.Tab,
            "escape" or "esc" => Keys.Escape,
            "space" or " " => Keys.Space,
            "backspace" => Keys.Backspace,
            "delete" or "del" => Keys.Delete,
            "insert" => Keys.Insert,
            "home" => Keys.Home,
            "end" => Keys.End,
            "pageup" => Keys.PageUp,
            "pagedown" => Keys.PageDown,
            "arrowup" or "up" => Keys.ArrowUp,
            "arrowdown" or "down" => Keys.ArrowDown,
            "arrowleft" or "left" => Keys.ArrowLeft,
            "arrowright" or "right" => Keys.ArrowRight,
            _ => keyPart.Length == 1 ? keyPart : null
        };
        if (named is null) return null;
        return prefix + named;
    }

    /// <summary>
    /// Navigate, or open/reuse a NAMED tab when the step asks for one.
    /// </summary>
    /// <remarks>
    /// A named tab is created on first use and REUSED afterwards: opening a second tab under a live
    /// alias would make every loop iteration grow the browser, and «return to system B» would stop
    /// meaning the page that is already logged in. «رفتن به تب جدید» off opens it in the background
    /// and the run keeps working on the tab it was on.
    /// </remarks>
    private static StepOutcome DoGoToUrl(IWebDriver driver, GraphNode step, string? value, RunTabs tabs)
    {
        var url = string.IsNullOrWhiteSpace(value)
            ? (step.NavigateUrl ?? step.ConstantValue ?? "")
            : value!;
        if (string.IsNullOrWhiteSpace(url))
            return StepOutcome.Fail("آدرس مقصد برای رفتن به آدرس مشخص نیست.");

        if (step.ReadExtraBool("openInNewTab", false))
        {
            var alias = step.ReadExtraString("newTabAlias").Trim();
            if (alias.Length == 0) alias = tabs.NextAutoAlias();
            var switchToNew = step.ReadExtraBool("switchToNewTab", true);

            var existing = tabs.HandleFor(alias);
            if (existing is not null)
            {
                var previousHandle = driver.CurrentWindowHandle;
                try
                {
                    driver.SwitchTo().Window(existing);
                    driver.Navigate().GoToUrl(url);
                    // «رفتن به تب جدید» off: the author wants the page opened WITHOUT leaving the
                    // tab the run was working on.
                    if (!switchToNew)
                    {
                        try { driver.SwitchTo().Window(previousHandle); } catch { /* the old tab may be gone */ }
                    }
                    return new StepOutcome(true, Navigated: true);
                }
                catch (NoSuchWindowException)
                {
                    // The author closed it by hand; open a fresh one under the same name.
                    tabs.ForgetHandle(existing);
                }
            }

            var previous = driver.CurrentWindowHandle;
            driver.SwitchTo().NewWindow(WindowType.Tab);
            var handle = driver.CurrentWindowHandle;
            tabs.Register(alias, handle);
            try
            {
                driver.Navigate().GoToUrl(url);
            }
            catch
            {
                tabs.ForgetHandle(handle);
                throw;
            }
            if (!switchToNew)
            {
                try { driver.SwitchTo().Window(previous); } catch { /* the old tab may be gone */ }
            }
            return new StepOutcome(true, Navigated: true);
        }

        driver.Navigate().GoToUrl(url);
        return new StepOutcome(true, Navigated: true);
    }

    /// <summary>Move the driver to the tab a SwitchTab step names.</summary>
    private StepOutcome DoSwitchTab(IWebDriver driver, GraphNode step)
    {
        var handles = driver.WindowHandles.ToList();
        if (handles.Count == 0) return StepOutcome.Fail("تبی برای سوئیچ پیدا نشد.");

        var mode = step.ReadExtraString("switchTabTarget");
        if (string.IsNullOrWhiteSpace(mode)) mode = "Alias";
        string? handle = mode switch
        {
            "Url" or "Title" => FindHandleByText(driver, handles,
                step.ReadExtraString(mode == "Url" ? "switchTabUrl" : "switchTabTitle"), mode == "Url"),
            "First" => handles[0],
            "Last" => handles[^1],
            "Next" => NeighbourHandle(driver, handles, +1),
            "Previous" => NeighbourHandle(driver, handles, -1),
            // A named tab is one this run opened with «رفتن به آدرس» + «تب جدید». `main` is the
            // window the run started in; an alias nobody opened cannot be found.
            _ => _tabs.HandleFor(step.ReadExtraString("switchTabAlias")) ?? driver.CurrentWindowHandle
        };
        if (handle is null) return StepOutcome.Fail("تب مقصد پیدا نشد.");
        if (!string.Equals(handle, driver.CurrentWindowHandle, StringComparison.Ordinal))
            driver.SwitchTo().Window(handle);
        return StepOutcome.Success;
    }

    /// <summary>Close the tab a CloseTab step names. The last tab of the session is never closed.</summary>
    private StepOutcome DoCloseTab(IWebDriver driver, GraphNode step)
    {
        var handles = driver.WindowHandles.ToList();
        if (handles.Count <= 1) return StepOutcome.Fail("فقط یک تب باز است؛ قابل بستن نیست.");

        var mode = step.ReadExtraString("closeTabTarget");
        if (string.IsNullOrWhiteSpace(mode)) mode = "Last";
        var current = driver.CurrentWindowHandle;
        string? victim = mode switch
        {
            "Url" or "Title" => FindHandleByText(driver, handles,
                step.ReadExtraString(mode == "Url" ? "closeTabUrl" : "closeTabTitle"), mode == "Url"),
            "First" => handles[0],
            "Next" => NeighbourHandle(driver, handles, +1),
            "Previous" => NeighbourHandle(driver, handles, -1),
            "Current" => current,
            // A named tab is one this run opened under that alias.
            "Alias" => _tabs.HandleFor(step.ReadExtraString("closeTabAlias")),
            _ => handles[^1]
        };
        if (victim is null) return StepOutcome.Fail("تب موردنظر برای بستن پیدا نشد.");
        if (handles.Count <= 1) return StepOutcome.Fail("فقط یک تب باز است؛ قابل بستن نیست.");

        var continueIn = string.Equals(victim, current, StringComparison.Ordinal)
            ? handles.First(h => !string.Equals(h, victim, StringComparison.Ordinal))
            : current;

        driver.SwitchTo().Window(victim);
        driver.Close();
        // The alias (if any) pointed at a window that is now gone; a later SwitchTab must say so
        // instead of switching to a reclaimed handle.
        _tabs.ForgetHandle(victim);
        try { driver.SwitchTo().Window(continueIn); }
        catch (NoSuchWindowException)
        {
            var remaining = driver.WindowHandles.ToList();
            if (remaining.Count == 0) return StepOutcome.Fail("هیچ تبی باقی نماند.");
            driver.SwitchTo().Window(remaining[0]);
        }
        return StepOutcome.Success;
    }

    /** The handle whose URL or title contains the pattern (case-insensitive). */
    private static string? FindHandleByText(
        IWebDriver driver, List<string> handles, string pattern, bool byUrl)
    {
        var needle = (pattern ?? "").Trim();
        if (needle.Length == 0) return null;
        var original = driver.CurrentWindowHandle;
        string? found = null;
        foreach (var handle in handles)
        {
            try
            {
                driver.SwitchTo().Window(handle);
                var text = byUrl ? driver.Url : driver.Title;
                if ((text ?? "").Contains(needle, StringComparison.OrdinalIgnoreCase))
                {
                    found = handle;
                    break;
                }
            }
            catch { /* a window that vanished mid-scan is skipped */ }
        }
        try { driver.SwitchTo().Window(original); } catch { /* the caller re-switches */ }
        return found;
    }

    /** Next/previous handle relative to the current one, or null at the ends. */
    private static string? NeighbourHandle(IWebDriver driver, List<string> handles, int step)
    {
        var index = handles.IndexOf(driver.CurrentWindowHandle);
        if (index < 0) return null;
        var next = index + step;
        return next >= 0 && next < handles.Count ? handles[next] : null;
    }

    private static StepOutcome DoHover(IWebDriver driver, GraphNode step)
    {
        var el = FindElement(driver, step);
        new Actions(driver).MoveToElement(el).Perform();
        return StepOutcome.Success;
    }

    private static async Task<StepOutcome> DoInputAsync(
        IWebDriver driver, GraphNode step, string value, CancellationToken ct)
    {
        var el = FindElement(driver, step);
        var perChar = string.Equals(step.ReadExtraString("typeMode"), "PerCharacter", StringComparison.OrdinalIgnoreCase);
        if (perChar)
        {
            // Keystroke by keystroke, for a field the page watches as the user types (live search,
            // autocomplete, a masked input). Setting the value in one shot never fires those.
            // Typing APPENDS, so the field is emptied first — the same thing ClearContent would do.
            try { el.Clear(); } catch { /* some fields refuse Clear; the native setter below still writes */ }
            var keystrokeDelay = Math.Max(0, step.ReadExtraInt("typeDelayMs") ?? 0);
            try
            {
                foreach (var ch in value)
                {
                    el.SendKeys(ch.ToString());
                    if (keystrokeDelay > 0) await Task.Delay(keystrokeDelay, ct);
                }
            }
            catch (ElementNotInteractableException)
            {
                return StepOutcome.Fail("المان هدف قابل تایپ نیست (غیرفعال یا فقط‌خواندنی).");
            }
            return StepOutcome.Success;
        }
        // One-shot: fast, and what a plain text field actually needs.
        ((IJavaScriptExecutor)driver).ExecuteScript(
            "const el=arguments[0],v=arguments[1];" +
            "const proto=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;" +
            "const d=Object.getOwnPropertyDescriptor(proto,'value');" +
            "if(d&&d.set){d.set.call(el,v);}else{el.value=v;}" +
            "el.dispatchEvent(new Event('input',{bubbles:true}));" +
            "el.dispatchEvent(new Event('change',{bubbles:true}));",
            el, value);
        return StepOutcome.Success;
    }

    /// <summary>
    /// Press the element and keep the button down for the step's duration, then release.
    /// </summary>
    /// <remarks>
    /// A page that reacts to a long press listens across the whole down..up window, so a plain
    /// click (down and up in the same tick) is never seen as one. Holding the real mouse button open
    /// is exactly that window.
    /// </remarks>
    private static async Task<StepOutcome> DoHoldAsync(
        IWebDriver driver, GraphNode step, string value, CancellationToken ct)
    {
        var el = FindElement(driver, step);
        var holdMs = int.TryParse(value.Trim(), out var parsed) ? Math.Max(0, parsed) : 500;
        try
        {
            new Actions(driver).MoveToElement(el).ClickAndHold(el).Perform();
            if (holdMs > 0) await Task.Delay(holdMs, ct);
            new Actions(driver).Release(el).Perform();
            return StepOutcome.Success;
        }
        catch (Exception ex)
        {
            // Release best-effort: a stuck pressed button would corrupt every later step.
            try { new Actions(driver).Release().Perform(); } catch { /* ignore */ }
            return StepOutcome.Fail($"نگه‌داشتن ماوس ناموفق بود: {Shorten(ex.Message)}");
        }
    }

    private static StepOutcome DoClear(IWebDriver driver, GraphNode step)
    {
        var el = FindElement(driver, step);
        try { el.Clear(); }
        catch
        {
            ((IJavaScriptExecutor)driver).ExecuteScript(
                "const el=arguments[0];el.value='';" +
                "el.dispatchEvent(new Event('input',{bubbles:true}));" +
                "el.dispatchEvent(new Event('change',{bubbles:true}));",
                el);
        }
        return StepOutcome.Success;
    }

    private static StepOutcome DoSelectOption(IWebDriver driver, GraphNode step, string value)
    {
        var el = FindElement(driver, step);
        var select = new SelectElement(el);
        // The author chooses HOW the option is matched. Value is exact by design; a label typed
        // into the value field is a common slip, so the Value mode falls back to the text.
        var mode = step.ReadExtraString("selectBy");
        if (mode.Length == 0) mode = "Value";
        try
        {
            if (string.Equals(mode, "Index", StringComparison.OrdinalIgnoreCase))
            {
                if (!int.TryParse(value.Trim(), out var index) || index < 0)
                    return StepOutcome.Fail($"اندیس گزینهٔ «{value}» معتبر نیست.");
                select.SelectByIndex(index);
            }
            else if (string.Equals(mode, "Text", StringComparison.OrdinalIgnoreCase))
            {
                select.SelectByText(value);
            }
            else
            {
                try { select.SelectByValue(value); }
                catch (NoSuchElementException) { select.SelectByText(value); }
            }
            return StepOutcome.Success;
        }
        catch (NoSuchElementException)
        {
            return StepOutcome.Fail($"گزینهٔ «{value}» در فهرست پیدا نشد.");
        }
    }

    private static StepOutcome DoScroll(IWebDriver driver, GraphNode step, string? value)
    {
        var mode = step.ReadExtraString("scrollType");
        if (mode.Length == 0) mode = "Amount";

        if (string.Equals(mode, "ToElement", StringComparison.OrdinalIgnoreCase))
        {
            if (string.IsNullOrWhiteSpace(step.Selector))
                return StepOutcome.Fail("برای اسکرول تا المان، ابتدا المان مقصد را انتخاب کنید.");
            var el = FindElement(driver, step);
            try
            {
                ((IJavaScriptExecutor)driver).ExecuteScript(
                    "arguments[0].scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});", el);
            }
            catch
            {
                try { ((IJavaScriptExecutor)driver).ExecuteScript("arguments[0].scrollIntoView();", el); }
                catch { /* a detached node cannot be scrolled to */ }
            }
            return StepOutcome.Success;
        }

        // Amount: the step's own value, or about one screenful when it is blank.
        var dy = int.TryParse((value ?? "").Trim(), out var amount) && amount != 0 ? amount : 600;
        try
        {
            ((IJavaScriptExecutor)driver).ExecuteScript(
                "window.scrollBy({top:arguments[0],left:0,behavior:'instant'});", dy);
        }
        catch
        {
            try { ((IJavaScriptExecutor)driver).ExecuteScript("window.scrollBy(0, arguments[0]);", dy); }
            catch { /* a page that refuses to scroll is not a failure */ }
        }
        return StepOutcome.Success;
    }

    /// <summary>
    /// Answer the browser dialog the previous step raised.
    /// </summary>
    /// <remarks>
    /// Finding NO dialog is a failure, not a quiet pass: the step exists to answer one, so its
    /// absence means the page did not do what the diagram expected. The step's own switch decides
    /// whether that failure stops the run.
    /// </remarks>
    private static async Task<StepOutcome> DoAlertAcceptAsync(
        IWebDriver driver, GraphNode step, CancellationToken ct)
    {
        var waitMs = Math.Max(0, step.ReadExtraInt("alertWaitMs") ?? 0);
        if (waitMs == 0) waitMs = 400;
        var deadline = DateTime.UtcNow.AddMilliseconds(waitMs);

        IAlert? alert = null;
        while (true)
        {
            ct.ThrowIfCancellationRequested();
            try { alert = driver.SwitchTo().Alert(); break; }
            catch (NoAlertPresentException)
            {
                if (DateTime.UtcNow >= deadline) break;
                await Task.Delay(100, ct);
            }
        }
        if (alert is null) return StepOutcome.Fail("دیالوگ مرورگر پیدا نشد.");

        var dismissing = string.Equals(step.ReadExtraString("alertType"), "Dismiss", StringComparison.OrdinalIgnoreCase);
        if (dismissing)
        {
            alert.Dismiss();
            return StepOutcome.Success;
        }

        var promptText = step.ReadExtraString("alertPromptText");
        if (promptText.Length > 0)
        {
            // A prompt dialog needs its text before Accept; any other kind refuses SendKeys.
            try { alert.SendKeys(promptText); } catch { /* not a prompt dialog */ }
        }
        alert.Accept();
        return StepOutcome.Success;
    }

    private static async Task<StepOutcome> DoWaitForLoadingAsync(
        IWebDriver driver, GraphNode step, CancellationToken ct)
    {
        // Mirrors the extension: the step's OWN value is the budget (`constantValue`), a step-level
        // `waitMaxMs` is the fallback, and a blank value means fifteen seconds. Reaching the budget
        // is NOT a step failure — the page merely said it was still loading.
        var maxMs = 0;
        if (int.TryParse((step.ConstantValue ?? "").Trim(), out var fromValue) && fromValue > 0)
            maxMs = fromValue;
        if (maxMs == 0) maxMs = Math.Max(0, step.ReadExtraInt("waitMaxMs") ?? 0);
        if (maxMs == 0) maxMs = 15_000;
        var deadline = DateTime.UtcNow.AddMilliseconds(maxMs);
        while (DateTime.UtcNow < deadline)
        {
            ct.ThrowIfCancellationRequested();
            try
            {
                var state = (string)((IJavaScriptExecutor)driver)
                    .ExecuteScript("return document.readyState")!;
                if (string.Equals(state, "complete", StringComparison.OrdinalIgnoreCase))
                {
                    // readyState covers the document; if the step also waits for one element, wait
                    // for that too, so "loading finished" means the thing the author was waiting for
                    // is actually on the page rather than merely fetched.
                    if (!string.IsNullOrWhiteSpace(step.Selector))
                    {
                        var found = driver.FindElements(BuildBy(step));
                        if (found.Count == 0)
                        {
                            await Task.Delay(200, ct);
                            continue;
                        }
                    }                    return StepOutcome.Success;
                }
            }
            catch { /* a navigating document throws; wait and retry */ }
            await Task.Delay(200, ct);
        }
        return StepOutcome.Success; // readyState never settling is not itself a step failure
    }

    /// <summary>
    /// Remove matched elements from the page.
    /// </summary>
    /// <remarks>
    /// Honours the step's `removeAllMatches` flag (default true), because the two behaviours are
    /// genuinely wanted: clearing a repeated block removes every match, while "the one banner that
    /// is currently up" removes only the first. Removing nothing is an ERROR rather than a quiet
    /// success — the step existed to remove something, and a run that silently skipped it would
    /// carry on against a page it did not actually change.
    /// </remarks>
    private static StepOutcome DoRemoveElements(IWebDriver driver, GraphNode step)
    {
        if (string.IsNullOrWhiteSpace(step.Selector))
            return StepOutcome.Fail("برای حذف المنت، انتخابگر لازم است.");

        var by = BuildBy(step);
        // One lookup: a miss is retryable, so the engine's wait budget may repeat it. Removing
        // nothing is an ERROR rather than a quiet success — the step existed to remove something.
        if (driver.FindElements(by).Count == 0)
            return StepOutcome.Fail("المنتی برای حذف پیدا نشد.", retryable: true);

        var removeAll = step.ReadExtraBool("removeAllMatches", true);
        var removedRaw = ((IJavaScriptExecutor)driver).ExecuteScript(
            "const all=Array.from(document.querySelectorAll(arguments[0]));" +
            "const wanted=arguments[1]?all:all.slice(0,1);" +
            "let n=0;for(const e of wanted){try{if(e.parentNode){e.parentNode.removeChild(e);n++;}}catch(_){}}" +
            "return n;",
            step.Selector, removeAll);
        var removed = removedRaw is null ? 0L : Convert.ToInt64(removedRaw);

        if (removed == 0)
            return StepOutcome.Fail("هیچ المنتی حذف نشد.");
        return StepOutcome.Read(removed.ToString());
    }

    // ---- Values ---------------------------------------------------------------------------------

    /// <summary>
    /// Read a value out of the page, for the actions that capture one (field value or text).
    /// </summary>
    public StepOutcome ReadElementValue(IWebDriver driver, GraphNode step)
    {
        try
        {
            // The value an «عنصر صفحه» source reads lives on the VALUE side of the node
            // (`equalSelectorValue`), not on the target side: that is where the editor's picker puts
            // it, and reading the target made a step capture the element it was meant to act on.
            var el = FindElement(driver, step, valueSide: true);
            // WHICH part of the element is the value. `Auto` keeps the historic guess (a form
            // field's value, otherwise its text); the other modes read exactly what was authored —
            // a link's href, a named attribute, the markup.
            var mode = (step.ReadExtraString("elementValueMode") ?? "").Trim();
            if (mode.Length == 0) mode = (step.ReadExtraString("equalElementValueMode") ?? "").Trim();
            if (mode.Length == 0) mode = "Auto";
            var attr = (step.ReadExtraString("elementValueAttribute") ?? "").Trim();
            if (attr.Length == 0) attr = (step.ReadExtraString("equalElementValueAttribute") ?? "").Trim();
            const string js =
                "const el=arguments[0], m=String(arguments[1]||'auto').toLowerCase(), a=arguments[2];" +
                "if(m==='value')return el.value!=null?String(el.value):'';" +
                "if(m==='attribute'){if(!a)return '';const v=el.getAttribute(a);return v==null?'':String(v);}" +
                "if(m==='innerhtml')return el.innerHTML||'';" +
                "if(m==='outerhtml')return el.outerHTML||'';" +
                "if(m==='innertext')return (el.innerText||'').trim();" +
                "if(m==='text')return (el.textContent||'').trim();" +
                "if(m==='auto'){const t=(el.tagName||'').toUpperCase();" +
                "if(t==='INPUT'||t==='TEXTAREA'||t==='SELECT')return el.value||'';" +
                "return (el.innerText||el.textContent||'').trim();}" +
                "const v=el.getAttribute(m);return v==null?'':String(v);";
            var text = ((IJavaScriptExecutor)driver).ExecuteScript(js, el, mode, attr) as string;
            return StepOutcome.Read(text ?? "");
        }
        catch (NoSuchElementException)
        {
            return StepOutcome.Fail("المنت منبع مقدار در صفحه پیدا نشد.", retryable: true);
        }
        catch (Exception ex)
        {
            return StepOutcome.Fail(Shorten(ex.Message));
        }
    }

    private static string Shorten(string msg)
    {
        if (string.IsNullOrWhiteSpace(msg)) return "خطای نامشخص";
        var oneLine = Regex.Replace(msg, @"\s+", " ").Trim();
        return oneLine.Length > 200 ? oneLine[..200] + "…" : oneLine;
    }
}
