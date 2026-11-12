// app/token-budget.js - Token Budget Exhaustion & Fallback Engine

export class TokenBudgetService {
  constructor() {
    this.budgets = new Map();
    this.seedBudgets();
  }

  seedBudgets() {
    this.budgets.set('you@example.com', {
      userId: 'you@example.com',
      roleId: 'senior_dev',
      dailyLimit: 1500000,
      tokensUsedToday: 1500000, // 100% used matching screenshot #5!
      availableCreditsDollars: 13.45,
      isExhausted: true,
      fallbackModel: 'phi-3-mini-local',
      resetLabel: 'Saturday, 3:00 PM EST'
    });

    this.budgets.set('student.alex@lincoln.edu', {
      userId: 'student.alex@lincoln.edu',
      roleId: 'student',
      dailyLimit: 50000,
      tokensUsedToday: 18200,
      availableCreditsDollars: 0,
      isExhausted: false,
      fallbackModel: 'tutor-heuristic-guided',
      resetLabel: 'Tomorrow, 12:00 AM EST'
    });
  }

  getBudget(userId = 'you@example.com') {
    if (this.budgets.has(userId)) return this.budgets.get(userId);
    if (userId === 'you@example.com' || userId === 'owner@example.com') {
      return this.budgets.get('you@example.com');
    }
    const fresh = {
      userId,
      roleId: 'junior_dev',
      dailyLimit: 350000,
      tokensUsedToday: 0,
      availableCreditsDollars: 0,
      isExhausted: false,
      fallbackModel: 'nemotron-3_5-lightning',
      resetLabel: 'Tomorrow, 12:00 AM EST'
    };
    this.budgets.set(userId, fresh);
    return fresh;
  }

  syncFromLedger(userId, ledgerMeData) {
    const b = this.getBudget(userId);
    if (!b || !ledgerMeData) return b;
    const tot = ledgerMeData.total || {};
    const used = (tot.input || 0) + (tot.output || 0);
    b.tokensUsedToday = used;
    if (b.tokensUsedToday >= b.dailyLimit && b.availableCreditsDollars <= 0) {
      b.isExhausted = true;
    } else {
      b.isExhausted = false;
    }
    return b;
  }

  canExecute(userId = 'you@example.com', tokens = 5000) {
    const b = this.getBudget(userId);
    if (!b.isExhausted && (b.dailyLimit - b.tokensUsedToday) >= tokens) return true;
    return b.availableCreditsDollars > 0.50;
  }

  drawCredits(userId = 'you@example.com', dollars = 2.0, tokens = 200000) {
    const b = this.getBudget(userId);
    if (b.availableCreditsDollars < dollars) return false;
    b.availableCreditsDollars -= dollars;
    b.dailyLimit += tokens;
    b.isExhausted = false;
    return true;
  }

  renderTokenExhaustedBannerHtml(userId = 'you@example.com') {
    const b = this.getBudget(userId);
    if (!b.isExhausted) return '';

    return `
      <div class="token-limit-banner" style="background:#261818;border:1px solid rgba(239,68,68,0.3);border-radius:8px;padding:8px 12px;margin-bottom:8px;display:flex;align-items:center;justify-content:space-between;box-shadow:0 4px 12px rgba(0,0,0,0.35);">
        <div style="display:flex;align-items:center;gap:8px;">
          <span style="font-size:14px;color:#ef4444;">⚠️</span>
          <div>
            <div style="font-size:12px;font-weight:600;color:#fca5a5;">Limit hit · 100% of weekly/daily tokens used</div>
            <div style="font-size:11px;color:#a1a1aa;">Resets ${b.resetLabel}. Use credits ($${b.availableCreditsDollars.toFixed(2)} available) or switch to free local model.</div>
          </div>
        </div>
        <div style="display:flex;gap:6px;">
          <button class="btn" onclick="window.tokenBudgetSvc?.drawCredits('${b.userId}'); window.renderTokenBudgetBanner?.(); toast('Drew $2.00 from credits (+200k tokens)');" style="padding:4px 8px;font-size:11px;background:#3f3f46;color:#fff;">Use Credits</button>
          <button class="btn pri" onclick="if (window.openAppSettings) window.openAppSettings('billing');" style="padding:4px 10px;font-size:11px;">Buy Credits</button>
        </div>
      </div>
    `;
  }
}