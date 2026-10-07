using System.ComponentModel;
using System.Runtime.CompilerServices;
using System.Windows;

namespace Morobot.Desktop.Models;

/// <summary>One process as the desktop list needs it: enough to show a row and start a run.</summary>
public sealed class ProcessRow : INotifyPropertyChanged
{
    private bool _runOnServer = true;
    private bool _localRunPendingSync;

    public int Id { get; set; }
    public string Title { get; set; } = "";
    public int StepCount { get; set; }
    public int GroupCount { get; set; }
    public int DataSourceCount { get; set; }
    public DateTime? UpdatedAtUtc { get; set; }
    public bool CanExecute { get; set; } = true;
    public bool CanEdit { get; set; }

    /// <summary>
    /// Whether runs for this process are managed on the server. Mirrors the panel's per-process
    /// switch, so the same process behaves the same way whichever client starts it.
    /// </summary>
    public bool RunOnServer
    {
        get => _runOnServer;
        set { if (_runOnServer == value) return; _runOnServer = value; OnChanged(); OnChanged(nameof(RunModeLabel)); }
    }

    /// <summary>Set when a local run's results have not been pushed to the server yet.</summary>
    public bool LocalRunPendingSync
    {
        get => _localRunPendingSync;
        set
        {
            if (_localRunPendingSync == value) return;
            _localRunPendingSync = value;
            OnChanged();
            OnChanged(nameof(SyncVisibility));
        }
    }

    /// <summary>The Sync button only exists once a local run has something to push.</summary>
    public Visibility SyncVisibility => LocalRunPendingSync ? Visibility.Visible : Visibility.Collapsed;

    public string StepsLabel => StepCount.ToString();
    public string GroupsLabel => GroupCount.ToString();
    public string SourcesLabel => DataSourceCount.ToString();
    public string LastRunLabel => UpdatedAtUtc?.ToLocalTime().ToString("yyyy/MM/dd HH:mm") ?? "—";
    public string RunModeLabel => RunOnServer ? "سرور" : "محلی";

    public event PropertyChangedEventHandler? PropertyChanged;

    private void OnChanged([CallerMemberName] string? name = null)
        => PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
