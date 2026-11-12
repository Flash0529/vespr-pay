// Outbound runner. A remote job cannot select its isolation mode.
import WebSocket from 'ws'
import os from 'node:os'
import path from 'node:path'
import { validateJob, prepareJob } from './job.js'
import { runNative } from './sandbox.js'
import { runLocal } from './local.js'

export function startRunner ({ server, token, label = `${os.hostname()} (${process.platform})`, root = path.join(os.tmpdir(), 'murmio-runner'), canRun = async () => false, log = console.log, isolation = process.platform === 'linux' ? 'native' : 'trusted-local', nativeOptions = {} }) {
  if (!['native', 'trusted-local'].includes(isolation)) throw new Error('isolation must be native or trusted-local')
  const decided = new Map()
  let stopped = false; let ws; let reconnect; let active

  async function runJob (raw, socket) {
    const send = m => socket.readyState === WebSocket.OPEN && socket.send(JSON.stringify({ id: raw.id, ...m }))
    let job
    try { job = validateJob(raw) } catch (error) { send({ type: 'result', code: -1, error: error.message }); return }
    if (active) { send({ type: 'result', code: -1, error: 'runner is busy' }); return }
    const controller = new AbortController(); active = controller
    let prepared
    try {
      if (!decided.has(job.room)) decided.set(job.room, Promise.resolve().then(() => canRun(job.room)).then(Boolean, () => false))
      const allowed = await decided.get(job.room)
      if (controller.signal.aborted || stopped) throw new Error('job cancelled')
      if (!allowed) throw new Error(`this runner does not allow workspace "${job.room}"`)
      prepared = prepareJob(root, job)
      log(`job ${job.id} (${job.room}) using ${isolation}`)
      const execute = isolation === 'native' ? runNative : runLocal
      const result = await execute(prepared, job, { ...nativeOptions, signal: controller.signal, onChunk: data => send({ type: 'chunk', data }) })
      send({ type: 'result', ...result })
    } catch (error) {
      log(`job ${job.id} refused or failed: ${error.message}`)
      send({ type: 'result', code: -1, error: error.message })
    } finally { prepared?.cleanup(); if (active === controller) active = null }
  }

  function connect () {
    if (stopped) return
    const socket = new WebSocket(`${server.replace(/\/$/, '')}/runner?token=${encodeURIComponent(token)}&label=${encodeURIComponent(label)}&os=${process.platform}&arch=${process.arch}`, { maxPayload: 16 * 1024 * 1024 })
    ws = socket
    socket.on('open', () => log(`connected to ${server} as "${label}" (${isolation})`))
    socket.on('message', raw => { let m; try { m = JSON.parse(raw) } catch { return } if (m?.type === 'job') runJob(m, socket).catch(e => log('job failed: ' + e.message)) })
    socket.on('close', () => { active?.abort(); if (!stopped) { log('disconnected; retrying in 5 s'); reconnect = setTimeout(connect, 5000) } })
    socket.on('error', e => log('connection error: ' + e.message))
  }
  connect()
  return { stop () { stopped = true; clearTimeout(reconnect); active?.abort(); try { ws.close() } catch {} } }
}
