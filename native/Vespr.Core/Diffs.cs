namespace Vespr.Core;

using System.Text.RegularExpressions;

/// <summary>
/// Workspace diff and line-change helper for the SDE shell. Port of app/diffs.js.
/// </summary>
public static class Diffs
{
    public const int MaxLines = 1000;
    public const int MaxLineLen = 1000;
    public const int MaxDiffBytes = 500000;

    public record DiffItem(string Type, string Text, int? OldLine = null, int? NewLine = null);
    public record DiffSummary(int Additions, int Deletions, int Unchanged, int Total);
    public record PatchHunk(string Header, int OldStart, int OldCount, int NewStart, int NewCount, List<DiffItem> Lines);
    public record PatchResult(List<PatchHunk> Hunks, DiffSummary Summary);

    private static string CleanText(string? val)
    {
        if (val is null) return "";
        var replaced = val.Replace("\0", "");
        return replaced.Length > MaxDiffBytes ? replaced[..MaxDiffBytes] : replaced;
    }

    public static List<string> SplitLines(string? text)
    {
        var clean = CleanText(text).Replace("\r\n", "\n").Replace('\r', '\n');
        if (clean.Length == 0) return [];
        var raw = clean.Split('\n');
        var clamped = new List<string>(Math.Min(raw.Length, MaxLines));
        var limit = Math.Min(raw.Length, MaxLines);
        for (var i = 0; i < limit; i++)
        {
            var l = raw[i];
            clamped.Add(l.Length > MaxLineLen ? l[..MaxLineLen] : l);
        }
        return clamped;
    }

    public static List<DiffItem> DiffLines(string? oldStr, string? newStr)
    {
        var oldLines = SplitLines(oldStr);
        var newLines = SplitLines(newStr);

        if (oldLines.Count == 0 && newLines.Count == 0) return [];

        // Trim common prefix
        var start = 0;
        while (start < oldLines.Count && start < newLines.Count && oldLines[start] == newLines[start])
        {
            start++;
        }

        // Trim common suffix
        var oldEnd = oldLines.Count - 1;
        var newEnd = newLines.Count - 1;
        while (oldEnd >= start && newEnd >= start && oldLines[oldEnd] == newLines[newEnd])
        {
            oldEnd--;
            newEnd--;
        }

        var items = new List<DiffItem>();
        var oldLineNum = 1;
        var newLineNum = 1;

        // Push common prefix
        for (var i = 0; i < start; i++)
        {
            items.Add(new DiffItem("eq", oldLines[i], oldLineNum++, newLineNum++));
        }

        // Compute LCS on middle segment
        var midOld = oldLines.Skip(start).Take(oldEnd - start + 1).ToList();
        var midNew = newLines.Skip(start).Take(newEnd - start + 1).ToList();

        var n = midOld.Count;
        var m = midNew.Count;

        if (n > 0 || m > 0)
        {
            var dp = new int[n + 1, m + 1];
            for (var i = 0; i < n; i++)
            {
                for (var j = 0; j < m; j++)
                {
                    if (midOld[i] == midNew[j])
                    {
                        dp[i + 1, j + 1] = dp[i, j] + 1;
                    }
                    else
                    {
                        dp[i + 1, j + 1] = Math.Max(dp[i + 1, j], dp[i, j + 1]);
                    }
                }
            }

            // Backtrack to find diff operations
            var midOps = new List<DiffItem>();
            var ci = n;
            var cj = m;
            while (ci > 0 || cj > 0)
            {
                if (ci > 0 && cj > 0 && midOld[ci - 1] == midNew[cj - 1])
                {
                    midOps.Add(new DiffItem("eq", midOld[ci - 1]));
                    ci--;
                    cj--;
                }
                else if (cj > 0 && (ci == 0 || dp[ci, cj - 1] >= dp[ci - 1, cj]))
                {
                    midOps.Add(new DiffItem("add", midNew[cj - 1]));
                    cj--;
                }
                else if (ci > 0)
                {
                    midOps.Add(new DiffItem("del", midOld[ci - 1]));
                    ci--;
                }
            }

            midOps.Reverse();
            foreach (var op in midOps)
            {
                if (op.Type == "eq")
                {
                    items.Add(new DiffItem("eq", op.Text, oldLineNum++, newLineNum++));
                }
                else if (op.Type == "del")
                {
                    items.Add(new DiffItem("del", op.Text, oldLineNum++, null));
                }
                else if (op.Type == "add")
                {
                    items.Add(new DiffItem("add", op.Text, null, newLineNum++));
                }
            }
        }

        // Push common suffix
        for (var k = oldEnd + 1; k < oldLines.Count; k++)
        {
            items.Add(new DiffItem("eq", oldLines[k], oldLineNum++, newLineNum++));
        }

        return items;
    }

    public static DiffSummary Summary(IEnumerable<DiffItem>? items)
    {
        if (items is null) return new DiffSummary(0, 0, 0, 0);

        var additions = 0;
        var deletions = 0;
        var unchanged = 0;

        foreach (var it in items)
        {
            if (it is null) continue;
            if (it.Type == "add") additions++;
            else if (it.Type == "del") deletions++;
            else if (it.Type == "eq") unchanged++;
        }

        return new DiffSummary(additions, deletions, unchanged, additions + deletions + unchanged);
    }

    public static DiffSummary Summary(PatchResult? patch)
    {
        if (patch is null) return new DiffSummary(0, 0, 0, 0);
        return patch.Summary;
    }

    public static string FormatBadge(DiffSummary? input)
    {
        if (input is null) return "0";
        var add = Math.Max(0, input.Additions);
        var del = Math.Max(0, input.Deletions);

        if (add == 0 && del == 0) return "0";
        if (add > 0 && del > 0) return $"+{add} \u2212{del}";
        if (add > 0) return $"+{add}";
        return $"\u2212{del}";
    }

    public static string FormatBadge(IEnumerable<DiffItem>? input)
    {
        if (input is null) return "0";
        return FormatBadge(Summary(input));
    }

    public static PatchResult ParsePatch(string? patchStr)
    {
        if (patchStr is null) return new PatchResult([], new DiffSummary(0, 0, 0, 0));

        var lines = SplitLines(patchStr);
        var hunks = new List<PatchHunk>();
        PatchHunk? curHunk = null;

        var additions = 0;
        var deletions = 0;

        var headerRegex = new Regex(@"^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@", RegexOptions.Compiled);

        foreach (var line in lines)
        {
            if (line.StartsWith("--- ") || line.StartsWith("+++ "))
            {
                continue; // Skip file header lines
            }

            if (line.StartsWith("@@"))
            {
                var match = headerRegex.Match(line);
                if (match.Success)
                {
                    var oldStart = int.Parse(match.Groups[1].Value);
                    var oldCount = match.Groups[2].Success ? int.Parse(match.Groups[2].Value) : 1;
                    var newStart = int.Parse(match.Groups[3].Value);
                    var newCount = match.Groups[4].Success ? int.Parse(match.Groups[4].Value) : 1;

                    curHunk = new PatchHunk(line, oldStart, oldCount, newStart, newCount, []);
                    hunks.Add(curHunk);
                    continue;
                }
            }

            if (line.StartsWith('+'))
            {
                if (curHunk is null)
                {
                    curHunk = new PatchHunk("@@ -1,1 +1,1 @@", 1, 0, 1, 0, []);
                    hunks.Add(curHunk);
                }
                additions++;
                curHunk.Lines.Add(new DiffItem("add", line[1..]));
            }
            else if (line.StartsWith('-'))
            {
                if (curHunk is null)
                {
                    curHunk = new PatchHunk("@@ -1,1 +1,1 @@", 1, 0, 1, 0, []);
                    hunks.Add(curHunk);
                }
                deletions++;
                curHunk.Lines.Add(new DiffItem("del", line[1..]));
            }
            else if (line.StartsWith(' ') && curHunk is not null)
            {
                curHunk.Lines.Add(new DiffItem("eq", line[1..]));
            }
        }

        return new PatchResult(hunks, new DiffSummary(additions, deletions, 0, additions + deletions));
    }

    public static string FormatUnified(string? filename, string? oldStr, string? newStr)
    {
        if (oldStr is null && newStr is null) return "";
        var fname = !string.IsNullOrEmpty(filename) ? filename : "file";

        var items = DiffLines(oldStr, newStr);
        if (items.Count == 0) return "";

        var s = Summary(items);
        if (s.Additions == 0 && s.Deletions == 0) return "";

        var header = "--- a/" + fname + "\n+++ b/" + fname;
        var hunkLines = new List<string>();
        var oldStart = 1;
        var newStart = 1;
        var oldCount = 0;
        var newCount = 0;

        foreach (var it in items)
        {
            if (it.Type == "eq")
            {
                oldCount++;
                newCount++;
                hunkLines.Add(" " + it.Text);
            }
            else if (it.Type == "del")
            {
                oldCount++;
                hunkLines.Add("-" + it.Text);
            }
            else if (it.Type == "add")
            {
                newCount++;
                hunkLines.Add("+" + it.Text);
            }
        }

        var hunkHeader = "@@ -" + oldStart + "," + oldCount + " +" + newStart + "," + newCount + " @@";
        return header + "\n" + hunkHeader + "\n" + string.Join('\n', hunkLines);
    }
}
