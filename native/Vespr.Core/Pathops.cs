using System.Text.RegularExpressions;

namespace Vespr.Core;

/// <summary>
/// File and folder operations for the explorer: what is allowed and exactly what changes. Port of app/pathops.js;
/// native/golden/pathops.json holds the JavaScript answers this must reproduce exactly.
/// </summary>
public static class Pathops
{
    public const int MaxSegment = 120;
    public const int MaxPath = 300;
    public const int MaxDepth = 12;
    public const int MaxMoves = 500;
    public const string FolderMarker = ".keep";

    static readonly Regex SegmentRegex = new(@"^[A-Za-z0-9._-]+$", RegexOptions.Compiled);
    static readonly Regex HiddenCharRegex = new(@"[\u0000-\u001f\u007f]", RegexOptions.Compiled);
    static readonly Regex AllDotsRegex = new(@"^\.+$", RegexOptions.Compiled);

    public record ValidationResult(bool Ok, string? Reason = null, string? Name = null);
    public record PlanCreateResult(bool Ok, string? Reason = null, List<string>? Add = null, string? Path = null);
    public record PlanRenameResult(bool Ok, string? Reason = null, List<string[]>? Moves = null);
    public record PlanDeleteResult(bool Ok, string? Reason = null, List<string>? Remove = null, int? Count = null, string? Kind = null);

    static ValidationResult Fail(string reason) => new(false, Reason: reason);

    /// <summary>Validates a proposed file or folder name according to explorer rules.</summary>
    public static ValidationResult ValidateName(string? name)
    {
        if (name is null) return Fail("Give a name");
        var cleaned = Js.Trim(name);
        if (cleaned.StartsWith("./", StringComparison.Ordinal)) cleaned = cleaned[2..];
        if (cleaned.Length == 0) return Fail("Give a name");
        if (cleaned.StartsWith('/') || cleaned.Contains('\\')) return Fail("Use / between folders, with no / at the start");
        if (HiddenCharRegex.IsMatch(cleaned)) return Fail("That name has a hidden character");

        var segments = cleaned.Split('/');
        foreach (var s in segments)
        {
            if (s.Length == 0) return Fail("A folder or file name is empty");
            if (AllDotsRegex.IsMatch(s)) return Fail("Names cannot use . or .. as a step");
            if (s.Length > MaxSegment) return Fail("A name is too long");
            if (!SegmentRegex.IsMatch(s)) return Fail("Use letters, numbers, dots, dashes and underscores");
            if (s.EndsWith('.')) return Fail("A name cannot end with a dot");
        }

        if (segments.Length > MaxDepth || cleaned.Length > MaxPath) return Fail("That path is too long");
        if (string.Equals(Js.ToLowerCase(segments[0]), ".git", StringComparison.Ordinal)) return Fail("That folder is managed by git");
        if (string.Equals(Js.ToLowerCase(segments[^1]), FolderMarker, StringComparison.Ordinal)) return Fail(FolderMarker + " is reserved for empty folders");

        return new ValidationResult(true, Name: cleaned);
    }

    /// <summary>Joins a parent directory and a child name cleanly using forward slashes.</summary>
    public static string JoinPath(string? dir, string? name)
    {
        var d = (dir ?? "").Trim('/');
        var n = (name ?? "").TrimStart('/');
        if (d.Length == 0) return n;
        if (n.Length == 0) return d;
        return $"{d}/{n}";
    }

    /// <summary>'file' when a path equals p, 'folder' when some path starts with p + '/', else null. Case-insensitive.</summary>
    public static string? Exists(IEnumerable<string>? paths, string? p)
    {
        var k = Js.ToLowerCase(p ?? "");
        var folder = false;
        if (paths is not null)
        {
            foreach (var x in paths)
            {
                var l = Js.ToLowerCase(x ?? "");
                if (string.Equals(l, k, StringComparison.Ordinal)) return "file";
                if (l.StartsWith(k + "/", StringComparison.Ordinal)) folder = true;
            }
        }
        return folder ? "folder" : null;
    }

    static List<string> AncestorsOf(string p)
    {
        var parts = p.Split('/');
        var outList = new List<string>(parts.Length);
        for (var i = 1; i < parts.Length; i++)
        {
            outList.Add(string.Join('/', parts.Take(i)));
        }
        return outList;
    }

    static string? BlockedByFile(IEnumerable<string>? paths, string target)
    {
        var pathList = paths?.ToList() ?? [];
        foreach (var a in AncestorsOf(target))
        {
            var la = Js.ToLowerCase(a);
            if (pathList.Any(x => string.Equals(Js.ToLowerCase(x), la, StringComparison.Ordinal)))
                return a;
        }
        return null;
    }

    /// <summary>Plans creation of a new file or folder in a directory.</summary>
    public static PlanCreateResult PlanCreate(IEnumerable<string>? paths, string? dir, string? name, string? kind)
    {
        if (kind != "file" && kind != "folder") return new PlanCreateResult(false, Reason: "Unknown kind");
        var v = ValidateName(name);
        if (!v.Ok) return new PlanCreateResult(false, Reason: v.Reason);

        var target = JoinPath(dir, v.Name);
        var full = ValidateName(target);
        if (!full.Ok) return new PlanCreateResult(false, Reason: full.Reason);
        if (full.Name != target) return new PlanCreateResult(false, Reason: "That parent path is not usable");

        var added = kind == "file" ? target : target + "/" + FolderMarker;
        if (added.Length > MaxPath || added.Split('/').Length > MaxDepth) return new PlanCreateResult(false, Reason: "That path is too long");

        var have = Exists(paths, target);
        if (have is not null) return new PlanCreateResult(false, Reason: $"There is already a {have} named {target}");

        var blocker = BlockedByFile(paths, target);
        if (blocker is not null) return new PlanCreateResult(false, Reason: $"{blocker} is a file, so it cannot hold {target}");

        return new PlanCreateResult(true, Add: [added], Path: target);
    }

    /// <summary>Plans renaming or moving a file or folder.</summary>
    public static PlanRenameResult PlanRename(IEnumerable<string>? paths, string? from, string? to)
    {
        if (from is null) return new PlanRenameResult(false, Reason: "Give the name to rename");
        var kind = Exists(paths, from);
        if (kind is null) return new PlanRenameResult(false, Reason: "Nothing named that");

        var v = ValidateName(to);
        if (!v.Ok) return new PlanRenameResult(false, Reason: v.Reason);
        var dest = v.Name!;
        if (string.Equals(dest, from, StringComparison.Ordinal)) return new PlanRenameResult(false, Reason: "That is already its name");

        var lcDest = Js.ToLowerCase(dest);
        var lcFrom = Js.ToLowerCase(from);
        if (kind == "folder" && lcDest.StartsWith(lcFrom + "/", StringComparison.Ordinal))
            return new PlanRenameResult(false, Reason: "A folder cannot move into itself");

        var pathList = paths?.ToList() ?? [];
        List<string> moving;
        if (kind == "file")
        {
            var match = pathList.Find(x => string.Equals(Js.ToLowerCase(x), lcFrom, StringComparison.Ordinal));
            moving = match is not null ? [match] : [];
        }
        else
        {
            moving = pathList.Where(x => Js.ToLowerCase(x).StartsWith(lcFrom + "/", StringComparison.Ordinal)).ToList();
        }

        if (moving.Count > MaxMoves) return new PlanRenameResult(false, Reason: "Too many files to move at once");

        var movingSet = new HashSet<string>(moving.Select(Js.ToLowerCase), StringComparer.Ordinal);
        var remaining = pathList.Where(x => !movingSet.Contains(Js.ToLowerCase(x))).ToList();
        var remainingNames = new HashSet<string>(remaining.Select(Js.ToLowerCase), StringComparer.Ordinal);
        var remainingFolders = new HashSet<string>(remaining.SelectMany(p => AncestorsOf(Js.ToLowerCase(p))), StringComparer.Ordinal);

        var moves = moving.Select(old => new[] { old, kind == "file" ? dest : dest + old[from.Length..] }).ToList();
        moves.Sort((a, b) => string.CompareOrdinal(a[0], b[0]));

        foreach (var pair in moves)
        {
            var nu = pair[1];
            if (nu.Length > MaxPath || nu.Split('/').Length > MaxDepth) return new PlanRenameResult(false, Reason: "That path is too long");

            var lcNu = Js.ToLowerCase(nu);
            if (remainingNames.Contains(lcNu)) return new PlanRenameResult(false, Reason: $"There is already a file named {nu}");

            var parentFile = AncestorsOf(nu).Find(p => remainingNames.Contains(Js.ToLowerCase(p)));
            if (parentFile is not null) return new PlanRenameResult(false, Reason: $"{parentFile} is a file, so it cannot hold {nu}");

            if (remainingFolders.Contains(lcNu)) return new PlanRenameResult(false, Reason: $"There is already a folder named {nu}");
        }

        var blocker = BlockedByFile(remaining, dest);
        if (blocker is not null) return new PlanRenameResult(false, Reason: $"{blocker} is a file, so it cannot hold {dest}");

        var folderClash = remaining.Any(x => Js.ToLowerCase(x).StartsWith(lcDest + "/", StringComparison.Ordinal) && kind == "file");
        if (folderClash) return new PlanRenameResult(false, Reason: $"There is already a folder named {dest}");

        return new PlanRenameResult(true, Moves: moves);
    }

    /// <summary>Plans deletion of a file or folder.</summary>
    public static PlanDeleteResult PlanDelete(IEnumerable<string>? paths, string? target)
    {
        var kind = Exists(paths, target);
        if (kind is null) return new PlanDeleteResult(false, Reason: "Nothing named that");

        var k = Js.ToLowerCase(target ?? "");
        var pathList = paths?.ToList() ?? [];
        var remove = pathList.Where(x => {
            var l = Js.ToLowerCase(x);
            return string.Equals(l, k, StringComparison.Ordinal) || l.StartsWith(k + "/", StringComparison.Ordinal);
        }).ToList();
        remove.Sort(string.CompareOrdinal);

        return new PlanDeleteResult(true, Remove: remove, Count: remove.Count, Kind: kind);
    }

    /// <summary>True if the path represents an empty folder placeholder (.keep marker).</summary>
    public static bool IsMarker(string? p) => p is not null && p.Split('/').Last() == FolderMarker;

    /// <summary>Returns visible paths, filtering out empty folder marker files (.keep).</summary>
    public static List<string> VisiblePaths(IEnumerable<string>? paths) =>
        (paths ?? Enumerable.Empty<string>()).Where(p => !IsMarker(p)).ToList();
}
