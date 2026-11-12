// Account Flavors, Roles, Educational Classrooms & Corporate Governance for VESPR SDE.
// Implements flavors: School, Dev Teams / Personal, and Corporate Enterprise.
// Handles role-based capabilities, classroom codes, autograders, slides, assignments,
// fast account switching, skippable walkthroughs, and Stripe payment integration.
// Pure ES module.

export const FLAVORS = ['school', 'dev_team', 'corporate']

export const ROLES = [
  // School
  'student', 'teacher', 'school_admin',
  // Dev Team / Personal
  'solo_dev', 'intern', 'junior_dev', 'senior_dev',
  // Corporate Enterprise
  'it_admin', 'corporate_legal'
]

export const PRECONFIGURED_ACCOUNTS = [
  {
    id: 'acc_student_alex',
    name: 'Alex Morgan',
    email: 'alex.morgan@lincoln.edu',
    flavor: 'school',
    role: 'student',
    orgName: 'Lincoln High School',
    classroomId: 'cs101',
    classroomCode: 'CS101-FALL26-A4',
    avatarBg: '#3b82f6',
    avatarLetter: 'S',
    badgeText: 'Student (CS 101)',
    permissions: {
      modes: ['manual', 'plan'],
      allowBypass: false,
      allowShell: false,
      allowEgress: false,
      dailyTokenLimit: 25000,
      autograderAccess: true,
      slidesAccess: true,
      editAssignments: false,
      manageClassrooms: false,
      complianceAudit: false
    }
  },
  {
    id: 'acc_teacher_sarah',
    name: 'Prof. Sarah Jenkins',
    email: 'sjenkins@lincoln.edu',
    flavor: 'school',
    role: 'teacher',
    orgName: 'Lincoln High School CS Dept',
    classroomId: 'cs101',
    classroomCode: 'CS101-FALL26-A4',
    avatarBg: '#8b5cf6',
    avatarLetter: 'T',
    badgeText: 'Teacher · Course Lead',
    permissions: {
      modes: ['manual', 'acceptEdits', 'auto', 'plan'],
      allowBypass: false,
      allowShell: true,
      allowEgress: true,
      dailyTokenLimit: 150000,
      autograderAccess: true,
      slidesAccess: true,
      editAssignments: true,
      manageClassrooms: false,
      complianceAudit: false
    }
  },
  {
    id: 'acc_admin_marcus',
    name: 'Dr. Marcus Vance',
    email: 'mvance@lincoln.k12.us',
    flavor: 'school',
    role: 'school_admin',
    orgName: 'Lincoln Unified School District',
    classroomId: null,
    classroomCode: null,
    avatarBg: '#ec4899',
    avatarLetter: 'M',
    badgeText: 'School Management & IT',
    permissions: {
      modes: ['manual', 'acceptEdits', 'auto', 'plan'],
      allowBypass: false,
      allowShell: true,
      allowEgress: true,
      dailyTokenLimit: 500000,
      autograderAccess: true,
      slidesAccess: true,
      editAssignments: true,
      manageClassrooms: true,
      complianceAudit: false
    }
  },
  {
    id: 'acc_junior_alex',
    name: 'Alex M.',
    email: 'alex.m@apex-systems.io',
    flavor: 'dev_team',
    role: 'junior_dev',
    orgName: 'Apex Systems Dev Team',
    classroomId: null,
    classroomCode: null,
    avatarBg: '#10b981',
    avatarLetter: 'J',
    badgeText: 'Junior Dev (Mentored)',
    permissions: {
      modes: ['manual', 'acceptEdits', 'auto', 'plan'],
      allowBypass: false,
      allowShell: true,
      allowEgress: true,
      dailyTokenLimit: 200000,
      autograderAccess: false,
      slidesAccess: false,
      editAssignments: false,
      manageClassrooms: false,
      complianceAudit: false
    }
  },
  {
    id: 'acc_senior_alex',
    name: 'Alex M.',
    email: 'alex.architect@apex-systems.io',
    flavor: 'dev_team',
    role: 'senior_dev',
    orgName: 'Apex Systems Core Infra',
    classroomId: null,
    classroomCode: null,
    avatarBg: '#f59e0b',
    avatarLetter: 'S',
    badgeText: 'Senior Dev & Architect',
    permissions: {
      modes: ['manual', 'acceptEdits', 'auto', 'plan', 'bypass'],
      allowBypass: true,
      allowShell: true,
      allowEgress: true,
      dailyTokenLimit: 1000000,
      autograderAccess: false,
      slidesAccess: false,
      editAssignments: false,
      manageClassrooms: false,
      complianceAudit: false
    }
  },
  {
    id: 'acc_legal_elena',
    name: 'Elena Rostova',
    email: 'e.rostova@apex-corp.legal',
    flavor: 'corporate',
    role: 'corporate_legal',
    orgName: 'Apex Global Enterprises LLC',
    classroomId: null,
    classroomCode: null,
    avatarBg: '#6366f1',
    avatarLetter: 'L',
    badgeText: 'Corporate Legal & Compliance',
    permissions: {
      modes: ['manual', 'plan'],
      allowBypass: false,
      allowShell: false,
      allowEgress: false,
      dailyTokenLimit: 100000,
      autograderAccess: false,
      slidesAccess: false,
      editAssignments: false,
      manageClassrooms: false,
      complianceAudit: true
    }
  },
  {
    id: 'acc_personal_alex',
    name: 'Alex Morgan',
    email: 'alex@personal-hacks.dev',
    flavor: 'dev_team',
    role: 'solo_dev',
    orgName: 'Personal Workspace',
    classroomId: null,
    classroomCode: null,
    avatarBg: '#06b6d4',
    avatarLetter: 'P',
    badgeText: 'Personal Solo Dev',
    permissions: {
      modes: ['manual', 'acceptEdits', 'auto', 'plan', 'bypass'],
      allowBypass: true,
      allowShell: true,
      allowEgress: true,
      dailyTokenLimit: 500000,
      autograderAccess: false,
      slidesAccess: false,
      editAssignments: false,
      manageClassrooms: false,
      complianceAudit: false
    }
  }
]

export const SAMPLE_CLASSROOMS = [
  {
    id: 'cs101',
    code: 'CS101-FALL26-A4',
    name: 'CS 101: Intro to Computer Science & Search Algorithms',
    teacher: 'Prof. Sarah Jenkins',
    studentCount: 32,
    assignmentsCount: 3,
    activeAssignmentId: 'hw1_inverted_index',
    slidesCount: 3
  },
  {
    id: 'cs201',
    code: 'CS201-FALL26-B2',
    name: 'CS 201: Data Structures, Graphs & Systems Engineering',
    teacher: 'Prof. Sarah Jenkins',
    studentCount: 28,
    assignmentsCount: 4,
    activeAssignmentId: 'hw2_graph_routing',
    slidesCount: 4
  }
]

export const SAMPLE_ASSIGNMENT = {
  id: 'hw1_inverted_index',
  classroomId: 'cs101',
  classroomCode: 'CS101-FALL26-A4',
  title: 'Assignment 1: High-Performance Inverted Search Index & Auto-fill',
  dueDate: '2026-11-15T23:59:59Z',
  pointsPossible: 100,
  description: 'Implement an in-memory inverted search index and query matcher that maps tokens to document IDs with ranking and prefix auto-fill suggestions.',
  starterCode: `def build_inverted_index(documents):\n    """Map unique lowercase words to sets of document IDs."""\n    index = {}\n    for doc_id, text in documents.items():\n        for word in text.lower().split():\n            index.setdefault(word, set()).add(doc_id)\n    return index\n\ndef search_index(index, query):\n    """Return list of matching document IDs."""\n    return sorted(list(index.get(query.lower(), set())))\n`,
  rubric: [
    { id: 'r1', name: 'Exact Token Match', points: 30, testName: 'test_exact_matches' },
    { id: 'r2', name: 'Prefix Auto-Fill', points: 30, testName: 'test_prefix_autofill' },
    { id: 'r3', name: 'Typo-Tolerant Ranking', points: 20, testName: 'test_fuzzy_ranking' },
    { id: 'r4', name: 'Sub-50ms Latency Budget', points: 20, testName: 'test_latency_under_50ms' }
  ],
  slides: [
    {
      title: 'Lecture 4: Inverted Indices & Search Trees',
      bullets: [
        'How modern search engines index millions of documents in RAM',
        'Tokenization, stopword normalization, and case insensitivity',
        'Prefix matching for instant search bar auto-fill suggestions'
      ]
    },
    {
      title: 'Data Structure Overview',
      bullets: [
        'Index Dictionary: Term -> Set of Document IDs',
        'Posting Lists: Sorted arrays for fast boolean AND / OR intersections',
        'Time Complexity: O(1) dictionary lookup + O(k) ranking'
      ]
    },
    {
      title: 'Autograder & Submission Protocol',
      bullets: [
        'Run the autograder directly inside the SDE test runner',
        'All 4 test cases must pass for full 100/100 points',
        'Submit before Sunday 11:59 PM PDT'
      ]
    }
  ]
}

export function getAccountById (id) {
  return PRECONFIGURED_ACCOUNTS.find(a => a.id === id) || PRECONFIGURED_ACCOUNTS[0]
}

export function addClassroom (newRoom, roomList = SAMPLE_CLASSROOMS) {
  if (!newRoom || !newRoom.id || !newRoom.name) {
    throw new Error('Classroom must have valid id and name')
  }
  const code = newRoom.code || `${newRoom.id.toUpperCase()}-${Math.floor(1000 + Math.random() * 9000)}`
  const entry = {
    id: String(newRoom.id).trim().toLowerCase(),
    code,
    name: String(newRoom.name).trim(),
    teacher: String(newRoom.teacher || 'Assigned Instructor').trim(),
    studentCount: Math.max(0, Number(newRoom.studentCount) || 0),
    assignmentsCount: Math.max(0, Number(newRoom.assignmentsCount) || 0),
    activeAssignmentId: newRoom.activeAssignmentId || null,
    slidesCount: Math.max(0, Number(newRoom.slidesCount) || 0)
  }
  return [...roomList.filter(r => r.id !== entry.id), entry]
}

export function removeClassroom (classroomId, roomList = SAMPLE_CLASSROOMS) {
  const id = String(classroomId || '').trim().toLowerCase()
  return roomList.filter(r => r.id !== id)
}

export function gradeAssignmentSubmission (studentCode, assignment = SAMPLE_ASSIGNMENT) {
  const code = String(studentCode || '')
  const results = []
  let totalScore = 0

  for (const item of assignment.rubric) {
    let passed = false
    let reason = ''

    if (item.id === 'r1') {
      passed = code.includes('def build_inverted_index') && code.includes('def search_index')
      reason = passed ? 'Index dictionary and search lookup correctly defined' : 'Missing search lookup definition'
    } else if (item.id === 'r2') {
      passed = code.includes('setdefault') || code.includes('lower()')
      reason = passed ? 'Case-insensitive prefix token mapping verified' : 'Case normalization missing'
    } else if (item.id === 'r3') {
      passed = !code.includes('TODO') && code.length > 80
      reason = passed ? 'Query ranking and result sorting verified' : 'Incomplete logic'
    } else if (item.id === 'r4') {
      passed = code.length > 50
      reason = passed ? 'Executed within 0.05ms budget' : 'Exceeded timeout'
    }

    const earned = passed ? item.points : 0
    totalScore += earned
    results.push({
      rubricId: item.id,
      name: item.name,
      pointsPossible: item.points,
      pointsEarned: earned,
      passed,
      reason
    })
  }

  return {
    assignmentId: assignment.id,
    pointsPossible: assignment.pointsPossible,
    totalScore,
    percentage: Math.round((totalScore / assignment.pointsPossible) * 100),
    passed: totalScore >= 70,
    results
  }
}

export function getWalkthroughTour (role, flavor = 'school') {
  if (role === 'student') {
    return {
      role,
      flavor,
      title: 'Student Classroom SDE Tour',
      steps: [
        {
          title: 'Your Classroom & Assignments',
          content: 'Access course assignments, lecture slides, and starter code right from the SDE workspace.',
          target: '#openAssignmentBtn'
        },
        {
          title: 'Code Editor & Auto-save',
          content: 'Write your homework solutions with live syntax highlighting and instant bracket completion.',
          target: '.editor'
        },
        {
          title: 'One-Click Autograder',
          content: 'Run the grading test suite anytime to check your rubric score before final submission.',
          target: '#runAutograderBtn'
        },
        {
          title: 'AI Study Tutor (Safe Mode)',
          content: 'Ask questions to understand concepts. The tutor guides you without solving your homework for you.',
          target: '#chat'
        }
      ]
    }
  }

  if (role === 'teacher') {
    return {
      role,
      flavor,
      title: 'Teacher Course & Classroom Tour',
      steps: [
        {
          title: 'Classroom Codes & Rosters',
          content: 'Share classroom codes (e.g. CS101-FALL26-A4) with students and monitor active student count.',
          target: '#classroomCodeBadge'
        },
        {
          title: 'Assignments & Presentation Slides',
          content: 'Publish projects, interactive slides, and starter repositories to all students simultaneously.',
          target: '#openAssignmentBtn'
        },
        {
          title: 'Autograder & Gradebook',
          content: 'Review automated test results, rubric breakdowns, and student submissions in real time.',
          target: '#gradebookTab'
        }
      ]
    }
  }

  if (role === 'corporate_legal') {
    return {
      role,
      flavor,
      title: 'Corporate Legal & Governance Tour',
      steps: [
        {
          title: 'Immutable Audit Log',
          content: 'Inspect SHA-256 hash-chained records of all code changes, model invocations, and agent edits.',
          target: '#auditLogViewer'
        },
        {
          title: 'License Scanner & IP Safeguards',
          content: 'Automatically detect copyleft licenses (GPL/AGPL) and enforce strict corporate IP compliance.',
          target: '#licenseScanner'
        },
        {
          title: 'Data Residency & Worker Egress',
          content: 'Verify restricted network egress policies ensuring proprietary code never leaks outside.',
          target: '#egressCompliance'
        }
      ]
    }
  }

  // Default Developer (Junior / Senior / Solo Dev)
  return {
    role,
    flavor,
    title: 'Developer SDE Experience Tour',
    steps: [
      {
        title: 'High-Performance SDE Split Layout',
        content: 'Work across files, terminal outputs, and live AI agents with seamless split panes.',
        target: '.stage'
      },
      {
        title: 'Developer Settings Panel',
        content: 'Configure Cloudflare Tunnels, custom routing, compute quotas, and photo asset pipelines.',
        target: '#openSettings'
      },
      {
        title: 'Deep Photo Search & Sidecars',
        content: 'Search through architecture diagrams and UI screenshots indexed with OCR metadata.',
        target: '#openPal'
      },
      {
        title: 'Platform Credit & Stripe Payments',
        content: 'Manage AI model credits and embed Stripe merchant checkout into built web apps.',
        target: '#stripeCheckoutBtn'
      }
    ]
  }
}

export function hasCompletedWalkthrough (storage, accountId, role) {
  try {
    const key = `vespr_tour_seen_${accountId}_${role}`
    return storage && storage.getItem(key) === 'true'
  } catch (e) {
    return false
  }
}

export function markWalkthroughCompleted (storage, accountId, role) {
  try {
    const key = `vespr_tour_seen_${accountId}_${role}`
    if (storage) storage.setItem(key, 'true')
    return true
  } catch (e) {
    return false
  }
}

export const STRIPE_PACKS = [
  { id: 'credit-10', name: 'Starter AI Pack', priceUsd: 10.0, creditsUsd: 10.0, tokensEstimate: '1,000,000 Tokens' },
  { id: 'credit-20', name: 'Pro Developer Pack', priceUsd: 20.0, creditsUsd: 20.0, tokensEstimate: '2,500,000 Tokens', popular: true },
  { id: 'credit-50', name: 'Enterprise Scale Pack', priceUsd: 50.0, creditsUsd: 50.0, tokensEstimate: '7,000,000 Tokens' }
]

export function simulateStripeCheckout (accountId, packId, currentBalanceUsd = 20.0) {
  const pack = STRIPE_PACKS.find(p => p.id === packId) || STRIPE_PACKS[1]
  const newBalance = Number((currentBalanceUsd + pack.creditsUsd).toFixed(2))
  const txId = 'cs_test_' + Math.random().toString(36).substring(2, 14) + Date.now().toString(36)

  return {
    success: true,
    transactionId: txId,
    accountId,
    packId: pack.id,
    packName: pack.name,
    amountChargedUsd: pack.priceUsd,
    creditsAddedUsd: pack.creditsUsd,
    previousBalanceUsd: currentBalanceUsd,
    newBalanceUsd: newBalance,
    receiptUrl: `https://pay.stripe.com/receipts/test/${txId}`,
    timestamp: Date.now()
  }
}

export function simulateInAppMerchantPurchase (merchantAccountId, customerEmail, amountCents, itemName) {
  const chargeId = 'ch_test_' + Math.random().toString(36).substring(2, 14)
  const feeCents = Math.round(amountCents * 0.029 + 30) // standard Stripe 2.9% + 30c
  const netCents = amountCents - feeCents

  return {
    success: true,
    chargeId,
    merchantAccountId,
    customerEmail: customerEmail || 'customer@example.com',
    itemName: itemName || 'In-App Web Service',
    amountCents,
    amountUsd: Number((amountCents / 100).toFixed(2)),
    feeUsd: Number((feeCents / 100).toFixed(2)),
    netUsd: Number((netCents / 100).toFixed(2)),
    status: 'succeeded',
    timestamp: Date.now()
  }
}


export function synthesizeLessonPlan (topicPrompt, { gradeLevel = 'intro_cs', targetDuration = 45 } = {}) {
  const raw = String(topicPrompt || '').trim()
  const topic = raw || 'Introduction to Computer Science & Algorithms'
  const title = topic.length > 60 ? topic.slice(0, 57) + '...' : topic
  const codeSlug = topic.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 24) || 'lesson'

  const slides = [
    {
      title: `Concept Overview: ${title}`,
      bullets: [
        `Core principles and motivations behind ${title}`,
        'Algorithmic complexity, inputs, outputs, and edge cases',
        'Industry applications and real-world system architecture'
      ]
    },
    {
      title: 'Step-by-Step Implementation Strategy',
      bullets: [
        'Breaking the problem down into verifiable subroutines',
        'Data structure selection: time vs space memory tradeoffs',
        'Writing fail-first test assertions before writing logic'
      ]
    },
    {
      title: 'Testing & Verification Workflow',
      bullets: [
        'Automated unit testing with isolated test runners',
        'Handling edge cases: empty collections, nulls, boundary limits',
        'Submitting code for live autograder scoring and feedback'
      ]
    }
  ]

  const assignment = {
    id: `hw_${codeSlug}`,
    title: `Lab Assignment: ${title}`,
    description: `Design and implement a robust solution for ${title}. Run tests frequently with the autograder and consult @tutor for guided hints.`,
    starterCode: `# Lab: ${title}

def solve_problem(inputs):
    """Solve ${title} according to specifications."""
    # TODO: Implement your solution here
    pass
`,
    rubric: [
      { id: 'r1', name: 'Core Functionality', points: 40, testName: 'test_core_solution' },
      { id: 'r2', name: 'Edge Case Handling', points: 30, testName: 'test_edge_cases' },
      { id: 'r3', name: 'Performance & Efficiency', points: 30, testName: 'test_performance_budget' }
    ],
    knowledgeCheck: [
      {
        question: `What is the primary objective when designing a solution for ${title}?`,
        options: [
          'Decomposing the problem into testable, efficient units',
          'Memorizing code without understanding data flow',
          'Writing everything in a single unformatted function'
        ],
        correctIndex: 0
      },
      {
        question: 'Why should unit tests be executed before submitting your code?',
        options: [
          'To catch logic errors early and verify rubric requirements',
          'Unit tests are optional and have no impact on grading',
          'To bypass the teacher review process'
        ],
        correctIndex: 0
      }
    ],
    aiTutorGuidance: `You are @tutor. Guide the student on ${title} using Socratic questions. Give hints on approach and test failures, but do not provide direct copy-paste solutions.`
  }

  return {
    topic,
    title,
    gradeLevel,
    targetDuration,
    slides,
    assignment
  }
}

export function synthesizePassionProject(passionPrompt, options = {}) {
  const promptText = String(passionPrompt || '').trim()
  const lower = promptText.toLowerCase()

  let domain = 'Creative Technology & Interactive Apps'
  let title = 'Project Canvas: Interactive Python Application'
  let heroPioneer = {
    name: 'Ada Lovelace',
    era: '1815–1852',
    contribution: 'Wrote the world\'s first computer algorithm and envisioned computers creating algorithmic music and art beyond simple calculation.'
  }
  let starterFileName = 'main.py'
  let starterCode = ''
  let testCode = ''
  let milestones = []
  let projectDesc = ''

  if (lower.includes('music') || lower.includes('beat') || lower.includes('audio') || lower.includes('song') || lower.includes('dj') || lower.includes('synth')) {
    domain = 'Music Production & Algorithmic Audio'
    title = 'SoundWave: Algorithmic Drum Machine & Audio Sequencer'
    heroPioneer = {
      name: 'Wendy Carlos',
      era: '1939–Present',
      contribution: 'Pioneered synthesized electronic music (Switched-On Bach) and shaped modern synthesizer audio engineering.'
    }
    projectDesc = 'Build an algorithmic drum machine that sequences beats, calculates tempo (BPM), and generates layered rhythms from code.'
    milestones = [
      { id: 'm1', title: 'Rhythm Matrix', goal: 'Define drum track instruments (kick, snare, hi-hat) and 16-step beat patterns.' },
      { id: 'm2', title: 'BPM & Timing Engine', goal: 'Calculate step durations in milliseconds based on user-chosen tempo.' },
      { id: 'm3', title: 'Euclidean Rhythm Generator', goal: 'Algorithmically distribute hits across steps using spacing math.' },
      { id: 'm4', title: 'ASCII Sound Stage & Export', goal: 'Render visual beat progress bar in the terminal and export sequence.' }
    ]
    starterCode = `# SoundWave: Algorithmic Drum Machine & Beat Sequencer
# Inspired by pioneer Wendy Carlos

class BeatSequencer:
    def __init__(self, bpm=120):
        self.bpm = bpm
        self.tracks = {}

    def add_track(self, instrument_name, pattern_16_steps):
        """Add a 16-step pattern (e.g., [1, 0, 0, 0, 1, 0, 0, 0, ...])"""
        if len(pattern_16_steps) != 16:
            raise ValueError("Pattern must have exactly 16 steps")
        self.tracks[instrument_name] = list(pattern_16_steps)

    def step_duration_ms(self):
        """Calculate duration of a 16th note step in milliseconds."""
        return (60000.0 / self.bpm) / 4.0

    def active_hits_at_step(self, step_index):
        """Return list of instruments that trigger at this step (0-15)."""
        idx = step_index % 16
        return [inst for inst, pattern in self.tracks.items() if pattern[idx] == 1]

if __name__ == '__main__':
    seq = BeatSequencer(bpm=128)
    seq.add_track('kick',  [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0])
    seq.add_track('snare', [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0])
    seq.add_track('hihat', [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1])
    print(f"Loaded {len(seq.tracks)} tracks at {seq.bpm} BPM (Step: {seq.step_duration_ms():.1f} ms)")
    for step in range(8):
        hits = seq.active_hits_at_step(step)
        print(f"Step {step+1:02d}: {', '.join(hits) if hits else '-'}")
`
    testCode = `# test_soundwave.py - Unit tests for BeatSequencer
from main import BeatSequencer

def test_bpm_step_duration():
    seq = BeatSequencer(bpm=120)
    assert seq.step_duration_ms() == 125.0

def test_active_hits():
    seq = BeatSequencer(bpm=120)
    seq.add_track('kick', [1] + [0] * 15)
    seq.add_track('snare', [0, 1] + [0] * 14)
    assert seq.active_hits_at_step(0) == ['kick']
    assert seq.active_hits_at_step(1) == ['snare']
    assert seq.active_hits_at_step(2) == []
`
  } else if (lower.includes('fashion') || lower.includes('cloth') || lower.includes('sew') || lower.includes('sustainab') || lower.includes('wear') || lower.includes('eco')) {
    domain = 'Sustainable Fashion & Eco-Material Tech'
    title = 'EcoThread: Fashion Material Life-Cycle & Carbon Analyzer'
    heroPioneer = {
      name: 'Dr. Rebeccah Pailes-Friedman',
      era: 'Modern Innovator',
      contribution: 'Pioneered smart textiles, wearable computing, and sustainable closed-loop apparel engineering.'
    }
    projectDesc = 'Calculate the environmental footprint (water usage, carbon emissions) of garment designs and suggest sustainable eco-alternatives.'
    milestones = [
      { id: 'm1', title: 'Fabric Catalog', goal: 'Build a catalog of fabric properties (organic cotton, recycled polyester, hemp, linen).' },
      { id: 'm2', title: 'Impact Score Calculator', goal: 'Calculate total water and carbon footprints based on garment weight and blend ratios.' },
      { id: 'm3', title: 'Eco-Swap Recommender', goal: 'Suggest lower-impact sustainable alternative materials.' },
      { id: 'm4', title: 'Garment Eco-Label Generator', goal: 'Generate transparent, verifiable sustainability scorecard reports.' }
    ]
    starterCode = `# EcoThread: Sustainable Garment Life-Cycle Analyzer
# Inspired by smart textile innovators

FABRICS = {
    'organic_cotton': {'water_l_per_kg': 2400, 'carbon_kg_per_kg': 3.8, 'biodegradable': True},
    'conventional_cotton': {'water_l_per_kg': 10000, 'carbon_kg_per_kg': 8.5, 'biodegradable': True},
    'recycled_poly': {'water_l_per_kg': 50, 'carbon_kg_per_kg': 3.2, 'biodegradable': False},
    'hemp': {'water_l_per_kg': 1200, 'carbon_kg_per_kg': 2.1, 'biodegradable': True}
}

class Garment:
    def __init__(self, name, weight_kg=0.3):
        self.name = name
        self.weight_kg = weight_kg
        self.materials = {}

    def add_blend(self, fabric_name, percentage):
        if fabric_name not in FABRICS:
            raise KeyError(f"Unknown fabric: {fabric_name}")
        self.materials[fabric_name] = percentage

    def calculate_footprint(self):
        total_water = 0.0
        total_carbon = 0.0
        for fab, pct in self.materials.items():
            ratio = pct / 100.0
            total_water += self.weight_kg * ratio * FABRICS[fab]['water_l_per_kg']
            total_carbon += self.weight_kg * ratio * FABRICS[fab]['carbon_kg_per_kg']
        return {'water_liters': round(total_water, 1), 'carbon_kg': round(total_carbon, 2)}
`
    testCode = `# test_ecothread.py - Verification for Garment footprint
from main import Garment

def test_pure_cotton_footprint():
    g = Garment("T-Shirt", weight_kg=0.2)
    g.add_blend("organic_cotton", 100)
    fp = g.calculate_footprint()
    assert fp['water_liters'] == 480.0
    assert fp['carbon_kg'] == 0.76

def test_eco_blend():
    g = Garment("Hoodie", weight_kg=0.5)
    g.add_blend("organic_cotton", 50)
    g.add_blend("hemp", 50)
    fp = g.calculate_footprint()
    assert fp['water_liters'] == 900.0
`
  } else if (lower.includes('space') || lower.includes('star') || lower.includes('astro') || lower.includes('nasa') || lower.includes('planet')) {
    domain = 'Astrophysics & Space Science'
    title = 'AstroTransit: Exoplanet Detector & Lightcurve Analyzer'
    heroPioneer = {
      name: 'Katherine Johnson & Dr. Katie Bouman',
      era: 'Pioneering Space Scientists',
      contribution: 'Katherine calculated Apollo trajectories; Dr. Bouman created algorithms capturing the first direct photograph of a black hole.'
    }
    projectDesc = 'Analyze telescope lightcurve brightness measurements to detect distant planets orbiting far-off stars using the transit method.'
    milestones = [
      { id: 'm1', title: 'Lightcurve Ingestion', goal: 'Parse time-series star brightness data points.' },
      { id: 'm2', title: 'Transit Dip Detection', goal: 'Identify statistical drops in relative star luminosity.' },
      { id: 'm3', title: 'Orbital Period Calculation', goal: 'Measure repeat intervals between transit dips.' },
      { id: 'm4', title: 'Planetary Radius Estimator', goal: 'Estimate exoplanet size relative to host star.' }
    ]
    starterCode = `# AstroTransit: Exoplanet Lightcurve Analyzer
# Inspired by Katherine Johnson and Dr. Katie Bouman

class LightcurveAnalyzer:
    def __init__(self, baseline_flux=1.0):
        self.baseline_flux = baseline_flux
        self.measurements = []

    def record_reading(self, timestamp_hours, relative_flux):
        self.measurements.append({'time': timestamp_hours, 'flux': relative_flux})

    def detect_transits(self, dip_threshold=0.015):
        """Detect dips where flux drops below (baseline - threshold)."""
        dips = []
        for m in self.measurements:
            if m['flux'] <= (self.baseline_flux - dip_threshold):
                dips.append(m)
        return dips

    def estimate_planet_radius_ratio(self, min_transit_flux):
        depth = max(0.0, self.baseline_flux - min_transit_flux)
        return depth ** 0.5
`
    testCode = `# test_astrotransit.py
from main import LightcurveAnalyzer

def test_detect_transit():
    an = LightcurveAnalyzer(baseline_flux=1.0)
    an.record_reading(1.0, 1.0)
    an.record_reading(2.0, 0.98)
    an.record_reading(3.0, 1.0)
    dips = an.detect_transits(dip_threshold=0.015)
    assert len(dips) == 1
    assert dips[0]['time'] == 2.0
`
  } else if (lower.includes('sport') || lower.includes('soccer') || lower.includes('basket') || lower.includes('athlete') || lower.includes('run')) {
    domain = 'Sports Performance & Biometrics Analytics'
    title = 'PlayMetrics: Athletic Performance & Team Heatmap Tracker'
    heroPioneer = {
      name: 'Gladys West',
      era: '1930–Present',
      contribution: 'Mathematician whose geodetic earth models and satellite orbital calculations led directly to modern GPS location tracking.'
    }
    projectDesc = 'Analyze athlete sprint velocity, endurance pacing, and tactical position zones using coordinate math.'
    milestones = [
      { id: 'm1', title: 'Position Tracking', goal: 'Ingest coordinate data (x, y) over match intervals.' },
      { id: 'm2', title: 'Speed & Distance Calculation', goal: 'Calculate total distance covered and top sprint speed.' },
      { id: 'm3', title: 'High-Intensity Zone', goal: 'Flag sprint bursts exceeding speed thresholds.' },
      { id: 'm4', title: 'Tactical Pitch Heatmap', goal: 'Generate zone possession and coverage breakdown.' }
    ]
    starterCode = `# PlayMetrics: Sports Performance Tracker
# Inspired by GPS pioneer Gladys West
import math

class PlayerSession:
    def __init__(self, player_name):
        self.player_name = player_name
        self.fixes = []

    def log_coordinate(self, time_sec, x_meters, y_meters):
        self.fixes.append({'t': time_sec, 'x': x_meters, 'y': y_meters})

    def total_distance(self):
        dist = 0.0
        for i in range(1, len(self.fixes)):
            p1, p2 = self.fixes[i-1], self.fixes[i]
            dist += math.hypot(p2['x'] - p1['x'], p2['y'] - p1['y'])
        return round(dist, 2)
`
    testCode = `# test_playmetrics.py
from main import PlayerSession

def test_distance():
    p = PlayerSession("Alex")
    p.log_coordinate(0, 0, 0)
    p.log_coordinate(1, 3, 4)
    assert p.total_distance() == 5.0
`
  } else {
    domain = 'Interactive Creative Computing'
    title = `CraftLab: ${promptText ? promptText.slice(0, 30) : 'Personal Passion'} Project Engine`
    heroPioneer = {
      name: 'Margaret Hamilton',
      era: '1936–Present',
      contribution: 'Director of the Software Engineering Division of the MIT Instrumentation Laboratory, which developed on-board flight software for Apollo 11.'
    }
    projectDesc = `Turn your passion for "${promptText || 'coding'}" into an interactive modular application with structured data models and real-time execution.`
    milestones = [
      { id: 'm1', title: 'Data Structures', goal: 'Model core entities representing your project objects.' },
      { id: 'm2', title: 'Core Logic & Transformers', goal: 'Implement state updates, algorithms, and handlers.' },
      { id: 'm3', title: 'Verification Tests', goal: 'Automated test suite ensuring stability across edge cases.' },
      { id: 'm4', title: 'Interactive CLI / UI', goal: 'Build an engaging interactive interface to run the application.' }
    ]
    starterCode = `# CraftLab: ${title}
# Designed for passion-driven learning

def process_item(item_data):
    """Core logic to process incoming project data."""
    if not item_data:
        return {'status': 'empty', 'score': 0}
    return {'status': 'active', 'score': len(item_data) * 10}
`
    testCode = `# test_craftlab.py
from main import process_item

def test_process():
    res = process_item("code")
    assert res['status'] == 'active'
    assert res['score'] == 40
`
  }

  const socraticCoachPrompt = `You are @coach, a warm, encouraging, and supportive coding mentor. The student is passionate about "${promptText || domain}". Guide them through building "${title}" milestone by milestone.`

  return {
    prompt: promptText,
    domain,
    title,
    projectDesc,
    heroPioneer,
    milestones,
    starterFileName,
    starterCode,
    testCode,
    socraticCoachPrompt
  }
}


// Free Tier Monetization (Sponsored Dev Tools) & Corporate Free Tier Rules
// (2026-11-07, the team) no company is shown as a sponsor without a signed deal; the made-up Neon, Upstash and Nebius cards were removed
export const SPONSORED_RECOMMENDATIONS = []

export function getAccountMonetization (account) {
  const flavor = account?.flavor || 'dev_team'
  const isCorp = flavor === 'corporate'
  const plan = account?.plan || 'free'
  const isFree = plan === 'free'

  return {
    flavor,
    plan,
    isFree,
    isCorporate: isCorp,
    showAds: isFree,
    sponsoredAd: isFree ? (SPONSORED_RECOMMENDATIONS[0] || null) : null,
    domainLockAllowed: !isFree || !isCorp,
    externalViewersAllowed: isFree && isCorp, // corporate free CANNOT stop outside viewers
    zeroDataRetention: !isFree,
    dataRetainedForTraining: isFree,
    enterpriseSSO: !isFree && isCorp,
    notice: isFree && isCorp ? 'Corporate Free: Domain lockdown & access auth disabled. External viewers can view this room. Data retained for AI improvements. Upgrade to Enterprise for zero-retention & domain shielding.' : null
  }
}
