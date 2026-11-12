// app/account-devices.js
// Logged-on devices, session history & corporate lifecycle governance for VESPR SDE.
// Parity port with native/Vespr.Core/AccountDeviceManager.cs.

export const ClientDeviceType = {
  DesktopApp: 'desktop_app',
  SdeWeb: 'sde_web',
  MobileCompanion: 'mobile_companion',
  TerminalCli: 'terminal_cli'
};

export function getDeviceDisplayName(clientType) {
  switch (clientType) {
    case ClientDeviceType.DesktopApp: return 'Desktop App - Windows 11';
    case ClientDeviceType.SdeWeb: return 'SDE Web Browser';
    case ClientDeviceType.MobileCompanion: return 'Mobile Companion - iOS/Android';
    case ClientDeviceType.TerminalCli: return 'Pi 5 CLI Terminal';
    default: return 'Unknown Device';
  }
}

export function getDeviceIcon(clientType) {
  switch (clientType) {
    case ClientDeviceType.DesktopApp: return 'monitor';
    case ClientDeviceType.SdeWeb: return 'globe';
    case ClientDeviceType.MobileCompanion: return 'message';
    case ClientDeviceType.TerminalCli: return 'term';
    default: return 'monitor';
  }
}

export const AccountLifecycleStatus = {
  Active: 'Active',
  Suspended: 'Suspended',
  Deactivated: 'Deactivated',
  PendingProvisioning: 'PendingProvisioning'
};

export function isSelfServiceDeactivationAllowed(role, flavor) {
  const f = String(flavor || '').toLowerCase();
  const r = String(role || '').toLowerCase();
  if (f === 'school' || f === 'corporate') {
    return false;
  }
  return r === 'solo_dev';
}

export function isHistoryClearingAllowed(role, flavor) {
  const f = String(flavor || '').toLowerCase();
  const r = String(role || '').toLowerCase();
  if (f === 'school' || f === 'corporate') {
    return false;
  }
  return r === 'solo_dev';
}

export function getCorporatePolicy(flavor, orgName = '') {
  const f = String(flavor || '').toLowerCase();
  const org = orgName || 'Organization';

  if (f === 'corporate') {
    return {
      flavor: 'corporate',
      orgName: org,
      allowsSelfServiceDeactivation: false,
      allowsHistoryClearing: false,
      retentionPeriodDays: 365,
      enforcingAuthority: `${org} security policy`,
      deactivationProcedureNotice: 'Account provisioning, suspension, and deactivation are strictly managed by your Corporate IT Administrator and Legal Compliance Department. Individual accounts cannot be self-terminated.'
    };
  }

  if (f === 'school') {
    return {
      flavor: 'school',
      orgName: org,
      allowsSelfServiceDeactivation: false,
      allowsHistoryClearing: false,
      retentionPeriodDays: 180,
      enforcingAuthority: `${org} academic records policy`,
      deactivationProcedureNotice: 'Student and faculty accounts are provisioned and decommissioned via School IT Administration. Classroom rosters and audit records are preserved for academic continuity.'
    };
  }

  return {
    flavor: 'dev_team',
    orgName: org,
    allowsSelfServiceDeactivation: false,
    allowsHistoryClearing: true,
    retentionPeriodDays: 90,
    enforcingAuthority: `${org} Developer Team Policy`,
    deactivationProcedureNotice: 'Team membership is administered by project owners. Contact your team lead for seat offboarding.'
  };
}

export class AccountDeviceService {
  constructor() {
    this._sessions = new Map();
    this._history = new Map();
    this._lifecycle = new Map();
  }

  seedDefaultSessions(userId, currentSessionId = 'sess_desktop_win11') {
    const now = new Date();

    const desktop = {
      sessionId: 'sess_desktop_win11',
      userId,
      deviceName: 'Windows 11 Pro Desktop Workstation',
      clientType: ClientDeviceType.DesktopApp,
      ipAddress: '198.51.100.15',
      userAgent: 'VESPR-Native-Desktop/1.0.0 (Windows NT 10.0; Win64; x64)',
      createdAt: new Date(now.getTime() - 6 * 3600 * 1000).toISOString(),
      lastActiveAt: now.toISOString(),
      isCurrentDevice: currentSessionId === 'sess_desktop_win11',
      isRevoked: false
    };

    const web = {
      sessionId: 'sess_web_edge',
      userId,
      deviceName: 'Microsoft Edge on Windows',
      clientType: ClientDeviceType.SdeWeb,
      ipAddress: '198.51.100.8',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 Edg/122.0.0.0',
      createdAt: new Date(now.getTime() - 48 * 3600 * 1000).toISOString(),
      lastActiveAt: new Date(now.getTime() - 34 * 60 * 1000).toISOString(),
      isCurrentDevice: currentSessionId === 'sess_web_edge',
      isRevoked: false
    };

    const mobile = {
      sessionId: 'sess_mobile_ios',
      userId,
      deviceName: 'iPhone 15 Pro Companion',
      clientType: ClientDeviceType.MobileCompanion,
      ipAddress: '203.0.113.19',
      userAgent: 'VESPR-Mobile/2.4.0 (iOS 17.4; iPhone16,1)',
      createdAt: new Date(now.getTime() - 120 * 3600 * 1000).toISOString(),
      lastActiveAt: new Date(now.getTime() - 3 * 3600 * 1000).toISOString(),
      isCurrentDevice: currentSessionId === 'sess_mobile_ios',
      isRevoked: false
    };

    const piTerminal = {
      sessionId: 'sess_pi_term',
      userId,
      deviceName: 'Raspberry Pi 5 Remote Terminal',
      clientType: ClientDeviceType.TerminalCli,
      ipAddress: '198.51.100.8',
      userAgent: 'VESPR-CLI/1.0.0 (Linux aarch64; Debian 12)',
      createdAt: new Date(now.getTime() - 24 * 3600 * 1000).toISOString(),
      lastActiveAt: new Date(now.getTime() - 60 * 60 * 1000).toISOString(),
      isCurrentDevice: currentSessionId === 'sess_pi_term',
      isRevoked: false
    };

    this._sessions.set(desktop.sessionId, desktop);
    this._sessions.set(web.sessionId, web);
    this._sessions.set(mobile.sessionId, mobile);
    this._sessions.set(piTerminal.sessionId, piTerminal);

    this._lifecycle.set(userId, AccountLifecycleStatus.Active);

    const historyList = [
      {
        eventId: 'evt_001',
        userId,
        eventType: 'login_success',
        clientType: ClientDeviceType.DesktopApp,
        ipAddress: '198.51.100.15',
        location: 'Local Subnet (Atlanta, GA)',
        timestamp: new Date(now.getTime() - 6 * 3600 * 1000).toISOString(),
        details: 'Windows Hello biometric authentication successful'
      },
      {
        eventId: 'evt_002',
        userId,
        eventType: 'login_mfa_verified',
        clientType: ClientDeviceType.SdeWeb,
        ipAddress: '198.51.100.8',
        location: 'Local Subnet (Atlanta, GA)',
        timestamp: new Date(now.getTime() - 48 * 3600 * 1000).toISOString(),
        details: 'FIDO2 WebAuthn token verified'
      },
      {
        eventId: 'evt_003',
        userId,
        eventType: 'token_refreshed',
        clientType: ClientDeviceType.MobileCompanion,
        ipAddress: '203.0.113.19',
        location: 'VPN / LTE',
        timestamp: new Date(now.getTime() - 3 * 3600 * 1000).toISOString(),
        details: 'OAuth2 refresh token renewed'
      }
    ];

    this._history.set(userId, historyList);
  }

  getActiveSessions(userId) {
    return Array.from(this._sessions.values())
      .filter(s => s.userId === userId && !s.isRevoked)
      .sort((a, b) => {
        if (a.isCurrentDevice !== b.isCurrentDevice) return a.isCurrentDevice ? -1 : 1;
        return new Date(b.lastActiveAt) - new Date(a.lastActiveAt);
      });
  }

  getAllSessions(userId) {
    return Array.from(this._sessions.values())
      .filter(s => s.userId === userId)
      .sort((a, b) => {
        if (a.isCurrentDevice !== b.isCurrentDevice) return a.isCurrentDevice ? -1 : 1;
        return new Date(b.lastActiveAt) - new Date(a.lastActiveAt);
      });
  }

  getSession(sessionId) {
    return this._sessions.get(sessionId) || null;
  }

  revokeSession(actorUserId, sessionId, reason = 'User initiated revocation') {
    const session = this._sessions.get(sessionId);
    if (!session) return false;
    if (session.isRevoked) return true;

    const revokedSession = {
      ...session,
      isRevoked: true,
      revokedAt: new Date().toISOString(),
      revokedBy: actorUserId
    };
    this._sessions.set(sessionId, revokedSession);

    this.recordHistory({
      eventId: 'evt_' + Math.random().toString(36).slice(2, 10),
      userId: session.userId,
      eventType: 'device_revoked',
      clientType: session.clientType,
      ipAddress: session.ipAddress,
      location: 'Security Control',
      timestamp: new Date().toISOString(),
      details: `Session '${session.deviceName}' (${session.sessionId}) revoked by ${actorUserId}. Reason: ${reason}`
    });

    return true;
  }

  revokeAllOtherSessions(actorUserId, currentSessionId) {
    const others = Array.from(this._sessions.values())
      .filter(s => s.userId === actorUserId && !s.isRevoked && s.sessionId !== currentSessionId);

    let count = 0;
    for (const sess of others) {
      if (this.revokeSession(actorUserId, sess.sessionId, 'Logged out from all other devices')) {
        count++;
      }
    }
    return count;
  }

  recordHistory(entry) {
    const list = this._history.get(entry.userId) || [];
    list.unshift(entry);
    this._history.set(entry.userId, list);
  }

  getSessionHistory(userId) {
    const list = this._history.get(userId) || [];
    return list.slice().sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  }

  clearSessionHistory(actorUserId, actorRole, flavor) {
    if (!isHistoryClearingAllowed(actorRole, flavor)) {
      const policy = getCorporatePolicy(flavor);
      return {
        success: false,
        error: `Session history clearing is blocked by ${policy.enforcingAuthority}. Audit logs must be retained for compliance.`
      };
    }

    const list = this._history.get(actorUserId) || [];
    list.length = 0;
    list.push({
      eventId: 'evt_' + Math.random().toString(36).slice(2, 10),
      userId: actorUserId,
      eventType: 'history_cleared',
      clientType: ClientDeviceType.DesktopApp,
      ipAddress: '127.0.0.1',
      location: 'Local Device',
      timestamp: new Date().toISOString(),
      details: 'Session history audit trail cleared by user.'
    });
    this._history.set(actorUserId, list);

    return { success: true, error: '' };
  }

  getAccountLifecycle(userId) {
    return this._lifecycle.get(userId) || AccountLifecycleStatus.Active;
  }

  suspendAccount(actorUserId, actorRole, targetUserId, reason) {
    if (!this._isAuthorizedLifecycleAdmin(actorRole)) {
      return {
        success: false,
        error: 'Unauthorized: Only IT Administrators, School Administrators, or Corporate Legal may suspend accounts.'
      };
    }

    this._lifecycle.set(targetUserId, AccountLifecycleStatus.Suspended);

    const activeSessions = this.getActiveSessions(targetUserId);
    for (const s of activeSessions) {
      this.revokeSession(actorUserId, s.sessionId, `Account suspended: ${reason}`);
    }

    this.recordHistory({
      eventId: 'evt_' + Math.random().toString(36).slice(2, 10),
      userId: targetUserId,
      eventType: 'account_suspended',
      clientType: ClientDeviceType.DesktopApp,
      ipAddress: '127.0.0.1',
      location: 'Administrative Console',
      timestamp: new Date().toISOString(),
      details: `Account placed in Suspended status by ${actorUserId} (${actorRole}). Reason: ${reason}`
    });

    return { success: true, error: '' };
  }

  deactivateAccount(actorUserId, actorRole, targetUserId, reason) {
    if (!this._isAuthorizedLifecycleAdmin(actorRole)) {
      return {
        success: false,
        error: 'Unauthorized: Company policy dictates that only IT Administrators or Corporate Legal may deactivate enterprise accounts.'
      };
    }

    this._lifecycle.set(targetUserId, AccountLifecycleStatus.Deactivated);

    const activeSessions = this.getActiveSessions(targetUserId);
    for (const s of activeSessions) {
      this.revokeSession(actorUserId, s.sessionId, `Corporate seat deactivation: ${reason}`);
    }

    this.recordHistory({
      eventId: 'evt_' + Math.random().toString(36).slice(2, 10),
      userId: targetUserId,
      eventType: 'account_deactivated',
      clientType: ClientDeviceType.DesktopApp,
      ipAddress: '127.0.0.1',
      location: 'Administrative Console',
      timestamp: new Date().toISOString(),
      details: `Account deactivated by ${actorUserId} (${actorRole}). Reason: ${reason}`
    });

    return { success: true, error: '' };
  }

  reactivateAccount(actorUserId, actorRole, targetUserId, reason) {
    if (actorRole !== 'it_admin' && actorRole !== 'school_admin') {
      return {
        success: false,
        error: 'Unauthorized: Reactivation requires IT Administrator or School Administrator authorization.'
      };
    }

    this._lifecycle.set(targetUserId, AccountLifecycleStatus.Active);

    this.recordHistory({
      eventId: 'evt_' + Math.random().toString(36).slice(2, 10),
      userId: targetUserId,
      eventType: 'account_reactivated',
      clientType: ClientDeviceType.DesktopApp,
      ipAddress: '127.0.0.1',
      location: 'Administrative Console',
      timestamp: new Date().toISOString(),
      details: `Account restored to Active status by ${actorUserId} (${actorRole}). Reason: ${reason}`
    });

    return { success: true, error: '' };
  }

  _isAuthorizedLifecycleAdmin(role) {
    return role === 'it_admin' || role === 'school_admin' || role === 'corporate_legal';
  }
}
