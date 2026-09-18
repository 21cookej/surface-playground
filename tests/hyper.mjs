import assert from 'node:assert/strict';
import {
  defaults,
  spawn,
  field,
  curvature,
  advance,
  turn,
  dot,
  norm
} from '../site/hyper/math.js';
for (let mode = 0; mode < 4; mode++) {
  const c = defaults(mode);
  let s = spawn(c);
  for (let i = 0; i < 150; i++) {
    turn(s, .018, .006);
    s = advance(s, s.axes[0], .07, c);
    assert.ok(Math.abs(field(s.p, c).d) < 1e-6);
    for (let a = 0; a < 3; a++) {
      assert.ok(Math.abs(norm(s.axes[a]) - 1) < 1e-9);
      assert.ok(Math.abs(dot(s.axes[a], field(s.p, c).g)) < 1e-7);
      for (let b = 0; b < a; b++) assert.ok(Math.abs(dot(s.axes[a], s.axes[b])) < 1e-8);
    }
  }
  console.log('PASS constrained 4D movement and orthonormal camera in mode', mode);
}
const c = defaults(1);
assert.ok(Math.abs(curvature([3, 0, 0, 0], c) - 1 / 9) < 1e-5);
assert.ok(Math.abs(curvature([3, 0, 0, 0], defaults(2))) < 1e-7);
assert.ok(curvature([4.1, 0, 0, 0], defaults(3)) > 0);
assert.ok(curvature([1.5, 0, 0, 0], defaults(3)) < 0);
let s = spawn(defaults(2));
s.axes = [
  [0, 0, 0, 1],
  [0, 0, 1, 0],
  [0, 1, 0, 0]
];
const start = [...s.p];
s = advance(s, s.axes[0], Math.PI * 6, defaults(2));
assert.ok(norm(s.p.map((x, i) => x - start[i])) < .01, 'cylinder completes a closed 4D loop');
const base = defaults(0);
let w = 0;
s = spawn(base);
for (let i = 0; i < 350; i++) {
  s = advance(s, s.axes[0], .06, base);
  w = Math.max(w, s.p[3]);
}
assert.ok(w > 1, 'player actually enters W');
assert.ok(Math.abs(s.p[3]) < 1e-5, 'player exits back into ordinary W=0 space');
console.log('PASS hypersphere curvature, flat cylinder, torus curvature signs, closed loop, and continuous W entry/exit');

// New walking and primitive behavior: validate the constraints, not UI labels.
const {
  grounded,
  groundFrame,
  moveWithCollision,
  floorY,
  primitive
} = await import('../site/hyper/math.js');
for (let mode = 0; mode < 4; mode++) {
  const c = defaults(mode);
  let s = spawn(c);
  s.p = grounded(s.p, c, .6);
  assert.ok(s.p);
  s.axes = groundFrame(s, c);
  for (let i = 0; i < 250; i++) {
    s = moveWithCollision(s, s.axes[i % 3 === 0 ? 1 : 0], .05, c, true, .6);
    s.axes = groundFrame(s, c);
    assert.ok(Math.abs(s.p[1] - floorY(c) - .6) < 1e-7);
    assert.ok(Math.abs(field(s.p, c).d) < 1e-5);
  }
  const start = [...s.p];
  s = moveWithCollision(s, [0, -1, 0, 0], 1, c, false, .6);
  assert.ok(s.p[1] >= floorY(c) + .6 - 1e-7);
}
for (const type of [0, 1, 2, 3, 4, 5])
  for (const negative of [false, true]) {
    const c = defaults(0);
    c.objects = [{
      type,
      negative,
      p: [0, 0, 0, -.7],
      radius: 2,
      major: 2.5,
      blend: .5,
      angle: .35
    }];
    const p = [1.6, .4, .8, .3],
      a = field(p, c),
      eps = 1e-5;
    for (let j = 0; j < 4; j++) {
      const lo = [...p],
        hi = [...p];
      lo[j] -= eps;
      hi[j] += eps;
      assert.ok(Math.abs((field(hi, c).d - field(lo, c).d) / (2 * eps) - a.g[j]) < 1e-4);
    }
  }
for (const type of [3, 4]) {
  const p = type === 3 ? [2, 2, 0, 0] : [2, 2, 0, 0];
  assert.ok(primitive(p, type, 2, 2, 1).d > primitive(p, type, 2, 2, .1).d, 'softness rounds isolated edges inward');
}
console.log('PASS grounded walking/collision in every scene, all signed primitive gradients, isolated edge softness');
