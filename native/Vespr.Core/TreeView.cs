namespace Vespr.Core;

using System.Text.RegularExpressions;

/// <summary>
/// Workspace file tree builder, flattener, and filter for the SDE shell. Port of app/treeview.js.
/// </summary>
public static class TreeView
{
    public const int MaxPaths = 5000;
    public const int MaxPathLen = 300;
    public const int MaxDepth = 30;
    public const int MaxRows = 2000;

    public class TreeNode
    {
        public string N { get; set; } = "";
        public string Full { get; set; } = "";
        public int Dir { get; set; }
        public List<TreeNode>? Kids { get; set; }
        public string Ext { get; set; } = "";
        public bool Chg { get; set; }
        public int Count { get; set; }

        public TreeNode() { }

        public TreeNode(
            string n,
            string full,
            int dir,
            List<TreeNode>? kids = null,
            string ext = "",
            bool chg = false,
            int count = 0)
        {
            N = n;
            Full = full;
            Dir = dir;
            Kids = kids;
            Ext = ext;
            Chg = chg;
            Count = count;
        }
    }

    public record FlatRow(
        string N,
        string Full,
        int Dir,
        int Depth,
        bool Open,
        int Count,
        string Ext,
        bool Chg,
        bool Active
    );

    public record TreeOptions(
        bool HideKeepFiles = true,
        bool Sort = true,
        IEnumerable<string>? ChangedPaths = null
    );

    public record FlattenOptions(
        int? MaxRows = null,
        string? ActivePath = null
    );

    public static int NaturalCompare(string? a, string? b)
    {
        var sa = a ?? "";
        var sb = b ?? "";

        var ia = 0;
        var ib = 0;

        while (ia < sa.Length && ib < sb.Length)
        {
            var ca = sa[ia];
            var cb = sb[ib];

            if (char.IsDigit(ca) && char.IsDigit(cb))
            {
                var startA = ia;
                while (ia < sa.Length && char.IsDigit(sa[ia])) ia++;
                var numStrA = sa[startA..ia];

                var startB = ib;
                while (ib < sb.Length && char.IsDigit(sb[ib])) ib++;
                var numStrB = sb[startB..ib];

                // Parse or compare lengths first (to avoid overflow with huge numbers)
                var trimA = numStrA.TrimStart('0');
                var trimB = numStrB.TrimStart('0');

                if (trimA.Length != trimB.Length)
                {
                    return trimA.Length.CompareTo(trimB.Length);
                }

                var numCmp = string.CompareOrdinal(trimA, trimB);
                if (numCmp != 0) return numCmp;
            }
            else
            {
                var cmp = char.ToLowerInvariant(ca).CompareTo(char.ToLowerInvariant(cb));
                if (cmp != 0) return cmp;
                ia++;
                ib++;
            }
        }

        return (sa.Length - ia).CompareTo(sb.Length - ib);
    }

    private static string GetExt(string name)
    {
        var idx = name.LastIndexOf('.');
        return idx > 0 ? name[(idx + 1)..].ToLowerInvariant() : "";
    }

    private static List<string> SplitPath(string? rawPath)
    {
        if (rawPath is null) return [];
        var clean = rawPath.Replace('\\', '/').Trim();
        if (clean.Length > MaxPathLen) clean = clean[..MaxPathLen];
        if (clean.Length == 0) return [];

        var segments = clean.Split('/')
            .Where(s => s.Length > 0 && s != "." && s != "__proto__" && s != "constructor")
            .Take(MaxDepth)
            .ToList();

        return segments;
    }

    public static int CountTreeFiles(object? nodeOrNodes)
    {
        if (nodeOrNodes is null) return 0;
        if (nodeOrNodes is IEnumerable<TreeNode> list)
        {
            var sum = 0;
            foreach (var item in list) sum += CountTreeFiles(item);
            return sum;
        }
        if (nodeOrNodes is TreeNode node)
        {
            if (node.Dir == 0) return 1;
            var total = 0;
            if (node.Kids is not null)
            {
                foreach (var k in node.Kids) total += CountTreeFiles(k);
            }
            return total;
        }
        return 0;
    }

    public static List<TreeNode> SortTreeNodes(List<TreeNode>? nodes)
    {
        if (nodes is null) return [];

        nodes.Sort((a, b) =>
        {
            var aDir = a.Dir != 0 ? 1 : 0;
            var bDir = b.Dir != 0 ? 1 : 0;
            if (aDir != bDir) return bDir - aDir;
            return NaturalCompare(a.N, b.N);
        });

        foreach (var n in nodes)
        {
            if (n.Dir != 0 && n.Kids is not null)
            {
                SortTreeNodes(n.Kids);
            }
        }

        return nodes;
    }

    public static List<TreeNode> BuildTree(IEnumerable<string>? paths, TreeOptions? options = null)
    {
        if (paths is null) return [];

        var hideKeepFiles = options?.HideKeepFiles ?? true;
        var shouldSort = options?.Sort ?? true;
        var changedSet = new HashSet<string>(options?.ChangedPaths ?? [], StringComparer.Ordinal);

        var pathList = paths.Take(MaxPaths).ToList();
        var root = new TreeNode { Kids = [] };

        for (var pIdx = 0; pIdx < pathList.Count; pIdx++)
        {
            var raw = pathList[pIdx];
            var parts = SplitPath(raw);
            if (parts.Count == 0) continue;

            var cur = root;
            for (var i = 0; i < parts.Count; i++)
            {
                var seg = parts[i];
                var isFile = i == parts.Count - 1;
                var isDir = !isFile;
                var full = string.Join("/", parts.Take(i + 1));

                var existing = cur.Kids?.FirstOrDefault(k => k.N == seg);
                if (existing is not null)
                {
                    if (isDir && existing.Dir == 0)
                    {
                        existing.Dir = 1;
                        existing.Kids ??= [];
                        existing.Ext = "";
                    }
                    else if (isFile && changedSet.Contains(full))
                    {
                        existing.Chg = true;
                    }
                }
                else
                {
                    existing = new TreeNode(
                        n: seg,
                        full: full,
                        dir: isDir ? 1 : 0,
                        kids: isDir ? [] : null,
                        ext: isFile ? GetExt(seg) : "",
                        chg: changedSet.Contains(full)
                    );
                    cur.Kids?.Add(existing);
                }
                cur = existing;
            }
        }

        (int Count, bool Chg) Decorate(TreeNode node)
        {
            if (node.Dir == 0)
            {
                node.Count = 1;
                return (1, node.Chg);
            }

            var totalCount = 0;
            var anyChg = node.Chg;

            if (node.Kids is not null)
            {
                if (hideKeepFiles)
                {
                    node.Kids.RemoveAll(k => k.N == ".keep" && k.Dir == 0);
                }

                foreach (var kid in node.Kids)
                {
                    var res = Decorate(kid);
                    totalCount += res.Count;
                    if (res.Chg) anyChg = true;
                }
            }

            node.Count = totalCount;
            node.Chg = anyChg;
            return (totalCount, anyChg);
        }

        if (hideKeepFiles)
        {
            root.Kids?.RemoveAll(k => k.N == ".keep" && k.Dir == 0);
        }

        if (root.Kids is not null)
        {
            foreach (var top in root.Kids)
            {
                Decorate(top);
            }

            if (shouldSort)
            {
                SortTreeNodes(root.Kids);
            }
        }

        return root.Kids ?? [];
    }

    public static List<FlatRow> FlattenTree(
        IEnumerable<TreeNode>? nodes,
        Func<string, bool>? isOpen = null,
        FlattenOptions? options = null)
    {
        if (nodes is null) return [];

        var maxRows = options?.MaxRows is int m && m > 0
            ? Math.Max(1, Math.Min(MaxRows, m))
            : MaxRows;

        var activePath = options?.ActivePath?.Trim() ?? "";
        var rows = new List<FlatRow>();

        void Walk(IEnumerable<TreeNode> list, int depth)
        {
            if (depth > MaxDepth || rows.Count >= maxRows) return;

            foreach (var node in list)
            {
                if (node is null) continue;
                if (rows.Count >= maxRows) break;

                var open = node.Dir != 0 && (isOpen?.Invoke(node.Full) == true);
                var active = node.Dir == 0 && node.Full == activePath;

                rows.Add(new FlatRow(
                    N: node.N,
                    Full: node.Full,
                    Dir: node.Dir != 0 ? 1 : 0,
                    Depth: depth,
                    Open: open,
                    Count: node.Count,
                    Ext: node.Ext ?? "",
                    Chg: node.Chg,
                    Active: active
                ));

                if (open && node.Kids is not null && node.Kids.Count > 0)
                {
                    Walk(node.Kids, depth + 1);
                }
            }
        }

        Walk(nodes, 0);
        return rows;
    }

    public static TreeNode? FindNode(IEnumerable<TreeNode>? nodes, string? fullPath)
    {
        if (nodes is null || string.IsNullOrWhiteSpace(fullPath)) return null;
        var clean = fullPath.Replace('\\', '/').Trim();

        foreach (var node in nodes)
        {
            if (node is null) continue;
            if (node.Full == clean) return node;

            if (node.Dir != 0 && node.Kids is not null)
            {
                var match = FindNode(node.Kids, clean);
                if (match is not null) return match;
            }
        }

        return null;
    }

    public static List<TreeNode> FilterTree(List<TreeNode>? nodes, string? query)
    {
        if (nodes is null) return [];
        if (string.IsNullOrWhiteSpace(query)) return nodes;

        var q = query.Trim().ToLowerInvariant();

        List<TreeNode> FilterList(List<TreeNode> list)
        {
            var outList = new List<TreeNode>();
            foreach (var node in list)
            {
                if (node is null) continue;
                var nameMatch = node.N.ToLowerInvariant().Contains(q);

                if (node.Dir != 0 && node.Kids is not null)
                {
                    var filteredKids = FilterList(node.Kids);
                    if (filteredKids.Count > 0 || nameMatch)
                    {
                        var count = filteredKids.Sum(k => k.Count > 0 ? k.Count : (k.Dir != 0 ? 0 : 1));
                        outList.Add(new TreeNode(
                            n: node.N,
                            full: node.Full,
                            dir: node.Dir,
                            kids: filteredKids,
                            ext: node.Ext,
                            chg: node.Chg,
                            count: count
                        ));
                    }
                }
                else if (nameMatch)
                {
                    outList.Add(new TreeNode(
                        n: node.N,
                        full: node.Full,
                        dir: node.Dir,
                        kids: null,
                        ext: node.Ext,
                        chg: node.Chg,
                        count: node.Count
                    ));
                }
            }
            return outList;
        }

        return FilterList(nodes);
    }
}
