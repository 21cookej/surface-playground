import fs from 'node:fs';
import assert from 'node:assert/strict';
const noop = () => {},
  elements = new Map(),
  tools = new Map();
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
    this.min = '0';
    this.max = '30';
    this.dataset = {};
    this.hidden = false;
    this.handlers = {};
    this.classList = {
      add: noop,
      remove: noop,
      toggle: noop
    };
    this.width = 960;
    this.height = 640;
  }
  getContext() {
    return gl
  }
  getBoundingClientRect() {
    return {
      width: this.id === 'preview' ? 355 : 960,
      height: this.id === 'preview' ? 249 : 640
    }
  }
  setAttribute(k, v) {
    this[k] = v
  }
  addEventListener(k, v) {
    this.handlers[k] = v
  }
  append(v) {}
  querySelector() {
    return new Element('child')
  }
  click() {
    this.onclick?.()
  }
  showModal() {
    this.open = true
  }
  close() {
    this.open = false
  }
}
for (const id of fs.readFileSync('site/index.html', 'utf8').matchAll(/id="([^"]+)"/g)) elements.set(
  id[1], new Element(id[1]));
const addButtons = ['handle', 'bump', 'bowl', 'ring', 'plane', 'cube', 'sphere', 'cylinder'].map(type => {
  let e = new Element(type);
  e.dataset.add = type;
  return e;
});
globalThis.document = {
  getElementById: id => elements.get(id),
  createElement: () => new Element('new'),
  querySelectorAll: q => q === '[data-add]' ? addButtons : [],
  activeElement: null,
  hidden: false,
  addEventListener: noop,
  modelContext: {
    registerTool: t => tools.set(t.name, t)
  }
};
globalThis.window = {
  addEventListener: noop
};
globalThis.addEventListener = noop;
globalThis.devicePixelRatio = 1;
globalThis.innerWidth = 960;
globalThis.requestAnimationFrame = f => animate = f;
globalThis.Worker = class {
  postMessage() {}
};
await import('../site/app.js');
assert.equal(tools.get('read_surface_state').execute().surface, 'joined');
for (const mode of ['cylinder', 'torus', 'sheets', 'joined']) {
  tools.get('select_surface').execute({
    surface: mode
  });
  assert.equal(tools.get('read_surface_state').execute().surface, mode);
}
assert.throws(() => tools.get('select_surface').execute({
  surface: 'invalid'
}));
elements.get('observer').onclick();
assert.equal(tools.get('read_surface_state').execute().view, 'observer');
elements.get('swap').onclick();
assert.equal(tools.get('read_surface_state').execute().view, 'intrinsic');
addButtons[0].onclick();
elements.get('visit').onclick();
const p = tools.get('read_surface_state').execute().position;
assert.ok(p.every(Number.isFinite));
elements.get('remove').onclick();
elements.get('walk').onclick();
for (let i = 0; i < 10; i++) animate(performance.now() + i * 20);
assert.ok(tools.get('read_surface_state').execute().distanceTravelled > 0);
console.log('PASS scene selection, view swapping, shape add/remove, reposition, auto-walk and tool validation');

// The settings dialog changes live constraints without allowing a shader-unsafe capacity.
elements.get('settings').onclick();
elements.get('limit-shapes').value = '3';
elements.get('limit-position').value = '12';
elements.get('limit-size-min').value = '.8';
elements.get('limit-size-max').value = '4';
elements.get('limit-depth-min').value = '.4';
elements.get('limit-depth-max').value = '3';
elements.get('limit-blend-min').value = '.2';
elements.get('limit-blend-max').value = '1.5';
elements.get('limit-view-min').value = '7';
elements.get('limit-view-max').value = '18';
elements.get('save-settings').onclick();
let state = tools.get('read_surface_state').execute();
assert.equal(state.maxShapes, 3);
assert.ok(state.shapeCount <= state.maxShapes);
const before = state.shapeCount;
addButtons.find(b => b.dataset.add === 'cylinder').onclick();
assert.equal(tools.get('read_surface_state').execute().shapeCount, before, 'live maximum shape limit blocks additions');
assert.equal(elements.get('size').min, .8);
assert.equal(elements.get('size').max, 4);
assert.equal(elements.get('distance').min, 7);
assert.equal(elements.get('distance').max, 18);
assert.ok(!fs.readFileSync('site/index.html', 'utf8').includes('data-add="spike"'));
console.log('PASS settings limits, cylinder primitive UI, and removed spike UI');
