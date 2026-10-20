using Webautomator.Contracts.Auth;
using Webautomator.Infrastructure.Identity;
using Webautomator.Infrastructure.Options;
using Webautomator.Infrastructure.Persistence;
using Webautomator.Infrastructure.Services;
using Webautomator.Infrastructure.Services.Payments;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace Webautomator.Infrastructure;

public static class DependencyInjection
{
    /// <summary>
    /// Wires the persistence, licensing and application services. <paramref name="contentRoot"/>
    /// is the folder relative paths (update staging, uploads) resolve against; it defaults to
    /// the process base directory, which is correct for a published deployment.
    /// </summary>
    public static IServiceCollection AddInfrastructure(
        this IServiceCollection services,
        IConfiguration config,
        string? contentRoot = null)
    {
        var cs = config.GetConnectionString("Default")
                 ?? throw new InvalidOperationException("Connection string 'Default' is missing.");

        // Resilience, without overriding the operator's own choices.
        //
        // A published deployment commonly fails the FIRST request after a quiet period and works on
        // refresh: either the network dropped the pooled connection while it sat idle, or the
        // database was suspended/auto-paused and the connect attempt hit it before it woke up. The
        // app talks to the database on every page — the landing page included (licence and
        // SystemSettings) — so the first page load is exactly where that failure shows up.
        //
        // Idle Connection Resiliency (Connect Retry*) re-opens a pooled connection the network
        // silently killed; the longer connect timeout gives a waking database room to answer.
        // Values already present in the connection string win, so an operator who tuned them keeps
        // their tuning.
        var builder = new Microsoft.Data.SqlClient.SqlConnectionStringBuilder(cs);
        if (!builder.ContainsKey("Connect Retry Count")) builder.ConnectRetryCount = 3;
        if (!builder.ContainsKey("Connect Retry Interval")) builder.ConnectRetryInterval = 2;
        if (!builder.ContainsKey("Connect Timeout")) builder.ConnectTimeout = 30;

        // SaveChanges and queries are executed through this strategy: a transient SQL error is
        // retried instead of surfacing as "database error" on the first click. Code that opens its
        // own transaction MUST run through `Database.CreateExecutionStrategy()` — see
        // DataSourceService's cell/structure writes.
        services.AddDbContext<AppDbContext>(o => o.UseSqlServer(builder.ConnectionString, sql =>
            sql.EnableRetryOnFailure(
                maxRetryCount: 5,
                maxRetryDelay: TimeSpan.FromSeconds(15),
                errorNumbersToAdd: null)));
        services.Configure<WebautomatorOptions>(config.GetSection(WebautomatorOptions.SectionName));
        services.Configure<OfflineUpdateOptions>(config.GetSection(OfflineUpdateOptions.SectionName));
        services.AddHttpClient();
        services.AddHttpClient(nameof(UpdateCheckService), client =>
        {
            client.DefaultRequestHeaders.UserAgent.ParseAdd("Webautomator-UpdateCheck/1.0");
            client.Timeout = TimeSpan.FromSeconds(20);
        });
        services.AddScoped<LicenseService>();
        services.AddScoped<DeploymentBindingService>();
        services.AddScoped<BrandingService>();
        services.AddScoped<ProductUpdateFeedService>();
        services.AddScoped<UpdateCheckService>();
        var resolvedContentRoot = string.IsNullOrWhiteSpace(contentRoot) ? AppContext.BaseDirectory : contentRoot!;
        services.AddScoped<OfflineUpdateService>(sp => new OfflineUpdateService(
            sp.GetRequiredService<Microsoft.Extensions.Options.IOptions<OfflineUpdateOptions>>(),
            resolvedContentRoot,
            sp.GetRequiredService<Microsoft.Extensions.Logging.ILogger<OfflineUpdateService>>()));
        services.AddScoped<AuthService>();
        services.AddScoped<AuthModeResolver>();
        services.AddScoped<ILdapAuthenticator, LdapAuthenticator>();
        services.AddScoped<EntitlementService>();
        services.AddScoped<EventLogService>();
        services.AddScoped<MonitoringService>();
        services.AddScoped<SystemSettingsService>();
        services.AddScoped<DiagramSettingsService>();
        services.AddScoped<TaskService>();
        services.AddScoped<TaskShareService>();
        services.AddScoped<TemplateService>();
        services.AddScoped<RecordingService>();
        services.AddScoped<DataSourceService>();
        services.AddScoped<LegacyImportService>();
        // Commerce: the pricing rules, the order/payment flow, and the gateways it can use.
        services.AddScoped<PricingService>();
        services.AddScoped<CheckoutService>();
        // The manual gateway is always present: it needs no credentials, so the checkout works on a
        // fresh install. A real PSP registered later is preferred by key where one is configured.
        services.AddScoped<IPaymentGateway, ManualPaymentGateway>();
        services.AddSingleton<SmartLearningService>();
        return services;
    }
}
