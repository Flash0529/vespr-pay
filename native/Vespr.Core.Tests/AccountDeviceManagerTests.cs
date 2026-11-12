using Vespr.Core;
using Xunit;

namespace Vespr.Core.Tests;

public class AccountDeviceManagerTests
{
    [Fact]
    public void SeedDefaultSessions_CreatesExpectedSessionsAndHistory()
    {
        var svc = new AccountDeviceService();
        svc.SeedDefaultSessions("alex_dev");

        var activeSessions = svc.GetActiveSessions("alex_dev");
        Assert.Equal(4, activeSessions.Count);

        var current = activeSessions.FirstOrDefault(s => s.IsCurrentDevice);
        Assert.NotNull(current);
        Assert.Equal("sess_desktop_win11", current.SessionId);
        Assert.Equal(ClientDeviceType.DesktopApp, current.ClientType);

        var history = svc.GetSessionHistory("alex_dev");
        Assert.NotEmpty(history);
        Assert.True(history.Count >= 3);
    }

    [Fact]
    public void RevokeSession_MarksSessionRevokedAndRecordsHistory()
    {
        var svc = new AccountDeviceService();
        svc.SeedDefaultSessions("alex_dev");

        var beforeCount = svc.GetActiveSessions("alex_dev").Count;
        var ok = svc.RevokeSession("alex_dev", "sess_mobile_ios", "Lost device");
        Assert.True(ok);

        var activeSessions = svc.GetActiveSessions("alex_dev");
        Assert.Equal(beforeCount - 1, activeSessions.Count);
        Assert.DoesNotContain(activeSessions, s => s.SessionId == "sess_mobile_ios");

        var revokedSession = svc.GetSession("sess_mobile_ios");
        Assert.NotNull(revokedSession);
        Assert.True(revokedSession.IsRevoked);
        Assert.Equal("alex_dev", revokedSession.RevokedBy);

        var history = svc.GetSessionHistory("alex_dev");
        Assert.Contains(history, h => h.EventType == "device_revoked" && h.Details.Contains("sess_mobile_ios"));
    }

    [Fact]
    public void RevokeAllOtherSessions_RevokesOnlyOtherDevices()
    {
        var svc = new AccountDeviceService();
        svc.SeedDefaultSessions("alex_dev", "sess_desktop_win11");

        var revokedCount = svc.RevokeAllOtherSessions("alex_dev", "sess_desktop_win11");
        Assert.Equal(3, revokedCount);

        var active = svc.GetActiveSessions("alex_dev");
        Assert.Single(active);
        Assert.Equal("sess_desktop_win11", active[0].SessionId);
        Assert.True(active[0].IsCurrentDevice);
    }

    [Theory]
    [InlineData("solo_dev", "dev_team", true)]
    [InlineData("solo_dev", "personal", true)]
    [InlineData("student", "school", false)]
    [InlineData("teacher", "school", false)]
    [InlineData("school_admin", "school", false)]
    [InlineData("junior_dev", "corporate", false)]
    [InlineData("senior_dev", "corporate", false)]
    [InlineData("corporate_legal", "corporate", false)]
    [InlineData("it_admin", "corporate", false)]
    public void IsSelfServiceDeactivationAllowed_FollowsCorporateAndSchoolPolicy(string role, string flavor, bool expected)
    {
        var allowed = AccountDeviceService.IsSelfServiceDeactivationAllowed(role, flavor);
        Assert.Equal(expected, allowed);
    }

    [Fact]
    public void ClearSessionHistory_BlocksCorporateAndSchoolUsers()
    {
        var svc = new AccountDeviceService();
        svc.SeedDefaultSessions("corp_dev");

        var cleared = svc.ClearSessionHistory("corp_dev", "senior_dev", "corporate", out var error);
        Assert.False(cleared);
        Assert.Contains("compliance", error, StringComparison.OrdinalIgnoreCase);

        var history = svc.GetSessionHistory("corp_dev");
        Assert.NotEmpty(history);
    }

    [Fact]
    public void ClearSessionHistory_AllowsSoloDev()
    {
        var svc = new AccountDeviceService();
        svc.SeedDefaultSessions("solo_user");

        var cleared = svc.ClearSessionHistory("solo_user", "solo_dev", "personal", out var error);
        Assert.True(cleared);
        Assert.Empty(error);

        var history = svc.GetSessionHistory("solo_user");
        Assert.Single(history);
        Assert.Equal("history_cleared", history[0].EventType);
    }

    [Fact]
    public void SuspendAccount_RequiresAuthorizedRole()
    {
        var svc = new AccountDeviceService();
        svc.SeedDefaultSessions("target_user");

        var ok = svc.SuspendAccount("junior_actor", "junior_dev", "target_user", "Suspicious activity", out var error);
        Assert.False(ok);
        Assert.Contains("Unauthorized", error);
        Assert.Equal(AccountLifecycleStatus.Active, svc.GetAccountLifecycle("target_user"));
    }

    [Fact]
    public void SuspendAccount_RevokesAllActiveSessions()
    {
        var svc = new AccountDeviceService();
        svc.SeedDefaultSessions("target_user");

        var ok = svc.SuspendAccount("sec_admin", "it_admin", "target_user", "Security Incident SEC-902", out var error);
        Assert.True(ok);
        Assert.Empty(error);
        Assert.Equal(AccountLifecycleStatus.Suspended, svc.GetAccountLifecycle("target_user"));

        var activeSessions = svc.GetActiveSessions("target_user");
        Assert.Empty(activeSessions);
    }

    [Fact]
    public void DeactivateAccount_BlocksUnauthorizedUsers()
    {
        var svc = new AccountDeviceService();
        svc.SeedDefaultSessions("employee_user");

        var ok = svc.DeactivateAccount("employee_user", "senior_dev", "employee_user", "Leaving company", out var error);
        Assert.False(ok);
        Assert.Contains("Unauthorized", error);
        Assert.Equal(AccountLifecycleStatus.Active, svc.GetAccountLifecycle("employee_user"));
    }

    [Fact]
    public void DeactivateAccount_SucceedsForItAdminAndLegal()
    {
        var svc = new AccountDeviceService();
        svc.SeedDefaultSessions("departing_emp");

        var ok = svc.DeactivateAccount("legal_officer", "corporate_legal", "departing_emp", "Voluntary separation", out var error);
        Assert.True(ok);
        Assert.Empty(error);
        Assert.Equal(AccountLifecycleStatus.Deactivated, svc.GetAccountLifecycle("departing_emp"));

        var activeSessions = svc.GetActiveSessions("departing_emp");
        Assert.Empty(activeSessions);
    }

    [Fact]
    public void ReactivateAccount_RestoresStatusToActive()
    {
        var svc = new AccountDeviceService();
        svc.SeedDefaultSessions("contractor");

        svc.SuspendAccount("admin", "it_admin", "contractor", "Contract renewal pending", out _);
        Assert.Equal(AccountLifecycleStatus.Suspended, svc.GetAccountLifecycle("contractor"));

        var reactivated = svc.ReactivateAccount("admin", "it_admin", "contractor", "Contract renewed", out var err);
        Assert.True(reactivated);
        Assert.Empty(err);
        Assert.Equal(AccountLifecycleStatus.Active, svc.GetAccountLifecycle("contractor"));
    }

    [Fact]
    public void GetCorporatePolicy_ReturnsCorrectComplianceDetails()
    {
        var corpPolicy = AccountDeviceService.GetCorporatePolicy("corporate", "Apex Systems");
        Assert.False(corpPolicy.AllowsSelfServiceDeactivation);
        Assert.False(corpPolicy.AllowsHistoryClearing);
        Assert.Equal(365, corpPolicy.RetentionPeriodDays);
        Assert.Contains("Apex Systems IT Security Policy", corpPolicy.EnforcingAuthority);

        var schoolPolicy = AccountDeviceService.GetCorporatePolicy("school", "Lincoln High");
        Assert.False(schoolPolicy.AllowsSelfServiceDeactivation);
        Assert.Contains("FERPA", schoolPolicy.EnforcingAuthority);
    }
}
