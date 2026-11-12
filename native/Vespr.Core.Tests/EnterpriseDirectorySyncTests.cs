using Vespr.Core;
using Xunit;

namespace Vespr.Core.Tests;

public class EnterpriseDirectorySyncTests
{
    [Fact]
    public void InitialDirectory_SyncsGitHubMembersAndAssignsRoles()
    {
        var roleMgr = new SmartRoleManager();
        var syncMgr = new EnterpriseDirectorySyncManager(roleMgr);

        var status = syncMgr.GetStatus();
        Assert.True(status.GitHubConnected);
        Assert.Equal("apex-systems-cloud", status.GitHubOrg);
        Assert.Equal(5, status.GitHubMembersCount);

        // Verify mapped roles
        var shamitRole = roleMgr.GetUserRole("owner@example.com");
        Assert.Equal("it_admin", shamitRole.RoleId);

        var alexRole = roleMgr.GetUserRole("alex.m@apexsystems.com");
        Assert.Equal("senior_dev", alexRole.RoleId);

        var devonRole = roleMgr.GetUserRole("devon.v@apexsystems.com");
        Assert.Equal("junior_dev", devonRole.RoleId);

        var elenaRole = roleMgr.GetUserRole("elena.r@corporate-legal.org");
        Assert.Equal("corporate_legal", elenaRole.RoleId);
    }

    [Fact]
    public void CustomTeamMapping_UpdatesMappedRole()
    {
        var roleMgr = new SmartRoleManager();
        var syncMgr = new EnterpriseDirectorySyncManager(roleMgr);

        syncMgr.SetTeamMapping("external-advisors", "corporate_legal");
        Assert.Equal("corporate_legal", syncMgr.GetTeamMappings()["external-advisors"]);

        var newMembers = new List<GitHubMemberRecord>
        {
            new("advisor-bob", "bob@advisory.com", "member", new() { "external-advisors" })
        };

        syncMgr.IngestGitHubMembers(newMembers);
        var bobRole = roleMgr.GetUserRole("bob@advisory.com");
        Assert.Equal("corporate_legal", bobRole.RoleId);
    }

    [Fact]
    public void ScimUserIngestion_MapsDepartmentsAndLogsAuditTrail()
    {
        var roleMgr = new SmartRoleManager();
        var syncMgr = new EnterpriseDirectorySyncManager(roleMgr);

        var scimUsers = new List<ScimUserRecord>
        {
            new("scim-101", "clara.c@apexsystems.com", "Legal", "Compliance Associate", Active: true),
            new("scim-102", "dave.it@apexsystems.com", "IT", "Systems Admin", Active: true),
            new("scim-103", "ex.employee@apexsystems.com", "Engineering", "Former Dev", Active: false)
        };

        syncMgr.IngestScimUsers(scimUsers);

        var claraRole = roleMgr.GetUserRole("clara.c@apexsystems.com");
        Assert.Equal("corporate_legal", claraRole.RoleId);

        var daveRole = roleMgr.GetUserRole("dave.it@apexsystems.com");
        Assert.Equal("it_admin", daveRole.RoleId);

        var audit = syncMgr.GetAuditTrail();
        Assert.Contains(audit, a => a.TargetUser == "ex.employee@apexsystems.com" && a.Action == "DEPROVISION_USER");
    }

    [Fact]
    public void SuspendedGitHubMember_SuspendsSeatAndUpdatesStatus()
    {
        var roleMgr = new SmartRoleManager();
        var syncMgr = new EnterpriseDirectorySyncManager(roleMgr);

        var suspendedMember = new List<GitHubMemberRecord>
        {
            new("compromised-user", "compromised@apexsystems.com", "member", new() { "backend-engineers" }, IsSuspended: true)
        };

        syncMgr.IngestGitHubMembers(suspendedMember);

        var status = syncMgr.GetStatus();
        Assert.True(status.SuspendedSeats >= 1);

        var audit = syncMgr.GetAuditTrail();
        Assert.Contains(audit, a => a.TargetUser == "compromised@apexsystems.com" && a.Action == "SUSPEND_SEAT");
    }
}