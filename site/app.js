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
  operationOf,
  isCustomColor,
  BASE_COLOR
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
const limits = {
  maxShapes: MAX_SHAPES,
  position: 1e6,
  sizeMin: .05,
  sizeMax: 1e6,
  depthMin: .05,
  depthMax: 1e6,
  blendMin: .02,
  blendMax: 1e6,
  viewMin: 4,
  viewMax: 16
};
let config = defaults(),
  avatar = spawn(config),
  selected = 0,
  view = 'intrinsic',
  zoom = 8,
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
  camDistance = 13,
  interactionUntil = 0,
  renderScale = 1,
  sceneData = null,
  sceneDataRevision = -1;
// Keep mesh density fixed so movement never changes surface tessellation.
const sceneStates = new Map();
const appearance = {
  colorView: 0,
  textureDensity: 2,
  textureContrast: .16,
  drawDistance: 400,
  arrowScale: 1.4,
  speed: 1.75
};
let paintDirty = true,
  lastObserverDraw = 0;
const TRACE_FIXED = {
    angles: 224,
    rings: 112
  },
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
  gl.getExtension('OES_standard_derivatives');
  const intrinsic = program(gl, intrinsicVertex, intrinsicFragment),
    observer = program(gl, quadVertex, observerFragment),
    quad = gl.createBuffer(),
    screen = gl.createBuffer(),
    points = gl.createBuffer(),
    metadata = gl.createBuffer(),
    indices = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl
    .STATIC_DRAW);
  return {
    canvas,
    gl,
    intrinsic,
    observer,
    quad,
    screen,
    points,
    metadata,
    indices,
    count: 0,
    meshAngles: 0,
    meshRings: 0,
    ready: false
  };
}

function setMesh(r, angles, rings) {
  if (r.meshAngles === angles && r.meshRings === rings) return;
  const indices = new Uint16Array(angles * rings * 6);
  let at = 0;
  for (let a = 0; a < angles; a++)
    for (let ring = 0; ring < rings; ring++) {
      const i = a * (rings + 1) + ring,
        j = i + rings + 1;
      indices[at++] = i;
      indices[at++] = j;
      indices[at++] = i + 1;
      indices[at++] = j;
      indices[at++] = j + 1;
      indices[at++] = i + 1;
    }
  r.gl.bindBuffer(r.gl.ELEMENT_ARRAY_BUFFER, r.indices);
  r.gl.bufferData(r.gl.ELEMENT_ARRAY_BUFFER, indices, r.gl.STATIC_DRAW);
  r.count = indices.length;
  r.meshAngles = angles;
  r.meshRings = rings;
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

function packScene(c) {
  const shapes = new Float32Array(MAX_SHAPES * 4),
    specs = new Float32Array(MAX_SHAPES * 4),
    rotationA = new Float32Array(MAX_SHAPES * 4),
    rotationB = new Float32Array(MAX_SHAPES * 4),
    colors = new Float32Array(MAX_SHAPES * 4),
    base = BASE_COLOR.slice(1);
  for (let i = 0; i < Math.min(c.shapes.length, MAX_SHAPES); i++) {
    const o = c.shapes[i],
      at = i * 4,
      rz = o.rotationZ ?? o.rotation ?? 0,
      custom = operationOf(o) === 'additive' && isCustomColor(o.color),
      hex = custom ? o.color.slice(1) : base;
    shapes[at] = o.x;
    shapes[at + 1] = o.y;
    shapes[at + 2] = shapeTypes.indexOf(o.type);
    shapes[at + 3] = o.size;
    specs[at] = o.strength;
    specs[at + 1] = o.blend;
    specs[at + 2] = o.z || 0;
    specs[at + 3] = operationOf(o) === 'negative' ? 1 : 0;
    rotationA[at] = Math.cos(o.rotationX || 0);
    rotationA[at + 1] = Math.sin(o.rotationX || 0);
    rotationA[at + 2] = Math.cos(o.rotationY || 0);
    rotationA[at + 3] = Math.sin(o.rotationY || 0);
    rotationB[at] = Math.cos(rz);
    rotationB[at + 1] = Math.sin(rz);
    colors[at] = parseInt(hex.slice(0, 2), 16) / 255;
    colors[at + 1] = parseInt(hex.slice(2, 4), 16) / 255;
    colors[at + 2] = parseInt(hex.slice(4, 6), 16) / 255;
    colors[at + 3] = custom ? 1 : 0;
  }
  return {
    shapes,
    specs,
    rotationA,
    rotationB,
    colors
  };
}

function currentSceneData() {
  if (sceneDataRevision !== revision) {
    sceneData = packScene(config);
    sceneDataRevision = revision;
  }
  return sceneData;
}

function uniforms(r, pr, c, a, packed) {
  for (const key of ['textureDensity', 'textureContrast', 'drawDistance', 'arrowScale']) uniform(r,
    pr, key, 'uniform1f', appearance[key]);
  uniform(r, pr, 'colorView', 'uniform1i', appearance.colorView);
  uniform(r, pr, 'mode', 'uniform1i', types.indexOf(c.mode));
  uniform(r, pr, 'radius', 'uniform1f', c.radius);
  uniform(r, pr, 'strength', 'uniform1f', c.strength);
  uniform(r, pr, 'smoothing', 'uniform1f', c.blend);
  uniform(r, pr, 'shapeCount', 'uniform1i', Math.min(c.shapes.length, MAX_SHAPES));
  uniform(r, pr, 'shapes', 'uniform4fv', packed.shapes);
  uniform(r, pr, 'specs', 'uniform4fv', packed.specs);
  uniform(r, pr, 'rotationA', 'uniform4fv', packed.rotationA);
  uniform(r, pr, 'rotationB', 'uniform4fv', packed.rotationB);
  uniform(r, pr, 'colors', 'uniform4fv', packed.colors);
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
    uniforms(r, pr, snapshot.config, snapshot.avatar, snapshot.revision === revision ? currentSceneData() :
      snapshot.scene);
    uniform(r, pr, 'zoom', 'uniform1f', snapshot.zoom);
    uniform(r, pr, 'viewOffset', 'uniform2f', 0, 0);
    uniform(r, pr, 'viewRotation', 'uniform2f', 1, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, r.metadata);
    for (const [name, size, offset] of [
        ['surfaceNormal', 3, 0],
        ['curvatureValue', 1, 12],
        ['owner', 1, 16]
      ]) {
      const loc = gl.getAttribLocation(pr.p, name);
      if (loc >= 0) {
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 20, offset);
      }
    }
    attribute(r, pr, 'screen', r.screen, 2);
    attribute(r, pr, 'point', r.points, 3);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, r.indices);
    gl.drawElements(gl.TRIANGLES, r.count, gl.UNSIGNED_SHORT, 0);
  } else {
    const pr = r.observer;
    gl.useProgram(pr.p);
    uniforms(r, pr, config, avatar, currentSceneData());
    const cameraNormal = $('follow-tilt').checked ? avatar.n : [0, 0, 1],
      right = cross(avatar.v, cameraNormal),
      back = add(mul(avatar.v, -Math.cos(orbit)), mul(right, Math.sin(orbit))),
      camera = add(avatar.p, add(mul(cameraNormal, camDistance * Math.sin(elevation)), mul(back,
        camDistance * Math.cos(elevation))));
    uniform(r, pr, 'camera', 'uniform3fv', camera);
    uniform(r, pr, 'target', 'uniform3fv', add(avatar.p, mul(avatar.v, .8)));
    uniform(r, pr, 'cameraUp', 'uniform3fv', cameraNormal);
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
    paintDirty = true;
    for (const r of renderers) {
      const gl = r.gl;
      gl.bindBuffer(gl.ARRAY_BUFFER, r.metadata);
      gl.bufferData(gl.ARRAY_BUFFER, data.metadata, gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, r.points);
      gl.bufferData(gl.ARRAY_BUFFER, data.points, gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, r.screen);
      gl.bufferData(gl.ARRAY_BUFFER, pending.screen, gl.STATIC_DRAW);
      setMesh(r, pending.angles, pending.rings);
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
  const quality = TRACE_FIXED,
    angles = quality.angles,
    rings = quality.rings,
    aspect = Math.max(...renderers.map(r => r.canvas.width / r.canvas.height)),
    range = Math.hypot(aspect, 1) * zoom * 1.02,
    screen = new Float32Array((angles + 1) * (rings + 1) * 2);
  // Only one sin/cos pair per ray; ring samples are scalar multiples.
  for (let a = 0; a <= angles; a++) {
    const t = a / angles * Math.PI * 2,
      ct = Math.cos(t),
      st = Math.sin(t),
      row = a * (rings + 1) * 2;
    for (let r = 0; r <= rings; r++) {
      const rr = r / rings * range,
        at = row + r * 2;
      screen[at] = ct * rr;
      screen[at + 1] = st * rr;
    }
  }
  pending = {
    id: ++job,
    revision,
    screen,
    zoom,
    angles,
    rings,
    config: structuredClone(config),
    avatar: structuredClone(avatar),
    scene: currentSceneData()
  };
  worker.postMessage({
    id: job,
    config: pending.config,
    position: avatar.p,
    forward: avatar.v,
    range,
    angles,
    rings
  });
}

function resize() {
  paintDirty = true;
  for (let i = 0; i < renderers.length; i++) {
    const r = renderers[i],
      bounds = r.canvas.getBoundingClientRect(),
      pixelRatio = Math.min(devicePixelRatio, 1.1) * renderScale;
    r.canvas.width = Math.max(1, Math.round(bounds.width * pixelRatio));
    r.canvas.height = Math.max(1, Math.round(bounds.height * pixelRatio));
  }
  dirty = true;
}

function markInteraction() {
  paintDirty = true;
  interactionUntil = performance.now() + 180;
}
addEventListener('resize', resize);
resize();

function rotate(angle) {
  markInteraction();
  const r = cross(avatar.v, avatar.n);
  avatar.v = norm(add(mul(avatar.v, Math.cos(angle)), mul(r, Math.sin(angle))));
  dirty = true;
}

function advance(amount, side) {
  markInteraction();
  const right = cross(avatar.v, avatar.n),
    dir = side ? right : avatar.v;
  let p = avatar.p,
    v = dir,
    n = avatar.n,
    heading = avatar.v;
  const count = Math.min(64, Math.max(1, Math.ceil(Math.abs(amount) / .07)));
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
  if ($('about').open || $('settings-dialog').open || document.hidden) return;
  const turn = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has(
    'ArrowLeft') ? 1 : 0);
  if (turn) rotate(turn * dt * 1.4);
  const f = (walk || keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys
      .has('ArrowDown') ? 1 : 0),
    side = (keys.has('KeyE') ? 1 : 0) - (keys.has('KeyQ') ? 1 : 0),
    speed = (keys.has('ShiftLeft') || keys.has('ShiftRight') ? appearance.speed * 2 : appearance
      .speed) * dt;
  if (f) advance(f * speed, false);
  if (side) advance(side * speed, true);
}

function setView(v) {
  paintDirty = true;
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
  return config.shapes[selected] || null;
}

function syncLimitsToControls() {
  const o = selectedShape();
  for (const id of ['x', 'y', 'z']) {
    $(id).min = -limits.position;
    $(id).max = limits.position;
  }
  for (const [id, lo, hi, current, span] of [
      ['size', limits.sizeMin, limits.sizeMax, o ? o.size : config.radius, 12],
      ['depth', limits.depthMin, limits.depthMax, o ? o.strength : config.strength, 8],
      ['blend', limits.blendMin, limits.blendMax, o ? o.blend : config.blend, 4],
      ['distance', limits.viewMin, limits.viewMax, zoom, 30]
    ]) {
    $(id).min = lo;
    $(id).max = Math.min(hi, Math.max(span, current * 2));
    $(id).step = 'any';
  }
}

function syncControls() {
  const joined = config.mode === 'joined',
    o = selectedShape(),
    labels = {
      handle: 'Torus handle',
      bump: 'Spherical bump',
      bowl: 'Hollow',
      ring: 'Ring / rim',
      plane: 'Flat plane',
      cube: 'Cube',
      sphere: 'Sphere',
      cylinder: 'Cylinder'
    };
  syncLimitsToControls();
  $('shape-editor').hidden = false;
  $('selection').innerHTML = '';
  const baseOption = document.createElement('option');
  baseOption.value = -1;
  baseOption.textContent = 'Base surface settings';
  $('selection').append(baseOption);
  config.shapes.forEach((shape, i) => {
    let opt = document.createElement('option');
    opt.value = i;
    opt.textContent = (i + 1) + ' · ' + (labels[shape.type] || shape.type);
    $('selection').append(opt);
  });
  selected = Math.max(-1, Math.min(selected, config.shapes.length - 1));
  $('selection').value = selected;
  for (const key of ['x', 'y', 'z']) $(key).value = o ? (o[key] || 0) : 0;
  for (const key of ['rotationX', 'rotationY', 'rotationZ']) $(key).value = o ? Math.round((o[
    key] ?? (key === 'rotationZ' ? o.rotation || 0 : 0)) * 180 / Math.PI) : 0;
  $('operation').value = o ? operationOf(o) : 'additive';
  const canTint = !!o && operationOf(o) === 'additive',
    custom = canTint && isCustomColor(o.color);
  $('color-mode').value = custom ? 'custom' : 'default';
  $('color-mode').disabled = !canTint;
  $('color').value = isCustomColor(o?.color) ? o.color : '#3ba4e4';
  $('color').disabled = !custom;
  $('custom-color-label').hidden = !canTint;
  $('size').value = o ? o.size : config.radius;
  $('depth').value = o ? o.strength : config.strength;
  $('blend').value = o ? o.blend : config.blend;
  $('depth').disabled = !o && config.mode === 'cylinder';
  $('blend').disabled = !o && (config.mode === 'cylinder' || config.mode === 'torus');
  $('size').disabled = !o && joined;
  if (!o && joined) {
    $('depth').disabled = true;
    $('blend').disabled = true;
  }
  for (const id of ['x', 'y', 'z', 'rotationX', 'rotationY', 'rotationZ', 'operation']) $(id)
    .disabled = !o;
  $('depth-label').textContent = !o && config.mode === 'sheets' ? 'Half sheet separation' : !o &&
    config.mode === 'torus' ? 'Tube thickness' : 'Height / depth';
  $('size-label').textContent = !o && config.mode === 'sheets' ? 'Throat radius' : 'Radius';
  $('visit').hidden = !o;
  $('remove').disabled = !o;
  document.querySelectorAll('[data-add]').forEach(b => b.disabled = config.shapes.length >= limits
    .maxShapes);
  updateOutputs();
  $('scene-note').textContent = {
    joined: 'Additive shapes raise, connect, or add material. Negative shapes cut inward. Each shape has its own color and three-axis rotation.',
    cylinder: 'A closed circumference, infinite length. Look for repeated red arrows along the wrapping direction.',
    torus: 'One closed surface. Orange outside, blue inside. Sidestep to move around the tube.',
    sheets: 'Two infinite planes join around a circular throat. Walk toward its blue rim to descend.'
  } [config.mode];
}

function updateOutputs() {
  for (const id of ['size', 'depth', 'blend', 'distance']) {
    $(id + '-exact').value = $(id).value;
    $(id + '-exact').min = limits[id === 'size' ? 'sizeMin' : id === 'depth' ? 'depthMin' : id ===
      'blend' ? 'blendMin' : 'viewMin'];
    $(id + '-exact').max = limits[id === 'size' ? 'sizeMax' : id === 'depth' ? 'depthMax' : id ===
      'blend' ? 'blendMax' : 'viewMax'];
    $(id + '-exact').disabled = $(id).disabled;
  }
  for (const key of ['size', 'depth', 'blend']) $(key + '-out').textContent = (+$(key).value)
    .toFixed(1) + (key === 'size' ? ' m' : key === 'depth' && config.mode === 'sheets' ? ' m' : '');
  $('distance-out').textContent = zoom + ' m';
  $('distance-exact').value = zoom;
}

function boundedNumber(id, fallback, min, max) {
  const n = +$(id).value;
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}

function showSettings() {
  setWalk(false);
  keys.clear();
  for (const [id, key] of [
      ['limit-shapes', 'maxShapes'],
      ['limit-position', 'position'],
      ['limit-size-min', 'sizeMin'],
      ['limit-size-max', 'sizeMax'],
      ['limit-depth-min', 'depthMin'],
      ['limit-depth-max', 'depthMax'],
      ['limit-blend-min', 'blendMin'],
      ['limit-blend-max', 'blendMax'],
      ['limit-view-min', 'viewMin'],
      ['limit-view-max', 'viewMax']
    ]) $(id).value = limits[key];
  $('settings-dialog').showModal();
}

function applySettings() {
  limits.maxShapes = Math.round(boundedNumber('limit-shapes', limits.maxShapes, 1, MAX_SHAPES));
  limits.position = boundedNumber('limit-position', limits.position, 1, 1e9);
  limits.sizeMin = boundedNumber('limit-size-min', limits.sizeMin, .001, 1e9);
  limits.sizeMax = Math.max(limits.sizeMin, boundedNumber('limit-size-max', limits.sizeMax, .001,
    1e9));
  limits.depthMin = boundedNumber('limit-depth-min', limits.depthMin, .05, 1e6);
  limits.depthMax = Math.max(limits.depthMin, boundedNumber('limit-depth-max', limits.depthMax, .05,
    1e6));
  limits.blendMin = boundedNumber('limit-blend-min', limits.blendMin, .001, 1e6);
  limits.blendMax = Math.max(limits.blendMin, boundedNumber('limit-blend-max', limits.blendMax,
    .001, 1e6));
  limits.viewMin = boundedNumber('limit-view-min', limits.viewMin, 4, 16);
  limits.viewMax = Math.max(limits.viewMin, boundedNumber('limit-view-max', limits.viewMax, 4,
    16));
  config.shapes = config.shapes.slice(0, limits.maxShapes);
  for (const o of config.shapes) {
    o.x = Math.max(-limits.position, Math.min(limits.position, o.x));
    o.y = Math.max(-limits.position, Math.min(limits.position, o.y));
    o.z = Math.max(-limits.position, Math.min(limits.position, o.z || 0));
    o.size = Math.max(limits.sizeMin, Math.min(limits.sizeMax, o.size));
    o.strength = Math.max(limits.depthMin, Math.min(limits.depthMax, o.strength));
    o.blend = Math.max(limits.blendMin, Math.min(limits.blendMax, o.blend));
  }
  zoom = Math.max(limits.viewMin, Math.min(limits.viewMax, zoom));
  $('distance').value = zoom;
  selected = Math.min(selected, config.shapes.length - 1);
  syncControls();
  geometryChanged();
  $('settings-dialog').close();
}
$('settings').onclick = showSettings;
$('save-settings').onclick = applySettings;
$('close-settings').onclick = () => $('settings-dialog').close();
$('scene').onchange = () => {
  sceneStates.set(config.mode, {
    config: structuredClone(config),
    selected,
    zoom
  });
  const mode = $('scene').value,
    previous = sceneStates.get(mode);
  if (previous) {
    config = structuredClone(previous.config);
    selected = previous.selected;
    zoom = Math.max(4, Math.min(16, previous.zoom));
  } else {
    config = defaults();
    config.mode = mode;
    if (mode !== 'joined') config.shapes = [];
    config.strength = mode === 'sheets' ? 3 : mode === 'torus' ? 1.8 : 2.5;
    selected = config.shapes.length ? 0 : -1;
    zoom = mode === 'cylinder' ? 16 : 8;
  }
  config.shapes = config.shapes.slice(0, limits.maxShapes);
  syncControls();
  reset();
};
$('selection').onchange = () => {
  selected = +$('selection').value;
  syncControls()
};

function geometryChanged() {
  markInteraction();
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
  if (o) {
    o[id] = Math.max(+el.min, Math.min(+el.max, +el.value)) * Math.PI / 180;
    if (id === 'rotationZ') o.rotation = o[id];
  }
  geometryChanged();
});
$('operation').onchange = () => {
  const o = selectedShape();
  if (o) {
    o.operation = $('operation').value;
    syncControls();
    geometryChanged();
  }
};
$('color-mode').onchange = () => {
  const o = selectedShape();
  if (!o || operationOf(o) !== 'additive') return;
  o.color = $('color-mode').value === 'default' ? 'default' : (isCustomColor(o.color) ? o.color :
    '#3ba4e4');
  syncControls();
  sceneDataRevision = -1;
  paintDirty = true;
};
$('color').oninput = () => {
  const o = selectedShape();
  if (o && operationOf(o) === 'additive' && isCustomColor($('color').value)) {
    o.color = $('color').value;
    sceneDataRevision = -1;
    paintDirty = true;
  }
};
$('distance').oninput = () => {
  zoom = +$('distance').value;
  markInteraction();
  dirty = true;
  revision++;
  updateOutputs()
};
document.querySelectorAll('[data-add]').forEach(b => b.onclick = () => {
  if (config.shapes.length >= limits.maxShapes) return;
  const forward = avatar.v,
    placement = project(add(avatar.p, mul(forward, 3)), config, 30),
    n = normal(placement, config);
  config.shapes.push({
    type: b.dataset.add,
    operation: b.dataset.add === 'bowl' ? 'negative' : 'additive',
    color: 'default',
    x: placement[0],
    y: placement[1],
    z: placement[2],
    rotation: 0,
    rotationX: 0,
    rotationY: Math.acos(Math.max(-1, Math.min(1, n[2]))),
    rotationZ: Math.atan2(n[1], n[0]),
    size: 2.6,
    strength: 1.25,
    blend: 1.2
  });
  selected = config.shapes.length - 1;
  geometryChanged();
  syncControls()
});
$('remove').onclick = () => {
  if (!selectedShape()) return;
  config.shapes.splice(selected, 1);
  selected = Math.min(selected, config.shapes.length - 1);
  geometryChanged();
  syncControls()
};
for (const id of ['size', 'depth', 'blend', 'distance']) $(id + '-exact').onchange = () => {
  const e = $(id + '-exact'),
    v = Number(e.value);
  if (!e.value.trim() || !Number.isFinite(v) || v < +e.min || v > +e.max) {
    e.value = $(id).value;
    return;
  }
  $(id).max = Math.max(+$(id).max, v);
  $(id).value = v;
  $(id).dispatchEvent(new Event('input', {
    bubbles: true
  }));
};
$('color-view').onchange = () => {
  appearance.colorView = +$('color-view').value;
  paintDirty = true;
  $('legend').hidden = appearance.colorView === 1;
};
for (const [id, key] of [
    ['texture-density', 'textureDensity'],
    ['texture-contrast', 'textureContrast'],
    ['move-speed', 'speed'],
    ['arrow-scale', 'arrowScale'],
    ['draw-distance', 'drawDistance']
  ]) $(id).onchange = () => {
  const e = $(id),
    v = Number(e.value);
  if (e.value.trim() && Number.isFinite(v) && v >= +e.min && v <= +e.max) {
    appearance[key] = v;
    paintDirty = true;
  }
};
$('camera-distance').onchange = () => {
  const v = Number($('camera-distance').value);
  if (Number.isFinite(v) && v >= .1 && v <= 1e9) {
    camDistance = v;
    paintDirty = true;
  }
};
$('collapse').onclick = () => {
  $('controls').hidden = true;
  $('show-controls').hidden = false;
};
$('show-controls').onclick = () => {
  $('controls').hidden = false;
  $('show-controls').hidden = true;
};
$('follow-tilt').onchange = () => {
  paintDirty = true;
};
$('observer-tilt').oninput = () => {
  elevation = +$('observer-tilt').value * Math.PI / 180;
  paintDirty = true;
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
window.addEventListener('blur', () => {
  keys.clear();
  setWalk(false)
});
document.addEventListener('visibilitychange', () => {
  keys.clear();
  if (document.hidden) setWalk(false)
});
for (const [i, r] of renderers.entries()) {
  let drag = null;
  r.canvas.addEventListener('pointerdown', e => {
    drag = [e.clientX, e.clientY];
    r.canvas.setPointerCapture(e.pointerId)
  });
  r.canvas.addEventListener('pointerup', () => drag = null);
  r.canvas.addEventListener('pointercancel', () => drag = null);
  r.canvas.addEventListener('pointermove', e => {
    if (!drag) return;
    const dx = e.clientX - drag[0],
      dy = e.clientY - drag[1],
      isIntrinsic = (i === 0) === (view === 'intrinsic');
    markInteraction();
    if (isIntrinsic) rotate(dx * .006);
    else {
      paintDirty = true;
      orbit -= dx * .006;
      elevation = Math.max(.15, Math.min(1.4, elevation + dy * .004));
    }
    drag = [e.clientX, e.clientY];
  });
  r.canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const isIntrinsic = (i === 0) === (view === 'intrinsic');
    markInteraction();
    if (isIntrinsic) {
      zoom = Math.round(Math.max(limits.viewMin, Math.min(limits.viewMax, zoom + Math.sign(e
        .deltaY))));
      $('distance').max = Math.max(+$('distance').max, zoom);
      $('distance').value = zoom;
      dirty = true;
      revision++;
      updateOutputs();
    } else {
      paintDirty = true;
      camDistance = Math.max(5, Math.min(40, camDistance + Math.sign(e.deltaY)));
    }
  }, {
    passive: false
  });
}
document.querySelectorAll('[data-key]').forEach(b => {
  b.onpointerdown = e => {
    e.preventDefault();
    b.setPointerCapture(e.pointerId);
    keys.add(b.dataset.key)
  };
  b.onpointerup = b.onpointercancel = () => keys.delete(b.dataset.key);
});
let last = performance.now(),
  hud = 0;

function frame(now) {
  const dt = Math.min(.045, (now - last) / 1000);
  last = now;
  move(dt);
  requestTrace();
  const moving = now < interactionUntil;
  if (paintDirty || moving) {
    draw(renderers[view === 'intrinsic' ? 0 : 1], true);
    if (!moving || now - lastObserverDraw > 32) {
      draw(renderers[view === 'intrinsic' ? 1 : 0], false);
      lastObserverDraw = now;
    }
    paintDirty = false;
  }
  hud += dt;
  if (hud > .25) {
    const k = curvature(avatar.p, config);
    $('readout').textContent = distance.toFixed(1) + ' m travelled · K ' + (Math.abs(k) < .00005 ?
      '0.000' : k.toFixed(3));
    hud = 0;
  }
  requestAnimationFrame(frame);
}
syncControls();
setView(view);
requestAnimationFrame(frame);
if (document.modelContext?.registerTool) {
  for (const tool of [{
      name: 'read_surface_state',
      description: 'Read the current surface, constrained player position and local Gaussian curvature.',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false
      },
      annotations: {
        readOnlyHint: true
      },
      execute: () => ({
        surface: config.mode,
        view,
        position: avatar.p,
        curvature: curvature(avatar.p, config),
        distanceTravelled: distance,
        shapeCount: config.shapes.length,
        maxShapes: limits.maxShapes
      })
    }, {
      name: 'select_surface',
      description: 'Select a surface example and reset the player on it.',
      inputSchema: {
        type: 'object',
        properties: {
          surface: {
            type: 'string',
            enum: types
          }
        },
        required: ['surface'],
        additionalProperties: false
      },
      execute: input => {
        if (!types.includes(input?.surface)) throw Error('Invalid surface');
        $('scene').value = input.surface;
        $('scene').onchange();
        return {
          surface: config.mode,
          position: avatar.p
        };
      }
    }]) {
    try {
      Promise.resolve(document.modelContext.registerTool(tool)).catch(() => {});
    } catch {}
  }
}
