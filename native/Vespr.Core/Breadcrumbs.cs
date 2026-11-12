namespace Vespr.Core;

/// <summary>
/// Workspace breadcrumb path parsing and formatting helper. Port of app/breadcrumbs.js.
/// </summary>
public static class Breadcrumbs
{
    public const int MaxPath = 300;
    public const int MaxSegments = 10;
    public const int MinSegments = 3;
    public const int MaxLabel = 80;

    public record BreadcrumbItem(
        string Label,
        string Path,
        bool IsLeaf,
        bool IsRoot,
        bool IsSymbol,
        bool IsEllipsis,
        string Icon
    );

    public record BreadcrumbOptions(
        string? Root = null,
        string? Symbol = null,
        int? MaxSegments = null
    );

    private static string CleanString(string? val)
    {
        if (val is null) return "";
        var replaced = val.Replace("\0", "");
        return Js.Trim(replaced);
    }

    public static List<string> NormalizePath(string? pathStr)
    {
        var clean = CleanString(pathStr).Replace('\\', '/');
        var rawSegments = clean.Split('/', StringSplitOptions.RemoveEmptyEntries);

        var resolved = new List<string>();
        foreach (var seg in rawSegments)
        {
            if (seg == ".") continue;
            if (seg == "..")
            {
                if (resolved.Count > 0) resolved.RemoveAt(resolved.Count - 1);
            }
            else
            {
                resolved.Add(seg.Length > MaxLabel ? seg[..MaxLabel] : seg);
            }
        }

        return resolved;
    }

    private static List<BreadcrumbItem> Compact(List<BreadcrumbItem> items, int maxCount)
    {
        if (items.Count <= maxCount) return items;

        var headCount = Math.Max(1, (maxCount - 1) / 2);
        var tailCount = Math.Max(1, maxCount - 1 - headCount);

        var head = items.Take(headCount).ToList();
        var tail = items.Skip(items.Count - tailCount).ToList();

        var ellipsis = new BreadcrumbItem(
            "…",
            "",
            false,
            false,
            false,
            true,
            "more"
        );

        var res = new List<BreadcrumbItem>(headCount + 1 + tailCount);
        res.AddRange(head);
        res.Add(ellipsis);
        res.AddRange(tail);
        return res;
    }

    public static string ParentOf(string? pathStr)
    {
        var segments = NormalizePath(pathStr);
        if (segments.Count <= 1) return "";
        return string.Join('/', segments.Take(segments.Count - 1));
    }

    public static List<BreadcrumbItem> Format(string? pathStr, BreadcrumbOptions? options = null)
    {
        var opts = options ?? new BreadcrumbOptions();
        var rootClean = CleanString(opts.Root);
        var rootName = rootClean.Length > MaxLabel ? rootClean[..MaxLabel] : rootClean;

        var symbolClean = CleanString(opts.Symbol);
        var symbolName = symbolClean.Length > MaxLabel ? symbolClean[..MaxLabel] : symbolClean;

        var rawMax = opts.MaxSegments;
        var maxSegs = rawMax.HasValue
            ? Math.Max(MinSegments, Math.Min(MaxSegments, rawMax.Value))
            : 6;

        var segments = NormalizePath(pathStr);
        var items = new List<BreadcrumbItem>();

        if (!string.IsNullOrEmpty(rootName))
        {
            items.Add(new BreadcrumbItem(
                rootName,
                "",
                false,
                true,
                false,
                false,
                "workspace"
            ));
        }

        var accumulated = "";
        for (var i = 0; i < segments.Count; i++)
        {
            var seg = segments[i];
            accumulated = accumulated.Length > 0 ? accumulated + "/" + seg : seg;
            var isFile = i == segments.Count - 1;

            items.Add(new BreadcrumbItem(
                seg,
                accumulated,
                false,
                false,
                false,
                false,
                isFile ? "file" : "folder"
            ));
        }

        if (!string.IsNullOrEmpty(symbolName))
        {
            items.Add(new BreadcrumbItem(
                symbolName,
                accumulated,
                false,
                false,
                true,
                false,
                "symbol"
            ));
        }

        if (items.Count == 0) return [];

        var result = Compact(items, maxSegs);
        for (var i = 0; i < result.Count; i++)
        {
            result[i] = result[i] with { IsLeaf = i == result.Count - 1 };
        }

        return result;
    }

    public static string RenderText(IEnumerable<BreadcrumbItem>? items, string separator = " > ")
    {
        if (items is null) return "";
        return string.Join(separator, items.Select(it => it.Label).Where(l => !string.IsNullOrEmpty(l)));
    }
}
