// An edit share link is a seat in the room (it can answer an agent's Approve card and change the mode): the Share dialog says so before the link is made,
// and the guest sees a reminder. the team chose "keep, add a notice" over blocking it on 2026-11-11 (docs: SHARE-LINKS-SECURITY-2026-11-11.md finding 4).
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const html = readFileSync(new URL('../prototype.html', import.meta.url), 'utf8')

test('the Share dialog carries the edit-link notice and shows it only for an edit link to the whole project', () => {
  const note = /<p class="fnote" id="shiEditNote" role="note" hidden>([^<]+)<\/p>/.exec(html)
  assert.ok(note, 'the notice exists, hidden by default')
  for (const w of ['Approve or Deny', 'run something', 'mode', 'chat', 'trust']) assert.ok(note[1].includes(w), 'the notice mentions ' + w)
  assert.match(html, /en\.hidden=!\(shiRole==='edit'&&!file\)/, 'shown only when "Can edit" is chosen for the whole project')
})

test('a guest with edit rights is reminded that they can answer agents', () => {
  assert.match(html, /You can also answer the agents\\' requests, so check a card before you approve it\./)
})
