using DynamicAutomator.Domain.Entities;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace DynamicAutomator.Infrastructure.Persistence;

public static class DbSeeder
{
    public static async Task SeedAsync(AppDbContext db)
    {
        if (await db.Users.AnyAsync())
            return;

        var hasher = new PasswordHasher<AppUser>();
        var admin = new AppUser
        {
            UserName = "admin",
            FirstName = "مدیر",
            LastName = "سیستم",
            IsActive = true,
            CreatedAtUtc = DateTime.UtcNow
        };
        admin.PasswordHash = hasher.HashPassword(admin, "Admin123!");
        db.Users.Add(admin);
        await db.SaveChangesAsync();
    }
}
