namespace DynamicAutomator.Domain.Entities;

public class UserTaskAccess
{
    public int Id { get; set; }
    public int UserId { get; set; }
    public int TaskId { get; set; }
    public bool CanModify { get; set; }

    public AppUser User { get; set; } = null!;
    public AutomationTask Task { get; set; } = null!;
}
