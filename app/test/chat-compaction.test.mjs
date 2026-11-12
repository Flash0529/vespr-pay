// app/test/chat-compaction.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { ChatCompactionService } from '../chat-compaction.js';

test('ChatCompactionService seeds turns matching user screenshot', () => {
  const svc = new ChatCompactionService();
  const turns = svc.getTurns();
  assert.equal(turns.length, 3);

  // Turn 1 assertions
  assert.ok(turns[0].content.includes('Thanks for the photo'));
  assert.equal(turns[0].isCompacted, true);
  assert.equal(turns[0].pills[0].summaryText, 'Read 2 files, created 2 files, ran 4 commands');
  assert.equal(turns[0].pills[0].additions, 56);

  // Turn 2 assertions
  assert.ok(turns[1].content.includes('The lumps version'));
  assert.equal(turns[1].pills[0].additions, 27);
  assert.equal(turns[1].pills[0].deletions, 3);
  assert.equal(turns[1].pills[0].extraThumbnailCount, 1);

  // Turn 3 assertions
  assert.ok(turns[2].content.includes('Set v4 is on the Pi'));
  assert.equal(turns[2].pills.length, 2);
  assert.equal(turns[2].pills[1].summaryText, 'Created worklog_v4.py');
  assert.equal(turns[2].pills[1].additions, 13);
});

test('ChatCompactionService auto-compacts previous turns on new chat', () => {
  const svc = new ChatCompactionService();
  const newTurn = svc.addTurn('user', 'What are our next steps for enterprise sync?');

  const turns = svc.getTurns();
  assert.equal(turns.length, 4);
  assert.equal(turns[0].isCompacted, true);
  assert.equal(turns[1].isCompacted, true);
  assert.equal(turns[2].isCompacted, true);
  assert.equal(turns[3].isCompacted, false);
  assert.equal(turns[3].turnId, newTurn.turnId);
});

test('ChatCompactionService toggles pill expansion and star/fork metadata', () => {
  const svc = new ChatCompactionService();
  assert.equal(svc.getTurns()[0].pills[0].isExpanded, false);

  const expanded = svc.togglePill('turn-1', 0);
  assert.equal(expanded, true);
  assert.equal(svc.getTurns()[0].pills[0].isExpanded, true);

  const starred = svc.starTurn('turn-1');
  assert.equal(starred, true);

  const forked = svc.forkTurn('turn-1');
  assert.equal(forked, 1);

  const html = svc.renderTurnHtml(svc.getTurns()[0]);
  assert.ok(html.includes('pill-summary-text'));
  assert.ok(html.includes('+56'));
});