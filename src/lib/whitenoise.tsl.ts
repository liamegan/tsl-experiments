import { DataTexture, RGFormat, NearestFilter } from "three/webgpu";
import { RepeatWrapping } from "three/webgpu";
import {
  Fn,
  vec2,
  fract,
  sin,
  dot,
  texture,
  floor,
  float,
  mix,
} from "three/tsl";

export const whiteNoise = Fn(([p]: [any]) => {
  return fract(sin(dot(p, vec2(12.9898, 78.233))).mul(43758.5453));
});

const noiseSize = 512;
// Two channels (RG): R and G hold independent random values so adjacent
// z-slices can be fetched in a single texture lookup and interpolated.
const noiseData = new Uint8Array(noiseSize * noiseSize * 2);
for (let i = 0; i < noiseData.length; i++) {
  noiseData[i] = Math.floor(Math.random() * 256);
}
const noiseTex = new DataTexture(noiseData, noiseSize, noiseSize, RGFormat);
noiseTex.wrapS = RepeatWrapping;
noiseTex.wrapT = RepeatWrapping;
noiseTex.magFilter = NearestFilter;
noiseTex.minFilter = NearestFilter;
noiseTex.needsUpdate = true;

export const whiteNoiseTexture = Fn(([p]: [any]) => {
  return texture(noiseTex, p).r;
});

// 3-D value noise LUT — trilinear interpolation via a single texture sample.
// z-slices are offset by vec2(37, 17)*p.z; R and G hold the floor/ceil z values.
export const whiteNoiseTexture3D = Fn(([x]: [any]) => {
  const p = floor(x).toVar();
  const f = fract(x).toVar();
  f.assign(f.mul(f).mul(float(3).sub(f.mul(2))));
  const uv = p.xy.add(vec2(37.0, 17.0).mul(p.z)).add(f.xy);
  const rg = texture(noiseTex, uv.add(0.5).div(float(noiseSize))).yx.sub(0.5);
  return mix(rg.x, rg.y, f.z);
});
