import assert from 'node:assert/strict';
import {
  defaults,
  spawn,
  field,
  baseField,
  normal,
  project,
  add,
  mul,
  curvature
} from '../site/surface.js';
let result;
globalThis.self = {
  postMessage: r => result = r
};
await import('../site/geodesics.js');
for (const mode of ['joined', 'cylinder', 'torus', 'sheets']) {
  const c = defaults();
  c.mode = mode;
  c.shapes = [];
  const a = spawn(c),
    n = a.n;
  for (const operation of ['additive', 'negative']) {
    c.shapes = [{
      type: 'sphere',
      operation,
      color: '#00ff00',
      x: a.p[0],
      y: a.p[1],
      z: a.p[2],
      rotationX: 0,
      rotationY: Math.acos(n[2]),
      rotationZ: Math.atan2(n[1], n[0]),
      size: .8,
      strength: 1,
      blend: .2
    }];
    assert.ok(Math.abs(field(a.p, c)[0] - baseField(a.p, c)[0]) > .1, mode +
      ' object affects field');
    const b = spawn(c);
    self.onmessage({
      data: {
        id: 1,
        config: c,
        position: b.p,
        forward: b.v,
        angles: 24,
        rings: 24,
        range: 2
      }
    });
    for (let i = 0; i < result.points.length; i += 3) {
      const p = Array.from(result.points.slice(i, i + 3));
      assert.ok(Math.abs(field(p, c)[0]) < .002, mode + ' traced surface');
      const m = i / 3 * 5;
      assert.ok(result.metadata.slice(m, m + 5).every(Number.isFinite));
      if (i % 90 === 0) assert.ok(Math.abs(result.metadata[m + 3] - curvature(p, c)) < .02, mode +
        ' curvature metadata');
    }
    console.log('PASS', mode, operation, 'geometry and curvature');
  }
}
const c = defaults();
const a = spawn(c);
const now = performance.now();
self.onmessage({
  data: {
    id: 2,
    config: c,
    position: a.p,
    forward: a.v,
    angles: 128,
    rings: 72,
    range: 25
  }
});
console.log('Interactive mesh + curvature ms:', (performance.now() - now).toFixed(1));
