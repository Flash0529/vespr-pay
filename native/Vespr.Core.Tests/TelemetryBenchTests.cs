using Vespr.Core;
using Xunit;

namespace Vespr.Core.Tests;

public class TelemetryBenchTests
{
    [Fact]
    public void SearchMetrics_ComputesAveragesP95AndMissRate()
    {
        var col = new TelemetryBench.Collector();
        col.RecordSearchQuery("test", 1.0, 10.0, 0.5, 5);
        col.RecordSearchQuery("find", 2.0, 12.0, 0.5, 3);
        col.RecordSearchQuery("nonexistent", 0.5, 5.0, 0.2, 0); // miss

        var m = col.GetSearchMetrics();
        Assert.Equal(3, m.TotalQueries);
        Assert.Equal(1, m.MissCount);
        Assert.Equal(33.33, m.MissRatePercent);
        Assert.True(m.AvgExecutionTimeMs > 0);
        Assert.True(m.AvgAutoFillLatencyMs > 0);
        Assert.True(m.AvgTotalResultLoadTimeMs > 0);
    }

    [Fact]
    public void AiMetrics_ComputesAveragesAndAcceptanceRate()
    {
        var col = new TelemetryBench.Collector();
        col.RecordAiCompletion(100, 20, 35.0, accepted: true);
        col.RecordAiCompletion(150, 25, 45.0, accepted: true);
        col.RecordAiCompletion(200, 10, 25.0, accepted: false); // rejected

        var m = col.GetAiMetrics();
        Assert.Equal(3, m.TotalRequests);
        Assert.Equal(2, m.AcceptedCount);
        Assert.Equal(1, m.MissCount);
        Assert.Equal(33.33, m.MissRatePercent);
        Assert.True(m.AvgLatencyMs > 0);
    }

    [Fact]
    public void ConstantsCheck()
    {
        Assert.Equal(10_000, TelemetryBench.DefaultSampleCapacity);
    }
}
