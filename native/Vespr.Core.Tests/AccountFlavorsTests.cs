using Vespr.Core;
using Xunit;

namespace Vespr.Core.Tests;

public class AccountFlavorsTests
{
    [Fact]
    public void FlavorsAndRoles_ContainsRequiredTypes()
    {
        Assert.Equal(3, AccountFlavors.Flavors.Length);
        Assert.Contains("school", AccountFlavors.Flavors);
        Assert.Contains("dev_team", AccountFlavors.Flavors);
        Assert.Contains("corporate", AccountFlavors.Flavors);

        Assert.Contains("student", AccountFlavors.Roles);
        Assert.Contains("teacher", AccountFlavors.Roles);
        Assert.Contains("school_admin", AccountFlavors.Roles);
        Assert.Contains("junior_dev", AccountFlavors.Roles);
        Assert.Contains("senior_dev", AccountFlavors.Roles);
        Assert.Contains("corporate_legal", AccountFlavors.Roles);
        Assert.Contains("solo_dev", AccountFlavors.Roles);
    }

    [Fact]
    public void PreconfiguredAccounts_HaveDistinctPermissions()
    {
        Assert.Equal(7, AccountFlavors.PreconfiguredAccounts.Count);

        var student = AccountFlavors.GetAccountById("acc_student_alex");
        Assert.Equal("school", student.Flavor);
        Assert.Equal("student", student.Role);
        Assert.Equal("CS101-FALL26-A4", student.ClassroomCode);
        Assert.False(student.Permissions.AllowBypass);
        Assert.False(student.Permissions.AllowShell);
        Assert.True(student.Permissions.AutograderAccess);

        var teacher = AccountFlavors.GetAccountById("acc_teacher_sarah");
        Assert.Equal("teacher", teacher.Role);
        Assert.True(teacher.Permissions.EditAssignments);
        Assert.False(teacher.Permissions.ManageClassrooms);

        var schoolAdmin = AccountFlavors.GetAccountById("acc_admin_marcus");
        Assert.Equal("school_admin", schoolAdmin.Role);
        Assert.True(schoolAdmin.Permissions.ManageClassrooms);

        var seniorDev = AccountFlavors.GetAccountById("acc_senior_alex");
        Assert.Equal("senior_dev", seniorDev.Role);
        Assert.True(seniorDev.Permissions.AllowBypass);
        Assert.True(seniorDev.Permissions.AllowShell);

        var legal = AccountFlavors.GetAccountById("acc_legal_elena");
        Assert.Equal("corporate_legal", legal.Role);
        Assert.True(legal.Permissions.ComplianceAudit);
    }

    [Fact]
    public void ClassroomManagement_AddsAndRemoves()
    {
        Assert.Equal(2, AccountFlavors.SampleClassrooms.Count);

        var updated = AccountFlavors.AddClassroom(new AccountFlavors.ClassroomInfo(
            "web301",
            "WEB301-FALL26",
            "Web Applications & Cloud Systems",
            "Prof. Sarah Jenkins",
            20,
            2,
            null,
            2
        ));

        Assert.Equal(3, updated.Count);
        var removed = AccountFlavors.RemoveClassroom("cs201", updated);
        Assert.Equal(2, removed.Count);
        Assert.DoesNotContain(removed, r => r.Id == "cs201");
    }

    [Fact]
    public void GradeAssignmentSubmission_CalculatesRubric()
    {
        var perfect = AccountFlavors.GradeAssignmentSubmission(AccountFlavors.SampleAssignment.StarterCode);
        Assert.Equal(100, perfect.PointsPossible);
        Assert.Equal(100, perfect.TotalScore);
        Assert.True(perfect.Passed);
        Assert.Equal(4, perfect.Results.Count);

        var incomplete = AccountFlavors.GradeAssignmentSubmission("x = 1");
        Assert.Equal(0, incomplete.TotalScore);
        Assert.False(incomplete.Passed);
    }

    [Fact]
    public void GetWalkthroughTour_AdaptsToRole()
    {
        var studentTour = AccountFlavors.GetWalkthroughTour("student", "school");
        Assert.Equal("Student Classroom SDE Tour", studentTour.Title);
        Assert.Equal(4, studentTour.Steps.Count);

        var teacherTour = AccountFlavors.GetWalkthroughTour("teacher", "school");
        Assert.Equal("Teacher Course & Classroom Tour", teacherTour.Title);

        var legalTour = AccountFlavors.GetWalkthroughTour("corporate_legal", "corporate");
        Assert.Equal("Corporate Legal & Governance Tour", legalTour.Title);
    }

    [Fact]
    public void StripeCheckoutAndMerchant_SimulateTransactions()
    {
        Assert.Equal(3, AccountFlavors.StripePacks.Count);

        var res = AccountFlavors.SimulateStripeCheckout("acc_senior_alex", "credit-20", 20.0);
        Assert.True(res.Success);
        Assert.Equal(20.0, res.CreditsAddedUsd);
        Assert.Equal(40.0, res.NewBalanceUsd);
        Assert.StartsWith("cs_test_", res.TransactionId, StringComparison.Ordinal);

        var purchase = AccountFlavors.SimulateInAppMerchantPurchase("acc_senior_alex", "buyer@apex.io", 2000, "Pro Plan");
        Assert.True(purchase.Success);
        Assert.Equal(20.0, purchase.AmountUsd);
        Assert.Equal("succeeded", purchase.Status);
    }
}
