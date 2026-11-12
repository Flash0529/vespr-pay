// app/classroom-orchestrator.js
// Student age layouts (Middle School vs High School+), project scope slides, pod orchestration, and repeat scheduled chats.
// Parity port with native/Vespr.Core/ClassroomOrchestrationManager.cs.

export class ClassroomOrchestratorService {
  constructor() {
    this._ageTier = 'HighSchoolPlus'; // 'MiddleSchoolUnder' | 'HighSchoolPlus'
    this._projects = new Map();
    this._recurringSchedules = new Map();
    this._chatHistory = [];
    this._seedDefaultProject();
    this._seedDefaultSchedules();
    this._seedChatHistory();
  }

  getAgeTier() { return this._ageTier; }
  setAgeTier(tier) { this._ageTier = tier; }

  getLayoutConfig(tier = this._ageTier) {
    if (tier === 'MiddleSchoolUnder') {
      return {
        ageTier: 'MiddleSchoolUnder',
        isSimplifiedLayout: true,
        allowShellTerminal: false,
        allowNetworkEgress: false,
        allowAdvancedSettings: false,
        guidedPromptsOnly: true,
        uiMode: 'friendly_blocks'
      };
    }
    return {
      ageTier: 'HighSchoolPlus',
      isSimplifiedLayout: false,
      allowShellTerminal: true,
      allowNetworkEgress: true,
      allowAdvancedSettings: true,
      guidedPromptsOnly: false,
      uiMode: 'pro_sde'
    };
  }

  createOrchestratedProject(title, teacherPrompt, usePodsForBeginners = true) {
    const projectId = 'proj_' + Math.random().toString(36).slice(2, 10);
    const mode = usePodsForBeginners ? 'Beginner_Pods' : 'Advanced_Individual';

    const slides = [
      {
        slideNumber: 1,
        title: 'Project Architecture & Scope',
        bulletPoints: [
          'Overall objective: ' + title,
          'Teacher prompt: ' + teacherPrompt,
          'Microservice architecture split across autonomous team modules'
        ],
        scopeSummary: 'Defines system boundary and shared API specifications.'
      },
      {
        slideNumber: 2,
        title: 'Task Distribution & Pod Workflows',
        bulletPoints: [
          usePodsForBeginners ? 'Beginner Pods: 3-student pods reduce individual workload' : 'Advanced Track: 1:1 module ownership with automated unit tests',
          'Continuous integration with automated test suite',
          'AI Pair Programmer guidance enabled per student role'
        ],
        scopeSummary: 'Orchestrates individual deliverables and integration merge points.'
      }
    ];

    const parts = usePodsForBeginners ? [
      { partId: 'part_1', title: 'Cart & Calculation Engine', moduleFile: 'cart.py', assignedTo: 'Pod Alpha (Alex, Sam, Jamie)', isPod: true, podMembers: ['Alex', 'Sam', 'Jamie'], status: 'In Progress', score: 95 },
      { partId: 'part_2', title: 'Payment Gateway & Stripe Webhooks', moduleFile: 'payment.py', assignedTo: 'Pod Beta (Jordan, Taylor, Morgan)', isPod: true, podMembers: ['Jordan', 'Taylor', 'Morgan'], status: 'Submitted', score: 100 },
      { partId: 'part_3', title: 'Search & Product Indexing', moduleFile: 'search.py', assignedTo: 'Pod Gamma (Casey, Riley, Quinn)', isPod: true, podMembers: ['Casey', 'Riley', 'Quinn'], status: 'In Progress', score: 90 }
    ] : [
      { partId: 'part_1', title: 'Discount Calculation Algorithm', moduleFile: 'cart.py', assignedTo: 'Alex Morgan', isPod: false, podMembers: ['Alex Morgan'], status: 'In Progress', score: 100 },
      { partId: 'part_2', title: 'Stripe Payment Tokenizer', moduleFile: 'stripe_handler.py', assignedTo: 'Taylor Swift', isPod: false, podMembers: ['Taylor Swift'], status: 'Submitted', score: 100 },
      { partId: 'part_3', title: 'Inverted Index Parser', moduleFile: 'indexer.py', assignedTo: 'Jordan Lee', isPod: false, podMembers: ['Jordan Lee'], status: 'In Progress', score: 85 }
    ];

    const project = {
      projectId,
      title,
      teacherPrompt,
      difficultyMode: mode,
      scopeSlides: slides,
      parts,
      createdAt: new Date().toISOString()
    };

    this._projects.set(projectId, project);
    return project;
  }

  getProject(id) { return this._projects.get(id) || null; }
  listProjects() { return Array.from(this._projects.values()); }

  scheduleRepeatChat(title, prompt, intervalType = 'Daily', intervalStep = 1, attachedFiles = []) {
    const id = 'sched_' + Math.random().toString(36).slice(2, 10);
    const now = new Date();
    let nextMs = 24 * 3600 * 1000 * intervalStep;
    if (intervalType === 'Weekly') nextMs = 7 * 24 * 3600 * 1000 * intervalStep;
    if (intervalType === 'Monthly') nextMs = 30 * 24 * 3600 * 1000 * intervalStep;

    const sched = {
      scheduleId: id,
      chatTitle: title,
      promptText: prompt,
      intervalType,
      intervalStep,
      nextRun: new Date(now.getTime() + nextMs).toISOString(),
      lastRun: null,
      isActive: true,
      attachedFiles
    };
    this._recurringSchedules.set(id, sched);
    return sched;
  }

  getRecurringSchedules() {
    return Array.from(this._recurringSchedules.values())
      .sort((a, b) => new Date(a.nextRun) - new Date(b.nextRun));
  }

  _seedDefaultProject() {
    this.createOrchestratedProject(
      'E-Commerce Microservices Engine',
      'Build a modular Python e-commerce application with discount calculation, Stripe billing, and Google Classroom autograded turn-in.',
      true
    );
  }

  _seedDefaultSchedules() {
    this.scheduleRepeatChat('Daily Standup & Test Health', '@coder summarize test status, git diffs, and failing tests', 'Daily', 1, ['test_cart.py']);
    this.scheduleRepeatChat('Weekly Security & Compliance Audit', '@reviewer audit dependencies and off-company access permissions', 'Weekly', 1, ['access.js']);
  }

  _seedChatHistory() {
    const now = new Date();
    this._chatHistory = [
      { chatId: 'chat_1', title: 'Fix the discount bug in cart.py', snippet: 'Discussion on applying discounts without losing 2 decimal rounding precision.', timestamp: new Date(now.getTime() - 3600 * 1000).toISOString(), isRecurring: false, isReadOnly: false },
      { chatId: 'chat_2', title: 'Native C# Device & Corporate Security', snippet: 'Architecture discussion for desktop app logged-on device management and SOC-2 audit locks.', timestamp: new Date(now.getTime() - 3 * 3600 * 1000).toISOString(), isRecurring: false, isReadOnly: false },
      { chatId: 'chat_3', title: 'Google Classroom Autograder Sync', snippet: 'Batch export of grades and student assignment turn-in integration with Google Classroom.', timestamp: new Date(now.getTime() - 6 * 3600 * 1000).toISOString(), isRecurring: false, isReadOnly: false },
      { chatId: 'chat_4', title: 'Off-Company Partner Chat', snippet: 'Guest view-only session for external audit team.', timestamp: new Date(now.getTime() - 24 * 3600 * 1000).toISOString(), isRecurring: false, isReadOnly: true },
      { chatId: 'chat_5', title: 'Daily Standup & Test Health', snippet: 'Scheduled recurrence: daily check on test pass rates.', timestamp: new Date(now.getTime() - 48 * 3600 * 1000).toISOString(), isRecurring: true, isReadOnly: false }
    ];
  }

  searchChats(query) {
    if (!query || !query.trim()) {
      return this._chatHistory.slice().sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    }
    const q = query.toLowerCase().trim();
    const terms = q.split(/\s+/);
    return this._chatHistory
      .map(c => {
        let score = 0;
        const text = `${c.title} ${c.snippet}`.toLowerCase();
        for (const term of terms) {
          if (c.title.toLowerCase().includes(term)) score += 3.0;
          if (c.snippet.toLowerCase().includes(term)) score += 1.0;
        }
        return { ...c, relevanceScore: score };
      })
      .filter(c => c.relevanceScore > 0)
      .sort((a, b) => b.relevanceScore - a.relevanceScore);
  }

  getAgeBand() {
    return tierToAgeBand(this._ageTier);
  }

  setAgeBand(band) {
    this._ageTier = ageBandToTier(band);
    return this._ageTier;
  }

  applyRestrictions(doc = globalThis.document) {
    if (!doc) return this.getLayoutConfig();
    const config = this.getLayoutConfig();
    if (doc.body) {
      doc.body.dataset.ageTier = this.getAgeBand();
      doc.body.dataset.uiMode = config.uiMode;
    }
    const term = doc.getElementById ? doc.getElementById('terminalPane') : null;
    if (term) {
      term.hidden = !config.allowShellTerminal;
    }
    const net = doc.getElementById ? doc.getElementById('networkStatusBadge') : null;
    if (net) {
      net.textContent = config.allowNetworkEgress ? 'Full Internet' : 'Allowlist Only';
    }
    return config;
  }
}

export function tierToAgeBand(tier) {
  return tier === 'MiddleSchoolUnder' ? 'under13' : '13-17';
}

export function ageBandToTier(band) {
  return String(band || '').toLowerCase() === 'under13' ? 'MiddleSchoolUnder' : 'HighSchoolPlus';
}
