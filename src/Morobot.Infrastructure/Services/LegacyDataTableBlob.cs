using System.Text;
using System.Text.RegularExpressions;
using System.Xml.Linq;

namespace Morobot.Infrastructure.Services;

/// <summary>
/// Reads the legacy source blob (<c>GroupDataSources.Source</c>).
/// The Windows-era app serialized a <see cref="System.Data.DataTable"/> with BinaryFormatter using
/// <c>RemotingFormat = Xml</c>; that format embeds the XmlSchema and the XmlDiffGram payloads as
/// (single-byte) text inside the binary stream. .NET 9 removed BinaryFormatter, so the matrix is
/// recovered by extracting those two Xml fragments — no binary deserialization is required.
/// </summary>
public static class LegacyDataTableBlob
{
    private static readonly Regex XmlNameEscape = new("_x([0-9A-Fa-f]{4})_", RegexOptions.Compiled);

    /// <summary>
    /// Parse the blob into the base table (schema column order + rows ordered by rowOrder).
    /// Returns <c>null</c> when the payload does not contain a readable diffgram/schema pair.
    /// </summary>
    public static LegacyTableBlob? TryRead(byte[] blob, out string message)
    {
        message = "";
        var text = Encoding.UTF8.GetString(blob);
        var si = text.IndexOf("<xs:schema", StringComparison.Ordinal);
        var sj = text.IndexOf("</xs:schema>", StringComparison.Ordinal);
        var di = text.IndexOf("<diffgr:diffgram", StringComparison.Ordinal);
        var dj = text.IndexOf("</diffgr:diffgram>", StringComparison.Ordinal);
        if (si < 0 || sj < 0)
        {
            message = "no schema block found";
            return null;
        }

        var schemaXml = text.Substring(si, sj - si + "</xs:schema>".Length);
        XNamespace xs = "http://www.w3.org/2001/XMLSchema";
        var schema = XDocument.Parse(schemaXml);
        var tableElem = schema.Root!.Elements(xs + "element").First();
        var tableName = tableElem.Attribute("name")!.Value;
        var encodedCols = tableElem.Descendants(xs + "element")
            .Select(e => e.Attribute("name")!.Value).ToList();
        var columns = encodedCols.Select(DecodeXmlName).ToList();

        var rows = new List<string[]>();
        if (di >= 0 && dj > di)
        {
            var diffXml = text.Substring(di, dj - di + "</diffgr:diffgram>".Length);
            var diff = XDocument.Parse(diffXml);
            XNamespace msdata = "urn:schemas-microsoft-com:xml-msdata";
            // Rows sit under <diffgr:diffgram>/<DataSetName>/<TableName> in the Xml diffgram.
            // The <diffgr:before> block (original values) is excluded.
            var rowElems = diff.Root!.Descendants()
                .Where(e => e.Name.LocalName == tableName
                    && !e.Ancestors().Any(a => a.Name.LocalName == "before"))
                .ToList();
            var ordered = rowElems
                .Select((e, idx) => (Elem: e, Order: (int?)e.Attribute(msdata + "rowOrder") ?? idx))
                .OrderBy(x => x.Order).Select(x => x.Elem).ToList();
            foreach (var re in ordered)
            {
                var arr = new string[encodedCols.Count];
                for (var c = 0; c < encodedCols.Count; c++)
                {
                    var child = re.Elements().FirstOrDefault(e => e.Name.LocalName == encodedCols[c]);
                    arr[c] = child is null ? "" : child.Value;
                }
                rows.Add(arr);
            }
        }

        message = $"table={tableName} columns={columns.Count} rows={rows.Count}";
        return new LegacyTableBlob { TableName = tableName, Columns = columns, Rows = rows };
    }

    /// <summary>Xml encodes spaces/special chars as <c>_xHHHH_</c> (e.g. <c>_x0020_</c> = space).</summary>
    private static string DecodeXmlName(string encoded) =>
        XmlNameEscape.Replace(encoded, m => ((char)Convert.ToInt32(m.Groups[1].Value, 16)).ToString());
}

/// <summary>Base matrix recovered from a legacy source blob.</summary>
public sealed class LegacyTableBlob
{
    public string TableName { get; init; } = "";
    public List<string> Columns { get; init; } = new();
    public List<string[]> Rows { get; init; } = new();
}
