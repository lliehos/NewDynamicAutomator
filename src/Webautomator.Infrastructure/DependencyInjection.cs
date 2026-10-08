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

        services.AddDbContext<AppDbContext>(o => o.UseSqlServer(cs));
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
