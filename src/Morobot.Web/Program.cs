using System.Text;
using Morobot.Infrastructure;
using Morobot.Infrastructure.Identity;
using Morobot.Infrastructure.Persistence;
using Morobot.Web.Hubs;
using Morobot.Web.Middleware;
using Morobot.Web.Services;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;

var builder = WebApplication.CreateBuilder(args);

// Configuration layering, lowest priority first:
//   1. appsettings.json                    — shared defaults, shipped in Git
//   2. appsettings.{Environment}.json      — Development or Production, chosen by ASPNETCORE_ENVIRONMENT
//   3. environment variables               — ASPNETCORE_-prefixed vars and ConnectionStrings__Default
//   4. appsettings.ServerUpdate.json       — added here, so it wins over all of the above
//
// Layer 4 exists for the offline updater. A fielded server keeps the customer's connection string
// and secrets in appsettings.Production.json, and an update package needs a way to force a value
// through (a new update feed URL, a rollout flag) without an operator hand-editing that file.
// It is added LAST so it is authoritative, and it is optional so a deployment that never uses the
// updater can delete it. Reload-on-change is off on purpose: this is boot-time configuration, and
// silently rebinding the database mid-run would be worse than requiring a restart.
var serverUpdateSettings = Path.Combine(builder.Environment.ContentRootPath, "appsettings.ServerUpdate.json");
builder.Configuration.AddJsonFile(serverUpdateSettings, optional: true, reloadOnChange: false);

builder.Services.AddHttpContextAccessor();
builder.Services.AddMemoryCache();
builder.Services.AddScoped<ILocaleService, LocaleService>();
builder.Services.AddScoped<BrandingCookieService>();
builder.Services.AddScoped<TenantBrandingViewService>();
builder.Services.AddScoped<ExtensionBrandingOverlay>();
builder.Services.AddSingleton<SetupGuideService>();
builder.Services.AddControllersWithViews(o =>
    {
        o.Filters.Add<Morobot.Web.Filters.BlockAdminFromPanelFilter>();
        o.Filters.Add<Morobot.Web.Filters.LicenseGateFilter>();
        o.Filters.Add<Morobot.Web.Filters.RequireProfileCompleteFilter>();
        o.Filters.Add<Morobot.Web.Filters.UserPresenceFilter>();
        o.Filters.Add<Morobot.Web.Filters.TenantBrandingViewDataFilter>();
    })
    .AddJsonOptions(o =>
    {
        o.JsonSerializerOptions.PropertyNamingPolicy = System.Text.Json.JsonNamingPolicy.CamelCase;
        o.JsonSerializerOptions.PropertyNameCaseInsensitive = true;
    });
builder.Services.AddSignalR();
builder.Services.AddSingleton<Morobot.Web.Services.PlaySessionTracker>();
builder.Services.AddSingleton<Morobot.Web.Services.UpdateNotifyStateService>();
builder.Services.AddSingleton<Morobot.Web.Services.IAppVersionService, Morobot.Web.Services.AppVersionService>();
builder.Services.AddScoped<Morobot.Web.Services.CatalogLiveService>();
// Singleton: the setup state must survive for the process lifetime so the "try again" action can
// flip the whole application from blocked to ready without a restart.
builder.Services.AddSingleton<Morobot.Web.Services.DatabaseSetupState>();
builder.Services.AddInfrastructure(builder.Configuration, builder.Environment.ContentRootPath);
builder.Services.AddScoped<Morobot.Infrastructure.Services.ILicenseRequestHostAccessor, HttpLicenseRequestHostAccessor>();

var jwtKey = builder.Configuration["Jwt:Key"] ?? "CHANGE-ME-TO-A-LONG-SECRET-KEY-32+";
var issuer = builder.Configuration["Jwt:Issuer"] ?? "Morobot";
var audience = builder.Configuration["Jwt:Audience"] ?? "Morobot";

builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidateAudience = true,
            ValidateIssuerSigningKey = true,
            ValidIssuer = issuer,
            ValidAudience = audience,
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtKey)),
            ClockSkew = TimeSpan.FromMinutes(1),
            RoleClaimType = System.Security.Claims.ClaimTypes.Role,
            NameClaimType = System.Security.Claims.ClaimTypes.Name
        };
        options.Events = new JwtBearerEvents
        {
            OnMessageReceived = ctx =>
            {
                if (string.IsNullOrEmpty(ctx.Token)
                    && ctx.Request.Cookies.TryGetValue(AuthService.CookieName, out var cookie))
                {
                    ctx.Token = cookie;
                }
                if (string.IsNullOrEmpty(ctx.Token)
                    && ctx.Request.Path.StartsWithSegments("/hubs")
                    && ctx.Request.Query.TryGetValue("access_token", out var accessToken))
                {
                    ctx.Token = accessToken;
                }
                return Task.CompletedTask;
            },
            OnChallenge = ctx =>
            {
                if (ctx.Request.Path.StartsWithSegments("/api")
                    || ctx.Request.Path.StartsWithSegments("/hubs"))
                {
                    ctx.HandleResponse();
                    ctx.Response.StatusCode = StatusCodes.Status401Unauthorized;
                    return Task.CompletedTask;
                }

                if (!ctx.Response.HasStarted)
                {
                    ctx.HandleResponse();
                    ctx.Response.Redirect("/Panel/Account/Login");
                }
                return Task.CompletedTask;
            }
        };
    });
builder.Services.AddAuthorization();
builder.Services.AddSingleton<ExtensionSyncService>();
builder.Services.AddHostedService(sp => sp.GetRequiredService<ExtensionSyncService>());
builder.Services.AddHostedService<UpdateNotifyBackgroundService>();

var app = builder.Build();

// Record every play start in the durable event log.
//
// Play sessions themselves live in memory, so without this there is no history at all: the
// dashboard's activity trend could only ever show sessions that happen to still be running, and
// a finished run vanished from the chart. Writing a "Play" event at the moment of start gives
// the trend a real series to read, and it reuses the existing event table rather than adding a
// schema just for a chart.
//
// The handler is fired from the registering request thread, so the database write is handed to a
// background task: a slow or failing write must not delay or fail the play it is describing.
{
    var plays = app.Services.GetRequiredService<Morobot.Web.Services.PlaySessionTracker>();
    var log = app.Services.GetRequiredService<IServiceScopeFactory>();
    plays.OnStarted += info =>
    {
        _ = Task.Run(async () =>
        {
            try
            {
                using var scope = log.CreateScope();
                var events = scope.ServiceProvider.GetRequiredService<Morobot.Infrastructure.Services.EventLogService>();
                // The task id also goes in DetailsJson: the message and path are for humans, and
                // reading an id back out of either would be fragile. This is the field the
                // process list queries to answer "when was this last run, and by whom".
                var details = System.Text.Json.JsonSerializer.Serialize(new { taskId = info.TaskId });
                await events.LogAsync(
                    "Info", "Play", "PlayStarted",
                    $"Task {info.TaskId} play started",
                    info.UserId, info.UserName,
                    detailsJson: details,
                    path: $"/Panel/Tasks/Editor/{info.TaskId}");
            }
            catch
            {
                // Analytics only: never let a logging failure surface to the caller.
            }
        });
    };
}

if (!app.Environment.IsDevelopment())
{
    app.UseExceptionHandler("/Home/Error");
    app.UseHsts();
}

app.UseHttpsRedirection();
app.UseStaticFiles(new StaticFileOptions
{
    OnPrepareResponse = ctx =>
    {
        var path = ctx.Context.Request.Path.Value ?? "";
        if (path.StartsWith("/uploads/branding", StringComparison.OrdinalIgnoreCase)
            || path.StartsWith("/img/brand", StringComparison.OrdinalIgnoreCase))
        {
            ctx.Context.Response.Headers.AccessControlAllowOrigin = "*";
        }

        // A request carrying ?v= is referencing one specific build of the file, because the views
        // stamp every asset with the assembly version. That URL can never mean something else
        // later, so it is safe to cache it hard instead of letting the browser revalidate on
        // every navigation. Unversioned URLs keep the framework default.
        if (ctx.Context.Request.Query.ContainsKey("v"))
        {
            ctx.Context.Response.Headers.CacheControl = "public,max-age=31536000,immutable";
        }
    }
});
app.UseRouting();

// Before authentication and before the controllers: while the database is unreachable there is
// nothing to authenticate against, and the sign-in form would itself fail. This diverts everything
// to the setup page except the page itself, its retry action, and the static assets it needs.
app.UseMiddleware<Morobot.Web.Middleware.DatabaseSetupMiddleware>();

app.UseMiddleware<CultureMiddleware>();
app.UseAuthentication();
app.UseAuthorization();
app.MapControllers();
app.MapHub<PlayDataHub>("/hubs/play-data");
app.MapHub<CanvasHub>("/hubs/canvas");
app.MapHub<CatalogHub>("/hubs/catalog");
app.MapControllerRoute(
    name: "areas",
    pattern: "{area:exists}/{controller=Home}/{action=Index}/{id?}");
app.MapControllerRoute(
    name: "default",
    pattern: "{controller=Home}/{action=Index}/{id?}");

// Initialisation runs in the BACKGROUND, not before the host starts listening.
//
// The initialisation body, given its own function so the setup page's retry action can run the very
// same sequence. A retry only re-tests the connection; without this, a deployment whose DBA had just
// created the login would sit in Preparing with nothing working on it. The host assigns this to
// DatabaseSetupState.ResumeInitialisation below.
async Task RunInitialisationAsync(IServiceProvider services, CancellationToken ct)
{
    using var scope = services.CreateScope();
    var config = scope.ServiceProvider.GetRequiredService<IConfiguration>();
    var log = scope.ServiceProvider.GetRequiredService<ILoggerFactory>().CreateLogger("Startup");
    var setupState = scope.ServiceProvider.GetRequiredService<DatabaseSetupState>();

    try
    {
        var cs = config.GetConnectionString("Default")
                 ?? throw new InvalidOperationException(
                     "Connection string 'Default' is missing. Set ConnectionStrings:Default in " +
                     "appsettings.json (or as an environment variable) before starting the app.");

        setupState.ReportProgress("بررسی اتصال به دیتابیس…");
        var dbCheck = await Morobot.Infrastructure.Services.DatabaseBootstrapService
            .EnsureDatabaseAsync(cs, log);

        if (!dbCheck.IsReady)
        {
            // Not fatal. Record the diagnosis; the middleware serves the setup page, and the retry
            // action re-runs this whole sequence once a DBA has created what is missing. Exiting
            // here would mean a console trace on a server nobody is watching.
            setupState.RecordStartupFailure(dbCheck);
            log.LogWarning(
                "Database is not ready ({Stage}); serving the setup page. {Summary}",
                dbCheck.Stage, dbCheck.Summary);
            return;
        }

        setupState.ReportProgress("به‌روزرسانی ساختار دیتابیس…");
        await Morobot.Infrastructure.Services.CanvasBackfillService.RunIfNeededAsync(cs, log);

        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        await Morobot.Infrastructure.Services.DatabaseBootstrapService.MigrateAndSeedAsync(db, log);

        setupState.ReportProgress("آماده‌سازی لایسنس و افزونه‌ها…");
        var license = scope.ServiceProvider.GetRequiredService<Morobot.Infrastructure.Services.LicenseService>();
        await license.EnsureAnchorAsync();

        // SyncNow copies the extension files, but its branding overlay is skipped while the state is
        // still Preparing — the overlay reads SystemSettings, which has only just been created. The
        // explicit ApplyAllPackagesAsync below is what actually applies it, so the order here is
        // deliberate: files first, then overlay, and only then is the application announced ready.
        var sync = scope.ServiceProvider.GetRequiredService<ExtensionSyncService>();
        var overlay = scope.ServiceProvider.GetRequiredService<ExtensionBrandingOverlay>();
        sync.SyncNow("startup");
        await overlay.ApplyAllPackagesAsync(sync);

        // Last: flip the state so the progress page stops polling and the real site is served.
        setupState.MarkReady();
        log.LogInformation("Startup initialisation completed.");
    }
    catch (Exception ex)
    {
        log.LogCritical(ex, "Startup initialisation failed.");
        setupState.RecordStartupFailure(new Morobot.Infrastructure.Services.DatabaseSetupResult
        {
            Stage = Morobot.Infrastructure.Services.DatabaseSetupStage.ServerUnreachable,
            Summary = "راه‌اندازی سامانه با خطا متوقف شد. برای جزئیات، لاگ سرور را ببینید.",
            ServerMessage = ex.Message
        });
    }
}

// Let the setup page's retry resume the full sequence, not just the connection probe.
app.Services.GetRequiredService<DatabaseSetupState>().ResumeInitialisation =
    ct => RunInitialisationAsync(app.Services, ct);

// Fire and forget on purpose: the host must start listening immediately so the progress page can be
// served while this runs. Nothing here may throw — RunInitialisationAsync guards its whole body.
_ = Task.Run(() => RunInitialisationAsync(app.Services, CancellationToken.None));

await app.RunAsync();

