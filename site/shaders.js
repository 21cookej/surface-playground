export const common = `
precision highp float;
uniform int mode;
uniform float radius;
uniform float strength;
uniform float smoothing;
uniform int shapeCount;
uniform vec4 shapes[10]; // x, y, type, size
uniform vec4 specs[10];  // strength, blend, z, operation (0 add / 1 negative)
// Precomputed cos/sin pairs remove six trig calls from every field sample.
uniform vec4 rotationA[10]; // cosX, sinX, cosY, sinY
uniform vec4 rotationB[10]; // cosZ, sinZ
// RGB plus a custom-material flag. Alpha 0 is the explicit Default (base) color.
uniform vec4 colors[10];
uniform vec3 player;
uniform vec3 forward;
uniform vec3 up;
vec4 smin(vec4 a, vec4 b, float k) {
  float h = clamp(.5 + .5 * (b.x - a.x) / k, 0., 1.); vec4 d = mix(b, a, h); d.x -= k * h * (1. - h); return d;
}
vec4 smax(vec4 a, vec4 b, float k) { return -smin(-a, -b, k); }
vec4 ball(vec3 p, float r) { float l = max(length(p), .000001); return vec4(l - r, p / l); }
vec4 tor(vec3 p, float R, float r, bool vertical) {
  float radial = max(vertical ? length(p.xz) : length(p.xy), .000001), a = radial - R, b = vertical ? p.y : p.z, l = max(length(vec2(a, b)), .000001), g = a / l / radial;
  return vertical ? vec4(l - r, p.x * g, b / l, p.z * g) : vec4(l - r, p.x * g, p.y * g, b / l);
}
vec4 roundedBox(vec3 p, vec3 b, float round) {
  vec3 q = abs(p) - b, outside = max(q, vec3(0.)); float l = length(outside); vec3 g = vec3(0.);
  if (l > .000001) g = outside / l * sign(p);
  else if (q.x >= q.y && q.x >= q.z) g.x = sign(p.x) == 0. ? 1. : sign(p.x);
  else if (q.y >= q.z) g.y = sign(p.y) == 0. ? 1. : sign(p.y);
  else g.z = sign(p.z) == 0. ? 1. : sign(p.z);
  return vec4(l + min(max(q.x, max(q.y, q.z)), 0.) - round, g);
}
vec4 cappedCylinder(vec3 p, float r, float h) {
  float radial = max(length(p.xy), .000001), a = radial - r, b = abs(p.z) - h, oa = max(a, 0.), ob = max(b, 0.), l = length(vec2(oa, ob)); vec3 g = vec3(0.);
  if (l > .000001) { g.xy = oa / l * p.xy / radial; g.z = ob / l * (sign(p.z) == 0. ? 1. : sign(p.z)); }
  else if (a >= b) g.xy = p.xy / radial;
  else g.z = sign(p.z) == 0. ? 1. : sign(p.z);
  return vec4(l + min(max(a, b), 0.), g);
}
// Shapes use an inverse Rz*Ry*Rx local transform, then rotate the gradient back.
vec3 localPoint(vec3 p, vec4 o, vec4 sp, vec4 ra, vec4 rb) {
  float cx = ra.x, sx = ra.y, cy = ra.z, sy = ra.w, cz = rb.x, sz = rb.y;
  vec3 d = p - vec3(o.xy, sp.z); float x1 = d.x * cz + d.y * sz, y1 = -d.x * sz + d.y * cz, x2 = x1 * cy - d.z * sy, z2 = x1 * sy + d.z * cy;
  return vec3(x2, y1 * cx + z2 * sx, -y1 * sx + z2 * cx);
}
vec3 worldVector(vec3 v, vec4 ra, vec4 rb) {
  float cx = ra.x, sx = ra.y, cy = ra.z, sy = ra.w, cz = rb.x, sz = rb.y;
  float x1 = v.x, y1 = cx * v.y - sx * v.z, z1 = sx * v.y + cx * v.z, x2 = cy * x1 + sy * z1, z2 = -sy * x1 + cy * z1;
  return vec3(cz * x2 - sz * y1, sz * x2 + cz * y1, z2);
}
// 0 handle, 1 bump, 2 bowl, 3 ring, 4 plane, 5 cube, 6 sphere, 7 cylinder.
vec4 shapeField(vec4 o, vec4 sp, vec4 ra, vec4 rb, vec3 p) {
  float type = o.z, stretch = max(.05, sp.x), scale = min(1., stretch); vec3 q = localPoint(p, o, sp, ra, rb); float zz = q.z / stretch; vec4 t;
  if (type < .5) t = tor(vec3(q.xy, zz), o.w, max(.6, o.w * .29), true);
  else if (type > 2.5 && type < 3.5) t = tor(vec3(q.xy, zz), o.w, max(.6, o.w * .29), false);
  else if (type > 3.5 && type < 4.5) t = roundedBox(vec3(q.xy, zz), vec3(o.w, o.w, .13), .06);
  else if (type > 4.5 && type < 5.5) t = roundedBox(vec3(q.xy, zz), vec3(o.w * .55), .09);
  else if (type > 6.5) t = cappedCylinder(vec3(q.xy, zz), o.w, o.w * .62);
  else { float offset = type > 1.5 && type < 2.5 ? -o.w * .28 : o.w * .28; t = ball(vec3(q.xy, (q.z + offset) / stretch), o.w); }
  vec3 g = worldVector(vec3(t.y, t.z, t.w / stretch), ra, rb); return vec4(t.x * scale, g * scale);
}
vec4 field(vec3 p) {
  if (mode == 1) { float l = max(length(p.xz), .000001); return vec4(l - radius, p.x / l, 0., p.z / l); }
  if (mode == 2) return tor(p, radius + 2., max(.6, strength * .65), false);
  if (mode == 3) { float rr = max(length(p.xy), .000001); return smax(vec4(abs(p.z) - strength, 0., 0., sign(p.z)), vec4(radius - rr, -p.x / rr, -p.y / rr, 0.), smoothing); }
  vec4 f = vec4(p.z, 0., 0., 1.);
  for (int i = 0; i < 10; i++) { if (i >= shapeCount) break; vec4 o = shapes[i], sp = specs[i], b = shapeField(o, sp, rotationA[i], rotationB[i], p); f = sp.w > .5 ? smax(f, -b, sp.y) : smin(f, b, sp.y); }
  return f;
}
vec3 normal(vec3 p) { return normalize(field(p).yzw); }
float gaussian(vec3 p, vec3 n) {
  vec3 a = normalize(cross(n, abs(n.z) < .9 ? vec3(0., 0., 1.) : vec3(0., 1., 0.))), b = cross(n, a); float e = .025;
  vec3 da = (normal(p + a * e) - normal(p - a * e)) / (2. * e), db = (normal(p + b * e) - normal(p - b * e)) / (2. * e);
  return dot(a, da) * dot(b, db) - dot(a, db) * dot(b, da);
}
float tiles(vec2 p) { vec2 q = abs(fract(p * 2.) - .5); float sd = length(max(q - vec2(.22), 0.)) - .105; return 1. - smoothstep(-.018, .018, sd); }
float arrow(vec3 p) { vec3 d = (p - player) / 1.4, rt = normalize(cross(forward, up)); float x = dot(d, rt), y = dot(d, forward), z = abs(dot(d, up)); float shaft = max(abs(x) - .09, abs(y + .06) - .22), head = max(abs(x) * .95 + y * .65 - .26, max(-y + .04, y - .42)); return (1. - smoothstep(-.016, .016, min(shaft, head))) * (1. - smoothstep(.07, .15, z)); }
// Material ownership uses the unblended winner test (a 0.035m anti-alias edge),
// not abs(shape distance), so color cannot bleed across the surrounding plane.
vec3 materialColor(vec3 p) {
  vec3 gray = vec3(.57, .60, .58), material = gray; vec4 f = vec4(p.z, 0., 0., 1.);
  if (mode != 0) return material;
  for (int i = 0; i < 10; i++) { if (i >= shapeCount) break; vec4 o = shapes[i], sp = specs[i], b = shapeField(o, sp, rotationA[i], rotationB[i], p);
    if (sp.w > .5) { float cut = smoothstep(-.035, .035, -b.x - f.x); material = mix(material, gray, cut); f = smax(f, -b, sp.y); }
    else { float own = smoothstep(.035, -.035, b.x - f.x); material = mix(material, colors[i].rgb, own * colors[i].a); f = smin(f, b, sp.y); }
  }
  return material;
}
vec3 surfaceColor(vec3 p, vec3 n) {
  vec3 c = materialColor(p); vec3 w = pow(abs(n), vec3(6.)); w /= max(dot(w, vec3(1.)), .0001); float pattern = tiles(p.yz) * w.x + tiles(p.xz) * w.y + tiles(p.xy) * w.z; c *= .96 + pattern * .08;
  // Curvature is applied last, globally, so it remains vivid over custom material
  // and over negative cavities instead of being averaged away by a shape tint.
  float K = gaussian(p, n), weight = smoothstep(.002, .060, abs(K)); vec3 curvatureColor = K > 0. ? vec3(1., .46, .12) : vec3(.07, .59, .96);
  c = mix(c, curvatureColor, weight);
  return mix(c, vec3(.83, .025, .035), arrow(p));
}
`;
export const intrinsicVertex = `attribute vec2 screen; attribute vec3 point; uniform vec2 aspect; uniform float zoom; varying vec3 pos; void main() { pos = point; gl_Position = vec4(screen / aspect / zoom, 0., 1.); }`;
export const intrinsicFragment = common + `varying vec3 pos; void main() { vec3 n = normal(pos); gl_FragColor = vec4(surfaceColor(pos, n), 1.); }`;
export const quadVertex = `attribute vec2 a; varying vec2 uv; void main() { uv = a; gl_Position = vec4(a, 0., 1.); }`;
export const observerFragment = common + `
varying vec2 uv; uniform vec2 aspect; uniform vec3 camera; uniform vec3 target; uniform vec3 cameraUp;
void main() { vec3 f = normalize(target - camera), r = normalize(cross(f, cameraUp)), u = cross(r, f), ray = normalize(f + (uv.x * aspect.x * r + uv.y * u) * .62), sky = mix(vec3(.69, .77, .82), vec3(.84, .87, .88), .5 + .5 * ray.z); float t = .03; bool hit = false; vec3 p;
  for (int i = 0; i < 120; i++) { p = camera + ray * t; float d = abs(field(p).x); if (d < .006) { hit = true; break; } t += max(.008, d * .65); if (t > 110.) break; }
  if (!hit) { gl_FragColor = vec4(sky, 1.); return; } vec3 n = normal(p), c = surfaceColor(p, n); float light = .72 + .28 * abs(dot(n, normalize(vec3(-.4, -.6, 1.)))); c *= light; c = mix(c, sky, 1. - exp(-t * .003)); gl_FragColor = vec4(c, 1.);
}`;
