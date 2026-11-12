// app/test/smart-role-maker.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { SmartRoleService } from '../smart-role-maker.js';

test('SmartRoleService seeds built-in system roles', () => {
  const svc = new SmartRoleService();
  const roles = svc.getRoles();
  assert.ok(roles.length >= 8);

  const student = svc.getRole('student');
  assert.equal(student.shell, 'None');
  assert.equal(student.fileSystem, 'ReadOnlyProject');
  assert.equal(student.allowChatSharing, false);

  const senior = svc.getRole('senior_dev');
  assert.equal(senior.shell, 'FullHost');
  assert.equal(senior.autonomy, 'MultiAgentAutonomous');
});

test('SmartRoleService synthesizes role from prompt for designer and devops', () => {
  const svc = new SmartRoleService();

  const designer = svc.synthesizeRoleFromPrompt('Contract UI designer working on Figma and Canva assets, 75k tokens');
  assert.equal(designer.displayName, 'Creative & UI Designer');
  assert.equal(designer.shell, 'None');
  assert.equal(designer.maxDailyComputeTokens, 75000);

  const devops = svc.synthesizeRoleFromPrompt('Senior Cloud DevOps engineer managing Kubernetes, 600k tokens');
  assert.equal(devops.displayName, 'Lead Cloud & DevOps Engineer');
  assert.equal(devops.shell, 'FullHost');
  assert.equal(devops.maxDailyComputeTokens, 600000);
});

test('SmartRoleService assigns role to user and protects built-in deletion', () => {
  const svc = new SmartRoleService();
  assert.equal(svc.deleteRole('senior_dev'), false); // Immutable

  svc.assignRole('user1@example.com', 'intern');
  const userRole = svc.getUserRole('user1@example.com');
  assert.equal(userRole.roleId, 'intern');
});

test('SmartRoleService maps role presets to server access rights and policy', () => {
  const svc = new SmartRoleService();

  // Access rights mapping (server/access.js RIGHTS: make, view, edit, delete, manage)
  assert.deepEqual(svc.roleToAccessRights('student'), ['view']);
  assert.deepEqual(svc.roleToAccessRights('intern'), ['view', 'edit', 'make']);
  assert.deepEqual(svc.roleToAccessRights('junior_dev'), ['view', 'edit', 'make', 'delete']);
  assert.deepEqual(svc.roleToAccessRights('senior_dev'), ['view', 'edit', 'make', 'delete', 'manage']);
  assert.deepEqual(svc.roleToAccessRights('teacher'), ['view', 'edit', 'make', 'delete', 'manage']);
  assert.deepEqual(svc.roleToAccessRights('corporate_legal'), ['view']);

  // Policy mapping (server/policy.js)
  const studentPol = svc.roleToPolicy('student');
  assert.equal(studentPol.role, 'student');
  assert.equal(studentPol.ageBand, 'under13');
  assert.equal(studentPol.canRun, false);

  const seniorPol = svc.roleToPolicy('senior_dev');
  assert.equal(seniorPol.role, 'admin');
  assert.equal(seniorPol.netLevel, 'full');
  assert.equal(seniorPol.canRun, true);
});

test('SmartRoleService syncRoleToWorkspace grants rights to workspace', async () => {
  const svc = new SmartRoleService();
  let calledUrl = '';
  let calledBody = null;
  let calledHeaders = {};

  const mockFetch = async (url, opts) => {
    calledUrl = url;
    calledHeaders = opts.headers;
    calledBody = JSON.parse(opts.body);
    return {
      ok: true,
      status: 200,
      json: async () => ({ ok: true, room: 'team-room', granted: calledBody.rights })
    };
  };

  const res = await svc.syncRoleToWorkspace('team-room', 'intern.sam@example.com', 'intern', {
    token: 'test_token_abc',
    baseUrl: 'https://test.vespr.online',
    fetchImpl: mockFetch
  });

  assert.equal(res.ok, true);
  assert.equal(res.status, 200);
  assert.deepEqual(res.rights, ['view', 'edit', 'make']);
  assert.equal(calledUrl, 'https://test.vespr.online/api/access/team-room/grant');
  assert.equal(calledHeaders.Authorization, 'Bearer test_token_abc');
  assert.equal(calledBody.who, 'intern.sam@example.com');
  assert.deepEqual(calledBody.rights, ['view', 'edit', 'make']);
});
