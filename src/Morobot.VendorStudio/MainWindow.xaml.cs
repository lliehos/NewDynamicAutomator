using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Windows;
using Microsoft.Win32;
using Morobot.Licensing;

namespace Morobot.VendorStudio;

public partial class MainWindow : Window
{
    private LicenseDocument? _lastDocument;

    public MainWindow()
    {
        InitializeComponent();
        Title = VsStrings.WindowTitle;
        ValidUntil.SelectedDate = DateTime.Today.AddYears(1);
        var root = FindRepoRoot();
        if (root is not null)
        {
            ProjectPath.Text = Path.Combine(root, "src", "Morobot.Web", "Morobot.Web.csproj");
            OutputPath.Text = Path.Combine(root, "dist", "morobot-server");
            PrivateKeyPath.Text = Path.Combine(root, "tools", "license-keys", "morobot-private.pem");
        }
    }

    private void BrowseRequest_Click(object sender, RoutedEventArgs e)
        => RequestPath.Text = PickFile("JSON|*.json;*.morobot|همه|*.*", "انتخاب درخواست فعال‌سازی") ?? RequestPath.Text;

    private void BrowsePrivateKey_Click(object sender, RoutedEventArgs e)
        => PrivateKeyPath.Text = PickFile("PEM|*.pem|همه|*.*", "انتخاب کلید خصوصی") ?? PrivateKeyPath.Text;

    private void BrowseProject_Click(object sender, RoutedEventArgs e)
        => ProjectPath.Text = PickFile("پروژه|*.csproj|همه|*.*", "انتخاب Morobot.Web.csproj") ?? ProjectPath.Text;

    private void BrowseOutput_Click(object sender, RoutedEventArgs e)
    {
        var dlg = new OpenFolderDialog { Title = "انتخاب پوشه خروجی publish" };
        if (dlg.ShowDialog() == true)
            OutputPath.Text = dlg.FolderName;
    }

    private void SignLicense_Click(object sender, RoutedEventArgs e)
    {
        try
        {
            if (string.IsNullOrWhiteSpace(RequestPath.Text) || !File.Exists(RequestPath.Text.Trim()))
                throw new InvalidOperationException(VsStrings.ErrRequestPath);
            if (string.IsNullOrWhiteSpace(PrivateKeyPath.Text) || !File.Exists(PrivateKeyPath.Text.Trim()))
                throw new InvalidOperationException(VsStrings.ErrPrivateKey);

            var request = LicenseJson.TryParseActivationRequest(File.ReadAllText(RequestPath.Text.Trim()));
            if (request is null || string.IsNullOrWhiteSpace(request.DeploymentAnchorId))
                throw new InvalidOperationException(VsStrings.ErrInvalidRequest);

            if (!ValidUntil.SelectedDate.HasValue)
                throw new InvalidOperationException(VsStrings.ErrValidUntil);

            string? allowedHost = null;
            if (!string.IsNullOrWhiteSpace(AllowedHost.Text))
            {
                if (!LicenseHostBinding.TryNormalize(AllowedHost.Text.Trim(), out var normalizedHost))
                    throw new InvalidOperationException("دامنه یا IP مجاز نامعتبر است.");
                allowedHost = normalizedHost;
            }

            // Rejected rather than silently dropped: a link the vendor believes was signed into
            // the licence but never was would only surface much later, inside the customer's panel.
            string? referralUrl = null;
            if (!string.IsNullOrWhiteSpace(ReferralUrl.Text))
            {
                referralUrl = LicenseReferralUrl.TryNormalize(ReferralUrl.Text.Trim());
                if (referralUrl is null)
                    throw new InvalidOperationException("لینک ویجت معرفی نامعتبر است (فقط http یا https).");
            }

            var payload = new LicensePayload
            {
                LicenseId = Guid.NewGuid().ToString("D"),
                OrganizationName = string.IsNullOrWhiteSpace(Organization.Text) ? null : Organization.Text.Trim(),
                DeploymentAnchorId = request.DeploymentAnchorId,
                IssuedAtUtc = DateTime.UtcNow,
                ValidUntilUtc = ValidUntil.SelectedDate.Value.Date.AddDays(1).AddTicks(-1).ToUniversalTime(),
                Sequence = long.TryParse(Sequence.Text, out var seq) ? seq : 1,
                MaxUsers = int.TryParse(MaxUsers.Text, out var max) ? max : null,
                DatabaseConnectionString = string.IsNullOrWhiteSpace(DbConnection.Text) ? null : DbConnection.Text.Trim(),
                TrialDays = int.TryParse(TrialDays.Text, out var trial) ? trial : 3,
                AllowUpdates = AllowUpdates.IsChecked == true,
                AllowLegacyMigration = AllowLegacyMigration.IsChecked == true,
                UpdateServerUrl = string.IsNullOrWhiteSpace(UpdateUrl.Text) ? null : UpdateUrl.Text.Trim(),
                AllowedHost = allowedHost,
                ReferralWidgetUrl = referralUrl,
                // Signed hard ceilings on one data source. Empty means the vendor set none, which
                // lets the plan decide; a trial still gets its own small default.
                MaxSourceRows = int.TryParse(MaxSourceRows.Text, out var maxRows) ? maxRows : null,
                MaxSourceBytes = long.TryParse(MaxSourceBytes.Text, out var maxBytes) ? maxBytes : null
            };

            var privatePem = File.ReadAllText(PrivateKeyPath.Text.Trim());
            _lastDocument = LicenseCrypto.Sign(payload, privatePem);
            LicenseOutput.Text = LicenseJson.SerializeDocument(_lastDocument);
            StatusText.Text = string.Format(VsStrings.StatusSigned, payload.LicenseId);
        }
        catch (Exception ex)
        {
            StatusText.Text = ex.Message;
            MessageBox.Show(this, ex.Message, VsStrings.MsgSignFailed, MessageBoxButton.OK, MessageBoxImage.Error);
        }
    }

    private void SaveLicense_Click(object sender, RoutedEventArgs e)
    {
        if (_lastDocument is null)
        {
            SignLicense_Click(sender, e);
            if (_lastDocument is null) return;
        }

        var dlg = new SaveFileDialog
        {
            Filter = "لایسنس مروبات|*.morobot|JSON|*.json",
            FileName = "license.morobot",
            Title = "ذخیره فایل لایسنس"
        };
        if (dlg.ShowDialog() != true) return;
        File.WriteAllText(dlg.FileName, LicenseOutput.Text);
        StatusText.Text = string.Format(VsStrings.StatusSaved, dlg.FileName);
    }

    private async void BuildPackage_Click(object sender, RoutedEventArgs e)
    {
        try
        {
            if (string.IsNullOrWhiteSpace(ProjectPath.Text) || !File.Exists(ProjectPath.Text.Trim()))
                throw new InvalidOperationException(VsStrings.ErrProjectPath);
            if (string.IsNullOrWhiteSpace(OutputPath.Text))
                throw new InvalidOperationException(VsStrings.ErrOutputPath);

            StatusText.Text = VsStrings.StatusPublishing;
            var output = OutputPath.Text.Trim();
            Directory.CreateDirectory(output);
            var exit = await RunProcessAsync("dotnet",
                $"publish \"{ProjectPath.Text.Trim()}\" -c Release -o \"{output}\"");
            if (exit != 0)
                throw new InvalidOperationException(string.Format(VsStrings.ErrPublish, exit));

            CopySetupGuide(output);

            var zipPath = output.TrimEnd('\\', '/') + ".zip";
            if (File.Exists(zipPath)) File.Delete(zipPath);
            ZipFile.CreateFromDirectory(output, zipPath);
            StatusText.Text = string.Format(VsStrings.StatusPackageReady, zipPath);
        }
        catch (Exception ex)
        {
            StatusText.Text = ex.Message;
            MessageBox.Show(this, ex.Message, VsStrings.MsgPackageFailed, MessageBoxButton.OK, MessageBoxImage.Error);
        }
    }

    private void BrowseUpdateSource_Click(object sender, RoutedEventArgs e)
    {
        var dlg = new OpenFolderDialog { Title = "انتخاب پوشه فایل‌های publish" };
        if (dlg.ShowDialog() == true)
            UpdateSourcePath.Text = dlg.FolderName;
    }

    private void UseInstallTabSource_Click(object sender, RoutedEventArgs e)
    {
        if (!string.IsNullOrWhiteSpace(OutputPath.Text))
            UpdateSourcePath.Text = OutputPath.Text.Trim();
    }

    private void BrowseUpdateZip_Click(object sender, RoutedEventArgs e)
    {
        var suggested = string.IsNullOrWhiteSpace(UpdateVersion.Text) ? "1.0.1" : UpdateVersion.Text.Trim();
        var dlg = new SaveFileDialog
        {
            Filter = "بستهٔ آپدیت|*.zip",
            FileName = $"morobot-update-{suggested}.zip",
            Title = "ذخیرهٔ بستهٔ آپدیت"
        };
        if (dlg.ShowDialog() == true)
            UpdateZipPath.Text = dlg.FileName;
    }

    /// <summary>
    /// Builds an offline update package from an already-published folder. The manifest is
    /// produced by the shared builder, so a package made here is byte-compatible with one
    /// made by the CLI tool and is accepted by the same server-side verification.
    /// </summary>
    private void BuildUpdatePackage_Click(object sender, RoutedEventArgs e)
    {
        try
        {
            if (string.IsNullOrWhiteSpace(UpdateSourcePath.Text) || !Directory.Exists(UpdateSourcePath.Text.Trim()))
                throw new InvalidOperationException(VsStrings.ErrUpdateSource);
            if (string.IsNullOrWhiteSpace(UpdateVersion.Text) || !Version.TryParse(UpdateVersion.Text.Trim(), out _))
                throw new InvalidOperationException(VsStrings.ErrUpdateVersion);

            var version = UpdateVersion.Text.Trim();
            var zip = string.IsNullOrWhiteSpace(UpdateZipPath.Text)
                ? Path.Combine(FindRepoRoot() ?? Environment.CurrentDirectory, "dist", $"morobot-update-{version}.zip")
                : UpdateZipPath.Text.Trim();

            StatusText.Text = VsStrings.StatusBuildingUpdate;
            var result = Licensing.UpdatePackageBuilder.Build(
                UpdateSourcePath.Text.Trim(),
                zip,
                version,
                notes: UpdateNotes.Text,
                channel: UpdateChannel.Text,
                minCurrentVersion: string.IsNullOrWhiteSpace(UpdateMinVersion.Text) ? null : UpdateMinVersion.Text.Trim(),
                productName: Path.GetFileNameWithoutExtension(ProjectPath.Text));

            UpdateZipPath.Text = result.ZipPath;
            StatusText.Text = string.Format(VsStrings.StatusUpdateReady, result.Manifest.Version, result.FileCount, result.ZipPath);
        }
        catch (Exception ex)
        {
            StatusText.Text = ex.Message;
            MessageBox.Show(this, ex.Message, VsStrings.MsgUpdateFailed, MessageBoxButton.OK, MessageBoxImage.Error);
        }
    }

    private static async Task<int> RunProcessAsync(string file, string args)
    {
        var psi = new ProcessStartInfo
        {
            FileName = file,
            Arguments = args,
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true
        };
        using var proc = Process.Start(psi) ?? throw new InvalidOperationException("Could not start process.");
        var stdout = await proc.StandardOutput.ReadToEndAsync();
        var stderr = await proc.StandardError.ReadToEndAsync();
        await proc.WaitForExitAsync();
        if (!string.IsNullOrWhiteSpace(stderr))
            Debug.WriteLine(stderr);
        if (!string.IsNullOrWhiteSpace(stdout))
            Debug.WriteLine(stdout);
        return proc.ExitCode;
    }

    private static string? PickFile(string filter, string title)
    {
        var dlg = new OpenFileDialog { Filter = filter, Title = title };
        return dlg.ShowDialog() == true ? dlg.FileName : null;
    }

    private static string? FindRepoRoot()
    {
        var dir = AppContext.BaseDirectory;
        for (var i = 0; i < 8; i++)
        {
            if (File.Exists(Path.Combine(dir, "Morobot.sln")))
                return dir;
            dir = Directory.GetParent(dir)?.FullName ?? dir;
        }
        return null;
    }

    private static void CopySetupGuide(string outputDir)
    {
        var root = FindRepoRoot();
        if (root is null) return;
        var source = Path.Combine(root, "docs", "setup-guide.md");
        if (!File.Exists(source)) return;
        var destDir = Path.Combine(outputDir, "docs");
        Directory.CreateDirectory(destDir);
        File.Copy(source, Path.Combine(destDir, "setup-guide.md"), overwrite: true);
        File.WriteAllText(Path.Combine(outputDir, "START-HERE.txt"),
            "بسته سرور Morobot\r\n==================\r\nراهنما: docs/setup-guide.md\r\nوب: /Home/SetupGuide\r\n");
    }
}
