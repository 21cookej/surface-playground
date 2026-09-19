import fs from 'node:fs';
import assert from 'node:assert/strict';
const noop = () => {},
  elements = new Map(),
  registered = new Map(),
  events = new Map();
let animate;
const gl = new Proxy({
  getShaderParameter: () => true,
  getProgramParameter: () => true,
  getUniformLocation: () => 1,
  getAttribLocation: () => 1
}, {
  get: (o, k) => o[k] ?? noop
});
class Element {
  constructor(id) {
    this.id = id;
    this.value = '';
    this.dataset = {};
    this.hidden = false;
    this.checked = false;
  }
  getContext() {
    return gl;
  }
  getBoundingClientRect() {
    return {
      width: 680,
      height: 453
    };
  }
  setAttribute(k, v) {
    this[k] = v;
  }
  replaceChildren(...c) {
    this.children = c;
  }
  setPointerCapture() {}
}
const html = fs.readFileSync('site/hyper/index.html', 'utf8');
for (const m of html.matchAll(/<(?:\w+)[^>]*id="([^"]+)"[^>]*>/g)) {
  const e = new Element(m[1]);
  for (const k of ['value', 'min', 'max']) e[k] = m[0].match(new RegExp(k + '="([^"]+)"'))?.[1] ?? '';
  e.checked = m[0].includes('checked');
  elements.set(m[1], e);
}
elements.get('quality').value = '1';
elements.get('colors').value = '0';
const buttons = [0, 1, 2].map(i => {
  const e = new Element('add' + i);
  e.dataset.add = i;
  return e;
});
globalThis.Option = class {
  constructor(text, value) {
    this.text = text;
    this.value = value;
  }
};
globalThis.document = {
  getElementById: id => elements.get(id),
  querySelectorAll: q => q === '[data-add]' ? buttons : [],
  hidden: false,
  addEventListener: noop,
  modelContext: {
    registerTool: t => registered.set(t.name, t)
  }
};
globalThis.addEventListener = (k, fn) => events.set(k, fn);
globalThis.requestAnimationFrame = fn => animate = fn;
globalThis.setTimeout = noop;
await import('../site/hyper/app.js');
const read = () => registered.get('read_4d_state').execute();
assert.equal(read().position.length, 4);
assert.equal(read().objects, 1);
assert.equal(read().observerFollowing, true);
animate(1000);
elements.get('outside').onclick();
assert.equal(elements.get('outside')['aria-pressed'], true);
elements.get('inside').onclick();
for (let mode = 0; mode < 5; mode++) {
  elements.get('scene').value = mode;
  elements.get('scene').onchange();
  buttons[2].onclick();
  assert.ok(read().objects > 0);
  elements.get('w').value = '5';
  elements.get('w').onchange();
  elements.get('visit').onclick();
  assert.ok(read().position.every(Number.isFinite));
  assert.ok(Math.abs(read().residual) < 1e-5);
  elements.get('remove').onclick();
  elements.get('reset').onclick();
  animate(1200 + mode * 200);
}
elements.get('scene').value = 0;
elements.get('scene').onchange();
const p = [...read().position];
elements.get('auto').onclick();
for (let i = 0; i < 20; i++) animate(2200 + i * 20);
assert.notDeepEqual(read().position, p);
assert.ok(Math.abs(read().residual) < 1e-6);
console.log('PASS 4D UI initialization, both perspectives, every scene, object edits/visit/remove, auto-travel');
elements.get('collapse').onclick();
assert.equal(elements.get('panel').hidden, true);
assert.equal(elements.get('show-controls').hidden, false);
elements.get('show-controls').onclick();
assert.equal(elements.get('panel').hidden, false);
elements.get('operation').value = 'negative';
elements.get('operation').onchange();
assert.ok(Math.abs(read().residual) < 1e-4);
elements.get('pitch').value = 30;
elements.get('pitch').oninput();
animate(5000);
console.log('PASS tuck-away panel, negative operation, and camera tilt');
