import assert from 'node:assert'
import {
  FLAVORS,
  ROLES,
  PRECONFIGURED_ACCOUNTS,
  SAMPLE_CLASSROOMS,
  SAMPLE_ASSIGNMENT,
  getAccountById,
  addClassroom,
  removeClassroom,
  gradeAssignmentSubmission,
  getWalkthroughTour,
  hasCompletedWalkthrough,
  markWalkthroughCompleted,
  STRIPE_PACKS,
  simulateStripeCheckout,
  simulateInAppMerchantPurchase,
  synthesizeLessonPlan,
  synthesizePassionProject,
  getAccountMonetization,
  SPONSORED_RECOMMENDATIONS
} from '../account-flavors.js'

// 1. Flavors & Roles
assert.strictEqual(FLAVORS.length, 3)
assert.ok(FLAVORS.includes('school'))
assert.ok(FLAVORS.includes('dev_team'))
assert.ok(FLAVORS.includes('corporate'))

assert.ok(ROLES.includes('student'))
assert.ok(ROLES.includes('teacher'))
assert.ok(ROLES.includes('school_admin'))
assert.ok(ROLES.includes('junior_dev'))
assert.ok(ROLES.includes('senior_dev'))
assert.ok(ROLES.includes('corporate_legal'))
assert.ok(ROLES.includes('solo_dev'))

// 2. Pre-configured Accounts
assert.strictEqual(PRECONFIGURED_ACCOUNTS.length, 7)

const student = getAccountById('acc_student_alex')
assert.strictEqual(student.flavor, 'school')
assert.strictEqual(student.role, 'student')
assert.strictEqual(student.classroomCode, 'CS101-FALL26-A4')
assert.strictEqual(student.permissions.allowBypass, false)
assert.strictEqual(student.permissions.allowShell, false)
assert.strictEqual(student.permissions.autograderAccess, true)

const teacher = getAccountById('acc_teacher_sarah')
assert.strictEqual(teacher.role, 'teacher')
assert.strictEqual(teacher.permissions.editAssignments, true)
assert.strictEqual(teacher.permissions.manageClassrooms, false)

const schoolAdmin = getAccountById('acc_admin_marcus')
assert.strictEqual(schoolAdmin.role, 'school_admin')
assert.strictEqual(schoolAdmin.permissions.manageClassrooms, true)

const seniorDev = getAccountById('acc_senior_alex')
assert.strictEqual(seniorDev.role, 'senior_dev')
assert.strictEqual(seniorDev.permissions.allowBypass, true)
assert.strictEqual(seniorDev.permissions.allowShell, true)

const legal = getAccountById('acc_legal_elena')
assert.strictEqual(legal.role, 'corporate_legal')
assert.strictEqual(legal.permissions.complianceAudit, true)

// 3. Classroom management
assert.strictEqual(SAMPLE_CLASSROOMS.length, 2)
const updatedRooms = addClassroom({
  id: 'web301',
  code: 'WEB301-FALL26',
  name: 'Web Applications & Cloud Systems',
  teacher: 'Prof. Sarah Jenkins',
  studentCount: 20
}, SAMPLE_CLASSROOMS)

assert.strictEqual(updatedRooms.length, 3)
const removed = removeClassroom('cs201', updatedRooms)
assert.strictEqual(removed.length, 2)
assert.strictEqual(removed.some(r => r.id === 'cs201'), false)

// 4. Assignment & Autograder
assert.strictEqual(SAMPLE_ASSIGNMENT.id, 'hw1_inverted_index')
assert.strictEqual(SAMPLE_ASSIGNMENT.pointsPossible, 100)
assert.strictEqual(SAMPLE_ASSIGNMENT.slides.length, 3)

// Run autograder on starter code (should get 100 on valid implementation)
const gradeResult = gradeAssignmentSubmission(SAMPLE_ASSIGNMENT.starterCode, SAMPLE_ASSIGNMENT)
assert.strictEqual(gradeResult.pointsPossible, 100)
assert.strictEqual(gradeResult.totalScore, 100)
assert.strictEqual(gradeResult.passed, true)
assert.strictEqual(gradeResult.results.length, 4)

// Incomplete code fails grading
const badGrade = gradeAssignmentSubmission('x = 1', SAMPLE_ASSIGNMENT)
assert.strictEqual(badGrade.totalScore, 0)
assert.strictEqual(badGrade.passed, false)

// 5. Role-aware Walkthrough Tour
const studentTour = getWalkthroughTour('student', 'school')
assert.strictEqual(studentTour.title, 'Student Classroom SDE Tour')
assert.strictEqual(studentTour.steps.length, 4)

const teacherTour = getWalkthroughTour('teacher', 'school')
assert.strictEqual(teacherTour.title, 'Teacher Course & Classroom Tour')

const legalTour = getWalkthroughTour('corporate_legal', 'corporate')
assert.strictEqual(legalTour.title, 'Corporate Legal & Governance Tour')

// Tour completion state tracking
const mockStorage = {
  _data: {},
  getItem(k) { return this._data[k] || null },
  setItem(k, v) { this._data[k] = String(v) }
}
assert.strictEqual(hasCompletedWalkthrough(mockStorage, 'acc_student_alex', 'student'), false)
markWalkthroughCompleted(mockStorage, 'acc_student_alex', 'student')
assert.strictEqual(hasCompletedWalkthrough(mockStorage, 'acc_student_alex', 'student'), true)
assert.strictEqual(hasCompletedWalkthrough(mockStorage, 'acc_teacher_sarah', 'teacher'), false) // independent per account/role

// 6. Stripe Checkout & Merchant Integration
assert.strictEqual(STRIPE_PACKS.length, 3)
const checkout = simulateStripeCheckout('acc_senior_alex', 'credit-20', 20.0)
assert.strictEqual(checkout.success, true)
assert.strictEqual(checkout.creditsAddedUsd, 20.0)
assert.strictEqual(checkout.newBalanceUsd, 40.0)
assert.ok(checkout.transactionId.startsWith('cs_test_'))

const merchantPurchase = simulateInAppMerchantPurchase('acc_senior_alex', 'buyer@test.io', 2000, 'Pro Subscription')
assert.strictEqual(merchantPurchase.success, true)
assert.strictEqual(merchantPurchase.amountUsd, 20.0)
assert.strictEqual(merchantPurchase.status, 'succeeded')

// 7. Real AI Lesson Planner (Ask #502)
const plan = synthesizeLessonPlan('Binary Search and Divide-and-Conquer Algorithms', { gradeLevel: 'high_school', targetDuration: 50 })
assert.strictEqual(plan.title, 'Binary Search and Divide-and-Conquer Algorithms')
assert.strictEqual(plan.slides.length, 3)
assert.strictEqual(plan.assignment.rubric.length, 3)
assert.strictEqual(plan.assignment.knowledgeCheck.length, 2)
assert.ok(plan.assignment.starterCode.includes('def solve_problem'))
assert.ok(plan.assignment.aiTutorGuidance.includes('Socratic questions'))

// 8. Passion Projects & Pioneer Spotlights (Asks #190 & #191)
const music = synthesizePassionProject('Making electronic beats and synth tracks')
assert.strictEqual(music.domain, 'Music Production & Algorithmic Audio')
assert.strictEqual(music.heroPioneer.name, 'Wendy Carlos')
assert.strictEqual(music.milestones.length, 4)
assert.ok(music.starterCode.includes('BeatSequencer'))
assert.ok(music.testCode.includes('test_bpm_step_duration'))

const fashion = synthesizePassionProject('Sustainable sewing and eco-friendly clothing fabrics')
assert.strictEqual(fashion.domain, 'Sustainable Fashion & Eco-Material Tech')
assert.strictEqual(fashion.heroPioneer.name, 'Dr. Rebeccah Pailes-Friedman')
assert.ok(fashion.starterCode.includes('Garment'))

const space = synthesizePassionProject('NASA James Webb telescope star photos and planets')
assert.strictEqual(space.domain, 'Astrophysics & Space Science')
assert.ok(space.heroPioneer.name.includes('Katherine Johnson'))
assert.ok(space.starterCode.includes('LightcurveAnalyzer'))


// 9. Free Tier Ads & Corporate Free Tier Restrictions
const freePersonal = getAccountMonetization({ flavor: 'dev_team', plan: 'free' })
assert.strictEqual(freePersonal.showAds, true)
assert.strictEqual(freePersonal.dataRetainedForTraining, true)
assert.strictEqual(freePersonal.zeroDataRetention, false)

const freeCorp = getAccountMonetization({ flavor: 'corporate', plan: 'free' })
assert.strictEqual(freeCorp.showAds, true)
assert.strictEqual(freeCorp.domainLockAllowed, false)
assert.strictEqual(freeCorp.externalViewersAllowed, true) // Cannot stop outside people
assert.strictEqual(freeCorp.zeroDataRetention, false)
assert.ok(freeCorp.notice.includes('Corporate Free: Domain lockdown & access auth disabled'))

const paidCorp = getAccountMonetization({ flavor: 'corporate', plan: 'enterprise' })
assert.strictEqual(paidCorp.showAds, false)
assert.strictEqual(paidCorp.domainLockAllowed, true)
assert.strictEqual(paidCorp.externalViewersAllowed, false) // Enterprise isolation enforced
assert.strictEqual(paidCorp.zeroDataRetention, true)
assert.strictEqual(paidCorp.dataRetainedForTraining, false)
assert.strictEqual(paidCorp.enterpriseSSO, true)

console.log('account-flavors tests passed successfully')
