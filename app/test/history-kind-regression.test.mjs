// Isolated generated records exercise the actual History index; no product/sample-data UI.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createVersionIndex,searchVersions} from '../version-index.js';
const scope='history-regression-scope';
const record=(id,path,text,at,recordScope=scope)=>({id,path,text,at,scope:recordScope});

test('Versions search finds retained code behind eighty newer conversation matches',()=>{
 const code=record('code','calculator.py','def integral(f): return f',1);
 const chats=Array.from({length:80},(_,i)=>record('chat-'+i,'.conversations/main.txt','Discuss integral change '+i,i+2));
 const db=createVersionIndex({scope,initial:[code,...chats]});
 assert.equal(db.list().length,81);
 const found=db.search({kind:'versions',query:'integrals'});
 assert.deepEqual(found.map(r=>r.version.id),['code']);
});

test('Conversations search applies its kind before a crowd of newer code matches',()=>{
 const chat=record('conversation','.conversations/main.txt','Remember integral change',1);
 const code=Array.from({length:80},(_,i)=>record('code-'+i,'calculator.py','def integral_'+i+'(f): return f',i+2));
 const found=searchVersions([chat,...code],{scope,kind:'conversations',query:'integrals'});
 assert.deepEqual(found.map(r=>r.version.id),['conversation']);
});

test('kind preserves code predecessor and selected-snippet evidence without conversation lineage',()=>{
 const rows=[record('code-before','calculator.py','def add(a,b): return a+b',1),record('code-after','calculator.py','def add(a,b): return a+b\ndef integral(f): return broken',2),record('chat-before','.conversations/main.txt','Discuss calculator',3),record('chat-after','.conversations/main.txt','Discuss integral',4)];
 const found=searchVersions(rows,{scope,kind:'versions',query:'get me the version without integrals',snippet:'def add(a,b)'});
 assert.equal(found.length,1);assert.equal(found[0].version.id,'code-before');assert.equal(found[0].introducedIn.id,'code-after');
});

test('omitting kind retains mixed results and the eighty-result cap',()=>{
 const rows=Array.from({length:90},(_,i)=>record('mixed-'+i,i%2?'.conversations/main.txt':'calculator.py','integral '+i,i));
 const found=searchVersions(rows,{scope,query:'integrals'});
 assert.equal(found.length,80);assert.equal(found[0].version.id,'mixed-89');
 assert.ok(found.some(r=>r.version.path.startsWith('.conversations/')));assert.ok(found.some(r=>!r.version.path.startsWith('.conversations/')));
});

test('kind never crosses the selected account/workspace scope',()=>{
 const other=record('private','calculator.py','private integral',999,'another-scope');
 assert.deepEqual(searchVersions([other],{scope,kind:'versions',query:'integrals'}),[]);
});
