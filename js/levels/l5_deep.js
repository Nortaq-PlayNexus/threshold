// LEVEL 5 — THE DEEP END. Flooded drains under the pools. Emergency lights.
// Pull two levers to open the floodgate. Something is in the water with you.
import * as THREE from 'three/webgpu';
import { materialColor, positionWorld, mix, vec3, smoothstep, mx_noise_float } from 'three/tsl';
import { pbr } from '../assets.js';
import { Collision, NavGrid, Interactions, tiledCylinder } from '../world.js';
import { CellWorld } from '../cellworld.js';
import { createWater, addCaustics } from '../water.js';
import { damp, clamp, mulberry32 } from '../util.js';
import { audio } from '../audio.js';
import { ui } from '../ui.js';
import { fx } from '../renderer.js';
import { createHollow, Hunter } from '../entities.js';
import { createNote, glowMaterial } from '../props.js';

const W = 36, H = 32, C = 2;
const WATER = 0.55;

export default {
	number: 'LEVEL 5', name: 'THE DEEP END', blurb: 'flooded drains · emergency light · it hunts',
	subtitle: 'Below the pools there is a place where the water goes. It is dark there.',

	async build(ctx) {
		const { game, player, quality } = ctx;
		const scene = new THREE.Scene();
		const root = new THREE.Group(); scene.add(root);
		scene.background = new THREE.Color(0x010202);
		scene.fog = new THREE.Fog(0x030605, 4, 38);
		const rng = mulberry32(5150);

		// ---------------------------------------------------------- layout
		const cw = new CellWorld(W, H, C);
		const T = 3.2;
		cw.carve(2, 26, 7, 30, 0, 3.6);          // S: entry sump
		cw.carve(8, 28, 13, 29, 0, T);            // tunnel S→B
		cw.carve(12, 26, 13, 27, 0, T);
		cw.carve(8, 14, 21, 25, 0, 5.0);          // B: cistern hall
		cw.carve(4, 9, 5, 25, 0, T);              // A: west drain
		cw.carve(1, 4, 8, 8, 0, 3.8);             // R: control room
		cw.carve(22, 19, 27, 20, 0, T);           // C: tunnel B→P
		cw.carve(28, 13, 34, 24, 0, 4.4);         // P: pump room
		cw.carve(15, 9, 16, 13, 0, T);            // D: B→F
		cw.carve(11, 4, 21, 8, 0, 4.6);           // F: floodgate chamber
		cw.carve(9, 6, 10, 7, 0, T);              // R↔F
		cw.carve(22, 6, 30, 7, 0, T);             // F↔P loop
		cw.carve(29, 8, 30, 12, 0, T);
		cw.carve(15, 0, 17, 3, -0.9, 20);         // E: the shaft beyond the gate
		cw.setCeil(15, 0, 17, 3, 20, true);
		// low sections & steps for variety
		cw.setCeil(4, 14, 5, 18, 2.4); cw.setCeil(24, 19, 25, 20, 2.3);
		cw.setFloor(8, 14, 21, 15, -0.3); cw.setFloor(28, 21, 34, 24, -0.35);

		// ---------------------------------------------------------- materials
		const [wall, floor, metal, rust] = await Promise.all([
			pbr('bunker', { color: 0x9aa59c, roughness: 1, normalScale: 1.2 }),
			pbr('concrete', { color: 0x7d857c, roughness: 0.9, normalScale: 1.0 }),
			pbr('metal', { color: 0x8a8f8c, roughness: 0.7 }),
			pbr('metal', { color: 0x8a5a3a, roughness: 0.9, metalness: 0.6 }),
		]);
		// water-line staining
		const sn = mx_noise_float(positionWorld.mul(0.6)).mul(0.5).add(0.5);
		wall.colorNode = materialColor.mul(mix(vec3(0.32, 0.38, 0.3), vec3(1, 1, 1), smoothstep(WATER - 0.1, sn.mul(0.6).add(WATER + 0.35), positionWorld.y)));

		const water = await createWater(scene, { size: [W * C + 10, H * C + 10], center: [W * C / 2, H * C / 2], y: WATER, reflScale: quality === 'ultra' ? 0.4 : quality === 'high' ? 0.25 : 0, shallow: 0x3b5a46, deep: 0x041210, absorb: 0.9, ripple: 0.25, distortion: 0.02 });

		const mb = cw.build(undefined, (kind) => kind === 'floor' ? 'floor' : kind === 'ceil' ? 'ceil' : 'wall');
		root.add(mb.build({ wall, floor, ceil: floor }, { receiveShadow: true, castShadow: true }));
		const col = new Collision(4);
		cw.addCollision(col);

		// cistern pillars + pipes
		const pillarGeo = tiledCylinder(0.45, 5.3, 28);
		for (let j = 16; j <= 23; j += 3) for (let i = 10; i <= 19; i += 3) {
			const x = (i + 0.5) * C, z = (j + 0.5) * C;
			const m = new THREE.Mesh(pillarGeo, wall); m.position.set(x, 5.3 / 2 - 0.3, z); m.castShadow = m.receiveShadow = true; root.add(m);
			col.addCircle(x, z, 0.47);
		}
		const pipeGeo = new THREE.CylinderGeometry(0.16, 0.16, 1, 16); pipeGeo.rotateZ(Math.PI / 2);
		const pipe = (x0, x1, y, z) => { const m = new THREE.Mesh(pipeGeo, rust); m.scale.x = Math.abs(x1 - x0); m.position.set((x0 + x1) / 2, y, z); root.add(m); };
		const pipeZ = (z0, z1, y, x) => { const m = new THREE.Mesh(pipeGeo, rust); m.scale.x = Math.abs(z1 - z0); m.rotation.y = Math.PI / 2; m.position.set(x, y, (z0 + z1) / 2); root.add(m); };
		pipe(44, 56, 2.7, 38.3); pipe(44, 56, 2.35, 38.3); pipeZ(18, 50, 2.1, 8.25); pipe(56, 70, 3.8, 26.3); pipeZ(28, 48, 3.6, 68.3);

		// ---------------------------------------------------------- emergency lights
		const lampRed = glowMaterial(0xff2a14, 5), lampOff = glowMaterial(0x220604, 1);
		const lampGeo = new THREE.BoxGeometry(0.34, 0.14, 0.12);
		const lamps = [];
		const addLamp = (x, y, z, ry, color = 0xff2a14, dist = 13, inten = 9) => {
			const m = new THREE.Mesh(lampGeo, color === 0xff2a14 ? lampRed : glowMaterial(color, 5)); m.position.set(x, y, z); m.rotation.y = ry; root.add(m);
			const L = new THREE.PointLight(color, inten, dist, 1.5); L.position.set(x + Math.sin(ry) * 0.4, y - 0.1, z + Math.cos(ry) * 0.4); root.add(L);
			lamps.push({ m, L, base: inten, onMat: m.material, flick: color === 0xff2a14 && rng() < 0.3, ph: rng() * 10 });
		};
		addLamp(4.02, 2.8, 57, Math.PI / 2); addLamp(14, 2.8, 52.02, 0); addLamp(22, 2.4, 59.98, Math.PI);
		addLamp(16.02, 4.0, 36, Math.PI / 2); addLamp(43.98, 4.0, 32, -Math.PI / 2); addLamp(22, 4.2, 28.02, 0); addLamp(36, 4.2, 51.98, Math.PI);
		addLamp(8.02, 2.2, 30, Math.PI / 2); addLamp(11.98, 2.6, 44, -Math.PI / 2);
		addLamp(2.02, 3.0, 15, Math.PI / 2);
		addLamp(50, 2.6, 38.02, 0);
		addLamp(56.02, 3.6, 30, Math.PI / 2); addLamp(69.98, 3.6, 44, -Math.PI / 2);
		addLamp(52, 2.6, 12.02, 0); addLamp(58.02, 2.6, 22, Math.PI / 2);
		addLamp(20, 2.6, 12.02, 0); addLamp(30.02, 2.6, 22, Math.PI / 2);
		addLamp(22.02, 3.8, 10, Math.PI / 2); addLamp(43.98, 3.8, 17, -Math.PI / 2);
		// the gate's beacon (amber, stronger)
		addLamp(28, 4.2, 8.02, 0, 0xffa020, 14, 10);
		const hemi = new THREE.HemisphereLight(0x2a3a30, 0x0a100c, 0.22); root.add(hemi);

		// ---------------------------------------------------------- floodgate + shaft
		const gate = new THREE.Group();
		const gateW = 6;
		const slab = new THREE.Mesh(new THREE.BoxGeometry(gateW, 4.4, 0.25), metal); slab.position.set(0, 2.2, 0); slab.castShadow = true; gate.add(slab);
		for (let k = 0; k < 6; k++) { const rib = new THREE.Mesh(new THREE.BoxGeometry(gateW, 0.12, 0.12), rust); rib.position.set(0, 0.4 + k * 0.72, 0.17); gate.add(rib); }
		gate.position.set(16.5 * C + 0, 0, 8 - 0.13); root.add(gate);
		const gateCol = col.addBox(30, 7.7, 36, 8.05);
		const shaftLight = new THREE.SpotLight(0xbfffe0, 260, 30, 0.6, 0.7, 1.1); shaftLight.position.set(33, 18, 3); shaftLight.target.position.set(33, -1, 3); root.add(shaftLight, shaftLight.target);
		const shaftGlow = new THREE.Mesh(new THREE.CircleGeometry(3.2, 40), glowMaterial(0xd8fff0, 3)); shaftGlow.rotation.x = Math.PI / 2; shaftGlow.position.set(33, 19.5, 4); root.add(shaftGlow);
		// shaft ladder
		for (let k = 0; k < 24; k++) { const r = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.5, 8), metal); r.rotation.z = Math.PI / 2; r.position.set(33, 0.4 + k * 0.32, 0.12); root.add(r); }
		const rails = new THREE.Mesh(new THREE.BoxGeometry(0.04, 8, 0.04), metal); rails.position.set(32.75, 4, 0.12); root.add(rails); const rails2 = rails.clone(); rails2.position.x = 33.25; root.add(rails2);

		// ---------------------------------------------------------- interactions: levers, batteries
		const inter = new Interactions();
		let levers = 0, gateOpen = false, gateT = 0;
		const makeLever = (x, z, ry, name) => {
			const g = new THREE.Group();
			const box = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.8, 0.22), metal); box.position.set(0, 1.5, 0.11); g.add(box);
			const stripe = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.08), glowMaterial(0xffb000, 1.5)); stripe.position.set(0, 1.95, 0.225); g.add(stripe);
			const pivot = new THREE.Group(); pivot.position.set(0, 1.5, 0.25);
			const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.55, 10), new THREE.MeshPhysicalNodeMaterial({ color: 0xc81e14, roughness: 0.4, clearcoat: 0.8 })); handle.position.y = 0.27; pivot.add(handle);
			const grip = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 8), handle.material); grip.position.y = 0.55; pivot.add(grip);
			pivot.rotation.x = -0.6; g.add(pivot);
			g.position.set(x, 0, z); g.rotation.y = ry; root.add(g);
			const light = new THREE.PointLight(0xffb000, 2.5, 4, 1.6); light.position.set(x + Math.sin(ry) * 0.6, 2.1, z + Math.cos(ry) * 0.6); root.add(light);
			let done = false;
			const it = inter.add({
				pos: new THREE.Vector3(x + Math.sin(ry) * 0.25, 1.6, z + Math.cos(ry) * 0.25), radius: 2.4, hold: 1.6,
				prompt: () => `Pull lever (${name})`,
				onHold: (f) => { pivot.rotation.x = -0.6 + f * 1.8; },
				onUse: () => {
					if (done) return; done = true; it.enabled = false; pivot.rotation.x = 1.2; light.color.setHex(0x30ff60);
					levers++; audio.clang(); audio.thunk();
					ui.toast(`LEVER ${levers}/2`);
					if (levers === 1) { ui.subtitle('The clang echoes down every tunnel. Something heard it.', 4); setTimeout(spawnHollowFar, 2500); }
					else { gateOpen = true; audio.gurgle(); ui.subtitle('Somewhere north, a great gate begins to grind upward.', 4); hollow.alwaysHunt = true; hollow.speedChase = 3.1; }
					updateObjective();
				}
			});
		};
		makeLever(35 * C - 0.02, 18.5 * C, -Math.PI / 2, 'pump room');
		makeLever(1 * C + 0.02, 5.5 * C, Math.PI / 2, 'control room');
		const batMat = new THREE.MeshStandardNodeMaterial({ color: 0x1a1a1a, roughness: 0.5, metalness: 0.4 });
		const batTop = new THREE.MeshStandardNodeMaterial({ color: 0xc9a227, roughness: 0.3, metalness: 0.8 });
		const batteries = [[6.5, 29.5], [9.5, 16.5], [33.5, 14.5], [2.5, 7.5], [25.5, 6.5], [20.5, 24.5], [15.5, 10.5]];
		const shelfY = 1.0;
		for (const [ci, cj] of batteries) {
			const x = ci * C, z = cj * C;
			const g = new THREE.Group();
			const crate = new THREE.Mesh(new THREE.BoxGeometry(0.6, shelfY, 0.6), rust); crate.position.y = shelfY / 2; g.add(crate);
			const b = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.13, 14), batMat); b.position.y = shelfY + 0.065; g.add(b);
			const bt = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.036, 0.03, 14), batTop); bt.position.y = shelfY + 0.115; g.add(bt);
			const glint = new THREE.PointLight(0x9fd0ff, 0.6, 2.2, 2); glint.position.y = shelfY + 0.5; g.add(glint);
			g.position.set(x, 0, z); root.add(g);
			col.addBox(x - 0.3, z - 0.3, x + 0.3, z + 0.3);
			const it = inter.add({ pos: new THREE.Vector3(x, shelfY + 0.1, z), radius: 2.2, prompt: 'Take battery', onUse: () => { audio.pickup(); player.battery = Math.min(1, player.battery + 0.6); g.remove(b, bt, glint); inter.remove(it); ui.toast('BATTERY +60%'); } });
		}
		createNote(root, inter, { x: 4.6 * C, y: 1.4, z: 30.98 * C, wall: Math.PI, html: 'MAINTENANCE — LOWER DRAINS<br><br>Floodgate requires <b>two</b> release levers:<br>· <b>PUMP ROOM</b> (east)<br>· <b>CONTROL ROOM</b> (north-west)<br><br>Emergency lighting only. Carry a torch and spare cells.<br><br><i>someone scratched underneath:</i><br><b>it can\'t see in the dark. neither can you.<br>it hears the water move. walk slow. crouch.</b>' });

		// ---------------------------------------------------------- hunter
		const nav = new NavGrid(col, 0, 0, W * C, H * C, 1.0, 0.35);
		const hollow = new Hunter({ root, col, nav, lit: false }, createHollow(), { walk: 1.3, chase: 3.3, sight: 20, hearing: 15, splash: true });
		function spawnHollowFar() {
			nav.flood(player.pos.x, player.pos.z);
			let best = null;
			for (let k = 0; k < 400; k++) {
				const p = nav.randomFree(rng); if (!p) continue;
				if (p.z < 8.5) continue;
				const d = nav.distAt(p.x, p.z);
				if (d > 24 && d < 50 && !col.los(p.x, p.z, player.pos.x, player.pos.z)) { best = p; break; }
			}
			if (best) hollow.spawn(best.x, best.z);
		}
		let ambushT = 70;

		// ---------------------------------------------------------- level object
		let t0 = 0, dripT = 2, clangT = 20;
		const level = {
			scene, root, col, nav, interactions: inter, lit: false,
			spawn: { x: 4.5 * C, z: 28 * C, yaw: 0.3 },
			flash: { allowed: true, drain: 1 / 150 }, rechargeFlash: false,
			waterLevel: () => water.y,
			surfaceAt: () => 'water',
			start() {
				audio.setReverb(5.5, 0.55, 0.85);
				audio.water(0.1); audio.drone(0.05, 41); audio.roomtone(0.05, 50);
				updateObjective();
				setTimeout(() => ui.subtitle('Cold water up to my knees. My torch is the only light I can trust. [F]', 4.5), 3000);
			},
			update(dt, t) {
				t0 += dt;
				// lamps flicker
				for (const l of lamps) {
					const v = l.flick ? (Math.sin(t * 19 + l.ph) * Math.sin(t * 5.3 + l.ph * 3) > 0.45 ? 0.05 : 1) : 1;
					l.L.intensity = l.base * v; if (l.flick) l.m.material = v > 0.5 ? l.onMat : lampOff;
				}
				// ambience
				dripT -= dt; if (dripT < 0) { dripT = 0.8 + Math.random() * 2.5; const a = Math.random() * 6.28; audio.drip({ x: player.pos.x + Math.cos(a) * 6, y: 2.5, z: player.pos.z + Math.sin(a) * 6 }); }
				clangT -= dt; if (clangT < 0) { clangT = 25 + Math.random() * 30; const a = Math.random() * 6.28; audio.knock({ x: player.pos.x + Math.cos(a) * 25, y: 2, z: player.pos.z + Math.sin(a) * 25 }, 2); }
				// it comes anyway if you dawdle
				if (!hollow.active && levers === 0) { ambushT -= dt; if (ambushT < 0) { spawnHollowFar(); ui.subtitle('Something moved in the water. Far away.', 3); } }
				// gate
				if (gateOpen && gateT < 1) {
					gateT = Math.min(1, gateT + dt / 9);
					gate.position.y = gateT * 4.2;
					if (Math.random() < dt * 4) audio.scrape({ x: 33, y: 2, z: 8 });
					if (gateT > 0.45) gateCol.on = false;
					if (gateT >= 1) { ui.subtitle('The gate is open. There is light in the shaft beyond.', 3.5); updateObjective(); }
				}
				const r = hollow.update(dt, player, t);
				if (hollow.active) {
					game.setFear(r.state === 'chase' ? clamp(1 - r.dist / 22, 0.35, 1) : r.dist < 14 ? 0.3 : 0.1);
					if (r.dist < hollow.killDist) game.die('The water went still.');
				}
				// exit: into the shaft
				if (gateT > 0.45 && player.pos.z < 5.5 && player.pos.x > 30 && player.pos.x < 36) game.complete({ white: true });
			},
			dispose() { hollow.despawn(); }
		};
		hollow.level = Object.assign(hollow.level, level);
		function updateObjective() {
			const t = levers < 2 ? `Pull the floodgate levers (${levers}/2)` : gateT < 1 ? 'Survive until the gate opens' : 'Go through the floodgate (north)';
			ui.setObjective('LEVEL 5 · THE DEEP END', t);
		}
		return level;
	}
};
