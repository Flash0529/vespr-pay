import assert from 'node:assert'
import {
  MAX_LINES,
  MAX_LINE_CHARS,
  DEFAULT_MAX_PERCENT,
  DEFAULT_SCALE,
  MAX_BARS,
  lineWidthPercent,
  computeLines,
  sampleLines,
  renderMinimapHtml,
  viewportSlider
} from '../minimap.js'

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
  assert.strictEqual(MAX_LINES, 10000)
  assert.strictEqual(MAX_LINE_CHARS, 1000)
  assert.strictEqual(DEFAULT_MAX_PERCENT, 100)
  assert.strictEqual(DEFAULT_SCALE, 2.2)
  assert.strictEqual(MAX_BARS, 120)
})

t('lineWidthPercent returns 0 for empty and whitespace-only lines', () => {
  assert.strictEqual(lineWidthPercent(''), 0)
  assert.strictEqual(lineWidthPercent('   '), 0)
  assert.strictEqual(lineWidthPercent('\t\t'), 0)
  assert.strictEqual(lineWidthPercent(null), 0)
})

t('lineWidthPercent calculates proportional width based on character length', () => {
  const line = 'def total():' // length 12
  const w = lineWidthPercent(line)
  assert.strictEqual(w, Math.round(12 * DEFAULT_SCALE)) // 26%
})

t('lineWidthPercent clamps to maxPercent', () => {
  const longLine = 'x = 100; '.repeat(30) // length 270
  const w = lineWidthPercent(longLine)
  assert.strictEqual(w, 100)
})

t('lineWidthPercent strips HTML tags before calculating length', () => {
  const withHtml = '<span class="k">def</span> <span class="f">total</span>():'
  const plain = 'def total():'
  assert.strictEqual(lineWidthPercent(withHtml), lineWidthPercent(plain))
})

t('computeLines generates line density objects with line numbers', () => {
  const code = 'line 1\nline 2\n\nline 4'
  const items = computeLines(code)
  assert.strictEqual(items.length, 4)
  assert.strictEqual(items[0].line, 1)
  assert.strictEqual(items[2].line, 3)
  assert.strictEqual(items[2].width, 0) // blank line
  assert.strictEqual(items[3].line, 4)
})

t('computeLines associates diff status with modified lines', () => {
  const code = 'line 1\nline 2\nline 3'
  const diffs = [
    { line: 2, type: 'chg' },
    { line: 3, type: 'add' }
  ]
  const items = computeLines(code, diffs)
  assert.strictEqual(items[0].type, '')
  assert.strictEqual(items[1].type, 'chg')
  assert.strictEqual(items[2].type, 'add')
})

t('sampleLines downsamples line items into bounded buckets', () => {
  const items = Array.from({ length: 300 }, (_, i) => ({
    line: i + 1,
    width: (i % 20) * 4,
    type: i === 150 ? 'chg' : ''
  }))

  const sampled = sampleLines(items, 50)
  assert.strictEqual(sampled.length, 50)
  // Ensures changed line in bucket 25 is preserved
  const changedBucket = sampled.find(b => b.type === 'chg')
  assert.ok(changedBucket)
})

t('renderMinimapHtml renders styled HTML elements matching CSS rules', () => {
  const code = 'const x = 1\nconst y = 2'
  const html = renderMinimapHtml(code)
  assert.ok(html.includes('<i style="width:'))
  assert.strictEqual(html.split('<i').length - 1, 2)
})

t('renderMinimapHtml includes diff styling classes', () => {
  const code = 'line 1\nline 2\nline 3'
  const diffs = [
    { line: 1, type: 'del' },
    { line: 2, type: 'chg' },
    { line: 3, type: 'add' }
  ]
  const html = renderMinimapHtml(code, diffs)
  assert.ok(html.includes('class="del"'))
  assert.ok(html.includes('class="chg"'))
  assert.ok(html.includes('class="add"'))
})

t('viewportSlider calculates proportional slider position and height', () => {
  const slider = viewportSlider(100, 20, 25)
  assert.strictEqual(slider.topPercent, 19) // (20 - 1) / 100 * 100 = 19%
  assert.strictEqual(slider.heightPercent, 25) // 25 / 100 * 100 = 25%
})

t('viewportSlider prevents slider from overflowing bounds', () => {
  const slider = viewportSlider(100, 95, 20)
  assert.strictEqual(slider.heightPercent, 20)
  assert.strictEqual(slider.topPercent, 80) // 100 - 20 = 80
})

t('hostile input immunity for all minimap functions', () => {
  assert.strictEqual(lineWidthPercent(null), 0)
  assert.deepStrictEqual(computeLines(null), [])
  assert.deepStrictEqual(sampleLines(null), [])
  assert.strictEqual(renderMinimapHtml(null), '')
  assert.deepStrictEqual(viewportSlider(0, 0, 0), { topPercent: 0, heightPercent: 100 })
})

console.log('minimap tests passed (' + n + ')')