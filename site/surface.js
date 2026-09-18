export const TAU = Math.PI * 2;
export const add = (a, b) => a.map((v, i) => v + b[i]);
export const sub = (a, b) => a.map((v, i) => v - b[i]);
export const mul = (a, s) => a.map(v => v * s);
export const dot = (a, b) => a.reduce((v, x, i) => v + x * b[i], 0);
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const norm = a => mul(a, 1 / Math.max(1e-12, Math.hypot(...a)));
export const SHAPE_TYPES = ['handle', 'bump', 'bowl', 'ring', 'plane', 'cube', 'sphere', 'cylinder'];
export const MAX_SHAPES = 10; // Keep in sync with the worker and GLSL fixed arrays.
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

function blend(a, b, k) {
  const h = clamp(.5 + .5 * (b[0] - a[0]) / k, 0, 1), q = 1 - h;
  return [b[0] * q + a[0] * h - k * h * q, b[1] * q + a[1] * h, b[2] * q + a[2] * h, b[3] * q + a[3] * h];
}
function maximum(a, b, k) { return blend(a.map(v => -v), b.map(v => -v), k).map(v => -v); }
function sphere(x, y, z, r) {
  const l = Math.max(1e-9, Math.hypot(x, y, z));
  return [l - r, x / l, y / l, z / l];
}
function torus(x, y, z, R, r, vertical) {
  const radial = Math.max(vertical ? Math.hypot(x, z) : Math.hypot(x, y), 1e-9), a = radial - R,
    b = vertical ? y : z, l = Math.max(1e-9, Math.hypot(a, b)), g = a / l / radial;
  return vertical ? [l - r, x * g, b / l, z * g] : [l - r, x * g, y * g, b / l];
}
function roundedBox(x, y, z, bx, by, bz, round) {
  const ax = Math.abs(x) - bx, ay = Math.abs(y) - by, az = Math.abs(z) - bz;
  const ox = Math.max(ax, 0), oy = Math.max(ay, 0), oz = Math.max(az, 0), l = Math.hypot(ox, oy, oz);
  let gx = 0, gy = 0, gz = 0;
  if (l > 1e-9) {
    gx = ox / l * Math.sign(x); gy = oy / l * Math.sign(y); gz = oz / l * Math.sign(z);
  } else if (ax >= ay && ax >= az) gx = Math.sign(x) || 1;
  else if (ay >= az) gy = Math.sign(y) || 1;
  else gz = Math.sign(z) || 1;
  return [l + Math.min(Math.max(ax, Math.max(ay, az)), 0) - round, gx, gy, gz];
}
function cappedCylinder(x, y, z, r, h) {
  const radial = Math.max(Math.hypot(x, y), 1e-9), a = radial - r, b = Math.abs(z) - h,
    oa = Math.max(a, 0), ob = Math.max(b, 0), l = Math.hypot(oa, ob);
  let gx = 0, gy = 0, gz = 0;
  if (l > 1e-9) { gx = oa / l * x / radial; gy = oa / l * y / radial; gz = ob / l * (Math.sign(z) || 1); }
  else if (a >= b) { gx = x / radial; gy = y / radial; }
  else gz = Math.sign(z) || 1;
  return [l + Math.min(Math.max(a, b), 0), gx, gy, gz];
}

// A shape keeps the legacy `rotation` (Z rotation) readable, while rotationX/Y/Z
// add a complete local frame. Rz * Ry * Rx maps local vectors to world vectors.
function rotations(o) { return [o.rotationX || 0, o.rotationY || 0, o.rotationZ ?? o.rotation ?? 0]; }
function localPoint(x, y, z, o) {
  const [rx, ry, rz] = rotations(o), cx = Math.cos(rx), sx = Math.sin(rx), cy = Math.cos(ry), sy = Math.sin(ry), cz = Math.cos(rz), sz = Math.sin(rz);
  const dx = x - o.x, dy = y - o.y, dz = z - (o.z || 0);
  const x1 = dx * cz + dy * sz, y1 = -dx * sz + dy * cz;
  const x2 = x1 * cy - dz * sy, z2 = x1 * sy + dz * cy;
  return [x2, y1 * cx + z2 * sx, -y1 * sx + z2 * cx];
}
function worldVector(v, o) {
  const [rx, ry, rz] = rotations(o), cx = Math.cos(rx), sx = Math.sin(rx), cy = Math.cos(ry), sy = Math.sin(ry), cz = Math.cos(rz), sz = Math.sin(rz);
  const x1 = v[0], y1 = cx * v[1] - sx * v[2], z1 = sx * v[1] + cx * v[2];
  const x2 = cy * x1 + sy * z1, z2 = -sy * x1 + cy * z1;
  return [cz * x2 - sz * y1, sz * x2 + cz * y1, z2];
}
export function operationOf(o) { return o.operation || (o.type === 'bowl' ? 'negative' : 'additive'); }
export function colorOf(o) { return /^#[0-9a-f]{6}$/i.test(o.color || '') ? o.color : '#3ba4e4'; }
function shapeField(o, x, y, z) {
  const [rx, ry, rz] = localPoint(x, y, z, o), stretch = Math.max(.05, o.strength), scale = Math.min(1, stretch), zz = rz / stretch;
  let t;
  if (o.type === 'handle') t = torus(rx, ry, zz, o.size, Math.max(.6, o.size * .29), true);
  else if (o.type === 'ring') t = torus(rx, ry, zz, o.size, Math.max(.6, o.size * .29), false);
  else if (o.type === 'plane') t = roundedBox(rx, ry, zz, o.size, o.size, .13, .06);
  else if (o.type === 'cube') t = roundedBox(rx, ry, zz, o.size * .55, o.size * .55, o.size * .55, .09);
  else if (o.type === 'cylinder') t = cappedCylinder(rx, ry, zz, o.size, o.size * .62);
  else {
    const offset = o.type === 'bowl' ? -o.size * .28 : o.size * .28;
    t = sphere(rx, ry, (rz + offset) / stretch, o.size);
  }
  const g = worldVector([t[1], t[2], t[3] / stretch], o);
  return [t[0] * scale, g[0] * scale, g[1] * scale, g[2] * scale];
}

// Return signed implicit field and its analytical gradient. The worker and GLSL mirror this.
export function field(p, c) {
  const [x, y, z] = p;
  if (c.mode === 'cylinder') {
    const l = Math.max(1e-9, Math.hypot(x, z)); return [l - c.radius, x / l, 0, z / l];
  }
  if (c.mode === 'torus') return torus(x, y, z, c.radius + 2, Math.max(.6, c.strength * .65), false);
  if (c.mode === 'sheets') {
    const rr = Math.max(1e-9, Math.hypot(x, y));
    return maximum([Math.abs(z) - c.strength, 0, 0, Math.sign(z) || 1], [c.radius - rr, -x / rr, -y / rr, 0], c.blend);
  }
  let f = [z, 0, 0, 1];
  for (const o of c.shapes) {
    const b = shapeField(o, x, y, z);
    f = operationOf(o) === 'negative' ? maximum(f, b.map(v => -v), o.blend) : blend(f, b, o.blend);
  }
  return f;
}
export function project(p, c, iterations = 4) {
  let q = p.slice();
  for (let i = 0; i < iterations; i++) {
    const f = field(q, c), gg = f[1] ** 2 + f[2] ** 2 + f[3] ** 2;
    if (gg < 1e-14) break;
    const t = clamp(f[0] / gg, -.6, .6); q = [q[0] - t * f[1], q[1] - t * f[2], q[2] - t * f[3]];
  }
  return q;
}
export function normal(p, c) { return norm(field(p, c).slice(1)); }
export function transport(v, n0, n1) { return norm(sub(v, mul(add(n0, n1), dot(v, n1) / Math.max(.01, 1 + dot(n0, n1))))); }
export function step(p, v, h, c) {
  const n0 = normal(p, c), q = project(add(p, mul(v, h)), c, 3), n1 = normal(q, c);
  return { p: q, v: transport(v, n0, n1), n: n1 };
}
export function curvature(p, c) {
  const n = normal(p, c), a = norm(cross(n, Math.abs(n[2]) < .9 ? [0, 0, 1] : [0, 1, 0])), b = cross(n, a), e = .025;
  const da = mul(sub(normal(add(p, mul(a, e)), c), normal(add(p, mul(a, -e)), c)), .5 / e), db = mul(sub(normal(add(p, mul(b, e)), c), normal(add(p, mul(b, -e)), c)), .5 / e);
  return dot(a, da) * dot(b, db) - dot(a, db) * dot(b, da);
}
export function defaults() {
  return { mode: 'joined', radius: 2.3, strength: 2.5, blend: 1.15, shapes: [
    { type: 'handle', operation: 'additive', color: '#31a6e8', x: 0, y: 0, z: 0, rotationX: 0, rotationY: 0, rotationZ: 0, size: 3.4, strength: 1.3, blend: 1.15 },
    { type: 'bump', operation: 'additive', color: '#f4774f', x: 10, y: 2, z: 0, rotationX: 0, rotationY: 0, rotationZ: 0, size: 3, strength: 1.5, blend: 1.3 },
    { type: 'bowl', operation: 'negative', color: '#805ad5', x: -9, y: 1, z: 0, rotationX: 0, rotationY: 0, rotationZ: 0, size: 3, strength: 1.6, blend: 1.3 }
  ] };
}
export function spawn(c, onShape = false, index = 0) {
  let p, v;
  if (c.mode === 'cylinder') { p = [0, 0, c.radius]; v = [1, 0, 0]; }
  else if (c.mode === 'torus') { p = [c.radius + 2 + Math.max(.6, c.strength * .65), 0, 0]; v = [0, 1, 0]; }
  else if (c.mode === 'sheets') { p = [0, -c.radius - 3, c.strength]; v = [0, 1, 0]; }
  else {
    const o = c.shapes[index] || c.shapes[0] || { x: 0, y: 0, z: 0, size: 3.4, strength: 1.3, type: 'handle' };
    if (onShape) { p = [o.x, o.y, (o.z || 0) + o.size * Math.max(1, o.strength) + 1]; v = [0, 1, 0]; }
    else { p = [o.x + (o.type === 'handle' ? o.size : 0), o.y - (o.type === 'handle' ? o.size * .29 : o.size) - 2, 0]; v = [0, 1, 0]; }
  }
  p = project(p, c, 35); const n = normal(p, c); v = norm(sub(v, mul(n, dot(v, n))));
  return { p, v, n };
}
