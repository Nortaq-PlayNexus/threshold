// World construction + physics helpers shared by all levels.
import * as THREE from 'three/webgpu';

const UP = new THREE.Vector3(0, 1, 0);
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _n = new THREE.Vector3(), _r = new THREE.Vector3();

/** Accumulates quads per material key, with world-space UVs in metres. */
export class MeshBuilder {
	constructor() { this.buckets = new Map(); }
	bucket(key) {
		if (!this.buckets.has(key)) this.buckets.set(key, { pos: [], nor: [], uv: [], idx: [] });
		return this.buckets.get(key);
	}
	/** pts: 4 Vector3-like corners (any order around the quad), n: outward normal. uvFn optional. */
	quad(key, pts, n, uvOffset = null) {
		const b = this.bucket(key);
		const base = b.pos.length / 3;
		_n.set(n[0] ?? n.x, n[1] ?? n.y, n[2] ?? n.z);
		// winding check (Newell normal — robust for degenerate / triangular quads)
		let nx = 0, ny = 0, nz = 0;
		for (let i = 0; i < 4; i++) {
			const c = pts[i], d = pts[(i + 1) % 4];
			nx += (c[1] - d[1]) * (c[2] + d[2]); ny += (c[2] - d[2]) * (c[0] + d[0]); nz += (c[0] - d[0]) * (c[1] + d[1]);
		}
		const flip = (nx * _n.x + ny * _n.y + nz * _n.z) < 0;
		const order = flip ? [0, 3, 2, 1] : [0, 1, 2, 3];
		let horiz = Math.abs(_n.y) > 0.5;
		if (!horiz) _r.crossVectors(UP, _n).normalize();
		for (const i of order) {
			const p = pts[i];
			b.pos.push(p[0], p[1], p[2]);
			b.nor.push(_n.x, _n.y, _n.z);
			let u, v;
			if (horiz) { u = p[0]; v = _n.y > 0 ? -p[2] : p[2]; }
			else { u = p[0] * _r.x + p[2] * _r.z; v = p[1]; }
			if (uvOffset) { u += uvOffset[0]; v += uvOffset[1]; }
			b.uv.push(u, v);
		}
		b.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
	}
	// axis aligned helpers
	floor(key, x0, z0, x1, z1, y, up = true) {
		this.quad(key, [[x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1]], up ? [0, 1, 0] : [0, -1, 0]);
	}
	wallX(key, x, z0, z1, y0, y1, dir) { // plane at x, normal (dir,0,0)
		this.quad(key, [[x, y0, z0], [x, y0, z1], [x, y1, z1], [x, y1, z0]], [dir, 0, 0]);
	}
	wallZ(key, z, x0, x1, y0, y1, dir) {
		this.quad(key, [[x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]], [0, 0, dir]);
	}
	box(key, x0, y0, z0, x1, y1, z1, faces = 'xXyYzZ') {
		if (faces.includes('x')) this.wallX(key, x0, z0, z1, y0, y1, -1);
		if (faces.includes('X')) this.wallX(key, x1, z0, z1, y0, y1, 1);
		if (faces.includes('y')) this.floor(key, x0, z0, x1, z1, y0, false);
		if (faces.includes('Y')) this.floor(key, x0, z0, x1, z1, y1, true);
		if (faces.includes('z')) this.wallZ(key, z0, x0, x1, y0, y1, -1);
		if (faces.includes('Z')) this.wallZ(key, z1, x0, x1, y0, y1, 1);
	}
	build(materials, { castShadow = false, receiveShadow = false } = {}) {
		const group = new THREE.Group();
		for (const [key, b] of this.buckets) {
			if (!b.idx.length) continue;
			const g = new THREE.BufferGeometry();
			g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
			g.setAttribute('normal', new THREE.Float32BufferAttribute(b.nor, 3));
			g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
			g.setIndex(b.pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(b.idx, 1) : new THREE.Uint16BufferAttribute(b.idx, 1));
			g.computeBoundingSphere(); g.computeBoundingBox();
			const m = new THREE.Mesh(g, materials[key]);
			if (!materials[key]) console.warn('missing material', key);
			m.castShadow = castShadow; m.receiveShadow = receiveShadow;
			m.name = key;
			group.add(m);
		}
		return group;
	}
}

/** Re-maps a geometry's UVs to metres using per-triangle box projection (in world space). */
export function boxProjectUVs(geo, matrix = null) {
	geo = geo.index ? geo.toNonIndexed() : geo;
	const pos = geo.attributes.position, uv = new Float32Array(pos.count * 2);
	const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
	for (let i = 0; i < pos.count; i += 3) {
		a.fromBufferAttribute(pos, i); b.fromBufferAttribute(pos, i + 1); c.fromBufferAttribute(pos, i + 2);
		if (matrix) { a.applyMatrix4(matrix); b.applyMatrix4(matrix); c.applyMatrix4(matrix); }
		n.subVectors(b, a).cross(c.clone().sub(a)).normalize();
		const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
		[a, b, c].forEach((p, k) => {
			let u, v;
			if (ay >= ax && ay >= az) { u = p.x; v = p.z; }
			else if (ax >= az) { u = p.z; v = p.y; }
			else { u = p.x; v = p.y; }
			uv[(i + k) * 2] = u; uv[(i + k) * 2 + 1] = v;
		});
	}
	geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
	geo.computeVertexNormals();
	return geo;
}

/** Cylinder with UVs in metres (so tiles keep their size). */
export function tiledCylinder(r, h, seg = 32) {
	const g = new THREE.CylinderGeometry(r, r, h, seg, 1, true);
	const uv = g.attributes.uv, circ = 2 * Math.PI * r;
	for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * circ, uv.getY(i) * h);
	return g;
}

// ---------------------------------------------------------------- collision
export class Collision {
	constructor(cell = 4) {
		this.cell = cell;
		this.boxes = [];
		this.circles = [];
		this.hash = new Map();
		this.ground = () => 0;
		this.maxStep = 0.6;
	}
	_key(ix, iz) { return ix * 73856093 ^ iz * 19349663; }
	addBox(x0, z0, x1, z1, y0 = -100, y1 = 100, tag = null) {
		const b = { x0: Math.min(x0, x1), z0: Math.min(z0, z1), x1: Math.max(x0, x1), z1: Math.max(z0, z1), y0, y1, tag, on: true };
		this.boxes.push(b);
		const c = this.cell;
		for (let ix = Math.floor(b.x0 / c); ix <= Math.floor(b.x1 / c); ix++)
			for (let iz = Math.floor(b.z0 / c); iz <= Math.floor(b.z1 / c); iz++) {
				const k = this._key(ix, iz);
				if (!this.hash.has(k)) this.hash.set(k, []);
				this.hash.get(k).push(b);
			}
		return b;
	}
	addCircle(x, z, r, tag = null) { const c = { x, z, r, tag, on: true }; this.circles.push(c); return c; }
	query(x0, z0, x1, z1, out = []) {
		out.length = 0;
		const c = this.cell, seen = this._seen || (this._seen = new Set());
		seen.clear();
		for (let ix = Math.floor(x0 / c); ix <= Math.floor(x1 / c); ix++)
			for (let iz = Math.floor(z0 / c); iz <= Math.floor(z1 / c); iz++) {
				const arr = this.hash.get(this._key(ix, iz));
				if (arr) for (const b of arr) if (b.on && !seen.has(b)) { seen.add(b); out.push(b); }
			}
		return out;
	}
	blockedAt(x, z, r, y = 1) {
		const list = this.query(x - r, z - r, x + r, z + r, this._q || (this._q = []));
		for (const b of list) if (y > b.y0 && y < b.y1 && x + r > b.x0 && x - r < b.x1 && z + r > b.z0 && z - r < b.z1) return true;
		for (const c of this.circles) if (c.on) { const dx = x - c.x, dz = z - c.z; if (dx * dx + dz * dz < (r + c.r) ** 2) return true; }
		return false;
	}
	/** Moves pos (Vector3, xz) by (dx,dz) with sliding. y = feet height for vertical filtering. */
	move(pos, dx, dz, r, y = 1) {
		const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / (r * 0.5)));
		const sx = dx / steps, sz = dz / steps;
		for (let s = 0; s < steps; s++) {
			const g0 = this.ground(pos.x, pos.z);
			let nx = pos.x + sx;
			if (!this.blockedAt(nx, pos.z, r, y + 0.5) && this.ground(nx, pos.z) - g0 <= this.maxStep) pos.x = nx;
			let nz = pos.z + sz;
			if (!this.blockedAt(pos.x, nz, r, y + 0.5) && this.ground(pos.x, nz) - g0 <= this.maxStep) pos.z = nz;
			// push out of circles
			for (const c of this.circles) {
				if (!c.on) continue;
				const ddx = pos.x - c.x, ddz = pos.z - c.z, d = Math.hypot(ddx, ddz), m = r + c.r;
				if (d < m && d > 1e-5) { pos.x = c.x + ddx / d * m; pos.z = c.z + ddz / d * m; }
			}
		}
	}
	/** True if the segment a→b (xz, at height y) is unobstructed. */
	los(ax, az, bx, bz, y = 1.5) {
		const list = this.query(Math.min(ax, bx), Math.min(az, bz), Math.max(ax, bx), Math.max(az, bz), this._q2 || (this._q2 = []));
		const dx = bx - ax, dz = bz - az;
		for (const b of list) {
			if (y < b.y0 || y > b.y1) continue;
			let t0 = 0, t1 = 1;
			if (Math.abs(dx) < 1e-9) { if (ax < b.x0 || ax > b.x1) continue; }
			else { let ta = (b.x0 - ax) / dx, tb = (b.x1 - ax) / dx; if (ta > tb) [ta, tb] = [tb, ta]; t0 = Math.max(t0, ta); t1 = Math.min(t1, tb); if (t0 > t1) continue; }
			if (Math.abs(dz) < 1e-9) { if (az < b.z0 || az > b.z1) continue; }
			else { let ta = (b.z0 - az) / dz, tb = (b.z1 - az) / dz; if (ta > tb) [ta, tb] = [tb, ta]; t0 = Math.max(t0, ta); t1 = Math.min(t1, tb); if (t0 > t1) continue; }
			return false;
		}
		return true;
	}
}

// ---------------------------------------------------------------- navigation
export class NavGrid {
	constructor(col, x0, z0, x1, z1, cell = 1, radius = 0.35) {
		this.x0 = x0; this.z0 = z0; this.cell = cell;
		this.w = Math.ceil((x1 - x0) / cell); this.h = Math.ceil((z1 - z0) / cell);
		this.block = new Uint8Array(this.w * this.h);
		for (let j = 0; j < this.h; j++) for (let i = 0; i < this.w; i++) {
			const x = x0 + (i + 0.5) * cell, z = z0 + (j + 0.5) * cell;
			this.block[j * this.w + i] = col.blockedAt(x, z, radius, 1.0) ? 1 : 0;
		}
		this.dist = new Int32Array(this.w * this.h);
		this.queue = new Int32Array(this.w * this.h);
	}
	idx(x, z) {
		const i = Math.floor((x - this.x0) / this.cell), j = Math.floor((z - this.z0) / this.cell);
		if (i < 0 || j < 0 || i >= this.w || j >= this.h) return -1;
		return j * this.w + i;
	}
	center(id, out) { out.x = this.x0 + (id % this.w + 0.5) * this.cell; out.z = this.z0 + (Math.floor(id / this.w) + 0.5) * this.cell; return out; }
	nearestFree(id) {
		if (id >= 0 && !this.block[id]) return id;
		if (id < 0) return -1;
		const ci = id % this.w, cj = Math.floor(id / this.w);
		for (let r = 1; r < 6; r++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
			const i = ci + di, j = cj + dj;
			if (i < 0 || j < 0 || i >= this.w || j >= this.h) continue;
			const k = j * this.w + i; if (!this.block[k]) return k;
		}
		return -1;
	}
	/** BFS distance field from target; returns this (call nextStep). */
	flood(tx, tz, maxSteps = 1e9) {
		this.dist.fill(-1);
		let t = this.nearestFree(this.idx(tx, tz));
		if (t < 0) return this;
		let qh = 0, qt = 0;
		this.queue[qt++] = t; this.dist[t] = 0;
		const w = this.w, h = this.h;
		while (qh < qt) {
			const c = this.queue[qh++], d = this.dist[c];
			if (d > maxSteps) break;
			const ci = c % w, cj = (c / w) | 0;
			if (ci > 0) this._v(c - 1, d, qt) && (this.queue[qt++] = c - 1);
			if (ci < w - 1) this._v(c + 1, d, qt) && (this.queue[qt++] = c + 1);
			if (cj > 0) this._v(c - w, d, qt) && (this.queue[qt++] = c - w);
			if (cj < h - 1) this._v(c + w, d, qt) && (this.queue[qt++] = c + w);
		}
		return this;
	}
	_v(n, d) { if (this.block[n] || this.dist[n] >= 0) return false; this.dist[n] = d + 1; return true; }
	/** Given position, returns world target of the next cell downhill in the field (8-neighbour). */
	nextStep(x, z, out) {
		let id = this.nearestFree(this.idx(x, z));
		if (id < 0 || this.dist[id] < 0) return null;
		const w = this.w, ci = id % w, cj = (id / w) | 0;
		let best = id, bd = this.dist[id];
		for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
			if (!di && !dj) continue;
			const i = ci + di, j = cj + dj;
			if (i < 0 || j < 0 || i >= w || j >= this.h) continue;
			const k = j * w + i, d = this.dist[k];
			if (d < 0) continue;
			if (di && dj && (this.block[cj * w + i] || this.block[j * w + ci])) continue; // no corner cutting
			const dd = d + (di && dj ? 0.4 : 0);
			if (dd < bd) { bd = dd; best = k; }
		}
		return this.center(best, out);
	}
	distAt(x, z) { const id = this.nearestFree(this.idx(x, z)); return id < 0 ? -1 : this.dist[id]; }
	randomFree(rng) {
		for (let k = 0; k < 2000; k++) { const id = Math.floor(rng() * this.block.length); if (!this.block[id]) return this.center(id, { x: 0, z: 0 }); }
		return null;
	}
}

// ---------------------------------------------------------------- interactions
export class Interactions {
	constructor() { this.list = []; }
	add(o) { o.enabled = o.enabled ?? true; o.radius = o.radius ?? 2.2; o.hold = o.hold ?? 0; this.list.push(o); return o; }
	remove(o) { const i = this.list.indexOf(o); if (i >= 0) this.list.splice(i, 1); }
	/** Finds best interactable in front of the camera. */
	pick(cam, col) {
		const dir = cam.getWorldDirection(_a);
		let best = null, bestScore = -1;
		for (const o of this.list) {
			if (!o.enabled) continue;
			const p = o.pos;
			_b.set(p.x - cam.position.x, p.y - cam.position.y, p.z - cam.position.z);
			const d = _b.length();
			if (d > o.radius) continue;
			const dot = _b.normalize().dot(dir);
			if (dot < (d < 1.0 ? 0.5 : 0.82)) continue;
			if (col && !col.los(cam.position.x, cam.position.z, p.x + (cam.position.x - p.x) * 0.15, p.z + (cam.position.z - p.z) * 0.15, Math.min(p.y, cam.position.y))) continue;
			const score = dot - d * 0.05;
			if (score > bestScore) { bestScore = score; best = o; }
		}
		return best;
	}
}

// Dispose everything under an object
export function disposeTree(obj) {
	obj.traverse(o => {
		if (o.geometry) o.geometry.dispose();
		if (o.material) {
			const ms = Array.isArray(o.material) ? o.material : [o.material];
			ms.forEach(m => {
				for (const k in m) { const v = m[k]; if (v && v.isTexture) v.dispose(); }
				m.dispose();
			});
		}
	});
}
