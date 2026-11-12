// app/smart-role-maker.js - Smart Role Builder, Permission Matrices & AI Role Synthesizer

export class SmartRoleService {
  constructor() {
    this.roles = new Map();
    this.userRoles = new Map();
    this.seedRoles();
  }

  seedRoles() {
    const defaultRoles = [
      {
        roleId: 'student',
        displayName: 'Student',
        description: 'Middle and high school enrolled learner with safety guardrails',
        flavor: 'school',
        shell: 'None',
        fileSystem: 'ReadOnlyProject',
        network: 'AllowlistOnly',
        autonomy: 'RestrictedTutor',
        retention: 'FERPACompliant365Days',
        allowChatSharing: false,
        maxDailyComputeTokens: 50000,
        requireMfa: false,
        allowSelfServiceDeactivation: false,
        isSystemImmutable: true,
        tags: ['Education', 'K-12', 'Safety']
      },
      {
        roleId: 'teacher',
        displayName: 'Teacher / Instructor',
        description: 'Classroom educator managing students, assignments, and pods',
        flavor: 'school',
        shell: 'SandboxedIsolated',
        fileSystem: 'ProjectWorkspaceOnly',
        network: 'FullInternet',
        autonomy: 'StandardSDE',
        retention: 'FERPACompliant365Days',
        allowChatSharing: true,
        maxDailyComputeTokens: 300000,
        requireMfa: true,
        allowSelfServiceDeactivation: false,
        isSystemImmutable: true,
        tags: ['Education', 'Faculty', 'Grader']
      },
      {
        roleId: 'intern',
        displayName: 'Software Engineering Intern',
        description: 'Junior trainee with sandbox restrictions and supervised merges',
        flavor: 'corporate',
        shell: 'SandboxedIsolated',
        fileSystem: 'ProjectWorkspaceOnly',
        network: 'AllowlistOnly',
        autonomy: 'GuidedAssistedOnly',
        retention: 'SOC2Compliant180Days',
        allowChatSharing: false,
        maxDailyComputeTokens: 100000,
        requireMfa: true,
        allowSelfServiceDeactivation: false,
        isSystemImmutable: true,
        tags: ['Engineering', 'Trainee', 'Sandboxed']
      },
      {
        roleId: 'junior_dev',
        displayName: 'Junior Developer',
        description: 'Core developer working with isolated branch checkouts and tests',
        flavor: 'corporate',
        shell: 'SandboxedIsolated',
        fileSystem: 'DualProjectAndHost',
        network: 'AllowlistOnly',
        autonomy: 'StandardSDE',
        retention: 'SOC2Compliant180Days',
        allowChatSharing: true,
        maxDailyComputeTokens: 350000,
        requireMfa: true,
        allowSelfServiceDeactivation: false,
        isSystemImmutable: true,
        tags: ['Engineering', 'Developer']
      },
      {
        roleId: 'senior_dev',
        displayName: 'Senior Developer / Tech Lead',
        description: 'Full autonomous multi-agent developer with host access',
        flavor: 'corporate',
        shell: 'FullHost',
        fileSystem: 'DualProjectAndHost',
        network: 'FullInternet',
        autonomy: 'MultiAgentAutonomous',
        retention: 'SOC2Compliant180Days',
        allowChatSharing: true,
        maxDailyComputeTokens: 1500000,
        requireMfa: true,
        allowSelfServiceDeactivation: false,
        isSystemImmutable: true,
        tags: ['Engineering', 'Lead', 'Autonomous']
      },
      {
        roleId: 'it_admin',
        displayName: 'Corporate IT Admin',
        description: 'Enterprise administrator governing seats, SSO, and device security',
        flavor: 'corporate',
        shell: 'FullHost',
        fileSystem: 'FullSystem',
        network: 'FullInternet',
        autonomy: 'MultiAgentAutonomous',
        retention: 'SOC2Compliant180Days',
        allowChatSharing: true,
        maxDailyComputeTokens: 2000000,
        requireMfa: true,
        allowSelfServiceDeactivation: false,
        isSystemImmutable: true,
        tags: ['IT', 'Security', 'SCIM']
      },
      {
        roleId: 'corporate_legal',
        displayName: 'Corporate Legal & Compliance',
        description: 'Audit and legal officer with read-only retention review',
        flavor: 'corporate',
        shell: 'None',
        fileSystem: 'ReadOnlyProject',
        network: 'AllowlistOnly',
        autonomy: 'GuidedAssistedOnly',
        retention: 'SOC2Compliant180Days',
        allowChatSharing: false,
        maxDailyComputeTokens: 150000,
        requireMfa: true,
        allowSelfServiceDeactivation: false,
        isSystemImmutable: true,
        tags: ['Legal', 'Compliance', 'Audit']
      },
      {
        roleId: 'solo_dev',
        displayName: 'Solo Developer / Personal',
        description: 'Independent developer with full workspace control and self-deactivation',
        flavor: 'personal_dev',
        shell: 'FullHost',
        fileSystem: 'DualProjectAndHost',
        network: 'FullInternet',
        autonomy: 'MultiAgentAutonomous',
        retention: 'Standard30Days',
        allowChatSharing: true,
        maxDailyComputeTokens: 800000,
        requireMfa: false,
        allowSelfServiceDeactivation: true,
        isSystemImmutable: true,
        tags: ['Solo', 'Personal']
      }
    ];

    for (const r of defaultRoles) {
      this.roles.set(r.roleId, r);
    }

    this.userRoles.set('you@example.com', 'senior_dev');
  }

  getRoles() {
    return Array.from(this.roles.values());
  }

  getRole(roleId) {
    return this.roles.get(roleId) || null;
  }

  createRole(role) {
    if (!role.roleId || this.roles.has(role.roleId)) return false;
    this.roles.set(role.roleId, { ...role, isSystemImmutable: false });
    return true;
  }

  updateRole(role) {
    const existing = this.roles.get(role.roleId);
    if (!existing || existing.isSystemImmutable) return false;
    this.roles.set(role.roleId, { ...role, isSystemImmutable: false });
    return true;
  }

  deleteRole(roleId) {
    const existing = this.roles.get(roleId);
    if (!existing || existing.isSystemImmutable) return false;
    return this.roles.delete(roleId);
  }

  assignRole(userId, roleId) {
    if (!this.roles.has(roleId)) return false;
    this.userRoles.set(userId, roleId);
    return true;
  }

  getUserRole(userId) {
    const roleId = this.userRoles.get(userId) || 'junior_dev';
    return this.roles.get(roleId) || this.roles.get('junior_dev');
  }

  synthesizeRoleFromPrompt(prompt) {
    const lower = (prompt || '').toLowerCase();
    const idSlug = lower.replace(/[^a-z0-9]+/g, '_').slice(0, 24).replace(/^_+|_+$/g, '') || 'custom_role';

    let displayName = 'Custom Role';
    let flavor = 'corporate';
    let shell = 'SandboxedIsolated';
    let fileSystem = 'ProjectWorkspaceOnly';
    let network = 'AllowlistOnly';
    let autonomy = 'StandardSDE';
    let retention = 'Standard30Days';
    let allowChatSharing = true;
    let maxDailyComputeTokens = 250000;
    let requireMfa = false;
    let allowSelfServiceDeactivation = false;
    const tags = [];

    if (lower.includes('design') || lower.includes('canva') || lower.includes('figma')) {
      displayName = 'Creative & UI Designer';
      shell = 'None';
      fileSystem = 'ProjectWorkspaceOnly';
      network = 'AllowlistOnly';
      autonomy = 'GuidedAssistedOnly';
      maxDailyComputeTokens = 150000;
      tags.push('Design', 'UI/UX', 'Assets');
    } else if (lower.includes('student') || lower.includes('k-12') || lower.includes('school')) {
      displayName = 'Custom Student Learner';
      flavor = 'school';
      shell = 'None';
      fileSystem = 'ReadOnlyProject';
      autonomy = 'RestrictedTutor';
      retention = 'FERPACompliant365Days';
      allowChatSharing = false;
      maxDailyComputeTokens = 60000;
      tags.push('Education', 'Learner');
    } else if (lower.includes('contractor') || lower.includes('vendor') || lower.includes('external')) {
      displayName = 'External Contractor';
      shell = 'SandboxedIsolated';
      fileSystem = 'ProjectWorkspaceOnly';
      network = 'AllowlistOnly';
      autonomy = 'GuidedAssistedOnly';
      retention = 'SOC2Compliant180Days';
      allowChatSharing = false;
      maxDailyComputeTokens = 120000;
      requireMfa = true;
      tags.push('Contractor', 'External', 'Restricted');
    } else if (lower.includes('devops') || lower.includes('cloud') || lower.includes('infra') || lower.includes('lead')) {
      displayName = 'Lead Cloud & DevOps Engineer';
      shell = 'FullHost';
      fileSystem = 'DualProjectAndHost';
      network = 'FullInternet';
      autonomy = 'MultiAgentAutonomous';
      retention = 'SOC2Compliant180Days';
      maxDailyComputeTokens = 1200000;
      requireMfa = true;
      tags.push('DevOps', 'Infrastructure', 'Lead');
    } else {
      tags.push('Custom');
    }

    const tokenMatch = lower.match(/(\d+)\s*(k|m)?\s*tokens?/);
    if (tokenMatch) {
      const num = parseInt(tokenMatch[1], 10);
      const mult = tokenMatch[2] === 'k' ? 1000 : (tokenMatch[2] === 'm' ? 1000000 : 1);
      maxDailyComputeTokens = num * mult;
    }

    return {
      roleId: `custom_${idSlug}`,
      displayName,
      description: `Synthesized role from prompt: ${prompt}`,
      flavor,
      shell,
      fileSystem,
      network,
      autonomy,
      retention,
      allowChatSharing,
      maxDailyComputeTokens,
      requireMfa,
      allowSelfServiceDeactivation,
      isSystemImmutable: false,
      tags
    };
  }

  roleToAccessRights(roleId) {
    return roleToAccessRights(roleId);
  }

  roleToPolicy(roleId) {
    return roleToPolicy(roleId);
  }

  async syncRoleToWorkspace(room, who, roleId, { token, baseUrl = '', fetchImpl = globalThis.fetch } = {}) {
    const rights = roleToAccessRights(roleId);
    if (!room || !who) return { ok: false, error: 'room and who required', rights };
    const cleanRoom = encodeURIComponent(String(room).trim());
    const url = `${baseUrl}/api/access/${cleanRoom}/grant`;
    try {
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ who, path: '', rights })
      });
      const data = await res.json().catch(() => ({}));
      return { ok: res.ok, status: res.status, rights, data };
    } catch (err) {
      return { ok: false, error: err.message, rights };
    }
  }
}

export function roleToAccessRights(roleId) {
  const r = String(roleId || '').toLowerCase();
  if (r === 'student' || r.includes('student') || r === 'corporate_legal') {
    return ['view'];
  }
  if (r === 'intern' || r.includes('intern') || r.includes('contractor') || r.includes('design')) {
    return ['view', 'edit', 'make'];
  }
  if (r === 'junior_dev' || r.includes('junior')) {
    return ['view', 'edit', 'make', 'delete'];
  }
  if (r === 'senior_dev' || r === 'it_admin' || r === 'teacher' || r === 'solo_dev' || r === 'admin' || r === 'lead' || r === 'owner') {
    return ['view', 'edit', 'make', 'delete', 'manage'];
  }
  return ['view', 'edit', 'make'];
}

export function roleToPolicy(roleId) {
  const r = String(roleId || '').toLowerCase();
  if (r === 'student' || r.includes('student')) {
    return { role: 'student', ageBand: 'under13', modes: ['manual', 'plan'], netLevel: 'allowlist', canRun: false };
  }
  if (r === 'intern' || r.includes('intern')) {
    return { role: 'member', ageBand: 'adult', modes: ['manual', 'acceptEdits'], netLevel: 'allowlist', canRun: true };
  }
  if (r === 'teacher' || r.includes('teacher')) {
    return { role: 'teacher', ageBand: 'adult', modes: ['manual', 'acceptEdits', 'auto', 'plan'], netLevel: 'full', canRun: true };
  }
  if (r === 'senior_dev' || r.includes('senior') || r.includes('lead') || r === 'it_admin' || r === 'admin') {
    return { role: 'admin', ageBand: 'adult', modes: ['manual', 'acceptEdits', 'auto', 'plan', 'bypass'], netLevel: 'full', canRun: true };
  }
  if (r === 'corporate_legal') {
    return { role: 'guest', ageBand: 'adult', modes: ['manual'], netLevel: 'off', canRun: false };
  }
  if (r === 'solo_dev') {
    return { role: 'owner', ageBand: 'adult', modes: ['manual', 'acceptEdits', 'auto', 'plan', 'bypass'], netLevel: 'full', canRun: true };
  }
  return { role: 'member', ageBand: 'adult', modes: ['manual', 'acceptEdits', 'auto'], netLevel: 'allowlist', canRun: true };
}
