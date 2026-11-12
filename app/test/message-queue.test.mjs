// app/test/message-queue.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { MessageQueueService } from '../message-queue.js';

test('MessageQueueService seeds default queued message matching screenshot', () => {
  const svc = new MessageQueueService();
  const q = svc.getQueue();
  assert.equal(q.length, 1);
  assert.ok(q[0].text.includes('kind of like this but less lines'));
});

test('MessageQueueService supports enqueue, edit, delete, and instant send', () => {
  const svc = new MessageQueueService();
  const m2 = svc.enqueue('New follow-up prompt');
  assert.equal(svc.getQueue().length, 2);

  // Edit
  svc.edit('qmsg-01', 'Edited prompt text');
  assert.equal(svc.getQueue()[0].text, 'Edited prompt text');

  // Instant send
  const instant = svc.instantSend('qmsg-01');
  assert.equal(instant.text, 'Edited prompt text');
  assert.equal(svc.getQueue().length, 1);
  assert.equal(svc.getQueue()[0].queuePosition, 1);

  // Delete
  svc.delete(m2.queueId);
  assert.equal(svc.getQueue().length, 0);
});