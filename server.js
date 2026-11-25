// Riftbound Training Center - local server (zero dependencies).
// Serves the UI, caches card DATA (no images) from Riftcodex, stores decks, and syncs games over SSE.
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const game = require('./game');
// Trust the Windows/OS certificate store too (antivirus / missing intermediate certs break Node's bundled CA list).
try { const tls = require('tls'); tls.setDefaultCACertificates([...tls.getCACertificates('default'), ...tls.getCACertificates('system')]); } catch {}

const PORT = Number(process.env.PORT) || 3000;
const ROOT = __dirname;
const PUB = path.join(ROOT, 'public');
const DATA = path.join(ROOT, 'data');
const CARDS_FILE = path.join(DATA, 'cards.json');
const DECKS_FILE = path.join(DATA, 'decks.json');
fs.mkdirSync(DATA, { recursive: true });

// ---------- card database ----------
let cards = null;
let cardsLoading = null;

function slim(c) {
  const k = c.classification || {}, a = c.attributes || {}, m = c.metadata || {};
  return {
    id: c.id, name: c.name, code: (c.riftbound_id || '').toLowerCase(), num: c.collector_number,
    type: k.type, supertype: k.supertype, rarity: k.rarity, domain: k.domain || [],
    energy: a.energy, might: a.might, power: a.power,
    text: (c.text && c.text.plain) || '', img: (c.media && c.media.image_url) || '',
    tags: c.tags || [], set: c.set && c.set.set_id, setLabel: c.set && c.set.label,
    landscape: c.orientation === 'landscape',
    alt: !!(m.alternate_art || m.overnumbered || m.signature),
  };
}

// Primary source: the official card gallery (playriftbound.com), which carries every set including the newest.
const decodeHtml = s => s.replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, '&');
function officialSlim(c) {
  const acc = (c.cardImage && c.cardImage.accessibilityText) || '';
  const type = ((c.cardType && c.cardType.type && c.cardType.type[0]) || {}).label || (/^Riftbound (\w+)/.exec(acc) || [])[1] || 'Unit';
  const sup = ((c.cardType && c.cardType.superType) || []).map(t => t.label);
  const tags = (c.tags && c.tags.tags) || [];
  // legends are titled by their epithet only ("Void Burrower"): prefix the champion tag
  let name = c.name + (c.subtitle ? ', ' + c.subtitle : '');
  if (type === 'Legend' && tags[0]) name = tags[0] + ', ' + c.name;
  const html = [c.text, c.effect].map(t => (t && t.richText && t.richText.body) || '').join(' ');
  const text = decodeHtml(html.replace(/<br\s*\/?>/g, ' ').replace(/<\/p>\s*<p>/g, ' ').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
  const num = v => (v && v.value && typeof v.value.id === 'number' ? v.value.id : null);
  const m = /^[a-z]+-(\d+)[a-z]*(?:-star)?-(\d+)$/i.exec(c.id) || [];
  const alt = /-star-|\d[a-z]-/i.test(c.id) || (m[1] && +m[1] > +m[2]);
  return {
    id: c.id, name, code: c.id.toLowerCase(), num: c.collectorNumber, type,
    supertype: ['Champion', 'Signature', 'Token', 'Basic'].find(x => sup.includes(x)) || null,
    rarity: c.rarity && c.rarity.value && c.rarity.value.label, domain: ((c.domain && c.domain.values) || []).map(v => v.label),
    energy: num(c.energy), power: num(c.power), might: num(c.might), text,
    img: (c.cardImage && c.cardImage.url) || '', tags, set: c.set && c.set.value && c.set.value.id, setLabel: c.set && c.set.value && c.set.value.label,
    landscape: c.orientation === 'landscape', alt: !!alt,
  };
}
async function fetchOfficial() {
  const html = await (await fetch('https://playriftbound.com/en-us/card-gallery/')).text();
  const m = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(html);
  if (!m) throw new Error('galerie officielle illisible');
  let items = null;
  (function walk(o) {
    if (items || !o || typeof o !== 'object') return;
    if (Array.isArray(o) && o.length > 100 && o[0] && o[0].collectorNumber !== undefined) { items = o; return; }
    for (const k in o) walk(o[k]);
  })(JSON.parse(m[1]));
  if (!items) throw new Error('liste de cartes introuvable');
  return items.map(officialSlim);
}

async function fetchAllCards() {
  try {
    const out = await fetchOfficial();
    fs.writeFileSync(CARDS_FILE, JSON.stringify(out));
    return out;
  } catch (e) { console.warn('Galerie officielle indisponible, repli sur Riftcodex :', e.message); }
  const out = [];
  for (let page = 1, pages = 1; page <= pages; page++) {
    const r = await fetch(`https://api.riftcodex.com/cards?size=100&page=${page}`);
    if (!r.ok) throw new Error('Riftcodex HTTP ' + r.status);
    const j = await r.json();
    pages = j.pages;
    out.push(...j.items.map(slim));
  }
  fs.writeFileSync(CARDS_FILE, JSON.stringify(out));
  return out;
}

function loadCards(force) {
  if (!force && cards) return Promise.resolve(cards);
  if (!force && fs.existsSync(CARDS_FILE)) return Promise.resolve(cards = JSON.parse(fs.readFileSync(CARDS_FILE, 'utf8')));
  if (!cardsLoading) cardsLoading = fetchAllCards().then(c => (cards = c)).finally(() => (cardsLoading = null));
  return cardsLoading;
}

// ---------- decks ----------
const readDecks = () => (fs.existsSync(DECKS_FILE) ? JSON.parse(fs.readFileSync(DECKS_FILE, 'utf8')) : []);
const writeDecks = d => fs.writeFileSync(DECKS_FILE, JSON.stringify(d, null, 1));

// ---------- rooms (one game each, joined with a tag) + SSE sync ----------
const AI = require('./ai');
const other = game.other;
const rooms = new Map();
const TAG_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const LEVELS = { easy: 'IA Facile', normal: 'IA Normale', hard: 'IA Difficile' };

function newTag() {
  let t;
  do t = Array.from({ length: 5 }, () => TAG_CHARS[Math.floor(Math.random() * TAG_CHARS.length)]).join('');
  while (rooms.has(t));
  return t;
}
function makeRoom(mode) {
  const r = { tag: newTag(), mode, state: game.newState(), clients: new Set(), ai: null, decks: {}, timer: null, seen: Date.now() };
  rooms.set(r.tag, r);
  return r;
}
// online: rooms nobody has looked at for 2 hours are dropped (memory)
setInterval(() => {
  for (const r of rooms.values()) if (!r.clients.size && Date.now() - r.seen > 2 * 3600e3) { clearTimeout(r.timer); rooms.delete(r.tag); }
}, 10 * 60e3).unref();
function broadcast(r) {
  const extra = { room: r.tag, mode: r.mode, ai: r.ai && { seat: r.ai.seat, level: r.ai.level } };
  for (const c of r.clients) c.res.write(`data: ${JSON.stringify({ ...game.viewFor(r.state, c.seat), ...extra })}\n\n`);
}
async function startRoom(r) {
  await loadCards(false);
  r.state.auto = r.ai ? { [r.ai.seat]: true } : {}; // the AI pays and resolves its effects itself
  const err = game.apply(r.state, { type: 'start', decks: r.decks, cards, caller: r.ai ? other(r.ai.seat) : null });
  if (err) throw new Error(err);
  broadcast(r);
  aiTick(r);
}
const AI_SPEED = process.env.AI_SPEED != null ? Number(process.env.AI_SPEED) : 1; // tests: 0 = no pause
const AI_DELAY = { pass: 900, chainPass: 900, chainResolve: 700, resolve: 900, startTurn: 1000, fight: 1100, endTurn: 800, play: 750, move: 550, chooseBf: 1500, callParity: 1400, rollDice: 1200, mulligan: 1800 };
// The AI's next action. A bug in the AI must never freeze the game: fall back to the safe move (let the spell
// resolve, pass, answer the prompt, end the turn).
// peek: only look (AI.next advances the AI's plan in mem, so a look uses a copy)
function aiNext(r, peek) {
  const s = r.state, me = r.ai.seat;
  try { return AI.next(s, me, r.ai.level, peek ? structuredClone(r.ai.mem) : r.ai.mem); }
  catch (e) {
    console.error('AI error:', e);
    r.ai.mem = {};
    const top = s.chain && s.chain[s.chain.length - 1];
    if (s.pending) return s.pending.to === me ? (s.pending.kind === 'bf' ? { type: 'resolve', bf: s.pending.opts[0] } : { type: 'resolve', iids: s.pending.opt ? [] : (s.pending.opts || []).slice(0, s.pending.n) }) : null;
    if (top) return top.cb.by !== me ? (top.cb.seen ? null : { type: 'chainPass' }) : top.cb.seen ? { type: 'chainResolve' } : null;
    if (s.showdown) return s.showdown.focus === me ? { type: 'pass' } : null;
    return s.active === me && s.stage === 'main' ? { type: 'endTurn' } : null;
  }
}
// AI plays one action at a time with a pause so the animations stay readable. The action is chosen again when the
// pause ends: the human may have played in between (a reaction on the stack...), and a stale choice would skip it.
function aiTick(r) {
  if (!r.ai || r.timer || !rooms.has(r.tag)) return;
  const first = aiNext(r, true);
  if (!first) return;
  r.timer = setTimeout(() => {
    r.timer = null;
    if (!rooms.has(r.tag)) return;
    const act = aiNext(r);
    if (!act) return;
    const err = game.apply(r.state, { ...act, seat: r.ai.seat, p: r.ai.seat });
    if (err) {
      r.ai.mem.q = []; // replan from the current board
      if (++r.ai.errors > 15) { r.ai.errors = 0; game.apply(r.state, { type: 'endTurn', seat: r.ai.seat, p: r.ai.seat }); }
    }
    broadcast(r);
    aiTick(r);
  }, (AI_DELAY[first.type] || 600) * AI_SPEED);
}
const deckById = id => readDecks().find(d => d.id === id);

// ---------- http ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json' };

function body(req) {
  return new Promise((ok, ko) => {
    let s = '';
    req.on('data', d => { s += d; if (s.length > 5e6) req.destroy(); });
    req.on('end', () => { try { ok(s ? JSON.parse(s) : {}); } catch (e) { ko(e); } });
  });
}
const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };

function lanUrls() {
  return Object.values(os.networkInterfaces()).flat()
    .filter(i => i && i.family === 'IPv4' && !i.internal).map(i => `http://${i.address}:${PORT}`);
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  try {
    if (p === '/api/cards' && req.method === 'GET') {
      const R = require('./rules');
      // nt: units a spell chooses; ab: activated abilities (text, cost, number of targets)
      const extra = c => {
        const x = c.type === 'Spell' ? { nt: R.playFx(c).filter(e => e.kind === 'target').length } : {};
        const ab = R.abilities(c);
        if (ab.length) x.ab = ab.map(a => ({ text: a.text, e: a.cost.e, p: a.cost.p.length, nt: a.fx.filter(e => e.kind === 'target').length, kill: a.kill, xp: a.xp, other: a.other }));
        return Object.keys(x).length ? { ...c, ...x } : c;
      };
      return json(res, 200, [...(await loadCards(false)).map(extra), ...R.SYNTH_TOKENS]);
    }
    if (p === '/api/cards/refresh' && req.method === 'POST') return json(res, 200, { count: (await loadCards(true)).length });
    if (p === '/api/info') return json(res, 200, { lan: lanUrls() });

    if (p === '/api/decks' && req.method === 'GET') return json(res, 200, readDecks());
    if (p === '/api/decks' && req.method === 'POST') {
      const d = await body(req);
      if (!d || typeof d.name !== 'string' || !d.cards) return json(res, 400, { error: 'deck invalide' });
      const decks = readDecks();
      d.id = d.id || Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      d.updated = Date.now();
      const i = decks.findIndex(x => x.id === d.id);
      if (i >= 0) decks[i] = d; else decks.push(d);
      writeDecks(decks);
      return json(res, 200, d);
    }
    if (p.startsWith('/api/decks/') && req.method === 'DELETE') {
      const id = decodeURIComponent(p.slice(11));
      writeDecks(readDecks().filter(d => d.id !== id));
      return json(res, 200, { ok: true });
    }

    if (p === '/api/room/create' && req.method === 'POST') {
      const a = await body(req);
      const d1 = deckById(a.deckId);
      if (!d1) return json(res, 400, { error: 'Choisissez un deck' });
      const name = String(a.name || '').slice(0, 24) || 'Joueur 1';
      const r = makeRoom(a.mode === 'ai' ? 'ai' : 'pvp');
      r.state.seats.p1 = { name };
      r.decks.p1 = d1;
      if (r.mode === 'pvp') { broadcast(r); return json(res, 200, { tag: r.tag, seat: 'p1' }); }
      const d2 = deckById(a.deckId2) || d1;
      r.decks.p2 = d2;
      const level = LEVELS[a.level] ? a.level : 'normal';
      r.ai = { seat: 'p2', level, mem: {}, errors: 0 };
      r.state.seats.p2 = { name: LEVELS[level] };
      await startRoom(r);
      return json(res, 200, { tag: r.tag, seat: 'p1' });
    }
    if (p === '/api/room/join' && req.method === 'POST') {
      const a = await body(req);
      const r = rooms.get(String(a.tag || '').trim().toUpperCase().replace(/^RIFT-/, ''));
      if (!r || r.mode !== 'pvp') return json(res, 404, { error: 'Tag inconnu' });
      if (r.state.phase === 'playing') return json(res, 409, { error: 'La partie a déjà commencé' });
      const d = deckById(a.deckId);
      if (!d) return json(res, 400, { error: 'Choisissez un deck' });
      r.state.seats.p2 = { name: String(a.name || '').slice(0, 24) || 'Joueur 2' };
      r.decks.p2 = d;
      await startRoom(r);
      return json(res, 200, { tag: r.tag, seat: 'p2' });
    }
    if (p === '/api/events') {
      const seat = url.searchParams.get('seat') || 'spec', r = rooms.get(url.searchParams.get('room'));
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      if (!r) { res.write(`data: ${JSON.stringify({ phase: 'none' })}\n\n`); return res.end(); }
      const c = { res, seat };
      r.clients.add(c); r.seen = Date.now();
      broadcast(r);
      const ping = setInterval(() => res.write(': ping\n\n'), 20000);
      req.on('close', () => { clearInterval(ping); r.clients.delete(c); r.seen = Date.now(); });
      return;
    }
    if (p === '/api/action' && req.method === 'POST') {
      const a = await body(req);
      const r = rooms.get(a.room);
      if (!r) return json(res, 404, { error: 'Partie introuvable' });
      if (a.type === 'start') return json(res, 400, { error: 'action interdite' });
      if (r.ai && a.seat === r.ai.seat) return json(res, 403, { error: 'siège IA' });
      const err = game.apply(r.state, a);
      if (err) return json(res, 400, { error: err });
      if (r.ai && a.type === 'undo') { clearTimeout(r.timer); r.timer = null; r.ai.mem = {}; }
      broadcast(r);
      aiTick(r);
      if (a.type === 'quit') setTimeout(() => { clearTimeout(r.timer); rooms.delete(r.tag); }, 5000);
      return json(res, 200, { ok: true });
    }

    // static files
    let f = path.normalize(path.join(PUB, p === '/' ? 'index.html' : p));
    if (!f.startsWith(PUB)) { res.writeHead(403); return res.end(); }
    fs.readFile(f, (e, buf) => {
      if (e) { res.writeHead(404); return res.end('404'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
      res.end(buf);
    });
  } catch (e) {
    console.error(e);
    json(res, 500, { error: String(e.message || e) });
  }
}).listen(PORT, () => {
  console.log(`\n  Riftbound Training Center\n  -> http://localhost:${PORT}`);
  for (const u of lanUrls()) console.log(`  -> ${u}  (autre PC sur le reseau local)`);
  console.log('');
});
