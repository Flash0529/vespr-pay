using System.Globalization;
using System.Text.RegularExpressions;

namespace Vespr.Core;

/// <summary>
/// Message box helpers: big paste detection/metadata, Enter-key list continuation, and live activity strip.
/// Faithful C# port of app/composer.js.
/// </summary>
public static class Composer
{
    public const int BigPasteChars = 2500;
    public const int BigPasteLines = 40;
    public const int DefaultMaxActivitySteps = 6;

    public record BigPasteConfig(int Chars = BigPasteChars, int Lines = BigPasteLines);
    public static readonly BigPasteConfig BigPaste = new();

    public record PasteMetadata(string Name, int Lines, int Chars, string Kind);

    public record ContinueListResult(string Value, int Caret, bool Ended);

    public record ActivityStep(string Text, string State);

    public record ActivityViewResult(
        string Who,
        string Title,
        long Elapsed,
        List<ActivityStep> Steps,
        int More
    );

    public record ComposerItem(
        string? R = null,
        string? Text = null,
        string? Status = null,
        bool? Ok = true,
        double? Started = null,
        long? Ts = null,
        string? Who = null
    );

    public record ActivityOptions(
        long? Now = null,
        int Max = DefaultMaxActivitySteps
    );

    /// <summary>Detect if pasted text is large enough to treat as an attached file rather than an inline chat message.</summary>
    public static bool IsBigPaste(string? text)
    {
        var t = text ?? "";
        if (string.IsNullOrWhiteSpace(t)) return false;
        return t.Length >= BigPasteChars || t.Split('\n').Length >= BigPasteLines;
    }

    /// <summary>Extract metadata (filename, lines, chars, kind) for pasted text.</summary>
    public static PasteMetadata PasteMeta(string? text, int n = 1)
    {
        var t = text ?? "";
        var lines = t.Split('\n');
        var first = lines.FirstOrDefault(l => !string.IsNullOrWhiteSpace(l))?.Trim() ?? "";
        var heading = Regex.Match(first, @"^#{1,3}\s+(.{3,60})$");
        var md = Regex.IsMatch(t, @"^#{1,6}\s|^\s*[-*]\s|\*\*|\]\(", RegexOptions.Multiline);

        var semicolonOrBraces = Regex.Matches(t, @"[{};]");
        var code = !md &&
            Regex.IsMatch(t, @"[;{}]\s*$|^\s*(def|class|function|import|const|let|var|#include|public|package)\b", RegexOptions.Multiline) &&
            semicolonOrBraces.Count > (lines.Length / 4.0);

        string baseName;
        if (heading.Success)
        {
            baseName = Regex.Replace(heading.Groups[1].Value, @"[\\/:*?""<>|]+", "").Trim();
        }
        else
        {
            baseName = n > 1 ? $"Pasted text {n}" : "Pasted text";
        }

        var ext = md ? ".md" : ".txt";
        var kind = code ? "code" : md ? "markdown" : "text";

        return new PasteMetadata(baseName + ext, lines.Length, t.Length, kind);
    }

    /// <summary>Continues list on Enter (1. -> 2., a) -> b), - -> -) or terminates an empty item.</summary>
    public static ContinueListResult? ContinueList(string? value, int? caret = null)
    {
        var v = value ?? "";
        var at = Math.Max(0, Math.Min(caret ?? v.Length, v.Length));
        var start = at == 0 ? 0 : v.LastIndexOf('\n', at - 1) + 1;
        var line = v[start..at];

        var m = Regex.Match(line, @"^(\s*)(?:(\d{1,3})([.)])|([a-z])\)|([-*•]))(\s+)(.*)$");
        if (!m.Success) return null;

        var indent = m.Groups[1].Value;
        var num = m.Groups[2].Value;
        var sep = m.Groups[3].Value;
        var letter = m.Groups[4].Value;
        var bullet = m.Groups[5].Value;
        var gap = m.Groups[6].Value;
        var rest = m.Groups[7].Value;

        if (string.IsNullOrWhiteSpace(rest))
        {
            var value2 = v[..start] + indent + v[at..];
            return new ContinueListResult(value2, start + indent.Length, true);
        }

        string marker;
        if (!string.IsNullOrEmpty(num))
        {
            marker = (int.Parse(num, CultureInfo.InvariantCulture) + 1) + sep;
        }
        else if (!string.IsNullOrEmpty(letter))
        {
            marker = (letter == "z" ? "a" : ((char)(letter[0] + 1)).ToString()) + ")";
        }
        else
        {
            marker = bullet;
        }

        var ins = "\n" + indent + marker + gap;
        return new ContinueListResult(v[..at] + ins + v[at..], at + ins.Length, false);
    }

    /// <summary>Compute active status strip above composer box: current agent action, elapsed time, and recent steps.</summary>
    public static ActivityViewResult? ActivityView(IEnumerable<ComposerItem>? items, ActivityOptions? options = null)
    {
        if (items == null) return null;
        var list = items.Where(x => x != null).ToList();
        if (list.Count == 0) return null;

        var now = options?.Now ?? DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        var max = options?.Max ?? DefaultMaxActivitySteps;

        int from = 0;
        for (int i = list.Count - 1; i >= 0; i--)
        {
            if (list[i].R == "me" || list[i].R == "team")
            {
                from = i + 1;
                break;
            }
        }

        var recent = list.Skip(from).ToList();
        var steps = recent.Where(x => x.R == "work").ToList();
        var thinking = recent.FirstOrDefault(x => x.R == "thinking");
        var running = steps.Where(x => x.Status == "running").ToList();

        if (running.Count == 0 && thinking == null) return null;

        var cur = running.Count > 0 ? running[^1] : null;
        var who = cur?.Who ?? thinking?.Who ?? "The agent";

        string title;
        if (cur != null)
        {
            var firstLine = (cur.Text ?? "").Split('\n')[0];
            title = firstLine.StartsWith("$ ", StringComparison.Ordinal)
                ? "Running " + firstLine[2..]
                : firstLine;
        }
        else
        {
            title = $"{who} is thinking";
        }

        double t0 = double.PositiveInfinity;
        foreach (var s in steps)
        {
            if (s.Started.HasValue && !double.IsNaN(s.Started.Value) && s.Started.Value < t0)
            {
                t0 = s.Started.Value;
            }
        }
        if (thinking?.Ts.HasValue == true && (double)thinking.Ts.Value < t0)
        {
            t0 = thinking.Ts.Value;
        }

        long elapsed = !double.IsInfinity(t0) ? Math.Max(0, (long)(now - t0)) : 0;

        var displayedSteps = steps.TakeLast(max).Select(s =>
        {
            var text = (s.Text ?? "").Split('\n')[0];
            var state = s.Status == "running" ? "running" : s.Ok == false ? "failed" : "done";
            return new ActivityStep(text, state);
        }).ToList();

        int more = Math.Max(0, steps.Count - max);

        return new ActivityViewResult(who, title, elapsed, displayedSteps, more);
    }

    /// <summary>Format elapsed milliseconds to strip clock format (e.g. 52s, 14m 36s, 1h 2m).</summary>
    public static string Clock(double? ms)
    {
        var val = ms is double d && !double.IsNaN(d) && !double.IsInfinity(d) ? d : 0.0;
        var totalSecs = (long)Math.Floor(Math.Max(0, val) / 1000.0);
        var s = totalSecs % 60;
        var m = (totalSecs / 60) % 60;
        var h = totalSecs / 3600;

        if (h > 0) return $"{h}h {m}m";
        if (totalSecs >= 60) return $"{totalSecs / 60}m {s}s";
        return $"{s}s";
    }
}
