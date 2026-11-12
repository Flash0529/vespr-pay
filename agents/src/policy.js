// Permission modes for agents, the usual coding-assistant modes: what an agent may do on its own and when it must ask.
//   manual       ask before every edit and every command
//   acceptEdits  edits go through; commands ask
//   auto         edits go through; commands that look safe go through, risky ones ask, dangerous ones are refused
//   plan         read-only: the agent writes a plan in chat; nothing is changed until a person approves it
//   bypass       everything goes through (never on someone else's machine: it falls back to auto)
// The mode lives in the shared document (settings.agentMode), so the whole workspace sees it and anyone can change it.
export const MODES = ['manual', 'acceptEdits', 'auto', 'plan', 'bypass']
export const DEFAULT_MODE = 'manual'

const SHELL_TRICKS = /[;|&<>`\n]|\$\(/
const SAFE = [
  /^(python3?|node|ruby|php)\s+[\w./-]+(\s+[\w./=:-]+)*$/,           // run a script in the workspace
  /^(pytest|python3? -m pytest|python3? -m unittest)(\s+[\w./=:-]+)*$/,
  /^(npm|yarn|pnpm)( run)? (test|lint|build|typecheck)$/,
  /^(make|cargo|go) (test|build|check)$/,
  /^(tsc|eslint|prettier|ruff|flake8|black)\b[\w\s./=:-]*$/,
  /^(ls|pwd|cat|head|tail|wc|grep|find|tree|diff|sort|uniq|echo|which|date)\b[\w\s./=:*"'-]*$/,
  /^git (status|diff|log|show|branch)\b[\w\s./=:-]*$/
]
const DANGEROUS = [/\bsudo\b/, /\bmkfs\b/, /\bdd\s+if=/, /\brm\s+-[a-z]*r[a-z]*f?\s+(\/|~|\*)/, /:\(\)\s*\{/, /\bchmod\s+-R\s+777\s+\//, /\b(shutdown|reboot|halt)\b/]

// Running a script or a test suite executes whatever the workspace contains, so on someone's own computer (a remote runner)
// only commands that merely look at things count as safe.
const READ_ONLY = /^(ls|pwd|cat|head|tail|wc|grep|tree|diff|sort|uniq|echo|which|date|git (status|diff|log|show|branch))\b[\w\s./=:*"'-]*$/

export function classifyCommand (cmd, { remote = false } = {}) {
  const c = cmd.trim()
  if (DANGEROUS.some(re => re.test(c))) return 'dangerous'
  if (!SHELL_TRICKS.test(c) && (remote ? READ_ONLY : { test: x => SAFE.some(re => re.test(x)) }).test(c)) return 'safe'
  return 'risky' // anything else, including network tools, installs, pipes and redirects
}

// action: { kind: 'read' | 'edit' | 'delete' | 'command', command? }  ->  'allow' | 'ask' | 'deny'
export function decide (mode, action, { remoteRunner = false } = {}) {
  if (action.kind === 'read') return 'allow'
  if (mode === 'bypass' && remoteRunner) mode = 'auto'
  switch (mode) {
    case 'plan': return 'deny'
    case 'bypass': return 'allow'
    case 'acceptEdits': return action.kind === 'edit' ? 'allow' : 'ask'
    case 'auto':
      if (action.kind === 'edit') return 'allow'
      if (action.kind === 'delete') return 'ask'
      { const c = classifyCommand(action.command || '', { remote: remoteRunner }); return c === 'safe' ? 'allow' : c === 'dangerous' ? 'deny' : 'ask' }
    default: return 'ask' // manual, or anything unknown
  }
}
