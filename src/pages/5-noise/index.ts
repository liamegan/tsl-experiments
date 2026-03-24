import * as THREE from "three/webgpu";
import {
  Fn,
  uniform,
  vec4,
  vec3,
  normalView,
  positionWorld,
} from "three/tsl";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

import { Pane } from "tweakpane";

import { whiteNoiseTexture3D } from "/src/lib/whitenoise.tsl";
import { valueNoise } from "/src/lib/valuenoise.tsl";
import { perlinNoise } from "/src/lib/perlinnoise.tsl";
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

const options = {
  map: "color",
  noiseType: "white",
  scale: 256,
};

const noiseScaleUniform = uniform(256);

function buildMaterial(noiseFn: (p: any) => any, map: "color" | "normal") {
  const mat = new THREE.MeshStandardMaterial({
    color: "crimson",
    roughness: 0.5,
    metalness: 0.5,
  });

  const sample = Fn(() => {
    return noiseFn(positionWorld.mul(noiseScaleUniform));
  });

  if (map === "color") {
    mat.colorNode = Fn(() => vec4(vec3(sample()), 1))();
  } else {
    mat.normalNode = Fn(() => {
      const n = normalView.toVar();
      n.addAssign(sample().mul(0.1).sub(0.05));
      return vec4(n, 1);
    })();
  }

  return mat;
}

const noiseVariants: Record<string, (p: any) => any> = {
  white: (p) => whiteNoiseTexture3D(p),
  value: (p) => valueNoise(p),
  perlin: (p) => perlinNoise(p.mul(0.05)),
  simplex: (p) => simplexNoise(p.mul(0.05)),
  fbm: (p) => simplexFBM(p.mul(0.05)),
};

const materials: Record<
  string,
  { color: THREE.MeshStandardMaterial; normal: THREE.MeshStandardMaterial }
> = Object.fromEntries(
  Object.entries(noiseVariants).map(([key, fn]) => [
    key,
    { color: buildMaterial(fn, "color"), normal: buildMaterial(fn, "normal") },
  ]),
);

const mesh = new THREE.Mesh(new THREE.BoxGeometry(), materials.white.color);
scene.add(mesh);

async function applyMaterial() {
  const label = `${options.noiseType}/${options.map}`;
  const next = materials[options.noiseType][options.map as "color" | "normal"];
  (mesh.material as THREE.Material).dispose();
  mesh.material = next;

  // Stage 1: TSL node graph → WGSL string
  const t0 = performance.now();
  const shader = await renderer.debug.getShaderAsync(scene, camera, mesh);
  const tslMs = performance.now() - t0;

  // Stage 2: WGSL → GPU pipeline (compileAsync drives the full pipeline)
  const t1 = performance.now();
  await renderer.compileAsync(scene, camera);
  const gpuMs = performance.now() - t1;

  console.group(label);
  console.log(`TSL→WGSL : ${tslMs.toFixed(1)}ms`);
  console.log(`GPU compile: ${gpuMs.toFixed(1)}ms`);
  console.log(`Fragment WGSL length: ${shader.fragmentShader.length} chars`);
  console.groupEnd();
}

const p: Pane = new Pane();
const c = p.addFolder({ title: "Settings" });
c.addBinding(options, "scale", {
  min: 2,
  max: 2048,
  step: 4,
}).on("change", (v: any) => {
  noiseScaleUniform.value = v.value;
});
c.addBinding(options, "noiseType", {
  options: {
    white: "white",
    value: "value",
    perlin: "perlin",
    simplex: "simplex",
    fbm: "fbm",
  },
}).on("change", () => applyMaterial());
c.addBinding(options, "map", {
  options: {
    normal: "normal",
    color: "color",
  },
}).on("change", () => applyMaterial());

const sun = new THREE.DirectionalLight(0xffffff, 8);
sun.position.set(2, 2, 2);
scene.add(sun, new THREE.AmbientLight(0xffffff, 1));

function animate() {
  controls.update();
  renderer.render(scene, camera);
}
