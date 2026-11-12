// Unit tests for VESPR NAS Storage Service
import test from 'node:test'
import assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import net from 'node:net'

const usedTestPorts = new Set()
function freePort () {
  return new Promise((resolve, reject) => {
    const s = net.createServer()
    s.once('error', reject)
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port
      s.close(err => {
        if (err) return reject(err)
        if (usedTestPorts.has(p)) return resolve(freePort())
        usedTestPorts.add(p)
        resolve(p)
      })
    })
  })
}

import crypto from 'node:crypto'
import { createNas, cleanName, cleanClearance } from '../nas.js'

const tmpDir = path.join('/tmp', 'nas-test-' + crypto.randomBytes(4).toString('hex'))
fs.mkdirSync(tmpDir, { recursive: true })

const TOKENS = new Map([
  ['valid-token', 'alice'],
  ['agent-token', 'agent-coder']
])

const identify = token => TOKENS.get(token) || null
const roomOk = r => /^[a-z0-9-]+$/.test(r)

const nas = createNas({
  DATA: tmpDir,
  identify,
  roomOk,
  maxBytes: 10 * 1024 * 1024, // 10 MB for test
  maxRoomBytes: 25 * 1024 * 1024
})

const server = http.createServer((req, res) => {
  if (nas.http(req, res)) return
  res.writeHead(404)
  res.end('not found')
})

const bindPort = await freePort()
await new Promise(r => server.listen(bindPort, '127.0.0.1', r))
const port = server.address().port
const base = `http://127.0.0.1:${port}`

try {
  // 1. Sanity check cleanName & cleanClearance
  assert.strictEqual(cleanName('foo/bar/test.bin'), 'test.bin')
  assert.strictEqual(cleanName('../../../evil.sh'), 'evil.sh')
  assert.strictEqual(cleanClearance('l3'), 'L3')
  assert.strictEqual(cleanClearance('unknown'), 'L1')

  // 2. Reject unauthenticated requests
  const unauthRes = await fetch(`${base}/api/nas/room-1`)
  assert.strictEqual(unauthRes.status, 401, '401 on missing token')

  // 3. Upload a sample binary asset
  const sampleData = Buffer.from('VESPR NAS Storage Binary Payload chunk-001')
  const uploadRes = await fetch(`${base}/api/nas/room-1?name=dataset-v1.bin&clearance=L2`, {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer valid-token',
      'Content-Type': 'application/octet-stream'
    },
    body: sampleData
  })
  assert.strictEqual(uploadRes.status, 201, '201 Created on asset upload')
  const uploaded = await uploadRes.json()
  assert.ok(uploaded.id && /^[0-9a-f]{16}$/.test(uploaded.id))
  assert.strictEqual(uploaded.name, 'dataset-v1.bin')
  assert.strictEqual(uploaded.clearance, 'L2')
  assert.strictEqual(uploaded.size, sampleData.length)
  assert.strictEqual(uploaded.by, 'alice')
  const expectedSha = crypto.createHash('sha256').update(sampleData).digest('hex')
  assert.strictEqual(uploaded.sha256, expectedSha)

  // 4. List assets
  const listRes = await fetch(`${base}/api/nas/room-1`, {
    headers: { 'Authorization': 'Bearer valid-token' }
  })
  assert.strictEqual(listRes.status, 200)
  const items = await listRes.json()
  assert.strictEqual(items.length, 1)
  assert.strictEqual(items[0].id, uploaded.id)

  // 5. Full download
  const dlRes = await fetch(`${base}/api/nas/room-1/${uploaded.id}`, {
    headers: { 'Authorization': 'Bearer valid-token' }
  })
  assert.strictEqual(dlRes.status, 200)
  assert.strictEqual(dlRes.headers.get('accept-ranges'), 'bytes')
  const downloadedBuf = Buffer.from(await dlRes.arrayBuffer())
  assert.deepStrictEqual(downloadedBuf, sampleData)

  // 6. Range request download (HTTP 206 Partial Content)
  // Request bytes 6 through 14
  const rangeRes = await fetch(`${base}/api/nas/room-1/${uploaded.id}`, {
    headers: {
      'Authorization': 'Bearer valid-token',
      'Range': 'bytes=6-14'
    }
  })
  assert.strictEqual(rangeRes.status, 206, '206 Partial Content')
  assert.strictEqual(rangeRes.headers.get('content-range'), `bytes 6-14/${sampleData.length}`)
  const rangeBuf = Buffer.from(await rangeRes.arrayBuffer())
  assert.deepStrictEqual(rangeBuf, sampleData.subarray(6, 15))

  // 7. Verify integrity endpoint
  const verifyRes = await fetch(`${base}/api/nas/room-1/${uploaded.id}/verify`, {
    method: 'POST',
    headers: { 'Authorization': 'Bearer valid-token' }
  })
  assert.strictEqual(verifyRes.status, 200)
  const verifyData = await verifyRes.json()
  assert.strictEqual(verifyData.verified, true)
  assert.strictEqual(verifyData.sha256, expectedSha)

  // 8. Delete asset
  const delRes = await fetch(`${base}/api/nas/room-1/${uploaded.id}`, {
    method: 'DELETE',
    headers: { 'Authorization': 'Bearer valid-token' }
  })
  assert.strictEqual(delRes.status, 200)
  const delData = await delRes.json()
  assert.strictEqual(delData.ok, true)

  // Confirm listing is empty
  const listAfter = await (await fetch(`${base}/api/nas/room-1`, { headers: { 'Authorization': 'Bearer valid-token' } })).json()
  assert.strictEqual(listAfter.length, 0)

  console.log('nas tests passed: cleanName, cleanClearance, auth, upload, list, full download, range streaming (206), verify, and delete')
} finally {
  server.close()
  fs.rmSync(tmpDir, { recursive: true, force: true })
}
