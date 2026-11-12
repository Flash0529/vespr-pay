// File readers (R41): office files, PDFs, tables, 3D models, images and audio, built from generated fixtures. No network, no external programs required.
import assert from 'node:assert'
import zlib from 'node:zlib'
import { spawnSync } from 'node:child_process'
import { readZip, readDocx, readPptx, readXlsx, readCsv, readPdf, readImageInfo, readStl, readObj, readGlb, readWav, describeFile, detectKind } from '../src/readers.js'

// a tiny zip writer: stored and deflated entries
function zip (files, { flags = 0, lie } = {}) {
  const parts = []; const dir = []; let off = 0
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.from(content); const deflate = data.length > 40; const comp = deflate ? zlib.deflateRawSync(data) : data; const nb = Buffer.from(name)
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(flags, 6); lh.writeUInt16LE(deflate ? 8 : 0, 8); lh.writeUInt32LE(zlib.crc32(data), 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nb.length, 26)
    parts.push(lh, nb, comp)
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(flags, 8); ch.writeUInt16LE(deflate ? 8 : 0, 10); ch.writeUInt32LE(zlib.crc32(data), 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(lie || data.length, 24); ch.writeUInt16LE(nb.length, 28); ch.writeUInt32LE(off, 42)
    dir.push(ch, nb); off += lh.length + nb.length + comp.length
  }
  const cd = Buffer.concat(dir); const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16)
  return Buffer.concat([...parts, cd, end])
}

// zip basics and refusals
const z = readZip(zip({ 'a.txt': 'hello', 'b/long.txt': 'x'.repeat(500) }))
assert.deepStrictEqual(z.names, ['a.txt', 'b/long.txt']); assert.strictEqual(z.get('a.txt').toString(), 'hello'); assert.strictEqual(z.get('b/long.txt').length, 500); assert.strictEqual(z.get('nope'), null)
assert.throws(() => readZip(Buffer.from('not a zip at all, just text')), /not a zip/)
assert.throws(() => readZip(zip({ 'a.txt': 'hello' }, { flags: 1 })), /password/)
assert.throws(() => readZip(zip({ 'a.txt': 'hello' }, { lie: 100 * 1024 * 1024 })), /unpack to more than/)
assert.throws(() => readZip(zip({ 'a.txt': 'hello' }), { maxEntries: 0 }), /too many entries/)

// Word
const docx = zip({ '[Content_Types].xml': '<Types/>', 'word/document.xml': '<w:document><w:body><w:p><w:r><w:t>Quarterly plan &amp; budget</w:t></w:r></w:p><w:p><w:r><w:t xml:space="preserve">Revenue</w:t></w:r><w:r><w:tab/></w:r><w:r><w:t>40</w:t></w:r></w:p><w:p></w:p></w:body></w:document>', 'word/media/image1.png': 'x' })
const w = readDocx(docx); assert.strictEqual(w.text, 'Quarterly plan & budget\nRevenue\t40'); assert.strictEqual(w.paragraphs, 2); assert.strictEqual(w.images, 1)
assert.throws(() => readDocx(zip({ 'x.txt': 'y' })), /not a Word document/)

// PowerPoint, with speaker notes matched through the slide's relationships
const sl = t => `<p:sld><a:p><a:r><a:t>${t}</a:t></a:r></a:p></p:sld>`
const pptx = zip({
  'ppt/slides/slide2.xml': sl('Second &lt;slide&gt;'), 'ppt/slides/slide1.xml': sl('Title slide') + '<a:p><a:r><a:t>Subtitle</a:t></a:r></a:p>', 'ppt/slides/slide10.xml': sl('Tenth'),
  'ppt/slides/_rels/slide1.xml.rels': '<Relationships><Relationship Id="r1" Target="../notesSlides/notesSlide7.xml"/></Relationships>', 'ppt/notesSlides/notesSlide7.xml': '<p:notes><a:p><a:r><a:t>Say hello</a:t></a:r></a:p><a:p><a:r><a:t>1</a:t></a:r></a:p></p:notes>', 'ppt/media/pic.png': 'x'
})
const p = readPptx(pptx); assert.deepStrictEqual(p.slides.map(s => s.n), [1, 2, 10], 'numeric order'); assert.strictEqual(p.slides[0].text, 'Title slide\nSubtitle'); assert.strictEqual(p.slides[0].notes, 'Say hello'); assert.strictEqual(p.slides[1].text, 'Second <slide>'); assert.strictEqual(p.images, 1)

// Excel: shared strings, inline strings, numbers, booleans, a gap in the columns, a second sheet
const xlsx = zip({
  'xl/workbook.xml': '<workbook><sheets><sheet name="Sales &amp; Cost" sheetId="1" r:id="rId1"/><sheet name="Notes" sheetId="2" r:id="rId2"/></sheets></workbook>',
  'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>',
  'xl/sharedStrings.xml': '<sst><si><t>Item</t></si><si><t>Qty</t></si><si><r><t>Wid</t></r><r><t>get</t></r></si></sst>',
  'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="D1" t="b"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><f>3*4</f><v>12</v></c></row></sheetData></worksheet>',
  'xl/worksheets/sheet2.xml': '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>hello</t></is></c></row></sheetData></worksheet>'
})
const x = readXlsx(xlsx); assert.deepStrictEqual(x.sheets.map(s => s.name), ['Sales & Cost', 'Notes'])
assert.deepStrictEqual(x.sheets[0].rows, [['Item', 'Qty', '', 'TRUE'], ['Widget', '12']]); assert.deepStrictEqual(x.sheets[1].rows, [['hello']])

// CSV: quotes, embedded delimiters and newlines, escaped quotes, semicolon files
const c = readCsv('name,note\n"Smith, J","said ""hi""\nthere"\nlee,ok\n'); assert.strictEqual(c.delimiter, ','); assert.deepStrictEqual(c.rows, [['name', 'note'], ['Smith, J', 'said "hi"\nthere'], ['lee', 'ok']])
assert.strictEqual(readCsv('a;b;c\n1;2;3').delimiter, ';'); assert.strictEqual(readCsv('a;b;c\r\n1;2;3\r\n').rowCount, 2)
assert.strictEqual(readCsv(Array.from({ length: 300 }, (_, i) => i).join('\n')).truncated, true)

// PDF: basic reader (compressed and plain streams, TJ arrays, escapes); real engine used when pdftotext exists
const pdfStream = '1 0 obj\n<< /Type /Page >>\nendobj\nBT /F1 12 Tf (Hello \\(PDF\\) world) Tj [(Sp) -20 (lit)] TJ ET'
const pdf = Buffer.concat([Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Page >>\nendobj\n2 0 obj\n<< /Filter /FlateDecode /Length 10 >>\nstream\n'), zlib.deflateSync(Buffer.from(pdfStream)), Buffer.from('\nendstream\nendobj\n%%EOF')])
const pr = readPdf(pdf); assert.ok(pr.pages >= 1)
if (pr.engine === 'basic') { assert.match(pr.text, /Hello \(PDF\) world/); assert.match(pr.text, /Split/); assert.ok(pr.notes.length) } else assert.match(pr.text, /Hello/)
const empty = readPdf(Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Page >>\nendobj\n%%EOF')); assert.strictEqual(empty.text, ''); assert.match(empty.notes[0], /OCR|No text/)
assert.throws(() => readPdf(Buffer.from('hello')), /not a PDF/)

// images
const png = Buffer.alloc(33); Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png); png.writeUInt32BE(640, 16); png.writeUInt32BE(480, 20)
assert.deepStrictEqual(readImageInfo(png), { format: 'png', width: 640, height: 480 })
const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x01, 0xe0, 0x02, 0x80, 0x03, 0, 0, 0]); assert.deepStrictEqual(readImageInfo(jpg), { format: 'jpeg', height: 480, width: 640 })
const gif = Buffer.concat([Buffer.from('GIF89a'), Buffer.from([0x20, 0x00, 0x10, 0x00])]); assert.deepStrictEqual(readImageInfo(gif), { format: 'gif', width: 32, height: 16 })
assert.throws(() => readImageInfo(Buffer.from('nope')), /not a PNG/)

// 3D: binary STL, ASCII STL, OBJ, GLB
const stl = Buffer.alloc(84 + 50 * 2); stl.writeUInt32LE(2, 80); [[0, 0, 0, 2, 0, 0, 0, 3, 0], [0, 0, 1, 2, 0, 1, 0, 3, 1]].forEach((t, i) => t.forEach((v, k) => stl.writeFloatLE(v, 84 + i * 50 + 12 + k * 4)))
const s1 = readStl(stl); assert.strictEqual(s1.format, 'stl-binary'); assert.strictEqual(s1.triangles, 2); assert.deepStrictEqual(s1.size, [2, 3, 1])
const s2 = readStl(Buffer.from('solid t\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 4 0 0\nvertex 0 5 0\nendloop\nendfacet\nendsolid t')); assert.strictEqual(s2.format, 'stl-ascii'); assert.strictEqual(s2.triangles, 1); assert.deepStrictEqual(s2.size, [4, 5, 0])
assert.throws(() => readStl(Buffer.from('random bytes here')), /not an STL/)
const o = readObj('v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nf 1 2 3 4\nf 1 3 4\n'); assert.strictEqual(o.vertices, 4); assert.strictEqual(o.triangles, 3); assert.deepStrictEqual(o.size, [1, 1, 0]); assert.throws(() => readObj('hello'), /no vertices/)
const glbJson = Buffer.from(JSON.stringify({ asset: { version: '2.0' }, meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }, { attributes: { POSITION: 0 }, mode: 1 }] }], nodes: [{}, {}], materials: [{}], accessors: [{ count: 8, min: [-1, -2, -3], max: [1, 2, 3] }, { count: 36 }] }))
const pad = Buffer.concat([glbJson, Buffer.alloc((4 - glbJson.length % 4) % 4, 0x20)]); const hdr = Buffer.alloc(20); hdr.write('glTF', 0); hdr.writeUInt32LE(2, 4); hdr.writeUInt32LE(20 + pad.length, 8); hdr.writeUInt32LE(pad.length, 12); hdr.write('JSON', 16)
const g = readGlb(Buffer.concat([hdr, pad])); assert.strictEqual(g.format, 'glb'); assert.strictEqual(g.triangles, 12, 'line-mode primitives are not counted'); assert.deepStrictEqual(g.size, [2, 4, 6]); assert.strictEqual(g.nodes, 2); assert.throws(() => readGlb(Buffer.from('x'.repeat(30))), /not a GLB/)

// audio: WAV header duration (1 s, 8 kHz, mono, 8-bit)
const wavData = Buffer.alloc(8000, 128); const wh = Buffer.alloc(44); wh.write('RIFF', 0); wh.writeUInt32LE(36 + wavData.length, 4); wh.write('WAVEfmt ', 8); wh.writeUInt32LE(16, 16); wh.writeUInt16LE(1, 20); wh.writeUInt16LE(1, 22); wh.writeUInt32LE(8000, 24); wh.writeUInt32LE(8000, 28); wh.writeUInt16LE(1, 32); wh.writeUInt16LE(8, 34); wh.write('data', 36); wh.writeUInt32LE(wavData.length, 40)
const wav = Buffer.concat([wh, wavData]); const wi = readWav(wav); assert.deepStrictEqual([wi.sampleRate, wi.channels, wi.bits, wi.seconds], [8000, 1, 8, 1])

// the single entry point: kinds, summaries, honest notes, bad input never throws
assert.strictEqual(detectKind('report', docx), 'docx'); assert.strictEqual(detectKind('noext', pdf), 'pdf'); assert.strictEqual(detectKind('notes.txt', Buffer.from('hi')), 'text'); assert.strictEqual(detectKind('blob', Buffer.from([1, 0, 2])), 'unknown')
let d = describeFile('plan.docx', docx); assert.strictEqual(d.kind, 'docx'); assert.match(d.summary, /2 paragraphs/); assert.ok(d.notes.some(n => /image/.test(n)))
d = describeFile('deck.pptx', pptx); assert.match(d.text, /--- slide 1 ---\nTitle slide\nSubtitle\n\[notes\] Say hello/)
d = describeFile('data.xlsx', xlsx); assert.match(d.summary, /2 sheet/); assert.match(d.text, /Widget\t12/); assert.ok(d.notes.some(n => /Formulas/.test(n)))
d = describeFile('pic.png', png); assert.match(d.summary, /640 x 480/); assert.ok(d.notes.some(n => /not looked at/.test(n)))
d = describeFile('hood.stl', stl); assert.match(d.summary, /2 triangles, size 2 x 3 x 1/)
d = describeFile('clip.wav', wav); assert.match(d.summary, /1 s/); assert.ok(d.notes.some(n => /No transcript/.test(n)))
d = describeFile('movie.mp4', Buffer.from('not really a video')); assert.strictEqual(d.kind, 'video'); assert.ok(d.notes.some(n => /not watched/.test(n)), 'says plainly it did not watch it')
d = describeFile('broken.docx', Buffer.from('this is not a zip')); assert.match(d.summary, /Could not read/); assert.match(d.notes[0], /not a zip/)
d = describeFile('x.bin', Buffer.from([0, 1, 2, 3])); assert.match(d.summary, /Unknown binary/)
d = describeFile('big.txt', Buffer.from('a'.repeat(30000)), { max: 100 }); assert.ok(d.text.length < 200); assert.match(d.text, /more characters not shown/)

// real ffprobe, only when it is installed
if (spawnSync('ffprobe', ['-version']).status === 0) { const m = describeFile('clip.wav', wav); assert.ok(Math.abs(m.data.seconds - 1) < 0.1) }
console.log('readers tests passed')
