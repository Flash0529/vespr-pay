namespace Vespr.Core;

/// <summary>
/// Status bar state, item registry, and formatting for the SDE shell. Port of app/statusbar.js.
/// </summary>
public static class StatusBar
{
    public const int MaxStatusItems = 50;
    public const int MaxIdLen = 60;
    public const int MaxTextLen = 120;
    public const int MaxTooltipLen = 200;
    public const int MaxMessageLen = 250;
    public const int DefaultMessageTimeout = 5000;

    public record StatusItem(
        string Id,
        string Text = "",
        string Tooltip = "",
        string Icon = "",
        string Command = "",
        string Side = "left",
        int Priority = 0,
        bool Visible = true,
        string ClassName = ""
    );

    public record StatusBarList(
        List<StatusItem> Left,
        List<StatusItem> Right
    );

    public static string FormatCursor(int? line, int? col, int? selectionLength = null)
    {
        var l = line is int ln && ln >= 1 ? ln : 1;
        var c = col is int cl && cl >= 1 ? cl : 1;
        var sel = selectionLength is int s && s > 0 ? s : 0;

        if (sel > 0)
        {
            return $"Ln {l}, Col {c} ({sel} selected)";
        }
        return $"Ln {l}, Col {c}";
    }

    public static string FormatProblems(int? errors = null, int? warnings = null)
    {
        var errCount = errors is int e && e > 0 ? e : 0;
        var warnCount = warnings is int w && w > 0 ? w : 0;

        if (errCount == 0 && warnCount == 0)
        {
            return "0 Problems";
        }

        var parts = new List<string>();
        if (errCount > 0)
        {
            parts.Add($"✕ {errCount}");
        }
        if (warnCount > 0)
        {
            parts.Add($"⚠ {warnCount}");
        }

        return string.Join("  ", parts);
    }

    public static string FormatGit(string? branch, int ahead = 0, int behind = 0, bool detached = false)
    {
        var rawBranch = branch?.Trim() ?? "";
        if (rawBranch.Length > 60) rawBranch = rawBranch[..60];
        if (rawBranch.Length == 0) return "";

        if (detached)
        {
            return "HEAD detached at " + rawBranch;
        }

        var ah = Math.Max(0, ahead);
        var bh = Math.Max(0, behind);

        var indicators = "";
        if (bh > 0) indicators += bh + "↓ ";
        if (ah > 0) indicators += ah + "↑";
        indicators = indicators.Trim();

        return indicators.Length > 0 ? $"{rawBranch} {indicators}" : rawBranch;
    }

    public static string FormatIndent(string? type = "spaces", int size = 2)
    {
        var isTabs = (type ?? "").Trim().ToLowerInvariant().StartsWith("tab", StringComparison.Ordinal);
        var s = size > 0 ? size : (isTabs ? 4 : 2);
        return isTabs ? $"Tabs: {s}" : $"Spaces: {s}";
    }

    public static string FormatEncoding(string? encoding = "utf-8", string? eol = "\n")
    {
        var enc = !string.IsNullOrWhiteSpace(encoding) ? encoding.Trim().ToUpperInvariant() : "UTF-8";
        if (enc.Length > 20) enc = enc[..20];
        var isCrlf = eol == "\r\n" || (eol is not null && eol.ToLowerInvariant().Contains("crlf", StringComparison.Ordinal));
        return enc + "  " + (isCrlf ? "CRLF" : "LF");
    }

    public static StatusItem? SanitizeItem(string? id, StatusItem? raw)
    {
        if (raw is null || string.IsNullOrWhiteSpace(id)) return null;

        var cleanId = id.Trim();
        if (cleanId.Length > MaxIdLen) cleanId = cleanId[..MaxIdLen];
        if (cleanId.Length == 0 || cleanId == "__proto__" || cleanId == "constructor") return null;

        var text = (raw.Text ?? "").Trim();
        if (text.Length > MaxTextLen) text = text[..MaxTextLen];

        var tooltip = (raw.Tooltip ?? "").Trim();
        if (tooltip.Length > MaxTooltipLen) tooltip = tooltip[..MaxTooltipLen];

        var icon = (raw.Icon ?? "").Trim();
        if (icon.Length > 30) icon = icon[..30];

        var command = (raw.Command ?? "").Trim();
        if (command.Length > 60) command = command[..60];

        var side = string.Equals(raw.Side, "right", StringComparison.OrdinalIgnoreCase) ? "right" : "left";

        var className = (raw.ClassName ?? "").Trim();
        if (className.Length > 50) className = className[..50];

        return new StatusItem(
            Id: cleanId,
            Text: text,
            Tooltip: tooltip,
            Icon: icon,
            Command: command,
            Side: side,
            Priority: raw.Priority,
            Visible: raw.Visible,
            ClassName: className
        );
    }

    public static StatusBarManager CreateStatusBar()
    {
        return new StatusBarManager();
    }
}

public class StatusBarManager
{
    private readonly Dictionary<string, StatusBar.StatusItem> _items = new(StringComparer.Ordinal);
    private (string Text, long ExpiresAt)? _ephemeralMessage;

    public int Size => _items.Count;

    public bool Set(string? id, StatusBar.StatusItem? rawItem)
    {
        var clean = StatusBar.SanitizeItem(id, rawItem);
        if (clean is null) return false;

        if (_items.Count >= StatusBar.MaxStatusItems && !_items.ContainsKey(clean.Id))
        {
            return false;
        }

        _items[clean.Id] = clean;
        return true;
    }

    public StatusBar.StatusItem? Get(string? id)
    {
        if (string.IsNullOrWhiteSpace(id)) return null;
        return _items.GetValueOrDefault(id.Trim());
    }

    public bool Has(string? id)
    {
        if (string.IsNullOrWhiteSpace(id)) return false;
        return _items.ContainsKey(id.Trim());
    }

    public bool Remove(string? id)
    {
        if (string.IsNullOrWhiteSpace(id)) return false;
        return _items.Remove(id.Trim());
    }

    public bool Show(string? id)
    {
        if (string.IsNullOrWhiteSpace(id)) return false;
        var key = id.Trim();
        if (!_items.TryGetValue(key, out var item)) return false;
        _items[key] = item with { Visible = true };
        return true;
    }

    public bool Hide(string? id)
    {
        if (string.IsNullOrWhiteSpace(id)) return false;
        var key = id.Trim();
        if (!_items.TryGetValue(key, out var item)) return false;
        _items[key] = item with { Visible = false };
        return true;
    }

    public List<StatusBar.StatusItem> List(string side)
    {
        var full = List();
        return string.Equals(side, "right", StringComparison.OrdinalIgnoreCase) ? full.Right : full.Left;
    }

    public StatusBar.StatusBarList List()
    {
        var left = new List<StatusBar.StatusItem>();
        var right = new List<StatusBar.StatusItem>();

        foreach (var item in _items.Values)
        {
            if (!item.Visible) continue;
            if (item.Side == "right")
            {
                right.Add(item);
            }
            else
            {
                left.Add(item);
            }
        }

        int Sorter(StatusBar.StatusItem a, StatusBar.StatusItem b)
        {
            if (b.Priority != a.Priority) return b.Priority.CompareTo(a.Priority);
            return string.Compare(a.Id, b.Id, StringComparison.Ordinal);
        }

        left.Sort(Sorter);
        right.Sort(Sorter);

        return new StatusBar.StatusBarList(left, right);
    }

    public bool SetMessage(string? text, int timeout = StatusBar.DefaultMessageTimeout, Func<long>? now = null)
    {
        if (string.IsNullOrWhiteSpace(text))
        {
            _ephemeralMessage = null;
            return false;
        }

        var cleanText = text.Trim();
        if (cleanText.Length > StatusBar.MaxMessageLen) cleanText = cleanText[..StatusBar.MaxMessageLen];

        var validTimeout = timeout > 0 ? timeout : StatusBar.DefaultMessageTimeout;
        var currentTime = now is not null ? now() : DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

        _ephemeralMessage = (cleanText, currentTime + validTimeout);
        return true;
    }

    public string? GetMessage(Func<long>? now = null)
    {
        if (_ephemeralMessage is null) return null;

        var currentTime = now is not null ? now() : DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        if (currentTime >= _ephemeralMessage.Value.ExpiresAt)
        {
            _ephemeralMessage = null;
            return null;
        }

        return _ephemeralMessage.Value.Text;
    }

    public void ClearMessage()
    {
        _ephemeralMessage = null;
    }

    public void Clear()
    {
        _items.Clear();
        _ephemeralMessage = null;
    }
}
