namespace Vespr.Core;

/// <summary>
/// Context menu data model, presets, keyboard navigation, and viewport positioning. Port of app/contextmenu.js.
/// </summary>
public static class ContextMenu
{
    public const int MaxMenuItems = 50;
    public const int MaxLabelLen = 100;
    public const int MaxIdLen = 60;
    public const double DefaultMargin = 8;

    public record MenuItem(
        string? Id = null,
        string? Label = null,
        string Icon = "",
        string Shortcut = "",
        bool Disabled = false,
        bool Danger = false,
        Func<object?>? Action = null,
        string? ActionId = null,
        bool Separator = false,
        List<MenuItem>? Children = null
    );

    public record PopupPosition(
        int X,
        int Y,
        string Placement
    );

    public record NavigationResult(
        int Index,
        MenuItem Item
    );

    public record KeyResult(
        string Action,
        int? Index = null,
        MenuItem? Item = null
    );

    public record FileMenuOptions(
        bool IsDir = false,
        bool CanPaste = false
    );

    public record TabMenuOptions(
        bool IsPinned = false,
        int TabCount = 1,
        int Index = 0
    );

    public record EditorMenuOptions(
        bool HasSelection = false,
        bool ReadOnly = false
    );

    public record PositionTarget(
        double X = 0,
        double Y = 0,
        double Width = 0,
        double Height = 0
    );

    public record PopupSize(
        double Width = 160,
        double Height = 200
    );

    public record ViewportSize(
        double Width = 1024,
        double Height = 768
    );

    public static MenuItem? NormalizeMenuItem(MenuItem? raw)
    {
        if (raw is null) return null;
        if (raw.Separator) return new MenuItem(Separator: true);

        var id = (raw.Id ?? "").Trim();
        if (id.Length > MaxIdLen) id = id[..MaxIdLen];

        var label = (raw.Label ?? "").Trim();
        if (label.Length > MaxLabelLen) label = label[..MaxLabelLen];

        if (id.Length == 0 && label.Length == 0) return null;

        var finalId = id.Length > 0 ? id : label.ToLowerInvariant().Replace(' ', '-');
        var finalLabel = label.Length > 0 ? label : id;

        var icon = (raw.Icon ?? "").Trim();
        if (icon.Length > 30) icon = icon[..30];

        var shortcut = (raw.Shortcut ?? "").Trim();
        if (shortcut.Length > 30) shortcut = shortcut[..30];

        List<MenuItem>? validChildren = null;
        if (raw.Children is not null && raw.Children.Count > 0)
        {
            validChildren = new List<MenuItem>();
            foreach (var child in raw.Children)
            {
                var norm = NormalizeMenuItem(child);
                if (norm is not null) validChildren.Add(norm);
            }
            if (validChildren.Count == 0)
            {
                validChildren = null;
            }
            else if (validChildren.Count > MaxMenuItems)
            {
                validChildren = validChildren.Take(MaxMenuItems).ToList();
            }
        }

        return new MenuItem(
            Id: finalId,
            Label: finalLabel,
            Icon: icon,
            Shortcut: shortcut,
            Disabled: raw.Disabled,
            Danger: raw.Danger,
            Action: raw.Action,
            ActionId: raw.ActionId,
            Separator: false,
            Children: validChildren
        );
    }

    public static List<MenuItem> CreateFileMenu(FileMenuOptions? options = null)
    {
        var isDir = options?.IsDir == true;
        var canPaste = options?.CanPaste == true;

        var items = new List<MenuItem>();
        if (isDir)
        {
            items.Add(new MenuItem(Id: "new-file", Label: "New File", Icon: "file"));
            items.Add(new MenuItem(Id: "new-folder", Label: "New Folder", Icon: "folder"));
            items.Add(new MenuItem(Separator: true));
        }

        items.Add(new MenuItem(Id: "cut", Label: "Cut", Shortcut: "Mod+X"));
        items.Add(new MenuItem(Id: "copy", Label: "Copy", Shortcut: "Mod+C"));

        if (isDir)
        {
            items.Add(new MenuItem(Id: "paste", Label: "Paste", Shortcut: "Mod+V", Disabled: !canPaste));
        }

        items.Add(new MenuItem(Separator: true));
        items.Add(new MenuItem(Id: "copy-path", Label: "Copy Path"));
        items.Add(new MenuItem(Id: "copy-relative-path", Label: "Copy Relative Path"));
        items.Add(new MenuItem(Separator: true));
        items.Add(new MenuItem(Id: "rename", Label: "Rename", Shortcut: "F2"));
        items.Add(new MenuItem(Id: "delete", Label: "Delete", Shortcut: "Delete", Danger: true));

        return items.Select(NormalizeMenuItem).Where(it => it is not null).Cast<MenuItem>().ToList();
    }

    public static List<MenuItem> CreateTabMenu(TabMenuOptions? options = null)
    {
        var isPinned = options?.IsPinned == true;
        var tabCount = options?.TabCount is int tc && tc > 0 ? tc : 1;
        var index = options?.Index is int idx && idx >= 0 ? idx : 0;

        var hasMultiple = tabCount > 1;
        var hasTabsToRight = index < tabCount - 1;

        var items = new List<MenuItem>
        {
            new(Id: "close", Label: "Close", Shortcut: "Mod+W"),
            new(Id: "close-others", Label: "Close Others", Disabled: !hasMultiple),
            new(Id: "close-right", Label: "Close to the Right", Disabled: !hasTabsToRight),
            new(Id: "close-saved", Label: "Close Saved", Disabled: !hasMultiple),
            new(Separator: true),
            new(Id: "pin", Label: isPinned ? "Unpin Tab" : "Pin Tab"),
            new(Separator: true),
            new(Id: "copy-path", Label: "Copy Path")
        };

        return items.Select(NormalizeMenuItem).Where(it => it is not null).Cast<MenuItem>().ToList();
    }

    public static List<MenuItem> CreateEditorMenu(EditorMenuOptions? options = null)
    {
        var hasSelection = options?.HasSelection == true;
        var readOnly = options?.ReadOnly == true;

        var items = new List<MenuItem>
        {
            new(Id: "cut", Label: "Cut", Shortcut: "Mod+X", Disabled: readOnly || !hasSelection),
            new(Id: "copy", Label: "Copy", Shortcut: "Mod+C", Disabled: !hasSelection),
            new(Id: "paste", Label: "Paste", Shortcut: "Mod+V", Disabled: readOnly),
            new(Separator: true),
            new(Id: "select-all", Label: "Select All", Shortcut: "Mod+A"),
            new(Id: "format-document", Label: "Format Document", Shortcut: "Shift+Alt+F", Disabled: readOnly)
        };

        return items.Select(NormalizeMenuItem).Where(it => it is not null).Cast<MenuItem>().ToList();
    }

    public static NavigationResult? NavigateMenu(IReadOnlyList<MenuItem>? items, int currentIndex, string? key)
    {
        if (items is null || items.Count == 0 || string.IsNullOrEmpty(key)) return null;

        var selectableIndices = new List<int>();
        for (var i = 0; i < items.Count; i++)
        {
            var item = items[i];
            if (item is not null && !item.Separator && !item.Disabled)
            {
                selectableIndices.Add(i);
            }
        }

        if (selectableIndices.Count == 0) return null;

        if (key == "Home")
        {
            var idx = selectableIndices[0];
            return new NavigationResult(idx, items[idx]);
        }

        if (key == "End")
        {
            var idx = selectableIndices[^1];
            return new NavigationResult(idx, items[idx]);
        }

        var curPos = selectableIndices.IndexOf(currentIndex);

        if (key == "ArrowDown")
        {
            var nextPos = curPos == -1 || curPos >= selectableIndices.Count - 1 ? 0 : curPos + 1;
            var idx = selectableIndices[nextPos];
            return new NavigationResult(idx, items[idx]);
        }

        if (key == "ArrowUp")
        {
            var prevPos = curPos <= 0 ? selectableIndices.Count - 1 : curPos - 1;
            var idx = selectableIndices[prevPos];
            return new NavigationResult(idx, items[idx]);
        }

        return null;
    }

    public static PopupPosition ComputePopupPosition(
        PositionTarget? target = null,
        PopupSize? popup = null,
        ViewportSize? viewport = null,
        double margin = DefaultMargin)
    {
        var tx = target is not null && double.IsFinite(target.X) ? target.X : 0;
        var ty = target is not null && double.IsFinite(target.Y) ? target.Y : 0;
        var tw = target is not null && double.IsFinite(target.Width) && target.Width > 0 ? target.Width : 0;
        var th = target is not null && double.IsFinite(target.Height) && target.Height > 0 ? target.Height : 0;

        var pw = popup is not null && double.IsFinite(popup.Width) && popup.Width > 0 ? popup.Width : 160;
        var ph = popup is not null && double.IsFinite(popup.Height) && popup.Height > 0 ? popup.Height : 200;

        var vw = viewport is not null && double.IsFinite(viewport.Width) && viewport.Width > 0 ? viewport.Width : 1024;
        var vh = viewport is not null && double.IsFinite(viewport.Height) && viewport.Height > 0 ? viewport.Height : 768;

        var x = tx;
        var y = ty + th;
        var placement = "bottom-start";

        // Flip upward if overflowing bottom and space available above
        if (y + ph > vh - margin && ty - ph >= margin)
        {
            y = ty - ph;
            placement = "top-start";
        }

        // Constrain X coordinate inside viewport boundaries
        if (x + pw > vw - margin)
        {
            x = Math.Max(margin, vw - pw - margin);
        }
        if (x < margin)
        {
            x = margin;
        }

        // Final safety clamp for Y coordinate
        if (y + ph > vh - margin)
        {
            y = Math.Max(margin, vh - ph - margin);
        }
        if (y < margin)
        {
            y = margin;
        }

        return new PopupPosition((int)Math.Round(x), (int)Math.Round(y), placement);
    }

    public static MenuManager CreateMenu()
    {
        return new MenuManager();
    }
}

public class MenuManager
{
    private bool _open;
    private double _x;
    private double _y;
    private List<ContextMenu.MenuItem> _items = [];
    private int _selectedIndex = -1;

    public bool IsOpen => _open;
    public double X => _x;
    public double Y => _y;
    public List<ContextMenu.MenuItem> Items => [.. _items];
    public int SelectedIndex => _selectedIndex;

    public bool Show(IEnumerable<ContextMenu.MenuItem>? rawItems, double x = 0, double y = 0)
    {
        if (rawItems is null) return false;

        var normalized = new List<ContextMenu.MenuItem>();
        foreach (var raw in rawItems)
        {
            var norm = ContextMenu.NormalizeMenuItem(raw);
            if (norm is not null) normalized.Add(norm);
        }

        _items = normalized.Take(ContextMenu.MaxMenuItems).ToList();
        _x = double.IsFinite(x) ? x : 0;
        _y = double.IsFinite(y) ? y : 0;
        _open = true;
        _selectedIndex = -1;
        return true;
    }

    public void Close()
    {
        _open = false;
        _items.Clear();
        _selectedIndex = -1;
    }

    public ContextMenu.KeyResult? HandleKey(string? key)
    {
        if (!_open || string.IsNullOrEmpty(key)) return null;

        if (key == "Escape")
        {
            Close();
            return new ContextMenu.KeyResult("close");
        }

        if (key == "Enter")
        {
            if (_selectedIndex >= 0 && _selectedIndex < _items.Count)
            {
                var selected = _items[_selectedIndex];
                if (!selected.Disabled && !selected.Separator)
                {
                    Close();
                    return new ContextMenu.KeyResult("execute", Item: selected);
                }
            }
            return null;
        }

        var nav = ContextMenu.NavigateMenu(_items, _selectedIndex, key);
        if (nav is not null)
        {
            _selectedIndex = nav.Index;
            return new ContextMenu.KeyResult("select", Index: nav.Index, Item: nav.Item);
        }

        return null;
    }
}
