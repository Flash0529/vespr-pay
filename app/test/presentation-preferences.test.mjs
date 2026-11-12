import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import test from 'node:test';

const source = readFileSync(new URL('../presentation.js', import.meta.url), 'utf8');

function makeDom() {
  const handlers = { button: [], panel: [], outside: [] };
  const state = { focusCalled: false };
  const button = {
    setAttribute() {},
    toggleAttribute(name, value) { if (name === 'hidden') state.buttonHidden = value; },
    addEventListener(event, handler) { if (event === 'click') handlers.button.push(handler); },
    focus() { state.focusCalled = true; },
  };
  const panel = {
    toggleAttribute(name, value) { if (name === 'hidden') state.panelHidden = value; },
    addEventListener(event, handler) { if (event === 'keydown') handlers.panel.push(handler); },
  };
  const document = {
    documentElement: { dataset: {} },
    getElementById(id) {
      if (id === 'developerToolsBtn') return button;
      if (id === 'developerActions') return panel;
      return null;
    },
    querySelectorAll() { return []; },
    querySelector() { return null; },
    addEventListener(event, handler) { if (event === 'click') handlers.outside.push(handler); },
  };
  return { document, handlers, state };
}

function run(source, storage, compact = true) {
  const dom = makeDom();
  const context = createContext({
    document: dom.document,
    localStorage: storage,
    matchMedia: () => ({ matches:compact }),
  });
  runInContext(source, context);
  return dom;
}

// 2026-11-10 (the team: the row of icons in the top bar was pestering): the tools are one menu on every window size. It starts closed, a click opens and closes it, a click elsewhere or Escape closes it.
// The root attribute stays 'on' because other styles (the composer's effort and context chips) key off it.
const click = (dom, target = { closest: () => null }) => { for (const h of dom.handlers.button) h({ stopPropagation() {} }); return dom };
test('the tools menu starts closed on every window size', () => {
  for (const compact of [true, false]) { const dom = run(source, { getItem: () => 'on', setItem() {} }, compact); assert.equal(dom.state.panelHidden, true, 'closed (compact=' + compact + ')'); assert.equal(dom.state.buttonHidden, false, 'its button is always there'); assert.equal(dom.document.documentElement.dataset.developerTools, 'on') }
})
test('an old saved preference no longer opens it, and denied storage does not matter', () => {
  assert.equal(run(source, { getItem: () => 'on', setItem() {} }).state.panelHidden, true)
  assert.equal(run(source, { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } }).state.panelHidden, true)
})
test('clicking the button opens and closes the menu', () => {
  const dom = run(source, { getItem: () => null, setItem() {} }); assert.equal(dom.handlers.button.length, 1)
  click(dom); assert.equal(dom.state.panelHidden, false); click(dom); assert.equal(dom.state.panelHidden, true)
})
test('a click outside closes it, a click inside does not', () => {
  const dom = run(source, { getItem: () => null, setItem() {} }); click(dom); assert.equal(dom.state.panelHidden, false)
  for (const h of dom.handlers.outside) h({ target: { closest: sel => (/developerActions/.test(sel) ? {} : null) } }); assert.equal(dom.state.panelHidden, false, 'inside the menu')
  for (const h of dom.handlers.outside) h({ target: { closest: () => null } }); assert.equal(dom.state.panelHidden, true, 'outside')
})
test('Escape on the panel closes it and returns focus to the button', () => {
  const dom = run(source, { getItem: () => null, setItem() {} }); click(dom); assert.equal(dom.state.panelHidden, false); assert.equal(dom.state.focusCalled, false)
  for (const handler of dom.handlers.panel) handler({ key: 'Escape' }); assert.equal(dom.state.panelHidden, true); assert.equal(dom.state.focusCalled, true)
})
test('aria-expanded follows the menu', () => {
  const dom = makeDom(); const attributes = {}; const button = dom.document.getElementById('developerToolsBtn'); button.setAttribute = (n, v) => { attributes[n] = v };
  runInContext(source, createContext({ document: dom.document, localStorage: { getItem: () => null, setItem() {} }, matchMedia: () => ({ matches: false }) }))
  assert.equal(attributes['aria-expanded'], 'false'); for (const h of dom.handlers.button) h({ stopPropagation() {} }); assert.equal(attributes['aria-expanded'], 'true')
  for (const h of dom.handlers.panel) h({ key: 'Escape' }); assert.equal(attributes['aria-expanded'], 'false')
})
