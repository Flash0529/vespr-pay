using System.Text.Json;

namespace Vespr.Core.Tests;

// Pathops must give exactly the JavaScript answers recorded in native/golden/pathops.json.
public class PathopsTests
{
    [Fact]
    public void Constants_match_javascript()
    {
        var c = Golden.Constants("pathops");
        Assert.Equal(Pathops.FolderMarker, c.GetProperty("FOLDER_MARKER").GetString());
        Assert.Equal(Pathops.MaxDepth, c.GetProperty("MAX_DEPTH").GetInt32());
        Assert.Equal(Pathops.MaxMoves, c.GetProperty("MAX_MOVES").GetInt32());
        Assert.Equal(Pathops.MaxPath, c.GetProperty("MAX_PATH").GetInt32());
        Assert.Equal(Pathops.MaxSegment, c.GetProperty("MAX_SEGMENT").GetInt32());
    }

    [Fact]
    public void ValidateName_matches_javascript() =>
        Golden.Check("pathops", "validateName", c => Golden.Json(Pathops.ValidateName(c.Args[0].GetString())));

    [Fact]
    public void JoinPath_matches_javascript() =>
        Golden.Check("pathops", "joinPath", c => Golden.Json(Pathops.JoinPath(c.Args[0].GetString(), c.Args[1].GetString())));

    [Fact]
    public void Exists_matches_javascript() =>
        Golden.Check("pathops", "exists", c => Golden.Json(Pathops.Exists(
            c.Args[0].EnumerateArray().Select(x => x.GetString()!).ToList(), c.Args[1].GetString())));

    [Fact]
    public void PlanCreate_matches_javascript() =>
        Golden.Check("pathops", "planCreate", c => Golden.Json(Pathops.PlanCreate(
            c.Args[0].EnumerateArray().Select(x => x.GetString()!).ToList(),
            c.Args[1].GetString(), c.Args[2].GetString(), c.Args[3].GetString())));

    [Fact]
    public void PlanRename_matches_javascript() =>
        Golden.Check("pathops", "planRename", c => Golden.Json(Pathops.PlanRename(
            c.Args[0].EnumerateArray().Select(x => x.GetString()!).ToList(),
            c.Args[1].GetString(), c.Args[2].GetString())));

    [Fact]
    public void PlanDelete_matches_javascript() =>
        Golden.Check("pathops", "planDelete", c => Golden.Json(Pathops.PlanDelete(
            c.Args[0].EnumerateArray().Select(x => x.GetString()!).ToList(), c.Args[1].GetString())));

    [Fact]
    public void IsMarker_matches_javascript() =>
        Golden.Check("pathops", "isMarker", c => Golden.Json(Pathops.IsMarker(c.Args[0].GetString())));

    [Fact]
    public void VisiblePaths_matches_javascript() =>
        Golden.Check("pathops", "visiblePaths", c => Golden.Json(Pathops.VisiblePaths(
            c.Args[0].EnumerateArray().Select(x => x.GetString()!).ToList())));
}
