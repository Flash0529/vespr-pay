using System.Globalization;

namespace Vespr.Core;

public enum GoogleClassroomRole
{
    Student,
    Teacher,
    Admin
}

public enum GoogleClassroomCourseState
{
    Active,
    Archived,
    Provisioned
}

public enum GoogleClassroomCourseWorkState
{
    Published,
    Draft,
    Deleted
}

public enum GoogleClassroomSubmissionState
{
    New,
    Created,
    TurnedIn,
    Returned,
    ReclaimedByStudent
}

public record GoogleClassroomCourse(
    string Id,
    string Name,
    string Section,
    string DescriptionHeading,
    string Room,
    string EnrollmentCode,
    string AlternateLink,
    GoogleClassroomCourseState State,
    string TeacherEmail,
    int StudentCount,
    DateTime CreationTime);

public record GoogleClassroomCourseWork(
    string Id,
    string CourseId,
    string Title,
    string Description,
    string Materials,
    GoogleClassroomCourseWorkState State,
    string AlternateLink,
    DateTime DueDate,
    int MaxPoints,
    string WorkType,
    string StarterCode);

public record GoogleClassroomSubmission(
    string Id,
    string CourseId,
    string CourseWorkId,
    string UserId,
    string StudentName,
    GoogleClassroomSubmissionState State,
    double? AssignedGrade,
    double? DraftGrade,
    string AlternateLink,
    DateTime? TurnInTime,
    string SubmittedCode,
    string AutograderSummary);

public record GoogleClassroomSyncStatus(
    bool IsConnected,
    string UserEmail,
    string ActiveCourseId,
    DateTime LastSyncedAt,
    int CoursesCount,
    int AssignmentsCount,
    int SubmissionsCount);

public record GoogleClassroomTurnInRequest(
    string CourseId,
    string CourseWorkId,
    string UserId,
    string StudentName,
    string Code,
    double AutograderScore,
    string RubricSummary);

public record GoogleClassroomGradeSyncRequest(
    string CourseId,
    string CourseWorkId,
    string SubmissionId,
    double AssignedGrade,
    string? Feedback = null);

public record GoogleClassroomOperationResult(
    bool Success,
    string Message,
    string? EntityId = null);

/// <summary>
/// Native Google Classroom integration service for VESPR SDE.
/// Provides bidirectional sync for courses, coursework assignments, autograder scores, and turn-ins.
/// </summary>
public class GoogleClassroomService
{
    private readonly object _lock = new();
    private bool _isConnected;
    private string _userEmail = "";
    private string _activeCourseId = "cs101";
    private DateTime _lastSyncedAt = DateTime.MinValue;

    private readonly List<GoogleClassroomCourse> _courses = [];
    private readonly List<GoogleClassroomCourseWork> _assignments = [];
    private readonly List<GoogleClassroomSubmission> _submissions = [];

    public GoogleClassroomService(bool seedDefaults = true)
    {
        if (seedDefaults)
        {
            _courses.AddRange(CreateDefaultCourses());
            _assignments.AddRange(CreateDefaultCourseWork());
            _submissions.AddRange(CreateDefaultSubmissions());
            _isConnected = true;
            _userEmail = "sarah.jenkins@lincoln-high.edu";
            _lastSyncedAt = DateTime.UtcNow;
        }
    }

    public GoogleClassroomSyncStatus Connect(string userEmail, string accessToken = "mock_gc_token")
    {
        lock (_lock)
        {
            if (string.IsNullOrWhiteSpace(userEmail))
            {
                throw new ArgumentException("User email cannot be empty", nameof(userEmail));
            }

            _isConnected = true;
            _userEmail = userEmail;
            _lastSyncedAt = DateTime.UtcNow;
            return GetSyncStatus();
        }
    }

    public GoogleClassroomSyncStatus Disconnect()
    {
        lock (_lock)
        {
            _isConnected = false;
            _userEmail = "";
            return GetSyncStatus();
        }
    }

    public GoogleClassroomSyncStatus GetSyncStatus()
    {
        lock (_lock)
        {
            return new GoogleClassroomSyncStatus(
                _isConnected,
                _userEmail,
                _activeCourseId,
                _lastSyncedAt,
                _courses.Count,
                _assignments.Count,
                _submissions.Count);
        }
    }

    public void SetActiveCourse(string courseId)
    {
        lock (_lock)
        {
            _activeCourseId = courseId;
        }
    }

    public IReadOnlyList<GoogleClassroomCourse> ListCourses(GoogleClassroomCourseState? state = null)
    {
        lock (_lock)
        {
            return state.HasValue
                ? _courses.Where(c => c.State == state.Value).ToList().AsReadOnly()
                : _courses.ToList().AsReadOnly();
        }
    }

    public GoogleClassroomCourse? GetCourse(string courseId)
    {
        lock (_lock)
        {
            return _courses.FirstOrDefault(c => string.Equals(c.Id, courseId, StringComparison.OrdinalIgnoreCase));
        }
    }

    public GoogleClassroomOperationResult CreateCourse(GoogleClassroomCourse course)
    {
        lock (_lock)
        {
            if (string.IsNullOrWhiteSpace(course.Id) || string.IsNullOrWhiteSpace(course.Name))
            {
                return new GoogleClassroomOperationResult(false, "Course Id and Name are required");
            }

            if (_courses.Any(c => string.Equals(c.Id, course.Id, StringComparison.OrdinalIgnoreCase)))
            {
                return new GoogleClassroomOperationResult(false, $"Course with ID '{course.Id}' already exists");
            }

            _courses.Add(course);
            _lastSyncedAt = DateTime.UtcNow;
            return new GoogleClassroomOperationResult(true, $"Course '{course.Name}' created successfully", course.Id);
        }
    }

    public IReadOnlyList<GoogleClassroomCourseWork> ListCourseWork(string courseId)
    {
        lock (_lock)
        {
            return _assignments
                .Where(a => string.Equals(a.CourseId, courseId, StringComparison.OrdinalIgnoreCase))
                .ToList()
                .AsReadOnly();
        }
    }

    public GoogleClassroomCourseWork? GetCourseWork(string courseId, string courseWorkId)
    {
        lock (_lock)
        {
            return _assignments.FirstOrDefault(a =>
                string.Equals(a.CourseId, courseId, StringComparison.OrdinalIgnoreCase) &&
                string.Equals(a.Id, courseWorkId, StringComparison.OrdinalIgnoreCase));
        }
    }

    public GoogleClassroomOperationResult CreateCourseWork(GoogleClassroomCourseWork courseWork)
    {
        lock (_lock)
        {
            if (string.IsNullOrWhiteSpace(courseWork.Id) || string.IsNullOrWhiteSpace(courseWork.Title))
            {
                return new GoogleClassroomOperationResult(false, "CourseWork Id and Title are required");
            }

            if (_assignments.Any(a => string.Equals(a.Id, courseWork.Id, StringComparison.OrdinalIgnoreCase)))
            {
                return new GoogleClassroomOperationResult(false, $"CourseWork with ID '{courseWork.Id}' already exists");
            }

            _assignments.Add(courseWork);
            _lastSyncedAt = DateTime.UtcNow;
            return new GoogleClassroomOperationResult(true, $"CourseWork '{courseWork.Title}' published to Google Classroom", courseWork.Id);
        }
    }

    public IReadOnlyList<GoogleClassroomSubmission> ListSubmissions(string courseId, string courseWorkId)
    {
        lock (_lock)
        {
            return _submissions
                .Where(s =>
                    string.Equals(s.CourseId, courseId, StringComparison.OrdinalIgnoreCase) &&
                    string.Equals(s.CourseWorkId, courseWorkId, StringComparison.OrdinalIgnoreCase))
                .ToList()
                .AsReadOnly();
        }
    }

    public GoogleClassroomSubmission? GetUserSubmission(string courseId, string courseWorkId, string userId)
    {
        lock (_lock)
        {
            return _submissions.FirstOrDefault(s =>
                string.Equals(s.CourseId, courseId, StringComparison.OrdinalIgnoreCase) &&
                string.Equals(s.CourseWorkId, courseWorkId, StringComparison.OrdinalIgnoreCase) &&
                string.Equals(s.UserId, userId, StringComparison.OrdinalIgnoreCase));
        }
    }

    public GoogleClassroomOperationResult TurnInAssignment(GoogleClassroomTurnInRequest request)
    {
        lock (_lock)
        {
            if (!_isConnected)
            {
                return new GoogleClassroomOperationResult(false, "Google Classroom account is not connected");
            }

            if (string.IsNullOrWhiteSpace(request.CourseId) || string.IsNullOrWhiteSpace(request.CourseWorkId))
            {
                return new GoogleClassroomOperationResult(false, "Course ID and CourseWork ID are required");
            }

            var existingIndex = _submissions.FindIndex(s =>
                string.Equals(s.CourseId, request.CourseId, StringComparison.OrdinalIgnoreCase) &&
                string.Equals(s.CourseWorkId, request.CourseWorkId, StringComparison.OrdinalIgnoreCase) &&
                string.Equals(s.UserId, request.UserId, StringComparison.OrdinalIgnoreCase));

            var submissionId = existingIndex >= 0 ? _submissions[existingIndex].Id : $"sub_{request.UserId}_{DateTime.UtcNow.Ticks}";
            var altLink = $"https://classroom.google.com/c/{request.CourseId}/a/{request.CourseWorkId}/submissions/by-user/{request.UserId}";

            var updatedSubmission = new GoogleClassroomSubmission(
                submissionId,
                request.CourseId,
                request.CourseWorkId,
                request.UserId,
                request.StudentName,
                GoogleClassroomSubmissionState.TurnedIn,
                AssignedGrade: null,
                DraftGrade: request.AutograderScore,
                altLink,
                DateTime.UtcNow,
                request.Code,
                request.RubricSummary);

            if (existingIndex >= 0)
            {
                _submissions[existingIndex] = updatedSubmission;
            }
            else
            {
                _submissions.Add(updatedSubmission);
            }

            _lastSyncedAt = DateTime.UtcNow;
            return new GoogleClassroomOperationResult(true, $"Successfully turned in assignment to Google Classroom with score {request.AutograderScore:0.#}", submissionId);
        }
    }

    public GoogleClassroomOperationResult ReturnSubmissionWithGrade(GoogleClassroomGradeSyncRequest request)
    {
        lock (_lock)
        {
            if (!_isConnected)
            {
                return new GoogleClassroomOperationResult(false, "Google Classroom account is not connected");
            }

            var index = _submissions.FindIndex(s =>
                string.Equals(s.CourseId, request.CourseId, StringComparison.OrdinalIgnoreCase) &&
                string.Equals(s.CourseWorkId, request.CourseWorkId, StringComparison.OrdinalIgnoreCase) &&
                string.Equals(s.Id, request.SubmissionId, StringComparison.OrdinalIgnoreCase));

            if (index < 0)
            {
                return new GoogleClassroomOperationResult(false, $"Submission with ID '{request.SubmissionId}' not found");
            }

            var sub = _submissions[index];
            var returned = sub with
            {
                State = GoogleClassroomSubmissionState.Returned,
                AssignedGrade = request.AssignedGrade,
                DraftGrade = request.AssignedGrade
            };

            _submissions[index] = returned;
            _lastSyncedAt = DateTime.UtcNow;
            return new GoogleClassroomOperationResult(true, $"Grade {request.AssignedGrade:0.#} returned to student {sub.StudentName} on Google Classroom", sub.Id);
        }
    }

    public GoogleClassroomOperationResult SyncAllGrades(string courseId, string courseWorkId, IEnumerable<GoogleClassroomGradeSyncRequest> updates)
    {
        lock (_lock)
        {
            if (!_isConnected)
            {
                return new GoogleClassroomOperationResult(false, "Google Classroom account is not connected");
            }

            int count = 0;
            foreach (var upd in updates)
            {
                var res = ReturnSubmissionWithGrade(upd);
                if (res.Success) count++;
            }

            _lastSyncedAt = DateTime.UtcNow;
            return new GoogleClassroomOperationResult(true, $"Synced {count} student grades to Google Classroom gradebook", courseWorkId);
        }
    }

    public static List<GoogleClassroomCourse> CreateDefaultCourses()
    {
        return
        [
            new GoogleClassroomCourse(
                "cs101",
                "CS 101: Introduction to Algorithms & Inverted Indices",
                "Period 2",
                "Computer Science Department",
                "Lab 3B",
                "CS101-FALL26-A4",
                "https://classroom.google.com/c/cs101",
                GoogleClassroomCourseState.Active,
                "sarah.jenkins@lincoln-high.edu",
                28,
                DateTime.Parse("2026-08-25T08:00:00Z", CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal)),
            new GoogleClassroomCourse(
                "cs201",
                "CS 201: Systems Programming & C# Native Architecture",
                "Period 5",
                "Advanced Computer Science",
                "Lab 5A",
                "CS201-FALL26-B2",
                "https://classroom.google.com/c/cs201",
                GoogleClassroomCourseState.Active,
                "sarah.jenkins@lincoln-high.edu",
                22,
                DateTime.Parse("2026-08-26T10:00:00Z", CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal))
        ];
    }

    public static List<GoogleClassroomCourseWork> CreateDefaultCourseWork()
    {
        return
        [
            new GoogleClassroomCourseWork(
                "hw1_inverted_index",
                "cs101",
                "Assignment 1: High-Performance Inverted Search Index & Auto-fill",
                "Implement an in-memory inverted search index and query matcher mapping tokens to document IDs with ranking.",
                "Lecture 4 Slides; Unit Test Harness",
                GoogleClassroomCourseWorkState.Published,
                "https://classroom.google.com/c/cs101/a/hw1_inverted_index/details",
                DateTime.Parse("2026-11-15T23:59:59Z", CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal),
                100,
                "ASSIGNMENT",
                "def build_inverted_index(documents):\n    index = {}\n    for doc_id, text in documents.items():\n        for word in text.lower().split():\n            index.setdefault(word, set()).add(doc_id)\n    return index\n"),
            new GoogleClassroomCourseWork(
                "hw2_csharp_filesystem",
                "cs201",
                "Assignment 2: Native Dual-Directory File System & RBAC Governance",
                "Implement role-based sandbox traversal rules between workspace and host operating systems.",
                "Architecture Spec; xUnit Runner",
                GoogleClassroomCourseWorkState.Published,
                "https://classroom.google.com/c/cs201/a/hw2_csharp_filesystem/details",
                DateTime.Parse("2026-11-20T23:59:59Z", CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal),
                100,
                "ASSIGNMENT",
                "namespace Vespr.Core;\npublic class FsExercise { }\n")
        ];
    }

    public static List<GoogleClassroomSubmission> CreateDefaultSubmissions()
    {
        return
        [
            new GoogleClassroomSubmission(
                "sub_alex_001",
                "cs101",
                "hw1_inverted_index",
                "acc_student_alex",
                "Alex Morgan",
                GoogleClassroomSubmissionState.TurnedIn,
                AssignedGrade: null,
                DraftGrade: 100.0,
                "https://classroom.google.com/c/cs101/a/hw1_inverted_index/submissions/by-user/acc_student_alex",
                DateTime.Parse("2026-11-04T23:42:00Z", CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal),
                "def build_inverted_index(documents):\n    return {}\n",
                "Exact Token Match: 30/30, Prefix Auto-Fill: 30/30, Ranking: 20/20, Latency: 20/20"),
            new GoogleClassroomSubmission(
                "sub_maya_002",
                "cs101",
                "hw1_inverted_index",
                "acc_student_maya",
                "Maya Lin",
                GoogleClassroomSubmissionState.TurnedIn,
                AssignedGrade: null,
                DraftGrade: 90.0,
                "https://classroom.google.com/c/cs101/a/hw1_inverted_index/submissions/by-user/acc_student_maya",
                DateTime.Parse("2026-11-04T22:15:00Z", CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal),
                "def build_inverted_index(documents):\n    return {}\n",
                "Exact Token Match: 30/30, Prefix Auto-Fill: 30/30, Ranking: 10/20, Latency: 20/20"),
            new GoogleClassroomSubmission(
                "sub_carlos_003",
                "cs101",
                "hw1_inverted_index",
                "acc_student_carlos",
                "Carlos Ortiz",
                GoogleClassroomSubmissionState.TurnedIn,
                AssignedGrade: null,
                DraftGrade: 80.0,
                "https://classroom.google.com/c/cs101/a/hw1_inverted_index/submissions/by-user/acc_student_carlos",
                DateTime.Parse("2026-11-04T20:30:00Z", CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal),
                "def build_inverted_index(documents):\n    return {}\n",
                "Exact Token Match: 30/30, Prefix Auto-Fill: 30/30, Ranking: 0/20, Latency: 20/20"),
            new GoogleClassroomSubmission(
                "sub_devon_004",
                "cs101",
                "hw1_inverted_index",
                "acc_student_devon",
                "Devon Smith",
                GoogleClassroomSubmissionState.Created,
                AssignedGrade: null,
                DraftGrade: 0.0,
                "https://classroom.google.com/c/cs101/a/hw1_inverted_index/submissions/by-user/acc_student_devon",
                null,
                "",
                "Not yet submitted")
        ];
    }
}
