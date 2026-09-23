using Morobot.Infrastructure.Identity;
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
        services.AddScoped<AuthService>();
        services.AddScoped<TaskService>();
        services.AddScoped<RecordingService>();
        services.AddScoped<GraphService>();
        services.AddScoped<DataSourceService>();
        services.AddSingleton<SmartLearningService>();
        return services;
    }
}
