import * as THREE from "three/webgpu";
import {
  Fn,
  uniform,
  vec4,
  vec3,
  float,
  normalView,
  positionWorld,
  cameraPosition,
  sin,
  fract,
  atan,
  time,
  Loop,
} from "three/tsl";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { ConvexGeometry } from "three/addons/geometries/ConvexGeometry.js";

import { Pane } from "tweakpane";

import { simplexNoise } from "/src/lib/simplexnoise.tsl";
import { makeFBM } from "/src/lib/fbm.tsl";

console.clear();

const simplexFBM = makeFBM(simplexNoise, {
  octaves: 3,
  lacunarity: 3.0,
  gain: 0.5,
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

const options = {
  seed: 64,
  points: 64,
  topPole: 1,
  bottomPole: -0.6,
  equatorBias: 1.5,
  equatorRadius: 1.0,
  radialVariance: 0.4,
  yJitter: 0.1,
  // Exterior
  hueSpeed: 0.1,
  fresnelPower: 2.0,
  specPower: 128.0,
  noiseScale: 4,
  noiseStrength: 0.08,
  // Interior
  interiorSteps: 32,
  interiorStepSize: 0.04,
  interiorNoiseScale: 1.4,
  interiorBrightness: 1.0,
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

interiorMat.colorNode = Fn(() => {
  // Ray from back-face surface toward camera (through the interior)
  const ro = positionWorld.toVar();
  const rd = cameraPosition.sub(positionWorld).normalize().toVar();

  const accumulated = vec3(0).toVar();
  const t = float(0).toVar();

  Loop({ start: 0, end: interiorStepsUniform }, () => {
    const pos = ro.add(rd.mul(t));
    const nt = time.mul(hueSpeedUniform);

    // Sample FBM noise at this interior position
    const n = simplexFBM(pos.mul(interiorNoiseScaleUniform)).pow(2).sub(0.1);

    // Rainbow hue from world-space position angle (different axis for variety)
    const hue = fract(
      atan(pos.z, pos.x)
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

    // Accumulate: noise acts as density
    accumulated.addAssign(
      col
        .mul(n.mul(interiorStepSizeUniform).mul(interiorBrightnessUniform))
        .mul(float(1).sub(t)),
    );
    t.addAssign(interiorStepSizeUniform);
  });

  return vec4(accumulated, 1);
})();

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

function animate() {
  controls.update();
  if (exteriorMesh) {
    exteriorMesh.rotation.y += 0.001;
    interiorMesh!.rotation.y = exteriorMesh.rotation.y;
  }
  renderer.render(scene, camera);
}
