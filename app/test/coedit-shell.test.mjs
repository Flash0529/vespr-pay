import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createContext,runInContext} from 'node:vm'
import {byId} from '../shortcuts.js'
const source=readFileSync(new URL('../prototype.html',import.meta.url),'utf8')
test('app has no embedded VS Code entry, iframe target or menu route',()=>{
 assert.doesNotMatch(source,/open-vscode|Full VS Code|judge1\.\$\{domain\}|127\.0\.0\.1:9400/)
})
test('agent following is not an app mode or a keyboard command',()=>{
 assert.equal(byId('follow'),null)
 assert.doesNotMatch(source,/followStored|toggleFollow|followPressed|id="follow"|import\('\.\/follow\.js'\)/)
})
test('legacy embedded-view navigation resolves to the built-in editor',()=>{
 const start=source.indexOf('function showView(v){'),end=source.indexOf('\nfunction setLayout',start)
 const context=createContext({state:{view:'editor'},NL:null,ide(){}})
 runInContext(source.slice(start,end),context);context.showView('ide')
 assert.equal(context.state.view,'editor')
})
function editContext(file='other.py'){
 const calls=[];const state={activeFile:'mine.py',liveDiffs:{},edit:{},cm:{file:'mine.py',handle:{markRecent:(...args)=>calls.push(['mark',...args])}}}
 const context=createContext({WX:null,state,logEvent:e=>calls.push(['log',e]),ide:()=>calls.push(['render']),followEdit:e=>{if(e.ai)state.activeFile=e.file},console})
 const named=source.indexOf('function handleWorkspaceEdit(e){')
 let code
 if(named>=0)code=source.slice(named,source.indexOf('\nasync function connectLive',named))
 else{const old=source.indexOf("liveClient.on('edit', e => {");assert.ok(old>=0);const end=source.indexOf('\n    });',old);code='function handleWorkspaceEdit(e){'+source.slice(old+"liveClient.on('edit', e => {".length,end)+'\n}'}
 runInContext(code,context)
 context.handleWorkspaceEdit({file,ai:true,by:'agent',at:0,added:'agent edit'})
 return {state,calls}
}
test('agent editing another file does not change the human active file',()=>{
 const actual=editContext();assert.equal(actual.state.activeFile,'mine.py');assert.equal(actual.state.liveDiffs['other.py'].added,'agent edit')
})
test('same-file agent edits preserve the mounted editor while recording attribution',()=>{
 const actual=editContext('mine.py');assert.equal(actual.state.activeFile,'mine.py');assert.equal(actual.calls.filter(x=>x[0]==='mark').length,1);assert.equal(actual.calls.filter(x=>x[0]==='log').length,1)
})
test('agent activity offers an explicit one-time file action, not a follow command',()=>{
 assert.match(source,/id="liveGo"[^>]*>Open file</)
 assert.doesNotMatch(source,/command\(\{\s*type:\s*'follow'/)
})
test('responsive updates preserve actual read-only rights in the built-in editor',()=>{
 const app={dataset:{sb:'on'}},showSidebar={},calls=[]
 const context=createContext({state:{cm:{file:'mine.py',handle:{setReadOnly:value=>calls.push(value)}}},isMobile:()=>false,myRight:()=>false,document:{body:{toggleAttribute(){}},getElementById:()=>null},$:selector=>selector==='#app'?app:showSidebar,syncMnav(){}})
 const start=source.indexOf('function applyMobile(){'),end=source.indexOf('\nfunction latestPreview',start)
 runInContext(source.slice(start,end),context);context.applyMobile()
 assert.equal(calls.at(-1),true)
})
