// Geodesic tracer. Importing the authoritative CPU field prevents the movement,
// tracer and renderer from silently diverging when a primitive is changed.
import { field } from './surface.js';
const g = new Float64Array(4);
function sample(x, y, z, c) {
  const f = field([x, y, z], c);
  g[0] = f[0]; g[1] = f[1]; g[2] = f[2]; g[3] = f[3];
}
self.onmessage = ({ data: m }) => {
  const { config: c, position: p, forward: f, range, angles, rings, id } = m;
  sample(...p, c);
  let len = Math.hypot(g[1], g[2], g[3]), nx = g[1] / len, ny = g[2] / len, nz = g[3] / len;
  const right = [f[1] * nz - f[2] * ny, f[2] * nx - f[0] * nz, f[0] * ny - f[1] * nx],
    out = new Float32Array((angles + 1) * (rings + 1) * 3), count = Math.max(1, Math.ceil(range / rings / .14)), h = range / rings / count;
  for (let a = 0; a <= angles; a++) {
    const angle = a / angles * Math.PI * 2, co = Math.cos(angle), si = Math.sin(angle);
    let x = p[0], y = p[1], z = p[2], vx = right[0] * co + f[0] * si, vy = right[1] * co + f[1] * si, vz = right[2] * co + f[2] * si,
      n0 = nx, n1 = ny, n2 = nz, idx = a * (rings + 1) * 3;
    out[idx++] = x; out[idx++] = y; out[idx++] = z;
    for (let r = 1; r <= rings; r++) {
      for (let sub = 0; sub < count; sub++) {
        x += vx * h; y += vy * h; z += vz * h;
        for (let j = 0; j < 2; j++) {
          sample(x, y, z, c);
          const gg = g[1] * g[1] + g[2] * g[2] + g[3] * g[3], t = g[0] / Math.max(gg, 1e-12);
          x -= t * g[1]; y -= t * g[2]; z -= t * g[3];
        }
        sample(x, y, z, c); len = Math.hypot(g[1], g[2], g[3]);
        const nn0 = g[1] / len, nn1 = g[2] / len, nn2 = g[3] / len,
          k = (vx * nn0 + vy * nn1 + vz * nn2) / Math.max(.01, 1 + n0 * nn0 + n1 * nn1 + n2 * nn2);
        vx -= (n0 + nn0) * k; vy -= (n1 + nn1) * k; vz -= (n2 + nn2) * k;
        len = Math.hypot(vx, vy, vz); vx /= len; vy /= len; vz /= len;
        n0 = nn0; n1 = nn1; n2 = nn2;
      }
      out[idx++] = x; out[idx++] = y; out[idx++] = z;
    }
  }
  self.postMessage({ id, points: out }, [out.buffer]);
};
