// app/message-queue.js - Message Queuing, Inline Editing, Deletion & Instant Send

export class MessageQueueService {
  constructor() {
    this.queue = [];
    this.seedDefaultQueuedMessage();
  }

  seedDefaultQueuedMessage() {
    this.queue = [
      {
        queueId: 'qmsg-01',
        text: 'kind of like this but less lines keep it more mysterious',
        attachments: ['[Image: media_1793892836648_9a3dc130.jpg]'],
        enqueuedAt: new Date(),
        queuePosition: 1,
        isEditing: false
      }
    ];
  }

  getQueue() {
    return this.queue;
  }

  enqueue(text, attachments = []) {
    const id = `qmsg-${Math.random().toString(36).substring(2, 8)}`;
    const msg = {
      queueId: id,
      text,
      attachments,
      enqueuedAt: new Date(),
      queuePosition: this.queue.length + 1,
      isEditing: false
    };
    this.queue.push(msg);
    return msg;
  }

  edit(queueId, newText) {
    const item = this.queue.find(m => m.queueId === queueId);
    if (!item) return false;
    item.text = newText;
    item.isEditing = false;
    return true;
  }

  setEditing(queueId, isEditing = true) {
    const item = this.queue.find(m => m.queueId === queueId);
    if (!item) return false;
    item.isEditing = isEditing;
    return true;
  }

  delete(queueId) {
    const idx = this.queue.findIndex(m => m.queueId === queueId);
    if (idx === -1) return false;
    this.queue.splice(idx, 1);
    this.queue.forEach((m, i) => m.queuePosition = i + 1);
    return true;
  }

  instantSend(queueId) {
    const idx = this.queue.findIndex(m => m.queueId === queueId);
    if (idx === -1) return null;
    const msg = this.queue.splice(idx, 1)[0];
    this.queue.forEach((m, i) => m.queuePosition = i + 1);
    return msg;
  }

  dequeueNext() {
    if (this.queue.length === 0) return null;
    const msg = this.queue.shift();
    this.queue.forEach((m, i) => m.queuePosition = i + 1);
    return msg;
  }

  renderQueueBarHtml() {
    const escapeHtml = s => (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    if (this.queue.length === 0) return '';

    return `
      <div class="message-queue-banner" style="background:#18181b;border:1px solid rgba(255,255,255,0.12);border-radius:8px;padding:6px 10px;margin-bottom:8px;display:flex;flex-direction:column;gap:6px;box-shadow:0 4px 12px rgba(0,0,0,0.35);">
        ${this.queue.map(m => {
          if (m.isEditing) {
            return `
              <div style="display:flex;align-items:center;gap:8px;">
                <input id="editQueueIn-${m.queueId}" class="cset-input" value="${escapeHtml(m.text)}" style="flex:1;padding:4px 8px;font-size:12px;">
                <button class="btn pri" onclick="window.messageQueueSvc?.edit('${m.queueId}', document.getElementById('editQueueIn-${m.queueId}').value); window.renderMessageQueueBar?.();" style="padding:4px 10px;font-size:11px;">Save</button>
                <button class="btn" onclick="window.messageQueueSvc?.setEditing('${m.queueId}', false); window.renderMessageQueueBar?.();" style="padding:4px 8px;font-size:11px;">Cancel</button>
              </div>
            `;
          }

          const attachBadges = m.attachments.map(att => `<span style="font-size:10.5px;padding:1px 5px;background:#27272a;border-radius:4px;color:#a1a1aa;margin-right:4px;">📎 ${escapeHtml(att)}</span>`).join('');

          return `
            <div style="display:flex;align-items:center;justify-content:space-between;font-size:12px;">
              <div style="display:flex;align-items:center;gap:8px;min-width:0;flex:1;">
                <span style="font-size:10.5px;padding:2px 6px;border-radius:4px;background:rgba(59,130,246,0.15);color:#60a5fa;font-weight:600;white-space:nowrap;">
                  ${this.queue.length} message queued
                </span>
                <span style="color:#e4e4e7;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
                  ${attachBadges} ${escapeHtml(m.text)}
                </span>
              </div>
              <div style="display:flex;align-items:center;gap:6px;margin-left:10px;">
                <button class="ib" onclick="window.messageQueueSvc?.setEditing('${m.queueId}', true); window.renderMessageQueueBar?.();" title="Edit queued message" style="padding:3px;color:#a1a1aa;">
                  ✏️
                </button>
                <button class="ib" onclick="const s = window.messageQueueSvc?.instantSend('${m.queueId}'); window.renderMessageQueueBar?.(); if (s && window.onInstantSend) window.onInstantSend(s);" title="Instant Send (Send now without waiting)" style="padding:3px;color:#facc15;">
                  ⚡
                </button>
                <button class="ib" onclick="window.messageQueueSvc?.delete('${m.queueId}'); window.renderMessageQueueBar?.();" title="Delete queued message" style="padding:3px;color:#ef4444;">
                  🗑️
                </button>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }
}