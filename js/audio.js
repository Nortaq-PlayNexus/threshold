// 100% procedural audio. Web Audio graph:
//   sources → (dry) → master → compressor → out
//           → reverbSend → convolver (synthetic IR) → master
// Positional sources use HRTF PannerNodes bound to the camera listener.
import { clamp } from './util.js';

export class AudioEngine {
	constructor() {
		this.ctx = null;
		this.volume = 0.8;
		this.loops = {};
		this.muffle = 0;
	}

	init() {
		if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
		const ctx = this.ctx = new (window.AudioContext || window.webkitAudioContext)();
		this.comp = ctx.createDynamicsCompressor();
		this.comp.threshold.value = -14; this.comp.ratio.value = 4;
		this.out = ctx.createGain(); this.out.gain.value = this.volume;
		this.lp = ctx.createBiquadFilter(); this.lp.type = 'lowpass'; this.lp.frequency.value = 20000;
		this.master = ctx.createGain();
		this.master.connect(this.lp); this.lp.connect(this.comp); this.comp.connect(this.out); this.out.connect(ctx.destination);
		this.convolver = ctx.createConvolver();
		this.reverbGain = ctx.createGain(); this.reverbGain.gain.value = 0.6;
		this.convolver.connect(this.reverbGain); this.reverbGain.connect(this.master);
		this.reverbSend = ctx.createGain(); this.reverbSend.connect(this.convolver);
		this.setReverb(2.0, 0.5);
		this.white = this.makeNoise('white', 4);
		this.brown = this.makeNoise('brown', 6);
		this.pink = this.makeNoise('pink', 5);
	}

	setVolume(v) { this.volume = v; if (this.out) this.out.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05); }
	get t() { return this.ctx.currentTime; }

	setMuffle(m) {
		if (!this.ctx || Math.abs(m - this.muffle) < 0.01) return;
		this.muffle = m;
		this.lp.frequency.setTargetAtTime(20000 * Math.pow(0.02, m), this.t, 0.08);
	}

	makeNoise(type, seconds) {
		const ctx = this.ctx, len = Math.floor(ctx.sampleRate * seconds);
		const buf = ctx.createBuffer(2, len, ctx.sampleRate);
		for (let ch = 0; ch < 2; ch++) {
			const d = buf.getChannelData(ch);
			let last = 0, b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
			for (let i = 0; i < len; i++) {
				const w = Math.random() * 2 - 1;
				if (type === 'white') d[i] = w;
				else if (type === 'brown') { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
				else {
					b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
					b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
					d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
				}
			}
		}
		return buf;
	}

	// Synthetic impulse response: decaying stereo noise with progressive damping.
	setReverb(seconds, damping = 0.5, wet = 0.6) {
		if (!this.ctx) return;
		const ctx = this.ctx, len = Math.floor(ctx.sampleRate * seconds);
		const ir = ctx.createBuffer(2, len, ctx.sampleRate);
		for (let ch = 0; ch < 2; ch++) {
			const d = ir.getChannelData(ch);
			let lp = 0;
			for (let i = 0; i < len; i++) {
				const t = i / len;
				const k = 0.05 + (1 - damping) * 0.9 * (1 - t);
				lp += (Math.random() * 2 - 1 - lp) * k;
				d[i] = lp * Math.pow(1 - t, 2.2) * (i < 40 ? i / 40 : 1);
			}
		}
		this.convolver.buffer = ir;
		this.reverbGain.gain.setTargetAtTime(wet, this.t, 0.1);
	}

	// ---------- graph helpers ----------
	src(buffer, loop = true, rate = 1) {
		const s = this.ctx.createBufferSource();
		s.buffer = buffer; s.loop = loop; s.playbackRate.value = rate;
		if (loop) s.loopStart = Math.random() * (buffer.duration - 1);
		return s;
	}
	filter(type, f, q = 1) { const b = this.ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; }
	gain(v = 1) { const g = this.ctx.createGain(); g.gain.value = v; return g; }
	route(node, dry = 1, wet = 0.3) {
		const d = this.gain(dry), w = this.gain(wet);
		node.connect(d); node.connect(w); d.connect(this.master); w.connect(this.reverbSend);
		return { dry: d, wet: w };
	}
	panner(ref = 2, roll = 1.3) {
		const p = this.ctx.createPanner();
		p.panningModel = 'HRTF'; p.distanceModel = 'inverse'; p.refDistance = ref; p.rolloffFactor = roll; p.maxDistance = 200;
		return p;
	}

	updateListener(cam) {
		if (!this.ctx) return;
		const L = this.ctx.listener, p = cam.position;
		const f = cam.getWorldDirection(this._v || (this._v = cam.position.clone()));
		const t = this.t;
		if (L.positionX) {
			L.positionX.setTargetAtTime(p.x, t, 0.02); L.positionY.setTargetAtTime(p.y, t, 0.02); L.positionZ.setTargetAtTime(p.z, t, 0.02);
			L.forwardX.setTargetAtTime(f.x, t, 0.02); L.forwardY.setTargetAtTime(f.y, t, 0.02); L.forwardZ.setTargetAtTime(f.z, t, 0.02);
			L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0;
		} else { L.setPosition(p.x, p.y, p.z); L.setOrientation(f.x, f.y, f.z, 0, 1, 0); }
	}

	// ---------- ambience loops ----------
	stopAll(fade = 0.8) {
		for (const k of Object.keys(this.loops)) this.stopLoop(k, fade);
	}
	stopLoop(name, fade = 0.8) {
		const l = this.loops[name]; if (!l) return;
		delete this.loops[name];
		const t = this.t;
		l.out.gain.cancelScheduledValues(t);
		l.out.gain.setValueAtTime(l.out.gain.value, t);
		l.out.gain.linearRampToValueAtTime(0, t + fade);
		setTimeout(() => { l.nodes.forEach(n => { try { n.stop && n.stop(); } catch (e) {} try { n.disconnect(); } catch (e) {} }); }, fade * 1000 + 100);
	}
	setLoop(name, v, tc = 0.3) { const l = this.loops[name]; if (l) l.out.gain.setTargetAtTime(v * l.base, this.t, tc); }

	_loop(name, base, nodes, out, wet = 0.2) {
		this.stopLoop(name, 0.1);
		out.gain.value = 0;
		out.gain.setTargetAtTime(base, this.t, 0.8);
		this.route(out, 1, wet);
		nodes.forEach(n => n.start && n.start());
		this.loops[name] = { nodes: [...nodes, out], out, base };
	}

	// Fluorescent light hum: mains harmonics + buzzy noise
	hum(level = 0.06) {
		const ctx = this.ctx, out = this.gain(), nodes = [];
		[120, 240, 360, 600].forEach((f, i) => {
			const o = ctx.createOscillator(); o.type = i === 0 ? 'sawtooth' : 'sine'; o.frequency.value = f;
			const g = this.gain([0.25, 0.12, 0.06, 0.03][i]); o.connect(g); g.connect(out); nodes.push(o);
		});
		const n = this.src(this.white); const bp = this.filter('bandpass', 3800, 2); const ng = this.gain(0.05);
		n.connect(bp); bp.connect(ng); ng.connect(out); nodes.push(n);
		const lfo = ctx.createOscillator(); lfo.frequency.value = 0.13; const lg = this.gain(0.08); lfo.connect(lg); lg.connect(out.gain); nodes.push(lfo);
		const lp = this.filter('lowpass', 2400); out.connect(lp);
		const o2 = this.gain(); lp.connect(o2);
		this._loop('hum', level, nodes, o2, 0.05);
		out.gain.value = 1;
	}

	// Indoor water: lapping filtered noise with slow swells
	water(level = 0.12) {
		const ctx = this.ctx, out = this.gain(), nodes = [];
		const n = this.src(this.pink); const bp = this.filter('bandpass', 500, 0.7); const g = this.gain(0.8);
		const lfo = ctx.createOscillator(); lfo.frequency.value = 0.21; const lg = this.gain(250); lfo.connect(lg); lg.connect(bp.frequency);
		const lfo2 = ctx.createOscillator(); lfo2.frequency.value = 0.37; const lg2 = this.gain(0.35); lfo2.connect(lg2); lg2.connect(g.gain);
		n.connect(bp); bp.connect(g); g.connect(out); nodes.push(n, lfo, lfo2);
		const n2 = this.src(this.brown); const lp = this.filter('lowpass', 180); const g2 = this.gain(0.5); n2.connect(lp); lp.connect(g2); g2.connect(out); nodes.push(n2);
		this._loop('water', level, nodes, out, 0.6);
	}

	// Low wind / air handling / room tone
	roomtone(level = 0.08, freq = 90) {
		const out = this.gain(), n = this.src(this.brown); const lp = this.filter('lowpass', freq, 0.5);
		n.connect(lp); lp.connect(out);
		this._loop('room', level, [n], out, 0.3);
	}

	wind(level = 0.12) {
		const ctx = this.ctx, out = this.gain(), nodes = [];
		const n = this.src(this.pink); const bp = this.filter('bandpass', 700, 0.4); const g = this.gain(1);
		const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07; const lg = this.gain(400); lfo.connect(lg); lg.connect(bp.frequency);
		const lfo2 = ctx.createOscillator(); lfo2.frequency.value = 0.11; const lg2 = this.gain(0.5); lfo2.connect(lg2); lg2.connect(g.gain);
		n.connect(bp); bp.connect(g); g.connect(out); nodes.push(n, lfo, lfo2);
		this._loop('wind', level, nodes, out, 0.1);
	}

	// Unsettling sub drone, two detuned oscillators through a resonant filter
	drone(level = 0.05, base = 55) {
		const ctx = this.ctx, out = this.gain(), nodes = [];
		const lp = this.filter('lowpass', 300, 6);
		[base, base * 1.007, base * 1.498].forEach((f, i) => {
			const o = ctx.createOscillator(); o.type = i === 2 ? 'triangle' : 'sawtooth'; o.frequency.value = f;
			const g = this.gain(i === 2 ? 0.2 : 0.4); o.connect(g); g.connect(lp); nodes.push(o);
		});
		const lfo = ctx.createOscillator(); lfo.frequency.value = 0.05; const lg = this.gain(180); lfo.connect(lg); lg.connect(lp.frequency); nodes.push(lfo);
		lp.connect(out);
		this._loop('drone', level, nodes, out, 0.5);
	}

	// ---------- one-shots ----------
	_env(g, t, a, peak, d) {
		g.gain.setValueAtTime(0.0001, t);
		g.gain.exponentialRampToValueAtTime(peak, t + a);
		g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
	}
	_noiseHit({ type = 'bandpass', f = 1000, q = 1, a = 0.002, d = 0.1, peak = 0.3, wet = 0.2, rate = 1, sweep = 0, at = 0, buf = null, dest = null }) {
		const t = this.t + at;
		const s = this.src(buf || this.white, false, rate);
		const fl = this.filter(type, f, q);
		if (sweep) fl.frequency.exponentialRampToValueAtTime(Math.max(40, f * sweep), t + a + d);
		const g = this.gain(0);
		s.connect(fl); fl.connect(g);
		if (dest) g.connect(dest); else this.route(g, 1, wet);
		this._env(g, t, a, peak, d);
		s.start(t, Math.random() * 2); s.stop(t + a + d + 0.05);
		return g;
	}
	_tone({ f = 440, type = 'sine', a = 0.005, d = 0.5, peak = 0.2, wet = 0.4, at = 0, slide = 0, dest = null }) {
		const t = this.t + at;
		const o = this.ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t);
		if (slide) o.frequency.exponentialRampToValueAtTime(f * slide, t + a + d);
		const g = this.gain(0); o.connect(g);
		if (dest) g.connect(dest); else this.route(g, 1, wet);
		this._env(g, t, a, peak, d);
		o.start(t); o.stop(t + a + d + 0.05);
	}

	footstep(surface, intensity = 1) {
		if (!this.ctx) return;
		const v = intensity * (0.85 + Math.random() * 0.3);
		switch (surface) {
			case 'carpet':
				this._noiseHit({ type: 'lowpass', f: 420, q: 0.7, d: 0.09, peak: 0.25 * v, wet: 0.05, buf: this.pink });
				this._noiseHit({ type: 'bandpass', f: 2600, q: 0.6, d: 0.05, peak: 0.03 * v, wet: 0.05, at: 0.01 });
				break;
			case 'tile':
				this._noiseHit({ type: 'bandpass', f: 1900 + Math.random() * 600, q: 3, d: 0.06, peak: 0.22 * v, wet: 0.5 });
				this._noiseHit({ type: 'lowpass', f: 300, d: 0.05, peak: 0.25 * v, wet: 0.3, buf: this.brown });
				break;
			case 'concrete':
				this._noiseHit({ type: 'bandpass', f: 900, q: 1.2, d: 0.08, peak: 0.25 * v, wet: 0.45 });
				this._noiseHit({ type: 'highpass', f: 4000, d: 0.04, peak: 0.05 * v, wet: 0.4, at: 0.015 });
				break;
			case 'water': {
				const deep = intensity > 1.2;
				this._noiseHit({ type: 'bandpass', f: 700 + Math.random() * 500, q: 1.4, a: 0.02, d: deep ? 0.45 : 0.25, peak: 0.28 * v, wet: 0.55, sweep: 0.45, buf: this.pink });
				this._noiseHit({ type: 'highpass', f: 3500, q: 0.7, a: 0.01, d: 0.18, peak: 0.07 * v, wet: 0.5, at: 0.04 });
				for (let i = 0; i < 3; i++) this._tone({ f: 900 + Math.random() * 1400, a: 0.002, d: 0.05, peak: 0.02 * v, wet: 0.6, at: 0.03 + Math.random() * 0.15, slide: 1.6 });
				break;
			}
			case 'grass':
				this._noiseHit({ type: 'highpass', f: 2500, q: 0.5, a: 0.02, d: 0.16, peak: 0.08 * v, wet: 0.02 });
				this._noiseHit({ type: 'lowpass', f: 250, d: 0.06, peak: 0.15 * v, wet: 0.02, buf: this.brown });
				break;
		}
	}

	drip(pan) {
		if (!this.ctx) return;
		const f = 1200 + Math.random() * 1600;
		const dest = this._panAt(pan);
		this._tone({ f, a: 0.001, d: 0.08, peak: 0.12, slide: 2.2, dest });
		this._tone({ f: f * 1.5, a: 0.001, d: 0.05, peak: 0.04, slide: 1.8, at: 0.02, dest });
	}
	_panAt(pos) {
		if (!pos) { const g = this.gain(1); this.route(g, 1, 0.7); return g; }
		const p = this.panner(1.5, 1.1);
		p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z;
		const g = this.gain(1); g.connect(p); this.route(p, 1, 0.8);
		setTimeout(() => { try { p.disconnect(); } catch (e) {} }, 4000);
		return g;
	}

	pickup() {
		this._tone({ f: 660, type: 'triangle', d: 0.25, peak: 0.12, wet: 0.5 });
		this._tone({ f: 990, type: 'triangle', d: 0.4, peak: 0.08, wet: 0.6, at: 0.08 });
	}
	paper() { this._noiseHit({ type: 'highpass', f: 2500, a: 0.02, d: 0.25, peak: 0.12, wet: 0.1, sweep: 1.5 }); }
	click() { this._noiseHit({ type: 'bandpass', f: 3000, q: 4, d: 0.03, peak: 0.15, wet: 0.1 }); }
	flashlight(on) { this._noiseHit({ type: 'bandpass', f: on ? 2400 : 1800, q: 6, d: 0.04, peak: 0.2, wet: 0.05 }); }

	// Heavy electrical "thunk" for blackouts
	thunk() {
		this._tone({ f: 70, type: 'sine', a: 0.005, d: 0.9, peak: 0.6, wet: 0.5, slide: 0.5 });
		this._noiseHit({ type: 'lowpass', f: 600, d: 0.4, peak: 0.4, wet: 0.6, buf: this.brown });
		this._noiseHit({ type: 'bandpass', f: 3000, q: 2, d: 0.15, peak: 0.12, wet: 0.4 });
	}
	powerUp() {
		this._tone({ f: 60, type: 'sawtooth', a: 0.4, d: 1.0, peak: 0.12, wet: 0.4, slide: 2 });
		[0, 0.15, 0.22, 0.4].forEach(a => this._noiseHit({ type: 'bandpass', f: 4000, q: 3, d: 0.03, peak: 0.1, wet: 0.3, at: a }));
	}

	// Dissonant swell / stab
	stinger(power = 1) {
		const freqs = [110, 116.5, 155.6, 164.8, 233, 246.9];
		freqs.forEach((f, i) => this._tone({ f, type: i % 2 ? 'sawtooth' : 'triangle', a: 0.02, d: 2.4, peak: 0.06 * power, wet: 0.8, slide: 0.94 }));
		this._noiseHit({ type: 'bandpass', f: 1800, q: 0.8, a: 0.01, d: 1.4, peak: 0.25 * power, wet: 0.9, sweep: 0.3 });
	}
	jumpscare() {
		this.stinger(2.2);
		this._noiseHit({ type: 'lowpass', f: 5000, a: 0.005, d: 1.2, peak: 0.9, wet: 0.4 });
		[180, 190, 270, 285].forEach(f => this._tone({ f, type: 'sawtooth', a: 0.01, d: 1.4, peak: 0.12, wet: 0.5, slide: 0.6 }));
	}
	heartbeat(vol = 0.3) {
		this._tone({ f: 55, a: 0.005, d: 0.14, peak: vol, wet: 0.05, slide: 0.6 });
		this._tone({ f: 50, a: 0.005, d: 0.18, peak: vol * 0.8, wet: 0.05, slide: 0.6, at: 0.22 });
	}

	ding() {
		[1318.5, 1046.5].forEach((f, i) => { this._tone({ f, a: 0.003, d: 1.6, peak: 0.12, wet: 0.5, at: i * 0.45 }); this._tone({ f: f * 2.01, a: 0.003, d: 0.8, peak: 0.03, wet: 0.5, at: i * 0.45 }); });
	}
	doorOpen() {
		this._noiseHit({ type: 'bandpass', f: 380, q: 9, a: 0.2, d: 0.7, peak: 0.12, wet: 0.4, sweep: 1.7 });
		this._noiseHit({ type: 'lowpass', f: 200, a: 0.01, d: 0.25, peak: 0.3, wet: 0.4, buf: this.brown, at: 0.75 });
	}
	knock(pos, n = 3) {
		const dest = this._panAt(pos);
		for (let i = 0; i < n; i++) this._noiseHit({ type: 'lowpass', f: 380, q: 2, d: 0.12, peak: 0.6, at: i * 0.32, buf: this.brown, dest });
	}
	clack(pos) {
		const dest = this._panAt(pos);
		this._noiseHit({ type: 'bandpass', f: 1300, q: 5, d: 0.07, peak: 0.35, dest });
		this._noiseHit({ type: 'bandpass', f: 700, q: 3, d: 0.1, peak: 0.25, dest, at: 0.03 });
	}
	scrape(pos) {
		const dest = this._panAt(pos);
		this._noiseHit({ type: 'bandpass', f: 900, q: 6, a: 0.05, d: 0.35, peak: 0.2, dest, sweep: 1.3 });
	}
	valve() {
		for (let i = 0; i < 4; i++) this._noiseHit({ type: 'bandpass', f: 500 + i * 60, q: 12, a: 0.05, d: 0.3, peak: 0.12, wet: 0.6, at: i * 0.35, sweep: 1.4 });
	}
	gurgle() {
		for (let i = 0; i < 14; i++) this._tone({ f: 120 + Math.random() * 300, a: 0.01, d: 0.25, peak: 0.08, wet: 0.8, at: i * 0.18 + Math.random() * 0.1, slide: 1.8 });
		this._noiseHit({ type: 'lowpass', f: 400, a: 0.5, d: 3.5, peak: 0.3, wet: 0.8, buf: this.brown });
	}
	clang() {
		[220, 331, 497, 745].forEach((f, i) => this._tone({ f, type: 'triangle', a: 0.002, d: 2.5 - i * 0.4, peak: 0.12, wet: 0.9 }));
		this._noiseHit({ type: 'bandpass', f: 1200, q: 1, d: 0.2, peak: 0.3, wet: 0.8 });
	}
	birds() {
		const at = Math.random() * 0.3;
		const base = 2500 + Math.random() * 2000;
		for (let i = 0; i < 2 + Math.floor(Math.random() * 4); i++)
			this._tone({ f: base, a: 0.01, d: 0.08, peak: 0.03, wet: 0.2, at: at + i * 0.13, slide: 1.3 + Math.random() * 0.4 });
	}
	whisper(pos) {
		const dest = this._panAt(pos);
		for (let i = 0; i < 5; i++) this._noiseHit({ type: 'bandpass', f: 1500 + Math.random() * 2500, q: 8, a: 0.05, d: 0.25, peak: 0.15, at: i * 0.18 + Math.random() * 0.1, dest });
	}

	// Music box: slow minor-key motif with bell partials
	musicBox(level = 0.06, notes = null, tempo = 0.62) {
		this.stopMusic();
		const seq = notes || [69, 72, 76, 74, 72, 71, 72, 69, 64, 67, 69, 71, 72, 71, 69, 0, 69, 72, 76, 79, 77, 76, 74, 72, 71, 72, 74, 71, 69, 0, 0, 0];
		const bus = this.gain(level); this.route(bus, 1, 0.7);
		let i = 0;
		const play = () => {
			const n = seq[i % seq.length]; i++;
			if (n) {
				const f = 440 * Math.pow(2, (n - 69) / 12);
				this._tone({ f, type: 'sine', a: 0.003, d: 2.2, peak: 0.5, dest: bus });
				this._tone({ f: f * 2.756, type: 'sine', a: 0.002, d: 0.6, peak: 0.12, dest: bus });
				this._tone({ f: f * 5.4, type: 'sine', a: 0.001, d: 0.2, peak: 0.04, dest: bus });
			}
		};
		this._music = { bus, timer: setInterval(play, tempo * 1000) };
	}
	stopMusic() {
		if (!this._music) return;
		clearInterval(this._music.timer);
		const b = this._music.bus; b.gain.setTargetAtTime(0, this.t, 0.6);
		setTimeout(() => { try { b.disconnect(); } catch (e) {} }, 3000);
		this._music = null;
	}

	// A positional "voice" loop for entities: breathing / growl, follows a position.
	createVoice(kind = 'hollow') {
		const ctx = this.ctx;
		const p = this.panner(2.5, 1.4);
		const out = this.gain(0);
		const nodes = [];
		if (kind === 'hollow') {
			const n = this.src(this.pink); const bp = this.filter('bandpass', 420, 4); const g = this.gain(1);
			const lfo = ctx.createOscillator(); lfo.frequency.value = 0.35; const lg = this.gain(0.9); lfo.connect(lg); lg.connect(g.gain);
			const lfo2 = ctx.createOscillator(); lfo2.frequency.value = 0.21; const lg2 = this.gain(160); lfo2.connect(lg2); lg2.connect(bp.frequency);
			n.connect(bp); bp.connect(g); g.connect(out);
			const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 43; const og = this.gain(0.12); const ol = this.filter('lowpass', 200, 3); o.connect(ol); ol.connect(og); og.connect(out);
			nodes.push(n, lfo, lfo2, o);
		}
		out.connect(p); this.route(p, 1, 0.5);
		nodes.forEach(n => n.start());
		return {
			set(pos, vol) {
				const t = ctx.currentTime;
				p.positionX.setTargetAtTime(pos.x, t, 0.05); p.positionY.setTargetAtTime(pos.y, t, 0.05); p.positionZ.setTargetAtTime(pos.z, t, 0.05);
				out.gain.setTargetAtTime(vol, t, 0.2);
			},
			stop() { out.gain.setTargetAtTime(0, ctx.currentTime, 0.2); setTimeout(() => nodes.forEach(n => { try { n.stop(); n.disconnect(); } catch (e) {} }), 800); }
		};
	}
	// Positional one-shot thud for creature footfalls
	thud(pos, vol = 0.5, splash = false) {
		const dest = this._panAt(pos);
		if (splash) this._noiseHit({ type: 'bandpass', f: 600, q: 1.2, a: 0.02, d: 0.3, peak: vol * 0.6, sweep: 0.5, dest, buf: this.pink });
		else this._noiseHit({ type: 'lowpass', f: 260, q: 1.5, d: 0.12, peak: vol, dest, buf: this.brown });
	}
	phone(pos) {
		const dest = this._panAt(pos);
		for (let r = 0; r < 2; r++) for (let i = 0; i < 20; i++) {
			this._tone({ f: 880, type: 'square', a: 0.002, d: 0.03, peak: 0.04, at: r * 2 + i * 0.05, dest });
			this._tone({ f: 1320, type: 'square', a: 0.002, d: 0.03, peak: 0.03, at: r * 2 + i * 0.05 + 0.025, dest });
		}
	}
}

export const audio = new AudioEngine();
