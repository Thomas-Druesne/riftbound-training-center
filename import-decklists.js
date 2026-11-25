// Builds data/decks.json: ONE deck per Legend, named after the Legend, every deck shaped like a tournament deck:
// 1 Legend + 1 Chosen Champion + 39 main deck cards, a 10-card sideboard, 3 battlefields, 12 runes.
// Source: competitive lists (official "Top Decks" / "Best-Of" articles, saved as text in data/decklists/).
// For each Legend the best-placed list with no banned card is taken; when every list has banned cards, the best
// one is adapted: banned main deck cards become more copies of the deck's own cards (never sideboard cards), a
// banned Chosen Champion becomes another champion of the Legend, banned battlefields the most played legal ones.
// Legends without a list keep their generated deck (seed-legend-decks.js), given a sideboard. The user's own decks
// are kept as they are.
// Usage: node import-decklists.js
const fs = require('fs');
const cards = require('./data/cards.json');

const SOURCES = [
  { file: 'data/decklists/rc-europe-2026-11.txt', label: 'RC Europe, nov. 2026' },
  { file: 'data/decklists/rq-los-angeles-2026-09.txt', label: 'RQ Los Angeles, sept. 2026' },
];
// Standard ban list (Radiance update effective November 23, 2026, plus earlier bans)
const BANNED = ['Riven, Broken Blade', "Zhonya's Hourglass", 'Stellacorn Herder', 'Nocturne, Horrifying', 'Rhasa the Sunderer',
  'Brynhir Thundersong', 'Dazzling Aurora', 'Baited Hook', "Emperor's Dais", 'Star Spring', 'Stacked Deck', "Reaver's Row"];
const SIDE = 10, MAIN = 39;

const norm = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’‘]/g, "'").toLowerCase().replace(/[^a-z0-9']+/g, ' ').trim();
const byName = {}, byId = {};
for (const c of cards) { byId[c.id] = c; const n = norm(c.name); if (!byName[n] || (byName[n].alt && !c.alt) || (byName[n].supertype === 'Token' && c.supertype !== 'Token')) byName[n] = c; }
// names used in the articles that differ from the card data
const ALIAS = { 'kennen, heart of the tempest': 'Yordle, Heart of the Tempest', 'trapping ground': 'Trapping Grounds', "hunter's circle": "Hunters' Circle" };
const card = name => byName[norm(ALIAS[name.toLowerCase()] || name)] || byName[norm(name.replace(',', ' -'))];
const banned = new Set(BANNED.map(norm));
const isBanned = name => banned.has(norm(name));
const SEC = { 'legend': 'legend', 'champion': 'champion', 'main deck': 'main', 'battlefields': 'battlefields', 'rune pool': 'runes', 'runes': 'runes', 'sideboard': 'side' };

function parse(text) {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const out = [];
  let d = null, sec = null;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i], h = /^([A-Za-z ]+):$/.exec(l);
    if (h && SEC[h[1].toLowerCase()]) {
      sec = SEC[h[1].toLowerCase()];
      if (sec === 'legend') {
        let k = i - 1; while (k > 0 && /^(Legend Rank|Overall Ranking)/.test(lines[k])) k--;
        d = { player: lines[k], legend: [], champion: [], main: [], battlefields: [], runes: [], side: [] };
        out.push(d);
      }
      continue;
    }
    const m = /^(\d+)\s+(.+)$/.exec(l);
    if (d && sec && m) d[sec].push({ n: +m[1], name: m[2].trim() });
    else if (d && sec === 'side' && !m) sec = null; // end of the list
  }
  return out;
}
const total = l => l.reduce((t, x) => t + x.n, 0);
const bannedIn = r => [...r.champion, ...r.main, ...r.battlefields].filter(x => isBanned(x.name)).length;

// every list, grouped by Legend, best placed first
const lists = new Map(), missing = [];
for (const src of SOURCES) {
  if (!fs.existsSync(src.file)) continue;
  for (const raw of parse(fs.readFileSync(src.file, 'utf8'))) {
    const L = raw.legend[0] && card(raw.legend[0].name);
    if (!L) { missing.push(`${src.label} / ${raw.player}: légende ${raw.legend[0] && raw.legend[0].name}`); continue; }
    raw.src = src.label; raw.L = L; raw.short = raw.legend[0].name.split(',')[0].trim();
    for (const k of ['champion', 'main', 'battlefields', 'runes', 'side']) raw[k] = raw[k].filter(x => card(x.name) || (missing.push(`${src.label} / ${raw.player}: ${x.name}`), false)).map(x => ({ n: x.n, name: card(x.name).name }));
    if (!lists.has(L.name)) lists.set(L.name, []);
    lists.get(L.name).push(raw);
  }
}

const bfCount = {};
for (const ls of lists.values()) for (const r of ls) for (const b of r.battlefields) if (!isBanned(b.name)) bfCount[b.name] = (bfCount[b.name] || 0) + 1;
const popularBfs = Object.keys(bfCount).sort((a, b) => bfCount[b] - bfCount[a]);

// add copies of `name` to list (max 3 copies of a name across main deck + sideboard); returns the copies added
function addCopies(list, others, name, n) {
  const have = [...list, ...others].filter(x => x.name === name).reduce((t, x) => t + x.n, 0), k = Math.min(n, 3 - have);
  if (k <= 0) return 0;
  const e = list.find(x => x.name === name); if (e) e.n += k; else list.push({ name, n: k });
  return k;
}
const typeOf = name => (card(name) || {}).type;

function build(raw) {
  const notes = [];
  let champ = raw.champion.slice(), main = raw.main.map(x => ({ ...x })), side = raw.side.map(x => ({ ...x }));
  // banned main deck cards -> more copies of the deck's own cards, same card type first, core cards (most copies) first
  const lost = [];
  main = main.filter(x => { if (isBanned(x.name)) { lost.push(x); notes.push(x.name); return false; } return true; });
  for (const x of lost) {
    let left = x.n;
    const pool = main.filter(y => card(y.name).supertype !== 'Champion').sort((a, b) => (typeOf(b.name) === typeOf(x.name)) - (typeOf(a.name) === typeOf(x.name)) || b.n - a.n);
    for (const y of pool) { if (!left) break; left -= addCopies(main, side, y.name, left); }
  }
  // banned Chosen Champion -> another champion of the Legend (one that fits an Equipment deck if the deck has them)
  if (champ[0] && isBanned(champ[0].name)) {
    notes.push(champ[0].name);
    const tag = (raw.L.tags || [])[0], gear = main.filter(x => /\[Equip\]/.test(card(x.name).text || '')).reduce((t, x) => t + x.n, 0);
    const alts = cards.filter(c => c.supertype === 'Champion' && c.type === 'Unit' && !c.alt && (c.tags || []).includes(tag) && !isBanned(c.name));
    const score = c => (gear >= 3 && /Weaponmaster|\[Equip\]|Equipment/.test(c.text || '') ? 5 : 0) + (main.some(x => x.name === c.name) ? 2 : 0);
    const alt = alts.sort((a, b) => score(b) - score(a))[0];
    if (!alt) return null;
    champ = [{ n: 1, name: alt.name }];
    const e = main.find(x => x.name === alt.name); // the champion zone takes one of its copies from the main deck
    if (e) { e.n--; if (!e.n) main.splice(main.indexOf(e), 1); for (const y of main.slice().sort((a, b) => b.n - a.n)) if (addCopies(main, side, y.name, 1)) break; }
  }
  // sideboard: no banned card, exactly 10 (more copies of its own cards, then of main deck cards)
  side = side.filter(x => { if (isBanned(x.name)) { notes.push(x.name + ' (side)'); return false; } return true; });
  while (total(side) > SIDE) { const x = side[side.length - 1]; if (!--x.n) side.pop(); }
  for (const y of [...side.slice(), ...main.slice().sort((a, b) => a.n - b.n)]) { if (total(side) >= SIDE) break; addCopies(side, main, y.name, SIDE - total(side)); }
  // battlefields: 3 legal ones
  let bfs = raw.battlefields.filter(x => { if (isBanned(x.name)) { notes.push(x.name); return false; } return true; });
  for (const b of popularBfs) { if (bfs.length >= 3) break; if (!bfs.some(x => x.name === b)) bfs.push({ n: 1, name: b }); }
  return { champ, main, side, bfs, notes };
}

const out = [];
for (const [legend, ls] of lists) {
  const clean = ls.find(r => !bannedIn(r)), raw = clean || ls[0], b = build(raw);
  if (!b) { missing.push(`${legend}: aucun champion légal`); continue; }
  const ids = list => list.map(x => ({ id: card(x.name).id, n: x.n }));
  if (total(b.main) !== MAIN || total(b.side) !== SIDE || b.bfs.length !== 3 || total(raw.runes) !== 12)
    console.log(`⚠ ${legend} (${raw.player}) : main ${total(b.main)}, side ${total(b.side)}, champs ${b.bfs.length}, runes ${total(raw.runes)}`);
  out.push({
    id: 'comp-' + norm(legend).replace(/[^a-z0-9]+/g, '-'), competitive: true, name: raw.short,
    source: `${raw.player} (${raw.src})`, legendName: legend, banReplaced: b.notes,
    cards: { legend: [{ id: raw.L.id, n: 1 }], champion: ids(b.champ), main: ids(b.main), battlefields: ids(b.bfs), runes: ids(raw.runes), side: ids(b.side) },
  });
}

// Legends without a list: their generated deck (or starter), named after the Legend, with a 10-card sideboard
const FILE = 'data/decks.json';
const old = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const legendOf = d => (byId[(d.cards.legend[0] || {}).id] || {}).name;
const covered = new Set(out.map(d => d.legendName));
const own = old.filter(d => !d.competitive && !d.generated && !d.starter);
const fill = [];
for (const d of old.filter(d => (d.generated || d.starter) && !covered.has(legendOf(d)))) {
  const L = byId[d.cards.legend[0].id]; if (!L || fill.some(x => x.legendName === L.name)) continue;
  const main = d.cards.main.map(x => ({ name: byId[x.id].name, n: x.n }));
  const doms = (L.domain || []).filter(x => x !== 'Colorless');
  const pool = cards.filter(c => !c.alt && ['Spell', 'Unit', 'Gear'].includes(c.type) && c.supertype !== 'Champion' && c.supertype !== 'Token' && c.supertype !== 'Signature'
    && (c.domain || []).length && c.domain.every(x => doms.includes(x)) && !isBanned(c.name) && !main.some(x => x.name === c.name))
    .sort((a, b) => /\[Reaction\]/.test(b.text || '') - /\[Reaction\]/.test(a.text || '') || a.name.localeCompare(b.name));
  const side = [];
  for (const c of pool) { if (total(side) >= SIDE) break; addCopies(side, main, c.name, Math.min(2, SIDE - total(side))); }
  const short = L.name.split(',')[0];
  fill.push({ ...d, name: short === 'Yordle' ? 'Kennen' : short, legendName: L.name, generated: true, starter: undefined, cards: { ...d.cards, side: side.map(x => ({ id: card(x.name).id, n: x.n })) } });
}
const all = [...out, ...fill].sort((a, b) => a.name.localeCompare(b.name));
// two Legends of the same champion: the full Legend name tells them apart
for (const d of all) if (all.filter(x => x.name === d.name).length > 1) d.dupe = true;
for (const d of all) if (d.dupe) { d.name = d.legendName.replace(/^Yordle/, 'Kennen'); delete d.dupe; }
fs.writeFileSync(FILE, JSON.stringify([...all, ...own], null, 1));
if (missing.length) console.log('Introuvables :\n  ' + [...new Set(missing)].join('\n  '));
console.log(`${all.length} decks (un par légende) : ${out.length} listes compétitives (${out.filter(d => d.banReplaced.length).length} adaptées au ban), ${fill.length} decks générés ; ${own.length} decks personnels gardés.`);
for (const d of out.filter(d => d.banReplaced.length)) console.log(`  ${d.name} : ${d.banReplaced.join(', ')}`);
