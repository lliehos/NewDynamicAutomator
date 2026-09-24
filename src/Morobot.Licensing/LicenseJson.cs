using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Morobot.Licensing;

public static class LicenseJson
{
    private static readonly JsonSerializerOptions WriteOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        WriteIndented = true
    };

    private static readonly JsonSerializerOptions CanonicalOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        WriteIndented = false
    };

    public static string SerializeDocument(LicenseDocument doc)
        => JsonSerializer.Serialize(doc, WriteOptions);

    public static string SerializeActivationRequest(ActivationRequest request)
        => JsonSerializer.Serialize(request, WriteOptions);

    public static LicenseDocument? TryParseDocument(string json)
    {
        try
        {
            return JsonSerializer.Deserialize<LicenseDocument>(json, WriteOptions);
        }
        catch (JsonException)
        {
            return null;
        }
    }

    public static ActivationRequest? TryParseActivationRequest(string json)
    {
        try
        {
            return JsonSerializer.Deserialize<ActivationRequest>(json, WriteOptions);
        }
        catch (JsonException)
        {
            return null;
        }
    }

    /// <summary>Deterministic UTF-8 bytes for RSA signing.</summary>
    public static byte[] CanonicalPayloadBytes(LicensePayload payload)
    {
        var json = JsonSerializer.Serialize(payload, CanonicalOptions);
        return Encoding.UTF8.GetBytes(json);
    }
}
