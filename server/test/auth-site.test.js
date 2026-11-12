// Static checks on the website's sign-in pages (site/signin.html, signup, verify, account and site/js/auth.js), no browser:
// the script parses, every /auth/* endpoint it calls exists in server/auth.js, the pages load it, and with accounts off it says so.
// (The browser and API checks of these pages live with the site's sources; this keeps the site and the server from drifting apart.)
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const site = path.join(here, '..', '..', 'site')
const js = fs.readFileSync(path.join(site, 'js', 'auth.js'), 'utf8')
const authSrc = fs.readFileSync(path.join(here, '..', 'auth.js'), 'utf8')
let n = 0
const check = (ok, what) => { if (!ok) { console.error('FAILED: ' + what); process.exit(1) } n++ }

let parses = true
try { new vm.Script(js) } catch { parses = false }
check(parses, 'site/js/auth.js parses')

const calls = [...new Set([...js.matchAll(/'(\/auth\/[a-z0-9/_-]*)'/g)].map(m => m[1]))]
check(calls.length >= 8, 'the sign-in script calls the auth endpoints (' + calls.length + ')')
for (const c of calls) check(authSrc.includes(c), 'server has ' + c)

for (const page of ['signin.html', 'signup.html', 'verify.html', 'account.html']) {
  const html = fs.readFileSync(path.join(site, page), 'utf8')
  check(html.includes('js/auth.js'), page + ' loads js/auth.js')
}
check(js.includes('Accounts are not switched on'), 'with accounts off on the server, the pages say so instead of pretending')
check(!/@[a-z0-9-]+\.(com|net|org)\b/i.test(js.replace(/example\.(com|org)/g, '')), 'no real email address in the sign-in script')

// the checker itself notices a broken script and a missing endpoint
let broken = true
try { new vm.Script(js.replace('function', 'function {')) ; broken = false } catch {}
check(broken, 'checker notices a script syntax error')
check(!authSrc.includes('/auth/does-not-exist'), 'checker would notice a missing endpoint')

console.log(`auth site tests passed: ${n} checks (sign-in pages and server agree)`)
