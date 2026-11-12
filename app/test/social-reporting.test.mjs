// app/test/social-reporting.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { SocialAndReportingService } from '../social-reporting.js';

test('SocialAndReportingService manages friends, unfriend, and block', () => {
  const svc = new SocialAndReportingService();
  const friends = svc.getFriends();
  assert.ok(friends.length >= 3);

  const newContact = svc.addFriend('lucas@example.org', 'Lucas Vance');
  assert.equal(newContact.name, 'Lucas Vance');
  assert.equal(newContact.status, 'Friend');

  svc.blockUser(newContact.userId);
  assert.equal(svc.getBlockedUsers().some(u => u.userId === newContact.userId), true);

  svc.unfriend(newContact.userId);
  assert.equal(svc.getBlockedUsers().some(u => u.userId === newContact.userId), false);
});

test('SocialAndReportingService shares agentic chats with external off-company accounts', () => {
  const svc = new SocialAndReportingService();
  const grant = svc.shareAgenticChat('chat_777', 'external_partner@acme.com', true, true);
  assert.ok(grant.grantId);
  assert.equal(grant.isOffCompanyAccount, true);
  assert.equal(grant.isReadOnly, true);

  const found = svc.getChatGrantByToken(grant.accessToken);
  assert.equal(found.chatId, 'chat_777');
});

test('SocialAndReportingService AI triage sorts spam and tiers bugs', () => {
  const svc = new SocialAndReportingService();
  const spam = svc.ingestAndTriageReport('Free Crypto Casino Giveaway', 'Visit asdfghjk.ru for coins', 'bot@casino.ru.spam', 'email_intake');
  assert.equal(spam.isFakeOrSpam, true);
  assert.equal(spam.emergencyTier, 1);

  const bug = svc.ingestAndTriageReport('Rounding error in cart.py', 'Float precision causes tests to fail in cart calculation', 'qa@corp.com', 'context_menu_rclick');
  assert.equal(bug.isFakeOrSpam, false);
  assert.equal(bug.category, 'Bug');
  assert.equal(bug.emergencyTier, 7);
  assert.match(bug.automatedFixSuggestion, /cart\.py/);

  const ok = svc.approveAndCommitFix(bug.id, 'the VESPR team');
  assert.equal(ok, true);
  assert.equal(svc.listReports().find(r => r.id === bug.id).fixStatus, 'Committed');
});


test('SocialAndReportingService syncs with server/friends.js and dispatches requests', async () => {
  const svc = new SocialAndReportingService();

  const mockFetch = async (url, opts) => {
    if (url.endsWith('/api/friends') && opts.method === 'GET') {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          me: 'shamit',
          friends: [{ handle: 'jordan', since: 1700000000000 }],
          incoming: [{ handle: 'taylor', ts: 1700000100000 }],
          outgoing: []
        })
      };
    }
    if (url.endsWith('/api/friends/request') && opts.method === 'POST') {
      const b = JSON.parse(opts.body);
      return {
        ok: true,
        status: 200,
        json: async () => ({ status: 'pending', to: b.to })
      };
    }
    if (url.endsWith('/api/friends/accept') && opts.method === 'POST') {
      return {
        ok: true,
        status: 200,
        json: async () => ({ status: 'friends' })
      };
    }
    if (url.endsWith('/api/friends/remove') && opts.method === 'POST') {
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true })
      };
    }
    return { ok: false, status: 404 };
  };

  // Test sync
  const synced = await svc.syncWithServer({ token: 'tok_abc', fetchImpl: mockFetch });
  assert.equal(synced.ok, true);
  assert.equal(svc.getFriends().some(f => f.name === 'jordan'), true);

  // Test request
  const requested = await svc.requestFriend('casey', { token: 'tok_abc', fetchImpl: mockFetch });
  assert.equal(requested.ok, true);
  assert.equal(requested.status, 'pending');

  // Test accept
  const accepted = await svc.acceptFriend('taylor', { token: 'tok_abc', fetchImpl: mockFetch });
  assert.equal(accepted.ok, true);
  assert.equal(accepted.status, 'friends');

  // Test remove
  const removed = await svc.removeFriendServer('casey', { token: 'tok_abc', fetchImpl: mockFetch });
  assert.equal(removed.ok, true);
});
