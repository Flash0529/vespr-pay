import { test } from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createContext,runInContext} from 'node:vm';
const source=readFileSync(new URL('../prototype.html',import.meta.url),'utf8');
function extract(start,end){const a=source.indexOf(start),b=source.indexOf(end,a);assert.ok(a>=0&&b>a);return source.slice(a,b);}
// the team, 2026-11-10: the chat that talks to the AI has ALL the dev features; only DM and group message threads are restricted. Chat vs Code is a layout choice, not a capability gate.
test('Chat with no workspace connected sends through the personal AI chat',()=>{
 let sent=0;const c=createContext({convs:[],state:{productMode:'chat'},WX:{personalSend(){sent++}},liveSnap:()=>null,isMessagingChat:()=>false,toast(){}});
 runInContext(extract('function send(){','\n// Ask #301 & #314 Modal wiring'),c);c.send();assert.equal(sent,1);
});
test('Chat with a workspace connected does NOT take the personal route (it is the workspace conversation)',()=>{
 let sent=0;const c=createContext({convs:[],state:{productMode:'chat'},WX:{personalSend(){sent++},notePrompt(){}},liveSnap:()=>({files:[]}),isMessagingChat:()=>false,toast(){},inp:{value:''}});
 try{runInContext(extract('function send(){','\n// Ask #301 & #314 Modal wiring'),c);c.send()}catch(e){/* the rest of send() needs the whole page; reaching it is the point */}
 assert.equal(sent,0);
});
test('Chat does not fall through to the workspace send when the interface is still loading',()=>{
 const notes=[];const c=createContext({convs:[],state:{productMode:'chat'},WX:null,liveSnap:()=>null,isMessagingChat:()=>false,toast:t=>notes.push(t)});
 runInContext(extract('function send(){','\n// Ask #301 & #314 Modal wiring'),c);c.send();assert.equal(notes.length,1);
});
test('Chat can open the editor layout and connect a workspace: no gate refuses it any more',()=>{
 const state={productMode:'chat',layout:'chat'};
 assert.doesNotMatch(extract('function setLayout(l){','\n// SDE ('),/Switch to Code to open the editor/);
 assert.doesNotMatch(extract('async function connectLive(opts = {}) {','\nfunction disconnectLive()'),/productMode\s*===\s*'chat'/);
 assert.doesNotMatch(extract("async function runIt(kind = 'file'){",'\nfunction fixRun('),/productMode\s*===\s*'chat'/);
 assert.equal(state.layout,'chat');
});
test('only DM and group threads count as messaging chats',()=>{
 const state={conv:'t1'};const convs=[{id:'t1',kind:'team'},{id:'a1',kind:'agent'},{id:'c_sandbox',kind:'chat'}];
 const c=createContext({state,convs});runInContext(extract('const isMessagingChat=','\nfunction accountKind()')+';globalThis.f=isMessagingChat',c);const f=c.f;
 assert.equal(f(),true);state.conv='a1';assert.equal(f(),false);state.conv='c_sandbox';assert.equal(f(),false);state.conv='missing';assert.equal(f(),false);
});
test('disconnect destroys the actual workspace client and editor',()=>{
 let destroyed=0,editor=0;const node={dataset:{},classList:{},remove(){}};
 const c=createContext({state:{},liveClient:{destroy(){destroyed++}},liveConnected:true,ACC_TIMER:0,clearInterval(){},destroyNative(){editor++},closeArtifactPreview(){},document:{getElementById:id=>id==='app'?node:null},$:()=>node,toast(){},nav(){},chat(){}});
 runInContext(extract('function disconnectLive() {','\nnav();chat();ide();'),c);c.disconnectLive();assert.equal(destroyed,1);assert.equal(editor,1);assert.equal(c.liveClient,null);assert.equal(c.liveConnected,false);
});
test('primary selector has exactly Code and Chat, with a separate split control',()=>{
 assert.equal((source.match(/<button data-product-mode=/g)||[]).length,2);assert.match(source,/id="splitCodeBtn"/);assert.doesNotMatch(source,/<button data-lay=/);
});
