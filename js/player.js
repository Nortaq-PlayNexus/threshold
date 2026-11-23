// First-person controller: mouse look, sprint/crouch, wading, head-bob, footsteps, flashlight.
import * as THREE from 'three/webgpu';
import { clamp, damp, lerp } from './util.js';
import { audio } from './audio.js';

export class Player {
	constructor(camera, input, settings) {
		this.cam = camera;
		this.input = input;
		this.settings = settings;
		this.pos = new THREE.Vector3();
		this.vel = new THREE.Vector3();
		this.yaw = 0; this.pitch = 0;
		this.radius = 0.3;
		this.crouchT = 0;
		this.stamina = 1;
		this.battery = 1;
		this.bobPhase = 0; this.lastStep = 0;
		this.eyeY = 1.65;
		this.speedNow = 0;
		this.noise = 0;          // how loud the player is (for AI hearing)
		this.frozen = false;
		this.lookOverride = null; // {target: Vector3, t}
		this.flashOn = false;
		this.flashAllowed = true;
		this.flashDrain = 1 / 120;
		this.headUnder = false;
		this.wadeDepth = 0;

		// Flashlight
		const fl = new THREE.SpotLight(0xfff0dc, 0, 32, 0.48, 0.55, 1.4);
		fl.castShadow = true;
		fl.shadow.mapSize.set(1024, 1024);
		fl.shadow.camera.near = 0.2; fl.shadow.camera.far = 32;
		fl.shadow.bias = -0.0004;
		fl.position.set(0.18, -0.2, 0.1);
		fl.target.position.set(0, -0.2, -5);
		this.flash = fl;
		this.flashRig = new THREE.Group();
		this.flashRig.add(fl, fl.target);
		this._sway = new THREE.Quaternion();
	}

	attach(scene) {
		scene.add(this.cam);
		this.cam.add(this.flashRig);
	}

	spawn(x, z, yaw = 0, ground = 0) {
		this.pos.set(x, ground, z);
		this.vel.set(0, 0, 0);
		this.yaw = yaw; this.pitch = 0;
		this.stamina = 1; this.crouchT = 0;
		this.frozen = false; this.lookOverride = null;
		this._feetY = ground;
	}

	setFlash(on) {
		if (on && (!this.flashAllowed || this.battery <= 0.01)) on = false;
		if (on !== this.flashOn) audio.flashlight(on);
		this.flashOn = on;
	}

	update(dt, level) {
		const inp = this.input, s = this.settings;
		const col = level.col;

		// ---- look
		if (!this.frozen) {
			const sens = 0.0021 * s.sens;
			this.yaw -= inp.mx * sens;
			this.pitch -= inp.my * sens * (s.invert ? -1 : 1);
			this.pitch = clamp(this.pitch, -1.45, 1.45);
		}
		if (this.lookOverride) {
			const lo = this.lookOverride, dx = lo.target.x - this.cam.position.x, dz = lo.target.z - this.cam.position.z, dy = lo.target.y - this.cam.position.y;
			const ty = Math.atan2(-dx, -dz), tp = Math.atan2(dy, Math.hypot(dx, dz));
			let d = ty - this.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
			this.yaw += d * Math.min(1, dt * lo.speed); this.pitch = lerp(this.pitch, tp, Math.min(1, dt * lo.speed));
		}

		// ---- move
		let fx = 0, fz = 0;
		if (!this.frozen) {
			if (inp.down('KeyW', 'ArrowUp')) fz -= 1;
			if (inp.down('KeyS', 'ArrowDown')) fz += 1;
			if (inp.down('KeyA', 'ArrowLeft')) fx -= 1;
			if (inp.down('KeyD', 'ArrowRight')) fx += 1;
		}
		const moving = fx || fz;
		const crouch = !this.frozen && inp.down('KeyC', 'ControlLeft', 'ControlRight');
		this.crouchT = damp(this.crouchT, crouch ? 1 : 0, 10, dt);
		const wantSprint = inp.down('ShiftLeft', 'ShiftRight') && moving && !crouch && fz <= 0;
		const sprint = wantSprint && this.stamina > 0.02 && !this._exhausted;
		if (sprint) this.stamina = Math.max(0, this.stamina - dt / 6.5);
		else this.stamina = Math.min(1, this.stamina + dt / (moving ? 7 : 4));
		if (this.stamina <= 0.01) this._exhausted = true;
		if (this._exhausted && this.stamina > 0.35) this._exhausted = false;

		const g = col.ground(this.pos.x, this.pos.z);
		const water = level.waterLevel !== undefined ? level.waterLevel() : -99;
		this.wadeDepth = Math.max(0, water - g);
		const wade = 1 - clamp(this.wadeDepth / 1.5, 0, 1) * 0.55;

		let speed = (sprint ? 5.4 : 2.6) * lerp(1, 0.5, this.crouchT) * wade * (level.speedMul || 1);
		const len = Math.hypot(fx, fz) || 1;
		const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
		const wx = (fx * cos + fz * sin) / len * speed, wz = (-fx * sin + fz * cos) / len * speed;
		const accel = moving ? 10 : 12;
		this.vel.x = damp(this.vel.x, moving ? wx : 0, accel, dt);
		this.vel.z = damp(this.vel.z, moving ? wz : 0, accel, dt);
		const before = this.pos.clone();
		col.move(this.pos, this.vel.x * dt, this.vel.z * dt, this.radius, this._feetY);
		const moved = Math.hypot(this.pos.x - before.x, this.pos.z - before.z);
		this.speedNow = moved / Math.max(dt, 1e-4);

		// ---- vertical: follow ground smoothly (falls are quick, steps smooth)
		const g2 = col.ground(this.pos.x, this.pos.z);
		this._feetY = this._feetY > g2 ? damp(this._feetY, g2, 9, dt) : damp(this._feetY, g2, 14, dt);
		this.pos.y = this._feetY;

		// ---- head bob + footsteps
		const bobAmt = clamp(this.speedNow / 5.4, 0, 1);
		this.bobPhase += moved * (sprint ? 1.9 : 2.3);
		const bob = Math.sin(this.bobPhase * Math.PI) * 0.045 * bobAmt;
		const sway = Math.cos(this.bobPhase * Math.PI * 0.5) * 0.03 * bobAmt;
		const stepIdx = Math.floor(this.bobPhase);
		if (stepIdx !== this.lastStep && this.speedNow > 0.4) {
			this.lastStep = stepIdx;
			let surf = level.surfaceAt ? level.surfaceAt(this.pos.x, this.pos.z) : 'concrete';
			let inten = sprint ? 1.25 : crouch ? 0.35 : 0.8;
			if (this.wadeDepth > 0.03) { surf = 'water'; inten *= this.wadeDepth > 0.5 ? 1.5 : 1; }
			audio.footstep(surf, inten);
			level.onFootstep && level.onFootstep(this, surf, inten);
		}
		this.noise = this.speedNow < 0.3 ? 0 : sprint ? 1 : crouch ? 0.15 : 0.45;
		if (this.wadeDepth > 0.03 && this.speedNow > 0.3) this.noise = Math.min(1, this.noise + 0.25);

		// ---- camera
		this.eyeY = lerp(1.65, 1.0, this.crouchT);
		this.cam.position.set(this.pos.x + sway * cos, this.pos.y + this.eyeY + bob, this.pos.z - sway * sin);
		this.cam.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
		this.headUnder = this.cam.position.y < water - 0.02;

		// FOV kick while sprinting
		const fov = s.fov + (sprint ? 6 : 0);
		if (Math.abs(this.cam.fov - fov) > 0.05) { this.cam.fov = damp(this.cam.fov, fov, 6, dt); this.cam.updateProjectionMatrix(); }

		// ---- flashlight
		if (!this.frozen && inp.hit('KeyF')) this.setFlash(!this.flashOn);
		if (this.flashOn) {
			this.battery = Math.max(0, this.battery - dt * this.flashDrain);
			if (this.battery <= 0) this.setFlash(false);
		} else if (level.rechargeFlash) this.battery = Math.min(1, this.battery + dt / 25);
		const flick = this.battery < 0.15 ? (Math.random() < 0.08 ? 0.2 : 1) : 1;
		this.flash.intensity = this.flashOn ? 38 * flick * (0.4 + 0.6 * Math.min(1, this.battery * 4)) : 0;
		// slight lag on the beam so it feels hand-held
		this.flashRig.rotation.x = damp(this.flashRig.rotation.x, -inp.my * 0.0008, 8, dt);
		this.flashRig.rotation.y = damp(this.flashRig.rotation.y, -inp.mx * 0.0008, 8, dt);
	}

	forward(out) { return this.cam.getWorldDirection(out); }
}
