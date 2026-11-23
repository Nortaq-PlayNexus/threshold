// LEVEL 4 — FLOOR 8. A looping hotel corridor.
// If something is wrong, turn back. If nothing is wrong, keep going. Five in a row to leave.
import * as THREE from 'three/webgpu';
import { materialColor, positionWorld, mix, vec3, step, fract } from 'three/tsl';
import { pbr, imageTex } from '../assets.js';
import { MeshBuilder, Collision, Interactions } from '../world.js';
import { damp, clamp, mulberry32, sleep } from '../util.js';
import { audio } from '../audio.js';
import { ui } from '../ui.js';
import { fx } from '../renderer.js';
import { createHollow, createMannequin, animateWalk, randomPose } from '../entities.js';
import { createNote, glowMaterial, textTexture } from '../props.js';

const HW = 1.4, CEIL = 2.6, LEN = 36, NEED = 5;
const DOORS = [5, 11, 17, 23, 29];

export default {
	number: 'LEVEL 4', name: 'FLOOR 8', blurb: 'hotel corridor · it repeats · notice everything',
	subtitle: 'I have walked this corridor before. I will walk it again.',

	async build(ctx) {
		const { game, player, quality } = ctx;
		const scene = new THREE.Scene();
		const root = new THREE.Group(); scene.add(root);
		scene.background = new THREE.Color(0x0a0705);
		scene.fog = new THREE.Fog(0x1a120a, 14, 48);
		const rng = mulberry32(808);

		// ---------------------------------------------------------- materials
		const [wallM, wains, carpet, ceilM, wood, doorWood, brass, paintTex, paintBad] = await Promise.all([
			pbr('hotelwall', { color: 0xe6d6bc, roughness: 1, normalScale: 0.5 }),
			pbr('wood', { color: 0xc89a72, roughness: 0.55 }),
			pbr('hotelcarpet', { color: 0xc89880, roughness: 1, normalScale: 1.0 }),
			pbr('concrete', { color: 0xfffaf0, roughness: 1, normalScale: 0.08, size: 6 }),
			pbr('wood', { color: 0xd0a47c, roughness: 0.5 }),
			pbr('wood', { color: 0xa0704c, roughness: 0.45, physical: { clearcoat: 0.6, clearcoatRoughness: 0.25 } }),
			Promise.resolve(new THREE.MeshStandardNodeMaterial({ color: 0xc9a45c, metalness: 1, roughness: 0.28 })),
			imageTex('assets/img/painting.webp'),
			imageTex('assets/img/painting_anomaly.webp'),
		]);
		// faint vertical damask stripe on the wallpaper
		wallM.colorNode = materialColor.mul(mix(vec3(0.94, 0.92, 0.9), vec3(1, 1, 1), step(0.5, fract(positionWorld.x.add(positionWorld.z).mul(2.2)))));

		// ---------------------------------------------------------- geometry
		const mb = new MeshBuilder();
		const col = new Collision(4);
		const floorRect = (x0, z0, x1, z1) => { mb.floor('carpet', x0, z0, x1, z1, 0, true); mb.floor('ceil', x0, z0, x1, z1, CEIL, false); };
		floorRect(-8, -3, -HW, 0); floorRect(-HW, -3, HW, 0); floorRect(-HW, 0, HW, LEN); floorRect(-HW, LEN, HW, LEN + 3); floorRect(HW, LEN, 8, LEN + 3);
		// wall helper with wainscot split
		const wX = (x, z0, z1, dir) => { mb.wallX('wains', x, z0, z1, 0, 0.95, dir); mb.wallX('wall', x, z0, z1, 0.95, CEIL, dir); };
		const wZ = (z, x0, x1, dir) => { mb.wallZ('wains', z, x0, x1, 0, 0.95, dir); mb.wallZ('wall', z, x0, x1, 0.95, CEIL, dir); };
		// stubs and bends
		wZ(0, -8, -HW, -1); wZ(-3, -8, HW, 1); wX(-8, -3, 0, 1); wX(HW, -3, 0, -1);
		wZ(LEN + 3, -HW, 8, -1); wZ(LEN, HW, 8, 1); wX(8, LEN, LEN + 3, -1); wX(-HW, LEN, LEN + 3, 1);
		// corridor walls with door openings
		for (const side of [-1, 1]) {
			const x = side * HW, dir = -side;
			let z = 0;
			for (const dz of DOORS) {
				wX(x, z, dz - 0.55, dir);
				mb.wallX('wall', x, dz - 0.55, dz + 0.55, 2.2, CEIL, dir);
				// recess jambs + header
				mb.wallZ('trim', dz - 0.55, side > 0 ? x : x - 0.2, side > 0 ? x + 0.2 : x, 0, 2.2, 1);
				mb.wallZ('trim', dz + 0.55, side > 0 ? x : x - 0.2, side > 0 ? x + 0.2 : x, 0, 2.2, -1);
				mb.floor('trim', side > 0 ? x : x - 0.2, dz - 0.55, side > 0 ? x + 0.2 : x, dz + 0.55, 2.2, false);
				z = dz + 0.55;
			}
			wX(x, z, side > 0 ? LEN : LEN + 3, dir);
			if (side > 0) {} // east wall south part already handled by bend wall above
		}
		// chair rail and skirting
		const rails = (x0, z0, x1, z1) => { mb.box('trim', x0, 0.93, z0, x1, 0.99, z1, 'xXzZY'); mb.box('trim', x0, 0, z0, x1, 0.1, z1, 'xXzZY'); };
		for (const side of [-1, 1]) {
			const x = side * HW, i0 = side > 0 ? x - 0.025 : x, i1 = side > 0 ? x : x + 0.025;
			let z = side > 0 ? -3 : 0;
			for (const dz of DOORS) { rails(i0, z, i1, dz - 0.62); z = dz + 0.62; }
			rails(i0, z, i1, side > 0 ? LEN : LEN + 3);
		}
		const world = mb.build({ wall: wallM, wains, carpet, ceil: ceilM, trim: wood }, { receiveShadow: true });
		root.add(world);
		// collision
		col.addBox(-10, -5, 10, -3); col.addBox(-10, LEN + 3, 10, LEN + 5);
		col.addBox(-10, 0, -HW, LEN + 3); col.addBox(HW, -3, 10, LEN);
		col.addBox(-10, -3, -8, 0); col.addBox(8, LEN, 10, LEN + 3);

		// ---------------------------------------------------------- doors
		const voidMat = new THREE.MeshBasicNodeMaterial({ color: 0x000000, side: THREE.BackSide });
		const doors = [];
		let num = 801;
		for (const dz of DOORS) for (const side of [-1, 1]) {
			const x = side * (HW + 0.2);
			const closet = new THREE.Mesh(new THREE.BoxGeometry(1.4, 2.2, 1.1), voidMat);
			closet.position.set(side * (HW + 0.2 + 0.55), 1.1, dz); root.add(closet);
			const hinge = new THREE.Group(); hinge.position.set(x, 0, dz - side * 0.5); hinge.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
			const leaf = new THREE.Mesh(new THREE.BoxGeometry(1.0, 2.18, 0.05), doorWood); leaf.position.set(0.5, 1.09, 0); leaf.castShadow = true;
			const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.14, 12), brass); knob.rotation.x = Math.PI / 2; knob.position.set(0.88, 1.0, 0); 
			const lock = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.1, 0.012), brass); lock.position.set(0.88, 1.18, 0.03);
			const peep = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.07, 10), brass); peep.rotation.x = Math.PI / 2; peep.position.set(0.5, 1.55, 0);
			hinge.add(leaf, knob, lock, peep);
			// panels on the leaf (raised moulding)
			for (const py of [0.55, 1.55]) { const pnl = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.75, 0.012), doorWood); pnl.position.set(0.5, py, 0.03); hinge.add(pnl); }
			root.add(hinge);
			// number plaque
			const plaqueMat = new THREE.MeshStandardNodeMaterial({ map: textTexture(String(num), { w: 256, h: 128, bg: '#1b120b', fg: '#d8b56a', font: '600 78px Plex, monospace' }), roughness: 0.4, metalness: 0.3 });
			const plaque = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.11), plaqueMat);
			plaque.position.set(side * (HW - 0.003), 1.6, dz - 0.8); plaque.rotation.y = -side * Math.PI / 2;
			root.add(plaque);
			doors.push({ hinge, side, z: dz, num, plaque, base: hinge.rotation.y, red: null });
			num++;
		}

		// ---------------------------------------------------------- lights
		const domeMat = glowMaterial(0xffe1b0, 2.6);
		const domeGeo = new THREE.SphereGeometry(0.22, 24, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
		const lights = [];
		const addLight = (x, z) => {
			const d = new THREE.Mesh(domeGeo, domeMat); d.position.set(x, CEIL, z); root.add(d);
			const L = new THREE.PointLight(0xffc98a, 5.5, 9, 1.6); L.position.set(x, CEIL - 0.35, z); root.add(L);
			lights.push({ L, d, z, base: 5.5 });
		};
		for (let z = 2; z < LEN; z += 4) addLight(0, z);
		addLight(-5, -1.5); addLight(0, -1.5); addLight(0, LEN + 1.5); addLight(5, LEN + 1.5);
		const hemi = new THREE.HemisphereLight(0xffe6c8, 0x6a4424, 0.3); root.add(hemi);

		// ---------------------------------------------------------- props
		const props = {};
		// painting (east wall, between doors 2 and 3)
		const pFrame = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.78, 1.02), new THREE.MeshStandardNodeMaterial({ color: 0x3a2412, roughness: 0.4, metalness: 0.2 }));
		pFrame.position.set(HW - 0.03, 1.65, 14); root.add(pFrame);
		const pMat = new THREE.MeshStandardNodeMaterial({ map: paintTex, roughness: 0.6 });
		const pic = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.66), pMat); pic.position.set(HW - 0.062, 1.65, 14); pic.rotation.y = -Math.PI / 2; root.add(pic);
		const picLight = new THREE.SpotLight(0xffe0b0, 6, 3, 0.6, 0.6, 1.5); picLight.position.set(HW - 0.4, 2.45, 14); picLight.target.position.set(HW, 1.6, 14); root.add(picLight, picLight.target);
		props.pic = pic;
		// side table + vase on west wall
		const table = new THREE.Group();
		const top = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.04, 1.0), wood); top.position.y = 0.78; table.add(top);
		for (const [a, b] of [[-0.16, -0.45], [0.16, -0.45], [-0.16, 0.45], [0.16, 0.45]]) { const lg = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.78, 0.04), wood); lg.position.set(a, 0.39, b); table.add(lg); }
		const vase = new THREE.Mesh(new THREE.LatheGeometry([0, 0.07, 0.11, 0.09, 0.05, 0.06].map((r, i) => new THREE.Vector2(r, i * 0.07)), 24), new THREE.MeshPhysicalNodeMaterial({ color: 0x1d3b52, roughness: 0.15, clearcoat: 1 }));
		vase.position.y = 0.8; table.add(vase);
		const flower = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 8), new THREE.MeshStandardNodeMaterial({ color: 0xd8d0c0, roughness: 0.8 })); flower.position.y = 1.22; table.add(flower);
		table.position.set(-HW + 0.21, 0, 20); root.add(table); col.addBox(-HW, 19.5, -HW + 0.42, 20.5);
		props.vase = vase; props.flower = flower;
		// clock (west wall)
		const clock = new THREE.Group();
		const face = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.03, 32), new THREE.MeshStandardNodeMaterial({ color: 0xf2eee4, roughness: 0.5 })); face.rotation.z = Math.PI / 2; clock.add(face);
		const rim = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.012, 8, 40), brass); rim.rotation.y = Math.PI / 2; clock.add(rim);
		const handM = new THREE.MeshBasicNodeMaterial({ color: 0x111111 });
		const hH = new THREE.Mesh(new THREE.BoxGeometry(0.005, 0.09, 0.012), handM); hH.geometry.translate(0, 0.045, 0);
		const hM = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.14, 0.008), handM); hM.geometry.translate(0, 0.07, 0);
		hH.position.x = 0.02; hM.position.x = 0.022; clock.add(hH, hM);
		clock.position.set(-HW + 0.02, 1.95, 8); root.add(clock);
		props.hH = hH; props.hM = hM;
		// fire extinguisher (north bend)
		const ext = new THREE.Group();
		const extBody = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.5, 20), new THREE.MeshPhysicalNodeMaterial({ color: 0xb3150e, roughness: 0.3, clearcoat: 1 })); extBody.position.y = 0.25; ext.add(extBody);
		const extTop = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.05, 0.08, 12), new THREE.MeshStandardNodeMaterial({ color: 0x222222, metalness: 0.8, roughness: 0.3 })); extTop.position.y = 0.54; ext.add(extTop);
		ext.position.set(-HW + 0.12, 0.9, LEN + 2.2); root.add(ext);
		const extSign = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.2), new THREE.MeshStandardNodeMaterial({ map: textTexture('FIRE', { w: 128, h: 128, bg: '#b3150e', fg: '#fff', font: '600 40px Plex, monospace' }) }));
		extSign.position.set(-HW + 0.005, 1.7, LEN + 2.2); extSign.rotation.y = Math.PI / 2; root.add(extSign);
		props.ext = ext;
		// exit signs at both stub ends + fire doors
		const exitTex = textTexture('EXIT ▸', { w: 256, h: 96, bg: '#0b3d1c', fg: '#7dffa8', font: '600 60px Plex, monospace', glow: 12 });
		const exitBad = textTexture('◂ TIXE', { w: 256, h: 96, bg: '#3d0b0b', fg: '#ff7d7d', font: '600 60px Plex, monospace', glow: 12 });
		const exitMat = new THREE.MeshBasicNodeMaterial({ map: exitTex });
		const exitSign = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.16, 0.42), [glowMaterial(0x222222, 1), exitMat, glowMaterial(0x222222, 1), glowMaterial(0x222222, 1), glowMaterial(0x222222, 1), glowMaterial(0x222222, 1)]);
		exitSign.position.set(HW - 0.03, 2.35, LEN - 1.0); exitSign.rotation.y = 0; root.add(exitSign);
		const exitPlane = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.16), exitMat);
		exitPlane.position.set(0, 2.38, LEN + 2.98); exitPlane.rotation.y = Math.PI; root.add(exitPlane);
		props.exitMat = exitMat;
		const fireDoor = (x, rotY) => {
			const g = new THREE.Group();
			const d = new THREE.Mesh(new THREE.BoxGeometry(1.5, 2.2, 0.06), new THREE.MeshStandardNodeMaterial({ color: 0x7a2a1e, roughness: 0.55, metalness: 0.2 })); d.position.y = 1.1; g.add(d);
			const bar = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.06, 0.06), brass); bar.position.set(0, 1.0, 0.06); g.add(bar);
			const sgn = new THREE.Mesh(new THREE.PlaneGeometry(0.36, 0.13), exitMat); sgn.position.set(0, 2.4, 0.04); g.add(sgn);
			g.position.set(x, 0, 0); g.rotation.y = rotY; return g;
		};
		const fdW = fireDoor(0, Math.PI / 2); fdW.position.set(-8 + 0.03, 0, -1.5); root.add(fdW);
		const fdE = fireDoor(0, -Math.PI / 2); fdE.position.set(8 - 0.03, 0, LEN + 1.5); root.add(fdE);
		// floor counter sign in the south bend (facing the player as they enter)
		let counterTex = null;
		const counterMat = new THREE.MeshStandardNodeMaterial({ roughness: 0.5, emissive: new THREE.Color(0.12, 0.1, 0.08) });
		const counter = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.45), counterMat);
		counter.position.set(HW - 0.005, 1.7, -1.5); counter.rotation.y = -Math.PI / 2; root.add(counter);
		const setCounter = (n) => {
			counterTex?.dispose();
			counterTex = textTexture(n >= NEED ? 'FLOOR 8' : `FLOOR 8  ·  ${n}`, { w: 512, h: 256, bg: '#15100a', fg: '#e6c27a', font: '600 70px Plex, monospace' });
			counterMat.map = counterTex; counterMat.emissiveMap = counterTex; counterMat.needsUpdate = true;
		};
		// water puddle (anomaly)
		const puddle = new THREE.Mesh(new THREE.CircleGeometry(1, 40), new THREE.MeshPhysicalNodeMaterial({ color: 0x120b06, roughness: 0.04, metalness: 0, clearcoat: 1, transparent: true, opacity: 0.85 }));
		puddle.rotation.x = -Math.PI / 2; puddle.position.set(-0.6, 0.006, 23); puddle.scale.set(0.8, 1.4, 1); puddle.visible = false; root.add(puddle);
		// mannequin (anomaly)
		const manq = createMannequin(); manq.root.position.set(0.4, 0, LEN - 2); manq.root.rotation.y = Math.PI; manq.root.visible = false; root.add(manq.root);
		// charger (anomaly)
		const charger = createHollow(); charger.root.visible = false; root.add(charger.root);
		// red light (anomaly door)
		const redL = new THREE.PointLight(0xff1a0a, 0, 5, 1.4); root.add(redL);

		// rules poster in the west stub
		const inter = new Interactions();
		createNote(root, inter, { x: -4.5, y: 1.5, z: -0.02, wall: Math.PI, html: '<b>FLOOR 8 — GUEST NOTICE</b><br><br>Look carefully at the corridor.<br><br>If you notice <b>anything unusual</b>, turn back <b>immediately</b>.<br>If you notice <b>nothing unusual</b>, do not turn back.<br><br>Leave through the fire door at the end.<br>Do this <b>five times in a row</b> to leave Floor 8.<br><br><i>Do not run from anything that is not chasing you.<br>Run from anything that is.</i>' });

		// ---------------------------------------------------------- anomalies
		const ANOM = {
			painting: { on() { pMat.map = paintBad; pMat.needsUpdate = true; }, off() { pMat.map = paintTex; pMat.needsUpdate = true; } },
			doorAjar: { on() { const d = doors[5]; d.hinge.rotation.y = d.base + d.side * 0.5; redL.position.set(d.side * (HW + 0.6), 1.2, d.z); redL.intensity = 3; }, off() { const d = doors[5]; d.hinge.rotation.y = d.base; redL.intensity = 0; } },
			redLights: { on() { lights.forEach(l => { if (l.z > LEN / 2) l.L.color.setHex(0xff3a20); }); }, off() { lights.forEach(l => l.L.color.setHex(0xffc98a)); } },
			flicker: { on() { anomFlicker = true; }, off() { anomFlicker = false; } },
			darkEnd: { on() { lights.forEach(l => { if (l.z > LEN - 9 && l.z < LEN) { l.L.intensity = 0; l.dead = true; } }); }, off() { lights.forEach(l => { l.dead = false; }); } },
			mannequin: { on() { randomPose(manq, rng); manq.root.visible = true; }, off() { manq.root.visible = false; } },
			plaque: { on() { const d = doors[6]; d.plaque.material.map = textTexture('8O8', { w: 256, h: 128, bg: '#1b120b', fg: '#d8b56a', font: '600 78px Plex, monospace' }); d.plaque.material.needsUpdate = true; }, off() { const d = doors[6]; d.plaque.material.map = textTexture(String(d.num), { w: 256, h: 128, bg: '#1b120b', fg: '#d8b56a', font: '600 78px Plex, monospace' }); d.plaque.material.needsUpdate = true; } },
			exitSign: { on() { exitMat.map = exitBad; exitMat.needsUpdate = true; }, off() { exitMat.map = exitTex; exitMat.needsUpdate = true; } },
			noExt: { on() { ext.visible = false; }, off() { ext.visible = true; } },
			puddle: { on() { puddle.visible = true; puddle.scale.set(0.3, 0.5, 1); puddleGrow = true; }, off() { puddle.visible = false; puddleGrow = false; } },
			clock: { on() { clockFast = true; }, off() { clockFast = false; } },
			knock: { on() { knockArmed = true; }, off() { knockArmed = false; } },
			bigVase: { on() { flower.scale.setScalar(3.2); flower.material.color.setHex(0x7a0d0d); }, off() { flower.scale.setScalar(1); flower.material.color.setHex(0xd8d0c0); } },
			steps: { on() { stepsBehind = true; }, off() { stepsBehind = false; } },
			charger: { on() { charger.root.visible = true; charger.visibility.value = 1; charger.root.position.set(0, 0, LEN - 1); charger.root.rotation.y = Math.PI; chargeState = 'wait'; }, off() { charger.root.visible = false; chargeState = 'off'; } },
		};
		const names = Object.keys(ANOM);
		let anomFlicker = false, puddleGrow = false, clockFast = false, knockArmed = false, stepsBehind = false, chargeState = 'off';
		let current = null, lastAnom = null, count = 0, loops = 0, entered = false, maxZ = 0, transitioning = false;
		const used = new Set();

		function rollLoop() {
			if (current) ANOM[current].off();
			current = null;
			if (loops > 0 && rng() < 0.58) {
				let pool = names.filter(n => n !== lastAnom && !used.has(n));
				if (!pool.length) { used.clear(); pool = names.filter(n => n !== lastAnom); }
				// the charger only appears after a few loops
				if (loops < 3) pool = pool.filter(n => n !== 'charger');
				current = pool[Math.floor(rng() * pool.length)];
				used.add(current); lastAnom = current;
				ANOM[current].on();
			}
			loops++;
			entered = false; maxZ = 0; knockDone = false; stepT = 0;
		}
		let knockDone = false, stepT = 0;

		async function pass(forward) {
			if (transitioning) return;
			transitioning = true;
			const correct = forward ? !current : !!current;
			count = correct ? count + 1 : 0;
			level.freeze = true;
			audio.doorOpen();
			await ui.fade(1, false, 350);
			if (count >= NEED) { game.complete({}); return; }
			rollLoop();
			setCounter(count);
			player.spawn(-5.6, -1.5, -Math.PI / 2, 0);
			charger.root.visible = current === 'charger';
			await sleep(250);
			level.freeze = false;
			ui.fade(0, false, 600);
			if (!correct && loops > 1) { audio.stinger(0.35); ui.subtitle('...back to the start.', 2.5); }
			updateObjective();
			transitioning = false;
		}

		// ---------------------------------------------------------- level object
		let T = 0;
		const tmp = new THREE.Vector3();
		const level = {
			scene, root, col, interactions: inter,
			spawn: { x: -5.6, z: -1.5, yaw: -Math.PI / 2 },
			flash: { allowed: false, drain: 0 },
			surfaceAt: () => 'carpet',
			start() {
				audio.setReverb(0.9, 0.75, 0.3);
				audio.roomtone(0.05, 60); audio.hum(0.025);
				audio.musicBox(0.022, [67, 71, 74, 78, 76, 74, 71, 0, 69, 72, 76, 79, 78, 76, 72, 0], 0.9);
				setCounter(0); rollLoop(); updateObjective();
				setTimeout(() => ui.subtitle('A hotel corridor. There\'s a notice on the wall.', 4), 3000);
			},
			update(dt, t) {
				T += dt;
				const p = player.pos;
				if (p.z > 3) entered = true;
				maxZ = Math.max(maxZ, p.z);
				// lights + flicker anomaly
				for (const l of lights) {
					let v = l.dead ? 0 : 1;
					if (anomFlicker && l.z > 10 && l.z < 30) v *= (Math.sin(t * 31 + l.z) * Math.sin(t * 9.3 + l.z * 2) > 0.2 ? 0.08 : 1);
					l.L.intensity = l.base * v;
				}
				// clock
				const sec = clockFast ? T * 40 : T * 0.02 + 2.3;
				props.hM.rotation.x = -sec; props.hH.rotation.x = -sec / 12;
				if (puddleGrow) { puddle.scale.x = Math.min(1.3, puddle.scale.x + dt * 0.03); puddle.scale.y = Math.min(2.2, puddle.scale.y + dt * 0.05); if (rng() < dt * 1.5) audio.drip({ x: -1.4, y: 2.2, z: 23 }); }
				if (knockArmed && !knockDone && p.z > 9 && p.z < 14) { knockDone = true; audio.knock({ x: -1.8, y: 1.3, z: 11 }, 4); doors[2].hinge.rotation.y = doors[2].base + 0.03; setTimeout(() => doors[2].hinge.rotation.y = doors[2].base, 1300); }
				if (stepsBehind && entered) {
					stepT -= dt;
					if (stepT < 0 && player.speedNow > 0.5) { stepT = 0.55; player.forward(tmp); audio.thud({ x: p.x - tmp.x * 3, y: 0, z: p.z - tmp.z * 3 }, 0.3); }
				}
				// charger anomaly
				if (current === 'charger' && chargeState !== 'off') {
					const c = charger.root.position;
					const d = Math.hypot(p.x - c.x, p.z - c.z);
					if (chargeState === 'wait') { animateWalk(charger, 0, 0, t, 0.2); if (p.z > 11) { chargeState = 'run'; audio.stinger(1); fx.glitch.value = 0.7; } }
					else if (chargeState === 'run') {
						const s = 5.2 * dt, dx = p.x - c.x, dz = p.z - c.z, l = Math.hypot(dx, dz) || 1;
						c.x += dx / l * s; c.z += dz / l * s; charger.root.rotation.y = Math.atan2(dx, dz);
						charger.phase = (charger.phase || 0) + s * 2.4; animateWalk(charger, charger.phase, 1, t, 0.6);
						if (charger.phase % 2.6 < s * 2.4) audio.thud({ x: c.x, y: 0, z: c.z }, 0.8);
						game.setFear(clamp(1 - d / 20, 0, 1));
						if (d < 0.9) game.die('It ran.');
						if (p.z < -0.5 && p.x < -5.5) { chargeState = 'off'; }
					}
				} else game.setFear(current && current !== 'charger' && maxZ > 8 ? 0.15 : 0);
				// transitions
				if (!transitioning) {
					if (p.x > 6.4 && p.z > LEN) pass(true);
					else if (p.x < -6.6 && p.z < 0 && entered) pass(false);
				}
			},
			dispose() {}
		};
		function updateObjective() {
			ui.setObjective('LEVEL 4 · FLOOR 8', count === 0 ? 'Anomaly → turn back.  No anomaly → keep going.' : `Correct in a row: ${count}/${NEED}`);
		}
		return level;
	}
};
