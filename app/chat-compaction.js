// app/chat-compaction.js - Chat Turn Compaction, Action Summary Pills & Visual History

export class ChatCompactionService {
  constructor() {
    this.turns = [];
    this.seedScreenshotHistory();
  }

  seedScreenshotHistory() {
    this.turns = [
      {
        turnId: 'turn-1',
        role: 'assistant',
        content: "Thanks for the photo, it's a helpful reference for the soft rounded dome. I'm now checking how the curly-hair lumps are built so I can match that fluffy shape.",
        timestamp: new Date(Date.now() - 2 * 86400000),
        timeAgo: '2 days ago',
        isCompacted: true,
        isStarred: false,
        forkCount: 0,
        pills: [
          {
            summaryText: 'Read 2 files, created 2 files, ran 4 commands',
            additions: 56,
            deletions: 0,
            thumbnails: ['brand/avatar_sprite_preview.png'],
            extraThumbnailCount: 0,
            isExpanded: false,
            logs: ['read native/Vespr.Core/TermOutput.cs', 'created worklog_v3.py', 'ran git status']
          }
        ]
      },
      {
        turnId: 'turn-2',
        role: 'assistant',
        content: "The lumps version gives a soft, rounded dome like your photo, with the fringe in front. I'm bumping the volume slightly and starting the final render pass, with F1 now at your good angle.",
        timestamp: new Date(Date.now() - 2 * 86400000),
        timeAgo: '2 days ago',
        isCompacted: true,
        isStarred: false,
        forkCount: 0,
        pills: [
          {
            summaryText: 'Saved 2 memories, ran 8 and 6 more actions',
            additions: 27,
            deletions: 3,
            thumbnails: ['brand/render_pass_f1.png', 'brand/angle_inspect.png', 'brand/dome_profile.png'],
            extraThumbnailCount: 1,
            isExpanded: false,
            logs: ['Saved memory: fringe volume preference', 'Saved memory: F1 good angle bias']
          }
        ]
      },
      {
        turnId: 'turn-3',
        role: 'assistant',
        content: "Final render pass is done. I'm checking your reframed good-angle close-up, then I'll finish and upload the set.\n\nSet v4 is on the Pi with 62 of 62 hashes matching. Now the worklog entry, then the commit.",
        timestamp: new Date(Date.now() - 2 * 86400000),
        timeAgo: '2 days ago',
        isCompacted: true,
        isStarred: false,
        forkCount: 0,
        pills: [
          {
            summaryText: 'Read 2 files, ran 4 commands, created 3 files',
            additions: 55,
            deletions: 0,
            thumbnails: ['brand/closeup_good_angle.png', 'brand/render_final_grid.png'],
            extraThumbnailCount: 0,
            isExpanded: false,
            logs: ['read render_output.json', 'verified 62/62 hashes']
          },
          {
            summaryText: 'Created worklog_v4.py',
            additions: 13,
            deletions: 0,
            thumbnails: [],
            extraThumbnailCount: 0,
            isExpanded: false,
            logs: ['created app/worklog_v4.py']
          }
        ]
      }
    ];
  }

  getTurns() {
    return this.turns;
  }

  addTurn(role, content, pills = [], autoCompactPrevious = true) {
    if (autoCompactPrevious) {
      for (const t of this.turns) {
        t.isCompacted = true;
      }
    }

    const newTurn = {
      turnId: `turn-${this.turns.length + 1}`,
      role,
      content,
      timestamp: new Date(),
      timeAgo: 'Just now',
      isCompacted: false,
      isStarred: false,
      forkCount: 0,
      pills: pills.map(p => ({
        summaryText: p.summaryText || 'Executed agent actions',
        additions: p.additions || 0,
        deletions: p.deletions || 0,
        thumbnails: p.thumbnails || [],
        extraThumbnailCount: p.extraThumbnailCount || 0,
        isExpanded: false,
        logs: p.logs || []
      }))
    };

    this.turns.push(newTurn);
    return newTurn;
  }

  togglePill(turnId, pillIndex) {
    const turn = this.turns.find(t => t.turnId === turnId);
    if (!turn || !turn.pills[pillIndex]) return false;
    turn.pills[pillIndex].isExpanded = !turn.pills[pillIndex].isExpanded;
    return turn.pills[pillIndex].isExpanded;
  }

  toggleCompaction(turnId) {
    const turn = this.turns.find(t => t.turnId === turnId);
    if (!turn) return false;
    turn.isCompacted = !turn.isCompacted;
    return turn.isCompacted;
  }

  starTurn(turnId) {
    const turn = this.turns.find(t => t.turnId === turnId);
    if (!turn) return false;
    turn.isStarred = !turn.isStarred;
    return turn.isStarred;
  }

  forkTurn(turnId) {
    const turn = this.turns.find(t => t.turnId === turnId);
    if (!turn) return 0;
    turn.forkCount = (turn.forkCount || 0) + 1;
    return turn.forkCount;
  }

  getEstimatedSpaceSavingsPercent() {
    if (this.turns.length === 0) return 0;
    const compacted = this.turns.filter(t => t.isCompacted).length;
    return Math.round((compacted / this.turns.length) * 74);
  }

  renderTurnHtml(turn) {
    const escapeHtml = (s) => (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const isUser = turn.role === 'user';
    const alignClass = isUser ? 'chat-turn-user' : 'chat-turn-assistant';

    let pillsHtml = '';
    if (turn.pills && turn.pills.length > 0) {
      pillsHtml = turn.pills.map((pill, idx) => {
        const addsHtml = pill.additions > 0 ? `<span class="pill-diff-add">+${pill.additions}</span>` : '';
        const delsHtml = pill.deletions > 0 ? `<span class="pill-diff-del">-${pill.deletions}</span>` : '';
        const thumbsHtml = (pill.thumbnails || []).map(th => `<span class="pill-thumb" style="background:#2a2b2e; border:1px solid #444; border-radius:3px; display:inline-block; width:22px; height:20px; vertical-align:middle; margin-left:3px;"></span>`).join('');
        const extraHtml = pill.extraThumbnailCount > 0 ? `<span class="pill-extra-count">+${pill.extraThumbnailCount}</span>` : '';
        const chevron = pill.isExpanded ? '▾' : '▸';

        const logsHtml = pill.isExpanded
          ? `<div class="pill-expanded-logs" style="margin-top:6px; padding:6px 8px; background:#121316; border-radius:4px; font-family:monospace; font-size:11px; color:#888;">
              ${(pill.logs || []).map(l => `<div>• ${escapeHtml(l)}</div>`).join('')}
            </div>`
          : '';

        return `
          <div class="chat-action-pill-wrapper" style="margin: 8px 0;">
            <div class="chat-action-pill" onclick="window.chatCompactionService?.togglePill('${turn.turnId}', ${idx}); window.renderChatCompaction?.();" style="display:inline-flex; align-items:center; gap:6px; background:#1e1f23; border:1px solid #2d2e33; border-radius:6px; padding:3px 8px; cursor:pointer; font-size:12px; color:#c0c0c0; user-select:none;">
              <span class="pill-summary-text">${escapeHtml(pill.summaryText)}</span>
              ${addsHtml}
              ${delsHtml}
              <span class="pill-chevron" style="color:#777; font-size:11px;">${chevron}</span>
              <div class="pill-thumbnails" style="display:inline-flex; align-items:center; margin-left:auto;">
                ${thumbsHtml}
                ${extraHtml}
              </div>
            </div>
            ${logsHtml}
          </div>
        `;
      }).join('');
    }

    const paragraphs = (turn.content || '').split('\n\n').map(p => `<p style="margin:0 0 6px 0; line-height:1.45; font-size:13.5px; color:#e0e0e0;">${escapeHtml(p)}</p>`).join('');

    const footerHtml = isUser ? '' : `
      <div class="chat-turn-footer" style="display:flex; align-items:center; gap:12px; margin-top:8px; font-size:12px; color:#6e7078;">
        <span class="footer-icon-btn" onclick="navigator.clipboard.writeText('${escapeHtml(turn.content)}')" title="Copy message" style="cursor:pointer;">📋</span>
        <span class="footer-icon-btn" onclick="window.chatCompactionService?.forkTurn('${turn.turnId}'); window.renderChatCompaction?.();" title="Fork turn" style="cursor:pointer;">⑂ ${turn.forkCount > 0 ? turn.forkCount : ''}</span>
        <span class="footer-icon-btn" onclick="window.chatCompactionService?.starTurn('${turn.turnId}'); window.renderChatCompaction?.();" title="Bookmark" style="cursor:pointer; color:${turn.isStarred ? '#ffd700' : 'inherit'};">★</span>
        <span class="footer-icon-btn" title="Text to speech" style="cursor:pointer;">🔊</span>
        <span class="footer-timestamp" style="margin-left:4px; font-size:11px; color:#5c5f66;">${turn.timeAgo || 'Just now'}</span>
      </div>
    `;

    return `
      <div class="chat-turn-item ${alignClass} ${turn.isCompacted ? 'is-compacted' : 'is-active'}" id="turn-${turn.turnId}" style="margin-bottom:14px; padding:8px 12px; border-radius:8px; background:${isUser ? 'rgba(59,130,246,0.1)' : 'transparent'}; border:1px solid ${isUser ? 'rgba(59,130,246,0.2)' : 'transparent'};">
        <div class="turn-content-body">
          ${paragraphs}
        </div>
        ${pillsHtml}
        ${footerHtml}
      </div>
    `;
  }
}