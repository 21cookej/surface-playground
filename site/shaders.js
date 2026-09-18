export const common = `
precision highp float;
uniform int mode;
uniform float radius;
uniform float strength;
uniform float smoothing;
uniform int shapeCount;
uniform vec4 shapes[10];
uniform vec4 specs[10];
uniform vec3 player;
uniform vec3 forward;
uniform vec3 up;
vec4 smin(vec4 a, vec4 b, float k) {
  float h = clamp(.5 + .5 * (b.x - a.x) / k, 0., 1.);
  vec4 d = mix(b, a, h);
  d.x -= k * h * (1. - h);
  return d;
}
vec4 smax(vec4 a, vec4 b, float k) {
  return -smin(-a, -b, k);
}
vec4 ball(vec3 p, float r) {
  float l = max(length(p), .000001);
  return vec4(l - r, p / l);
}
vec4 diamond(vec3 p, float r) {
  float l = max(abs(p.x) + abs(p.y) + abs(p.z), .000001);
  return vec4(l - r, sign(p.x), sign(p.y), sign(p.z));
}
vec4 tor(vec3 p, float R, float r, bool vertical) {
  float radial = max(vertical ? length(p.xz) : length(p.xy), .000001);
  float a = radial - R;
  float b = vertical ? p.y : p.z;
  float l = max(length(vec2(a, b)), .000001);
  float g = a / l / radial;
  return vertical ? vec4(l - r, p.x * g, b / l, p.z * g) : vec4(l - r, p.x * g, p.y * g, b / l);
}
// Shape types: 0 handle, 1 bump, 2 bowl, 3 ring, 4 spike. Each is sampled in a
// local frame translated by (o.x, o.y), shifted in height by sp.z, and rotated
// by sp.w around the vertical axis; the local gradient is rotated back after.
vec4 shapeField(vec4 o, vec4 sp, vec3 p) {
  float type = o.z;
  vec2 d = p.xy - o.xy;
  float ca = cos(sp.w), sa = sin(sp.w);
  float rx = d.x * ca + d.y * sa, ry = -d.x * sa + d.y * ca;
  float zz0 = p.z - sp.z;
  float stretch = sp.x, scale = min(1., stretch);
  vec4 t;
  if (type < .5) {
    t = tor(vec3(rx, ry, zz0 / stretch), o.w, max(.6, o.w * .29), true);
  } else if (type > 2.5 && type < 3.5) {
    t = tor(vec3(rx, ry, zz0 / stretch), o.w, max(.6, o.w * .29), false);
  } else {
    float zz = (zz0 + (type > 1.5 && type < 2.5 ? -o.w * .28 : o.w * .28)) / stretch;
    t = type > 3.5 ? diamond(vec3(rx, ry, zz), o.w) : ball(vec3(rx, ry, zz), o.w);
  }
  float gx = t.y * ca - t.z * sa, gy = t.y * sa + t.z * ca;
  return vec4(t.x * scale, gx * scale, gy * scale, t.w * scale / stretch);
}
vec4 field(vec3 p) {
  if (mode == 1) {
    float l = max(length(p.xz), .000001);
    return vec4(l - radius, p.x / l, 0., p.z / l);
  }
  if (mode == 2) return tor(p, radius + 2., max(.6, strength * .65), false);
  if (mode == 3) {
    float rr = max(length(p.xy), .000001);
    return smax(vec4(abs(p.z) - strength, 0., 0., sign(p.z)), vec4(radius - rr, -p.x / rr, -p.y /
      rr, 0.), smoothing);
  }
  vec4 f = vec4(p.z, 0., 0., 1.);
  for (int i = 0; i < 10; i++) {
    if (i >= shapeCount) break;
    vec4 o = shapes[i];
    vec4 sp = specs[i];
    vec4 b = shapeField(o, sp, p);
    bool bowl = o.z > 1.5 && o.z < 2.5;
    f = bowl ? smax(f, -b, sp.y) : smin(f, b, sp.y);
  }
  return f;
}
vec3 normal(vec3 p) {
  return normalize(field(p).yzw);
}
float gaussian(vec3 p, vec3 n) {
  vec3 a = normalize(cross(n, abs(n.z) < .9 ? vec3(0., 0., 1.) : vec3(0., 1., 0.)));
  vec3 b = cross(n, a);
  float e = .025;
  vec3 da = (normal(p + a * e) - normal(p - a * e)) / (2. * e), db = (normal(p + b * e) - normal(
    p - b * e)) / (2. * e);
  return dot(a, da) * dot(b, db) - dot(a, db) * dot(b, da);
}
float tiles(vec2 p) {
  vec2 q = abs(fract(p * 2.) - .5);
  float sd = length(max(q - vec2(.22), 0.)) - .105;
  return 1. - smoothstep(-.018, .018, sd);
}
float arrow(vec3 p) {
  vec3 d = (p - player) / 1.4;
  vec3 rt = normalize(cross(forward, up));
  float x = dot(d, rt), y = dot(d, forward), z = abs(dot(d, up));
  float shaft = max(abs(x) - .09, abs(y + .06) - .22);
  float head = max(abs(x) * .95 + y * .65 - .26, max(-y + .04, y - .42));
  return (1. - smoothstep(-.016, .016, min(shaft, head))) * (1. - smoothstep(.07, .15, z));
}
vec3 surfaceColor(vec3 p, vec3 n) {
  float K = gaussian(p, n);
  vec3 gray = vec3(.57, .60, .58), orange = vec3(1., .46, .12), blue = vec3(.07, .59, .96);
  float weight = 1. - exp(-abs(K) * 23.);
  vec3 c = mix(gray, K > 0. ? orange : blue, weight);
  vec3 w = pow(abs(n), vec3(6.));
  w /= max(dot(w, vec3(1.)), .0001);
  float pattern = tiles(p.yz) * w.x + tiles(p.xz) * w.y + tiles(p.xy) * w.z;
  c *= .94 + pattern * .16;
  c = mix(c, vec3(.83, .025, .035), arrow(p));
  return c;
}
`;
export const intrinsicVertex = `
attribute vec2 screen;
attribute vec3 point;
uniform vec2 aspect;
uniform float zoom;
varying vec3 pos;
void main() {
  pos = point;
  gl_Position = vec4(screen / aspect / zoom, 0., 1.);
}
`;
export const intrinsicFragment = common + `
varying vec3 pos;
void main() {
  vec3 n = normal(pos);
  gl_FragColor = vec4(surfaceColor(pos, n), 1.);
}
`;
export const quadVertex = `
attribute vec2 a;
varying vec2 uv;
void main() {
  uv = a;
  gl_Position = vec4(a, 0., 1.);
}
`;
export const observerFragment = common + `
varying vec2 uv;
uniform vec2 aspect;
uniform vec3 camera;
uniform vec3 target;
uniform vec3 cameraUp;
void main() {
  vec3 f = normalize(target - camera), r = normalize(cross(f, cameraUp)), u = cross(r, f);
  vec3 ray = normalize(f + (uv.x * aspect.x * r + uv.y * u) * .62);
  vec3 sky = mix(vec3(.69, .77, .82), vec3(.84, .87, .88), .5 + .5 * ray.z);
  float t = .03;
  bool hit = false;
  vec3 p;
  for (int i = 0; i < 150; i++) {
    p = camera + ray * t;
    float d = abs(field(p).x);
    if (d < .006) {
      hit = true;
      break;
    }
    t += max(.008, d * .65);
    if (t > 110.) break;
  }
  if (!hit) {
    gl_FragColor = vec4(sky, 1.);
    return;
  }
  vec3 n = normal(p), c = surfaceColor(p, n);
  float light = .67 + .33 * abs(dot(n, normalize(vec3(-.4, -.6, 1.))));
  c *= light;
  c = mix(c, sky, 1. - exp(-t * .003));
  gl_FragColor = vec4(c, 1.);
}
`;
