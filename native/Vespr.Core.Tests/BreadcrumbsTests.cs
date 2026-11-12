namespace Vespr.Core.Tests;

public class BreadcrumbsTests
{
    [Fact]
    public void Constants_exist_and_have_expected_bounds()
    {
        Assert.Equal(300, Breadcrumbs.MaxPath);
        Assert.Equal(10, Breadcrumbs.MaxSegments);
        Assert.Equal(3, Breadcrumbs.MinSegments);
        Assert.Equal(80, Breadcrumbs.MaxLabel);
    }

    [Fact]
    public void Format_parses_single_file_into_leaf_breadcrumb()
    {
        var crumbs = Breadcrumbs.Format("cart.py");
        Assert.Single(crumbs);
        Assert.Equal(new Breadcrumbs.BreadcrumbItem(
            "cart.py",
            "cart.py",
            true,
            false,
            false,
            false,
            "file"
        ), crumbs[0]);
    }

    [Fact]
    public void Format_parses_nested_path_with_folder_icons_and_accumulated_paths()
    {
        var crumbs = Breadcrumbs.Format("src/components/Button.tsx");
        Assert.Equal(3, crumbs.Count);

        Assert.Equal("src", crumbs[0].Label);
        Assert.Equal("src", crumbs[0].Path);
        Assert.Equal("folder", crumbs[0].Icon);
        Assert.False(crumbs[0].IsLeaf);

        Assert.Equal("components", crumbs[1].Label);
        Assert.Equal("src/components", crumbs[1].Path);
        Assert.Equal("folder", crumbs[1].Icon);
        Assert.False(crumbs[1].IsLeaf);

        Assert.Equal("Button.tsx", crumbs[2].Label);
        Assert.Equal("src/components/Button.tsx", crumbs[2].Path);
        Assert.Equal("file", crumbs[2].Icon);
        Assert.True(crumbs[2].IsLeaf);
    }

    [Fact]
    public void Format_includes_root_and_symbol_when_provided()
    {
        var crumbs = Breadcrumbs.Format("app/editor.js", new Breadcrumbs.BreadcrumbOptions(
            Root: "vespr",
            Symbol: "mount()"
        ));
        Assert.Equal(4, crumbs.Count);

        Assert.Equal("vespr", crumbs[0].Label);
        Assert.True(crumbs[0].IsRoot);
        Assert.False(crumbs[0].IsLeaf);
        Assert.Equal("workspace", crumbs[0].Icon);

        Assert.Equal("app", crumbs[1].Label);
        Assert.Equal("folder", crumbs[1].Icon);

        Assert.Equal("editor.js", crumbs[2].Label);
        Assert.Equal("file", crumbs[2].Icon);
        Assert.False(crumbs[2].IsLeaf);

        Assert.Equal("mount()", crumbs[3].Label);
        Assert.True(crumbs[3].IsSymbol);
        Assert.True(crumbs[3].IsLeaf);
        Assert.Equal("symbol", crumbs[3].Icon);
    }

    [Fact]
    public void Compacts_deep_paths_with_an_ellipsis_segment_when_exceeding_maxSegments()
    {
        var path = "a/b/c/d/e/f/g/h/target.py";
        var crumbs = Breadcrumbs.Format(path, new Breadcrumbs.BreadcrumbOptions(MaxSegments: 5));
        Assert.Equal(5, crumbs.Count);

        Assert.Equal("a", crumbs[0].Label);
        Assert.Equal("b", crumbs[1].Label);

        Assert.Equal("…", crumbs[2].Label);
        Assert.True(crumbs[2].IsEllipsis);
        Assert.Equal("more", crumbs[2].Icon);
        Assert.False(crumbs[2].IsLeaf);

        Assert.Equal("h", crumbs[3].Label);
        Assert.Equal("target.py", crumbs[4].Label);
        Assert.True(crumbs[4].IsLeaf);
    }

    [Fact]
    public void Path_normalization_handles_slashes_backslashes_and_redundant_separators()
    {
        var crumbs = Breadcrumbs.Format(@"///deep\\\\nested\dir///file.py///");
        Assert.Equal(4, crumbs.Count);
        Assert.Equal("deep", crumbs[0].Label);
        Assert.Equal("nested", crumbs[1].Label);
        Assert.Equal("dir", crumbs[2].Label);
        Assert.Equal("file.py", crumbs[3].Label);
        Assert.Equal("deep/nested/dir/file.py", crumbs[3].Path);
    }

    [Fact]
    public void Dot_dot_segments_resolve_safely_without_escaping_root()
    {
        var crumbs = Breadcrumbs.Format("../../../src/../lib/utils.js");
        Assert.Equal(2, crumbs.Count);
        Assert.Equal("lib", crumbs[0].Label);
        Assert.Equal("utils.js", crumbs[1].Label);
        Assert.Equal("lib/utils.js", crumbs[1].Path);
    }

    [Fact]
    public void Hostile_input_immunity_for_format()
    {
        Assert.Empty(Breadcrumbs.Format(null));
        Assert.Empty(Breadcrumbs.Format(""));

        var withRootOnly = Breadcrumbs.Format(null, new Breadcrumbs.BreadcrumbOptions(Root: "my-project"));
        Assert.Single(withRootOnly);
        Assert.Equal("my-project", withRootOnly[0].Label);
        Assert.True(withRootOnly[0].IsLeaf);

        var withNullByte = Breadcrumbs.Format("src/\0hidden/file.js");
        Assert.Equal("hidden", withNullByte[1].Label);
    }

    [Fact]
    public void ParentOf_extracts_directory_path_or_empty_string()
    {
        Assert.Equal("src/components", Breadcrumbs.ParentOf("src/components/Button.tsx"));
        Assert.Equal("src", Breadcrumbs.ParentOf("src/main.rs"));
        Assert.Equal("", Breadcrumbs.ParentOf("cart.py"));
        Assert.Equal("", Breadcrumbs.ParentOf(""));
        Assert.Equal("", Breadcrumbs.ParentOf(null));
        Assert.Equal("a/b", Breadcrumbs.ParentOf("/a/b/c/"));
    }

    [Fact]
    public void RenderText_joins_breadcrumb_labels_with_custom_separator()
    {
        var crumbs = Breadcrumbs.Format("src/models/user.py", new Breadcrumbs.BreadcrumbOptions(
            Root: "shop",
            Symbol: "User.save()"
        ));
        var text = Breadcrumbs.RenderText(crumbs);
        Assert.Equal("shop > src > models > user.py > User.save()", text);

        var slashText = Breadcrumbs.RenderText(crumbs, " / ");
        Assert.Equal("shop / src / models / user.py / User.save()", slashText);

        Assert.Equal("", Breadcrumbs.RenderText(null));
        Assert.Equal("", Breadcrumbs.RenderText([]));
    }

    [Fact]
    public void Label_length_clamping_respects_MAX_LABEL()
    {
        var hugeSegment = new string('a', 200);
        var crumbs = Breadcrumbs.Format(hugeSegment + "/test.py");
        Assert.Equal(Breadcrumbs.MaxLabel, crumbs[0].Label.Length);
        Assert.Equal("test.py", crumbs[1].Label);
    }
}
