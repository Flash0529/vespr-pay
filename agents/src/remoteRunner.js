// A Runner that sends the command to a machine connected to the VESPR server (a teammate's computer, a server, a cloud VM).
// Same two members as SandboxRunner: label/remote and exec(). The room's files go with the job; files the command creates
// or changes come back and are written into the shared workspace as the agent's edits.
export class RemoteRunner {
  constructor ({ baseUrl, token, info }) { this.baseUrl = baseUrl.replace(/\/$/, ''); this.token = token; this.id = info.id; this.label = `${info.label} (${info.os})`; this.remote = true }

  async exec (room, command, msgId) {
    const files = {}; for (const rel of room.list()) files[rel] = room.read(rel)
    const res = await fetch(`${this.baseUrl}/api/run`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.token}` },
      body: JSON.stringify({ runner: this.id, room: room.roomName, files, command, timeoutMs: 60000 })
    })
    if (!res.ok) return { code: -1, output: `could not reach runner ${this.label}: HTTP ${res.status}`, changed: [] }
    let output = ''; let result = null; let buf = ''
    for await (const chunk of res.body) {
      buf += Buffer.from(chunk).toString()
      let nl; while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl); buf = buf.slice(nl + 1)
        if (!line.trim()) continue
        const m = JSON.parse(line)
        if (m.type === 'chunk') output += m.data
        if (m.type === 'result') result = m
      }
    }
    if (!result) return { code: -1, output: output + '\n[runner stopped answering]', changed: [] }
    if (result.error) return { code: result.code ?? -1, output: result.error, changed: [] }
    const changed = []
    for (const [rel, text] of Object.entries(result.changed || {})) { if (room.read(rel) !== text) { const r = room.write(rel, text, msgId); if (r.ok) changed.push(rel) } }
    return { code: result.code, output: output.slice(0, 20 * 1024), changed }
  }
}

// Which runner does this workspace use right now? Returns null when the chosen one is offline (never silently falls back).
export async function pickRunner ({ room, sandbox, baseUrl, token }) {
  const want = room.settings.get('runner') || 'sandbox'
  if (want === 'sandbox') return sandbox
  try {
    const list = await (await fetch(`${baseUrl}/api/runners`, { headers: { Authorization: `Bearer ${token}` } })).json()
    const info = list.find(r => r.id === want)
    return info ? new RemoteRunner({ baseUrl, token, info }) : null
  } catch { return null }
}
