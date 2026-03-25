import * as THREE from "three/webgpu";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { ConvexGeometry } from "three/addons/geometries/ConvexGeometry.js";
import { Pane } from "tweakpane";

import { generateGemPoints } from "/src/lib/gem-points";
import { createGemMaterial } from "/src/lib/gem-material";
import { voronoiFracture } from "/src/lib/voronoi-fracture";

console.clear();

// --- Scene setup ---
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

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

const clock = new THREE.Clock();

// --- Material ---
const { material, uniforms: matUniforms } = createGemMaterial(THREE.DoubleSide);

// --- Fragment group ---
const group = new THREE.Group();
scene.add(group);

type FragmentMesh = { mesh: THREE.Mesh; center: THREE.Vector3 };
let fragmentMeshes: FragmentMesh[] = [];

// --- Options ---
const options = {
  // Shape
  seed: 64,
  points: 64,
  topPole: 1.0,
  bottomPole: -0.6,
  equatorBias: 1.5,
  equatorRadius: 1.0,
  radialVariance: 0.4,
  yJitter: 0.1,
  // Material
  hueSpeed: 0.1,
  fresnelPower: 2.0,
  specPower: 48.0,
  noiseScale: 4,
  noiseStrength: 0.08,
  // Fragments
  fragmentCount: 8,
  fragmentSeed: 42,
  // Explode
  explodeAmount: 0.0,
  explodeScale: 0.8,
  autoExplode: true,
  explodeSpeed: 0.4,
};

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
  const gemGeom = new ConvexGeometry(pts);

  for (const { mesh } of fragmentMeshes) {
    group.remove(mesh);
    mesh.geometry.dispose();
  }
  fragmentMeshes = [];

  const { fragments } = voronoiFracture(gemGeom, options.fragmentCount, options.fragmentSeed);

  for (const frag of fragments) {
    const mesh = new THREE.Mesh(frag.geometry, material);
    group.add(mesh);
    fragmentMeshes.push({ mesh, center: frag.center });
  }

  gemGeom.dispose();
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
  .addBinding(options, "topPole", { label: "Top Pole", min: 0, max: 2, step: 0.01 })
  .on("change", () => buildGem());
shapeFolder
  .addBinding(options, "bottomPole", { label: "Bottom Pole", min: -2, max: 0, step: 0.01 })
  .on("change", () => buildGem());
shapeFolder
  .addBinding(options, "equatorBias", { label: "Equator Bias", min: 0.1, max: 5, step: 0.05 })
  .on("change", () => buildGem());
shapeFolder
  .addBinding(options, "equatorRadius", { label: "Equator Radius", min: 0.1, max: 2, step: 0.01 })
  .on("change", () => buildGem());
shapeFolder
  .addBinding(options, "radialVariance", { label: "Radial Variance", min: 0, max: 1, step: 0.01 })
  .on("change", () => buildGem());
shapeFolder
  .addBinding(options, "yJitter", { label: "Y Jitter", min: 0, max: 1, step: 0.01 })
  .on("change", () => buildGem());
shapeFolder.expanded = false;

const fragFolder = pane.addFolder({ title: "Fragments" });
fragFolder
  .addBinding(options, "fragmentCount", { label: "Count", min: 2, max: 20, step: 1 })
  .on("change", () => buildGem());
fragFolder
  .addBinding(options, "fragmentSeed", { label: "Seed", min: 0, max: 9999, step: 1 })
  .on("change", () => buildGem());

const explodeFolder = pane.addFolder({ title: "Explode" });
explodeFolder.addBinding(options, "autoExplode", { label: "Auto" });
explodeFolder.addBinding(options, "explodeAmount", {
  label: "Amount",
  min: 0,
  max: 1,
  step: 0.01,
});
explodeFolder.addBinding(options, "explodeScale", {
  label: "Scale",
  min: 0,
  max: 2,
  step: 0.01,
});
explodeFolder.addBinding(options, "explodeSpeed", {
  label: "Speed",
  min: 0.05,
  max: 2,
  step: 0.05,
});

const matFolder = pane.addFolder({ title: "Material" });
matFolder
  .addBinding(options, "hueSpeed", { label: "Hue Speed", min: -1, max: 1, step: 0.01 })
  .on("change", (v: any) => { matUniforms.hueSpeed.value = v.value; });
matFolder
  .addBinding(options, "fresnelPower", { label: "Fresnel Power", min: 0.5, max: 8, step: 0.1 })
  .on("change", (v: any) => { matUniforms.fresnelPower.value = v.value; });
matFolder
  .addBinding(options, "specPower", { label: "Spec Power", min: 1, max: 256, step: 1 })
  .on("change", (v: any) => { matUniforms.specPower.value = v.value; });
matFolder
  .addBinding(options, "noiseScale", { label: "Noise Scale", min: 0.1, max: 20, step: 0.1 })
  .on("change", (v: any) => { matUniforms.noiseScale.value = v.value; });
matFolder
  .addBinding(options, "noiseStrength", { label: "Noise Strength", min: 0, max: 0.5, step: 0.01 })
  .on("change", (v: any) => { matUniforms.noiseStrength.value = v.value; });
matFolder.expanded = false;

// --- Animation ---
function animate() {
  const elapsed = clock.getElapsedTime();

  const t = options.autoExplode
    ? Math.sin(elapsed * options.explodeSpeed) * 0.5 + 0.5
    : options.explodeAmount;

  for (const { mesh, center } of fragmentMeshes) {
    mesh.position.copy(center).multiplyScalar(t * options.explodeScale);
  }

  group.rotation.y += 0.001;
  controls.update();
  renderer.render(scene, camera);
}
