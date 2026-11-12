using Vespr.Core;
using Xunit;

namespace Vespr.Core.Tests;

public class SmartRoleManagerTests
{
    [Fact]
    public void StandardRoles_SeededWithSecurityBoundaries()
    {
        var mgr = new SmartRoleManager();
        var roles = mgr.GetRoles();
        Assert.True(roles.Count >= 9);

        var student = mgr.GetRole("student");
        Assert.NotNull(student);
        Assert.Equal(ShellAccessTier.None, student.Shell);
        Assert.Equal(FileSystemAccessTier.ReadOnlyProject, student.FileSystem);
        Assert.False(student.AllowChatSharing);
        Assert.False(student.AllowSelfServiceDeactivation);
        Assert.Equal(DataRetentionTier.FERPACompliant365Days, student.Retention);

        var senior = mgr.GetRole("senior_dev");
        Assert.NotNull(senior);
        Assert.Equal(ShellAccessTier.FullHost, senior.Shell);
        Assert.Equal(AgentAutonomyTier.MultiAgentAutonomous, senior.Autonomy);

        var legal = mgr.GetRole("corporate_legal");
        Assert.NotNull(legal);
        Assert.Equal(ShellAccessTier.None, legal.Shell);
        Assert.Equal(DataRetentionTier.SOC2Compliant180Days, legal.Retention);
    }

    [Fact]
    public void BuiltInRoles_CannotBeDeleted()
    {
        var mgr = new SmartRoleManager();
        var deleted = mgr.DeleteRole("senior_dev");
        Assert.False(deleted);
        Assert.NotNull(mgr.GetRole("senior_dev"));
    }

    [Fact]
    public void CustomRole_CanBeCreatedUpdatedAndDeleted()
    {
        var mgr = new SmartRoleManager();
        var custom = new RoleDefinition(
            RoleId: "qa_tester",
            DisplayName: "QA Automation Tester",
            Description: "Runs automated e2e tests in sandbox",
            Flavor: "corporate",
            Shell: ShellAccessTier.SandboxedIsolated,
            FileSystem: FileSystemAccessTier.ProjectWorkspaceOnly,
            Network: NetworkAccessTier.AllowlistOnly,
            MaxDailyComputeTokens: 200000
        );

        Assert.True(mgr.CreateRole(custom));
        var fetched = mgr.GetRole("qa_tester");
        Assert.NotNull(fetched);
        Assert.Equal("QA Automation Tester", fetched.DisplayName);

        var updated = fetched with { MaxDailyComputeTokens = 300000 };
        Assert.True(mgr.UpdateRole(updated));
        Assert.Equal(300000, mgr.GetRole("qa_tester")?.MaxDailyComputeTokens);

        Assert.True(mgr.DeleteRole("qa_tester"));
        Assert.Null(mgr.GetRole("qa_tester"));
    }

    [Fact]
    public void SynthesizeRoleFromPrompt_ParsesDesignerRequirements()
    {
        var mgr = new SmartRoleManager();
        var synthesized = mgr.SynthesizeRoleFromPrompt("Contract graphic designer working on Canva slides and UI mockups, 80k tokens");

        Assert.Contains("custom_", synthesized.RoleId);
        Assert.Equal("Creative & UI Designer", synthesized.DisplayName);
        Assert.Equal(ShellAccessTier.None, synthesized.Shell);
        Assert.Equal(FileSystemAccessTier.ProjectWorkspaceOnly, synthesized.FileSystem);
        Assert.Equal(80000, synthesized.MaxDailyComputeTokens);
        Assert.Contains("Design", synthesized.Tags);
    }

    [Fact]
    public void SynthesizeRoleFromPrompt_ParsesDevOpsRequirements()
    {
        var mgr = new SmartRoleManager();
        var synthesized = mgr.SynthesizeRoleFromPrompt("Senior Cloud DevOps infrastructure lead managing Kubernetes, 500k tokens");

        Assert.Equal("Lead Cloud & DevOps Engineer", synthesized.DisplayName);
        Assert.Equal(ShellAccessTier.FullHost, synthesized.Shell);
        Assert.Equal(NetworkAccessTier.FullInternet, synthesized.Network);
        Assert.Equal(AgentAutonomyTier.MultiAgentAutonomous, synthesized.Autonomy);
        Assert.Equal(500000, synthesized.MaxDailyComputeTokens);
    }

    [Fact]
    public void UserRoleAssignment_AssignsAndRetrievesProperRole()
    {
        var mgr = new SmartRoleManager();
        mgr.AssignRoleToUser("intern.alice@apexsystems.com", "intern");

        var role = mgr.GetUserRole("intern.alice@apexsystems.com");
        Assert.Equal("intern", role.RoleId);
        Assert.Equal("Software Engineering Intern", role.DisplayName);
        Assert.Equal(ShellAccessTier.SandboxedIsolated, role.Shell);
    }
}