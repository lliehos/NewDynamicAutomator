using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Morobot.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    /// <summary>
    /// Insert <c>ProcessManager</c> into <see cref="Morobot.Domain.Enums.UserRole"/> between User
    /// and Admin, renumbering the rows that were already stored.
    /// </summary>
    /// <remarks>
    /// The column is an int, so the new value has to be squeezed in and everything above it shifted
    /// up by one. Without the shift every existing administrator (stored as 1) would read back as
    /// <c>ProcessManager</c> — an account that can publish templates but cannot open the admin area.
    ///
    /// The shift is a single UPDATE guarded by the old bound (&gt;= 1), so it is correct however
    /// many rows exist and never touches the User rows (stored as 0).
    /// </remarks>
    public partial class SeedProcessManagerRolePlaceholder : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // 1 (old Admin) -> 2 (new Admin). Users (0) are untouched.
            migrationBuilder.Sql("UPDATE [Users] SET [Role] = 2 WHERE [Role] >= 1;");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Fold any ProcessManager (1) back to User (0) first, so the shift below cannot leave a
            // stray 1 that the old enum would read as Admin.
            migrationBuilder.Sql("UPDATE [Users] SET [Role] = 0 WHERE [Role] = 1;");
            migrationBuilder.Sql("UPDATE [Users] SET [Role] = 1 WHERE [Role] >= 2;");
        }
    }
}
