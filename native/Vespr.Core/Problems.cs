namespace Vespr.Core;

using System.Text.Json;

/// <summary>
/// Workspace diagnostics and problems manager for the SDE shell. Port of app/problems.js.
/// </summary>
public class Problems
{
    public const int MaxProblems = 200;
    public const int MaxPath = 300;
    public const int MaxMessage = 1000;
    public static readonly string[] Severities = ["error", "warning", "info"];

    public record ProblemItem(string File, int Line, int Col, string Message, string Severity, string Source);
    public record SummaryResult(int Total, int Errors, int Warnings, int Infos);
    public record FilterCriteria(string? File = null, string? Severity = null, string? Query = null);

    private readonly int _limit;
    private List<ProblemItem> _items = [];

    public Problems(int? max = null)
    {
        var rawMax = max ?? MaxProblems;
        _limit = Math.Max(1, Math.Min(MaxProblems, rawMax));
    }

    public static bool IsValidPath(string? p) =>
        p is not null && p.Length > 0 && p.Length <= MaxPath && !p.Contains('\0');

    public static string CleanSeverity(string? sev)
    {
        if (sev is not null)
        {
            var s = Js.Trim(Js.ToLowerCase(sev));
            if (s is "err" or "error") return "error";
            if (s is "warn" or "warning") return "warning";
            if (s is "info" or "information" or "hint") return "info";
        }
        return "error";
    }

    public static int CleanPos(int? val)
    {
        if (val.HasValue)
        {
            return Math.Max(1, val.Value);
        }
        return 1;
    }

    public static string CleanString(string? str, int maxLen = MaxMessage)
    {
        if (str is null) return "";
        var replaced = str.Replace("\0", "");
        var trimmed = Js.Trim(replaced);
        return trimmed.Length > maxLen ? trimmed[..maxLen] : trimmed;
    }

    public static ProblemItem? NormalizeProblem(string? file, int? line, int? col, string? message, string? severity, string? source)
    {
        if (!IsValidPath(file)) return null;

        var f = file!;
        var l = CleanPos(line);
        var c = CleanPos(col);
        var msgClean = CleanString(message, MaxMessage);
        var msg = string.IsNullOrEmpty(msgClean) ? "unknown problem" : msgClean;
        var sev = CleanSeverity(severity);
        var srcClean = CleanString(source, 50);
        var src = string.IsNullOrEmpty(srcClean) ? "workspace" : srcClean;

        return new ProblemItem(f, l, c, msg, sev, src);
    }

    public static ProblemItem? NormalizeProblem(ProblemItem? raw)
    {
        if (raw is null) return null;
        return NormalizeProblem(raw.File, raw.Line, raw.Col, raw.Message, raw.Severity, raw.Source);
    }

    public bool Add(string? file, int? line = null, int? col = null, string? message = null, string? severity = null, string? source = null)
    {
        var prob = NormalizeProblem(file, line, col, message, severity, source);
        if (prob is null) return false;
        return AddNormalized(prob);
    }

    public bool Add(ProblemItem? raw)
    {
        var prob = NormalizeProblem(raw);
        if (prob is null) return false;
        return AddNormalized(prob);
    }

    private bool AddNormalized(ProblemItem prob)
    {
        // Avoid exact duplicate
        var exists = _items.Any(it =>
            it.File == prob.File &&
            it.Line == prob.Line &&
            it.Col == prob.Col &&
            it.Message == prob.Message &&
            it.Severity == prob.Severity
        );
        if (exists) return false;

        if (_items.Count >= _limit)
        {
            _items.RemoveAt(0); // Evict oldest problem when reaching limit
        }

        _items.Add(prob);
        return true;
    }

    public int Set(string? file, IEnumerable<ProblemItem>? rawList)
    {
        if (!IsValidPath(file)) return 0;
        Clear(file);
        if (rawList is null) return 0;

        var added = 0;
        foreach (var item in rawList)
        {
            if (item is not null)
            {
                var candidate = item with { File = file! };
                if (Add(candidate)) added++;
            }
        }
        return added;
    }

    public int Clear(string? file = null)
    {
        if (!string.IsNullOrEmpty(file))
        {
            var initialCount = _items.Count;
            _items.RemoveAll(it => it.File == file);
            return initialCount - _items.Count;
        }

        var count = _items.Count;
        _items.Clear();
        return count;
    }

    public List<ProblemItem> List() => _items.Select(it => it with { }).ToList();

    public SummaryResult Summary()
    {
        var errors = 0;
        var warnings = 0;
        var infos = 0;
        foreach (var it in _items)
        {
            if (it.Severity == "error") errors++;
            else if (it.Severity == "warning") warnings++;
            else if (it.Severity == "info") infos++;
        }
        return new SummaryResult(_items.Count, errors, warnings, infos);
    }

    public List<ProblemItem> Filter(FilterCriteria? crit = null)
    {
        if (crit is null) return List();

        var targetFile = !string.IsNullOrEmpty(crit.File) ? crit.File : null;
        var targetSev = !string.IsNullOrEmpty(crit.Severity) ? CleanSeverity(crit.Severity) : null;
        var targetQuery = !string.IsNullOrWhiteSpace(crit.Query) ? Js.Trim(Js.ToLowerCase(crit.Query)) : null;

        var results = new List<ProblemItem>();
        foreach (var it in _items)
        {
            if (targetFile is not null && it.File != targetFile) continue;
            if (targetSev is not null && it.Severity != targetSev) continue;
            if (targetQuery is not null)
            {
                var text = Js.ToLowerCase($"{it.File} {it.Message} {it.Source}");
                if (!text.Contains(targetQuery, StringComparison.Ordinal)) continue;
            }
            results.Add(it with { });
        }
        return results;
    }

    public Dictionary<string, List<ProblemItem>> GroupByFile()
    {
        var groups = new Dictionary<string, List<ProblemItem>>(StringComparer.Ordinal);
        foreach (var it in _items)
        {
            if (!groups.TryGetValue(it.File, out var list))
            {
                list = [];
                groups[it.File] = list;
            }
            list.Add(it with { });
        }

        var sortedKeys = groups.Keys.OrderBy(k => k, StringComparer.Ordinal).ToList();
        var sorted = new Dictionary<string, List<ProblemItem>>(StringComparer.Ordinal);
        foreach (var k in sortedKeys)
        {
            sorted[k] = groups[k]
                .OrderBy(a => a.Line)
                .ThenBy(a => a.Col)
                .ToList();
        }
        return sorted;
    }

    public static string FormatRow(ProblemItem? problem)
    {
        var p = NormalizeProblem(problem);
        if (p is null) return "";
        var src = !string.IsNullOrEmpty(p.Source) ? $" ({p.Source})" : "";
        return $"{p.File}:{p.Line}:{p.Col} [{p.Severity}] {p.Message}{src}";
    }

    public int Rename(string? from, string? to)
    {
        if (!IsValidPath(from) || !IsValidPath(to)) return 0;
        if (from == to) return 0;

        var fromPrefix = from!.EndsWith('/') ? from : from + "/";
        var toPrefix = to!.EndsWith('/') ? to : to + "/";

        var renamedCount = 0;
        var updated = new List<ProblemItem>();

        foreach (var it in _items)
        {
            if (it.File == from)
            {
                updated.Add(it with { File = to! });
                renamedCount++;
            }
            else if (it.File.StartsWith(fromPrefix, StringComparison.Ordinal))
            {
                var candidate = toPrefix + it.File[fromPrefix.Length..];
                if (IsValidPath(candidate))
                {
                    updated.Add(it with { File = candidate });
                    renamedCount++;
                }
                else
                {
                    updated.Add(it);
                }
            }
            else
            {
                updated.Add(it);
            }
        }

        _items = updated;
        return renamedCount;
    }

    public string Serialize()
    {
        var obj = new
        {
            items = _items.Select(it => new
            {
                file = it.File,
                line = it.Line,
                col = it.Col,
                message = it.Message,
                severity = it.Severity,
                source = it.Source
            }).ToList()
        };
        return JsonSerializer.Serialize(obj);
    }

    public bool Deserialize(string? data)
    {
        if (string.IsNullOrEmpty(data)) return false;
        try
        {
            using var doc = JsonDocument.Parse(data);
            var root = doc.RootElement;
            if (root.ValueKind != JsonValueKind.Object) return false;

            if (root.TryGetProperty("__proto__", out _) || root.TryGetProperty("constructor", out _))
                return false;

            var valid = new List<ProblemItem>();
            if (root.TryGetProperty("items", out var itemsEl) && itemsEl.ValueKind == JsonValueKind.Array)
            {
                foreach (var el in itemsEl.EnumerateArray())
                {
                    if (el.ValueKind != JsonValueKind.Object) continue;
                    var file = el.TryGetProperty("file", out var fEl) && fEl.ValueKind == JsonValueKind.String ? fEl.GetString() : null;
                    var line = el.TryGetProperty("line", out var lEl) && lEl.ValueKind == JsonValueKind.Number ? lEl.GetInt32() : (int?)null;
                    var col = el.TryGetProperty("col", out var cEl) && cEl.ValueKind == JsonValueKind.Number ? cEl.GetInt32() : (int?)null;
                    var msg = el.TryGetProperty("message", out var mEl) && mEl.ValueKind == JsonValueKind.String ? mEl.GetString() : null;
                    var sev = el.TryGetProperty("severity", out var sEl) && sEl.ValueKind == JsonValueKind.String ? sEl.GetString() : null;
                    var src = el.TryGetProperty("source", out var srcEl) && srcEl.ValueKind == JsonValueKind.String ? srcEl.GetString() : null;

                    var p = NormalizeProblem(file, line, col, msg, sev, src);
                    if (p is not null)
                    {
                        valid.Add(p);
                        if (valid.Count >= _limit) break;
                    }
                }
            }

            _items = valid;
            return true;
        }
        catch
        {
            return false;
        }
    }
}
