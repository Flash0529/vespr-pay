using Vespr.Core;
using Xunit;

namespace Vespr.Core.Tests;

public class ClassroomOrchestrationTests
{
    [Fact]
    public void AgeLayout_EnforcesSimplifiedMiddleSchoolVsHighSchoolPlus()
    {
        var svc = new ClassroomOrchestratorService();
        var ms = svc.GetLayoutConfig(StudentAgeTier.MiddleSchoolUnder);
        Assert.True(ms.IsSimplifiedLayout);
        Assert.False(ms.AllowShellTerminal);
        Assert.False(ms.AllowNetworkEgress);
        Assert.True(ms.GuidedPromptsOnly);
        Assert.Equal("friendly_blocks", ms.UIMode);

        var hs = svc.GetLayoutConfig(StudentAgeTier.HighSchoolPlus);
        Assert.False(hs.IsSimplifiedLayout);
        Assert.True(hs.AllowShellTerminal);
        Assert.True(hs.AllowNetworkEgress);
        Assert.False(hs.GuidedPromptsOnly);
        Assert.Equal("pro_sde", hs.UIMode);
    }

    [Fact]
    public void OrchestratedProject_SupportsPodsForBeginnersAndIndividualForAdvanced()
    {
        var svc = new ClassroomOrchestratorService();

        // Beginner project with pods
        var podProj = svc.CreateOrchestratedProject("Web Store API", "Build shop backend", usePodsForBeginners: true);
        Assert.Equal("Beginner_Pods", podProj.DifficultyMode);
        Assert.NotEmpty(podProj.ScopeSlides);
        Assert.All(podProj.Parts, p => Assert.True(p.IsPod));

        // Advanced individual project
        var advProj = svc.CreateOrchestratedProject("Compiler Frontend", "Build lexical scanner", usePodsForBeginners: false);
        Assert.Equal("Advanced_Individual", advProj.DifficultyMode);
        Assert.All(advProj.Parts, p => Assert.False(p.IsPod));
    }

    [Fact]
    public void RecurringChats_ScheduleAndRetrieve()
    {
        var svc = new ClassroomOrchestratorService();
        var sched = svc.ScheduleRepeatChat("Nightly CI Check", "@coder run test suite and log issues", "Daily", 1, new List<string> { "cart.py" });
        Assert.NotNull(sched);
        Assert.True(sched.IsActive);
        Assert.Equal("Daily", sched.IntervalType);

        var all = svc.GetRecurringSchedules();
        Assert.Contains(all, s => s.ScheduleId == sched.ScheduleId);
    }

    [Fact]
    public void SearchChats_PerformsSemanticAndKeywordMatch()
    {
        var svc = new ClassroomOrchestratorService();
        var results = svc.SearchChats("discount bug");
        Assert.NotEmpty(results);
        Assert.Contains(results, r => r.Title.Contains("discount", StringComparison.OrdinalIgnoreCase));

        var offComp = svc.SearchChats("view-only partner");
        Assert.NotEmpty(offComp);
        Assert.True(offComp[0].IsReadOnly);
    }
}
