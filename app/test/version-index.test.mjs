import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchVersions, createVersionIndex, safeHistoryPath } from '../version-index.js';

const versions = [
 {id:'1',scope:'a',path:'calculator.py',text:'def add(a,b): return a+b',at:1},
 {id:'2',scope:'a',path:'calculator.py',text:'def add(a,b): return a+b\ndef integral(f): return broken',at:2},
 {id:'3',scope:'a',path:'calculator.py',text:'def integral(f): return fixed',at:3},
 {id:'4',scope:'a',path:'other.py',text:'def integral(f): return f',at:4},
 {id:'5',scope:'b',path:'calculator.py',text:'private other tenant',at:5}
];
test('before-feature query returns exact predecessor and evidence',()=>{
 const r=searchVersions(versions,{scope:'a',query:'get me the version without integrals',path:'calculator.py'});
 assert.equal(r[0].version.id,'1');assert.equal(r[0].introducedIn.id,'2');assert.match(r[0].reason,/before/);
});
test('selected snippet disambiguates file lineage',()=>{
 const r=searchVersions(versions,{scope:'a',query:'right before integrals appeared',snippet:'def add(a,b)'});
 assert.equal(r[0].version.id,'1');assert.equal(r.length,1);
});
test('first retained version already has feature: never invent predecessor',()=>{
 assert.deepEqual(searchVersions(versions,{scope:'a',query:'without integrals',path:'other.py'}),[]);
});
test('lexical search never crosses account/workspace scope',()=>{
 assert.deepEqual(searchVersions(versions,{scope:'a',query:'private other tenant'}),[]);
});
test('missing/empty feature never guesses a version',()=>{
 assert.deepEqual(searchVersions(versions,{scope:'a',query:'without'}),[]);
});
test('checkpoint deduplication preserves real transitions',async()=>{
 const i=createVersionIndex({scope:'a'});
 await i.record({path:'x.js',text:'one',at:1});await i.record({path:'x.js',text:'one',at:2});
 await i.record({path:'x.js',text:'two',at:3});await i.record({path:'x.js',text:'one',at:4});
 assert.equal(i.list().length,3);assert.equal(i.list()[2].text,'one');
});
test('oversize code is skipped, never silently truncated',async()=>{
 const i=createVersionIndex({scope:'a',maxText:5});await assert.rejects(i.record({path:'x',text:'123456'}),/large/);assert.equal(i.list().length,0);
});
test('secret-shaped files and traversal are not indexed',()=>{
 for(const p of ['.env','a/.env.prod','../a','/etc/passwd','a\\b','id_rsa','secret.pem'])assert.equal(safeHistoryPath(p),false,p);
 assert.equal(safeHistoryPath('src/calculator.py'),true);
});
test('failed persistence never reports a saved checkpoint',async()=>{
 const i=createVersionIndex({scope:'a',save:async()=>{throw Error('quota')}});
 await assert.rejects(i.record({path:'x',text:'one'}),/quota/);assert.equal(i.list().length,0);
});
test('clear history removes persisted scope before clearing memory',async()=>{
 let removed=false;const i=createVersionIndex({scope:'a',remove:async()=>{removed=true}});
 await i.record({path:'x',text:'one'});await i.clear();assert.equal(removed,true);assert.equal(i.list().length,0);
});
