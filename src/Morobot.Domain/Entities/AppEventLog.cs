namespace Morobot.Domain.Entities;

public class AppEventLog
{
    public long Id { get; set; }
    public int? UserId { get; set; }
    public string? UserName { get; set; }
    /// <summary>Info | Warn | Error | Audit</summary>
    public string Level { get; set; } = "Info";
    /// <summary>Auth | Task | Source | Play | Record | Client | System</summary>
    public string Category { get; set; } = "System";
    public string EventType { get; set; } = string.Empty;
    public string Message { get; set; } = string.Empty;
    public string? DetailsJson { get; set; }
    public string? FingerprintHash { get; set; }
    public string? Path { get; set; }
    public string? IpAddress { get; set; }
    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;

    public AppUser? User { get; set; }
}
