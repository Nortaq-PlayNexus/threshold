// Shared props.
import * as THREE from 'three/webgpu';
import { makeCanvasTexture } from './util.js';
import { audio } from './audio.js';
import { ui } from './ui.js';
import { imageTex } from './assets.js';

const paperTex = () => makeCanvasTexture(THREE, 256, 362, (g, w, h) => {
	g.fillStyle = '#e8e2cf'; g.fillRect(0, 0, w, h);
	g.strokeStyle = 'rgba(70,90,150,.25)';
	for (let y = 40; y < h; y += 18) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
	g.strokeStyle = 'rgba(30,30,40,.75)'; g.lineWidth = 1.6;
	for (let y = 50; y < h - 30; y += 18) {
		let x = 20; g.beginPath(); g.moveTo(x, y);
		const end = 40 + Math.random() * (w - 70);
		while (x < end) { x += 4 + Math.random() * 6; g.lineTo(x, y - 3 + Math.random() * 6); }
		g.stroke();
	}
	const grd = g.createRadialGradient(w * .7, h * .3, 5, w * .7, h * .3, 120); grd.addColorStop(0, 'rgba(120,100,40,.18)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
	g.fillStyle = grd; g.fillRect(0, 0, w, h);
});

/** A sheet of paper on the floor (or a wall) that opens the reader. */
export function createNote(root, inter, { x, y = 0.005, z, rot = 0, wall = null, html }) {
	const mat = new THREE.MeshStandardNodeMaterial({ map: paperTex(), roughness: 0.9, side: THREE.DoubleSide });
	const m = new THREE.Mesh(new THREE.PlaneGeometry(0.21, 0.297), mat);
	if (wall) { m.position.set(x, y, z); m.rotation.y = wall; }
	else { m.rotation.x = -Math.PI / 2; m.rotation.z = rot; m.position.set(x, y, z); }
	m.receiveShadow = true;
	root.add(m);
	return inter.add({ pos: m.position, prompt: 'Read', onUse: () => { audio.paper(); ui.openNote(html); }, radius: 2.4 });
}

export async function createPhoto(root, inter, { x, y, z, rotY = 0, flat = true, src, caption, onTake }) {
	const t = await imageTex(src);
	const g = new THREE.Group();
	const frame = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.004, 0.13), new THREE.MeshStandardNodeMaterial({ color: 0xf2efe6, roughness: 0.6 }));
	const pic = new THREE.Mesh(new THREE.PlaneGeometry(0.095, 0.095), new THREE.MeshStandardNodeMaterial({ map: t, roughness: 0.4, emissive: new THREE.Color(0.25, 0.22, 0.18), emissiveMap: t }));
	pic.rotation.x = -Math.PI / 2; pic.position.set(0, 0.0025, -0.012);
	g.add(frame, pic);
	g.position.set(x, y, z); g.rotation.y = rotY;
	if (!flat) g.rotation.x = Math.PI / 2;
	root.add(g);
	const light = new THREE.PointLight(0xffd9a0, 1.6, 3.5, 2); light.position.set(x, y + 0.6, z); root.add(light);
	const it = inter.add({
		pos: g.position, prompt: 'Take photograph', radius: 2.4, onUse: () => {
			audio.pickup(); ui.openPhoto(src, caption);
			root.remove(g); root.remove(light); inter.remove(it); onTake && onTake();
		}
	});
	return { group: g, light, it };
}

/** Text on a canvas → texture */
export function textTexture(text, { w = 512, h = 128, bg = null, fg = '#fff', font = '600 72px Plex, monospace', glow = 0, align = 'center' } = {}) {
	return makeCanvasTexture(THREE, w, h, (g) => {
		if (bg) { g.fillStyle = bg; g.fillRect(0, 0, w, h); }
		g.font = font; g.fillStyle = fg; g.textAlign = align; g.textBaseline = 'middle';
		if (glow) { g.shadowColor = fg; g.shadowBlur = glow; }
		g.fillText(text, align === 'center' ? w / 2 : 20, h / 2 + 4);
	});
}

export function glowMaterial(color, strength = 4) {
	const c = new THREE.Color(color).multiplyScalar(strength);
	return new THREE.MeshBasicNodeMaterial({ color: c });
}
