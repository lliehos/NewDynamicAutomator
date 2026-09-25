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

    /// <summary>Per-day counts for the trailing window, oldest first — chart-ready.</summary>
    public IReadOnlyList<AdminDailyPoint> DailyActivity { get; init; } = Array.Empty<AdminDailyPoint>();
    /// <summary>Event counts split by level over the same window.</summary>
    public IReadOnlyList<AdminLevelStat> EventLevels { get; init; } = Array.Empty<AdminLevelStat>();
    /// <summary>Top process owners by process count.</summary>
    public IReadOnlyList<AdminTopUser> TopProcessOwners { get; init; } = Array.Empty<AdminTopUser>();
    /// <summary>Runs (play sessions) started in the trailing window.</summary>
    public int Plays7d { get; init; }
    /// <summary>Processes created in the trailing window.</summary>
    public int Processes7d { get; init; }
    /// <summary>Error + warn events in the trailing window.</summary>
    public int ProblemEvents7d { get; init; }
    public IReadOnlyList<string> DailyActivityLabels { get; init; } = Array.Empty<string>();
}

/// <summary>One bucket of the activity chart.</summary>
public sealed class AdminDailyPoint
{
    public string Label { get; init; } = "";
    public int Events { get; init; }
    public int Processes { get; init; }
    public int Plays { get; init; }
    public int Signups { get; set; }
    public int NewDevices { get; set; }
}

public sealed class AdminLevelStat
{
    public string Level { get; init; } = "";
    public int Count { get; init; }
}

public sealed class AdminTopUser
{
    public string UserName { get; init; } = "";
    public int ProcessCount { get; init; }
    public int SourceCount { get; init; }
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
