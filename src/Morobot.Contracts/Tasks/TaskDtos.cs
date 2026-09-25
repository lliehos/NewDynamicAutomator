namespace Morobot.Contracts.Tasks;

public class TaskListItemDto
{
    public int Id { get; set; }
    public string Title { get; set; } = string.Empty;
    public DateTime CreatedAtUtc { get; set; }
    public int GroupCount { get; set; }
    public int StepCount { get; set; }
    public int DataSourceCount { get; set; }
    public bool CanModify { get; set; }
    public bool CanView { get; set; } = true;
    public bool CanEdit { get; set; }
    public bool CanDelete { get; set; }
    public bool CanExecute { get; set; }
    public bool CanChangeDataSource { get; set; }
    public bool CanShare { get; set; }
    public bool IsOwner { get; set; }
    /// <summary>Manual or Recorded</summary>
    public string DesignOrigin { get; set; } = "Manual";
    public string? OwnerUserName { get; set; }
    public int SharedWithCount { get; set; }
    /// <summary>Last canvas/process save (UTC).</summary>
    public DateTime? UpdatedAtUtc { get; set; }
    public string? LastEditorUserName { get; set; }
    /// <summary>Latest cell/metadata change on any linked library source (UTC).</summary>
    public DateTime? DataUpdatedAtUtc { get; set; }
    public string? DataLastEditorUserName { get; set; }

    /// <summary>
    /// When this process was last started and by whom, taken from the recorded play events.
    /// Null when it has never been run, which is different from "run but we lost the record" -
    /// play starts are written to the event log, so the absence means it really has not run.
    /// </summary>
    public DateTime? LastPlayedAtUtc { get; set; }
    public string? LastPlayedByUserName { get; set; }
    /// <summary>How many times this process has been started, from the same records.</summary>
    public int PlayCount { get; set; }
}

/// <summary>One recorded run of a process, for the run-history list.</summary>
public class TaskRunEntry
{
    public DateTime AtUtc { get; set; }
    public string? UserName { get; set; }
}

public class CreateTaskRequest
{
    public string Title { get; set; } = string.Empty;
    public int DelayBeforeMs { get; set; }
    public int DelayAfterMs { get; set; }
    public bool UseGlobalDataSources { get; set; }
    /// <summary>Manual (default) or Recorded</summary>
    public string? DesignOrigin { get; set; }
}

public class UpdateTaskTitleRequest
{
    public string? Title { get; set; }
    public string? EditorSessionId { get; set; }
}

public class TaskShareDto
{
    public int UserId { get; set; }
    public string UserName { get; set; } = string.Empty;
    public string? DisplayName { get; set; }
    public string? Email { get; set; }
    public string? NationalId { get; set; }
    public bool CanView { get; set; } = true;
    public bool CanEdit { get; set; }
    public bool CanDelete { get; set; }
    public bool CanExecute { get; set; }
    public bool CanChangeDataSource { get; set; }
    public bool IsOwner { get; set; }
    public DateTime GrantedAtUtc { get; set; }
}

public class UpsertTaskShareRequest
{
    public int UserId { get; set; }
    public bool CanView { get; set; } = true;
    public bool CanEdit { get; set; }
    public bool CanDelete { get; set; }
    public bool CanExecute { get; set; }
    public bool CanChangeDataSource { get; set; }
}

public class UserSearchHitDto
{
    public int UserId { get; set; }
    public string UserName { get; set; } = string.Empty;
    public string? FirstName { get; set; }
    public string? LastName { get; set; }
    public string? DisplayName { get; set; }
    public string? Email { get; set; }
    public string? NationalId { get; set; }
}
