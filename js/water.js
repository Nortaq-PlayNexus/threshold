// TSL water: planar reflection (reflector) + screen-space refraction (viewportSharedTexture)
// with true thickness-based absorption from the depth buffer, and procedural caustics.
import * as THREE from 'three/webgpu';
import {
	Fn, uniform, vec2, vec3, vec4, float, texture, time, positionWorld, positionView, cameraPosition, normalize, dot, max, pow, mix,
	exp, reflector, viewportSharedTexture, viewportSafeUV, viewportDepthTexture, perspectiveDepthToViewZ, cameraNear, cameraFar,
	screenUV, smoothstep, mx_worley_noise_vec2, step, clamp
} from 'three/tsl';
import { tex } from './assets.js';

export const caustics = Fn(([p, t]) => {
	const a = mx_worley_noise_vec2(p.mul(1.6).add(vec2(t.mul(0.16), t.mul(0.11))));
	const b = mx_worley_noise_vec2(p.mul(2.2).add(vec2(t.mul(-0.13), t.mul(0.14))).add(3.7));
	const ea = float(1).sub(smoothstep(0.0, 0.16, a.y.sub(a.x)));
	const eb = float(1).sub(smoothstep(0.0, 0.16, b.y.sub(b.x)));
	return pow(ea.mul(eb).mul(1.4).add(ea.add(eb).mul(0.18)), 1.4);
});

/** Adds animated caustics (as emissive) to a material wherever it is under the water uniform. */
export function addCaustics(mat, waterY, strength = 0.35, tint = new THREE.Color(0.75, 1.0, 0.95)) {
	const depth = waterY.sub(positionWorld.y);
	const mask = smoothstep(0.0, 0.12, depth).mul(float(1).sub(smoothstep(1.0, 5.0, depth)).mul(0.65).add(0.35));
	mat.emissiveNode = caustics(positionWorld.xz.add(vec2(positionWorld.y.mul(0.35), 0)), time).mul(mask).mul(strength).mul(vec3(tint.r, tint.g, tint.b));
}

let normals = null;
async function getNormals() {
	if (!normals) normals = Promise.all([tex('assets/tex/water_n1.jpg'), tex('assets/tex/water_n2.jpg')]);
	return normals;
}

/**
 * opts: size [w,d], center [x,z], y, shallow (Color), deep (Color), absorb, reflScale (0 = off),
 *       reflStrength, ripple, distortion
 */
export async function createWater(scene, opts = {}) {
	const [n1, n2] = await getNormals();
	const level = uniform(opts.y ?? 0);
	const shallow = uniform(new THREE.Color(opts.shallow ?? 0x9fe8de));
	const deep = uniform(new THREE.Color(opts.deep ?? 0x0b5f63));
	const absorb = uniform(opts.absorb ?? 0.45);
	const reflStrength = uniform(opts.reflStrength ?? 1.0);
	const ripple = opts.ripple ?? 0.35, distortion = opts.distortion ?? 0.025;

	const mat = new THREE.MeshBasicNodeMaterial();
	mat.transparent = true;
	mat.depthWrite = true;
	mat.fog = true;

	const wuv = positionWorld.xz;
	const nA = texture(n1, wuv.mul(0.11).add(vec2(time.mul(0.011), time.mul(0.007)))).xyz.mul(2).sub(1);
	const nB = texture(n2, wuv.mul(0.17).add(vec2(time.mul(-0.009), time.mul(0.013)))).xyz.mul(2).sub(1);
	const nT = nA.add(nB);
	const N = normalize(vec3(nT.x.mul(ripple), 1.0, nT.y.mul(ripple)));
	const offset = nT.xy.mul(distortion);

	let refl = null;
	if (opts.reflScale > 0) {
		refl = reflector({ resolutionScale: opts.reflScale });
		refl.target.rotateX(-Math.PI / 2);
		refl.target.position.y = opts.y ?? 0;
		refl.uvNode = refl.uvNode.add(offset.mul(0.6));
		scene.add(refl.target);
	}

	mat.colorNode = Fn(() => {
		const V = normalize(cameraPosition.sub(positionWorld));
		const fres = float(0.02).add(float(0.98).mul(pow(float(1).sub(max(dot(V, N), 0)), 5.0)));
		// refraction: distorted lookup, but fall back if the distorted sample lies in front of the water
		const rUV = viewportSafeUV(screenUV.add(offset));
		const zD = perspectiveDepthToViewZ(viewportDepthTexture(rUV), cameraNear, cameraFar);
		const valid = step(zD, positionView.z); // scene behind water surface
		const uvF = mix(screenUV, rUV, valid);
		const zF = perspectiveDepthToViewZ(viewportDepthTexture(uvF), cameraNear, cameraFar);
		const thick = max(positionView.z.sub(zF), 0.0);
		const trans = exp(thick.mul(absorb).negate());
		const refr = viewportSharedTexture(uvF).rgb;
		const under = mix(deep.mul(0.35), refr.mul(shallow), trans);
		const reflC = refl ? refl.rgb : vec3(0.6, 0.7, 0.75);
		const c = mix(under, reflC, clamp(fres.mul(reflStrength), 0, 1));
		// soft edge foam-less shoreline fade
		return vec4(c, 1.0);
	})();

	const geo = new THREE.PlaneGeometry(opts.size?.[0] ?? 100, opts.size?.[1] ?? 100);
	geo.rotateX(-Math.PI / 2);
	const mesh = new THREE.Mesh(geo, mat);
	mesh.position.set(opts.center?.[0] ?? 0, opts.y ?? 0, opts.center?.[1] ?? 0);
	mesh.renderOrder = 10;
	scene.add(mesh);

	return {
		mesh, level, refl, shallow, deep, absorb, reflStrength,
		setLevel(y) { level.value = y; mesh.position.y = y; if (refl) refl.target.position.y = y; },
		get y() { return level.value; }
	};
}
