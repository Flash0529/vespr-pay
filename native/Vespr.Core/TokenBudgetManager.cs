using System.Collections.Concurrent;

namespace Vespr.Core;

public record TokenBudgetRecord(
    string UserId,
    string RoleId,
    int DailyLimit,
    int TokensUsedToday,
    decimal AvailableCreditsDollars,
    bool IsExhausted,
    string FallbackModel = "phi-3-mini-local",
    DateTime ResetTime = default
)
{
    public int TokensRemaining => Math.Max(0, DailyLimit - TokensUsedToday);
    public int PercentUsed => DailyLimit > 0 ? (int)Math.Min(100, (double)TokensUsedToday / DailyLimit * 100) : 100;
}

public class TokenBudgetService
{
    private readonly ConcurrentDictionary<string, TokenBudgetRecord> _budgets = new();

    public TokenBudgetService()
    {
        SeedDefaultBudgets();
    }

    private void SeedDefaultBudgets()
    {
        // Default developer account with high limit
        _budgets["owner@example.com"] = new(
            UserId: "owner@example.com",
            RoleId: "senior_dev",
            DailyLimit: 1500000,
            TokensUsedToday: 1500000, // 100% used matching screenshot #5!
            AvailableCreditsDollars: 13.45m,
            IsExhausted: true,
            FallbackModel: "phi-3-mini-local",
            ResetTime: DateTime.UtcNow.Date.AddDays(2).AddHours(15) // Saturday 3:00 PM EST
        );

        // Student account with strict guardrails
        _budgets["student.alex@lincoln.edu"] = new(
            UserId: "student.alex@lincoln.edu",
            RoleId: "student",
            DailyLimit: 50000,
            TokensUsedToday: 18200,
            AvailableCreditsDollars: 0m,
            IsExhausted: false,
            FallbackModel: "tutor-heuristic-guided",
            ResetTime: DateTime.UtcNow.Date.AddDays(1)
        );
    }

    public TokenBudgetRecord GetBudget(string userId)
    {
        if (_budgets.TryGetValue(userId, out var b)) return b;

        var def = new TokenBudgetRecord(
            UserId: userId,
            RoleId: "junior_dev",
            DailyLimit: 250000,
            TokensUsedToday: 0,
            AvailableCreditsDollars: 5.0m,
            IsExhausted: false,
            ResetTime: DateTime.UtcNow.Date.AddDays(1)
        );
        _budgets[userId] = def;
        return def;
    }

    public bool CanExecute(string userId, int estimatedTokens)
    {
        var b = GetBudget(userId);
        if (!b.IsExhausted && b.TokensRemaining >= estimatedTokens)
            return true;

        // Can still execute if available usage credits exist
        return b.AvailableCreditsDollars > 0.50m;
    }

    public void ConsumeTokens(string userId, int tokens)
    {
        var b = GetBudget(userId);
        var newUsed = b.TokensUsedToday + tokens;
        var exhausted = newUsed >= b.DailyLimit;

        _budgets[userId] = b with
        {
            TokensUsedToday = newUsed,
            IsExhausted = exhausted
        };
    }

    public bool DrawUsageCredits(string userId, decimal amountDollars, int tokensGranted)
    {
        var b = GetBudget(userId);
        if (b.AvailableCreditsDollars < amountDollars) return false;

        _budgets[userId] = b with
        {
            AvailableCreditsDollars = b.AvailableCreditsDollars - amountDollars,
            DailyLimit = b.DailyLimit + tokensGranted,
            IsExhausted = false
        };
        return true;
    }

    public string GetActiveModel(string userId)
    {
        var b = GetBudget(userId);
        if (b.IsExhausted && b.AvailableCreditsDollars <= 0)
        {
            return b.FallbackModel; // Fallback to free local model
        }
        return "nemotron-3-super-120b";
    }

    public string GetExhaustionNotification(string userId)
    {
        var b = GetBudget(userId);
        if (!b.IsExhausted) return "Token budget healthy";

        return $"Token limit reached. You have used 100% of your daily compute tokens ({b.DailyLimit:N0}). " +
               $"Resets on {b.ResetTime:dddd, h:mm tt} EST. " +
               $"Use available credits (${b.AvailableCreditsDollars:F2}) or continue in free offline mode ({b.FallbackModel}).";
    }
}