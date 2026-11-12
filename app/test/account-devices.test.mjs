// app/test/account-devices.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ClientDeviceType,
  AccountLifecycleStatus,
  isSelfServiceDeactivationAllowed,
  isHistoryClearingAllowed,
  getCorporatePolicy,
  AccountDeviceService
} from '../account-devices.js';

test('AccountDeviceService seeds default sessions and history', () => {
  const svc = new AccountDeviceService();
  svc.seedDefaultSessions('alex_dev');

  const active = svc.getActiveSessions('alex_dev');
  assert.equal(active.length, 4);

  const current = active.find(s => s.isCurrentDevice);
  assert.ok(current);
  assert.equal(current.sessionId, 'sess_desktop_win11');
  assert.equal(current.clientType, ClientDeviceType.DesktopApp);

  const history = svc.getSessionHistory('alex_dev');
  assert.ok(history.length >= 3);
});

test('AccountDeviceService revokes individual session and logs history', () => {
  const svc = new AccountDeviceService();
  svc.seedDefaultSessions('alex_dev');

  const ok = svc.revokeSession('alex_dev', 'sess_mobile_ios', 'Lost phone');
  assert.equal(ok, true);

  const active = svc.getActiveSessions('alex_dev');
  assert.equal(active.length, 3);
  assert.equal(active.some(s => s.sessionId === 'sess_mobile_ios'), false);

  const sess = svc.getSession('sess_mobile_ios');
  assert.equal(sess.isRevoked, true);
  assert.equal(sess.revokedBy, 'alex_dev');

  const history = svc.getSessionHistory('alex_dev');
  assert.ok(history.some(h => h.eventType === 'device_revoked' && h.details.includes('sess_mobile_ios')));
});

test('AccountDeviceService revokes all other sessions leaving current active', () => {
  const svc = new AccountDeviceService();
  svc.seedDefaultSessions('alex_dev', 'sess_desktop_win11');

  const count = svc.revokeAllOtherSessions('alex_dev', 'sess_desktop_win11');
  assert.equal(count, 3);

  const active = svc.getActiveSessions('alex_dev');
  assert.equal(active.length, 1);
  assert.equal(active[0].sessionId, 'sess_desktop_win11');
  assert.equal(active[0].isCurrentDevice, true);
});

test('isSelfServiceDeactivationAllowed follows corporate and school governance', () => {
  assert.equal(isSelfServiceDeactivationAllowed('solo_dev', 'dev_team'), true);
  assert.equal(isSelfServiceDeactivationAllowed('solo_dev', 'personal'), true);
  assert.equal(isSelfServiceDeactivationAllowed('junior_dev', 'corporate'), false);
  assert.equal(isSelfServiceDeactivationAllowed('senior_dev', 'corporate'), false);
  assert.equal(isSelfServiceDeactivationAllowed('corporate_legal', 'corporate'), false);
  assert.equal(isSelfServiceDeactivationAllowed('it_admin', 'corporate'), false);
  assert.equal(isSelfServiceDeactivationAllowed('student', 'school'), false);
  assert.equal(isSelfServiceDeactivationAllowed('teacher', 'school'), false);
});

test('clearSessionHistory blocks corporate and school accounts', () => {
  const svc = new AccountDeviceService();
  svc.seedDefaultSessions('corp_user');

  const res = svc.clearSessionHistory('corp_user', 'senior_dev', 'corporate');
  assert.equal(res.success, false);
  assert.match(res.error, /compliance/i);

  const history = svc.getSessionHistory('corp_user');
  assert.ok(history.length >= 3);
});

test('clearSessionHistory allows solo_dev accounts', () => {
  const svc = new AccountDeviceService();
  svc.seedDefaultSessions('solo_user');

  const res = svc.clearSessionHistory('solo_user', 'solo_dev', 'personal');
  assert.equal(res.success, true);
  assert.equal(res.error, '');

  const history = svc.getSessionHistory('solo_user');
  assert.equal(history.length, 1);
  assert.equal(history[0].eventType, 'history_cleared');
});

test('Corporate lifecycle suspension and deactivation by authorized administrators', () => {
  const svc = new AccountDeviceService();
  svc.seedDefaultSessions('emp_1');

  // Junior dev cannot suspend
  const failRes = svc.suspendAccount('jdev', 'junior_dev', 'emp_1', 'Suspicious activity');
  assert.equal(failRes.success, false);
  assert.match(failRes.error, /Unauthorized/);
  assert.equal(svc.getAccountLifecycle('emp_1'), AccountLifecycleStatus.Active);

  // IT admin suspends account and revokes active sessions
  const suspRes = svc.suspendAccount('admin', 'it_admin', 'emp_1', 'Security investigation');
  assert.equal(suspRes.success, true);
  assert.equal(svc.getAccountLifecycle('emp_1'), AccountLifecycleStatus.Suspended);
  assert.equal(svc.getActiveSessions('emp_1').length, 0);

  // Reactivate
  const reactRes = svc.reactivateAccount('admin', 'it_admin', 'emp_1', 'Investigation cleared');
  assert.equal(reactRes.success, true);
  assert.equal(svc.getAccountLifecycle('emp_1'), AccountLifecycleStatus.Active);

  // Corporate Legal deactivates account
  const deactRes = svc.deactivateAccount('legal', 'corporate_legal', 'emp_1', 'Employee termination');
  assert.equal(deactRes.success, true);
  assert.equal(svc.getAccountLifecycle('emp_1'), AccountLifecycleStatus.Deactivated);
});

test('getCorporatePolicy returns corporate and school compliance details', () => {
  const corp = getCorporatePolicy('corporate', 'Apex Systems');
  assert.equal(corp.allowsSelfServiceDeactivation, false);
  assert.equal(corp.allowsHistoryClearing, false);
  assert.equal(corp.retentionPeriodDays, 365);
  assert.match(corp.enforcingAuthority, /Apex Systems security policy/);

  const school = getCorporatePolicy('school', 'Lincoln High');
  assert.equal(school.allowsSelfServiceDeactivation, false);
  assert.match(school.enforcingAuthority, /academic records policy/);
});
