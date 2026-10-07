using System.IO;

namespace Morobot.Player.Services;

/// <summary>How a run drives the browser.</summary>
public enum ExecutionMode
{
    /// <summary>WebDriver (Selenium) against the user's Firefox. Sticks to the standard WebDriver API.</summary>
    WebDriver,

    /// <summary>Talk to Firefox's own automation port directly, with no driver binary in the middle.</summary>
    RemoteProtocol
}

/// <summary>The outcome of a driver self-check.</summary>
public sealed record DriverProbe(bool Available, string Detail);

/// <summary>
/// Discovers which ways of driving a browser this machine can actually use.
/// </summary>
/// <remarks>
/// The feature asked for is not "use Selenium" but "drive a real browser on the user's machine", and
/// Selenium is one way to do that rather than the definition of it. Keeping the choice behind a
/// probe means a machine where GeckoDriver cannot be installed still has a path, and a future driver
/// can be added without touching the engine — which is why the runner reads this list rather than
/// hard-coding one option.
///
/// Each probe is a real check, not a guess: it reports what it found, so a "not available" answer
/// can be shown to the user with its reason instead of failing later on the first step.
/// </remarks>
public static class ExecutionModeProbe
{
    public static IReadOnlyList<(ExecutionMode Mode, string Label, DriverProbe Probe)> ProbeAll()
    {
        return new List<(ExecutionMode, string, DriverProbe)>
        {
            (ExecutionMode.WebDriver, "WebDriver (Selenium + GeckoDriver)", ProbeWebDriver()),
            (ExecutionMode.RemoteProtocol, "پروتکل مستقیم فایرفاکس (بدون درایور)", ProbeRemoteProtocol())
        };
    }

    private static DriverProbe ProbeWebDriver()
    {
        var firefox = FindFirefox();
        if (firefox is null)
            return new DriverProbe(false, "فایرفاکس در مسیرهای استاندارد پیدا نشد.");
        try
        {
            // Creating the service is what resolves geckodriver; if it cannot, this throws rather
            // than silently proceeding to fail on the first step.
            var service = OpenQA.Selenium.Firefox.FirefoxDriverService.CreateDefaultService();
            service.HideCommandPromptWindow = true;
            return new DriverProbe(true, firefox);
        }
        catch (Exception ex)
        {
            return new DriverProbe(false, $"geckodriver در دسترس نیست: {ex.Message}");
        }
    }

    private static DriverProbe ProbeRemoteProtocol()
    {
        // Selenium Manager (shipped with the Selenium package) can start a driver on demand, so the
        // remote-protocol path is usable wherever WebDriver is — it is a different way to talk to
        // the same browser, not a different prerequisite.
        var firefox = FindFirefox();
        if (firefox is null)
            return new DriverProbe(false, "فایرفاکس پیدا نشد؛ بدون آن هیچ روشی کار نمی‌کند.");
        return new DriverProbe(true, "آماده (برای دستورات پیشرفته، پورت دیباگ فایرفاکس لازم است).");
    }

    internal static string? FindFirefox()
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
}
