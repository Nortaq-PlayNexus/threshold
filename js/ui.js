// DOM UI controller.
const $ = (s) => document.querySelector(s);

export const ui = {
	hud: $('#hud'),
	show(id) { $(id).classList.remove('hidden'); },
	hide(id) { $(id).classList.add('hidden'); },
	screens: ['#menu', '#levels', '#settings', '#controls', '#pause', '#death', '#ending', '#loading'],
	only(id) { this.screens.forEach(s => s === id ? this.show(s) : this.hide(s)); },

	setObjective(lvl, txt) {
		$('#objective .lvl').textContent = lvl;
		const t = $('#objective .txt');
		if (t.textContent !== txt) { t.textContent = txt; t.animate([{ opacity: 0, transform: 'translateX(-8px)' }, { opacity: 1, transform: 'none' }], { duration: 600 }); }
	},
	prompt(txt) {
		const p = $('#prompt');
		if (p.textContent !== (txt || '')) p.textContent = txt || '';
		$('#crosshair').classList.toggle('active', !!txt);
	},
	hold(f) {
		const r = $('#holdring');
		r.style.opacity = f > 0 ? 1 : 0;
		r.querySelector('circle').style.strokeDashoffset = 100.5 * (1 - f);
	},
	meters(stamina, battery, showBattery) {
		const s = $('#stamina'), b = $('#battery');
		s.querySelector('i').style.width = (stamina * 100) + '%';
		s.style.opacity = stamina > 0.99 ? 0 : 1;
		b.querySelector('i').style.width = (battery * 100) + '%';
		b.style.opacity = showBattery ? 1 : 0;
		b.classList.toggle('low', battery < 0.2);
	},
	clock(sec) {
		const h = Math.floor(sec / 3600), m = Math.floor(sec / 60) % 60, s = Math.floor(sec) % 60;
		$('#clock').textContent = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
	},
	_subT: 0,
	subtitle(txt, dur = 4) {
		const el = $('#subtitle'); el.textContent = txt; el.classList.add('show');
		clearTimeout(this._subT); this._subT = setTimeout(() => el.classList.remove('show'), dur * 1000);
	},
	_toastT: 0,
	toast(txt, dur = 3) {
		const el = $('#toast'); el.textContent = txt; el.classList.add('show');
		clearTimeout(this._toastT); this._toastT = setTimeout(() => el.classList.remove('show'), dur * 1000);
	},
	card(n, t, s) {
		const c = $('#card');
		c.querySelector('.n').textContent = n; c.querySelector('.t').textContent = t; c.querySelector('.s').textContent = s;
		c.classList.remove('hidden');
		c.style.animation = 'none'; void c.offsetWidth; c.style.animation = '';
		clearTimeout(this._cardT); this._cardT = setTimeout(() => c.classList.add('hidden'), 5600);
	},
	readerOpen: false,
	openNote(html) {
		const p = $('#reader .paper'); p.className = 'paper';
		p.querySelector('.body').innerHTML = html;
		this.show('#reader'); this.readerOpen = true;
	},
	openPhoto(src, caption) {
		const p = $('#reader .paper'); p.className = 'paper photo';
		p.querySelector('.body').innerHTML = `<img src="${src}"><div class="cap">${caption}</div>`;
		this.show('#reader'); this.readerOpen = true;
	},
	closeReader() { this.hide('#reader'); this.readerOpen = false; },
	fade(to, white = false, ms = 1200) {
		const f = $('#fade');
		f.classList.toggle('white', white);
		f.style.transition = `opacity ${ms}ms ease`;
		f.style.opacity = to;
		return new Promise(r => setTimeout(r, ms));
	},
	loading(p, txt) { $('#loadBar').style.width = (p * 100) + '%'; if (txt) $('#loadTxt').textContent = txt; },
	fatal(msg) { const f = $('#fatal'); f.textContent = msg; f.classList.remove('hidden'); },
};
