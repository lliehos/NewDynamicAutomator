using System.Security.Cryptography;
using Morobot.Licensing;

if (args.Length == 0 || args[0] is "-h" or "--help" or "help")
{
    PrintHelp();
    return 0;
}

return args[0].ToLowerInvariant() switch
{
    "genkeypair" => GenKeyPair(args),
    "sign" => Sign(args),
    "verify" => Verify(args),
    "info" => Info(args),
    "package" => Package(args),
    _ => Unknown(args[0])
};

static int Unknown(string cmd)
{
    Console.Error.WriteLine($"Unknown command: {cmd}");
    PrintHelp();
    return 1;
}

static void PrintHelp()
{
    Console.WriteLine("""
Morobot license tool (vendor-only — never deploy private keys to customers)

Commands:
  genkeypair [--out-dir <path>]
  sign --request <activation.json> --private-key <pem> --valid-until <yyyy-MM-dd> [--max-users N] [--org "Name"] [--sequence N] [--allowed-host "host-or-ip"] [--db-connection "<cs>"] [--trial-days N] [--allow-updates true|false] [--update-url URL] [-o license.morobot]
  package --project <path-to-Morobot.Web.csproj> --output <folder>
  verify --license <file.morobot> [--public-key <pem>]
  info --request <activation.json>
""");
}

static int GenKeyPair(string[] args)
{
    var outDir = GetArg(args, "--out-dir") ?? Path.Combine(Environment.CurrentDirectory, "license-keys");
    Directory.CreateDirectory(outDir);
    var (pub, priv) = LicenseCrypto.GenerateKeyPair();
    var pubPath = Path.Combine(outDir, "morobot-public.pem");
    var privPath = Path.Combine(outDir, "morobot-private.pem");
    File.WriteAllText(pubPath, pub);
    File.WriteAllText(privPath, priv);
    Console.WriteLine($"Public key:  {pubPath}");
    Console.WriteLine($"Private key: {privPath}");
    Console.WriteLine("Keep the private key offline. Embed the public key in Morobot.Licensing.");
    return 0;
}

static int Info(string[] args)
{
    var requestPath = RequireArg(args, "--request");
    var json = File.ReadAllText(requestPath);
    var request = LicenseJson.TryParseActivationRequest(json);
    if (request is null)
    {
        Console.Error.WriteLine("Invalid activation request JSON.");
        return 1;
    }

    Console.WriteLine($"Anchor:   {request.DeploymentAnchorId}");
    Console.WriteLine($"Machine:  {request.MachineName ?? "-"}");
    Console.WriteLine($"App:      {request.AppVersion ?? "-"}");
    Console.WriteLine($"Org hint: {request.OrganizationHint ?? "-"}");
    Console.WriteLine($"Requested:{request.RequestedAtUtc:u}");
    return 0;
}

static int Sign(string[] args)
{
    var requestPath = RequireArg(args, "--request");
    var privateKeyPath = RequireArg(args, "--private-key");
    var validUntilRaw = RequireArg(args, "--valid-until");
    if (!DateTime.TryParse(validUntilRaw, out var validUntil))
    {
        Console.Error.WriteLine("Invalid --valid-until date.");
        return 1;
    }

    var requestJson = File.ReadAllText(requestPath);
    var request = LicenseJson.TryParseActivationRequest(requestJson);
    if (request is null || string.IsNullOrWhiteSpace(request.DeploymentAnchorId))
    {
        Console.Error.WriteLine("Invalid activation request.");
        return 1;
    }

    var privatePem = File.ReadAllText(privateKeyPath);
    var maxUsers = ParseNullableInt(GetArg(args, "--max-users"));
    var sequence = ParseLong(GetArg(args, "--sequence")) ?? 1;
    var org = GetArg(args, "--org");
    var dbConnection = GetArg(args, "--db-connection");
    var trialDays = ParseNullableInt(GetArg(args, "--trial-days")) ?? 3;
    var allowUpdatesRaw = GetArg(args, "--allow-updates");
    var allowUpdates = !string.Equals(allowUpdatesRaw, "false", StringComparison.OrdinalIgnoreCase);
    var updateUrl = GetArg(args, "--update-url");
    var allowedHostRaw = GetArg(args, "--allowed-host");
    string? allowedHost = null;
    if (!string.IsNullOrWhiteSpace(allowedHostRaw))
    {
        if (!LicenseHostBinding.TryNormalize(allowedHostRaw, out var normalizedHost))
        {
            Console.Error.WriteLine("Invalid --allowed-host (use domain, IP, or https://host).");
            return 1;
        }

        allowedHost = normalizedHost;
    }

    var payload = new LicensePayload
    {
        LicenseId = Guid.NewGuid().ToString("D"),
        OrganizationName = org,
        DeploymentAnchorId = request.DeploymentAnchorId,
        IssuedAtUtc = DateTime.UtcNow,
        ValidUntilUtc = DateTime.SpecifyKind(validUntil.Date.AddDays(1).AddTicks(-1), DateTimeKind.Utc),
        Sequence = sequence,
        MaxUsers = maxUsers,
        DatabaseConnectionString = dbConnection,
        TrialDays = trialDays,
        AllowUpdates = allowUpdates,
        UpdateServerUrl = updateUrl,
        AllowedHost = allowedHost
    };

    var doc = LicenseCrypto.Sign(payload, privatePem);
    var outPath = GetArg(args, "-o") ?? GetArg(args, "--output") ?? "license.morobot";
    File.WriteAllText(outPath, LicenseJson.SerializeDocument(doc));
    Console.WriteLine($"License written: {outPath}");
    Console.WriteLine($"LicenseId: {payload.LicenseId}");
    Console.WriteLine($"MaxUsers:  {(payload.MaxUsers?.ToString() ?? "unlimited")}");
    Console.WriteLine($"Valid until: {payload.ValidUntilUtc:u}");
    return 0;
}

static int Verify(string[] args)
{
    var licensePath = RequireArg(args, "--license");
    var publicKeyPath = GetArg(args, "--public-key");
    var publicPem = publicKeyPath is not null
        ? File.ReadAllText(publicKeyPath)
        : LicensePublicKeys.Development;

    var json = File.ReadAllText(licensePath);
    var doc = LicenseJson.TryParseDocument(json);
    if (doc is null)
    {
        Console.Error.WriteLine("Invalid license file.");
        return 1;
    }

    var result = LicenseValidator.ValidateDocument(
        doc,
        doc.Payload.DeploymentAnchorId,
        publicPem,
        DateTime.UtcNow);

    Console.WriteLine($"Status: {result.Status}");
    if (!string.IsNullOrWhiteSpace(result.Message))
        Console.WriteLine(result.Message);
    if (result.Payload is not null)
    {
        Console.WriteLine($"Org:       {result.Payload.OrganizationName ?? "-"}");
        Console.WriteLine($"MaxUsers:  {(result.Payload.MaxUsers?.ToString() ?? "unlimited")}");
        Console.WriteLine($"Sequence:  {result.Payload.Sequence}");
        Console.WriteLine($"Valid until: {result.Payload.ValidUntilUtc:u}");
    }

    return result.IsValid ? 0 : 1;
}

static string RequireArg(string[] args, string name)
{
    var v = GetArg(args, name);
    if (string.IsNullOrWhiteSpace(v))
        throw new InvalidOperationException($"Missing required argument: {name}");
    return v;
}

static string? GetArg(string[] args, string name)
{
    for (var i = 0; i < args.Length - 1; i++)
    {
        if (string.Equals(args[i], name, StringComparison.OrdinalIgnoreCase))
            return args[i + 1];
    }
    return null;
}

static int? ParseNullableInt(string? raw)
    => int.TryParse(raw, out var n) ? n : null;

static long? ParseLong(string? raw)
    => long.TryParse(raw, out var n) ? n : null;

static int Package(string[] args)
{
    var project = RequireArg(args, "--project");
    var output = GetArg(args, "--output") ?? Path.Combine(Environment.CurrentDirectory, "dist", "morobot-server");
    Directory.CreateDirectory(output);
    var psi = new System.Diagnostics.ProcessStartInfo
    {
        FileName = "dotnet",
        Arguments = $"publish \"{project}\" -c Release -o \"{output}\" /p:DeploymentMode=Enterprise",
        UseShellExecute = false,
        RedirectStandardOutput = true,
        RedirectStandardError = true
    };
    using var proc = System.Diagnostics.Process.Start(psi)
        ?? throw new InvalidOperationException("Could not start dotnet publish.");
    proc.WaitForExit();
    Console.WriteLine(proc.StandardOutput.ReadToEnd());
    var err = proc.StandardError.ReadToEnd();
    if (!string.IsNullOrWhiteSpace(err))
        Console.Error.WriteLine(err);
    if (proc.ExitCode != 0)
        return proc.ExitCode;

    CopySetupGuide(output);

    var zipPath = output.TrimEnd('\\', '/') + ".zip";
    if (File.Exists(zipPath)) File.Delete(zipPath);
    System.IO.Compression.ZipFile.CreateFromDirectory(output, zipPath);
    Console.WriteLine($"Package folder: {output}");
    Console.WriteLine($"Package zip:    {zipPath}");
    return 0;
}

static void CopySetupGuide(string outputDir)
{
    var candidates = new[]
    {
        Path.GetFullPath(Path.Combine(outputDir, "..", "..", "..", "..", "docs", "setup-guide.md")),
        Path.GetFullPath(Path.Combine(Directory.GetCurrentDirectory(), "docs", "setup-guide.md")),
        Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "..", "docs", "setup-guide.md"))
    };
    var source = candidates.FirstOrDefault(File.Exists);
    if (source is null) return;
    var destDir = Path.Combine(outputDir, "docs");
    Directory.CreateDirectory(destDir);
    File.Copy(source, Path.Combine(destDir, "setup-guide.md"), overwrite: true);
    File.WriteAllText(Path.Combine(outputDir, "START-HERE.txt"),
        """
        Morobot Server Package
        ======================
        Full setup guide (Persian): docs/setup-guide.md
        Same guide in browser after install: /Home/SetupGuide
        """);
}
