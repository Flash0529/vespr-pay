// app/test/token-budget.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { TokenBudgetService } from '../token-budget.js';

test('TokenBudgetService detects exhausted limit and draws credits', () => {
  const svc = new TokenBudgetService();
  const b = svc.getBudget('owner@example.com');
  assert.equal(b.isExhausted, true);
  assert.equal(b.availableCreditsDollars, 13.45);

  const canExec = svc.canExecute('owner@example.com');
  assert.equal(canExec, true); // Has credits

  const drawn = svc.drawCredits('owner@example.com', 2.0, 200000);
  assert.equal(drawn, true);
  assert.equal(svc.getBudget('owner@example.com').isExhausted, false);
});

test('TokenBudgetService provides fresh budget for new users and syncs from server ledger', () => {
  const svc = new TokenBudgetService();
  const fresh = svc.getBudget('new.developer@vespr.online');
  assert.equal(fresh.isExhausted, false);
  assert.equal(fresh.tokensUsedToday, 0);

  // Sync with ledger data
  const ledgerData = {
    total: { calls: 5, input: 12000, output: 3500, price_usd: 0.045 }
  };
  svc.syncFromLedger('new.developer@vespr.online', ledgerData);
  assert.equal(fresh.tokensUsedToday, 15500);
  assert.equal(fresh.isExhausted, false);
});
