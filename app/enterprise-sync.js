// NOT LOADED BY THE APP (2026-11-11): this is a simulation with a made-up GitHub organization and sample audit events. No directory is connected, and Settings > Organization
// directory says so. Kept only so its test and the packaging lists still build; do not load it in the app until a real connection exists.
// app/enterprise-sync.js - GitHub Organizations & SCIM 2.0 Enterprise Directory Sync

export class EnterpriseDirectorySyncService {
  constructor(roleService) {
    this.roleService = roleService;
    this.gitHubOrg = 'apex-systems-cloud';
    this.gitHubConnected = true;
    this.gitHubLastSync = new Date();
    this.scimProviderName = 'Okta Enterprise SCIM 2.0';
    this.scimConnected = true;
    this.scimLastSync = new Date();

    this.teamMappings = new Map([
      ['org-owners', 'it_admin'],
      ['lead-architects', 'senior_dev'],
      ['backend-engineers', 'senior_dev'],
      ['frontend-engineers', 'junior_dev'],
      ['interns', 'intern'],
      ['compliance-officers', 'corporate_legal']
    ]);

    this.gitHubMembers = [
      { login: 'shamit-apex', email: 'owner@example.com', role: 'admin', teams: ['org-owners', 'lead-architects'], isSuspended: false },
      { login: 'alex-apex', email: 'alex.m@apexsystems.com', role: 'member', teams: ['backend-engineers'], isSuspended: false },
      { login: 'devon-apex', email: 'devon.v@apexsystems.com', role: 'member', teams: ['frontend-engineers'], isSuspended: false },
      { login: 'maya-intern', email: 'maya.lin@stanford.edu', role: 'member', teams: ['interns'], isSuspended: false },
      { login: 'elena-legal', email: 'elena.r@corporate-legal.org', role: 'member', teams: ['compliance-officers'], isSuspended: false }
    ];

    this.scimUsers = [
      { scimId: 'scim-01', email: 'owner@example.com', department: 'Executive', jobTitle: 'Chief Architect', active: true },
      { scimId: 'scim-02', email: 'alex.m@apexsystems.com', department: 'Engineering', jobTitle: 'Staff Backend Dev', active: true },
      { scimId: 'scim-03', email: 'elena.r@corporate-legal.org', department: 'Legal', jobTitle: 'Compliance Officer', active: true }
    ];

    this.auditTrail = [
      { provider: 'GitHub', action: 'SYNC_ROLE', targetUser: 'owner@example.com', assignedRole: 'it_admin', timestamp: new Date() },
      { provider: 'GitHub', action: 'SYNC_ROLE', targetUser: 'alex.m@apexsystems.com', assignedRole: 'senior_dev', timestamp: new Date() },
      { provider: 'SCIM', action: 'PROVISION_USER', targetUser: 'elena.r@corporate-legal.org', assignedRole: 'corporate_legal', timestamp: new Date() }
    ];

    this.syncAll();
  }

  syncAll() {
    for (const m of this.gitHubMembers) {
      if (m.isSuspended) continue;
      let targetRole = 'junior_dev';
      for (const t of m.teams) {
        if (this.teamMappings.has(t)) {
          targetRole = this.teamMappings.get(t);
          break;
        }
      }
      if (this.roleService && typeof this.roleService.assignRole === 'function') {
        this.roleService.assignRole(m.email, targetRole);
      }
    }
    this.gitHubLastSync = new Date();
  }

  setTeamMapping(team, roleId) {
    this.teamMappings.set(team, roleId);
  }

  getTeamMappings() {
    return Array.from(this.teamMappings.entries());
  }

  getStatus() {
    const suspended = this.gitHubMembers.filter(m => m.isSuspended).length;
    const active = this.gitHubMembers.filter(m => !m.isSuspended).length;
    return {
      gitHubConnected: this.gitHubConnected,
      gitHubOrg: this.gitHubOrg,
      gitHubLastSync: this.gitHubLastSync,
      gitHubMembersCount: this.gitHubMembers.length,
      scimConnected: this.scimConnected,
      scimProvider: this.scimProviderName,
      scimLastSync: this.scimLastSync,
      scimUsersCount: this.scimUsers.length,
      totalProvisionedSeats: active,
      suspendedSeats: suspended
    };
  }

  getAuditTrail() {
    return this.auditTrail;
  }
}