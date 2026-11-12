// Agent wake and initial kickoff prompt chips.
// When an agent joins a workspace or wakes up (VESPR_AGENT_WAKE=1), it inspects the workspace
// using detectProject and posts an orientation kickoff message with quick action prompt chips.
import { detectProject } from './project.js'

export function generateWakeMessage ({ name = 'coder', files = [], read = () => '' } = {}) {
  const project = detectProject({
    list: () => files,
    read
  })

  const stackName = project.stack && project.stack !== 'unknown'
    ? project.stack.toUpperCase()
    : 'workspace'

  const chips = []
  if (project.test) chips.push(`Run test suite (\`${project.test}\`)`)
  if (project.dev) chips.push(`Start dev preview (\`${project.dev.split(' -- ')[0]}\`)`)
  chips.push('Explain project architecture & entrypoints')
  chips.push('Run diagnostics & linter check')

  let text = `👋 Hello! **@${name}** is active and connected to this workspace.\n\n`
  if (files.length === 0) {
    text += 'The workspace is currently empty. You can drag and drop files here, import a GitHub repository, or ask me to scaffold a new project.\n\n'
    text += '**Quick actions to get started:**\n'
    text += '- 💡 Scaffold a new React / Vite frontend\n'
    text += '- 💡 Scaffold a FastAPI / Python backend\n'
    text += '- 💡 Import an existing GitHub repository\n'
  } else {
    text += `I inspected the repository (${files.length} files) and detected **${stackName}** infrastructure.\n`
    if (project.command) {
      text += `- **Dev / Start Command**: \`${project.command}\`\n`
    }
    if (project.test) {
      text += `- **Test Suite**: \`${project.test}\`\n`
    }
    text += '\n**Quick actions to get started:**\n'
    for (const chip of chips) {
      text += `- 💡 ${chip}\n`
    }
  }

  return {
    project,
    text,
    chips
  }
}

export function shouldWake ({ room, name = 'coder', wakeFlag = process.env.VESPR_AGENT_WAKE } = {}) {
  // If explicitly disabled with '0', don't wake
  if (wakeFlag === '0' || wakeFlag === 'false') return false

  // Check if handled map has a recorded wake
  const wakeKey = `wake:${name}`
  if (room && room.handled && room.handled.get(wakeKey)) return false

  // Check if room chat already has a wake message from this agent
  const chatArray = room && room.chat ? room.chat.toArray() : []
  const alreadyWoke = chatArray.some(m => {
    const isThisAgent = m.get('author') === name && m.get('isAgent')
    const text = m.get('text') ? m.get('text').toString() : ''
    return isThisAgent && (text.includes('is active and connected') || text.includes('Quick actions'))
  })
  if (alreadyWoke) return false

  return true
}

export async function wakeAgent ({ room, name = 'coder', wakeFlag = process.env.VESPR_AGENT_WAKE } = {}) {
  if (!shouldWake({ room, name, wakeFlag })) return null

  const wakeKey = `wake:${name}`
  if (room && room.handled) room.handled.set(wakeKey, Date.now())

  const files = room && typeof room.list === 'function' ? room.list() : []
  const read = p => (room && typeof room.read === 'function' ? room.read(p) : '')
  const wakeData = generateWakeMessage({ name, files, read })

  if (room && typeof room.say === 'function') {
    room.say(wakeData.text)
  }

  return wakeData
}
