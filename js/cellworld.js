// Height-field cell world: per-cell floor/ceiling heights, ramps, skylights.
// Generates every visible face (walls, pool edges, ramp sides, ceiling steps, skylight shafts).
import { MeshBuilder } from './world.js';

const E = 1e-3;
// ramp directions: the LOW side
export const RAMP = { N: 1, S: 2, W: 3, E: 4 };

export class CellWorld {
	constructor(W, H, C) {
		this.W = W; this.H = H; this.C = C;
		const n = W * H;
		this.open = new Uint8Array(n);
		this.floor = new Float32Array(n);
		this.ceil = new Float32Array(n);
		this.ramp = new Uint8Array(n);
		this.drop = new Float32Array(n);
		this.noCeil = new Uint8Array(n);
		this.tag = new Uint8Array(n);
	}
	id(i, j) { return (i < 0 || j < 0 || i >= this.W || j >= this.H) ? -1 : j * this.W + i; }
	isOpen(i, j) { const k = this.id(i, j); return k >= 0 && this.open[k] === 1; }
	rect(i0, j0, i1, j1, fn) { for (let j = Math.min(j0, j1); j <= Math.max(j0, j1); j++) for (let i = Math.min(i0, i1); i <= Math.max(i0, i1); i++) { const k = this.id(i, j); if (k >= 0) fn(k, i, j); } }
	carve(i0, j0, i1, j1, floor = 0, ceil = 4) { this.rect(i0, j0, i1, j1, k => { this.open[k] = 1; this.floor[k] = floor; this.ceil[k] = ceil; this.ramp[k] = 0; }); }
	setFloor(i0, j0, i1, j1, h) { this.rect(i0, j0, i1, j1, k => { this.floor[k] = h; }); }
	setCeil(i0, j0, i1, j1, h, noCeil = false) { this.rect(i0, j0, i1, j1, k => { this.ceil[k] = h; this.noCeil[k] = noCeil ? 1 : 0; }); }
	setRamp(i0, j0, i1, j1, dir, top, drop) { this.rect(i0, j0, i1, j1, k => { this.ramp[k] = dir; this.floor[k] = top; this.drop[k] = drop; }); }
	setTag(i0, j0, i1, j1, t) { this.rect(i0, j0, i1, j1, k => { this.tag[k] = t; }); }

	/** heights at corners: [x0z0, x1z0, x1z1, x0z1] */
	corners(k) {
		const f = this.floor[k], r = this.ramp[k], d = this.drop[k];
		if (!r) return [f, f, f, f];
		const lo = f - d;
		if (r === RAMP.N) return [lo, lo, f, f];
		if (r === RAMP.S) return [f, f, lo, lo];
		if (r === RAMP.W) return [lo, f, f, lo];
		return [f, lo, lo, f];
	}
	ground(x, z) {
		const C = this.C, i = Math.floor(x / C), j = Math.floor(z / C), k = this.id(i, j);
		if (k < 0 || !this.open[k]) return 10;
		const f = this.floor[k], r = this.ramp[k];
		if (!r) return f;
		const u = x / C - i, v = z / C - j, d = this.drop[k];
		if (r === RAMP.N) return f - d * (1 - v);
		if (r === RAMP.S) return f - d * v;
		if (r === RAMP.W) return f - d * (1 - u);
		return f - d * u;
	}

	/** keyFn(kind, i, j, info) → material key; kind ∈ floor|ceil|wall|edge|step */
	build(mb = new MeshBuilder(), keyFn) {
		const { W, H, C } = this;
		// edge definitions: [neighbour di,dj, my corner idx a,b, neighbour corner idx a,b, inward normal]
		const EDGES = [
			[-1, 0, 0, 3, 1, 2, [1, 0, 0]],
			[1, 0, 1, 2, 0, 3, [-1, 0, 0]],
			[0, -1, 0, 1, 3, 2, [0, 0, 1]],
			[0, 1, 3, 2, 0, 1, [0, 0, -1]],
		];
		for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
			const k = j * W + i;
			if (!this.open[k]) continue;
			const x0 = i * C, z0 = j * C, x1 = x0 + C, z1 = z0 + C;
			const P = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
			const h = this.corners(k), c = this.ceil[k];
			mb.quad(keyFn('floor', i, j, { h }), P.map((p, n) => [p[0], h[n], p[1]]), [0, 1, 0]);
			if (!this.noCeil[k]) mb.quad(keyFn('ceil', i, j, {}), P.map(p => [p[0], c, p[1]]), [0, -1, 0]);
			for (const [di, dj, a, b, na, nb, nrm] of EDGES) {
				const pa = P[a], pb = P[b];
				const nk = this.id(i + di, j + dj);
				if (nk < 0 || !this.open[nk]) {
					mb.quad(keyFn('wall', i, j, { y0: Math.min(h[a], h[b]) }), [[pa[0], h[a], pa[1]], [pb[0], h[b], pb[1]], [pb[0], c, pb[1]], [pa[0], c, pa[1]]], nrm);
					continue;
				}
				const nh = this.corners(nk);
				const ha = nh[na], hb = nh[nb];
				if (ha > h[a] + E || hb > h[b] + E) {
					mb.quad(keyFn('edge', i, j, { y1: Math.max(ha, hb) }), [[pa[0], h[a], pa[1]], [pb[0], h[b], pb[1]], [pb[0], Math.max(hb, h[b]), pb[1]], [pa[0], Math.max(ha, h[a]), pa[1]]], nrm);
				}
				const nc = this.ceil[nk];
				if (nc < c - E) mb.quad(keyFn('step', i, j, {}), [[pa[0], nc, pa[1]], [pb[0], nc, pb[1]], [pb[0], c, pb[1]], [pa[0], c, pa[1]]], nrm);
			}
		}
		return mb;
	}
	addCollision(col) {
		const { W, H, C } = this;
		// merge solid runs per row to keep box count low
		for (let j = 0; j < H; j++) {
			let start = -1;
			for (let i = 0; i <= W; i++) {
				const solid = i < W && !this.open[j * W + i];
				if (solid && start < 0) start = i;
				if (!solid && start >= 0) { col.addBox(start * C, j * C, i * C, (j + 1) * C); start = -1; }
			}
		}
		// border
		col.addBox(-C, -C, (W + 1) * C, 0); col.addBox(-C, H * C, (W + 1) * C, (H + 1) * C);
		col.addBox(-C, 0, 0, H * C); col.addBox(W * C, 0, (W + 1) * C, H * C);
		col.ground = (x, z) => this.ground(x, z);
	}
}
