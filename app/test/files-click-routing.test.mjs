// Actual prototype dispatch prefix with synthetic DOM ancestry and adapter spies.
// No browser, network, provider, model, or device filesystem access.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../prototype.html', import.meta.url), 'utf8');
const start = source.indexOf(" const d3 = e.target.closest('[data-view3d]');");
const end = source.indexOf('if(t.dataset.ask)return approve', start);
assert.ok(start >= 0 && end > start, 'Actual dispatch prefix through ordinary file opening must exist');
const dispatchSource = source.slice(start, end);
assert.match(dispatchSource, /if\(t\.dataset\.file\)/, 'Exercise ordinary file opening, not a stand-in fallback');

class Element {
  constructor(tag, { dataset = {}, classes = [], id = '' } = {}, parent = null) {
    this.tagName = tag.toUpperCase();
    this.dataset = dataset;
    this.classes = new Set(classes);
    this.id = id;
    this.parentElement = parent;
  }

  matches(selector) {
    return selector.split(',').some(part => {
      let rest = part.trim();
      const tag = rest.match(/^[a-z]+/i);
      if (tag) {
        if (this.tagName !== tag[0].toUpperCase()) return false;
        rest = rest.slice(tag[0].length);
      }
      while (rest) {
        const id = rest.match(/^#([\w-]+)/);
        if (id) {
          if (this.id !== id[1]) return false;
          rest = rest.slice(id[0].length);
          continue;
        }
        const cls = rest.match(/^\.([\w-]+)/);
        if (cls) {
          if (!this.classes.has(cls[1])) return false;
          rest = rest.slice(cls[0].length);
          continue;
        }
        const attr = rest.match(/^\[data-([\w-]+)(?:="([^"]*)")?\]/);
        if (attr) {
          const key = attr[1].replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
          if (!Object.hasOwn(this.dataset, key) || (attr[2] !== undefined && this.dataset[key] !== attr[2])) return false;
          rest = rest.slice(attr[0].length);
          continue;
        }
        throw Error('Synthetic DOM must explicitly support selector: ' + part);
      }
      return true;
    });
  }

  closest(selector) {
    for (let node = this; node; node = node.parentElement) if (node.matches(selector)) return node;
    return null;
  }
}

const innerIcon = parent => new Element('use', {}, new Element('svg', {}, parent));
const row = scope => new Element('div', {
  classes: ['row'], dataset: { file: scope === 'project' ? 'src/cart.py' : 'home/user/scripts/backup.sh', fsscope: scope }
}, new Element('div', { classes: ['tree'] }));

function dispatch(target, initialScope) {
  const calls = { nav: 0, touched: [], views: [], ide: 0, imports: [], exports: [], notices: [] };
  const state = { fsScope: initialScope, activeFile: 'previous.py' };
  const hiddenNodes = new Map();
  const sandbox = {
    e: { target }, state, liveConnected: false, liveClient: null,
    nav: () => calls.nav++,
    importHostFile: path => calls.imports.push(path),
    exportProjectFile: path => calls.exports.push(path),
    touchFile: path => calls.touched.push(path),
    showView: view => calls.views.push(view),
    ide: () => calls.ide++,
    toast: message => calls.notices.push(message),
    dirPop() {}, isMobile: () => false,
    $: selector => {
      if (!hiddenNodes.has(selector)) hiddenNodes.set(selector, { hidden: true });
      return hiddenNodes.get(selector);
    }
  };
  vm.runInNewContext(`(() => {\n${dispatchSource}\n})()`, sandbox);
  return { state, calls };
}

for (const scope of ['project', 'system']) {
  for (const click of ['row', 'inner icon']) {
    test(`${scope} file ${click} reaches the ordinary open route`, () => {
      const fileRow = row(scope);
      const { state, calls } = dispatch(click === 'row' ? fileRow : innerIcon(fileRow), scope);
      assert.equal(state.activeFile, fileRow.dataset.file);
      assert.deepEqual(calls.touched, [fileRow.dataset.file]);
      assert.deepEqual(calls.views, ['editor']);
      assert.equal(calls.ide, 1);
      assert.equal(calls.nav, 0, 'File opening must not become a scope-switch action');
      assert.deepEqual(calls.imports, []);
      assert.deepEqual(calls.exports, []);
    });
  }
}

for (const [action, scope, attribute, receipt] of [
  ['Import', 'system', 'fsImport', 'imports'],
  ['Export', 'project', 'fsExport', 'exports']
]) {
  for (const click of ['button', 'inner icon']) {
    test(`${action} ${click} inside a scoped row runs its transfer exactly once`, () => {
      const fileRow = row(scope);
      const actions = new Element('span', { classes: ['fs-row-actions'] }, fileRow);
      const button = new Element('button', { classes: ['mini-act'], dataset: { [attribute]: fileRow.dataset.file } }, actions);
      const { calls } = dispatch(click === 'button' ? button : innerIcon(button), scope);
      assert.deepEqual(calls[receipt], [fileRow.dataset.file]);
      assert.deepEqual(calls[receipt === 'imports' ? 'exports' : 'imports'], []);
      assert.deepEqual(calls.touched, []);
      assert.deepEqual(calls.views, []);
      assert.equal(calls.ide, 0);
      assert.equal(calls.nav, 0);
    });
  }
}

for (const scope of ['project', 'system']) {
  for (const click of ['button', 'inner icon']) {
    test(`${scope} scope ${click} still switches scope exactly once`, () => {
      const button = new Element('button', { classes: ['fs-scope-btn'], dataset: { fsscope: scope } }, new Element('div', { classes: ['fs-scope-toggle'] }));
      const { state, calls } = dispatch(click === 'button' ? button : innerIcon(button), scope === 'project' ? 'system' : 'project');
      assert.equal(state.fsScope, scope);
      assert.equal(calls.nav, 1);
      assert.deepEqual(calls.touched, []);
      assert.deepEqual(calls.imports, []);
      assert.deepEqual(calls.exports, []);
    });
  }
}

test('Back to Project button retains its scope-switch action', () => {
  const button = new Element('button', { classes: ['mini'], dataset: { fsscope: 'project' } }, new Element('div', { classes: ['treebar'] }));
  const label = new Element('span', {}, button);
  const { state, calls } = dispatch(label, 'system');
  assert.equal(state.fsScope, 'project');
  assert.equal(calls.nav, 1);
  assert.deepEqual(calls.touched, []);
});
