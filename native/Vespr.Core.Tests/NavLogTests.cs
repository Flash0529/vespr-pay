namespace Vespr.Core.Tests;

using Vespr.Core;
using Xunit;

public class NavLogTests
{
    [Fact]
    public void Constants_ExistAndHaveExpectedBounds()
    {
        Assert.Equal(30000, NavLog.DefaultQuickMs);
        Assert.Equal(0.15, NavLog.DefaultThreshold);
        Assert.Equal(10, NavLog.DefaultMinVisits);
        Assert.Equal(500, NavLog.DefaultMax);
    }

    [Fact]
    public void CleanPath_WithoutBounces_ReportsNothing()
    {
        long clock = 1000;
        var log = NavLog.CreateNavLog(now: () => clock);
        // Visit A -> B -> C -> D with no returns
        foreach (var s in new[] { "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K" })
        {
            clock += 1000;
            log.Visit(s);
        }
        Assert.Empty(log.Report());
    }

    [Fact]
    public void TenVisitsOfA_WithTwoBouncesToB_ReportedWithPartnerB()
    {
        long clock = 1000;
        var log = NavLog.CreateNavLog(now: () => clock);
        // Bounce 1: A -> B -> A
        log.Visit("A"); clock += 1000;
        log.Visit("B"); clock += 1000;
        log.Visit("A"); clock += 1000;
        // Bounce 2: A -> B -> A
        log.Visit("B"); clock += 1000;
        log.Visit("A"); clock += 1000;
        // 7 more visits of A without bouncing (e.g. A -> X -> Y -> A)
        for (int i = 0; i < 7; i++)
        {
            log.Visit($"X{i}"); clock += 1000;
            log.Visit($"Y{i}"); clock += 1000;
            log.Visit("A"); clock += 1000;
        }

        var rep = log.Report();
        Assert.Single(rep);
        Assert.Equal("A", rep[0].Screen);
        Assert.Equal(10, rep[0].Visits);
        Assert.Equal(2, rep[0].Bounces);
        Assert.Equal(0.2, rep[0].Ratio);
        Assert.Equal("B", rep[0].Partner);
    }

    [Fact]
    public void BelowMinVisits_ReportsNothingEvenAtHighRatio()
    {
        long clock = 1000;
        var log = NavLog.CreateNavLog(now: () => clock);
        // A -> B -> A -> B -> A (3 visits, 2 bounces, ratio 0.67, but < 10 minVisits)
        log.Visit("A"); clock += 1000;
        log.Visit("B"); clock += 1000;
        log.Visit("A"); clock += 1000;
        log.Visit("B"); clock += 1000;
        log.Visit("A"); clock += 1000;
        Assert.Empty(log.Report());
    }

    [Fact]
    public void BounceSlowerThanQuickMs_DoesNotCount()
    {
        long clock = 1000;
        var log = NavLog.CreateNavLog(now: () => clock);
        // Slower than quickMs (30,000 ms)
        log.Visit("A"); clock += 1000;
        log.Visit("B"); clock += 35000;
        log.Visit("A"); clock += 1000;
        // Fill 9 more non-bouncing visits of A
        for (int i = 0; i < 9; i++)
        {
            log.Visit($"X{i}"); clock += 1000;
            log.Visit($"Y{i}"); clock += 1000;
            log.Visit("A"); clock += 1000;
        }
        Assert.Empty(log.Report());
    }

    [Fact]
    public void RepeatedVisit_OfSameScreen_DoesNotAddEntry()
    {
        var log = NavLog.CreateNavLog();
        log.Visit("editor");
        log.Visit("editor");
        log.Visit("editor");
        Assert.Single(log.Export());
    }

    [Fact]
    public void Max_DropsOldestEntries()
    {
        long clock = 1000;
        var log = NavLog.CreateNavLog(now: () => clock, max: 3);
        log.Visit("A"); clock += 100;
        log.Visit("B"); clock += 100;
        log.Visit("C"); clock += 100;
        log.Visit("D"); clock += 100;
        var exp = log.Export();
        Assert.Equal(3, exp.Count);
        Assert.Equal(["B", "C", "D"], exp.Select(x => x.Screen));
    }

    [Fact]
    public void Import_RejectsGarbageEntries()
    {
        var log = NavLog.CreateNavLog();
        log.Import([
            null!,
            new NavLog.NavEntry("", 100),
            new NavLog.NavEntry("valid", 1234),
            new NavLog.NavEntry(new string('a', 100), 100),
            new NavLog.NavEntry("another", 5678)
        ]);
        var exp = log.Export();
        Assert.Equal(2, exp.Count);
        Assert.Equal(["valid", "another"], exp.Select(x => x.Screen));
    }

    [Fact]
    public void TiesForPartner_ChooseFirstSeen()
    {
        long clock = 1000;
        var log = NavLog.CreateNavLog(now: () => clock);
        // A -> B -> A (bounce with B at t=1000)
        log.Visit("A"); clock += 500;
        log.Visit("B"); clock += 500;
        log.Visit("A"); clock += 500;
        // A -> C -> A (bounce with C at t=2500)
        log.Visit("C"); clock += 500;
        log.Visit("A"); clock += 500;
        // 8 more non-bouncing visits
        for (int i = 0; i < 8; i++)
        {
            log.Visit($"X{i}"); clock += 500;
            log.Visit($"Y{i}"); clock += 500;
            log.Visit("A"); clock += 500;
        }
        // B and C each have 1 bounce. B was seen first.
        var rep = log.Report();
        Assert.Single(rep);
        Assert.Equal("B", rep[0].Partner);
    }
}
