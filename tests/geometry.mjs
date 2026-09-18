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
  dot,
  SHAPE_TYPES,
  operationOf,
  colorOf,
  hasCustomMaterial,
  BASE_COLOR,
  DEFAULT_COLOR
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
  if (mode !== 'joined') c.shapes = [];
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

// Editable primitives share one field contract in the CPU and tracer. New scenes
// deliberately exercise all axes and both material operations, not just defaults.
assert.ok(!SHAPE_TYPES.includes('spike'));
assert.deepEqual(SHAPE_TYPES, ['handle', 'bump', 'bowl', 'ring', 'plane', 'cube', 'sphere',
  'cylinder'
]);
for (const type of SHAPE_TYPES) {
  for (const operation of ['additive', 'negative']) {
    const c = defaults();
    c.shapes = [{
      type,
      operation,
      color: '#22aa77',
      x: 1.5,
      y: -1,
      z: .4,
      rotationX: .31,
      rotationY: -.42,
      rotationZ: .63,
      size: 2.1,
      strength: 1.35,
      blend: .75
    }];
    assert.equal(operationOf(c.shapes[0]), operation);
    const a = spawn(c, true);
    assert.ok(a.p.every(Number.isFinite), `${type}/${operation} spawn is finite`);
    assert.ok(Math.abs(field(a.p, c)[0]) < 1e-6, `${type}/${operation} spawn is constrained`);
    self.onmessage({
      data: {
        config: c,
        position: a.p,
        forward: a.v,
        range: 3,
        angles: 12,
        rings: 12,
        id: 9
      }
    });
    for (let i = 0; i < result.points.length; i += 3) {
      const p = Array.from(result.points.slice(i, i + 3));
      assert.ok(p.every(Number.isFinite), `${type}/${operation} worker point is finite`);
      assert.ok(Math.abs(field(p, c)[0]) < .015, `${type}/${operation} worker uses CPU field`);
    }
  }
}
const legacy = defaults();
legacy.shapes = [{
  type: 'cube',
  x: 0,
  y: 0,
  z: 0,
  rotation: .7,
  size: 2,
  strength: 1,
  blend: 1
}];
const modern = structuredClone(legacy);
modern.shapes[0].rotationZ = .7;
delete modern.shapes[0].rotation;
const probe = [1.2, -.8, .6];
assert.deepEqual(field(probe, legacy), field(probe, modern),
'legacy Z rotation remains compatible');
const unrotated = structuredClone(modern);
unrotated.shapes[0].rotationX = 0;
unrotated.shapes[0].rotationY = 0;
unrotated.shapes[0].rotationZ = 0;
assert.notEqual(field(probe, unrotated)[0], field(probe, modern)[0],
  'three-axis rotation changes non-symmetric geometry');
console.log(
  'PASS primitive operations, all-axis rotations, legacy rotation compatibility, and worker/CPU consistency'
  );

// Default is an explicit base material and a negative operation must never expose
// its retained custom editor swatch. The shader receives this same boolean as alpha.
const defaultMaterial = {
  type: 'cube',
  operation: 'additive',
  color: DEFAULT_COLOR
};
const customMaterial = {
  type: 'cube',
  operation: 'additive',
  color: '#e05090'
};
const negativeMaterial = {
  type: 'cube',
  operation: 'negative',
  color: '#e05090'
};
assert.equal(colorOf(defaultMaterial), BASE_COLOR);
assert.equal(colorOf(customMaterial), '#e05090');
assert.equal(colorOf(negativeMaterial), BASE_COLOR);
assert.equal(hasCustomMaterial(defaultMaterial), false);
assert.equal(hasCustomMaterial(customMaterial), true);
assert.equal(hasCustomMaterial(negativeMaterial), false);
console.log('PASS explicit Default material and negative-shape color suppression');
