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
    "package-update" => PackageUpdate(args),
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
  sign --request <activation.json> --private-key <pem> --valid-until <yyyy-MM-dd> [--max-users N] [--org "Name"] [--sequence N] [--allowed-host "host-or-ip"] [--referral-url URL] [--db-connection "<cs>"] [--trial-days N] [--allow-updates true|false] [--allow-legacy-migration true|false] [--allow-plan-management true|false] [--allow-bilingual true|false] [--allow-front-package true|false] [--allow-local-run true|false] [--allow-commerce true|false] [--allow-software-purchase true|false] [--allow-self-issued-licenses true|false] [--server-base-url URL] [--update-url URL] [--max-source-rows N] [--max-source-bytes N] [-o license.morobot]
  package --project <path-to-Morobot.Web.csproj> --output <folder>
  package-update --version <semver> --source <published-folder> [-o <file.zip>] [--notes "text"] [--channel stable] [--min-current <semver>] [--product-name Morobot]
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
    // Opt-in only: absence of the flag must keep migration disabled.
    var allowLegacyMigration = string.Equals(GetArg(args, "--allow-legacy-migration"), "true", StringComparison.OrdinalIgnoreCase);
    // Opt-OUT, unlike migration: plan management existed before this flag was signable, so an
    // omission has to mean "allowed" or every already-signed licence would silently lose it.
    var allowPlanManagement = !string.Equals(GetArg(args, "--allow-plan-management"), "false", StringComparison.OrdinalIgnoreCase);
    // Opt-OUT as well: the second language shipped before this flag was signable, so an omission has
    // to mean "both languages" or existing single-licence customers would silently lose one.
    var allowBilingual = !string.Equals(GetArg(args, "--allow-bilingual"), "false", StringComparison.OrdinalIgnoreCase);
    // Opt-IN, like migration: the front-end package is a separately sold bundle, so a licence that
    // does not name it must not hand it to a customer who never bought it.
    var allowFrontPackage = string.Equals(GetArg(args, "--allow-front-package"), "true", StringComparison.OrdinalIgnoreCase);
    // Opt-IN for the same reason: local execution moves work off the server, so it is granted
    // explicitly rather than acquired by omission.
    var allowLocalRun = string.Equals(GetArg(args, "--allow-local-run"), "true", StringComparison.OrdinalIgnoreCase);
    // Commerce is opt-in and three-layered, so turning on selling plans cannot silently also grant
    // the right to hand out the software or to mint licenses. Each has to be named.
    var allowCommerce = string.Equals(GetArg(args, "--allow-commerce"), "true", StringComparison.OrdinalIgnoreCase);
    var allowSoftwarePurchase = string.Equals(GetArg(args, "--allow-software-purchase"), "true", StringComparison.OrdinalIgnoreCase);
    var allowSelfIssuedLicenses = string.Equals(GetArg(args, "--allow-self-issued-licenses"), "true", StringComparison.OrdinalIgnoreCase);
    // Signed so a client never has to be told the address: the desktop player reads it from here.
    var serverBaseUrl = GetArg(args, "--server-base-url");
    var updateUrl = GetArg(args, "--update-url");
    var allowedHostRaw = GetArg(args, "--allowed-host");    string? allowedHost = null;
    if (!string.IsNullOrWhiteSpace(allowedHostRaw))
    {
        if (!LicenseHostBinding.TryNormalize(allowedHostRaw, out var normalizedHost))
        {
            Console.Error.WriteLine("Invalid --allowed-host (use domain, IP, or https://host).");
            return 1;
        }

        allowedHost = normalizedHost;
    }

    var referralUrlRaw = GetArg(args, "--referral-url");
    string? referralUrl = null;
    if (!string.IsNullOrWhiteSpace(referralUrlRaw))
    {
        referralUrl = LicenseReferralUrl.TryNormalize(referralUrlRaw);
        if (referralUrl is null)
        {
            Console.Error.WriteLine("Invalid --referral-url (use an http or https address).");
            return 1;
        }
    }

    // Hard ceilings on a single data source. Signed here so a deployment cannot raise them.
    var maxSourceRows = ParseNullableInt(GetArg(args, "--max-source-rows"));
    var maxSourceBytes = ParseNullableLong(GetArg(args, "--max-source-bytes"));

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
        AllowLegacyMigration = allowLegacyMigration,
        AllowPlanManagement = allowPlanManagement,
        AllowBilingual = allowBilingual,
        AllowFrontPackage = allowFrontPackage,
        AllowLocalRun = allowLocalRun,
        AllowCommerce = allowCommerce,
        AllowSoftwarePurchase = allowSoftwarePurchase,
        AllowSelfIssuedLicenses = allowSelfIssuedLicenses,
        ServerBaseUrl = serverBaseUrl,
        UpdateServerUrl = updateUrl,
        AllowedHost = allowedHost,
        ReferralWidgetUrl = referralUrl,
        MaxSourceRows = maxSourceRows,
        MaxSourceBytes = maxSourceBytes
    };

    var doc = LicenseCrypto.Sign(payload, privatePem);
    var outPath = GetArg(args, "-o") ?? GetArg(args, "--output") ?? "license.morobot";
    File.WriteAllText(outPath, LicenseJson.SerializeDocument(doc));
    Console.WriteLine($"License written: {outPath}");
    Console.WriteLine($"LicenseId: {payload.LicenseId}");
    Console.WriteLine($"MaxUsers:  {(payload.MaxUsers?.ToString() ?? "unlimited")}");
    Console.WriteLine($"MaxSourceRows:  {(payload.MaxSourceRows?.ToString() ?? "unlimited")}");
    Console.WriteLine($"MaxSourceBytes: {(payload.MaxSourceBytes?.ToString() ?? "unlimited")}");
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

static long? ParseNullableLong(string? raw)
    => long.TryParse(raw, out var n) ? n : null;

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

static int PackageUpdate(string[] args)
{
    var version = RequireArg(args, "--version");
    var source = RequireArg(args, "--source");
    var zip = GetArg(args, "-o") ?? GetArg(args, "--output")
              ?? Path.Combine(Environment.CurrentDirectory, "dist", $"morobot-update-{version.Trim()}.zip");

    var result = UpdatePackageBuilder.Build(
        source,
        zip,
        version,
        notes: GetArg(args, "--notes"),
        channel: GetArg(args, "--channel"),
        minCurrentVersion: GetArg(args, "--min-current"),
        productName: GetArg(args, "--product-name"));

    Console.WriteLine($"Update package: {result.ZipPath}");
    Console.WriteLine($"Version:        {result.Manifest.Version}");
    Console.WriteLine($"Files:          {result.FileCount}");
    Console.WriteLine("Upload it at Admin → License → Offline update, then apply.");
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
