// Builds one legal test deck per Legend that has no deck yet (data/decks.json), for AI tests and training.
// Rules: Chosen Champion with the Legend's tag, 39 main cards of the Legend's domains (max 3 copies,
// Signature cards only for that champion), 12 runes split between the two domains, 3 battlefields.
// The pick is seeded by the legend id, so the decks are the same on every run. Usage: node seed-legend-decks.js
const fs = require('fs');
const R = require('./rules');
const cards = require('./data/cards.json');
const FILE = './data/decks.json';
const decks = JSON.parse(fs.readFileSync(FILE, 'utf8'));

function rng(seed) { let h = 2166136261; for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) ^ Math.imul(h ^ (h >>> 13), 3266489909)) >>> 0) / 4294967296; }
const base = new Map(); // one print per name (the regular one)
for (const c of cards) if (!c.alt && c.supertype !== 'Token' && (!base.has(c.name) || c.id < base.get(c.name).id)) base.set(c.name, c);
const all = [...base.values()];
const legends = all.filter(c => c.type === 'Legend');
const used = new Set(decks.map(d => (cards.find(c => c.id === d.cards.legend[0].id) || {}).name));
const runeOf = dom => all.find(c => c.type === 'Rune' && c.domain.includes(dom) && c.rarity === 'Common');
const bfs = all.filter(c => c.type === 'Battlefield');
const inDomains = (c, doms) => (c.domain || []).every(d => d === 'Colorless' || doms.includes(d));

let added = 0;
for (const L of legends) {
  if (used.has(L.name) || (L.domain || []).length < 2) continue;
  const rand = rng(L.id), tag = (L.tags || [])[0];
  const pick = (list, n) => list.map(x => [rand(), x]).sort((a, b) => a[0] - b[0]).slice(0, n).map(x => x[1]);
  const champ = all.filter(c => c.type === 'Unit' && c.supertype === 'Champion' && (c.tags || []).includes(tag) && inDomains(c, L.domain)).sort((a, b) => (a.energy || 0) - (b.energy || 0))[0];
  if (!champ) { console.log('skip (no champion):', L.name); continue; }
  const pool = all.filter(c => ['Unit', 'Spell', 'Gear'].includes(c.type) && inDomains(c, L.domain)
    && (c.supertype !== 'Signature' || (c.tags || []).includes(tag)) && !(c.supertype === 'Champion' && !(c.tags || []).includes(tag)));
  const known = c => c.type !== 'Spell' || R.playFx(c).length > 0;
  const sig = pool.filter(c => c.supertype === 'Signature');
  const units = pool.filter(c => c.type === 'Unit' && c.supertype !== 'Champion' && (c.energy || 0) <= 7);
  const spells = pool.filter(c => c.type === 'Spell' && c.supertype !== 'Signature');
  const gear = pool.filter(c => c.type === 'Gear' && c.supertype !== 'Signature');
  // mostly cards the engine understands, a few it doesn't (they stay manual and must not block the AI)
  const chosen = [
    ...pick(sig, 2).map(c => [c, 2]),
    [champ, 2],
    ...pick(units, 8).map(c => [c, 3]),
    ...pick(spells.filter(known), 4).map(c => [c, 2]),
    ...pick(spells.filter(c => !known(c)), 1).map(c => [c, 1]),
    ...pick(gear, 2).map(c => [c, 1]),
  ];
  const main = new Map();
  for (const [c, n] of chosen) main.set(c.id, Math.min(3, (main.get(c.id) || 0) + n));
  let total = [...main.values()].reduce((a, b) => a + b, 0);
  for (const c of pick(units, units.length)) { if (total >= 39) break; const k = main.get(c.id) || 0; if (k < 3) { main.set(c.id, k + 1); total++; } }
  for (const c of pick(spells, spells.length)) { if (total >= 39) break; const k = main.get(c.id) || 0; if (k < 3) { main.set(c.id, k + 1); total++; } }
  while (total > 39) { const [id, n] = [...main].find(([, n]) => n > 1) || [...main][0]; if (n > 1) main.set(id, n - 1); else main.delete(id); total--; }
  if (total < 39) { console.log('skip (pool too small):', L.name, total); continue; }
  const [d1, d2] = L.domain;
  decks.push({
    id: 'legend-' + L.id, name: L.name, generated: true,
    cards: {
      legend: [{ id: L.id, n: 1 }], champion: [{ id: champ.id, n: 1 }],
      main: [...main].map(([id, n]) => ({ id, n })),
      runes: [{ id: runeOf(d1).id, n: 6 }, { id: runeOf(d2).id, n: 6 }],
      battlefields: pick(bfs, 3).map(c => ({ id: c.id, n: 1 })),
    },
  });
  added++;
}
fs.writeFileSync(FILE, JSON.stringify(decks, null, 2));
console.log(`${added} deck(s) added, ${decks.length} in total.`);
