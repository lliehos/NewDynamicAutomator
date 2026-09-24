using Markdig;

namespace Morobot.Web.Services;

public sealed class SetupGuideService
{
    private static readonly string RelativePath = Path.Combine("docs", "setup-guide.md");
    private readonly IWebHostEnvironment _env;
    private readonly ILogger<SetupGuideService> _log;
    private readonly IHttpContextAccessor _http;

    public SetupGuideService(IWebHostEnvironment env, ILogger<SetupGuideService> log, IHttpContextAccessor http)
    {
        _env = env;
        _log = log;
        _http = http;
    }

    public async Task<SetupGuideDocument?> LoadAsync(CancellationToken ct = default)
    {
        var path = ResolveGuidePath();
        if (path is null || !File.Exists(path))
        {
            _log.LogWarning("Setup guide not found. Expected docs/setup-guide.md in content root or repo docs/.");
            return null;
        }

        var markdown = await File.ReadAllTextAsync(path, ct);
        // The vendor-authored guide ships with the stock product name; rebrand it for the
        // tenant's screen without touching the source document on disk.
        markdown = RebrandForDisplay(markdown);
        var pipeline = new MarkdownPipelineBuilder()
            .UseAdvancedExtensions()
            .Build();
        var html = Markdown.ToHtml(markdown, pipeline);
        var modified = File.GetLastWriteTimeUtc(path);

        return new SetupGuideDocument
        {
            RawMarkdown = markdown,
            HtmlBody = html,
            SourcePath = path,
            LastUpdatedUtc = modified
        };
    }

    /// <summary>Swaps the stock product name for the tenant's Admin → Branding name.</summary>
    private string RebrandForDisplay(string markdown)
    {
        var ctx = _http.HttpContext;
        var brand = (ctx?.Items[Models.BrandHeadModel.ItemKey] as Models.BrandHeadModel)?.AppName;
        if (string.IsNullOrWhiteSpace(brand)) return markdown;
        if (string.Equals(brand, "Morobot", StringComparison.OrdinalIgnoreCase)) return markdown;

        return markdown
            .Replace("Morobot", brand, StringComparison.Ordinal)
            .Replace("مروبات", brand, StringComparison.Ordinal)
            // Undo the double substitution when the brand itself contains the stock token.
            .Replace($"{brand} {brand}", brand, StringComparison.Ordinal);
    }

    private string? ResolveGuidePath()
    {
        var candidates = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            Path.Combine(_env.ContentRootPath, RelativePath),
            Path.Combine(AppContext.BaseDirectory, RelativePath),
            Path.GetFullPath(Path.Combine(_env.ContentRootPath, "..", "..", "docs", "setup-guide.md")),
            Path.GetFullPath(Path.Combine(_env.ContentRootPath, "..", "docs", "setup-guide.md")),
            Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "docs", "setup-guide.md"))
        };

        var dir = _env.ContentRootPath;
        for (var depth = 0; depth < 6 && !string.IsNullOrEmpty(dir); depth++)
        {
            candidates.Add(Path.Combine(dir, "docs", "setup-guide.md"));
            dir = Directory.GetParent(dir)?.FullName;
        }

        foreach (var path in candidates)
        {
            if (!File.Exists(path))
                continue;

            _log.LogInformation("Setup guide loaded from {Path}", path);
            return path;
        }

        _log.LogWarning(
            "Setup guide not found. Searched under ContentRoot={ContentRoot} and BaseDirectory={BaseDirectory}",
            _env.ContentRootPath,
            AppContext.BaseDirectory);
        return null;
    }
}

public sealed class SetupGuideDocument
{
    public string RawMarkdown { get; init; } = "";
    public string HtmlBody { get; init; } = "";
    public string SourcePath { get; init; } = "";
    public DateTime LastUpdatedUtc { get; init; }
}
