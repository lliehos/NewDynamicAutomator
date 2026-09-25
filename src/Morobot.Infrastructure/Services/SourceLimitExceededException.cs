namespace Morobot.Infrastructure.Services;

/// <summary>
/// Thrown when a data source would grow past the effective row/byte ceiling. A dedicated type (not
/// a bare <see cref="InvalidOperationException"/>) so controllers can answer with a specific code
/// and the numbers involved, which the UI turns into a translated message.
/// </summary>
public sealed class SourceLimitExceededException : InvalidOperationException
{
    public SourceLimitExceededException(
        string message, int rowCount, long byteCount, int? maxRows, long? maxBytes)
        : base(message)
    {
        RowCount = rowCount;
        ByteCount = byteCount;
        MaxRows = maxRows;
        MaxBytes = maxBytes;
    }

    public const string Code = "source-limit";

    public int RowCount { get; }
    public long ByteCount { get; }
    public int? MaxRows { get; }
    public long? MaxBytes { get; }
}
