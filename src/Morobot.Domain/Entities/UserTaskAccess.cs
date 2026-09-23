namespace Morobot.Domain.Entities;

public class UserTaskAccess
{
    public int Id { get; set; }
    public int UserId { get; set; }
    public int TaskId { get; set; }

    /// <summary>Legacy; kept in sync with CanEdit.</summary>
    public bool CanModify { get; set; }

    public bool CanView { get; set; } = true;
    public bool CanEdit { get; set; }
    public bool CanDelete { get; set; }
    public bool CanExecute { get; set; }
    public bool CanChangeDataSource { get; set; }

    public DateTime GrantedAtUtc { get; set; } = DateTime.UtcNow;
    public int? GrantedByUserId { get; set; }

    public AppUser User { get; set; } = null!;
    public AutomationTask Task { get; set; } = null!;
}
