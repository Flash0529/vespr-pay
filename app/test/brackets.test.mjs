import assert from 'node:assert'
import {
  MAX_SCAN_LEN,
  OPEN_BRACKETS,
  CLOSE_BRACKETS,
  AUTO_CLOSE_PAIRS,
  isBracket,
  getAutoCloseChar,
  wrapWithPair,
  findMatchingBracket,
  checkBalance
} from '../brackets.js'

let n = 0
const t = (name, fn) => {
  try {
    fn()
    n++
  } catch (e) {
    console.error('FAILED: ' + name)
    throw e
  }
}

// 1. Constants
t('exports safe bracket and auto-close constants', () => {
  assert.strictEqual(MAX_SCAN_LEN, 200000)
  assert.deepStrictEqual(OPEN_BRACKETS, { '(': ')', '[': ']', '{': '}' })
  assert.deepStrictEqual(CLOSE_BRACKETS, { ')': '(', ']': '[', '}': '{' })
  assert.strictEqual(AUTO_CLOSE_PAIRS['('], ')')
  assert.strictEqual(AUTO_CLOSE_PAIRS['"'], '"')
})

// 2. isBracket
t('identifies brackets and rejects non-brackets', () => {
  assert.strictEqual(isBracket('('), true)
  assert.strictEqual(isBracket(')'), true)
  assert.strictEqual(isBracket('['), true)
  assert.strictEqual(isBracket(']'), true)
  assert.strictEqual(isBracket('{'), true)
  assert.strictEqual(isBracket('}'), true)
  assert.strictEqual(isBracket('a'), false)
  assert.strictEqual(isBracket(''), false)
  assert.strictEqual(isBracket(null), false)
})

// 3. getAutoCloseChar
t('retrieves auto-close pair counterparts', () => {
  assert.strictEqual(getAutoCloseChar('('), ')')
  assert.strictEqual(getAutoCloseChar('['), ']')
  assert.strictEqual(getAutoCloseChar('{'), '}')
  assert.strictEqual(getAutoCloseChar('"'), '"')
  assert.strictEqual(getAutoCloseChar("'"), "'")
  assert.strictEqual(getAutoCloseChar('`'), '`')
  assert.strictEqual(getAutoCloseChar(')'), null)
  assert.strictEqual(getAutoCloseChar('x'), null)
})

// 4. wrapWithPair
t('wraps selected text with matching pair', () => {
  assert.strictEqual(wrapWithPair('hello', '('), '(hello)')
  assert.strictEqual(wrapWithPair('items', '['), '[items]')
  assert.strictEqual(wrapWithPair('foo', '{'), '{foo}')
  assert.strictEqual(wrapWithPair('text', '"'), '"text"')
  assert.strictEqual(wrapWithPair('plain', 'x'), 'plain')
  assert.strictEqual(wrapWithPair(null, '('), '()')
})

// 5. findMatchingBracket forward
t('finds matching closing bracket forward across nested structures', () => {
  const code = 'function test(a, b) { if (a > 0) { return [a, b]; } }'
  // '(' at index 13: test(
  const m1 = findMatchingBracket(code, 13)
  assert.ok(m1)
  assert.strictEqual(m1.openOffset, 13)
  assert.strictEqual(m1.closeOffset, 18)
  assert.strictEqual(m1.pair, '()')

  // '{' at index 20
  const m2 = findMatchingBracket(code, 20)
  assert.ok(m2)
  assert.strictEqual(m2.openOffset, 20)
  assert.strictEqual(m2.closeOffset, code.length - 1)
  assert.strictEqual(m2.pair, '{}')
})

// 6. findMatchingBracket backward
t('finds matching opening bracket backward from closing bracket', () => {
  const code = 'const arr = [1, [2, 3], 4];'
  // Outer closing bracket ']' at index 25
  const mOuter = findMatchingBracket(code, 25)
  assert.ok(mOuter)
  assert.strictEqual(mOuter.openOffset, 12)
  assert.strictEqual(mOuter.closeOffset, 25)
  assert.strictEqual(mOuter.pair, '[]')

  // Inner closing bracket ']' at index 21
  const mInner = findMatchingBracket(code, 21)
  assert.ok(mInner)
  assert.strictEqual(mInner.openOffset, 16)
  assert.strictEqual(mInner.closeOffset, 21)
})

// 7. findMatchingBracket string and comment skipping
t('ignores brackets inside string literals and comments', () => {
  const code = 'const s = "{ not a bracket }"; // [comment]\nconst x = { ok: 1 };'
  const openBrace = code.indexOf('{ ok')
  const m = findMatchingBracket(code, openBrace)
  assert.ok(m)
  assert.strictEqual(m.openOffset, openBrace)
  assert.strictEqual(m.closeOffset, code.indexOf('};'))
})

// 8. findMatchingBracket offset tolerance
t('matches bracket when cursor is positioned directly after it', () => {
  const code = 'foo()'
  // Offset 4 is right after ')'
  const m = findMatchingBracket(code, 4)
  assert.ok(m)
  assert.strictEqual(m.openOffset, 3)
  assert.strictEqual(m.closeOffset, 4)
})

// 9. checkBalance on valid code
t('returns balanced true for balanced code', () => {
  const code = `
    function sum(items) {
      let total = 0;
      for (const x of items) {
        total += x;
      }
      return [total];
    }
  `
  const res = checkBalance(code)
  assert.strictEqual(res.balanced, true)
  assert.strictEqual(res.issues.length, 0)
})

// 10. checkBalance on unexpected closing bracket
t('detects unexpected closing bracket with accurate line and col', () => {
  const code = 'function test() }\n'
  const res = checkBalance(code)
  assert.strictEqual(res.balanced, false)
  assert.strictEqual(res.issues.length, 1)
  assert.strictEqual(res.issues[0].found, '}')
  assert.strictEqual(res.issues[0].expected, null)
  assert.strictEqual(res.issues[0].line, 1)
  assert.strictEqual(res.issues[0].col, 17)
})

// 11. checkBalance on mismatched closing bracket
t('detects mismatched bracket types (e.g. { closed by ])', () => {
  const code = 'const data = { items: [1, 2} ];'
  const res = checkBalance(code)
  assert.strictEqual(res.balanced, false)
  assert.ok(res.issues.length > 0)
  const mismatch = res.issues.find(i => i.found === '}')
  assert.ok(mismatch)
  assert.strictEqual(mismatch.expected, ']')
})

// 12. checkBalance on unclosed opening brackets
t('detects unclosed opening brackets at end of file', () => {
  const code = 'function unclosed() {\n  const x = [1, 2;\n'
  const res = checkBalance(code)
  assert.strictEqual(res.balanced, false)
  assert.strictEqual(res.issues.length, 2) // unclosed [ and unclosed {
  assert.ok(res.issues.some(i => i.expected === ']'))
  assert.ok(res.issues.some(i => i.expected === '}'))
})

console.log('brackets tests passed (' + n + ')')
