// motion.js - the Kepthold duplicate book as one lit scene, in raw WebGL2. No libraries, no requests to other hosts.
// One pad, bound at the top. The grey top sheet is the app's page; the green sheet under it is the copy.
// One key light from the upper left lights the paper; the ground's light pool is the page's own CSS (.pool),
// and this canvas adds only what stands on the ground: the pad, the falling sheet and their shadows.
// Debug queries: ?p=0.45 fixes the tear progress; ?poster=1 renders stills for the baked posters;
// ?sheet=2|3 renders a lone kept copy (No. 0417 / 0416) for the lower page; ?layout=desk|phone forces the ink layout.

const Q = new URLSearchParams(location.search);
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const ease = t => t * t * (3 - 2 * t);
let FIXED = Q.has('p') ? clamp(+Q.get('p')) : null;
const POSTER = Q.has('poster');
if (Q.has('flat')) { FIXED = 1; document.documentElement.classList.add('flat'); }   // the page unpinned, torn: for whole-page captures
const SHEET = +(Q.get('sheet') || 0);           // 2 or 3: a lone kept copy for the lower page
const doc = document.documentElement;
const hero = document.querySelector('.hero');
const pin = document.querySelector('.pin');
const box = document.getElementById('padbox');
const handle = document.getElementById('handle');
const hint = document.getElementById('hint');
const tearBtn = document.querySelector('.act.tear'), after = document.querySelector('.after');
const askBtn = document.querySelector('.act.ask'), undo = document.querySelector('.undo');

// ---------------------------------------------------------------- content (made-up sample data)
const SLIPS = {
  1: { q: 'Who owes us for more than 30 days?', a: '4 customers owe $6,320.',
       rows: [['Northgate Plumbing', '47 days', '$2,940'], ['Harbour Lane Bakery', '38 days', '$1,860'],
              ['Riverside Dental', '33 days', '$1,040'], ['Ashford Print Works', '31 days', '$480']],
       tot: ['Total', '4 customers', '$6,320'], kept: 'From last night’s copy', no: 'Copy 418', ch: ['Customer', 'Overdue', 'Amount'] },
  2: { q: 'What did we sell last week?', a: '$18,240 from 212 orders.',
       rows: [['Counter sales', '148 orders', '$9,870'], ['Online orders', '41 orders', '$5,210'],
              ['Catering', '6 orders', '$2,460'], ['Gift cards', '17 orders', '$700']],
       tot: ['Total', '212 orders', '$18,240'], kept: 'From the copy a night earlier', no: 'Copy 417', ch: ['Sales', 'Orders', 'Amount'] },
  3: { q: 'What is payroll this Friday?', a: '$11,460 for 14 people.',
       rows: [['Kitchen', '6 people', '$4,980'], ['Front of house', '5 people', '$3,720'],
              ['Delivery', '2 people', '$1,640'], ['Office', '1 person', '$1,120']],
       tot: ['Total', '14 people', '$11,460'], kept: 'From the copy two nights earlier', no: 'Copy 416', ch: ['Team', 'People', 'Amount'] },
};

// ---------------------------------------------------------------- the pad, in pad units (1 unit = 1 CSS px at 1440 x 900)
// Sheet frame: u runs right from the sheet's left edge, v runs down from the perforation.
const PW = 520, PH = 610, BOT = PH + 14;        // sheet size; the board's bottom edge (the stack shows below the sheets)
const BOX = [-3, -58, 526, BOT + 58];            // the #padbox element covers exactly this (binding top to board bottom)
const Z_BOARD = 2, Z_GAP = 0.7, N_STACK = 5;
const Z_GREEN = Z_BOARD + Z_GAP * (N_STACK + 1), Z_TOP = Z_GREEN + Z_GAP, Z_BIND = Z_TOP + 0.9;   // the binding cloth lies flush on the sheets
const PITCH = 11, HOLE_R = 2.15, EB = 4 * PITCH / 8;   // perforation pitch, hole radius, half-height of the torn band (units)
// one key light: upper left, a little warm, about 48 degrees above the surface
const L = (() => { const v = [-0.55, -0.835, 1.15]; const n = Math.hypot(...v); return v.map(x => x / n); })();
const SHV = [-L[0] / L[2], -L[1] / L[2]];      // ground offset of a cast shadow per unit of height
const CAM = [PW / 2, PH / 2 - 20], CAM_D = 2600;   // close enough that paper lifted toward the viewer grows
// the light pool: the same numbers as .pool in index.html (box-relative), so paper and ground are lit alike
// centred up and left of the pad, where the key light falls brightest; constant beyond 0.75 of its radius
const POOL = { cx: BOX[0] - 0.12 * BOX[2], cy: BOX[1] - 0.10 * BOX[3], rx: 2.2 * BOX[2], ry: 2.2 * BOX[2],
               stops: [[0, 0], [0.35, 0.015], [0.75, 0.065], [1, 0.065]], tint: [23 / 255, 25 / 255, 22 / 255] };

// ---------------------------------------------------------------- GL setup
const canvas = document.createElement('canvas');
canvas.setAttribute('aria-hidden', 'true');
canvas.className = 'gl-scene';
const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: true, preserveDrawingBuffer: POSTER || !!SHEET });
if (!gl) throw new Error('no webgl2');
hero.appendChild(canvas);

const HEAD = `#version 300 es
precision highp float; precision highp int;
#define ZG ${Z_GREEN.toFixed(3)}
#define ZT ${Z_TOP.toFixed(3)}
#define ZB ${Z_BIND.toFixed(3)}
#define EB ${EB.toFixed(3)}
`;
const CURL = `
uniform vec4 uFold;      // fold normal (x, y), fold offset c, roll radius R
uniform vec4 uBend;      // spiral k (radius change per radian; < 0 opens out, > 0 tightens), taper, telescoping, unevenness
uniform vec4 uChord;     // the fold line's span inside the sheet (along-axis min, max), tab lift, unused
uniform vec4 uOpen;      // the freed sheet springing open: R, k, fold offset of the open arc; how far it has opened (0 to 1)
float rollAngle(float s, float R, float k) {   // arc length s on the spiral r = R (1 - k th): th = (2 s / R) / (1 + sqrt(1 - 2 k s / R))
  float D = max(1.0 - 2.0 * k * s / R, 0.0);
  return (2.0 * s / R) / (1.0 + sqrt(D));
}
float softIn(float x, float lo, float hi) {   // keeps rolled paper over the sheet: soft walls at both ends of the fold
  float m = 5.0;
  if (x < lo + m) x = lo + m - m * (1.0 - exp((x - lo - m) / m));
  if (x > hi - m) x = hi - m + m * (1.0 - exp((hi - m - x) / m));
  return x;
}
vec3 rollGeoX(vec2 q, out float th, float C, float R0, float K) {   // a point of the top sheet on the curl or roll; th = its roll angle
  vec2 nn = uFold.xy; vec2 t = vec2(-nn.y, nn.x);
  float s = dot(q, nn) - C;
  float lift = uChord.z * clamp(dot(q, nn) / max(C, 1.0), 0.0, 1.0);   // the tab between perforation and roll, under tension
  th = 0.0;
  if (s <= 0.0) return vec3(q, lift);
  float ta = dot(q, t);
  float len = max(uChord.y - uChord.x, 1.0), mid = 0.5 * (uChord.x + uChord.y);
  float R = R0 * (1.0 + uBend.y * (ta - mid) / len) * (1.0 + uBend.w * sin(ta * 0.021 + 1.3));
  th = rollAngle(s, R, K);
  float r = R * (1.0 - K * th) * (1.0 + uBend.w * 0.5 * sin(th * 0.83) * cos(ta * 0.013));
  float w = smoothstep(0.0, 30.0, s);
  float ta2 = mix(ta, softIn(ta, uChord.x + 2.0 + uChord.w, uChord.y - 2.0 - uChord.w - 11.0 * uBend.z), w) + uBend.z * min(th, 60.0) * 0.13 * w;
  vec2 base = nn * C + t * ta2;
  return vec3(base + nn * (r * sin(th)), R - r * cos(th) + lift);
}
vec3 curlP(vec2 q) {
  float th; vec3 p = rollGeoX(q, th, uFold.z, uFold.w, uBend.x);
  if (uOpen.w > 0.0) { float t2; p = mix(p, rollGeoX(q, t2, uOpen.z, uOpen.x, uOpen.y), uOpen.w); }
  return p;
}
vec3 curlN(vec2 q) {
  float th; vec3 p = rollGeoX(q, th, uFold.z, uFold.w, uBend.x);
  vec3 n = th <= 0.0 ? vec3(0, 0, 1) : vec3(-uFold.xy * sin(th), cos(th));
  if (uOpen.w > 0.0) {
    float t2; p = rollGeoX(q, t2, uOpen.z, uOpen.x, uOpen.y);
    vec3 n2 = t2 <= 0.0 ? vec3(0, 0, 1) : vec3(-uFold.xy * sin(t2), cos(t2));
    n = normalize(mix(n, n2, uOpen.w) + vec3(0.0, 0.0, 1e-4));
  }
  return n;
}`;

const VS = HEAD + `
layout(location = 0) in vec2 aUV;
uniform int uKind, uPass;
uniform float uZ, uFront;
uniform vec2 uOff;
uniform mat3 uRot; uniform vec3 uPivot, uTrans; uniform float uFly;
uniform vec4 uPull;      // the hand: lift of the roll, extra lift on the torn side, lift of the torn top edge, unused
uniform vec4 uView;      // origin x, y (css px), scale (px per unit), camera distance
uniform vec2 uCam, uCanvas, uShv;
out vec2 vUV; out vec3 vW;
${CURL}
void main() {
  vec3 P = vec3(aUV, 0.0);
  if (uKind == 5) {
    // where it has torn, the sheet's top edge pulls back toward the roll and lifts: the gap opens behind the tear front
    float torn = smoothstep(0.0, 40.0, aUV.x - uFront);
    float nearTop = 1.0 - smoothstep(2.0, 34.0, aUV.y);
    vec2 q = aUV + vec2(0.0, 1.8 * uPull.z * torn * nearTop);
    P = curlP(q);
    // the hand holds the roll up: the tab between the perforation and the roll slopes up to it, more on the torn side
    float s = dot(q, uFold.xy) - uFold.z;
    float tt = clamp(dot(q, uFold.xy) / max(uFold.z, 1.0), 0.0, 1.0);
    float hold = s > 0.0 ? 1.0 : tt * tt * (3.0 - 2.0 * tt);
    float side = clamp((aUV.x - uFront + 60.0) / 300.0, 0.0, 1.0);
    P.z += hold * (uPull.x + uPull.y * side) + uPull.z * torn * nearTop;
    // while it is still on the pad, the roll's ends stay over the pad's edges (the camera's spread would push them past)
    P.x = mix(P.x, uCam.x + (P.x - uCam.x) * (1.0 - max(P.z, 0.0) / uView.w), 1.0 - uOpen.w);
  }
  if (uKind == 3 && aUV.x > uFront) P.z += 1.1 * smoothstep(-0.75 * EB, EB, aUV.y);   // the torn lip of the stub lifts a little
  if (uKind == 3) P.z += uChord.z * 0.35 * smoothstep(-EB, EB, aUV.y) * step(aUV.x, uFront);   // and is pulled up while the sheet tensions
  P.xy += uOff; P.z += uZ;
  if (uPass == 1 && uKind == 4) P.z = ZT;   // the binding cloth lies on the sheets: it casts no higher than they do
  if (uKind == 5 && uFly > 0.5) P = uRot * (P - uPivot) + uPivot + uTrans;
  vUV = aUV; vW = P;
  vec2 px;
  if (uPass == 1) px = uView.xy + (P.xy + P.z * uShv + (P.xy - uCam) * max(P.z - ZT, 0.0) / 1800.0) * uView.z;   // a high caster's shadow spreads
  else px = uView.xy + (uCam + (P.xy - uCam) * uView.w / (uView.w - P.z)) * uView.z;
  gl_Position = vec4(px.x / uCanvas.x * 2.0 - 1.0, 1.0 - px.y / uCanvas.y * 2.0, clamp(-P.z / 2400.0, -0.99, 0.99), 1.0);
}`;

const SHADOW_FN = `
uniform sampler2D uS0, uS1, uS2, uS3, uS4, uS5;
const float SIG1 = 0.8, SIG2 = 2.5, SIG3 = 7.0, SIG4 = 18.0, SIG5 = 44.0;
float occAt(vec2 uv, vec4 m, float w) {   // coverage of the channel m, blurred to a penumbra of w css px
  float c0 = dot(texture(uS0, uv), m), c1 = dot(texture(uS1, uv), m), c2 = dot(texture(uS2, uv), m),
        c3 = dot(texture(uS3, uv), m), c4 = dot(texture(uS4, uv), m), c5 = dot(texture(uS5, uv), m);
  if (w < SIG1) return mix(c0, c1, w / SIG1);
  if (w < SIG2) return mix(c1, c2, (w - SIG1) / (SIG2 - SIG1));
  if (w < SIG3) return mix(c2, c3, (w - SIG2) / (SIG3 - SIG2));
  if (w < SIG4) return mix(c3, c4, (w - SIG3) / (SIG4 - SIG3));
  return mix(c4, c5, clamp((w - SIG4) / (SIG5 - SIG4), 0.0, 1.0));
}
float liftedH(vec2 uv, out float near) {  // mean height of the lifted top sheet around here (0 when none)
  vec4 s = texture(uS4, uv); near = smoothstep(0.0, 0.06, s.b);
  return s.b > 0.002 ? s.a / s.b * 900.0 + ZT : 0.0;
}`;

const FS = HEAD + `
in vec2 vUV; in vec3 vW;
uniform sampler2D uPaper, uEdge, uInk, uWords;
uniform vec2 uClip;      // x: on the top sheet, a word that reaches the fold goes whole; y: on the copy, a word shows once clear of the roll
uniform float uExt, uOver;   // how far the roll reaches past its fold line over the copy, and back over the flat sheet
uniform int uKind, uPass;
uniform float uFront, uFresh, uRelief, uAlb, uTexK, uInkOn, uTornTop, uFly, uPoolOn, uShade, uLift, uMat, uFade;
uniform vec4 uRect, uView;
uniform vec3 uTint, uTintBack, uL, uPoolTint;
uniform vec2 uTexOff, uCam, uCanvas, uShv;
uniform vec4 uPoolE; uniform vec4 uPoolS;   // ellipse cx, cy, rx, ry; stop alphas at 0.45, 0.8, 1
uniform mat3 uRot;
out vec4 o;
${CURL}
${SHADOW_FN}
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
float holeMask(float u, float v, float e) {
  float k = floor(u / ${PITCH.toFixed(1)}); float hc = (k + 0.5) * ${PITCH.toFixed(1)};
  return smoothstep(${HOLE_R.toFixed(2)} - e, ${HOLE_R.toFixed(2)} + e, length(vec2(u - hc, v)));
}
float poolA(vec2 w) {
  float d = length((w - uPoolE.xy) / uPoolE.zw);
  if (d < 0.35) return mix(0.0, uPoolS.x, d / 0.35);
  if (d < 0.75) return mix(uPoolS.x, uPoolS.y, (d - 0.35) / 0.4);
  if (d < 1.0) return mix(uPoolS.y, uPoolS.z, (d - 0.75) / 0.25);
  return uPoolS.z;
}
void main() {
  float u = vUV.x, v = vUV.y;
  float e = max(fwidth(u) + fwidth(v), 0.04) * 0.6;
  float a = smoothstep(uRect.x - e, uRect.x + e, u) * smoothstep(uRect.y + e, uRect.y - e, u)
          * smoothstep(uRect.z - e, uRect.z + e, v) * smoothstep(uRect.w + e, uRect.w - e, v);
  float core = 0.0;
  bool edged = uKind == 3 || uKind == 5 || (uKind == 2 && uTornTop > 0.5);
  if (edged) {
    float ea;
    bool sheetSide = uKind != 3;
    if (u > uFront || uKind == 2) {   // torn: the strip's contour, the fibre core, the loose fibres
      float ex = (${PW}.0 - u) * ${(48 / PITCH).toFixed(4)} / 4096.0 + (uKind == 2 ? uTexOff.x : 0.0);
      vec4 E = texture(uEdge, vec2(ex, (v + EB) / (2.0 * EB)));
      // a point just inside the torn edge: the paper one unit further toward the edge is missing. That rim is the
      // exposed fibre, paler than the face; the same profile on the stub and on the leaving sheet (a mating pair).
      float dv = sheetSide ? -1.7 : 1.7;
      vec4 E2 = texture(uEdge, vec2(ex, (v + dv + EB) / (2.0 * EB)));
      float out2;
      if (sheetSide) { ea = v > EB - 0.1 ? 1.0 : (v < 0.1 - EB ? 0.0 : E.b); out2 = (v + dv) < 0.1 - EB ? 0.0 : ((v + dv) > EB - 0.1 ? 1.0 : E2.b); }
      else { ea = v < 0.1 - EB ? 1.0 : (v > EB - 0.1 ? 0.0 : E.r); out2 = (v + dv) > EB - 0.1 ? 0.0 : ((v + dv) < 0.1 - EB ? 1.0 : E2.r); }
      out2 *= holeMask(u, v + dv, e);
      float rim = clamp(1.0 - out2, 0.0, 1.0) * 0.5 + (1.0 - smoothstep(0.3, 0.95, ea)) * 0.45;
      core = max(1.5 * E.g * step(abs(v), EB - 0.1), rim) * (1.0 + 0.4 * uFresh * exp(-max(u - uFront, 0.0) / 30.0));
    } else {                           // still joined: fringe and sheet overlap by a unit, so no seam shows
      ea = sheetSide ? smoothstep(-0.6 - e, -0.6 + e, v) : smoothstep(0.6 + e, 0.6 - e, v);
    }
    ea *= holeMask(u, v, e);
    a *= ea;
  }
  if (a < 0.004) discard;
  if (uPass == 1) {   // shadow map: any caster, casters above the copy, the lifted top sheet, its height
    if (a < 0.5) discard;
    float z = vW.z;
    bool lifted = uKind == 5 && z > ZT + 1.0;
    o = vec4(1.0, step(ZG + 0.35, z), lifted ? 1.0 : 0.0, lifted ? clamp((z - ZT) / 900.0, 0.0, 1.0) : 0.0);
    return;
  }
  // ---- surface normal
  vec3 N = vec3(0, 0, 1);
  if (uKind == 5) { N = curlN(vUV); if (uFly > 0.5) N = uRot * N; }
  if (uKind == 4) {   // the binding cloth rounds over the top edge of the book and lips onto the sheets
    float w = clamp((v - uRect.z) / (uRect.w - uRect.z), 0.0, 1.0);
    float ang = w < 0.4 ? -pow((0.4 - w) / 0.4, 1.3) * 1.25 : (w > 0.86 ? pow((w - 0.86) / 0.14, 1.5) * 0.7 : 0.0);
    N = vec3(0.0, sin(ang), cos(ang));
  }
  vec3 camP = vec3(uCam, uView.w);
  vec3 V = normalize(camP - vW);
  bool back = dot(N, V) < 0.0;
  vec3 Nf = back ? -N : N;
  // ---- paper
  // Materials. uMat 0: uncoated carbonless copy paper, soft fibre. uMat 1: the app's coated sheet, smooth and a little glossy.
  vec2 tc = vUV / 270.0 * uTexK + uTexOff;
  float texel = max(1.0 / 1024.0, length(fwidth(tc)) * 0.7);
  vec4 P0 = texture(uPaper, tc);
  float hx = texture(uPaper, tc + vec2(texel, 0)).g - texture(uPaper, tc - vec2(texel, 0)).g;
  float hy = texture(uPaper, tc + vec2(0, texel)).g - texture(uPaper, tc - vec2(0, texel)).g;
  float formation = vnoise(vUV / 46.0) * 0.6 + vnoise(vUV / 13.0 + 7.0) * 0.4;   // the cloudy look-through of paper
  // ---- ink first: where there is ink, the fibre relief is filled in (no grain stamped over the letters)
  float inkAmt = 0.0; vec3 inkc = vec3(1.0);
  if (uInkOn > 0.5) {
    vec2 iu = vec2(u / ${PW}.0, v / ${PH}.0);
    if (iu.x > 0.0 && iu.x < 1.0 && iu.y > 0.0 && iu.y < 1.0) {
      if (back) {   // seen from behind, the print shows through the thin stock: faint, soft, mirrored by itself
        vec3 thru = textureLod(uInk, iu, 4.6).rgb;
        inkc = mix(vec3(1.0), thru, 0.09);
      } else {
        vec3 sharp = texture(uInk, iu).rgb;
        vec3 soft = textureLod(uInk, iu, 1.2).rgb;
        inkc = min(sharp, mix(vec3(1.0), soft, uMat > 0.5 ? 0.15 : 0.4));   // uncoated stock spreads the ink a little
        if (uClip.x + uClip.y > 0.001) {   // whole words only: no fragment of a word beside the fold or the roll
          vec4 wb = texture(uWords, iu);
          if (wb.b >= wb.r) {
            vec2 a0 = wb.rg * vec2(${PW}.0, ${PH}.0), a1 = wb.ba * vec2(${PW}.0, ${PH}.0), nn = uFold.xy;
            float d0 = dot(a0, nn), d1 = dot(vec2(a1.x, a0.y), nn), d2 = dot(vec2(a0.x, a1.y), nn), d3 = dot(a1, nn);
            float sMax = max(max(d0, d1), max(d2, d3)) - uFold.z, sMin = min(min(d0, d1), min(d2, d3)) - uFold.z;
            float keep = uKind == 5 ? mix(1.0, 1.0 - smoothstep(-uOver - 16.0, -uOver, sMax), uClip.x)
                                    : mix(1.0, smoothstep(uExt, uExt + 14.0, sMin), uClip.y);
            inkc = mix(vec3(1.0), inkc, keep);
          }
        }
      }
      inkAmt = 1.0 - min(inkc.r, min(inkc.g, inkc.b));
    }
  }
  float relief = (back ? max(uRelief, 0.24) : uRelief) * (1.0 - 0.9 * smoothstep(0.05, 0.5, inkAmt));   // the back of the app sheet is plain uncoated stock
  vec3 Np = normalize(Nf + vec3(-hx, -hy, 0.0) * relief);
  if (uKind == 4) Np = normalize(Nf + vec3(0.0, sin(u * 2.4 + P0.g * 2.0) * 0.05, 0.0) + vec3(-hx, -hy, 0.0) * uRelief);
  vec3 tint = back ? uTintBack : uTint;
  float alb = 1.0 + (P0.r - 0.5) * (back ? max(uAlb, 0.04) : uAlb) + (formation - 0.5) * (uMat > 0.5 && !back ? 0.012 : 0.035);
  vec3 col = tint * alb;
  if (inkAmt > 0.0) {   // flat ink, a touch lighter where it lies in the fibre (low-frequency, so no pattern on the letters)
    float take = uMat > 0.5 ? 0.97 : 0.93 - 0.05 * vnoise(vUV / 2.2) - 0.03 * (formation - 0.5);
    col *= 1.0 - (1.0 - inkc) * take;
  }
  col = mix(col, vec3(0.985, 0.985, 0.975), clamp(core, 0.0, 1.0) * 0.9);   // the torn fibre: paler and brighter than the face
  // ---- light
  vec3 Lv = normalize(uL);
  float wrapK = (uKind == 5 && uFly > 0.5) ? 0.4 : 0.0;   // thin paper: light wraps a little round a bend
  float key = max(dot(Np, Lv) + wrapK, 0.0) / (Lv.z + wrapK);
  key = key / (1.0 + 0.45 * max(key - 1.0, 0.0));   // what faces the low light gets brighter than the flat, but not blown out
  float sh = 1.0;
  if (uShade > 0.5) {
    vec2 spx = uView.xy + (vW.xy + vW.z * uShv) * uView.z;
    vec2 suv = vec2(spx.x / uCanvas.x, 1.0 - spx.y / uCanvas.y);
    float near; float hl = liftedH(suv, near);
    float z = vW.z;
    vec4 ch = (uKind <= 2) ? vec4(0, 1, 0, 0) : vec4(0, 0, 1, 0);
    float dh = mix(max(ZB - z, 0.5), max(hl - z, 0.5), near);
    float w = max(0.35 + dh * (near > 0.5 ? 0.2 : 0.11), 1.4) * uView.z;
    float occ = occAt(suv, ch, w);
    if (uKind == 5 && z > ZT + 1.0) occ *= smoothstep(z + 8.0, z + 40.0, hl);   // only what stands higher than this point
    sh = 1.0 - occ * (uKind <= 2 && near < 0.5 ? 0.42 : 0.36 - 0.25 * smoothstep(10.0, 220.0, dh));   // a high caster: wider, fainter
  }
  float amb = (uKind == 5 && uFly < 0.5 ? 0.30 : 0.42) + 0.08 * Nf.z;   // the roll: deeper form shading                        // sky fill: what faces up gets a little more
  float keyF = max(dot(N, Lv), 0.0) / Lv.z;              // the light on the printed face
  float trans = back ? 0.30 * keyF : 0.0;                 // from the back, some of it comes through the thin stock
  vec3 warm = vec3(1.0, 0.988, 0.962);
  vec3 lit = col * (amb * vec3(0.975, 0.99, 1.0) + (1.0 - amb) * (key + trans) * sh * warm);
  if (uKind == 5) {
    float bent = 1.0 - abs(N.z);
    vec3 H = normalize(Lv + V);
    // coated face: a broad soft gloss; the uncoated back of the sheet: almost none
    float gl = back ? 0.05 : 0.16;
    lit += warm * pow(max(dot(Np, H), 0.0), back ? 10.0 : 22.0) * gl * smoothstep(0.02, 0.3, bent) * sh;
    float facing = abs(dot(N, V));
    lit += tint * pow(1.0 - facing, 3.0) * 0.18 * smoothstep(0.0, 0.6, key) * smoothstep(0.05, 0.25, bent);   // the bright lip
    a *= 1.0 - uFade;
  }
  if (uMat > 0.5 && !back && N.z > 0.9) {   // the coated sheet lying flat: a wide, faint sheen where the key light mirrors
    vec2 d = (vW.xy - vec2(150.0, 140.0)) / vec2(330.0, 300.0);
    lit += warm * 0.045 * exp(-dot(d, d)) * sh;
  }
  if ((uKind == 5 || uKind == 3) && uChord.z > 0.01) {   // tension: the paper along the perforation catches the light
    lit += warm * 0.07 * (uChord.z / 2.6) * exp(-pow((v - 1.5) / (0.55 * EB), 2.0));
  }
  if (uShade > 0.5 && vW.z < ZT + 1.0) {   // the roll closes off the sky right beside it, on both sides: contact occlusion
    vec2 p0 = uView.xy + vW.xy * uView.z;
    vec2 uv0 = vec2(p0.x / uCanvas.x, 1.0 - p0.y / uCanvas.y);
    lit *= 1.0 - 0.14 * texture(uS2, uv0).b - 0.07 * texture(uS3, uv0).b;
  }
  if (uKind <= 1) lit *= uLift;   // the edges of the earlier sheets sit in the stack's own shade
  if (uKind == 1 || uKind == 2) {   // each sheet's bottom and right edge: a fine dark gap under it, a lit lip just inside
    float dE = min(uRect.w - v, uRect.y - u), px = max(fwidth(v) + fwidth(u), 0.08);
    float gap = 1.0 - smoothstep(0.0, 0.45 + px, dE);
    float lip = smoothstep(0.3, 0.9, dE) * (1.0 - smoothstep(0.9, 1.9 + px, dE));
    lit *= 1.0 - 0.30 * gap;
    lit += warm * 0.05 * lip * (uKind == 1 ? 1.0 : 0.6);
  }
  if (uPoolOn > 0.5) lit = mix(lit, uPoolTint, poolA(vW.xy));
  o = vec4(lit * a, a);
}`;

const QVS = `#version 300 es
layout(location = 0) in vec2 aP; void main() { gl_Position = vec4(aP, 0.0, 1.0); }`;
const BLUR = `#version 300 es
precision highp float;
uniform sampler2D uT; uniform vec2 uDir, uSize; uniform float uSig;
out vec4 o;
void main() {
  vec2 uv = gl_FragCoord.xy / uSize;
  float st = max(1.0, uSig / 2.2); int n = int(ceil(2.6 * uSig / st));
  vec4 acc = vec4(0); float ws = 0.0;
  for (int i = -14; i <= 14; i++) {
    if (abs(i) > n) continue;
    float x = float(i) * st; float w = exp(-x * x / (2.0 * uSig * uSig));
    acc += texture(uT, uv + uDir * x / uSize) * w; ws += w;
  }
  o = acc / ws;
}`;
const GFS = HEAD + `
uniform vec2 uCanvas; uniform float uDpr, uDith, uK;
out vec4 o;
${SHADOW_FN}
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
void main() {
  vec2 suv = gl_FragCoord.xy / (uCanvas * uDpr);
  float near; float hl = liftedH(suv, near);
  float dh = mix(ZB, hl, near);
  float w = max(0.35 + dh * (near > 0.5 ? 0.2 : 0.11), 1.4) * uK;
  float occ = occAt(suv, vec4(1, 0, 0, 0), w);
  float ao = texture(uS4, suv).r;
  float dark = occ * (0.40 - 0.26 * smoothstep(4.0, 60.0, dh) - 0.06 * smoothstep(60.0, 320.0, dh)) + ao * 0.07;
  dark += uDith * (hash(gl_FragCoord.xy) - 0.5) / 255.0;
  o = vec4(0.0, 0.0, 0.0, clamp(dark, 0.0, 1.0));
}`;

function compile(vs, fs) {
  const p = gl.createProgram();
  for (const [t, s] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
    const sh = gl.createShader(t); gl.shaderSource(sh, s); gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
    gl.attachShader(p, sh);
  }
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const loc = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) { const u = gl.getActiveUniform(p, i); loc[u.name.replace(/\[0\]$/, '')] = gl.getUniformLocation(p, u.name); }
  return { p, loc };
}
const sheetProg = compile(VS, FS), blurProg = compile(QVS, BLUR), groundProg = compile(QVS, GFS);

function grid(u0, u1, v0, v1, nu, nv) {
  const pts = [], idx = [];
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) pts.push(u0 + (u1 - u0) * i / nu, v0 + (v1 - v0) * j / nv);
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const a = j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1; idx.push(a, b, c, b, d, c);
  }
  const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
  const vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(pts), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(idx), gl.STATIC_DRAW);
  gl.bindVertexArray(null);
  return { vao, n: idx.length };
}
const quadVao = (() => { const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
  const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0); gl.bindVertexArray(null); return vao; })();

function tex(img, mip, wrap) {
  const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap === gl.REPEAT ? gl.MIRRORED_REPEAT : wrap);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mip ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  if (mip) gl.generateMipmap(gl.TEXTURE_2D);
  const an = gl.getExtension('EXT_texture_filter_anisotropic');
  if (an && mip) gl.texParameterf(gl.TEXTURE_2D, an.TEXTURE_MAX_ANISOTROPY_EXT, 8);
  return t;
}
const loadImg = src => new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = src; });
// The top perforation's torn edge is a swappable strip (format: tools/edge_from_gen.py). The generated one first,
// the code-made one (tools/textures.py) if it is missing; ?edge=<path> tries another.
const EDGES = [Q.get('edge'), 'assets/edge/edge-strip-gen.webp', 'assets/edge/edge-strip.webp'].filter(Boolean);
const loadEdge = async () => { for (const e of EDGES) { try { return await loadImg(e); } catch (x) {} } throw new Error('no edge strip'); };

// ---------------------------------------------------------------- ink: what is printed on the two sheets, in the site's faces
const SERIF = '"Besley", "Besley Fallback", Georgia, serif', SANS = '"Schibsted Grotesk", "Schibsted Fallback", Arial, sans-serif';
const INK_K = 2.4;
function wrapText(c, s, maxW) {
  const words = s.split(' '), lines = []; let cur = '';
  for (const w of words) { const t = cur ? cur + ' ' + w : w; if (c.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t; }
  lines.push(cur); return lines;
}
function inkCanvas() {
  const cv = document.createElement('canvas'); cv.width = Math.round(PW * INK_K); cv.height = Math.round(PH * INK_K);
  const c = cv.getContext('2d'); c.fillStyle = '#fff'; c.fillRect(0, 0, cv.width, cv.height); c.scale(INK_K, INK_K);
  c.textBaseline = 'alphabetic'; return { cv, c };
}
const ls = (c, px) => { if ('letterSpacing' in c) c.letterSpacing = px + 'px'; };
let WORDS = null;   // while drawing a sheet: the box of every printed word, in sheet units
function text(c, s, x, y, font, color, align = 'left', maxW = 0, lh = 0) {
  c.font = font; c.fillStyle = color; c.textAlign = align;
  const lines = maxW ? wrapText(c, s, maxW) : [s];
  const size = +(font.match(/([\d.]+)px/) || [0, 16])[1];
  lines.forEach((l, i) => {
    const by = y + i * lh; c.fillText(l, x, by);
    if (!WORDS) return;
    const w = c.measureText(l).width, x0 = align === 'right' ? x - w : (align === 'center' ? x - w / 2 : x);
    WORDS.push([x0 - 1, by - size * 0.80, x0 + w + 1, by + size * 0.26]);   // a printed item goes or stays whole
  });
  return lines.length;
}
function group(fn) {   // what fn prints is one unit for the clip: a two-line answer shows whole or not at all
  const n = WORDS ? WORDS.length : 0; fn();
  if (!WORDS || WORDS.length <= n) return;
  const bs = WORDS.splice(n);
  WORDS.push([Math.min(...bs.map(b => b[0])), Math.min(...bs.map(b => b[1])), Math.max(...bs.map(b => b[2])), Math.max(...bs.map(b => b[3]))]);
}
const WB = [260, 305];   // the word-box map: 2 sheet units per texel
function wordMap(boxes) {
  const [W, H] = WB, d = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) { d[i * 4] = 255; d[i * 4 + 1] = 255; d[i * 4 + 2] = 0; d[i * 4 + 3] = 0; }   // empty: no word
  const q = (x, m, up) => clamp(up ? Math.ceil(x / m * 255) : Math.floor(x / m * 255), 0, 255);
  for (const [x0, y0, x1, y1] of boxes) {
    const i0 = Math.max(0, Math.floor(x0 / PW * W) - 1), i1 = Math.min(W - 1, Math.ceil(x1 / PW * W) + 1);
    const j0 = Math.max(0, Math.floor(y0 / PH * H) - 1), j1 = Math.min(H - 1, Math.ceil(y1 / PH * H) + 1);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const k = (j * W + i) * 4; d.set([q(x0, PW, 0), q(y0, PH, 0), q(x1, PW, 1), q(y1, PH, 1)], k);
    }
  }
  const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, d);
  for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
  return t;
}
// Both sheets are printed on ONE grid, so that when the corner lifts the copy reads as the same page, now with numbers:
// the question on the same baseline, the big line (failure / answer) on the same two baselines, the status line,
// the column heads, the row rules and the three column edges all shared. Units are sheet units (v down from the perforation).
function gridFor(phone) {
  return phone
    ? { X: 40, MX: 480, C2: 340, hd: [20, 40, 60], f: [76, 132], q: 112, qs: [21, 30], big: [204, 262], bigS: 56, st: [306, 20],
        ch: [352, 16], r: [364, 43, 21] }
    : { X: 44, MX: 476, C2: 336, hd: [16, 40, 60], f: [80, 128], q: 110, qs: [17, 27], big: [200, 256], bigS: 50, st: [300, 16],
        ch: [352, 13], r: [366, 40, 16] };
}
function balance2(c, s, maxW) {   // two lines of near-equal width (keeps a number with its noun), else the greedy wrap
  const w = s.split(" "); let best = null;
  for (let i = 1; i < w.length; i++) {
    const a = w.slice(0, i).join(" "), b = w.slice(i).join(" "), m = Math.max(c.measureText(a).width, c.measureText(b).width);
    if (m <= maxW && (!best || m < best[0])) best = [m, [a, b]];
  }
  return c.measureText(s).width <= maxW * 0.62 ? [s] : (best ? best[1] : wrapText(c, s, maxW));
}
function fitSize(c, texts, weight, family, size, maxW, maxLines) {   // the largest size at which every text fits in maxLines
  for (let s = size; s > 8; s -= 0.5) {
    c.font = `${weight} ${s}px ${family}`;
    if (texts.every(t => wrapText(c, t, maxW).length <= maxLines)) return s;
  }
  return 8;
}
function bigSize(c, G) {   // the failure line and the answer share one size: the largest at which both make 2 lines
  return Math.min(fitSize(c, ['Not responding since 08:12'], 600, SANS, G.bigS, G.MX - G.X, 2),
                  fitSize(c, ['4 customers owe $6,320.', '$18,240 from 212 orders.', '$11,460 for 14 people.'], 650, SERIF, G.bigS, G.MX - G.X, 2));
}
function drawCopy(phone, slip) {   // the green kept copy
  const { cv, c } = inkCanvas();
  const G = gridFor(phone), { X, MX, C2 } = G, W = MX - X;
  // the question, in the display face, on the app's question baseline and within the same measure: one line
  const qs = fitSize(c, [slip.q], 500, SERIF, G.qs[1], W, 1);
  text(c, slip.q, X, G.q, `500 ${qs}px ${SERIF}`, '#16181D');
  const bs = bigSize(c, G);
  ls(c, -0.018 * bs);
  c.font = `650 ${bs}px ${SERIF}`;
  group(() => balance2(c, slip.a, W).forEach((l, i) => text(c, l, X, G.big[i], `650 ${bs}px ${SERIF}`, '#1E4A3A')));
  ls(c, 0);
  // what this sheet is, and when it was kept
  c.font = `500 ${G.st[1]}px ${SANS}`;
  const sts = fitSize(c, [slip.kept], 500, SANS, G.st[1], W - c.measureText(slip.no).width - 28, 1);
  text(c, slip.kept, X, G.st[0], `500 ${sts}px ${SANS}`, '#1E4A3A');
  text(c, slip.no, MX, G.st[0], `500 ${sts}px ${SANS}`, '#16181D', 'right');
  const [chy, chs] = G.ch;
  text(c, slip.ch[0], X, chy, `600 ${chs}px ${SANS}`, '#5E7A6B');
  text(c, slip.ch[1], C2, chy, `600 ${chs}px ${SANS}`, '#5E7A6B', 'right');
  text(c, slip.ch[2], MX, chy, `600 ${chs}px ${SANS}`, '#5E7A6B', 'right');
  const [ry, rh, fs] = G.r;
  const rows = slip.rows.concat([slip.tot]);
  rows.forEach((r, i) => {
    const top = ry + i * rh, tot = i === rows.length - 1;
    c.fillStyle = tot ? 'rgba(30,74,58,.70)' : 'rgba(30,74,58,.26)';
    c.fillRect(X, top, W, tot ? 1.3 : 0.9);
    const base = top + rh * 0.5 + fs * 0.36;
    text(c, r[0], X, base, `${tot ? 600 : 400} ${fs}px ${SANS}`, tot ? '#1E4A3A' : '#16181D');
    text(c, r[1], C2, base, `${tot ? 600 : 400} ${fs}px ${SANS}`, tot ? '#1E4A3A' : '#46604F', 'right');
    text(c, r[2], MX, base, `600 ${fs}px ${SANS}`, tot ? '#1E4A3A' : '#16181D', 'right');
  });
  return cv;
}
function drawApp(phone) {         // the grey top sheet: the invoicing app's page, printed on coated stock
  const { cv, c } = inkCanvas();
  const G = gridFor(phone), { X, MX, C2 } = G, W = MX - X;
  const [hs, hb, hr] = G.hd;
  text(c, 'Invoices', X, hb, `600 ${hs}px ${SANS}`, '#4A5057');
  c.fillStyle = '#B9BDC2'; c.fillRect(0, hr, PW, 1.1);
  // the search field: the question sits on the shared baseline at the left column edge; the glass sits at the right
  const [fy0, fy1] = G.f, qf = G.qs[0];
  c.strokeStyle = '#8F959B'; c.lineWidth = 1.3; c.beginPath();
  c.roundRect ? c.roundRect(X - 14, fy0, W + 28, fy1 - fy0, 3) : c.rect(X - 14, fy0, W + 28, fy1 - fy0); c.stroke();
  const q = 'Who owes us for more than 30 days?';
  text(c, q, X, G.q, `400 ${qf}px ${SANS}`, '#2F343A');
  c.fillStyle = '#2F343A';
  c.fillRect(X + c.measureText(q).width + 3, G.q - qf * 0.8, 1.2, qf * 1.05);   // the caret, still waiting
  const bs = bigSize(c, G);
  ls(c, -0.012 * bs);
  c.font = `600 ${bs}px ${SANS}`;
  group(() => balance2(c, 'Not responding since 08:12', W).forEach((l, i) => text(c, l, X, G.big[i], `600 ${bs}px ${SANS}`, '#C8321E')));
  ls(c, 0);
  text(c, 'Asked 08:14. No reply.', X, G.st[0], `400 ${G.st[1]}px ${SANS}`, '#41464C');
  const [chy, chs] = G.ch;
  text(c, 'Customer', X, chy, `600 ${chs}px ${SANS}`, '#6A7077');
  text(c, 'Overdue', C2, chy, `600 ${chs}px ${SANS}`, '#6A7077', 'right');
  text(c, 'Amount', MX, chy, `600 ${chs}px ${SANS}`, '#6A7077', 'right');
  const [ry, rh, fs] = G.r;
  // the names were on the page before it stopped answering; the figures never came
  ['Northgate Plumbing', 'Harbour Lane Bakery', 'Riverside Dental', 'Ashford Print Works', 'Total'].forEach((n, i) => {
    const top = ry + i * rh, tot = i === 4;
    c.fillStyle = tot ? '#A9AEB3' : '#C4C8CC'; c.fillRect(X, top, W, tot ? 1.2 : 0.9);
    const base = top + rh * 0.5 + fs * 0.36;
    text(c, n, X, base, `${tot ? 600 : 400} ${fs}px ${SANS}`, '#5A6067');
    if (i === 0) text(c, 'Figures not loaded', MX, base, `400 ${fs}px ${SANS}`, '#5A6067', 'right');
  });
  return cv;
}

// ---------------------------------------------------------------- state
let phone = false, view = null, inkCopy = null, inkApp = null, wordsCopy = null, wordsApp = null, need = true;
let paperTex, edgeTex, meshBoard, meshStack, meshGreen, meshFringe, meshBind, meshTop;
let maps = null;   // shadow map pyramid
const st = { focusNext: null, p: 0, drag: null, anim: null, aoff: 0, lastHole: -1, shiver: 0, frameMs: [], nudged: false, touched: false };

function pickLayout() {
  const f = Q.get('layout'); if (f) return f === 'phone';
  return !matchMedia('(min-width: 1024px)').matches;
}
function computeView() {
  const hr = hero.getBoundingClientRect(), br = box.getBoundingClientRect();
  const s = br.width / BOX[2];
  return { W: hr.width, H: hr.height, s, ox: br.left - hr.left - BOX[0] * s, oy: br.top - hr.top - BOX[1] * s };
}
function mkTarget(w, h) {
  const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { t, f };
}
function resize() {
  const np = pickLayout();
  if (np !== phone || !inkCopy) { phone = np; buildInk(); }
  view = computeView();
  const dpr = (POSTER || SHEET) ? 2 : Math.min(devicePixelRatio || 1, 2);
  view.dpr = dpr;
  canvas.width = Math.round(view.W * dpr); canvas.height = Math.round(view.H * dpr);
  const mk = Math.min(1, 1600 / Math.max(view.W, view.H));
  const mw = Math.max(4, Math.round(view.W * mk)), mh = Math.max(4, Math.round(view.H * mk));
  if (maps) for (const m of maps.list) { gl.deleteTexture(m.t); gl.deleteFramebuffer(m.f); }
  const list = [0, 1, 2, 3, 4, 5, 6].map(() => mkTarget(mw, mh));
  maps = { w: mw, h: mh, k: mk, list, S: list.slice(0, 6), tmp: list[6] };
  need = true;
}
function buildInk() {
  const slip = SLIPS[SHEET || 1];
  for (const t of [inkCopy, inkApp, wordsCopy, wordsApp]) if (t) gl.deleteTexture(t);
  WORDS = []; inkCopy = tex(drawCopy(phone, slip), true, gl.CLAMP_TO_EDGE); wordsCopy = wordMap(WORDS);
  WORDS = []; inkApp = tex(drawApp(phone), true, gl.CLAMP_TO_EDGE); wordsApp = wordMap(WORDS);
  WORDS = null;
}
function buildMeshes() {
  meshBoard = grid(BOX[0] - 0.5, BOX[0] + BOX[2] + 0.5, -57, BOT + 2, 2, 2);
  meshStack = grid(-4, PW + 5, -15, PH + 14, 2, 2);
  meshGreen = grid(-1, PW + 1, -15, PH + 1, 2, 2);
  meshFringe = grid(-1, PW + 1, -15, EB + 1, 300, 10);
  meshBind = grid(BOX[0] - 0.5, BOX[0] + BOX[2] + 0.5, -59, -17, 2, 24);
  meshTop = grid(-1, PW + 1, -EB - 0.6, PH + 1, 150, 300);
}

// ---------------------------------------------------------------- the tear, as a function of progress
// A sheet bound at the top. The fold line is set by its two ends: one runs along the bottom edge and then up the left
// edge, the other runs up the right edge, so the rolled part is always the paper below the fold.
// 0 to 0.30    the bottom-right corner curls up and over, loose at the corner and tighter toward the fold.
// 0.30 to 0.44 the hand draws the curl up the sheet; it turns until its axis lies along the binding and stays a loose roll.
// 0.44 to 0.48 the hand lifts the roll: the tab between the perforation and the roll strains and catches the light.
// 0.48 to 0.60 it tears along the perforation from the right, hanging on each bridge; the torn side rises first.
// 0.60 to 0.65 free, the sheet springs open and lifts toward the viewer: its printed face and its paler back both show.
// 0.65 to 0.84 it turns a little and drops out through the bottom of the frame; its shadow lifts off the pad and fades.
// 0.84 to 1    the green copy, after a small settle of the pad.
const PA = 0.30, PB = 0.60;          // PA: the copy shows; PB: past it, a released drag finishes by itself
const CS = 62;                       // where the roll stops: its fold line, units below the perforation
const T_ROLL = 0.44, T_TEN = 0.48, T_TORN = 0.60, T_OPEN = 0.65, T_GONE = 0.84;
function foldFrom(p1, p2) {          // fold normal (pointing at the rolled part), offset, and its span inside the sheet
  const dx = p2[0] - p1[0], dy = p2[1] - p1[1], n = Math.hypot(dx, dy) || 1;
  const nn = [-dy / n, dx / n];
  return { nn, c: nn[0] * p1[0] + nn[1] * p1[1] };
}
function chord(nn, c) {              // along-axis span of the line dot(q, nn) = c inside [0, PW] x [0, PH]
  const t = [-nn[1], nn[0]], o = [nn[0] * c, nn[1] * c];
  let lo = -1e5, hi = 1e5;
  for (const [i, mx] of [[0, PW], [1, PH]]) {
    if (Math.abs(t[i]) < 1e-6) continue;
    let a = (0 - o[i]) / t[i], b = (mx - o[i]) / t[i]; if (a > b) [a, b] = [b, a];
    lo = Math.max(lo, a); hi = Math.min(hi, b);
  }
  return hi > lo ? [lo, hi] : [-PW / 2, PW / 2];
}
const endL = d => d <= PW ? [PW - d, PH] : [0, PH - (d - PW)];   // along the bottom edge, then up the left edge
const endR = d => [PW, PH - d];
function spiralK(nn, c, R, f) {      // the spiral that ends its innermost turn at f times the outer radius
  let smax = 0;
  for (const q of [[0, 0], [PW, 0], [0, PH], [PW, PH]]) smax = Math.max(smax, q[0] * nn[0] + q[1] * nn[1] - c);
  const thEnd = 2 * smax / (R * (1 + f));
  return (1 - f) / Math.max(thEnd, 1e-3);
}
function tearParams(p, aoff = 0) {
  let dL, dR, R, k, cone = 0, tele = 0, uneven = 0, lift = 0, front = PW + 2;
  let pull = [0, 0, 0], fly = null, clipT = 1, clipG = 1, open = [1, 0, 0, 0];
  const dTop = PW + PH - CS, rTop = PH - CS;
  if (p <= PA) {
    const t = p / PA, e = 0.25 * t + 0.75 * ease(t);
    const d0 = phone ? 104 : 116;   // the resting corner: lifted clear, never over the last row
    dL = lerp(d0, 390, e); dR = lerp(d0, 300, e);
    R = lerp(22, 34, Math.pow(t, 0.7));
    k = lerp(-0.11, -0.05, t);                   // opens out toward the corner: wide and loose at the tip
    uneven = 0.02;
  } else {
    const t = clamp((p - PA) / (T_ROLL - PA)), e = ease(t);
    // the right end runs ahead early and the left end catches up, so the roll turns flat while it climbs
    dL = lerp(390, dTop, Math.pow(e, 0.85)); dR = lerp(300, rTop, Math.pow(e, 0.7));
    R = lerp(34, 40, e);
    cone = -0.12 * smooth(0, 0.6, t); tele = 0.2 * smooth(0.2, 1, t); uneven = lerp(0.02, 0.045, t);
  }
  let { nn, c } = foldFrom(endL(dL), endR(dR));
  if (aoff) {                                    // the drag direction turns the curl a little about its middle
    const m = [(endL(dL)[0] + endR(dR)[0]) / 2, (endL(dL)[1] + endR(dR)[1]) / 2];
    const a = Math.atan2(nn[1], nn[0]) + aoff * (1 - smooth(PA, T_ROLL, p));
    nn = [Math.cos(a), Math.sin(a)]; c = nn[0] * m[0] + nn[1] * m[1];
  }
  if (p > PA) k = lerp(-0.05, spiralK(nn, c, R, 0.62), smooth(PA, PA + 0.06, p));   // a loose roll: the inner turn at 0.62 of the outer
  if (p > T_ROLL) {
    lift = 2.6 * smooth(T_ROLL, T_TEN, p) * (1 - smooth(T_TORN - 0.02, T_TORN + 0.03, p));
    pull[0] = 16 * smooth(T_ROLL, T_TEN + 0.02, p);
    if (p >= T_TEN) {
      const t = clamp((p - T_TEN) / (T_TORN - T_TEN));
      let f = PW * (1 - (0.15 * t + 0.85 * ease(t)));
      const kk = f / PITCH, fr = kk - Math.floor(kk);
      f = (Math.floor(kk) + smooth(0.3, 0.8, fr)) * PITCH;   // it hangs on each bridge, then lets go
      front = t >= 1 ? -2 : f;
      pull[1] = 22 * smooth(0, 1, t); pull[2] = 7 * smooth(0, 0.25, t);
    }
  }
  if (p > T_TORN) {                               // free: it springs open as it lifts, then drops
    const t = clamp((p - T_TORN) / (T_OPEN - T_TORN)), e = ease(t);
    const cO = -EB - 2, RO = 380;
    open = [RO, spiralK(nn, cO, RO, 0.8), cO, smooth(0, 0.4, t)];
    uneven *= 1 - e; cone *= 1 - e; tele *= 1 - e;
    pull = [lerp(16, 64, e), lerp(22, 0, e), 7];
    clipT = 1 - smooth(0.32, 0.52, t); clipG = 1 - smooth(0, 0.35, t);
    const tf = clamp((p - T_OPEN) / (T_GONE - T_OPEN));
    const fall = Math.pow(tf, 1.7);
    fly = { pitch: -0.45 * e + 0.22 * smooth(0, 1, tf), yaw: 0.05 * e + 0.20 * fall, roll: 0.30 * smooth(0, 1, tf),
            t: [36 * fall, -12 * e + 1320 * fall, 40 * e + 70 * tf] };
  }
  const ext = R * (1 + Math.max(0, -k) * 1.8) + 8 + pull[0] * 0.5, over = p <= PA ? R * 0.9 : R * 1.05;
  const [tmin, tmax] = chord(nn, c);
  const a = Math.atan2(nn[1], nn[0]);
  // a tilted roll's round end would stand out past the sheet's edge: keep it inside by its radius times the tilt
  const tilt = Math.min(Math.abs(nn[0] / (nn[1] || 1e-6)), Math.abs(nn[1] / (nn[0] || 1e-6)));
  const inset = Math.min(R, R * tilt) * 1.1 * smooth(PA, PA + 0.04, p) * (1 - smooth(T_TORN, T_TORN + 0.02, p));
  return { inset, a, c, R, k, cone, tele, uneven, tmin, tmax, lift, front, pull, fly, clipT, clipG, ext, over, open, gone: p >= T_GONE };
}
function leafParams() {   // a torn-off leaf for the lower page: its bottom-right corner lifts a little, its torn top edge too
  const { nn, c } = foldFrom(endL(92), endR(92));
  const [tmin, tmax] = chord(nn, c);
  return { a: Math.atan2(nn[1], nn[0]), c, R: 30, k: -0.09, cone: 0, tele: 0, uneven: 0.02, tmin, tmax, lift: 0, front: -2,
           pull: [0, 0, 2.5], fly: null, clipT: 0, clipG: 0, ext: 0, over: 0, open: [1, 0, 0, 0], gone: false };
}
function flyMatrix(tp) {   // the free sheet: about its top edge, Rz(yaw) Ry(roll) Rx(pitch), then moved
  const { pitch: x, yaw: z, roll: y } = tp.fly;
  const cx = Math.cos(x), sx = Math.sin(x), cy = Math.cos(y), sy = Math.sin(y), cz = Math.cos(z), sz = Math.sin(z);
  // row-major M = Rz * Ry * Rx
  const M = [cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx,
             sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx,
             -sy, cy * sx, cy * cx];
  const colMajor = new Float32Array([M[0], M[3], M[6], M[1], M[4], M[7], M[2], M[5], M[8]]);
  return { m: colMajor, pivot: [PW / 2, -EB, Z_TOP + tp.pull[0]], trans: tp.fly.t };
}

// ---------------------------------------------------------------- drawing
function setView(g, pass) {
  gl.uniform4f(g.uView, view.ox, view.oy, view.s, CAM_D);
  gl.uniform2f(g.uCam, ...CAM); gl.uniform2f(g.uCanvas, view.W, view.H); gl.uniform2f(g.uShv, ...SHV);
  gl.uniform1i(g.uPass, pass);
}
function bindShadows(g) {
  for (let i = 0; i < 6; i++) { gl.activeTexture(gl.TEXTURE4 + i); gl.bindTexture(gl.TEXTURE_2D, maps.S[i].t); gl.uniform1i(g['uS' + i], 4 + i); }
}
function drawSheets(pass, P, tp) {
  const g = sheetProg.loc;
  gl.useProgram(sheetProg.p);
  setView(g, pass);
  gl.uniform3f(g.uL, ...L);
  gl.uniform4f(g.uPoolE, POOL.cx, POOL.cy, POOL.rx, POOL.ry);
  gl.uniform4f(g.uPoolS, POOL.stops[1][1], POOL.stops[2][1], POOL.stops[3][1], 0);
  gl.uniform3f(g.uPoolTint, ...POOL.tint);
  gl.uniform1f(g.uPoolOn, SHEET ? 0 : 1);
  gl.uniform1f(g.uShade, pass === 0 ? 1 : 0);
  gl.uniform4f(g.uFold, Math.cos(tp.a), Math.sin(tp.a), tp.c, tp.R); gl.uniform4f(g.uBend, tp.k, tp.cone, tp.tele, tp.uneven);
  gl.uniform4f(g.uChord, tp.tmin, tp.tmax, tp.lift, tp.inset || 0);
  gl.uniform4f(g.uPull, ...tp.pull, 0); gl.uniform4f(g.uOpen, ...tp.open);
  gl.uniform1f(g.uExt, tp.ext); gl.uniform1f(g.uOver, tp.over);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, paperTex); gl.uniform1i(g.uPaper, 0);
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, edgeTex); gl.uniform1i(g.uEdge, 1);
  if (pass === 0) bindShadows(g);
  else for (let i = 0; i < 6; i++) { gl.activeTexture(gl.TEXTURE4 + i); gl.bindTexture(gl.TEXTURE_2D, null); }
  const ts = clamp((P - (T_GONE - 0.05)) / 0.12);   // once the sheet is gone the pad settles: a unit down and back
  const settle = 1.1 * Math.sin(Math.PI * ts) * (1 - ts);
  const sv = st.shiver * Math.sin(performance.now() * 0.09) * 0.4;
  const off = [sv * 0.5, settle + sv];
  gl.uniform1f(g.uFly, 0); gl.uniform1f(g.uFresh, 0); gl.uniform1f(g.uTornTop, 0); gl.uniform1f(g.uFront, 1e5);
  gl.uniform1f(g.uLift, 1);
  const draw = (mesh, kind, z, rect, tint, back, opt = {}) => {
    gl.uniform1i(g.uKind, kind); gl.uniform1f(g.uZ, z);
    gl.uniform2f(g.uOff, ...(opt.off || off));
    gl.uniform4f(g.uRect, ...rect);
    gl.uniform3f(g.uTint, ...tint); gl.uniform3f(g.uTintBack, ...(back || tint));
    gl.uniform2f(g.uTexOff, ...(opt.texOff || [0, 0])); gl.uniform1f(g.uTexK, opt.texK || 1);
    gl.uniform1f(g.uRelief, opt.relief ?? 0.5); gl.uniform1f(g.uAlb, opt.alb ?? 0.06);
    gl.uniform1f(g.uInkOn, opt.ink ? 1 : 0);
    if (opt.ink) { gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, opt.ink); gl.uniform1i(g.uInk, 2); }
    gl.uniform2f(g.uClip, ...(opt.clip || [0, 0]));
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, opt.words || wordsCopy); gl.uniform1i(g.uWords, 3);
    gl.uniform1f(g.uLift, opt.lift ?? 1); gl.uniform1f(g.uMat, opt.mat ?? 0); gl.uniform1f(g.uFade, opt.fade ?? 0);
    gl.bindVertexArray(mesh.vao); gl.drawElements(gl.TRIANGLES, mesh.n, gl.UNSIGNED_SHORT, 0);
  };
  const KEPT = [0.862, 0.914, 0.874], GREY = [0.80, 0.812, 0.826], GREY_B = [0.855, 0.86, 0.868];
  const COPY = { relief: 0.13, alb: 0.045, texK: 0.6, mat: 0 };               // uncoated carbonless copy paper
  const APP = { relief: 0.05, alb: 0.012, texK: 1.5, mat: 1, texOff: [0.37, 0.61] };   // the app's coated sheet
  if (SHEET) {   // a lone kept copy for the lower page: torn off the book along its top perforation, its corner a little curled
    gl.uniform1f(g.uFront, -2);
    gl.uniformMatrix3fv(g.uRot, false, new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]));
    draw(meshTop, 5, 1.2, [0, PW, -EB - 0.5, PH], KEPT, [0.90, 0.935, 0.905], { ...COPY, ink: inkCopy, off: [0, 0], texOff: [0.21 * SHEET, 0.37 * SHEET] });
    gl.bindVertexArray(null); return;
  }
  // the back board, then the earlier sheets of the book (grey originals and green copies, alternating), each a touch off square
  draw(meshBoard, 0, Z_BOARD, [BOX[0], BOX[0] + BOX[2], -57, BOT], [0.47, 0.455, 0.43], null, { relief: 0.9, alb: 0.14, texOff: [0.5, 0.2], lift: 1 });
  // each lower sheet shows a little more at the bottom and the right, so the pad has thickness: five offset edges
  const jit = [[-0.4, 12.4, -1.1, 3.4], [0.3, 9.7, -0.3, 2.8], [-0.2, 7.2, -0.8, 1.9], [0.4, 4.8, 0.1, 1.3], [-0.1, 2.4, -0.4, 0.6]];
  for (let i = 0; i < N_STACK; i++) {
    const [dx, dy, l, r] = jit[i];
    const greenSheet = (N_STACK - 1 - i) % 2 === 1;
    const tint = greenSheet ? KEPT : GREY;
    draw(meshStack, 1, Z_BOARD + Z_GAP * (i + 1), [l, PW + r, -15, PH + dy], tint, tint,
         { ...(greenSheet ? COPY : APP), off: [off[0] + dx * 0.3, off[1]], texOff: [0.13 * i, 0.29 * i], lift: 0.84 + 0.03 * i });
  }
  // the kept copy: while the top sheet is lifting, a word shows only once it is wholly clear of the roll
  draw(meshGreen, 2, Z_GREEN, [0, PW, -15, PH], KEPT, KEPT, { ...COPY, ink: inkCopy, words: wordsCopy, clip: [0, tp.clipG] });
  // the top sheet's stub under the binding: it stays when the sheet goes
  gl.uniform1f(g.uFront, tp.front); gl.uniform1f(g.uFresh, 0.6);
  draw(meshFringe, 3, Z_TOP, [0, PW, -15, EB + 0.5], GREY, GREY_B, { ...APP });
  // the top sheet (the app's page), then the binding cloth, depth-tested together: the sheet is always under the binding
  // unless it has been lifted clear above it
  if (tp.fly) {
    const fm = flyMatrix(tp);
    gl.uniform1f(g.uFly, 1); gl.uniformMatrix3fv(g.uRot, false, fm.m); gl.uniform3f(g.uPivot, ...fm.pivot); gl.uniform3f(g.uTrans, ...fm.trans);
  } else { gl.uniform1f(g.uFly, 0); gl.uniformMatrix3fv(g.uRot, false, new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1])); }
  if (pass === 0) { gl.enable(gl.DEPTH_TEST); gl.clear(gl.DEPTH_BUFFER_BIT); }
  if (!tp.gone) draw(meshTop, 5, Z_TOP, [0, PW, -EB - 0.5, PH], GREY, GREY_B, { ...APP, ink: inkApp, words: wordsApp, clip: [tp.clipT, 0], off: tp.fly ? [0, 0] : off });
  gl.uniform1f(g.uFly, 0);
  draw(meshBind, 4, Z_BIND, [BOX[0], BOX[0] + BOX[2], -58, -18], [0.155, 0.205, 0.183], null, { relief: 0.9, alb: 0.16, texOff: [0.5, 0.1], texK: 1.3, off: [off[0] * 0.5, off[1]] });
  gl.disable(gl.DEPTH_TEST);
  gl.bindVertexArray(null);
}

function blurPass(src, dst, dir, sig) {
  const g = blurProg.loc;
  gl.bindFramebuffer(gl.FRAMEBUFFER, dst.f); gl.viewport(0, 0, maps.w, maps.h);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, src.t); gl.uniform1i(g.uT, 0);
  gl.uniform2f(g.uDir, ...dir); gl.uniform2f(g.uSize, maps.w, maps.h); gl.uniform1f(g.uSig, sig);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}
function frame(P) {
  const tp = SHEET ? leafParams() : tearParams(P, st.aoff);
  // 1. the shadow map: every caster flattened onto the ground along the light (css px of the canvas)
  gl.bindFramebuffer(gl.FRAMEBUFFER, maps.S[0].f);
  gl.viewport(0, 0, maps.w, maps.h);
  gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
  gl.enable(gl.BLEND); gl.blendEquation(gl.MAX); gl.blendFunc(gl.ONE, gl.ONE);
  drawSheets(1, P, tp);
  // 2. the penumbra pyramid: each level a gaussian of the one before (sigma 0.8, 2.5, 7, 18 css px)
  gl.disable(gl.BLEND);
  gl.useProgram(blurProg.p); gl.bindVertexArray(quadVao);
  const sig = [0.8, 2.5, 7, 18, 44]; let prev = 0;
  for (let i = 1; i <= 5; i++) {
    const inc = Math.sqrt(sig[i - 1] ** 2 - prev ** 2) * maps.k; prev = sig[i - 1];
    blurPass(maps.S[i - 1], maps.tmp, [1, 0], inc); blurPass(maps.tmp, maps.S[i], [0, 1], inc);
  }
  // 3. the ground: shadows and occlusion only (the light pool is the page's CSS)
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.enable(gl.BLEND); gl.blendEquation(gl.FUNC_ADD); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.useProgram(groundProg.p);
  const g = groundProg.loc;
  gl.uniform2f(g.uCanvas, view.W, view.H); gl.uniform1f(g.uDpr, view.dpr); gl.uniform1f(g.uDith, (POSTER || SHEET) ? 0 : 1); gl.uniform1f(g.uK, view.s);
  bindShadows(g);
  gl.bindVertexArray(quadVao); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  // 4. the paper
  drawSheets(0, P, tp);
  return tp;
}

// ---------------------------------------------------------------- control: scroll scrubs while the hero is pinned, the hand pulls the corner
const pinned = () => doc.classList.contains('gl') && pin.offsetHeight > innerHeight + 10;
const SPAN = 0.86;
function scrollP() {
  if (!pinned()) return 0;
  const top = pin.getBoundingClientRect().top;
  return clamp(-top / Math.max(1, (pin.offsetHeight - innerHeight) * SPAN));
}
const scrollFor = (p) => pin.offsetTop + (pin.offsetHeight - innerHeight) * SPAN * p;
function tweenScroll(to, ms) {
  const from = scrollY, t0 = performance.now();
  const stepFn = (now) => { const t = clamp((now - t0) / ms); const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    window.scrollTo(0, from + (to - from) * e); if (t < 1 && !st.drag) requestAnimationFrame(stepFn); };
  requestAnimationFrame(stepFn);
}
function runTo(to, ms, then) { st.anim = { from: st.p, to, t0: performance.now(), ms, then }; }

function setLabel(torn) {   // before: the tear; after: the one real next step, and a quiet way back
  tearBtn.hidden = torn; after.hidden = !torn;
  if (st.focusNext && !st.focusNext.closest('[hidden]')) { st.focusNext.focus({ preventScroll: true }); st.focusNext = null; }
}
tearBtn.addEventListener('click', (e) => {
  e.preventDefault(); st.touched = true; st.focusNext = askBtn;
  if (pinned()) tweenScroll(scrollFor(1) + 2, 1900); else runTo(1, 1900);
});
undo.addEventListener('click', (e) => {
  e.preventDefault(); st.touched = true; st.focusNext = tearBtn;
  if (pinned()) tweenScroll(pin.offsetTop, 1100); else runTo(0, 900);
});

handle.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  st.drag = { x: e.clientX, y: e.clientY, p0: st.p, id: e.pointerId };
  st.anim = null; st.touched = true;
  handle.setPointerCapture(e.pointerId);
  handle.classList.add('held');
});
handle.addEventListener('pointermove', (e) => {
  const dr = st.drag; if (!dr || e.pointerId !== dr.id) return;
  const dx = (e.clientX - dr.x) / view.s, dy = (e.clientY - dr.y) / view.s;
  const px = -0.52, py = -0.85;                       // the hand pulls the corner up and to the left
  const along = dx * px + dy * py, across = -dx * py + dy * px;
  st.p = clamp(dr.p0 + along / 720, 0, 0.63);   // the hand can tear it through; once it is free it falls by itself
  st.aoff = clamp(Math.atan2(across, Math.max(60, Math.abs(along))) * 0.5, -0.24, 0.24);   // the drag direction turns the curl
  need = true;
});
const release = (e) => {
  const dr = st.drag; if (!dr || (e && e.pointerId !== dr.id)) return;
  st.drag = null; handle.classList.remove('held');
  if (st.p >= PB) runTo(1, (1 - st.p) * 1700 + 250, () => { if (pinned()) window.scrollTo(0, scrollFor(1) + 2); });   // past 60%: it finishes by itself
  else runTo(scrollP(), 420 + st.p * 500);                                                                    // before: it springs back
};
handle.addEventListener('pointerup', release);
handle.addEventListener('pointercancel', release);

// ---------------------------------------------------------------- loop
let last = performance.now(), live = false, onScreen = true;
new IntersectionObserver(es => { onScreen = es[0].isIntersecting; if (onScreen) need = true; }).observe(hero);
addEventListener('resize', () => { resize(); });
addEventListener('scroll', () => { need = true; }, { passive: true });

function tick(now) {
  const dt = Math.min(64, now - last); last = now;
  if (FIXED !== null) st.p = FIXED;
  else if (st.anim) {
    const a = st.anim, t = clamp((now - a.t0) / a.ms);
    const e = a.curve ? a.curve(t) : (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
    st.p = a.curve ? e : a.from + (a.to - a.from) * e; st.aoff *= 0.92; need = true;
    if (t >= 1) { st.anim = null; if (a.then) a.then(); }
  } else if (!st.drag) {
    const tgt = pinned() ? scrollP() : st.p;
    const k = 1 - Math.exp(-dt / 60);
    const np = Math.abs(tgt - st.p) < 0.0005 ? tgt : st.p + (tgt - st.p) * k;
    if (np !== st.p) { st.p = np; need = true; }
    st.aoff *= 0.9;
  }
  const tp = tearParams(st.p), hole = Math.floor(tp.front / PITCH);
  if (st.lastHole >= 0 && hole !== st.lastHole && FIXED === null && !tp.fly && tp.front > 0) st.shiver = Math.min(0.6, st.shiver + 0.25);
  st.lastHole = hole;
  if (st.shiver > 0.001) { st.shiver *= Math.exp(-dt / 60); need = true; } else st.shiver = 0;
  if (need && onScreen && view) {
    const t0 = performance.now();
    const ftp = frame(st.p);
    hero.classList.toggle('flying', !!ftp.fly && !ftp.gone);   // the falling sheet passes in front of the words
    st.frameMs.push(performance.now() - t0); if (st.frameMs.length > 600) st.frameMs.shift();
    need = false;
    hint.style.opacity = String(1 - smooth(0.08, 0.16, st.p));
    handle.style.display = st.p > PB ? 'none' : '';
    setLabel(st.p > PA);
    doc.classList.toggle('is-torn', st.p > PA);
    if (!live) { live = true; doc.classList.add('live'); window.__klive = true; scheduleNudge(); }
  }
  window.__kp = st.p;
  requestAnimationFrame(tick);
}
function scheduleNudge() {   // one small lift of the corner after load, so it reads as something to pull
  if (FIXED !== null || POSTER || SHEET || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  setTimeout(() => {
    if (st.touched || st.drag || st.anim || st.p > 0.001 || scrollP() > 0.001) return;
    st.anim = { t0: performance.now(), ms: 1300, curve: t => 0.07 * Math.pow(Math.sin(Math.PI * t), 2) * (1 - 0.3 * t) };
  }, 1400);
}

// debug hooks for the frame-time check and the recorder
window.__ktime = () => st.frameMs.slice();
window.__kset = (p) => { FIXED = p; st.p = p; st.anim = null; st.shiver = 0; need = true; };
window.__kbox = () => { const r = box.getBoundingClientRect(), h = hero.getBoundingClientRect(); return { x: r.left - h.left, y: r.top - h.top, w: r.width, h: r.height, s: view.s }; };
window.__kcorner = () => [view.ox + PW * view.s, view.oy + PH * view.s];

(async () => {
  await Promise.all([document.fonts.load(`500 26px ${SERIF}`), document.fonts.load(`650 54px ${SERIF}`),
                     document.fonts.load(`400 16px ${SANS}`), document.fonts.load(`600 16px ${SANS}`)]).catch(() => {});
  const [pi, ei] = await Promise.all([loadImg('assets/gl/paper.webp'), loadEdge()]);
  paperTex = tex(pi, true, gl.REPEAT);
  edgeTex = tex(ei, false, gl.REPEAT);
  buildMeshes();
  if (POSTER || SHEET) doc.classList.add('poster-mode');
  resize();
  requestAnimationFrame(tick);
})().catch(err => { console.warn('Kepthold scene stays still:', err && err.message); doc.classList.remove('gl'); doc.classList.add('still'); });
