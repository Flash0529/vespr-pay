// app/social-reporting.js
// Social friends, external off-company chat sharing with read-only grants, and AI emergency triage for issue intake.
// Parity port with native/Vespr.Core/SocialAndReportingManager.cs.

export class SocialAndReportingService {
  constructor() {
    this._contacts = new Map();
    this._chatGrants = new Map();
    this._reports = new Map();
    this._seedDefaultContacts();
    this._seedDefaultReports();
  }

  _seedDefaultContacts() {
    const now = new Date();
    this._contacts.set('usr_maya', {
      userId: 'usr_maya',
      name: 'Maya Lin',
      email: 'maya.lin@stanford.edu',
      avatarLetter: 'M',
      avatarBg: '#ec4899',
      status: 'Friend',
      canShareAgenticChats: true,
      sharedChatCount: 4,
      addedAt: new Date(now.getTime() - 20 * 24 * 3600 * 1000).toISOString()
    });
    this._contacts.set('usr_devon', {
      userId: 'usr_devon',
      name: 'Devon Vance',
      email: 'devon.v@apexsystems.com',
      avatarLetter: 'D',
      avatarBg: '#3b82f6',
      status: 'Friend',
      canShareAgenticChats: true,
      sharedChatCount: 7,
      addedAt: new Date(now.getTime() - 14 * 24 * 3600 * 1000).toISOString()
    });
    this._contacts.set('usr_elena', {
      userId: 'usr_elena',
      name: 'Elena Rostova',
      email: 'elena.r@corporate-legal.org',
      avatarLetter: 'E',
      avatarBg: '#8b5cf6',
      status: 'Friend',
      canShareAgenticChats: false,
      sharedChatCount: 1,
      addedAt: new Date(now.getTime() - 5 * 24 * 3600 * 1000).toISOString()
    });
    this._contacts.set('usr_spammer', {
      userId: 'usr_spammer',
      name: 'Crypto Bot 9000',
      email: 'airdrop@unknown-spammer.io',
      avatarLetter: 'C',
      avatarBg: '#ef4444',
      status: 'Blocked',
      canShareAgenticChats: false,
      sharedChatCount: 0,
      addedAt: new Date(now.getTime() - 2 * 24 * 3600 * 1000).toISOString()
    });
  }

  getFriends() {
    return Array.from(this._contacts.values())
      .filter(c => c.status === 'Friend')
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  getBlockedUsers() {
    return Array.from(this._contacts.values())
      .filter(c => c.status === 'Blocked')
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  addFriend(email, name = '') {
    for (const c of this._contacts.values()) {
      if (c.email.toLowerCase() === email.toLowerCase()) {
        if (c.status === 'Blocked') {
          c.status = 'Friend';
        }
        return c;
      }
    }
    const id = 'usr_' + Math.random().toString(36).slice(2, 10);
    const displayName = name || email.split('@')[0];
    const letter = displayName[0].toUpperCase();
    const contact = {
      userId: id,
      name: displayName,
      email,
      avatarLetter: letter,
      avatarBg: '#10b981',
      status: 'Friend',
      canShareAgenticChats: true,
      sharedChatCount: 0,
      addedAt: new Date().toISOString()
    };
    this._contacts.set(id, contact);
    return contact;
  }

  unfriend(userId) {
    return this._contacts.delete(userId);
  }

  blockUser(userId) {
    const c = this._contacts.get(userId);
    if (!c) return false;
    c.status = 'Blocked';
    c.canShareAgenticChats = false;
    return true;
  }

  shareAgenticChat(chatId, targetEmailOrId, isOffCompany = true, isReadOnly = true) {
    const grantId = 'grant_' + Math.random().toString(36).slice(2, 10);
    const token = 'tok_ext_' + Math.random().toString(36).slice(2, 12);
    const grant = {
      grantId,
      chatId,
      targetEmailOrId,
      isOffCompanyAccount: isOffCompany,
      isReadOnly,
      accessToken: token,
      grantedAt: new Date().toISOString()
    };
    this._chatGrants.set(grantId, grant);
    return grant;
  }

  getChatGrantByToken(token) {
    for (const g of this._chatGrants.values()) {
      if (g.accessToken === token) return g;
    }
    return null;
  }

  ingestAndTriageReport(title, description, reporterEmail, source = 'feedback_form') {
    const id = 'rep_' + Math.random().toString(36).slice(2, 10);
    const { isFake, category, tier, fix } = this._runAiTriage(title, description, reporterEmail);

    const report = {
      id,
      source,
      reporterEmail,
      title,
      description,
      isFakeOrSpam: isFake,
      category,
      emergencyTier: tier,
      automatedFixSuggestion: fix,
      fixStatus: 'PendingApproval',
      createdAt: new Date().toISOString(),
      committedAt: null,
      committedBy: null
    };

    this._reports.set(id, report);
    return report;
  }

  _runAiTriage(title, desc, email) {
    const text = `${title} ${desc}`.toLowerCase();

    if (text.includes('casino') || text.includes('viagra') || text.includes('crypto free') ||
        text.includes('asdfghjk') || text.includes('click here to win') || email.endsWith('.ru.spam')) {
      return { isFake: true, category: 'Spam', tier: 1, fix: 'Automated filter rule: Discard spam submission.' };
    }

    if (text.includes('vulnerability') || text.includes('cve') || text.includes('sql injection') ||
        text.includes('secret leak') || text.includes('auth bypass') || text.includes('crash loop')) {
      return { isFake: false, category: 'Security', tier: 10, fix: 'Patch: Enforce strict bearer token validation in server/access.js.' };
    }

    if (text.includes('billing') || text.includes('double charge') || text.includes('stripe payment failed')) {
      return { isFake: false, category: 'Billing', tier: 8, fix: 'Patch: Implement idempotent webhook handlers for Stripe customer invoices.' };
    }

    if (text.includes('discount') || text.includes('syntaxerror') || text.includes('test fail') || text.includes('cart.py')) {
      return { isFake: false, category: 'Bug', tier: 7, fix: 'Patch: In cart.py, update return statement to round(amount * (1 - percent / 100), 2).' };
    }

    if (text.includes('compliance') || text.includes('ferpa') || text.includes('gdpr') || text.includes('soc2')) {
      return { isFake: false, category: 'Compliance', tier: 6, fix: 'Patch: Lock session audit trail purge and enforce corporate retention policy.' };
    }

    return { isFake: false, category: 'Feature', tier: 4, fix: 'Config: Enable requested toggle in app/user-settings.js.' };
  }

  _seedDefaultReports() {
    const now = new Date();
    this.ingestAndTriageReport('Rounding precision in cart calculation', 'When applying a 20% discount on float values, rounding exceeds 2 decimal points.', 'alex.m@apexsystems.com', 'context_menu_rclick');
    this.ingestAndTriageReport('Token expiry audit log validation', 'Verify off-company external viewer links expire within 48 hours.', 'security-lead@apexsystems.com', 'email_intake');
    this.ingestAndTriageReport('Claim your free $5000 grant', 'Congratulations you won free credits click link.', 'spam-bot@fakedomain.biz', 'email_intake');
  }

  listReports({ filterFake = null, category = null, minTier = null, sortBy = 'date' } = {}) {
    let list = Array.from(this._reports.values());

    if (filterFake !== null) {
      list = list.filter(r => r.isFakeOrSpam === filterFake);
    }
    if (category) {
      list = list.filter(r => r.category.toLowerCase() === category.toLowerCase());
    }
    if (minTier !== null) {
      list = list.filter(r => r.emergencyTier >= minTier);
    }

    if (sortBy === 'tier') {
      return list.sort((a, b) => b.emergencyTier - a.emergencyTier);
    }
    if (sortBy === 'category') {
      return list.sort((a, b) => a.category.localeCompare(b.category));
    }
    return list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  approveAndCommitFix(reportId, committer) {
    const r = this._reports.get(reportId);
    if (!r) return false;
    r.fixStatus = 'Committed';
    r.committedAt = new Date().toISOString();
    r.committedBy = committer;
    return true;
  }

  cleanHandle(input) {
    if (!input) return '';
    const s = String(input).trim().toLowerCase();
    const handlePart = s.includes('@') ? s.split('@')[0] : s;
    return handlePart.replace(/[^a-z0-9._-]/g, '').slice(0, 32);
  }

  async syncWithServer({ token, baseUrl = '', fetchImpl = globalThis.fetch } = {}) {
    if (!token) return { ok: false, error: 'token required' };
    try {
      const res = await fetchImpl(`${baseUrl}/api/friends`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) return { ok: false, status: res.status };
      const data = await res.json().catch(() => ({}));
      
      if (Array.isArray(data.friends)) {
        for (const f of data.friends) {
          const id = 'usr_' + f.handle;
          if (!this._contacts.has(id)) {
            const letter = (f.handle[0] || 'F').toUpperCase();
            this._contacts.set(id, {
              userId: id,
              name: f.handle,
              email: `${f.handle}@example.com`,
              avatarLetter: letter,
              avatarBg: '#3b82f6',
              status: 'Friend',
              canShareAgenticChats: true,
              sharedChatCount: 0,
              addedAt: new Date(f.since || Date.now()).toISOString()
            });
          }
        }
      }
      return { ok: true, data };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  async requestFriend(toHandle, { token, baseUrl = '', fetchImpl = globalThis.fetch } = {}) {
    const to = this.cleanHandle(toHandle);
    if (!to) return { ok: false, error: 'valid handle required' };
    if (!token) {
      this.addFriend(`${to}@example.com`, to);
      return { ok: true, status: 'friends' };
    }
    try {
      const res = await fetchImpl(`${baseUrl}/api/friends/request`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ to })
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        this.addFriend(`${to}@example.com`, to);
      }
      return { ok: res.ok, status: data.status || (res.ok ? 'pending' : 'failed'), data };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  async acceptFriend(fromHandle, { token, baseUrl = '', fetchImpl = globalThis.fetch } = {}) {
    const from = this.cleanHandle(fromHandle);
    if (!from || !token) return { ok: false, error: 'token and handle required' };
    try {
      const res = await fetchImpl(`${baseUrl}/api/friends/accept`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ from })
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        this.addFriend(`${from}@example.com`, from);
      }
      return { ok: res.ok, status: data.status || 'friends', data };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  async removeFriendServer(handle, { token, baseUrl = '', fetchImpl = globalThis.fetch } = {}) {
    const who = this.cleanHandle(handle);
    if (!who || !token) return { ok: false, error: 'token and handle required' };
    try {
      const res = await fetchImpl(`${baseUrl}/api/friends/remove`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ who })
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        this.unfriend('usr_' + who);
      }
      return { ok: res.ok, data };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }
}
