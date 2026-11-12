// VESPR agent worker: joins a room as a named teammate and answers chat messages that mention it (@name or @agent).
import { joinRoom } from './src/room.js'
import { OpenAICompat, Mock, discoverModel, tavilyWorks } from './src/llm.js'
import { respond } from './src/agent.js'
import { startSuggestServer } from './src/suggest.js'
import { catchUp } from './src/digest.js'
import { SandboxRunner } from './src/runner.js'
import { pickRunner } from './src/remoteRunner.js'
import { ProcessManager } from './src/processes.js'
import { previewHandler } from './src/preview.js'
import { createBudget } from './src/budget.js'
import { startRuns } from './src/runs.js'
import { startPacks } from './src/packs.js'
import { startGithub, githubFetchers } from './src/github.js'
import { startGithubPr, githubApi } from './src/githubpr.js'
import { buildLibrary, makeGithubSearch, httpFetchers } from './src/skills.js'
import { createAttachments } from './src/attachments.js'
import { createManager, DEFAULT_BEAT_INTERVAL_SEC } from './src/manager.js'
import { treeFrom, answersMention } from './src/hierarchy.js'
import { hasReports } from './src/delegate.js'
import { createWorker, WORKER_TICK_SEC, evidenceFrom } from './src/worker.js'
import { createLedgerReporter, createPaywall, LIMIT } from './src/ledger.js'
import { wakeAgent } from './src/wake.js'
import path from 'node:path'; import { fileURLToPath } from 'node:url'

const env = process.env
const name = env.AGENT_NAME || 'coder'
const apiKey = env.NEBIUS_API_KEY
const baseUrl = env.NEBIUS_BASE_URL || 'https://api.tokenfactory.nebius.com/v1'
let llm; let suggestModel
if (apiKey) {
  try {
    const model = env.NEBIUS_MODEL || await discoverModel({ baseUrl, apiKey, prefer: [/super/i] })
    const planModel = env.NEBIUS_PLAN_MODEL || await discoverModel({ baseUrl, apiKey, prefer: [/ultra/i] }).catch(() => model)
    llm = new OpenAICompat({ baseUrl, apiKey, model, planModel })
    // small and fast for inline suggestions (latency matters more than depth there)
    // measured on Token Factory 2026-10-28 (thinking off, six different prompts): Super median 628 ms, Nano 2095 ms, so Super also serves the suggestions
  suggestModel = env.NEBIUS_SUGGEST_MODEL || model
  } catch (e) {
    // a rejected key or an unreachable provider must not take the agent (and the whole demo chat) down: stay up as the scripted agent and say why
    console.error(`NEBIUS_API_KEY is set but the model could not be set up (${e.message}); falling back to the scripted demo agent`)
    llm = new Mock(); llm.label = `demo-mode (scripted; the model key did not work: ${e.message})`; suggestModel = undefined
  }
} else llm = new Mock()
let tavilyKey = env.TAVILY_API_KEY
if (tavilyKey && !(await tavilyWorks(tavilyKey))) { console.error('TAVILY_API_KEY was rejected by Tavily; web search stays off'); tavilyKey = undefined }
console.log(`agent "${name}" starting, model: ${llm.label}${tavilyKey ? ', web search on' : ''}`)

const room = joinRoom({ server: env.MURMIO_SERVER || 'ws://collab:8241', room: env.MURMIO_ROOM || 'demo', token: env.MURMIO_TOKEN, name, color: env.AGENT_COLOR || 'hsl(170, 70%, 55%)', model: llm.apiKey ? `chat ${llm.model} · plan ${llm.planModel} · suggest ${suggestModel}` : llm.label })
await room.ready
// every agent says it is alive every few seconds (awareness), so a manager can tell a quiet worker from a gone one
room.beat(); setInterval(() => room.beat(), DEFAULT_BEAT_INTERVAL_SEC * 1000)
// Agent Wake: proactively orient when joining workspace (VESPR_AGENT_WAKE=1 or quiet room)
if (env.VESPR_AGENT_WAKE === '1' || env.VESPR_AGENT_WAKE === 'true') {
  wakeAgent({ room, name, wakeFlag: env.VESPR_AGENT_WAKE }).catch(e => console.error(`agent "${name}" wake failed:`, e.message))
}
const agentTree = treeFrom(env.VESPR_AGENT_TREE || '') // the team tree (hierarchy.js): empty unless the operator set one
// every model call goes to the server's usage ledger (server/usage-ledger.js), billed to who asked: on with VESPR_LEDGER=1
const ledger = env.VESPR_LEDGER === '1' ? createLedgerReporter({ server: env.MURMIO_SERVER || 'ws://collab:8241', token: env.MURMIO_TOKEN }) : null
// with billing on (VESPR_BILLING=1, server/billing.js) the agent asks before spending on someone, and shows the usage-limit card when they are out
const paywall = env.VESPR_BILLING === '1' ? createPaywall({ server: env.MURMIO_SERVER || 'ws://collab:8241', token: env.MURMIO_TOKEN }) : null
const gated = async (person, run) => { if (paywall && !(await paywall(person, room.roomName)).ok) return room.limit(person, LIMIT); return run() }
// AGENT_ROLE=manager: also run the manager watchdog for this agent's direct reports in the agent tree (VESPR_AGENT_TREE, hierarchy.js).
// No tree, or this agent not in it: the manager loop stays off (a manager never takes workers from what peers claim about themselves).
if (env.AGENT_ROLE === 'manager' || hasReports(treeFrom(env.VESPR_AGENT_TREE || '')(), name)) { // a middle manager watches its own workers too
  const tree = treeFrom(env.VESPR_AGENT_TREE || '')
  if (!tree().has(name)) console.error(`AGENT_ROLE=manager but "${name}" is not in the agent tree (${env.VESPR_AGENT_TREE || 'VESPR_AGENT_TREE is not set'}): the manager loop stays off`)
  else {
    const mgr = createManager({ name, pair: env.AGENT_PAIR || name, room, tree })
    setInterval(() => { try { mgr.tick() } catch (e) { console.error('manager tick failed:', e.message) } }, mgr.tickSec * 1000)
    console.log(`manager of ${[...tree().values()].filter(n => n.parent === name).map(n => n.name).join(', ') || 'nobody yet'} (team ${mgr.pair}, watchdog every ${mgr.tickSec} s)`)
  }
}
const started = Date.now()
const mention = new RegExp(`@(${name}|agent|all)\\b`, 'i')
const runner = new SandboxRunner()
const processes = new ProcessManager()
const budget = createBudget({ cap: Number(env.MURMIO_TOKEN_CAP || 0), windowMs: Number(env.MURMIO_TOKEN_WINDOW_HOURS || 24) * 3600 * 1000 }) // MURMIO_TOKEN_CAP=0 (default): no limit
const publicUrl = (env.MURMIO_PUBLIC_URL || 'http://localhost:9401').replace(/\/$/, '') // where a browser reaches the VESPR server: previews are served under it
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { processes.stopAll(); process.exit(0) })
const httpBase = (env.MURMIO_SERVER || 'ws://collab:8241').replace(/^ws/, 'http')
const attachments = createAttachments({ baseUrl: httpBase, token: env.MURMIO_TOKEN, room: env.MURMIO_ROOM || 'demo' }) // files people uploaded to this room
const getRunner = () => pickRunner({ room, sandbox: runner, baseUrl: httpBase, token: env.MURMIO_TOKEN })
// Skills: a built-in starter library (src/starter-skills), an optional folder (VESPR_SKILLS_DIR), and GitHub repositories the owner connected (VESPR_SKILL_SOURCES, comma-separated links).
// Skills installed into the workspace live in its files (.vespr/skills). Anything from GitHub is only installed after a person approves it.
const here = path.dirname(fileURLToPath(import.meta.url))
// The bundled skills (src/pack-skills: browser checks, video and audio, Vite/React/TypeScript/Supabase, diagrams, ...) are findable with find_skill even when no field pack copied them in; they stay out of the prompt index.
const { lib: skillLibrary, errors: skillErrors } = buildLibrary({ bundledDir: path.join(here, 'src/pack-skills'), starterDir: path.join(here, 'src/starter-skills'), extraDir: env.VESPR_SKILLS_DIR })
skillErrors.forEach(e => console.error('skill skipped: ' + e))
const skillSources = (env.VESPR_SKILL_SOURCES || '').split(',').map(s => s.trim()).filter(Boolean)
const skills = { library: skillLibrary, github: skillSources.length ? makeGithubSearch(skillSources, httpFetchers({ token: env.GITHUB_TOKEN })) : undefined }
console.log(`skills: ${skillLibrary.list().length} in the library, ${skillSources.length} GitHub source(s)`)
let queue = Promise.resolve()

const checkMessage = m => {
  const id = m.get('id'); const text = m.get('text') ? m.get('text').toString() : ''
  if (m.get('isAgent') || m.get('ts') < started - 2000 || !mention.test(text) || room.handled.get(id)) return
  if (!answersMention({ text, name, tree: agentTree() })) return // a generic @agent / @all is for the top agent, not its workers
  room.handled.set(id, name) // claim it, so a second agent does not answer the same message
  const job = /\b(catch( me)? up|what did i miss|digest)\b/i.test(text) ? () => gated(String(m.get('author') || ''), () => catchUp({ room, llm, msg: m })) : () => respond({ room, llm, trigger: id, tavilyKey, runner, getRunner, processes, publicUrl, budget, skills, attachments, tree: agentTree, ledger, paywall })
  queue = queue.then(job).catch(e => console.error("job failed:", e.message))
}
room.chat.observe(ev => {
  for (const item of ev.changes.added) for (const m of item.content.getContent()) {
    checkMessage(m)
    const tx = m.get('text')
    if (tx && tx.observe && !room.handled.get(m.get('id'))) {
      tx.observe(() => checkMessage(m))
    }
  }
})
startGithub({ room, fetchers: githubFetchers({ token: env.GITHUB_TOKEN || '' }) }) // open a GitHub repository in the workspace (public ones need no key)
startGithubPr({ room, api: env.GITHUB_TOKEN ? githubApi({ token: env.GITHUB_TOKEN }) : null }) // send the workspace's changes back as a pull request (needs a token that can write to that repository; the room approves one card first)
startPacks({ room, fetchers: httpFetchers({ token: env.GITHUB_TOKEN || '' }) }) // the app's first-run question: skills for the field (GitHub ones only after a person approves)
startRuns({ room, getRunner, enabled: env.MURMIO_HUMAN_RUNS === '1' }) // the app's Run button: off unless the operator turns it on
startSuggestServer({ room, llm, model: suggestModel, port: Number(env.SUGGEST_PORT || 8242), tokensFile: env.MURMIO_TOKENS_FILE || '/run/secrets/murmio-tokens', extra: previewHandler(processes), budget, ledger, paywall })
console.log(`inline suggestions on :${env.SUGGEST_PORT || 8242} with ${suggestModel || llm.label}`)
console.log(`ready in room ${env.MURMIO_ROOM || 'demo'}; files: ${room.list().length}`)

// A worker: an agent with a parent in the agent tree takes the tasks its manager assigns (worker.js), one at a time, through the
// same job queue as chat so it never runs two jobs at once. Evidence for the manager's review: its own replies and steps for the task.
{
  const me = treeFrom(env.VESPR_AGENT_TREE || '')().get(name)
  if (me && me.parent) {
    const runTask = task => new Promise(resolve => {
      queue = queue.then(async () => {
        const since = Date.now() - 1
        const note = room.say(`Working on task ${task.id} (${task.title})${task.createdBy ? ` for ${task.createdBy}` : ''}.`)
        await respond({ room, llm, trigger: note.id, tavilyKey, runner, getRunner, processes, publicUrl, budget, skills, attachments, task, tree: agentTree, ledger, paywall })
        const lines = room.chat.toArray().map(m => ({ author: m.get('author'), ts: m.get('ts'), id: m.get('id'), role: m.get('role'), status: m.get('status'), text: m.get('text') ? m.get('text').toString() : '' }))
        resolve(evidenceFrom(lines, { name, since, skipId: note.id }))
      }).catch(e => resolve({ evidence: '', passed: false, error: e.message }))
    })
    const worker = createWorker({ name, pair: env.AGENT_PAIR || me.parent, tasks: room.doc.getMap('tasks'), run: runTask })
    setInterval(() => { try { worker.tick() } catch (e) { console.error('worker tick failed:', e.message) } }, WORKER_TICK_SEC * 1000)
    console.log(`worker for ${me.parent} (checks for tasks every ${WORKER_TICK_SEC} s)`)
  }
}
