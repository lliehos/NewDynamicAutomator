using Markdig;

namespace Morobot.Web.Services;

public sealed class SetupGuideService
{
    private static readonly string RelativePath = Path.Combine("docs", "setup-guide.md");
    private readonly IWebHostEnvironment _env;
    private readonly ILogger<SetupGuideService> _log;

    public SetupGuideService(IWebHostEnvironment env, ILogger<SetupGuideService> log)
    {
        _env = env;
        _log = log;
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
