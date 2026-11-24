// Builds the starter decks from data/starter-decks.txt into data/decks.json (replaces decks with the same name).
// Lists come from piltoverarchive.com (Nov 2026). Usage: node seed-decks.js
const fs = require('fs');
const cards = require('./data/cards.json');
const norm = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const byName = {};
for (const c of cards) { const n = norm(c.name); if (!byName[n] || (byName[n].alt && !c.alt)) byName[n] = c; }
const SEC = { legend: 'legend', champion: 'champion', maindeck: 'main', battlefields: 'battlefields', runes: 'runes' };

const decks = [], missing = [];
for (const block of fs.readFileSync('data/starter-decks.txt', 'utf8').split(/\n\s*\n/)) {
  const lines = block.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (!lines.length) continue;
  const d = { id: 'starter-' + norm(lines[0].replace(/^Deck:/, '')).replace(/ /g, '-'), name: lines[0].replace(/^Deck:\s*/, ''), starter: true, cards: { legend: [], champion: [], main: [], battlefields: [], runes: [], side: [] } };
  let sec = null;
  for (const l of lines.slice(1)) {
    if (l.endsWith(':')) { sec = SEC[norm(l).replace(/ /g, '')]; continue; }
    const m = /^(\d+)\s+(.+)$/.exec(l);
    // "Name, Title" and "Name - Title" are the same card
    const c = m && (byName[norm(m[2])] || byName[norm(m[2].replace(',', ' -'))]);
    if (!c) { missing.push(`${d.name}: ${l}`); continue; }
    d.cards[sec].push({ id: c.id, n: +m[1] });
  }
  d.updated = Date.now();
  decks.push(d);
}
if (missing.length) { console.error('Introuvables:\n' + missing.join('\n')); process.exitCode = 1; }
const file = 'data/decks.json';
const old = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
const names = new Set(decks.map(d => d.name));
const keep = old.filter(d => !names.has(d.name) && !/jinx/i.test(d.name));
fs.writeFileSync(file, JSON.stringify([...decks, ...keep], null, 1));
for (const d of decks) {
  const n = k => d.cards[k].reduce((a, x) => a + x.n, 0);
  console.log(`${d.name}: legend ${n('legend')} champion ${n('champion')} main+champ ${n('main') + n('champion')} runes ${n('runes')} bf ${d.cards.battlefields.length}`);
}
