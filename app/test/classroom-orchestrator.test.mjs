// app/test/classroom-orchestrator.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { ClassroomOrchestratorService } from '../classroom-orchestrator.js';

test('ClassroomOrchestratorService toggles age layout configs', () => {
  const svc = new ClassroomOrchestratorService();
  const ms = svc.getLayoutConfig('MiddleSchoolUnder');
  assert.equal(ms.isSimplifiedLayout, true);
  assert.equal(ms.allowShellTerminal, false);
  assert.equal(ms.uiMode, 'friendly_blocks');

  const hs = svc.getLayoutConfig('HighSchoolPlus');
  assert.equal(hs.isSimplifiedLayout, false);
  assert.equal(hs.allowShellTerminal, true);
  assert.equal(hs.uiMode, 'pro_sde');
});

test('ClassroomOrchestratorService supports beginner pods and advanced individual projects', () => {
  const svc = new ClassroomOrchestratorService();
  const podProject = svc.createOrchestratedProject('Distributed Shop', 'Create microservices', true);
  assert.equal(podProject.difficultyMode, 'Beginner_Pods');
  assert.equal(podProject.parts[0].isPod, true);
  assert.ok(podProject.scopeSlides.length >= 2);

  const indProject = svc.createOrchestratedProject('Kernel Scheduler', 'Build preemptive scheduler', false);
  assert.equal(indProject.difficultyMode, 'Advanced_Individual');
  assert.equal(indProject.parts[0].isPod, false);
});

test('ClassroomOrchestratorService schedules repeat chats and provides searchable chat history', () => {
  const svc = new ClassroomOrchestratorService();
  const sched = svc.scheduleRepeatChat('Weekly Code Health', '@coder review git diff', 'Weekly', 1, ['cart.py']);
  assert.equal(sched.intervalType, 'Weekly');
  assert.equal(sched.isActive, true);

  const results = svc.searchChats('discount bug');
  assert.ok(results.length > 0);
  assert.match(results[0].title, /discount/i);

  const readOnlyChat = svc.searchChats('partner');
  assert.ok(readOnlyChat.length > 0);
  assert.equal(readOnlyChat[0].isReadOnly, true);
});


test('ClassroomOrchestratorService aligns with server/orgs age bands and applies restrictions', () => {
  const svc = new ClassroomOrchestratorService();
  
  // High school default
  assert.equal(svc.getAgeBand(), '13-17');
  
  // Set to under13 (Middle School)
  svc.setAgeBand('under13');
  assert.equal(svc.getAgeTier(), 'MiddleSchoolUnder');
  assert.equal(svc.getAgeBand(), 'under13');

  // Set back to 13-17 or adult
  svc.setAgeBand('adult');
  assert.equal(svc.getAgeTier(), 'HighSchoolPlus');

  // Test applyRestrictions to DOM
  const mockElements = {
    terminalPane: { hidden: false },
    networkStatusBadge: { textContent: '' }
  };
  const mockDoc = {
    body: { dataset: {} },
    getElementById: (id) => mockElements[id] || null
  };

  svc.setAgeBand('under13');
  svc.applyRestrictions(mockDoc);
  assert.equal(mockDoc.body.dataset.ageTier, 'under13');
  assert.equal(mockDoc.body.dataset.uiMode, 'friendly_blocks');
  assert.equal(mockElements.terminalPane.hidden, true);
  assert.equal(mockElements.networkStatusBadge.textContent, 'Allowlist Only');

  svc.setAgeBand('13-17');
  svc.applyRestrictions(mockDoc);
  assert.equal(mockDoc.body.dataset.ageTier, '13-17');
  assert.equal(mockDoc.body.dataset.uiMode, 'pro_sde');
  assert.equal(mockElements.terminalPane.hidden, false);
  assert.equal(mockElements.networkStatusBadge.textContent, 'Full Internet');
});
