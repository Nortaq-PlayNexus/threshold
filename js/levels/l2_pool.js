// LEVEL 2 — THE POOLROOMS. Turn three valves to drain the water and reveal the tunnel.
import * as THREE from 'three/webgpu';
import { materialColor, positionWorld, mix, vec3, float, smoothstep } from 'three/tsl';
import { pbr, loadSkyHDR } from '../assets.js';
import { Collision, NavGrid, Interactions, tiledCylinder } from '../world.js';
import { CellWorld, RAMP } from '../cellworld.js';
import { createWater, addCaustics } from '../water.js';
import { damp, clamp, mulberry32 } from '../util.js';
import { audio } from '../audio.js';
import { ui } from '../ui.js';
import { fx } from '../renderer.js';
import { createHollow, animateWalk } from '../entities.js';
import { createNote, glowMaterial } from '../props.js';

const W = 40, H = 36, C = 2;

export default {
	number: 'LEVEL 2', name: 'THE POOLROOMS', blurb: 'lukewarm water · white tile · skylights',
	subtitle: 'The water is lukewarm. It has always been lukewarm.',

	async build(ctx) {
		const { game, player, quality } = ctx;
		const scene = new THREE.Scene();
		const root = new THREE.Group(); scene.add(root);
		const sky = await loadSkyHDR();
		scene.background = sky; scene.backgroundIntensity = 1.1;
		scene.environment = sky; scene.environmentIntensity = 0.3;
		scene.fog = new THREE.Fog(0xbfd9d6, 45, 170);
		const rng = mulberry32(4242);

		// ---------------------------------------------------------- layout
		const cw = new CellWorld(W, H, C);
		const pillars = [];
		const skylights = [];
		const sky4 = (i, j, w = 2, h = 2, top = 9) => { cw.setCeil(i, j, i + w - 1, j + h - 1, top, true); skylights.push([(i + w / 2) * C, (j + h / 2) * C, w * C, h * C, top]); };

		// R0 spawn hall
		cw.carve(2, 26, 13, 33, 0, 4.4);
		[[5, 28], [9, 28], [5, 31], [9, 31], [12, 28], [12, 31]].forEach(p => pillars.push(p));
		sky4(7, 29);
		// R1 great pool hall
		cw.carve(12, 10, 27, 24, 0, 6.0);
		cw.setFloor(15, 10, 24, 18, -1.4);
		cw.setRamp(18, 19, 21, 19, RAMP.N, 0, 1.4);
		[[13, 12], [13, 16], [26, 12], [26, 16], [13, 21], [26, 21], [16, 22], [23, 22]].forEach(p => pillars.push(p));
		[[16, 12], [23, 12], [16, 16], [23, 16]].forEach(p => pillars.push(p));
		sky4(18, 12, 4, 4, 10);
		sky4(14, 22, 2, 2, 9); sky4(24, 22, 2, 2, 9);
		// tunnel north of the great pool (flooded until drained)
		cw.carve(19, 2, 20, 9, -1.4, 0.9);
		// R2 west wing
		cw.carve(2, 6, 9, 20, 0, 4.4);
		[[4, 8], [7, 8], [4, 11], [7, 11], [4, 14], [7, 14], [4, 17], [7, 17]].forEach(p => pillars.push(p));
		sky4(5, 9); sky4(5, 15);
		cw.carve(5, 21, 6, 25, 0, 3.0);
		cw.carve(10, 15, 11, 16, 0, 3.0);
		// R3 east wing with basin
		cw.carve(30, 8, 37, 28, 0, 4.4);
		cw.setFloor(32, 12, 35, 24, -1.0);
		cw.setRamp(33, 25, 34, 25, RAMP.N, 0, 1.0);
		[[31, 10], [36, 10], [31, 26], [36, 26], [31, 18], [36, 18]].forEach(p => pillars.push(p));
		sky4(33, 15, 2, 2, 9); sky4(33, 20, 2, 2, 9);
		cw.carve(28, 17, 29, 18, 0, 3.0);
		// R4 south-east rotunda room
		cw.carve(16, 27, 26, 33, 0, 5.5);
		cw.setFloor(19, 29, 23, 32, -0.7);
		cw.setRamp(20, 28, 22, 28, RAMP.S, 0, 0.7);
		sky4(17, 31, 2, 2, 9); sky4(24, 31, 2, 2, 9);
		cw.carve(14, 29, 15, 30, 0, 3.0);
		cw.carve(20, 25, 21, 26, 0, 3.0);

		// ---------------------------------------------------------- materials
		const waterY0 = 0.3;
		const [tile, tileFloor, aqua, ceilTile] = await Promise.all([
			pbr('pooltile', { color: 0xf4f6f2, roughness: 0.55, normalScale: 0.8, physical: { clearcoat: 0.6, clearcoatRoughness: 0.12 } }),
			pbr('pooltile', { color: 0xf0f3ef, roughness: 0.5, normalScale: 0.8, physical: { clearcoat: 0.5, clearcoatRoughness: 0.15 } }),
			pbr('aquatile', { color: 0xbfeee9, roughness: 0.45, normalScale: 0.8, physical: { clearcoat: 0.5, clearcoatRoughness: 0.15 } }),
			pbr('pooltile', { color: 0xe9ece7, roughness: 0.7, normalScale: 0.6 }),
		]);
		// subtle grime gradient near the waterline on walls
		tile.colorNode = materialColor.mul(mix(vec3(0.86, 0.9, 0.86), vec3(1, 1, 1), smoothstep(0.2, 1.4, positionWorld.y)));

		const quality_reflect = quality === 'ultra' ? 0.5 : quality === 'high' ? 0.33 : 0;
		const water = await createWater(scene, { size: [W * C + 20, H * C + 20], center: [W * C / 2, H * C / 2], y: waterY0, reflScale: quality_reflect, shallow: 0xa8f0e6, deep: 0x0e6d6c, absorb: 0.32, ripple: 0.3, distortion: 0.02 });
		[tile, tileFloor, aqua].forEach(m => addCaustics(m, water.level, 0.28));

		// ---------------------------------------------------------- geometry
		const mb = cw.build(undefined, (kind, i, j, info) => {
			if (kind === 'floor') return Math.min(...info.h) < -0.05 ? 'aqua' : 'floor';
			if (kind === 'ceil') return 'ceil';
			if (kind === 'edge') return (info.y1 ?? 0) <= 0.01 ? 'aqua' : 'wall';
			return 'wall';
		});
		const world = mb.build({ wall: tile, floor: tileFloor, aqua, ceil: ceilTile }, { receiveShadow: true });
		root.add(world);

		const col = new Collision(4);
		cw.addCollision(col);

		// pillars
		const pillarGroup = new THREE.Group();
		pillars.forEach(([i, j]) => {
			const k = cw.id(i, j);
			const f = cw.floor[k], c = cw.ceil[k] > 7 ? 6 : cw.ceil[k];
			const x = (i + 0.5) * C, z = (j + 0.5) * C;
			const r = 0.42;
			const m = new THREE.Mesh(tiledCylinder(r, c - f, 40), f < -0.05 ? aqua : tile);
			m.position.set(x, (c + f) / 2, z); m.receiveShadow = true;
			pillarGroup.add(m);
			col.addCircle(x, z, r);
		});
		root.add(pillarGroup);

		// rotunda tower in R4 (spiral feature)
		const tower = new THREE.Group();
		const tx = 21.5 * C, tz = 30.5 * C;
		const tcyl = new THREE.Mesh(tiledCylinder(1.0, 6.3, 48), aqua); tcyl.position.set(tx, -0.7 + 3.15, tz); tower.add(tcyl);
		for (let k = 0; k < 6; k++) {
			const ring = new THREE.Mesh(new THREE.CylinderGeometry(1.7 - k * 0.12, 1.7 - k * 0.12, 0.12, 48), tile);
			ring.position.set(tx, 0.6 + k * 0.85, tz); tower.add(ring);
		}
		col.addCircle(tx, tz, 1.05);
		root.add(tower);

		// ---------------------------------------------------------- lights
		const hemi = new THREE.HemisphereLight(0xeefcff, 0x6fb8b0, 0.4); root.add(hemi);
		skylights.forEach(([x, z, w, d, top]) => {
			const s = new THREE.SpotLight(0xfff1dc, 420, 22, 0.9, 0.8, 1.3);
			s.position.set(x, top - 0.3, z); s.target.position.set(x, -2, z);
			root.add(s, s.target);
		});
		const lampMat = glowMaterial(0xf2fbff, 3.2);
		const lampGeo = new THREE.BoxGeometry(1.0, 0.03, 1.0);
		for (let j = 0; j < H; j += 3) for (let i = 0; i < W; i += 3) {
			const k = cw.id(i, j);
			if (!cw.open[k] || cw.noCeil[k] || cw.ceil[k] < 2.5 || cw.floor[k] < -1) continue;
			const x = (i + 0.5) * C, z = (j + 0.5) * C, y = cw.ceil[k];
			const m = new THREE.Mesh(lampGeo, lampMat); m.position.set(x, y - 0.015, z); root.add(m);
			const L = new THREE.PointLight(0xf0f8ff, 7, 10, 1.6); L.position.set(x, y - 0.3, z); root.add(L);
		}
		// underwater lights along pool walls
		const uwMat = glowMaterial(0x9ffcff, 5);
		const uwGeo = new THREE.CircleGeometry(0.16, 24);
		const addUW = (x, y, z, ry) => {
			const m = new THREE.Mesh(uwGeo, uwMat); m.position.set(x, y, z); m.rotation.y = ry; root.add(m);
			const L = new THREE.PointLight(0x7ff6ff, 4, 6, 1.5); L.position.set(x + Math.sin(ry) * 0.4, y, z + Math.cos(ry) * 0.4); root.add(L);
		};
		for (let i = 15; i <= 24; i += 3) addUW((i + 0.5) * C, -0.8, 19 * C - 0.01, Math.PI);
		for (let j = 11; j <= 18; j += 3) { addUW(15 * C + 0.01, -0.8, (j + 0.5) * C, Math.PI / 2); addUW(25 * C - 0.01, -0.8, (j + 0.5) * C, -Math.PI / 2); }
		for (let j = 13; j <= 24; j += 4) { addUW(32 * C + 0.01, -0.55, (j + 0.5) * C, Math.PI / 2); addUW(36 * C - 0.01, -0.55, (j + 0.5) * C, -Math.PI / 2); }
		// tunnel end light
		const endPanel = new THREE.Mesh(new THREE.PlaneGeometry(4, 2.3), glowMaterial(0xffffff, 8));
		endPanel.position.set(20 * C, -0.25, 2 * C + 0.02); root.add(endPanel);
		const endLight = new THREE.PointLight(0xffffff, 30, 16, 1.2); endLight.position.set(20 * C, 0, 3 * C); root.add(endLight);

		// ---------------------------------------------------------- props: valves, grate, duck
		const inter = new Interactions();
		const metal = await pbr('metal', { color: 0xb08d57, roughness: 0.35, metalness: 1 });
		const red = new THREE.MeshPhysicalNodeMaterial({ color: 0xa3201a, roughness: 0.35, clearcoat: 1 });
		const levels = [waterY0, -0.2, -0.65, -1.15];
		let valves = 0, targetY = waterY0, drained = false;
		const makeValve = (x, y, z, ry, label) => {
			const g = new THREE.Group();
			const flange = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.04, 24), metal); flange.rotation.x = Math.PI / 2; flange.position.z = 0.02;
			const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.22, 12), metal); stem.rotation.x = Math.PI / 2; stem.position.z = 0.13;
			const wheel = new THREE.Group(); wheel.position.z = 0.24;
			const tor = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.022, 12, 40), red); wheel.add(tor);
			for (let s = 0; s < 4; s++) { const sp = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.02, 0.02), red); sp.rotation.z = s * Math.PI / 4; wheel.add(sp); }
			const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 3, 16), metal); pipe.position.set(0, -1.6, 0.06);
			g.add(flange, stem, wheel, pipe);
			g.position.set(x, y, z); g.rotation.y = ry;
			root.add(g);
			let done = false;
			const it = inter.add({
				pos: new THREE.Vector3(x, y, z), radius: 2.4, hold: 2.4,
				prompt: () => done ? 'Valve — open' : `Turn valve (${label})`,
				onHold: (f) => { wheel.rotation.z = -f * Math.PI * 3; if (Math.random() < 0.05) audio.valve(); },
				onUse: () => {
					if (done) return; done = true; it.enabled = false;
					valves++; targetY = levels[valves];
					audio.valve(); audio.gurgle();
					ui.toast(`VALVE ${valves}/3`);
					ui.subtitle(valves < 3 ? 'Somewhere deep below, water begins to drain.' : 'A low, enormous gurgle. The water is going down.', 4);
					updateObjective();
				}
			});
			return g;
		};
		makeValve(4 * 1 + 0.02, 1.25, 7 * C + 1, Math.PI / 2, 'west wing');
		makeValve(34 * C, 1.25, 8 * C + 0.02, 0, 'east wing');
		makeValve(21 * C + 1, 1.25, 34 * C - 0.02, Math.PI, 'rotunda');
		// grate at the tunnel mouth
		const grate = new THREE.Group();
		for (let b = 0; b < 17; b++) { const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 2.3, 8), metal); bar.position.set(19 * C + 0.12 + b * 0.235, -0.25, 10 * C - 0.05); grate.add(bar); }
		for (let r = 0; r < 3; r++) { const rail = new THREE.Mesh(new THREE.BoxGeometry(4, 0.05, 0.05), metal); rail.position.set(20 * C, -1.2 + r * 0.95, 10 * C - 0.05); grate.add(rail); }
		root.add(grate);
		const grateCol = col.addBox(19 * C, 10 * C - 0.15, 21 * C, 10 * C + 0.05);
		// rubber duck
		const duck = new THREE.Group();
		const yellow = new THREE.MeshPhysicalNodeMaterial({ color: 0xffd21a, roughness: 0.3, clearcoat: 1 });
		const db = new THREE.Mesh(new THREE.SphereGeometry(0.11, 20, 14), yellow); db.scale.set(1.2, 0.8, 1);
		const dh = new THREE.Mesh(new THREE.SphereGeometry(0.065, 16, 12), yellow); dh.position.set(0.08, 0.1, 0);
		const bk = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.06, 10), new THREE.MeshStandardNodeMaterial({ color: 0xff6a00 })); bk.rotation.z = -Math.PI / 2; bk.position.set(0.16, 0.09, 0);
		duck.add(db, dh, bk); duck.position.set(19 * C, waterY0, 15 * C); root.add(duck);

		createNote(root, inter, { x: 3.4 * C, y: 1.3, z: 33.98 * C, wall: Math.PI, html: 'The water is warm. It\'s always warm. I followed the pipes for hours.<br><br>Three <b>red valves</b> — one in the <b>west wing</b>, one in the <b>east wing</b>, one in the <b>round room</b> past the arch.<br><br>Under the great pool there\'s a grate. A tunnel. I think it leads <i>down</i>. Drain the water and the grate lifts.<br><br>I keep seeing someone standing far away. When I get close there\'s no one.' });

		// ---------------------------------------------------------- watcher (harmless sightings)
		const watcher = createHollow();
		watcher.root.visible = false; root.add(watcher.root);
		const spots = [[19.5, 23.5], [33.5, 9.5], [3.5, 7.5], [26.5, 11.5], [20.5, 32.5], [36.5, 27.5], [8.5, 19.5]].map(([i, j]) => ({ x: i * C, z: j * C }));
		let watchT = 25, watchOn = false, watchSeen = 0, watchLife = 0;

		// ---------------------------------------------------------- level object
		let T = 0, dripT = 1;
		const tmp = new THREE.Vector3();
		const level = {
			scene, root, col, interactions: inter,
			spawn: { x: 3.6 * C, z: 32.5 * C, yaw: -0.35 },
			flash: { allowed: true, drain: 1 / 300 }, rechargeFlash: true,
			waterLevel: () => water.y,
			surfaceAt: () => 'tile',
			start() {
				audio.setReverb(4.8, 0.25, 0.9);
				audio.water(0.13); audio.roomtone(0.04, 70);
				audio.musicBox(0.03);
				updateObjective();
				setTimeout(() => ui.subtitle('The air smells of chlorine. Somewhere, water laps against tile.', 4), 3000);
			},
			update(dt, t) {
				T += dt;
				// water level
				const y = damp(water.y, targetY, 0.22, dt);
				water.setLevel(y);
				if (valves === 3 && !drained && water.y < -1.0) {
					drained = true; grateCol.on = false; audio.clang(); ui.subtitle('The grate grinds open.', 3); updateObjective();
				}
				if (drained) grate.position.y = damp(grate.position.y, 2.4, 0.8, dt);
				duck.position.y = Math.max(water.y, cw.ground(duck.position.x, duck.position.z)) + Math.sin(t * 1.3) * 0.01;
				duck.position.x = 19 * C + Math.sin(t * 0.05) * 3; duck.position.z = 15 * C + Math.cos(t * 0.04) * 2.5; duck.rotation.y = t * 0.05;

				// drips
				dripT -= dt;
				if (dripT < 0) { dripT = 1.5 + Math.random() * 4; const a = Math.random() * 6.28; audio.drip({ x: player.pos.x + Math.cos(a) * 8, y: 3, z: player.pos.z + Math.sin(a) * 8 }); }

				// watcher sightings
				watchT -= dt;
				if (!watchOn && watchT < 0) {
					const c = player.pos;
					const options = spots.filter(s => { const d = Math.hypot(s.x - c.x, s.z - c.z); return d > 18 && d < 50 && col.los(s.x, s.z, c.x, c.z, 1.6); });
					if (options.length) {
						const s = options[Math.floor(Math.random() * options.length)];
						watcher.root.position.set(s.x, cw.ground(s.x, s.z), s.z);
						watcher.root.rotation.y = Math.atan2(c.x - s.x, c.z - s.z);
						animateWalk(watcher, 0, 0, t, 0.15);
						watcher.root.visible = true; watcher.visibility.value = 1; watchOn = true; watchSeen = 0; watchLife = 0;
					}
					watchT = 8;
				}
				if (watchOn) {
					watchLife += dt;
					const c = player.cam.position;
					const d = Math.hypot(watcher.root.position.x - c.x, watcher.root.position.z - c.z);
					player.cam.getWorldDirection(tmp);
					const dx = watcher.root.position.x - c.x, dz = watcher.root.position.z - c.z;
					const looking = (dx * tmp.x + dz * tmp.z) / (Math.hypot(dx, dz) || 1) > 0.9;
					if (looking) { watchSeen += dt; if (watchSeen > 0.3 && watchSeen - dt <= 0.3) { audio.stinger(0.5); fx.glitch.value = 0.3; } }
					game.setFear(looking ? 0.25 : 0);
					if (d < 14 || watchSeen > 3.5 || watchLife > 30) {
						watcher.visibility.value = Math.max(0, watcher.visibility.value - dt * 2);
						if (watcher.visibility.value <= 0) { watcher.root.visible = false; watchOn = false; watchT = 40 + Math.random() * 30; game.setFear(0); }
					}
				}

				// exit through the tunnel
				if (drained && player.pos.z < 4.2 * C && player.pos.x > 19 * C && player.pos.x < 21 * C) game.complete({ white: true });
			},
			dispose() {}
		};
		function updateObjective() {
			const t = valves < 3 ? `Turn the three red valves (${valves}/3)` : !drained ? 'Wait for the water to drain' : 'Go through the tunnel beneath the great pool';
			ui.setObjective('LEVEL 2 · THE POOLROOMS', t);
		}
		return level;
	}
};
