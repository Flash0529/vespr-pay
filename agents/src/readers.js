// Readers: turn a file's bytes into text and facts an agent can use (R41). Pure functions on Buffers, no dependencies, nothing is executed.
// Every reader says what it could NOT read (images inside a deck, scanned pages, audio without a speech model), so an agent never pretends.
//   describeFile(name, bytes) -> { name, kind, bytes, summary, text, data, notes }
import zlib from 'node:zlib'
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'
import { spawnSync } from 'node:child_process'

export const LIMITS = { entries: 400, unzipped: 60 * 1024 * 1024, text: 20000, rows: 200, cols: 40, slides: 100, triangles: 5_000_000 }

// ---- ZIP (docx, pptx, xlsx are zip files) ----
export function readZip (buf, { maxEntries = LIMITS.entries, maxBytes = LIMITS.unzipped } = {}) {
  let eocd = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
  if (eocd < 0) throw new Error('not a zip file (or it is damaged)')
  const count = buf.readUInt16LE(eocd + 10); let p = buf.readUInt32LE(eocd + 16)
  if (count > maxEntries) throw new Error('zip has too many entries (' + count + ')')
  const entries = new Map(); let total = 0
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new Error('zip directory is damaged')
    const flags = buf.readUInt16LE(p + 8); const method = buf.readUInt16LE(p + 10); const csize = buf.readUInt32LE(p + 20); const usize = buf.readUInt32LE(p + 24)
    const nl = buf.readUInt16LE(p + 28); const xl = buf.readUInt16LE(p + 30); const cl = buf.readUInt16LE(p + 32); const off = buf.readUInt32LE(p + 42)
    const name = buf.toString('utf8', p + 46, p + 46 + nl)
    if (flags & 1) throw new Error('the file is password protected')
    if (csize === 0xffffffff || usize === 0xffffffff || off === 0xffffffff) throw new Error('zip64 files are not supported')
    total += usize; if (total > maxBytes) throw new Error('zip would unpack to more than ' + Math.round(maxBytes / 1048576) + ' MB')
    entries.set(name, { method, csize, usize, off }); p += 46 + nl + xl + cl
  }
  return {
    names: [...entries.keys()],
    get (name) {
      const e = entries.get(name); if (!e) return null
      if (buf.readUInt32LE(e.off) !== 0x04034b50) throw new Error('zip entry is damaged: ' + name)
      const start = e.off + 30 + buf.readUInt16LE(e.off + 26) + buf.readUInt16LE(e.off + 28); const raw = buf.subarray(start, start + e.csize)
      if (e.method === 0) return Buffer.from(raw)
      if (e.method === 8) return zlib.inflateRawSync(raw, { maxOutputLength: e.usize + 1 })
      throw new Error('unsupported zip compression ' + e.method)
    }
  }
}

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
const unxml = s => s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e) => (e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENT[e.toLowerCase()]))
const xmlText = s => s.toString('utf8')
const clip = (t, max = LIMITS.text) => (t.length > max ? t.slice(0, max) + '\n[… ' + (t.length - max) + ' more characters not shown]' : t)

// ---- Word ----
export function readDocx (buf) {
  const z = readZip(buf); const doc = z.get('word/document.xml'); if (!doc) throw new Error('no word/document.xml: not a Word document')
  const paras = xmlText(doc).split(/<\/w:p>/).map(p => unxml(p.replace(/<w:tab\/>/g, '\t').replace(/<w:br\/>/g, '\n').replace(/<(?!w:t[ >])[^>]*>/g, '').replace(/<w:t[^>]*>/g, '').replace(/<\/w:t>/g, '')).replace(/\s+$/, '')).filter(Boolean)
  const images = z.names.filter(n => n.startsWith('word/media/')).length
  return { text: paras.join('\n'), paragraphs: paras.length, images }
}

// ---- PowerPoint ----
export function readPptx (buf) {
  const z = readZip(buf); const slideNames = z.names.filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => parseInt(a.match(/\d+/)[0]) - parseInt(b.match(/\d+/)[0]))
  if (!slideNames.length) throw new Error('no slides found: not a PowerPoint file')
  const paras = x => xmlText(x).split(/<\/a:p>/).map(p => unxml([...p.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map(m => m[1]).join(''))).filter(s => s.trim())
  const slides = slideNames.slice(0, LIMITS.slides).map(n => {
    const num = parseInt(n.match(/\d+/)[0]); const rels = z.get(`ppt/slides/_rels/slide${num}.xml.rels`)
    const note = rels && /Target="\.\.\/notesSlides\/(notesSlide\d+\.xml)"/.exec(xmlText(rels)); const nx = note && z.get('ppt/notesSlides/' + note[1])
    return { n: num, text: paras(z.get(n)).join('\n'), notes: nx ? paras(nx).filter(s => !/^\d+$/.test(s.trim())).join('\n') : '' }
  })
  return { slides, slideCount: slideNames.length, images: z.names.filter(n => n.startsWith('ppt/media/')).length, truncated: slideNames.length > LIMITS.slides }
}

// ---- Excel ----
const colIndex = ref => { let n = 0; for (const ch of /^[A-Z]+/.exec(ref)[0]) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1 }
export function readXlsx (buf) {
  const z = readZip(buf); const wb = z.get('xl/workbook.xml'); if (!wb) throw new Error('no xl/workbook.xml: not an Excel file')
  const rels = z.get('xl/_rels/workbook.xml.rels'); const relMap = new Map([...(rels ? xmlText(rels) : '').matchAll(/<Relationship\b[^>]*>/g)].map(m => [/\bId="([^"]+)"/.exec(m[0])?.[1], /\bTarget="([^"]+)"/.exec(m[0])?.[1]]))
  const ss = z.get('xl/sharedStrings.xml'); const shared = ss ? [...xmlText(ss).matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => unxml([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(x => x[1]).join(''))) : []
  const sheets = [...xmlText(wb).matchAll(/<sheet\b[^>]*>/g)].map(m => ({ name: unxml(/\bname="([^"]*)"/.exec(m[0])?.[1] || ''), rid: /\br:id="([^"]+)"/.exec(m[0])?.[1] })).map(sh => {
    const target = relMap.get(sh.rid) || ''; const file = z.get(target.startsWith('/') ? target.slice(1) : 'xl/' + target); const rows = []; let rowCount = 0; let colMax = 0
    if (file) for (const r of xmlText(file).matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      rowCount++; if (rows.length >= LIMITS.rows) continue
      const cells = []
      for (const c of r[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const ref = /\br="([A-Z]+\d+)"/.exec(c[1]); if (!ref) continue; const t = /\bt="(\w+)"/.exec(c[1])?.[1]; const body = c[2] || ''
        const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1]; let val = ''
        if (t === 's' && v !== undefined) val = shared[+v] ?? ''
        else if (t === 'inlineStr') val = unxml([...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(x => x[1]).join(''))
        else if (t === 'b') val = v === '1' ? 'TRUE' : 'FALSE'
        else if (v !== undefined) val = unxml(v)
        const ci = colIndex(ref[1]); if (ci < LIMITS.cols) { cells[ci] = val; colMax = Math.max(colMax, ci + 1) }
      }
      rows.push(Array.from(cells, v => v ?? ''))
    }
    return { name: sh.name, rows, rowCount, truncated: rowCount > LIMITS.rows || colMax >= LIMITS.cols }
  })
  return { sheets }
}

// ---- CSV and plain text ----
export function readCsv (text) {
  const first = text.split('\n', 1)[0]; const delim = [',', ';', '\t', '|'].map(d => [d, first.split(d).length]).sort((a, b) => b[1] - a[1])[0][0]
  const rows = []; let row = []; let cell = ''; let q = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++ } else q = false } else cell += ch } else if (ch === '"') q = true
    else if (ch === delim) { row.push(cell); cell = '' } else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); cell = ''; if (row.length > 1 || row[0] !== '') rows.push(row); row = [] } else cell += ch
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row) }
  return { delimiter: delim, rows: rows.slice(0, LIMITS.rows).map(r => r.slice(0, LIMITS.cols)), rowCount: rows.length, truncated: rows.length > LIMITS.rows }
}

// ---- PDF: pdftotext when installed, otherwise a basic reader for text that is not font-encoded ----
export function readPdf (buf) {
  if (buf.subarray(0, 5).toString('latin1') !== '%PDF-') throw new Error('not a PDF file')
  const pages = (buf.toString('latin1').match(/\/Type\s*\/Page(?![s\w])/g) || []).length
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-')), 'in.pdf')
  try {
    fs.writeFileSync(tmp, buf)
    const r = spawnSync('pdftotext', ['-layout', '-q', tmp, '-'], { encoding: 'utf8', timeout: 20000, maxBuffer: 20 * 1024 * 1024 })
    if (!r.error && r.status === 0 && r.stdout.trim()) return { text: r.stdout, pages, engine: 'pdftotext', notes: [] }
  } finally { fs.rmSync(path.dirname(tmp), { recursive: true, force: true }) }
  const src = buf.toString('latin1'); const out = []
  for (const m of src.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    let body = Buffer.from(m[1], 'latin1')
    if (/\/FlateDecode/.test(src.slice(Math.max(0, m.index - 300), m.index))) { try { body = zlib.inflateSync(body, { maxOutputLength: 20 * 1024 * 1024 }) } catch { continue } }
    const s = body.toString('latin1'); if (!/\bBT\b/.test(s)) continue
    for (const t of s.matchAll(/\[((?:[^\]\\]|\\.)*)\]\s*TJ|\(((?:[^()\\]|\\.)*)\)\s*Tj/g)) {
      const parts = t[1] !== undefined ? [...t[1].matchAll(/\(((?:[^()\\]|\\.)*)\)/g)].map(x => x[1]).join('') : t[2]
      out.push(parts.replace(/\\([nrtbf()\\]|[0-7]{1,3})/g, (mm, e) => ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '(': '(', ')': ')', '\\': '\\' })[e] ?? String.fromCharCode(parseInt(e, 8))))
    }
  }
  const text = out.join('\n').trim()
  return { text, pages, engine: 'basic', notes: text ? ['Basic text extraction (no pdftotext here): tables, columns and font-encoded text may be wrong or missing.'] : ['No text could be extracted. The PDF is probably scanned images or uses encoded fonts; it needs OCR or pdftotext, which are not available here.'] }
}

// ---- images ----
export function readImageInfo (buf) {
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { format: 'png', width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
  if (buf.subarray(0, 3).toString('latin1') === 'GIF') return { format: 'gif', width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) }
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let p = 2
    while (p + 9 < buf.length) {
      if (buf[p] !== 0xff) { p++; continue }
      const m = buf[p + 1]; if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { p += 2; continue }
      const len = buf.readUInt16BE(p + 2)
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { format: 'jpeg', height: buf.readUInt16BE(p + 5), width: buf.readUInt16BE(p + 7) }
      p += 2 + len
    }
    return { format: 'jpeg' }
  }
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return { format: 'webp' }
  throw new Error('not a PNG, JPEG, GIF or WebP image')
}

// ---- 3D models: facts only (triangles, size), not the geometry ----
const grow = (b, x, y, z) => { if (!b) return { min: [x, y, z], max: [x, y, z] }; const mn = b.min; const mx = b.max; if (x < mn[0]) mn[0] = x; if (y < mn[1]) mn[1] = y; if (z < mn[2]) mn[2] = z; if (x > mx[0]) mx[0] = x; if (y > mx[1]) mx[1] = y; if (z > mx[2]) mx[2] = z; return b }
const size = b => (b ? b.max.map((v, i) => +(v - b.min[i]).toFixed(4)) : null)
export function readStl (buf) {
  let b = null
  if (buf.length >= 84 && 84 + 50 * buf.readUInt32LE(80) === buf.length) {
    const n = buf.readUInt32LE(80); if (n > LIMITS.triangles) throw new Error('model has too many triangles')
    for (let i = 0; i < n; i++) for (let v = 0; v < 3; v++) { const o = 84 + i * 50 + 12 + v * 12; b = grow(b, buf.readFloatLE(o), buf.readFloatLE(o + 4), buf.readFloatLE(o + 8)) }
    return { format: 'stl-binary', triangles: n, bounds: b, size: size(b) }
  }
  const t = buf.toString('utf8'); if (!/^\s*solid/.test(t) || !/facet/.test(t)) throw new Error('not an STL file')
  let n = 0; for (const m of t.matchAll(/vertex\s+(\S+)\s+(\S+)\s+(\S+)/g)) { b = grow(b, +m[1], +m[2], +m[3]); n++ }
  return { format: 'stl-ascii', triangles: Math.floor(n / 3), bounds: b, size: size(b) }
}
export function readObj (text) {
  let b = null; let v = 0; let faces = 0; let tris = 0
  for (const line of text.split('\n')) {
    if (line.startsWith('v ')) { const [, x, y, z] = line.trim().split(/\s+/); b = grow(b, +x, +y, +z); v++ } else if (line.startsWith('f ')) { const k = line.trim().split(/\s+/).length - 1; faces++; tris += Math.max(0, k - 2) }
  }
  if (!v) throw new Error('no vertices: not an OBJ file')
  return { format: 'obj', vertices: v, faces, triangles: tris, bounds: b, size: size(b) }
}
export function readGltf (json) {
  const acc = json.accessors || []; let tris = 0; let b = null
  for (const m of json.meshes || []) for (const p of m.primitives || []) {
    if (p.mode !== undefined && p.mode !== 4) continue
    const idx = p.indices !== undefined ? acc[p.indices] : null; const pos = acc[p.attributes && p.attributes.POSITION]
    tris += Math.floor((idx ? idx.count : pos ? pos.count : 0) / 3)
    if (pos && pos.min && pos.max) { b = grow(b, ...pos.min); b = grow(b, ...pos.max) }
  }
  return { format: 'gltf', meshes: (json.meshes || []).length, nodes: (json.nodes || []).length, materials: (json.materials || []).length, animations: (json.animations || []).length, triangles: tris, bounds: b, size: size(b), notes: ['Size ignores node transforms.'] }
}
export function readGlb (buf) {
  if (buf.length < 20 || buf.toString('latin1', 0, 4) !== 'glTF') throw new Error('not a GLB file')
  const len = buf.readUInt32LE(12); if (buf.toString('latin1', 16, 20) !== 'JSON') throw new Error('GLB has no JSON chunk')
  return { ...readGltf(JSON.parse(buf.toString('utf8', 20, 20 + len))), format: 'glb' }
}

// ---- audio and video: what the file is, not what is in it ----
export function readWav (buf) {
  if (buf.toString('latin1', 0, 4) !== 'RIFF' || buf.toString('latin1', 8, 12) !== 'WAVE') throw new Error('not a WAV file')
  let p = 12; let fmt = null; let dataLen = 0
  while (p + 8 <= buf.length) { const id = buf.toString('latin1', p, p + 4); const n = buf.readUInt32LE(p + 4); if (id === 'fmt ') fmt = { channels: buf.readUInt16LE(p + 10), sampleRate: buf.readUInt32LE(p + 12), bits: buf.readUInt16LE(p + 22) }; if (id === 'data') { dataLen = Math.min(n, buf.length - p - 8); break } p += 8 + n + (n % 2) }
  if (!fmt) throw new Error('WAV has no fmt chunk')
  return { format: 'wav', ...fmt, seconds: +(dataLen / (fmt.sampleRate * fmt.channels * (fmt.bits / 8))).toFixed(3) }
}
export function probeMedia (buf) { // needs ffprobe; returns null when it is not installed
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'media-')); const f = path.join(dir, 'in.bin')
  try {
    fs.writeFileSync(f, buf)
    const r = spawnSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', f], { encoding: 'utf8', timeout: 20000, maxBuffer: 5 * 1024 * 1024 })
    if (r.error || r.status !== 0) return null
    const j = JSON.parse(r.stdout)
    return { seconds: j.format && j.format.duration ? +(+j.format.duration).toFixed(2) : null, container: j.format && j.format.format_name, streams: (j.streams || []).map(s => ({ type: s.codec_type, codec: s.codec_name, width: s.width, height: s.height, channels: s.channels, sampleRate: s.sample_rate && +s.sample_rate })) }
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
}

// ---- one entry point ----
const EXT = { docx: 'docx', pptx: 'pptx', xlsx: 'xlsx', csv: 'csv', tsv: 'csv', pdf: 'pdf', png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', stl: 'model3d', obj: 'model3d', glb: 'model3d', gltf: 'model3d', wav: 'audio', mp3: 'audio', m4a: 'audio', flac: 'audio', ogg: 'audio', mp4: 'video', mov: 'video', webm: 'video', mkv: 'video' }
export function detectKind (name, buf) {
  const ext = String(name).toLowerCase().split('.').pop(); if (EXT[ext]) return EXT[ext]
  if (buf.subarray(0, 4).toString('latin1') === 'PK\u0003\u0004') { try { const z = readZip(buf); if (z.names.includes('word/document.xml')) return 'docx'; if (z.names.some(n => n.startsWith('ppt/slides/'))) return 'pptx'; if (z.names.includes('xl/workbook.xml')) return 'xlsx' } catch {} }
  if (buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf'
  if (!buf.subarray(0, 4096).includes(0)) return 'text'
  return 'unknown'
}
const table = rows => rows.map(r => r.join('\t')).join('\n')
const NOT_READ = { image: 'The picture itself was not looked at: only its size is known. Describing it needs a vision model.', audio: 'No transcript: speaking and music were not heard. Transcribing needs a speech model, which is not connected.', video: 'No frames or transcript: the video was not watched or heard. That needs frame extraction plus a vision and speech model, which are not connected.', model3d: 'Only counts and size were read, not how the model looks.' }

export function describeFile (name, buf, { max = LIMITS.text } = {}) {
  const kind = detectKind(name, buf); const out = { name, kind, bytes: buf.length, summary: '', text: '', data: null, notes: [] }
  try {
    if (kind === 'docx') { const r = readDocx(buf); out.text = clip(r.text, max); out.summary = `Word document: ${r.paragraphs} paragraphs`; if (r.images) out.notes.push(r.images + ' image(s) inside were not read.') }
    else if (kind === 'pptx') { const r = readPptx(buf); out.text = clip(r.slides.map(s => `--- slide ${s.n} ---\n${s.text}${s.notes ? '\n[notes] ' + s.notes : ''}`).join('\n'), max); out.summary = `PowerPoint: ${r.slideCount} slides`; if (r.images) out.notes.push(r.images + ' picture(s) on the slides were not read.'); if (r.truncated) out.notes.push('Only the first ' + LIMITS.slides + ' slides were read.') }
    else if (kind === 'xlsx') { const r = readXlsx(buf); out.data = r; out.text = clip(r.sheets.map(s => `--- sheet ${s.name} (${s.rowCount} rows) ---\n${table(s.rows)}`).join('\n'), max); out.summary = `Excel: ${r.sheets.length} sheet(s): ` + r.sheets.map(s => `${s.name} (${s.rowCount} rows)`).join(', '); out.notes.push('Formulas show their last saved value; charts and images were not read.'); if (r.sheets.some(s => s.truncated)) out.notes.push('Large sheets are cut to ' + LIMITS.rows + ' rows and ' + LIMITS.cols + ' columns.') }
    else if (kind === 'csv') { const r = readCsv(buf.toString('utf8')); out.data = r; out.text = clip(table(r.rows), max); out.summary = `Table: ${r.rowCount} rows, ${r.rows[0] ? r.rows[0].length : 0} columns (delimiter ${JSON.stringify(r.delimiter)})`; if (r.truncated) out.notes.push('Cut to ' + LIMITS.rows + ' rows.') }
    else if (kind === 'pdf') { const r = readPdf(buf); out.text = clip(r.text, max); out.summary = `PDF: about ${r.pages} page(s), read with ${r.engine}`; out.notes.push(...r.notes) }
    else if (kind === 'image') { const r = readImageInfo(buf); out.data = r; out.summary = `Image: ${r.format}${r.width ? ` ${r.width} x ${r.height}` : ''}`; out.notes.push(NOT_READ.image) }
    else if (kind === 'model3d') {
      const ext = name.toLowerCase().split('.').pop()
      const r = ext === 'stl' ? readStl(buf) : ext === 'obj' ? readObj(buf.toString('utf8')) : ext === 'glb' ? readGlb(buf) : readGltf(JSON.parse(buf.toString('utf8')))
      out.data = r; out.summary = `3D model (${r.format}): ${r.triangles} triangles${r.size ? ', size ' + r.size.join(' x ') : ''}`; out.notes.push(NOT_READ.model3d, ...(r.notes || []))
    } else if (kind === 'audio' || kind === 'video') {
      let info = null; if (name.toLowerCase().endsWith('.wav')) { try { info = readWav(buf) } catch {} }
      const probe = probeMedia(buf); out.data = { ...(info || {}), ...(probe || {}) }
      const secs = out.data.seconds; out.summary = `${kind === 'audio' ? 'Audio' : 'Video'}${secs != null ? `, ${secs} s` : ''}${probe ? '' : ' (ffprobe is not installed, so only the header was read)'}`; out.notes.push(NOT_READ[kind])
    } else if (kind === 'text') { const t = buf.toString('utf8'); out.text = clip(t, max); out.summary = `Text: ${t.split('\n').length} lines` }
    else { out.summary = 'Unknown binary file'; out.notes.push('No reader for this file type, so nothing was read.') }
  } catch (e) { out.summary = 'Could not read this ' + kind + ' file'; out.notes.push(e.message) }
  return out
}
