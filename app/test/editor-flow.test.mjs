import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createContext,runInContext} from 'node:vm'
const source=readFileSync(new URL('../prototype.html',import.meta.url),'utf8')
function extract(start,end){const a=source.indexOf(start),b=source.indexOf(end,a);assert.ok(a>=0&&b>a);return source.slice(a,b)}
function editor({state={},snapshot=null,text=null,mobile=false,right=true}={}){
 const input={value:'',selectionStart:0,selectionEnd:0,readOnly:false,setAttribute(){},removeAttribute(){},dispatchEvent(){},scrollTop:0}
 const nodes={liveEditorTextarea:input,liveGutter:{innerHTML:'',scrollTop:0},liveSaveBadge:{textContent:'',style:{}},stPos:{textContent:''}}
 const toasts=[];const context=createContext({WX:null,state,document:{getElementById:id=>nodes[id]},isMobile:()=>mobile,myRight:()=>right,liveSnap:()=>snapshot,liveClient:{read:()=>text},CODE_SURFACE:null,toast:t=>toasts.push(t),setTimeout:()=>{},Event:class{}})
 runInContext(extract('function fallbackEditorReadOnly(file)','\nfunction ide(){'),context)
 context.mountLiveInteractiveEditor('notes.md');return {context,input,nodes,toasts}
}
test('opening a stored project file shows its actual contents',()=>{
 assert.equal(editor({state:{fsStorage:{'project:notes.md':'Existing notes'}}}).input.value,'Existing notes')
})
test('an intentionally empty saved file stays empty despite an older draft',()=>{
 assert.equal(editor({state:{fsStorage:{'project:notes.md':''},fileStorage:{'notes.md':'Old'}}}).input.value,'')
})
test('system and project text remain in the selected scope',()=>{
 const state={fsScope:'system',fsStorage:{'project:notes.md':'Project','system:notes.md':'System'}}
 const actual=editor({state});assert.equal(actual.input.value,'System');actual.input.value='System edit';actual.input.oninput();assert.equal(state.fsStorage['system:notes.md'],'System edit');assert.equal(state.fsStorage['project:notes.md'],'Project')
})
test('live fallback shows the current workspace text instead of a stale local draft',()=>{
 const actual=editor({state:{fileStorage:{'notes.md':'Stale draft'}},snapshot:{files:['notes.md']},text:'Live text'})
 assert.equal(actual.input.value,'Live text');assert.equal(actual.input.readOnly,true)
})
test('read-only fallback cannot be modified with custom Tab/Enter handlers',()=>{
 const actual=editor({state:{fileStorage:{'notes.md':'Existing'}},mobile:true})
 for(const key of ['Tab','Enter'])actual.input.onkeydown({key,preventDefault(){}})
 assert.equal(actual.input.value,'Existing')
})
test('synthetic input cannot save a read-only fallback as a local draft',()=>{
 const state={fileStorage:{'notes.md':'Old'}};const actual=editor({state,snapshot:{files:['notes.md']},text:'Server'});actual.input.value='Synthetic';actual.input.oninput();assert.equal(state.fileStorage['notes.md'],'Old')
})
test('Ctrl+S on a local draft never claims a disk save',()=>{
 const actual=editor({state:{fileStorage:{'notes.md':'Draft'}}})
 actual.input.onkeydown({key:'s',ctrlKey:true,preventDefault(){}})
 assert.equal(/✓ Saved/.test(actual.nodes.liveSaveBadge.textContent),false)
})
async function run({snapshot=null,request=()=>'fixture-run'}={}){
 const output={innerHTML:'',scrollTop:0},calls=[],messages=[]
 const context=createContext({state:{activeFile:'notes.py'},document:{getElementById:id=>id==='termOut'?output:null},window:{},liveSnap:()=>snapshot,liveClient:{run:(...args)=>{calls.push(args);return request(...args)}},refreshTerm(){},toast:text=>messages.push(text),esc:x=>String(x),setTimeout:fn=>fn()})
 runInContext(extract('async function runIt(kind = \'file\'){','\nfunction fixRun('),context)
 await context.runIt('file');return {output,calls,messages}
}
test('Run without a workspace reports a connection requirement instead of fake success',async()=>{
 const actual=await run();assert.equal(actual.calls.length,0);assert.equal(/exit code 0|executed cleanly|Syntax verified/.test(actual.output.innerHTML),false);assert.ok(actual.messages.some(x=>/connect/i.test(x)))
})
test('Run requests once and leaves success/failure to actual workspace receipts',async()=>{
 const actual=await run({snapshot:{files:['notes.py'],runsEnabled:true,runs:[]}})
 assert.equal(actual.calls.length,1);assert.equal(/exit code 0|executed cleanly/.test(actual.output.innerHTML),false)
})
test('Run disabled by workspace does not create a run',async()=>{
 assert.equal((await run({snapshot:{files:['notes.py'],runsEnabled:false,runs:[]}})).calls.length,0)
})
test('a queued run is reused instead of duplicated',async()=>{
 const actual=await run({snapshot:{files:['notes.py'],runsEnabled:true,runs:[{kind:'file',file:'notes.py',status:'requested'}]}})
 assert.equal(actual.calls.length,0);assert.ok(actual.messages.some(x=>x.includes('already queued')))
})
test('missing selected file cannot create a file run',async()=>{
 assert.equal((await run({snapshot:{files:[],runsEnabled:true,runs:[]}})).calls.length,0)
})
test('request errors are visible rather than suppressed',async()=>{
 const actual=await run({snapshot:{files:['notes.py'],runsEnabled:true,runs:[]},request:()=>{throw Error('Fixture request rejected')}})
 assert.ok(actual.messages.some(x=>x.includes('Fixture request rejected')))
})
