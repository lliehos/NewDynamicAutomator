using System.Text.RegularExpressions;
using Morobot.Desktop.Models;
using OpenQA.Selenium;
using OpenQA.Selenium.Interactions;
using OpenQA.Selenium.Support.UI;

namespace Morobot.Desktop.Services;

/// <summary>Outcome of one action, in the same shape the engine uses.</summary>
public sealed record StepOutcome(bool Ok, string? Error = null, string? Value = null, bool Navigated = false)
{
    public static readonly StepOutcome Success = new(true);
    public static StepOutcome Fail(string error) => new(false, error);
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
    /// <summary>
    /// Run one action. <paramref name="value"/> is the already-resolved value for actions that take
    /// one; the caller resolves source/memory indirection.
    /// </summary>
    public async Task<StepOutcome> RunAsync(
        IWebDriver driver, GraphNode step, string? value, TimeSpan timeout, CancellationToken ct)
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
                    driver.Navigate().GoToUrl(value ?? step.NavigateUrl ?? step.ConstantValue ?? "about:blank");
                    return new StepOutcome(true, Navigated: true);

                case "GoBack":
                    driver.Navigate().Back();
                    return new StepOutcome(true, Navigated: true);

                case "GoForward":
                    driver.Navigate().Forward();
                    return new StepOutcome(true, Navigated: true);

                case "Refresh":
                    driver.Navigate().Refresh();
                    return new StepOutcome(true, Navigated: true);

                case "Click":
                case "DoubleClick":
                case "RightClick":
                    return DoClick(driver, step, action, timeout);

                case "Hover":
                    return DoHover(driver, step, timeout);

                case "InputContent":
                    return DoInput(driver, step, value ?? "", timeout);

                case "ClearContent":
                    return DoClear(driver, step, timeout);

                case "SelectOption":
                    return DoSelectOption(driver, step, value ?? "", timeout);

                case "ScrollPage":
                    return DoScroll(driver, step);

                case "AlertAccept":
                    return DoAlertAccept(driver);

                case "WaitForLoading":
                    return await DoWaitForLoadingAsync(driver, step, timeout, ct);

                default:
                    // An action this runner does not implement must stop the step rather than be
                    // skipped: silently continuing would run the rest of the process against a page
                    // state the missing action never produced.
                    return StepOutcome.Fail($"اقدام «{action}» در اجراکننده محلی پشتیبانی نمی‌شود.");
            }
        }
        catch (NoSuchElementException)
        {
            return StepOutcome.Fail("المنت موردنظر در صفحه پیدا نشد.");
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
    /// </remarks>
    private static By BuildBy(GraphNode step)
    {
        var selector = step.Selector ?? "";
        var type = (step.SelectorType ?? "").Trim();
        if (type.Equals("XPath", StringComparison.OrdinalIgnoreCase)) return By.XPath(selector);
        if (type.Equals("Id", StringComparison.OrdinalIgnoreCase)) return By.Id(selector);
        if (type.Equals("Name", StringComparison.OrdinalIgnoreCase)) return By.Name(selector);
        if (selector.TrimStart().StartsWith("//") || selector.TrimStart().StartsWith("(/")) return By.XPath(selector);
        return By.CssSelector(selector);
    }

    /// <summary>Find the element, honouring an optional index when several match.</summary>
    private static IWebElement FindElement(IWebDriver driver, GraphNode step, TimeSpan timeout)
    {
        var by = BuildBy(step);
        var index = step.SelectorIndex ?? 0;
        var wait = new WebDriverWait(driver, timeout);
        if (index <= 0)
            return wait.Until(d => d.FindElement(by));

        var all = wait.Until(d =>
        {
            var found = d.FindElements(by);
            return found.Count > index ? found : null;
        });
        return all[index];
    }

    // ---- Actions --------------------------------------------------------------------------------

    private static StepOutcome DoClick(IWebDriver driver, GraphNode step, string action, TimeSpan timeout)
    {
        var el = FindElement(driver, step, timeout);
        try
        {
            // Scroll first: a click on an element that is out of view is a common, confusing failure.
            ((IJavaScriptExecutor)driver).ExecuteScript("arguments[0].scrollIntoView({block:'center'});", el);
        }
        catch { /* scrolling is a courtesy; the click below is the real attempt */ }

        try
        {
            switch (action)
            {
                case "DoubleClick":
                    new Actions(driver).DoubleClick(el).Perform();
                    break;
                case "RightClick":
                    new Actions(driver).ContextClick(el).Perform();
                    break;
                default:
                    el.Click();
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

    private static StepOutcome DoHover(IWebDriver driver, GraphNode step, TimeSpan timeout)
    {
        var el = FindElement(driver, step, timeout);
        new Actions(driver).MoveToElement(el).Perform();
        return StepOutcome.Success;
    }

    private static StepOutcome DoInput(IWebDriver driver, GraphNode step, string value, TimeSpan timeout)
    {
        var el = FindElement(driver, step, timeout);
        var perChar = string.Equals(step.ReadExtraString("typeMode"), "PerCharacter", StringComparison.OrdinalIgnoreCase);
        try { el.Clear(); } catch { /* some fields refuse Clear; SendKeys below still writes */ }
        if (perChar)
        {
            // Keystroke by keystroke, for a field the page watches as the user types (live search,
            // autocomplete, a masked input). Setting the value in one shot never fires those.
            el.SendKeys(value);
        }
        else
        {
            // One-shot: fast, and what a plain text field actually needs.
            ((IJavaScriptExecutor)driver).ExecuteScript(
                "const el=arguments[0],v=arguments[1];" +
                "const proto=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;" +
                "const d=Object.getOwnPropertyDescriptor(proto,'value');" +
                "if(d&&d.set){d.set.call(el,v);}else{el.value=v;}" +
                "el.dispatchEvent(new Event('input',{bubbles:true}));" +
                "el.dispatchEvent(new Event('change',{bubbles:true}));",
                el, value);
        }
        return StepOutcome.Success;
    }

    private static StepOutcome DoClear(IWebDriver driver, GraphNode step, TimeSpan timeout)
    {
        var el = FindElement(driver, step, timeout);
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

    private static StepOutcome DoSelectOption(IWebDriver driver, GraphNode step, string value, TimeSpan timeout)
    {
        var el = FindElement(driver, step, timeout);
        var select = new SelectElement(el);
        try
        {
            // Prefer the visible text; a recorded step usually carries what the user saw.
            select.SelectByText(value);
        }
        catch (NoSuchElementException)
        {
            try { select.SelectByValue(value); }
            catch (NoSuchElementException) { return StepOutcome.Fail($"گزینهٔ «{value}» در فهرست پیدا نشد."); }
        }
        return StepOutcome.Success;
    }

    private static StepOutcome DoScroll(IWebDriver driver, GraphNode step)
    {
        var mode = step.ReadExtraString("scrollType");
        if (mode.Equals("ToElement", StringComparison.OrdinalIgnoreCase) && !string.IsNullOrWhiteSpace(step.Selector))
        {
            var el = FindElement(driver, step, TimeSpan.FromSeconds(10));
            ((IJavaScriptExecutor)driver).ExecuteScript("arguments[0].scrollIntoView({block:'center'});", el);
            return StepOutcome.Success;
        }
        var amount = step.WaitMs ?? 500;
        // The extension scrolls the page by a pixel amount; "Bottom" asks for the end.
        if (mode.Equals("Bottom", StringComparison.OrdinalIgnoreCase))
            ((IJavaScriptExecutor)driver).ExecuteScript("window.scrollTo(0, document.body.scrollHeight);");
        else
            ((IJavaScriptExecutor)driver).ExecuteScript($"window.scrollBy(0, {amount});");
        return StepOutcome.Success;
    }

    private static StepOutcome DoAlertAccept(IWebDriver driver)
    {
        try
        {
            driver.SwitchTo().Alert().Accept();
            return StepOutcome.Success;
        }
        catch (NoAlertPresentException)
        {
            // No dialog is not a failure: the action is often used defensively after a save.
            return StepOutcome.Success;
        }
    }

    private static async Task<StepOutcome> DoWaitForLoadingAsync(
        IWebDriver driver, GraphNode step, TimeSpan timeout, CancellationToken ct)
    {
        var deadline = DateTime.UtcNow + timeout;
        while (DateTime.UtcNow < deadline)
        {
            ct.ThrowIfCancellationRequested();
            try
            {
                var state = (string)((IJavaScriptExecutor)driver)
                    .ExecuteScript("return document.readyState")!;
                if (string.Equals(state, "complete", StringComparison.OrdinalIgnoreCase))
                    return StepOutcome.Success;
            }
            catch { /* a navigating document throws; wait and retry */ }
            await Task.Delay(200, ct);
        }
        return StepOutcome.Success; // readyState never settling is not itself a step failure
    }

    // ---- Values ---------------------------------------------------------------------------------

    /// <summary>
    /// Read a value out of the page, for the actions that capture one (field value or text).
    /// </summary>
    public StepOutcome ReadElementValue(IWebDriver driver, GraphNode step, TimeSpan timeout)
    {
        try
        {
            var el = FindElement(driver, step, timeout);
            var text = ((IJavaScriptExecutor)driver).ExecuteScript(
                "const el=arguments[0];" +
                "if(el.tagName==='INPUT'||el.tagName==='TEXTAREA'||el.tagName==='SELECT')return el.value||'';" +
                "return (el.innerText||el.textContent||'').trim();",
                el) as string;
            return StepOutcome.Read(text ?? "");
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
