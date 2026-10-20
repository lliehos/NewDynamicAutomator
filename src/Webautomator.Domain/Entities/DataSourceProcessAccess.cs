namespace Webautomator.Domain.Entities;

/// <summary>
/// One ProcessManager grant: this process may use this public data source.
/// </summary>
/// <remarks>
/// The grant is what the "دسترسی فرآیندها" dialog edits on the sources page, and it is deliberately
/// separate from <see cref="ProcessDataSource"/> (the actual attachment): a process can hold the
/// access without the source being attached yet — that is exactly the state a manager creates
/// before the process owner adds the source from the sources list. Adding a grant through the
/// dialog also attaches the source (and removing the grant detaches it), so the permission and the
/// usage stay visibly in step.
///
/// A public source with <see cref="DataSource.AllowAllProcesses"/> set bypasses this table for the
/// attach permission — any process may attach it — and every attach made under that blanket
/// permission records a row here anyway, so a manager can later narrow the list and see exactly
/// which processes to untick.
/// </remarks>
public class DataSourceProcessAccess
{
    public int DataSourceId { get; set; }
    public int ProcessId { get; set; }

    public DataSource? DataSource { get; set; }
    public Process? Process { get; set; }
}
