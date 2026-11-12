// app/autonomous-workers.js - Headless Background Autonomous Workers & Planner UI

export class AutonomousWorkerService {
  constructor() {
    this.workers = new Map();
    this.seedDefaultWorkers();
  }

  seedDefaultWorkers() {
    const defaultList = [
      {
        workerId: 'wrk-indexer',
        name: 'AST Codebase Indexer',
        workerType: 'indexer',
        status: 'Completed',
        currentStepDescription: 'Indexed 84 files across native C# and JS modules',
        progressPercent: 100,
        logs: ['Parsed symbol graph', 'Built syntax trees for 38 C# files', 'Cached 1,420 AST nodes'],
        tokensConsumed: 14200,
        durationSeconds: 3.4,
        artifactProduced: 'ast_symbols.cache.json'
      },
      {
        workerId: 'wrk-security',
        name: 'Static Vulnerability & Secret Auditor',
        workerType: 'auditor',
        status: 'Running',
        currentStepDescription: 'Analyzing dataflow for SQL injection and exposed tokens',
        progressPercent: 68,
        logs: ['Scanning .env boundaries', 'Checked 12 API controllers', 'Zero credential leaks found'],
        tokensConsumed: 8900,
        durationSeconds: 6.1,
        artifactProduced: null
      },
      {
        workerId: 'wrk-testrunner',
        name: 'Autonomous E2E Test Runner',
        workerType: 'test_runner',
        status: 'Queued',
        currentStepDescription: 'Awaiting security auditor completion',
        progressPercent: 0,
        logs: ['Queued behind wrk-security'],
        tokensConsumed: 0,
        durationSeconds: 0,
        artifactProduced: null
      }
    ];

    for (const w of defaultList) {
      this.workers.set(w.workerId, w);
    }
  }

  syncFromLiveSnap(snap) {
    if (!snap) return;
    const claims = snap.claims || {};
    const plans = snap.plans || {};
    for (const [who, claim] of Object.entries(claims)) {
      if (claim && claim.ai) {
        const id = `wrk-agent-${who}`;
        const plan = plans[who];
        const items = (plan && Array.isArray(plan.items)) ? plan.items : [];
        const runningItem = items.find(it => it.status === 'running') || items[0];
        const stepDesc = runningItem ? runningItem.text : (claim.task || `${who} autonomous task`);
        const doneCount = items.filter(it => it.status === 'done').length;
        const pct = items.length ? Math.round((doneCount / items.length) * 100) : 50;
        const existing = this.workers.get(id);
        if (existing) {
          existing.status = 'Running';
          existing.currentStepDescription = stepDesc;
          existing.progressPercent = pct;
        } else {
          this.workers.set(id, {
            workerId: id,
            name: `@${who} Autonomous Execution`,
            workerType: 'agent_runner',
            status: 'Running',
            currentStepDescription: stepDesc,
            progressPercent: pct,
            logs: [`Live agent @${who} active in workspace`],
            tokensConsumed: 1250,
            durationSeconds: 1.5,
            artifactProduced: null
          });
        }
      }
    }
  }

  getActiveWorkers() {
    return Array.from(this.workers.values());
  }

  spawnWorker(name, workerType, initialStep = 'Initializing autonomous worker') {
    const id = `wrk-${Math.random().toString(36).substring(2, 10)}`;
    const worker = {
      workerId: id,
      name,
      workerType,
      status: 'Running',
      currentStepDescription: initialStep,
      progressPercent: 0,
      logs: [`Worker ${name} started in autonomous headless mode`],
      tokensConsumed: 500,
      durationSeconds: 0,
      artifactProduced: null
    };
    this.workers.set(id, worker);
    return worker;
  }

  progressWorker(workerId, progress, stepDescription, logEntry = null) {
    const w = this.workers.get(workerId);
    if (!w) return false;
    w.progressPercent = Math.min(100, Math.max(0, progress));
    w.currentStepDescription = stepDescription;
    if (logEntry) w.logs.push(logEntry);
    return true;
  }

  completeWorker(workerId, artifactProduced) {
    const w = this.workers.get(workerId);
    if (!w) return false;
    w.status = 'Completed';
    w.progressPercent = 100;
    w.currentStepDescription = `Completed: ${artifactProduced}`;
    w.artifactProduced = artifactProduced;
    w.logs.push(`Worker finished successfully. Artifact: ${artifactProduced}`);
    return true;
  }

  failWorker(workerId, error) {
    const w = this.workers.get(workerId);
    if (!w) return false;
    w.status = 'Failed';
    w.currentStepDescription = `Failed: ${error}`;
    w.logs.push(`Worker error: ${error}`);
    return true;
  }

  renderPlannerCardsHtml() {
    const escapeHtml = s => (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const workers = this.getActiveWorkers();

    return `
      <div class="planner-workers-container" style="display:flex;flex-direction:column;gap:8px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">
          <b style="font-size:12px;color:#e4e4e7;">Autonomous Background Workers (${workers.length})</b>
          <span style="font-size:10.5px;color:#71717a;">Headless Execution · No Human Input Needed</span>
        </div>
        ${workers.map(w => {
          const isDone = w.status === 'Completed';
          const isRunning = w.status === 'Running';
          const badgeBg = isDone ? 'rgba(34,197,94,0.15)' : (isRunning ? 'rgba(59,130,246,0.15)' : 'rgba(255,255,255,0.08)');
          const badgeColor = isDone ? '#4ade80' : (isRunning ? '#60a5fa' : '#a1a1aa');

          return `
            <div class="planner-worker-card" style="background:#18181b;border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:10px 12px;">
              <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
                <div style="display:flex;align-items:center;gap:8px;">
                  <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${badgeColor};"></span>
                  <b style="font-size:12.5px;color:#fff;">${escapeHtml(w.name)}</b>
                </div>
                <span style="font-size:10.5px;padding:2px 7px;border-radius:4px;background:${badgeBg};color:${badgeColor};font-weight:600;">${w.status}</span>
              </div>
              <div style="font-size:11.5px;color:#a1a1aa;margin-bottom:6px;">${escapeHtml(w.currentStepDescription)}</div>
              
              <div style="width:100%;height:4px;background:#27272a;border-radius:2px;overflow:hidden;margin-bottom:6px;">
                <div style="width:${w.progressPercent}%;height:100%;background:${badgeColor};transition:width .2s;"></div>
              </div>

              <div style="display:flex;align-items:center;justify-content:space-between;font-size:10.5px;color:#71717a;">
                <span>Progress: ${w.progressPercent}%</span>
                <span>${(w.tokensConsumed || 0).toLocaleString()} tokens</span>
                ${w.artifactProduced ? `<span style="color:#60a5fa;">Artifact: ${escapeHtml(w.artifactProduced)}</span>` : ''}
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }
}