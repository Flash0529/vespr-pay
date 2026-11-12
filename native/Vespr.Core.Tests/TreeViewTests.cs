namespace Vespr.Core.Tests;

using Vespr.Core;
using Xunit;

public class TreeViewTests
{
    [Fact]
    public void Constants_ExistAndHaveExpectedBounds()
    {
        Assert.Equal(5000, TreeView.MaxPaths);
        Assert.Equal(300, TreeView.MaxPathLen);
        Assert.Equal(30, TreeView.MaxDepth);
        Assert.Equal(2000, TreeView.MaxRows);
    }

    [Fact]
    public void NaturalCompare_PerformsNaturalCaseInsensitiveNumericSorting()
    {
        Assert.True(TreeView.NaturalCompare("file2.txt", "file10.txt") < 0);
        Assert.True(TreeView.NaturalCompare("file10.txt", "file2.txt") > 0);
        Assert.Equal(0, TreeView.NaturalCompare("file.txt", "FILE.txt"));
        Assert.Equal(0, TreeView.NaturalCompare(null, ""));
    }

    [Fact]
    public void BuildTree_BuildsHierarchicalTreeFromFlatPaths()
    {
        var paths = new[]
        {
            "README.md",
            "src/index.js",
            "src/utils.js"
        };
        var tree = TreeView.BuildTree(paths);
        Assert.Equal(2, tree.Count);

        // src directory is first (folders first)
        var src = tree[0];
        Assert.Equal("src", src.N);
        Assert.Equal("src", src.Full);
        Assert.Equal(1, src.Dir);
        Assert.Equal(2, src.Count);
        Assert.NotNull(src.Kids);
        Assert.Equal(2, src.Kids.Count);

        // README.md file is second
        var readme = tree[1];
        Assert.Equal("README.md", readme.N);
        Assert.Equal("README.md", readme.Full);
        Assert.Equal(0, readme.Dir);
        Assert.Equal("md", readme.Ext);
        Assert.Equal(1, readme.Count);
    }

    [Fact]
    public void BuildTree_BuildsDeeplyNestedFolderStructuresWithAccurateCounts()
    {
        var paths = new[]
        {
            "a/b/c/d/file.txt",
            "a/b/other.js"
        };
        var tree = TreeView.BuildTree(paths);
        Assert.Single(tree);
        var a = tree[0];
        Assert.Equal(2, a.Count);

        var nodeD = TreeView.FindNode(tree, "a/b/c/d");
        Assert.NotNull(nodeD);
        Assert.Equal(1, nodeD.Dir);
        Assert.Equal(1, nodeD.Count);
        Assert.NotNull(nodeD.Kids);
        Assert.Equal("file.txt", nodeD.Kids[0].N);
        Assert.Equal("txt", nodeD.Kids[0].Ext);
    }

    [Fact]
    public void BuildTree_SortsDirectoriesFirstThenNaturalAlphabetical()
    {
        var paths = new[]
        {
            "zoo.txt",
            "beta.txt",
            "alpha",
            "docs/b.md",
            "docs/a.md",
            "alpha/1.txt"
        };
        var tree = TreeView.BuildTree(paths);

        // Folders first: alpha, docs. Then files: beta.txt, zoo.txt
        Assert.Equal("alpha", tree[0].N);
        Assert.Equal(1, tree[0].Dir);
        Assert.Equal("docs", tree[1].N);
        Assert.Equal(1, tree[1].Dir);
        Assert.Equal("beta.txt", tree[2].N);
        Assert.Equal(0, tree[2].Dir);
        Assert.Equal("zoo.txt", tree[3].N);
        Assert.Equal(0, tree[3].Dir);

        // Subfolder kids sorted: a.md before b.md
        Assert.NotNull(tree[1].Kids);
        Assert.Equal("a.md", tree[1].Kids![0].N);
        Assert.Equal("b.md", tree[1].Kids![1].N);
    }

    [Fact]
    public void BuildTree_HidesKeepFilesByDefault()
    {
        var paths = new[]
        {
            "empty/.keep",
            "active/file.js",
            "active/.keep"
        };
        var tree = TreeView.BuildTree(paths, new TreeView.TreeOptions(HideKeepFiles: true));
        var empty = TreeView.FindNode(tree, "empty");
        Assert.NotNull(empty);
        Assert.NotNull(empty.Kids);
        Assert.Empty(empty.Kids);
        Assert.Equal(0, empty.Count);

        var active = TreeView.FindNode(tree, "active");
        Assert.NotNull(active);
        Assert.NotNull(active.Kids);
        Assert.Single(active.Kids);
        Assert.Equal("file.js", active.Kids[0].N);
    }

    [Fact]
    public void BuildTree_PropagatesChgFlagsFromFilesUpToParentFolders()
    {
        var paths = new[]
        {
            "src/feature/code.js",
            "src/other.js",
            "docs/read.md"
        };
        var tree = TreeView.BuildTree(paths, new TreeView.TreeOptions(ChangedPaths: ["src/feature/code.js"]));
        var code = TreeView.FindNode(tree, "src/feature/code.js");
        var feature = TreeView.FindNode(tree, "src/feature");
        var src = TreeView.FindNode(tree, "src");
        var docs = TreeView.FindNode(tree, "docs");

        Assert.NotNull(code);
        Assert.True(code.Chg);
        Assert.NotNull(feature);
        Assert.True(feature.Chg);
        Assert.NotNull(src);
        Assert.True(src.Chg);
        Assert.NotNull(docs);
        Assert.False(docs.Chg);
    }

    [Fact]
    public void CountTreeFiles_RecursivelyCountsFilesAcrossNodes()
    {
        var tree = TreeView.BuildTree(["a/1.js", "a/2.js", "b/c/3.js", "root.txt"]);
        Assert.Equal(4, TreeView.CountTreeFiles(tree));
        Assert.Equal(0, TreeView.CountTreeFiles(null));
        Assert.Equal(1, TreeView.CountTreeFiles(new TreeView.TreeNode { Dir = 0 }));
    }

    [Fact]
    public void FlattenTree_FlattensTreeIntoRowsRespectingIsOpenAndActivePath()
    {
        var paths = new[]
        {
            "src/components/button.jsx",
            "src/index.js",
            "package.json"
        };
        var tree = TreeView.BuildTree(paths);

        // Nothing open
        var closedRows = TreeView.FlattenTree(tree, _ => false);
        Assert.Equal(2, closedRows.Count); // src, package.json
        Assert.Equal("src", closedRows[0].N);
        Assert.Equal(1, closedRows[0].Dir);
        Assert.False(closedRows[0].Open);
        Assert.Equal(0, closedRows[0].Depth);

        // src open, components closed, active on package.json
        var openSet = new HashSet<string> { "src" };
        var openRows = TreeView.FlattenTree(
            tree,
            path => openSet.Contains(path),
            new TreeView.FlattenOptions(ActivePath: "package.json")
        );
        Assert.Equal(4, openRows.Count); // src (open), components (closed), index.js, package.json (active)
        Assert.Equal("src", openRows[0].N);
        Assert.True(openRows[0].Open);
        Assert.Equal("components", openRows[1].N);
        Assert.Equal(1, openRows[1].Depth);
        Assert.False(openRows[1].Open);
        Assert.Equal("index.js", openRows[2].N);
        Assert.Equal(1, openRows[2].Depth);
        Assert.Equal("package.json", openRows[3].N);
        Assert.True(openRows[3].Active);
    }

    [Fact]
    public void FindNode_FindsNodesByFullPathAndReturnsNullWhenNotFound()
    {
        var tree = TreeView.BuildTree(["dir/subdir/file.txt"]);
        Assert.Equal(1, TreeView.FindNode(tree, "dir")!.Dir);
        Assert.Equal(1, TreeView.FindNode(tree, "dir/subdir")!.Dir);
        Assert.Equal(0, TreeView.FindNode(tree, "dir/subdir/file.txt")!.Dir);
        Assert.Null(TreeView.FindNode(tree, "nonexistent"));
        Assert.Null(TreeView.FindNode(tree, null));
    }

    [Fact]
    public void FilterTree_FiltersTreeNodesAndRetainsAncestorDirectories()
    {
        var paths = new[]
        {
            "src/components/Button.jsx",
            "src/components/Header.jsx",
            "src/utils/math.js",
            "README.md"
        };
        var tree = TreeView.BuildTree(paths);
        var filtered = TreeView.FilterTree(tree, "button");

        Assert.Single(filtered);
        Assert.Equal("src", filtered[0].N);
        Assert.NotNull(filtered[0].Kids);
        Assert.Single(filtered[0].Kids!);
        Assert.Equal("components", filtered[0].Kids![0].N);
        Assert.NotNull(filtered[0].Kids![0].Kids);
        Assert.Single(filtered[0].Kids![0].Kids!);
        Assert.Equal("Button.jsx", filtered[0].Kids![0].Kids![0].N);
    }

    [Fact]
    public void HostileInputImmunity_HandlesHostileInputsAndBoundsSafely()
    {
        Assert.Empty(TreeView.BuildTree(null));
        Assert.Empty(TreeView.BuildTree(["", "   ", "//"]));

        // Windows backslashes
        var treeWin = TreeView.BuildTree(["src\\win\\test.js"]);
        Assert.NotNull(TreeView.FindNode(treeWin, "src/win/test.js"));

        // Cap huge paths array
        var bigList = Enumerable.Range(0, 6000).Select(i => "f" + i + ".txt").ToList();
        var treeBig = TreeView.BuildTree(bigList);
        Assert.True(treeBig.Count <= TreeView.MaxPaths);
    }
}
