import {
  Fn,
  vec2,
  vec3,
  vec4,
  float,
  floor,
  abs,
  max,
  min,
  dot,
  step,
} from "three/tsl";

// Plain JS helpers — NOT TSL Fn nodes.
//
// TSL Fn substitutes the argument node into its body at call time. If the
// argument appears N times in the body, TSL may create N separate copies of
// the argument sub-graph (one per occurrence), so the visited-node cache
// sees them as different objects and re-traverses each one.
//
// Plain JS functions preserve JS object identity: the same node reference
// sits in every slot. TSL's cache (keyed by object identity) correctly
// deduplicates on the second encounter, keeping traversal O(graph_size).
//
// Callers must .toVar() any compound expression before passing it in,
// since these bodies reference their argument more than once.
const mod289 = (x: any): any =>
  x.sub(floor(x.mul(1.0 / 289.0)).mul(289.0));

const permute = (x: any): any =>
  mod289(x.mul(34.0).add(10.0).mul(x));

const taylorInvSqrt = (r: any): any =>
  float(1.79284291400159).sub(r.mul(0.85373472095314));

// 3D Simplex noise — ported from McEwan / Gustavson (Ashima Arts)
// Output remapped to [0, 1]
export const simplexNoise = Fn(([v]: [any]) => {
  const C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const D = vec4(0.0, 0.5, 1.0, 2.0);

  // First corner
  const i  = floor(vec3(v).add(dot(vec3(v), vec3(C.y, C.y, C.y)))).toVar() as any;
  const x0 = (vec3(v).sub(i).add(dot(i, vec3(C.x, C.x, C.x)))).toVar() as any;

  // Which simplex cell — derive two corner offsets without conditionals
  const g  = step(vec3(x0.y, x0.z, x0.x), x0).toVar() as any;
  const l  = (vec3(1.0).sub(g)).toVar() as any;
  const i1 = min(g, vec3(l.z, l.x, l.y)).toVar() as any;
  const i2 = max(g, vec3(l.z, l.x, l.y)).toVar() as any;

  const x1 = (x0.sub(i1).add(C.x)).toVar() as any;
  const x2 = (x0.sub(i2).add(C.y)).toVar() as any;
  const x3 = (x0.sub(0.5)).toVar() as any;

  // Permutations.
  // iMod is a VarNode leaf: mod289/permute each reference their argument
  // twice, so passing a VarNode means both sites share the same object and
  // the cache deduplicates them.
  const iMod  = mod289(i).toVar() as any;

  const zBase = vec4(iMod.z, iMod.z, iMod.z, iMod.z)
    .add(vec4(0.0, i1.z, i2.z, 1.0)).toVar();

  const perm0 = permute(zBase)
    .add(vec4(iMod.y, iMod.y, iMod.y, iMod.y))
    .add(vec4(0.0, i1.y, i2.y, 1.0))
    .toVar();

  const perm1 = permute(perm0)
    .add(vec4(iMod.x, iMod.x, iMod.x, iMod.x))
    .add(vec4(0.0, i1.x, i2.x, 1.0))
    .toVar();

  const p = permute(perm1).toVar() as any;

  // Gradients: 7x7 over a square mapped onto an octahedron
  const n_  = float(1.0 / 7.0);
  const ns  = vec3(n_.mul(D.w), n_.mul(D.y).sub(1.0), n_.mul(D.z)).toVar() as any;

  const j   = p.sub(float(49.0).mul(floor(p.mul(ns.z).mul(ns.z)))).toVar() as any;
  const x_  = floor(j.mul(ns.z)).toVar() as any;
  const y_  = floor(j.sub(float(7.0).mul(x_))).toVar() as any;
  const gx  = x_.mul(ns.x).add(ns.y).toVar() as any;
  const gy  = y_.mul(ns.x).add(ns.y).toVar() as any;
  const h   = float(1.0).sub(abs(gx)).sub(abs(gy)).toVar() as any;

  const b0  = vec4(gx.x, gx.y, gy.x, gy.y).toVar() as any;
  const b1  = vec4(gx.z, gx.w, gy.z, gy.w).toVar() as any;
  const s0  = floor(b0).mul(2.0).add(1.0).toVar() as any;
  const s1  = floor(b1).mul(2.0).add(1.0).toVar() as any;
  const sh  = step(h, vec4(0.0)).negate().toVar() as any;

  const a0  = vec4(b0.x, b0.z, b0.y, b0.w).add(
    vec4(s0.x, s0.z, s0.y, s0.w).mul(vec4(sh.x, sh.x, sh.y, sh.y)),
  ).toVar() as any;
  const a1  = vec4(b1.x, b1.z, b1.y, b1.w).add(
    vec4(s1.x, s1.z, s1.y, s1.w).mul(vec4(sh.z, sh.z, sh.w, sh.w)),
  ).toVar() as any;

  const p0  = vec3(a0.x, a0.y, h.x).toVar() as any;
  const p1  = vec3(a0.z, a0.w, h.y).toVar() as any;
  const p2  = vec3(a1.x, a1.y, h.z).toVar() as any;
  const p3  = vec3(a1.z, a1.w, h.w).toVar() as any;

  // Normalise gradients
  const norm = taylorInvSqrt(
    vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)),
  ).toVar() as any;
  const p0n = p0.mul(norm.x).toVar() as any;
  const p1n = p1.mul(norm.y).toVar() as any;
  const p2n = p2.mul(norm.z).toVar() as any;
  const p3n = p3.mul(norm.w).toVar() as any;

  // Mix contributions from four corners
  const m  = max(
    float(0.6).sub(vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3))),
    0.0,
  ).toVar() as any;
  const m2 = m.mul(m).toVar();

  return float(42.0)
    .mul(dot(m2.mul(m2), vec4(dot(p0n, x0), dot(p1n, x1), dot(p2n, x2), dot(p3n, x3))))
    .mul(0.5)
    .add(0.5);
});
