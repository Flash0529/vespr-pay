// app/test/enterprise-sync.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { SmartRoleService } from '../smart-role-maker.js';
import { EnterpriseDirectorySyncService } from '../enterprise-sync.js';

test('EnterpriseDirectorySyncService syncs GitHub teams and assigns roles', () => {
  const roleSvc = new SmartRoleService();
  const syncSvc = new EnterpriseDirectorySyncService(roleSvc);

  const status = syncSvc.getStatus();
  assert.equal(status.gitHubConnected, true);
  assert.equal(status.gitHubOrg, 'apex-systems-cloud');
  assert.equal(status.gitHubMembersCount, 5);

  const shamitRole = roleSvc.getUserRole('owner@example.com');
  assert.equal(shamitRole.roleId, 'it_admin');

  const alexRole = roleSvc.getUserRole('alex.m@apexsystems.com');
  assert.equal(alexRole.roleId, 'senior_dev');
});

test('EnterpriseDirectorySyncService updates team mappings and audits events', () => {
  const roleSvc = new SmartRoleService();
  const syncSvc = new EnterpriseDirectorySyncService(roleSvc);

  syncSvc.setTeamMapping('security-triage', 'corporate_legal');
  const mappings = syncSvc.getTeamMappings();
  assert.ok(mappings.some(([k, v]) => k === 'security-triage' && v === 'corporate_legal'));

  const audit = syncSvc.getAuditTrail();
  assert.ok(audit.length >= 3);
  assert.ok(audit.some(e => e.provider === 'GitHub' && e.action === 'SYNC_ROLE'));
});