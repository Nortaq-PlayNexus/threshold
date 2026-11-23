// Keyboard / mouse / pointer-lock input.
export class Input {
	constructor(canvas) {
		this.canvas = canvas;
		this.keys = new Set();
		this.pressed = new Set();
		this.mx = 0; this.my = 0;
		this.locked = false;
		this.onUnlock = null;
		this.allowNoLock = false; // debug / automation
		addEventListener('keydown', e => {
			if (e.repeat) return;
			this.keys.add(e.code); this.pressed.add(e.code);
			if (['Space', 'ArrowUp', 'ArrowDown', 'Tab'].includes(e.code)) e.preventDefault();
		});
		addEventListener('keyup', e => this.keys.delete(e.code));
		addEventListener('blur', () => this.keys.clear());
		addEventListener('mousemove', e => {
			if (!this.locked && !this.allowNoLock) return;
			// clamp crazy spikes some browsers emit on lock
			if (Math.abs(e.movementX) > 300 || Math.abs(e.movementY) > 300) return;
			this.mx += e.movementX; this.my += e.movementY;
		});
		document.addEventListener('pointerlockchange', () => {
			const was = this.locked;
			this.locked = document.pointerLockElement === canvas;
			if (was && !this.locked && this.onUnlock) this.onUnlock();
		});
	}
	lock() {
		try {
			const p = this.canvas.requestPointerLock({ unadjustedMovement: true });
			if (p && p.catch) p.catch(() => { try { this.canvas.requestPointerLock(); } catch (e) {} });
		} catch (e) { try { this.canvas.requestPointerLock(); } catch (e2) {} }
	}
	unlock() { if (document.pointerLockElement) document.exitPointerLock(); }
	down(...codes) { return codes.some(c => this.keys.has(c)); }
	hit(code) { return this.pressed.has(code); }
	endFrame() { this.pressed.clear(); this.mx = 0; this.my = 0; }
}
