// Procedural creatures + AI.
import * as THREE from 'three/webgpu';
import { positionLocal, normalLocal, time, sin, vec3, float, uniform, mx_noise_float, normalView, positionView, dot, pow, max, mix, Fn, hash, step } from 'three/tsl';
import { audio } from './audio.js';
import { clamp, damp } from './util.js';

function limb(r, len, mat) {
	const g = new THREE.CapsuleGeometry(r, len, 6, 12);
	g.translate(0, -len / 2 - r * 0.5, 0); // pivot at top
	const m = new THREE.Mesh(g, mat); m.castShadow = true;
	return m;
}

/** Builds a jointed humanoid. Returns {root, joints, mats}. */
function humanoid(mat, { height = 2.4, thin = 1, headScale = [1, 1.35, 1], armLen = 1 } = {}) {
	const s = height / 2.4;
	const root = new THREE.Group();
	const hips = new THREE.Group(); hips.position.y = 1.15 * s; root.add(hips);
	const spine = new THREE.Group(); hips.add(spine);
	const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.17 * s * thin, 0.62 * s, 6, 14), mat);
	torso.position.y = 0.42 * s; torso.scale.set(1.1, 1, 0.65); torso.castShadow = true; spine.add(torso);
	const pelvis = new THREE.Mesh(new THREE.SphereGeometry(0.16 * s * thin, 16, 12), mat);
	pelvis.scale.set(1.15, 0.8, 0.75); pelvis.castShadow = true; hips.add(pelvis);
	const neck = new THREE.Group(); neck.position.y = 0.86 * s; spine.add(neck);
	const neckM = limb(0.045 * s, 0.16 * s, mat); neckM.rotation.x = Math.PI; neck.add(neckM);
	const head = new THREE.Group(); head.position.y = 0.24 * s; neck.add(head);
	const headM = new THREE.Mesh(new THREE.SphereGeometry(0.13 * s, 24, 18), mat);
	headM.scale.set(...headScale); headM.position.y = 0.06 * s; headM.castShadow = true; head.add(headM);
	const mk = (side) => {
		const sh = new THREE.Group(); sh.position.set(side * 0.24 * s * thin, 0.78 * s, 0); spine.add(sh);
		const up = limb(0.05 * s * thin, 0.42 * s * armLen, mat); sh.add(up);
		const el = new THREE.Group(); el.position.y = -0.52 * s * armLen; sh.add(el);
		const lo = limb(0.042 * s * thin, 0.46 * s * armLen, mat); el.add(lo);
		const hand = new THREE.Mesh(new THREE.SphereGeometry(0.05 * s, 10, 8), mat); hand.scale.set(0.8, 1.8, 0.5); hand.position.y = -0.6 * s * armLen; el.add(hand);
		const hp = new THREE.Group(); hp.position.set(side * 0.1 * s, -0.05 * s, 0); hips.add(hp);
		const th = limb(0.07 * s * thin, 0.42 * s, mat); hp.add(th);
		const kn = new THREE.Group(); kn.position.y = -0.55 * s; hp.add(kn);
		const sn = limb(0.055 * s * thin, 0.42 * s, mat); kn.add(sn);
		const ft = new THREE.Mesh(new THREE.BoxGeometry(0.09 * s, 0.05 * s, 0.22 * s), mat); ft.position.set(0, -0.56 * s, 0.05 * s); kn.add(ft);
		return { sh, el, hp, kn };
	};
	const L = mk(1), R = mk(-1);
	return { root, hips, spine, neck, head, headM, L, R, s };
}

// ------------------------------------------------------------------ Hollow
export function createHollow() {
	const mat = new THREE.MeshStandardNodeMaterial({ color: 0x030303, roughness: 0.75, metalness: 0 });
	const visibility = uniform(1);
	// Shimmering, boiling silhouette: displaced along normals with animated noise.
	mat.positionNode = Fn(() => {
		const n = mx_noise_float(positionLocal.mul(9).add(vec3(0, time.mul(3.0), time.mul(1.3))));
		const jitter = sin(time.mul(60).add(positionLocal.y.mul(40))).mul(0.004);
		return positionLocal.add(normalLocal.mul(n.mul(0.018).add(jitter)));
	})();
	const rim = Fn(() => {
		const v = positionView.normalize().negate();
		return pow(float(1).sub(max(dot(normalView, v), 0)), 3.0);
	})();
	mat.emissiveNode = vec3(0.06, 0.07, 0.09).mul(rim);
	// noise dissolve (opaque + alpha test keeps it in the GTAO/TRAA prepass)
	const dissolve = step(mx_noise_float(positionLocal.mul(14)).mul(0.5).add(0.5), visibility.mul(1.02));
	mat.opacityNode = dissolve;
	mat.alphaTest = 0.5;

	const h = humanoid(mat, { height: 2.55, thin: 0.8, headScale: [0.95, 1.5, 1.05], armLen: 1.35 });
	const eyeMat = new THREE.MeshBasicNodeMaterial({ color: new THREE.Color(6, 6, 5.5) });
	eyeMat.opacityNode = step(0.5, visibility); eyeMat.alphaTest = 0.5;
	const eg = new THREE.SphereGeometry(0.018, 8, 6);
	const e1 = new THREE.Mesh(eg, eyeMat), e2 = new THREE.Mesh(eg, eyeMat);
	e1.position.set(0.045, 0.1, 0.12); e2.position.set(-0.045, 0.1, 0.12);
	h.head.add(e1, e2);
	h.eyes = [e1, e2];
	h.visibility = visibility;
	h.root.traverse(o => { if (o.isMesh) o.frustumCulled = false; });
	h.kind = 'hollow';
	return h;
}

// ------------------------------------------------------------------ Mannequin
export function createMannequin() {
	const mat = new THREE.MeshPhysicalNodeMaterial({ color: 0xe9e4da, roughness: 0.35, clearcoat: 0.8, clearcoatRoughness: 0.15 });
	const h = humanoid(mat, { height: 1.9, thin: 1.15, headScale: [0.95, 1.25, 1.05], armLen: 0.95 });
	h.kind = 'mannequin';
	h.root.traverse(o => { if (o.isMesh) { o.castShadow = true; } });
	return h;
}

// ------------------------------------------------------------------ animation
export function animateWalk(h, phase, amt, t, hunch = 0.35) {
	const sw = Math.sin(phase) * 0.6 * amt;
	h.L.hp.rotation.x = sw; h.R.hp.rotation.x = -sw;
	h.L.kn.rotation.x = Math.max(0, -Math.sin(phase + 1.2)) * 0.9 * amt;
	h.R.kn.rotation.x = Math.max(0, Math.sin(phase + 1.2)) * 0.9 * amt;
	h.L.sh.rotation.x = -sw * 0.5 + 0.1; h.R.sh.rotation.x = sw * 0.5 + 0.1;
	h.L.el.rotation.x = -0.15; h.R.el.rotation.x = -0.15;
	h.spine.rotation.x = hunch;
	h.neck.rotation.x = -hunch * 0.6;
	h.hips.position.y = 1.15 * h.s + Math.abs(Math.cos(phase)) * 0.04 * amt;
	if (h.kind === 'hollow') {
		// unnatural twitches
		const tw = Math.sin(t * 13.1) * Math.sin(t * 7.3) > 0.85 ? 1 : 0;
		h.head.rotation.z = Math.sin(t * 1.7) * 0.15 + tw * 0.5;
		h.head.rotation.y = Math.sin(t * 0.9) * 0.2;
		h.L.sh.rotation.z = 0.12; h.R.sh.rotation.z = -0.12;
	}
}

export function randomPose(h, rng = Math.random) {
	const r = (a) => (rng() * 2 - 1) * a;
	h.L.sh.rotation.set(r(1.6) - 0.3, 0, r(0.6) + 0.2);
	h.R.sh.rotation.set(r(1.6) - 0.3, 0, r(0.6) - 0.2);
	h.L.el.rotation.x = -rng() * 1.8; h.R.el.rotation.x = -rng() * 1.8;
	h.L.hp.rotation.x = r(0.5); h.R.hp.rotation.x = r(0.5);
	h.L.kn.rotation.x = rng() * 0.6; h.R.kn.rotation.x = rng() * 0.6;
	h.spine.rotation.set(r(0.3), r(0.4), r(0.2));
	h.head.rotation.set(r(0.5), r(0.9), r(0.6));
	h.neck.rotation.set(0, 0, 0);
}

// ------------------------------------------------------------------ Hunter AI
// States: idle → wander → investigate → chase. Grid BFS + line of sight + hearing.
const _v = new THREE.Vector3(), _t = { x: 0, z: 0 };
export class Hunter {
	constructor(level, model, opts = {}) {
		this.level = level; this.m = model;
		this.pos = new THREE.Vector3();
		this.yaw = 0;
		this.speedWalk = opts.walk ?? 1.4;
		this.speedChase = opts.chase ?? 3.6;
		this.sight = opts.sight ?? 22;
		this.hearing = opts.hearing ?? 16;
		this.killDist = opts.kill ?? 0.9;
		this.state = 'wander';
		this.target = null; this.lastSeen = null; this.lostT = 0;
		this.repath = 0; this.phase = 0; this.active = false;
		this.voice = null; this.stepAcc = 0;
		this.flinch = 0;
		this.splash = !!opts.splash;
		this.alwaysHunt = !!opts.alwaysHunt;
		level.root.add(model.root);
		model.root.visible = false;
	}
	spawn(x, z) {
		this.pos.set(x, this.level.col.ground(x, z), z);
		this.active = true; this.m.root.visible = true;
		this.state = this.alwaysHunt ? 'chase' : 'wander';
		this.m.visibility && (this.m.visibility.value = 1);
		if (!this.voice && audio.ctx) this.voice = audio.createVoice('hollow');
		this.repath = 0;
	}
	despawn() {
		this.active = false; this.m.root.visible = false;
		if (this.voice) { this.voice.stop(); this.voice = null; }
	}
	canSee(player) {
		const c = player.cam.position;
		const d = Math.hypot(c.x - this.pos.x, c.z - this.pos.z);
		if (d > this.sight) return false;
		const lit = player.flashOn || this.level.lit !== false;
		if (!lit && d > 6) return false;
		return this.level.col.los(this.pos.x, this.pos.z, c.x, c.z, 1.5);
	}
	update(dt, player, t) {
		if (!this.active) return { dist: 999 };
		const lvl = this.level, nav = lvl.nav;
		const c = player.pos;
		const dist = Math.hypot(c.x - this.pos.x, c.z - this.pos.z);
		const sees = this.canSee(player);
		const hears = player.noise > 0 && dist < this.hearing * player.noise;

		if (sees || hears || this.alwaysHunt) { this.state = 'chase'; this.lastSeen = { x: c.x, z: c.z }; this.lostT = 0; }
		else if (this.state === 'chase') { this.lostT += dt; if (this.lostT > 5) this.state = 'investigate'; }

		// flinch when lit by the flashlight
		this.flinch = Math.max(0, this.flinch - dt);
		if (player.flashOn && dist < 14) {
			player.forward(_v);
			const dx = this.pos.x - player.cam.position.x, dz = this.pos.z - player.cam.position.z, l = Math.hypot(dx, dz) || 1;
			if ((dx * _v.x + dz * _v.z) / l > 0.93 && sees) this.flinch = 0.25;
		}

		// choose target
		let goal = null, speed = this.speedWalk;
		if (this.state === 'chase') { goal = this.lastSeen; speed = this.speedChase; }
		else if (this.state === 'investigate') {
			goal = this.lastSeen; speed = this.speedWalk * 1.4;
			if (!goal || Math.hypot(goal.x - this.pos.x, goal.z - this.pos.z) < 1.2) { this.state = 'wander'; this.target = null; }
		}
		if (this.state === 'wander') {
			if (!this.target || Math.hypot(this.target.x - this.pos.x, this.target.z - this.pos.z) < 1.2) {
				// wander roughly toward the player's area to keep pressure on
				const p = nav.randomFree(Math.random);
				this.target = Math.random() < 0.5 ? { x: (p.x + c.x) / 2, z: (p.z + c.z) / 2 } : p;
			}
			goal = this.target;
		}
		if (this.flinch > 0) speed *= 0.25;

		// path step
		if (goal) {
			let tx = goal.x, tz = goal.z;
			const direct = lvl.col.los(this.pos.x, this.pos.z, tx, tz, 1.0) && lvl.col.los(this.pos.x + 0.3, this.pos.z + 0.3, tx, tz, 1.0);
			if (!direct) {
				this.repath -= dt;
				if (this.repath <= 0 || !this._field) { nav.flood(tx, tz); this._field = true; this.repath = 0.4; }
				const n = nav.nextStep(this.pos.x, this.pos.z, _t);
				if (n) { tx = n.x; tz = n.z; }
			}
			const dx = tx - this.pos.x, dz = tz - this.pos.z, l = Math.hypot(dx, dz);
			if (l > 0.05) {
				const step = Math.min(l, speed * dt);
				const nx = this.pos.x + dx / l * step, nz = this.pos.z + dz / l * step;
				this.pos.x = nx; this.pos.z = nz;
				const ty = Math.atan2(dx, dz);
				let d = ty - this.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
				this.yaw += d * Math.min(1, dt * 6);
				this.phase += step * 2.2;
				this.stepAcc += step;
				if (this.stepAcc > 1.1) { this.stepAcc = 0; audio.thud(this.m.root.position, speed > 2.5 ? 0.7 : 0.35, this.splash); }
			}
		}
		this.pos.y = damp(this.pos.y, lvl.col.ground(this.pos.x, this.pos.z), 8, dt);
		this.m.root.position.copy(this.pos);
		this.m.root.rotation.y = this.yaw;
		animateWalk(this.m, this.phase, clamp(speed / 3, 0.3, 1), t, this.state === 'chase' ? 0.55 : 0.3);
		if (this.voice) this.voice.set(_v.set(this.pos.x, this.pos.y + 2, this.pos.z), this.state === 'chase' ? 0.55 : 0.25);
		return { dist, sees, state: this.state };
	}
}
