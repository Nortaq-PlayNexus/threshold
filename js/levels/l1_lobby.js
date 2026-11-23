// LEVEL 1 — THE LOBBY (the Backrooms). Find 3 fuses, power the elevator, survive the blackouts.
import * as THREE from 'three/webgpu';
import { instancedBufferAttribute, vec3, float, materialColor, materialRoughness, uv, positionWorld, mx_fractal_noise_float, mx_noise_float, smoothstep, mix, step, fract, vec2 } from 'three/tsl';
import { pbr } from '../assets.js';
import { MeshBuilder, Collision, NavGrid, Interactions } from '../world.js';
import { mulberry32, damp, clamp } from '../util.js';
import { audio } from '../audio.js';
import { ui } from '../ui.js';
import { fx } from '../renderer.js';
import { createHollow, Hunter } from '../entities.js';
import { createNote, glowMaterial } from '../props.js';

const W = 40, H = 40, C = 2, CEIL = 2.75;

export default {
	number: 'LEVEL 1', name: 'THE LOBBY', blurb: 'fluorescent hum · damp carpet · blackouts',
	subtitle: '"If you\'re not careful and you noclip out of reality in the wrong areas, you\'ll end up here."',

	async build(ctx) {
		const { game, player, quality } = ctx;
		const scene = new THREE.Scene();
		const root = new THREE.Group(); scene.add(root);
		scene.background = new THREE.Color(0x0d0b05);
		scene.fog = new THREE.Fog(0x2a2410, 6, 46);

		// ---------------------------------------------------------- layout
		const rng = mulberry32(7331);
		const solid = new Uint8Array(W * H);
		const S = (i, j) => (i < 0 || j < 0 || i >= W || j >= H) ? 1 : solid[j * W + i];
		const set = (i, j, v) => { if (i >= 0 && j >= 0 && i < W && j < H) solid[j * W + i] = v; };
		for (let i = 0; i < W; i++) { set(i, 0, 1); set(i, H - 1, 1); }
		for (let j = 0; j < H; j++) { set(0, j, 1); set(W - 1, j, 1); }
		for (let k = 0; k < 90; k++) {
			const len = 2 + Math.floor(rng() * 6), hz = rng() < 0.5;
			const i = 1 + Math.floor(rng() * (W - 2)), j = 1 + Math.floor(rng() * (H - 2));
			for (let l = 0; l < len; l++) set(hz ? i + l : i, hz ? j : j + l, 1);
		}
		for (let k = 0; k < 8; k++) {
			const rw = 4 + Math.floor(rng() * 5), rh = 4 + Math.floor(rng() * 5);
			const i0 = 2 + Math.floor(rng() * (W - rw - 4)), j0 = 2 + Math.floor(rng() * (H - rh - 4));
			for (let i = i0; i <= i0 + rw; i++) { set(i, j0, 1); set(i, j0 + rh, 1); }
			for (let j = j0; j <= j0 + rh; j++) { set(i0, j, 1); set(i0 + rw, j, 1); }
			for (let i = i0 + 1; i < i0 + rw; i++) for (let j = j0 + 1; j < j0 + rh; j++) set(i, j, 0);
			for (let d = 0; d < 3; d++) {
				const side = Math.floor(rng() * 4);
				if (side < 2) set(i0 + 1 + Math.floor(rng() * (rw - 1)), side ? j0 : j0 + rh, 0);
				else set(side === 2 ? i0 : i0 + rw, j0 + 1 + Math.floor(rng() * (rh - 1)), 0);
			}
		}
		for (let k = 0; k < 50; k++) set(2 + Math.floor(rng() * (W - 4)), 2 + Math.floor(rng() * (H - 4)), 1);
		for (let i = 2; i <= 5; i++) for (let j = 2; j <= 5; j++) set(i, j, 0);
		// elevator vestibule (east wall, row 36)
		const EJ = 36;
		for (let i = 34; i <= 38; i++) for (let j = 34; j <= 38; j++) set(i, j, 0);
		set(W - 1, EJ, 0);

		// connectivity: flood from spawn; carve toward unreachable key cells; seal the rest
		const flood = () => {
			const d = new Int32Array(W * H).fill(-1), q = [3 + 3 * W]; d[q[0]] = 0;
			for (let h = 0; h < q.length; h++) {
				const c = q[h], i = c % W, j = (c / W) | 0;
				for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
					const n = (j + dj) * W + i + di;
					if (!S(i + di, j + dj) && d[n] < 0) { d[n] = d[c] + 1; q.push(n); }
				}
			}
			return d;
		};
		let dist = flood();
		const carve = (ti, tj) => {
			let i = ti, j = tj;
			while (dist[j * W + i] < 0) {
				if (i > 3 && (rng() < 0.5 || j === 3)) i--; else if (j > 3) j--; else i--;
				set(i, j, 0);
				if (dist[j * W + i] >= 0) break;
			}
			dist = flood();
		};
		carve(36, 36);
		for (let j = 1; j < H - 1; j++) for (let i = 1; i < W - 1; i++) if (!S(i, j) && dist[j * W + i] < 0) set(i, j, 1);
		dist = flood();

		// ---------------------------------------------------------- materials
		const [wall, carpet, ceil] = await Promise.all([
			pbr('wallpaper', { color: 0xd9c77a, roughness: 1, normalScale: 0.6 }),
			pbr('carpet', { color: 0xb8a560, roughness: 1, normalScale: 1.2 }),
			pbr('ceiling', { color: 0xe8e1c4, roughness: 1, metalness: 0 }),
		]);
		ceil.metalnessMap = null; ceil.metalness = 0;
		// TSL detail layers: damp carpet patches (darker + glossier) and stained, striped wallpaper
		const wet = smoothstep(0.08, 0.35, mx_fractal_noise_float(vec3(positionWorld.x.mul(0.12), 0, positionWorld.z.mul(0.12)), 3));
		carpet.colorNode = materialColor.mul(mix(float(1), float(0.6), wet));
		carpet.roughnessNode = materialRoughness.mul(mix(float(1), float(0.45), wet));
		const stripe = mix(float(0.97), float(1.0), step(0.5, fract(uv().x.mul(1.6)))).mul(mix(float(1), float(0.78), step(0.94, fract(uv().x.mul(6.25)))));
		const n = mx_noise_float(vec2(uv().x.mul(0.9), 0)).mul(0.5).add(0.5);
		const rise = smoothstep(n.mul(0.9).add(0.25), 0.0, uv().y);
		const topStain = smoothstep(2.2, 2.75, uv().y).mul(n);
		wall.colorNode = materialColor.mul(stripe).mul(mix(vec3(1, 1, 1), vec3(0.62, 0.52, 0.32), rise.add(topStain.mul(0.5)).clamp(0, 1)));
		const metal = await pbr('metal', { color: 0x9a9a95, roughness: 0.6 });

		// ---------------------------------------------------------- geometry
		const mb = new MeshBuilder();
		const col = new Collision(4);
		for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
			const x0 = i * C, z0 = j * C, x1 = x0 + C, z1 = z0 + C;
			if (S(i, j)) {
				if (i === W - 1 && j === EJ) continue;
				if (!S(i - 1, j)) mb.wallX('wall', x0, z0, z1, 0, CEIL, -1);
				if (!S(i + 1, j)) mb.wallX('wall', x1, z0, z1, 0, CEIL, 1);
				if (!S(i, j - 1)) mb.wallZ('wall', z0, x0, x1, 0, CEIL, -1);
				if (!S(i, j + 1)) mb.wallZ('wall', z1, x0, x1, 0, CEIL, 1);
				col.addBox(x0, z0, x1, z1);
			} else {
				mb.floor('floor', x0, z0, x1, z1, 0, true);
				mb.floor('ceil', x0, z0, x1, z1, CEIL, false);
			}
		}
		const world = mb.build({ wall, floor: carpet, ceil }, { receiveShadow: true, castShadow: true });
		root.add(world);

		// ---------------------------------------------------------- lights
		const lights = [];
		const fixtures = [];
		for (let j = 1; j < H; j += 2) for (let i = 1; i < W; i += 2) {
			if (S(i, j)) continue;
			const x = (i + 0.5) * C, z = (j + 0.5) * C;
			const r = rng();
			const state = r < 0.07 ? 'dead' : r < 0.13 ? 'flicker' : 'on';
			fixtures.push({ x, z, state, phase: rng() * 100, cur: 1 });
		}
		const N = fixtures.length;
		const panelAttr = new THREE.InstancedBufferAttribute(new Float32Array(N), 1);
		const panelMat = new THREE.MeshBasicNodeMaterial();
		panelMat.colorNode = vec3(1.0, 0.95, 0.78).mul(instancedBufferAttribute(panelAttr)).mul(5.0).add(vec3(0.08, 0.08, 0.07));
		const panels = new THREE.InstancedMesh(new THREE.BoxGeometry(1.18, 0.03, 0.58), panelMat, N);
		const frameMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1.26, 0.025, 0.66), new THREE.MeshStandardNodeMaterial({ color: 0x8a8576, roughness: 0.9 }), N);
		const m4 = new THREE.Matrix4();
		fixtures.forEach((f, k) => {
			m4.makeTranslation(f.x, CEIL - 0.018, f.z); panels.setMatrixAt(k, m4);
			m4.makeTranslation(f.x, CEIL - 0.008, f.z); frameMesh.setMatrixAt(k, m4);
			const L = new THREE.PointLight(0xffefc2, 0, 8.5, 1.6);
			L.position.set(f.x, CEIL - 0.12, f.z);
			root.add(L); f.light = L; lights.push(L);
		});
		root.add(panels, frameMesh);
		const hemi = new THREE.HemisphereLight(0xfff2c0, 0x5a4a20, 0.35);
		root.add(hemi);
		const LIGHT_I = 9;

		// ---------------------------------------------------------- props
		const inter = new Interactions();
		let fuses = 0, powered = false, elevatorOpen = false;
		const fuseMat = new THREE.MeshStandardNodeMaterial({ color: 0x2b2b2b, roughness: 0.4, metalness: 0.6 });
		const fuseGlow = glowMaterial(0xff9a3a, 3);
		// pick fuse cells
		const cand = [];
		for (let j = 1; j < H - 1; j++) for (let i = 1; i < W - 1; i++) if (!S(i, j) && dist[j * W + i] > 20) cand.push([i, j]);
		const chosen = [];
		for (let tries = 0; tries < 4000 && chosen.length < 3; tries++) {
			const c = cand[Math.floor(rng() * cand.length)];
			if (chosen.every(o => Math.hypot(o[0] - c[0], o[1] - c[1]) > 11) && Math.hypot(c[0] - 36, c[1] - 36) > 6) chosen.push(c);
		}
		chosen.forEach(([i, j]) => {
			const g = new THREE.Group();
			const body = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.16, 16), fuseMat); body.rotation.z = Math.PI / 2;
			const band = new THREE.Mesh(new THREE.CylinderGeometry(0.037, 0.037, 0.05, 16), fuseGlow); band.rotation.z = Math.PI / 2;
			g.add(body, band);
			const x = (i + 0.5) * C + (rng() - 0.5), z = (j + 0.5) * C + (rng() - 0.5);
			g.position.set(x, 0.04, z); g.rotation.y = rng() * 6;
			const gl = new THREE.PointLight(0xff9a3a, 0.7, 2.2, 2); gl.position.set(x, 0.3, z);
			root.add(g, gl);
			const it = inter.add({
				pos: g.position, prompt: 'Take fuse', radius: 2.3, onUse: () => {
					root.remove(g); root.remove(gl); inter.remove(it);
					fuses++; audio.pickup();
					ui.toast(`FUSE ${fuses}/3`);
					if (fuses === 1 && nextBlackout > 1e8) nextBlackout = T + 20;
					updateObjective();
				}
			});
		});

		// Breaker panel + elevator
		const EX = W * C, EZ = (EJ + 0.5) * C;
		const panelG = new THREE.Group();
		const box = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.7, 0.5), metal); panelG.add(box);
		const led = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.05, 0.05), glowMaterial(0xff2a1a, 4)); led.position.set(-0.045, 0.25, 0.16); panelG.add(led);
		// place on the west face of the solid cell south of the vestibule entrance
		panelG.position.set(EX - C - 0.04, 1.4, EZ - 1.5);
		root.add(panelG);
		const elev = new THREE.Group();
		const steel = await pbr('metal', { color: 0xc8c8c8, roughness: 0.35, size: 0.8 });
		const cab = new MeshBuilder();
		const cx0 = EX, cx1 = EX + 2.2, cz0 = EZ - 1.0, cz1 = EZ + 1.0;
		cab.wallX('s', cx1, cz0, cz1, 0, 2.5, -1);
		cab.wallZ('s', cz0, cx0, cx1, 0, 2.5, 1); cab.wallZ('s', cz1, cx0, cx1, 0, 2.5, -1);
		cab.floor('s', cx0, cz0, cx1, cz1, 0, true); cab.floor('s', cx0, cz0, cx1, cz1, 2.5, false);
		cab.wallX('s', EX - 0.63, EZ - 1, EZ + 1, 2.3, CEIL, -1);
		cab.wallX('s', EX, EZ - 1, EZ + 1, 2.5, CEIL, -1);
		elev.add(cab.build({ s: steel }));
		col.addBox(cx1, cz0 - 0.2, cx1 + 0.2, cz1 + 0.2); col.addBox(cx0, cz0 - 0.2, cx1, cz0); col.addBox(cx0, cz1, cx1, cz1 + 0.2);
		const doorL = new THREE.Mesh(new THREE.BoxGeometry(0.06, 2.3, 1.0), steel), doorR = doorL.clone();
		doorL.position.set(EX - 0.6, 1.15, EZ - 0.5); doorR.position.set(EX - 0.6, 1.15, EZ + 0.5);
		elev.add(doorL, doorR);
		const doorCol = col.addBox(EX - 0.7, EZ - 1, EX - 0.5, EZ + 1);
		const cabLight = new THREE.PointLight(0xfff6e0, 0, 4, 1.5); cabLight.position.set(EX + 1.1, 2.3, EZ); elev.add(cabLight);
		const cabPanel = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.02, 0.5), glowMaterial(0xfff6e0, 0.2)); cabPanel.position.set(EX + 1.1, 2.49, EZ); elev.add(cabPanel);
		root.add(elev);

		let arrivalT = -1;
		inter.add({
			pos: panelG.position, radius: 2.4, hold: 1.4,
			prompt: () => powered ? 'Breaker panel — powered' : fuses < 3 ? `Breaker panel (${fuses}/3 fuses)` : 'Insert fuses (hold)',
			onUse: () => {
				if (powered) return;
				if (fuses < 3) { ui.subtitle('Three empty fuse slots. They must be somewhere on this floor.'); return; }
				powered = true; audio.powerUp(); audio.clang();
				led.material = glowMaterial(0x3aff6a, 4);
				arrivalT = T + 14;
				ui.subtitle('Somewhere above, machinery groans awake. The elevator is coming.');
				startBlackout(true);
				updateObjective();
			}
		});

		createNote(root, inter, { x: 4.6 * C, z: 3.4 * C, rot: 0.4, html: '<b>DAY ?</b><br>I don\'t know how long I\'ve been here. The carpet is always wet. The lights never stop humming.<br><br>There\'s an <b>elevator on the far side</b> — east, I think. It needs power. The breaker is missing its <b>three fuses</b>.<br><br>When the lights go out, <b>use your flashlight [F]</b>. It doesn\'t like the light. It hates it.<br><br>Don\'t run unless you have to. It hears you.' });
		createNote(root, inter, { x: 20.5 * C, z: 19.5 * C, rot: 2.1, html: 'it walks with its arms dragging<br>it was tall like the ceiling was too low for it<br><br>the lights always come back.<br>you just have to still be there when they do' });
		createNote(root, inter, { x: 36.5 * C, z: 34.6 * C, rot: -0.8, html: 'Fuses go in the panel by the lift.<br>Once it\'s called you will have to <b>WAIT</b> for it.<br>It knows when the power changes.<br><br>Keep moving. Keep the light on it.' });

		// ---------------------------------------------------------- hollow
		const nav = new NavGrid(col, 0, 0, W * C, H * C, 1.0, 0.35);
		const hollow = new Hunter({ root, col, nav, lit: true }, createHollow(), { walk: 1.6, chase: 3.7, sight: 26, hearing: 15 });

		// ---------------------------------------------------------- state machine
		let T = 0, nextBlackout = 1e9, blackout = false, blackoutEnd = 0, warnT = 0, fade = 0;
		const level = {
			scene, root, col, nav, interactions: inter, lit: true,
			spawn: { x: 3.5 * C, z: 3.5 * C, yaw: -Math.PI * 0.69 },
			flash: { allowed: true, drain: 1 / 70 },
			rechargeFlash: true,
			surfaceAt: () => 'carpet',
			start() {
				audio.setReverb(1.1, 0.7, 0.35);
				audio.hum(0.07); audio.roomtone(0.06, 120);
				updateObjective();
				setTimeout(() => ui.subtitle('...where am I? This isn\'t my room.', 4), 3500);
			},
			update, dispose() { hollow.despawn(); }
		};
		hollow.level = Object.assign(hollow.level, level);

		function updateObjective() {
			let t;
			if (fuses < 3) t = `Find the missing fuses (${fuses}/3)`;
			else if (!powered) t = 'Restore power at the breaker panel by the elevator (east)';
			else if (!elevatorOpen) t = 'Survive until the elevator arrives';
			else t = 'Get in the elevator';
			ui.setObjective('LEVEL 1 · THE LOBBY', t);
		}

		function spawnHollowFar() {
			nav.flood(player.pos.x, player.pos.z);
			let best = null;
			for (let k = 0; k < 400; k++) {
				const p = nav.randomFree(rng); if (!p) continue;
				const d = nav.distAt(p.x, p.z);
				if (d > 22 && d < 42 && !col.los(p.x, p.z, player.pos.x, player.pos.z)) { best = p; break; }
			}
			if (best) hollow.spawn(best.x, best.z);
		}

		function startBlackout(final = false) {
			blackout = true; level.lit = false; hollow.level.lit = false;
			level.rechargeFlash = false;
			blackoutEnd = final ? 1e9 : T + 16 + rng() * 5;
			audio.thunk(); audio.stopLoop('hum', 0.2); audio.drone(0.06, 49);
			fx.glitch.value = 0.6;
			spawnHollowFar();
			if (!final) ui.subtitle('The lights died.', 2.5);
		}
		function endBlackout() {
			blackout = false; level.lit = true; hollow.level.lit = true;
			level.rechargeFlash = true;
			audio.powerUp(); audio.stopLoop('drone', 2); audio.hum(0.07);
			fade = 1;
			nextBlackout = T + 45 + rng() * 30;
		}

		const tmp = new THREE.Vector3();
		function update(dt, t) {
			T += dt;
			// blackout scheduling
			if (!blackout && T > nextBlackout - 2.5 && T < nextBlackout) warnT = 1; else warnT = 0;
			if (!blackout && T >= nextBlackout && !powered) startBlackout();
			if (blackout && T >= blackoutEnd) endBlackout();

			// hollow fade-out after power returns
			if (!blackout && hollow.active) {
				fade = Math.max(0, fade - dt * 0.8);
				hollow.m.visibility.value = fade;
				if (fade <= 0) hollow.despawn();
			}

			// lights
			const flick = (f) => {
				if (f.state === 'dead') return 0;
				if (blackout) return 0;
				let v = 1;
				if (f.state === 'flicker') v = (Math.sin(t * 23 + f.phase) * Math.sin(t * 7.1 + f.phase * 2) > 0.3) ? 0.15 : 1;
				if (warnT) v *= Math.random() < 0.35 ? 0.05 : 1;
				return v;
			};
			for (let k = 0; k < N; k++) {
				const f = fixtures[k];
				const target = flick(f);
				f.cur = blackout ? 0 : (f.state === 'flicker' || warnT ? target : damp(f.cur, target, 6, dt));
				f.light.intensity = f.cur * (level.lightI ?? LIGHT_I);
				panelAttr.array[k] = f.cur;
			}
			panelAttr.needsUpdate = true;
			hemi.intensity = blackout ? 0.012 : 0.35;
			scene.fog.color.setHex(blackout ? 0x020201 : 0x2a2410);
			scene.background.setHex(blackout ? 0x000000 : 0x0d0b05);

			// elevator arrival
			if (powered && !elevatorOpen && T >= arrivalT) {
				elevatorOpen = true; doorCol.on = false; audio.ding(); cabLight.intensity = 6; cabPanel.material = glowMaterial(0xfff6e0, 4);
				ui.subtitle('*ding*', 2); updateObjective();
			}
			if (elevatorOpen) {
				doorL.position.z = damp(doorL.position.z, EZ - 1.45, 2, dt);
				doorR.position.z = damp(doorR.position.z, EZ + 1.45, 2, dt);
				if (player.pos.x > EX + 0.5) { hollow.despawn(); game.complete(); }
			}

			// hollow AI
			let fear = 0;
			if (hollow.active && blackout) {
				const r = hollow.update(dt, player, t);
				fear = clamp(1 - r.dist / 20, 0, 1);
				if (r.sees) fear = Math.max(fear, 0.5);
				if (r.dist < 0.95) {
					player.lookOverride = { target: tmp.set(hollow.pos.x, hollow.pos.y + 2.2, hollow.pos.z), speed: 12 };
					game.die('It found you in the dark.');
				}
			} else if (hollow.active) {
				animIdle(t);
			}
			game.setFear(fear);
			audio.setLoop('hum', warnT ? 1.6 : 1);

			// ambient scares
			if (!this._amb) this._amb = 20;
			this._amb -= dt;
			if (this._amb < 0) {
				this._amb = 25 + rng() * 30;
				const a = rng() * Math.PI * 2;
				const p = { x: player.pos.x + Math.cos(a) * 14, y: 1.5, z: player.pos.z + Math.sin(a) * 14 };
				rng() < 0.5 ? audio.knock(p, 2 + Math.floor(rng() * 3)) : audio.whisper(p);
			}
		}
		function animIdle(t) { hollow.m.root.rotation.y += 0.0; }

		return level;
	}
};
