import { openVersionIndex, safeHistoryPath } from './version-index.js';
import { createPersonalStore } from './personal-chats.js';
import { sha256Hex } from './sha256.js';

// UI over explicit adapters. No arbitrary filesystem, workspace or model capability is attached to personal chat.
export function mountWorkspaceExperience(api) {
 const $=s=>document.querySelector(s), state=api.state;
 let mode='chat',page='',index=null,indexScope='',opening=null,epoch=0,selected=null,results=[],lastPrompt='',watch=null,timer=null,location='cloud',entries=[],folder=[],fileSelection=null,historyKind='versions';
 const esc=api.esc,codeHint=document.querySelector('.chat .hint')?.textContent||'',timers=new Map(),drafts={code:'',chat:''};
 const panel=document.createElement('section');panel.className='workspace-page';panel.id='workspacePage';panel.hidden=true;$('#app').append(panel);
 const nav=document.createElement('div');nav.className='workspace-nav';nav.innerHTML='<button data-workspace-page="history">'+api.ic('clock')+'History</button><button data-workspace-page="files">'+api.ic('folder')+'Files</button>';$('#nav').after(nav);
 const picker=document.createElement('input');picker.type='file';picker.multiple=true;picker.setAttribute('webkitdirectory','');picker.hidden=true;document.body.append(picker);
 const scope=()=>JSON.stringify([api.accountId(),mode==='chat'?'personal':api.workspaceId()]);
 let filesEpoch=0,pickerRequest=null,readingRequest=null;
 const filesNotice='Folders are not uploaded automatically. Network locations keep the computer’s existing access rules.';
 function invalidateFiles(){filesEpoch++;fileSelection=null;pickerRequest=null;readingRequest=null;}
 function filesRequest(){invalidateFiles();return {generation:filesEpoch,scope:scope(),mode,location,handle:folder.at(-1)};}
 function filesCurrent(request){return request&&page==='files'&&request.generation===filesEpoch&&request.mode===mode&&request.scope===scope()&&request.location===location&&request.handle===folder.at(-1);}
 function publishFiles(request,next,breadcrumb,status=filesNotice){
  if(!filesCurrent(request))return;
  entries=next;readingRequest=null;$('#wxBreadcrumb').textContent=breadcrumb;$('#wxFileStatus').textContent=status;
  $$('[data-location]').forEach(b=>b.setAttribute('aria-current',String(b.dataset.location===location)));renderFileRows();
 }
 function resumeFiles(request){
  if(!filesCurrent(request))return;
  // The directory-input fallback has File objects, not a handle that can be enumerated again.
  if(request.location==='local'&&!request.handle)return publishFiles(filesRequest(),entries,'This PC');
  return listLocation();
 }
 const hash=text=>sha256Hex(text);
 const say=t=>api.toast(t);
 async function historyIndex(){
  const raw=scope(),target=await hash(raw);if(raw!==scope())throw Error('History scope changed; try again');if(index&&indexScope===target)return index;
  if(opening?.target===target)return opening.promise;
  const generation=++epoch;index?.close();index=null;indexScope=target;
  const promise=openVersionIndex(target).then(opened=>{if(generation!==epoch||raw!==scope()){opened.close();throw Error('History scope changed; try again');}index=opened;return index;});opening={target,promise};
  try{return await promise;}finally{if(opening?.promise===promise)opening=null;}
 }
 async function record(path,text,label=lastPrompt||'Edit checkpoint'){
  if(mode!=='code'||!safeHistoryPath(path))return;
  const raw=scope();let db;try{db=await historyIndex();}catch(e){if(raw!==scope())return;throw e;}if(raw!==scope()||mode!=='code')return;
  await db.record({path,text,label,by:api.actor()});
 }
 function capture(path){
  if(mode!=='code')return;clearTimeout(timers.get(path));const raw=scope();timers.set(path,setTimeout(()=>{timers.delete(path);if(raw===scope()&&mode==='code')record(path,api.read(path)).catch(e=>say('History: '+e.message));},700));
 }
 function watchFile(path,ytext){
  watch?.();watch=null;if(mode!=='code')return;
  record(path,ytext?ytext.toString():api.read(path),'File opened').catch(e=>say('History: '+e.message));
  if(ytext){const changed=()=>capture(path);ytext.observe(changed);watch=()=>ytext.unobserve(changed);}
 }
 function showPage(next){
  invalidateFiles();
  page=next;panel.hidden=!next;$('#app').dataset.page=next;nav.querySelectorAll('button').forEach(b=>b.setAttribute('aria-current',b.dataset.workspacePage===next?'page':'false'));
  if(next==='history')return renderHistory();if(next==='files')return renderFiles();
 }
 function setMode(next){
  if(!['code','chat'].includes(next))return;const changed=mode!==next;
  if(changed){drafts[mode]=$('#in').value;$('#in').value=drafts[next];$('#send').disabled=!drafts[next].trim();}
  if(changed&&mode==='code'&&index)for(const path of timers.keys())if(safeHistoryPath(path))index.record({path,text:api.read(path),label:lastPrompt||'Mode switch checkpoint',by:api.actor()}).catch(e=>say('History: '+e.message));
  mode=next;state.productMode=mode;document.documentElement.dataset.productMode=mode;
  $$('button[data-product-mode]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.productMode===mode)));
  $('#splitCodeBtn').hidden=mode!=='code';showPage('');
  if(changed){watch?.();watch=null;for(const t of timers.values())clearTimeout(t);timers.clear();index?.close();index=null;indexScope='';epoch++;selected=null;results=[];fileSelection=null;entries=[];folder=[];}
  if(mode==='chat'){
   // Chat is the conversation view of the same work: the layout drops the editor, nothing is disconnected. Without a workspace it is a personal AI chat saved on this device;
   // with one it is the workspace conversation (agents, files, runner, all the dev features).
   api.setLayout('chat');if(api.hasWorkspace&&api.hasWorkspace()){api.renderCodeChat();}else renderPersonal();
  }else {$('#in').placeholder='Work with your coding agents and teammates';api.setLayout('split');api.renderCodeChat();api.renderEditor();}
  if(changed){try{api.chatsChanged&&api.chatsChanged();}catch{}} // the sidebar lists different things in Chat and Code
  const hint=$('.chat .hint');if(hint)hint.textContent=mode==='chat'&&!(api.hasWorkspace&&api.hasWorkspace())?'Ask anything. Connect a workspace to give the AI your files and tools. This chat is saved on this device.':codeHint;
  syncSplit();
 }
 const $$=s=>[...document.querySelectorAll(s)];
 function syncSplit(){const b=$('#splitCodeBtn');b.setAttribute('aria-pressed',String(state.layout==='split'));b.textContent=state.layout==='split'?'Hide chat pane':'Show chat pane';}
 // Personal Chat: every chat is its own thread, saved on this device (app/personal-chats.js). A reply comes from window.VESPR_PERSONAL_AI(messages) when the host provides one;
 // without it the thread says plainly that no model is connected (nothing is pretended). Chat never touches a workspace, and workspace agent APIs never receive a personal prompt.
 let pstore=null,pscope='',thinking=false;
 function ps(){const id=String(api.accountId());if(!pstore||pscope!==id){pstore=createPersonalStore(localStorage,id);pscope=id;}return pstore;}
 const personalBox=()=>{const t=ps().active();return t?t.messages:[];};
 // the composer's placeholder and the line under it say what this conversation is: a personal AI chat (no workspace) or the workspace conversation
 function syncComposer(){const ws=!!(api.hasWorkspace&&api.hasWorkspace());const personal=mode==='chat'&&!ws;const inp=$('#in');if(inp)inp.placeholder=personal?'Ask, write or plan — personal chat':'Work with your coding agents and teammates';const hint=$('.chat .hint');if(hint)hint.textContent=personal?'Ask anything. Connect a workspace to give the AI your files and tools. This chat is saved on this device.':codeHint;}
 function renderPersonal(){
  if(mode!=='chat')return;const t=ps().active();
  $('#chead').innerHTML='<h2>'+esc(t?t.title:'New chat')+'</h2><span class="sp"></span><span class="wx-scope">Saved on this device</span><button class="btn" data-personal-new>New chat</button>';
  $('#live').hidden=true;$('#atray').replaceChildren();$('#quotes').replaceChildren();
  const msgs=personalBox();
  if(!msgs.length){const sponsored=api.adEligible();$('#feed').innerHTML='<div class="wx-home">'+(sponsored?'<span class="wx-promo">VESPR promotion</span>':'')+'<h1>What would you like<br>to work on?</h1><p>Ask anything, or connect a workspace so the AI can work in your files, run your code and work with your team.</p>'+(sponsored?'<button data-upgrade>Explore paid plans</button><small>Start a conversation below to leave this screen.</small>':'')+'</div>';}else{
   $('#feed').innerHTML=msgs.map(m=>'<article class="wx-personal-message '+(m.role==='user'?'user':'')+'"><small>'+(m.role==='user'?'You':m.role==='assistant'?'VESPR':'Personal service')+'</small>'+esc(m.text)+'</article>').join('')+(thinking?'<article class="wx-personal-message" role="status"><small>VESPR</small><span class="wx-thinking">Thinking…</span></article>':'');$('#feed').scrollTop=1e9;
  }
  syncComposer();
  try{api.chatsChanged&&api.chatsChanged();}catch{}
 }
 async function personalSend(){
  if(mode!=='chat')return false;const input=$('#in'),text=input.value.trim();if(!text)return true;
  if(thinking){say('Wait for the reply before sending another message.');return true;}
  const ctxNames=typeof window.VESPR_CHAT_CONTEXT==='function'?window.VESPR_CHAT_CONTEXT():[];const saved=ctxNames.length?text+'\n[Added: '+ctxNames.join(', ')+']':text;
  const r=ps().append(saved,'user');
  if(!r.ok){say(r.reason==='long'?'Please keep a personal message under 12,000 characters.':r.reason==='full'?'Start a new chat to keep going: this one is full.':'This message could not be saved on this device.');return true;}
  if(ctxNames.length)window.VESPR_CHAT_CONTEXT_CLEAR();
  input.value='';input.style.height='auto';$('#send').disabled=true;
  const ask=window.VESPR_PERSONAL_AI;
  if(typeof ask!=='function'){ps().append('No model is connected to personal Chat in this build. Your message is saved here; it was not sent to a company workspace or provider.','notice');renderPersonal();return true;}
  thinking=true;renderPersonal();const id=r.id;
  try{const reply=await ask(ps().history(id));if(typeof reply!=='string'||!reply.trim())throw new Error('empty reply');ps().setActive(id);ps().append(reply.slice(0,20000),'assistant');}
  catch(e){ps().setActive(id);ps().append('The model did not answer ('+String(e&&e.message||e).slice(0,120)+'). Your message is saved; try again.','notice');}
  thinking=false;renderPersonal();return true;
 }
 async function renderHistory(){
  panel.innerHTML='<header class="wx-head"><div><h1>History</h1><p>Find conversations and recover the code behind them.</p></div><span class="sp"></span><button data-history-export>Export history</button><button data-history-clear>Clear this history</button><button data-page-close>Back to '+(mode==='code'?'Code':'Chat')+'</button></header><div class="wx-body"><aside class="wx-assistant"><h2>History assistant</h2><p>Search saved checkpoints on this device. A dedicated model is not connected yet.</p><label for="wxHistoryQuery">What are you looking for?</label><input id="wxHistoryQuery" placeholder="The version without integrals"><label for="wxHistorySnippet">Code reference (optional)</label><textarea id="wxHistorySnippet" placeholder="Paste a small part of the code"></textarea><button data-history-search>Find version</button> <button data-history-reference>Use editor selection</button><p id="wxHistoryAnswer" class="wx-answer" role="status" aria-live="polite">Checking saved history…</p></aside><section class="wx-preview" aria-label="Version preview"><header><b id="wxVersionTitle">Select a version</b><span class="sp"></span><button data-history-copy disabled>Copy code</button><button data-history-recover disabled>Recover as a new file</button></header><small id="wxVersionMeta">Your current files are never overwritten here.</small><pre id="wxVersionCode" tabindex="0">Saved code will appear here.</pre></section><aside class="wx-versions"><h2>Version history</h2><div id="wxVersions"></div></aside></div><footer class="wx-notice">Local checkpoints: up to 160 versions / 12 MB per account and workspace; up to 500,000 characters per file. Recorded after a pause in editing. Older Git history is not imported. Secret-shaped filenames excluded; content is not a secret scan.</footer>';
  try{const db=await historyIndex();if(page!=='history')return;
   if(mode==='chat'){$('#wxHistoryAnswer').textContent='Personal conversations only. Switch to Code to search workspace versions.';results=db.list().slice().reverse().map(version=>({version,reason:'Archived personal conversation.'}));paintVersions();if(!results.length)$('#wxVersionCode').textContent=personal.map(m=>m.role+': '+m.text).join('\n\n')||'No personal conversation yet.';return;}
   results=db.list().filter(r=>historyKind==='conversations'?r.path.startsWith('.conversations/'):!r.path.startsWith('.conversations/')).slice().reverse().map(version=>({version,reason:'Saved '+(historyKind==='conversations'?'conversation':'edit checkpoint')+'.'}));paintVersions();$('#wxHistoryAnswer').textContent=results.length?'Search these recorded versions, or use selected code to narrow the file.':'No recorded '+historyKind+' yet. Open and edit a Code file or send a workspace message to begin. Earlier history is unavailable.';
   const tabs=document.createElement('div');tabs.className='seg';tabs.setAttribute('role','group');tabs.setAttribute('aria-label','History type');tabs.innerHTML='<button data-history-kind="versions" aria-pressed="'+(historyKind==='versions')+'">Versions</button><button data-history-kind="conversations" aria-pressed="'+(historyKind==='conversations')+'">Conversations</button>';panel.querySelector('.wx-head').append(tabs);
  }catch(e){if(page==='history')$('#wxHistoryAnswer').textContent='History storage unavailable: '+e.message;}
 }
 function paintVersions(){
  $('#wxVersions').innerHTML=results.map((r,i)=>'<button class="wx-version" data-version="'+i+'" aria-selected="false"><span>'+esc(r.version.path)+'</span><small>'+esc(new Date(r.version.at).toLocaleString())+'</small><small>'+esc(r.version.label)+'</small></button>').join('');if(results.length)selectVersion(0);else{selected=null;$('#wxVersionTitle').textContent='No matching version';$('#wxVersionMeta').textContent='No saved text selected.';$('#wxVersionCode').textContent='No matching recorded version.';$$('[data-history-copy],[data-history-recover]').forEach(b=>b.disabled=true);}
 }
 function selectVersion(i){selected=results[i];if(!selected)return;$$('[data-version]').forEach(b=>b.setAttribute('aria-selected',String(+b.dataset.version===i)));$('#wxVersionTitle').textContent=selected.version.path;$('#wxVersionCode').textContent=selected.version.text;$('#wxVersionMeta').textContent=new Date(selected.version.at).toLocaleString()+' · '+selected.version.by+' · SHA-256 '+selected.version.hash.slice(0,12);$('#wxHistoryAnswer').textContent=selected.reason;$$('[data-history-copy],[data-history-recover]').forEach(b=>b.disabled=false);$('[data-history-recover]').disabled=selected.version.path.startsWith('.conversations/');}
 async function searchHistory(){
  if(mode==='chat'){const q=$('#wxHistoryQuery').value.trim().toLowerCase(),db=await historyIndex();results=db.list().filter(v=>v.text.toLowerCase().includes(q)).reverse().map(version=>({version,reason:'Matching archived personal conversation.'}));paintVersions();if(!results.length)$('#wxVersionCode').textContent=personal.filter(m=>m.text.toLowerCase().includes(q)).map(m=>m.role+': '+m.text).join('\n\n')||'No personal conversation matches.';return;}
  const db=await historyIndex();results=db.search({query:$('#wxHistoryQuery').value,snippet:$('#wxHistorySnippet').value,kind:historyKind});paintVersions();if(!results.length)$('#wxHistoryAnswer').textContent='No recorded match. The earlier version may predate recording or have expired. No version was guessed.';
 }
 function recover(){
  if(mode!=='code'||!selected)return;const p=selected.version.path,at=p.lastIndexOf('.'),name=(at>0?p.slice(0,at):p)+'.recovered-'+Date.now()+(at>0?p.slice(at):'');
  api.recover(name,selected.version.text);showPage('');
 }
 function renderFiles(){
  panel.innerHTML='<header class="wx-head"><div><h1>Files</h1><p>One place for your workspace and folders you choose.</p></div><span class="sp"></span><button data-page-close>Back to '+(mode==='code'?'Code':'Chat')+'</button></header><div class="wx-toolbar"><button data-folder-back aria-label="Parent folder">↑</button><b id="wxBreadcrumb">Cloud workspace</b><button data-folder-choose>Choose folder…</button><input id="wxFileSearch" aria-label="Filter files" placeholder="Search this folder"></div><div class="wx-files-body"><nav class="wx-locations" aria-label="File locations"><button data-location="home">⌂ Home</button><button data-location="cloud">☁ Cloud workspace</button><small>This computer</small><button data-location="local">▣ This PC</button><button data-location="network">▣ Network & NAS</button><button data-location="linux">▣ Linux</button><button data-location="devices">▣ Connected devices</button></nav><section id="wxDirectory" class="wx-directory" aria-label="Files in location"></section></div><footer class="wx-notice" id="wxFileStatus">Folders are not uploaded automatically. Network locations keep the computer’s existing access rules.</footer>';
  listLocation();
 }
 async function chooseFolder(){
  if(mode!=='code'){say('Switch to Code before granting file access.');return;}
  const request=filesRequest();
  try{if(typeof window.showDirectoryPicker==='function'){const handle=await window.showDirectoryPicker({mode:'read'});if(!filesCurrent(request))return;folder=[handle];location='local';await listLocation();}else{pickerRequest=request;picker.click();}}catch(e){if(!filesCurrent(request))return;if(e.name!=='AbortError')say('Folder access unavailable: '+e.message);await resumeFiles(request);}
 }
 picker.addEventListener('change',()=>{
  const request=pickerRequest,next=[...picker.files].slice(0,2000).map(file=>({name:file.webkitRelativePath||file.name,kind:'file',file}));picker.value='';
  if(!filesCurrent(request)||mode!=='code')return;
  folder=[];location='local';publishFiles(filesRequest(),next,'This PC');
 });
 picker.addEventListener('cancel',()=>resumeFiles(pickerRequest));
 async function listLocation(){
  if(page!=='files')return;
  const request=filesRequest(),next=[];let breadcrumb,status=filesNotice;entries=[];
  if(request.location==='cloud'){
   breadcrumb='Cloud workspace';if(mode==='code')for(const name of api.files())next.push({name,kind:'file',cloud:true});
  }else if(request.location==='local'&&request.handle&&mode==='code'){
   breadcrumb=folder.map(f=>f.name).join(' / ');
   publishFiles(request,[],breadcrumb);readingRequest=request;renderFileRows();
   try{for await(const [name,item]of request.handle.entries()){if(!filesCurrent(request))return;if(next.length>=2000)break;next.push({name,kind:item.kind,handle:item});}}
   catch(e){if(!filesCurrent(request))return;status='Could not read this folder: '+e.message;}
  }else breadcrumb={home:'Home',local:'This PC',network:'Network & NAS',linux:'Linux',devices:'Connected devices'}[request.location]||request.location;
  publishFiles(request,next,breadcrumb,status);
 }
 function renderFileRows(){
  if(page!=='files')return;if(filesCurrent(readingRequest)){$('#wxDirectory').innerHTML='<div class="wx-empty" role="status">Reading folder…</div>';return;}
  const q=$('#wxFileSearch').value.toLowerCase(),visible=entries.map((entry,id)=>({entry,id})).filter(({entry})=>entry.name.toLowerCase().includes(q)).sort((a,b)=>a.entry.kind===b.entry.kind?a.entry.name.localeCompare(b.entry.name):a.entry.kind==='directory'?-1:1);
  $('#wxDirectory').innerHTML=visible.length?'<div class="wx-file-row"><b>Name</b><small>Type</small><small>Location</small></div>'+visible.map(({entry:e,id})=>'<button class="wx-file-row" data-file-entry="'+id+'"><span>'+api.ic(e.kind==='directory'?'folder':'file')+' '+esc(e.name)+'</span><small>'+esc(e.kind==='directory'?'Folder':e.name.split('.').pop().toUpperCase()+' file')+'</small><small>'+(e.cloud?'Cloud':'This device')+'</small></button>').join(''):'<div class="wx-empty"><h2>'+(mode==='chat'?'Files belong in Code':location==='cloud'?'Connect a workspace':'Choose what to connect')+'</h2><p>'+(mode==='chat'?'Chat has no code, company drive or runner access. Use Code to browse those files.':location==='cloud'?'Connect your cloud workspace to browse its files here.':'Choose a local folder or an already accessible network share using the system folder picker. Drives, phones, NAS and Linux are not automatically scanned or connected.')+'</p><button class="btn" data-folder-choose>Choose folder…</button></div>';
 }
 async function openEntry(id){
  const e=entries[id];if(!e||mode!=='code')return;if(e.cloud){api.openFile(e.name);showPage('');return;}
  if(e.kind==='directory'){folder.push(e.handle);return listLocation();}
  const request=filesRequest();
  try{
   const f=e.file||await e.handle.getFile();if(!filesCurrent(request))return;if(f.size>500000){say('This file is too large for the text preview.');return;}
   if(!safeHistoryPath(e.name)){say('This file is excluded from code preview.');return;}
   const text=await f.text();if(!filesCurrent(request))return;if(text.includes('\0')){say('This binary file cannot be previewed as text.');return;}
   fileSelection={name:f.name,text,request};$('#wxDirectory').innerHTML='<section class="wx-preview"><header><b>'+esc(f.name)+'</b><span class="sp"></span><button data-file-import>Copy into cloud workspace</button><button data-file-list>Back to files</button></header><small>Read-only local preview. Nothing has been uploaded.</small><pre>'+esc(text)+'</pre></section>';
  }catch(e){if(filesCurrent(request))throw e;}
 }
 document.addEventListener('input',e=>{if(e.target.id==='wxFileSearch')renderFileRows();});
 document.addEventListener('keydown',e=>{if(e.target.id==='wxHistoryQuery'&&e.key==='Enter'){e.preventDefault();searchHistory().catch(e=>say(e.message));}if(e.key==='Escape'&&page){showPage('');$('#openPal').focus();}});
 document.addEventListener('click',e=>{
  const t=e.target.closest('button');if(!t)return;
  if(t.id==='histBtn'){e.preventDefault();e.stopImmediatePropagation();showPage('history');return;}
  if(t.id==='aiSearchChatBtn'){e.preventDefault();e.stopImmediatePropagation();const q=$('#chatSearchInput').value;Promise.resolve(showPage('history')).then(()=>{if(page==='history'){$('#wxHistoryQuery').value=q;return searchHistory();}}).catch(e=>say(e.message));return;}
  const act=async()=>{
   if(t.dataset.productMode){setMode(t.dataset.productMode);return;}
   if(t.id==='splitCodeBtn'){if(mode==='code'){showPage('');api.setLayout(state.layout==='split'?'ide':'split');syncSplit();}return;}
   if(t.dataset.workspacePage){showPage(t.dataset.workspacePage);return;}
   if(t.hasAttribute('data-page-close'))return showPage('');
   if(t.hasAttribute('data-history-search'))return searchHistory();
   if(t.dataset.historyKind){historyKind=t.dataset.historyKind;return renderHistory();}
   if(t.hasAttribute('data-history-reference')){if(mode!=='code')return say('Code selections are available in Code mode.');$('#wxHistorySnippet').value=api.selection().slice(0,12000);return;}
   if(t.dataset.version!==undefined)return selectVersion(+t.dataset.version);
   if(t.hasAttribute('data-history-copy')){if(selected)await navigator.clipboard.writeText(selected.version.text);return;}
   if(t.hasAttribute('data-history-recover'))return recover();
   if(t.hasAttribute('data-history-clear')){if(confirm('Clear recorded history for this account and current workspace on this device? Current files are kept.')){await(await historyIndex()).clear();return renderHistory();}return;}
   if(t.hasAttribute('data-history-export')){const rows=(await historyIndex()).list();const b=new Blob([JSON.stringify({schema:1,versions:rows},null,2)],{type:'application/json'}),u=URL.createObjectURL(b),a=document.createElement('a');a.href=u;a.download='vespr-history.json';a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);return;}
   if(t.hasAttribute('data-personal-new')){const cur=ps().active();if(cur&&cur.messages.length)await(await historyIndex()).record({path:'.conversations/personal-'+cur.id+'.txt',text:cur.messages.map(m=>m.role+': '+m.text).join('\n\n'),label:'Personal conversation',by:api.actor()});ps().start();renderPersonal();return;}
   if(t.hasAttribute('data-upgrade'))return api.upgrade();
   if(t.hasAttribute('data-folder-choose'))return chooseFolder();
   if(t.hasAttribute('data-folder-back')){if(folder.length>1)folder.pop();return listLocation();}
   if(t.dataset.location){location=t.dataset.location;return listLocation();}
   if(t.dataset.fileEntry!==undefined)return openEntry(+t.dataset.fileEntry);
   if(t.hasAttribute('data-file-list'))return renderFiles();
   if(t.hasAttribute('data-file-import')&&fileSelection&&filesCurrent(fileSelection.request)){api.importFile(fileSelection.name,fileSelection.text);return;}
  };act().catch(err=>say(err.message));
 },true);
 $('#aiSearchChatBtn')?.setAttribute('title','Search recorded history');
 setMode('chat');
 return {setMode,showPage,personalSend,renderPersonal,syncComposer,personalExportAll:()=>ps().list().map(t=>ps().get(t.id)),personalClearAll:()=>{ps().clear();renderPersonal();},personalThreads:()=>ps().list(),personalActive:()=>{const t=ps().active();return t&&t.id;},personalOpen:id=>{if(!ps().setActive(id))return false;if(mode!=='chat')setMode('chat');renderPersonal();return true;},personalNew:()=>{ps().start();if(mode!=='chat')setMode('chat');renderPersonal();},personalRemove:id=>{const ok=ps().remove(id);renderPersonal();return ok;},personalRename:(id,t)=>ps().rename(id,t),personalSearchable:()=>ps().searchable(),watchFile,capture,record,mode:()=>mode,notePrompt:text=>{lastPrompt=String(text).slice(0,160);},captureConversation:messages=>{if(mode==='code'&&messages.length){const text=messages.map(m=>(m.by||m.name||m.role||'Workspace')+': '+String(m.text||'')).join('\n\n');record('.conversations/main.txt',text,'Workspace conversation').catch(e=>say('Conversation history: '+e.message));}},layoutChanged:syncSplit};
}
