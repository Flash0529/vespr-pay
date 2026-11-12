// Setups: what a person is doing (school, a hackathon, a side project, a startup) -> layout, permission mode, skill fields and starter prompts.
// Pure ES module, no DOM, no network. The shell shows the summary BEFORE anything is applied, and a setup only chooses among settings the person
// can change by hand afterwards. A setup never picks "Auto" or "Bypass" (how much the agents may do alone stays the person's call) and never sets
// a free-text "something else" (that would start a GitHub search nobody asked for). Run: node app/test/presets.test.mjs

export const FIELD_IDS = ['vibe', 'web', 'design', 'backend', 'data', 'docs', 'business'] // the bundled skill fields (agents/src/packs.js FOCUS)
export const SAFE_MODES = ['manual', 'plan', 'acceptEdits']
export const MODE_LABEL = { manual: 'Manual', plan: 'Plan', acceptEdits: 'Accept edits' }
const MODE_WORDS = { manual: 'asks before it edits or runs anything', plan: 'explains its plan before it changes anything', acceptEdits: 'edits files without asking, still asks before running commands' }
const LAYOUT_WORDS = { split: 'Split view', chat: 'Conversation only', ide: 'Editor only' }
const FIELD_LABEL = { vibe: 'Vibe coding', web: 'Websites and web apps', design: 'UI and visual design', backend: 'Backend and APIs', data: 'Data and analysis', docs: 'Docs and writing' }

export const PRESETS = [
  { id: 'school', name: 'School', blurb: 'A course, an assignment, a thesis or studying', layout: 'split', mode: 'plan', focus: ['docs', 'data'],
    starters: ['Explain what this assignment asks for, step by step', 'Check my work and tell me what to fix, without rewriting it', 'Make a study plan from these notes'],
    words: ['school', 'homework', 'assignment', 'class', 'course', 'exam', 'study', 'thesis', 'lab', 'professor', 'university', 'college', 'essay', 'teacher', 'student'] },
  { id: 'hackathon', name: 'Hackathon', blurb: 'A deadline, a team and a demo', layout: 'split', mode: 'acceptEdits', focus: ['vibe', 'web'],
    starters: ['Plan the hours we have left, ending with a demo', 'Build the smallest version that can be demoed', 'Write the README and a two-minute demo script'],
    words: ['hackathon', 'hack', 'demo', 'devpost', 'judges', 'judging', 'weekend', 'deadline', 'prize', 'submission'] },
  { id: 'project', name: 'Side project', blurb: 'Something you are building and want to keep', layout: 'split', mode: 'manual', focus: ['vibe'],
    starters: ['Read the project and explain how it fits together', 'Add tests for the part I am changing', 'Find what is most likely to break'],
    words: ['project', 'side', 'hobby', 'open', 'source', 'library', 'tool', 'app', 'script', 'build', 'prototype'] },
  { id: 'startup', name: 'Startup', blurb: 'A product, customers and a first milestone', layout: 'split', mode: 'manual', focus: ['web', 'backend', 'docs'],
    starters: ['Turn this idea into a one-page spec and a first milestone', 'Set up the project and a first landing page', 'List the riskiest assumptions and how to test each one'],
    words: ['startup', 'founder', 'mvp', 'customers', 'customer', 'investors', 'investor', 'pitch', 'saas', 'launch', 'product', 'company', 'business'] }
]

export const getPreset = id => PRESETS.find(p => p.id === id) || null

// The best match for a few words the person typed ("my chem lab report", "weekend hackathon"), or null when nothing matches. Ties go to the earlier setup.
export function suggestPreset (text) {
  const words = String(text == null ? '' : text).toLowerCase().split(/[^a-z]+/).filter(Boolean)
  if (!words.length) return null
  let best = null; let bestScore = 0
  for (const p of PRESETS) {
    let score = 0
    for (const w of words) if (p.words.includes(w)) score++
    if (score > bestScore) { best = p.id; bestScore = score }
  }
  return best
}

// What choosing a setup would do, with the skill fields cut down to what this server offers (`catalog` = ids from the room's packsCatalog; omit it in demo mode).
export function planFor (id, { catalog } = {}) {
  const p = getPreset(id); if (!p) return null
  const focus = p.focus.filter(f => FIELD_IDS.includes(f) && (!Array.isArray(catalog) || catalog.includes(f)))
  const starters = p.starters.slice(0, 3)
  const summary = [LAYOUT_WORDS[p.layout], MODE_WORDS[p.mode], focus.length ? 'skills: ' + focus.map(f => FIELD_LABEL[f]).join(', ') : 'no extra skills'].join(' · ')
  return { id: p.id, name: p.name, layout: p.layout, mode: p.mode, modeLabel: MODE_LABEL[p.mode], focus, starters, summary }
}


// Ask #314: Session handoff & project entry parser
// "get me into this project", "open project <x>", "switch to <x>"
// Redacts sensitive info/keys and configures the animated 3-pane trio layout
export function parseSessionHandoff (text, { availableProjects = [] } = {}) {
  const raw = String(text ?? '').trim()
  if (!raw) return { isHandoff: false }

  const handoffRegex = /^(?:hey\s+)?(?:get|put|take)\s+me\s+into\s+(?:this\s+)?(?:project\s+|session\s+)?([a-zA-Z0-9_\-./]+)?/i
  const openRegex = /^(?:open|switch\s+to|start)\s+(?:project|session)\s+([a-zA-Z0-9_\-./]+)/i

  const m = raw.match(handoffRegex) || raw.match(openRegex)
  if (!m) return { isHandoff: false }

  let target = (m[1] || '').trim()
  if (!target || target.toLowerCase() === 'this') {
    target = 'cart-checkout'
  }

  // Redact credentials/tokens from the prompt before handoff or logging
  const redacted = raw
    .replace(/\b(?:sk-[a-zA-Z0-9_\-]{20,}|ghp_[a-zA-Z0-9]{20,}|AIza[0-9A-Za-z\-_]{25,}|Bearer\s+[a-zA-Z0-9._\-]{20,})\b/gi, '[REDACTED_KEY]')
    .replace(/\b(?:password|secret)\s*[:=]\s*['"][^'"]+['"]/gi, 'password=[REDACTED]')

  return {
    isHandoff: true,
    project: target,
    redactedPrompt: redacted,
    layout: 'trio',
    workflow: {
      sidebar: 'off',
      chat: 'left',
      editor: 'middle',
      browser: 'right',
      animated: true
    },
    message: `Entering project **${target}**. Sidebar minimized, 3-pane workflow active (Chat left · Editor middle · Browser preview right).`
  }
}
