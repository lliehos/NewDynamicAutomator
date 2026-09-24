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
        => RequestPath.Text = PickFile("JSON files|*.json;*.morobot|All files|*.*") ?? RequestPath.Text;

    private void BrowsePrivateKey_Click(object sender, RoutedEventArgs e)
        => PrivateKeyPath.Text = PickFile("PEM files|*.pem|All files|*.*") ?? PrivateKeyPath.Text;

    private void BrowseProject_Click(object sender, RoutedEventArgs e)
        => ProjectPath.Text = PickFile("Project files|*.csproj|All files|*.*") ?? ProjectPath.Text;

    private void BrowseOutput_Click(object sender, RoutedEventArgs e)
    {
        var dlg = new OpenFolderDialog();
        if (dlg.ShowDialog() == true)
            OutputPath.Text = dlg.FolderName;
    }

    private void SignLicense_Click(object sender, RoutedEventArgs e)
    {
        try
        {
            var request = LicenseJson.TryParseActivationRequest(File.ReadAllText(RequestPath.Text));
            if (request is null || string.IsNullOrWhiteSpace(request.DeploymentAnchorId))
                throw new InvalidOperationException("Invalid activation request file.");

            if (!ValidUntil.SelectedDate.HasValue)
                throw new InvalidOperationException("Valid until date is required.");

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
                UpdateServerUrl = string.IsNullOrWhiteSpace(UpdateUrl.Text) ? null : UpdateUrl.Text.Trim()
            };

            var privatePem = File.ReadAllText(PrivateKeyPath.Text);
            _lastDocument = LicenseCrypto.Sign(payload, privatePem);
            LicenseOutput.Text = LicenseJson.SerializeDocument(_lastDocument);
            StatusText.Text = $"License signed: {payload.LicenseId}";
        }
        catch (Exception ex)
        {
            StatusText.Text = ex.Message;
            MessageBox.Show(this, ex.Message, "Sign failed", MessageBoxButton.OK, MessageBoxImage.Error);
        }
    }

    private void SaveLicense_Click(object sender, RoutedEventArgs e)
    {
        if (_lastDocument is null)
        {
            SignLicense_Click(sender, e);
            if (_lastDocument is null) return;
        }

        var dlg = new SaveFileDialog { Filter = "Morobot license|*.morobot|JSON|*.json", FileName = "license.morobot" };
        if (dlg.ShowDialog() != true) return;
        File.WriteAllText(dlg.FileName, LicenseOutput.Text);
        StatusText.Text = $"Saved {dlg.FileName}";
    }

    private async void BuildPackage_Click(object sender, RoutedEventArgs e)
    {
        try
        {
            StatusText.Text = "Publishing…";
            var output = OutputPath.Text.Trim();
            Directory.CreateDirectory(output);
            var exit = await RunProcessAsync("dotnet",
                $"publish \"{ProjectPath.Text}\" -c Release -o \"{output}\"");
            if (exit != 0) throw new InvalidOperationException($"dotnet publish failed ({exit}).");

            var appsettings = Path.Combine(output, "appsettings.json");
            if (File.Exists(appsettings))
            {
                var json = File.ReadAllText(appsettings).Replace(
                    "\"DeploymentMode\": \"Cloud\"",
                    "\"DeploymentMode\": \"Enterprise\"",
                    StringComparison.Ordinal);
                File.WriteAllText(appsettings, json);
            }

            CopySetupGuide(output);

            var zipPath = output.TrimEnd('\\', '/') + ".zip";
            if (File.Exists(zipPath)) File.Delete(zipPath);
            ZipFile.CreateFromDirectory(output, zipPath);
            StatusText.Text = $"Package ready: {zipPath}";
        }
        catch (Exception ex)
        {
            StatusText.Text = ex.Message;
            MessageBox.Show(this, ex.Message, "Package failed", MessageBoxButton.OK, MessageBoxImage.Error);
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

    private static string? PickFile(string filter)
    {
        var dlg = new OpenFileDialog { Filter = filter };
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
            "Morobot Server Package\r\n======================\r\nFull setup guide: docs/setup-guide.md\r\nWeb UI: /Home/SetupGuide\r\n");
    }
}
