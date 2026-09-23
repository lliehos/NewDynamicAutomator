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
builder.Services.AddScoped<ILocaleService, LocaleService>();
builder.Services.AddControllersWithViews(o =>
    {
        o.Filters.Add<Morobot.Web.Filters.BlockAdminFromPanelFilter>();
        o.Filters.Add<Morobot.Web.Filters.RequireProfileCompleteFilter>();
    })
    .AddJsonOptions(o =>
    {
        o.JsonSerializerOptions.PropertyNamingPolicy = System.Text.Json.JsonNamingPolicy.CamelCase;
        o.JsonSerializerOptions.PropertyNameCaseInsensitive = true;
    });
builder.Services.AddSignalR();
builder.Services.AddSingleton<Morobot.Web.Services.PlaySessionTracker>();
builder.Services.AddScoped<Morobot.Web.Services.CatalogLiveService>();
builder.Services.AddInfrastructure(builder.Configuration);

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

var app = builder.Build();

if (!app.Environment.IsDevelopment())
{
    app.UseExceptionHandler("/Home/Error");
    app.UseHsts();
}

app.UseHttpsRedirection();
app.UseStaticFiles();
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
    var log = scope.ServiceProvider.GetRequiredService<ILoggerFactory>().CreateLogger("CanvasBackfill");
    // Must run while legacy Groups/… tables still exist (before Migrate DROP).
    await Morobot.Infrastructure.Services.CanvasBackfillService.RunIfNeededAsync(cs, log);

    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    await db.Database.MigrateAsync();
    await DbSeeder.SeedAsync(db);
}

app.Run();
