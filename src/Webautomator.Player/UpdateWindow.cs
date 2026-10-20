using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using Webautomator.Player.Services;

namespace Webautomator.Player;

/// <summary>
/// The in-app update page: shows the new version, applies it, and restarts the app.
/// </summary>
/// <remarks>
/// A page of its own rather than a MessageBox, for the same reason the rest of the app draws its
/// own chrome: the update is a multi-step operation (download, verify, hand off, restart) and the
/// user should watch it happen in the product's own window, with the same close button every other
/// form has — not in a system dialog that cannot show progress.
///
/// The update is applied automatically on open: reaching this window already means the user chose
/// it from the notification, so a second "are you sure" step would only be ceremony. Closing the
/// window before it finishes cancels the download.
/// </remarks>
public sealed class UpdateWindow : Window
{
    private readonly string _serverBase;
    private readonly UpdateInfo _info;
    private readonly ProgressBar _progress;
    private readonly TextBlock _status;
    private readonly Button _close;

    public UpdateWindow(string serverBase, UpdateInfo info)
    {
        _serverBase = serverBase;
        _info = info;
        Width = 460;
        SizeToContent = SizeToContent.Height;
        WindowStyle = WindowStyle.None;
        ResizeMode = ResizeMode.NoResize;
        WindowStartupLocation = WindowStartupLocation.CenterOwner;
        FlowDirection = FlowDirection.RightToLeft;
        Background = new SolidColorBrush(Color.FromRgb(0xF7, 0xF7, 0xFB));
        Title = "به‌روزرسانی";

        var root = new StackPanel { Margin = new Thickness(20) };

        // In-form title bar: this form, like every other, carries its own chrome.
        var titleBar = new DockPanel { LastChildFill = false, Margin = new Thickness(0, 0, 0, 14) };
        titleBar.MouseLeftButtonDown += (_, _) => { try { DragMove(); } catch { /* not pressed on chrome */ } };
        _close = new Button
        {
            Content = "✕",
            Width = 30,
            Height = 26,
            HorizontalAlignment = HorizontalAlignment.Left,
            Background = Brushes.Transparent,
            BorderThickness = new Thickness(0),
            Cursor = Cursors.Hand
        };
        _close.Click += (_, _) => Close();
        DockPanel.SetDock(_close, Dock.Left);
        titleBar.Children.Add(_close);
        titleBar.Children.Add(new TextBlock
        {
            Text = "به‌روزرسانی برنامه",
            FontSize = 15,
            FontWeight = FontWeights.Bold,
            VerticalAlignment = VerticalAlignment.Center
        });
        root.Children.Add(titleBar);

        root.Children.Add(new TextBlock
        {
            Text = $"نسخهٔ جدید {info.Version} در حال نصب است (نسخهٔ فعلی {UpdateService.CurrentVersion}).\n" +
                   "پس از پایان، برنامه به‌صورت خودکار دوباره باز می‌شود.",
            TextWrapping = TextWrapping.Wrap,
            Margin = new Thickness(0, 0, 0, 14),
            Foreground = new SolidColorBrush(Color.FromRgb(0x5E, 0x58, 0x73))
        });

        _progress = new ProgressBar { Height = 10, Minimum = 0, Maximum = 100 };
        root.Children.Add(_progress);

        _status = new TextBlock
        {
            Margin = new Thickness(0, 10, 0, 0),
            TextWrapping = TextWrapping.Wrap,
            Foreground = new SolidColorBrush(Color.FromRgb(0x5E, 0x58, 0x73))
        };
        root.Children.Add(_status);

        Content = new Border { Background = Brushes.White, CornerRadius = new CornerRadius(10), Child = root };
        Loaded += async (_, _) => await ApplyAsync();
    }

    private async Task ApplyAsync()
    {
        _close.IsEnabled = false;
        _status.Text = "در حال دانلود…";
        var progress = new Progress<int>(p =>
        {
            _progress.Value = p;
            _status.Text = $"در حال دانلود… {p}%";
        });

        var downloadUrl = _info.DownloadUrl ?? "/desktop/download";
        var (ok, newExe, error) = await UpdateService.DownloadAndStageAsync(_serverBase, downloadUrl, progress);
        if (!ok || newExe is null)
        {
            _status.Text = error ?? "به‌روزرسانی ناموفق بود.";
            _close.IsEnabled = true;
            return;
        }

        _status.Text = "به‌روزرسانی آماده است؛ برنامه در حال راه‌اندازی مجدد…";
        try
        {
            // Start the new build, then close this one so the file lock on the old exe is released.
            // The new build runs from its staging folder, the only way Windows allows this.
            System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(newExe)
            {
                UseShellExecute = true,
                WorkingDirectory = System.IO.Path.GetDirectoryName(newExe)
            });
        }
        catch (Exception ex)
        {
            _status.Text = $"اجرای نسخهٔ جدید ناموفق بود: {ex.Message}";
            _close.IsEnabled = true;
            return;
        }

        Application.Current.Shutdown();
    }
}
