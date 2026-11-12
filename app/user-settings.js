// app/user-settings.js
// Comprehensive user settings, billing, usage metrics, shortcuts, macros and the full settings panels.
// Parity port with native/Vespr.Core/UserSettingsManager.cs.

export class UserSettingsService {
  constructor() {
    this._codeSettings = {
      branchPrefix: 'vespr',
      labelSessionsByStatus: true,
      defaultTranscriptView: 'Normal',
      dynamicWorkflows: false,
      promptSuggestions: true,
      summaryAndNextSteps: true,
      unrelatedTaskAction: 'Ask me',
      outputStyle: 'Default',
      openPullRequestsAutomatically: true,
      activeModel: 'nebius:nemotron-3-super',
      isSandboxed: true
    };
    try {
      if (typeof localStorage !== 'undefined') {
        const saved = localStorage.getItem('vespr_code_settings');
        if (saved) Object.assign(this._codeSettings, JSON.parse(saved));
      }
    } catch {}

    this._accountProfile = {
      fullName: 'the VESPR team',
      preferredName: 'the team',
      workDescription: 'Software Engineer & Architect',
      orgId: 'b7b8fed3-4269-4452-8ef8-be53ed03510e',
      profilePhotoUrl: 'brand/avatar-sb.png'
    };
    try {
      if (typeof localStorage !== 'undefined') {
        const saved = localStorage.getItem('vespr_user_profile');
        if (saved) Object.assign(this._accountProfile, JSON.parse(saved));
      }
    } catch {}

    this._appearance = {
      theme: 'dark',
      fontScale: 'normal',
      syntaxTheme: 'jetbrains-dark',
      highContrast: false,
      reducedMotion: false
    };
    try {
      if (typeof localStorage !== 'undefined') {
        const saved = localStorage.getItem('vespr_appearance');
        if (saved) Object.assign(this._appearance, JSON.parse(saved));
      }
    } catch {}

    this._aiPersona = {
      tone: 'concise_sde',
      customInstructions: '',
      autoExtractConventions: true,
      memoryRetentionActive: true
    };
    try {
      if (typeof localStorage !== 'undefined') {
        const saved = localStorage.getItem('vespr_ai_persona');
        if (saved) Object.assign(this._aiPersona, JSON.parse(saved));
      }
    } catch {}

    this._capabilities = {
      autonomousSwarm: true,
      webSearchReach: 'allowlist',
      sandboxBackend: 'managed_sandbox',
      autoPullRequests: true,
      benchmarkTelemetryCollection: true
    };

    this._notifications = {
      audioChimes: true,
      soundTheme: 'subtle',
      desktopPush: true,
      emailSummaries: false,
      slackWebhookUrl: ''
    };

    this._privacy = {
      zeroDataTraining: true,
      telemetryOptIn: true,
      retentionDays: 180,
      secretRedactionLevel: 'strict'
    };

    this._wellbeing = {
      pomodoroReminders: true,
      breakIntervalMinutes: 50,
      eyeComfortMode: false,
      dailySpendWarningDollars: 20.00
    };
    try { if (typeof localStorage !== 'undefined') { const saved = localStorage.getItem('vespr_wellbeing'); if (saved) Object.assign(this._wellbeing, JSON.parse(saved)); } } catch {}

    this._cowork = {
      collaborativePairing: true,
      cursorPresence: true,
      sharedTerminal: true,
      voiceTranscription: true
    };

    this._desktopApp = {
      directPiHost: 'http://10.0.0.8:8240',
      autoSyncIntervalSeconds: 30,
      autoRestartOnNewBuild: true,
      offlineFileCache: true
    };

    const now = new Date();
    this._apiKeys = []; // starts empty: keys appear only when the person adds them (no invented sample keys)

    this._billingPlan = {
      planTier: 'Pro plan',
      cadence: 'Monthly',
      nextRenewalDate: new Date(now.getTime() + 8 * 24 * 3600 * 1000).toISOString(),
      usageCreditBalance: 13.45,
      autoReloadThreshold: 5.00,
      autoReloadAmount: 15.00,
      autoReloadEnabled: true
    };

    this._paymentMethods = [
      { id: 'pm_1', brand: 'Visa', last4: '3948', expDate: '03/2030', isDefault: false },
      { id: 'pm_2', brand: 'American Express', last4: '3029', expDate: '05/2030', isDefault: false },
      { id: 'pm_3', brand: 'Visa', last4: '6860', expDate: '06/2030', isDefault: true }
    ];

    this._usageMetrics = {
      currentSessionPercent: 0,
      weeklyPercentUsed: 0,
      resetSchedule: 'Weekly cycle',
      limitHit: false,
      purchasedCredits: 13.45,
      usageCreditsEnabled: true
    };

    this._shortcuts = new Map([
      ['settings', 'Ctrl+,'],
      ['palette', 'Ctrl+K'],
      ['chatToggle', 'Ctrl+J'],
      ['runCode', 'Ctrl+Enter'],
      ['reportIssue', 'Shift+Alt+R'],
      ['formatCode', 'Shift+Alt+F']
    ]);

    this._macros = [
      {
        id: 'macro_clean_test',
        name: 'Clean, Build & Test All',
        triggerKey: 'Ctrl+Shift+T',
        actions: ['git status', 'dotnet test native/Vespr.sln', 'pytest -q']
      },
      {
        id: 'macro_ai_review',
        name: 'Trigger AI Code Review',
        triggerKey: 'Ctrl+Shift+R',
        actions: ['@reviewer review staged changes for security and style']
      }
    ];

    this._mouseConfig = {
      leftClickAction: 'select_and_open',
      rightClickAction: 'context_menu_with_report',
      swapButtons: false
    };

    // connectors are the server's (server/connectors.js, app/connectors-panel.js), not a list here

    this._recurringChats = [
      { id: 'rec_morning_audit', title: 'Daily Morning Security & Vulnerability Scan', interval: 'Daily (9:00 AM)', nextRun: 'Tomorrow, 9:00 AM', active: true, targetAgent: 'security_auditor' },
      { id: 'rec_weekly_triage', title: 'Weekly AI Issue Triage & Bug Sweep', interval: 'Weekly (Every Monday)', nextRun: 'Monday, 8:00 AM', active: true, targetAgent: 'coder' },
      { id: 'rec_pr_summary', title: 'PR Sync & Classroom Pod Review', interval: 'Daily (5:00 PM)', nextRun: 'Today, 5:00 PM', active: false, targetAgent: 'reviewer' }
    ];
  }

  getCodeSettings() { return { ...this._codeSettings }; }
  updateCodeSettings(patch) {
    this._codeSettings = { ...this._codeSettings, ...patch };
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('vespr_code_settings', JSON.stringify(this._codeSettings));
      }
    } catch {}
  }

  getAccountProfile() { return { ...this._accountProfile }; }
  updateAccountProfile(patch) {
    this._accountProfile = { ...this._accountProfile, ...patch };
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('vespr_user_profile', JSON.stringify(this._accountProfile));
      }
    } catch {}
  }

  getAppearance() { return { ...this._appearance }; }
  updateAppearance(patch) {
    this._appearance = { ...this._appearance, ...patch };
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('vespr_appearance', JSON.stringify(this._appearance));
      }
    } catch {}
    if (typeof document !== 'undefined') {
      if (patch.theme) {
        const eff = patch.theme === 'system'
          ? (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
          : patch.theme;
        document.documentElement.setAttribute('data-theme', eff);
        document.documentElement.dataset.theme = eff;
      }
      if (patch.fontScale) {
        document.documentElement.dataset.fontScale = patch.fontScale;
        if (patch.fontScale === 'compact') {
          document.body.style.fontSize = '12px';
        } else if (patch.fontScale === 'relaxed') {
          document.body.style.fontSize = '14.5px';
        } else {
          document.body.style.fontSize = '';
        }
      }
      if (patch.highContrast !== undefined) {
        document.documentElement.classList.toggle('high-contrast', !!patch.highContrast);
      }
      if (patch.reducedMotion !== undefined) {
        document.documentElement.classList.toggle('reduced-motion', !!patch.reducedMotion);
      }
    }
  }

  getAiPersona() { return { ...this._aiPersona }; }
  updateAiPersona(patch) {
    this._aiPersona = { ...this._aiPersona, ...patch };
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('vespr_ai_persona', JSON.stringify(this._aiPersona));
      }
    } catch {}
  }

  getCapabilities() { return { ...this._capabilities }; }
  updateCapabilities(patch) { this._capabilities = { ...this._capabilities, ...patch }; }

  getNotifications() { return { ...this._notifications }; }
  updateNotifications(patch) { this._notifications = { ...this._notifications, ...patch }; }

  getPrivacy() { return { ...this._privacy }; }
  updatePrivacy(patch) { this._privacy = { ...this._privacy, ...patch }; }

  getWellbeing() { return { ...this._wellbeing }; }
  updateWellbeing(patch) { this._wellbeing = { ...this._wellbeing, ...patch }; try { if (typeof localStorage !== 'undefined') localStorage.setItem('vespr_wellbeing', JSON.stringify(this._wellbeing)); } catch {} }

  getCowork() { return { ...this._cowork }; }
  updateCowork(patch) { this._cowork = { ...this._cowork, ...patch }; }

  getDesktopApp() { return { ...this._desktopApp }; }
  updateDesktopApp(patch) { this._desktopApp = { ...this._desktopApp, ...patch }; }

  getApiKeys() { return this._apiKeys.map(k => ({ ...k })); }
  addApiKey(label, provider, rawKey) {
    const id = 'key_' + Math.random().toString(36).substring(2, 8);
    const prefix = rawKey.length > 6 ? rawKey.substring(0, 6) : 'key';
    const masked = rawKey.length > 8 ? prefix + '•••••••••••••' + rawKey.slice(-3) : '••••••••';
    const record = { id, label, keyPrefix: prefix, keyMasked: masked, provider, createdAt: new Date().toISOString(), lastUsedAt: null };
    this._apiKeys.push(record);
    return record;
  }
  revokeApiKey(id) {
    const idx = this._apiKeys.findIndex(k => k.id === id);
    if (idx === -1) return false;
    this._apiKeys.splice(idx, 1);
    return true;
  }

  getRecurringChats() { return this._recurringChats.map(r => ({ ...r })); }
  addRecurringChat(title, interval, targetAgent = 'coder') {
    const id = 'rec_' + Date.now();
    const item = { id, title, interval, nextRun: 'Next interval', active: true, targetAgent };
    this._recurringChats.push(item);
    return item;
  }
  toggleRecurringChat(id) {
    const r = this._recurringChats.find(x => x.id === id);
    if (r) { r.active = !r.active; return true; }
    return false;
  }

  getBillingPlan() { return { ...this._billingPlan }; }
  updateBillingPlan(patch) { this._billingPlan = { ...this._billingPlan, ...patch }; }

  getPaymentMethods() { return this._paymentMethods.map(p => ({ ...p })); }
  setDefaultPaymentMethod(id) {
    this._paymentMethods.forEach(pm => { pm.isDefault = pm.id === id; });
  }

  getUsageMetrics() { return { ...this._usageMetrics }; }
  updateUsageMetrics(patch) { this._usageMetrics = { ...this._usageMetrics, ...patch }; }

  getShortcuts() {
    return Object.fromEntries(this._shortcuts.entries());
  }
  setShortcut(action, key) {
    if (!action || !key) return false;
    this._shortcuts.set(action, key.trim());
    return true;
  }

  getMacros() { return this._macros.map(m => ({ ...m })); }
  addMacro(macro) {
    this._macros = this._macros.filter(m => m.id !== macro.id);
    this._macros.push(macro);
  }

  getMouseConfig() { return { ...this._mouseConfig }; }
  updateMouseConfig(patch) { this._mouseConfig = { ...this._mouseConfig, ...patch }; }

}
