import { test, describe } from 'node:test'
import assert from 'node:assert'
import * as Y from 'yjs'
import { generateWakeMessage, shouldWake, wakeAgent } from '../src/wake.js'

describe('Agent Wake & Kickoff Prompts', () => {
  test('generateWakeMessage on empty workspace offers scaffolding', () => {
    const res = generateWakeMessage({ name: 'coder', files: [], read: () => '' })
    assert.strictEqual(res.project.stack, 'unknown')
    assert.ok(res.text.includes('@coder'))
    assert.ok(res.text.includes('is active and connected'))
    assert.ok(res.text.includes('The workspace is currently empty'))
    assert.ok(res.text.includes('Scaffold a new React / Vite frontend'))
  })

  test('generateWakeMessage detects Node/Vite project and adds chips', () => {
    const files = ['package.json', 'src/App.jsx', 'vite.config.js']
    const read = f => f === 'package.json' ? JSON.stringify({ name: 'my-app', scripts: { dev: 'vite', test: 'vitest' }, dependencies: { vite: '^5.0.0' } }) : ''
    const res = generateWakeMessage({ name: 'coder', files, read })

    assert.strictEqual(res.project.stack, 'vite')
    assert.ok(res.text.includes('detected **VITE** infrastructure'))
    assert.ok(res.text.includes('npm test'))
    assert.ok(res.chips.some(c => c.includes('Run test suite')))
    assert.ok(res.chips.some(c => c.includes('Start dev preview')))
  })

  test('generateWakeMessage detects Python/FastAPI project and adds chips', () => {
    const files = ['requirements.txt', 'main.py']
    const read = f => f === 'requirements.txt' ? 'fastapi\nuvicorn\npytest\n' : ''
    const res = generateWakeMessage({ name: 'architect', files, read })

    assert.strictEqual(res.project.stack, 'fastapi')
    assert.ok(res.text.includes('detected **FASTAPI** infrastructure'))
    assert.ok(res.text.includes('pytest'))
    assert.ok(res.chips.some(c => c.includes('Run test suite')))
  })

  test('shouldWake obeys VESPR_AGENT_WAKE flag and deduplication', () => {
    const doc = new Y.Doc()
    const handled = doc.getMap('handled')
    const chat = doc.getArray('chat')
    const room = { handled, chat }

    // Enabled
    assert.strictEqual(shouldWake({ room, name: 'coder', wakeFlag: '1' }), true)

    // Disabled explicitly
    assert.strictEqual(shouldWake({ room, name: 'coder', wakeFlag: '0' }), false)
    assert.strictEqual(shouldWake({ room, name: 'coder', wakeFlag: 'false' }), false)

    // Handled map recorded
    handled.set('wake:coder', Date.now())
    assert.strictEqual(shouldWake({ room, name: 'coder', wakeFlag: '1' }), false)
  })

  test('shouldWake detects existing wake in room chat', () => {
    const doc = new Y.Doc()
    const handled = doc.getMap('handled')
    const chat = doc.getArray('chat')

    const m = new Y.Map()
    const tx = new Y.Text()
    tx.insert(0, '👋 Hello! **@coder** is active and connected to this workspace.')
    m.set('author', 'coder')
    m.set('isAgent', true)
    m.set('text', tx)
    chat.push([m])

    const room = { handled, chat }
    assert.strictEqual(shouldWake({ room, name: 'coder', wakeFlag: '1' }), false)
  })

  test('wakeAgent sends message via room.say and marks handled', async () => {
    const doc = new Y.Doc()
    const handled = doc.getMap('handled')
    const chat = doc.getArray('chat')
    let said = ''
    const room = {
      handled,
      chat,
      list: () => ['package.json'],
      read: () => JSON.stringify({ name: 'sample', scripts: { test: 'jest' } }),
      say: text => { said = text }
    }

    const res = await wakeAgent({ room, name: 'bot', wakeFlag: '1' })
    assert.ok(res)
    assert.ok(said.includes('@bot'))
    assert.ok(said.includes('is active and connected'))
    assert.ok(handled.has('wake:bot'))

    // Second call is a no-op
    const res2 = await wakeAgent({ room, name: 'bot', wakeFlag: '1' })
    assert.strictEqual(res2, null)
  })
})
