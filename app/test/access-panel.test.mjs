// The "Who has access" panel (access-panel.js): what it shows for open and locked workspaces, owner vs manager vs member, the add form's
// checks, toggling a right, grants that end, requests and who may answer them, and that hostile names and paths are escaped.
import assert from 'node:assert'
import { accessView, validateGrant, toggled, accessHtml, whoLabel, pathLabel, canDo, answerable, untilLabel, RIGHTS } from '../access-panel.js'

let n = 0
const t = (name, fn) => { try { fn(); n++ } catch (e) { console.error('FAILED: ' + name); throw e } }
const NOW = Date.UTC(2026, 10, 4, 23, 0)
const locked = { room: 'team', locked: true, owner: 'alice', grants: [{ who: '*', path: 'docs/', rights: ['view'] }, { who: 'coder', path: '', rights: ['make', 'view', 'edit', 'delete'] }, { who: 'bob', path: 'src/', rights: ['view', 'edit'] }], mine: ['view'] }

t('an open workspace shows the lock button and no list', () => {
  const v = accessView({ room: 'team', locked: false, owner: null, grants: [], mine: RIGHTS }, 'alice')
  assert.deepStrictEqual([v.locked, v.isOwner, v.rows.length], [false, false, 0])
  const h = accessHtml(v)
  assert.match(h, /data-acc-lock/); assert.match(h, /<b>open<\/b>/); assert.doesNotMatch(h, /acc-list/)
})

t('the owner sees every row with tick boxes (manage too, not for everyone), an add form and "open it again"', () => {
  const v = accessView(locked, ' ALICE ', NOW)
  assert.strictEqual(v.isOwner, true, 'names compared without case or spaces')
  assert.deepStrictEqual(v.rows.map(r => r.who), ['bob', 'coder', '*'], 'people by name, everyone last')
  assert.deepStrictEqual(v.rows[0].rights, { make: false, view: true, edit: true, delete: false, manage: false })
  const h = accessHtml(v, { folders: ['src/', 'docs/', 'src/'] })
  assert.strictEqual((h.match(/data-acc-toggle=/g) || []).length, 14, '2 rows x 5 rights, and everyone gets no manage box')
  assert.strictEqual((h.match(/data-acc-revoke/g) || []).length, 3)
  assert.match(h, /data-acc-add/); assert.match(h, /data-acc-unlock/); assert.match(h, /<b>alice<\/b><small>owner<\/small>/)
  assert.match(h, /data-acc-new="manage"/, 'the owner may give manage')
  assert.strictEqual((h.match(/<option value="src\/">/g) || []).length, 1, 'each folder once'); assert.match(h, /<option value="">Whole workspace<\/option>/)
  assert.match(h, /Everyone signed in/); assert.match(h, /data-acc-toggle="edit" data-acc-who="bob" data-acc-path="src\/"[^>]* checked/)
})

t('a manager changes rows inside the place they manage, never manage, never a manager’s row', () => {
  const d = { ...locked, grants: [...locked.grants, { who: 'maya', path: 'src/', rights: ['view', 'edit', 'manage'] }, { who: 'sam', path: 'src/', rights: ['view', 'manage'] }] }
  const v = accessView(d, 'maya', NOW)
  assert.deepStrictEqual([v.isOwner, v.manages], [false, true])
  const by = w => v.rows.find(r => r.who === w)
  assert.strictEqual(by('bob').editable, true, 'bob is in src/'); assert.strictEqual(by('coder').editable, false, 'coder is on the whole workspace')
  assert.strictEqual(by('sam').editable, false, 'another manager'); assert.strictEqual(by('maya').editable, false, 'herself (a manager row)')
  const h = accessHtml(v)
  assert.doesNotMatch(h, /data-acc-toggle="manage"/); assert.doesNotMatch(h, /data-acc-new="manage"/); assert.doesNotMatch(h, /data-acc-unlock/)
  assert.match(h, /data-acc-add/); assert.match(h, /You manage part of this workspace/)
})

t('a member sees the list read-only, who owns it, and their own rights', () => {
  const h = accessHtml(accessView(locked, 'bob'))
  assert.doesNotMatch(h, /data-acc-toggle|data-acc-revoke|data-acc-add|data-acc-unlock/)
  assert.match(h, /Only <b>alice<\/b> and the people they make managers/); assert.match(h, /You can: view/)
  assert.match(accessHtml(accessView({ ...locked, mine: [] }, 'bob')), /your rights are on specific folders/)
})

t('grants that end: shown with the time, only removable; ended ones are gone', () => {
  const d = { ...locked, grants: [{ who: 'coder', path: 'src/', rights: ['edit'], until: NOW + 3600_000 }, { who: 'zed', path: '', rights: ['view'], until: NOW - 1 }] }
  const v = accessView(d, 'alice', NOW)
  assert.deepStrictEqual(v.rows.map(r => r.who), ['coder'], 'the ended one is not shown')
  assert.deepStrictEqual([v.rows[0].editable, v.rows[0].removable], [false, true])
  assert.match(v.rows[0].untilText, /^until \d{1,2}:\d{2} [AP]M$/)
  assert.strictEqual(untilLabel(0), ''); assert.match(untilLabel(NOW + 3 * 86400_000, NOW), /^until [A-Z][a-z]{2} \d+, /)
  assert.strictEqual(canDo(d, 'zed', 'view', '', NOW), false); assert.strictEqual(canDo(d, 'coder', 'edit', 'src/a', NOW), true)
  assert.strictEqual(canDo(d, 'coder', 'edit', 'src/a', NOW + 3600_000), false, 'and then it ends')
})

t('requests: who may answer, and the waiting list', () => {
  const d = { ...locked, grants: [...locked.grants, { who: 'maya', path: 'src/', rights: ['view', 'edit', 'manage'] }] }
  const q = { id: 'r1', who: 'coder', agent: true, path: 'src/', rights: ['edit'], reason: 'fix the <test>', status: 'pending' }
  assert.strictEqual(answerable(d, 'alice', q), true, 'the owner'); assert.strictEqual(answerable(d, 'maya', q), true, 'a manager of src/')
  assert.strictEqual(answerable(d, 'bob', q), false, 'a member'); assert.strictEqual(answerable(d, 'maya', { ...q, path: '' }), false, 'outside her place')
  assert.strictEqual(answerable(d, 'coder', { ...q, who: 'coder' }), false, 'not your own'); assert.strictEqual(answerable({ locked: false }, 'x', q), false, 'open: nothing to answer')
  const h = accessHtml(accessView(d, 'maya'), { requests: [q, { ...q, id: 'r2', status: 'approved' }], me: 'maya', data: d })
  assert.strictEqual((h.match(/data-acc-answer="r1"/g) || []).length, 3, 'allow for an hour, always, deny'); assert.doesNotMatch(h, /r2/, 'only waiting ones')
  assert.match(h, /&lt;test&gt;/, 'the reason is escaped'); assert.match(h, /<small>agent<\/small>/)
  assert.doesNotMatch(accessHtml(accessView(d, 'bob'), { requests: [q], me: 'bob', data: d }), /data-acc-answer/, 'a member sees it waiting, without buttons')
})

t('the add form: a name, a place inside the workspace, at least one right; manage only for a named person', () => {
  assert.deepStrictEqual(validateGrant({ who: ' bob ', path: '/src/', rights: ['edit', 'view', 'fly'] }), { ok: true, grant: { who: 'bob', path: 'src/', rights: ['view', 'edit'] } })
  assert.deepStrictEqual(validateGrant({ who: '*', path: '', rights: ['view'] }).grant, { who: '*', path: '', rights: ['view'] })
  assert.match(validateGrant({ who: '*', path: '', rights: ['manage'] }).reason, /named person/)
  assert.match(validateGrant({ who: '', rights: ['view'] }).reason, /name/)
  assert.match(validateGrant({ who: 'x'.repeat(61), rights: ['view'] }).reason, /too long/)
  assert.match(validateGrant({ who: 'bob', path: '../etc', rights: ['view'] }).reason, /inside the workspace/)
  assert.match(validateGrant({ who: 'bob', path: 'src', rights: [] }).reason, /at least one/)
  assert.strictEqual(validateGrant().ok, false)
})

t('toggling a right: the new set, or null when nothing is left (remove the line)', () => {
  const row = accessView(locked, 'alice').rows[0]
  assert.deepStrictEqual(toggled(row, 'make'), ['make', 'view', 'edit'])
  assert.deepStrictEqual(toggled(row, 'edit'), ['view'])
  assert.deepStrictEqual(toggled(row, 'manage'), ['view', 'edit', 'manage'])
  assert.strictEqual(toggled({ rights: { make: false, view: true, edit: false, delete: false, manage: false } }, 'view'), null)
  assert.strictEqual(toggled(row, 'fly'), null); assert.strictEqual(toggled(null, 'view'), null)
})

t('hostile names and paths are escaped everywhere', () => {
  const bad = { locked: true, owner: '<img src=x onerror=alert(1)>', grants: [{ who: '"><script>x</script>', path: '<b>/', rights: ['view'] }], mine: [] }
  const all = accessHtml(accessView(bad, '<img src=x onerror=alert(1)>'), { folders: ['"><svg>/'], requests: [{ id: '"><i>', who: '<u>', path: '<s>', rights: ['view'], status: 'pending', reason: '<x>' }] }) + accessHtml(accessView(bad, 'bob'))
  assert.doesNotMatch(all, /<img|<script|<svg|<b>\/|<u>|<s>|<x>|"><i>/)
})

t('junk input never throws', () => {
  for (const d of [null, undefined, 5, 'x', { grants: 'x' }, { locked: true, grants: [null, { who: 5 }, { who: 'a', path: 'b', rights: 'x' }] }]) assert.doesNotThrow(() => accessHtml(accessView(d, null), { requests: 'x' }))
  assert.strictEqual(accessView({ locked: true, grants: [{ who: 'a', path: '', rights: ['view'] }] }, null).isOwner, false)
  assert.strictEqual(whoLabel('*'), 'Everyone signed in'); assert.strictEqual(pathLabel(''), 'Whole workspace'); assert.strictEqual(pathLabel('src/'), 'src/')
  assert.strictEqual(answerable(null, 'a', null), false)
})

t('canDo matches the server: open allows all, owner all, grants by path, never look-alikes', () => {
  assert.strictEqual(canDo(null, 'x', 'edit', 'a'), true, 'no list loaded yet: allowed (the server still checks)')
  assert.strictEqual(canDo({ locked: false }, 'x', 'delete', 'a'), true)
  assert.strictEqual(canDo(locked, ' Alice', 'delete', 'README.md'), true, 'the owner')
  assert.strictEqual(canDo(locked, ' Alice', 'manage', 'src/'), true, 'the owner manages everywhere')
  assert.strictEqual(canDo(locked, 'bob', 'edit', 'src/a.py'), true)
  assert.strictEqual(canDo(locked, 'bob', 'edit', 'README.md'), false)
  assert.strictEqual(canDo(locked, 'bob', 'make', 'src/new.py'), false, 'view and edit only')
  assert.strictEqual(canDo(locked, 'dave', 'view', 'docs/x.md'), true, 'the * grant')
  assert.strictEqual(canDo(locked, 'dave', 'edit', 'docs/x.md'), false)
  assert.strictEqual(canDo({ locked: true, owner: 'a', grants: [{ who: 'bob', path: 'src', rights: ['edit'] }] }, 'bob', 'edit', 'srcx/a.py'), false)
  assert.strictEqual(canDo(locked, 'coder', 'edit', ''), true, 'the agent may change shared state (edit on the whole workspace)')
  assert.strictEqual(canDo(locked, 'bob', 'edit', ''), false)
})

console.log(`access-panel tests passed (${n})`)
