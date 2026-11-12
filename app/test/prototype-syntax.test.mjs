// Every inline script in prototype.html must parse. String-level tests can pass while the page is broken (a trailing comment once swallowed a closing parenthesis: 2026-11-11).
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const html = readFileSync(new URL('../prototype.html', import.meta.url), 'utf8')

test('every inline script of the app shell parses', () => {
  const dir = mkdtempSync(join(tmpdir(), 'proto-syntax-'))
  try {
    let n = 0; const bad = []
    for (const m of html.matchAll(/<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/g)) {
      const attrs = m[1]; if (/importmap|json/.test(attrs)) continue
      const f = join(dir, 'inline-' + (++n) + (/module/.test(attrs) ? '.mjs' : '.js')); writeFileSync(f, m[2])
      const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' })
      if (r.status !== 0) bad.push(n + ': ' + r.stderr.split('\n').slice(0, 4).join(' | '))
    }
    assert.ok(n >= 1, 'found the inline scripts')
    assert.deepEqual(bad, [])
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
