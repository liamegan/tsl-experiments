import { Fn } from "three/tsl";
import { whiteNoiseTexture3D } from "./whitenoise.tsl";

export const valueNoise = Fn(([p]: [any]) => {
  return whiteNoiseTexture3D(p);
});
