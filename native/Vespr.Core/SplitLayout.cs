namespace Vespr.Core;

/// <summary>
/// SDE multi-panel split layout, resizable gutter drag, and panel visibility. Port of app/splitlayout.js.
/// </summary>
public static class SplitLayout
{
    public const int MinChatWidth = 280;
    public const double MaxChatPercent = 0.62;
    public const int MinEditorWidth = 360;
    public const int DefaultChatWidth = 330;
    public const int MinSidebarWidth = 180;
    public const int MaxSidebarWidth = 500;
    public const int DefaultSidebarWidth = 240;
    public const int MobileBreakpoint = 860;
    public static readonly string[] ValidLayouts = ["split", "ide", "chat"];

    public record PanelVisibility(
        bool ShowEditor,
        bool ShowChat,
        bool ShowGutter,
        bool ShowSidebar,
        bool ShowTerminal,
        bool ShowMinimap
    );

    public record PanelVisibilityState(
        string? Layout = "split",
        bool SidebarOpen = true,
        bool TerminalOpen = false,
        bool ChatMin = false,
        bool IsCompact = false
    );

    public record LayoutGeometry(
        string Layout,
        int ContainerWidth,
        int ContainerHeight,
        bool IsCompact,
        int SidebarWidth,
        int ChatWidth,
        int EditorWidth,
        PanelVisibility Panels
    );

    public record LayoutManagerOptions(
        string? Layout = "split",
        double? ChatWidth = null,
        double? SidebarWidth = null,
        bool SidebarOpen = true,
        bool TerminalOpen = false,
        bool ChatMin = false
    );

    public static int ClampChatWidth(double? width, double? containerWidth = null)
    {
        var cw = containerWidth is double c && double.IsFinite(c) && c > 0 ? c : 1024.0;
        var maxAllowedByPercent = (int)Math.Floor(cw * MaxChatPercent);
        var maxAllowedByEditor = Math.Max(MinChatWidth, (int)Math.Floor(cw - MinEditorWidth));
        var effectiveMax = Math.Max(MinChatWidth, Math.Min(maxAllowedByPercent, maxAllowedByEditor));

        var target = width is double w && double.IsFinite(w) ? (int)Math.Floor(w) : DefaultChatWidth;
        return Math.Max(MinChatWidth, Math.Min(effectiveMax, target));
    }

    public static int ClampSidebarWidth(double? width, double? containerWidth = null)
    {
        var cw = containerWidth is double c && double.IsFinite(c) && c > 0 ? c : 1024.0;
        var maxAllowed = Math.Min(MaxSidebarWidth, Math.Max(MinSidebarWidth, (int)Math.Floor(cw * 0.4)));
        var target = width is double w && double.IsFinite(w) ? (int)Math.Floor(w) : DefaultSidebarWidth;
        return Math.Max(MinSidebarWidth, Math.Min(maxAllowed, target));
    }

    public static int ComputeGutterDrag(double? startWidth, double? deltaX, double? containerWidth = null, string side = "chat")
    {
        var sw = startWidth is double s && double.IsFinite(s) ? s : DefaultChatWidth;
        var dx = deltaX is double d && double.IsFinite(d) ? d : 0.0;

        if (string.Equals(side, "sidebar", StringComparison.OrdinalIgnoreCase))
        {
            var raw = sw + dx;
            return ClampSidebarWidth(raw, containerWidth);
        }

        var rawChat = sw - dx;
        return ClampChatWidth(rawChat, containerWidth);
    }

    public static bool IsCompact(double? width)
    {
        return width is double w && double.IsFinite(w) && w <= MobileBreakpoint;
    }

    public static PanelVisibility ComputePanelVisibility(PanelVisibilityState? state = null)
    {
        var layout = state?.Layout?.Trim().ToLowerInvariant();
        if (layout != "ide" && layout != "chat" && layout != "split")
        {
            layout = "split";
        }

        var sidebarOpen = state?.SidebarOpen ?? true;
        var terminalOpen = state?.TerminalOpen ?? false;
        var chatMin = state?.ChatMin ?? false;
        var compact = state?.IsCompact ?? false;

        if (layout == "ide")
        {
            return new PanelVisibility(
                ShowEditor: true,
                ShowChat: false,
                ShowGutter: false,
                ShowSidebar: sidebarOpen && !compact,
                ShowTerminal: terminalOpen && !compact,
                ShowMinimap: !compact
            );
        }

        if (layout == "chat")
        {
            return new PanelVisibility(
                ShowEditor: false,
                ShowChat: true,
                ShowGutter: false,
                ShowSidebar: sidebarOpen && !compact,
                ShowTerminal: false,
                ShowMinimap: false
            );
        }

        // 'split'
        var hasGutter = !chatMin && !compact;
        return new PanelVisibility(
            ShowEditor: true,
            ShowChat: !chatMin,
            ShowGutter: hasGutter,
            ShowSidebar: sidebarOpen && !compact,
            ShowTerminal: terminalOpen && !compact,
            ShowMinimap: !compact
        );
    }

    public static LayoutManager CreateLayoutManager(LayoutManagerOptions? initial = null)
    {
        return new LayoutManager(initial);
    }
}

public class LayoutManager
{
    private string _layout;
    private int _chatWidth;
    private int _sidebarWidth;
    private bool _sidebarOpen;
    private bool _terminalOpen;
    private bool _chatMin;

    public LayoutManager(SplitLayout.LayoutManagerOptions? initial = null)
    {
        var cleanLayout = initial?.Layout?.Trim().ToLowerInvariant();
        _layout = cleanLayout == "ide" || cleanLayout == "chat" || cleanLayout == "split" ? cleanLayout : "split";

        _chatWidth = SplitLayout.ClampChatWidth(initial?.ChatWidth);
        _sidebarWidth = SplitLayout.ClampSidebarWidth(initial?.SidebarWidth);
        _sidebarOpen = initial?.SidebarOpen ?? true;
        _terminalOpen = initial?.TerminalOpen ?? false;
        _chatMin = initial?.ChatMin ?? false;
    }

    public string Layout => _layout;
    public int ChatWidth => _chatWidth;
    public int SidebarWidth => _sidebarWidth;
    public bool SidebarOpen => _sidebarOpen;
    public bool TerminalOpen => _terminalOpen;
    public bool ChatMin => _chatMin;

    public bool SetLayout(string? mode)
    {
        if (mode is null) return false;
        var clean = mode.Trim().ToLowerInvariant();
        if (clean != "split" && clean != "ide" && clean != "chat") return false;
        _layout = clean;
        return true;
    }

    public string CycleLayout()
    {
        var idx = Array.IndexOf(SplitLayout.ValidLayouts, _layout);
        var nextIdx = (idx + 1) % SplitLayout.ValidLayouts.Length;
        _layout = SplitLayout.ValidLayouts[nextIdx];
        return _layout;
    }

    public int SetChatWidth(double? width, double? containerWidth = null)
    {
        _chatWidth = SplitLayout.ClampChatWidth(width, containerWidth);
        return _chatWidth;
    }

    public int SetSidebarWidth(double? width, double? containerWidth = null)
    {
        _sidebarWidth = SplitLayout.ClampSidebarWidth(width, containerWidth);
        return _sidebarWidth;
    }

    public bool ToggleSidebar()
    {
        _sidebarOpen = !_sidebarOpen;
        return _sidebarOpen;
    }

    public bool ToggleTerminal()
    {
        _terminalOpen = !_terminalOpen;
        return _terminalOpen;
    }

    public bool ToggleChatMin()
    {
        _chatMin = !_chatMin;
        return _chatMin;
    }

    public SplitLayout.LayoutGeometry Compute(double? containerWidth = null, double? containerHeight = null)
    {
        var cw = containerWidth is double w && double.IsFinite(w) && w > 0 ? (int)Math.Floor(w) : 1024;
        var ch = containerHeight is double h && double.IsFinite(h) && h > 0 ? (int)Math.Floor(h) : 768;

        var compact = SplitLayout.IsCompact(cw);
        var effectiveChatWidth = SplitLayout.ClampChatWidth(_chatWidth, cw);
        var effectiveSidebarWidth = SplitLayout.ClampSidebarWidth(_sidebarWidth, cw);

        var panels = SplitLayout.ComputePanelVisibility(new SplitLayout.PanelVisibilityState(
            Layout: _layout,
            SidebarOpen: _sidebarOpen,
            TerminalOpen: _terminalOpen,
            ChatMin: _chatMin,
            IsCompact: compact
        ));

        var visibleSidebarWidth = panels.ShowSidebar ? effectiveSidebarWidth : 0;
        var mainWidth = Math.Max(0, cw - visibleSidebarWidth);

        var editorWidth = 0;
        var finalChatWidth = 0;

        if (panels.ShowEditor && panels.ShowChat)
        {
            finalChatWidth = effectiveChatWidth;
            editorWidth = Math.Max(0, mainWidth - finalChatWidth);
        }
        else if (panels.ShowEditor)
        {
            editorWidth = mainWidth;
        }
        else if (panels.ShowChat)
        {
            finalChatWidth = mainWidth;
        }

        return new SplitLayout.LayoutGeometry(
            Layout: _layout,
            ContainerWidth: cw,
            ContainerHeight: ch,
            IsCompact: compact,
            SidebarWidth: effectiveSidebarWidth,
            ChatWidth: finalChatWidth,
            EditorWidth: editorWidth,
            Panels: panels
        );
    }
}
