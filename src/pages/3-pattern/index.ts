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
  float,
  length,
  fract,
  sin,
  time,
  rotateUV,
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
camera.position.set(1, 1, 1);

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
  const p = positionLocal.toVar();

  p.assign(p.mul(5));
  p.xy.assign(rotateUV(p.xy, time.mul(0.1)));
  p.zx.assign(rotateUV(p.zx, time.add(1).mul(0.2)));
  p.yz.assign(rotateUV(p.yz, time.mul(0.05)));
  p.assign(fract(p).sub(0.5));
  const t = length(p);
  t.assign(abs(sin(t.mul(10).add(time))));
  t.assign(smoothstep(fwidth(t).add(0.3), 0.3, t));

  return t;
});
material.fragmentNode = main();

const mesh = new THREE.Mesh(new THREE.BoxGeometry(), material);
scene.add(mesh);

renderer.debug.getShaderAsync(scene, camera, mesh).then((e) => {
  console.log(e.fragmentShader);
});
function animate() {
  controls.update();

  renderer.render(scene, camera);
}
