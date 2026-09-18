import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  defaults,
  spawn,
  field,
  step,
  normal,
  curvature,
  project,
  dot
} from '../site/surface.js';
fs.mkdirSync('tests/output', {
  recursive: true
});
let result;
globalThis.self = {
  postMessage: r => result = r
};
await import('../site/geodesics.js');
for (const mode of ['joined', 'cylinder', 'torus', 'sheets']) {
  let c = defaults();
  c.mode = mode;
  let a = spawn(c);
  const rings = 160,
    angles = 320,
    range = 25;
  console.time(mode);
  self.onmessage({
    data: {
      config: c,
      position: a.p,
      forward: a.v,
      range,
      angles,
      rings,
      id: 1
    }
  });
  console.timeEnd(mode);
  let max = 0,
    bad = 0;
  for (let i = 0; i < result.points.length; i += 3) {
    const p = Array.from(result.points.slice(i, i + 3));
    assert.ok(p.every(Number.isFinite));
    const e = Math.abs(field(p, c)[0]);
    max = Math.max(max, e);
    if (e > .01) bad++;
  }
  console.log(mode, 'max surface residual', max, 'bad points', bad);
  assert.ok(max < .015);
  if (mode === 'cylinder') {
    const idx = ((angles / 4) * (rings + 1) + Math.round((2 * Math.PI * c.radius) / range *
      rings)) * 3;
    const p = Array.from(result.points.slice(idx, idx + 3));
    console.log('closed cylinder ray return distance', Math.hypot(...p.map((v, i) => v - a.p[i])));
    assert.ok(Math.hypot(...p.map((v, i) => v - a.p[i])) < .12);
    assert.ok(Math.abs(curvature(a.p, c)) < 1e-8);
  }
  if (mode === 'torus') {
    const R = c.radius + 2,
      r = c.strength * .65;
    const outside = curvature([R + r, 0, 0], c),
      inside = curvature([R - r, 0, 0], c);
    console.log('torus curvature', outside, inside);
    assert.ok(outside > 0 && inside < 0);
  }
  if (mode === 'sheets') {
    let minZ = a.p[2];
    for (let i = 0; i < 1300; i++) {
      a = (() => {
        const x = step(a.p, a.v, .025, c);
        return {
          p: x.p,
          v: x.v,
          n: x.n
        }
      })();
      minZ = Math.min(minZ, a.p[2]);
      assert.ok(Math.abs(field(a.p, c)[0]) < 1e-7);
    }
    console.log('sheet transition min z', minZ);
    assert.ok(minZ < -c.strength + .1);
  }
  if (mode === 'joined') {
    fs.writeFileSync('tests/output/points.bin', Buffer.from(result.points.buffer));
    fs.writeFileSync('tests/output/snapshot.json', JSON.stringify({
      config: c,
      avatar: a,
      range,
      angles,
      rings
    }));
  }
}
let c = defaults(),
  a = spawn(c, true);
for (let i = 0; i < 1600; i++) {
  const t = step(a.p, a.v, .025, c);
  a = {
    p: t.p,
    v: t.v,
    n: t.n
  };
  assert.ok(Math.abs(field(a.p, c)[0]) < 1e-7);
  assert.ok(Math.abs(dot(a.v, a.n)) < 1e-6);
}
console.log('PASS torus handle joins stay constrained');
