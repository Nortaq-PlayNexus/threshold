import * as THREE from 'three/webgpu';
import { Renderer, fx } from './renderer.js';
import { Input } from './input.js';
import { Player } from './player.js';
import { audio } from './audio.js';
import { ui } from './ui.js';
import { setAniso, setProgressHandler } from './assets.js';
import { disposeTree } from './world.js';
import { clamp, damp, nextFrame } from './util.js';

import L1 from './levels/l1_lobby.js';
import L2 from './levels/l2_pool.js';
import L3 from './levels/l3_aqueduct.js';
import L4 from './levels/l4_hotel.js';
import L5 from './levels/l5_deep.js';
import L6 from './levels/l6_hill.js';

const LEVELS = [L1, L2, L3, L4, L5, L6];
const params = new URLSearchParams(location.search);

// ------------------------------------------------------------ settings & save
const defaults = { quality: 'high', sens: 1, fov: 75, vol: 0.8, bright: 1, invert: false, vhs: true };
const settings = Object.assign({}, defaults, JSON.parse(localStorage.getItem('threshold.settings') || '{}'));
const save = Object.assign({ unlocked: 1, deaths: 0, time: 0, current: 0 }, JSON.parse(localStorage.getItem('threshold.save') || '{}'));
const persist = () => { localStorage.setItem('threshold.settings', JSON.stringify(settings)); localStorage.setItem('threshold.save', JSON.stringify(save)); };

class Game {
	async boot() {
		this.canvas = document.getElementById('view');
		if (!navigator.gpu) console.warn('WebGPU not available — falling back to WebGL2 backend');
		this.renderer = await new Renderer(this.canvas).init();
		this.renderer.quality = params.get('q') || settings.quality;
		if (!this.renderer.isWebGPU && !params.get('q') && settings.quality === 'ultra') this.renderer.quality = 'high';
		this.renderer.resize();
		setAniso(this.renderer.maxAniso);
		document.getElementById('gpuinfo').textContent = this.renderer.isWebGPU ? 'WebGPU backend active' : 'WebGL2 fallback backend (WebGPU unavailable)';

		this.camera = new THREE.PerspectiveCamera(settings.fov, innerWidth / innerHeight, 0.05, 400);
		this.renderer.camera = this.camera;
		this.input = new Input(this.canvas);
		this.player = new Player(this.camera, this.input, settings);
		this.timer = new THREE.Timer(); this.timer.connect(document);
		this.state = 'menu';
		this.level = null; this.levelIndex = 0;
		this.holdT = 0; this.elapsed = 0;
		this.fxTarget = { fear: 0 };
		this.input.onUnlock = () => { if (this.state === 'playing' && !this.input.allowNoLock) this.pause(); };
		this.bindUI();
		this.applySettings();
		this.renderer.r.setAnimationLoop(() => this.frame());

		const lv = parseInt(params.get('level'));
		if (lv) { this.input.allowNoLock = !!params.get('auto'); await this.startLevel(lv - 1); }
		else { ui.only('#menu'); ui.fade(0, false, 800); }
		window.__game = this;
	}

	// ------------------------------------------------------------ UI wiring
	bindUI() {
		document.body.addEventListener('click', (e) => {
			const b = e.target.closest('button'); if (!b) return;
			audio.init(); audio.click && audio.ctx && audio.click();
			const act = b.dataset.act;
			if (act === 'new') { save.unlocked = Math.max(save.unlocked, 1); save.deaths = 0; save.time = 0; persist(); this.startLevel(0); }
			else if (act === 'continue') this.startLevel(Math.min(save.current || 0, LEVELS.length - 1));
			else if (act === 'levels') { this.renderLevelList(); this.prevScreen = this.state === 'paused' ? '#pause' : '#menu'; ui.only('#levels'); }
			else if (act === 'settings') { this.prevScreen = this.state === 'paused' ? '#pause' : '#menu'; ui.only('#settings'); }
			else if (act === 'controls') { this.prevScreen = '#menu'; ui.only('#controls'); }
			else if (act === 'back') ui.only(this.prevScreen || '#menu');
			else if (act === 'resume') this.resume();
			else if (act === 'restart') this.startLevel(this.levelIndex);
			else if (act === 'quit') this.quit();
			else if (b.dataset.level) this.startLevel(parseInt(b.dataset.level));
		});
		document.getElementById('btnContinue').disabled = !(save.current > 0);
		document.getElementById('clickToPlay').addEventListener('click', () => {
			ui.hide('#clickToPlay'); this.input.lock(); audio.init();
			if (this.state === 'paused') this.resume();
		});
		this.canvas.addEventListener('click', () => { if (this.state === 'playing' && !this.input.locked) this.input.lock(); });

		const bind = (id, key, conv = parseFloat) => {
			const el = document.getElementById(id);
			if (el.type === 'checkbox') el.checked = settings[key]; else el.value = settings[key];
			el.addEventListener('input', () => { settings[key] = el.type === 'checkbox' ? el.checked : conv(el.value); this.applySettings(key); persist(); });
		};
		bind('optQuality', 'quality', v => v); bind('optSens', 'sens'); bind('optFov', 'fov'); bind('optVol', 'vol');
		bind('optBright', 'bright'); bind('optInvert', 'invert'); bind('optVhs', 'vhs');
		addEventListener('keydown', (e) => {
			if (e.code === 'Escape' && this.state === 'paused' && !document.pointerLockElement) { /* stay paused */ }
			if (e.code === 'Escape' && this.state === 'playing' && this.input.allowNoLock) this.pause();
		});
	}

	renderLevelList() {
		const L = document.getElementById('levelList');
		L.innerHTML = '';
		LEVELS.forEach((lv, i) => {
			const b = document.createElement('button');
			b.dataset.level = i;
			b.innerHTML = `${lv.number} — ${lv.name}<small>${lv.blurb}</small>`;
			b.disabled = i >= save.unlocked && !params.get('unlock');
			L.appendChild(b);
		});
	}

	applySettings(key) {
		audio.setVolume(settings.vol);
		fx.bright.value = settings.bright;
		fx.vhs.value = settings.vhs ? 1 : 0;
		this.camera.fov = settings.fov; this.camera.updateProjectionMatrix();
		if (key === 'quality' && this.renderer.quality !== settings.quality) {
			this.renderer.setQuality(settings.quality);
			if (this.level) this.level.onQuality && this.level.onQuality(settings.quality);
		}
	}

	// ------------------------------------------------------------ level flow
	async startLevel(i) {
		audio.init();
		this.state = 'loading';
		ui.hide('#hud'); ui.hide('#clickToPlay'); ui.closeReader();
		await ui.fade(1, false, 500);
		ui.only('#loading'); ui.loading(0.02, 'entering ' + LEVELS[i].name.toLowerCase() + '…');
		await nextFrame();
		if (this.level) { this.unloadLevel(); }
		audio.stopAll(0.5); audio.stopMusic();
		Object.values(fx).forEach(u => { if (u.isNode && typeof u.value === 'number') {} });
		fx.fear.value = 0; fx.glitch.value = 0; fx.damage.value = 0; fx.under.value = 0; fx.tint.value.setRGB(1, 1, 1);
		fx.exposure.value = 1; fx.bloomStrength.value = 0.35; fx.vignette.value = 0.55;
		this.fxTarget.fear = 0;

		let loaded = 0;
		setProgressHandler(() => { loaded++; ui.loading(Math.min(0.9, 0.05 + loaded * 0.06)); });
		const def = LEVELS[i];
		this.levelIndex = i;
		save.current = i; save.unlocked = Math.max(save.unlocked, i + 1); persist();
		document.getElementById('btnContinue').disabled = false;

		this.player.flashOn = false; this.player.battery = 1;
		const ctx = { game: this, renderer: this.renderer, player: this.player, camera: this.camera, quality: this.renderer.quality, settings };
		try {
			this.level = await def.build(ctx);
		} catch (e) {
			console.error(e); ui.fatal('Failed to build level: ' + e.message + '\n' + e.stack); return;
		}
		const L = this.level;
		L.def = def;
		this.player.attach(L.scene);
		this.player.flashAllowed = L.flash?.allowed ?? true;
		this.player.flashDrain = L.flash?.drain ?? 1 / 120;
		this.player.flash.castShadow = this.renderer.quality !== 'low';
		const sp = L.spawn;
		this.player.spawn(sp.x, sp.z, sp.yaw ?? 0, L.col.ground(sp.x, sp.z));
		this.player.update(0.016, L);
		this.renderer.buildPipeline(L.scene, this.camera);
		ui.loading(0.95, 'compiling shaders…');
		try { await this.renderer.r.compileAsync(L.scene, this.camera); } catch (e) { console.warn('compileAsync', e); }
		ui.loading(1, '');
		// warm up a couple of frames
		for (let k = 0; k < 3; k++) { this.renderer.render(); await nextFrame(); }

		ui.only(null); ui.show('#hud');
		this.state = 'playing';
		this.holdT = 0;
		L.start && L.start();
		ui.card(def.number, def.name, def.subtitle);
		ui.fade(0, false, 2200);
		if (!this.input.locked && !this.input.allowNoLock) ui.show('#clickToPlay');
	}

	unloadLevel() {
		const L = this.level;
		try { L.dispose && L.dispose(); } catch (e) { console.warn(e); }
		if (this.camera.parent) this.camera.parent.remove(this.camera);
		disposeTree(L.scene);
		this.level = null;
	}

	async complete(opts = {}) {
		if (this.state !== 'playing') return;
		this.state = 'transition';
		audio.stopAll(1.5); audio.stopMusic();
		await ui.fade(1, !!opts.white, opts.white ? 2500 : 1500);
		const next = this.levelIndex + 1;
		if (next >= LEVELS.length) return this.ending();
		save.unlocked = Math.max(save.unlocked, next + 1); persist();
		this.startLevel(next);
	}

	die(msg = 'You were found.') {
		if (this.state !== 'playing') return;
		this.state = 'dead';
		save.deaths++; persist();
		fx.glitch.value = 1; fx.damage.value = 0.8;
		audio.jumpscare();
		setTimeout(() => {
			audio.stopAll(0.3);
			this.input.unlock();
			document.getElementById('deathMsg').textContent = msg;
			ui.hide('#hud'); ui.only('#death');
		}, 1100);
	}

	ending() {
		this.state = 'ending';
		this.input.unlock();
		if (this.level) this.unloadLevel();
		ui.hide('#hud'); ui.only('#ending');
		const m = Math.floor(save.time / 60), s = Math.floor(save.time % 60);
		document.getElementById('endStats').textContent = `TIME ${m}m ${s}s  ·  DEATHS ${save.deaths}`;
		ui.fade(0, true, 3000);
		audio.musicBox(0.05, [72, 76, 79, 83, 81, 79, 76, 72, 74, 77, 81, 79, 77, 76, 74, 0], 0.7);
		save.current = 0; persist();
	}

	pause() {
		if (this.state !== 'playing') return;
		this.state = 'paused';
		ui.only('#pause');
		if (audio.ctx) audio.ctx.suspend();
	}
	resume() {
		ui.only(null);
		this.state = 'playing';
		if (audio.ctx) audio.ctx.resume();
		if (!this.input.allowNoLock) this.input.lock();
	}
	quit() {
		this.input.unlock();
		if (audio.ctx) audio.ctx.resume();
		audio.stopAll(0.3); audio.stopMusic();
		if (this.level) this.unloadLevel();
		this.state = 'menu';
		ui.hide('#hud'); ui.only('#menu'); ui.fade(0, false, 600);
		document.getElementById('btnContinue').disabled = !(save.current > 0);
	}

	// ------------------------------------------------------------ per-frame
	frame() {
		this.timer.update();
		const dt = clamp(this.timer.getDelta(), 0, 0.05);
		const t = this.timer.getElapsed();
		const L = this.level;
		if (!L || (this.state !== 'playing' && this.state !== 'dead' && this.state !== 'transition')) { this.input.endFrame(); return; }

		if (this.state === 'playing') {
			this.elapsed += dt; save.time += dt;
			if (Math.floor(save.time) % 10 === 0) persist();
			ui.clock(this.elapsed);
			if (ui.readerOpen) {
				if (this.input.hit('KeyE') || this.input.hit('Escape') || this.input.hit('Space')) { ui.closeReader(); audio.paper(); }
				this.player.frozen = true;
			} else this.player.frozen = !!L.freeze;
			this.player.update(dt, L);
			if (!ui.readerOpen && !L.freeze) this.handleInteract(dt);
			L.update(dt, t);
			ui.meters(this.player.stamina, this.player.battery, this.player.flashAllowed && (this.player.flashOn || this.player.battery < 0.999));
		} else {
			L.update && L.update(dt * 0.3, t);
			this.player.update(dt, L);
		}

		// FX smoothing
		fx.fear.value = damp(fx.fear.value, this.fxTarget.fear, 2.5, dt);
		fx.glitch.value = damp(fx.glitch.value, 0, 3, dt);
		fx.damage.value = damp(fx.damage.value, 0, 1.5, dt);
		fx.under.value = damp(fx.under.value, this.player.headUnder ? 1 : 0, 8, dt);
		audio.setMuffle(this.player.headUnder ? 0.85 : 0);
		// heartbeat
		this._hb = (this._hb || 0) - dt;
		if (fx.fear.value > 0.35 && this._hb <= 0 && this.state === 'playing') { audio.heartbeat(0.15 + fx.fear.value * 0.3); this._hb = 1.1 - fx.fear.value * 0.55; }

		audio.updateListener(this.camera);
		this.renderer.render();
		this.input.endFrame();
	}

	handleInteract(dt) {
		const L = this.level;
		const it = L.interactions ? L.interactions.pick(this.camera, L.col) : null;
		if (it) {
			ui.prompt(`[E] ${typeof it.prompt === 'function' ? it.prompt() : it.prompt}`);
			if (this.input.down('KeyE')) {
				if (it.hold > 0) {
					this.holdT += dt;
					it.onHold && it.onHold(this.holdT / it.hold);
					ui.hold(Math.min(1, this.holdT / it.hold));
					if (this.holdT >= it.hold) { this.holdT = -999; ui.hold(0); it.onUse(); }
				} else if (this.input.hit('KeyE')) it.onUse();
			} else { this.holdT = 0; ui.hold(0); }
		} else { ui.prompt(''); this.holdT = 0; ui.hold(0); }
		if (!this.input.down('KeyE') && this.holdT < 0) this.holdT = 0;
	}

	setFear(v) { this.fxTarget.fear = clamp(v, 0, 1); }
}

const game = new Game();
game.boot().catch(e => { console.error(e); ui.fatal('Startup failed:\n' + (e && e.stack || e)); });
