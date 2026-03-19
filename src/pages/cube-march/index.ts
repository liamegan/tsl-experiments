import * as THREE from "three/webgpu";
import {
  color,
  vec2,
  vec3,
  vec4,
  positionLocal,
  abs,
  cross,
  mix,
  Fn,
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
material.colorNode = Fn(() => {
  const p = positionLocal;
  return vec4(p, 1);
})();

const mesh = new THREE.Mesh(new THREE.BoxGeometry(), material);
scene.add(mesh);

const pointLight = new THREE.PointLight("white", 20, 10);
pointLight.position.set(2, 2, 2);
scene.add(pointLight);
const ambientLight = new THREE.AmbientLight("white", 0.5);
scene.add(ambientLight);

renderer.debug.getShaderAsync(scene, camera, mesh).then((e) => {
  console.log(e.fragmentShader);
});

function animate() {
  controls.update();
  renderer.render(scene, camera);
}
