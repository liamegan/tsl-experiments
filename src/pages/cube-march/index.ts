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
  faceDirection,
  faceForward,
  materialNormal,
  positionView,
  positionGeometry,
  positionViewDirection,
  positionWorldDirection,
  struct,
  normalize,
  Loop,
  int,
  If,
  max,
  float,
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
const calcIntersection = Fn((cam) => {

  const MAX_TRACE_DISTANCE = 10.;             // max trace distance
  const INTERSECTION_PRECISION = 0.001;       // precision of the intersection
  const NUM_OF_TRACE_STEPS = 128;               // max number of trace steps
  const STEP_MULTIPLIER = .05;

  let h =  INTERSECTION_PRECISION*2.0;
  let rayDepth = 0.0;
  let hitDepth = -1.0;
  let accum = float(0);
  let position;
  let colour;

  Loop({start: int(0), end: NUM_OF_TRACE_STEPS, type: 'int', condition: "<", name: "i"}, (i) {
    If(h < INTERSECTION_PRECISION || rayDepth > MAX_TRACE_DISTANCE).break();
    if( abs(h) < INTERSECTION_PRECISION || rayDepth > MAX_TRACE_DISTANCE ) break;
    position = cam.ro+cam.rd*rayDepth;
    const h = map( position );
    rayDepth += h * STEP_MULTIPLIER;
    accum.add(max(h, 0.));
  });

  if( rayDepth < MAX_TRACE_DISTANCE ) hitDepth = rayDepth;

  return accum;
});
material.colorNode = Fn(() => {
  const camera = struct({
    ro: positionView,
    rd: positionViewDirection
  });
  const s = calcIntersection(camera);
  const p = positionLocal;
  const p2 = positionViewDirection;
  const n = materialNormal;
  return vec4(p2, 1);
})();

const mesh = new THREE.Mesh(new THREE.BoxGeometry(), material);
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
