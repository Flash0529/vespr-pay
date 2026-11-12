import assert from 'node:assert'
import {
  MAX_TERM_LINES,
  MAX_LINE_CHARS,
  MAX_PARSED_ERRORS,
  stripAnsi,
  ansiToHtml,
  parseErrors,
  createTermBuffer
} from '../termoutput.js'

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

t('constants exist and have expected bounds', () => {
  assert.strictEqual(MAX_TERM_LINES, 1000)
  assert.strictEqual(MAX_LINE_CHARS, 2000)
  assert.strictEqual(MAX_PARSED_ERRORS, 50)
})

t('stripAnsi removes escape codes and normalizes newlines', () => {
  const colored = '\u001b[31mError:\u001b[0m test failed\r\nline 2\rline 3\u0000'
  const plain = stripAnsi(colored)
  assert.strictEqual(plain, 'Error: test failed\nline 2\nline 3')
})

t('ansiToHtml converts ANSI color codes into safe styled HTML spans', () => {
  const redText = '\u001b[31mFAIL\u001b[0m: test failed'
  const html = ansiToHtml(redText)
  assert.ok(html.includes('<span style="color:var(--bad);">FAIL</span>'))
  assert.ok(html.includes(': test failed'))
})

t('ansiToHtml escapes embedded HTML tags to prevent XSS', () => {
  const injection = '\u001b[32m<script>alert("xss")</script>\u001b[0m'
  const html = ansiToHtml(injection)
  assert.ok(html.includes('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'))
  assert.ok(!html.includes('<script>'))
})

t('parseErrors extracts Python traceback location and message', () => {
  const output = `Traceback (most recent call last):
  File "cart.py", line 12, in total
    raise ValueError("negative price")
ValueError: negative price
`
  const errs = parseErrors(output)
  assert.strictEqual(errs.length, 1)
  assert.strictEqual(errs[0].file, 'cart.py')
  assert.strictEqual(errs[0].line, 12)
  assert.strictEqual(errs[0].severity, 'error')
  assert.ok(errs[0].message.includes('ValueError: negative price'))
})

t('parseErrors extracts Python unittest failures', () => {
  const output = 'FAIL: test_discount (test_cart.py:15)\nAssertionError: 90 != 10\n'
  const errs = parseErrors(output)
  assert.strictEqual(errs.length, 1)
  assert.strictEqual(errs[0].file, 'test_cart.py')
  assert.strictEqual(errs[0].line, 15)
  assert.strictEqual(errs[0].message, 'FAIL: test_discount')
})

t('parseErrors extracts Node.js stack trace locations', () => {
  const output = `TypeError: Cannot read properties of null
    at Object.calculate (app/cart.js:24:18)
    at test (app/test/cart.test.mjs:10:5)
`
  const errs = parseErrors(output)
  assert.ok(errs.length >= 1)
  assert.strictEqual(errs[0].file, 'app/cart.js')
  assert.strictEqual(errs[0].line, 24)
  assert.strictEqual(errs[0].col, 18)
})

t('parseErrors extracts standard C/C++ compiler errors', () => {
  const output = 'src/native.c:42:10: error: use of undeclared identifier \'ptr\''
  const errs = parseErrors(output)
  assert.strictEqual(errs.length, 1)
  assert.strictEqual(errs[0].file, 'src/native.c')
  assert.strictEqual(errs[0].line, 42)
  assert.strictEqual(errs[0].col, 10)
  assert.strictEqual(errs[0].severity, 'error')
  assert.ok(errs[0].message.includes('undeclared identifier'))
})

t('createTermBuffer maintains rolling buffer within limit', () => {
  const buf = createTermBuffer({ maxLines: 5 })
  buf.append('line 1\nline 2\nline 3')
  assert.strictEqual(buf.lines().length, 3)

  buf.append('line 4\nline 5\nline 6\nline 7')
  assert.strictEqual(buf.lines().length, 5)
  assert.strictEqual(buf.lines()[0], 'line 3')
  assert.strictEqual(buf.lines()[4], 'line 7')
})

t('createTermBuffer tail returns last N lines', () => {
  const buf = createTermBuffer({ maxLines: 20 })
  buf.append('a\nb\nc\nd\ne')
  assert.strictEqual(buf.tail(2), 'd\ne')
})

t('createTermBuffer summary provides totals and error indicators', () => {
  const buf = createTermBuffer()
  buf.append('all green\nall ok')
  assert.strictEqual(buf.summary().hasErrors, false)

  buf.append('FAIL: test_cart (test_cart.py:10)')
  assert.strictEqual(buf.summary().hasErrors, true)
  assert.strictEqual(buf.summary().errorCount, 1)
})

t('hostile input immunity for all termoutput functions', () => {
  assert.strictEqual(stripAnsi(null), '')
  assert.strictEqual(ansiToHtml(null), '')
  assert.deepStrictEqual(parseErrors(null), [])

  const buf = createTermBuffer(null)
  assert.strictEqual(buf.append(null), 0)
  assert.strictEqual(buf.clear(), 0)
  assert.deepStrictEqual(buf.lines(), [])
})

console.log('termoutput tests passed (' + n + ')')