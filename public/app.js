'use strict';
/* Riftbound Training Center - client */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const h = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k === 'style') e.style.cssText = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v != null && v !== false) e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) e.append(k.nodeType ? k : document.createTextNode(k));
  return e;
};
const store = {
  get(k, d) { try { const v = localStorage.getItem('rtc.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('rtc.' + k, JSON.stringify(v)); } catch {} },
};
const DOM_COLORS = { Fury: 'var(--fury)', Calm: 'var(--calm)', Mind: 'var(--mind)', Body: 'var(--body)', Chaos: 'var(--chaos)', Order: 'var(--order)' };
const TYPE_FR = { Unit: 'Unité', Spell: 'Sort', Gear: 'Équipement', Legend: 'Légende', Battlefield: 'Champ de bataille', Rune: 'Rune', Token: 'Jeton' };
const other = p => (p === 'p1' ? 'p2' : 'p1');

const S = {
  cards: [], byId: {}, byName: {}, byCode: {},
  decks: [], curDeck: null,
  seat: store.get('seat', 'spec'), name: store.get('name', ''),
  v: null, me: 'p1', lastActive: null, lastScores: {},
  hover: null, sel: null, viewer: null,
};

/* ================= helpers ================= */
async function api(path, opts) {
  const r = await fetch(path, opts && opts.body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, ...opts, body: JSON.stringify(opts.body) } : opts);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'HTTP ' + r.status);
  return j;
}
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2400);
}
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\((signature|alternate art|alt art|overnumbered)\)/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

/* ================= sound (synthesized, no audio files) ================= */
const sfx = (() => {
  let ctx, master, muted = store.get('mute', false), lastHover = 0;
  const init = () => {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain(); master.gain.value = 0.55;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 5500;
      master.connect(lp); lp.connect(ctx.destination);
      // short airy echo so the chimes feel "magical" rather than beepy
      const dl = ctx.createDelay(), fb = ctx.createGain(), wet = ctx.createGain();
      dl.delayTime.value = 0.13; fb.gain.value = 0.28; wet.gain.value = 0.2;
      master.connect(dl); dl.connect(fb); fb.connect(dl); dl.connect(wet); wet.connect(lp);
    }
    if (ctx.state === 'suspended') ctx.resume();
  };
  const tone = (f, t, dur, vol, type = 'sine', f2) => {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.05);
  };
  const noise = (t, dur, vol, freq) => {
    const b = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = b; f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = 1.2;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(master); s.start(t);
  };
  const play = fn => { if (muted) return; try { init(); fn(ctx.currentTime); } catch {} };
  return {
    hover: () => { const n = performance.now(); if (n - lastHover < 60) return; lastHover = n; play(t => tone(2600, t, 0.045, 0.01)); },
    click: () => play(t => { tone(1318.5, t, 0.25, 0.04); tone(1975.5, t + 0.035, 0.32, 0.022); noise(t, 0.04, 0.015, 3500); }),
    card: () => play(t => { noise(t, 0.11, 0.03, 850); tone(190, t, 0.12, 0.035, 'sine', 95); }),
    turn: () => play(t => [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, t + i * 0.07, 0.8, 0.026, 'triangle'))),
    score: () => play(t => [783.99, 1046.5, 1318.5].forEach((f, i) => tone(f, t + i * 0.08, 0.5, 0.035))),
    start: () => play(t => { tone(196, t, 1.4, 0.045, 'triangle', 392); tone(293.7, t + 0.06, 1.4, 0.03, 'sine', 587.3); noise(t, 0.7, 0.015, 1400); }),
    toggle() { muted = !muted; store.set('mute', muted); return muted; },
    get muted() { return muted; },
  };
})();
const HOVERABLE = '.mbtn, .btn, .mode, .lvl, .deck-item, .back, .score button, .crest';
document.addEventListener('pointerover', e => { const b = e.target.closest(HOVERABLE); if (b && !b.contains(e.relatedTarget)) sfx.hover(); });
document.addEventListener('pointerdown', e => { if (e.button === 0 && e.target.closest('button, .deck-item')) sfx.click(); }, true);
const SPEAKER = m => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9.5h3.2L12 5.5v13l-4.8-4H4z"/>${m
  ? '<path d="M16 9.5l5 5M21 9.5l-5 5"/>'
  : '<path d="M15.5 9a4.2 4.2 0 0 1 0 6"/><path d="M18 6.5a7.8 7.8 0 0 1 0 11"/>'}</svg>`;
const muteBtn = () => {
  const b = h('button', { class: 'mute', title: 'Son', onclick: () => { const m = sfx.toggle(); $$('.mute').forEach(x => (x.innerHTML = SPEAKER(m))); } });
  b.innerHTML = SPEAKER(sfx.muted);
  return b;
};
document.body.append(Object.assign(muteBtn(), { className: 'mute fixed' }));

/* ================= hover zoom: a big readable copy next to any face-up card ================= */
const zoomEl = h('div', { class: 'zoom' });
document.body.append(zoomEl);
let zoomT, zoomFor = null;
function hideZoom() { clearTimeout(zoomT); zoomFor = null; zoomEl.classList.remove('show'); }
function showZoom(el) {
  const c = S.byId[el.dataset.cid];
  if (!c) return hideZoom();
  zoomFor = el;
  zoomEl.innerHTML = '';
  zoomEl.append(cardView(c));
  const r = el.getBoundingClientRect(), z = zoomEl.firstChild.getBoundingClientRect();
  const gap = 16, inHand = !!el.closest('.hand.mine');
  let x = r.right + gap;
  if (x + z.width > innerWidth - 8) x = r.left - gap - z.width;
  let y = inHand ? innerHeight - z.height - 12 : r.top + r.height / 2 - z.height / 2;
  zoomEl.style.left = Math.max(8, x) + 'px';
  zoomEl.style.top = Math.max(8, Math.min(y, innerHeight - z.height - 8)) + 'px';
  zoomEl.classList.add('show');
}
document.addEventListener('pointerover', e => {
  const el = e.target.closest && e.target.closest('.card[data-cid]');
  // no zoom where cards are already shown big (pre-game / prompt screens)
  if (!el || el === zoomFor || el.closest('.preview, .zoom, .ghost, .pregame') || drag) return;
  clearTimeout(zoomT);
  zoomT = setTimeout(() => el.isConnected && el.matches(':hover') && showZoom(el), 140);
});
document.addEventListener('pointerout', e => { const el = e.target.closest && e.target.closest('.card[data-cid]'); if (el && el === zoomFor && !el.contains(e.relatedTarget)) hideZoom(); else if (el && !el.contains(e.relatedTarget)) clearTimeout(zoomT); });
document.addEventListener('pointerdown', hideZoom, true);
addEventListener('wheel', hideZoom, { passive: true });

/* ================= screens ================= */
function show(name) {
  $$('.screen').forEach(s => s.classList.toggle('active', s.id === 'scr-' + name));
  S.screen = name;
  document.body.classList.toggle('in-game', name === 'game');
  if (name === 'decks') renderDeckList();
  if (name === 'lobby') renderLobby();
  if (name === 'menu') renderMenu();
}
document.addEventListener('click', e => { const g = e.target.closest('[data-go]'); if (g) show(g.dataset.go); });

function leaveTitle() { if (S.screen === 'title') { sfx.start(); show('menu'); } }
window.addEventListener('keydown', leaveTitle, { once: false });
$('#scr-title').addEventListener('click', leaveTitle);
S.screen = 'title';

/* ================= particles (title/menu ambience) ================= */
(() => {
  const cv = $('#fx'), cx = cv.getContext('2d'); let W, H, P = [];
  const rs = () => { W = cv.width = innerWidth * devicePixelRatio; H = cv.height = innerHeight * devicePixelRatio; };
  rs(); addEventListener('resize', rs);
  for (let i = 0; i < 70; i++) P.push({ x: Math.random(), y: Math.random(), r: Math.random() * 2 + .5, s: Math.random() * .0006 + .0002, g: Math.random() < .5 });
  (function loop() {
    cx.clearRect(0, 0, W, H);
    const dim = S.screen === 'game' ? .25 : 1;
    for (const p of P) {
      p.y -= p.s; p.x += Math.sin(p.y * 20) * .0003; if (p.y < -0.02) { p.y = 1.02; p.x = Math.random(); }
      cx.beginPath(); cx.arc(p.x * W, p.y * H, p.r * devicePixelRatio, 0, 7);
      cx.fillStyle = p.g ? `rgba(245,200,75,${.5 * dim})` : `rgba(10,200,185,${.45 * dim})`;
      cx.shadowBlur = 12; cx.shadowColor = p.g ? '#f5c84b' : '#0ac8b9'; cx.fill();
    }
    requestAnimationFrame(loop);
  })();
})();

/* ================= card database ================= */
async function loadCards() {
  $('#db-status').textContent = 'Chargement de la base (le premier lancement peut prendre ~1 min)…';
  try {
    S.cards = await api('/api/cards');
    indexCards();
    $('#db-status').textContent = `${S.cards.length} cartes en cache · cliquer pour mettre à jour`;
  } catch (e) { $('#db-status').textContent = 'Erreur : ' + e.message + ' (cliquer pour réessayer)'; }
}
function indexCards() {
  S.byId = {}; S.byName = {}; S.byCode = {};
  for (const c of S.cards) {
    S.byId[c.id] = c;
    const n = norm(c.name);
    if (!S.byName[n] || (S.byName[n].alt && !c.alt)) S.byName[n] = c;
    const m = /^([a-z0-9]+)-(\d+)([a-z*]*)/.exec(c.code);
    if (m) {
      const k = m[1] + '-' + Number(m[2]) + (m[3] || '');
      S.byCode[k] = c;
      if (!m[3] && !S.byCode[m[1] + '-' + Number(m[2])]) S.byCode[m[1] + '-' + Number(m[2])] = c;
    }
  }
}
$('#btn-refresh').addEventListener('click', async () => {
  $('#db-status').textContent = 'Mise à jour depuis Riftcodex…';
  try { await api('/api/cards/refresh', { method: 'POST' }); await loadCards(); toast('Base de cartes à jour'); }
  catch (e) { $('#db-status').textContent = 'Erreur : ' + e.message; }
});

/* ================= card visuals ================= */
// Images are hot-linked from the official CDN at display time (never downloaded/stored); a drawn frame is the fallback.
function cardFace(c) {
  const dc = DOM_COLORS[(c.domain || [])[0]] || '#667';
  const frame = h('div', { class: 'frame' + (c.supertype === 'Token' && !c.img ? ' tokenface' : ''), style: `--dc:${dc}` },
    c.energy != null ? h('div', { class: 'fe' }, c.energy) : null,
    h('div', { class: 'fn' }, c.name),
    h('div', { class: 'ft' }, [TYPE_FR[c.type] || c.type, c.supertype === 'Token' ? 'Jeton' : c.supertype].filter(Boolean).join(' · ')),
    h('div', { class: 'fx' }, c.text || ''),
    c.might != null ? h('div', { class: 'fm' }, '⚔ ' + c.might) : null);
  const parts = [frame];
  if (c.img) {
    const img = h('img', { src: c.img, alt: c.name, loading: 'lazy', draggable: 'false', referrerpolicy: 'no-referrer' });
    img.onerror = () => img.remove();
    parts.push(img);
  }
  return parts;
}
// Card backs drawn as SVG after the official Riftbound backs: thin gold frame, a large diamond,
// a hexagonal band with the LEAGUE OF LEGENDS wordmark, dotted arcs and small glyphs top and bottom.
// Blue = main deck, white = runes, black = legends / battlefields.
function backSvg(bg, bg2, gold, ink) {
  const glyph = "<path d='M-1.6,-4.2 C1.8,-3.6 2.2,-0.6 0.2,0.6 C-1.6,1.6 -1.4,3.6 1.2,4.4 C-2.6,4.2 -3.2,1 -1.2,-0.2 C0.4,-1.2 0.2,-3 -1.6,-4.2 Z'/>";
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 140'>
<defs><radialGradient id='b' cx='50%' cy='48%' r='70%'><stop offset='0' stop-color='${bg2}'/><stop offset='1' stop-color='${bg}'/></radialGradient></defs>
<rect width='100' height='140' rx='6' fill='url(#b)'/>
<g fill='none' stroke='${gold}' stroke-linejoin='round'>
<rect x='5.5' y='5.5' width='89' height='129' rx='4' stroke-width='.9'/>
<path d='M50 33 L91 70 L50 107 L9 70 Z' stroke-width='.9'/>
<path d='M50 38.5 L85 70 L50 101.5 L15 70 Z' stroke-width='.45'/>
<path d='M9 70 Q 22 46 50 33 M91 70 Q 78 46 50 33 M9 70 Q 22 94 50 107 M91 70 Q 78 94 50 107' stroke-width='.35' opacity='.8'/>
<path d='M29 55.5 Q50 47 71 55.5 M29 84.5 Q50 93 71 84.5' stroke-width='.9' stroke-dasharray='.4 1.6' stroke-linecap='round'/>
<path d='M50 12 V24 M50 116 V128' stroke-width='.5'/>
</g>
<path d='M17 70 L25 59 H75 L83 70 L75 81 H25 Z' fill='${bg}' stroke='${gold}' stroke-width='.9'/>
<text x='50' y='68.6' text-anchor='middle' font-family='Georgia, Times New Roman, serif' font-weight='bold' font-size='8.6' letter-spacing='.2' fill='${gold}'>LEAGUE<tspan font-size='4.2' dx='1' dy='-.2'>OF</tspan></text>
<text x='50' y='77.8' text-anchor='middle' font-family='Georgia, Times New Roman, serif' font-weight='bold' font-size='8.6' letter-spacing='.2' fill='${gold}'>LEGENDS</text>
<g fill='${gold}'><g transform='translate(50 28) scale(1.15)'>${glyph}</g><g transform='translate(50 112) scale(1.15) rotate(180)'>${glyph}</g></g>
<circle cx='50' cy='70' r='0' fill='${ink}'/>
</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}
document.documentElement.style.setProperty('--back-main', backSvg('#0f3247', '#17465f', '#e2c25c', '#0f3247'));
document.documentElement.style.setProperty('--back-rune', backSvg('#e9e6df', '#fbfaf6', '#b8952f', '#e9e6df'));
document.documentElement.style.setProperty('--back-black', backSvg('#09090b', '#18181c', '#e2c25c', '#09090b'));
const backKind = (data, zone) => (data ? (data.type === 'Rune' ? 'b-rune' : ['Legend', 'Battlefield'].includes(data.type) ? 'b-black' : '') : zone === 'runeDeck' || zone === 'runes' ? 'b-rune' : '');

// generic card element (deck builder, viewer, preview)
function cardView(c, { back = false, cls = '' } = {}) {
  const el = h('div', { class: `card ${cls} ${back ? 'back' : ''} ${c && c.landscape ? 'landscape' : ''}`, 'data-cid': !back && c ? c.id : null });
  el.append(h('div', { class: 'in' }, back || !c ? [] : cardFace(c)));
  return el;
}

/* ================= decks ================= */
const SECTIONS = [
  ['legend', 'Légende'], ['champion', 'Champion choisi'], ['main', 'Deck principal'],
  ['battlefields', 'Champs de bataille'], ['runes', 'Runes'], ['side', 'Réserve (side)'],
];
const HEADERS = { legend: /^(legend|legende|légende)/, champion: /^(chosen )?champion/, main: /^(main|maindeck|main deck|deck)\b/, battlefields: /^(battlefield|champs? de bataille)/, runes: /^(rune)/, side: /^(side|sideboard|reserve)/ };
const emptyDeck = name => ({ name, cards: { legend: [], champion: [], main: [], battlefields: [], runes: [], side: [] } });
const sectionFor = c => (c.type === 'Legend' ? 'legend' : c.type === 'Battlefield' ? 'battlefields' : c.type === 'Rune' ? 'runes' : 'main');
const count = list => (list || []).reduce((a, x) => a + x.n, 0);

function findCard(raw) {
  const s = raw.trim();
  const code = /^([a-z]{2,4}\d?)[- ]?(\d{1,3})([a-z*]?)(?:[- ]\d+)?$/i.exec(s);
  if (code) {
    const k = code[1].toLowerCase() + '-' + Number(code[2]);
    const c = S.byCode[k + (code[3] || '').toLowerCase()] || S.byCode[k];
    if (c) return c;
  }
  const n = norm(s);
  if (S.byName[n]) return S.byName[n];
  // trailing set code e.g. "Jinx, Loose Cannon (OGN-202)"
  const tail = /\(?([a-z]{2,4})[- ](\d{1,3})\)?\s*$/i.exec(s);
  if (tail) { const c = S.byCode[tail[1].toLowerCase() + '-' + Number(tail[2])]; if (c) return c; }
  const n2 = norm(s.replace(/\(.*?\)|\[.*?\]/g, ''));
  return S.byName[n2] || S.cards.find(c => !c.alt && norm(c.name).startsWith(n2)) || null;
}

function parseDeck(text, name) {
  const d = emptyDeck(name || 'Deck importé');
  const warn = [];
  let sec = null, sawChampion = false;
  const add = (k, c, n) => { const l = d.cards[k]; const e = l.find(x => x.id === c.id); if (e) e.n += n; else l.push({ id: c.id, n }); };
  for (let line of text.split(/\r?\n/)) {
    line = line.replace(/\/\/.*$|#.*$/, '').trim();
    if (!line) continue;
    const hl = norm(line.replace(/:$/, '').replace(/\(\d+\)$/, ''));
    const head = Object.entries(HEADERS).find(([, re]) => re.test(hl) && (line.endsWith(':') || !/^\d/.test(line)) && hl.split(' ').length <= 3);
    if (head && !/^\d/.test(line)) { sec = head[0]; if (sec === 'champion') sawChampion = true; continue; }
    let n = 1, rest = line;
    const m1 = /^(\d+)\s*x?\s+(.+)$/i.exec(line), m2 = /^(.+?)\s+x?(\d+)$/i.exec(line);
    if (m1) { n = +m1[1]; rest = m1[2]; } else if (m2 && !/[- ]\d{1,3}$/.test(line.replace(/\s+x?\d+$/, '') + '') ) { n = +m2[2]; rest = m2[1]; }
    const c = findCard(rest);
    if (!c) { warn.push('Introuvable : ' + line); continue; }
    let k = sec && sec !== 'main' ? sec : sectionFor(c);
    if (sec === 'side') k = 'side';
    if (sec === 'champion') k = 'champion';
    add(k, c, n);
  }
  // auto-pick chosen champion when list has none
  if (!sawChampion && !d.cards.champion.length && d.cards.legend.length) {
    const lg = S.byId[d.cards.legend[0].id];
    const e = d.cards.main.find(x => { const c = S.byId[x.id]; return c.supertype === 'Champion' && c.tags.some(t => lg.tags.includes(t)); });
    if (e) { e.n--; d.cards.champion.push({ id: e.id, n: 1 }); if (!e.n) d.cards.main.splice(d.cards.main.indexOf(e), 1); }
  }
  return { deck: d, warn };
}

function exportDeck(d) {
  const L = [];
  const names = { legend: 'Legend', champion: 'Champion', main: 'MainDeck', battlefields: 'Battlefields', runes: 'Runes', side: 'Sideboard' };
  for (const [k] of SECTIONS) {
    const l = d.cards[k] || [];
    if (!l.length) continue;
    L.push(names[k] + ':');
    for (const x of l) { const c = S.byId[x.id]; L.push(`${x.n} ${c ? c.name : x.id}`); }
    L.push('');
  }
  return L.join('\n');
}

function deckChecks(d) {
  const c = d.cards, mainN = count(c.main) + count(c.champion);
  const copies = {};
  for (const k of ['main', 'champion']) for (const x of c[k]) { const n = norm((S.byId[x.id] || {}).name); copies[n] = (copies[n] || 0) + x.n; }
  const over = Object.entries(copies).filter(([, n]) => n > 3).map(([k]) => k);
  return [
    [count(c.legend) === 1, `Légende ${count(c.legend)}/1`],
    [count(c.champion) === 1, `Champion ${count(c.champion)}/1`],
    [mainN >= 40, `Deck ${mainN}/40 (champion inclus)`],
    [count(c.runes) === 12, `Runes ${count(c.runes)}/12`],
    [c.battlefields.length === 3 && count(c.battlefields) === 3, c.battlefields.length < count(c.battlefields) ? `Champs de bataille : doublon (${c.battlefields.length} différents sur 3)` : `Champs de bataille ${count(c.battlefields)}/3`],
    [!over.length, over.length ? `+3 copies : ${over.join(', ')}` : 'Max 3 copies ✓'],
  ];
}
const deckDomains = d => { const l = d.cards.legend[0] && S.byId[d.cards.legend[0].id]; return l ? l.domain : []; };

async function loadDecks() { S.decks = await api('/api/decks').catch(() => []); }
let saveT;
function saveDeck(d, now) {
  clearTimeout(saveT);
  const go = async () => { const r = await api('/api/decks', { body: d }); d.id = r.id; renderDeckList(true); };
  if (now) return go(); saveT = setTimeout(go, 400);
}

function renderDeckList(keepEditor) {
  const list = $('#deck-list'); list.innerHTML = '';
  if (!S.decks.length) list.append(h('div', { class: 'empty-hint', style: 'margin-top:20px;font-size:14px' }, 'Aucun deck'));
  for (const d of S.decks) {
    const lg = d.cards.legend[0] && S.byId[d.cards.legend[0].id];
    list.append(h('div', { class: 'deck-item' + (S.curDeck === d ? ' sel' : ''), onclick: () => { S.curDeck = d; renderDeckList(); } },
      h('div', {}, h('b', {}, d.name), h('small', {}, lg ? lg.name : 'Sans légende')),
      h('div', { class: 'doms' }, deckDomains(d).map(x => h('i', { class: 'dom', style: `color:${DOM_COLORS[x]}` })))));
  }
  if (!keepEditor) renderEditor();
}

function renderEditor() {
  const ed = $('#deck-editor'), d = S.curDeck;
  ed.innerHTML = '';
  if (!d) { ed.append(h('div', { class: 'empty-hint' }, 'Importez une liste ou créez un deck pour commencer.')); return; }
  const name = h('input', { class: 'name', value: d.name, oninput: e => { d.name = e.target.value; saveDeck(d); } });
  ed.append(h('div', { class: 'de-head' }, name, h('div', { class: 'grow' }),
    h('button', { class: 'btn', onclick: () => { navigator.clipboard.writeText(exportDeck(d)).then(() => toast('Liste copiée')); } }, 'Copier la liste'),
    h('button', { class: 'btn', onclick: async () => { const c = JSON.parse(JSON.stringify(d)); delete c.id; c.name += ' (copie)'; await saveDeck(c, true); await loadDecks(); S.curDeck = S.decks.find(x => x.id === c.id); renderDeckList(); } }, 'Dupliquer'),
    h('button', { class: 'btn danger', onclick: async () => { if (!confirm(`Supprimer « ${d.name} » ?`)) return; await api('/api/decks/' + encodeURIComponent(d.id), { method: 'DELETE' }); await loadDecks(); S.curDeck = null; renderDeckList(); } }, 'Supprimer')));
  ed.append(h('div', { class: 'checks' }, deckChecks(d).map(([ok, t]) => h('span', { class: 'chk ' + (ok ? 'ok' : 'bad') }, t))));

  const change = (k, id, delta) => {
    const l = d.cards[k], e = l.find(x => x.id === id);
    if (e) { e.n += delta; if (e.n <= 0) l.splice(l.indexOf(e), 1); } else if (delta > 0) l.push({ id, n: delta });
    saveDeck(d); renderEditor();
  };
  for (const [k, label] of SECTIONS) {
    const l = d.cards[k];
    if (k === 'side' && !l.length) continue;
    const grid = h('div', { class: 'grid' });
    for (const x of l) {
      const c = S.byId[x.id]; if (!c) continue;
      const el = cardView(c, { cls: 'dcard' });
      el.addEventListener('mouseenter', () => showPreview(c));
      el.append(h('div', { class: 'qty' }, x.n), h('div', { class: 'qb' },
        h('button', { title: 'Retirer', onclick: () => change(k, x.id, -1) }, '−'),
        h('button', { title: 'Ajouter', onclick: () => change(k, x.id, 1) }, '+'),
        k === 'main' && c.supertype === 'Champion' ? h('button', { title: 'Définir comme champion choisi', onclick: () => { for (const y of d.cards.champion.splice(0)) change('main', y.id, y.n); change('main', x.id, -1); change('champion', x.id, 1); } }, '★') : null,
        k !== 'side' ? h('button', { title: 'Vers la réserve', onclick: () => { change(k, x.id, -1); change('side', x.id, 1); } }, 'S') : h('button', { title: 'Vers le deck', onclick: () => { change('side', x.id, -1); change(sectionFor(c), x.id, 1); } }, 'D')));
      grid.append(el);
    }
    ed.append(h('div', { class: 'de-sec' }, h('h3', {}, h('span', {}, label), h('span', {}, count(l))), grid));
  }
  // add cards
  const q = h('input', { placeholder: 'Rechercher une carte (nom, texte, tag)…' });
  const type = h('select', {}, h('option', { value: '' }, 'Tous types'), Object.entries(TYPE_FR).map(([k, v]) => h('option', { value: k }, v)));
  const dom = h('select', {}, h('option', { value: '' }, 'Tous domaines'), Object.keys(DOM_COLORS).map(k => h('option', { value: k }, k)));
  const alts = h('input', { type: 'checkbox' });
  const res = h('div', { class: 'results' });
  const run = () => {
    const t = norm(q.value);
    res.innerHTML = '';
    if (!t && !type.value && !dom.value) return;
    S.cards.filter(c => (alts.checked || !c.alt) && (!type.value || c.type === type.value) && (!dom.value || c.domain.includes(dom.value)) &&
      (!t || norm(c.name + ' ' + c.text + ' ' + c.tags.join(' ')).includes(t))).slice(0, 80)
      .forEach(c => { const el = cardView(c); el.title = 'Clic : ajouter'; el.onclick = () => change(sectionFor(c), c.id, 1); el.onmouseenter = () => showPreview(c); res.append(el); });
  };
  for (const e of [q, type, dom, alts]) e.addEventListener('input', run);
  ed.append(h('div', { class: 'de-sec' }, h('h3', {}, 'Ajouter des cartes'),
    h('div', { class: 'search-bar' }, q, type, dom, h('label', { style: 'display:flex;gap:6px;align-items:center;color:var(--mut)' }, alts, 'variantes')), res));
}

$('#btn-new-deck').onclick = async () => { const d = emptyDeck('Nouveau deck'); await saveDeck(d, true); await loadDecks(); S.curDeck = S.decks.find(x => x.id === d.id); renderDeckList(); };
$('#btn-import').onclick = () => {
  const ta = h('textarea', { placeholder: 'Collez votre liste (formats Rift Atlas / Piltover Archive / Pixelborn / TTS)…\n\nLegend:\n1 Jinx, Loose Cannon\nChampion:\n1 Jinx, Demolitionist\nMainDeck:\n3 Get Excited!\n...\nBattlefields:\n1 ...\nRunes:\n6 Fury Rune\n6 Chaos Rune\n\nLes codes (OGN-202) fonctionnent aussi.' });
  const nm = h('input', { placeholder: 'Nom du deck', style: 'flex:1' });
  const warn = h('div', { class: 'warn' });
  openModal(h('div', { class: 'box' }, h('h3', {}, 'Importer une liste'), ta, warn,
    h('div', { class: 'row' }, nm, h('button', { class: 'btn', onclick: closeModal }, 'Annuler'),
      h('button', { class: 'btn gold', onclick: async () => {
        if (!S.cards.length) return (warn.textContent = 'Base de cartes non chargée.');
        const { deck, warn: w } = parseDeck(ta.value, nm.value.trim() || undefined);
        if (!nm.value.trim()) { const lg = deck.cards.legend[0] && S.byId[deck.cards.legend[0].id]; deck.name = lg ? lg.name : 'Deck importé'; }
        if (!SECTIONS.some(([k]) => deck.cards[k].length)) return (warn.textContent = 'Aucune carte reconnue.\n' + w.join('\n'));
        await saveDeck(deck, true); await loadDecks(); S.curDeck = S.decks.find(x => x.id === deck.id); renderDeckList();
        if (w.length) { warn.textContent = `Importé avec ${w.length} ligne(s) ignorée(s) :\n` + w.join('\n'); } else closeModal();
        toast('Deck importé');
      } }, 'Importer'))));
  ta.focus();
};

function openModal(box, panel) { const m = $('#modal'); m.innerHTML = ''; m.append(box); m.classList.add('show'); m.classList.toggle('panel', !!panel); }
function closeModal() { $('#modal').classList.remove('show'); S.viewer = null; }
$('#modal').addEventListener('pointerdown', e => { if (e.target.id === 'modal') closeModal(); });

/* ================= menu ================= */
function renderMenu() {}

/* ================= sync (SSE) ================= */
let es;
function connect(room, seat) {
  S.room = room; S.seat = seat;
  store.set('room', room); store.set('seat', seat);
  if (es) es.close();
  es = null;
  if (!room) return;
  es = new EventSource(`/api/events?room=${encodeURIComponent(room)}&seat=${seat}`);
  es.onmessage = ev => onState(JSON.parse(ev.data));
}
const isSeated = () => ['p1', 'p2', 'solo'].includes(S.seat);
async function send(a) {
  try { await api('/api/action', { body: { room: S.room, seat: S.seat, p: S.me, ...a } }); }
  catch (e) { toast(e.message); }
}

function onState(v) {
  const prev = S.v; S.v = v;
  if (v.phase === 'none') { connect(null, null); S.v = null; if (S.screen === 'game') show('menu'); return; }
  if (v.phase === 'ended') {
    connect(null, null); S.v = null;
    if (S.screen === 'game') { banner('Partie terminée'); setTimeout(() => show('menu'), 1600); }
    return;
  }
  if (v.phase === 'lobby') { if (S.screen === 'lobby') renderLobby(); return; }
  if (S.seat === 'p1' || S.seat === 'p2') S.me = S.seat;
  const wantAuto = !!store.get('auto', true);
  if (v.phase === 'playing' && S.me && !!(v.auto || {})[S.me] !== wantAuto && S.autoSync !== S.room + wantAuto) {
    S.autoSync = S.room + wantAuto; send({ type: 'setAuto', on: wantAuto });
  }
  if (!prev || prev.phase !== 'playing') {
    if (S.seat === 'solo') S.me = v.first;
    S.lastActive = null; S.lastScores = {}; S.autoSwap = null; skeletonKey = '';
    if (S.screen !== 'decks') show('game');
  }
  if (S.screen === 'game') renderGame();
}

/* ================= play screen (mode choice) ================= */
const ICONS = {
  // hextech core: faceted crystal inside a hexagon, with circuit nodes
  ai: `<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round">
    <path d="M24 3 42 13.5v21L24 45 6 34.5v-21Z" opacity=".55"/>
    <path d="M24 12 33 24 24 36 15 24Z" fill="currentColor" fill-opacity=".18"/><path d="M15 24h18M24 12v24" opacity=".7"/>
    <circle cx="24" cy="24" r="3.2" fill="currentColor"/>
    <path d="M6 24h5M37 24h5M24 3v5M24 40v5"/><circle cx="11" cy="24" r="1.4" fill="currentColor"/><circle cx="37" cy="24" r="1.4" fill="currentColor"/></svg>`,
  // two crossed swords
  pvp: `<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M8 6h6l20 20-6 6L8 12Z" fill="currentColor" fill-opacity=".15"/><path d="M28 32l-4 4M34 26l4-4M31 35l7 7M35 31l7 7"/>
    <path d="M40 6h-6L14 26l6 6 20-20Z" fill="currentColor" fill-opacity=".15"/><path d="M20 32l4 4M14 26l-4-4M17 35l-7 7M13 31l-7 7"/></svg>`,
};
const LEVELS = [
  ['easy', 'Adversaire débutant', 'Joue au hasard, gaspille ses runes, attaque sans réfléchir.'],
  ['normal', 'Adversaire confirmé', 'Lance ses sorts au bon moment, contre et réagit en combat, prend les champs de bataille.'],
  ['hard', 'Pro Player', 'Calcule toutes les attaques possibles et la riposte adverse, optimise chaque rune.'],
];
S.mode = store.get('mode', 'ai'); S.level = store.get('level', 'normal');
async function renderLobby() {
  const L = $('#lobby'); if (!L) return;
  if (!S.lan) S.lan = /^(localhost|127\.|\[::1\])/.test(location.hostname) ? (await api('/api/info').catch(() => ({ lan: [] }))).lan : [];
  L.innerHTML = '';
  // waiting for the second human
  if (S.v && S.v.phase === 'lobby' && S.room) {
    L.append(h('div', { class: 'wait' },
      h('div', { class: 'wait-lbl' }, 'Donnez ce tag à votre adversaire'),
      h('div', { class: 'tag', title: 'Cliquer pour copier', onclick: () => navigator.clipboard.writeText(S.room).then(() => toast('Tag copié')) }, S.room),
      h('div', { class: 'spinner' }), h('div', { class: 'wait-lbl' }, 'En attente de l’adversaire…'),
      h('div', { class: 'lan' }, 'Il ouvre ', S.lan.length ? S.lan.map((u, i) => [i ? ' ou ' : '', h('code', {}, u)]) : h('code', {}, location.origin),
        ', clique sur Jouer › Contre un joueur et entre le tag.'),
      h('button', { class: 'btn', onclick: () => { send({ type: 'quit' }); connect(null, null); S.v = null; renderLobby(); } }, 'Annuler')));
    return;
  }
  const RANDOM = '__random';
  const deckOpts = (val, extra) => [extra, h('option', { value: RANDOM, selected: val === RANDOM }, '🎲 Aléatoire'), ...S.decks.map(d => h('option', { value: d.id, selected: d.id === val }, d.name))];
  // '🎲 Aléatoire': a deck drawn at random when the game is created
  const pickDeck = v => { if (v !== RANDOM) return v; const d = S.decks[Math.floor(Math.random() * S.decks.length)]; return d && d.id; };
  const deckName = id => (S.decks.find(d => d.id === id) || {}).name;
  const myDeck = h('select', {}, deckOpts(store.get('deck', ''), h('option', { value: '' }, '— Votre deck —')));
  const nameIn = h('input', { placeholder: 'Votre nom', value: S.name, oninput: e => { S.name = e.target.value; store.set('name', S.name); } });
  myDeck.onchange = () => store.set('deck', myDeck.value);
  const tabs = [['ai', 'Contre l’IA', ICONS.ai], ['pvp', 'Contre un joueur', ICONS.pvp]];
  if (!tabs.some(t => t[0] === S.mode)) S.mode = 'ai';
  const create = async (mode, extra = {}) => {
    if (!myDeck.value) return toast('Choisissez votre deck');
    try {
      store.set('auto', true); // every new game starts in auto mode (the switch at the top right turns it off)
      const mine = pickDeck(myDeck.value);
      if (extra.deckId2) extra = { ...extra, deckId2: pickDeck(extra.deckId2) };
      const drawn = [myDeck.value === RANDOM && `vous : ${deckName(mine)}`, extra.drawnAi && `IA : ${deckName(extra.deckId2)}`].filter(Boolean);
      if (drawn.length) toast('🎲 Deck tiré au sort — ' + drawn.join(' · '));
      delete extra.drawnAi;
      const r = await api('/api/room/create', { body: { mode, name: S.name, deckId: mine, auto: true, ...extra } });
      connect(r.tag, r.seat); S.me = r.seat;
      if (mode === 'pvp') setTimeout(renderLobby, 150);
    } catch (e) { toast(e.message); }
  };
  let panel;
  if (S.mode === 'ai') {
    const aiDeck = h('select', {}, deckOpts(store.get('aiDeck', ''), h('option', { value: '' }, 'Même deck que vous')));
    aiDeck.onchange = () => store.set('aiDeck', aiDeck.value);
    panel = h('div', { class: 'mode-panel' },
      h('div', { class: 'levels' }, LEVELS.map(([k, t, d]) => h('button', { class: 'lvl ' + k + (S.level === k ? ' on' : ''), onclick: e => { S.level = k; store.set('level', k); $$('.lvl').forEach(b => b.classList.toggle('on', b === e.currentTarget)); } },
        h('b', {}, t), h('span', {}, d)))),
      h('div', { class: 'form' }, h('label', {}, 'Votre deck', myDeck), h('label', {}, 'Deck de l’IA', aiDeck)),
      h('button', { class: 'btn gold big', onclick: () => create('ai', { level: S.level, deckId2: aiDeck.value, drawnAi: aiDeck.value === RANDOM }) }, 'Lancer la partie'));
  } else if (S.mode === 'pvp') {
    const tagIn = h('input', { placeholder: 'TAG', class: 'tag-in', maxlength: 10 });
    panel = h('div', { class: 'mode-panel' },
      h('div', { class: 'form' }, h('label', {}, 'Votre nom', nameIn), h('label', {}, 'Votre deck', myDeck)),
      h('div', { class: 'pvp' },
        h('div', { class: 'pvp-col' }, h('h4', {}, 'Créer une partie'), h('p', {}, 'Un tag est généré : donnez-le à votre adversaire.'), h('button', { class: 'btn gold big', onclick: () => create('pvp') }, 'Créer')),
        h('div', { class: 'pvp-or' }, 'ou'),
        h('div', { class: 'pvp-col' }, h('h4', {}, 'Rejoindre'), tagIn, h('button', { class: 'btn teal big', onclick: async () => {
          if (!myDeck.value) return toast('Choisissez votre deck');
          try { const r = (store.set('auto', true), await api('/api/room/join', { body: { tag: tagIn.value, name: S.name, deckId: pickDeck(myDeck.value), auto: true } })); connect(r.tag, r.seat); S.me = r.seat; }
          catch (e) { toast(e.message); }
        } }, 'Rejoindre'))));
  }
  const icon = svg => { const i = h('i'); i.innerHTML = svg; return i; };
  // the panel only fades when switching mode, never on other re-renders
  panel.classList.toggle('enter', !!S.lobbyAnim); S.lobbyAnim = false;
  L.append(
    h('div', { class: 'modes' }, tabs.map(([k, t, ic]) => h('button', { class: 'mode' + (S.mode === k ? ' on' : ''), onclick: () => { if (S.mode === k) return; S.mode = k; store.set('mode', k); S.lobbyAnim = true; renderLobby(); } }, icon(ic), h('b', {}, t)))),
    panel);
  if (!S.decks.length) L.append(h('div', { class: 'chk bad' }, 'Aucun deck : allez dans « Mes decks » pour en importer un.'));
}

/* ================= GAME ================= */
const els = new Map(); // iid -> element (persistent, for FLIP animations)
const origin = new Map(); // iid -> rect to animate from (drop position)
let skeletonKey = '';

const cardOf = c => (c && !c.hidden && c.cid ? S.byId[c.cid] : null);
const pname = p => (S.v.seats[p] && S.v.seats[p].name) || (p === 'p1' ? 'Joueur 1' : 'Joueur 2');

function locate(iid) {
  const v = S.v;
  for (const p of ['p1', 'p2']) for (const [z, arr] of Object.entries(v.players[p].zones)) { const c = arr.find(x => x.iid === iid); if (c) return { c, p, zone: z }; }
  const ci = (v.chain || []).find(x => x.iid === iid);
  if (ci) return { c: ci, zone: 'chain', p: ci.cb ? ci.cb.by : ci.owner };
  for (let b = 0; b < v.bfs.length; b++) {
    if (v.bfs[b].card && v.bfs[b].card.iid === iid) return { c: v.bfs[b].card, bfCard: b };
    for (const p of ['p1', 'p2']) { const c = v.bfs[b].units[p].find(x => x.iid === iid); if (c) return { c, bf: b, side: p }; }
    const hc = (v.bfs[b].hidden || []).find(x => x.iid === iid); if (hc) return { c: hc, bf: b, side: hc.owner, zone: 'hidden', p: hc.owner };
  }
  return null;
}

function zoneBox(cls, label, drop, inner) {
  const z = h('div', { class: 'zone ' + cls, 'data-drop': drop ? JSON.stringify(drop) : null }, h('span', { class: 'lbl' }, label), inner);
  return z;
}

const PILE_TIP = {
  main: mine => (mine ? 'Clic : piocher · Clic droit : options' : 'Deck adverse'),
  runeDeck: mine => (mine ? 'Clic : canaliser une rune · Clic droit : options' : 'Deck de runes adverse'),
  trash: () => 'Clic : voir la défausse',
  banish: () => 'Clic : voir les cartes bannies',
};
function buildSkeleton() {
  const v = S.v, me = S.me, op = other(me);
  const B = $('#board'); B.innerHTML = '';
  const half = (p, cls) => {
    const isMe = p === me;
    return h('div', { class: 'half ' + cls },
      zoneBox('z-legend', 'Légende', { p, zone: 'legend' }, h('div', { class: 'slot', 'data-z': p + ':legend' })),
      zoneBox('z-champion', 'Champion', { p, zone: 'champion' }, h('div', { class: 'slot', 'data-z': p + ':champion' })),
      zoneBox('z-base', 'Base' + (isMe ? '' : ' · ' + pname(p)), { p, zone: 'base' }, h('div', { class: 'row', 'data-z': p + ':base' })),
      zoneBox('z-runes', 'Réserve de runes', { p, zone: 'runes' }, [h('div', { class: 'pool', 'data-pool': p }), h('div', { class: 'row', 'data-z': p + ':runes', title: isMe ? 'Clic : épuiser / redresser une rune (+1 énergie en réserve)' : '' })]),
      ...[['main', 'Deck', 'top'], ['trash', 'Défausse', 'top'], ['runeDeck', 'Deck de runes', 'bottom'], ['banish', 'Bannis', 'top']].map(([z, label, pos]) =>
        zoneBox('pz-' + z, label, { p, zone: z, pos }, h('div', { class: 'slot pile', 'data-pile': p + ':' + z, title: PILE_TIP[z](p === S.me) }, h('div', { class: 'stack', 'data-z': p + ':' + z }), h('span', { class: 'count' })))));
  };
  const bfs = h('div', { class: 'bfrow' }, v.bfs.map((b, i) => h('div', { class: 'bf', 'data-bf': i },
    h('div', { class: 'units', 'data-drop': JSON.stringify({ bf: i, side: op }), 'data-z': `bf${i}:${op}` }),
    h('div', { class: 'mid' },
      h('span', { class: 'might-sum op', 'data-ms': `${i}:${op}` }),
      h('div', { class: 'bfcard slot', 'data-z': `bfc${i}`, style: 'padding:0;min-height:0;width:auto' }),

      h('div', { class: 'bfctl' },
        h('button', { class: 'crest', title: 'Contrôle (clic : moi / clic droit : adversaire)', 'data-crest': i }, '⚑'),
        h('button', { class: 'btn sm', 'data-fight': i, title: 'Combat (unités des deux côtés) ou conquête (+1 point)', onclick: () => {
          const b = S.v.bfs[i];
          if (S.v.showdown && S.v.showdown.bf === i) send({ type: 'pass' });
          else if (b.units.p1.length && b.units.p2.length) send({ type: 'fight', bf: i, att: b.units[S.me].length ? S.me : other(S.me) });
          else send({ type: 'conquer', bf: i });
          flashBf(i);
        } }, '⚔')),
      h('span', { class: 'might-sum me', 'data-ms': `${i}:${me}` })),
    h('div', { class: 'units', 'data-drop': JSON.stringify({ bf: i, side: me }), 'data-z': `bf${i}:${me}` }),
    h('div', { class: 'bfhidden op', 'data-z': `bfh${i}:${op}`, title: 'Carte cachée (Hidden)' }),
    h('div', { class: 'bfhidden me', 'data-z': `bfh${i}:${me}`, 'data-drop': JSON.stringify({ hide: i }), title: 'Votre carte cachée (Hidden) : glissez ici une carte [Hidden] de votre main' }))));
  B.append(
    h('div', { class: 'handwrap op zone', 'data-drop': JSON.stringify({ p: op, zone: 'hand' }) }, h('span', { class: 'hlbl' }, 'Main · ' + pname(op)), h('div', { class: 'hand op', 'data-z': op + ':hand' })),
    half(op, 'op'), bfs, half(me, 'me'),
    h('div', { class: 'handwrap mine zone', 'data-drop': JSON.stringify({ p: me, zone: 'hand' }) }, h('span', { class: 'hlbl' }, 'Votre main'), h('div', { class: 'hand mine', 'data-z': me + ':hand' })));
  $$('[data-crest]', B).forEach(b => {
    const i = +b.dataset.crest;
    b.onclick = () => send({ type: 'control', bf: i, p: S.me });
    b.oncontextmenu = e => { e.preventDefault(); send({ type: 'control', bf: i, p: other(S.me) }); };
  });
  $$('[data-pile]', B).forEach(pl => {
    const [p, z] = pl.dataset.pile.split(':');
    pl.onclick = e => { if (e.target.closest('.card') && pl._dragged) return; pileClick(p, z); };
    pl.oncontextmenu = e => { e.preventDefault(); e.stopPropagation(); pileMenu(p, z, e); };
  });
}

function pileClick(p, z) {
  const mine = p === S.me;
  if (z === 'main' || z === 'runeDeck') {
    if (!mine) return;
    if (!S.v.stage || S.v.stage === 'main') send(z === 'main' ? { type: 'draw', n: 1, p } : { type: 'channel', n: 1, p });
  } else openViewer(p, z);
}

function cardSig(c, faceDown) { return (faceDown || c.hidden || c.fd ? 'B' : c.cid) + ''; }

// equipment attached to a unit (gear stays in its controller's base with att = unit iid)
const eqOn = c => ['p1', 'p2'].flatMap(p => S.v.players[p].zones.base.filter(g => g.att === c.iid));
function syncCard(c, faceDown, extraCls, zone) {
  let el = els.get(c.iid);
  if (!el) {
    el = h('div', { class: 'card', 'data-iid': c.iid }, h('div', { class: 'in' }), h('div', { class: 'badges' }));
    els.set(c.iid, el);
  }
  const data = cardOf(c);
  const sig = cardSig(c, faceDown) + (data && data.landscape ? 'L' : '');
  const back = sig.startsWith('B') || !data;
  if (el.dataset.sig !== sig) {
    const wasBack = el.dataset.sig && el.dataset.sig.startsWith('B');
    const inn = el.querySelector('.in');
    inn.innerHTML = '';
    if (!back) inn.append(...cardFace(data));
    if (el.dataset.sig && wasBack !== back) inn.animate([{ transform: 'rotateY(90deg)' }, { transform: 'rotateY(0)' }], { duration: 300, easing: 'ease-out' });
    el.dataset.sig = sig;
  }
  if (back) delete el.dataset.cid; else el.dataset.cid = data.id;
  el.className = `card ${back ? 'back ' + backKind(data, zone) : ''} ${data && data.landscape ? 'landscape' : ''} ${c.ex ? 'ex' : ''} ${S.sel === c.iid ? 'sel' : ''} ${extraCls || ''}`;
  // badges
  const bd = el.querySelector('.badges'); bd.innerHTML = '';
  if (c.dmg) bd.append(h('span', { class: 'badge dmg' }, c.dmg));
  if (c.buff) bd.append(h('span', { class: 'badge buff' + (c.buff < 0 ? ' neg' : '') }, (c.buff > 0 ? '+' : '') + c.buff));
  const eq = eqOn(c);
  if ((c.buff || c.tb || eq.length) && data && data.might != null) bd.append(h('span', { class: 'badge might' }, '⚔' + (data.might + (c.buff || 0) + (c.tb || 0) + eq.reduce((t, g) => t + ((cardOf(g) || {}).might || 0), 0))));
  if (eq.length) bd.append(h('span', { class: 'badge equip', title: eq.map(g => (cardOf(g) || {}).name).join(', ') }, '⚙ ' + eq.length));
  if (c.att) { const u = locate(c.att); bd.append(h('span', { class: 'badge equip' }, '⚙ ' + (u && cardOf(u.c) ? cardOf(u.c).name.split(',')[0] : 'attaché'))); }
  if (c.emp) bd.append(h('span', { class: 'badge emp' }, 'EMPOWERED'));
  if (data && data.supertype === 'Token') el.classList.add('token');
  if (c.rev) bd.append(h('span', { class: 'badge rev' }, 'RÉVÉLÉE'));
  // [Mighty]: a unit with 5+ Might on the board
  if (data && data.type === 'Unit' && (zone === 'base' || /^p[12]$/.test(zone)) && (data.might || 0) + (c.buff || 0) + (c.tb || 0) >= 5) bd.append(h('span', { class: 'badge mighty' }, 'MIGHTY'));
  if (c.st) { bd.append(h('span', { class: 'badge stun' }, 'ÉTOURDI')); el.classList.add('stun'); }
  return el;
}

function renderGame() {
  const v = S.v;
  const key = S.me + '|' + v.bfs.length + '|' + pname('p1') + pname('p2');
  // FLIP: first
  const first = new Map();
  for (const [iid, el] of els) if (el.isConnected) first.set(iid, el.getBoundingClientRect());
  if (key !== skeletonKey) { buildSkeleton(); skeletonKey = key; }

  const seen = new Set();
  const fill = (zkey, cards, opts = {}) => {
    const box = $(`[data-z="${zkey}"]`); if (!box) return;
    const zone = zkey.split(':')[1];
    const want = cards.map(c => { seen.add(c.iid); return syncCard(c, opts.back, opts.cls, zone); });
    if (opts.stack) want.reverse(); // index 0 = top of pile = last child
    // reorder children minimally
    want.forEach((el, i) => { if (box.children[i] !== el) box.insertBefore(el, box.children[i] || null); });
    while (box.children.length > want.length) box.lastChild.remove();
  };
  fill('chain', v.chain || []);
  for (const p of ['p1', 'p2']) {
    const z = v.players[p].zones;
    fill(p + ':hand', z.hand);
    fill(p + ':base', z.base); fill(p + ':runes', z.runes);
    fill(p + ':legend', z.legend); fill(p + ':champion', z.champion);
    for (const k of ['main', 'runeDeck']) fill(p + ':' + k, z[k], { back: true, stack: true });
    for (const k of ['trash', 'banish']) fill(p + ':' + k, z[k], { stack: true });
    for (const k of ['main', 'runeDeck', 'trash', 'banish']) { const cnt = $(`[data-pile="${p}:${k}"] .count`); if (cnt) cnt.textContent = z[k].length; }
    // rune pool: energy / power already produced by hand, spent first when a card is played
    const pool = v.players[p].pool || { e: 0, p: [] }, pl = $(`[data-pool="${p}"]`);
    if (pl) {
      pl.innerHTML = '';
      if (pool.e) pl.append(h('span', { class: 'pe', title: 'Énergie en réserve' }, `⚡ ${pool.e}`));
      for (const [dom, n] of Object.entries(pool.p.reduce((a, d) => ((a[d] = (a[d] || 0) + 1), a), {})))
        pl.append(h('span', { class: 'pp', style: `--dc:${DOM_COLORS[dom] || '#f5c84b'}`, title: `Puissance ${dom === 'any' ? 'de n’importe quel domaine' : dom}` }, `◆ ${n} ${dom === 'any' ? 'au choix' : dom}`));
    }
  }
  v.bfs.forEach((b, i) => {
    fill(`bfc${i}`, b.card ? [b.card] : []);
    for (const p of ['p1', 'p2']) fill(`bfh${i}:${p}`, (b.hidden || []).filter(c => c.owner === p), { cls: 'hiddencard' });
    $(`[data-bf="${i}"]`).classList.toggle('showdown', !!(v.showdown && v.showdown.bf === i));
    for (const p of ['p1', 'p2']) {
      fill(`bf${i}:${p}`, b.units[p]);
      const ms = $(`[data-ms="${i}:${p}"]`);
      if (ms) { const sum = b.units[p].reduce((a, c) => { const d = cardOf(c); return a + (d && d.might != null && !c.fd ? d.might + (c.buff || 0) : 0); }, 0); ms.textContent = b.units[p].length ? '⚔ ' + sum : ''; }
    }
    const bfel = $(`[data-bf="${i}"]`);
    bfel.classList.toggle('ctrl-me', b.ctrl === S.me); bfel.classList.toggle('ctrl-op', !!b.ctrl && b.ctrl !== S.me);
    const cr = $(`[data-crest="${i}"]`); cr.className = 'crest ' + (b.ctrl ? (b.ctrl === S.me ? 'me' : 'op') : '');
  });
  // removed cards
  for (const [iid, el] of els) if (!seen.has(iid)) { el.remove(); els.delete(iid); }

  // FLIP: last, invert, play
  let moved = 0;
  for (const [iid, el] of els) {
    const a = origin.get(iid) || first.get(iid);
    if (!a) continue;
    const b = el.getBoundingClientRect();
    const dx = a.left - b.left, dy = a.top - b.top, sx = a.width / b.width, sy = a.height / b.height;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(sx - 1) < .02) continue;
    el.getAnimations().forEach(x => x.cancel());
    el.style.zIndex = 30;
    const far = Math.hypot(dx, dy) > 60;
    if (far) moved++;
    // long moves get a small arc + scale-up for a "thrown card" feel
    const mid = far ? [{ offset: 0.5, transform: `translate(${dx / 2}px,${dy / 2 - 24}px) scale(${(sx + 1) / 2 * 1.08},${(sy + 1) / 2 * 1.08})` }] : [];
    const an = el.animate([{ transform: `translate(${dx}px,${dy}px) scale(${sx},${sy})` }, ...mid, { transform: 'none' }], { duration: far ? 560 : 380, easing: 'cubic-bezier(.22,1,.36,1)' });
    an.onfinish = an.oncancel = () => { el.style.zIndex = ''; };
  }
  if (moved && v.rev !== S.soundRev) { S.soundRev = v.rev; sfx.card(); }
  origin.clear();
  // soft light on the active player's side of the board
  const live = v.stage === 'main' && !v.winner;
  $('.half.me') && $('.half.me').classList.toggle('turn', live && v.active === S.me);
  $('.half.op') && $('.half.op').classList.toggle('turn', live && v.active !== S.me);
  renderHud(); renderStack(); renderLog(); renderPregame(); renderAim(); drawArrows(); setTimeout(drawArrows, 600);
  if (S.viewer) openViewer(S.viewer.p, S.viewer.z, true);

  // turn / score banners
  if (v.turn > 0 && S.lastActive !== v.active + v.turn) {
    if (S.lastActive != null) { banner(S.seat === 'solo' ? `Tour de ${pname(v.active)}` : v.active === S.me ? 'À vous de jouer' : `Tour de ${pname(v.active)}`); sfx.turn(); }
    S.lastActive = v.active + v.turn;
  }
  for (const p of ['p1', 'p2']) {
    const sc = v.players[p].score;
    if (S.lastScores[p] != null && sc > S.lastScores[p]) sfx.score();
    if (S.lastScores[p] != null && sc >= v.winScore && S.lastScores[p] < v.winScore) banner(v.ai && p === v.ai.seat ? `Défaite…` : `Victoire de ${pname(p)} !`);
    S.lastScores[p] = sc;
  }
}

/* ---------- pre-game overlay: battlefield pick -> parity + die -> mulligan ---------- */
const STAGE_LABEL = { bf: 'Choix des champs de bataille', dice: 'Qui commence ?', mulligan: 'Mulligan' };
const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
const FACE_ROT = { 1: 'rotateX(0deg) rotateY(0deg)', 6: 'rotateX(0deg) rotateY(180deg)', 3: 'rotateX(0deg) rotateY(-90deg)', 4: 'rotateX(0deg) rotateY(90deg)', 5: 'rotateX(-90deg) rotateY(0deg)', 2: 'rotateX(90deg) rotateY(0deg)' };
function dieEl() {
  return h('div', { class: 'die-wrap' }, h('div', { class: 'die' }, ['cx', 'cy', 'cz'].map(k => h('div', { class: 'core ' + k })), [1, 2, 3, 4, 5, 6].map(n =>
    h('div', { class: 'face f' + n }, PIPS[n].map(k => h('i', { style: `grid-area:${Math.floor(k / 3) + 1}/${k % 3 + 1}` }))))));
}
S.mull = new Set();
function renderPregame() {
  const v = S.v, P = $('#pregame');
  const rolling = S.diceAnim && Date.now() < S.diceAnim.until;
  // a new die result arrived: play the roll before moving on to the mulligan
  if (v.dice && v.dice.roll && v.stage !== 'main' && S.diceSeen !== S.room + v.dice.roll + v.dice.winner) {
    S.diceSeen = S.room + v.dice.roll + v.dice.winner;
    if (S.diceShownFor !== S.room) { S.diceShownFor = S.room; S.diceAnim = { until: Date.now() + 3600 }; setTimeout(() => S.v && renderPregame(), 3650); return renderDiceRoll(P, v); }
  }
  if (rolling) return;
  if (v.stage === 'main' && v.pending && v.pending.to === S.me) return renderPrompt(P, v);
  if (v.stage === 'main' || !v.stage) { P.classList.remove('show'); P.innerHTML = ''; P.dataset.key = ''; return; }
  const me = S.me, op = other(me), wait = t => h('div', { class: 'pg-wait' }, h('div', { class: 'spinner' }), t);
  const key = [v.stage, v.bfPick && v.bfPick[me], v.dice && v.dice.call, v.players[me].mullDone, v.players[me].mullNew, v.players[me].zones.hand.map(c => c.iid).join()].join('|');
  if (P.dataset.key === key && P.classList.contains('show')) return;
  P.dataset.key = key;
  let body;
  if (v.stage === 'bf') {
    const mine = v.bfPick[me];
    body = [h('div', { class: 'pg-step' }, 'Étape 1 sur 3'), h('h2', {}, 'Choisissez votre champ de bataille'),
      h('p', {}, mine ? `Votre choix est fait. ${pname(op)} choisit le sien…` : 'Parmi les champs de bataille de votre deck, choisissez celui qui sera en jeu.'),
      h('div', { class: 'pg-cards' }, v.bfOpts[me].map(cid => {
        const el = cardView(S.byId[cid], { cls: mine === cid ? 'picked' : '' });
        el.onmouseenter = () => showPreview(S.byId[cid]);
        if (!mine) el.onclick = () => send({ type: 'chooseBf', cid });
        return el;
      })),
      mine ? wait('En attente de l’adversaire…') : null];
  } else if (v.stage === 'dice') {
    const d = v.dice, caller = d.caller === me, otherCall = d.call && (d.call === 'pair' ? 'impair' : 'pair');
    const sub = !d.call
      ? (caller ? [h('p', {}, 'Choisissez pair ou impair : le dé est lancé aussitôt. Si le résultat correspond, vous commencez.'),
        h('div', { class: 'parity' }, h('button', { class: 'btn gold', onclick: () => send({ type: 'callParity', parity: 'pair' }) }, 'Pair'), h('button', { class: 'btn gold', onclick: () => send({ type: 'callParity', parity: 'impair' }) }, 'Impair'))]
        : [h('p', {}, `${pname(d.caller)} choisit pair ou impair…`), wait('En attente')])
      : (caller ? [h('p', {}, `Vous avez « ${d.call} », ${pname(op)} a « ${otherCall} ». Lancez le dé !`), h('button', { class: 'btn gold big', onclick: () => send({ type: 'rollDice' }) }, 'Lancer le dé')]
        : [h('p', {}, `${pname(d.caller)} a choisi « ${d.call} », vous avez « ${otherCall} ».`), wait(`${pname(d.caller)} lance le dé…`)]);
    const die = dieEl(); die.firstChild.classList.add('idle');
    body = [h('div', { class: 'pg-step' }, 'Étape 2 sur 3'), h('h2', {}, 'Qui commence ?'), die, ...sub];
  } else {
    const pl = v.players[me], done = pl.mullDone, hand = pl.zones.hand;
    for (const id of [...S.mull]) if (!hand.some(c => c.iid === id)) S.mull.delete(id);
    const n = S.mull.size;
    if (pl.mullNew) {
      body = [h('div', { class: 'pg-step' }, 'Étape 3 sur 3'), h('h2', {}, 'Votre main'),
        h('p', {}, `Les cartes repiochées sont en surbrillance. ${pname(v.first)} commence.`),
        h('div', { class: 'pg-cards' }, hand.map(c => { const d = cardOf(c), k = pl.mullNew.indexOf(c.iid), el = cardView(d, { cls: k >= 0 ? 'fresh' : '' }); if (k >= 0) el.style.setProperty('--d', (0.15 + k * 0.22) + 's'); el.onmouseenter = () => showPreview(d, c); return el; })),
        h('div', { class: 'pg-actions' }, h('button', { class: 'btn gold big', onclick: () => send({ type: 'mullConfirm' }) }, 'Commencer la partie'))];
    } else body = [h('div', { class: 'pg-step' }, 'Étape 3 sur 3'), h('h2', {}, 'Mulligan'),
      h('p', {}, done ? `${pname(op)} choisit sa main…` : `${pname(v.first)} commence. Cliquez jusqu’à 2 cartes à renvoyer sous votre deck : vous en repiochez autant.`),
      h('div', { class: 'pg-cards' }, hand.map(c => {
        const d = cardOf(c), el = cardView(d, { cls: S.mull.has(c.iid) ? 'toss' : '' });
        el.onmouseenter = () => showPreview(d, c);
        if (!done) el.onclick = () => {
          if (S.mull.has(c.iid)) S.mull.delete(c.iid); else if (S.mull.size < 2) S.mull.add(c.iid); else return toast('2 cartes maximum');
          el.classList.toggle('toss', S.mull.has(c.iid)); // update in place: no re-render, no blink
          const b = P.querySelector('.pg-actions .btn'), k = S.mull.size;
          if (b) b.textContent = k ? `Renvoyer ${k} carte${k > 1 ? 's' : ''}` : 'Garder ma main';
        };
        return el;
      })),
      done ? wait('En attente de l’adversaire…')
        : h('div', { class: 'pg-actions' }, h('button', { class: 'btn gold big', onclick: () => { send({ type: 'mulligan', iids: [...S.mull] }); S.mull.clear(); } }, n ? `Renvoyer ${n} carte${n > 1 ? 's' : ''}` : 'Garder ma main'))];
  }
  const still = P.dataset.stage === v.stage && P.classList.contains('show');
  P.dataset.stage = v.stage;
  P.innerHTML = '';
  P.append(h('div', { class: 'pg' + (still ? ' still' : '') }, body));
  P.classList.add('show');
}
// A card asks this player to choose: discard N cards from hand, or destroy one of their units.
S.pick = new Set();
function renderPrompt(P, v) {
  const q = v.pending, me = S.me, fx = q.fx || {};
  // what can be chosen, and how many: discard (hand), sacrifice / buff (own units), target (listed by the engine),
  // bf (battlefields), predict (top cards of your deck, any number to recycle)
  const myUnits = [...v.players[me].zones.base, ...v.bfs.flatMap(b => b.units[me])].filter(c => (cardOf(c) || {}).type === 'Unit');
  const pool = q.kind === 'discard' ? v.players[me].zones.hand
    : q.kind === 'target' ? q.opts.map(id => locate(id)).filter(Boolean).map(L => L.c)
    : q.kind === 'bf' ? q.opts.map(i => v.bfs[i].card).filter(Boolean)
    : q.kind === 'predict' ? q.cards.map(id => v.players[me].zones.main.find(c => c.iid === id)).filter(Boolean)
    : myUnits.filter(c => c.iid !== q.exclude);
  const multi = q.kind === 'predict', max = multi ? pool.length : q.n;
  const mark = q.kind === 'discard' || q.kind === 'sacrifice' ? 'toss' : 'chosen';
  for (const id of [...S.pick]) if (!pool.some(c => c.iid === id)) S.pick.delete(id);
  const key = 'prompt|' + q.kind + q.card + pool.map(c => c.iid).join();
  if (P.dataset.key === key && P.classList.contains('show')) return;
  P.dataset.key = key;
  const who = q.by === me ? 'Votre carte' : pname(q.by);
  const OP = { dmg: `Infligez ${fx.n} dégât${fx.n > 1 ? 's' : ''}`, kill: fx.gear ? 'Détruisez un équipement' : 'Détruisez une unité', stun: 'Étourdissez une unité', might: `${fx.n > 0 ? '+' : ''}${fx.n} force ce tour`, ready: 'Redressez une unité', hand: 'Renvoyez une unité en main', recall: 'Rappelez une unité', attach: 'Attachez l’équipement',
    assault: `Donnez [Assault ${fx.n === 'might' ? '= force' : fx.n}] ce tour`, shield: `Donnez [Shield ${fx.n}]${fx.tank ? ' et [Tank]' : ''} ce tour`, double: 'Doublez la force d’une unité', mark: 'Choisissez votre unité',
    duel: 'Choisissez l’unité adverse (dégâts = force)', blink: 'Choisissez l’unité à bannir et rejouer', moveTo: 'Choisissez l’unité à déplacer', deck: 'Placez une unité sous le deck', dmgSplash: `Infligez ${fx.n} (et ${fx.splash} aux autres ennemis là-bas)` };
  const title = { discard: `Défaussez ${q.n} carte${q.n > 1 ? 's' : ''}`, sacrifice: 'Détruisez une de vos unités', buff: 'Buffez une unité', target: OP[fx.op] || 'Choisissez une cible', bf: fx.kind === 'target' ? 'Choisissez le champ de bataille' : fx.kind === 'bfBuff' ? 'Choisissez un champ de bataille' : `${fx.n} dégâts aux ennemis d’un champ de bataille`, predict: 'Prédiction' }[q.kind];
  const help = { discard: 'Cliquez sur les cartes de votre main à défausser.', sacrifice: 'Cliquez sur l’unité à détruire.', buff: 'Cliquez sur l’unité alliée qui reçoit le buff (+1 force si elle n’en a pas déjà un).', target: 'Cliquez sur la cible. Les unités ennemies sont marquées en rouge.', bf: 'Cliquez sur le champ de bataille visé.', predict: 'Le dessus de votre deck. Cliquez sur les cartes à recycler sous le deck, les autres restent dessus.' }[q.kind];
  const btnLabel = () => (multi ? (S.pick.size ? `Recycler ${S.pick.size} carte${S.pick.size > 1 ? 's' : ''}` : 'Tout garder') : 'Valider');
  P.innerHTML = '';
  P.append(h('div', { class: 'pg' },
    h('div', { class: 'pg-step' }, `${who} · ${q.card}`),
    h('h2', {}, title), h('p', {}, help),
    h('div', { class: 'pg-cards' }, pool.map((c, idx) => {
      const d = cardOf(c), el = cardView(d, { cls: S.pick.has(c.iid) ? mark : '' });
      el.onmouseenter = () => showPreview(d, c);
      el.dataset.iid = c.iid;
      if (q.kind === 'target') { const L = locate(c.iid); el.classList.add(L && (L.p || L.side) === me ? 'ally' : 'enemy'); }
      el.onclick = () => {
        if (S.pick.has(c.iid)) S.pick.delete(c.iid); else { if (S.pick.size >= max) S.pick.delete([...S.pick][0]); S.pick.add(c.iid); }
        P.querySelectorAll('.pg-cards .card').forEach(x => x.classList.toggle(mark, S.pick.has(x.dataset.iid)));
        const b = P.querySelector('.pg-actions .btn'); if (b) { b.disabled = !multi && S.pick.size !== q.n; b.textContent = btnLabel(); }
      };
      el.dataset.bfi = q.kind === 'bf' ? q.opts[idx] : '';
      return el;
    })),
    h('div', { class: 'pg-actions' }, h('button', { class: 'btn gold big', disabled: !multi && S.pick.size !== q.n, onclick: () => {
      const ids = [...S.pick]; S.pick.clear();
      if (q.kind === 'bf') { const el = P.querySelector(`.pg-cards .card[data-iid="${ids[0]}"]`); return send({ type: 'resolve', bf: +el.dataset.bfi }); }
      send({ type: 'resolve', iids: ids });
    } }, btnLabel()), q.opt ? h('button', { class: 'btn big', onclick: () => { S.pick.clear(); send({ type: 'resolve', iids: [] }); } }, 'Aucune cible') : '')));
  P.classList.add('show');
}

function renderDiceRoll(P, v) {
  const d = v.dice, die = dieEl(), cube = die.firstChild;
  const winTxt = d.winner === S.me ? 'Vous commencez !' : `${pname(d.winner)} commence !`;
  const res = h('div', { class: 'pg-res', style: 'visibility:hidden' }, `${d.roll} · ${d.roll % 2 ? 'impair' : 'pair'}`, h('small', {}, winTxt));
  P.innerHTML = '';
  P.dataset.key = '';
  P.append(h('div', { class: 'pg' }, h('div', { class: 'pg-step' }, 'Étape 2 sur 3'), h('h2', {}, `${pname(d.caller)} lance le dé`), die, res));
  P.classList.add('show');
  const spins = `rotateX(${720 + 360 * Math.floor(Math.random() * 2)}deg) rotateY(${1080}deg)`;
  const final = FACE_ROT[d.roll];
  cube.animate([
    { transform: 'translateY(-50px) rotateX(0deg) rotateY(0deg) scale(.6)' },
    { transform: `translateY(10px) ${spins} scale(1.1)`, offset: 0.55 },
    { transform: `translateY(-14px) ${final} scale(1)`, offset: 0.8 },
    { transform: `translateY(0) ${final} scale(1)` },
  ], { duration: 1700, easing: 'cubic-bezier(.2,.7,.3,1)', fill: 'forwards' });
  sfx.click();
  setTimeout(() => { res.style.visibility = 'visible'; sfx.turn(); }, 1750);
}

function banner(txt) { const b = $('#banner'); b.textContent = txt; b.classList.remove('show'); void b.offsetWidth; b.classList.add('show'); }
function flashBf(i) { const b = $(`[data-bf="${i}"]`); if (!b) return; const f = h('div', { class: 'flash' }); b.append(f); setTimeout(() => f.remove(), 1000); }

let lastLogLen = 0;
function renderLog() {
  const L = $('#log'), log = S.v.log;
  const atBottom = L.scrollHeight - L.scrollTop - L.clientHeight < 40;
  L.innerHTML = '';
  for (const e of log) {
    const cls = e.msg.startsWith('—') || e.msg.startsWith('Fin du') ? 'turn' : e.msg.startsWith('💬') ? 'chat' : e.msg.startsWith('🏆') || e.msg.startsWith('⚔') ? 'big' : '';
    L.append(h('div', { class: cls }, e.msg));
  }
  if (atBottom || log.length !== lastLogLen) L.scrollTop = L.scrollHeight;
  lastLogLen = log.length;
}

function scoreWidget(p) {
  const v = S.v, sc = v.players[p].score, mine = p === S.me;
  const val = h('span', { class: 'val' }, sc);
  if (S.lastScores[p] != null && S.lastScores[p] !== sc) val.classList.add('bump');
  return h('div', { class: 'score ' + (mine ? 'me' : 'op') },
    v.active === p && v.turn > 0 ? h('span', { class: 'active-dot', title: 'Joueur actif' }) : null,
    h('span', { class: 'nm', title: v.players[p].deckName }, pname(p)),
    h('button', { onclick: () => send({ type: 'score', p, delta: -1 }) }, '−'), val,
    h('button', { onclick: () => send({ type: 'score', p, delta: 1 }) }, '+'),
    h('div', { class: 'pips' }, Array.from({ length: v.winScore }, (_, i) => h('i', { class: 'pip' + (i < sc ? ' on' : '') }))),
    h('span', { class: 'xp', title: 'Expérience (XP) — clic : +1, clic droit : −1', onclick: () => send({ type: 'xp', p, delta: 1 }), oncontextmenu: e => { e.preventDefault(); send({ type: 'xp', p, delta: -1 }); } }, `XP ${v.players[p].xp || 0}`));
}

function renderHud() {
  const v = S.v, H = $('#hud'); H.innerHTML = '';
  const kb = k => h('span', { class: 'kbd' }, k);
  const B = (label, fn, k, cls = '', title) => h('button', { class: 'btn sm ' + cls, onclick: fn, title: title || '' }, label, k ? kb(k) : null);
  const aiTurn = v.ai && v.active === v.ai.seat && v.turn > 0 && !v.winner;
  H.classList.toggle('locked', !!aiTurn);
  const pre = v.stage !== 'main';
  const waitOther = v.pending && v.pending.to !== S.me;
  H.append(
    h('div', { class: 'turninfo' }, pre ? 'Avant-partie' : `Tour ${v.turn}`, h('small', {}, pre ? STAGE_LABEL[v.stage] : waitOther ? h('span', { class: 'thinking' }, `${pname(v.pending.to)} choisit (${v.pending.card})`, h('i'), h('i'), h('i')) : aiTurn ? h('span', { class: 'thinking' }, `${pname(v.active)} réfléchit`, h('i'), h('i'), h('i')) : `${pname(v.active)} joue`)),
    scoreWidget(S.me), scoreWidget(other(S.me)), h('div', { class: 'sep' }),
    ...(pre ? [] : [
      B('Jeton', e => tokenMenu(e), 'J', '', 'Créer des jetons dans votre base (clic droit sur un champ de bataille pour les y créer)'),
      h('div', { class: 'sep' }),
      B('🎲', () => send({ type: 'roll', sides: 6 }), '', '', 'Lancer un dé')]),
    h('div', { class: 'grow' }),
    pre ? '' : undoBtn(),
    autoBtn(),
    muteBtn(),
    v.mode === 'ai' ? '' : h('span', { class: 'roomtag', title: 'Tag de la partie' }, `Tag ${v.room}`),
    B(v.winner ? 'Quitter' : 'Abandonner', () => { if (v.winner || confirm('Quitter la partie ? Elle se termine pour les deux joueurs.')) send({ type: 'quit' }); }, '', 'danger'));
}

function endTurn() { send({ type: 'endTurn' }); }
// "Mode auto": off = you do everything by hand; on = draw, ready, channel, points, combat, payments and card effects are automatic
// rollback: back to before my last action (what the AI played since is undone too)
function undoBtn() {
  const ok = !!S.v.canUndo;
  return h('button', { class: 'undobtn', disabled: !ok, title: 'Annuler ma dernière action (Ctrl+Z). Ce que l’adversaire a joué depuis est annulé aussi.', onclick: undo },
    h('span', { class: 'ic' }, '↶'), h('span', { class: 'lbl' }, 'Annuler'));
}
function undo() { send({ type: 'undo', mine: true }); }
function autoBtn() {
  const on = !!(S.v.auto || {})[S.me];
  return h('button', { class: 'autosw' + (on ? ' on' : ''), title: on ? 'Mode auto activé : pioche, redressement, canalisation, points, combats, paiements et effets des cartes sont automatiques. Cliquez pour tout faire à la main.' : 'Mode manuel : vous faites tout à la main. Cliquez pour tout automatiser.',
    onclick: () => { store.set('auto', !on); S.autoSync = S.room + !on; send({ type: 'setAuto', on: !on }); } },
    h('span', { class: 'sw' }, h('i')), h('span', { class: 'md' }, 'Mode '), 'auto');
}
// bottom docks: draw / channel on the left, ready all / end turn on the right
function renderDocks() {
  const v = S.v, L = $('#dock-l'), Rr = $('#dock-r');
  L.innerHTML = ''; Rr.innerHTML = '';
  if (v.stage !== 'main') return;
  const kb = k => h('span', { class: 'kbd' }, k);
  const B = (label, fn, k, cls = '', title) => h('button', { class: 'btn ' + cls, onclick: fn, title: title || '' }, label, k ? kb(k) : null);
  const aiTurn = v.ai && v.active === v.ai.seat && !v.winner;
  L.classList.toggle('locked', !!aiTurn); Rr.classList.toggle('locked', !!aiTurn);
  L.append(B('Piocher', () => send({ type: 'draw', n: 1 }), 'D'), B('Canaliser', () => send({ type: 'channel', n: 1 }), 'C'));
  Rr.append(B('Redresser tout', () => send({ type: 'readyAll' }), 'R'),
    B('Fin de tour', endTurn, 'N', 'gold', 'Passe la main. Le tour suivant démarre seul : unités et runes redressées, points de tenue, 2 runes canalisées, 1 carte piochée.'));
}
// The stack (spells waiting to resolve) and the showdown in progress, with the buttons to answer them.
function renderStack() {
  renderDocks();
  const v = S.v, P = $('#stack'), top = v.chain && v.chain[v.chain.length - 1], sd = v.showdown;
  const info = P.querySelector('.st-info') || h('div', { class: 'st-info' });
  info.innerHTML = '';
  const vsAI = !!v.ai, me = S.me;
  const think = t => h('span', { class: 'thinking' }, t, h('i'), h('i'), h('i'));
  const bfName = i => { const b = v.bfs[i] && v.bfs[i].card; const d = b && cardOf(b); return d ? d.name : 'champ de bataille'; };
  if (top) {
    const mine = top.cb.by === me, d = cardOf(top);
    info.append(h('b', {}, `Pile : ${d ? d.name : 'carte'}`), h('span', {}, mine ? ' (la vôtre)' : ` (${pname(top.cb.by)})`));
    if (mine && vsAI && !top.cb.seen) info.append(think(`${pname(other(me))} réfléchit à une réponse`));
    else if (mine) info.append(h('small', {}, top.cb.fx ? 'Son effet s’applique à la résolution.' : 'Effet non géré : appliquez-le à la main, puis :'),
      h('button', { class: 'btn gold', onclick: () => send({ type: 'chainResolve' }) }, 'Résoudre'),
      top.cb.fx ? h('button', { class: 'btn sm', title: 'Retire le sort de la pile sans appliquer son effet (à faire à la main)', onclick: () => send({ type: 'chainResolve', apply: false }) }, 'Sans effet') : '');
    else info.append(h('small', {}, 'Répondez avec une [Reaction] (glissez-la sur le plateau), ou :'), h('button', { class: 'btn gold', onclick: () => send({ type: 'chainPass' }) }, 'Laisser résoudre'));
  } else if (sd) {
    info.append(h('b', {}, `⚔ Affrontement · ${bfName(sd.bf)}`), h('span', {}, ` (${pname(sd.att)} attaque)`));
    if (sd.focus === me) info.append(h('small', {}, sd.fresh && sd.att === me ? 'Ajoutez des attaquants, jouez une [Action]/[Reaction], ou :' : 'À vous : jouez une [Action]/[Reaction], ou :'), h('button', { class: 'btn gold', onclick: () => send({ type: 'pass' }) }, sd.passes ? 'Passer (combat)' : 'Passer'));
    else info.append(think(`${pname(sd.focus)} a la main`));
  }
  if (!info.isConnected) P.append(info);
  P.classList.toggle('show', !!(top || sd));
}
/* ---------- targets: chosen when a spell is cast, shown as arrows from the stack ---------- */
const HIDDEN_RE = /\[Hidden\]|(^|\n)Hidden \(/;
// how many units / gear the text designates ("a unit", "an enemy unit", "two friendly units"...)
function targetCount(d) {
  if (!d || d.type !== 'Spell') return 0;
  if (d.nt) return d.nt;
  const t = (d.text || '').replace(/\([^)]*\)/g, ' ');
  const N = { a: 1, an: 1, another: 1, one: 1, two: 2, three: 3 };
  let n = 0;
  for (const m of t.matchAll(/\b(?:up to )?(a|an|another|one|two|three)\s+(?:(?:friendly|enemy|exhausted|ready|stunned|damaged|attacking|defending|other|token)\s+)*(?:units?|gear)\b/gi)) n += N[m[1].toLowerCase()];
  return Math.min(n, 3);
}
const aimable = L => L && L.bfCard == null && (L.zone === 'base' || L.bf != null) && ['Unit', 'Gear'].includes((cardOf(L.c) || {}).type);
function playCard(iid, extra = {}) {
  const n = targetCount(cardOf((locate(iid) || {}).c));
  if (!n) return send({ type: 'play', iid, ...extra });
  S.cast = { iid, extra, n, picks: [] };
  hideMenu(); renderAim(); drawArrows();
}
function aimToggle(id) {
  const c = S.cast, i = c.picks.indexOf(id);
  if (i >= 0) c.picks.splice(i, 1); else { if (c.picks.length >= c.n) c.picks.shift(); c.picks.push(id); }
  renderAim(); drawArrows();
}
function aimEnd(go) {
  const c = S.cast; S.cast = null;
  renderAim(); drawArrows();
  if (go && c) send({ type: c.kind || 'play', iid: c.iid, targets: c.picks, ...c.extra });
}
// card text symbols for menus: ':rb_energy_2:' -> '2 ⚡', ':rb_rune_fury:' -> '◆ Fury', ':rb_might:' -> 'force'
const rbText = s => s.replace(/:rb_energy_(\d+):/g, '$1 ⚡').replace(/:rb_rune_rainbow:/g, '◆ au choix').replace(/:rb_rune_(\w+):/g, (m, d) => '◆ ' + d[0].toUpperCase() + d.slice(1)).replace(/:rb_might:/g, 'force').replace(/:rb_exhaust:/g, '↷');
function activate(iid, k) {
  const ab = ((cardOf((locate(iid) || {}).c) || {}).ab || [])[k];
  if (!ab || !ab.nt) return send({ type: 'activate', iid, k });
  S.cast = { iid, extra: { k }, n: ab.nt, picks: [], kind: 'activate', label: rbText(ab.text) };
  hideMenu(); renderAim(); drawArrows();
}
function renderAim() {
  let bar = $('#aimbar');
  if (S.cast && (!S.v || !locate(S.cast.iid))) S.cast = null;
  $$('.card.aimable, .card.aimed').forEach(x => x.classList.remove('aimable', 'aimed'));
  if (!S.cast) { if (bar) bar.remove(); return; }
  if (!bar) { bar = h('div', { id: 'aimbar' }); document.body.append(bar); }
  const c = S.cast, d = cardOf(locate(c.iid).c);
  for (const [iid, el] of els) { const L = locate(iid); if (aimable(L)) el.classList.add(c.picks.includes(iid) ? 'aimed' : 'aimable'); }
  bar.innerHTML = '';
  bar.append(h('b', {}, `${c.kind === 'activate' ? '⚡' : '🎯'} ${d ? d.name : 'Sort'}`), c.label ? h('i', {}, c.label) : '',
    h('span', {}, `Cliquez sur ${c.n > 1 ? `jusqu’à ${c.n} cibles` : 'la cible'} sur le plateau (${c.picks.length}/${c.n}).`),
    h('button', { class: 'btn gold', onclick: () => aimEnd(true) }, c.kind === 'activate' ? 'Activer' : c.picks.length ? 'Lancer' : 'Lancer sans cible'),
    h('button', { class: 'btn', onclick: () => aimEnd(false) }, 'Annuler'));
}
// SVG overlay: one curved arrow per declared target, from the spell on the stack (or the card being cast)
function drawArrows() {
  let svg = $('#arrows');
  if (!svg) {
    svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.id = 'arrows';
    svg.innerHTML = '<defs>' + ['me', 'op'].map(k => `<marker id="ah-${k}" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="var(--${k})"/></marker>`).join('') + '</defs><g></g>';
    document.body.append(svg);
  }
  const g = svg.querySelector('g'); g.innerHTML = '';
  $$('.card.targeted').forEach(x => x.classList.remove('targeted'));
  if (!S.v || S.screen !== 'game') return;
  const links = (S.v.chain || []).flatMap(c => (c.cb && c.cb.targets || []).map(t => [c.iid, t, c.cb.by]));
  if (S.cast) for (const t of S.cast.picks) links.push([S.cast.iid, t, S.me]);
  for (const [from, to, by] of links) {
    const a = els.get(from), b = els.get(to);
    if (!a || !b || !a.isConnected || !b.isConnected) continue;
    b.classList.add('targeted');
    const r1 = a.getBoundingClientRect(), r2 = b.getBoundingClientRect();
    const x1 = r1.left + r1.width / 2, y1 = r1.top + r1.height / 2, x2 = r2.left + r2.width / 2, y2 = r2.top + r2.height / 2;
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2 - Math.min(160, Math.hypot(x2 - x1, y2 - y1) * 0.3);
    const k = by === S.me ? 'me' : 'op';
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', `M${x1} ${y1} Q${mx} ${my} ${x2} ${y2}`);
    p.setAttribute('class', 'arrow ' + k); p.setAttribute('marker-end', `url(#ah-${k})`);
    g.append(p);
  }
}
window.addEventListener('resize', () => drawArrows());
function swapSide() { if (S.seat !== 'solo') return; S.me = other(S.me); renderGame(); }

/* ---------- preview ---------- */
function showPreview(c, inst, zone) {
  const P = $('#preview'); if (!P || !P.isConnected) return;
  P.innerHTML = '';
  if (!c) { P.append(cardView(null, { back: true, cls: backKind(null, zone) })); return; }
  P.append(cardView(c));
  const bits = [c.domain.join(' / '), c.energy != null ? `Coût ${c.energy}` : '', c.power != null ? `Puissance ${c.power}` : '', c.might != null ? `Force ${c.might}${inst && inst.buff ? ` (${c.might + inst.buff})` : ''}` : '', c.tags.join(', ')].filter(Boolean);
  P.append(h('div', { class: 'pinfo' }, bits.join(' · ')));
}

/* ---------- viewer (trash, banish, decks) ---------- */
const ZNAME = { main: 'Deck', runeDeck: 'Deck de runes', trash: 'Défausse', banish: 'Bannis', hand: 'Main' };
function openViewer(p, z, refresh) {
  if (refresh && !$('#modal').classList.contains('show')) { S.viewer = null; return; }
  S.viewer = { p, z };
  const list = S.v.players[p].zones[z];
  const grid = h('div', { class: 'zone-grid' });
  for (const c of list) {
    const d = cardOf(c);
    const el = cardView(d, { back: !d });
    el.dataset.iid = c.iid; el.dataset.viewer = '1';
    el.addEventListener('mouseenter', () => { S.hover = c.iid; showPreview(d, c); });
    grid.append(el);
  }
  const box = h('div', { class: 'box' },
    h('h3', {}, `${ZNAME[z]} · ${pname(p)} (${list.length})`),
    h('div', { style: 'color:var(--mut);font-size:13px;margin-bottom:10px' }, z === 'main' || z === 'runeDeck' ? 'Ordre : du dessus vers le dessous. Glissez une carte vers le plateau ou clic droit pour la déplacer.' : 'Glissez une carte vers le plateau ou clic droit pour la déplacer.'),
    list.length ? grid : h('div', { class: 'empty-hint', style: 'margin:30px' }, 'Vide'),
    h('div', { class: 'row' },
      (z === 'main' || z === 'runeDeck') ? h('button', { class: 'btn', onclick: () => { send({ type: 'shuffle', zone: z, p }); closeModal(); } }, 'Mélanger et fermer') : null,
      h('button', { class: 'btn gold', onclick: closeModal }, 'Fermer')));
  openModal(box, true);
}

/* ---------- context menus ---------- */
// items: [label, fn, key] | '-' | { sub: label, items: [...] }
function menuItems(box, items) {
  for (const it of items) {
    if (!it) continue;
    if (it === '-') { box.append(h('hr')); continue; }
    if (it.row) { // label + quick quantity buttons
      box.append(h('div', { class: 'qrow' }, h('span', { class: 'ql' }, it.row, h('small', {}, it.info)),
        it.btns.map(([n, fn]) => h('button', { class: 'qn', title: `Créer ${n}`, onclick: () => { hideMenu(); fn(); } }, '×' + n))));
      continue;
    }
    if (it.sub) {
      const sub = h('div', { class: 'sub' });
      menuItems(sub, it.items);
      const wrap = h('div', { class: 'has-sub' }, h('button', { onclick: () => openSub(wrap) }, h('span', {}, it.sub)), sub);
      // hover intent: a submenu opens on hover and stays open while the pointer travels to it, even diagonally
      // or outside the menus; it only closes once the pointer rests on another item of the parent menu.
      wrap.addEventListener('pointerenter', () => {
        const busy = [...box.children].some(s => s !== wrap && s.classList.contains('open'));
        clearTimeout(wrap._o); if (busy) wrap._o = setTimeout(() => openSub(wrap), 260); else openSub(wrap);
      });
      wrap.addEventListener('pointerleave', () => clearTimeout(wrap._o));
      box.append(wrap);
      continue;
    }
    box.append(h('button', { onclick: () => { hideMenu(); it[1](); } }, h('span', {}, it[0]), it[2] ? h('kbd', {}, it[2]) : null));
  }
  // resting on a plain item closes the open sibling submenu after a short delay (crossing it on the way does not)
  for (const el of box.children) if (el.matches('button, .qrow')) {
    el.addEventListener('pointerenter', () => { for (const s of box.children) if (s.classList.contains('open')) { clearTimeout(s._t); s._t = setTimeout(() => s.classList.remove('open'), 300); } });
  }
}
function openSub(wrap) {
  clearTimeout(wrap._t);
  for (const s of wrap.parentElement.children) if (s !== wrap && s.classList.contains('open')) { clearTimeout(s._t); s.classList.remove('open'); }
  wrap.classList.add('open');
}
function menu(e, title, items) {
  const M = $('#ctx'); M.innerHTML = '';
  if (title) M.append(h('div', { class: 'ttl' }, title));
  menuItems(M, items);
  M.classList.add('show');
  const r = M.getBoundingClientRect();
  // below mid-screen the menu opens upward so its bottom never hides behind the OS taskbar
  const up = e.clientY > innerHeight * 0.5;
  M.style.left = Math.max(8, Math.min(e.clientX, innerWidth - r.width - 8)) + 'px';
  M.style.top = Math.max(8, up ? e.clientY - r.height : e.clientY) + 'px';
  M.classList.toggle('flip-x', e.clientX + r.width + 220 > innerWidth);
  M.classList.toggle('flip-y', up);
}
function hideMenu() { $('#ctx').classList.remove('show'); }
document.addEventListener('pointerdown', e => { if (!e.target.closest('#ctx')) hideMenu(); });

const mv = (iid, to, extra) => send({ type: 'move', iid, to, ...extra });
// "[Equip] :rb_rune_order:" -> "◆ Order"; "[Repeat] :rb_energy_1::rb_rune_mind:" -> "1 ⚡ + ◆ Mind"
function costLabel(text, k) {
  const m = new RegExp(String.raw`\[${k}\]\s*(?:—\s*)?((?::rb_(?:energy_\d+|rune_\w+):)+)`).exec(text || '');
  if (!m) return '?';
  return [...m[1].matchAll(/:rb_(?:energy_(\d+)|rune_(\w+)):/g)].map(x => (x[1] ? `${x[1]} ⚡` : `◆ ${x[2] === 'rainbow' ? 'au choix' : x[2][0].toUpperCase() + x[2].slice(1)}`)).join(' + ');
}
const enemyUnits = p => [...S.v.players[other(p)].zones.base, ...S.v.bfs.flatMap(b => b.units[other(p)])].filter(u => (cardOf(u) || {}).type === 'Unit');
const mightOf = u => { const d = cardOf(u) || {}; return (d.might || 0) + (u.buff || 0) + (u.tb || 0) + eqOn(u).reduce((t, g) => t + ((cardOf(g) || {}).might || 0), 0); };
function cardMenu(e, iid) {
  const L = locate(iid); if (!L) return;
  const c = L.c, d = cardOf(c), o = c.owner || L.p;
  if (L.bfCard != null) {
    const i = L.bfCard;
    return menu(e, d ? d.name : 'Champ de bataille', [
      ['Je contrôle', () => send({ type: 'control', bf: i, p: S.me })],
      ['L’adversaire contrôle', () => send({ type: 'control', bf: i, p: other(S.me) })],
      ['Conquérir (+1 point)', () => { send({ type: 'conquer', bf: i }); flashBf(i); }],
    ]);
  }
  const isRune = d && d.type === 'Rune';
  const bfName = i => { const b = S.v.bfs[i].card; const bd = b && cardOf(b); return bd ? bd.name : 'Champ ' + (i + 1); };
  const inHand = L.zone === 'hand' || L.zone === 'champion', onBoard = !inHand && L.zone !== 'hidden' && L.zone !== 'trash' && L.zone !== 'banish';
  const txt = (d && d.text) || '', mine = (L.p || L.side || o) === S.me;
  const myUnits = [...S.v.players[S.me].zones.base, ...S.v.bfs.flatMap(b => b.units[S.me])].filter(u => (cardOf(u) || {}).type === 'Unit');
  const myBfs = S.v.bfs.map((b, i) => i).filter(i => S.v.bfs[i].ctrl === S.me || (S.v.bfs[i].units[S.me].length && !S.v.bfs[i].units[other(S.me)].length));
  menu(e, d ? d.name : 'Carte cachée', [
    L.zone === 'hidden' && mine ? ['✦ Jouer la carte cachée (gratuit)', () => playCard(iid)] : null,
    inHand && HIDDEN_RE.test(txt) ? { sub: 'Cacher (payez 1 puissance)', items: myBfs.length ? myBfs.map(i => [bfName(i), () => send({ type: 'hide', iid, bf: i })]) : [['Ayez d’abord une unité sur un champ de bataille', () => {}]] } : null,
    inHand && /\[Repeat\]/.test(txt) ? [`✦ Jouer avec Repeat (payez ${costLabel(txt, 'Repeat')} en plus)`, () => send({ type: 'play', iid, repeat: true })] : null,
    L.zone === 'trash' && mine && /\[Flow\]/.test(txt) ? [`✦ Jouer depuis la défausse (Flow : ${costLabel(txt, 'Flow')})`, () => { closeModal(); send({ type: 'play', iid, flow: true }); }] : null,
    onBoard && mine && d && d.type === 'Gear' && /\[Equip\]/.test(txt) ? (c.att ? ['Détacher l’équipement', () => send({ type: 'unequip', iid })]
      : { sub: `Équiper (${costLabel(txt, 'Equip')})`, items: myUnits.length ? myUnits.map(u => [(cardOf(u) || {}).name || 'unité', () => send({ type: 'equip', iid, unit: u.iid })]) : [['Aucune unité', () => {}]] }) : null,
    ...(onBoard && mine && d && d.ab ? d.ab.map((ab, k) => [`⚡ ${rbText(ab.text)}${ab.e || ab.p || ab.kill || ab.xp ? ` (${[ab.e ? ab.e + ' ⚡' : '', ab.p ? ab.p + ' ◆' : '', ab.xp ? ab.xp + ' XP' : '', ab.kill ? 'détruire cette carte' : ''].filter(Boolean).join(' + ')})` : ''}${c.ex ? ' — épuisé' : ''}`, () => activate(iid, k)]) : []),
    onBoard && mine && /\[Empower\]/.test(txt) ? [c.emp ? 'Retirer Empowered' : `Empower (${costLabel(txt, 'Empower')})`, () => send({ type: 'empower', iid })] : null,
    onBoard && mine && d && d.name === 'Gold' && d.supertype === 'Token' ? ['Utiliser le Gold (+1 puissance au choix)', () => send({ type: 'gold', iid })] : null,
    inHand && mine && d && ['Unit', 'Spell', 'Gear'].includes(d.type) ? [d.type === 'Spell' ? '✦ Lancer (sur la pile)' : '✦ Jouer', () => playCard(iid), 'P'] : null,
    ...(inHand && mine && d && d.type === 'Unit' ? S.v.bfs.map((b, i) => i).filter(i => {
      const b = S.v.bfs[i];
      return b.ctrl === S.me || (/\[Ambush\]|can be played to a battlefield/i.test(txt) && b.units[S.me].length) || (/where there are enemy units/i.test(txt) && b.units[other(S.me)].length);
    }).map(i => [`✦ Jouer sur ${bfName(i)}`, () => send({ type: 'play', iid, to: { bf: i } })]) : []),
    L.zone === 'chain' ? ['Contrer (vers la défausse)', () => mv(iid, { p: o, zone: 'trash', pos: 'top' })] : null,
    onBoard ? [c.ex ? 'Redresser' : 'Épuiser', () => send({ type: 'exhaust', iid }), 'Espace'] : null,
    L.zone === 'runes' ? ['Recycler la rune', () => send({ type: 'recycle', iid })] : null,
    onBoard && mine && d && d.type === 'Unit' ? { sub: 'Duel avec… (dégâts = force)', items: enemyUnits(o).map(u => [`${(cardOf(u) || {}).name || 'unité'} (${mightOf(u)})`, () => send({ type: 'duel', iid, target: u.iid })]).concat(enemyUnits(o).length ? [] : [['Aucune unité ennemie', () => {}]]) } : null,
    onBoard && !isRune ? { sub: 'Marqueurs', items: [
      ['Dégât +1', () => send({ type: 'counter', iid, key: 'dmg', delta: 1 }), '+'],
      ['Dégât −1', () => send({ type: 'counter', iid, key: 'dmg', delta: -1 }), '−'],
      ['Buff (+1 si aucun buff)', () => send({ type: 'buff', iid })],
      ['Force +1', () => send({ type: 'counter', iid, key: 'buff', delta: 1 }), ']'],
      ['Force −1', () => send({ type: 'counter', iid, key: 'buff', delta: -1 }), '['],
      ['Force +1 ce tour', () => send({ type: 'tbuff', iid, n: 1 })],
      [c.st ? 'Retirer l’étourdissement' : 'Étourdir', () => send({ type: 'stun', iid })]] } : null,
    { sub: 'Déplacer vers', items: [
      L.zone !== 'hand' ? ['Main', () => mv(iid, { p: o, zone: 'hand' }), 'H'] : null,
      L.zone !== 'base' && !isRune ? ['Base', () => mv(iid, { p: o, zone: 'base' }), 'B'] : null,
      ...(isRune ? [] : S.v.bfs.map((b, i) => (L.bf === i ? null : [bfName(i), () => mv(iid, { bf: i, side: o }), String(i + 1)]))),
      isRune && L.zone !== 'runes' ? ['Réserve de runes', () => mv(iid, { p: o, zone: 'runes' })] : null,
      '-',
      ['Défausse', () => mv(iid, { p: o, zone: 'trash', pos: 'top' }), 'Suppr'],
      ['Bannir', () => mv(iid, { p: o, zone: 'banish', pos: 'top' })],
      isRune ? ['Dessous du deck de runes', () => mv(iid, { p: o, zone: 'runeDeck', pos: 'bottom' })] : ['Dessus du deck', () => mv(iid, { p: o, zone: 'main', pos: 'top' })],
      !isRune ? ['Dessous du deck', () => mv(iid, { p: o, zone: 'main', pos: 'bottom' })] : null] },
    '-',
    ['Retourner face cachée / visible', () => send({ type: 'flip', iid }), 'F'],
    L.zone === 'hand' ? [c.rev ? 'Cacher' : 'Révéler à l’adversaire', () => send({ type: 'reveal', iid })] : null,
  ]);
}
// Tokens: the board's "Créer un jeton" menu (HUD button, or right-click on your base / your side of a battlefield)
const TOKENS = [['Recruit', '1 ⚔'], ['Mech', '3 ⚔'], ['Sand Soldier', '2 ⚔'], ['Bird', '1 ⚔ · Deflect'], ['Sprite', '3 ⚔ · prêt, Temporary', true], ['Tentacle', '1 ⚔'], ['Shadow Clone', '0 ⚔'], ['Gold', 'équipement'], ['Bomb', 'équipement']];
function tokenMenu(e, bf) {
  const where = bf != null ? (() => { const b = S.v.bfs[bf].card, d = b && cardOf(b); return d ? d.name : 'champ de bataille'; })() : 'votre base';
  const to = bf != null ? { bf } : undefined;
  menu(e, `Créer un jeton · ${where}`, TOKENS.map(([nm, info, ready]) => ({ row: nm, info, btns: [1, 2, 3, 4].map(n => [n, () => send({ type: 'token', name: nm, n, ready: !!ready, to })]) })));
}
function pileMenu(p, z, e) {
  const mine = p === S.me;
  if (!mine && (z === 'main' || z === 'runeDeck')) return;
  const items = [[z === 'main' || z === 'runeDeck' ? 'Chercher dans le deck' : 'Voir les cartes', () => openViewer(p, z)]];
  if (mine && z === 'main') items.unshift(['Piocher 1', () => send({ type: 'draw', n: 1, p }), 'D'], ['Piocher 2', () => send({ type: 'draw', n: 2, p })], ['Piocher…', () => { const n = parseInt(prompt('Combien de cartes ?', '1')); if (n > 0) send({ type: 'draw', n, p }); }], ['Mélanger', () => send({ type: 'shuffle', zone: 'main', p })], '-');
  if (mine && z === 'runeDeck') items.unshift(['Canaliser 1', () => send({ type: 'channel', n: 1, p }), 'C'], ['Canaliser 2', () => send({ type: 'channel', n: 2, p })], ['Mélanger', () => send({ type: 'shuffle', zone: 'runeDeck', p })], '-');
  menu(e, ZNAME[z] + ' · ' + pname(p), items);
}

/* ---------- pointer: hover, drag & drop, dblclick ---------- */
let drag = null;
document.addEventListener('pointerover', e => {
  if (S.screen !== 'game' || drag) return;
  const el = e.target.closest('.card[data-iid]');
  if (!el) return;
  const L = locate(el.dataset.iid);
  S.hover = el.dataset.iid;
  // never reveal deck cards (not even your own top card) by hovering the pile
  if (L && (L.zone === 'main' || L.zone === 'runeDeck') && !el.dataset.viewer) return showPreview(null, null, L.zone);
  if (L) showPreview(cardOf(L.c), L.c);
});
document.addEventListener('contextmenu', e => {
  if (S.screen !== 'game') return;
  const el = e.target.closest('.card[data-iid]');
  if (el && !el.closest('.pile')) { e.preventDefault(); cardMenu(e, el.dataset.iid); }
  else if (e.target.closest('.board')) {
    e.preventDefault();
    // right-click on your base or your side of a battlefield: create tokens there
    const z = e.target.closest('[data-drop]'), to = z && JSON.parse(z.dataset.drop);
    if (to && to.zone === 'base' && to.p === S.me) tokenMenu(e);
    else if (to && to.bf != null && to.side === S.me) tokenMenu(e, to.bf);
  }
});
document.addEventListener('dblclick', e => {
  if (S.screen !== 'game') return;
  const el = e.target.closest('.card[data-iid]');
  if (el && !el.closest('.pile') && !el.dataset.viewer && !el.closest('[data-z$=":runes"]')) send({ type: 'exhaust', iid: el.dataset.iid });
});
document.addEventListener('pointerdown', e => {
  if (S.screen !== 'game' || e.button !== 0) return;
  const el = e.target.closest('.card[data-iid]');
  if (!el) return;
  const L = locate(el.dataset.iid);
  if (!L || L.bfCard != null) return;
  // piles: only the top card is draggable (deck top = draw by drag)
  const pile = el.closest('.pile');
  if (pile) { const st = pile.querySelector('.stack'); if (st.lastElementChild !== el) return; }
  if (L.c.hidden && S.seat !== 'solo') return;
  drag = { el, iid: el.dataset.iid, x: e.clientX, y: e.clientY, started: false, pile };
});
document.addEventListener('pointermove', e => {
  if (!drag) return;
  if (!drag.started) {
    if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 6) return;
    drag.started = true;
    const r = drag.el.getBoundingClientRect();
    const g = drag.el.cloneNode(true);
    g.classList.add('ghost'); g.classList.remove('ex', 'sel');
    g.style.width = r.width + 'px'; g.style.height = r.height + 'px'; g.style.left = r.left + 'px'; g.style.top = r.top + 'px';
    if (drag.el.classList.contains('ex')) { g.style.width = r.width + 'px'; }
    document.body.append(g);
    drag.g = g; drag.ox = e.clientX - r.left; drag.oy = e.clientY - r.top; drag.r = r; drag.vx = 0; drag.lx = e.clientX;
    drag.el.classList.add('dragging'); document.body.classList.add('dragging-card');
    { const L = locate(drag.iid); if (L && (L.zone === 'hand' || L.zone === 'champion') && HIDDEN_RE.test((cardOf(L.c) || {}).text || '')) document.body.classList.add('dragging-hidden'); }
    if (drag.pile) drag.pile._dragged = true;
    hideMenu();
  }
  drag.vx = drag.vx * .7 + (e.clientX - drag.lx) * .3; drag.lx = e.clientX;
  const rot = Math.max(-18, Math.min(18, drag.vx * 1.2));
  drag.g.style.transform = `translate(${e.clientX - drag.ox - drag.r.left}px, ${e.clientY - drag.oy - drag.r.top}px) rotate(${rot}deg) scale(1.08)`;
  const z = dropAt(e.clientX, e.clientY);
  if (z !== drag.z) { drag.z && drag.z.classList.remove('drop-ok'); z && z.classList.add('drop-ok'); drag.z = z; }
});
document.addEventListener('pointerup', e => {
  if (!drag) return;
  const d = drag; drag = null;
  if (d.pile) setTimeout(() => (d.pile._dragged = false), 0);
  if (!d.started) { // simple click = select; on your own rune = exhaust / ready it (adds energy to your pool)
    const L = locate(d.iid);
    if (S.cast && L && aimable(L)) return aimToggle(d.iid);
    if (L && L.zone === 'runes' && L.p === S.me && !d.el.dataset.viewer) return send({ type: 'exhaust', iid: d.iid });
    if (!d.pile) { S.sel = S.sel === d.iid ? null : d.iid; $$('.card.sel').forEach(x => x.classList.remove('sel')); if (S.sel) d.el.classList.add('sel'); }
    return;
  }
  d.z && d.z.classList.remove('drop-ok');
  const gr = d.g.getBoundingClientRect();
  d.g.remove(); d.el.classList.remove('dragging'); document.body.classList.remove('dragging-card', 'dragging-hidden');
  if (!d.z) return animateFrom(d.el, gr);
  const to = JSON.parse(d.z.dataset.drop);
  const extra = {};
  if (to.pos) extra.pos = to.pos;
  else {
    const row = d.z.matches('[data-z]') ? d.z : d.z.querySelector('[data-z]');
    if (row) {
      const kids = [...row.children].filter(k => k !== d.el);
      let idx = kids.findIndex(k => { const r = k.getBoundingClientRect(); return e.clientY < r.bottom && e.clientX < r.left + r.width / 2; });
      extra.index = idx < 0 ? kids.length : idx;
    }
  }
  if (e.shiftKey && to.zone === 'main') extra.pos = 'bottom';
  delete to.pos;
  origin.set(d.iid, gr);
  // dropping a card from hand (or the champion zone) onto the board = playing it: auto-pay + play effects.
  // Hold Shift to just place it without paying.
  const src = locate(d.iid), data = src && cardOf(src.c);
  if (to.hide != null && src && (src.zone === 'hand' || src.zone === 'champion')) return send({ type: 'hide', iid: d.iid, bf: to.hide }).then(() => { if (els.get(d.iid) && locate(d.iid) && locate(d.iid).zone === src.zone) animateFrom(els.get(d.iid), gr); });
  if (to.hide != null) return animateFrom(d.el, gr);
  const ontoBoard = to.zone === 'base' || to.bf != null;
  if (src && (src.zone === 'hand' || src.zone === 'champion') && ontoBoard && !e.shiftKey && data && data.type === 'Spell') { animateFrom(d.el, gr); return playCard(d.iid); }
  if (src && (src.zone === 'hand' || src.zone === 'champion') && ontoBoard && !e.shiftKey && data && ['Unit', 'Spell', 'Gear'].includes(data.type)) {
    // only Ambush units go straight to a battlefield; the others are played to base
    const ambush = /\[Ambush\]|can be played to a battlefield/i.test(data.text);
    const okBf = to.bf != null && data.type === 'Unit' && (ambush || S.v.bfs[to.bf].ctrl === S.me);
    return send({ type: 'play', iid: d.iid, to: okBf ? { bf: to.bf } : undefined }).then(() => { if (els.get(d.iid) && locate(d.iid) && locate(d.iid).zone === src.zone) animateFrom(els.get(d.iid), gr); });
  }
  if (d.el.dataset.viewer) { const real = els.get(d.iid); if (real) origin.set(d.iid, gr); }
  const L = locate(d.iid);
  const same = L && ((L.zone && L.zone === to.zone && L.p === to.p) || (L.bf != null && L.bf === to.bf && L.side === to.side));
  if (same && extra.index != null) {
    const cur = L.zone ? S.v.players[L.p].zones[L.zone] : S.v.bfs[L.bf].units[L.side];
    if (cur.findIndex(x => x.iid === d.iid) === extra.index) { origin.delete(d.iid); return animateFrom(d.el, gr); }
  }
  if (src && src.zone === 'hidden' && !e.shiftKey) return playCard(d.iid);
  if (e.shiftKey) extra.free = true; // Shift: forced move (no standard-move checks)
  mv(d.iid, to, extra);
});
function dropAt(x, y) {
  const t = document.elementFromPoint(x, y);
  if (!t) return null;
  if (t.closest('.modal .box')) return null;
  return t.closest('[data-drop]');
}
function animateFrom(el, r) {
  const b = el.getBoundingClientRect();
  el.animate([{ transform: `translate(${r.left - b.left}px,${r.top - b.top}px)` }, { transform: 'none' }], { duration: 300, easing: 'cubic-bezier(.2,.85,.25,1)' });
}

/* ---------- keyboard ---------- */
window.addEventListener('keydown', e => {
  if (e.key === 'Escape' && $('#modal').classList.contains('show')) return closeModal();
  if (S.screen !== 'game') return;
  if (e.target.matches('input, textarea')) { if (e.key === 'Escape') e.target.blur(); return; }
  const k = e.key, iid = S.hover && locate(S.hover) ? S.hover : null;
  const L = iid && locate(iid), o = L && (L.c.owner || L.p);
  if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === 'z') { e.preventDefault(); return undo(); }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (k === 'Escape') { hideMenu(); closeModal(); S.sel = null; if (S.cast) aimEnd(); return; }
  if (k === 'Enter') { e.preventDefault(); return $('#chat-in').focus(); }
  if (k === 'Tab') { e.preventDefault(); return swapSide(); }
  const lk = k.toLowerCase();
  if (iid && L.bfCard == null) {
    if (k === ' ') { e.preventDefault(); return send({ type: 'exhaust', iid }); }
    if (lk === 'f') return send({ type: 'flip', iid });
    if (k === '+' || k === '=') return send({ type: 'counter', iid, key: 'dmg', delta: 1 });
    if (k === '-') return send({ type: 'counter', iid, key: 'dmg', delta: -1 });
    if (k === ']') return send({ type: 'counter', iid, key: 'buff', delta: 1 });
    if (k === '[') return send({ type: 'counter', iid, key: 'buff', delta: -1 });
    if (k === 'Delete' || k === 'Backspace') return mv(iid, { p: o, zone: 'trash', pos: 'top' });
    if (lk === 'p' && (L.zone === 'hand' || L.zone === 'champion')) return playCard(iid);
    if (lk === 'h') return mv(iid, { p: o, zone: 'hand' });
    if (lk === 'b') return mv(iid, { p: o, zone: 'base' });
    if (/^[1-9]$/.test(k) && S.v.bfs[+k - 1]) return mv(iid, { bf: +k - 1, side: o });
  }
  if (lk === 'd') return send({ type: 'draw', n: 1 });
  if (lk === 'c') return send({ type: 'channel', n: 1 });
  if (lk === 'r') return send({ type: 'readyAll' });
  if (lk === 'j') { const b = $$('#hud button').find(x => x.textContent.startsWith('Jeton')); const r = b && b.getBoundingClientRect(); return r && tokenMenu({ clientX: r.left, clientY: r.bottom + 4 }); }
  if (lk === 't') return send({ type: 'startTurn' });
  if (lk === 'n') return endTurn();
});
document.addEventListener('pointerout', e => { const el = e.target.closest && e.target.closest('.card[data-iid]'); if (el && !el.contains(e.relatedTarget)) S.hover = null; });

$('#chat').addEventListener('submit', e => { e.preventDefault(); const i = $('#chat-in'); if (i.value.trim()) send({ type: 'chat', msg: i.value }); i.value = ''; i.blur(); });
window.addEventListener('resize', () => { if (S.screen === 'game' && S.v) renderGame(); });

/* ================= boot ================= */
(async () => {
  await loadCards();
  await loadDecks();
  connect(store.get('room', null), store.get('seat', null)); // silently rejoin after a page reload
})();
