// Texture + PBR material factory. All UVs in the game are authored in METRES, so each
// material just needs to know the physical size of one texture repeat.
import * as THREE from 'three/webgpu';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';

const loader = new THREE.TextureLoader();
const cache = new Map();
let maxAniso = 8;
let onProgress = () => {};

export function setAniso(n) { maxAniso = n; }
export function setProgressHandler(fn) { onProgress = fn; }

function loadImageTexture(url) {
	if (!cache.has(url)) {
		cache.set(url, loader.loadAsync(url).then(t => { onProgress(url); return t; }));
	}
	return cache.get(url);
}

export async function tex(url, { srgb = false, size = 1, repeat = true } = {}) {
	const base = await loadImageTexture(url);
	const t = base.clone();
	t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
	if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1 / size, 1 / size); }
	t.anisotropy = maxAniso;
	t.needsUpdate = true;
	return t;
}

const SETS = {
	pooltile: { size: 1.5, ao: true },
	aquatile: { size: 1.5, ao: true },
	bigtile: { size: 2.0, ao: true },
	carpet: { size: 1.6, ao: true },
	wallpaper: { size: 3.2, ao: false },
	hotelwall: { size: 1.4, ao: false },
	ceiling: { size: 3.6, ao: true },
	hotelcarpet: { size: 1.2, ao: true },
	concrete: { size: 3.0, ao: false },
	bunker: { size: 3.0, ao: true },
	grass: { size: 2.5, ao: true },
	wood: { size: 1.2, ao: false },
	metal: { size: 1.0, ao: false, metal: true },
};

/**
 * Build a PBR node material from an ambientCG set.
 * opts: color, roughness (multiplier), metalness, normalScale, size override,
 *       physical:{clearcoat, clearcoatRoughness, ...}, emissive
 */
export async function pbr(name, opts = {}) {
	const set = SETS[name];
	const size = opts.size ?? set.size;
	const p = `assets/tex/${name}_`;
	const jobs = [
		tex(p + 'color.webp', { srgb: true, size }),
		tex(p + 'normal.webp', { size }),
		tex(p + 'rough.webp', { size }),
		set.ao ? tex(p + 'ao.webp', { size }) : null,
		set.metal ? tex(p + 'metal.webp', { size }) : null,
	];
	const [map, normalMap, roughnessMap, aoMap, metalnessMap] = await Promise.all(jobs);
	const Mat = opts.physical ? THREE.MeshPhysicalNodeMaterial : THREE.MeshStandardNodeMaterial;
	const m = new Mat({
		map, normalMap, roughnessMap,
		color: new THREE.Color(opts.color ?? 0xffffff),
		roughness: opts.roughness ?? 1,
		metalness: opts.metalness ?? (set.metal ? 1 : 0),
		side: opts.side ?? THREE.FrontSide,
	});
	if (aoMap) { m.aoMap = aoMap; m.aoMapIntensity = opts.aoIntensity ?? 1; }
	if (metalnessMap) m.metalnessMap = metalnessMap;
	const ns = opts.normalScale ?? 1;
	m.normalScale = new THREE.Vector2(ns, ns);
	if (opts.physical) Object.assign(m, opts.physical);
	if (opts.envMapIntensity !== undefined) m.envMapIntensity = opts.envMapIntensity;
	m.name = name;
	return m;
}

let hdrCache = null;
export function loadSkyHDR() {
	if (!hdrCache) {
		hdrCache = new HDRLoader().loadAsync('assets/env/sky_2k.hdr').then(t => {
			t.mapping = THREE.EquirectangularReflectionMapping;
			onProgress('sky');
			return t;
		});
	}
	return hdrCache;
}

export async function imageTex(url) {
	const t = (await loadImageTexture(url)).clone();
	t.colorSpace = THREE.SRGBColorSpace;
	t.anisotropy = maxAniso;
	t.needsUpdate = true;
	return t;
}
