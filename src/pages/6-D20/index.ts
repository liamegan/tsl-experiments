import * as THREE from "three/webgpu";
import {
  vec2,
  vec3,
  abs,
  Fn,
  normalize,
  Loop,
  If,
  min,
  max,
  float,
  positionWorld,
  cameraPosition,
  cameraNear,
  uniform,
  cameraFar,
  Break,
  length,
  normalWorld,
  select,
  normalLocal,
  normalFlat,
} from "three/tsl";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

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

const material = new THREE.MeshStandardMaterial({
  color: "crimson",
  roughness: 0.5,
  metalness: 0.5,
});

const options = {
  maxSteps: 128,
  surfaceDistance: 0.001,
};
const maxSteps = uniform(options.maxSteps);
const surfaceDistance = uniform(options.surfaceDistance);
const Box = Fn(([position, dimensions]: [any, any]) => {
  const distance = abs(position).sub(dimensions);
  return length(max(distance, 0.0)).add(
    min(max(distance.x, max(distance.y, distance.z)), 0.0),
  );
});
const sceneFn = Fn(([position]: [any]) => {
  const box0 = min(
    Box(position.sub(vec3(0)), vec3(0.1, 0.1, 0.3)),
    Box(position.sub(vec3(0)), vec3(0.1, 0.3, 0.1)),
    Box(position.sub(vec3(0)), vec3(0.3, 0.1, 0.1)),
  );
  const box1 = max(box0.negate(), Box(position.sub(vec3(0)), vec3(0.25)));
  return box1.sub(0.005);
});
const getNormal = Fn(([position, distance]: [any, any]) => {
  const offset = vec2(0.0025, 0);

  return normalize(
    distance.sub(
      vec3(
        sceneFn(position.sub(offset.xyy)),
        sceneFn(position.sub(offset.yxy)),
        sceneFn(position.sub(offset.yyx)),
      ),
    ),
  );
});
material.colorNode = Fn(() => {
  const ro = positionWorld.toVar();
  const rd = positionWorld.sub(cameraPosition).normalize().toVar();

  const pos = vec3(0).toVar();
  const distance = float(0).toVar();
  const accumulatedDistance = float(cameraNear).toVar();

  Loop({ start: 0, end: maxSteps }, () => {
    pos.assign(ro.add(rd.mul(accumulatedDistance)));
    distance.assign(sceneFn(pos));
    If(
      abs(distance)
        .lessThan(surfaceDistance)
        .or(accumulatedDistance.greaterThan(cameraFar)),
      () => {
        Break();
      },
    );
    accumulatedDistance.addAssign(distance);
  });

  const hit = abs(distance).lessThan(surfaceDistance);
  return select(hit, getNormal(pos, distance), normalFlat);
})();

const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(), material);
scene.add(mesh);

const sun = new THREE.DirectionalLight(0xffffff, 8);
sun.position.set(2, 2, 2);
scene.add(sun, new THREE.AmbientLight(0xffffff, 1));

renderer.debug.getShaderAsync(scene, camera, mesh).then((e) => {
  console.log(e.fragmentShader);
});

function animate() {
  controls.update();
  renderer.render(scene, camera);
}
