namespace Morobot.Domain.Enums;

/// <summary>How the process was primarily authored.</summary>
public enum TaskDesignOrigin
{
    Manual = 0,
    Recorded = 1,
    /// <summary>Imported from legacy Windows / old database.</summary>
    Transferred = 2
}
