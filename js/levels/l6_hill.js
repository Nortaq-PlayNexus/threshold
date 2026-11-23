// ∞ — THE HILL. Open sky, wind in the grass, a lone door at the top.
import * as THREE from 'three/webgpu';
import { positionLocal, uv, time, vec3, sin, mix, float, color, mx_noise_float } from 'three/tsl';
import { pbr, loadSkyHDR } from '../assets.js';
import { Collision, Interactions } from '../world.js';
import { damp, mulberry32, fbm } from '../util.js';
import { audio } from '../audio.js';
import { ui } from '../ui.js';
import { fx } from '../renderer.js';
import { glowMaterial } from '../props.js';

const height = (x, z) => 14 * Math.exp(-(x * x + z * z) / (2 * 45 * 45)) + Math.sin(x * 0.045) * Math.cos(z * 0.038) * 1.6 + Math.sin(x * 0.11 + z * 0.07) * 0.35;

export default {
	number: '∞', name: 'THE HILL', blurb: 'wind · grass · a door',
	subtitle: 'It is quiet here. The kind of quiet that means it is almost over.',

	async build(ctx) {
		const { game, player, quality } = ctx;
		const scene = new THREE.Scene();
		const root = new THREE.Group(); scene.add(root);
		const sky = await loadSkyHDR();
		scene.background = sky; scene.backgroundIntensity = 1.15;
		scene.environment = sky; scene.environmentIntensity = 0.7;
		scene.fog = new THREE.Fog(0xcfdde6, 60, 260);
		const rng = mulberry32(1111);

		// ---------------------------------------------------------- terrain
		const ground = await pbr('grass', { color: 0x9fb07a, roughness: 1, normalScale: 1.0 });
		const SZ = 420, SEG = quality === 'low' ? 160 : 256;
		const tg = new THREE.PlaneGeometry(SZ, SZ, SEG, SEG); tg.rotateX(-Math.PI / 2); tg.translate(0, 0, 40);
		const pos = tg.attributes.position, uvA = tg.attributes.uv;
		for (let i = 0; i < pos.count; i++) { const x = pos.getX(i), z = pos.getZ(i); pos.setY(i, height(x, z)); uvA.setXY(i, x, -z); }
		tg.computeVertexNormals();
		const terrain = new THREE.Mesh(tg, ground); terrain.receiveShadow = true; root.add(terrain);

		// ---------------------------------------------------------- grass (instanced, wind in TSL)
		const COUNT = quality === 'ultra' ? 200000 : quality === 'high' ? 120000 : 40000;
		const bg = new THREE.BufferGeometry();
		{
			const segs = 4, P = [], U = [], N = [], I = [];
			for (let bl = 0; bl < 3; bl++) {
				const ang = bl * 2.094 + 0.3, ca = Math.cos(ang), sa = Math.sin(ang);
				const ox = Math.cos(ang + 1.3) * 0.05, oz = Math.sin(ang + 1.3) * 0.05, hs = 1 - bl * 0.18;
				const base = P.length / 3;
				for (let s = 0; s <= segs; s++) {
					const t = s / segs, w = 0.016 * (1 - t * 0.9), y = t * hs, bend = t * t * 0.18;
					// local blade: x = ±w, z = bend → rotate by ang
					for (const sx of [-w, w]) P.push(ox + sx * ca - bend * sa, y, oz + sx * sa + bend * ca);
					U.push(0, t, 1, t); N.push(0, 1, 0.3, 0, 1, 0.3);
					if (s < segs) { const b = base + s * 2; I.push(b, b + 1, b + 2, b + 1, b + 3, b + 2); }
				}
			}
			bg.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
			bg.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
			bg.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
			bg.setIndex(I);
		}
		const gm = new THREE.MeshStandardNodeMaterial({ side: THREE.DoubleSide, roughness: 0.75 });
		const h = uv().y;
		const wp = positionLocal; // already instance-transformed when positionNode is evaluated
		const gust = mx_noise_float(vec3(wp.x.mul(0.04).add(time.mul(0.35)), 0, wp.z.mul(0.04).add(time.mul(0.12)))).mul(0.5).add(0.5);
		const sway = sin(time.mul(2.1).add(wp.x.mul(0.6)).add(wp.z.mul(0.45))).mul(0.12).add(gust.mul(0.55));
		const bendAmt = h.mul(h);
		gm.positionNode = wp.add(vec3(sway.mul(bendAmt).mul(0.8), sway.mul(bendAmt).mul(-0.18), sway.mul(bendAmt).mul(0.35)));
		gm.colorNode = mix(color(0x24401a), color(0xa8b85a), h.mul(0.85).add(gust.mul(0.15)));
		gm.emissiveNode = color(0x2a3410).mul(h).mul(gust).mul(0.35);
		const grass = new THREE.InstancedMesh(bg, gm, COUNT);
		const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), v = new THREE.Vector3(), e = new THREE.Euler(), c = new THREE.Color();
		for (let k = 0; k < COUNT; k++) {
			let x, z;
			if (k < COUNT * 0.65) { // dense band along the walk up the hill
				const t = rng(); z = -20 + t * 160; x = (rng() - 0.5) * 2 * (18 + rng() * 26);
			} else { x = (rng() - 0.5) * 200; z = -80 + rng() * 230; }
			const s = 0.35 + rng() * 0.55;
			e.set((rng() - 0.5) * 0.25, rng() * Math.PI * 2, (rng() - 0.5) * 0.25);
			q.setFromEuler(e); sc.set(0.8 + rng() * 0.7, s, 1);
			m4.compose(v.set(x, height(x, z) - 0.03, z), q, sc);
			grass.setMatrixAt(k, m4);
			c.setHSL(0.2 + rng() * 0.07, 0.35 + rng() * 0.25, 0.55 + rng() * 0.3); grass.setColorAt(k, c);
		}
		grass.computeBoundingSphere();
		grass.frustumCulled = false;
		root.add(grass);

		// ---------------------------------------------------------- light
		const sun = new THREE.DirectionalLight(0xfff0d0, 3.0);
		sun.position.set(-60, 80, -40); sun.target.position.set(0, 0, 20);
		sun.castShadow = quality !== 'low'; sun.shadow.mapSize.set(2048, 2048);
		const s2 = sun.shadow.camera; s2.left = -60; s2.right = 60; s2.top = 60; s2.bottom = -60; s2.far = 250;
		sun.shadow.bias = -0.0005;
		root.add(sun, sun.target);
		root.add(new THREE.HemisphereLight(0xdbeeff, 0x6f7a40, 0.6));

		// ---------------------------------------------------------- the door
		const topY = height(0, 0);
		const door = new THREE.Group();
		const frameMat = new THREE.MeshStandardNodeMaterial({ color: 0xf4f1ea, roughness: 0.45 });
		const wood = await pbr('wood', { color: 0xf0ece4, roughness: 0.5 });
		const fL = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.3, 0.18), frameMat); fL.position.set(-0.56, 1.15, 0); fL.castShadow = true;
		const fR = fL.clone(); fR.position.x = 0.56;
		const fT = new THREE.Mesh(new THREE.BoxGeometry(1.24, 0.12, 0.18), frameMat); fT.position.set(0, 2.36, 0); fT.castShadow = true;
		const leaf = new THREE.Group(); leaf.position.set(-0.5, 0, 0);
		const lm = new THREE.Mesh(new THREE.BoxGeometry(1.0, 2.25, 0.05), wood); lm.position.set(0.5, 1.125, 0); lm.castShadow = true; leaf.add(lm);
		const knob = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 8), new THREE.MeshStandardNodeMaterial({ color: 0xd8bc7a, metalness: 1, roughness: 0.2 })); knob.position.set(0.88, 1.05, 0.05); leaf.add(knob);
		const light = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 2.25), glowMaterial(0xfff8ec, 0.01)); light.position.set(0, 1.125, -0.01); light.rotation.y = Math.PI;
		const lightFront = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 2.25), glowMaterial(0xfff8ec, 0.01)); lightFront.position.set(0, 1.125, -0.012);
		door.add(fL, fR, fT, leaf, light, lightFront);
		door.position.set(0, topY - 0.05, 0); root.add(door);
		const doorGlow = new THREE.PointLight(0xfff2d8, 0, 12, 1.2); doorGlow.position.set(0, topY + 1.2, 1.2); root.add(doorGlow);

		const col = new Collision(8);
		col.ground = height;
		col.addBox(-0.62, -0.1, -0.5, 0.1); col.addBox(0.5, -0.1, 0.62, 0.1);
		col.addBox(-0.5, -0.06, 0.5, 0.0, -100, 100, 'door');
		col.addBox(-110, -90, -100, 160); col.addBox(100, -90, 110, 160); col.addBox(-110, -100, 110, -90); col.addBox(-110, 150, 110, 160);
		const inter = new Interactions();
		let opened = false, openT = 0;
		inter.add({
			pos: new THREE.Vector3(0, topY + 1.1, 0.1), radius: 2.6, prompt: () => opened ? '' : 'Open the door',
			onUse: () => {
				if (opened) return; opened = true; audio.doorOpen();
				ui.subtitle('Warm light. The smell of my own room.', 4);
				setTimeout(() => game.complete({ white: true }), 4200);
			}
		});

		// ---------------------------------------------------------- level object
		let birdT = 4, said = false;
		const level = {
			scene, root, col, interactions: inter,
			spawn: { x: 0, z: 120, yaw: 0 },
			flash: { allowed: false, drain: 0 },
			speedMul: 0.85,
			surfaceAt: () => 'grass',
			start() {
				audio.setReverb(1.5, 0.3, 0.12);
				audio.wind(0.12);
				audio.musicBox(0.03, [64, 67, 71, 72, 71, 67, 64, 0, 62, 66, 69, 71, 69, 66, 62, 0], 0.85);
				ui.setObjective('∞ · THE HILL', 'Walk up the hill');
				setTimeout(() => ui.subtitle('Grass. Real wind. Real sky...?', 4), 3500);
			},
			update(dt, t) {
				const p = player.pos;
				birdT -= dt; if (birdT < 0) { birdT = 7 + Math.random() * 12; audio.birds(); }
				const d = Math.hypot(p.x, p.z);
				if (!said && d < 25) { said = true; ui.setObjective('∞ · THE HILL', 'Open the door'); ui.subtitle('A door. Standing on its own. It\'s my bedroom door.', 4); }
				// warm light leaks around the door as you approach
				const near = Math.max(0, 1 - d / 30);
				doorGlow.intensity = opened ? damp(doorGlow.intensity, 60, 1.5, dt) : near * 3;
				if (opened) {
					openT = Math.min(1, openT + dt / 2.5);
					leaf.rotation.y = -openT * 1.7;
					light.material.color.setScalar(1 + openT * 8); lightFront.material.color.setScalar(1 + openT * 8);
					fx.exposure.value = 1 + openT * 0.8;
				}
				fx.vignette.value = damp(fx.vignette.value, 0.35, 1, dt);
			},
			dispose() { fx.exposure.value = 1; }
		};
		return level;
	}
};
