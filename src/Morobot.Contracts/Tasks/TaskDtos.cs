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

    /// <summary>
    /// The template this process inherits from, or null when it stands alone. Present so the list
    /// can show which template a row came from and offer the detach action.
    /// </summary>
    public int? TemplateId { get; set; }
    public string? TemplateTitle { get; set; }

    /// <summary>
    /// True when the template has been published since this process last inherited it. The list
    /// flags these rows so an author can pull in the fix rather than discovering it by comparing
    /// diagrams.
    /// </summary>
    public bool TemplateBehind { get; set; }
}

/// <summary>One template in the template menus, with the counts the picker shows.</summary>
public class ProcessTemplateDto
{
    public int Id { get; set; }
    public string Title { get; set; } = string.Empty;
    public string? Description { get; set; }
    public int Version { get; set; }
    public DateTime UpdatedAtUtc { get; set; }
    public string? CreatorUserName { get; set; }
    /// <summary>How many processes are still attached to it.</summary>
    public int AttachedProcessCount { get; set; }
    public int GroupCount { get; set; }
    public int StepCount { get; set; }
    /// <summary>
    /// Whether the caller may create, publish or retire templates. Everyone may still *use* a
    /// template; this only governs shaping the shared skeletons, so the management actions can be
    /// hidden rather than shown and then refused.
    /// </summary>
    public bool CanManage { get; set; }
}

/// <summary>Create a template from an existing process, or publish an edit to an existing one.</summary>
public class SaveTemplateRequest
{
    public string Title { get; set; } = string.Empty;
    public string? Description { get; set; }
    /// <summary>Publish the template's graph to every process still attached to it.</summary>
    public bool PushToAttached { get; set; } = true;
}

/// <summary>Create a process from a template. Source links are deliberately not copied.</summary>
public class CreateFromTemplateRequest
{
    public string Title { get; set; } = string.Empty;
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
