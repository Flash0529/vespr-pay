// app/test/autonomous-workers.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { AutonomousWorkerService } from '../autonomous-workers.js';

test('AutonomousWorkerService seeds default background workers', () => {
  const svc = new AutonomousWorkerService();
  const list = svc.getActiveWorkers();
  assert.equal(list.length, 3);
  assert.ok(list.some(w => w.workerType === 'indexer' && w.status === 'Completed'));
  assert.ok(list.some(w => w.workerType === 'auditor' && w.status === 'Running'));
});

test('AutonomousWorkerService spawns and updates autonomous workers', () => {
  const svc = new AutonomousWorkerService();
  const worker = svc.spawnWorker('Live Vulnerability Scanner', 'auditor');
  assert.equal(worker.status, 'Running');

  svc.progressWorker(worker.workerId, 50, 'Halfway done scanning');
  assert.equal(svc.workers.get(worker.workerId).progressPercent, 50);

  svc.completeWorker(worker.workerId, 'audit_report.json');
  assert.equal(svc.workers.get(worker.workerId).status, 'Completed');
  assert.equal(svc.workers.get(worker.workerId).artifactProduced, 'audit_report.json');

  const html = svc.renderPlannerCardsHtml();
  assert.ok(html.includes('Live Vulnerability Scanner'));
  assert.ok(html.includes('audit_report.json'));
});

test('AutonomousWorkerService syncFromLiveSnap reflects real agent tasks', () => {
  const svc = new AutonomousWorkerService();
  const mockSnap = {
    claims: {
      coder: { ai: true, task: '#T-12: cart.py discount bug', who: 'coder' }
    },
    plans: {
      coder: {
        items: [
          { text: 'Analyze discount bug in cart.py', status: 'done' },
          { text: 'Apply fix and execute pytest', status: 'running' }
        ]
      }
    }
  };
  svc.syncFromLiveSnap(mockSnap);
  const worker = svc.workers.get('wrk-agent-coder');
  assert.ok(worker);
  assert.equal(worker.status, 'Running');
  assert.equal(worker.currentStepDescription, 'Apply fix and execute pytest');
  assert.equal(worker.progressPercent, 50);
});
