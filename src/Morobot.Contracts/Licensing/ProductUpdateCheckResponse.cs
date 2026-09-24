namespace Morobot.Contracts.Licensing;

/// <summary>Public JSON from GET /checkupdate?current=…</summary>
public sealed class ProductUpdateCheckResponse
{
    public string Version { get; set; } = "";
    public string? Notes { get; set; }
    public string? DownloadUrl { get; set; }
    public bool UpdateAvailable { get; set; }
    public string? Current { get; set; }
    public DateTime? PublishedUtc { get; set; }
}
