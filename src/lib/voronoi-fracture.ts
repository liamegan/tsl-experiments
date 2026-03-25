import * as THREE from "three/webgpu";
import { ConvexGeometry } from "three/addons/geometries/ConvexGeometry.js";
import { mulberry32 } from "/src/lib/gem-points";

// A half-space: all points where normal · x + d <= 0
interface HalfSpace {
  normal: THREE.Vector3;
  d: number;
}

function hsFromFace(normal: THREE.Vector3, pointOnFace: THREE.Vector3): HalfSpace {
  const n = normal.clone().normalize();
  return { normal: n, d: -n.dot(pointOnFace) };
}

function hsFromVoronoiPair(seedA: THREE.Vector3, seedB: THREE.Vector3): HalfSpace {
  // Plane bisecting A and B, facing away from A (toward B)
  const mid = seedA.clone().add(seedB).multiplyScalar(0.5);
  const n = seedB.clone().sub(seedA).normalize();
  return { normal: n, d: -n.dot(mid) };
}

// Intersection of three planes via Cramer's rule
function triPlaneIntersect(
  a: HalfSpace,
  b: HalfSpace,
  c: HalfSpace,
): THREE.Vector3 | null {
  const n0 = a.normal, n1 = b.normal, n2 = c.normal;
  const cross12 = new THREE.Vector3().crossVectors(n1, n2);
  const det = n0.dot(cross12);
  if (Math.abs(det) < 1e-10) return null;

  const cross20 = new THREE.Vector3().crossVectors(n2, n0);
  const cross01 = new THREE.Vector3().crossVectors(n0, n1);

  return new THREE.Vector3()
    .addScaledVector(cross12, -a.d)
    .addScaledVector(cross20, -b.d)
    .addScaledVector(cross01, -c.d)
    .divideScalar(det);
}

const EPS = 1e-5;

function inside(p: THREE.Vector3, hs: HalfSpace): boolean {
  return hs.normal.dot(p) + hs.d <= EPS;
}

// Enumerate vertices of the convex polytope defined by the given half-spaces.
// For each triple of planes, compute their intersection and keep it only if it
// satisfies every other half-space.
function polytypeVertices(halfSpaces: HalfSpace[]): THREE.Vector3[] {
  const vertices: THREE.Vector3[] = [];
  const n = halfSpaces.length;

  for (let i = 0; i < n - 2; i++) {
    for (let j = i + 1; j < n - 1; j++) {
      for (let k = j + 1; k < n; k++) {
        const v = triPlaneIntersect(halfSpaces[i], halfSpaces[j], halfSpaces[k]);
        if (!v) continue;

        let valid = true;
        for (let l = 0; l < n; l++) {
          if (l === i || l === j || l === k) continue;
          if (!inside(v, halfSpaces[l])) {
            valid = false;
            break;
          }
        }
        if (!valid) continue;

        // Deduplicate
        if (!vertices.some((u) => u.distanceTo(v) < 1e-5)) {
          vertices.push(v);
        }
      }
    }
  }

  return vertices;
}

// Extract unique planar faces from a ConvexGeometry as half-spaces.
// Each face: normal from geometry + a point on the face.
function gemHalfSpaces(geometry: THREE.BufferGeometry): HalfSpace[] {
  const posAttr = geometry.attributes.position as THREE.BufferAttribute;
  const normAttr = geometry.attributes.normal as THREE.BufferAttribute;
  const triCount = posAttr.count / 3;

  // Group by normal to get one half-space per planar face
  const seen = new Map<string, HalfSpace>();
  for (let t = 0; t < triCount; t++) {
    const i0 = t * 3;
    const nx = normAttr.getX(i0);
    const ny = normAttr.getY(i0);
    const nz = normAttr.getZ(i0);
    const key = `${nx.toFixed(4)},${ny.toFixed(4)},${nz.toFixed(4)}`;
    if (!seen.has(key)) {
      const n = new THREE.Vector3(nx, ny, nz).normalize();
      const p = new THREE.Vector3(
        posAttr.getX(i0),
        posAttr.getY(i0),
        posAttr.getZ(i0),
      );
      seen.set(key, hsFromFace(n, p));
    }
  }

  return [...seen.values()];
}

export interface VoronoiFragment {
  geometry: THREE.BufferGeometry;
  center: THREE.Vector3; // centroid of the Voronoi cell vertices
}

export interface VoronoiResult {
  fragments: VoronoiFragment[];
  seeds: THREE.Vector3[];
}

function generateSeeds(
  bb: THREE.Box3,
  count: number,
  rng: () => number,
): THREE.Vector3[] {
  return Array.from(
    { length: count },
    () =>
      new THREE.Vector3(
        bb.min.x + rng() * (bb.max.x - bb.min.x),
        bb.min.y + rng() * (bb.max.y - bb.min.y),
        bb.min.z + rng() * (bb.max.z - bb.min.z),
      ),
  );
}

export function voronoiFracture(
  gemGeometry: THREE.BufferGeometry,
  numFragments: number,
  seed: number,
): VoronoiResult {
  const rng = mulberry32(seed);

  gemGeometry.computeBoundingBox();
  const bb = gemGeometry.boundingBox!;
  const seeds = generateSeeds(bb, numFragments, rng);

  const gemHS = gemHalfSpaces(gemGeometry);
  const fragments: VoronoiFragment[] = [];

  for (let si = 0; si < seeds.length; si++) {
    // Half-spaces: gem faces + Voronoi bisectors for every other seed
    const halfSpaces: HalfSpace[] = [...gemHS];
    for (let sj = 0; sj < seeds.length; sj++) {
      if (sj !== si) halfSpaces.push(hsFromVoronoiPair(seeds[si], seeds[sj]));
    }

    const verts = polytypeVertices(halfSpaces);

    // Need at least 4 non-coplanar points for a 3D convex hull
    if (verts.length < 4) continue;

    let geometry: THREE.BufferGeometry;
    try {
      geometry = new ConvexGeometry(verts);
    } catch {
      continue;
    }

    const center = new THREE.Vector3();
    for (const v of verts) center.add(v);
    center.divideScalar(verts.length);

    fragments.push({ geometry, center });
  }

  return { fragments, seeds };
}
