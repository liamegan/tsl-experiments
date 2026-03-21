import * as THREE from "three/webgpu";
import {
  color,
  texture,
  convertColorSpace,
  positionLocal,
  vec4,
  vec3,
  smoothstep,
  abs,
  fwidth,
  vec2,
  mix,
} from "three/tsl";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { Fn } from "three/src/nodes/TSL.js";

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(
  75,
  window.innerWidth / window.innerHeight,
  0.1,
  10,
);
camera.position.z = 1;

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

const material = new THREE.NodeMaterial();
material.fragmentNode = color("crimson");
material.fragmentNode = convertColorSpace(
  texture(
    new THREE.TextureLoader().load(
      "https://threejs.org/examples/textures/uv_grid_opengl.jpg",
    ),
  ),
  THREE.SRGBColorSpace,
  THREE.LinearSRGBColorSpace,
);
const main = Fn(() => {
  const p = positionLocal;
  const b = vec2(abs(p.x), abs(p.y));
  const w = 0.45;
  const m = smoothstep(fwidth(b.x).add(w), w, b.x).mul(
    smoothstep(fwidth(b.y).add(w), w, b.y),
  );
  return vec4(mix(vec3(0.4, 0.6, 0.9), vec3(0.99), m), 1);
});
material.fragmentNode = main();

const mesh = new THREE.Mesh(new THREE.PlaneGeometry(), material);
scene.add(mesh);

renderer.debug.getShaderAsync(scene, camera, mesh).then((e) => {
  console.log(e.fragmentShader);
});
function animate() {
  controls.update();

  renderer.render(scene, camera);
}
