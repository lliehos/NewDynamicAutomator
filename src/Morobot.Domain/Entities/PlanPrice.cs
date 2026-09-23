namespace Morobot.Domain.Entities;

public class PlanPrice
{
    public int Id { get; set; }
    public int PlanId { get; set; }
    public decimal Amount { get; set; }
    public string Currency { get; set; } = "IRR";
    /// <summary>Billing interval label, e.g. monthly / yearly / lifetime.</summary>
    public string Interval { get; set; } = "monthly";
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;
    public string? Notes { get; set; }

    public Plan Plan { get; set; } = null!;
}
