using Morobot.Domain.Enums;

namespace Morobot.Contracts.Auth;

public class LoginRequest
{
    public string UserName { get; set; } = string.Empty;
    public string Password { get; set; } = string.Empty;
    /// <summary>local | server. Default server for API; Panel form sets explicitly.</summary>
    public string Mode { get; set; } = "server";
    public DeviceFingerprintDto? Device { get; set; }
}

public class RegisterRequest
{
    public string UserName { get; set; } = string.Empty;
    public string Password { get; set; } = string.Empty;
    public string? ConfirmPassword { get; set; }
    public string? FirstName { get; set; }
    public string? LastName { get; set; }
    public string? Email { get; set; }
    public DeviceFingerprintDto? Device { get; set; }
}

/// <summary>Self-service plan upgrade (payment gateway later). Requires strong password for Pro/Gold.</summary>
public class UpgradePlanRequest
{
    /// <summary>Target plan: Pro or Gold.</summary>
    public string TargetPlan { get; set; } = nameof(PlanCode.Pro);
    public string CurrentPassword { get; set; } = string.Empty;
    public string NewPassword { get; set; } = string.Empty;
    public string? ConfirmPassword { get; set; }
}

public class DeviceFingerprintDto
{
    public string? FingerprintHash { get; set; }
    /// <summary>Stable across browsers on the same machine (no userAgent).</summary>
    public string? MachineFingerprint { get; set; }
    public string? BrowserFingerprint { get; set; }
    public string? UserAgent { get; set; }
    public string? Platform { get; set; }
    public string? Language { get; set; }
    public string? TimeZone { get; set; }
    public string? Screen { get; set; }
    public int? HardwareConcurrency { get; set; }
    public string? DetailsJson { get; set; }
}

public class ClientEventRequest
{
    public string Level { get; set; } = "Info";
    public string Category { get; set; } = "Client";
    public string EventType { get; set; } = string.Empty;
    public string Message { get; set; } = string.Empty;
    public string? DetailsJson { get; set; }
    public string? Path { get; set; }
    public DeviceFingerprintDto? Device { get; set; }
}

public class LoginResponse
{
    public string Token { get; set; } = string.Empty;
    public int UserId { get; set; }
    public string UserName { get; set; } = string.Empty;
    public string DisplayName { get; set; } = string.Empty;
    public string Role { get; set; } = nameof(UserRole.User);
    public EntitlementsDto Entitlements { get; set; } = new();
}

public class MeResponse
{
    public int UserId { get; set; }
    public string UserName { get; set; } = string.Empty;
    public bool IsAuthenticated { get; set; }
    public string Role { get; set; } = nameof(UserRole.User);
    public EntitlementsDto Entitlements { get; set; } = new();
}

public class EntitlementsDto
{
    public string PlanCode { get; set; } = nameof(Domain.Enums.PlanCode.Local);
    public string PlanNameFa { get; set; } = "محلی";
    public string PlanNameEn { get; set; } = "Local";
    public bool IsLocal { get; set; } = true;
    public bool CanPlay { get; set; }
    public bool CanSelector { get; set; }
    public bool CanRecord { get; set; }
    public bool CanSmart { get; set; }
    public bool CanShare { get; set; }
    public bool CanReceiveShare { get; set; } = true;
    public int? MaxSharesPerTask { get; set; }
    public bool ShareAllowView { get; set; } = true;
    public bool ShareAllowEdit { get; set; }
    public bool ShareAllowDelete { get; set; }
    public bool ShareAllowExecute { get; set; }
    public bool ShareAllowChangeDataSource { get; set; }
    /// <summary>Null = unlimited.</summary>
    public int? MaxTasks { get; set; } = 1;
    /// <summary>Null = unlimited.</summary>
    public int? MaxDataSources { get; set; } = 1;
    /// <summary>Max step/action nodes per process. Null = unlimited.</summary>
    public int? MaxProcessSteps { get; set; }
    /// <summary>
    /// Row ceiling for one data source. Null = unlimited. This is the effective value: the plan's
    /// own cap lowered to the signed license's ceiling, so it can never exceed what was licensed.
    /// </summary>
    public int? MaxSourceRows { get; set; }
    /// <summary>Byte ceiling for one data source's content. Null = unlimited.</summary>
    public long? MaxSourceBytes { get; set; }
    /// <summary>
    /// True when the ceiling came from the license rather than the plan — the UI uses this to say
    /// "بنا به لایسنس" (because of the license) instead of blaming the plan.
    /// </summary>
    public bool SourceLimitFromLicense { get; set; }
    public int? TaskCount { get; set; }
    public int? DataSourceCount { get; set; }
    public DateTime? PlanExpiresAtUtc { get; set; }
}
