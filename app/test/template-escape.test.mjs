// Static guard for the app shell templates: peer-controlled values (names, roles, models, ids, file names, paths) must go through esc() before they are put in HTML.
// A cheap regression test for the XSS sweep (2026-10-30); it reads prototype.html and fails if one of the known raw interpolations comes back.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'prototype.html'), 'utf8')
const raw = ['${o[0]}', '${o[1]}', '${o[2]}', '${f.n}', '${a.name}', '${a.role}', '${it.who}', '${it.model}', '${it.c}', '${tgt}', '${h.user}', '${h.host}', 'data-agent="${a.id}"', 'data-full="${a.id}"', 'data-open="${f}"', '<span class="t">${f}</span>', 'title="${a.note}"']
const bad = raw.filter(r => html.includes(r))
if (bad.length) { console.error('raw (unescaped) interpolations are back:', bad.join('  ')); process.exit(1) }
const need = ['esc(o[0])', 'esc(f.n)', 'esc(a.name)', 'esc(it.who)', 'esc(a.note)']
const missing = need.filter(r => !html.includes(r))
if (missing.length) { console.error('expected escaped forms missing:', missing.join('  ')); process.exit(1) }
console.log('template escape tests passed:', raw.length, 'raw patterns absent,', need.length, 'escaped forms present')
