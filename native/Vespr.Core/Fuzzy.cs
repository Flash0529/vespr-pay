namespace Vespr.Core;

/// <summary>
/// Search-as-you-type fuzzy matcher for the command palette and file navigation. Port of app/fuzzy.js; native/golden/fuzzy.json
/// holds the JavaScript answers this must reproduce exactly.
/// </summary>
public static class Fuzzy
{
    public const int MaxText = 300;
    public const int MaxResults = 50;

    static readonly HashSet<char> WordDelims = ['/', '_', '-', '.', ' '];

    /// <summary>How well <paramref name="query"/> matches <paramref name="text"/>; null when it does not match, 0 for an empty query.</summary>
    public static int? Score(string? query, string? text)
    {
        if (query is null || text is null) return null;
        var qOrig = Js.RemoveWhiteSpace(query);
        var q = Js.ToLowerCase(qOrig);
        if (q.Length == 0) return 0;

        var origText = Js.Slice(text, MaxText);
        var t = Js.ToLowerCase(origText);
        var indices = Find(q, t);
        if (indices is null) return null;

        var total = 100 * q.Length;
        for (var k = 0; k < indices.Count; k++)
        {
            var i = indices[k];
            if (i == 0) total += 30;
            if (i == 0 || WordDelims.Contains(t[i - 1])) total += 25;
            if (k > 0 && i == indices[k - 1] + 1) total += 20;
            // JS compares origText[i] with qOrig[k]; reading past either end gives undefined, which never equals a character
            if (i < origText.Length && k < qOrig.Length && origText[i] == qOrig[k]) total += 5;
        }

        var penalty = Math.Max(0, origText.Length - q.Length);
        return Math.Max(1, total - penalty);
    }

    /// <summary>
    /// The items that match, best first (higher score, then shorter text, then original order), at most <paramref name="limit"/>
    /// (floored, between 1 and MaxResults; a missing or non-finite limit means MaxResults). An empty query keeps the original order.
    /// </summary>
    public static List<T> Rank<T>(string? query, IReadOnlyList<T>? items, Func<T, string>? getText = null, double? limit = null)
    {
        if (items is null) return [];
        var lim = limit is double l && double.IsFinite(l) ? Math.Floor(l) : MaxResults;
        var max = (int)Math.Max(1, Math.Min(MaxResults, lim));
        var qRaw = query is null ? "" : Js.RemoveWhiteSpace(query);
        if (qRaw.Length == 0) return items.Take(max).ToList();

        getText ??= item => item?.ToString() ?? "null"; // JS String(item): String(null) is "null"
        var scored = new List<(T Item, int Score, int Len, int Index)>();
        for (var i = 0; i < items.Count; i++)
        {
            var txt = getText(items[i]);
            if (Score(query, txt) is int s) scored.Add((items[i], s, txt.Length, i));
        }
        // the index breaks every tie, so the order is total and the sort's stability does not matter
        scored.Sort((a, b) => a.Score != b.Score ? b.Score.CompareTo(a.Score) : a.Len != b.Len ? a.Len.CompareTo(b.Len) : a.Index.CompareTo(b.Index));
        return scored.Take(max).Select(x => x.Item).ToList();
    }

    /// <summary>The matched character ranges [start, end) to highlight; empty when there is no match.</summary>
    public static List<(int Start, int End)> Highlight(string? query, string? text)
    {
        if (query is null || text is null) return [];
        var q = Js.ToLowerCase(Js.RemoveWhiteSpace(query));
        if (q.Length == 0) return [];
        var t = Js.ToLowerCase(Js.Slice(text, MaxText));
        var indices = Find(q, t);
        if (indices is null) return [];

        var ranges = new List<(int, int)>();
        int start = indices[0], prev = indices[0];
        for (var k = 1; k < indices.Count; k++)
        {
            var cur = indices[k];
            if (cur == prev + 1) { prev = cur; continue; }
            ranges.Add((start, prev + 1));
            start = cur; prev = cur;
        }
        ranges.Add((start, prev + 1));
        return ranges;
    }

    // each query character in order, each found after the previous one (ordinal, like JS indexOf)
    static List<int>? Find(string q, string t)
    {
        var indices = new List<int>(q.Length);
        var from = 0;
        foreach (var c in q)
        {
            var pos = from <= t.Length ? t.IndexOf(c, from) : -1;
            if (pos == -1) return null;
            indices.Add(pos);
            from = pos + 1;
        }
        return indices;
    }
}
