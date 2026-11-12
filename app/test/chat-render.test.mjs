// The conversation renderer: Markdown, hand-over markers, work boxes. Run: node app/test/chat-render.test.mjs
import assert from 'node:assert'
import { renderMarkdown, groupWork, summarizeWork, workBox, fileKind, humanSize, esc, formatDuration, stepTime, planView, planBox, limitCard, usagePanel, money } from '../chat-render.js'

const md = (s, h = {}) => renderMarkdown(s, h)
// plain text, soft breaks, escaping
assert.strictEqual(md('hello\nworld'), '<p>hello<br>world</p>')
assert.strictEqual(md('<script>alert(1)</script>'), '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>')
assert.ok(!/<img|<script|href="javascript/i.test(md('<img src=x onerror=alert(1)> ![x](javascript:alert(1)) [a](javascript:alert(1))')), 'no live html, no javascript: links (the word onerror stays as harmless escaped text)')
assert.ok(!/href="javascript/i.test(md('[a](javascript:alert(1))')))
// inline
assert.strictEqual(md('a **bold** and *it* and `x < y` and ~~gone~~'), '<p>a <strong>bold</strong> and <em>it</em> and <code>x &lt; y</code> and <del>gone</del></p>')
assert.strictEqual(md('snake_case_name and 2*3*4'), '<p>snake_case_name and 2*3*4</p>', 'underscores inside words and spaced stars are not italics')
assert.match(md('see [the docs](https://example.com/a?b=1&c=2) now'), /<a href="https:\/\/example\.com\/a\?b=1&amp;c=2" target="_blank" rel="noopener noreferrer">the docs<\/a>/)
assert.match(md('go to https://example.com/x.'), /<a href="https:\/\/example\.com\/x"[^>]*>https:\/\/example\.com\/x<\/a>\.<\/p>/)
// code blocks: highlighted through the hook, copy button, no markdown inside, a fence still open while streaming
const c = md('Here:\n```python\ndef f():\n    return "**not bold**"\n```\ndone')
assert.match(c, /<div class="mdcode">.*mdlang">python<.*data-copy/s); assert.ok(!c.includes('<strong>')); assert.match(c, /<p>Here:<\/p>.*<p>done<\/p>/s)
assert.match(md('```js\nlet a = 1', {}), /mdcode.*let a = 1/s, 'an unclosed fence is shown as code')
assert.match(md('```x\n1\n```', { highlight: () => '<span class="k">HL</span>' }), /<code><span class="k">HL<\/span><\/code>/)
assert.match(md('```\n<b>x</b>\n```'), /&lt;b&gt;x&lt;\/b&gt;/)
// link attributes from the shell (a running app's preview opens in the browser pane)
assert.match(md('see https://x.example/preview/0123456789abcdef01234567/ now', { linkAttrs: u => /\/preview\//.test(u) ? ' data-preview="1"' : '' }), /<a href="https:\/\/x\.example\/preview\/0123456789abcdef01234567\/" target="_blank" rel="noopener noreferrer" data-preview="1">/)
assert.match(md('[app](https://x.example/preview/0123456789abcdef01234567/)', { linkAttrs: () => ' data-preview="1"' }), /data-preview="1">app<\/a>/)
assert.ok(!md('[a](https://e.com)').includes('data-preview'))
// headings, rules, quotes
assert.match(md('# One\n## Two'), /<h3 class="mdh">One<\/h3><h4 class="mdh">Two<\/h4>/)
assert.strictEqual(md('---'), '<hr>'); assert.strictEqual(md('> a\n> b'), '<blockquote>a<br>b</blockquote>')
// lists, nested and ordered
assert.strictEqual(md('- a\n- b'), '<ul><li>a</li><li>b</li></ul>')
assert.strictEqual(md('1. a\n2. b'), '<ol><li>a</li><li>b</li></ol>')
assert.strictEqual(md('- a\n  - b\n- c'), '<ul><li>a<ul><li>b</li></ul></li><li>c</li></ul>')
assert.strictEqual(md('Steps:\n- a\n- b\n\nAfter'), '<p>Steps:</p><ul><li>a</li><li>b</li></ul><p>After</p>')
// tables
const t = md('| Name | Qty |\n|---|--:|\n| apple | 3 |\n| pear | 10 |')
assert.match(t, /<th>Name<\/th><th style="text-align:right">Qty<\/th>/); assert.match(t, /<td>apple<\/td><td style="text-align:right">3<\/td>/); assert.match(t, /<td>pear<\/td>/)
assert.ok(!/<table/.test(md('a | b\nnot a table')))
// markers go to the hooks, block ones stand alone, unknown ones stay text
const seen = []; const hooks = { marker: (k, a, o) => { seen.push([k, a, o]); return k === 'file' ? `<span class="filechip">${esc(a)}</span>` : `<div class="fcard">${esc(a)}</div>` }, attached: a => `<div class="fcard">${esc(a.name)}</div>` }
assert.strictEqual(md('Open {{file:cart.py}} first', hooks), '<p>Open <span class="filechip">cart.py</span> first</p>')
assert.strictEqual(md('{{card:report.pdf}}', hooks), '<div class="fcard">report.pdf</div>')
assert.strictEqual(md('Result:\n\n{{image:chart.png|big}}\n\nMore', hooks).replace(/<\/?p>/g, '|'), '|Result:|<div class="fcard">chart.png</div>|More|')
assert.deepStrictEqual(seen.slice(-1)[0], ['image', 'chart.png', 'big'])
assert.strictEqual(md('{{artifact:dashboard.html|html}}', hooks), '<div class="fcard">dashboard.html</div>')
assert.deepStrictEqual(seen.slice(-1)[0], ['artifact', 'dashboard.html', 'html'])
assert.strictEqual(md('[attached: a.png 2048 id=0123456789abcdef]', hooks), '<div class="fcard">a.png</div>')
assert.strictEqual(md('{{nope:x}}'), '<p>{{nope:x}}</p>')
assert.ok(!md('{{file:<b>x</b>}}', {}).includes('<b>'), 'markers without hooks are shown as text, escaped')
// a placeholder byte typed by someone cannot reach the stash
assert.ok(!md('a\u00000\u0000b', hooks).includes('\u0000'))

// work boxes
const step = (id, text, ts, extra = {}) => ({ r: 'work', id, ts, text, ok: true, ...extra })
const now = 1_000_000
let items = [{ r: 'me', t: 'x' }, step('a', 'read cart.py', now - 5000), step('b', '$ python3 -m unittest -q', now - 2000), step('c', 'edited cart.py (line 11)', now - 1000)]
let g = groupWork(items, { now })
assert.strictEqual(g.length, 2); assert.strictEqual(g[1].r, 'workgroup'); assert.strictEqual(g[1].steps.length, 3); assert.strictEqual(g[1].live, true)
assert.strictEqual(groupWork(items, { now: now + 120000 })[1].live, false, 'old steps are not live')
assert.strictEqual(groupWork(items, { now: now + 120000, busy: true })[1].live, true)
g = groupWork([...items, { r: 'agent', t: 'done' }], { now }); assert.strictEqual(g[1].live, false, 'a reply after the steps ends the live state'); assert.strictEqual(g.length, 3)
g = groupWork([step('a', 'x', 1), { r: 'ask' }, step('b', 'y', 2)], { now }); assert.deepStrictEqual(g.map(x => x.r), ['workgroup', 'ask', 'workgroup'], 'an approval card splits the groups')
assert.strictEqual(summarizeWork([step('a', '$ a', 1), step('b', '$ b', 2)]), 'Ran 2 commands')
assert.strictEqual(summarizeWork([step('a', '$ a', 1)]), 'Ran 1 command')
assert.strictEqual(summarizeWork([step('a', 'read a', 1), step('b', 'read b', 2)]), 'Read 2 files')
assert.strictEqual(summarizeWork([step('a', 'read a', 1), step('b', '$ b', 2, { ok: false })]), 'Read a, ran 1 command, 1 failed')
assert.strictEqual(summarizeWork([step('a', 'Editing cart.py', 1), step('b', 'Editing cart.py', 2), step('c', '$ npm test', 3), step('d', 'Writing VESPR-FILES-DRAFT.md', 4)]), 'Edited cart.py, ran 1 command, wrote VESPR-FILES-DRAFT.md', 'one file named')
assert.strictEqual(summarizeWork([step('a', 'Reading a.py', 1), step('b', 'Reading b.py', 2), step('c', 'Searching the web: x', 3), step('d', 'Searching the web: y', 4), step('e', 'Using zoom', 5)]), 'Read 2 files, searched the web 2 times, 1 other step')
assert.strictEqual(summarizeWork([]), 'No steps')
const live = workBox(groupWork(items, { now })[1], { who: 'coder', ic: n => `<i>${n}</i>` })
assert.match(live, /class="wbox busy"/); assert.match(live, /<b>coder is working<\/b><span class="wcur">edited cart\.py \(line 11\)<\/span>/); assert.match(live, /<i>term<\/i>.*<i>eye<\/i>|<i>eye<\/i>.*<i>term<\/i>/s); assert.ok(!live.includes('data-open'))
const done = workBox(groupWork([...items, { r: 'agent' }], { now })[1], { who: 'coder', open: true })
assert.match(done, /class="wbox done"/); assert.match(done, /Read cart\.py, ran 1 command, edited cart\.py \(line 11\)/); assert.match(done, /data-open="1"/); assert.match(done, /aria-expanded="true"/)
assert.ok(!workBox({ id: 'z', live: false, steps: [step('q', '<img src=x onerror=1>', 1, { detail: '<script>' })] }).includes('<img'), 'step text is escaped')

// the live activity log: running steps, durations, rows that open one by one (agents report status, started, ended)
assert.strictEqual(formatDuration(0), '<1s'); assert.strictEqual(formatDuration(999), '<1s'); assert.strictEqual(formatDuration(12000), '12s')
assert.strictEqual(formatDuration(65000), '1m 05s'); assert.strictEqual(formatDuration(7380000), '2h 03m')
for (const bad of [-1, NaN, Infinity, '5', null, undefined, {}]) assert.strictEqual(formatDuration(bad), '', String(bad))
assert.strictEqual(stepTime({ started: now - 3000 }, now), '3s', 'a running step counts up to now')
assert.strictEqual(stepTime({ started: 1000, ended: 6000 }, now), '5s'); assert.strictEqual(stepTime({}, now), ''); assert.strictEqual(stepTime(null, now), '')
const running = step('r', '$ python3 -m unittest -q', 10, { status: 'running', started: now - 4000 })
g = groupWork([step('a', 'read cart.py', 5, { status: 'done', started: 5, ended: 900 }), running, { r: 'ask' }], { now })
assert.strictEqual(g[0].live, true, 'a running step keeps its group live even when an approval card follows and the step is old')
const runBox = workBox(g[0], { who: 'coder', now })
assert.match(runBox, /class="wbox busy"/); assert.match(runBox, /<span class="wcur">python3 -m unittest -q<\/span>/, 'the header names the running step')
assert.match(runBox, /class="wst run"[^>]*><span class="wsi"><span class="wsp sm"/, 'the running row has a spinner')
assert.match(runBox, new RegExp(`<span class="wdur" data-start="${now - 4000}">4s</span>`), 'its time ticks from data-start')
assert.match(runBox, /<span class="wdur">&lt;1s<\/span>|<span class="wdur"><1s<\/span>/, 'a finished step shows how long it took')
const doneTimed = workBox({ id: 'd', live: false, steps: [step('a', 'read a', 1, { started: 1000, ended: 2000 }), step('b', 'edited a', 2, { started: 2500, ended: 13000 })] }, { now })
assert.match(doneTimed, /Read a, edited a<span class="wtot"> · 12s<\/span>/, 'a finished box shows the total time'); assert.ok(!doneTimed.includes('data-start'))
// rows that open one at a time: collapsed rows hide output, an open row shows it escaped
const withOut = { id: 'o', live: false, steps: [step('s1', '$ make', 1, { detail: 'built <ok>', started: 0, ended: 2000 }), step('s2', 'read a', 2)] }
const shut = workBox(withOut, { openSteps: new Set(), now })
assert.match(shut, /data-step="s1"><button class="wsr" data-step-toggle aria-expanded="false">/); assert.ok(!shut.includes('<pre>'), 'collapsed rows hide their output')
assert.ok(!/data-step="s2"/.test(shut), 'a row without output is not a button')
const opened = workBox(withOut, { openSteps: new Set(['s1']), now })
assert.match(opened, /data-step="s1" data-open="1"><button class="wsr" data-step-toggle aria-expanded="true">/); assert.match(opened, /<pre>built &lt;ok&gt;<\/pre>/)
assert.match(workBox(withOut, { now }), /<pre>built &lt;ok&gt;<\/pre>/, 'without openSteps the old behavior stays: output shows in the open box')

// the checklist (update_plan)
const pv = planView({ items: [{ text: 'Read the code', status: 'done' }, { text: 'Fix  it\n', status: 'in_progress' }, { text: 'Test', status: 'weird' }, { text: '' }, null] })
assert.deepStrictEqual(pv, { steps: [{ text: 'Read the code', status: 'done' }, { text: 'Fix it', status: 'in_progress' }, { text: 'Test', status: 'pending' }], done: 1, total: 3, current: 'Fix it', finished: false })
for (const bad of [null, undefined, 'x', 5, {}, { items: 'x' }, JSON.parse('{"__proto__":{"items":[{"text":"evil"}]}}')]) { assert.strictEqual(planView(bad).total, 0); assert.strictEqual(planBox(bad), '') }
const pb = planBox({ items: [{ text: 'Read <b>x</b>', status: 'done' }, { text: 'Fix', status: 'in_progress' }, { text: 'Test', status: 'pending' }] }, { who: 'co<der', ic: n => `<i>${n}</i>` })
assert.match(pb, /<div class="planbox" data-plan="co&lt;der"><div class="ph"><span class="pw">co&lt;der's plan<\/span><span class="pn">1\/3<\/span><\/div>/)
assert.match(pb, /<li class="pst done"><span class="psi" role="img" aria-label="done"><i>check<\/i><\/span><span class="pt">Read &lt;b&gt;x&lt;\/b&gt;<\/span><\/li>/)
assert.match(pb, /<li class="pst in_progress"><span class="psi" role="img" aria-label="in progress"><span class="wsp sm"/); assert.match(pb, /aria-label="not started"><\/span><span class="pt">Test/)
assert.match(planBox({ items: [{ text: 'a', status: 'done' }] }), /class="planbox done"/, 'a finished plan is marked done')
// kinds and sizes
assert.strictEqual(fileKind('a.PNG'), 'image'); assert.strictEqual(fileKind('a.svg'), 'svg'); assert.strictEqual(fileKind('x', 'image/jpeg'), 'image'); assert.strictEqual(fileKind('m.glb'), '3d'); assert.strictEqual(fileKind('thing'), 'file')
assert.strictEqual(humanSize(0), '1 B'); assert.strictEqual(humanSize(2048), '2 KB'); assert.strictEqual(humanSize(1572864), '1.5 MB')
// the usage-limit card: full card with buttons only for the person it is for, escaped, optional reset time
{
  const mine = limitCard({ id: 'L1', who: 'coder', title: 'Usage limit reached', detail: 'Get more usage to keep working' }, { mine: true, ic: n => `<i data-ic="${n}"></i>` })
  assert.match(mine, /class="limitcard"/); assert.match(mine, /<b>Usage limit reached<\/b>/); assert.match(mine, /Get more usage to keep working/)
  assert.match(mine, /data-billing="buy">Get more usage</); assert.match(mine, /data-billing="usage">Open usage settings</); assert.match(mine, /data-ic="clock"/)
  assert.doesNotMatch(mine, /Resets at/, 'no reset time when there is none')
  const other = limitCard({ who: 'coder' }, { mine: false })
  assert.doesNotMatch(other, /data-billing/, 'others get no buttons'); assert.match(other, /coder paused: the person who asked is out of usage/)
  assert.match(limitCard({ resets: Date.UTC(2026, 10, 4, 15, 0) }, { mine: true }), / · Resets at \d{1,2}:00 (AM|PM)/)
  const evil = limitCard({ title: '<img src=x onerror=alert(1)>', detail: '"><script>', who: '<b>' }, { mine: true }) + limitCard({ who: '<b>x' }, {})
  assert.doesNotMatch(evil, /<img|<script|<b>x/, 'escaped')
  assert.strictEqual(money(20), '$20.00'); assert.strictEqual(money(-0.015), '-$0.01'); assert.strictEqual(money('x'), '$0.00')
  const panel = usagePanel({ balance_usd: 1.5, spent_usd: 18.5, packs: [{ id: 'credit-10', usd: 10 }, { id: 'credit-20', usd: 20 }] })
  assert.match(panel, /Balance <b>\$1\.50<\/b>/); assert.match(panel, /Used <b>\$18\.50<\/b>/); assert.match(panel, /data-pack="credit-10">Add \$10\.00</)
  assert.strictEqual(usagePanel(null).includes('data-pack'), false)
  assert.doesNotMatch(usagePanel({ packs: [{ id: '"><x', usd: 1 }] }), /"><x/)
}
// an empty marker from the model ("{{none}}", 2026-11-12) is dropped; real markers and code blocks are untouched
assert.strictEqual(md('Payment of $25 has been processed (captured).{{none}}'), '<p>Payment of $25 has been processed (captured).</p>')
assert.strictEqual(md('Done. {{ None }}\nAll set.'), '<p>Done.<br>All set.</p>'); assert.strictEqual(md('x {{null}} y {{nothing}} z {{file:}} w {{image:|big}}'), '<p>x y z w</p>')
assert.ok(!/\{\{/.test(md('x {{null}} y {{nothing}} z {{file:}} w {{image:|big}}')), 'no stray braces are left')
assert.match(md('```\n{{none}}\n```'), /\{\{none\}\}/, 'inside a code block it is code and stays')
assert.match(md('see {{file:a.py}} here', { marker: (k, a) => '<i>' + k + ':' + a + '</i>' }), /<i>file:a\.py<\/i>/, 'a real marker still works')
// a marker that names no file never becomes a box (a real model wrote these after a payment, 2026-11-12)
{
  const box = { marker: (k, a) => '<i>' + k + ':' + a + '</i>' }
  assert.strictEqual(md('The payment was captured. {{file:none}}', box), '<p>The payment was captured.</p>')
  assert.strictEqual(md('Paid.{{file:not found in this workspace}}', box), '<p>Paid.</p>')
  assert.strictEqual(md('a {{file: N/A }} b {{card:null|big}} c {{image:unknown}} d', box), '<p>a b c d</p>')
  assert.match(md('open {{file:notes/none.md}} and {{file:nonexistent.py}}', box), /<i>file:notes\/none\.md<\/i> and <i>file:nonexistent\.py<\/i>/, 'a real file whose name only starts with or contains such a word is kept')
}
assert.match(md('keep {{ name }} as written'), /\{\{ name \}\}/, 'other double braces (a template in the text) are left alone')
console.log('chat-render tests passed')
