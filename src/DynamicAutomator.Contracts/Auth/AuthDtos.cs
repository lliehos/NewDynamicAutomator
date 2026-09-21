using DynamicAutomator.Domain.Entities;
using DynamicAutomator.Domain.Enums;

namespace DynamicAutomator.Contracts.Auth;

public class LoginRequest
{
    public string UserName { get; set; } = string.Empty;
    public string Password { get; set; } = string.Empty;
}

public class LoginResponse
{
    public string Token { get; set; } = string.Empty;
    public int UserId { get; set; }
    public string UserName { get; set; } = string.Empty;
    public string DisplayName { get; set; } = string.Empty;
}

public class MeResponse
{
    public int UserId { get; set; }
    public string UserName { get; set; } = string.Empty;
    public bool IsAuthenticated { get; set; }
}
