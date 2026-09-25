using Morobot.Domain.Enums;

namespace Morobot.Domain.Entities;

public class Plan
{
    public int Id { get; set; }
    /// <summary>Stable key e.g. Local, Free, Pro, Gold (or custom).</summary>
    public string Code { get; set; } = nameof(PlanCode.Free);
    public string NameFa { get; set; } = string.Empty;
    public string NameEn { get; set; } = string.Empty;
    /// <summary>Null = unlimited.</summary>
    public int? MaxTasks { get; set; }
    /// <summary>Null = unlimited.</summary>
    public int? MaxDataSources { get; set; }
    /// <summary>Max step/action nodes per process graph. Null = unlimited.</summary>
    public int? MaxProcessSteps { get; set; }
    /// <summary>
    /// Most rows one data source may hold on this plan. Null = unlimited. The admin sets this, but
    /// the effective ceiling is always the lower of this and the signed license's cap.
    /// </summary>
    public int? MaxSourceRows { get; set; }
    /// <summary>
    /// Largest content (bytes) one data source may hold on this plan. Null = unlimited. Same
    /// license-vs-plan lowering rule as <see cref="MaxSourceRows"/>.
    /// </summary>
    public long? MaxSourceBytes { get; set; }
    public bool CanPlay { get; set; }
    public bool CanSelector { get; set; }
    public bool CanRecord { get; set; }
    public bool CanSmart { get; set; }
    public bool IsActive { get; set; } = true;
    public int SortOrder { get; set; }

    /// <summary>Minimum password length required for this plan.</summary>
    public int MinPasswordLength { get; set; } = 3;
    /// <summary>When true, password must include at least one letter and one digit.</summary>
    public bool RequireLetterAndDigit { get; set; }
    /// <summary>User may self-upgrade to this plan (subject to password policy).</summary>
    public bool AllowSelfUpgrade { get; set; }

    /// <summary>May share processes with other users (not Local/guest).</summary>
    public bool CanShare { get; set; }
    /// <summary>May appear as a share recipient (searchable / grantable).</summary>
    public bool CanReceiveShare { get; set; } = true;
    /// <summary>Null = unlimited recipients per task.</summary>
    public int? MaxSharesPerTask { get; set; }
    public bool ShareAllowView { get; set; } = true;
    public bool ShareAllowEdit { get; set; }
    public bool ShareAllowDelete { get; set; }
    public bool ShareAllowExecute { get; set; }
    public bool ShareAllowChangeDataSource { get; set; }

    public ICollection<PlanPrice> Prices { get; set; } = new List<PlanPrice>();
    public ICollection<AppUser> Users { get; set; } = new List<AppUser>();
}
