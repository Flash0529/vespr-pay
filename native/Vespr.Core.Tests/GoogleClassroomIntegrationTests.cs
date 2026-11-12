using Xunit;

namespace Vespr.Core.Tests;

public class GoogleClassroomIntegrationTests
{
    [Fact]
    public void ServiceInitializesWithDefaults()
    {
        var svc = new GoogleClassroomService(seedDefaults: true);
        var status = svc.GetSyncStatus();

        Assert.True(status.IsConnected);
        Assert.Equal("sarah.jenkins@lincoln-high.edu", status.UserEmail);
        Assert.Equal("cs101", status.ActiveCourseId);
        Assert.Equal(2, status.CoursesCount);
        Assert.Equal(2, status.AssignmentsCount);
        Assert.Equal(4, status.SubmissionsCount);
    }

    [Fact]
    public void ConnectAndDisconnect_ManagesConnectionState()
    {
        var svc = new GoogleClassroomService(seedDefaults: false);
        var initial = svc.GetSyncStatus();
        Assert.False(initial.IsConnected);

        var connected = svc.Connect("alex.morgan@lincoln-high.edu", "oauth2_token_xyz");
        Assert.True(connected.IsConnected);
        Assert.Equal("alex.morgan@lincoln-high.edu", connected.UserEmail);

        var disconnected = svc.Disconnect();
        Assert.False(disconnected.IsConnected);
        Assert.Empty(disconnected.UserEmail);
    }

    [Fact]
    public void ListCourses_ReturnsExpectedCoursesAndAllowsLookup()
    {
        var svc = new GoogleClassroomService();
        var courses = svc.ListCourses();

        Assert.Contains(courses, c => c.Id == "cs101" && c.EnrollmentCode == "CS101-FALL26-A4");
        Assert.Contains(courses, c => c.Id == "cs201" && c.EnrollmentCode == "CS201-FALL26-B2");

        var cs101 = svc.GetCourse("cs101");
        Assert.NotNull(cs101);
        Assert.Equal("Lab 3B", cs101.Room);
        Assert.Equal(28, cs101.StudentCount);
    }

    [Fact]
    public void CreateCourse_AddsNewCourseAndRejectsDuplicate()
    {
        var svc = new GoogleClassroomService();
        var newCourse = new GoogleClassroomCourse(
            "cs301",
            "CS 301: Distributed Systems & Consensus",
            "Period 6",
            "Computer Science",
            "Lab 1A",
            "CS301-FALL26-C3",
            "https://classroom.google.com/c/cs301",
            GoogleClassroomCourseState.Active,
            "marcus.vance@lincoln-high.edu",
            18,
            DateTime.UtcNow);

        var res = svc.CreateCourse(newCourse);
        Assert.True(res.Success);
        Assert.Equal("cs301", res.EntityId);

        var duplicateRes = svc.CreateCourse(newCourse);
        Assert.False(duplicateRes.Success);
        Assert.Contains("already exists", duplicateRes.Message);
    }

    [Fact]
    public void ListCourseWork_ReturnsAssignmentsForCourse()
    {
        var svc = new GoogleClassroomService();
        var cwList = svc.ListCourseWork("cs101");

        Assert.Single(cwList);
        var hw1 = cwList[0];
        Assert.Equal("hw1_inverted_index", hw1.Id);
        Assert.Equal(100, hw1.MaxPoints);
        Assert.Contains("build_inverted_index", hw1.StarterCode);

        var direct = svc.GetCourseWork("cs101", "hw1_inverted_index");
        Assert.NotNull(direct);
        Assert.Equal(GoogleClassroomCourseWorkState.Published, direct.State);
    }

    [Fact]
    public void TurnInAssignment_UpdatesSubmissionStateAndAutograderDraft()
    {
        var svc = new GoogleClassroomService();
        var req = new GoogleClassroomTurnInRequest(
            "cs101",
            "hw1_inverted_index",
            "acc_student_devon",
            "Devon Smith",
            "def build_inverted_index(documents):\n    return { 'sample': { 1 } }\n",
            100.0,
            "Exact Match: 30/30, Prefix: 30/30, Ranking: 20/20, Latency: 20/20");

        var res = svc.TurnInAssignment(req);
        Assert.True(res.Success);
        Assert.Contains("Successfully turned in", res.Message);

        var sub = svc.GetUserSubmission("cs101", "hw1_inverted_index", "acc_student_devon");
        Assert.NotNull(sub);
        Assert.Equal(GoogleClassroomSubmissionState.TurnedIn, sub.State);
        Assert.Equal(100.0, sub.DraftGrade);
        Assert.NotNull(sub.TurnInTime);
        Assert.Contains("Exact Match: 30/30", sub.AutograderSummary);
    }

    [Fact]
    public void TurnInAssignment_Disconnected_ReturnsError()
    {
        var svc = new GoogleClassroomService();
        svc.Disconnect();

        var req = new GoogleClassroomTurnInRequest(
            "cs101",
            "hw1_inverted_index",
            "acc_student_alex",
            "Alex Morgan",
            "code",
            100.0,
            "summary");

        var res = svc.TurnInAssignment(req);
        Assert.False(res.Success);
        Assert.Contains("not connected", res.Message);
    }

    [Fact]
    public void ReturnSubmissionWithGrade_SetsAssignedGradeAndReturnedState()
    {
        var svc = new GoogleClassroomService();
        var req = new GoogleClassroomGradeSyncRequest(
            "cs101",
            "hw1_inverted_index",
            "sub_alex_001",
            100.0,
            "Outstanding work on the inverted search index!");

        var res = svc.ReturnSubmissionWithGrade(req);
        Assert.True(res.Success);
        Assert.Contains("returned to student", res.Message);

        var sub = svc.GetUserSubmission("cs101", "hw1_inverted_index", "acc_student_alex");
        Assert.NotNull(sub);
        Assert.Equal(GoogleClassroomSubmissionState.Returned, sub.State);
        Assert.Equal(100.0, sub.AssignedGrade);
    }

    [Fact]
    public void SyncAllGrades_BatchUpdatesGradebookOnGoogleClassroom()
    {
        var svc = new GoogleClassroomService();
        var updates = new List<GoogleClassroomGradeSyncRequest>
        {
            new("cs101", "hw1_inverted_index", "sub_alex_001", 100.0),
            new("cs101", "hw1_inverted_index", "sub_maya_002", 90.0),
            new("cs101", "hw1_inverted_index", "sub_carlos_003", 85.0)
        };

        var res = svc.SyncAllGrades("cs101", "hw1_inverted_index", updates);
        Assert.True(res.Success);
        Assert.Contains("Synced 3 student grades", res.Message);

        var submissions = svc.ListSubmissions("cs101", "hw1_inverted_index");
        var carlos = submissions.First(s => s.UserId == "acc_student_carlos");
        Assert.Equal(85.0, carlos.AssignedGrade);
        Assert.Equal(GoogleClassroomSubmissionState.Returned, carlos.State);
    }

    [Fact]
    public void SetActiveCourse_UpdatesCurrentCourseInStatus()
    {
        var svc = new GoogleClassroomService();
        svc.SetActiveCourse("cs201");
        var status = svc.GetSyncStatus();

        Assert.Equal("cs201", status.ActiveCourseId);
    }
}
