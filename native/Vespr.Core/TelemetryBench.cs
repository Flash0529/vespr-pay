namespace Vespr.Core;

/// <summary>
/// Telemetry and latency benchmarking engine for search engines and AI auto-fill.
/// Measures query latency, auto-fill suggestion load time, result bar rendering time, and miss rate.
/// Port of app/telemetry-bench.js.
/// </summary>
public static class TelemetryBench
{
    public const int DefaultSampleCapacity = 10_000;

    public record SearchSample(
        string Query,
        double ExecMs,
        double AutoFillMs,
        double RenderMs,
        double TotalLoadTimeMs,
        int Count,
        bool IsMiss,
        string Source,
        long Ts
    );

    public record AiSample(
        int PromptChars,
        int CompletionTokens,
        double LatMs,
        bool Accepted,
        bool IsInlineAutoFill,
        long Ts
    );

    public record SearchMetrics(
        int TotalQueries,
        double AvgExecutionTimeMs,
        double P95ExecutionTimeMs,
        double AvgAutoFillLatencyMs,
        double AvgResultRenderTimeMs,
        double AvgTotalResultLoadTimeMs,
        int MissCount,
        double MissRatePercent
    );

    public record AiMetrics(
        int TotalRequests,
        double AvgLatencyMs,
        double P95LatencyMs,
        int AcceptedCount,
        int MissCount,
        double MissRatePercent
    );

    public class Collector
    {
        private readonly List<SearchSample> _search = [];
        private readonly List<AiSample> _ai = [];

        public void RecordSearchQuery(string query, double executionTimeMs, double autoFillLatencyMs, double resultRenderTimeMs, int matchCount, string source = "bar")
        {
            var exec = Math.Max(0.0, executionTimeMs);
            var autoFill = Math.Max(0.0, autoFillLatencyMs);
            var render = Math.Max(0.0, resultRenderTimeMs);
            var count = Math.Max(0, matchCount);

            _search.Add(new SearchSample(
                query ?? "",
                exec,
                autoFill,
                render,
                exec + render,
                count,
                count == 0,
                source ?? "bar",
                DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()
            ));
        }

        public void RecordAiCompletion(int promptChars, int completionTokens, double latencyMs, bool accepted = true, bool isInlineAutoFill = true)
        {
            _ai.Add(new AiSample(
                Math.Max(0, promptChars),
                Math.Max(0, completionTokens),
                Math.Max(0.0, latencyMs),
                accepted,
                isInlineAutoFill,
                DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()
            ));
        }

        public SearchMetrics GetSearchMetrics()
        {
            if (_search.Count == 0)
            {
                return new SearchMetrics(0, 0, 0, 0, 0, 0, 0, 0);
            }

            var total = _search.Count;
            var execSum = _search.Sum(s => s.ExecMs);
            var autoFillSum = _search.Sum(s => s.AutoFillMs);
            var renderSum = _search.Sum(s => s.RenderMs);
            var totalLoadSum = _search.Sum(s => s.TotalLoadTimeMs);
            var missCount = _search.Count(s => s.IsMiss);

            var sorted = _search.Select(s => s.ExecMs).OrderBy(x => x).ToList();
            var p95Idx = Math.Min((int)Math.Floor(total * 0.95), total - 1);
            var p95 = sorted[p95Idx];

            return new SearchMetrics(
                total,
                Math.Round(execSum / total, 2),
                Math.Round(p95, 2),
                Math.Round(autoFillSum / total, 2),
                Math.Round(renderSum / total, 2),
                Math.Round(totalLoadSum / total, 2),
                missCount,
                Math.Round((missCount / (double)total) * 100.0, 2)
            );
        }

        public AiMetrics GetAiMetrics()
        {
            if (_ai.Count == 0)
            {
                return new AiMetrics(0, 0, 0, 0, 0, 0);
            }

            var total = _ai.Count;
            var latSum = _ai.Sum(a => a.LatMs);
            var sorted = _ai.Select(a => a.LatMs).OrderBy(x => x).ToList();
            var p95Idx = Math.Min((int)Math.Floor(total * 0.95), total - 1);
            var p95 = sorted[p95Idx];

            var accepted = _ai.Count(a => a.Accepted);
            var miss = total - accepted;

            return new AiMetrics(
                total,
                Math.Round(latSum / total, 2),
                Math.Round(p95, 2),
                accepted,
                miss,
                Math.Round((miss / (double)total) * 100.0, 2)
            );
        }

        public void Reset()
        {
            _search.Clear();
            _ai.Clear();
        }
    }
}
