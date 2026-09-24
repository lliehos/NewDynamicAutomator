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
    public static IServiceCollection AddInfrastructure(this IServiceCollection services, IConfiguration config)
    {
        var cs = config.GetConnectionString("Default")
                 ?? throw new InvalidOperationException("Connection string 'Default' is missing.");

        services.AddDbContext<AppDbContext>(o => o.UseSqlServer(cs));
        services.Configure<MorobotOptions>(config.GetSection(MorobotOptions.SectionName));
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
        services.AddScoped<AuthService>();
        services.AddScoped<EntitlementService>();
        services.AddScoped<EventLogService>();
        services.AddScoped<SystemSettingsService>();
        services.AddScoped<TaskService>();
        services.AddScoped<TaskShareService>();
        services.AddScoped<RecordingService>();
        services.AddScoped<DataSourceService>();
        services.AddScoped<LegacyImportService>();
        services.AddSingleton<SmartLearningService>();
        return services;
    }
}
