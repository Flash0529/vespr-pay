import assert from 'node:assert'
import { createHash } from 'node:crypto'
import { sha256Hex, sha256Bytes } from '../sha256.js'
const ref = s => createHash('sha256').update(s).digest('hex')
for (const s of ['', 'abc', 'The quick brown fox jumps over the lazy dog', 'a'.repeat(55), 'a'.repeat(56), 'a'.repeat(63), 'a'.repeat(64), 'a'.repeat(1000), 'héllo wörld ✓ 日本語']) {
  assert.strictEqual(sha256Bytes(new TextEncoder().encode(s)), ref(s), 'fallback matches for ' + s.slice(0, 12) + '(' + s.length + ')')
  assert.strictEqual(await sha256Hex(s), ref(s), 'WebCrypto path matches')
}
const saved = Object.getOwnPropertyDescriptor(globalThis, 'crypto'); Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true })
assert.strictEqual(await sha256Hex('abc'), ref('abc'), 'plain-http page: no crypto at all')
Object.defineProperty(globalThis, 'crypto', { value: {}, configurable: true }); assert.strictEqual(await sha256Hex('abc'), ref('abc'), 'crypto without subtle')
if (saved) Object.defineProperty(globalThis, 'crypto', saved)
console.log('sha256 tests passed')
