import * as THREE from "three/webgpu";

export function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function generateGemPoints(
  count: number,
  seed: number,
  topPole: number,
  bottomPole: number,
  equatorBias: number,
  equatorRadius: number,
  radialVariance: number,
  yJitter: number,
): THREE.Vector3[] {
  const rng = mulberry32(seed);
  const points: THREE.Vector3[] = [];

  points.push(new THREE.Vector3(0, topPole, 0));
  points.push(new THREE.Vector3(0, bottomPole, 0));

  for (let i = 0; i < count - 2; i++) {
    const theta = rng() * Math.PI * 2;
    const raw = rng() * 2 - 1;
    const y =
      Math.sign(raw) * Math.pow(Math.abs(raw), 1 / equatorBias) * 0.85 +
      (rng() - 0.5) * yJitter;
    const r =
      equatorRadius *
      (1 - Math.abs(y)) *
      (1 - radialVariance + rng() * radialVariance);
    points.push(new THREE.Vector3(Math.cos(theta) * r, y, Math.sin(theta) * r));
  }

  return points;
}
