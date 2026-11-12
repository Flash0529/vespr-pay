// Actual module + mount/event wiring; synthetic DOM/file handles only. No browser, device or network access.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mountWorkspaceExperience } from '../workspace-experience.js';

const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const settle=()=>new Promise(resolve=>setImmediate(resolve));

function fixture(t,picker){
 const nodes=new Map(),created=[],handlers=new Map(),notes=[],imports=[],opened=[];
 class Element {
  constructor(tag='div'){this.tagName=tag;this.dataset={};this.style={};this.attributes=new Map();this.events=new Map();this.value='';this.textContent='';this.children=[];this._html='';}
  set innerHTML(html){this._html=html;for(const [id,node]of nodes)if(node.owner===this)nodes.delete(id);for(const match of html.matchAll(/id="([^"]+)"/g)){const node=new Element();node.owner=this;nodes.set('#'+match[1],node);}}
  get innerHTML(){return this._html;}
  append(...items){this.children.push(...items);} after(){} replaceChildren(){this.children=[];}
  setAttribute(k,v){this.attributes.set(k,String(v));} hasAttribute(k){return this.attributes.has(k);}
  addEventListener(k,fn){this.events.set(k,fn);} querySelectorAll(){return [];} querySelector(){return null;}
  click(){} focus(){}
 }
 for(const id of ['app','openPal','nav','in','send','splitCodeBtn','chead','live','atray','quotes','feed','aiSearchChatBtn'])nodes.set('#'+id,new Element());
 nodes.set('.chat .hint',new Element());
 const document={documentElement:new Element(),body:new Element(),createElement(tag){const node=new Element(tag);created.push(node);return node;},
  querySelector:s=>nodes.get(s)||null,querySelectorAll:()=>[],addEventListener:(event,fn)=>handlers.set(event,fn)};
 const globals={document,window:{showDirectoryPicker:picker},localStorage:{getItem:()=>null,setItem(){}}};
 const previous=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
 for(const [key,value]of Object.entries(globals))Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
 t.after(()=>{for(const [key,descriptor]of previous)if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];});
 let account='account-a',workspace='workspace-a';
 const state={layout:'chat'},api={state,esc:s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;'),ic:()=>'',toast:s=>notes.push(s),
  accountId:()=>account,workspaceId:()=>workspace,files:()=>['cloud.js'],actor:()=> 'Fixture',read:()=>'',
  disconnect(){},destroyEditor(){},clearAttachments(){},setLayout:v=>{state.layout=v;},renderCodeChat(){},renderEditor(){},adEligible:()=>false,
  importFile:(...args)=>imports.push(args),openFile:p=>opened.push(p)};
 const mounted=mountWorkspaceExperience(api);mounted.setMode('code');mounted.showPage('files');
 const input=created.find(node=>node.tagName==='input');
 function click({dataset={},attributes=[]}={}){const button=new Element('button');button.dataset=dataset;for(const key of attributes)button.setAttribute(key,'');button.matches=()=>false;
  handlers.get('click')({target:{closest:()=>button},preventDefault(){},stopImmediatePropagation(){}});}
 return {mounted,nodes,notes,imports,opened,input,click,
  location:value=>click({dataset:{location:value}}),choose:()=>click({attributes:['data-folder-choose']}),entry:id=>click({dataset:{fileEntry:String(id)}}),
  import:()=>click({attributes:['data-file-import']}),scope:(a,w)=>{account=a;workspace=w;},
  rows:()=>nodes.get('#wxDirectory').innerHTML,breadcrumb:()=>nodes.get('#wxBreadcrumb').textContent,status:()=>nodes.get('#wxFileStatus').textContent};
}
function slowFolder(name,{error=false}={}){const started=deferred(),release=deferred();return {started,release,handle:{name,async *entries(){started.resolve();await release.promise;if(error)throw Error('old folder denied');yield ['late-local.txt',{kind:'file'}];}}};}
function folder(name,items){return {name,async *entries(){for(const item of items)yield item;}};}
function file(name,text){return {kind:'file',async getFile(){return {name,size:10,text:async()=>text};}};}

test('a pending local listing cannot add local files to a newer Cloud location',async t=>{
 const slow=slowFolder('Local A'),ui=fixture(t,async()=>slow.handle);ui.choose();await slow.started.promise;
 assert.equal(ui.breadcrumb(),'Local A');assert.match(ui.rows(),/Reading folder/);assert.doesNotMatch(ui.rows(),/data-file-entry|cloud\.js/);
 ui.location('cloud');await settle();assert.match(ui.rows(),/cloud\.js/);slow.release.resolve();await settle();
 assert.equal(ui.breadcrumb(),'Cloud workspace');assert.match(ui.rows(),/cloud\.js/);assert.doesNotMatch(ui.rows(),/late-local/);
});

test('a newer folder selection wins over an older listing and its error',async t=>{
 const slow=slowFolder('Local A',{error:true}),fresh=folder('Local B',[['fresh.txt',file('fresh.txt','fresh')]]);let calls=0;
 const ui=fixture(t,async()=>++calls===1?slow.handle:fresh);ui.choose();await slow.started.promise;ui.choose();await settle();
 assert.equal(ui.breadcrumb(),'Local B');assert.match(ui.rows(),/fresh\.txt/);slow.release.resolve();await settle();
 assert.equal(ui.breadcrumb(),'Local B');assert.match(ui.rows(),/fresh\.txt/);assert.doesNotMatch(ui.status(),/denied/);
});

test('a current folder error is still shown',async t=>{
 const slow=slowFolder('Local A',{error:true}),ui=fixture(t,async()=>slow.handle);ui.choose();await slow.started.promise;slow.release.resolve();await settle();
 assert.match(ui.status(),/Could not read this folder: old folder denied/);
});

test('two pending listings of the same folder still honor the latest generation',async t=>{
 const gates=[deferred(),deferred()],started=[deferred(),deferred()];let iteration=0;
 const handle={name:'Same folder',async *entries(){const at=iteration++;started[at].resolve();await gates[at].promise;yield [at?'latest.txt':'older.txt',{kind:'file'}];}};
 const ui=fixture(t,async()=>handle);ui.choose();await started[0].promise;ui.location('local');await started[1].promise;
 gates[1].resolve();await settle();assert.match(ui.rows(),/latest\.txt/);gates[0].resolve();await settle();assert.match(ui.rows(),/latest\.txt/);assert.doesNotMatch(ui.rows(),/older\.txt/);
});

test('leaving and reopening Files invalidates the earlier listing',async t=>{
 const slow=slowFolder('Local A'),ui=fixture(t,async()=>slow.handle);ui.choose();await slow.started.promise;
 ui.mounted.showPage('');ui.location('cloud');ui.mounted.showPage('files');await settle();slow.release.resolve();await settle();
 assert.equal(ui.breadcrumb(),'Cloud workspace');assert.doesNotMatch(ui.rows(),/late-local/);
});

test('a late picker cannot undo newer location or mode navigation',async t=>{
 const selected=deferred(),ui=fixture(t,()=>selected.promise);ui.choose();ui.location('cloud');
 selected.resolve(folder('Stale choice',[['stale.txt',file('stale.txt','stale')]]));await settle();assert.equal(ui.breadcrumb(),'Cloud workspace');assert.doesNotMatch(ui.rows(),/stale\.txt/);
 const second=deferred();window.showDirectoryPicker=()=>second.promise;ui.choose();ui.mounted.setMode('chat');ui.mounted.setMode('code');ui.mounted.showPage('files');
 second.resolve(folder('Other stale choice',[['stale-again.txt',file('stale-again.txt','stale')]]));await settle();assert.doesNotMatch(ui.rows(),/stale-again/);
});

test('listing and picker completion cannot cross account or workspace scope',async t=>{
 const slow=slowFolder('Local A'),ui=fixture(t,async()=>slow.handle);ui.choose();await slow.started.promise;
 ui.scope('account-b','workspace-b');const before=ui.rows();slow.release.resolve();await settle();assert.equal(ui.rows(),before);
 const choice=deferred();window.showDirectoryPicker=()=>choice.promise;ui.choose();ui.scope('account-c','workspace-c');
 choice.resolve(folder('Wrong scope',[['wrong.txt',file('wrong.txt','wrong')]]));await settle();assert.equal(ui.rows(),before);
});

test('a slower preview cannot replace a newer preview or import its content',async t=>{
 const textA=deferred(),handleA={kind:'file',async getFile(){return {name:'a.txt',size:10,text:()=>textA.promise};}};
 const ui=fixture(t,async()=>folder('Local',[['a.txt',handleA],['b.txt',file('b.txt','content B')]]));ui.choose();await settle();
 ui.entry(0);await settle();ui.entry(1);await settle();assert.match(ui.rows(),/content B/);textA.resolve('content A');await settle();
 assert.match(ui.rows(),/content B/);assert.doesNotMatch(ui.rows(),/content A/);ui.import();assert.deepEqual(ui.imports,[['b.txt','content B']]);
});

test('stale preview failure is quiet and a newer location clears import selection',async t=>{
 const pending=deferred(),ui=fixture(t,async()=>folder('Local',[['bad.txt',{kind:'file',getFile:()=>pending.promise}],['good.txt',file('good.txt','good')]]));
 ui.choose();await settle();ui.entry(0);ui.location('cloud');pending.reject(Error('stale preview failure'));await settle();assert.deepEqual(ui.notes,[]);assert.match(ui.rows(),/cloud\.js/);
 ui.location('local');await settle();ui.entry(1);await settle();assert.match(ui.rows(),/good/);ui.location('cloud');ui.import();assert.deepEqual(ui.imports,[]);
});

test('import and preview do not cross a changed scope',async t=>{
 const text=deferred(),ui=fixture(t,async()=>folder('Local',[['pending.txt',{kind:'file',async getFile(){return {name:'pending.txt',size:5,text:()=>text.promise};}}],['ready.txt',file('ready.txt','ready')]]));
 ui.choose();await settle();ui.entry(0);await settle();ui.scope('account-b','workspace-b');const before=ui.rows();text.resolve('wrong scope');await settle();assert.equal(ui.rows(),before);
 ui.entry(1);await settle();ui.scope('account-c','workspace-c');ui.import();assert.deepEqual(ui.imports,[]);
});

test('fallback folder input accepts only its current picker request',async t=>{
 const ui=fixture(t,undefined);ui.choose();ui.location('cloud');ui.input.files=[{name:'old.txt',webkitRelativePath:'Folder/old.txt',size:3,text:async()=> 'old'}];ui.input.events.get('change')();
 assert.match(ui.rows(),/cloud\.js/);assert.doesNotMatch(ui.rows(),/old\.txt/);
 ui.choose();ui.input.files=[{name:'chosen.txt',webkitRelativePath:'Folder/chosen.txt',size:3,text:async()=> 'chosen'}];ui.input.events.get('change')();
 assert.match(ui.rows(),/Folder\/chosen\.txt/);ui.entry(0);await settle();assert.match(ui.rows(),/chosen/);ui.import();assert.deepEqual(ui.imports,[['chosen.txt','chosen']]);
});

test('canceling a fallback chooser preserves previously selected files and their usable rows',async t=>{
 const ui=fixture(t,undefined);ui.choose();ui.input.files=[{name:'kept.txt',webkitRelativePath:'Folder/kept.txt',size:4,text:async()=> 'kept contents'}];ui.input.events.get('change')();
 assert.match(ui.rows(),/Folder\/kept\.txt/);ui.choose();ui.input.events.get('cancel')();await settle();
 assert.match(ui.rows(),/Folder\/kept\.txt/);assert.equal(ui.breadcrumb(),'This PC');
 ui.entry(0);await settle();assert.match(ui.rows(),/kept contents/);ui.import();assert.deepEqual(ui.imports,[['kept.txt','kept contents']]);
 ui.choose();ui.location('cloud');ui.input.events.get('cancel')();await settle();assert.match(ui.rows(),/cloud\.js/);assert.doesNotMatch(ui.rows(),/kept\.txt/);
});

test('canceling the current picker restores the still-current listing',async t=>{
 const slow=slowFolder('Local A'),ui=fixture(t,async()=>slow.handle);ui.choose();await slow.started.promise;
 window.showDirectoryPicker=async()=>{const error=Error('canceled');error.name='AbortError';throw error;};
 ui.choose();await settle();assert.match(ui.rows(),/Reading folder/);slow.release.resolve();await settle();assert.match(ui.rows(),/late-local/);assert.deepEqual(ui.notes,[]);
});

test('cloud opening and existing local preview bounds remain available',async t=>{
 const big={kind:'file',async getFile(){return {name:'big.txt',size:500001,text:async()=>{throw Error('must not read');}};}};
 const ui=fixture(t,async()=>folder('Local',[['big.txt',big],['binary.txt',file('binary.txt','a\0b')]]));
 ui.entry(0);assert.deepEqual(ui.opened,['cloud.js']);ui.mounted.showPage('files');ui.choose();await settle();ui.entry(0);await settle();ui.entry(1);await settle();
 assert.match(ui.notes[0],/too large/);assert.match(ui.notes[1],/binary/);assert.deepEqual(ui.imports,[]);
});
