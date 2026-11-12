namespace Vespr.Core;

/// <summary>
/// Navigation log and bounce analyzer. Port of app/navlog.js.
/// </summary>
public static class NavLog
{
    public const long DefaultQuickMs = 30000;
    public const double DefaultThreshold = 0.15;
    public const int DefaultMinVisits = 10;
    public const int DefaultMax = 500;

    public record NavEntry(
        string Screen,
        long At
    );

    public record BounceReport(
        string Screen,
        int Visits,
        int Bounces,
        double Ratio,
        string? Partner
    );

    public record NavLogOptions(
        long? QuickMs = null,
        double? Threshold = null,
        int? MinVisits = null
    );

    public static NavLogManager CreateNavLog(Func<long>? now = null, int max = DefaultMax)
    {
        return new NavLogManager(now, max);
    }
}

public class NavLogManager
{
    private readonly Func<long> _now;
    private readonly int _limit;
    private List<NavLog.NavEntry> _entries = [];

    public NavLogManager(Func<long>? now = null, int max = NavLog.DefaultMax)
    {
        _now = now ?? (() => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
        _limit = Math.Max(1, max > 0 ? max : NavLog.DefaultMax);
    }

    public void Visit(string? screen)
    {
        if (string.IsNullOrWhiteSpace(screen) || screen.Length > 60) return;
        var cleanScreen = screen.Trim();
        if (cleanScreen.Length == 0) return;

        if (_entries.Count > 0 && _entries[^1].Screen == cleanScreen) return;

        _entries.Add(new NavLog.NavEntry(cleanScreen, _now()));
        if (_entries.Count > _limit)
        {
            _entries.RemoveAt(0);
        }
    }

    public List<NavLog.BounceReport> Report(NavLog.NavLogOptions? opts = null)
    {
        var quickMs = opts?.QuickMs ?? NavLog.DefaultQuickMs;
        var threshold = opts?.Threshold ?? NavLog.DefaultThreshold;
        var minVisits = opts?.MinVisits ?? NavLog.DefaultMinVisits;

        var visitsMap = new Dictionary<string, int>(StringComparer.Ordinal);
        foreach (var e in _entries)
        {
            visitsMap[e.Screen] = visitsMap.GetValueOrDefault(e.Screen, 0) + 1;
        }

        var bouncesMap = new Dictionary<string, int>(StringComparer.Ordinal);
        var partnerCounts = new Dictionary<string, Dictionary<string, int>>(StringComparer.Ordinal);
        var partnerFirstSeen = new Dictionary<string, Dictionary<string, int>>(StringComparer.Ordinal);

        for (var i = 0; i + 2 < _entries.Count; i++)
        {
            var e1 = _entries[i];
            var e2 = _entries[i + 1];
            var e3 = _entries[i + 2];
            var s = e1.Screen;
            var x = e2.Screen;

            if (e3.Screen == s && x != s && (e3.At - e1.At) <= quickMs)
            {
                bouncesMap[s] = bouncesMap.GetValueOrDefault(s, 0) + 1;

                if (!partnerCounts.TryGetValue(s, out var counts))
                {
                    counts = new Dictionary<string, int>(StringComparer.Ordinal);
                    partnerCounts[s] = counts;
                    partnerFirstSeen[s] = new Dictionary<string, int>(StringComparer.Ordinal);
                }

                var firstSeen = partnerFirstSeen[s];
                counts[x] = counts.GetValueOrDefault(x, 0) + 1;
                firstSeen.TryAdd(x, i);
            }
        }

        var res = new List<NavLog.BounceReport>();
        foreach (var (screen, visits) in visitsMap)
        {
            if (visits < minVisits) continue;

            var bounces = bouncesMap.GetValueOrDefault(screen, 0);
            var ratio = Math.Round(((double)bounces / visits) * 100.0) / 100.0;
            if (ratio < threshold) continue;

            string? partner = null;
            if (partnerCounts.TryGetValue(screen, out var counts) && counts.Count > 0)
            {
                var firstSeen = partnerFirstSeen[screen];
                var maxCount = -1;
                var bestSeen = int.MaxValue;

                foreach (var (p, cnt) in counts)
                {
                    var seenIndex = firstSeen[p];
                    if (cnt > maxCount || (cnt == maxCount && seenIndex < bestSeen))
                    {
                        maxCount = cnt;
                        bestSeen = seenIndex;
                        partner = p;
                    }
                }
            }

            res.Add(new NavLog.BounceReport(screen, visits, bounces, ratio, partner));
        }

        res.Sort((a, b) =>
        {
            if (Math.Abs(b.Ratio - a.Ratio) > 0.0001)
            {
                return b.Ratio.CompareTo(a.Ratio);
            }
            return b.Visits.CompareTo(a.Visits);
        });

        return res;
    }

    public List<NavLog.NavEntry> Export()
    {
        return [.. _entries];
    }

    public void Import(IEnumerable<NavLog.NavEntry>? list)
    {
        if (list is null) return;

        var valid = new List<NavLog.NavEntry>();
        foreach (var item in list)
        {
            if (item is not null &&
                !string.IsNullOrWhiteSpace(item.Screen) &&
                item.Screen.Trim().Length <= 60)
            {
                valid.Add(new NavLog.NavEntry(item.Screen.Trim(), item.At));
            }
        }

        var skip = Math.Max(0, valid.Count - _limit);
        _entries = valid.Skip(skip).ToList();
    }

    public void Clear()
    {
        _entries.Clear();
    }
}
