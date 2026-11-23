// LEVEL 3 — THE AQUEDUCT. Endless tiled arcades in shallow water under a sky that isn't real.
// Collect four photographs. The mannequins only move when you aren't looking.
import * as THREE from 'three/webgpu';
import { materialColor, positionWorld, mix, vec3, smoothstep, mx_noise_float } from 'three/tsl';
import { pbr, loadSkyHDR } from '../assets.js';
import { NavGrid, Interactions, boxProjectUVs } from '../world.js';
import { CellWorld, RAMP } from '../cellworld.js';
import { Collision } from '../world.js';
import { createWater, addCaustics } from '../water.js';
import { damp, mulberry32 } from '../util.js';
import { audio } from '../audio.js';
import { ui } from '../ui.js';
import { fx } from '../renderer.js';
import { createMannequin, randomPose } from '../entities.js';
import { createNote, createPhoto, glowMaterial } from '../props.js';

const N = 22, C = 6;             // 22×22 bays of 6 m = 132 m square
const PH = 4.6, AH = 2.9;        // pillar height, arch band height

function archGeometry(span, depth, pillar) {
	const hw = span / 2, r = hw - pillar / 2;
	const s = new THREE.Shape();
	s.moveTo(-hw, 0); s.lineTo(-r, 0);
	s.absarc(0, 0, r, Math.PI, 0, true);
	s.lineTo(hw, 0); s.lineTo(hw, AH); s.lineTo(-hw, AH); s.lineTo(-hw, 0);
	const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false, curveSegments: 28 });
	g.translate(0, PH, -depth / 2);
	return boxProjectUVs(g);
}
function boxGeo(w, h, d, y0) {
	const g = new THREE.BoxGeometry(w, h, d); g.translate(0, y0 + h / 2, 0);
	return boxProjectUVs(g);
}

export default {
	number: 'LEVEL 3', name: 'THE AQUEDUCT', blurb: 'arcades · shallow water · a painted sky',
	subtitle: 'The sky is too still. Like a ceiling someone painted blue.',

	async build(ctx) {
		const { game, player, quality } = ctx;
		const scene = new THREE.Scene();
		const root = new THREE.Group(); scene.add(root);
		const sky = await loadSkyHDR();
		scene.background = sky; scene.backgroundIntensity = 1.0;
		scene.environment = sky; scene.environmentIntensity = 0.45;
		scene.fog = new THREE.Fog(0xcfe0e6, 22, 105);
		const rng = mulberry32(9091);

		// ---------------------------------------------------------- layout (CellWorld; 2 cells per bay)
		const W = N * 2, CS = C / 2;
		const cw = new CellWorld(W, W, CS);
		cw.carve(0, 0, W - 1, W - 1, 0, 9);
		cw.setCeil(0, 0, W - 1, W - 1, 9, true);
		const pools = [[6, 6, 13, 13], [26, 8, 35, 15], [10, 28, 19, 37], [28, 30, 35, 37]];
		pools.forEach(([a, b, c, d]) => {
			cw.setFloor(a, b, c, d, -1.3);
			const mid = Math.floor((a + c) / 2);
			cw.setRamp(mid, d + 1, mid + 1, d + 1, RAMP.N, 0, 1.3);
		});
		// a few solid blocks (bricked-up bays) to break the sightlines
		[[20, 4, 21, 5], [4, 20, 5, 23], [38, 22, 39, 23], [22, 38, 23, 39], [16, 18, 17, 19], [30, 22, 31, 23]].forEach(([a, b, c, d]) => cw.rect(a, b, c, d, k => { cw.open[k] = 0; }));

		// ---------------------------------------------------------- materials
		const [tile, floorTile, aqua] = await Promise.all([
			pbr('pooltile', { color: 0xf3efe6, roughness: 0.6, normalScale: 0.7, physical: { clearcoat: 0.35, clearcoatRoughness: 0.2 } }),
			pbr('bigtile', { color: 0xe9e6dc, roughness: 0.55, normalScale: 0.7, physical: { clearcoat: 0.4, clearcoatRoughness: 0.15 } }),
			pbr('aquatile', { color: 0xc4efe9, roughness: 0.45, normalScale: 0.8 }),
		]);
		// sun-bleached tile with algae creeping up from the water
		const n = mx_noise_float(positionWorld.mul(0.35)).mul(0.5).add(0.5);
		tile.colorNode = materialColor.mul(mix(vec3(0.72, 0.8, 0.7), vec3(1, 1, 1), smoothstep(0.0, n.mul(0.8).add(0.35), positionWorld.y.sub(0.05))));

		const water = await createWater(scene, { size: [W * CS + 60, W * CS + 60], center: [W * CS / 2, W * CS / 2], y: 0.09, reflScale: quality === 'ultra' ? 0.5 : quality === 'high' ? 0.3 : 0, shallow: 0xbff5ea, deep: 0x157a76, absorb: 0.28, ripple: 0.22, distortion: 0.015 });
		[floorTile, aqua, tile].forEach(m => addCaustics(m, water.level, 0.3));

		const mb = cw.build(undefined, (kind, i, j, info) => {
			if (kind === 'floor') return Math.min(...info.h) < -0.05 ? 'aqua' : 'floor';
			if (kind === 'edge') return 'aqua';
			return 'wall';
		});
		root.add(mb.build({ wall: tile, floor: floorTile, aqua }, { receiveShadow: true, castShadow: true }));
		const col = new Collision(6);
		cw.addCollision(col);

		// ---------------------------------------------------------- arcades (instanced)
		const pGeoA = boxGeo(0.9, PH + AH, 0.9, 0), pGeoB = boxGeo(0.9, PH + AH + 1.3, 0.9, -1.3);
		const capGeo = boxGeo(1.15, 0.22, 1.15, PH - 0.22);
		const baseGeo = boxGeo(1.1, 0.35, 1.1, 0);
		const archX = archGeometry(C, 0.9, 0.9);
		const pillarsA = [], pillarsB = [], archesX = [], archesZ = [];
		const isSolidAt = (x, z) => !cw.isOpen(Math.floor(x / CS), Math.floor(z / CS));
		for (let j = 1; j < N; j++) for (let i = 1; i < N; i++) {
			const x = i * C, z = j * C;
			// skip pillars inside solid blocks
			if (isSolidAt(x - 0.5, z - 0.5) && isSolidAt(x + 0.5, z + 0.5)) continue;
			const g = cw.ground(x, z);
			(g < -0.5 ? pillarsB : pillarsA).push([x, z]);
			col.addBox(x - 0.45, z - 0.45, x + 0.45, z + 0.45);
			if (i < N - 1) archesX.push([x + C / 2, z]);
			if (j < N - 1) archesZ.push([x, z + C / 2]);
		}
		const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1), v3 = new THREE.Vector3();
		const inst = (geo, mat, list, rotY = 0, y = 0) => {
			const im = new THREE.InstancedMesh(geo, mat, list.length);
			q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY);
			list.forEach(([x, z], k) => { m4.compose(v3.set(x, y, z), q, one); im.setMatrixAt(k, m4); });
			im.castShadow = true; im.receiveShadow = true;
			im.computeBoundingSphere();
			root.add(im); return im;
		};
		inst(pGeoA, tile, pillarsA); inst(pGeoB, tile, pillarsB);
		inst(capGeo, tile, [...pillarsA, ...pillarsB]); inst(baseGeo, tile, pillarsA);
		inst(archX, tile, archesX, 0); inst(archX, tile, archesZ, Math.PI / 2);

		// ---------------------------------------------------------- light
		const sun = new THREE.DirectionalLight(0xfff0d8, 3.2);
		const sunDir = new THREE.Vector3(-0.45, 0.75, -0.35).normalize();
		sun.castShadow = quality !== 'low';
		sun.shadow.mapSize.set(quality === 'ultra' ? 4096 : 2048, quality === 'ultra' ? 4096 : 2048);
		const sc = sun.shadow.camera; sc.left = -45; sc.right = 45; sc.top = 45; sc.bottom = -45; sc.near = 1; sc.far = 140;
		sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.04;
		root.add(sun, sun.target);
		const hemi = new THREE.HemisphereLight(0xcfe9ff, 0xbfe8dd, 0.55); root.add(hemi);

		// ---------------------------------------------------------- photographs + door
		const inter = new Interactions();
		let photos = 0;
		const ped = await pbr('wood', { color: 0x9c7b56, roughness: 0.8 });
		const photoSpots = [
			{ x: 9.5 * CS, z: 9.5 * CS, y: -1.3, src: 'assets/img/mem1.webp', cap: 'A birthday. The cake has no candles. Nobody has a face.' },
			{ x: 41.5 * CS, z: 3.5 * CS, y: 0, src: 'assets/img/mem2.webp', cap: 'Our old hallway. The door at the end was never there.' },
			{ x: 14.5 * CS, z: 32.5 * CS, y: -1.3, src: 'assets/img/mem3.webp', cap: 'The pool at the hotel, summer \'98. I think I drowned here.' },
			{ x: 40.5 * CS, z: 41.5 * CS, y: 0, src: 'assets/img/mem4.webp', cap: 'My bedroom. The bed is made. I never came home.' },
		];
		for (const p of photoSpots) {
			const table = new THREE.Mesh(boxGeo(0.7, 0.9, 0.5, p.y), ped);
			table.position.set(p.x, 0, p.z); table.castShadow = true; root.add(table);
			col.addBox(p.x - 0.35, p.z - 0.25, p.x + 0.35, p.z + 0.25);
			await createPhoto(root, inter, { x: p.x, y: p.y + 0.905, z: p.z, rotY: rng() * 6, src: p.src, caption: p.cap, onTake: () => onPhoto() });
		}
		// the door: set into the north perimeter wall
		const DX = 23 * CS, DZ = 0.04;
		const doorG = new THREE.Group();
		const frameMat = new THREE.MeshStandardNodeMaterial({ color: 0xf0ede4, roughness: 0.5 });
		const doorMat = await pbr('wood', { color: 0x6e8f92, roughness: 0.7 });
		const fL = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.3, 0.14), frameMat); fL.position.set(-0.56, 1.15, 0);
		const fR = fL.clone(); fR.position.x = 0.56;
		const fT = new THREE.Mesh(new THREE.BoxGeometry(1.24, 0.12, 0.14), frameMat); fT.position.set(0, 2.36, 0);
		const leaf = new THREE.Group(); leaf.position.set(-0.5, 0, 0.02);
		const leafM = new THREE.Mesh(new THREE.BoxGeometry(1.0, 2.25, 0.05), doorMat); leafM.position.set(0.5, 1.125, 0); leaf.add(leafM);
		const knob = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 8), new THREE.MeshStandardNodeMaterial({ color: 0xc8a96a, metalness: 1, roughness: 0.25 })); knob.position.set(0.88, 1.05, 0.05); leaf.add(knob);
		const behind = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 2.25), glowMaterial(0xffffff, 0.0)); behind.position.set(0, 1.125, -0.03);
		doorG.add(fL, fR, fT, leaf, behind); doorG.position.set(DX, 0, DZ); root.add(doorG);
		const doorLight = new THREE.PointLight(0xffe2b0, 0, 8, 1.6); doorLight.position.set(DX, 1.6, 1.2); root.add(doorLight);
		let doorOpen = false;
		inter.add({
			pos: new THREE.Vector3(DX, 1.2, 0.3), radius: 2.6,
			prompt: () => photos < 4 ? `Locked — ${4 - photos} photograph${4 - photos > 1 ? 's' : ''} missing` : doorOpen ? 'Step through' : 'Open the door',
			onUse: () => {
				if (photos < 4) { audio.knock(null, 1); return; }
				if (!doorOpen) { doorOpen = true; audio.doorOpen(); return; }
				game.complete({ white: true });
			}
		});
		createNote(root, inter, { x: 21 * CS, z: 40.6 * CS, rot: 0.3, html: 'Four photographs. They\'re <b>mine</b> — I don\'t remember taking them.<br><br>The door in the <b>north wall</b> won\'t open until I have all four.<br><br>The figures. They weren\'t there when I arrived. <b>Don\'t take your eyes off them.</b> When I blink they are closer.' });

		// ---------------------------------------------------------- mannequins
		const nav = new NavGrid(col, 0, 0, W * CS, W * CS, 1.0, 0.4);
		const mannequins = [];
		const mSpots = [[18, 30], [30, 20], [10, 22], [36, 6], [24, 12], [6, 36], [40, 28], [16, 4], [28, 40], [34, 34], [4, 8], [22, 26]];
		for (const [ci, cj] of mSpots) {
			const m = createMannequin();
			const x = (ci + 0.5) * CS, z = (cj + 0.5) * CS;
			m.root.position.set(x, cw.ground(x, z), z);
			m.root.rotation.y = rng() * 6.28;
			randomPose(m, rng);
			root.add(m.root);
			mannequins.push({ m, x, z, active: false, seenT: 0, moved: false, wasSeen: true });
		}
		const frustum = new THREE.Frustum(), pm = new THREE.Matrix4(), sph = new THREE.Sphere();

		function onPhoto() {
			photos++;
			ui.toast(`PHOTOGRAPH ${photos}/4`);
			updateObjective();
			// wake mannequins progressively, nearest first
			const sleeping = mannequins.filter(o => !o.active).sort((a, b) => Math.hypot(a.x - player.pos.x, a.z - player.pos.z) - Math.hypot(b.x - player.pos.x, b.z - player.pos.z));
			const wake = photos === 1 ? 2 : photos < 4 ? 2 : 4;
			sleeping.slice(0, wake).forEach(o => o.active = true);
			if (photos === 1) setTimeout(() => ui.subtitle('Something scraped across the tile behind me.', 3.5), 1500);
			if (photos === 4) {
				doorLight.intensity = 6; behind.material = glowMaterial(0xfff4dc, 6);
				sky4 = true; audio.stinger(0.8); fx.glitch.value = 0.8;
				ui.subtitle('The sky flickers. Like a screen.', 3.5);
			}
		}
		let sky4 = false;

		// ---------------------------------------------------------- level object
		let T = 0, flood = 0, birdT = 6;
		const level = {
			scene, root, col, nav, interactions: inter,
			spawn: { x: 23 * CS, z: 42.5 * CS, yaw: 0.06 },
			flash: { allowed: false, drain: 0 },
			waterLevel: () => water.y,
			surfaceAt: () => 'tile',
			start() {
				audio.setReverb(3.2, 0.35, 0.6);
				audio.water(0.07); audio.wind(0.05);
				updateObjective();
				setTimeout(() => ui.subtitle('Arches, forever. There is a door somewhere in the north wall.', 4), 3500);
			},
			update(dt, t) {
				T += dt;
				const p = player.pos;
				leaf.rotation.y = damp(leaf.rotation.y, doorOpen ? -1.9 : 0, 2, dt);
				if (doorOpen && p.z < 1.1 && Math.abs(p.x - DX) < 0.7) game.complete({ white: true });
				// sun shadow box follows the player
				sun.position.set(p.x + sunDir.x * 70, sunDir.y * 70, p.z + sunDir.z * 70);
				sun.target.position.set(p.x, 0, p.z);
				// sky "screen" glitch after the fourth photo
				if (sky4) {
					const g = Math.sin(t * 17) * Math.sin(t * 3.1) > 0.92 ? 0.25 : 1;
					scene.backgroundIntensity = damp(scene.backgroundIntensity, 0.55 * g, 6, dt);
					sun.intensity = damp(sun.intensity, 1.4 * g, 4, dt);
					fx.tint.value.setRGB(1.0, damp(fx.tint.value.g, 0.9, 1, dt), damp(fx.tint.value.b, 0.86, 1, dt));
				}
				birdT -= dt; if (birdT < 0 && !sky4) { birdT = 14 + Math.random() * 20; audio.birds(); }

				// mannequin logic: move only when unseen
				const cam = player.cam;
				cam.updateMatrixWorld();
				pm.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse); frustum.setFromProjectionMatrix(pm);
				flood -= dt;
				if (flood <= 0) { nav.flood(p.x, p.z); flood = 0.5; }
				let nearest = 99;
				for (const o of mannequins) {
					const d = Math.hypot(o.x - p.x, o.z - p.z);
					sph.center.set(o.x, o.m.root.position.y + 1.0, o.z); sph.radius = 1.0;
					const inView = frustum.intersectsSphere(sph) && col.los(cam.position.x, cam.position.z, o.x, o.z, 1.5);
					if (!o.active) { if (!inView && d > 10 && rng() < dt * 0.05) { o.m.root.rotation.y = Math.atan2(p.x - o.x, p.z - o.z); } continue; }
					nearest = Math.min(nearest, d);
					if (inView) {
						if (!o.wasSeen && o.moved && d < 22) { audio.clack({ x: o.x, y: 1, z: o.z }); fx.glitch.value = Math.max(fx.glitch.value, 0.15); if (d < 8) audio.stinger(0.4); }
						o.wasSeen = true; o.moved = false;
						continue;
					}
					o.wasSeen = false;
					if (d > 40) continue;
					// step along the flow field toward the player
					const speed = d < 6 ? 2.0 : 3.6;
					const nx = nav.nextStep(o.x, o.z, { x: 0, z: 0 });
					let tx = nx ? nx.x : p.x, tz = nx ? nx.z : p.z;
					if (col.los(o.x, o.z, p.x, p.z, 1.0)) { tx = p.x; tz = p.z; }
					const dx = tx - o.x, dz = tz - o.z, l = Math.hypot(dx, dz) || 1;
					const s = Math.min(l, speed * dt);
					o.x += dx / l * s; o.z += dz / l * s; o.moved = true;
					o.m.root.position.set(o.x, cw.ground(o.x, o.z), o.z);
					o.m.root.rotation.y = Math.atan2(p.x - o.x, p.z - o.z);
					if (rng() < dt * 1.5) { randomPose(o.m, rng); audio.scrape({ x: o.x, y: 0.2, z: o.z }); }
					if (d < 0.95) { game.die('It was standing right behind you.'); }
				}
				game.setFear(nearest < 4 ? 0.85 : nearest < 9 ? 0.5 : nearest < 16 ? 0.25 : 0);
			},
			dispose() { fx.tint.value.setRGB(1, 1, 1); }
		};
		function updateObjective() {
			ui.setObjective('LEVEL 3 · THE AQUEDUCT', photos < 4 ? `Find the photographs (${photos}/4)` : 'Find the door in the north wall');
		}
		return level;
	}
};
