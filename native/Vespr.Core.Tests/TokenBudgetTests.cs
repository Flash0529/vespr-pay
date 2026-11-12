using Vespr.Core;
using Xunit;

namespace Vespr.Core.Tests;

public class TokenBudgetTests
{
    [Fact]
    public void DefaultBudget_MatchesScreenshotUsageLimits()
    {
        var svc = new TokenBudgetService();
        var b = svc.GetBudget("owner@example.com");

        Assert.Equal(1500000, b.DailyLimit);
        Assert.Equal(1500000, b.TokensUsedToday);
        Assert.Equal(100, b.PercentUsed);
        Assert.True(b.IsExhausted);
        Assert.Equal(13.45m, b.AvailableCreditsDollars);
    }

    [Fact]
    public void CanExecute_AllowsExecutionWhenCreditsExistEvenIfExhausted()
    {
        var svc = new TokenBudgetService();
        // Exhausted but has $13.45 in credits
        Assert.True(svc.CanExecute("owner@example.com", 5000));

        // When credits drawn
        var drawn = svc.DrawUsageCredits("owner@example.com", 2.0m, 200000);
        Assert.True(drawn);
        var updated = svc.GetBudget("owner@example.com");
        Assert.Equal(11.45m, updated.AvailableCreditsDollars);
        Assert.False(updated.IsExhausted);
    }

    [Fact]
    public void FallbackModel_ReturnedWhenExhaustedWithoutCredits()
    {
        var svc = new TokenBudgetService();
        var student = svc.GetBudget("student.alex@lincoln.edu");
        Assert.Equal("nemotron-3-super-120b", svc.GetActiveModel("student.alex@lincoln.edu"));

        // Exhaust student's daily tokens
        svc.ConsumeTokens("student.alex@lincoln.edu", 60000);
        var exhausted = svc.GetBudget("student.alex@lincoln.edu");
        Assert.True(exhausted.IsExhausted);
        Assert.Equal("tutor-heuristic-guided", svc.GetActiveModel("student.alex@lincoln.edu"));

        var msg = svc.GetExhaustionNotification("student.alex@lincoln.edu");
        Assert.Contains("Token limit reached", msg);
    }
}