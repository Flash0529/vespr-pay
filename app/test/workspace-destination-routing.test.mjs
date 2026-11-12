// Actual prototype workspace destination binding and live model dispatch behavior suite.
// Exercises enterWorkspace room lifecycle and send destination verification + model routing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../prototype.html', import.meta.url), 'utf8');

// Extract enterWorkspace
const ewStart = source.indexOf('function enterWorkspace(name){');
assert.ok(ewStart > 0, 'enterWorkspace function must exist');
const ewEnd = source.indexOf('function exitWorkspace(){', ewStart);
assert.ok(ewEnd > ewStart, 'exitWorkspace must follow enterWorkspace');
const enterWorkspaceSource = source.slice(ewStart, ewEnd);

// Extract send
const sendStart = source.indexOf('function send(){');
assert.ok(sendStart > 0, 'send function must exist');
const sendEnd = source.indexOf('// Ask #301 & #314 Modal wiring', sendStart);
assert.ok(sendEnd > sendStart, 'Modal wiring must follow send');
const sendSource = source.slice(sendStart, sendEnd);

function makeHarness(initialState = {}) {
  const calls = {
    disconnectLive: 0,
    nav: 0,
    toasts: [],
    ide: 0,
    chat: 0,
    liveClientSend: [],
    resolveTarget: []
  };

  const state = {
    workspace: 'default-ws',
    inWorkspace: false,
    liveConn: null,
    productMode: 'code',
    tray: [],
    steps: [],
    activeFile: 'app.py',
    pendingAttachments: [],
    liveDiffs: {},
    isSandboxed: true,
    selectedModelId: 'flint:40b',
    edit: { phase: 'idle' },
    quotes: [],
    ...initialState
  };

  const liveClient = {
    send: (text, payload) => {
      calls.liveClientSend.push({ text, payload });
    }
  };

  const modelRegistry = {
    getActiveModel: () => ({ id: state.selectedModelId || 'flint:40b' }),
    resolveTarget: (id, sandboxed) => {
      calls.resolveTarget.push({ id, sandboxed });
      return {
        model: { id, sandboxSafe: true },
        isFallback: false
      };
    }
  };

  const sandbox = {
    convs: [], // send() looks for a direct-message thread first
    state,
    liveConnected: Boolean(state.liveConn),
    liveClient: Boolean(state.liveConn) ? liveClient : null,
    disconnectLive: () => {
      calls.disconnectLive++;
      sandbox.liveConnected = false;
      sandbox.liveClient = null;
      state.liveConn = null;
    },
    nav: () => calls.nav++,
    toast: (msg) => calls.toasts.push(msg),
    ide: () => calls.ide++,
    chat: () => calls.chat++,
    inp: { value: '', style: {} },
    $: () => ({ disabled: false }),
    document: {
      querySelector: () => null,
      getElementById: () => null
    },
    localStorage: {
      setItem: () => {},
      getItem: () => null
    },
    window: {
      modelRegistry
    },
    WX: null,
    CC: null,
    CCP: null,
    PRE: null,
    esc: (s) => s,
    currentActor: () => 'me',
    formatMessageBody: (s) => s,
    renderTray: () => {},
    renderStarters: () => {},
    renderQuotes: () => {},
    generateAgentReply: () => 'reply'
  };

  vm.runInNewContext(enterWorkspaceSource + '\n' + sendSource, sandbox);
  return { sandbox, state, calls, liveClient, modelRegistry };
}

test('enterWorkspace disconnects live session if target room does not match current live room', () => {
  const { sandbox, state, calls } = makeHarness({
    workspace: 'room-alpha',
    liveConn: { room: 'room-alpha' }
  });

  assert.equal(sandbox.liveConnected, true);
  sandbox.enterWorkspace('room-beta');

  assert.equal(calls.disconnectLive, 1, 'disconnectLive must be called on room mismatch');
  assert.equal(sandbox.liveConnected, false);
  assert.equal(state.workspace, 'room-beta');
  assert.equal(state.inWorkspace, true);
  assert.ok(calls.toasts.includes('Entered room-beta'));
});

test('enterWorkspace preserves live session if target room matches existing live room', () => {
  const { sandbox, state, calls } = makeHarness({
    workspace: 'room-alpha',
    liveConn: { room: 'room-alpha' }
  });

  assert.equal(sandbox.liveConnected, true);
  sandbox.enterWorkspace('room-alpha');

  assert.equal(calls.disconnectLive, 0, 'disconnectLive must NOT be called if room is identical');
  assert.equal(sandbox.liveConnected, true);
  assert.equal(state.workspace, 'room-alpha');
});

test('send aborts and displays toast warning when destination room mismatches active workspace', () => {
  const { sandbox, state, calls } = makeHarness({
    workspace: 'room-beta',
    liveConn: { room: 'room-alpha' },
    quotes: [{ src: 'file.js', text: 'important snippet' }]
  });
  sandbox.inp.value = 'Hello agent';

  sandbox.send();

  assert.equal(calls.liveClientSend.length, 0, 'liveClient.send must NOT be dispatched on room mismatch');
  assert.ok(calls.toasts.some(t => t.includes('Destination mismatch')), 'Must toast destination mismatch');
  assert.equal(sandbox.inp.value, 'Hello agent', 'Draft input must be preserved on mismatch refusal');
  assert.equal(state.quotes.length, 1, 'Quotes must be preserved on mismatch refusal');
  assert.equal(state.quotes[0].text, 'important snippet');
});

test('send dispatches to liveClient with target model, sandbox policy, workspace, and room when matched', () => {
  const { sandbox, state, calls } = makeHarness({
    workspace: 'room-gamma',
    liveConn: { room: 'room-gamma' },
    isSandboxed: true,
    selectedModelId: 'flint:40b'
  });
  sandbox.inp.value = 'Implement feature X';

  sandbox.send();

  assert.equal(calls.liveClientSend.length, 1, 'liveClient.send must be dispatched exactly once');
  const dispatch = calls.liveClientSend[0];
  assert.equal(dispatch.text, 'Implement feature X');
  assert.equal(dispatch.payload.model, 'flint:40b');
  assert.equal(dispatch.payload.isSandboxed, true);
  assert.equal(dispatch.payload.sandboxSafe, true);
  assert.equal(dispatch.payload.workspace, 'room-gamma');
  assert.equal(dispatch.payload.room, 'room-gamma');
  assert.equal(calls.resolveTarget.length, 1, 'modelRegistry.resolveTarget must be consulted before dispatch');
});

test('send displays toast warning when model resolution triggers a sandbox safety fallback', () => {
  const { sandbox, calls, modelRegistry } = makeHarness({
    workspace: 'room-delta',
    liveConn: { room: 'room-delta' },
    isSandboxed: true,
    selectedModelId: 'untrusted:latest'
  });
  sandbox.inp.value = 'Run script';

  // Override resolveTarget to report fallback
  sandbox.window.modelRegistry.resolveTarget = (id, sandboxed) => {
    return {
      model: { id: 'flint:40b', sandboxSafe: true },
      isFallback: true,
      reason: 'Untrusted provider not permitted in sandboxed workspace'
    };
  };

  sandbox.send();

  assert.equal(calls.liveClientSend.length, 1);
  assert.equal(calls.liveClientSend[0].payload.model, 'flint:40b');
  assert.ok(calls.toasts.some(t => t.includes('Sandbox safety: Untrusted provider not permitted in sandboxed workspace')));
});
