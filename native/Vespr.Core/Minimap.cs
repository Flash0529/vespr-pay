namespace Vespr.Core;

using System.Text;
using System.Text.RegularExpressions;

/// <summary>
/// Editor minimap and density map generator for the SDE shell. Port of app/minimap.js.
/// </summary>
public static class Minimap
{
    public const int MaxLines = 10000;
    public const int MaxLineChars = 1000;
    public const int DefaultMaxPercent = 100;
    public const double DefaultScale = 2.2;
    public const int MaxBars = 120;

    public record MinimapOptions(
        double? Scale = null,
        double? MaxPercent = null,
        int? MaxBars = null
    );

    public record DiffItem(
        int? Line = null,
        int? NewLine = null,
        int? OldLine = null,
        string? Type = null
    );

    public record MinimapItem(
        int Line,
        int Width,
        string Type
    );

    public record ViewportSliderResult(
        int TopPercent,
        int HeightPercent
    );

    private static readonly Regex HtmlTagRegex = new(@"<[^>]+>", RegexOptions.Compiled);

    private static string CleanText(string? val)
    {
        if (val is null) return "";
        return val.Replace("\0", "");
    }

    private static int CleanNumber(int? val, int fallback = 0)
    {
        return val ?? fallback;
    }

    public static int LineWidthPercent(string? line, MinimapOptions? options = null)
    {
        if (line is null) return 0;

        var withoutHtml = HtmlTagRegex.Replace(line, "");
        var withoutTabs = withoutHtml.Replace("\t", "    ").TrimEnd();
        var clean = withoutTabs.Length > MaxLineChars ? withoutTabs[..MaxLineChars] : withoutTabs;

        if (string.IsNullOrWhiteSpace(clean)) return 0;

        var scale = options?.Scale is double s && double.IsFinite(s)
            ? Math.Max(0.1, s)
            : DefaultScale;

        var maxPercent = options?.MaxPercent is double mp && double.IsFinite(mp)
            ? Math.Max(1, Math.Min(100, (int)Math.Floor(mp)))
            : DefaultMaxPercent;

        var raw = clean.Length * scale;
        var rounded = (int)Math.Floor(raw + 0.5);

        return Math.Max(4, Math.Min(maxPercent, rounded));
    }

    public static List<MinimapItem> ComputeLines(
        string? text,
        IEnumerable<DiffItem>? diffs = null,
        MinimapOptions? options = null)
    {
        if (text is null) return [];
        var clean = CleanText(text);
        var rawLines = clean.Split('\n');
        return ComputeLines(rawLines, diffs, options);
    }

    public static List<MinimapItem> ComputeLines(
        IReadOnlyList<string>? rawLines,
        IEnumerable<DiffItem>? diffs = null,
        MinimapOptions? options = null)
    {
        if (rawLines is null || rawLines.Count == 0) return [];

        var limit = Math.Min(rawLines.Count, MaxLines);

        var diffMap = new Dictionary<int, string>();
        if (diffs is not null)
        {
            foreach (var d in diffs)
            {
                if (d is null) continue;
                var lineNum = d.Line ?? d.NewLine ?? d.OldLine ?? 0;
                var type = (d.Type ?? "").Trim().ToLowerInvariant();
                if (lineNum > 0 && (type == "add" || type == "del" || type == "chg"))
                {
                    diffMap[lineNum] = type;
                }
            }
        }

        var items = new List<MinimapItem>(limit);
        for (var i = 0; i < limit; i++)
        {
            var lineNum = i + 1;
            var lineStr = rawLines[i] ?? "";
            var width = LineWidthPercent(lineStr, options);
            diffMap.TryGetValue(lineNum, out var type);
            items.Add(new MinimapItem(lineNum, width, type ?? ""));
        }

        return items;
    }

    private static int GetTypePriority(string? type) => type switch
    {
        "chg" => 3,
        "del" => 2,
        "add" => 1,
        _ => 0
    };

    public static List<MinimapItem> SampleLines(IReadOnlyList<MinimapItem>? items, int maxBars = MaxBars)
    {
        if (items is null) return [];
        if (items.Count <= maxBars)
        {
            return items.Select(it => new MinimapItem(it.Line, it.Width, it.Type)).ToList();
        }

        var targetBars = Math.Max(10, Math.Min(MaxBars, maxBars <= 0 ? MaxBars : maxBars));
        var stride = (double)items.Count / targetBars;
        var sampled = new List<MinimapItem>(targetBars);

        for (var b = 0; b < targetBars; b++)
        {
            var start = (int)Math.Floor(b * stride);
            var end = Math.Min(items.Count, (int)Math.Floor((b + 1) * stride));

            var maxW = 0;
            var highestType = "";

            for (var k = start; k < end; k++)
            {
                var it = items[k];
                if (it.Width > maxW) maxW = it.Width;

                var curPri = GetTypePriority(highestType);
                var itPri = GetTypePriority(it.Type);
                if (itPri > curPri) highestType = it.Type;
            }

            sampled.Add(new MinimapItem(start + 1, maxW, highestType));
        }

        return sampled;
    }

    public static string RenderMinimapHtml(
        string? text,
        IEnumerable<DiffItem>? diffs = null,
        MinimapOptions? options = null)
    {
        if (text is null) return "";
        var items = ComputeLines(text, diffs, options);
        return RenderItemsHtml(items, options);
    }

    public static string RenderMinimapHtml(
        IReadOnlyList<string>? rawLines,
        IEnumerable<DiffItem>? diffs = null,
        MinimapOptions? options = null)
    {
        if (rawLines is null || rawLines.Count == 0) return "";
        var items = ComputeLines(rawLines, diffs, options);
        return RenderItemsHtml(items, options);
    }

    private static string RenderItemsHtml(List<MinimapItem> items, MinimapOptions? options)
    {
        if (items.Count == 0) return "";

        var resultItems = items;
        if (options?.MaxBars is int mb && mb > 0 && resultItems.Count > mb)
        {
            resultItems = SampleLines(resultItems, mb);
        }

        var sb = new StringBuilder();
        foreach (var it in resultItems)
        {
            var cls = !string.IsNullOrEmpty(it.Type) ? $" class=\"{it.Type}\"" : "";
            sb.Append($"<i{cls} style=\"width:{it.Width}%\"></i>");
        }

        return sb.ToString();
    }

    public static ViewportSliderResult ViewportSlider(int totalLines, int rawTopLine = 1, int rawVisibleLines = 10)
    {
        var total = Math.Max(0, totalLines);
        if (total <= 0) return new ViewportSliderResult(0, 100);

        var topLine = Math.Max(1, Math.Min(total, rawTopLine <= 0 ? 1 : rawTopLine));
        var visible = Math.Max(1, rawVisibleLines <= 0 ? 10 : rawVisibleLines);

        var heightPercent = Math.Max(5, Math.Min(100, (int)Math.Floor(((double)visible / total) * 100.0 + 0.5)));
        var topPercent = Math.Max(0, Math.Min(100, (int)Math.Floor(((double)(topLine - 1) / total) * 100.0 + 0.5)));

        if (topPercent + heightPercent > 100)
        {
            topPercent = Math.Max(0, 100 - heightPercent);
        }

        return new ViewportSliderResult(topPercent, heightPercent);
    }
}
