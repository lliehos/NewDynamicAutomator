namespace Morobot.Domain.Entities;

/// <summary>Per-user ACL on a process (table ProcessShares).</summary>
public class ProcessShare
{
    public int Id { get; set; }
    public int UserId { get; set; }
    public int ProcessId { get; set; }

    public bool CanView { get; set; } = true;
    public bool CanEdit { get; set; }
    public bool CanDelete { get; set; }
    public bool CanExecute { get; set; }
    public bool CanChangeDataSource { get; set; }

    public DateTime GrantedAtUtc { get; set; } = DateTime.UtcNow;
    public int? GrantedByUserId { get; set; }

    public AppUser User { get; set; } = null!;
    public Process Process { get; set; } = null!;
}
