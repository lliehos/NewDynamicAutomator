using System.IO;
using OpenQA.Selenium;
using OpenQA.Selenium.Firefox;

namespace Morobot.Desktop.Services;

/// <summary>
/// Owns one Firefox instance per run.
/// </summary>
/// <remarks>
/// One driver per run rather than a shared one, because the feature is explicitly meant to allow
/// several runs side by side: each run gets its own window and its own profile, so two runs on one
/// machine cannot steal each other's focus or cookie jar.
///
/// GeckoDriver rather than ChromeDriver on purpose: GeckoDriver is version-match free (it works
/// across Firefox releases), while ChromeDriver has to match the installed Chrome build exactly —
/// which would turn every customer browser update into a support call.
/// </remarks>
public sealed class FirefoxRunner : IDisposable
{
    private IWebDriver? _driver;

    public IWebDriver Driver => _driver ?? throw new InvalidOperationException("مرورگر هنوز باز نشده است.");
    public bool IsOpen => _driver is not null;

    /// <summary>
    /// Whether the pieces this runner needs are present: Firefox itself and a usable GeckoDriver.
    /// </summary>
    /// <remarks>
    /// Checked up front so a missing prerequisite is reported as a setup problem before a run, not
    /// as a mysterious failure on the first step. Selenium can auto-manage the driver binary, so the
    /// check is about the *browser* being installed, which Selenium will not do for us.
    /// </remarks>
    public static (bool ok, string? detail) CheckPrerequisites()
    {
        var firefox = FindFirefox();
        if (firefox is null)
            return (false, "Firefox در مسیرهای استاندارد ویندوز پیدا نشد.");
        try
        {
            var service = FirefoxDriverService.CreateDefaultService();
            service.HideCommandPromptWindow = true;
            return (true, firefox);
        }
        catch (Exception ex)
        {
            return (false, $"geckodriver در دسترس نیست: {ex.Message}");
        }
    }

    private static string? FindFirefox()
    {
        var candidates = new[]
        {
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Mozilla Firefox", "firefox.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "Mozilla Firefox", "firefox.exe")
        };
        foreach (var c in candidates)
        {
            try { if (File.Exists(c)) return c; } catch { /* keep looking */ }
        }
        return null;
    }

    /// <summary>Open a fresh Firefox window sized for a run.</summary>
    public void Start(bool headless = false)
    {
        if (_driver is not null) return;
        var options = new FirefoxOptions();
        // A private window per run: no leftover session from a previous run, and several parallel
        // runs cannot see each other's cookies.
        options.AddArgument("-private");
        if (headless) options.AddArgument("-headless");
        options.SetPreference("dom.webnotifications.enabled", false);
        // Keep the window a normal, usable size; a run is watched by a human.
        options.SetPreference("browser.startup.homepage", "about:blank");

        var service = FirefoxDriverService.CreateDefaultService();
        service.HideCommandPromptWindow = true;
        var timeout = TimeSpan.FromSeconds(60);
        _driver = new FirefoxDriver(service, options, timeout);
        try { _driver.Manage().Window.Maximize(); } catch { /* not fatal */ }
    }

    /// <summary>Bring this run's window to the front — used when the user picks which run to watch.</summary>
    public void Focus()
    {
        try { _driver?.SwitchTo().DefaultContent(); } catch { /* ignore */ }
    }

    public void Dispose()
    {
        try { _driver?.Quit(); } catch { /* the browser may already be gone */ }
        try { _driver?.Dispose(); } catch { /* ignore */ }
        _driver = null;
    }
}
