using Morobot.Contracts.Auth;
using Morobot.Infrastructure.Identity;
using Morobot.Infrastructure.Options;
using Morobot.Infrastructure.Persistence;
using Morobot.Infrastructure.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace Morobot.Infrastructure;

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
        services.Configure<MorobotOptions>(config.GetSection(MorobotOptions.SectionName));
        services.Configure<OfflineUpdateOptions>(config.GetSection(OfflineUpdateOptions.SectionName));
        services.AddHttpClient();
        services.AddHttpClient(nameof(UpdateCheckService), client =>
        {
            client.DefaultRequestHeaders.UserAgent.ParseAdd("Morobot-UpdateCheck/1.0");
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
        services.AddScoped<SystemSettingsService>();
        services.AddScoped<DiagramSettingsService>();
        services.AddScoped<TaskService>();
        services.AddScoped<TaskShareService>();
        services.AddScoped<RecordingService>();
        services.AddScoped<DataSourceService>();
        services.AddScoped<LegacyImportService>();
        services.AddSingleton<SmartLearningService>();
        return services;
    }
}
