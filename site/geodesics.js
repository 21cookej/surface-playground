// Allocation-free implicit geodesic tracer. Same fields and normal transport as surface.js.
const g = new Float64Array(4);

function sample(x, y, z, c) {
  let d = z,
    gx = 0,
    gy = 0,
    gz = 1;
  if (c.mode === 'cylinder') {
    let l = Math.hypot(x, z);
    g[0] = l - c.radius;
    g[1] = x / l;
    g[2] = 0;
    g[3] = z / l;
    return;
  }
  if (c.mode === 'torus') {
    let r = Math.max(1e-9, Math.hypot(x, y)),
      a = r - c.radius - 2,
      l = Math.max(1e-9, Math.hypot(a, z));
    g[0] = l - Math.max(.6, c.strength * .65);
    g[1] = a * x / l / r;
    g[2] = a * y / l / r;
    g[3] = z / l;
    return;
  }
  if (c.mode === 'sheets') {
    let rr = Math.max(1e-9, Math.hypot(x, y)),
      a = Math.abs(z) - c.strength,
      b = c.radius - rr,
      k = c.blend,
      h = Math.max(0, Math.min(1, .5 + .5 * (a - b) / k));
    g[0] = b * (1 - h) + a * h + k * h * (1 - h);
    g[1] = -x / rr * (1 - h);
    g[2] = -y / rr * (1 - h);
    g[3] = (Math.sign(z) || 1) * h;
    return;
  }
  for (let i = 0; i < c.shapes.length; i++) {
    let o = c.shapes[i],
      xx = x - o.x,
      yy = y - o.y,
      zz0 = z - (o.z || 0),
      ang = o.rotation || 0,
      co = Math.cos(ang),
      si = Math.sin(ang),
      rx = xx * co + yy * si,
      ry = -xx * si + yy * co,
      stretch = o.strength,
      scale = Math.min(1, stretch),
      bd, lx, ly, bz;
    if (o.type === 'handle' || o.type === 'ring') {
      let zz = zz0 / stretch,
        vertical = o.type === 'handle',
        rad = Math.max(1e-9, vertical ? Math.hypot(rx, zz) : Math.hypot(rx, ry)),
        a = rad - o.size,
        b = vertical ? ry : zz,
        l = Math.max(1e-9, Math.hypot(a, b)),
        gg = a / l / rad;
      bd = (l - Math.max(.6, o.size * .29)) * scale;
      if (vertical) {
        lx = rx * gg * scale;
        ly = b / l * scale;
        bz = zz * gg * scale / stretch;
      } else {
        lx = rx * gg * scale;
        ly = ry * gg * scale;
        bz = b / l * scale / stretch;
      }
    } else if (o.type === 'spike') {
      let zz = (zz0 + o.size * .28) / stretch,
        l = Math.max(1e-9, Math.abs(rx) + Math.abs(ry) + Math.abs(zz));
      bd = (l - o.size) * scale;
      lx = Math.sign(rx) * scale;
      ly = Math.sign(ry) * scale;
      bz = Math.sign(zz) * scale / stretch;
    } else {
      let zz = (zz0 + (o.type === 'bowl' ? -o.size * .28 : o.size * .28)) / stretch,
        l = Math.max(1e-9, Math.hypot(rx, ry, zz));
      bd = (l - o.size) * scale;
      lx = rx / l * scale;
      ly = ry / l * scale;
      bz = zz / l * scale / stretch;
    }
    let bx = lx * co - ly * si,
      by = lx * si + ly * co,
      k = o.blend;
    if (o.type === 'bowl') {
      bd = -bd;
      bx = -bx;
      by = -by;
      bz = -bz;
      let h = Math.max(0, Math.min(1, .5 + .5 * (d - bd) / k)),
        q = 1 - h;
      d = bd * q + d * h + k * h * q;
      gx = bx * q + gx * h;
      gy = by * q + gy * h;
      gz = bz * q + gz * h;
    } else {
      let h = Math.max(0, Math.min(1, .5 + .5 * (bd - d) / k)),
        q = 1 - h;
      d = bd * q + d * h - k * h * q;
      gx = bx * q + gx * h;
      gy = by * q + gy * h;
      gz = bz * q + gz * h;
    }
  }
  g[0] = d;
  g[1] = gx;
  g[2] = gy;
  g[3] = gz;
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
  sample(...p, c);
  let len = Math.hypot(g[1], g[2], g[3]),
    nx = g[1] / len,
    ny = g[2] / len,
    nz = g[3] / len;
  const right = [f[1] * nz - f[2] * ny, f[2] * nx - f[0] * nz, f[0] * ny - f[1] * nx],
    out = new Float32Array((angles + 1) * (rings + 1) * 3),
    count = Math.max(1, Math.ceil(range / rings / .14)),
    h = range / rings / count;
  for (let a = 0; a <= angles; a++) {
    const angle = a / angles * Math.PI * 2,
      co = Math.cos(angle),
      si = Math.sin(angle);
    let x = p[0],
      y = p[1],
      z = p[2],
      vx = right[0] * co + f[0] * si,
      vy = right[1] * co + f[1] * si,
      vz = right[2] * co + f[2] * si,
      n0 = nx,
      n1 = ny,
      n2 = nz;
    let idx = a * (rings + 1) * 3;
    out[idx++] = x;
    out[idx++] = y;
    out[idx++] = z;
    for (let r = 1; r <= rings; r++) {
      for (let sub = 0; sub < count; sub++) {
        x += vx * h;
        y += vy * h;
        z += vz * h;
        for (let j = 0; j < 2; j++) {
          sample(x, y, z, c);
          const gg = g[1] * g[1] + g[2] * g[2] + g[3] * g[3];
          const t = g[0] / Math.max(gg, 1e-12);
          x -= t * g[1];
          y -= t * g[2];
          z -= t * g[3];
        }
        sample(x, y, z, c);
        len = Math.hypot(g[1], g[2], g[3]);
        let nn0 = g[1] / len,
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
      out[idx++] = x;
      out[idx++] = y;
      out[idx++] = z;
    }
  }
  self.postMessage({
    id,
    points: out
  }, [out.buffer]);
};
