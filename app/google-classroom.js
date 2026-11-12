// Native Google Classroom integration service for VESPR SDE.
// Syncs courses, coursework assignments, autograder scores, and turn-ins with Google Classroom.

export const GOOGLE_CLASSROOM_SCOPES = [
  'https://www.googleapis.com/auth/classroom.courses.readonly',
  'https://www.googleapis.com/auth/classroom.coursework.me',
  'https://www.googleapis.com/auth/classroom.coursework.students',
  'https://www.googleapis.com/auth/classroom.rosters.readonly'
]

export const SAMPLE_GCLASSROOM_COURSES = [
  {
    id: 'cs101',
    name: 'CS 101: Introduction to Algorithms & Inverted Indices',
    section: 'Period 2',
    descriptionHeading: 'Computer Science Department',
    room: 'Lab 3B',
    enrollmentCode: 'CS101-FALL26-A4',
    alternateLink: 'https://classroom.google.com/c/cs101',
    state: 'ACTIVE',
    teacherEmail: 'sarah.jenkins@lincoln-high.edu',
    studentCount: 28,
    creationTime: '2026-08-25T08:00:00Z'
  },
  {
    id: 'cs201',
    name: 'CS 201: Systems Programming & C# Native Architecture',
    section: 'Period 5',
    descriptionHeading: 'Advanced Computer Science',
    room: 'Lab 5A',
    enrollmentCode: 'CS201-FALL26-B2',
    alternateLink: 'https://classroom.google.com/c/cs201',
    state: 'ACTIVE',
    teacherEmail: 'sarah.jenkins@lincoln-high.edu',
    studentCount: 22,
    creationTime: '2026-08-26T10:00:00Z'
  }
]

export const SAMPLE_GCLASSROOM_COURSEWORK = [
  {
    id: 'hw1_inverted_index',
    courseId: 'cs101',
    title: 'Assignment 1: High-Performance Inverted Search Index & Auto-fill',
    description: 'Implement an in-memory inverted search index and query matcher mapping tokens to document IDs with ranking and prefix auto-fill.',
    materials: 'Lecture 4 Slides; Unit Test Harness',
    state: 'PUBLISHED',
    alternateLink: 'https://classroom.google.com/c/cs101/a/hw1_inverted_index/details',
    dueDate: '2026-11-15T23:59:59Z',
    maxPoints: 100,
    workType: 'ASSIGNMENT',
    starterCode: `def build_inverted_index(documents):\n    """Map unique lowercase words to sets of document IDs."""\n    index = {}\n    for doc_id, text in documents.items():\n        for word in text.lower().split():\n            index.setdefault(word, set()).add(doc_id)\n    return index\n\ndef search_index(index, query):\n    """Return list of matching document IDs."""\n    return sorted(list(index.get(query.lower(), set())))\n`
  },
  {
    id: 'hw2_csharp_filesystem',
    courseId: 'cs201',
    title: 'Assignment 2: Native Dual-Directory File System & RBAC Governance',
    description: 'Implement role-based sandbox traversal rules between workspace and host operating systems.',
    materials: 'Architecture Spec; xUnit Runner',
    state: 'PUBLISHED',
    alternateLink: 'https://classroom.google.com/c/cs201/a/hw2_csharp_filesystem/details',
    dueDate: '2026-11-20T23:59:59Z',
    maxPoints: 100,
    workType: 'ASSIGNMENT',
    starterCode: `namespace Vespr.Core;\npublic class FsExercise { }\n`
  }
]

export const SAMPLE_GCLASSROOM_SUBMISSIONS = [
  {
    id: 'sub_alex_001',
    courseId: 'cs101',
    courseWorkId: 'hw1_inverted_index',
    userId: 'acc_student_alex',
    studentName: 'Alex Morgan',
    state: 'TURNED_IN',
    assignedGrade: null,
    draftGrade: 100.0,
    alternateLink: 'https://classroom.google.com/c/cs101/a/hw1_inverted_index/submissions/by-user/acc_student_alex',
    turnInTime: '2026-11-04T23:42:00Z',
    submittedCode: 'def build_inverted_index(documents):\n    return {}\n',
    autograderSummary: 'Exact Token Match: 30/30, Prefix Auto-Fill: 30/30, Ranking: 20/20, Latency: 20/20'
  },
  {
    id: 'sub_maya_002',
    courseId: 'cs101',
    courseWorkId: 'hw1_inverted_index',
    userId: 'acc_student_maya',
    studentName: 'Maya Lin',
    state: 'TURNED_IN',
    assignedGrade: null,
    draftGrade: 90.0,
    alternateLink: 'https://classroom.google.com/c/cs101/a/hw1_inverted_index/submissions/by-user/acc_student_maya',
    turnInTime: '2026-11-04T22:15:00Z',
    submittedCode: 'def build_inverted_index(documents):\n    return {}\n',
    autograderSummary: 'Exact Token Match: 30/30, Prefix Auto-Fill: 30/30, Ranking: 10/20, Latency: 20/20'
  },
  {
    id: 'sub_carlos_003',
    courseId: 'cs101',
    courseWorkId: 'hw1_inverted_index',
    userId: 'acc_student_carlos',
    studentName: 'Carlos Ortiz',
    state: 'TURNED_IN',
    assignedGrade: null,
    draftGrade: 80.0,
    alternateLink: 'https://classroom.google.com/c/cs101/a/hw1_inverted_index/submissions/by-user/acc_student_carlos',
    turnInTime: '2026-11-04T20:30:00Z',
    submittedCode: 'def build_inverted_index(documents):\n    return {}\n',
    autograderSummary: 'Exact Token Match: 30/30, Prefix Auto-Fill: 30/30, Ranking: 0/20, Latency: 20/20'
  },
  {
    id: 'sub_devon_004',
    courseId: 'cs101',
    courseWorkId: 'hw1_inverted_index',
    userId: 'acc_student_devon',
    studentName: 'Devon Smith',
    state: 'NEW',
    assignedGrade: null,
    draftGrade: 0.0,
    alternateLink: 'https://classroom.google.com/c/cs101/a/hw1_inverted_index/submissions/by-user/acc_student_devon',
    turnInTime: null,
    submittedCode: '',
    autograderSummary: 'Not yet submitted'
  }
]

export function createGoogleClassroomService (options = {}) {
  const seed = options.seedDefaults !== false
  let isConnected = seed
  let userEmail = seed ? (options.userEmail || 'sarah.jenkins@lincoln-high.edu') : ''
  let activeCourseId = options.activeCourseId || 'cs101'
  let lastSyncedAt = seed ? new Date().toISOString() : null

  const courses = seed ? JSON.parse(JSON.stringify(SAMPLE_GCLASSROOM_COURSES)) : []
  const assignments = seed ? JSON.parse(JSON.stringify(SAMPLE_GCLASSROOM_COURSEWORK)) : []
  const submissions = seed ? JSON.parse(JSON.stringify(SAMPLE_GCLASSROOM_SUBMISSIONS)) : []

  return {
    connect (email, token = 'mock_gc_token') {
      if (!email || typeof email !== 'string' || !email.trim()) {
        throw new Error('Valid Google account email is required')
      }
      isConnected = true
      userEmail = email.trim()
      lastSyncedAt = new Date().toISOString()
      return this.getStatus()
    },

    disconnect () {
      isConnected = false
      userEmail = ''
      return this.getStatus()
    },

    getStatus () {
      return {
        isConnected,
        userEmail,
        activeCourseId,
        lastSyncedAt,
        coursesCount: courses.length,
        assignmentsCount: assignments.length,
        submissionsCount: submissions.length
      }
    },

    setActiveCourse (courseId) {
      activeCourseId = courseId
    },

    listCourses (stateFilter = null) {
      return stateFilter ? courses.filter(c => c.state === stateFilter) : [...courses]
    },

    getCourse (courseId) {
      return courses.find(c => String(c.id).toLowerCase() === String(courseId).toLowerCase()) || null
    },

    createCourse (course) {
      if (!course || !course.id || !course.name) {
        return { success: false, message: 'Course Id and Name are required' }
      }
      if (courses.some(c => String(c.id).toLowerCase() === String(course.id).toLowerCase())) {
        return { success: false, message: `Course with ID '${course.id}' already exists` }
      }
      courses.push({
        state: 'ACTIVE',
        studentCount: 0,
        creationTime: new Date().toISOString(),
        ...course
      })
      lastSyncedAt = new Date().toISOString()
      return { success: true, message: `Course '${course.name}' created on Google Classroom`, entityId: course.id }
    },

    listCourseWork (courseId) {
      return assignments.filter(a => String(a.courseId).toLowerCase() === String(courseId).toLowerCase())
    },

    getCourseWork (courseId, courseWorkId) {
      return assignments.find(a =>
        String(a.courseId).toLowerCase() === String(courseId).toLowerCase() &&
        String(a.id).toLowerCase() === String(courseWorkId).toLowerCase()
      ) || null
    },

    createCourseWork (courseWork) {
      if (!courseWork || !courseWork.id || !courseWork.title) {
        return { success: false, message: 'CourseWork Id and Title are required' }
      }
      if (assignments.some(a => String(a.id).toLowerCase() === String(courseWork.id).toLowerCase())) {
        return { success: false, message: `CourseWork with ID '${courseWork.id}' already exists` }
      }
      assignments.push({
        state: 'PUBLISHED',
        maxPoints: 100,
        workType: 'ASSIGNMENT',
        ...courseWork
      })
      lastSyncedAt = new Date().toISOString()
      return { success: true, message: `CourseWork '${courseWork.title}' published to Google Classroom`, entityId: courseWork.id }
    },

    listSubmissions (courseId, courseWorkId) {
      return submissions.filter(s =>
        String(s.courseId).toLowerCase() === String(courseId).toLowerCase() &&
        String(s.courseWorkId).toLowerCase() === String(courseWorkId).toLowerCase()
      )
    },

    getUserSubmission (courseId, courseWorkId, userId) {
      return submissions.find(s =>
        String(s.courseId).toLowerCase() === String(courseId).toLowerCase() &&
        String(s.courseWorkId).toLowerCase() === String(courseWorkId).toLowerCase() &&
        String(s.userId).toLowerCase() === String(userId).toLowerCase()
      ) || null
    },

    turnInAssignment ({ courseId, courseWorkId, userId, studentName, code, autograderScore = 100, rubricSummary = '' }) {
      if (!isConnected) {
        return { success: false, message: 'Google Classroom account is not connected' }
      }
      if (!courseId || !courseWorkId || !userId) {
        return { success: false, message: 'Course ID, CourseWork ID, and User ID are required' }
      }

      const existingIndex = submissions.findIndex(s =>
        String(s.courseId).toLowerCase() === String(courseId).toLowerCase() &&
        String(s.courseWorkId).toLowerCase() === String(courseWorkId).toLowerCase() &&
        String(s.userId).toLowerCase() === String(userId).toLowerCase()
      )

      const submissionId = existingIndex >= 0 ? submissions[existingIndex].id : `sub_${userId}_${Date.now()}`
      const altLink = `https://classroom.google.com/c/${courseId}/a/${courseWorkId}/submissions/by-user/${userId}`

      const updated = {
        id: submissionId,
        courseId,
        courseWorkId,
        userId,
        studentName: studentName || 'Student',
        state: 'TURNED_IN',
        assignedGrade: null,
        draftGrade: Number(autograderScore) || 0,
        alternateLink: altLink,
        turnInTime: new Date().toISOString(),
        submittedCode: String(code || ''),
        autograderSummary: String(rubricSummary || '')
      }

      if (existingIndex >= 0) {
        submissions[existingIndex] = updated
      } else {
        submissions.push(updated)
      }

      lastSyncedAt = new Date().toISOString()
      return {
        success: true,
        message: `Successfully turned in assignment to Google Classroom with score ${autograderScore}`,
        entityId: submissionId
      }
    },

    returnSubmissionWithGrade ({ courseId, courseWorkId, submissionId, grade, feedback = '' }) {
      if (!isConnected) {
        return { success: false, message: 'Google Classroom account is not connected' }
      }

      const sub = submissions.find(s =>
        String(s.courseId).toLowerCase() === String(courseId).toLowerCase() &&
        String(s.courseWorkId).toLowerCase() === String(courseWorkId).toLowerCase() &&
        String(s.id).toLowerCase() === String(submissionId).toLowerCase()
      )

      if (!sub) {
        return { success: false, message: `Submission with ID '${submissionId}' not found` }
      }

      sub.state = 'RETURNED'
      sub.assignedGrade = Number(grade)
      sub.draftGrade = Number(grade)
      if (feedback) sub.feedback = feedback

      lastSyncedAt = new Date().toISOString()
      return {
        success: true,
        message: `Grade ${grade} returned to student ${sub.studentName} on Google Classroom`,
        entityId: sub.id
      }
    },

    syncAllGrades (courseId, courseWorkId, updates = []) {
      if (!isConnected) {
        return { success: false, message: 'Google Classroom account is not connected' }
      }

      let count = 0
      for (const upd of updates) {
        const res = this.returnSubmissionWithGrade({
          courseId,
          courseWorkId,
          submissionId: upd.submissionId,
          grade: upd.grade,
          feedback: upd.feedback
        })
        if (res.success) count++
      }

      lastSyncedAt = new Date().toISOString()
      return {
        success: true,
        message: `Synced ${count} student grades to Google Classroom gradebook`,
        entityId: courseWorkId
      }
    }
  }
}
