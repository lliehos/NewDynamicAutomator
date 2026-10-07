using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using Morobot.Player.Models;

namespace Morobot.Player.Services;

/// <summary>One call result: the body on success, or a human-readable reason on failure.</summary>
public sealed record ApiResult<T>(bool Ok, T? Value, string? Error)
{
    public static ApiResult<T> Success(T value) => new(true, value, null);
    public static ApiResult<T> Fail(string error) => new(false, default, error);
}

/// <summary>
/// Talks to the panel the same way the extension does: a bearer token minted from the session.
/// </summary>
/// <remarks>
/// Deliberately the SAME surface the extension uses. The desktop runner is another client of one
/// server, so it must not invent its own endpoints or its own permission model — anything it can do
/// here is something the API already allows that user.
/// </remarks>
public sealed class PanelClient : IDisposable
{
    private readonly HttpClient _http;

    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        PropertyNameCaseInsensitive = true,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
    };

    public string BaseUrl { get; }
    public string? UserName { get; private set; }
    public string? AccessToken { get; private set; }

    public PanelClient(string baseUrl)
    {
        BaseUrl = (baseUrl ?? "").TrimEnd('/');
        _http = new HttpClient { Timeout = TimeSpan.FromSeconds(30) };
    }

    public bool IsAuthenticated => !string.IsNullOrWhiteSpace(AccessToken);

    /// <summary>
    /// Sign in with the panel's own username and password.
    /// </summary>
    public async Task<ApiResult<string>> LoginAsync(string userName, string password, CancellationToken ct = default)
    {
        try
        {
            var res = await _http.PostAsJsonAsync($"{BaseUrl}/api/auth/login", new
            {
                userName,
                password,
                device = new
                {
                    fingerprintHash = DeviceFingerprint.Value,
                    machineFingerprint = DeviceFingerprint.Value,
                    userAgent = "MorobotDesktop",
                    platform = "desktop"
                }
            }, JsonOpts, ct);

            if (!res.IsSuccessStatusCode)
            {
                var msg = await ReadErrorAsync(res, ct) ?? "نام کاربری یا رمز نادرست است.";
                return ApiResult<string>.Fail(msg);
            }

            var doc = await res.Content.ReadFromJsonAsync<JsonElement>(JsonOpts, ct);
            var token = ReadString(doc, "token") ?? ReadString(doc, "accessToken");
            if (string.IsNullOrWhiteSpace(token))
                return ApiResult<string>.Fail("پاسخ سرور توکن نداشت.");

            AccessToken = token;
            UserName = ReadString(doc, "userName") ?? userName;
            _http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
            return ApiResult<string>.Success(UserName!);
        }
        catch (Exception ex)
        {
            return ApiResult<string>.Fail($"اتصال به سرور برقرار نشد: {ex.Message}");
        }
    }

    /// <summary>
    /// Begin a browser sign-in and wait for the user to finish it there.
    /// </summary>
    /// <remarks>
    /// The app never sees the password. It registers a random state, opens the user's own browser at
    /// the server's authorise page, and polls until the browser reports the sign-in is done — the flow
    /// VS Code and the GitHub CLI use, so the user signs in on a page whose address bar they can check,
    /// with whatever second factor their account already has.
    ///
    /// The browser is opened with <c>UseShellExecute</c> so it is the user's default browser and not a
    /// window inside this app: an embedded browser would put the credential field back inside a program
    /// the user has to trust, which is the thing this flow exists to avoid.
    /// </remarks>
    public async Task<ApiResult<string>> LoginWithBrowserAsync(
        Action<string>? onStatus = null,
        CancellationToken ct = default)
    {
        // A random state binds this app instance to the browser tab that answers it. It is not a
        // secret; it exists so a code minted for one handshake cannot be redeemed in another.
        var state = Convert.ToHexString(System.Security.Cryptography.RandomNumberGenerator.GetBytes(24)).ToLowerInvariant();

        try
        {
            var begin = await _http.PostAsJsonAsync($"{BaseUrl}/Panel/DesktopAuth/Begin", new { state }, JsonOpts, ct);
            if (!begin.IsSuccessStatusCode)
                return ApiResult<string>.Fail(await ReadErrorAsync(begin, ct) ?? "شروع ورود ناموفق بود.");
        }
        catch (Exception ex)
        {
            return ApiResult<string>.Fail($"اتصال به سرور برقرار نشد: {ex.Message}");
        }

        var authorizeUrl = $"{BaseUrl}/Panel/DesktopAuth/Authorize?state={Uri.EscapeDataString(state)}";
        try
        {
            System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(authorizeUrl)
            {
                UseShellExecute = true
            });
        }
        catch (Exception ex)
        {
            return ApiResult<string>.Fail($"باز کردن مرورگر ناموفق بود: {ex.Message}");
        }

        onStatus?.Invoke("منتظر تکمیل ورود در مرورگر…");

        // Poll until the browser approves it. The window is generous because it covers the user
        // typing a password and completing a second factor, but bounded so a tab closed by mistake
        // does not leave the login button disabled forever.
        var deadline = DateTime.UtcNow.AddMinutes(3);
        while (DateTime.UtcNow < deadline)
        {
            if (ct.IsCancellationRequested) return ApiResult<string>.Fail("لغو شد.");
            await Task.Delay(1500, ct);

            string status;
            try
            {
                using var poll = await _http.GetAsync($"{BaseUrl}/Panel/DesktopAuth/Poll?state={Uri.EscapeDataString(state)}", ct);
                var doc = await poll.Content.ReadFromJsonAsync<JsonElement>(JsonOpts, ct);
                status = ReadString(doc, "status") ?? "expired";
                if (status == "ready")
                {
                    var code = ReadString(doc, "code");
                    if (string.IsNullOrWhiteSpace(code)) return ApiResult<string>.Fail("کد ورود دریافت نشد.");
                    return await RedeemAsync(state, code, onStatus, ct);
                }
            }
            catch (Exception ex)
            {
                return ApiResult<string>.Fail($"اتصال به سرور قطع شد: {ex.Message}");
            }

            // "expired" means the server no longer knows this handshake — a restart, or the user took
            // far too long. Retrying would need a fresh state, so this is reported instead.
            if (status == "expired") return ApiResult<string>.Fail("مهلت ورود به پایان رسید. دوباره تلاش کنید.");
        }

        return ApiResult<string>.Fail("مهلت ورود در مرورگر به پایان رسید.");
    }

    /// <summary>Exchange the browser's one-time code for an API token.</summary>
    private async Task<ApiResult<string>> RedeemAsync(
        string state, string code, Action<string>? onStatus, CancellationToken ct)
    {
        try
        {
            var res = await _http.PostAsJsonAsync($"{BaseUrl}/Panel/DesktopAuth/Redeem", new { state, code }, JsonOpts, ct);
            if (!res.IsSuccessStatusCode)
                return ApiResult<string>.Fail(await ReadErrorAsync(res, ct) ?? "ورود ناموفق بود.");

            var doc = await res.Content.ReadFromJsonAsync<JsonElement>(JsonOpts, ct);
            var token = ReadString(doc, "token");
            if (string.IsNullOrWhiteSpace(token)) return ApiResult<string>.Fail("پاسخ سرور توکن نداشت.");

            AccessToken = token;
            UserName = ReadString(doc, "userName") ?? "کاربر";
            _http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
            onStatus?.Invoke("");
            return ApiResult<string>.Success(UserName!);
        }
        catch (Exception ex)
        {
            return ApiResult<string>.Fail($"تبادل کد ورود ناموفق بود: {ex.Message}");
        }
    }

    /// <summary>Verify an already-issued token (e.g. minted in the browser) still works.</summary>
    public async Task<ApiResult<string>> UseTokenAsync(string token, string? userName, CancellationToken ct = default)
    {
        AccessToken = token?.Trim();
        if (string.IsNullOrWhiteSpace(AccessToken))
            return ApiResult<string>.Fail("توکن خالی است.");
        _http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", AccessToken);
        var res = await ListProcessesAsync(ct);
        if (!res.Ok) return ApiResult<string>.Fail(res.Error ?? "توکن پذیرفته نشد.");
        UserName = userName;
        return ApiResult<string>.Success(userName ?? "کاربر");
    }

    /// <summary>The process list, in the shape the desktop list shows.</summary>
    public async Task<ApiResult<List<ProcessRow>>> ListProcessesAsync(CancellationToken ct = default)
    {
        try
        {
            var res = await _http.GetAsync($"{BaseUrl}/api/tasks", ct);
            if (!res.IsSuccessStatusCode)
                return ApiResult<List<ProcessRow>>.Fail(await ReadErrorAsync(res, ct) ?? "لیست فرآیندها دریافت نشد.");

            var items = await res.Content.ReadFromJsonAsync<List<JsonElement>>(JsonOpts, ct) ?? new();
            var rows = items.Select(MapProcessRow).Where(r => r.Id > 0).ToList();
            return ApiResult<List<ProcessRow>>.Success(rows);
        }
        catch (Exception ex)
        {
            return ApiResult<List<ProcessRow>>.Fail($"خطا در دریافت فرآیندها: {ex.Message}");
        }
    }

    /// <summary>Fetch a process's canvas so the local engine has the graph to run.</summary>
    public async Task<ApiResult<string>> GetCanvasAsync(int taskId, CancellationToken ct = default)
    {
        try
        {
            var res = await _http.GetAsync($"{BaseUrl}/api/tasks/{taskId}/canvas", ct);
            if (!res.IsSuccessStatusCode)
                return ApiResult<string>.Fail(await ReadErrorAsync(res, ct) ?? "دیاگرام فرآیند دریافت نشد.");
            var raw = await res.Content.ReadAsStringAsync(ct);
            return ApiResult<string>.Success(raw);
        }
        catch (Exception ex)
        {
            return ApiResult<string>.Fail($"خطا در دریافت دیاگرام: {ex.Message}");
        }
    }

    /// <summary>Register a server-managed run, mirroring what the extension does before it plays.</summary>
    public async Task<bool> RegisterPlayAsync(int taskId, CancellationToken ct = default)
    {
        try
        {
            var res = await _http.PostAsJsonAsync($"{BaseUrl}/Panel/Tasks/RegisterPlay",
                new { taskId = taskId.ToString(), userName = UserName }, JsonOpts, ct);
            return res.IsSuccessStatusCode;
        }
        catch { return false; }
    }

    /// <summary>Clear a server-managed run when it ends (or when the stop button is used).</summary>
    public async Task UnregisterPlayAsync(int taskId, CancellationToken ct = default)
    {
        try
        {
            await _http.PostAsJsonAsync($"{BaseUrl}/Panel/Tasks/UnregisterPlay",
                new { taskId = taskId.ToString() }, JsonOpts, ct);
        }
        catch { /* best effort; the server expires a stale session on its own */ }
    }

    /// <summary>Push the write-back of a local run, exactly as the panel's Sync button does.</summary>
    public async Task<ApiResult<string>> SyncLocalRunAsync(
        int taskId, DateTime? localRunAt, IEnumerable<object> cells, CancellationToken ct = default)
    {
        try
        {
            var res = await _http.PostAsJsonAsync($"{BaseUrl}/api/tasks/{taskId}/sync-local-run",
                new { localRunAt, cells }, JsonOpts, ct);
            if (!res.IsSuccessStatusCode)
                return ApiResult<string>.Fail(await ReadErrorAsync(res, ct) ?? "سینک ناموفق بود.");
            return ApiResult<string>.Success(await res.Content.ReadAsStringAsync(ct));
        }
        catch (Exception ex)
        {
            return ApiResult<string>.Fail($"خطا در سینک: {ex.Message}");
        }
    }

    /// <summary>
    /// The deployment's app name, for naming this app "&lt;AppName&gt; Player".
    /// </summary>
    /// <remarks>
    /// Reuses the branding endpoint the extension already reads, so the desktop app and the
    /// extension cannot disagree about what the product is called on one server. The endpoint
    /// exposes one resolved name (`appName`), not the per-language pair — which is what we want:
    /// the product identity, already resolved by the panel.
    /// </remarks>
    public async Task<string?> GetAppNameAsync(CancellationToken ct = default)
    {
        try
        {
            var res = await _http.GetAsync($"{BaseUrl}/extension/branding", ct);
            if (!res.IsSuccessStatusCode) return null;
            var doc = await res.Content.ReadFromJsonAsync<JsonElement>(JsonOpts, ct);
            return ReadString(doc, "appName");
        }
        catch { return null; }
    }

    /// <summary>Fetch the deployment's signed licence document, so the runner can honour the same gate the
    /// server does.
    /// </summary>
    public async Task<string?> GetLicenseJsonAsync(CancellationToken ct = default)
    {
        foreach (var path in new[] { "/api/license/document", "/Admin/License/Document" })
        {
            try
            {
                var res = await _http.GetAsync($"{BaseUrl}{path}", ct);
                if (!res.IsSuccessStatusCode) continue;
                var text = await res.Content.ReadAsStringAsync(ct);
                if (!string.IsNullOrWhiteSpace(text)) return text;
            }
            catch { /* try the next path */ }
        }
        return null;
    }

    /// <summary>Read one cell of a source, for a step that pulls its value from the server.</summary>
    public async Task<string?> ReadCellAsync(int dataSourceId, int rowIndex, string columnKey, CancellationToken ct = default)
    {
        try
        {
            var url = $"{BaseUrl}/api/datasources/{dataSourceId}/cells" +
                      $"?rowIndex={rowIndex}&columnKey={Uri.EscapeDataString(columnKey)}";
            var res = await _http.GetAsync(url, ct);
            if (!res.IsSuccessStatusCode) return null;
            var doc = await res.Content.ReadFromJsonAsync<JsonElement>(JsonOpts, ct);
            return ReadString(doc, "cellValue") ?? "";
        }
        catch { return null; }
    }

    /// <summary>Write one cell of a SHARED source — the only source a local run writes remotely.</summary>
    public async Task<bool> PatchCellAsync(
        int dataSourceId, int rowIndex, string columnKey, string? value, CancellationToken ct = default)
    {
        try
        {
            var res = await _http.PatchAsJsonAsync($"{BaseUrl}/api/datasources/{dataSourceId}/cells", new
            {
                rowIndex,
                columnKey,
                cellValue = value ?? "",
                insertMode = "auto"
            }, JsonOpts, ct);
            return res.IsSuccessStatusCode;
        }
        catch { return false; }
    }

    /// <summary>Insert a blank row into a source at the given index.</summary>
    public Task<ApiResult<string>> InsertRowAsync(int dataSourceId, int rowIndex, CancellationToken ct = default)
        => PostRowAsync($"{BaseUrl}/api/datasources/{dataSourceId}/rows/add", new { rowIndex }, ct);

    /// <summary>Delete one row from a source.</summary>
    public async Task<ApiResult<string>> DeleteRowAsync(int dataSourceId, int rowIndex, CancellationToken ct = default)
    {
        try
        {
            var res = await _http.DeleteAsync($"{BaseUrl}/api/datasources/{dataSourceId}/rows/{rowIndex}", ct);
            return res.IsSuccessStatusCode
                ? ApiResult<string>.Success("ok")
                : ApiResult<string>.Fail(await ReadErrorAsync(res, ct) ?? "حذف ردیف ناموفق بود.");
        }
        catch (Exception ex)
        {
            return ApiResult<string>.Fail($"خطا در حذف ردیف: {ex.Message}");
        }
    }

    private async Task<ApiResult<string>> PostRowAsync(string url, object body, CancellationToken ct)
    {
        try
        {
            var res = await _http.PostAsJsonAsync(url, body, JsonOpts, ct);
            return res.IsSuccessStatusCode
                ? ApiResult<string>.Success("ok")
                : ApiResult<string>.Fail(await ReadErrorAsync(res, ct) ?? "تغییر ردیف‌های منبع ناموفق بود.");
        }
        catch (Exception ex)
        {
            return ApiResult<string>.Fail($"خطا در تغییر ردیف‌ها: {ex.Message}");
        }
    }

    /// <summary>Persist the step gap and highlight colour onto the process's start node.</summary>
    public async Task<ApiResult<string>> SaveRunSettingsAsync(
        int taskId, int stepDelayMs, string highlightColor, CancellationToken ct = default)
    {
        try
        {
            var res = await _http.PostAsJsonAsync($"{BaseUrl}/api/tasks/{taskId}/run-settings",
                new { stepDelayMs, highlightColor }, JsonOpts, ct);
            return res.IsSuccessStatusCode
                ? ApiResult<string>.Success("ok")
                : ApiResult<string>.Fail(await ReadErrorAsync(res, ct) ?? "ذخیرهٔ تنظیمات ناموفق بود.");
        }
        catch (Exception ex)
        {
            return ApiResult<string>.Fail($"خطا در ذخیرهٔ تنظیمات: {ex.Message}");
        }
    }

    private static ProcessRow MapProcessRow(JsonElement e) => new()
    {
        Id = ReadInt(e, "id"),
        Title = ReadString(e, "title") ?? "بدون عنوان",
        StepCount = ReadInt(e, "stepCount"),
        GroupCount = ReadInt(e, "groupCount"),
        DataSourceCount = ReadInt(e, "dataSourceCount"),
        UpdatedAtUtc = ReadDate(e, "updatedAtUtc"),
        CanExecute = ReadBool(e, "canExecute", true),
        CanEdit = ReadBool(e, "canEdit", false),
        // The server record is always server-managed; a local run is a decision made on the client
        // and remembered locally, so it starts from the server's truth.
        RunOnServer = true
    };

    private static async Task<string?> ReadErrorAsync(HttpResponseMessage res, CancellationToken ct)
    {
        try
        {
            var text = await res.Content.ReadAsStringAsync(ct);
            if (string.IsNullOrWhiteSpace(text)) return null;
            using var doc = JsonDocument.Parse(text);
            if (doc.RootElement.ValueKind == JsonValueKind.Object
                && doc.RootElement.TryGetProperty("message", out var m))
                return m.GetString();
            return text.Length > 300 ? text[..300] : text;
        }
        catch { return null; }
    }

    private static string? ReadString(JsonElement e, string name)
        => e.ValueKind == JsonValueKind.Object && e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String
            ? v.GetString() : null;

    private static int ReadInt(JsonElement e, string name)
        => e.ValueKind == JsonValueKind.Object && e.TryGetProperty(name, out var v) && v.TryGetInt32(out var i) ? i : 0;

    private static bool ReadBool(JsonElement e, string name, bool fallback)
        => e.ValueKind == JsonValueKind.Object && e.TryGetProperty(name, out var v) && v.ValueKind is JsonValueKind.True or JsonValueKind.False
            ? v.GetBoolean() : fallback;

    private static DateTime? ReadDate(JsonElement e, string name)
        => e.ValueKind == JsonValueKind.Object && e.TryGetProperty(name, out var v)
           && v.ValueKind == JsonValueKind.String && v.TryGetDateTime(out var d) ? d : null;

    public void Dispose() => _http.Dispose();
}
