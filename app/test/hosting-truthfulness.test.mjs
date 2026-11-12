// Actual prototype hosting and usage truthfulness behavior test suite.
// Exercises openHostingDashboard state preservation, real deployWorkspaceAction fetch dispatch,
// and renderUsageStrip threshold styling and zero-mock hiding rules.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../prototype.html', import.meta.url), 'utf8');

// Extract openHostingDashboard
const ohdStart = source.indexOf('function openHostingDashboard() {');
assert.ok(ohdStart > 0, 'openHostingDashboard must exist');
const ohdEnd = source.indexOf('function closeHostingDashboard() {', ohdStart);
assert.ok(ohdEnd > ohdStart, 'closeHostingDashboard must follow openHostingDashboard');
const openHostingDashboardSource = source.slice(ohdStart, ohdEnd);

// Extract deployWorkspaceAction
const dwaStart = source.indexOf('async function deployWorkspaceAction() {');
assert.ok(dwaStart > 0, 'deployWorkspaceAction must exist');
const dwaEnd = source.indexOf('function promptConnectDashboard() {', dwaStart);
assert.ok(dwaEnd > dwaStart, 'promptConnectDashboard must follow deployWorkspaceAction');
const deployWorkspaceActionSource = source.slice(dwaStart, dwaEnd);

// Extract renderUsageStrip
const rusStart = source.indexOf('function renderUsageStrip() {');
assert.ok(rusStart > 0, 'renderUsageStrip must exist');
const rusEnd = source.indexOf('function triggerGuidedHighlight(', rusStart);
assert.ok(rusEnd > rusStart, 'triggerGuidedHighlight must follow renderUsageStrip');
const renderUsageStripSource = source.slice(rusStart, rusEnd);

function makeHarness(initialState = {}) {
  const calls = {
    fetch: [],
    toasts: [],
    nav: 0,
    renderHostingTab: 0,
    renderHostingDashboard: 0,
    renderDashboardSlot: 0,
    openAppSettings: []
  };

  const state = {
    workspace: 'vespr-app',
    hasHosting: false,
    activeView: null,
    usageStripDismissed: false,
    usageTelemetry: null,
    weeklyUsagePercent: null,
    ...initialState
  };

  const dom = {
    hostingPage: { hidden: true },
    app: { dataset: {} },
    hostingGlobalStatusBadge: { textContent: '', className: '' },
    hostingLogsTerminal: { textContent: '', scrollTop: 0, scrollHeight: 100 },
    hostingDeployTime: { textContent: '' },
    chatUsageStrip: { hidden: false, onclick: null },
    chatUsageTxt: { textContent: '' },
    chatUsageFill: { style: { width: '', background: '' } },
    chatUsageCloseBtn: { id: 'chatUsageCloseBtn' }
  };

  const sandbox = {
    state,
    document: {
      getElementById: (id) => dom[id] || null,
      querySelector: () => null
    },
    fetch: async (url, opts) => {
      calls.fetch.push({ url, opts });
      return {
        ok: true,
        status: 200,
        json: async () => ({ status: 'ok', commit: 'abc1234' })
      };
    },
    toast: (msg) => calls.toasts.push(msg),
    nav: () => calls.nav++,
    renderHostingTab: () => calls.renderHostingTab++,
    renderHostingDashboard: () => calls.renderHostingDashboard++,
    renderDashboardSlot: () => calls.renderDashboardSlot++,
    openAppSettings: (arg) => calls.openAppSettings.push(arg),
    window: {}
  };

  vm.runInNewContext(
    openHostingDashboardSource + '\n' +
    deployWorkspaceActionSource + '\n' +
    renderUsageStripSource,
    sandbox
  );

  return { sandbox, state, dom, calls };
}

test('openHostingDashboard does NOT manufacture hasHosting = true', () => {
  const { sandbox, state, dom } = makeHarness({ hasHosting: false });

  sandbox.openHostingDashboard();

  assert.equal(state.activeView, 'hosting');
  assert.equal(dom.hostingPage.hidden, false);
  assert.equal(dom.app.dataset.page, 'hosting');
  assert.equal(state.hasHosting, false, 'hasHosting must NOT be set to true simply by opening dashboard');
});

test('deployWorkspaceAction dispatches real fetch to /api/hosting/deploy', async () => {
  const { sandbox, state, dom, calls } = makeHarness({ workspace: 'my-store' });

  await sandbox.deployWorkspaceAction();

  assert.equal(calls.fetch.length, 1);
  assert.equal(calls.fetch[0].url, '/api/hosting/deploy');
  assert.equal(calls.fetch[0].opts.method, 'POST');
  assert.deepEqual(JSON.parse(calls.fetch[0].opts.body), { workspace: 'my-store' });

  assert.equal(dom.hostingGlobalStatusBadge.textContent, 'Live (HTTP 200)');
  assert.equal(dom.hostingGlobalStatusBadge.className, 'badge ok');
  assert.ok(state.lastDeploy.includes('abc1234'));
  assert.equal(calls.renderDashboardSlot, 1);
});

test('deployWorkspaceAction fails honestly when backend daemon is unreachable', async () => {
  const { sandbox, dom, calls } = makeHarness({ workspace: 'my-store' });

  // Simulate network failure
  sandbox.fetch = async () => {
    calls.fetch.push({ failed: true });
    throw new Error('Connection refused (port 9700 offline)');
  };

  await sandbox.deployWorkspaceAction();

  assert.equal(calls.fetch.length, 1);
  assert.equal(dom.hostingGlobalStatusBadge.textContent, 'Preview unavailable');
  assert.equal(dom.hostingGlobalStatusBadge.className, 'badge');
  assert.ok(dom.hostingLogsTerminal.textContent.includes('Connection refused'));
  assert.ok(calls.toasts.some(t => t.includes('Not deployed: no hosting service is connected')));
});

test('renderUsageStrip hides strip when usage telemetry and receipts are null', () => {
  const { sandbox, dom } = makeHarness({
    usageTelemetry: null,
    weeklyUsagePercent: null
  });

  sandbox.renderUsageStrip();

  assert.equal(dom.chatUsageStrip.hidden, true, 'Usage strip must remain hidden when receipts absent');
});

test('renderUsageStrip applies correct color thresholds for verified percentages', () => {
  const thresholds = [
    { pct: 50, color: '#3b82f6', expectedText: '50% of this week' },
    { pct: 75, color: '#f59e0b', expectedText: '75% of this week' },
    { pct: 90, color: '#f97316', expectedText: '90% used ? High usage alert' },
    { pct: 100, color: '#ef4444', expectedText: '100% of this week' }
  ];

  for (const { pct, color, expectedText } of thresholds) {
    const { sandbox, dom } = makeHarness({ weeklyUsagePercent: pct });
    sandbox.renderUsageStrip();

    assert.equal(dom.chatUsageStrip.hidden, false);
    assert.equal(dom.chatUsageFill.style.background, color);
    assert.equal(dom.chatUsageFill.style.width, pct + '%');
    assert.equal(dom.chatUsageTxt.textContent, expectedText);
  }
});

test('renderUsageStrip dismiss button hides strip and marks dismissed state', () => {
  const { sandbox, state, dom, calls } = makeHarness({ weeklyUsagePercent: 65 });

  sandbox.renderUsageStrip();
  assert.equal(dom.chatUsageStrip.hidden, false);

  // Trigger close button click
  const fakeEvent = {
    target: {
      closest: (sel) => sel === '#chatUsageCloseBtn' ? dom.chatUsageCloseBtn : null
    },
    stopPropagation: () => {}
  };

  dom.chatUsageStrip.onclick(fakeEvent);

  assert.equal(state.usageStripDismissed, true);
  assert.equal(dom.chatUsageStrip.hidden, true);
  assert.ok(calls.toasts.some(t => t.includes('Usage bar dismissed')));
});

test('renderUsageStrip displays verified percentage when state.realUsage ledger data is present', () => {
  const { sandbox, dom } = makeHarness({
    realUsage: {
      total: { price_usd: 7.50 },
      budget: 10.00
    }
  });

  sandbox.renderUsageStrip();

  assert.equal(dom.chatUsageStrip.hidden, false, 'Usage strip must show when realUsage ledger is present');
  assert.equal(dom.chatUsageFill.style.background, '#f59e0b', '75% must be amber');
  assert.equal(dom.chatUsageTxt.textContent, '75% of this week');
});
