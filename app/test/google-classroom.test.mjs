import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createGoogleClassroomService,
  SAMPLE_GCLASSROOM_COURSES,
  SAMPLE_GCLASSROOM_COURSEWORK,
  SAMPLE_GCLASSROOM_SUBMISSIONS
} from '../google-classroom.js'

test('createGoogleClassroomService initializes with defaults', () => {
  const svc = createGoogleClassroomService({ seedDefaults: true })
  const status = svc.getStatus()
  assert.equal(status.isConnected, true)
  assert.equal(status.userEmail, 'sarah.jenkins@lincoln-high.edu')
  assert.equal(status.coursesCount, 2)
  assert.equal(status.assignmentsCount, 2)
  assert.equal(status.submissionsCount, 4)
})

test('connect and disconnect toggles authentication state', () => {
  const svc = createGoogleClassroomService({ seedDefaults: false })
  assert.equal(svc.getStatus().isConnected, false)

  const conn = svc.connect('alex.morgan@lincoln-high.edu')
  assert.equal(conn.isConnected, true)
  assert.equal(conn.userEmail, 'alex.morgan@lincoln-high.edu')

  const dis = svc.disconnect()
  assert.equal(dis.isConnected, false)
  assert.equal(dis.userEmail, '')
})

test('listCourses and getCourse returns courses and handles lookup', () => {
  const svc = createGoogleClassroomService()
  const courses = svc.listCourses()
  assert.equal(courses.length, 2)
  assert.equal(courses[0].enrollmentCode, 'CS101-FALL26-A4')

  const cs101 = svc.getCourse('cs101')
  assert.ok(cs101)
  assert.equal(cs101.room, 'Lab 3B')
})

test('createCourse adds a new Google Classroom course and checks duplicates', () => {
  const svc = createGoogleClassroomService()
  const res = svc.createCourse({
    id: 'cs301',
    name: 'CS 301: Distributed Systems',
    enrollmentCode: 'CS301-FALL26-D1'
  })
  assert.equal(res.success, true)
  assert.equal(res.entityId, 'cs301')

  const dup = svc.createCourse({ id: 'cs301', name: 'Duplicate' })
  assert.equal(dup.success, false)
  assert.match(dup.message, /already exists/)
})

test('listCourseWork and createCourseWork handles assignments', () => {
  const svc = createGoogleClassroomService()
  const assignments = svc.listCourseWork('cs101')
  assert.equal(assignments.length, 1)
  assert.equal(assignments[0].id, 'hw1_inverted_index')

  const res = svc.createCourseWork({
    id: 'hw1_quiz',
    courseId: 'cs101',
    title: 'Quiz 1: Asymptotic Complexity'
  })
  assert.equal(res.success, true)
  assert.equal(svc.listCourseWork('cs101').length, 2)
})

test('turnInAssignment updates student submission state and draft grade', () => {
  const svc = createGoogleClassroomService()
  const res = svc.turnInAssignment({
    courseId: 'cs101',
    courseWorkId: 'hw1_inverted_index',
    userId: 'acc_student_devon',
    studentName: 'Devon Smith',
    code: 'def build_inverted_index(): pass',
    autograderScore: 100,
    rubricSummary: 'All 4 test cases passed'
  })
  assert.equal(res.success, true)

  const sub = svc.getUserSubmission('cs101', 'hw1_inverted_index', 'acc_student_devon')
  assert.ok(sub)
  assert.equal(sub.state, 'TURNED_IN')
  assert.equal(sub.draftGrade, 100)
  assert.match(sub.alternateLink, /classroom\.google\.com/)
})

test('turnInAssignment when disconnected returns failure', () => {
  const svc = createGoogleClassroomService()
  svc.disconnect()
  const res = svc.turnInAssignment({
    courseId: 'cs101',
    courseWorkId: 'hw1_inverted_index',
    userId: 'acc_student_alex'
  })
  assert.equal(res.success, false)
  assert.match(res.message, /not connected/)
})

test('returnSubmissionWithGrade updates assigned grade', () => {
  const svc = createGoogleClassroomService()
  const res = svc.returnSubmissionWithGrade({
    courseId: 'cs101',
    courseWorkId: 'hw1_inverted_index',
    submissionId: 'sub_alex_001',
    grade: 100,
    feedback: 'Excellent work!'
  })
  assert.equal(res.success, true)

  const sub = svc.getUserSubmission('cs101', 'hw1_inverted_index', 'acc_student_alex')
  assert.equal(sub.state, 'RETURNED')
  assert.equal(sub.assignedGrade, 100)
})

test('syncAllGrades batch updates gradebook submissions', () => {
  const svc = createGoogleClassroomService()
  const res = svc.syncAllGrades('cs101', 'hw1_inverted_index', [
    { submissionId: 'sub_alex_001', grade: 100 },
    { submissionId: 'sub_maya_002', grade: 95 },
    { submissionId: 'sub_carlos_003', grade: 88 }
  ])
  assert.equal(res.success, true)
  assert.match(res.message, /Synced 3 student grades/)

  const carlos = svc.getUserSubmission('cs101', 'hw1_inverted_index', 'acc_student_carlos')
  assert.equal(carlos.assignedGrade, 88)
  assert.equal(carlos.state, 'RETURNED')
})
