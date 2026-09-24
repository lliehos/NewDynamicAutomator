using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using Microsoft.Win32;

namespace Morobot.Infrastructure.Services;

/// <summary>Stable host identity for trial binding (not client browser fingerprint).</summary>
public static class ServerHostFingerprint
{
    public static string ComputeHash()
    {
        var material = CollectMaterial();
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(material));
        return Convert.ToHexString(bytes).ToLowerInvariant();
    }

    public static string ShortHash(string fullHash)
        => string.IsNullOrEmpty(fullHash) || fullHash.Length <= 12 ? fullHash : fullHash[..12];

    private static string CollectMaterial()
    {
        var parts = new List<string>
        {
            "v1",
            Environment.OSVersion.Platform.ToString(),
            RuntimeInformation.OSArchitecture.ToString(),
            Environment.ProcessorCount.ToString()
        };

        if (RuntimeInformation.IsOSPlatform(OSPlatform.Windows))
        {
            try
            {
                using var key = Registry.LocalMachine.OpenSubKey(@"SOFTWARE\Microsoft\Cryptography");
                var guid = key?.GetValue("MachineGuid")?.ToString();
                if (!string.IsNullOrWhiteSpace(guid))
                    parts.Add("win:" + guid.Trim());
            }
            catch
            {
                /* ignore */
            }
        }
        else if (RuntimeInformation.IsOSPlatform(OSPlatform.Linux))
        {
            TryAddFile(parts, "/etc/machine-id", "linux-id");
            TryAddFile(parts, "/var/lib/dbus/machine-id", "dbus-id");
        }

        parts.Add("host:" + Environment.MachineName);
        return string.Join('|', parts);
    }

    private static void TryAddFile(List<string> parts, string path, string prefix)
    {
        try
        {
            if (!File.Exists(path)) return;
            var line = File.ReadAllText(path).Trim();
            if (!string.IsNullOrWhiteSpace(line))
                parts.Add(prefix + ":" + line);
        }
        catch
        {
            /* ignore */
        }
    }
}
