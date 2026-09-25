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

builder.Services.AddHttpContextAccessor();
builder.Services.AddMemoryCache();
builder.Services.AddScoped<ILocaleService, LocaleService>();
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
builder.Services.AddScoped<Morobot.Web.Services.CatalogLiveService>();
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
                await events.LogAsync(
                    "Info", "Play", "PlayStarted",
                    $"Task {info.TaskId} play started",
                    info.UserId, info.UserName,
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
    }
});
app.UseRouting();
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

using (var scope = app.Services.CreateScope())
{
    var config = scope.ServiceProvider.GetRequiredService<IConfiguration>();
    var cs = config.GetConnectionString("Default")
             ?? throw new InvalidOperationException("Connection string 'Default' is missing.");
    var log = scope.ServiceProvider.GetRequiredService<ILoggerFactory>().CreateLogger("Startup");

    await Morobot.Infrastructure.Services.DatabaseBootstrapService.EnsureSqlServerDatabaseAsync(cs, log);
    await Morobot.Infrastructure.Services.CanvasBackfillService.RunIfNeededAsync(cs, log);

    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    await Morobot.Infrastructure.Services.DatabaseBootstrapService.MigrateAndSeedAsync(db, log);

    var license = scope.ServiceProvider.GetRequiredService<Morobot.Infrastructure.Services.LicenseService>();
    await license.EnsureAnchorAsync();

    var sync = scope.ServiceProvider.GetRequiredService<ExtensionSyncService>();
    var overlay = scope.ServiceProvider.GetRequiredService<ExtensionBrandingOverlay>();
    sync.SyncNow("startup");
    await overlay.ApplyAllPackagesAsync(sync);
}

app.Run();
