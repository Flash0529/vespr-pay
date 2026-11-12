namespace Vespr.Core;

using System.Text.RegularExpressions;

/// <summary>
/// In-file search, match navigation, and replace helper for the SDE shell. Port of app/search.js.
/// </summary>
public static class Search
{
    public const int MaxDocChars = 1000000;
    public const int MaxQueryLen = 500;
    public const int MaxMatches = 1000;

    public record SearchOptions(
        bool Regex = false,
        bool CaseSensitive = false,
        bool WholeWord = false
    );

    public record SearchMatch(
        int Index,
        int Length,
        int Line,
        int Col,
        string Text
    );

    public record ReplaceResult(string Text, int Count);
    public record MatchRange(int Index, int Length);

    private static string CleanText(string? val, int maxLen = MaxDocChars)
    {
        if (val is null) return "";
        var replaced = val.Replace("\0", "");
        return replaced.Length > maxLen ? replaced[..maxLen] : replaced;
    }

    public static string EscapeRegExp(string? str)
    {
        if (str is null) return "";
        return Regex.Replace(str, @"[.*+?^${}()|[\]\\]", @"\$&");
    }

    public static Regex? BuildRegex(string? query, SearchOptions? options = null)
    {
        var cleanQ = CleanText(query, MaxQueryLen);
        if (cleanQ.Length == 0) return null;

        var isRegex = options?.Regex == true;
        var isCaseSensitive = options?.CaseSensitive == true;
        var isWholeWord = options?.WholeWord == true;

        var pattern = isRegex ? cleanQ : EscapeRegExp(cleanQ);
        if (isWholeWord)
        {
            pattern = @"\b(?:" + pattern + @")\b";
        }

        var flags = RegexOptions.Multiline;
        if (!isCaseSensitive)
        {
            flags |= RegexOptions.IgnoreCase;
        }

        try
        {
            return new Regex(pattern, flags);
        }
        catch
        {
            return null;
        }
    }

    private static (int Line, int Col) ComputeLineCol(string src, int index)
    {
        var line = 1;
        var lineStart = 0;
        for (var i = 0; i < index && i < src.Length; i++)
        {
            if (src[i] == '\n')
            {
                line++;
                lineStart = i + 1;
            }
        }
        return (line, index - lineStart + 1);
    }

    public static List<SearchMatch> FindMatches(string? text, string? query, SearchOptions? options = null)
    {
        var src = CleanText(text);
        if (src.Length == 0) return [];

        var rx = BuildRegex(query, options);
        if (rx is null) return [];

        var matches = new List<SearchMatch>();
        foreach (Match match in rx.Matches(src))
        {
            if (matches.Count >= MaxMatches) break;

            var matchLen = match.Length;
            var (line, col) = ComputeLineCol(src, match.Index);

            matches.Add(new SearchMatch(
                match.Index,
                matchLen,
                line,
                col,
                match.Value
            ));
        }

        return matches;
    }

    public static string ReplaceOne(string? text, MatchRange? matchRange, string? replacement)
    {
        var src = CleanText(text);
        if (src.Length == 0 || matchRange is null) return src;

        var idx = matchRange.Index;
        var len = matchRange.Length;

        if (idx < 0 || idx + len > src.Length) return src;
        var rep = CleanText(replacement, MaxQueryLen);

        return src[..idx] + rep + src[(idx + len)..];
    }

    public static ReplaceResult ReplaceAll(string? text, string? query, string? replacement, SearchOptions? options = null)
    {
        var src = CleanText(text);
        if (src.Length == 0) return new ReplaceResult("", 0);

        var matches = FindMatches(src, query, options);
        if (matches.Count == 0) return new ReplaceResult(src, 0);

        var rx = BuildRegex(query, options);
        if (rx is null) return new ReplaceResult(src, 0);

        var rep = CleanText(replacement, MaxQueryLen);
        var replaced = rx.Replace(src, _ => rep);

        return new ReplaceResult(replaced, matches.Count);
    }

    public static int NextMatch(IReadOnlyList<SearchMatch>? matches, int currentOffset)
    {
        if (matches is null || matches.Count == 0) return -1;

        for (var i = 0; i < matches.Count; i++)
        {
            if (matches[i].Index > currentOffset)
            {
                return i;
            }
        }

        return 0;
    }

    public static int PrevMatch(IReadOnlyList<SearchMatch>? matches, int currentOffset)
    {
        if (matches is null || matches.Count == 0) return -1;

        for (var i = matches.Count - 1; i >= 0; i--)
        {
            if (matches[i].Index < currentOffset)
            {
                return i;
            }
        }

        return matches.Count - 1;
    }

    public static string FormatMatchCount(int? currentIndex, int? totalCount)
    {
        var total = Math.Max(0, totalCount ?? 0);
        if (total == 0) return "No results";

        var cur = currentIndex ?? -1;
        if (cur < 0 || cur >= total) return $"0 of {total}";

        return $"{cur + 1} of {total}";
    }
}
