namespace Webautomator.Web.Services;

/// <summary>
/// Content-aware file writes for the extension sync and the branding overlay.
///
/// Both run on every start and touch files inside %LocalAppData%. Rewriting identical bytes is
/// wasted I/O and, in the field, an anti-ransomware signal: endpoint protection sees an
/// application repeatedly overwriting image files and reports "file content tampering". Skipping
/// writes whose content already matches keeps the folder stable and removes that false positive.
/// </summary>
internal static class FileSyncHelper
{
    /// <summary>Copy only when the bytes differ. Returns true when a write happened.</summary>
    public static bool CopyIfDifferent(string source, string destination)
    {
        if (FilesAreIdentical(source, destination)) return false;
        EnsureDirectory(destination);
        File.Copy(source, destination, overwrite: true);
        return true;
    }

    /// <summary>Write text only when it differs from what is already on disk.</summary>
    public static bool WriteAllTextIfDifferent(string path, string content)
    {
        if (File.Exists(path))
        {
            try
            {
                if (string.Equals(File.ReadAllText(path), content, StringComparison.Ordinal)) return false;
            }
            catch
            {
                // Unreadable or locked: fall through and overwrite.
            }
        }
        EnsureDirectory(path);
        File.WriteAllText(path, content);
        return true;
    }

    public static async Task<bool> WriteAllTextIfDifferentAsync(string path, string content, CancellationToken ct = default)
    {
        if (File.Exists(path))
        {
            try
            {
                var existing = await File.ReadAllTextAsync(path, ct);
                if (string.Equals(existing, content, StringComparison.Ordinal)) return false;
            }
            catch
            {
                // Unreadable or locked: fall through and overwrite.
            }
        }
        EnsureDirectory(path);
        await File.WriteAllTextAsync(path, content, ct);
        return true;
    }

    public static bool FilesAreIdentical(string source, string destination)
    {
        try
        {
            var src = new FileInfo(source);
            var dst = new FileInfo(destination);
            if (!dst.Exists || !src.Exists) return false;
            if (src.Length != dst.Length) return false;
            using var sourceStream = src.OpenRead();
            using var destStream = dst.OpenRead();
            return StreamsEqual(sourceStream, destStream);
        }
        catch
        {
            return false;
        }
    }

    private static bool StreamsEqual(Stream left, Stream right)
    {
        const int bufferSize = 64 * 1024;
        var leftBuffer = new byte[bufferSize];
        var rightBuffer = new byte[bufferSize];
        while (true)
        {
            var leftRead = left.Read(leftBuffer, 0, bufferSize);
            var rightRead = right.Read(rightBuffer, 0, bufferSize);
            if (leftRead != rightRead) return false;
            if (leftRead == 0) return true;
            if (!leftBuffer.AsSpan(0, leftRead).SequenceEqual(rightBuffer.AsSpan(0, rightRead))) return false;
        }
    }

    private static void EnsureDirectory(string filePath)
    {
        var directory = Path.GetDirectoryName(filePath);
        if (!string.IsNullOrEmpty(directory)) Directory.CreateDirectory(directory);
    }
}
