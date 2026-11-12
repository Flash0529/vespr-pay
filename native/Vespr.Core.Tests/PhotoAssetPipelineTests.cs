using Vespr.Core;
using Xunit;

namespace Vespr.Core.Tests;

public class PhotoAssetPipelineTests
{
    [Fact]
    public void NormalizePhotoName_FormatsCleanNames()
    {
        var fixedTime = 1793881800000; // 20261105-1230 UTC
        var n1 = PhotoAssetPipeline.NormalizePhotoName("Screenshot 2026-11-05 at 10.15.22.png", fixedTime);
        Assert.Equal("asset-photo-20261105-1230-screenshot.png", n1);

        var n2 = PhotoAssetPipeline.NormalizePhotoName("IMG_0492.JPG", fixedTime, sequence: 2);
        Assert.Equal("asset-photo-20261105-1230-capture-2.jpg", n2);

        var n3 = PhotoAssetPipeline.NormalizePhotoName("Dashboard Analytics Graph.webp", fixedTime);
        Assert.Equal("asset-photo-20261105-1230-dashboard-analytics-graph.webp", n3);
    }

    [Fact]
    public void IsDescriptiveImageName_IdentifiesSchemesAndGenericDumps()
    {
        Assert.True(PhotoAssetPipeline.IsDescriptiveImageName("architecture-diagram.png"));
        Assert.True(PhotoAssetPipeline.IsDescriptiveImageName("user-profile.webp"));
        Assert.True(PhotoAssetPipeline.IsDescriptiveImageName("logo-dark.svg"));
        Assert.True(PhotoAssetPipeline.IsDescriptiveImageName("auth-flow-v2.png"));
        Assert.True(PhotoAssetPipeline.IsDescriptiveImageName("button-hover.png"));
        Assert.True(PhotoAssetPipeline.IsDescriptiveImageName("database_schema.png"));
        Assert.True(PhotoAssetPipeline.IsDescriptiveImageName("userProfileAvatar.png"));
        Assert.True(PhotoAssetPipeline.IsDescriptiveImageName("favicon.ico"));
        Assert.True(PhotoAssetPipeline.IsDescriptiveImageName("hero.jpg"));

        // Generic camera dumps and screenshots
        Assert.False(PhotoAssetPipeline.IsDescriptiveImageName("Screenshot 2026-11-05 at 10.15.22.png"));
        Assert.False(PhotoAssetPipeline.IsDescriptiveImageName("Screen Shot 2026-11-05.png"));
        Assert.False(PhotoAssetPipeline.IsDescriptiveImageName("IMG_0492.JPG"));
        Assert.False(PhotoAssetPipeline.IsDescriptiveImageName("DSC_0012.JPG"));
        Assert.False(PhotoAssetPipeline.IsDescriptiveImageName("DCIM_1001.JPG"));
        Assert.False(PhotoAssetPipeline.IsDescriptiveImageName("Pasted image.png"));
        Assert.False(PhotoAssetPipeline.IsDescriptiveImageName("image(1).png"));
        Assert.False(PhotoAssetPipeline.IsDescriptiveImageName("untitled.png"));
        Assert.False(PhotoAssetPipeline.IsDescriptiveImageName("8f4b2c1a-5b1e-4c3d-9a8b-1e2f3a4b5c6d.png"));
        Assert.False(PhotoAssetPipeline.IsDescriptiveImageName("1730793600123.png"));
    }

    [Fact]
    public void ShouldNormalizeImageName_HonorsSettings()
    {
        // 1. Descriptive names should NOT be normalized under default avoidDescriptiveNames=true
        Assert.False(PhotoAssetPipeline.ShouldNormalizeImageName("architecture-diagram.png", autoNormalizeNames: true, avoidDescriptiveNames: true));
        Assert.False(PhotoAssetPipeline.ShouldNormalizeImageName("user-profile.webp"));
        Assert.False(PhotoAssetPipeline.ShouldNormalizeImageName("logo-dark.svg"));

        // 2. Generic dumps SHOULD be normalized
        Assert.True(PhotoAssetPipeline.ShouldNormalizeImageName("Screenshot 2026-11-05 at 10.15.22.png", autoNormalizeNames: true, avoidDescriptiveNames: true));
        Assert.True(PhotoAssetPipeline.ShouldNormalizeImageName("IMG_0492.JPG"));

        // 3. If avoidDescriptiveNames is false -> even descriptive is normalized
        Assert.True(PhotoAssetPipeline.ShouldNormalizeImageName("architecture-diagram.png", autoNormalizeNames: true, avoidDescriptiveNames: false));

        // 4. If autoNormalizeNames is false -> never normalize
        Assert.False(PhotoAssetPipeline.ShouldNormalizeImageName("Screenshot 2026-11-05.png", autoNormalizeNames: false));

        // 5. Already normalized prefix -> skip
        Assert.False(PhotoAssetPipeline.ShouldNormalizeImageName("asset-photo-20261105-1230-capture.png"));
    }

    [Fact]
    public void ProcessIncomingPhoto_PreservesDescriptiveAndGeneratesSidecar()
    {
        var fixedTime = 1793881800000;
        var p1 = PhotoAssetPipeline.ProcessIncomingPhoto("Screenshot 2026-11-05 at 10.15.22.png", timestamp: fixedTime);
        Assert.True(p1.Renamed);
        Assert.Equal("asset-photo-20261105-1230-screenshot.png", p1.FinalName);
        Assert.Equal("asset-photo-20261105-1230-screenshot.png.meta.json", p1.SidecarPath);
        Assert.NotNull(p1.Meta);
        Assert.Equal("Screenshot 2026-11-05 at 10.15.22.png", p1.Meta.OriginalName);

        var p2 = PhotoAssetPipeline.ProcessIncomingPhoto("architecture-diagram.png", new PhotoAssetPipeline.PhotoMetaOptions(
            Description: "System architecture",
            Tags: ["Architecture", "Diagram"]
        ));
        Assert.False(p2.Renamed); // preserved!
        Assert.Equal("architecture-diagram.png", p2.FinalName);
        Assert.Equal("architecture-diagram.png.meta.json", p2.SidecarPath);
        Assert.NotNull(p2.Meta);
        Assert.Contains("architecture", p2.Meta.Tags);
    }

    [Fact]
    public void GeneratePairedMeta_ExtractsDimensionsAndAspect()
    {
        var meta = PhotoAssetPipeline.GeneratePairedMeta("assets/chart.png", new PhotoAssetPipeline.PhotoMetaOptions(
            OriginalName: "Screenshot 2026-11-05 at 10.15.22.png",
            Width: 1920,
            Height: 1080,
            SizeBytes: 250000,
            Description: "Production metrics dashboard in dark mode showing 99.9% uptime",
            Tags: ["Dashboard", "Metrics", "Dark Mode"],
            OcrTokens: ["revenue", "subscribers", "99.9%", "uptime"]
        ));

        Assert.Equal("png", meta.Format);
        Assert.Equal("16:9", meta.AspectRatio);
        Assert.Contains("dashboard", meta.Tags);
        Assert.Contains("revenue", meta.SearchIndex);
        Assert.Contains("uptime", meta.SearchIndex);
    }

    [Fact]
    public void SearchPhotoAssets_MatchesThroughMetaAndOcr()
    {
        var meta1 = PhotoAssetPipeline.GeneratePairedMeta("assets/dashboard.png", new PhotoAssetPipeline.PhotoMetaOptions(
            Description: "Revenue dashboard graph",
            Tags: ["metrics", "charts"],
            OcrTokens: ["q4", "growth", "$50k"]
        ));

        var meta2 = PhotoAssetPipeline.GeneratePairedMeta("assets/hero.jpg", new PhotoAssetPipeline.PhotoMetaOptions(
            Description: "Code editor hero illustration",
            Tags: ["editor", "hero"]
        ));

        var assets = new List<PhotoAssetPipeline.PhotoAssetItem>
        {
            new("assets/dashboard.png", meta1),
            new("assets/hero.jpg", meta2)
        };

        var results = PhotoAssetPipeline.SearchPhotoAssets("growth", assets);
        Assert.Single(results);
        Assert.Equal("assets/dashboard.png", results[0].AssetPath);
        Assert.Contains("growth", results[0].MatchedTerms);

        var editorResults = PhotoAssetPipeline.SearchPhotoAssets("editor", assets);
        Assert.Single(editorResults);
        Assert.Equal("assets/hero.jpg", editorResults[0].AssetPath);
    }

    [Fact]
    public void ConstantsCheck()
    {
        Assert.Equal(1200, PhotoAssetPipeline.DefaultWidth);
        Assert.Equal(800, PhotoAssetPipeline.DefaultHeight);
        Assert.Equal(8, PhotoAssetPipeline.ValidImageExts.Length);
    }
}
