namespace Morobot.Web.Areas.Admin.Models;

public sealed class AdminDashboardViewModel
{
    public int UserCount { get; init; }
    public int ActiveUserCount { get; init; }
    public int ProcessCount { get; init; }
    public int SourceCount { get; init; }
    public int PlanCount { get; init; }
    public int PlayingCount { get; init; }
    public int OnlineUserCount { get; init; }
    public int EventCount24h { get; init; }
    public string DefaultPlanCode { get; init; } = "";
    public string DefaultPlanName { get; init; } = "";
    public IReadOnlyList<AdminPlanStat> PlanStats { get; init; } = Array.Empty<AdminPlanStat>();
    public IReadOnlyList<AdminRecentEvent> RecentEvents { get; init; } = Array.Empty<AdminRecentEvent>();
}

public sealed class AdminPlanStat
{
    public string Code { get; init; } = "";
    public string Name { get; init; } = "";
    public int UserCount { get; init; }
    public bool IsActive { get; init; }
}

public sealed class AdminRecentEvent
{
    public DateTime CreatedAtUtc { get; init; }
    public string Level { get; init; } = "";
    public string Category { get; init; } = "";
    public string EventType { get; init; } = "";
    public string Message { get; init; } = "";
    public string? UserName { get; init; }
}
