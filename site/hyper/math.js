// A 3-manifold F(x,y,z,w)=0 embedded in Euclidean R4.
// Coordinates and transported camera axes are four-component vectors.
export const add = (a, b) => a.map((x, i) => x + b[i]);
export const scale = (a, s) => a.map(x => x * s);
export const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
export const norm = a => Math.hypot(...a);
export const unit = a => scale(a, 1 / Math.max(norm(a), 1e-12));
export const tangent = (v, n) => add(v, scale(n, -dot(v, n)));
export const MAX_OBJECTS = 6;
export const ROTATION_PLANES = ['XY','XZ','XW','YZ','YW','ZW'];
const rotationCache = new WeakMap();
export function rotationAngles(o) {
  return [o.angleXY || 0, o.angleXZ || 0, o.angleXW ?? o.angle ?? 0,
    o.angleYZ || 0, o.angleYW || 0, o.angleZW || 0];
}
// Row-major local-to-world SO(4) matrix. The six Givens rotations expose every
// independent 4D rotation plane while retaining legacy `angle` as XW.
export function rotationMatrix(o) {
  const angles = rotationAngles(o), key = angles.join(','), cached = rotationCache.get(o);
  if (cached?.key === key) return cached.matrix;
  let m = [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
  const planes = [[0,1],[0,2],[0,3],[1,2],[1,3],[2,3]];
  for (let k=0;k<6;k++) {
    const a=angles[k]; if (!a) continue;
    const [i,j]=planes[k], c=Math.cos(a), q=Math.sin(a), next=m.slice();
    for (let col=0;col<4;col++) {
      next[i*4+col]=c*m[i*4+col]-q*m[j*4+col];
      next[j*4+col]=q*m[i*4+col]+c*m[j*4+col];
    }
    m=next;
  }
  rotationCache.set(o,{key,matrix:m});
  return m;
}
export function rotateVector(o,v) {
  const m=rotationMatrix(o);
  return [0,1,2,3].map(r=>m[r*4]*v[0]+m[r*4+1]*v[1]+m[r*4+2]*v[2]+m[r*4+3]*v[3]);
}
function inverseRotateVector(o,v) {
  const m=rotationMatrix(o);
  return [0,1,2,3].map(c=>m[c]*v[0]+m[4+c]*v[1]+m[8+c]*v[2]+m[12+c]*v[3]);
}
export function defaults(mode = 0) {
  return {
    mode,
    radius: 3,
    blend: .8,
    objects: mode === 0 ? [{
      type: 0,
      p: [0, 0, 3, -1.7],
      radius: 3.2,
      major: 3,
      blend: 1,
      angle: 0,
      angleXY: 0, angleXZ: 0, angleXW: 0, angleYZ: 0, angleYW: 0, angleZW: 0,
      color: '#b89be8'
    }] : []
  };
}

export function primitive(p, type, r, R, soft = 0) {
  const rounding = Math.min(Math.max(0, soft) * .5, r * .45, type === 4 ? R * .8 : Infinity);
  if (type === 3 || type === 5) {
    const ext = type === 5 ? [r, r, r, Math.max(.12, r * .12)] : [r, r, r, r];
    const rad = Math.min(rounding, Math.min(...ext) * .8),
      q = p.map((v, i) => Math.abs(v) - ext[i] + rad),
      out = q.map(v => Math.max(v, 0)),
      l = norm(out);
    const axis = q.indexOf(Math.max(...q));
    return {
      d: l + Math.min(Math.max(...q), 0) - rad,
      g: l > 1e-9 ? out.map((v, i) => v / l * (Math.sign(p[i]) || 1)) : q.map((_, i) => i === axis ? (Math.sign(p[i]) || 1) : 0)
    };
  }
  if (type === 4) {
    const l = Math.max(Math.hypot(p[0], p[2], p[3]), 1e-9),
      a = l - r + rounding,
      b = Math.abs(p[1]) - R + rounding,
      aa = Math.max(a, 0),
      bb = Math.max(b, 0),
      d = Math.hypot(aa, bb),
      ga = d > 1e-9 ? aa / d : (a >= b ? 1 : 0),
      gb = d > 1e-9 ? bb / d : (b > a ? 1 : 0);
    return {
      d: d + Math.min(Math.max(a, b), 0) - rounding,
      g: [ga * p[0] / l, gb * (Math.sign(p[1]) || 1), ga * p[2] / l, ga * p[3] / l]
    };
  }
  if (type === 1) {
    const l = Math.max(Math.hypot(p[0], p[3]), 1e-9);
    return {
      d: l - r,
      g: [p[0] / l, 0, 0, p[3] / l]
    };
  }
  if (type === 2) {
    const l = Math.max(Math.hypot(p[0], p[2]), 1e-9),
      a = l - R,
      b = Math.max(Math.hypot(a, p[1], p[3]), 1e-9);
    return {
      d: b - r,
      g: [a * p[0] / l / b, p[1] / b, a * p[2] / l / b, p[3] / b]
    };
  }
  const l = Math.max(norm(p), 1e-9);
  return {
    d: l - r,
    g: scale(p, 1 / l)
  };
}
export function field(p, c) {
  let a = c.mode === 0 ? {
    d: p[3],
    g: [0, 0, 0, 1]
  } : primitive(p, c.mode - 1, c.mode === 3 ? 1.3 : c.radius, 2.8);
  for (const o of c.objects) {
    const q = inverseRotateVector(o, add(p, scale(o.p, -1)));
    const b = primitive(q, o.type, o.radius, o.major, o.blend);
    b.g = rotateVector(o, b.g);
    if (o.negative) {
      a = {
        d: -a.d,
        g: scale(a.g, -1)
      };
    }
    const k = Math.max(.05, o.blend),
      h = Math.max(0, Math.min(1, .5 + .5 * (b.d - a.d) / k));
    a = {
      d: b.d * (1 - h) + a.d * h - k * h * (1 - h),
      g: add(scale(b.g, 1 - h), scale(a.g, h))
    };
    if (o.negative) a = {
      d: -a.d,
      g: scale(a.g, -1)
    };
  }
  return a;
}
export function project(p, c) {
  let q = [...p];
  for (let i = 0; i < 10; i++) {
    const a = field(q, c);
    if (Math.abs(a.d) < 1e-8) break;
    q = add(q, scale(a.g, -a.d / Math.max(dot(a.g, a.g), 1e-10)));
  }
  return q;
}
export function frame(p, axes, c) {
  const n = unit(field(p, c).g),
    out = [];
  for (const a of axes) {
    let v = tangent(a, n);
    for (const b of out) v = tangent(v, b);
    if (norm(v) < 1e-5) {
      for (let i = 0; i < 4; i++) {
        v = [0, 0, 0, 0];
        v[i] = 1;
        v = tangent(v, n);
        for (const b of out) v = tangent(v, b);
        if (norm(v) > .1) break;
      }
    }
    out.push(unit(v));
  }
  return out;
}
export function spawn(c) {
  const p = project(c.mode === 0 ? [.8, 0, -7.5, 0] : c.mode === 3 ? [4.1, 0, 0, 0] : [c.radius, 0, 0, 0], c);
  return {
    p,
    axes: frame(p, [
      [0, 0, 1, 0], c.mode === 0 ? [1, 0, 0, 0] : [0, 0, 0, 1],
      [0, 1, 0, 0]
    ], c)
  };
}
export function advance(state, direction, distance, c) {
  let p = state.p,
    v = unit(tangent(direction, unit(field(p, c).g))),
    axes = state.axes;
  const count = Math.max(1, Math.ceil(Math.abs(distance) / .035)),
    ds = distance / count;
  for (let i = 0; i < count; i++) {
    const q = project(add(p, scale(v, ds)), c),
      n = unit(field(q, c).g);
    v = unit(tangent(v, n));
    axes = frame(q, axes, c);
    p = q;
  }
  return {
    p,
    axes
  };
}
export function turn(state, yaw, pitch) {
  let [f, r, u] = state.axes;
  const cy = Math.cos(yaw),
    sy = Math.sin(yaw),
    cp = Math.cos(pitch),
    sp = Math.sin(pitch);
  const nf = add(scale(f, cy), scale(r, sy));
  r = add(scale(r, cy), scale(f, -sy));
  f = add(scale(nf, cp), scale(u, sp));
  u = add(scale(u, cp), scale(nf, -sp));
  state.axes = [f, r, u];
}
// Scalar curvature / 6, from the Gauss equation. The three sectional
// curvatures need not have the same sign; this is explicitly their mean.
export function curvature(p, c) {
  const axes = frame(p, [
      [1, 0, 0, 0],
      [0, 1, 0, 0],
      [0, 0, 1, 0]
    ], c),
    eps = .003;
  const H = axes.map(a => scale(add(unit(field(add(p, scale(a, eps)), c).g), scale(unit(field(add(p, scale(a, -eps)), c).g), -1)), .5 / eps));
  let tr = 0,
    sq = 0;
  for (let i = 0; i < 3; i++) {
    tr += dot(H[i], axes[i]);
    for (let j = 0; j < 3; j++) sq += dot(H[i], axes[j]) * dot(H[j], axes[i]);
  }
  return (tr * tr - sq) / 6;
}

// Walking intersects the 3-manifold with an eye-height plane. All four
// coordinates still participate; W remains free to follow the curved passage.
export const floorY = c => c.mode === 3 ? -.7 : -1.45;
export function grounded(p, c, height = .6) {
  let q = [...p];
  const y = floorY(c) + height;
  for (let i = 0; i < 24; i++) {
    q[1] = y;
    const a = field(q, c),
      g = [...a.g];
    g[1] = 0;
    const den = dot(g, g);
    if (Math.abs(a.d) < 1e-7) return q;
    if (den < 1e-10) return null;
    q = add(q, scale(g, -Math.max(-.25, Math.min(.25, a.d)) / den));
  }
  return Math.abs(field(q, c).d) < 1e-5 ? q : null;
}
export function groundFrame(state, c) {
  const n = unit(field(state.p, c).g),
    u = unit(tangent([0, 1, 0, 0], n));
  if (norm(u) < .1) return state.axes;
  let f = tangent(tangent(state.axes[0], n), u);
  if (norm(f) < .01) f = tangent(tangent(state.axes[1], n), u);
  f = unit(f);
  const ordered = frame(state.p, [f, u, state.axes[1]], c);
  let r = ordered[2];
  if (dot(r, state.axes[1]) < 0) r = scale(r, -1);
  return [ordered[0], r, ordered[1]];
}
export function moveWithCollision(state, dir, distance, c, walk = true, height = .6) {
  let current = state;
  const steps = Math.max(1, Math.ceil(Math.abs(distance) / .025)),
    ds = distance / steps;
  for (let i = 0; i < steps; i++) {
    let v = dir;
    if (walk) {
      const n = unit(field(current.p, c).g),
        up = unit(tangent([0, 1, 0, 0], n));
      v = tangent(tangent(v, n), up);
      if (norm(v) < 1e-6) break;
    }
    let next = advance(current, v, ds, c);
    const minY = floorY(c) + height;
    if (walk || next.p[1] < minY) {
      const q = grounded(next.p, c, height);
      if (!q) break;
      next = {
        p: q,
        axes: frame(q, next.axes, c)
      };
    }
    if (!next.p.every(Number.isFinite) || Math.abs(field(next.p, c).d) > 1e-4 || norm(add(next.p, scale(current.p, -1))) > Math.max(.2, Math.abs(ds) * 4)) break;
    current = next;
  }
  return current;
}
