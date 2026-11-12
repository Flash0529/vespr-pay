// Filenames are metadata. Renaming must never detach the shared text an offline peer is still editing.
const stores = new WeakMap()
// Preserve existing Git/import filenames, including spaces and Unicode. The explorer applies its stricter naming rules.
const validPath = p => typeof p === 'string' && p.length > 0 && p.length <= 4096 && !p.startsWith('/') && !/[\\\u0000-\u001f\u007f]/.test(p) && !p.split('/').some(s => !s || s === '.' || s === '..' || s.length > 255 || s.toLowerCase() === '.git')
const parents = p => { const a = p.split('/'); return a.slice(1).map((_, i) => a.slice(0, i + 1).join('/')) }
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0

export function fileStore (doc) {
  if (stores.has(doc)) return stores.get(doc)
  const content = doc.getMap('files') // Legacy path keys remain intact; existing offline Y.Text references remain valid.
  const names = doc.getMap('filePaths') // content key -> current filename
  const listeners = new Set()
  let cached = null; let observed = new Map(); let sequence = 0
  function project () {
    if (cached) return cached
    const wanted = []
    for (const [key, text] of content) {
      if (!text || typeof text.toDelta !== 'function') continue
      if (key.startsWith('@file:') && !names.has(key)) continue // incomplete new-format record, never a filename
      const path = names.has(key) ? names.get(key) : key
      wanted.push({ key, text, wanted: path })
    }
    wanted.sort((a, b) => compare(String(a.wanted).toLowerCase(), String(b.wanted).toLowerCase()) || compare(a.key, b.key))
    // Reserve a conflict folder outside every requested root, so recovery never overwrites a person's file.
    const roots = new Set(wanted.map(r => String(r.wanted).split('/')[0].toLowerCase()))
    let recovery = '.vespr-conflicts'; let suffix = 0
    while (roots.has(recovery)) recovery = '.vespr-conflicts-' + ++suffix
    const used = new Set(); const folders = new Set(); const view = new Map()
    let conflict = 0
    for (const row of wanted) {
      const key = String(row.wanted).toLowerCase()
      let path = row.wanted
      const collision = !validPath(path) || used.has(key) || folders.has(key) || parents(key).some(p => used.has(p))
      if (collision) path = `${recovery}/${++conflict}.txt`
      used.add(path.toLowerCase()); for (const p of parents(path.toLowerCase())) folders.add(p)
      view.set(path, { ...row, conflict: collision })
    }
    cached = view
    return view
  }
  function notify (_, transaction) {
    cached = null
    const next = project(); const keys = new Map()
    for (const [path, row] of observed) if (!next.has(path)) keys.set(path, { action: 'delete', oldValue: row.text })
    for (const [path, row] of next) {
      const before = observed.get(path)
      if (!before) keys.set(path, { action: 'add' })
      else if (before.text !== row.text) keys.set(path, { action: 'update', oldValue: before.text })
    }
    const renamed = []
    const byText = new Map([...next].map(([path, row]) => [row.text, path]))
    for (const [from, row] of observed) { const to = byText.get(row.text); if (to && from !== to) renamed.push({ from, to, text: row.text }) }
    observed = new Map(next)
    if (keys.size) for (const fn of listeners) fn({ keys, keysChanged: new Set(keys.keys()), renamed, target: api }, transaction)
  }
  function assertTree (paths) {
    const keys = new Set()
    for (const p of paths) { if (!validPath(p)) throw new Error('that is not a usable file name'); const key = p.toLowerCase(); if (keys.has(key)) throw new Error('that name is taken: ' + p); keys.add(key) }
    for (const p of keys) if (parents(p).some(a => keys.has(a))) throw new Error('a file cannot hold another file: ' + p)
  }
  const api = {
    get size () { return project().size },
    get (path) { return project().get(path)?.text },
    has (path) { return project().has(path) },
    * keys () { yield * project().keys() },
    * values () { for (const row of project().values()) yield row.text },
    * entries () { for (const [path, row] of project()) yield [path, row.text] },
    [Symbol.iterator] () { return api.entries() },
    forEach (fn) { for (const [path, text] of api) fn(text, path, api) },
    pathFor (text) { for (const [path, row] of project()) if (row.text === text) return path; return null },
    conflicts () { return [...project()].filter(([, r]) => r.conflict).map(([path, r]) => ({ path, requested: r.wanted, id: r.key })) },
    set (path, text) {
      if (!validPath(path)) throw new Error('that is not a usable file name')
      const row = project().get(path)
      if (row?.text === text) return api
      if (!row) assertTree([...project().keys(), path])
      let key = row?.key
      if (!row) {
        if (doc.getMap('settings').get('fileStoreVersion') === 1) {
          do { key = `@file:${doc.clientID}:${++sequence}` } while (content.has(key))
        } else {
          if (content.has(path)) throw new Error('Reconnect to an updated server before creating this file')
          key = path // legacy server: keep its readable format, never silently introduce storage ids
        }
      }
      doc.transact(() => { content.set(key, text); names.set(key, path); cached = null })
      return api
    },
    delete (path) {
      const row = project().get(path); if (!row) return false
      // Explicit deletion still deletes content. Renaming alone never does this.
      doc.transact(() => { content.delete(row.key); names.delete(row.key); cached = null })
      return true
    },
    rename (moves) {
      if (doc.getMap('settings').get('fileStoreVersion') !== 1) throw new Error('Reconnect to an updated server before renaming files')
      if (!Array.isArray(moves) || !moves.length || moves.length > 500) throw new Error('nothing to rename, or too many files at once')
      const before = project(); const sources = new Set(); const change = []
      for (const pair of moves) {
        if (!Array.isArray(pair) || pair.length !== 2) throw new Error('each rename needs a source and destination')
        const [from, to] = pair; const row = before.get(from)
        if (!row || sources.has(from) || !validPath(to)) throw new Error('cannot rename ' + String(from).slice(0, 60))
        sources.add(from); change.push([row.key, to])
      }
      assertTree([...before.keys()].filter(p => !sources.has(p)).concat(change.map(([, to]) => to)))
      doc.transact(() => { for (const [key, to] of change) names.set(key, to); cached = null })
      return change.length
    },
    observe (fn) { if (!listeners.size) observed = new Map(project()); listeners.add(fn) },
    unobserve (fn) { listeners.delete(fn) }
  }
  content.observe(notify); names.observe(notify)
  doc.on('destroy', () => { content.unobserve(notify); names.unobserve(notify); listeners.clear(); stores.delete(doc) })
  stores.set(doc, api)
  return api
}
