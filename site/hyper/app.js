import {
  grounded,
  groundFrame,
  moveWithCollision,
  norm,
  defaults,
  spawn,
  field,
  project,
  frame,
  advance,
  turn,
  add,
  scale,
  unit,
  MAX_OBJECTS,
  rotationAngles,
  rotationMatrix,
  rotateVector
} from './math.js';
import {
  vertex,
  fragment
} from './shaders.js';
const $ = id => document.getElementById(id);
let config = defaults(),
  state = spawn(config),
  selection = 0,
  outside = false,
  dirty = true,
  auto = false,
  last = 0,
  lastInset = -1000,
  insetDirty = true,
  orbit = .5,
  elevation = .6,
  travel = 0;
const keys = new Set(),
  scenes = new Map(),
  renderers = [];
// Render close to CSS resolution while idle for clean patterns, then lower the
// pixel count temporarily during interaction. This feels faster than permanently
// stretching an 800px image across a large display.
const quality = [{scale:.68,moving:.46,max:900,step:.20},{scale:.90,moving:.58,max:1320,step:.16},{scale:1.08,moving:.72,max:1800,step:.13}];
let reducedResolution=true, refineAfter=0;
const centers=new Float32Array(24),specs=new Float32Array(24),tints=new Float32Array(24),ops=new Float32Array(6),rotationActive=new Float32Array(6),objectRotations=new Float32Array(96);

function renderer(canvas) {
  const gl = canvas.getContext('webgl', {
    alpha: false,
    antialias: false,
    preserveDrawingBuffer: false
  });
  if (!gl) throw Error('This 4D mode needs WebGL. Try a browser with hardware acceleration enabled.');
  gl.getExtension('OES_standard_derivatives');
  const program = gl.createProgram();
  for (const [type, src] of [
      [gl.VERTEX_SHADER, vertex],
      [gl.FRAGMENT_SHADER, fragment]
    ]) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(s));
    gl.attachShader(program, s);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(program));
  gl.useProgram(program);
  const b = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, b);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
  const at = gl.getAttribLocation(program, 'a');
  gl.enableVertexAttribArray(at);
  gl.vertexAttribPointer(at, 2, gl.FLOAT, false, 0, 0);
  const loc = new Map();
  return {
    canvas,
    gl,
    program,
    uniform(name, type, ...v) {
      if (!loc.has(name)) loc.set(name, gl.getUniformLocation(program, name));
      gl[type](loc.get(name), ...v);
    }
  };
}

function resize(reduced = reducedResolution) {
  reducedResolution = reduced;
  const q = quality[+$('quality').value], dpr = Math.min(globalThis.devicePixelRatio || 1, 1.25);
  for (let i = 0; i < renderers.length; i++) {
    const r = renderers[i],
      b = r.canvas.getBoundingClientRect(),
      scale = i ? Math.min(1,dpr) : (reduced ? q.moving : q.scale) * dpr,
      w = Math.min(b.width * scale, i ? 300 : q.max);
    r.canvas.width = Math.max(2,Math.round(w));
    r.canvas.height = Math.max(2,Math.round(w * b.height / Math.max(1,b.width)));
  }
  dirty = true;
}

function cameraAxes() {
  const copy = {
    p: state.p,
    axes: $('level-camera').checked ? groundFrame(state, config) : state.axes.map(a => [...a])
  };
  turn(copy, 0, +$('pitch').value * Math.PI / 180);
  return copy.axes;
}

function settle() {
  const height = Number($('eye-height').value);
  $('eye-height').value = Number.isFinite(height) ? Math.max(.2, Math.min(2, height)) : .6;
  if ($('ground-lock').checked) {
    const p = grounded(state.p, config, +$('eye-height').value);
    if (p) state = {
      p,
      axes: frame(p, state.axes, config)
    };
    else {
      $('ground-lock').checked = false;
      $('status').textContent = 'No ground at this height — free movement enabled';
    }
  }
  if ($('level-camera').checked) state.axes = groundFrame(state, config);
  dirty = true;
}

function interact(){refineAfter=performance.now()+150;if(!reducedResolution)resize(true);}

function look(yaw, pitch) {
  interact();
  turn(state, yaw, 0);
  $('pitch').value = Math.max(-80, Math.min(80, +$('pitch').value + pitch * 180 / Math.PI));
  dirty = true;
}

function draw(r, view) {
  const axes = cameraAxes();
  const {
    gl,
    canvas
  } = r, U = r.uniform;
  gl.useProgram(r.program);
  gl.viewport(0, 0, canvas.width, canvas.height);
  U('resolution', 'uniform2f', canvas.width, canvas.height);
  for (const [n, a] of [
      ['player', state.p],
      ['forward', axes[0]],
      ['right', axes[1]],
      ['up', axes[2]],
      ['groundUp', groundFrame(state, config)[2]]
    ]) U(n, 'uniform4fv', new Float32Array(a));
  for (const [n, v] of [
      ['mode', config.mode],
      ['count', config.objects.length],
      ['view', view],
      ['colorMode', +$('colors').value],
      ['wrappedSky', $('wrapped-sky').checked ? 1 : 0],
      ['observerFollow', $('follow').checked ? 1 : 0]
    ]) U(n, 'uniform1i', v);
  for (const [n, v] of [
      ['radius', config.radius],
      ['baseBlend', config.blend],
      ['fov', +$('fov').value * Math.PI / 180],
      ['rayStep', quality[+$('quality').value].step],
      ['range', 22],
      ['slice', $('follow').checked ? state.p[1] : +$('slice').value],
      ['rotation', +$('rotation').value * Math.PI / 180],
      ['orbit', orbit],
      ['elevation', elevation],
      ['observerDistance', +$('distance').value]
    ]) U(n, 'uniform1f', v);
  centers.fill(0);specs.fill(0);tints.fill(0);ops.fill(0);rotationActive.fill(0);objectRotations.fill(0);
  config.objects.forEach((o, i) => {
    centers.set(o.p, i * 4);
    specs.set([o.type, o.radius, o.major, o.blend], i * 4);
    tints.set([...o.color.slice(1).match(/../g).map(x => parseInt(x, 16) / 255), 1], i * 4);
    const m=rotationMatrix(o),angles=rotationAngles(o);
    rotationActive[i]=angles.some(a=>Math.abs(a)>1e-8)?1:0;
    // WebGL matrices are column-major; rotationMatrix is row-major.
    for(let row=0;row<4;row++)for(let col=0;col<4;col++)objectRotations[i*16+col*4+row]=m[row*4+col];
  });
  for(let i=config.objects.length;i<6;i++)for(let j=0;j<4;j++)objectRotations[i*16+j*5]=1;
  U('centers[0]', 'uniform4fv', centers);
  U('specs[0]', 'uniform4fv', specs);
  U('tints[0]', 'uniform4fv', tints);
  U('rotationActive[0]', 'uniform1fv', rotationActive);
  U('objectRotations[0]', 'uniformMatrix4fv', false, objectRotations);
  config.objects.forEach((o, i) => ops[i] = o.negative ? 1 : 0);
  U('operations[0]', 'uniform1fv', ops);
  gl.drawArrays(gl.TRIANGLES, 0, 6);
  if (r.copyContext) {
    r.copyContext.drawImage(renderers[0].canvas, 0, renderers[0].canvas.height - canvas.height, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
  }
}

function select() {
  const opts = config.objects.map((o, i) => new Option(`${i+1} · ${['Hypersphere','Loop cylinder','4D torus','Hypercube','Capped cylinder','Plane slab'][o.type]}`, i));
  $('object').replaceChildren(...opts);
  selection = Math.min(selection, config.objects.length - 1);
  $('object').value = selection;
  $('editor').hidden = selection < 0;
  $('count').textContent = `${config.objects.length}/${MAX_OBJECTS}`;
  document.querySelectorAll('[data-add]').forEach(b => b.disabled = config.objects.length >= MAX_OBJECTS);
  if (selection < 0) return;
  const o = config.objects[selection];
  ['x', 'y', 'z', 'w'].forEach((id, i) => $(id).value = o.p[i].toFixed(2));
  for (const id of ['radius', 'major', 'blend']) $(id).value = o[id];
  const a=rotationAngles(o),ids=['angleXY','angleXZ','angle','angleYZ','angleYW','angleZW'];
  ids.forEach((id,i)=>$(id).value=(a[i]*180/Math.PI).toFixed(2));
  $('tint').value = o.color;
  $('major').disabled = o.type !== 2 && o.type !== 4;
  $('operation').value = o.negative ? 'negative' : 'additive';
}

function reset() {
  state = spawn(config);
  settle();
  travel = 0;
  dirty = true;
}

function swap() {
  outside = !outside;
  $('inside').setAttribute('aria-pressed', !outside);
  $('outside').setAttribute('aria-pressed', outside);
  $('view-title').textContent = outside ? 'OUTSIDE · 3D SLICE' : 'ONE DIMENSION HIGHER';
  $('view-copy').textContent = outside ? 'X / Z / W visible · Y held at the slice.' : 'Travel through a 3D space that bends into W.';
  $('inset-title').textContent = outside ? 'INSIDE VIEW · CLICK TO SWAP ↗' : '4D SLICE · CLICK TO SWAP ↗';
  $('crosshair').hidden = outside;
  $('world').setAttribute('aria-label', outside ? 'Three-dimensional slice of the four-dimensional geometry' : 'First-person view inside the curved three-dimensional space');
  dirty = true;
}
$('inside').onclick = () => {
  if (outside) swap();
};
$('outside').onclick = () => {
  if (!outside) swap();
};
$('inset').onclick = swap;
$('reset').onclick = reset;
$('scene').onchange = () => {
  scenes.set(config.mode, config);
  config = scenes.get(+$('scene').value) || defaults(+$('scene').value);
  selection = 0;
  reset();
  select();
};
$('object').onchange = () => {
  selection = +$('object').value;
  select();
};
document.querySelectorAll('[data-add]').forEach(b => b.onclick = () => {
  if (config.objects.length >= MAX_OBJECTS) return;
  const p = add(state.p, scale(state.axes[0], 4));
  p[3] -= 1.3;
  config.objects.push({
    type: +b.dataset.add,
    p,
    radius: 2.5,
    major: 3,
    blend: .8,
    angle: 0,
    angleXY:0,angleXZ:0,angleXW:0,angleYZ:0,angleYW:0,angleZW:0,
    color: '#b89be8'
  });
  selection = config.objects.length - 1;
  state.p = project(state.p, config);
  state.axes = frame(state.p, state.axes, config);
  settle();
  select();
  dirty = true;
});

function edit() {
  if (selection < 0) return;
  const o = config.objects[selection];
  for (const [id, i] of [
      ['x', 0],
      ['y', 1],
      ['z', 2],
      ['w', 3]
    ]) {
    const v = parseFloat($(id).value);
    if (Number.isFinite(v)) o.p[i] = Math.max(-10000, Math.min(10000, v));
  }
  for (const id of ['radius', 'major', 'blend']) {
    const v = parseFloat($(id).value);
    if (Number.isFinite(v)) o[id] = Math.max(+$(id).min, Math.min(+$(id).max, v));
  }
  for(const [id,key] of [['angleXY','angleXY'],['angleXZ','angleXZ'],['angle','angleXW'],['angleYZ','angleYZ'],['angleYW','angleYW'],['angleZW','angleZW']]){
    const a=parseFloat($(id).value);if(Number.isFinite(a))o[key]=a*Math.PI/180;
  }
  o.angle=o.angleXW; // readable by older saved configurations
  o.color = $('tint').value;
  o.negative = $('operation').value === 'negative';
  state.p = project(state.p, config);
  state.axes = frame(state.p, state.axes, config);
  settle();
  dirty = true;
}
for (const id of ['x', 'y', 'z', 'w', 'radius', 'major', 'blend', 'angleXY', 'angleXZ', 'angle', 'angleYZ', 'angleYW', 'angleZW', 'tint', 'operation']) $(id).onchange = edit;
$('remove').onclick = () => {
  if (selection < 0) return;
  config.objects.splice(selection, 1);
  select();
  reset();
};
$('visit').onclick = () => {
  if (selection < 0) return;
  const o = config.objects[selection];
  const local = o.type === 2 ? [o.major, 0, 0, o.radius] : [0, 0, 0, o.radius];
  state.p = project(add(o.p, rotateVector(o,local)), config);
  state.axes = frame(state.p, [rotateVector(o,[0,0,1,0]),rotateVector(o,[1,0,0,0]),rotateVector(o,[0,1,0,0])], config);
  settle();
  dirty = true;
};
$('auto').onclick = () => {
  auto = !auto;
  $('auto').setAttribute('aria-pressed', auto);
};
$('collapse').onclick = () => {
  $('panel').hidden = true;
  $('show-controls').hidden = false;
};
$('show-controls').onclick = () => {
  $('panel').hidden = false;
  $('show-controls').hidden = true;
};
for (const id of ['ground-lock', 'eye-height', 'level-camera']) $(id).onchange = settle;
$('wrapped-sky').onchange = () => {
  dirty = true;
};
$('pitch').oninput = () => {
  dirty = true;
};
for (const id of ['fov', 'speed', 'quality', 'colors', 'slice', 'follow', 'rotation', 'distance']) $(id).oninput = () => {
  $('fov-value').textContent = $('fov').value + '°';
  if (id === 'quality') {reducedResolution=false;resize(false);}
  dirty = true;
};
addEventListener('keydown', e => {
  if (/INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
  const k = e.key.toLowerCase();
  if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) e.preventDefault();
  keys.add(k);
  if (!e.repeat && k === 'v') swap();
  if (!e.repeat && k === 'r') reset();
});
addEventListener('keyup', e => keys.delete(e.key.toLowerCase()));
addEventListener('blur', () => keys.clear());
document.addEventListener('visibilitychange', () => {
  keys.clear();
  last = 0;
});
let drag = null;
$('world').onpointerdown = e => {
  drag = [e.clientX, e.clientY];
  $('world').setPointerCapture(e.pointerId);
};
$('world').onpointermove = e => {
  if (!drag) return;
  const dx = e.clientX - drag[0],
    dy = e.clientY - drag[1];
  drag = [e.clientX, e.clientY];
  if (outside) {
    orbit -= dx * .006;
    elevation = Math.max(.08, Math.min(1.45, elevation + dy * .006));
  } else look(dx * .004, -dy * .004);
  dirty = true;
};
$('world').onpointerup = $('world').onpointercancel = () => drag = null;
document.querySelectorAll('[data-key]').forEach(b => {
  b.onpointerdown = e => {
    e.preventDefault();
    b.setPointerCapture(e.pointerId);
    keys.add(b.dataset.key);
  };
  b.onpointerup = b.onpointercancel = () => keys.delete(b.dataset.key);
});

function tick(now) {
  requestAnimationFrame(tick);
  if (document.hidden) {
    last = now;
    return;
  }
  const dt = Math.min(.04, last ? (now - last) / 1000 : 0);
  last = now;
  let f = (keys.has('w') || auto ? 1 : 0) - (keys.has('s') ? 1 : 0),
    r = (keys.has('d') ? 1 : 0) - (keys.has('a') ? 1 : 0),
    u = (keys.has(' ') ? 1 : 0) - (keys.has('c') ? 1 : 0),
    yaw = (keys.has('arrowright') ? 1 : 0) - (keys.has('arrowleft') ? 1 : 0),
    pitch = (keys.has('arrowup') ? 1 : 0) - (keys.has('arrowdown') ? 1 : 0);
  if (yaw || pitch) {
    look(yaw * dt, pitch * dt);
    dirty = true;
  }
  if (f || r || u) {
    interact();
    const dir = add(add(scale(state.axes[0], f), scale(state.axes[1], r)), scale(state.axes[2], u)),
      ds = dt * (+$('speed').value);
    const before = state.p;
    state = moveWithCollision(state, dir, ds, config, $('ground-lock').checked, +$('eye-height').value);
    if ($('level-camera').checked) state.axes = groundFrame(state, config);
    travel += norm(add(state.p, scale(before, -1)));
    dirty = true;
  }
  if(reducedResolution&&now>=refineAfter&&!f&&!r&&!u&&!yaw&&!pitch&&drag===null)resize(false);
  if (dirty) insetDirty = true;
  let copied = false;
  if (insetDirty && now - lastInset > 180) {
    draw(renderers[1], outside ? 0 : 1);
    lastInset = now;
    insetDirty = false;
    copied = true;
  }
  if (dirty || copied) {
    draw(renderers[0], outside ? 1 : 0);
    $('status').textContent = `W ${state.p[3].toFixed(2)} · ${travel.toFixed(1)} m travelled`;
    dirty = false;
  }
}
try {
  const main = renderer($('world'));
  renderers.push(main, {
    ...main,
    canvas: $('other'),
    copyContext: $('other').getContext('2d')
  });
  addEventListener('resize', resize);
  select();
  settle();
  resize(true);
  refineAfter=performance.now()+120;
  requestAnimationFrame(tick);
} catch (e) {
  $('error').hidden = false;
  $('error').textContent = e.message;
  console.error(e);
}
// Read-only state for numerical QA and external agent inspection.
if (document.modelContext?.registerTool) document.modelContext.registerTool({
  name: 'read_4d_state',
  description: 'Read the four-dimensional position and implicit manifold residual.',
  inputSchema: {
    type: 'object',
    properties: {}
  },
  execute: () => ({
    position: state.p,
    axes: state.axes,
    mode: config.mode,
    objects: config.objects.length,
    observerFollowing: $('follow').checked,
    residual: field(state.p, config).d
  })
});
