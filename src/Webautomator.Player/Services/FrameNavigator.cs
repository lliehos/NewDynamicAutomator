using System.Text.Json;
using System.Text.Json.Serialization;
using OpenQA.Selenium;
using Webautomator.Player.Models;

namespace Webautomator.Player.Services;

/// <summary>
/// Drives the browser into the frame chain a node recorded, and back out again.
/// </summary>
/// <remarks>
/// Port of <c>resolveFramePath</c> in engine.js. The canvas stores one hop per level
/// (<c>framePathJson</c>): the iframe's CSS selector, the child frame's src as a hint, and its
/// position among the parent's frames. Inside a hop the order is selector → src hint → index,
/// which is the order the recorder builds them in, so a page that moved its iframe still lands in
/// the right document as long as one of the three still holds.
///
/// Selenium switches into frames one at a time, so the whole chain is walked from the top document
/// for each step and the scope restores the top document afterwards — a step never leaves the
/// driver "inside" a frame, which is what the extension's per-action frame resolution amounts to.
/// </remarks>
internal static class FrameNavigator
{
    private static readonly JsonSerializerOptions HopJson = new() { PropertyNameCaseInsensitive = true };

    /// <summary>
    /// Switch into the node's frame path and return a scope that restores the top document.
    /// </summary>
    /// <remarks>
    /// ONE attempt per hop, deliberately: the caller's wait loop re-runs "resolve the frame chain +
    /// look up the element" every 200ms, exactly as engine.js does, so a retry here would only hide
    /// the budget from the code that owns it.
    /// </remarks>
    /// <exception cref="FrameNotResolvedException">A hop's frame is not in the page yet.</exception>
    public static IDisposable Enter(IWebDriver driver, GraphNode node)
    {
        var hops = Parse(node);
        // Always start from the top: a previous step's frame scope has already restored it, and a
        // node with no hops must be evaluated in the page itself rather than wherever the driver was.
        SafeDefaultContent(driver);
        if (hops.Count == 0) return new Scope(driver);

        foreach (var hop in hops)
            EnterHop(driver, hop);
        return new Scope(driver);
    }

    /// <summary>The frame chain a node recorded, in outer-to-inner order.</summary>
    public static List<Hop> Parse(GraphNode node)
    {
        if (!node.Extra.TryGetValue("framePathJson", out var raw)) return new List<Hop>();
        try
        {
            if (raw.ValueKind == JsonValueKind.Array)
                return raw.Deserialize<List<Hop>>(HopJson) ?? new List<Hop>();
            if (raw.ValueKind == JsonValueKind.String)
            {
                var json = raw.GetString();
                if (string.IsNullOrWhiteSpace(json)) return new List<Hop>();
                return JsonSerializer.Deserialize<List<Hop>>(json!, HopJson) ?? new List<Hop>();
            }
        }
        catch { /* a damaged path is treated as "top document" rather than failing the step */ }
        return new List<Hop>();
    }

    /// <summary>Find one hop's iframe and switch into it.</summary>
    private static void EnterHop(IWebDriver driver, Hop hop)
    {
        IWebElement frame;
        try
        {
            frame = FindFrame(driver, hop)
                ?? throw new FrameNotResolvedException($"فریم پیدا نشد: {Describe(hop)}");
            driver.SwitchTo().Frame(frame);
        }
        catch (FrameNotResolvedException) { throw; }
        catch (Exception ex)
        {
            // A frame that exists in the DOM but is not attached yet throws from Selenium; it is
            // the same "not there yet" case and deserves the same retry.
            throw new FrameNotResolvedException($"فریم هدف باز نشد ({Describe(hop)}): {ex.Message}", ex);
        }
    }

    private static IWebElement? FindFrame(IWebDriver driver, Hop hop)
    {
        var frames = driver.FindElements(By.CssSelector("iframe, frame"));

        if (!string.IsNullOrWhiteSpace(hop.Value))
        {
            try
            {
                var bySelector = driver.FindElements(By.CssSelector(hop.Value))
                    .FirstOrDefault(IsFrame);
                if (bySelector is not null) return bySelector;
            }
            catch (InvalidSelectorException) { /* the recorded selector no longer parses; try the hints */ }
        }

        if (!string.IsNullOrWhiteSpace(hop.SrcHint))
        {
            var hint = hop.SrcHint!;
            var bySource = frames.FirstOrDefault(f =>
            {
                var src = f.GetDomAttribute("src") ?? "";
                return src.Length > 0
                       && (string.Equals(src, hint, StringComparison.Ordinal)
                           || hint.Contains(src, StringComparison.Ordinal)
                           || src.Contains(hint, StringComparison.Ordinal));
            });
            if (bySource is not null) return bySource;
        }

        if (hop.IndexInParent is int index && index >= 0 && index < frames.Count)
            return frames[index];

        return null;
    }

    private static bool IsFrame(IWebElement element)
    {
        try
        {
            var tag = element.TagName;
            return string.Equals(tag, "iframe", StringComparison.OrdinalIgnoreCase)
                   || string.Equals(tag, "frame", StringComparison.OrdinalIgnoreCase);
        }
        catch { return false; }
    }

    private static string Describe(Hop hop)
        => !string.IsNullOrWhiteSpace(hop.Value) ? hop.Value!
            : !string.IsNullOrWhiteSpace(hop.SrcHint) ? hop.SrcHint!
            : hop.IndexInParent?.ToString() ?? "?";

    private static void SafeDefaultContent(IWebDriver driver)
    {
        try { driver.SwitchTo().DefaultContent(); } catch { /* the window may be gone */ }
    }

    /// <summary>One level of the recorded frame chain.</summary>
    public sealed class Hop
    {
        [JsonPropertyName("by")] public string? By { get; set; }
        [JsonPropertyName("value")] public string? Value { get; set; }
        [JsonPropertyName("srcHint")] public string? SrcHint { get; set; }
        [JsonPropertyName("indexInParent")] public int? IndexInParent { get; set; }
    }

    /// <summary>Leaves the driver in the top document of the current window.</summary>
    private sealed class Scope : IDisposable
    {
        private readonly IWebDriver _driver;
        public Scope(IWebDriver driver) => _driver = driver;

        public void Dispose()
        {
            // A step may have switched or closed windows; DefaultContent still applies to whatever
            // window is current, and a closed window simply throws here and is ignored.
            SafeDefaultContent(_driver);
        }
    }
}

/// <summary>
/// A frame in the recorded chain is not in the page (yet).
/// </summary>
/// <remarks>
/// Distinct type because the runner retries exactly this case — and only this case — while the
/// step's wait budget lasts.
/// </remarks>
public sealed class FrameNotResolvedException : Exception
{
    public FrameNotResolvedException(string message, Exception? inner = null) : base(message, inner) { }
}
