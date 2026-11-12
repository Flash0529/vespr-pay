namespace Vespr.Core;

using System.Text.Json;

/// <summary>
/// Recently opened files for quick switching. Port of app/recents.js.
/// </summary>
public class Recents
{
    public const int MaxRecents = 12;
    public const int MaxPath = 300;

    private List<string> _items = [];

    public static bool IsValidPath(string? p) =>
        p is not null && p.Length > 0 && p.Length <= MaxPath && !p.Contains('\0');

    public Recents(string? saved = null)
    {
        if (string.IsNullOrEmpty(saved)) return;
        try
        {
            using var doc = JsonDocument.Parse(saved);
            if (doc.RootElement.ValueKind == JsonValueKind.Array)
            {
                var seen = new HashSet<string>(StringComparer.Ordinal);
                foreach (var el in doc.RootElement.EnumerateArray())
                {
                    if (el.ValueKind == JsonValueKind.String)
                    {
                        var entry = el.GetString();
                        if (IsValidPath(entry) && seen.Add(entry!))
                        {
                            _items.Add(entry!);
                            if (_items.Count >= MaxRecents) break;
                        }
                    }
                }
            }
        }
        catch
        {
            _items = [];
        }
    }

    public Recents(IEnumerable<string?>? raw)
    {
        if (raw is null) return;
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var entry in raw)
        {
            if (IsValidPath(entry) && seen.Add(entry!))
            {
                _items.Add(entry!);
                if (_items.Count >= MaxRecents) break;
            }
        }
    }

    public void Touch(string? path)
    {
        if (!IsValidPath(path)) return;
        _items.RemoveAll(p => string.Equals(p, path, StringComparison.Ordinal));
        _items.Insert(0, path!);
        if (_items.Count > MaxRecents)
        {
            _items.RemoveAt(_items.Count - 1);
        }
    }

    public List<string> List(IEnumerable<string>? existing = null)
    {
        if (existing is not null)
        {
            var set = new HashSet<string>(existing, StringComparer.Ordinal);
            return _items.Where(p => set.Contains(p)).ToList();
        }
        return new List<string>(_items);
    }

    public void Remove(string? path)
    {
        if (path is null) return;
        _items.RemoveAll(p => string.Equals(p, path, StringComparison.Ordinal));
    }

    public void Rename(string? from, string? to)
    {
        if (!IsValidPath(from) || !IsValidPath(to)) return;
        var fromPrefix = from + "/";
        var toPrefix = to + "/";

        var updated = new List<string>();
        var seen = new HashSet<string>(StringComparer.Ordinal);

        foreach (var p in _items)
        {
            var next = p;
            if (string.Equals(p, from, StringComparison.Ordinal))
            {
                next = to!;
            }
            else if (p.StartsWith(fromPrefix, StringComparison.Ordinal))
            {
                next = toPrefix + p[fromPrefix.Length..];
            }

            if (seen.Add(next))
            {
                updated.Add(next);
            }
        }

        _items = updated.Take(MaxRecents).ToList();
    }

    public string Serialize() => JsonSerializer.Serialize(_items);
}
