using System.Security.Cryptography;
using System.Text;

namespace Morobot.Licensing;

public static class LicenseCrypto
{
    public static (string publicPem, string privatePem) GenerateKeyPair(int keySize = 2048)
    {
        using var rsa = RSA.Create(keySize);
        var publicPem = ExportPublicPem(rsa);
        var privatePem = ExportPrivatePem(rsa);
        return (publicPem, privatePem);
    }

    public static string SignPayload(LicensePayload payload, string privateKeyPem)
    {
        using var rsa = RSA.Create();
        rsa.ImportFromPem(privateKeyPem);
        var data = LicenseJson.CanonicalPayloadBytes(payload);
        var signature = rsa.SignData(data, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
        return Convert.ToBase64String(signature);
    }

    public static bool VerifyPayload(LicensePayload payload, string signatureBase64, string publicKeyPem)
    {
        if (string.IsNullOrWhiteSpace(signatureBase64))
            return false;
        try
        {
            using var rsa = RSA.Create();
            rsa.ImportFromPem(publicKeyPem);
            var data = LicenseJson.CanonicalPayloadBytes(payload);
            var signature = Convert.FromBase64String(signatureBase64);
            return rsa.VerifyData(data, signature, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
        }
        catch (FormatException)
        {
            return false;
        }
        catch (CryptographicException)
        {
            return false;
        }
    }

    public static LicenseDocument Sign(LicensePayload payload, string privateKeyPem) => new()
    {
        Format = LicenseFormats.License,
        Version = payload.Version,
        Payload = payload,
        Signature = SignPayload(payload, privateKeyPem)
    };

    public static string ExportPublicPem(RSA rsa)
    {
        var bytes = rsa.ExportSubjectPublicKeyInfo();
        return ToPem("PUBLIC KEY", bytes);
    }

    public static string ExportPrivatePem(RSA rsa)
    {
        var bytes = rsa.ExportPkcs8PrivateKey();
        return ToPem("PRIVATE KEY", bytes);
    }

    private static string ToPem(string label, byte[] der)
    {
        var b64 = Convert.ToBase64String(der, Base64FormattingOptions.InsertLineBreaks);
        var sb = new StringBuilder();
        sb.AppendLine($"-----BEGIN {label}-----");
        sb.AppendLine(b64);
        sb.AppendLine($"-----END {label}-----");
        return sb.ToString();
    }
}
