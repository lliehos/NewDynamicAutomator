using DynamicAutomator.Infrastructure.Identity;
using DynamicAutomator.Infrastructure.Persistence;
using DynamicAutomator.Infrastructure.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace DynamicAutomator.Infrastructure;

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
        return services;
    }
}
