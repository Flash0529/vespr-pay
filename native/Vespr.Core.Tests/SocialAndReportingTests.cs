using Vespr.Core;
using Xunit;

namespace Vespr.Core.Tests;

public class SocialAndReportingTests
{
    [Fact]
    public void SocialContacts_AddUnfriendAndBlockWorkflow()
    {
        var svc = new SocialAndReportingService();
        var friends = svc.GetFriends();
        Assert.True(friends.Count >= 3);

        var newFriend = svc.AddFriend("rachel.zane@lawcorp.com", "Rachel Zane");
        Assert.NotNull(newFriend);
        Assert.Equal(FriendshipStatus.Friend, newFriend.Status);

        // Block user
        var blocked = svc.BlockUser(newFriend.UserId);
        Assert.True(blocked);
        var blockedList = svc.GetBlockedUsers();
        Assert.Contains(blockedList, u => u.UserId == newFriend.UserId);

        // Unfriend
        var removed = svc.Unfriend(newFriend.UserId);
        Assert.True(removed);
    }

    [Fact]
    public void ExternalChatSharing_EnforcesOffCompanyAndReadOnlyGrants()
    {
        var svc = new SocialAndReportingService();
        var grant = svc.ShareAgenticChat("chat_demo_101", "guest.auditor@external.org", isOffCompany: true, isReadOnly: true);
        Assert.NotNull(grant);
        Assert.True(grant.IsOffCompanyAccount);
        Assert.True(grant.IsReadOnly);

        var retrieved = svc.GetChatGrantByToken(grant.AccessToken);
        Assert.NotNull(retrieved);
        Assert.Equal(grant.GrantId, retrieved.GrantId);
    }

    [Fact]
    public void AiEmergencyTriage_ClassifiesSpamAndTiersBugsAccurately()
    {
        var svc = new SocialAndReportingService();

        // Spam intake
        var spam = svc.IngestAndTriageReport("Free Crypto Casino Bonus", "Click here to claim 5000 USDT instantly", "spambot@spam.ru.spam", "email_intake");
        Assert.True(spam.IsFakeOrSpam);
        Assert.Equal("Spam", spam.Category);
        Assert.Equal(1, spam.EmergencyTier);

        // High tier security report
        var sec = svc.IngestAndTriageReport("Auth token vulnerability CVE check", "Possible secret leak in access.js token validation", "sec@corp.com", "feedback_form");
        Assert.False(sec.IsFakeOrSpam);
        Assert.Equal("Security", sec.Category);
        Assert.Equal(10, sec.EmergencyTier);

        // Bug with automated fix suggestion
        var bug = svc.IngestAndTriageReport("Discount calculation bug in cart.py", "Test failure in discount math", "dev@corp.com", "context_menu_rclick");
        Assert.False(bug.IsFakeOrSpam);
        Assert.Equal("Bug", bug.Category);
        Assert.Equal(7, bug.EmergencyTier);
        Assert.Contains("cart.py", bug.AutomatedFixSuggestion);
    }

    [Fact]
    public void Reports_FilterAndCommitWorkflow()
    {
        var svc = new SocialAndReportingService();
        var sortedByTier = svc.ListReports(filterFake: false, sortBy: "tier");
        Assert.NotEmpty(sortedByTier);
        Assert.True(sortedByTier[0].EmergencyTier >= sortedByTier[^1].EmergencyTier);

        var topReport = sortedByTier[0];
        var ok = svc.ApproveAndCommitFix(topReport.Id, "the VESPR team");
        Assert.True(ok);

        var updated = svc.ListReports().First(r => r.Id == topReport.Id);
        Assert.Equal("Committed", updated.FixStatus);
        Assert.Equal("the VESPR team", updated.CommittedBy);
    }
}
