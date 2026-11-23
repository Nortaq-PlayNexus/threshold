// WebGPURenderer + TSL RenderPipeline (GTAO → TRAA → bloom → AgX → horror grade).
import * as THREE from 'three/webgpu';
import {
	pass, mrt, normalView, velocity, packNormalToRGB, unpackRGBToNormal, sample, screenUV, screenSize,
	builtinAOContext, uniform, vec2, vec3, vec4, float, Fn, time, hash, mix, smoothstep, length, dot, sin,
	floor, step, luminance, renderOutput, convertToTexture, clamp, max, abs, fract, cos
} from 'three/tsl';
import { ClusteredLighting } from 'three/addons/lighting/ClusteredLighting.js';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { traa } from 'three/addons/tsl/display/TRAANode.js';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { fxaa } from 'three/addons/tsl/display/FXAANode.js';

// Global FX uniforms the game drives every frame.
export const fx = {
	fear: uniform(0),        // 0..1 – desaturation, CA, VHS jitter
	glitch: uniform(0),      // spikes on scares
	damage: uniform(0),      // red flash
	under: uniform(0),       // underwater tint
	vignette: uniform(0.55),
	grain: uniform(0.045),
	scan: uniform(0.35),
	bright: uniform(1),
	exposure: uniform(1),
	bloomStrength: uniform(0.35),
	vhs: uniform(1),
	tint: uniform(new THREE.Color(1, 1, 1)),
};

export class Renderer {
	constructor(canvas) {
		this.canvas = canvas;
		this.quality = 'high';
		this.pipeline = null;
	}

	async init() {
		const forceWebGL = !!new URLSearchParams(location.search).get('gl');
		const r = new THREE.WebGPURenderer({ canvas: this.canvas, antialias: false, powerPreference: 'high-performance', forceWebGL });
		this.lighting = new ClusteredLighting(1024, 32, 24, 96);
		if (!new URLSearchParams(location.search).get('nocluster')) r.lighting = this.lighting;
		r.toneMapping = THREE.AgXToneMapping;
		r.toneMappingExposure = 1.0;
		r.shadowMap.enabled = true;
		r.shadowMap.type = THREE.PCFShadowMap;
		await r.init();
		this.r = r;
		this.isWebGPU = r.backend.isWebGPUBackend === true;
		this.resize();
		window.addEventListener('resize', () => this.resize());
		return this;
	}

	get maxAniso() { return this.r.getMaxAnisotropy ? this.r.getMaxAnisotropy() : 8; }

	pixelRatio() {
		const dpr = window.devicePixelRatio || 1;
		if (this.quality === 'low') return Math.min(dpr, 1) * 0.8;
		if (this.quality === 'high') return Math.min(dpr, 1.25);
		return Math.min(dpr, 1.5);
	}

	resize() {
		if (!this.r) return;
		this.r.setPixelRatio(this.pixelRatio());
		this.r.setSize(window.innerWidth, window.innerHeight, false);
		if (this.camera) {
			this.camera.aspect = window.innerWidth / window.innerHeight;
			this.camera.updateProjectionMatrix();
		}
	}

	setQuality(q) {
		this.quality = q;
		this.resize();
		if (this.scene) this.buildPipeline(this.scene, this.camera);
	}

	buildPipeline(scene, camera) {
		this.scene = scene; this.camera = camera;
		if (this.pipeline) { this.pipeline.dispose(); this.pipeline = null; }
		const rp = new THREE.RenderPipeline(this.r);
		rp.outputColorTransform = false;

		let color;
		const ultra = this.quality === 'ultra';
		if (ultra) {
			// Prepass: view normals + velocity for GTAO and TRAA
			const pre = pass(scene, camera);
			pre.name = 'prepass';
			pre.transparent = false;
			pre.setMRT(mrt({ output: packNormalToRGB(normalView), velocity }));
			pre.getTexture('output').type = THREE.UnsignedByteType;
			const preNormal = sample((uv) => unpackRGBToNormal(pre.getTextureNode().sample(uv)));
			const preDepth = pre.getTextureNode('depth');
			const preVel = pre.getTextureNode('velocity');

			const scenePass = pass(scene, camera);
			const aoPass = ao(preDepth, preNormal, camera);
			aoPass.resolutionScale = 0.5;
			aoPass.samples.value = 12;
			aoPass.radius.value = 0.6;
			if (aoPass.thickness) aoPass.thickness.value = 1;
			scenePass.contextNode = builtinAOContext(aoPass.getTextureNode().sample(screenUV).r);
			const t = traa(scenePass, preDepth, preVel, camera);
			t.useSubpixelCorrection = false;
			color = t;
			this.aoPass = aoPass;
		} else {
			const scenePass = pass(scene, camera);
			color = scenePass;
		}

		const bloomPass = bloom(color, 0.35, 0.55, 0.92);
		this.bloomPass = bloomPass;
		const hdr = color.add(bloomPass).mul(fx.exposure);
		let ldr = renderOutput(hdr);
		if (!ultra) ldr = fxaa(ldr);
		const ldrTex = convertToTexture(ldr);

		const dbg = new URLSearchParams(location.search).get('dbg');
		if (dbg === 'raw') rp.outputNode = renderOutput(color);
		else if (dbg === 'ldr') rp.outputNode = ldr;
		else rp.outputNode = gradeNode(ldrTex);
		this.pipeline = rp;
	}

	render() {
		if (this.bloomPass) this.bloomPass.strength.value = fx.bloomStrength.value;
		if (this.pipeline) this.pipeline.render();
	}
}

// The final "found-footage" grade, written entirely in TSL.
function gradeNode(src) {
	return Fn(() => {
		const uv = screenUV.toVar();
		const px = screenUV.mul(screenSize);

		// underwater wobble
		uv.addAssign(vec2(sin(uv.y.mul(30).add(time.mul(2.0))), cos(uv.x.mul(24).add(time.mul(1.7)))).mul(0.003).mul(fx.under));

		// VHS tracking jitter: whole scanline bands shift sideways
		const band = floor(uv.y.mul(180));
		const tick = floor(time.mul(20));
		const r1 = hash(band.add(tick.mul(311)));
		const strength = fx.fear.mul(0.004).add(fx.glitch.mul(0.04)).mul(fx.vhs);
		const active = step(float(0.92).sub(fx.glitch.mul(0.5)).sub(fx.fear.mul(0.1)), hash(band.mul(0.731).add(tick)));
		uv.x.addAssign(r1.sub(0.5).mul(strength).mul(active));

		// radial chromatic aberration
		const d = uv.sub(0.5);
		const ca = float(0.0015).add(fx.fear.mul(0.006)).add(fx.glitch.mul(0.02)).mul(dot(d, d).mul(4).add(0.2)).mul(fx.vhs.mul(0.7).add(0.3));
		const cr = src.sample(uv.add(d.mul(ca))).r;
		const cg = src.sample(uv).g;
		const cb = src.sample(uv.sub(d.mul(ca))).b;
		const c = vec3(cr, cg, cb).toVar();

		// fear desaturation + underwater tint + global tint
		c.assign(mix(c, vec3(luminance(c)), fx.fear.mul(0.45)));
		c.assign(mix(c, c.mul(vec3(0.55, 0.95, 1.0)).add(vec3(0.0, 0.03, 0.04)), fx.under));
		c.mulAssign(fx.tint);
		c.assign(mix(c, vec3(luminance(c).mul(1.3), luminance(c).mul(0.15), luminance(c).mul(0.12)), fx.damage));

		// vignette
		const v = smoothstep(0.95, 0.2, length(d.mul(vec2(1.0, 0.85))));
		c.mulAssign(mix(float(1), v, fx.vignette.add(fx.fear.mul(0.3))));

		// scanlines + grain
		const sl = sin(px.y.mul(3.14159)).mul(0.5).add(0.5);
		c.mulAssign(float(1).sub(sl.mul(0.06).mul(fx.scan).mul(fx.vhs)));
		const g = hash(px.x.add(px.y.mul(1931.0)).add(fract(time.mul(13.37)).mul(10000.0)));
		c.addAssign(g.sub(0.5).mul(fx.grain.add(fx.fear.mul(0.05))).mul(fx.vhs.mul(0.6).add(0.4)));

		c.mulAssign(fx.bright);
		return vec4(clamp(c, 0, 1), 1);
	})();
}
