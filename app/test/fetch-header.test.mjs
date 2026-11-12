// The page wraps window.fetch to say which client it is. Only the desktop app may do that: in a browser a custom header turns every call to the collab server
// (another origin) into a CORS preflight the server does not allow, so the Share dialog, friends and billing probes all failed with "network" (found 2026-11-10).
import assert from 'node:assert'
import fs from 'node:fs'
import vm from 'node:vm'
const html = fs.readFileSync(new URL('../prototype.html', import.meta.url), 'utf8')
const m = /<script>\s*\(function\(\) \{\s*const origFetch = window\.fetch;[\s\S]*?\}\)\(\);\s*<\/script>/.exec(html)
assert.ok(m, 'the fetch wrapper is still an inline script on its own')
const code = m[0].replace(/^<script>/, '').replace(/<\/script>$/, '')
const run = desktop => {
  const calls = []; const win = { fetch (url, opts) { calls.push({ url, opts }); return Promise.resolve('ok') } }; if (desktop) win.VESPR_DESKTOP = { ws: 'ws://x' }
  vm.runInNewContext(code, { window: win }); return { win, calls }
}
{ const { win, calls } = run(false); await win.fetch('http://c/api/share/list', { headers: { Authorization: 'Bearer t' } })
  assert.strictEqual(calls.length, 1); assert.deepStrictEqual(Object.keys(calls[0].opts.headers), ['Authorization'], 'a browser adds no header of its own')
  await win.fetch('http://c/x'); assert.strictEqual(calls[1].opts, undefined, 'and does not even touch a call that has no options') }
{ const { win, calls } = run(true); await win.fetch('vespr-app://vespr/api/x', { headers: { Authorization: 'Bearer t' } })
  assert.match(calls[0].opts.headers['X-Vespr-Client'], /desktop/i, 'the desktop app still says so'); assert.strictEqual(calls[0].opts.headers.Authorization, 'Bearer t') }
console.log('fetch header tests passed')
