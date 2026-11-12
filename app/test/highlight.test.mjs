import assert from 'node:assert'
import {
  MAX_CODE_LEN,
  MAX_LINE_LEN,
  escapeHtml,
  isKeyword,
  tokenize,
  highlight,
  highlightLines
} from '../highlight.js'

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
  assert.strictEqual(MAX_CODE_LEN, 100000)
  assert.strictEqual(MAX_LINE_LEN, 2000)
})

t('escapeHtml encodes special HTML characters to prevent XSS', () => {
  assert.strictEqual(escapeHtml('<script>alert("test") & \'x\'</script>'), '&lt;script&gt;alert(&quot;test&quot;) &amp; &#39;x&#39;&lt;/script&gt;')
  assert.strictEqual(escapeHtml(null), '')
  assert.strictEqual(escapeHtml(123), '')
})

t('isKeyword recognizes language keywords', () => {
  assert.strictEqual(isKeyword('def'), true)
  assert.strictEqual(isKeyword('return'), true)
  assert.strictEqual(isKeyword('const'), true)
  assert.strictEqual(isKeyword('async'), true)
  assert.strictEqual(isKeyword('interface'), true)
  assert.strictEqual(isKeyword('myVariable'), false)
  assert.strictEqual(isKeyword(null), false)
})

t('tokenize extracts comments accurately', () => {
  const pyTokens = tokenize('# Python comment\nx = 10')
  assert.strictEqual(pyTokens[0].type, 'comment')
  assert.strictEqual(pyTokens[0].text, '# Python comment')

  const jsTokens = tokenize('let a = 1 // JS comment')
  const commentTok = jsTokens.find(t => t.type === 'comment')
  assert.ok(commentTok)
  assert.strictEqual(commentTok.text, '// JS comment')
})

t('tokenize extracts string literals across quote styles', () => {
  const tokens = tokenize('const s1 = "double"; const s2 = \'single\'; const s3 = `backtick`')
  const strings = tokens.filter(t => t.type === 'string')
  assert.strictEqual(strings.length, 3)
  assert.strictEqual(strings[0].text, '"double"')
  assert.strictEqual(strings[1].text, '\'single\'')
  assert.strictEqual(strings[2].text, '`backtick`')
})

t('tokenize extracts integers and decimal numbers', () => {
  const tokens = tokenize('x = 42; y = 3.1415')
  const nums = tokens.filter(t => t.type === 'number')
  assert.strictEqual(nums.length, 2)
  assert.strictEqual(nums[0].text, '42')
  assert.strictEqual(nums[1].text, '3.1415')
})

t('tokenize distinguishes identifiers with digits from raw numbers', () => {
  const tokens = tokenize('const item1 = 100')
  const nums = tokens.filter(t => t.type === 'number')
  assert.strictEqual(nums.length, 1)
  assert.strictEqual(nums[0].text, '100')

  const idTok = tokens.find(t => t.text === 'item1')
  assert.strictEqual(idTok.type, 'text')
})

t('tokenize identifies function definitions and function calls', () => {
  const defTokens = tokenize('def calculate_total(items):')
  const fnTok = defTokens.find(t => t.type === 'function')
  assert.ok(fnTok)
  assert.strictEqual(fnTok.text, 'calculate_total')

  const callTokens = tokenize('const res = print(message)')
  const callTok = callTokens.find(t => t.type === 'function')
  assert.ok(callTok)
  assert.strictEqual(callTok.text, 'print')
})

t('highlight renders HTML spans matching CSS rules', () => {
  const code = 'def total():\n    return 42'
  const html = highlight(code)
  assert.ok(html.includes('<span class="k">def</span>'))
  assert.ok(html.includes('<span class="f">total</span>'))
  assert.ok(html.includes('<span class="k">return</span>'))
  assert.ok(html.includes('<span class="n">42</span>'))
})

t('highlight escapes HTML embedded within string literals', () => {
  const code = 'const tag = "<div>hello</div>"'
  const html = highlight(code)
  assert.ok(html.includes('<span class="s">&quot;&lt;div&gt;hello&lt;/div&gt;&quot;</span>'))
  assert.ok(!html.includes('<div>'))
})

t('highlightLines splits and highlights individual lines', () => {
  const code = 'line1 = 10\nline2 = 20\nline3 = 30'
  const lines = highlightLines(code)
  assert.strictEqual(lines.length, 3)
  assert.ok(lines[0].includes('<span class="n">10</span>'))
  assert.ok(lines[1].includes('<span class="n">20</span>'))
  assert.ok(lines[2].includes('<span class="n">30</span>'))
})

t('hostile input immunity for all highlight functions', () => {
  assert.strictEqual(highlight(null), '')
  assert.strictEqual(highlight(undefined), '')
  assert.strictEqual(highlight(12345), '')
  assert.strictEqual(highlight(''), '')
  assert.deepStrictEqual(tokenize(null), [])
  assert.deepStrictEqual(highlightLines(null), [])
})

console.log('highlight tests passed (' + n + ')')