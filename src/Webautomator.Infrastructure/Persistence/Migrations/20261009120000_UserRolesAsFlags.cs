using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Webautomator.Infrastructure.Persistence;

#nullable disable

namespace Webautomator.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// Convert <c>Users.Role</c> from the old sequential enum to the role bit set.
    /// </summary>
    /// <remarks>
    /// The column was an int before and stays an int, so nothing about the schema changes — only the
    /// meaning of the values. Under the old enum User=0, ProcessManager=1, Admin=2, Monitor=3; under
    /// the new flags User=1, ProcessManager=2, Admin=4, Monitor=8. Without this UPDATE every stored
    /// account would be re-read as a different role: an administrator (2) would become a process
    /// manager, and a user (0) would become a role-less account that no check recognises.
    ///
    /// A single CASE both renumbers and leaves the column ready for combined values later — the old
    /// layout had no room for "two roles at once", which is the point of the change.
    /// </remarks>
    [DbContext(typeof(AppDbContext))]
    [Migration("20261009120000_UserRolesAsFlags")]
    public partial class UserRolesAsFlags : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(
                "UPDATE [Users] SET [Role] = CASE [Role] " +
                "WHEN 0 THEN 1 " +   // User
                "WHEN 1 THEN 2 " +   // ProcessManager
                "WHEN 2 THEN 4 " +   // Admin
                "WHEN 3 THEN 8 " +   // Monitor
                "ELSE 1 END;");      // anything unexpected degrades to User, never to a privilege
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Fold combined sets back to their strongest single role, because the old enum cannot
            // hold more than one. A stale admin or monitor bit must not survive as a smaller number
            // that the old checks would read as a different role.
            migrationBuilder.Sql(
                "UPDATE [Users] SET [Role] = CASE " +
                "WHEN ([Role] & 4) = 4 THEN 2 " +   // Admin wins
                "WHEN ([Role] & 8) = 8 THEN 3 " +   // then Monitor
                "WHEN ([Role] & 2) = 2 THEN 1 " +   // then ProcessManager
                "ELSE 0 END;");                     // otherwise User
        }
    }
}
