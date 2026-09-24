namespace Morobot.Licensing;

/// <summary>Embedded public keys for license verification. Replace Production before release builds.</summary>
public static class LicensePublicKeys
{
    public const string Development = """
        -----BEGIN PUBLIC KEY-----
        MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAtzNEdDnCM+AWBb8T1nIr
        klWRc3IR6yFBxkt16juwXGRFvt62loiU2kuPcBtsNNvykLVnhx/T1duHBNXO0Eko
        BwK7AgmUhg0Cqq8u9fMPTKxSgeyjGb/zGqLNkBm/Ecoo2chQaXz6Ku0NckObj+Uu
        7K9JPN4ysoNbnjm7PcTCV0CHYGrxwIALyMgkBlwB/9saR8CQYmHk4hB3c74HKn+qo
        3HSroLATRFXnjQWQYYxhqzoCFM0JyelVi783pYJy9qxLBR/y3AEzZZg2p5jltAze
        jzHSVkcs7FuMtxdatGEd/FGkmGG0IyTjeDrrjQimOyPJZEdI5A0giihBjqaIIBjtQ
        IDAQAB
        -----END PUBLIC KEY-----
        """;

    public static string Active => Development;
}
