namespace Vespr.Core;

using System.Text.Json;

/// <summary>
/// Tab and editor document lifecycle manager for the SDE shell. Port of app/tabs.js.
/// </summary>
public class Tabs
{
    public const int MaxTabs = 16;
    public const int MaxPath = 300;

    public record TabItem(string Path, bool Pinned);
    public record OpenResult(string Active, List<TabItem> Tabs, string? Evicted);
    public record CloseResult(string Active, string? Closed);
    public record CloseMultipleResult(string Active, List<string> Closed);

    private readonly int _limit;
    private List<TabItem> _items = [];
    private string _activePath = "";
    private List<string> _accessHistory = [];

    public static bool IsValidPath(string? p) =>
        p is not null && p.Length > 0 && p.Length <= MaxPath && !p.Contains('\0');

    public Tabs(int? max = null)
    {
        var rawMax = max ?? 8;
        _limit = Math.Max(1, Math.Min(MaxTabs, rawMax));
    }

    private void TouchAccess(string p)
    {
        _accessHistory.RemoveAll(x => x == p);
        _accessHistory.Insert(0, p);
    }

    public OpenResult Open(string? path)
    {
        if (!IsValidPath(path)) return new OpenResult(_activePath, List(), null);

        var existing = _items.Find(item => item.Path == path);
        if (existing is not null)
        {
            _activePath = path!;
            TouchAccess(path!);
            return new OpenResult(_activePath, List(), null);
        }

        string? evicted = null;
        if (_items.Count >= _limit)
        {
            // Find least recently used unpinned tab
            for (var i = _accessHistory.Count - 1; i >= 0; i--)
            {
                var cand = _accessHistory[i];
                var idx = _items.FindIndex(item => item.Path == cand && !item.Pinned);
                if (idx != -1)
                {
                    evicted = _items[idx].Path;
                    _items.RemoveAt(idx);
                    _accessHistory.RemoveAll(x => x == evicted);
                    break;
                }
            }

            // Fallback: pick first unpinned tab
            if (evicted is null)
            {
                var idx = _items.FindIndex(item => !item.Pinned);
                if (idx != -1)
                {
                    evicted = _items[idx].Path;
                    _items.RemoveAt(idx);
                    _accessHistory.RemoveAll(x => x == evicted);
                }
            }
        }

        if (_items.Count < _limit || evicted is not null)
        {
            _items.Add(new TabItem(path!, false));
            _activePath = path!;
            TouchAccess(path!);
        }

        return new OpenResult(_activePath, List(), evicted);
    }

    public CloseResult Close(string? path)
    {
        if (string.IsNullOrEmpty(path)) return new CloseResult(_activePath, null);

        var idx = _items.FindIndex(item => item.Path == path);
        if (idx == -1) return new CloseResult(_activePath, null);

        var wasActive = _activePath == path;
        _items.RemoveAt(idx);
        _accessHistory.RemoveAll(x => x == path);

        if (wasActive)
        {
            if (_items.Count == 0)
            {
                _activePath = "";
            }
            else
            {
                var nextIdx = idx < _items.Count ? idx : _items.Count - 1;
                _activePath = _items[nextIdx].Path;
                TouchAccess(_activePath);
            }
        }

        return new CloseResult(_activePath, path);
    }

    public CloseMultipleResult CloseOthers(string? path)
    {
        if (string.IsNullOrEmpty(path)) return new CloseMultipleResult(_activePath, []);
        var exists = _items.Any(item => item.Path == path);
        if (!exists) return new CloseMultipleResult(_activePath, []);

        var closed = new List<string>();
        var retained = new List<TabItem>();

        foreach (var item in _items)
        {
            if (item.Path == path || item.Pinned)
            {
                retained.Add(item);
            }
            else
            {
                closed.Add(item.Path);
            }
        }

        _items = retained;
        var closedSet = new HashSet<string>(closed);
        _accessHistory.RemoveAll(x => closedSet.Contains(x));

        _activePath = path;
        TouchAccess(path);

        return new CloseMultipleResult(_activePath, closed);
    }

    public CloseMultipleResult CloseToRight(string? path)
    {
        if (string.IsNullOrEmpty(path)) return new CloseMultipleResult(_activePath, []);
        var targetIdx = _items.FindIndex(item => item.Path == path);
        if (targetIdx == -1) return new CloseMultipleResult(_activePath, []);

        var closed = new List<string>();
        var retained = new List<TabItem>();

        for (var i = 0; i < _items.Count; i++)
        {
            var item = _items[i];
            if (i > targetIdx && !item.Pinned)
            {
                closed.Add(item.Path);
            }
            else
            {
                retained.Add(item);
            }
        }

        _items = retained;
        var closedSet = new HashSet<string>(closed);
        _accessHistory.RemoveAll(x => closedSet.Contains(x));

        if (closedSet.Contains(_activePath))
        {
            _activePath = path;
            TouchAccess(path);
        }

        return new CloseMultipleResult(_activePath, closed);
    }

    public bool Pin(string? path, bool isPinned = true)
    {
        if (path is null) return false;
        var item = _items.Find(it => it.Path == path);
        if (item is null) return false;
        var idx = _items.IndexOf(item);
        _items[idx] = item with { Pinned = isPinned };
        return true;
    }

    public bool Move(int fromIdx, int toIdx)
    {
        if (fromIdx < 0 || fromIdx >= _items.Count || toIdx < 0 || toIdx >= _items.Count) return false;
        if (fromIdx == toIdx) return true;

        var moved = _items[fromIdx];
        _items.RemoveAt(fromIdx);
        _items.Insert(toIdx, moved);
        return true;
    }

    public bool Rename(string? from, string? to)
    {
        if (!IsValidPath(from) || !IsValidPath(to)) return false;
        if (from == to) return false;

        var fromPrefix = from!.EndsWith('/') ? from : from + "/";
        var toPrefix = to!.EndsWith('/') ? to : to + "/";

        var renamedAny = false;
        var updated = new List<TabItem>();
        var seen = new Dictionary<string, int>(StringComparer.Ordinal);

        foreach (var item in _items)
        {
            var nextPath = item.Path;
            if (item.Path == from)
            {
                nextPath = to!;
                renamedAny = true;
            }
            else if (item.Path.StartsWith(fromPrefix, StringComparison.Ordinal))
            {
                var candidate = toPrefix + item.Path[fromPrefix.Length..];
                if (IsValidPath(candidate))
                {
                    nextPath = candidate;
                    renamedAny = true;
                }
            }

            if (seen.TryGetValue(nextPath, out var idx))
            {
                if (item.Pinned) updated[idx] = updated[idx] with { Pinned = true };
            }
            else
            {
                seen[nextPath] = updated.Count;
                updated.Add(new TabItem(nextPath, item.Pinned));
            }
        }

        _items = updated;

        if (_activePath == from)
        {
            _activePath = to!;
        }
        else if (_activePath.StartsWith(fromPrefix, StringComparison.Ordinal))
        {
            var candidate = toPrefix + _activePath[fromPrefix.Length..];
            if (IsValidPath(candidate))
            {
                _activePath = candidate;
            }
        }

        var nextHistory = new List<string>();
        var historySeen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var p in _accessHistory)
        {
            var nextP = p;
            if (p == from)
            {
                nextP = to!;
            }
            else if (p.StartsWith(fromPrefix, StringComparison.Ordinal))
            {
                var candidate = toPrefix + p[fromPrefix.Length..];
                if (IsValidPath(candidate))
                {
                    nextP = candidate;
                }
            }
            if (historySeen.Add(nextP))
            {
                nextHistory.Add(nextP);
            }
        }
        _accessHistory = nextHistory;

        return renamedAny;
    }

    public string Active() => _activePath;
    public List<TabItem> List() => _items.Select(it => new TabItem(it.Path, it.Pinned)).ToList();
    public List<string> Paths() => _items.Select(it => it.Path).ToList();

    public string Serialize()
    {
        var obj = new
        {
            active = _activePath,
            items = _items.Select(it => new { path = it.Path, pinned = it.Pinned }).ToList()
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

            var validItems = new List<TabItem>();
            var seen = new HashSet<string>(StringComparer.Ordinal);

            if (root.TryGetProperty("items", out var itemsEl) && itemsEl.ValueKind == JsonValueKind.Array)
            {
                foreach (var el in itemsEl.EnumerateArray())
                {
                    if (el.ValueKind == JsonValueKind.Object && el.TryGetProperty("path", out var pathEl) && pathEl.ValueKind == JsonValueKind.String)
                    {
                        var p = pathEl.GetString();
                        if (IsValidPath(p) && seen.Add(p!))
                        {
                            var pinned = el.TryGetProperty("pinned", out var pinEl) && pinEl.ValueKind == JsonValueKind.True;
                            validItems.Add(new TabItem(p!, pinned));
                            if (validItems.Count >= _limit) break;
                        }
                    }
                }
            }

            _items = validItems;
            _accessHistory = validItems.Select(it => it.Path).ToList();

            if (root.TryGetProperty("active", out var actEl) && actEl.ValueKind == JsonValueKind.String)
            {
                var act = actEl.GetString();
                if (IsValidPath(act) && seen.Contains(act!))
                {
                    _activePath = act!;
                    TouchAccess(_activePath);
                }
                else
                {
                    _activePath = _items.Count > 0 ? _items[0].Path : "";
                    if (_activePath.Length > 0) TouchAccess(_activePath);
                }
            }
            else
            {
                _activePath = _items.Count > 0 ? _items[0].Path : "";
                if (_activePath.Length > 0) TouchAccess(_activePath);
            }

            return true;
        }
        catch
        {
            return false;
        }
    }
}
