import { Fn, vec3, float, Loop } from "three/tsl";

interface FBMOptions {
  octaves?: number;
  lacunarity?: number;
  gain?: number;
}

// Returns a new Fn node that applies fractional Brownian motion to any noise function.
// TSL Loop emits a single native for-loop in the shader — only one copy of noiseFn
// in the node graph regardless of octave count, keeping compile time fast.
export const makeFBM = (
  noiseFn: (p: any) => any,
  { octaves = 6, lacunarity = 2.0, gain = 0.5 }: FBMOptions = {},
) =>
  Fn(([p]: [any]) => {
    const value = float(0).toVar();
    const amplitude = float(0.5).toVar();
    const pos = vec3(p).toVar();

    Loop(octaves, () => {
      value.addAssign(noiseFn(pos).mul(amplitude));
      pos.mulAssign(lacunarity);
      amplitude.mulAssign(gain);
    });

    return value;
  });
