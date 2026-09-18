// Allocation-free intrinsic geodesic tracer. This deliberately mirrors the scalar
// field contract in surface.js rather than importing its array-oriented helpers:
// a normal trace evaluates the field hundreds of thousands of times.
const MAX_SHAPES = 10;
const EPS = 1e-9;
const g = new Float64Array(5);
const shape = new Float64Array(MAX_SHAPES * 17);
let count = 0,
  mode = 0,
  radius = 0,
  strength = 0,
  smoothing = 0;
const clamp = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;

// Per-shape layout: x,y,z,size,strength,blend,operation,type,cx,sx,cy,sy,cz,sz,scale,offset,reserved.
function prepare(c) {
  mode = c.mode === 'cylinder' ? 1 : c.mode === 'torus' ? 2 : c.mode === 'sheets' ? 3 : 0;
  radius = c.radius;
  strength = c.strength;
  smoothing = c.blend;
  count = Math.min(c.shapes.length, MAX_SHAPES);
  for (let i = 0; i < count; i++) {
    const o = c.shapes[i],
      k = i * 17,
      rx = o.rotationX || 0,
      ry = o.rotationY || 0,
      rz = o.rotationZ ?? o.rotation ?? 0,
      type = o.type === 'handle' ? 0 : o.type === 'bump' ? 1 :
      o.type === 'bowl' ? 2 : o.type === 'ring' ? 3 : o.type === 'plane' ? 4 :
      o.type === 'cube' ? 5 : o.type === 'sphere' ? 6 : 7,
      s = Math.max(.05, o.strength),
      scale = Math.min(1, s);
    shape[k] = o.x;
    shape[k + 1] = o.y;
    shape[k + 2] = o.z || 0;
    shape[k + 3] = o.size;
    shape[k + 4] = s;
    shape[k + 5] = o.blend;
    shape[k + 6] = (o.operation || (o.type === 'bowl' ? 'negative' : 'additive')) === 'negative' ?
      1 : 0;
    shape[k + 7] = type;
    shape[k + 8] = Math.cos(rx);
    shape[k + 9] = Math.sin(rx);
    shape[k + 10] = Math.cos(ry);
    shape[k + 11] = Math.sin(ry);
    shape[k + 12] = Math.cos(rz);
    shape[k + 13] = Math.sin(rz);
    shape[k + 14] = scale;
    shape[k + 15] = (type === 2 ? -1 : 1) * o.size * .28;
  }
}

function putShape(k, x, y, z) {
  const dx = x - shape[k],
    dy = y - shape[k + 1],
    dz = z - shape[k + 2],
    size = shape[k + 3],
    stretch = shape[k + 4],
    type = shape[k + 7],
    cx = shape[k + 8],
    sx = shape[k + 9],
    cy = shape[k + 10],
    sy = shape[k + 11],
    cz = shape[k + 12],
    sz = shape[k + 13];
  const x1 = dx * cz + dy * sz,
    y1 = -dx * sz + dy * cz,
    lx = x1 * cy - dz * sy,
    lz = x1 * sy + dz * cy,
    ly = y1 * cx + lz * sx,
    lzz = -y1 * sx + lz * cx,
    zz = lzz / stretch;
  const round = Math.min(Math.max(0, shape[k + 5]) * .5, size * .45);
  let d, gx, gy, gz;
  if (type === 0 || type === 3) {
    const vertical = type === 0,
      radial = Math.max(vertical ? Math.hypot(lx, zz) : Math.hypot(lx, ly), EPS),
      a = radial - size,
      b = vertical ? ly : zz,
      l = Math.max(Math.hypot(a, b), EPS),
      q = a / l / radial;
    d = l - Math.max(.6, size * .29);
    if (vertical) {
      gx = lx * q;
      gy = b / l;
      gz = zz * q;
    } else {
      gx = lx * q;
      gy = ly * q;
      gz = b / l;
    }
  } else if (type === 4 || type === 5) {
    const bx = type === 4 ? size : size * .55 - round,
      by = bx,
      bz = type === 4 ? .13 : size * .55 - round,
      ax = Math.abs(lx) - bx,
      ay = Math.abs(ly) - by,
      az = Math.abs(zz) - bz,
      ox = Math.max(ax, 0),
      oy = Math.max(ay, 0),
      oz = Math.max(az, 0),
      l = Math.hypot(ox, oy, oz);
    d = l + Math.min(Math.max(ax, Math.max(ay, az)), 0) - (type === 4 ? .06 : round);
    if (l > EPS) {
      gx = ox / l * Math.sign(lx);
      gy = oy / l * Math.sign(ly);
      gz = oz / l * Math.sign(zz);
    } else if (ax >= ay && ax >= az) {
      gx = Math.sign(lx) || 1;
      gy = gz = 0;
    } else if (ay >= az) {
      gx = 0;
      gy = Math.sign(ly) || 1;
      gz = 0;
    } else {
      gx = gy = 0;
      gz = Math.sign(zz) || 1;
    }
  } else if (type === 7) {
    const radial = Math.max(Math.hypot(lx, ly), EPS),
      a = radial - size + round,
      b = Math.abs(zz) - size * .62 + round,
      oa = Math.max(a, 0),
      ob = Math.max(b, 0),
      l = Math.hypot(oa, ob);
    d = l + Math.min(Math.max(a, b), 0) - round;
    if (l > EPS) {
      gx = oa / l * lx / radial;
      gy = oa / l * ly / radial;
      gz = ob / l * (Math.sign(zz) || 1);
    } else if (a >= b) {
      gx = lx / radial;
      gy = ly / radial;
      gz = 0;
    } else {
      gx = gy = 0;
      gz = Math.sign(zz) || 1;
    }
  } else {
    const qz = (lzz + shape[k + 15]) / stretch,
      l = Math.max(Math.hypot(lx, ly, qz), EPS);
    d = l - size;
    gx = lx / l;
    gy = ly / l;
    gz = qz / l;
  }
  // Rz * Ry * Rx rotates the local (including depth-corrected) gradient to world.
  gz /= stretch;
  const vy = cx * gy - sx * gz,
    vz = sx * gy + cx * gz,
    vx2 = cy * gx + sy * vz,
    vz2 = -sy * gx + cy * vz,
    scale = shape[k + 14];
  g[0] = d * scale;
  g[1] = (cz * vx2 - sz * vy) * scale;
  g[2] = (sz * vx2 + cz * vy) * scale;
  g[3] = vz2 * scale;
}

function baseSample(x, y, z) {
  if (mode === 1) {
    const l = Math.max(Math.hypot(x, z), EPS);
    g[0] = l - radius;
    g[1] = x / l;
    g[2] = 0;
    g[3] = z / l;
    return;
  }
  if (mode === 2) {
    const radial = Math.max(Math.hypot(x, y), EPS),
      a = radial - radius - 2,
      l = Math.max(Math.hypot(a, z), EPS),
      q = a / l / radial;
    g[0] = l - Math.max(.6, strength * .65);
    g[1] = x * q;
    g[2] = y * q;
    g[3] = z / l;
    return;
  }
  if (mode === 3) {
    const rr = Math.max(Math.hypot(x, y), EPS),
      a = Math.abs(z) - strength,
      b = radius - rr,
      k = smoothing,
      h = clamp(.5 + .5 * (a - b) / k, 0, 1),
      q = 1 - h;
    g[0] = b * q + a * h + k * h * q;
    g[1] = (-x / rr) * q;
    g[2] = (-y / rr) * q;
    g[3] = (Math.sign(z) || 1) * h;
    return;
  }
  g[0] = z;
  g[1] = 0;
  g[2] = 0;
  g[3] = 1;
  return;
}

function sample(x, y, z) {
  baseSample(x, y, z);
  let owner = -1;
  for (let i = 0; i < count; i++) {
    const k = i * 17,
      d = g[0],
      gx = g[1],
      gy = g[2],
      gz = g[3];
    putShape(k, x, y, z);
    const bd = g[0],
      bx = g[1],
      by = g[2],
      bz = g[3],
      soft = shape[k + 5];
    let h;
    // Negative shapes use smax(f, -shape): negate both the shape distance and gradient.
    if (shape[k + 6]) {
      if (-bd > d) owner = -1;
      h = clamp(.5 + .5 * (d + bd) / soft, 0, 1);
      const q = 1 - h;
      g[0] = -bd * q + d * h + soft * h * q;
      g[1] = -bx * q + gx * h;
      g[2] = -by * q + gy * h;
      g[3] = -bz * q + gz * h;
    } else {
      if (bd < d) owner = i;
      h = clamp(.5 + .5 * (bd - d) / soft, 0, 1);
      const q = 1 - h;
      g[0] = bd * q + d * h - soft * h * q;
      g[1] = bx * q + gx * h;
      g[2] = by * q + gy * h;
      g[3] = bz * q + gz * h;
    }
  }
  g[4] = owner;
}

function metadata(x, y, z, out, at) {
  sample(x, y, z);
  let l = Math.hypot(g[1], g[2], g[3]) || 1,
    nx = g[1] / l,
    ny = g[2] / l,
    nz = g[3] / l,
    owner = g[4];
  let ax, ay, az;
  if (Math.abs(nz) < .9) {
    ax = ny;
    ay = -nx;
    az = 0;
  } else {
    ax = -nz;
    ay = 0;
    az = nx;
  }
  l = Math.hypot(ax, ay, az) || 1;
  ax /= l;
  ay /= l;
  az /= l;
  const bx = ny * az - nz * ay,
    by = nz * ax - nx * az,
    bz = nx * ay - ny * ax,
    e = .025;
  sample(x + ax * e, y + ay * e, z + az * e);
  l = Math.hypot(g[1], g[2], g[3]) || 1;
  let dax = g[1] / l,
    day = g[2] / l,
    daz = g[3] / l;
  sample(x - ax * e, y - ay * e, z - az * e);
  l = Math.hypot(g[1], g[2], g[3]) || 1;
  dax = (dax - g[1] / l) / (2 * e);
  day = (day - g[2] / l) / (2 * e);
  daz = (daz - g[3] / l) / (2 * e);
  sample(x + bx * e, y + by * e, z + bz * e);
  l = Math.hypot(g[1], g[2], g[3]) || 1;
  let dbx = g[1] / l,
    dby = g[2] / l,
    dbz = g[3] / l;
  sample(x - bx * e, y - by * e, z - bz * e);
  l = Math.hypot(g[1], g[2], g[3]) || 1;
  dbx = (dbx - g[1] / l) / (2 * e);
  dby = (dby - g[2] / l) / (2 * e);
  dbz = (dbz - g[3] / l) / (2 * e);
  const K = (ax * dax + ay * day + az * daz) * (bx * dbx + by * dby + bz * dbz) - (ax * dbx + ay *
    dby + az * dbz) * (bx * dax + by * day + bz * daz);
  out[at] = nx;
  out[at + 1] = ny;
  out[at + 2] = nz;
  out[at + 3] = K;
  out[at + 4] = owner;
}
self.onmessage = ({
  data: m
}) => {
  const {
    config: c,
    position: p,
    forward: f,
    range,
    angles,
    rings,
    id
  } = m;
  const started = performance.now();
  prepare(c);
  sample(p[0], p[1], p[2]);
  let len = Math.hypot(g[1], g[2], g[3]),
    nx = g[1] / len,
    ny = g[2] / len,
    nz = g[3] / len;
  const rightX = f[1] * nz - f[2] * ny,
    rightY = f[2] * nx - f[0] * nz,
    rightZ = f[0] * ny - f[1] * nx,
    out = new Float32Array((angles + 1) * (rings + 1) * 3),
    meta = new Float32Array((angles + 1) * (rings + 1) * 5),
    count = Math.min(12, Math.max(1, Math.ceil(range / rings / (c.rayStep || .14)))),
    h = range / rings / count;
  for (let a = 0; a <= angles; a++) {
    const angle = a / angles * Math.PI * 2,
      co = Math.cos(angle),
      si = Math.sin(angle);
    let x = p[0],
      y = p[1],
      z = p[2],
      vx = rightX * co + f[0] * si,
      vy = rightY * co + f[1] * si,
      vz = rightZ * co + f[2] * si,
      n0 = nx,
      n1 = ny,
      n2 = nz,
      idx = a * (rings + 1) * 3;
    metadata(x, y, z, meta, idx / 3 * 5);
    out[idx++] = x;
    out[idx++] = y;
    out[idx++] = z;
    for (let r = 1; r <= rings; r++) {
      for (let sub = 0; sub < count; sub++) {
        x += vx * h;
        y += vy * h;
        z += vz * h;
        for (let j = 0; j < 2; j++) {
          sample(x, y, z);
          const gg = g[1] * g[1] + g[2] * g[2] + g[3] * g[3],
            t = g[0] / Math.max(gg, 1e-12);
          x -= t * g[1];
          y -= t * g[2];
          z -= t * g[3];
        }
        sample(x, y, z);
        len = Math.hypot(g[1], g[2], g[3]);
        const nn0 = g[1] / len,
          nn1 = g[2] / len,
          nn2 = g[3] / len,
          k = (vx * nn0 + vy * nn1 + vz * nn2) / Math.max(.01, 1 + n0 * nn0 + n1 * nn1 + n2 *
            nn2);
        vx -= (n0 + nn0) * k;
        vy -= (n1 + nn1) * k;
        vz -= (n2 + nn2) * k;
        len = Math.hypot(vx, vy, vz);
        vx /= len;
        vy /= len;
        vz /= len;
        n0 = nn0;
        n1 = nn1;
        n2 = nn2;
      }
      metadata(x, y, z, meta, idx / 3 * 5);
      out[idx++] = x;
      out[idx++] = y;
      out[idx++] = z;
    }
  }
  self.postMessage({
    id,
    points: out,
    metadata: meta,
    traceMs: performance.now() - started
  }, [out.buffer, meta.buffer]);
};
