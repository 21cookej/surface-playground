export const TAU = Math.PI * 2;
export const add = (a, b) => a.map((v, i) => v + b[i]);
export const sub = (a, b) => a.map((v, i) => v - b[i]);
export const mul = (a, s) => a.map(v => v * s);
export const dot = (a, b) => a.reduce((v, x, i) => v + x * b[i], 0);
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] -
  a[1] * b[0]
];
export const norm = a => mul(a, 1 / Math.max(1e-12, Math.hypot(...a)));
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

function blend(a, b, k) {
  const h = clamp(.5 + .5 * (b[0] - a[0]) / k, 0, 1),
    q = 1 - h;
  return [b[0] * q + a[0] * h - k * h * q, b[1] * q + a[1] * h, b[2] * q + a[2] * h, b[3] * q + a[
    3] * h
  ];
}

function maximum(a, b, k) {
  return blend(a.map(v => -v), b.map(v => -v), k).map(v => -v);
}

function sphere(x, y, z, r) {
  const l = Math.max(1e-9, Math.hypot(x, y, z));
  return [l - r, x / l, y / l, z / l];
}

// Faceted diamond/pyramid form (L1 norm) used for the "spike" shape.
function spike(x, y, z, r) {
  const l = Math.max(1e-9, Math.abs(x) + Math.abs(y) + Math.abs(z));
  return [l - r, Math.sign(x), Math.sign(y), Math.sign(z)];
}

function torus(x, y, z, R, r, vertical) {
  let radial = vertical ? Math.hypot(x, z) : Math.hypot(x, y);
  radial = Math.max(radial, 1e-9);
  let a = radial - R,
    b = vertical ? y : z,
    l = Math.max(1e-9, Math.hypot(a, b)),
    g = a / l / radial;
  return vertical ? [l - r, x * g, b / l, z * g] : [l - r, x * g, y * g, b / l];
}
// Every shape is sampled in a local frame: translated by (o.x, o.y), rotated
// by o.rotation around the vertical (z) axis, and shifted in height by o.z.
// The resulting local gradient is rotated back into world space.
export const SHAPE_TYPES = ['handle', 'bump', 'bowl', 'ring', 'spike'];
function shapeField(o, x, y, z) {
  const xx = x - o.x,
    yy = y - o.y,
    zz0 = z - (o.z || 0),
    a = o.rotation || 0,
    co = Math.cos(a),
    si = Math.sin(a),
    rx = xx * co + yy * si,
    ry = -xx * si + yy * co,
    stretch = o.strength,
    scale = Math.min(1, stretch);
  let t;
  if (o.type === 'handle') {
    t = torus(rx, ry, zz0 / stretch, o.size, Math.max(.6, o.size * .29), true);
  } else if (o.type === 'ring') {
    t = torus(rx, ry, zz0 / stretch, o.size, Math.max(.6, o.size * .29), false);
  } else {
    const zz = (zz0 + (o.type === 'bowl' ? -o.size * .28 : o.size * .28)) / stretch;
    t = o.type === 'spike' ? spike(rx, ry, zz, o.size) : sphere(rx, ry, zz, o.size);
  }
  const gx = t[1] * co - t[2] * si,
    gy = t[1] * si + t[2] * co;
  return [t[0] * scale, gx * scale, gy * scale, t[3] * scale / stretch];
}
// Return signed implicit field and its analytical gradient, shared with GLSL.
export function field(p, c) {
  const [x, y, z] = p;
  if (c.mode === 'cylinder') {
    const l = Math.max(1e-9, Math.hypot(x, z));
    return [l - c.radius, x / l, 0, z / l];
  }
  if (c.mode === 'torus') return torus(x, y, z, c.radius + 2, Math.max(.6, c.strength * .65),
  false);
  if (c.mode === 'sheets') {
    const rr = Math.max(1e-9, Math.hypot(x, y));
    return maximum([Math.abs(z) - c.strength, 0, 0, Math.sign(z) || 1], [c.radius - rr, -x / rr, -
      y / rr, 0
    ], c.blend);
  }
  let f = [z, 0, 0, 1];
  for (const o of c.shapes) {
    const b = shapeField(o, x, y, z),
      k = o.blend;
    f = o.type === 'bowl' ? maximum(f, b.map(v => -v), k) : blend(f, b, k);
  }
  return f;
}
export function project(p, c, iterations = 4) {
  let q = p.slice();
  for (let i = 0; i < iterations; i++) {
    const f = field(q, c),
      gg = f[1] ** 2 + f[2] ** 2 + f[3] ** 2;
    if (gg < 1e-14) break;
    const t = clamp(f[0] / gg, -.6, .6);
    q = [q[0] - t * f[1], q[1] - t * f[2], q[2] - t * f[3]];
  }
  return q;
}
export function normal(p, c) {
  return norm(field(p, c).slice(1));
}
export function transport(v, n0, n1) {
  const den = Math.max(.01, 1 + dot(n0, n1));
  return norm(sub(v, mul(add(n0, n1), dot(v, n1) / den)));
}
export function step(p, v, h, c) {
  const n0 = normal(p, c);
  const q = project(add(p, mul(v, h)), c, 3),
    n1 = normal(q, c);
  return {
    p: q,
    v: transport(v, n0, n1),
    n: n1
  };
}
export function curvature(p, c) {
  const n = normal(p, c),
    a = norm(cross(n, Math.abs(n[2]) < .9 ? [0, 0, 1] : [0, 1, 0])),
    b = cross(n, a),
    e = .025;
  const da = mul(sub(normal(add(p, mul(a, e)), c), normal(add(p, mul(a, -e)), c)), .5 / e),
    db = mul(sub(normal(add(p, mul(b, e)), c), normal(add(p, mul(b, -e)), c)), .5 / e);
  return dot(a, da) * dot(b, db) - dot(a, db) * dot(b, da);
}
export function defaults() {
  return {
    mode: 'joined',
    radius: 2.3,
    strength: 2.5,
    blend: 1.15,
    shapes: [{
      type: 'handle',
      x: 0,
      y: 0,
      z: 0,
      rotation: 0,
      size: 3.4,
      strength: 1.3,
      blend: 1.15
    }, {
      type: 'bump',
      x: 10,
      y: 2,
      z: 0,
      rotation: 0,
      size: 3,
      strength: 1.5,
      blend: 1.3
    }, {
      type: 'bowl',
      x: -9,
      y: 1,
      z: 0,
      rotation: 0,
      size: 3,
      strength: 1.6,
      blend: 1.3
    }]
  };
}
export function spawn(c, onShape = false, index = 0) {
  let p, v;
  if (c.mode === 'cylinder') {
    p = [0, 0, c.radius];
    v = [1, 0, 0];
  } else if (c.mode === 'torus') {
    p = [c.radius + 2 + Math.max(.6, c.strength * .65), 0, 0];
    v = [0, 1, 0];
  } else if (c.mode === 'sheets') {
    p = [0, -c.radius - 3, c.strength];
    v = [0, 1, 0];
  } else {
    const o = c.shapes[index] || {
      x: 0,
      y: 0,
      size: 3.4,
      strength: 1.3,
      type: 'handle'
    };
    if (onShape) {
      if (o.type === 'handle') {
        p = [o.x, o.y - o.size * .29, o.size * o.strength];
        v = [-1, 0, 0];
      } else {
        p = [o.x, o.y, o.type === 'bowl' ? -o.size * o.strength : o.size * o.strength];
        v = [0, 1, 0];
      }
    } else {
      p = [o.x + (o.type === 'handle' ? o.size : 0), o.y - (o.type === 'handle' ? o.size * .29 : o
        .size) - 2, 0];
      v = [0, 1, 0];
    }
  }
  p = project(p, c, 35);
  const n = normal(p, c);
  v = norm(sub(v, mul(n, dot(v, n))));
  return {
    p,
    v,
    n
  };
}
