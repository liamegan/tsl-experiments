import * as THREE from "three/webgpu";
import {
  Fn,
  uniform,
  vec4,
  vec3,
  vec2,
  normalView,
  positionWorld,
  positionLocal,
  sin,
  fract,
  atan,
  time,
  uv,
  transformedNormalView,
  normalFlat,
} from "three/tsl";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { ConvexGeometry } from "three/addons/geometries/ConvexGeometry.js";

import { Pane } from "tweakpane";

import { simplexNoise } from "/src/lib/simplexnoise.tsl";
import { makeFBM } from "/src/lib/fbm.tsl";

console.clear();

const simplexFBM = makeFBM(simplexNoise);

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

  // Always include poles to ensure biconic shape
  points.push(new THREE.Vector3(0, topPole, 0));
  points.push(new THREE.Vector3(0, bottomPole, 0));

  for (let i = 0; i < count - 2; i++) {
    // Random angle around Y axis
    const theta = rng() * Math.PI * 2;

    // Random elevation, biased toward equator for biconic shape
    // Map from [-1, 1] but compress polar regions
    const raw = rng() * 2 - 1;
    // Bias: cube root stretches mid, but we want more points near equator
    // Use a sine-based bias to cluster near equator
    const y =
      Math.sign(raw) * Math.pow(Math.abs(raw), 1 / equatorBias) * 0.85 +
      (rng() - 0.5) * yJitter;

    // Radius tapers toward poles (biconic), with controllable variance
    const r =
      equatorRadius *
      (1 - Math.abs(y)) *
      (1 - radialVariance + rng() * radialVariance);

    points.push(new THREE.Vector3(Math.cos(theta) * r, y, Math.sin(theta) * r));
  }

  return points;
}

const options = {
  seed: 64,
  points: 64,
  topPole: 1,
  bottomPole: -0.6,
  equatorBias: 1.5,
  equatorRadius: 1.0,
  radialVariance: 0.4,
  yJitter: 0.1,
  hueSpeed: 0.1,
  fresnelPower: 2.0,
  specPower: 48.0,
  noiseScale: 4,
  noiseStrength: 0.08,
};

const topPoleUniform = uniform(options.topPole);
const bottomPoleUniform = uniform(options.bottomPole);
const noiseScaleUniform = uniform(options.noiseScale);
const noiseStrengthUniform = uniform(options.noiseStrength);
const hueSpeedUniform = uniform(options.hueSpeed);
const fresnelPowerUniform = uniform(options.fresnelPower);
const specPowerUniform = uniform(options.specPower);

// Cylindrical UV: u = angle around Y axis, v = normalised height between poles
const gemUV = Fn(() => {
  const u = atan(positionLocal.z, positionLocal.x)
    .div(Math.PI * 2)
    .add(0.5);
  const span = topPoleUniform.sub(bottomPoleUniform);
  const v = positionLocal.y.sub(bottomPoleUniform).div(span);
  return vec2(u, v);
});

const material = new THREE.MeshBasicMaterial();

// FBM normal perturbation for micro-faceting
material.normalNode = Fn(() => {
  const n = normalView.toVar();
  const noise = simplexFBM(positionWorld.mul(noiseScaleUniform));
  n.addAssign(
    vec3(noise).mul(noiseStrengthUniform).sub(noiseStrengthUniform.mul(0.5)),
  );
  return vec4(n, 1);
})();

// Dynamic matcap: hue from view-space normal angle, animated over time
material.colorNode = Fn(() => {
  const n = normalView.normalize().toVar();
  const p = positionWorld.toVar();

  const nt = time.mul(hueSpeedUniform);

  const noise = simplexFBM(positionWorld.mul(noiseScaleUniform).add(nt));

  // n.addAssign(
  //   vec3(noise).mul(noiseStrengthUniform).sub(noiseStrengthUniform.mul(0.5)),
  // );

  // Angle of the normal in view-space XY > hue [0, 1], animated
  const angle = atan(n.y, n.x).add(p.y.mul(2));
  const hue = fract(
    angle
      .div(Math.PI * 2)
      .add(noise.mul(noiseStrengthUniform))
      .add(0.5)
      .add(nt),
  );

  // Smooth rainbow via phase-shifted sine waves
  const tau = Math.PI * 2;
  const rainbow = vec3(
    sin(hue.mul(tau)).mul(0.5).add(0.5),
    sin(hue.mul(tau).add(2.094)).mul(0.5).add(0.5),
    sin(hue.mul(tau).add(4.189)).mul(0.5).add(0.5),
  );

  // Fresnel: rainbow is bright at grazing angles, dark face-on
  const nz = n.z.clamp(0, 1);
  const fresnel = nz.oneMinus().pow(fresnelPowerUniform);

  // Sharp specular highlight at face-on center
  const spec = nz.pow(specPowerUniform);

  // return vec4(normalView, 1);
  return vec4(rainbow.mul(fresnel).add(spec), 1);
})();

let mesh: THREE.Mesh | null = null;

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
  topPoleUniform.value = options.topPole;
  bottomPoleUniform.value = options.bottomPole;

  if (mesh) {
    mesh.geometry.dispose();
    mesh.geometry = geometry;
  } else {
    mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);
  }
}

buildGem();

const pane = new Pane();
const folder = pane.addFolder({ title: "Gem" });

folder
  .addBinding(options, "points", {
    label: "Points",
    min: 6,
    max: 128,
    step: 1,
  })
  .on("change", () => buildGem());

folder
  .addBinding(options, "seed", {
    label: "Seed",
    min: 0,
    max: 9999,
    step: 1,
  })
  .on("change", () => buildGem());

folder
  .addBinding(options, "topPole", {
    label: "Top Pole",
    min: 0,
    max: 2,
    step: 0.01,
  })
  .on("change", () => buildGem());

folder
  .addBinding(options, "bottomPole", {
    label: "Bottom Pole",
    min: -2,
    max: 0,
    step: 0.01,
  })
  .on("change", () => buildGem());

folder
  .addBinding(options, "equatorBias", {
    label: "Equator Bias",
    min: 0.1,
    max: 5,
    step: 0.05,
  })
  .on("change", () => buildGem());

folder
  .addBinding(options, "equatorRadius", {
    label: "Equator Radius",
    min: 0.1,
    max: 2,
    step: 0.01,
  })
  .on("change", () => buildGem());

folder
  .addBinding(options, "radialVariance", {
    label: "Radial Variance",
    min: 0,
    max: 1,
    step: 0.01,
  })
  .on("change", () => buildGem());

folder
  .addBinding(options, "yJitter", {
    label: "Y Jitter",
    min: 0,
    max: 1,
    step: 0.01,
  })
  .on("change", () => buildGem());

folder
  .addBinding(options, "hueSpeed", {
    label: "Hue Speed",
    min: -1,
    max: 1,
    step: 0.01,
  })
  .on("change", (v: any) => {
    hueSpeedUniform.value = v.value;
  });

folder
  .addBinding(options, "fresnelPower", {
    label: "Fresnel Power",
    min: 0.5,
    max: 8,
    step: 0.1,
  })
  .on("change", (v: any) => {
    fresnelPowerUniform.value = v.value;
  });

folder
  .addBinding(options, "specPower", {
    label: "Spec Power",
    min: 1,
    max: 256,
    step: 1,
  })
  .on("change", (v: any) => {
    specPowerUniform.value = v.value;
  });

folder
  .addBinding(options, "noiseScale", {
    label: "Noise Scale",
    min: 0.1,
    max: 20,
    step: 0.1,
  })
  .on("change", (v: any) => {
    noiseScaleUniform.value = v.value;
  });

folder
  .addBinding(options, "noiseStrength", {
    label: "Noise Strength",
    min: 0,
    max: 0.5,
    step: 0.01,
  })
  .on("change", (v: any) => {
    noiseStrengthUniform.value = v.value;
  });
folder.expanded = false;

function animate() {
  controls.update();
  if (mesh) mesh.rotation.y += 0.001;
  renderer.render(scene, camera);
}
