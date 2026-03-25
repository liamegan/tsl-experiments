import * as THREE from "three/webgpu";
import {
  Fn,
  uniform,
  uniformArray,
  vec4,
  vec3,
  vec2,
  float,
  normalView,
  positionWorld,
  cameraPosition,
  abs,
  sin,
  fract,
  atan,
  time,
  smoothstep,
  Loop,
} from "three/tsl";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { ConvexGeometry } from "three/addons/geometries/ConvexGeometry.js";

import { Pane } from "tweakpane";

import { simplexNoise } from "/src/lib/simplexnoise.tsl";
import { makeFBM } from "/src/lib/fbm.tsl";

console.clear();

const simplexFBM = makeFBM(simplexNoise, {
  octaves: 2,
  lacunarity: 1.0,
  gain: 0.8,
});
const patternFBM = Fn(([v]: [any]) => {
  const a = vec3(simplexFBM(v), simplexFBM(v.add(10)), v.z);
  const b = vec3(
    simplexFBM(v.add(a.mul(2).add(1))),
    simplexFBM(v.add(a.mul(2).sub(20))),
    v.z,
  );
  return simplexFBM(v.add(b.mul(2).add(1)));
});

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(
  75,
  window.innerWidth / window.innerHeight,
  0.1,
  10,
);
camera.position.z = 2;

const renderer = new THREE.WebGPURenderer({
  canvas: document.querySelector("#webgpu-canvas")!,
  antialias: true,
});
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setAnimationLoop(animate);

window.addEventListener("resize", function () {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

// PRNG
function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function generateGemPoints(
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

// Extract one plane per unique face of a ConvexGeometry as { normal, d } pairs
// where the plane equation is: dot(normal, x) + d = 0
// Points satisfying dot(normal, x) + d <= 0 are on the interior side.
function extractFacePlanes(geometry: THREE.BufferGeometry): {
  normals: THREE.Vector3[];
  ds: number[];
} {
  const posAttr = geometry.attributes.position as THREE.BufferAttribute;
  const normAttr = geometry.attributes.normal as THREE.BufferAttribute;
  const triCount = posAttr.count / 3;

  // ConvexGeometry gives the same normal to every vertex on a planar face,
  // so grouping by normal key deduplicates to one entry per face.
  const seen = new Map<string, { normal: THREE.Vector3; d: number }>();
  for (let t = 0; t < triCount; t++) {
    const i0 = t * 3;
    const nx = normAttr.getX(i0),
      ny = normAttr.getY(i0),
      nz = normAttr.getZ(i0);
    const key = `${nx.toFixed(4)},${ny.toFixed(4)},${nz.toFixed(4)}`;
    if (!seen.has(key)) {
      const n = new THREE.Vector3(nx, ny, nz).normalize();
      const p = new THREE.Vector3(
        posAttr.getX(i0),
        posAttr.getY(i0),
        posAttr.getZ(i0),
      );
      // d = -dot(n, p)  so that dot(n, p) + d = 0 on the face plane
      seen.set(key, { normal: n, d: -n.dot(p) });
    }
  }

  const planes = [...seen.values()];
  return { normals: planes.map((p) => p.normal), ds: planes.map((p) => p.d) };
}

const options = {
  seed: 3695,
  points: 128,
  topPole: 0.83,
  bottomPole: -1.3,
  equatorBias: 1.15,
  equatorRadius: 0.7,
  radialVariance: 0,
  yJitter: 1,
  // Exterior
  hueSpeed: 0.1,
  fresnelPower: 2.0,
  specPower: 256.0,
  noiseScale: 4,
  noiseStrength: 0.08,
  // Interior
  interiorSteps: 16,
  interiorStepSize: 0.03,
  interiorNoiseScale: 0.6,
  interiorBrightness: 1.5,
  interiorFalloffRadius: 0.6,
  interiorFalloffPower: 1,
};

// --- Exterior uniforms ---
const noiseScaleUniform = uniform(options.noiseScale);
const noiseStrengthUniform = uniform(options.noiseStrength);
const hueSpeedUniform = uniform(options.hueSpeed);
const fresnelPowerUniform = uniform(options.fresnelPower);
const specPowerUniform = uniform(options.specPower);

// --- Interior uniforms ---
const interiorStepsUniform = uniform(options.interiorSteps);
const interiorStepSizeUniform = uniform(options.interiorStepSize);
const interiorNoiseScaleUniform = uniform(options.interiorNoiseScale);
const interiorBrightnessUniform = uniform(options.interiorBrightness);
const interiorFalloffRadiusUniform = uniform(options.interiorFalloffRadius);
const interiorFalloffPowerUniform = uniform(options.interiorFalloffPower);

// --- Exterior material (front faces, matcap) ---
const exteriorMat = new THREE.MeshBasicMaterial({ side: THREE.FrontSide });

exteriorMat.normalNode = Fn(() => {
  const n = normalView.toVar();
  const noise = simplexFBM(positionWorld.mul(noiseScaleUniform));
  n.addAssign(
    vec3(noise).mul(noiseStrengthUniform).sub(noiseStrengthUniform.mul(0.5)),
  );
  return vec4(n, 1);
})();

exteriorMat.colorNode = Fn(() => {
  const n = normalView.normalize().toVar();
  const nt = time.mul(hueSpeedUniform);
  const noise = simplexFBM(positionWorld.mul(noiseScaleUniform).add(nt));

  const angle = atan(n.y, n.x);
  const hue = fract(
    angle
      .div(Math.PI * 2)
      .add(noise.mul(noiseStrengthUniform))
      .add(0.5)
      .add(nt),
  );

  const tau = Math.PI * 2;
  const rainbow = vec3(
    sin(hue.mul(tau)).mul(0.5).add(0.5),
    sin(hue.mul(tau).add(2.094)).mul(0.5).add(0.5),
    sin(hue.mul(tau).add(4.189)).mul(0.5).add(0.5),
  );

  const nz = n.z.clamp(0, 1);
  const fresnel = nz.oneMinus().pow(fresnelPowerUniform);
  const spec = nz.pow(specPowerUniform);

  return vec4(rainbow.mul(fresnel).add(spec), 1);
})();

// --- Interior material (back faces, additive raymarch) ---
const interiorMat = new THREE.MeshBasicMaterial({
  side: THREE.BackSide,
  transparent: true,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
  depthTest: false,
});

// Build the interior colorNode using the face planes of the current gem geometry.
//
// The core idea is the convex hull SDF:
//   For a convex polyhedron defined by N face planes, the signed distance from
//   any point p to the surface is:
//
//     SDF(p) = max over all faces i of ( dot(normal_i, p) + d_i )
//
//   Each term is the signed distance to a single plane:
//     - negative means p is on the interior side of that face
//     - positive means p has crossed outside that face
//
//   The max over all faces gives the "least inside" measurement:
//     - SDF < 0  → p is inside the gem (every plane test is negative)
//     - SDF = 0  → p is exactly on the surface
//     - SDF > 0  → p is outside the gem (at least one face is violated)
//
//   For interior points, -SDF is the distance to the nearest face.
//   This is exact at face centres and a lower bound near edges/corners.
//
// faceCount is a JS constant baked into the shader loop; changing it
// requires a new colorNode and triggers shader recompilation.
function buildInteriorColorNode(
  faceNormals: ReturnType<typeof uniformArray>,
  faceDs: ReturnType<typeof uniformArray>,
  faceCount: number,
) {
  return Fn(() => {
    // Ray origin = back-face world position; direction = toward camera
    const ro = positionWorld.toVar();
    const rd = cameraPosition.sub(positionWorld).normalize().toVar();

    const accumulated = vec3(0).toVar();
    const t = float(0).toVar();

    Loop({ start: 0, end: interiorStepsUniform }, () => {
      const pos = ro.add(rd.mul(t));
      const nt = time.mul(hueSpeedUniform);

      // --- Convex hull SDF ---
      // Start at -infinity so the first face distance always wins
      const sdf = float(-1e6).toVar();
      Loop(faceCount, ({ i }) => {
        // Signed distance from pos to face i's plane:
        //   dot(normal_i, pos) + d_i
        // Negative = inside this half-space, positive = outside
        const faceDist = (faceNormals.element(i) as any)
          .dot(pos)
          .add(faceDs.element(i));
        // The SDF is the maximum across all faces — the one closest to violating
        sdf.assign(sdf.max(faceDist));
      });
      // sdf is now negative (inside gem). -sdf = distance to nearest face.
      // smoothstep maps 0 (surface) → 0 and falloffRadius (deep interior) → 1
      const falloff = smoothstep(
        float(0),
        interiorFalloffRadiusUniform,
        sdf.negate(),
      ).pow(interiorFalloffPowerUniform);

      // Density: FBM noise shaped by the surface-distance falloff
      const n = patternFBM(pos.mul(interiorNoiseScaleUniform))
        .pow(4)
        .mul(2)
        .toVar();

      const hue = fract(
        n
          .div(Math.PI * 2)
          .add(pos.y.mul(0.3))
          .add(0.5)
          .add(nt),
      );
      const tau = Math.PI * 2;
      const col = vec3(
        sin(hue.mul(tau)).mul(0.5).add(0.5),
        sin(hue.mul(tau).add(2.094)).mul(0.5).add(0.5),
        sin(hue.mul(tau).add(4.189)).mul(0.5).add(0.5),
      );

      accumulated.addAssign(
        col
          .mul(n.mul(interiorStepSizeUniform).mul(interiorBrightnessUniform))
          .mul(falloff),
      );
      t.addAssign(interiorStepSizeUniform);
    });

    return vec4(accumulated, 1);
  })();
}

// --- Geometry & meshes ---
let exteriorMesh: THREE.Mesh | null = null;
let interiorMesh: THREE.Mesh | null = null;

function buildGem() {
  const pts = generateGemPoints(
    options.points,
    options.seed,
    options.topPole,
    options.bottomPole,
    options.equatorBias,
    options.equatorRadius,
    options.radialVariance,
    options.yJitter,
  );
  const geometry = new ConvexGeometry(pts);

  // Extract face planes and rebuild the interior shader.
  // Face count may differ each rebuild, which bakes a new loop bound into the
  // WGSL and forces a recompile — acceptable given the visual accuracy payoff.
  const { normals, ds } = extractFacePlanes(geometry);
  const faceNormals = uniformArray(normals, "vec3");
  const faceDs = uniformArray(ds, "float");
  interiorMat.colorNode = buildInteriorColorNode(
    faceNormals,
    faceDs,
    normals.length,
  );
  interiorMat.needsUpdate = true;

  if (exteriorMesh) {
    exteriorMesh.geometry.dispose();
    exteriorMesh.geometry = geometry;
    interiorMesh!.geometry = geometry;
  } else {
    exteriorMesh = new THREE.Mesh(geometry, exteriorMat);
    interiorMesh = new THREE.Mesh(geometry, interiorMat);
    // Interior renders after exterior so additive glow composites on top
    exteriorMesh.renderOrder = 0;
    interiorMesh.renderOrder = 1;
    scene.add(interiorMesh, exteriorMesh);
  }
}

buildGem();

// --- Tweakpane ---
const pane = new Pane();

const shapeFolder = pane.addFolder({ title: "Shape" });
shapeFolder
  .addBinding(options, "points", { label: "Points", min: 6, max: 128, step: 1 })
  .on("change", () => buildGem());
shapeFolder
  .addBinding(options, "seed", { label: "Seed", min: 0, max: 9999, step: 1 })
  .on("change", () => buildGem());
shapeFolder
  .addBinding(options, "topPole", {
    label: "Top Pole",
    min: 0,
    max: 2,
    step: 0.01,
  })
  .on("change", () => buildGem());
shapeFolder
  .addBinding(options, "bottomPole", {
    label: "Bottom Pole",
    min: -2,
    max: 0,
    step: 0.01,
  })
  .on("change", () => buildGem());
shapeFolder
  .addBinding(options, "equatorBias", {
    label: "Equator Bias",
    min: 0.1,
    max: 5,
    step: 0.05,
  })
  .on("change", () => buildGem());
shapeFolder
  .addBinding(options, "equatorRadius", {
    label: "Equator Radius",
    min: 0.1,
    max: 2,
    step: 0.01,
  })
  .on("change", () => buildGem());
shapeFolder
  .addBinding(options, "radialVariance", {
    label: "Radial Variance",
    min: 0,
    max: 1,
    step: 0.01,
  })
  .on("change", () => buildGem());
shapeFolder
  .addBinding(options, "yJitter", {
    label: "Y Jitter",
    min: 0,
    max: 1,
    step: 0.01,
  })
  .on("change", () => buildGem());
shapeFolder.expanded = false;

const exteriorFolder = pane.addFolder({ title: "Exterior" });
exteriorFolder
  .addBinding(options, "hueSpeed", {
    label: "Hue Speed",
    min: -1,
    max: 1,
    step: 0.01,
  })
  .on("change", (v: any) => {
    hueSpeedUniform.value = v.value;
  });
exteriorFolder
  .addBinding(options, "fresnelPower", {
    label: "Fresnel Power",
    min: 0.5,
    max: 8,
    step: 0.1,
  })
  .on("change", (v: any) => {
    fresnelPowerUniform.value = v.value;
  });
exteriorFolder
  .addBinding(options, "specPower", {
    label: "Spec Power",
    min: 1,
    max: 256,
    step: 1,
  })
  .on("change", (v: any) => {
    specPowerUniform.value = v.value;
  });
exteriorFolder
  .addBinding(options, "noiseScale", {
    label: "Noise Scale",
    min: 0.1,
    max: 20,
    step: 0.1,
  })
  .on("change", (v: any) => {
    noiseScaleUniform.value = v.value;
  });
exteriorFolder
  .addBinding(options, "noiseStrength", {
    label: "Noise Strength",
    min: 0,
    max: 0.5,
    step: 0.01,
  })
  .on("change", (v: any) => {
    noiseStrengthUniform.value = v.value;
  });
exteriorFolder.expanded = false;

const interiorFolder = pane.addFolder({ title: "Interior" });
interiorFolder
  .addBinding(options, "interiorSteps", {
    label: "Steps",
    min: 4,
    max: 128,
    step: 1,
  })
  .on("change", (v: any) => {
    interiorStepsUniform.value = v.value;
  });
interiorFolder
  .addBinding(options, "interiorStepSize", {
    label: "Step Size",
    min: 0.01,
    max: 0.2,
    step: 0.005,
  })
  .on("change", (v: any) => {
    interiorStepSizeUniform.value = v.value;
  });
interiorFolder
  .addBinding(options, "interiorNoiseScale", {
    label: "Noise Scale",
    min: 0.5,
    max: 10,
    step: 0.1,
  })
  .on("change", (v: any) => {
    interiorNoiseScaleUniform.value = v.value;
  });
interiorFolder
  .addBinding(options, "interiorBrightness", {
    label: "Brightness",
    min: 0,
    max: 5,
    step: 0.05,
  })
  .on("change", (v: any) => {
    interiorBrightnessUniform.value = v.value;
  });
interiorFolder
  .addBinding(options, "interiorFalloffRadius", {
    label: "Falloff Radius",
    min: 0.1,
    max: 2.0,
    step: 0.01,
  })
  .on("change", (v: any) => {
    interiorFalloffRadiusUniform.value = v.value;
  });
interiorFolder
  .addBinding(options, "interiorFalloffPower", {
    label: "Falloff Power",
    min: 0.1,
    max: 6.0,
    step: 0.01,
  })
  .on("change", (v: any) => {
    interiorFalloffPowerUniform.value = v.value;
  });

function animate() {
  controls.update();
  if (exteriorMesh) {
    exteriorMesh.rotation.y += 0.001;
    interiorMesh!.rotation.y = exteriorMesh.rotation.y;
  }
  renderer.render(scene, camera);
}
