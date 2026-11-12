import { sha256Hex } from './sha256.js';
const uuid=()=>globalThis.crypto&&typeof globalThis.crypto.randomUUID==='function'?globalThis.crypto.randomUUID():'v'+Date.now().toString(36)+Math.random().toString(36).slice(2,10); // randomUUID needs https or localhost
// Local, scope-separated recovery checkpoints. This module never calls a model or uploads code.
const words = text => String(text).replace(/([a-z])([A-Z])/g,'$1 $2').replace(/_/g,' ').toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
const stem = word => /^(?:integrals?|integrate|integration)$/.test(word)?'integral':word.length>4 && word.endsWith('s') ? word.slice(0,-1) : word;
const stop = new Set('get me the a an version where with without right before appeared added introduced feature code application please that it was when made broke broken trying back calculator'.split(' '));
export function safeHistoryPath(path) {
 return typeof path==='string' && path.length>0 && path.length<500 && !path.startsWith('/') && !path.includes('\\') && !path.includes('\0') && !path.split('/').some(p=>!p||p==='..'||p==='.'||/^\.env(?:\.|$)|^id_(?:rsa|ed25519)$|\.(?:pem|key|p12|pfx)$/i.test(p));
}
const has = (text,terms) => {const set=new Set(words(text).map(stem));return terms.every(w=>set.has(w));};
export function searchVersions(records,{scope,query='',snippet='',path='',kind=''}={}) {
 // Filter the selected tab before the shared result cap, so another kind cannot hide retained matches.
 const source=records.filter(r=>r.scope===scope&&(!path||r.path===path)&&(kind==='versions'?!r.path.startsWith('.conversations/'):kind==='conversations'?r.path.startsWith('.conversations/'):true)).sort((a,b)=>a.at-b.at);
 const before=/\b(?:without|before)\b/i.test(query);
 const feature=before ? query.split(/\b(?:without|before)\b/i).pop() : query;
 const terms=words(feature).map(stem).filter(w=>!stop.has(w));
 if(!terms.length&&!snippet)return [];
 const groups=new Map();for(const r of source){if(!groups.has(r.path))groups.set(r.path,[]);groups.get(r.path).push(r);}
 const results=[];
 for(const list of groups.values()) {
  if(snippet&&!list.some(r=>r.text.includes(snippet)))continue;
  if(before) {
   if(!terms.length)continue;
   for(let n=1;n<list.length;n++)if(has(list[n].text,terms)&&!has(list[n-1].text,terms)) {
    results.push({version:list[n-1],introducedIn:list[n],reason:'Recorded checkpoint immediately before '+terms.join(', ')+' appeared in this file.'});
   }
  } else for(const r of list)if((!terms.length||has(r.text+' '+r.path+' '+(r.label||''),terms))&&(!snippet||r.text.includes(snippet)))results.push({version:r,reason:snippet?'Selected code and query match this saved checkpoint.':'Query terms match this checkpoint.'});
 }
 return results.sort((a,b)=>(b.introducedIn||b.version).at-(a.introducedIn||a.version).at).slice(0,80);
}

export function createVersionIndex({scope,initial=[],save=async()=>{},remove=async()=>{},maxText=500000,maxRecords=160,maxBytes=12000000}={}) {
 if(!scope)throw Error('History scope required');
 let records=initial.filter(r=>r.scope===scope&&safeHistoryPath(r.path)&&typeof r.text==='string'&&r.text.length<=maxText).sort((a,b)=>a.at-b.at),queue=Promise.resolve();
 const serialized=fn=>{const next=queue.then(fn);queue=next.catch(()=>{});return next;};
 return {
  list:()=>records.slice(),
  search:opts=>searchVersions(records,{...opts,scope}),
  record:entry=>serialized(async()=>{
   if(!safeHistoryPath(entry.path))throw Error('This file is excluded from local history');
   if(typeof entry.text!=='string'||entry.text.length>maxText)throw Error('File too large for local history');
   const previous=records.filter(r=>r.path===entry.path).at(-1);if(previous?.text===entry.text)return previous;
   const hash=await sha256Hex(entry.text);
   const next={id:uuid(),scope,path:entry.path,text:entry.text,hash,at:Number.isFinite(entry.at)?entry.at:Date.now(),by:String(entry.by||'Workspace').slice(0,80),label:String(entry.label||'Edit checkpoint').slice(0,160)};
   const proposed=[...records,next];let bytes=proposed.reduce((n,r)=>n+r.text.length*2,0);
   while(proposed.length>maxRecords||bytes>maxBytes)bytes-=proposed.shift().text.length*2;
   await save(proposed);records=proposed;return next;
  }),
  clear:()=>serialized(async()=>{await remove();records=[];})
 };
}

export async function openVersionIndex(scope) {
 // No localStorage fallback: quota/private browsing errors remain visible, not a false Saved badge.
 const db=await new Promise((resolve,reject)=>{
  const request=indexedDB.open('vespr-version-checkpoints',1);
  request.onupgradeneeded=()=>{const s=request.result.createObjectStore('scopes');};
  request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
 });
 const op=(mode,fn)=>new Promise((resolve,reject)=>{
  const tx=db.transaction('scopes',mode);let result;
  const r=fn(tx.objectStore('scopes'));r.onsuccess=()=>{result=r.result};
  tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||Error('History storage aborted'));
 });
 const loaded=await op('readonly',s=>s.get(scope));let generation=loaded?.generation||0;
 const initial=Array.isArray(loaded)?loaded:loaded?.records||[];
 const update=(records,clear=false)=>new Promise((resolve,reject)=>{
  const tx=db.transaction('scopes','readwrite'),store=tx.objectStore('scopes'),get=store.get(scope);let failure=null,nextGeneration=generation;
  get.onsuccess=()=>{
   const current=get.result,currentGeneration=current?.generation||0;
   if(currentGeneration!==generation){failure=Error('History changed in another window. Reload before recording.');tx.abort();return;}
   if(clear){nextGeneration=generation+1;store.put({generation:nextGeneration,records:[]},scope);return;}
   const merged=new Map((Array.isArray(current)?current:current?.records||[]).map(r=>[r.id,r]));for(const r of records)merged.set(r.id,r);
   const next=[...merged.values()].sort((a,b)=>a.at-b.at);let bytes=next.reduce((n,r)=>n+r.text.length*2,0);
   while(next.length>160||bytes>12000000)bytes-=next.shift().text.length*2;
   store.put({generation,records:next},scope);
  };
  tx.oncomplete=()=>{generation=nextGeneration;resolve()};tx.onerror=()=>reject(failure||tx.error);tx.onabort=()=>reject(failure||tx.error||Error('History storage aborted'));
 });
 const index=createVersionIndex({scope,initial,save:records=>update(records),remove:()=>update([],true)});
 return {...index,close:()=>db.close()};
}
