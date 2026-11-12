// "Run" from the app, against a real collab server: a person asks for a run, the lead agent runs it on the sandbox runner, and the output (streamed, then final) comes back
// through the shared document. Only .py files of the workspace and the unit tests can be asked for; the feature is off unless the operator turns it on.
import { spawn } from 'node:child_process'
import net from 'node:net'
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'
import assert from 'node:assert'
import WebSocket from 'ws'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import { joinRoom } from '../src/room.js'
import { startRuns, buildCommand } from '../src/runs.js'
import { SandboxRunner } from '../src/runner.js'
import { createClient, parsePyProblems } from '../../app/vespr-client.js'

// the command that gets built: only a .py file of the workspace, or the tests
assert.deepStrictEqual(buildCommand('file', 'a/b.py', ['a/b.py']), { cmd: 'python3 a/b.py' })
assert.deepStrictEqual(buildCommand('tests', '', []), { cmd: 'python3 -m unittest discover -v' })
for (const bad of ['../x.py', '/etc/x.py', '-c.py', 'x.txt', 'a b.py', 'x.py; ls', '$(id).py', '']) assert.ok(buildCommand('file', bad, [bad]).error, 'refused: ' + bad)
assert.ok(buildCommand('file', 'missing.py', ['a.py']).error)
assert.ok(buildCommand('rm', 'a.py', ['a.py']).error)

// reading Python errors out of output
const tb = 'Traceback (most recent call last):\n  File "/tmp/murmio-sandbox/r1/boom.py", line 4, in <module>\n    go()\n  File "/tmp/murmio-sandbox/r1/boom.py", line 2, in go\n    return 1 / 0\nZeroDivisionError: division by zero\n'
assert.deepStrictEqual(parsePyProblems(tb, f => f === 'boom.py'), [{ file: 'boom.py', line: 2, message: 'ZeroDivisionError: division by zero' }])
assert.deepStrictEqual(parsePyProblems('  File "bad.py", line 3\n    def x(\n         ^\nSyntaxError: \'(\' was never closed\n', f => f === 'bad.py'), [{ file: 'bad.py', line: 3, message: "SyntaxError: '(' was never closed" }])
const two = 'FAIL: test_a (test_x.T)\n----------------------------------------------------------------------\nTraceback (most recent call last):\n  File "/usr/lib/python3.11/unittest/case.py", line 57, in testPartExecutor\n    yield\n  File "./test_x.py", line 7, in test_a\n    self.assertEqual(1, 2)\nAssertionError: 1 != 2\n\nERROR: test_b (test_x.T)\nTraceback (most recent call last):\n  File "test_x.py", line 11, in test_b\n    raise ValueError("no")\nValueError: no\n'
assert.deepStrictEqual(parsePyProblems(two, f => f === 'test_x.py').map(p => p.line + ' ' + p.message), ['7 AssertionError: 1 != 2', '11 ValueError: no'])
assert.deepStrictEqual(parsePyProblems(tb, () => false), [], 'frames outside the workspace are not marked')
assert.deepStrictEqual(parsePyProblems('all good\n', () => true), [])

const usedTestPorts = new Set(); const freePort = () => new Promise((resolve, reject) => { const s = net.createServer(); s.once('error', reject); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(err => { if (err) return reject(err); if (usedTestPorts.has(p)) return resolve(freePort()); usedTestPorts.add(p); resolve(p) }) }) })
const wait = ms => new Promise(r => setTimeout(r, ms))
const until = async (fn, what, ms = 15000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await wait(60) } throw new Error('timed out waiting for: ' + what) }
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vespr-runs-'))
fs.writeFileSync(path.join(dir, 'tokens'), 'alice:tok-a\ncoder:tok-c\ncoder2:tok-d\n')
const PORT = await freePort(); const here = path.dirname(new URL(import.meta.url).pathname)
const srv = spawn('node', [path.join(here, '../../server/index.js')], { env: { ...process.env, MURMIO_PORT: PORT, MURMIO_DATA: dir, MURMIO_TOKENS_FILE: path.join(dir, 'tokens') }, stdio: 'ignore' })
let alice, agent, alice2, agent2, handler, handler2
try {
  await wait(800)
  const server = 'ws://127.0.0.1:' + PORT; const deps = { Y, WebsocketProvider, WebSocketPolyfill: WebSocket }
  alice = createClient({ server, room: 'r1', token: 'tok-a', name: 'alice', deps }); await alice.ready
  agent = joinRoom({ server, room: 'r1', token: 'tok-c', name: 'coder', color: '#5eead4', model: 'fake-model' }); await agent.ready
  agent.write('hello.py', "print('hi from hello')\n", 'seed')
  agent.write('boom.py', 'def go():\n    return 1 / 0\n\ngo()\n', 'seed')
  agent.write('slow.py', "import time\nprint('one')\ntime.sleep(1.5)\nprint('two')\n", 'seed')
  agent.write('test_x.py', 'import unittest\n\nclass T(unittest.TestCase):\n    def test_ok(self):\n        self.assertEqual(1, 1)\n    def test_bad(self):\n        self.assertEqual(1, 2)\n\nif __name__ == "__main__":\n    unittest.main()\n', 'seed')
  agent.write('notes.txt', 'not python\n', 'seed')
  handler = startRuns({ room: agent, getRunner: async () => new SandboxRunner({ root: path.join(dir, 'sandbox') }), enabled: true })
  await until(() => alice.get().runsEnabled, 'the app learns that runs are on')
  await until(() => alice.get().files.includes('slow.py') && alice.get().files.includes('test_x.py'), 'files arrive')

  // a file runs and its output comes back
  const id = alice.run('file', 'hello.py')
  const done = await until(() => alice.get().runs.find(r => r.id === id && r.status === 'done'), 'hello.py finished')
  assert.strictEqual(done.code, 0); assert.strictEqual(done.out, 'hi from hello\n'); assert.strictEqual(done.cmd, 'python3 hello.py'); assert.strictEqual(done.by, 'alice'); assert.deepStrictEqual(alice.get().problems, [])

  // output streams while it runs
  const sid = alice.run('file', 'slow.py')
  await until(() => { const r = alice.get().runs.find(x => x.id === sid); return r && r.status === 'running' && r.out.includes('one') && !r.out.includes('two') }, 'the first line shows up while the run is still going')
  const sdone = await until(() => alice.get().runs.find(r => r.id === sid && r.status === 'done'), 'slow.py finished'); assert.ok(sdone.out.includes('two'))

  // a failing run: non-zero exit, the traceback, and the problem marked on the right file and line
  const bid = alice.run('file', 'boom.py')
  const bdone = await until(() => alice.get().runs.find(r => r.id === bid && r.status === 'done'), 'boom.py finished')
  assert.notStrictEqual(bdone.code, 0); assert.match(bdone.out, /ZeroDivisionError/)
  assert.deepStrictEqual(alice.get().problems.map(p => p.file + ':' + p.line), ['boom.py:2'])
  // a later run that passes clears the problems
  const hid = alice.run('file', 'hello.py'); await until(() => alice.get().runs.find(r => r.id === hid && r.status === 'done'), 'hello again'); assert.deepStrictEqual(alice.get().problems, [])

  // the tests: both outcomes are in the output and the failing line is marked
  const tid = alice.run('tests')
  const tdone = await until(() => alice.get().runs.find(r => r.id === tid && r.status === 'done'), 'tests finished')
  assert.notStrictEqual(tdone.code, 0); assert.match(tdone.out, /test_ok .*ok/); assert.match(tdone.out, /FAIL: test_bad/)
  assert.deepStrictEqual(alice.get().problems.map(p => p.file + ':' + p.line), ['test_x.py:7'])

  // only what the app can ask for: anything else is refused, with a reason
  for (const [kind, file, why] of [['file', '../etc/passwd', /not a Python file/], ['file', 'missing.py', /not in this workspace/], ['file', 'notes.txt', /not a Python file/], ['file', 'hello.py; ls', /not a Python file/]]) {
    const did = alice.run(kind, file); const d = await until(() => alice.get().runs.find(r => r.id === did && r.status === 'denied'), 'denied: ' + file); assert.match(d.out, why)
  }
  assert.throws(() => alice.run('shell', 'hello.py'), /kind must be/)

  // the run shows in History
  assert.ok(alice.history().some(h => h.type === 'run' && h.who === 'alice' && h.target === 'python3 hello.py' && /exit 0/.test(h.detail)))
  assert.ok(alice.get().runs.length <= 30)

  // switched off (the default): the app is told, and a request is refused
  alice2 = createClient({ server, room: 'r2', token: 'tok-a', name: 'alice', deps }); await alice2.ready
  agent2 = joinRoom({ server, room: 'r2', token: 'tok-d', name: 'coder2', color: '#5eead4', model: 'fake-model' }); await agent2.ready
  agent2.write('hello.py', "print('x')\n", 'seed')
  handler2 = startRuns({ room: agent2, getRunner: async () => new SandboxRunner({ root: path.join(dir, 'sandbox2') }) })
  await until(() => alice2.get().files.includes('hello.py') && alice2.get().status === 'connected' && alice2.get().people.some(p => p.isAgent), 'second room is ready')
  assert.strictEqual(alice2.get().runsEnabled, false)
  const off = alice2.run('file', 'hello.py'); const offDone = await until(() => alice2.get().runs.find(r => r.id === off && r.status === 'denied'), 'refused when off'); assert.match(offDone.out, /switched off/)
  console.log('runs tests passed: run, stream, failure and problems, tests, refusals, history, off by default')
} finally {
  for (const x of [handler, handler2]) try { x && x.stop() } catch {}
  for (const x of [alice, alice2]) try { x && x.destroy && x.destroy() } catch {}
  for (const x of [agent, agent2]) try { x && x.destroy() } catch {}
  srv.kill(); fs.rmSync(dir, { recursive: true, force: true }); setTimeout(() => process.exit(0), 200)
}
