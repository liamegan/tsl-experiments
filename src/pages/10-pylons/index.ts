import * as THREE from "three/webgpu";
import {
  Fn,
  uniform,
  storage,
  instanceIndex,
  vec3,
  vec4,
  float,
  sin,
  fract,
  floor,
  time,
  positionLocal,
  select,
} from "three/tsl";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { Pane } from "tweakpane";
import { simplexNoise } from "/src/lib/simplexnoise.tsl";

console.clear();

// ── Scene ─────────────────────────────────────────────────────────────────────

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x07080e);

const camera = new THREE.PerspectiveCamera(
  55,
  window.innerWidth / window.innerHeight,
  0.1,
  300,
);
camera.position.set(0, 16, 22);
camera.lookAt(0, 0, 0);

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
controls.target.set(0, 2, 0);

// ── Options & uniforms ────────────────────────────────────────────────────────

const options = {
  fieldRadius: 9,
  pylonRadius: 0.14,
  maxHeight: 6,
  noiseScale: 0.28,
  timeSpeed: 0.22,
  circularPattern: true,
};

const fieldRadiusU = uniform(options.fieldRadius);
const pylonRadiusU = uniform(options.pylonRadius);
const maxHeightU = uniform(options.maxHeight);
const noiseScaleU = uniform(options.noiseScale);
const timeSpeedU = uniform(options.timeSpeed);
// 1 = circular, 0 = full square grid
const circularPatternU = uniform(1);

// ── Grid sizing ───────────────────────────────────────────────────────────────
// Fill the field diameter with pylons spaced one pylon-diameter apart.
// GRID pylons span 2*fieldRadius, so spacing = 2*fieldRadius/(GRID-1).
// For spacing = 2*pylonRadius → GRID = fieldRadius/pylonRadius + 1.
// Capped so COUNT stays ≤ 90 000 (≈300×300).

function computeGrid(): number {
  const MAX_GRID = Math.floor(Math.sqrt(200_000)); // 300
  const desired = Math.round(options.fieldRadius / options.pylonRadius) + 1;
  return Math.min(MAX_GRID, Math.max(3, desired));
}

// ── Mutable GPU state ─────────────────────────────────────────────────────────

let GRID = 0;
let COUNT = 0;

let heightBuffer!: THREE.StorageBufferAttribute;
let colorBuffer!: THREE.StorageBufferAttribute;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let heightStorage!: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let colorStorage!: any;
let computeNode: any = null;
let pylonMesh: THREE.InstancedMesh | null = null;

// ── Shared geometry (never rebuilt) ───────────────────────────────────────────

const cylGeo = new THREE.CylinderGeometry(1, 1, 1, 16, 1);

// ── Build helpers ─────────────────────────────────────────────────────────────

function buildComputeNode(count: number) {
  // GRID is a JS constant baked into the node graph at call time —
  // a new compute node is required whenever GRID changes.
  return Fn(() => {
    const idxF = float(instanceIndex);
    const col = idxF.mod(float(GRID));
    const row = floor(idxF.div(float(GRID)));
    const nx = col
      .div(float(GRID - 1))
      .mul(2.0)
      .sub(1.0);
    const nz = row
      .div(float(GRID - 1))
      .mul(2.0)
      .sub(1.0);

    // active = inside the unit disc, OR when circular pattern is disabled
    const inside = nx.mul(nx).add(nz.mul(nz)).lessThanEqual(float(1));
    const active = inside.or(circularPatternU.lessThan(float(0.5)));

    const noiseIn = vec3(
      nx.mul(fieldRadiusU).mul(noiseScaleU).add(time.mul(timeSpeedU)),
      float(0),
      nz.mul(fieldRadiusU).mul(noiseScaleU).add(time.mul(timeSpeedU).mul(0.65)),
    ).toVar();
    const n = simplexNoise(noiseIn); // [0, 1]

    heightStorage
      .element(instanceIndex)
      .assign(select(active, n.mul(maxHeightU).add(0.04), float(0)));

    const hue = fract(n.mul(0.65).add(time.mul(0.035)));
    const tau = Math.PI * 2;
    const rgb = vec3(
      sin(hue.mul(tau)).mul(0.5).add(0.5),
      sin(hue.mul(tau).add(2.094)).mul(0.5).add(0.5),
      sin(hue.mul(tau).add(4.189)).mul(0.5).add(0.5),
    );
    colorStorage
      .element(instanceIndex)
      .assign(vec4(select(active, rgb, vec3(0, 0, 0)), float(1)));
  })().compute(count);
}

function buildMaterial(): THREE.MeshStandardMaterial {
  // Material nodes reference heightStorage / colorStorage at build time —
  // must be called after those variables are assigned.
  const mat = new THREE.MeshStandardMaterial({
    roughness: 0.2,
    metalness: 0.85,
  });

  mat.positionNode = Fn(() => {
    const h = heightStorage.element(instanceIndex);
    const pos = positionLocal.toVar();
    pos.x.assign(pos.x.mul(pylonRadiusU));
    pos.z.assign(pos.z.mul(pylonRadiusU));
    // y ∈ [-0.5, 0.5] → shift pivot to base → scale by computed height
    pos.y.assign(pos.y.add(0.5).mul(h));
    return pos;
  })();

  mat.colorNode = Fn(() => colorStorage.element(instanceIndex))();

  return mat;
}

// ── Rebuild ───────────────────────────────────────────────────────────────────
// Called on init and whenever fieldRadius / pylonRadius changes.
// If the desired GRID count is unchanged only instance positions are refreshed.

function rebuild() {
  const newGRID = computeGrid();

  if (newGRID === GRID && pylonMesh) {
    updateInstanceMatrices();
    return;
  }

  GRID = newGRID;
  COUNT = GRID * GRID;

  // New storage buffers (height: 1 float, colour: vec4)
  heightBuffer = new THREE.StorageBufferAttribute(COUNT, 1);
  colorBuffer = new THREE.StorageBufferAttribute(COUNT, 4);
  heightStorage = storage(heightBuffer, "float", COUNT);
  colorStorage = storage(colorBuffer, "vec4", COUNT);

  // New compute node — GRID is baked into the shader
  computeNode = buildComputeNode(COUNT);

  // Replace instanced mesh
  if (pylonMesh) {
    scene.remove(pylonMesh);
    (pylonMesh.material as THREE.Material).dispose();
  }
  pylonMesh = new THREE.InstancedMesh(cylGeo, buildMaterial(), COUNT);
  pylonMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(pylonMesh);

  updateInstanceMatrices();
}

// Positions are set via instance matrices (XZ world coords, Y used to sink
// out-of-circle instances below ground when circular pattern is active).
function updateInstanceMatrices() {
  if (!pylonMesh) return;
  const mat = new THREE.Matrix4();
  for (let i = 0; i < COUNT; i++) {
    const col = i % GRID;
    const row = Math.floor(i / GRID);
    const nx = (col / (GRID - 1)) * 2 - 1;
    const nz = (row / (GRID - 1)) * 2 - 1;
    const dist = Math.sqrt(nx * nx + nz * nz);
    const x = nx * options.fieldRadius;
    const z = nz * options.fieldRadius;
    mat.setPosition(x, options.circularPattern && dist > 1 ? -500 : 0, z);
    pylonMesh.setMatrixAt(i, mat);
  }
  pylonMesh.instanceMatrix.needsUpdate = true;
}

// ── Initial build ─────────────────────────────────────────────────────────────

rebuild();

// ── Ground plane ──────────────────────────────────────────────────────────────

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(400, 400),
  new THREE.MeshStandardMaterial({
    color: 0x0d0f18,
    roughness: 0.95,
    metalness: 0.05,
  }),
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.005;
scene.add(ground);

// ── Lighting ──────────────────────────────────────────────────────────────────

const sun = new THREE.DirectionalLight(0xffffff, 5);
sun.position.set(10, 20, 12);
scene.add(sun);
scene.add(new THREE.AmbientLight(0x223355, 2));

// ── Tweakpane ─────────────────────────────────────────────────────────────────

const pane = new Pane();
const f = pane.addFolder({ title: "Pylons" });

f.addBinding(options, "fieldRadius", {
  label: "Field Radius",
  min: 2,
  max: 100,
  step: 0.5,
}).on("change", (v: any) => {
  fieldRadiusU.value = v.value;
  rebuild();
});

f.addBinding(options, "circularPattern", { label: "Circular Pattern" }).on(
  "change",
  () => {
    circularPatternU.value = options.circularPattern ? 1 : 0;
    updateInstanceMatrices();
  },
);

f.addBinding(options, "pylonRadius", {
  label: "Pylon Radius",
  min: 0.05,
  max: 0.6,
  step: 0.01,
}).on("change", (v: any) => {
  pylonRadiusU.value = v.value;
  rebuild();
});

f.addBinding(options, "maxHeight", {
  label: "Max Height",
  min: 0.5,
  max: 20,
  step: 0.1,
}).on("change", (v: any) => {
  maxHeightU.value = v.value;
});

f.addBinding(options, "noiseScale", {
  label: "Noise Scale",
  min: 0.02,
  max: 2.0,
  step: 0.01,
}).on("change", (v: any) => {
  noiseScaleU.value = v.value;
});

f.addBinding(options, "timeSpeed", {
  label: "Time Speed",
  min: 0,
  max: 2,
  step: 0.01,
}).on("change", (v: any) => {
  timeSpeedU.value = v.value;
});

// ── Animation loop ────────────────────────────────────────────────────────────

async function animate() {
  controls.update();
  if (computeNode) await renderer.computeAsync(computeNode);
  renderer.render(scene, camera);
}
