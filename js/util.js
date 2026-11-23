// Small shared helpers: seeded RNG, value noise, math.
export function mulberry32(seed) {
	let a = seed >>> 0;
	return function () {
		a |= 0; a = a + 0x6D2B79F5 | 0;
		let t = Math.imul(a ^ a >>> 15, 1 | a);
		t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
		return ((t ^ t >>> 14) >>> 0) / 4294967296;
	};
}

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (t) => t * t * (3 - 2 * t);
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));

// 2D value noise + fbm (deterministic)
function hash2(x, y) {
	let h = x * 374761393 + y * 668265263;
	h = (h ^ (h >>> 13)) * 1274126177;
	return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
export function vnoise(x, y) {
	const xi = Math.floor(x), yi = Math.floor(y);
	const xf = x - xi, yf = y - yi;
	const u = smooth(xf), v = smooth(yf);
	const a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
	return lerp(lerp(a, b, u), lerp(c, d, u), v);
}
export function fbm(x, y, oct = 4) {
	let s = 0, amp = 0.5, f = 1;
	for (let i = 0; i < oct; i++) { s += amp * vnoise(x * f, y * f); f *= 2; amp *= 0.5; }
	return s;
}

export function makeCanvasTexture(THREE, w, h, draw, srgb = true) {
	const c = document.createElement('canvas');
	c.width = w; c.height = h;
	const g = c.getContext('2d');
	draw(g, w, h);
	const t = new THREE.CanvasTexture(c);
	if (srgb) t.colorSpace = THREE.SRGBColorSpace;
	t.anisotropy = 8;
	return t;
}

export const sleep = (ms) => new Promise(r => setTimeout(r, ms));
export const nextFrame = () => new Promise(r => requestAnimationFrame(() => r()));
