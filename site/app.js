import {
  defaults,
  spawn,
  field,
  normal,
  curvature,
  project,
  step,
  transport,
  add,
  sub,
  mul,
  dot,
  cross,
  norm,
  SHAPE_TYPES,
  MAX_SHAPES,
  operationOf
} from './surface.js';
import {
  intrinsicVertex,
  intrinsicFragment,
  quadVertex,
  observerFragment
} from './shaders.js';
const $ = id => document.getElementById(id),
  types = ['joined', 'cylinder', 'torus', 'sheets'],
  shapeTypes = SHAPE_TYPES;
const limits = { maxShapes: MAX_SHAPES, position: 30, sizeMin: .5, sizeMax: 6, depthMin: .2, depthMax: 4, blendMin: .15, blendMax: 2, viewMin: 6, viewMax: 30 };
let config = defaults(),
  avatar = spawn(config),
  selected = 0,
  view = 'intrinsic',
  zoom = 12,
  walk = false,
  distance = 0,
  revision = 0,
  dirty = true,
  busy = false,
  job = 0,
  pending = null,
  snapshot = null,
  orbit = 0,
  elevation = .63,
  camDistance = 13;
const ANGLES = 320,
  RINGS = 160,
  keys = new Set(),
  renderers = [];

function error(message) {
  $('error').hidden = false;
  $('error').querySelector('p').textContent = message;
}

function compile(gl, type, source) {
  const s = gl.createShader(type);
  gl.shaderSource(s, source);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(s));
  return s;
}

function program(gl, vs, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(p));
  return {
    p,
    u: new Map()
  };
}

function makeRenderer(canvas) {
  const gl = canvas.getContext('webgl', {
    alpha: false,
    antialias: false,
    powerPreference: 'high-performance'
  });
  if (!gl) throw Error('This simulation requires WebGL. Please enable hardware acceleration.');
  const intrinsic = program(gl, intrinsicVertex, intrinsicFragment),
    observer = program(gl, quadVertex, observerFragment),
    quad = gl.createBuffer(),
    screen = gl.createBuffer(),
    points = gl.createBuffer(),
    indices = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl
    .STATIC_DRAW);
  let ix = [];
  for (let a = 0; a < ANGLES; a++)
    for (let r = 0; r < RINGS; r++) {
      let i = a * (RINGS + 1) + r,
        j = i + RINGS + 1;
      ix.push(i, j, i + 1, j, j + 1, i + 1);
    }
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indices);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(ix), gl.STATIC_DRAW);
  return {
    canvas,
    gl,
    intrinsic,
    observer,
    quad,
    screen,
    points,
    indices,
    count: ix.length,
    ready: false
  };
}
try {
  renderers.push(makeRenderer($('main')), makeRenderer($('preview')));
} catch (e) {
  error(e.message);
  throw e;
}

function uniform(r, pr, name, type, ...values) {
  let u = pr.u.get(name);
  if (u === undefined) {
    u = r.gl.getUniformLocation(pr.p, name);
    pr.u.set(name, u);
  }
  if (u !== null) r.gl[type](u, ...values);
}

function uniforms(r, pr, c, a) {
  uniform(r, pr, 'mode', 'uniform1i', types.indexOf(c.mode));
  uniform(r, pr, 'radius', 'uniform1f', c.radius);
  uniform(r, pr, 'strength', 'uniform1f', c.strength);
  uniform(r, pr, 'smoothing', 'uniform1f', c.blend);
  uniform(r, pr, 'shapeCount', 'uniform1i', Math.min(c.shapes.length, MAX_SHAPES));
  let shapes = new Float32Array(MAX_SHAPES * 4),
    specs = new Float32Array(MAX_SHAPES * 4),
    rotations = new Float32Array(MAX_SHAPES * 4),
    colors = new Float32Array(MAX_SHAPES * 4);
  c.shapes.slice(0, MAX_SHAPES).forEach((o, i) => {
    const hex = /^#[0-9a-f]{6}$/i.test(o.color || '') ? o.color.slice(1) : '3ba4e4';
    shapes.set([o.x, o.y, shapeTypes.indexOf(o.type), o.size], i * 4);
    specs.set([o.strength, o.blend, o.z || 0, operationOf(o) === 'negative' ? 1 : 0], i * 4);
    rotations.set([o.rotationX || 0, o.rotationY || 0, o.rotationZ ?? o.rotation ?? 0, 0], i * 4);
    colors.set([parseInt(hex.slice(0, 2), 16) / 255, parseInt(hex.slice(2, 4), 16) / 255, parseInt(hex.slice(4, 6), 16) / 255, 1], i * 4);
  });
  uniform(r, pr, 'shapes', 'uniform4fv', shapes);
  uniform(r, pr, 'specs', 'uniform4fv', specs);
  uniform(r, pr, 'rotations', 'uniform4fv', rotations);
  uniform(r, pr, 'colors', 'uniform4fv', colors);
  uniform(r, pr, 'player', 'uniform3fv', a.p);
  uniform(r, pr, 'forward', 'uniform3fv', a.v);
  uniform(r, pr, 'up', 'uniform3fv', a.n);
  uniform(r, pr, 'aspect', 'uniform2f', r.canvas.width / r.canvas.height, 1);
}

function attribute(r, pr, name, buffer, size) {
  const gl = r.gl,
    loc = gl.getAttribLocation(pr.p, name);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
}

function draw(r, intrinsic) {
  const gl = r.gl,
    w = r.canvas.width,
    h = r.canvas.height;
  gl.viewport(0, 0, w, h);
  gl.clearColor(.63, .66, .63, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  if (intrinsic) {
    if (!r.ready || !snapshot) return;
    const pr = r.intrinsic;
    gl.useProgram(pr.p);
    uniforms(r, pr, snapshot.config, snapshot.avatar);
    uniform(r, pr, 'zoom', 'uniform1f', snapshot.zoom);
    attribute(r, pr, 'screen', r.screen, 2);
    attribute(r, pr, 'point', r.points, 3);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, r.indices);
    gl.drawElements(gl.TRIANGLES, r.count, gl.UNSIGNED_SHORT, 0);
  } else {
    const pr = r.observer;
    gl.useProgram(pr.p);
    uniforms(r, pr, config, avatar);
    const right = cross(avatar.v, avatar.n),
      back = add(mul(avatar.v, -Math.cos(orbit)), mul(right, Math.sin(orbit))),
      camera = add(avatar.p, add(mul(avatar.n, camDistance * Math.sin(elevation)), mul(back,
        camDistance * Math.cos(elevation))));
    uniform(r, pr, 'camera', 'uniform3fv', camera);
    uniform(r, pr, 'target', 'uniform3fv', add(avatar.p, mul(avatar.v, .8)));
    uniform(r, pr, 'cameraUp', 'uniform3fv', avatar.n);
    attribute(r, pr, 'a', r.quad, 2);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }
}
const worker = new Worker(new URL('./geodesics.js', import.meta.url), {
  type: 'module'
});
worker.onerror = e => {
  busy = false;
  error('The surface tracer could not start. Reload the page to try again.');
  console.error(e);
};
worker.onmessage = ({
  data
}) => {
  busy = false;
  if (!pending || data.id !== pending.id) return;
  if (pending.revision === revision) {
    snapshot = pending;
    for (const r of renderers) {
      const gl = r.gl;
      gl.bindBuffer(gl.ARRAY_BUFFER, r.points);
      gl.bufferData(gl.ARRAY_BUFFER, data.points, gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, r.screen);
      gl.bufferData(gl.ARRAY_BUFFER, pending.screen, gl.STATIC_DRAW);
      r.ready = true;
    }
    $('notice').hidden = true;
  }
  pending = null;
};

function requestTrace() {
  if (busy || !dirty) return;
  busy = true;
  dirty = false;
  const aspect = Math.max(...renderers.map(r => r.canvas.width / r.canvas.height)),
    range = Math.hypot(aspect, 1) * zoom * 1.015;
  const screen = new Float32Array((ANGLES + 1) * (RINGS + 1) * 2);
  for (let a = 0; a <= ANGLES; a++) {
    const t = a / ANGLES * Math.PI * 2;
    for (let r = 0; r <= RINGS; r++) {
      const at = (a * (RINGS + 1) + r) * 2,
        rr = r / RINGS * range;
      screen[at] = Math.cos(t) * rr;
      screen[at + 1] = Math.sin(t) * rr;
    }
  }
  pending = {
    id: ++job,
    revision,
    screen,
    zoom,
    config: structuredClone(config),
    avatar: structuredClone(avatar)
  };
  worker.postMessage({
    id: job,
    config: pending.config,
    position: avatar.p,
    forward: avatar.v,
    range,
    angles: ANGLES,
    rings: RINGS
  });
}

function resize() {
  for (let i = 0; i < renderers.length; i++) {
    const r = renderers[i],
      bounds = r.canvas.getBoundingClientRect();
    r.canvas.width = Math.round(bounds.width * Math.min(devicePixelRatio, 1.1));
    r.canvas.height = Math.round(bounds.height * Math.min(devicePixelRatio, 1.1));
  }
  dirty = true;
}
addEventListener('resize', resize);
resize();

function rotate(angle) {
  const r = cross(avatar.v, avatar.n);
  avatar.v = norm(add(mul(avatar.v, Math.cos(angle)), mul(r, Math.sin(angle))));
  dirty = true;
}

function advance(amount, side) {
  const right = cross(avatar.v, avatar.n),
    dir = side ? right : avatar.v;
  let p = avatar.p,
    v = dir,
    n = avatar.n,
    heading = avatar.v;
  const count = Math.ceil(Math.abs(amount) / .07);
  for (let i = 0; i < count; i++) {
    const s = step(p, v, amount / count, config);
    heading = transport(heading, n, s.n);
    p = s.p;
    v = s.v;
    n = s.n;
  }
  avatar = {
    p,
    v: heading,
    n
  };
  distance += Math.abs(amount);
  dirty = true;
}

function move(dt) {
  if ($('about').open || document.hidden) return;
  const turn = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has(
    'ArrowLeft') ? 1 : 0);
  if (turn) rotate(turn * dt * 1.4);
  const f = (walk || keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys
      .has('ArrowDown') ? 1 : 0),
    side = (keys.has('KeyE') ? 1 : 0) - (keys.has('KeyQ') ? 1 : 0),
    speed = (keys.has('ShiftLeft') || keys.has('ShiftRight') ? 3.5 : 1.75) * dt;
  if (f) advance(f * speed, false);
  if (side) advance(side * speed, true);
}

function setView(v) {
  view = v;
  const intrinsic = v === 'intrinsic';
  $('intrinsic').setAttribute('aria-pressed', intrinsic);
  $('observer').setAttribute('aria-pressed', !intrinsic);
  $('view-name').textContent = intrinsic ? 'INTRINSIC VIEW' : '3D OBSERVER';
  $('view-description').textContent = intrinsic ?
    'Light follows the surface. Your view unfolds its paths.' :
    'The red arrow stays on the surface, whichever way it bends.';
  $('inset-name').textContent = intrinsic ? '3D OBSERVER' : 'INTRINSIC VIEW';
  $('inset-hint').textContent = intrinsic ? 'Drag to orbit · scroll to zoom' :
    'Light paths, unfolded';
  $('main').setAttribute('aria-label', intrinsic ? 'Unfolded surface geodesic view' :
    'Three-dimensional observer view');
  $('preview').setAttribute('aria-label', intrinsic ? 'Three-dimensional observer view' :
    'Unfolded surface geodesic view');
}
$('intrinsic').onclick = () => setView('intrinsic');
$('observer').onclick = () => setView('observer');
$('swap').onclick = () => setView(view === 'intrinsic' ? 'observer' : 'intrinsic');

function setWalk(v) {
  walk = v;
  $('walk').classList.toggle('active', v);
  $('walk').textContent = v ? 'Stop walking' : 'Auto-walk';
}
$('walk').onclick = () => setWalk(!walk);
$('info').onclick = () => {
  setWalk(false);
  keys.clear();
  $('about').showModal()
};
$('close-info').onclick = () => $('about').close();

function reset(onShape = false) {
  avatar = spawn(config, onShape, selected);
  orbit = 0;
  distance = 0;
  setWalk(false);
  dirty = true;
  revision++;
  $('notice').hidden = false;
  $('notice').textContent = 'Unfolding light paths…';
}
$('reset').onclick = () => reset();
$('visit').onclick = () => reset(true);

function selectedShape() {
  return config.mode === 'joined' ? config.shapes[selected] : null;
}

function syncLimitsToControls() {
  for (const id of ['x', 'y', 'z']) { $(id).min = -limits.position; $(id).max = limits.position; }
  $('size').min = limits.sizeMin; $('size').max = limits.sizeMax;
  $('depth').min = limits.depthMin; $('depth').max = limits.depthMax;
  $('blend').min = limits.blendMin; $('blend').max = limits.blendMax;
  $('distance').min = limits.viewMin; $('distance').max = limits.viewMax;
}
function syncControls() {
  const joined = config.mode === 'joined', o = selectedShape(), labels = {
    handle: 'Torus handle', bump: 'Spherical bump', bowl: 'Hollow', ring: 'Ring / rim',
    plane: 'Flat plane', cube: 'Cube', sphere: 'Sphere', cylinder: 'Cylinder'
  };
  syncLimitsToControls();
  $('shape-editor').hidden = !joined;
  $('selection').innerHTML = '';
  config.shapes.forEach((shape, i) => {
    let opt = document.createElement('option'); opt.value = i; opt.textContent = (i + 1) + ' · ' + (labels[shape.type] || shape.type); $('selection').append(opt);
  });
  selected = Math.max(0, Math.min(selected, config.shapes.length - 1));
  $('selection').value = selected;
  for (const key of ['x', 'y', 'z']) $(key).value = o ? (o[key] || 0) : 0;
  for (const key of ['rotationX', 'rotationY', 'rotationZ']) $(key).value = o ? Math.round((o[key] ?? (key === 'rotationZ' ? o.rotation || 0 : 0)) * 180 / Math.PI) : 0;
  $('operation').value = o ? operationOf(o) : 'additive';
  $('color').value = o?.color || '#3ba4e4';
  $('size').value = o ? o.size : config.radius; $('depth').value = o ? o.strength : config.strength; $('blend').value = o ? o.blend : config.blend;
  $('depth').disabled = config.mode === 'cylinder'; $('blend').disabled = config.mode === 'cylinder' || config.mode === 'torus';
  $('depth-label').textContent = config.mode === 'sheets' ? 'Half sheet separation' : config.mode === 'torus' ? 'Tube thickness' : 'Height / depth';
  $('size-label').textContent = config.mode === 'sheets' ? 'Throat radius' : 'Radius';
  $('visit').hidden = !joined; $('remove').disabled = config.shapes.length <= 1;
  document.querySelectorAll('[data-add]').forEach(b => b.disabled = config.shapes.length >= limits.maxShapes);
  updateOutputs();
  $('scene-note').textContent = {
    joined: 'Additive shapes raise, connect, or add material. Negative shapes cut inward. Each shape has its own color and three-axis rotation.',
    cylinder: 'A closed circumference, infinite length. Look for repeated red arrows along the wrapping direction.',
    torus: 'One closed surface. Orange outside, blue inside. Sidestep to move around the tube.',
    sheets: 'Two infinite planes join around a circular throat. Walk toward its blue rim to descend.'
  }[config.mode];
}
function updateOutputs() {
  for (const key of ['size', 'depth', 'blend']) $(key + '-out').textContent = (+$(key).value).toFixed(1) + (key === 'size' ? ' m' : key === 'depth' && config.mode === 'sheets' ? ' m' : '');
  $('distance-out').textContent = zoom + ' m';
}
function boundedNumber(id, fallback, min, max) { const n = +$(id).value; return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback; }
function showSettings() {
  for (const [id, key] of [['limit-shapes', 'maxShapes'], ['limit-position', 'position'], ['limit-size-min', 'sizeMin'], ['limit-size-max', 'sizeMax'], ['limit-depth-min', 'depthMin'], ['limit-depth-max', 'depthMax'], ['limit-blend-min', 'blendMin'], ['limit-blend-max', 'blendMax'], ['limit-view-min', 'viewMin'], ['limit-view-max', 'viewMax']]) $(id).value = limits[key];
  $('settings-dialog').showModal();
}
function applySettings() {
  limits.maxShapes = Math.round(boundedNumber('limit-shapes', limits.maxShapes, 1, MAX_SHAPES));
  limits.position = boundedNumber('limit-position', limits.position, 1, 100);
  limits.sizeMin = boundedNumber('limit-size-min', limits.sizeMin, .1, 50); limits.sizeMax = Math.max(limits.sizeMin, boundedNumber('limit-size-max', limits.sizeMax, .1, 50));
  limits.depthMin = boundedNumber('limit-depth-min', limits.depthMin, .05, 30); limits.depthMax = Math.max(limits.depthMin, boundedNumber('limit-depth-max', limits.depthMax, .05, 30));
  limits.blendMin = boundedNumber('limit-blend-min', limits.blendMin, .02, 10); limits.blendMax = Math.max(limits.blendMin, boundedNumber('limit-blend-max', limits.blendMax, .02, 10));
  limits.viewMin = boundedNumber('limit-view-min', limits.viewMin, 1, 80); limits.viewMax = Math.max(limits.viewMin, boundedNumber('limit-view-max', limits.viewMax, 1, 80));
  config.shapes = config.shapes.slice(0, limits.maxShapes);
  for (const o of config.shapes) { o.x = Math.max(-limits.position, Math.min(limits.position, o.x)); o.y = Math.max(-limits.position, Math.min(limits.position, o.y)); o.z = Math.max(-limits.position, Math.min(limits.position, o.z || 0)); o.size = Math.max(limits.sizeMin, Math.min(limits.sizeMax, o.size)); o.strength = Math.max(limits.depthMin, Math.min(limits.depthMax, o.strength)); o.blend = Math.max(limits.blendMin, Math.min(limits.blendMax, o.blend)); }
  zoom = Math.max(limits.viewMin, Math.min(limits.viewMax, zoom)); $('distance').value = zoom; selected = Math.min(selected, config.shapes.length - 1);
  syncControls(); geometryChanged(); $('settings-dialog').close();
}
$('settings').onclick = showSettings;
$('save-settings').onclick = applySettings;
$('close-settings').onclick = () => $('settings-dialog').close();
$('scene').onchange = () => {
  config.mode = $('scene').value;
  if (config.mode === 'sheets') {
    config.strength = 3;
    config.radius = 2.3;
  } else if (config.mode === 'torus') {
    config.strength = 1.8;
    config.radius = 2.3;
  } else if (config.mode === 'cylinder') {
    config.radius = 2.3;
    zoom = Math.max(limits.viewMin, Math.min(limits.viewMax, 20));
    $('distance').value = zoom;
  }
  config.radius = Math.max(limits.sizeMin, Math.min(limits.sizeMax, config.radius));
  config.strength = Math.max(limits.depthMin, Math.min(limits.depthMax, config.strength));
  config.blend = Math.max(limits.blendMin, Math.min(limits.blendMax, config.blend));
  zoom = Math.max(limits.viewMin, Math.min(limits.viewMax, zoom));
  syncControls();
  reset();
};
$('selection').onchange = () => {
  selected = +$('selection').value;
  syncControls()
};

function geometryChanged() {
  revision++;
  dirty = true;
  const old = avatar.n;
  avatar.p = project(avatar.p, config, 30);
  avatar.n = normal(avatar.p, config);
  avatar.v = transport(avatar.v, old, avatar.n);
  updateOutputs();
}
for (const [id, key] of [
    ['size', 'size'],
    ['depth', 'strength'],
    ['blend', 'blend'],
    ['x', 'x'],
    ['y', 'y'],
    ['z', 'z']
  ]) $(id).addEventListener('input', () => {
  const el = $(id);
  if (!Number.isFinite(+el.value)) return;
  let val = Math.max(+el.min, Math.min(+el.max, +el.value));
  const o = selectedShape();
  if (o) o[key] = val;
  else if (id !== 'z') config[id === 'size' ? 'radius' : key] = val;
  geometryChanged()
});
for (const id of ['rotationX', 'rotationY', 'rotationZ']) $(id).addEventListener('input', () => {
  const el = $(id);
  if (!Number.isFinite(+el.value)) return;
  const o = selectedShape();
  if (o) { o[id] = Math.max(+el.min, Math.min(+el.max, +el.value)) * Math.PI / 180; if (id === 'rotationZ') o.rotation = o[id]; }
  geometryChanged();
});
$('operation').onchange = () => { const o = selectedShape(); if (o) { o.operation = $('operation').value; geometryChanged(); } };
$('color').oninput = () => { const o = selectedShape(); if (o && /^#[0-9a-f]{6}$/i.test($('color').value)) { o.color = $('color').value; dirty = true; revision++; } };
$('distance').oninput = () => {
  zoom = +$('distance').value;
  dirty = true;
  revision++;
  updateOutputs()
};
document.querySelectorAll('[data-add]').forEach(b => b.onclick = () => {
  if (config.shapes.length >= limits.maxShapes) return;
  const forward = avatar.v, palette = ['#3ba4e4', '#f4774f', '#805ad5', '#20a39e', '#d4a017'];
  config.shapes.push({
    type: b.dataset.add, operation: b.dataset.add === 'bowl' ? 'negative' : 'additive', color: palette[config.shapes.length % palette.length],
    x: Math.round((avatar.p[0] + forward[0] * 5) * 2) / 2,
    y: Math.round((avatar.p[1] + forward[1] * 5) * 2) / 2,
    z: 0, rotation: 0, rotationX: 0, rotationY: 0, rotationZ: 0,
    size: 2.6, strength: 1.25, blend: 1.2
  });
  selected = config.shapes.length - 1;
  geometryChanged();
  syncControls()
});
$('remove').onclick = () => {
  if (config.shapes.length <= 1) return;
  config.shapes.splice(selected, 1);
  selected = Math.min(selected, config.shapes.length - 1);
  geometryChanged();
  syncControls()
};
$('collapse').onclick = () => {
  const hidden = $('control-body').hidden = !$('control-body').hidden;
  $('controls').classList.toggle('collapsed', hidden);
  $('collapse').textContent = hidden ? '+' : '−';
  $('collapse').setAttribute('aria-label', hidden ? 'Expand controls' : 'Collapse controls')
};
if (innerWidth < 650) $('collapse').click();
window.addEventListener('keydown', e => {
  if (['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName) || $('about')
    .open) return;
  if (['KeyW', 'KeyS', 'KeyA', 'KeyD', 'KeyQ', 'KeyE', 'ArrowUp', 'ArrowDown', 'ArrowLeft',
      'ArrowRight', 'ShiftLeft', 'ShiftRight'
    ].includes(e.code)) {
    e.preventDefault();
    keys.add(e.code);
  }
  if (e.code === 'KeyV' && !e.repeat) setView(view === 'intrinsic' ? 'observer' : 'intrinsic');
  if (e.code === 'KeyR' && !e.repeat) reset();
  if (e.code === 'Escape') setWalk(false);
});
window.addEventListener('keyup', e => keys.delete(e.code));
window.addEventListener('blur', () => { keys.clear(); setWalk(false) });
document.addEventListener('visibilitychange', () => { keys.clear(); if (document.hidden) setWalk(false) });
for (const [i, r] of renderers.entries()) {
  let drag = null;
  r.canvas.addEventListener('pointerdown', e => { drag = [e.clientX, e.clientY]; r.canvas.setPointerCapture(e.pointerId) });
  r.canvas.addEventListener('pointerup', () => drag = null); r.canvas.addEventListener('pointercancel', () => drag = null);
  r.canvas.addEventListener('pointermove', e => {
    if (!drag) return;
    const dx = e.clientX - drag[0], dy = e.clientY - drag[1], isIntrinsic = (i === 0) === (view === 'intrinsic');
    if (isIntrinsic) rotate(dx * .006); else { orbit -= dx * .006; elevation = Math.max(.15, Math.min(1.4, elevation + dy * .004)); }
    drag = [e.clientX, e.clientY];
  });
  r.canvas.addEventListener('wheel', e => {
    e.preventDefault(); const isIntrinsic = (i === 0) === (view === 'intrinsic');
    if (isIntrinsic) { zoom = Math.round(Math.max(limits.viewMin, Math.min(limits.viewMax, zoom + Math.sign(e.deltaY)))); $('distance').value = zoom; dirty = true; revision++; updateOutputs(); }
    else camDistance = Math.max(5, Math.min(40, camDistance + Math.sign(e.deltaY)));
  }, { passive: false });
}
document.querySelectorAll('[data-key]').forEach(b => {
  b.onpointerdown = e => { e.preventDefault(); b.setPointerCapture(e.pointerId); keys.add(b.dataset.key) };
  b.onpointerup = b.onpointercancel = () => keys.delete(b.dataset.key);
});
let last = performance.now(), hud = 0;
function frame(now) {
  const dt = Math.min(.045, (now - last) / 1000); last = now; move(dt); requestTrace();
  draw(renderers[0], view === 'intrinsic'); draw(renderers[1], view !== 'intrinsic'); hud += dt;
  if (hud > .2) { const k = curvature(avatar.p, config); $('readout').textContent = distance.toFixed(1) + ' m travelled · K ' + (Math.abs(k) < .00005 ? '0.000' : k.toFixed(3)); hud = 0; }
  requestAnimationFrame(frame);
}
syncControls(); setView(view); requestAnimationFrame(frame);
if (document.modelContext?.registerTool) {
  for (const tool of [{
    name: 'read_surface_state', description: 'Read the current surface, constrained player position and local Gaussian curvature.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true },
    execute: () => ({ surface: config.mode, view, position: avatar.p, curvature: curvature(avatar.p, config), distanceTravelled: distance, shapeCount: config.shapes.length, maxShapes: limits.maxShapes })
  }, {
    name: 'select_surface', description: 'Select a surface example and reset the player on it.',
    inputSchema: { type: 'object', properties: { surface: { type: 'string', enum: types } }, required: ['surface'], additionalProperties: false },
    execute: input => { if (!types.includes(input?.surface)) throw Error('Invalid surface'); $('scene').value = input.surface; $('scene').onchange(); return { surface: config.mode, position: avatar.p }; }
  }]) { try { Promise.resolve(document.modelContext.registerTool(tool)).catch(() => {}); } catch {} }
}
