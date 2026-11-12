namespace Vespr.Core;

using System.Text.RegularExpressions;

/// <summary>
/// Git porcelain status parser and source control helper. Port of app/gitstatus.js.
/// </summary>
public static class GitStatus
{
    public const int MaxEntries = 500;
    public const int MaxPath = 300;
    public const int MaxLine = 1000;

    public record StatusEntry(
        string Staged,
        string Unstaged,
        string Path,
        string? OrigPath,
        bool IsStaged,
        bool IsUnstaged,
        bool IsUntracked,
        bool IsConflicted
    );

    public record StatusSummary(
        int StagedCount,
        int UnstagedCount,
        int UntrackedCount,
        int ConflictCount,
        int Total,
        bool IsClean
    );

    public record StatusResult(
        string Branch,
        string? Upstream,
        int Ahead,
        int Behind,
        bool IsDetached,
        List<StatusEntry> Entries,
        StatusSummary Summary
    );

    public record GroupedEntries(
        List<StatusEntry> Staged,
        List<StatusEntry> Unstaged,
        List<StatusEntry> Untracked,
        List<StatusEntry> Conflicted
    );

    private static readonly HashSet<string> ConflictCodes = new(StringComparer.Ordinal)
    {
        "DD", "AU", "UD", "UA", "DU", "AA", "UU"
    };

    private static readonly HashSet<char> ValidStaged = [' ', 'M', 'A', 'D', 'R', 'C', 'U', '?'];
    private static readonly HashSet<char> ValidUnstaged = [' ', 'M', 'D', 'A', 'U', '?'];

    private static string CleanLine(string? val)
    {
        if (val is null) return "";
        var replaced = val.Replace("\0", "").TrimEnd('\r', '\n');
        return replaced.Length > MaxLine ? replaced[..MaxLine] : replaced;
    }

    private static string StripQuotes(string str)
    {
        if (str.StartsWith('"') && str.EndsWith('"') && str.Length >= 2)
        {
            return str[1..^1];
        }
        return str;
    }

    private static string ClampPath(string p) => p.Length > MaxPath ? p[..MaxPath] : p;

    public static StatusResult ParseStatus(string? rawOutput)
    {
        var defaultSummary = new StatusSummary(0, 0, 0, 0, 0, true);
        var defaultResult = new StatusResult("", null, 0, 0, false, [], defaultSummary);

        if (string.IsNullOrEmpty(rawOutput)) return defaultResult;

        var rawLines = rawOutput.Split('\n');
        if (rawLines.Length == 0) return defaultResult;

        var branch = "";
        string? upstream = null;
        var ahead = 0;
        var behind = 0;
        var isDetached = false;
        var entries = new List<StatusEntry>();

        var aheadRegex = new Regex(@"ahead\s+(\d+)", RegexOptions.Compiled);
        var behindRegex = new Regex(@"behind\s+(\d+)", RegexOptions.Compiled);

        foreach (var rawLine in rawLines)
        {
            var line = CleanLine(rawLine);
            if (line.Length == 0) continue;

            if (line.StartsWith("## "))
            {
                var rest = line[3..].Trim();
                if (rest.StartsWith("HEAD (no branch)"))
                {
                    branch = "HEAD";
                    isDetached = true;
                }
                else if (rest.StartsWith("Initial commit on ") || rest.StartsWith("No commits yet on "))
                {
                    var parts = rest.Split(" on ");
                    branch = parts.Length > 1 ? parts[1].Trim() : "main";
                }
                else
                {
                    var bracketIdx = rest.IndexOf(" [");
                    var branchPart = bracketIdx >= 0 ? rest[..bracketIdx] : rest;
                    var trackPart = bracketIdx >= 0 && rest.EndsWith(']') ? rest[(bracketIdx + 2)..^1] : "";

                    var dotIdx = branchPart.IndexOf("...");
                    if (dotIdx >= 0)
                    {
                        branch = branchPart[..dotIdx].Trim();
                        var up = branchPart[(dotIdx + 3)..].Trim();
                        upstream = string.IsNullOrEmpty(up) ? null : up;
                    }
                    else
                    {
                        branch = branchPart.Trim();
                    }

                    if (!string.IsNullOrEmpty(trackPart))
                    {
                        var aheadMatch = aheadRegex.Match(trackPart);
                        if (aheadMatch.Success) ahead = int.Parse(aheadMatch.Groups[1].Value);

                        var behindMatch = behindRegex.Match(trackPart);
                        if (behindMatch.Success) behind = int.Parse(behindMatch.Groups[1].Value);
                    }
                }
                continue;
            }

            if (line.Length < 4) continue;
            if (entries.Count >= MaxEntries) break;

            var staged = line[0];
            var unstaged = line[1];
            var sep = line[2];

            if (!ValidStaged.Contains(staged) || !ValidUnstaged.Contains(unstaged) || sep != ' ') continue;

            var pathPart = line[3..].Trim();
            if (pathPart.Length == 0) continue;

            var code = $"{staged}{unstaged}";
            var isConflicted = ConflictCodes.Contains(code);
            var isUntracked = code == "??";
            var isStaged = !isUntracked && !isConflicted && staged != ' ';
            var isUnstaged = !isUntracked && !isConflicted && unstaged != ' ';

            string path;
            string? origPath = null;

            var arrowIdx = pathPart.IndexOf(" -> ");
            if (arrowIdx >= 0)
            {
                origPath = ClampPath(StripQuotes(pathPart[..arrowIdx].Trim()));
                path = ClampPath(StripQuotes(pathPart[(arrowIdx + 4)..].Trim()));
            }
            else
            {
                path = ClampPath(StripQuotes(pathPart));
            }

            entries.Add(new StatusEntry(
                staged.ToString(),
                unstaged.ToString(),
                path,
                origPath,
                isStaged,
                isUnstaged,
                isUntracked,
                isConflicted
            ));
        }

        var stagedCount = 0;
        var unstagedCount = 0;
        var untrackedCount = 0;
        var conflictCount = 0;

        foreach (var it in entries)
        {
            if (it.IsConflicted) conflictCount++;
            else if (it.IsUntracked) untrackedCount++;
            else
            {
                if (it.IsStaged) stagedCount++;
                if (it.IsUnstaged) unstagedCount++;
            }
        }

        var total = entries.Count;
        var isClean = total == 0;

        var summary = new StatusSummary(
            stagedCount,
            unstagedCount,
            untrackedCount,
            conflictCount,
            total,
            isClean
        );

        return new StatusResult(
            branch,
            upstream,
            ahead,
            behind,
            isDetached,
            entries,
            summary
        );
    }

    public static string FormatStatusLine(StatusResult? status)
    {
        if (status is null) return "main";
        var branch = !string.IsNullOrWhiteSpace(status.Branch) ? status.Branch.Trim() : "main";
        var ahead = Math.Max(0, status.Ahead);
        var behind = Math.Max(0, status.Behind);

        if (behind > 0 && ahead > 0)
        {
            return $"{branch} {behind}\u2193 {ahead}\u2191";
        }
        if (behind > 0)
        {
            return $"{branch} {behind}\u2193";
        }
        if (ahead > 0)
        {
            return $"{branch} {ahead}\u2191";
        }
        return branch;
    }

    public static string FormatFileBadge(StatusEntry? entry)
    {
        if (entry is null) return "M";
        if (entry.IsConflicted) return "!";
        if (entry.IsUntracked) return "?";
        if (entry.IsStaged && entry.IsUnstaged) return "M";
        if (entry.IsStaged) return entry.Staged;
        if (entry.IsUnstaged) return entry.Unstaged;
        return "M";
    }

    public static GroupedEntries GroupEntries(IEnumerable<StatusEntry>? entries)
    {
        var result = new GroupedEntries([], [], [], []);
        if (entries is null) return result;

        foreach (var it in entries)
        {
            if (it is null) continue;
            if (it.IsConflicted) result.Conflicted.Add(it);
            else if (it.IsUntracked) result.Untracked.Add(it);
            else
            {
                if (it.IsStaged) result.Staged.Add(it);
                if (it.IsUnstaged) result.Unstaged.Add(it);
            }
        }

        return result;
    }
}
