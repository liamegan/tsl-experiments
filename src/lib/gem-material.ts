import * as THREE from "three/webgpu";
import { Fn, uniform, vec4, vec3, normalView, positionWorld, sin, fract, atan, time } from "three/tsl";
import { simplexNoise } from "/src/lib/simplexnoise.tsl";
import { makeFBM } from "/src/lib/fbm.tsl";

const simplexFBM = makeFBM(simplexNoise);

export interface GemMaterialUniforms {
  noiseScale: ReturnType<typeof uniform>;
  noiseStrength: ReturnType<typeof uniform>;
  hueSpeed: ReturnType<typeof uniform>;
  fresnelPower: ReturnType<typeof uniform>;
  specPower: ReturnType<typeof uniform>;
}

export function createGemMaterial(
  side: THREE.Side = THREE.FrontSide,
): { material: THREE.MeshBasicMaterial; uniforms: GemMaterialUniforms } {
  const uniforms: GemMaterialUniforms = {
    noiseScale: uniform(4),
    noiseStrength: uniform(0.08),
    hueSpeed: uniform(0.1),
    fresnelPower: uniform(2.0),
    specPower: uniform(48.0),
  };

  const material = new THREE.MeshBasicMaterial({ side });

  material.normalNode = Fn(() => {
    const n = normalView.toVar();
    const noise = simplexFBM(positionWorld.mul(uniforms.noiseScale));
    n.addAssign(
      vec3(noise)
        .mul(uniforms.noiseStrength)
        .sub(uniforms.noiseStrength.mul(0.5)),
    );
    return vec4(n, 1);
  })();

  material.colorNode = Fn(() => {
    const n = normalView.normalize().toVar();
    const nt = time.mul(uniforms.hueSpeed);
    const noise = simplexFBM(positionWorld.mul(uniforms.noiseScale).add(nt));

    const angle = atan(n.y, n.x);
    const hue = fract(
      angle
        .div(Math.PI * 2)
        .add(noise.mul(uniforms.noiseStrength))
        .add(0.5)
        .add(nt),
    );

    const tau = Math.PI * 2;
    const rainbow = vec3(
      sin(hue.mul(tau)).mul(0.5).add(0.5),
      sin(hue.mul(tau).add(2.094)).mul(0.5).add(0.5),
      sin(hue.mul(tau).add(4.189)).mul(0.5).add(0.5),
    );

    const nz = n.z.clamp(0, 1);
    const fresnel = nz.oneMinus().pow(uniforms.fresnelPower);
    const spec = nz.pow(uniforms.specPower);

    return vec4(rainbow.mul(fresnel).add(spec), 1);
  })();

  return { material, uniforms };
}
