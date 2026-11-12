// app/test/user-settings.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { UserSettingsService } from '../user-settings.js';

test('UserSettingsService initializes default code and profile settings', () => {
  const svc = new UserSettingsService();
  const code = svc.getCodeSettings();
  assert.equal(code.branchPrefix, 'vespr');
  assert.equal(code.labelSessionsByStatus, true);
  assert.equal(code.defaultTranscriptView, 'Normal');

  const profile = svc.getAccountProfile();
  assert.equal(profile.fullName, 'the VESPR team');
  assert.equal(profile.preferredName, 'the team');
});

test('UserSettingsService manages payment methods and billing plan', () => {
  const svc = new UserSettingsService();
  const pms = svc.getPaymentMethods();
  assert.equal(pms.length, 3);

  svc.setDefaultPaymentMethod('pm_1');
  const updated = svc.getPaymentMethods();
  assert.equal(updated.find(p => p.id === 'pm_1').isDefault, true);
  assert.equal(updated.find(p => p.id === 'pm_3').isDefault, false);
});

test('UserSettingsService manages shortcuts and macros', () => {
  const svc = new UserSettingsService();
  assert.equal(svc.getShortcuts().settings, 'Ctrl+,');

  svc.setShortcut('settings', 'Ctrl+Shift+S');
  assert.equal(svc.getShortcuts().settings, 'Ctrl+Shift+S');

  assert.equal(svc.getConnectors, undefined, 'connectors come from the server (server/connectors.js), never a made-up list')
});

test('UserSettingsService manages the full settings panels', () => {
  const svc = new UserSettingsService();

  // Appearance
  assert.equal(svc.getAppearance().theme, 'dark');
  svc.updateAppearance({ fontScale: 'compact', syntaxTheme: 'monokai' });
  assert.equal(svc.getAppearance().fontScale, 'compact');
  assert.equal(svc.getAppearance().syntaxTheme, 'monokai');

  // AI Persona
  assert.equal(svc.getAiPersona().tone, 'concise_sde');
  svc.updateAiPersona({ tone: 'senior_architect' });
  assert.equal(svc.getAiPersona().tone, 'senior_architect');

  // Capabilities
  assert.equal(svc.getCapabilities().autonomousSwarm, true);
  assert.equal(svc.getCapabilities().webSearchReach, 'allowlist');

  // Notifications
  assert.equal(svc.getNotifications().audioChimes, true);
  assert.equal(svc.getNotifications().soundTheme, 'subtle');

  // Privacy & Retention
  assert.equal(svc.getPrivacy().zeroDataTraining, true);
  assert.equal(svc.getPrivacy().retentionDays, 180);

  // Wellbeing
  assert.equal(svc.getWellbeing().breakIntervalMinutes, 50);

  // Cowork
  assert.equal(svc.getCowork().collaborativePairing, true);

  // Desktop App
  assert.equal(svc.getDesktopApp().directPiHost, 'http://10.0.0.8:8240');
  assert.equal(svc.getDesktopApp().autoSyncIntervalSeconds, 30);

  // API Keys
  const keys = svc.getApiKeys();
  assert.equal(keys.length, 0, 'no invented sample keys: the list starts empty');
  const newKey = svc.addApiKey('Local Test Key', 'OpenAI', 'sk-test1234567890abcdef');
  assert.ok(newKey.id.startsWith('key_'));
  assert.equal(svc.getApiKeys().length, 1);
  const revoked = svc.revokeApiKey(newKey.id);
  assert.equal(revoked, true);
  assert.equal(svc.getApiKeys().length, 0);

  // Recurring Chats
  const recurring = svc.getRecurringChats();
  assert.equal(recurring.length, 3);
  const newRec = svc.addRecurringChat('Nightly Regression Sweep', 'Daily (11:00 PM)', 'testrunner');
  assert.ok(newRec.id.startsWith('rec_'));
  assert.equal(svc.getRecurringChats().length, 4);
  svc.toggleRecurringChat(newRec.id);
  assert.equal(svc.getRecurringChats().find(r => r.id === newRec.id).active, false);
});
