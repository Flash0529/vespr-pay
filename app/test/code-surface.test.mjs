import test from 'node:test'
import assert from 'node:assert/strict'
import { codeMarkup } from '../code-surface.js'
import { MAX_CODE_LEN } from '../highlight.js'
import { readFileSync } from 'node:fs'

test('code gets distinct keyword, string, number, function and comment spans', () => {
  const markup=codeMarkup('const price = 12;\nfunction total() { return "paid"; }\n// note')
  for(const kind of ['k','s','n','f','c'])assert.match(markup,new RegExp('class="'+kind+'"'))
})
test('untrusted code is escaped, never interpreted as parent HTML', () => {
  const markup=codeMarkup('const x = "</pre><img src=x onerror=run()>";')
  assert.equal(markup.includes('<img'),false)
  assert.match(markup,/&lt;img/)
})
test('large and binary input falls back to visible plain text rather than truncating code', () => {
  assert.equal(codeMarkup('a'.repeat(MAX_CODE_LEN+1)),null)
  assert.equal(codeMarkup('a\0b'),null)
  assert.equal(codeMarkup(null),null)
})
test('empty input and trailing line remain representable', () => {
  assert.equal(codeMarkup(''),'\n')
  assert.equal(codeMarkup('a\n').replace(/<[^>]+>/g,''),'a\n\n')
})
const css=readFileSync(new URL('../presentation.css',import.meta.url),'utf8')
const luminance=hex=>hex.match(/[a-f\d]{2}/gi).map(v=>parseInt(v,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0)
for(const theme of ['light','dark'])test(theme+' syntax colors maintain normal-text contrast',()=>{
 const block=css.match(theme==='light'?/:root\s*\{([^}]+)\}/:/:root\[data-theme=dark\]\s*\{([^}]+)\}/)[1]
 const background=theme==='light'?1:0
 const colors=[...block.matchAll(/--code-[a-z]+:\s*(#[a-f\d]{6})/gi)]
 assert.equal(colors.length,6)
 for(const [,hex] of colors){const light=luminance(hex.slice(1)),ratio=(Math.max(light,background)+.05)/(Math.min(light,background)+.05);assert.ok(ratio>=4.5,theme+' '+hex+' contrast '+ratio)}
})
