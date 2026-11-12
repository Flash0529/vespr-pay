namespace Vespr.Core;

using System;
using System.Collections.Generic;
using System.Linq;

/// <summary>
/// Dual-directory Integrated File System for VESPR SDE.
/// Integrates workspace Project Files (project://) and User's Host System Files (system://)
/// with role-based access governance, hierarchical tree generation, search, and bidirectional transfer.
/// </summary>
public static class IntegratedFileSystem
{
    public enum FsScope
    {
        Project = 0,
        SystemHost = 1
    }

    public record FsEntry(
        string Path,
        string Name,
        FsScope Scope,
        bool IsDirectory,
        long Size,
        DateTime ModifiedAt,
        string Extension,
        bool IsReadOnly,
        string MimeType
    );

    public class FsDirectoryNode
    {
        public string Name { get; set; } = "";
        public string Path { get; set; } = "";
        public FsScope Scope { get; set; }
        public bool IsDirectory { get; set; }
        public List<FsDirectoryNode> Children { get; set; } = new();
        public long Size { get; set; }
        public int FileCount { get; set; }
        public bool IsReadOnly { get; set; }

        public FsDirectoryNode() { }

        public FsDirectoryNode(
            string name,
            string path,
            FsScope scope,
            bool isDirectory,
            List<FsDirectoryNode>? children = null,
            long size = 0,
            int fileCount = 0,
            bool isReadOnly = false)
        {
            Name = name;
            Path = path;
            Scope = scope;
            IsDirectory = isDirectory;
            Children = children ?? new();
            Size = size;
            FileCount = fileCount;
            IsReadOnly = isReadOnly;
        }
    }

    public record FsOperationResult(
        bool Success,
        string Message,
        string? AffectedPath = null,
        long BytesTransferred = 0
    );

    public record FsScopeInfo(
        FsScope Scope,
        string RootPath,
        string DisplayName,
        bool CanRead,
        bool CanWrite,
        bool IsSandboxed
    );

    public static FsScopeInfo GetScopeInfo(FsScope scope, AccountFlavors.AccountProfile? account = null)
    {
        var canRead = CanAccessScope(account, scope, forWrite: false);
        var canWrite = CanAccessScope(account, scope, forWrite: true);

        if (scope == FsScope.Project)
        {
            return new FsScopeInfo(
                Scope: FsScope.Project,
                RootPath: "project://",
                DisplayName: "Project Files (cart-shop)",
                CanRead: canRead,
                CanWrite: canWrite,
                IsSandboxed: false
            );
        }
        else
        {
            var isStudent = account?.Role == "student";
            return new FsScopeInfo(
                Scope: FsScope.SystemHost,
                RootPath: "system://",
                DisplayName: isStudent ? "Host System Directory (Locked by School IT)" : "Host System Directory (/home/user)",
                CanRead: canRead,
                CanWrite: canWrite,
                IsSandboxed: isStudent
            );
        }
    }

    public static bool CanAccessScope(AccountFlavors.AccountProfile? account, FsScope scope, bool forWrite = false)
    {
        if (account == null)
        {
            return scope == FsScope.Project || !forWrite;
        }

        switch (account.Role)
        {
            case "student":
                // Students can read/write their project workspace, but cannot access host system files.
                return scope == FsScope.Project;

            case "intern":
            case "junior_dev":
                // Junior devs can read/write project, read host system directories, but cannot write host system files directly.
                return scope == FsScope.Project || !forWrite;

            case "teacher":
            case "school_admin":
                // Teachers and school admins have full project and system access for lesson assets.
                return true;

            case "corporate_legal":
                // Corporate legal has read-only audit access across both scopes.
                return !forWrite;

            case "solo_dev":
            case "senior_dev":
            case "it_admin":
            default:
                // Full unrestricted access across Project and Host System directory.
                return true;
        }
    }

    public static string NormalizePath(string rawPath, FsScope scope)
    {
        if (string.IsNullOrWhiteSpace(rawPath)) return "";
        var p = rawPath.Trim().Replace('\\', '/');
        if (p.StartsWith("project://", StringComparison.OrdinalIgnoreCase))
            p = p[10..];
        else if (p.StartsWith("system://", StringComparison.OrdinalIgnoreCase))
            p = p[9..];

        var parts = p.Split('/', StringSplitOptions.RemoveEmptyEntries);
        var stack = new List<string>();

        foreach (var part in parts)
        {
            if (part == "." || string.IsNullOrWhiteSpace(part)) continue;
            if (part == "..")
            {
                if (stack.Count > 0) stack.RemoveAt(stack.Count - 1);
            }
            else
            {
                stack.Add(part);
            }
        }

        return string.Join("/", stack);
    }

    public static string DetectMimeType(string path)
    {
        var ext = "";
        var idx = path.LastIndexOf('.');
        if (idx >= 0) ext = path[idx..].ToLowerInvariant();

        return ext switch
        {
            ".py" => "text/x-python",
            ".cs" => "text/x-csharp",
            ".js" or ".mjs" => "application/javascript",
            ".json" => "application/json",
            ".html" or ".htm" => "text/html",
            ".css" => "text/css",
            ".md" => "text/markdown",
            ".png" => "image/png",
            ".jpg" or ".jpeg" => "image/jpeg",
            ".svg" => "image/svg+xml",
            ".txt" => "text/plain",
            ".sh" => "application/x-sh",
            _ => "application/octet-stream"
        };
    }

    public static List<FsDirectoryNode> BuildDirectoryTree(IEnumerable<FsEntry> entries, FsScope scope, string rootPath = "")
    {
        var filtered = entries.Where(e => e.Scope == scope).ToList();
        var root = new FsDirectoryNode("", rootPath, scope, true);

        foreach (var entry in filtered)
        {
            var parts = NormalizePath(entry.Path, scope).Split('/', StringSplitOptions.RemoveEmptyEntries);
            if (parts.Length == 0) continue;

            var cur = root;
            for (var i = 0; i < parts.Length; i++)
            {
                var seg = parts[i];
                var isLast = i == parts.Length - 1;
                var currentPath = string.Join("/", parts.Take(i + 1));

                var existing = cur.Children.FirstOrDefault(c => c.Name.Equals(seg, StringComparison.OrdinalIgnoreCase));
                if (existing == null)
                {
                    var isDir = !isLast || entry.IsDirectory;
                    existing = new FsDirectoryNode(
                        name: seg,
                        path: currentPath,
                        scope: scope,
                        isDirectory: isDir,
                        children: isDir ? new() : null,
                        size: isLast ? entry.Size : 0,
                        fileCount: isLast && !entry.IsDirectory ? 1 : 0,
                        isReadOnly: entry.IsReadOnly
                    );
                    cur.Children.Add(existing);
                }
                cur = existing;
            }
        }

        void Decorate(FsDirectoryNode node)
        {
            if (!node.IsDirectory)
            {
                node.FileCount = 1;
                return;
            }

            long totalSize = 0;
            int totalFiles = 0;

            foreach (var child in node.Children)
            {
                Decorate(child);
                totalSize += child.Size;
                totalFiles += child.FileCount;
            }

            node.Size = totalSize;
            node.FileCount = totalFiles;
            node.Children.Sort((a, b) =>
            {
                if (a.IsDirectory != b.IsDirectory)
                    return b.IsDirectory ? 1 : -1;
                return TreeView.NaturalCompare(a.Name, b.Name);
            });
        }

        foreach (var top in root.Children)
        {
            Decorate(top);
        }

        root.Children.Sort((a, b) =>
        {
            if (a.IsDirectory != b.IsDirectory)
                return b.IsDirectory ? 1 : -1;
            return TreeView.NaturalCompare(a.Name, b.Name);
        });

        return root.Children;
    }

    public static FsOperationResult WriteFile(
        string path,
        FsScope scope,
        string content,
        IDictionary<string, string> storage,
        AccountFlavors.AccountProfile? account = null)
    {
        if (!CanAccessScope(account, scope, forWrite: true))
        {
            return new FsOperationResult(false, $"Write permission denied for {scope} scope under role {account?.Role ?? "guest"}.");
        }

        var norm = NormalizePath(path, scope);
        if (string.IsNullOrEmpty(norm))
        {
            return new FsOperationResult(false, "Invalid path.");
        }

        var key = $"{scope.ToString().ToLowerInvariant()}:{norm}";
        storage[key] = content;
        var bytes = System.Text.Encoding.UTF8.GetByteCount(content);

        return new FsOperationResult(true, $"Successfully wrote file to {scope}://{norm}", norm, bytes);
    }

    public static FsOperationResult ReadFile(
        string path,
        FsScope scope,
        IDictionary<string, string> storage,
        AccountFlavors.AccountProfile? account = null)
    {
        if (!CanAccessScope(account, scope, forWrite: false))
        {
            return new FsOperationResult(false, $"Read permission denied for {scope} scope under role {account?.Role ?? "guest"}.");
        }

        var norm = NormalizePath(path, scope);
        var key = $"{scope.ToString().ToLowerInvariant()}:{norm}";

        if (!storage.TryGetValue(key, out var content))
        {
            return new FsOperationResult(false, $"File not found at {scope}://{norm}", norm);
        }

        return new FsOperationResult(true, content, norm, System.Text.Encoding.UTF8.GetByteCount(content));
    }

    public static FsOperationResult CopyBetweenScopes(
        string srcPath,
        FsScope srcScope,
        string dstPath,
        FsScope dstScope,
        IDictionary<string, string> storage,
        AccountFlavors.AccountProfile? account = null)
    {
        if (!CanAccessScope(account, srcScope, forWrite: false))
        {
            return new FsOperationResult(false, $"Read permission denied on source scope {srcScope}.");
        }

        if (!CanAccessScope(account, dstScope, forWrite: true))
        {
            return new FsOperationResult(false, $"Write permission denied on destination scope {dstScope}.");
        }

        var normSrc = NormalizePath(srcPath, srcScope);
        var normDst = NormalizePath(dstPath, dstScope);

        var srcKey = $"{srcScope.ToString().ToLowerInvariant()}:{normSrc}";
        var dstKey = $"{dstScope.ToString().ToLowerInvariant()}:{normDst}";

        if (!storage.TryGetValue(srcKey, out var content))
        {
            return new FsOperationResult(false, $"Source file not found at {srcScope}://{normSrc}", normSrc);
        }

        storage[dstKey] = content;
        var byteCount = System.Text.Encoding.UTF8.GetByteCount(content);

        return new FsOperationResult(
            Success: true,
            Message: $"Successfully copied {srcScope}://{normSrc} to {dstScope}://{normDst}",
            AffectedPath: normDst,
            BytesTransferred: byteCount
        );
    }

    public static FsOperationResult DeleteEntry(
        string path,
        FsScope scope,
        IDictionary<string, string> storage,
        AccountFlavors.AccountProfile? account = null)
    {
        if (!CanAccessScope(account, scope, forWrite: true))
        {
            return new FsOperationResult(false, $"Delete permission denied for {scope} scope.");
        }

        var norm = NormalizePath(path, scope);
        var prefix = $"{scope.ToString().ToLowerInvariant()}:{norm}";

        var toRemove = storage.Keys
            .Where(k => k == prefix || k.StartsWith(prefix + "/"))
            .ToList();

        if (toRemove.Count == 0)
        {
            return new FsOperationResult(false, $"Entry not found at {scope}://{norm}", norm);
        }

        foreach (var k in toRemove) storage.Remove(k);

        return new FsOperationResult(true, $"Deleted {toRemove.Count} item(s) under {scope}://{norm}", norm);
    }

    public static List<FsEntry> Search(string query, FsScope? scope, IEnumerable<FsEntry> entries)
    {
        if (string.IsNullOrWhiteSpace(query))
        {
            return scope.HasValue ? entries.Where(e => e.Scope == scope.Value).ToList() : entries.ToList();
        }

        var q = query.Trim().ToLowerInvariant();
        return entries
            .Where(e => (!scope.HasValue || e.Scope == scope.Value) &&
                        (e.Name.ToLowerInvariant().Contains(q) || e.Path.ToLowerInvariant().Contains(q)))
            .OrderBy(e => e.IsDirectory ? 0 : 1)
            .ThenBy(e => TreeView.NaturalCompare(e.Name, e.Name))
            .ToList();
    }

    public static List<FsEntry> CreateDefaultProjectEntries()
    {
        var now = DateTime.UtcNow;
        return new List<FsEntry>
        {
            new FsEntry("README.md", "README.md", FsScope.Project, false, 820, now.AddHours(-4), ".md", false, "text/markdown"),
            new FsEntry("cart.py", "cart.py", FsScope.Project, false, 1420, now.AddHours(-1), ".py", false, "text/x-python"),
            new FsEntry("test_cart.py", "test_cart.py", FsScope.Project, false, 950, now.AddHours(-1), ".py", false, "text/x-python"),
            new FsEntry("fizzbuzz.py", "fizzbuzz.py", FsScope.Project, false, 410, now.AddDays(-1), ".py", false, "text/x-python"),
            new FsEntry("server/app.py", "app.py", FsScope.Project, false, 2800, now.AddHours(-2), ".py", false, "text/x-python"),
            new FsEntry("server/config.json", "config.json", FsScope.Project, false, 560, now.AddHours(-3), ".json", false, "application/json"),
            new FsEntry("agents/agent.js", "agent.js", FsScope.Project, false, 3400, now.AddHours(-2), ".js", false, "application/javascript"),
            new FsEntry("agents/runner.js", "runner.js", FsScope.Project, false, 4100, now.AddHours(-3), ".js", false, "application/javascript")
        };
    }

    public static List<FsEntry> CreateDefaultSystemEntries()
    {
        var now = DateTime.UtcNow;
        return new List<FsEntry>
        {
            new FsEntry("~/.bashrc", ".bashrc", FsScope.SystemHost, false, 3771, now.AddDays(-10), "", false, "text/plain"),
            new FsEntry("~/.config/vespr/settings.json", "settings.json", FsScope.SystemHost, false, 1204, now.AddHours(-5), ".json", false, "application/json"),
            new FsEntry("/srv/vespr/tools/claim.py", "claim.py", FsScope.SystemHost, false, 4820, now.AddDays(-2), ".py", false, "text/x-python"),
            new FsEntry("/srv/vespr/tools/msg.py", "msg.py", FsScope.SystemHost, false, 3910, now.AddDays(-2), ".py", false, "text/x-python"),
            new FsEntry("/home/user/scripts/backup.sh", "backup.sh", FsScope.SystemHost, false, 640, now.AddDays(-4), ".sh", false, "application/x-sh"),
            new FsEntry("/home/user/datasets/sample.csv", "sample.csv", FsScope.SystemHost, false, 18500, now.AddDays(-1), ".csv", false, "text/plain")
        };
    }
}
