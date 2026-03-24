import { Fn, vec3, float, floor, fract, mix, dot } from "three/tsl";
import { whiteNoiseTexture3D } from "./whitenoise.tsl";

// Derive a pseudo-random gradient vec3 at an integer lattice point.
// Three independent LUT lookups with spatial offsets give uncorrelated x/y/z components.
// whiteNoiseTexture3D returns [-0.5, 0.5] so no recentering needed.
const gradient = Fn(([p]: [any]) => {
  return vec3(
    whiteNoiseTexture3D(p),
    whiteNoiseTexture3D(p.add(vec3(31.3, 0.0, 0.0))),
    whiteNoiseTexture3D(p.add(vec3(0.0, 0.0, 47.9))),
  );
});

export const perlinNoise = Fn(([p]: [any]) => {
  const i = floor(p).toVar();
  const f = fract(p).toVar();

  // Quintic smoothstep: 6t^5 - 15t^4 + 10t^3
  const u = f.mul(f).mul(f).mul(f.mul(f.mul(float(6)).sub(float(15))).add(float(10)));

  const d000 = dot(gradient(i),                        f);
  const d100 = dot(gradient(i.add(vec3(1, 0, 0))),     f.sub(vec3(1, 0, 0)));
  const d010 = dot(gradient(i.add(vec3(0, 1, 0))),     f.sub(vec3(0, 1, 0)));
  const d110 = dot(gradient(i.add(vec3(1, 1, 0))),     f.sub(vec3(1, 1, 0)));
  const d001 = dot(gradient(i.add(vec3(0, 0, 1))),     f.sub(vec3(0, 0, 1)));
  const d101 = dot(gradient(i.add(vec3(1, 0, 1))),     f.sub(vec3(1, 0, 1)));
  const d011 = dot(gradient(i.add(vec3(0, 1, 1))),     f.sub(vec3(0, 1, 1)));
  const d111 = dot(gradient(i.add(vec3(1, 1, 1))),     f.sub(vec3(1, 1, 1)));

  return mix(
    mix(mix(d000, d100, u.x), mix(d010, d110, u.x), u.y),
    mix(mix(d001, d101, u.x), mix(d011, d111, u.x), u.y),
    u.z,
  ).mul(0.5).add(0.5);
});
