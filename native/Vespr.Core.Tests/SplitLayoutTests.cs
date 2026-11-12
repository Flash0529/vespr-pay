namespace Vespr.Core.Tests;

using Vespr.Core;
using Xunit;

public class SplitLayoutTests
{
    [Fact]
    public void Constants_ExistAndHaveExpectedBounds()
    {
        Assert.Equal(280, SplitLayout.MinChatWidth);
        Assert.Equal(0.62, SplitLayout.MaxChatPercent);
        Assert.Equal(360, SplitLayout.MinEditorWidth);
        Assert.Equal(330, SplitLayout.DefaultChatWidth);
        Assert.Equal(180, SplitLayout.MinSidebarWidth);
        Assert.Equal(500, SplitLayout.MaxSidebarWidth);
        Assert.Equal(240, SplitLayout.DefaultSidebarWidth);
        Assert.Equal(860, SplitLayout.MobileBreakpoint);
        Assert.Equal(["split", "ide", "chat"], SplitLayout.ValidLayouts);
    }

    [Fact]
    public void ClampChatWidth_ClampsChatWidthWithinSafeBounds()
    {
        // Normal 1200px container: 62% is 744px; cw - 360 is 840px. Effective max: 744px.
        Assert.Equal(400, SplitLayout.ClampChatWidth(400, 1200));
        Assert.Equal(280, SplitLayout.ClampChatWidth(100, 1200)); // Clamped to min 280
        Assert.Equal(744, SplitLayout.ClampChatWidth(900, 1200)); // Clamped to 62% (744)

        // Narrow 700px container: cw - 360 is 340px; 62% is 434px. Effective max: 340px.
        Assert.Equal(340, SplitLayout.ClampChatWidth(500, 700));

        // Default fallback for invalid inputs
        Assert.Equal(SplitLayout.DefaultChatWidth, SplitLayout.ClampChatWidth(null, null));
    }

    [Fact]
    public void ClampSidebarWidth_ClampsSidebarWidthWithinMinAndMaxBounds()
    {
        Assert.Equal(250, SplitLayout.ClampSidebarWidth(250, 1200));
        Assert.Equal(180, SplitLayout.ClampSidebarWidth(100, 1200));
        Assert.Equal(480, SplitLayout.ClampSidebarWidth(800, 1200)); // 40% of 1200
        Assert.Equal(SplitLayout.DefaultSidebarWidth, SplitLayout.ClampSidebarWidth(null, null));
    }

    [Fact]
    public void ComputeGutterDrag_ForChat_ComputesWidthAdjustmentFromDelta()
    {
        // Dragging left (negative delta) expands chat panel
        var expanded = SplitLayout.ComputeGutterDrag(330, -50, 1200, "chat");
        Assert.Equal(380, expanded);

        // Dragging right (positive delta) contracts chat panel
        var contracted = SplitLayout.ComputeGutterDrag(330, 50, 1200, "chat");
        Assert.Equal(280, contracted);

        // Dragging past limits is clamped
        var maxClamped = SplitLayout.ComputeGutterDrag(330, -600, 1200, "chat");
        Assert.Equal(744, maxClamped); // 62% of 1200
    }

    [Fact]
    public void ComputeGutterDrag_ForSidebar_ComputesWidthAdjustmentFromDelta()
    {
        // Dragging right (positive delta) expands left sidebar
        var expanded = SplitLayout.ComputeGutterDrag(240, 60, 1200, "sidebar");
        Assert.Equal(300, expanded);

        // Dragging left (negative delta) contracts left sidebar
        var contracted = SplitLayout.ComputeGutterDrag(240, -100, 1200, "sidebar");
        Assert.Equal(180, contracted);
    }

    [Fact]
    public void IsCompact_IdentifiesCompactMobileBreakpoints()
    {
        Assert.True(SplitLayout.IsCompact(860));
        Assert.True(SplitLayout.IsCompact(720));
        Assert.False(SplitLayout.IsCompact(861));
        Assert.False(SplitLayout.IsCompact(1200));
        Assert.False(SplitLayout.IsCompact(null));
    }

    [Fact]
    public void ComputePanelVisibility_InIdeMode()
    {
        var v = SplitLayout.ComputePanelVisibility(new SplitLayout.PanelVisibilityState(
            Layout: "ide",
            SidebarOpen: true,
            TerminalOpen: true
        ));
        Assert.True(v.ShowEditor);
        Assert.False(v.ShowChat);
        Assert.False(v.ShowGutter);
        Assert.True(v.ShowSidebar);
        Assert.True(v.ShowTerminal);
        Assert.True(v.ShowMinimap);
    }

    [Fact]
    public void ComputePanelVisibility_InChatMode()
    {
        var v = SplitLayout.ComputePanelVisibility(new SplitLayout.PanelVisibilityState(
            Layout: "chat",
            SidebarOpen: true,
            TerminalOpen: true
        ));
        Assert.False(v.ShowEditor);
        Assert.True(v.ShowChat);
        Assert.False(v.ShowGutter);
        Assert.True(v.ShowSidebar);
        Assert.False(v.ShowTerminal); // Terminal hidden in chat-only
        Assert.False(v.ShowMinimap);
    }

    [Fact]
    public void ComputePanelVisibility_InSplitModeAndChatMin()
    {
        var vNormal = SplitLayout.ComputePanelVisibility(new SplitLayout.PanelVisibilityState(
            Layout: "split",
            SidebarOpen: true,
            ChatMin: false
        ));
        Assert.True(vNormal.ShowEditor);
        Assert.True(vNormal.ShowChat);
        Assert.True(vNormal.ShowGutter);

        var vMin = SplitLayout.ComputePanelVisibility(new SplitLayout.PanelVisibilityState(
            Layout: "split",
            ChatMin: true
        ));
        Assert.True(vMin.ShowEditor);
        Assert.False(vMin.ShowChat);
        Assert.False(vMin.ShowGutter);
    }

    [Fact]
    public void ComputePanelVisibility_InCompactMode_HidesSecondaryPanels()
    {
        var v = SplitLayout.ComputePanelVisibility(new SplitLayout.PanelVisibilityState(
            Layout: "split",
            SidebarOpen: true,
            TerminalOpen: true,
            IsCompact: true
        ));
        Assert.False(v.ShowSidebar);
        Assert.False(v.ShowTerminal);
        Assert.False(v.ShowMinimap);
        Assert.False(v.ShowGutter);
    }

    [Fact]
    public void CreateLayoutManager_StateAndCompute()
    {
        var mgr = SplitLayout.CreateLayoutManager(new SplitLayout.LayoutManagerOptions(Layout: "split", ChatWidth: 350));
        Assert.Equal("split", mgr.Layout);
        Assert.Equal(350, mgr.ChatWidth);

        // Layout mode cycling
        Assert.Equal("ide", mgr.CycleLayout());
        Assert.Equal("chat", mgr.CycleLayout());
        Assert.Equal("split", mgr.CycleLayout());

        // Explicit set
        Assert.True(mgr.SetLayout("ide"));
        Assert.False(mgr.SetLayout("invalid"));
        Assert.Equal("ide", mgr.Layout);

        // Toggles
        Assert.True(mgr.ToggleTerminal());
        Assert.False(mgr.ToggleTerminal());

        // Compute geometry
        mgr.SetLayout("split");
        var geo = mgr.Compute(1200, 800);
        Assert.Equal("split", geo.Layout);
        Assert.Equal(1200, geo.ContainerWidth);
        Assert.Equal(800, geo.ContainerHeight);
        Assert.False(geo.IsCompact);
        Assert.Equal(SplitLayout.DefaultSidebarWidth, geo.SidebarWidth);
        Assert.Equal(350, geo.ChatWidth);
        // editorWidth = 1200 - 240 (sidebar) - 350 (chat) = 610
        Assert.Equal(610, geo.EditorWidth);
    }

    [Fact]
    public void HostileInputImmunity_HandlesBadTypesAndNonFiniteValuesGracefully()
    {
        var mgr = SplitLayout.CreateLayoutManager();
        Assert.False(mgr.SetLayout(null));

        Assert.Equal(SplitLayout.DefaultChatWidth, SplitLayout.ClampChatWidth(double.NaN, double.NaN));
        Assert.Equal(SplitLayout.DefaultSidebarWidth, SplitLayout.ClampSidebarWidth(double.PositiveInfinity, -50));

        var geo = mgr.Compute(double.NaN, null);
        Assert.True(double.IsFinite(geo.ContainerWidth));
        Assert.True(double.IsFinite(geo.ContainerHeight));
        Assert.True(double.IsFinite(geo.EditorWidth));
    }
}
