// Card-by-card sweep: every playable card (unit, spell, gear) is put in hand with enough resources and a board on
// both sides, played in AUTO mode, and every choice is answered the way the interface allows (first legal option).
// Checked: no crash, no choice that can't be answered (or that the interface can't show), the stack and the effect
// queue empty out, no card in two places, the card left the hand, and something actually happened.
// [Action] / [Reaction] spells are also cast inside a showdown. Report: sweep-report.md.
// Usage: node sweep.js [name filter]
const fs = require('fs');
const g = require('./game'), R = require('./rules');
const all = require('./data/cards.json'), decks = require('./data/decks.json');
const other = p => (p === 'p1' ? 'p2' : 'p1');
const FILTER = (process.argv[2] || '').toLowerCase();
const UI_KINDS = ['bf', 'confirm', 'discard', 'mode', 'pick', 'predict', 'sacrifice', 'buff', 'target']; // prompts public/app.js renders

const seen = new Set();
const pool = all.filter(c => ['Unit', 'Spell', 'Gear'].includes(c.type) && c.supertype !== 'Token' && !seen.has(c.name) && seen.add(c.name))
  .filter(c => !FILTER || c.name.toLowerCase().includes(FILTER));
const byName = n => all.find(c => c.name === n);
const RUNES = ['Fury', 'Calm', 'Mind', 'Body', 'Chaos', 'Order'].map(d => all.find(c => c.type === 'Rune' && c.name === d + ' Rune')).filter(Boolean);

function base() {
  const s = g.newState(); s.seats = { p1: { name: 'A' }, p2: { name: 'B' } }; s.auto = { p1: true, p2: true };
  g.apply(s, { type: 'start', cards: all, decks: { p1: decks[0], p2: decks[1] } });
  for (const p of ['p1', 'p2']) if (s.stage === 'bf' && !s.bfPick[p]) g.apply(s, { type: 'chooseBf', seat: p, cid: s.bfOpts[p][0] });
  g.apply(s, { type: 'callParity', seat: s.dice.caller, parity: 'pair' });
  for (const p of ['p1', 'p2']) g.apply(s, { type: 'mulligan', seat: p, iids: [] });
  const P = s.active, O = other(P);
  let n = 0;
  const put = (p, c, where) => { const x = { iid: 'w' + (++n), cid: c.id, owner: p, ex: false, dmg: 0, buff: 0 }; s.cd[c.id] = s.cd[c.id] || c; where.push(x); return x; };
  const units = all.filter(c => c.type === 'Unit' && c.supertype !== 'Token' && /^\s*$|^\[(Tank|Shield|Assault)\]/.test((c.text || '').replace(/\([^)]*\)/g, '').trim()) && (c.might || 0) >= 2 && (c.might || 0) <= 5).slice(0, 6);
  for (const p of [P, O]) {
    const z = s.players[p].zones;
    z.runes = []; for (const r of RUNES) { s.cd[r.id] = r; for (let i = 0; i < 2; i++) z.runes.push({ iid: 'r' + (++n), cid: r.id, owner: p, ex: false }); }
    s.players[p].pool = { e: 14, p: ['any', 'any', 'any', 'any', 'any', 'any'] };
    s.players[p].xp = 12;
  }
  // board: mine 2 in base + 1 at battlefield 0 (I control it); theirs 2 at battlefield 1 (they control it) + 1 in base
  put(P, units[0], s.players[P].zones.base); put(P, units[1], s.players[P].zones.base); put(P, units[2], s.bfs[0].units[P]); s.bfs[0].ctrl = P;
  put(O, units[3], s.bfs[1].units[O]); put(O, units[4], s.bfs[1].units[O]); put(O, units[5], s.players[O].zones.base); s.bfs[1].ctrl = O;
  const sword = byName("Doran's Blade"); if (sword) put(P, sword, s.players[P].zones.base);
  for (const c of [units[0], byName('Concentrate'), byName('Cleave')].filter(Boolean)) put(P, c, s.players[P].zones.trash);
  s.history = [];
  return { s, P, O };
}

const sig = s => JSON.stringify({ z: ['p1', 'p2'].map(p => Object.entries(s.players[p].zones).map(([k, a]) => k + ':' + a.map(c => c.iid + (c.ex ? 'x' : '') + (c.dmg || '') + '/' + (c.tb || '') + (c.ta || '') + (c.ts || '') + (c.buff || '') + (c.st ? 's' : '') + (c.emp ? 'e' : '') + (c.att || '') + (c.tt ? 't' : '') + (c.tg ? 'g' : '') + (c.prevent || '') + (c.doom || '') + (c.retreat || '')).join())),
  b: s.bfs.map(b => [b.ctrl, b.card && b.card.cid, ['p1', 'p2'].map(p => b.units[p].map(c => c.iid + (c.ex ? 'x' : '') + (c.dmg || '') + '/' + (c.tb || '') + (c.ta || '') + (c.ts || '') + (c.buff || '') + (c.st ? 's' : '') + (c.tt ? 't' : '') + (c.tg ? 'g' : '') + (c.prevent || '') + (c.doom || '')).join()), JSON.stringify(b.gear || {}), (b.hidden || []).length]),
  sc: ['p1', 'p2'].map(p => [s.players[p].score, s.players[p].xp, JSON.stringify(s.players[p].pool)]), x: [s.decree, s.noSpellDmg, s.spellDisc, s.unitDisc, s.anyBf, s.freeHide, s.extraTurn, s.silence, s.endReady, s.minefield] });

function dup(s) {
  const seenIds = new Map();
  const add = (c, w) => { if (!c) return null; if (seenIds.has(c.iid)) return `${c.iid} (${(g.cd(s, c) || {}).name}) : ${seenIds.get(c.iid)} et ${w}`; seenIds.set(c.iid, w); return null; };
  for (const p of ['p1', 'p2']) for (const [z, a] of Object.entries(s.players[p].zones)) for (const c of a) { const r = add(c, p + '.' + z); if (r) return r; }
  for (const [i, b] of s.bfs.entries()) { for (const p of ['p1', 'p2']) for (const c of [...b.units[p], ...((b.gear || {})[p] || [])]) { const r = add(c, 'bf' + i + '.' + p); if (r) return r; } for (const c of b.hidden || []) { const r = add(c, 'bf' + i + '.cachée'); if (r) return r; } }
  for (const c of s.chain || []) { const r = add(c, 'pile'); if (r) return r; }
  return null;
}

// the first legal answer, like a player clicking in the interface
function answerOf(s, q) {
  const z = s.players[q.to].zones, mine = [...z.base, ...s.bfs.flatMap(b => b.units[q.to])].filter(c => g.cd(s, c).type === 'Unit');
  switch (q.kind) {
    case 'confirm': return { yes: true };
    case 'mode': return { modes: q.opts.slice(0, q.n).map(o => o.i) };
    case 'pick': return { iids: q.cards.slice(0, 1) };
    case 'predict': return { iids: [] };
    case 'bf': return { bf: q.opts[0] };
    case 'target': return { iids: q.opts.slice(0, 1) };
    case 'discard': return { iids: z.hand.slice(0, q.n).map(c => c.iid) };
    case 'sacrifice': case 'buff': return { iids: mine.filter(c => c.iid !== q.exclude).slice(0, 1).map(c => c.iid) };
    default: return null;
  }
}

// play out everything that follows (prompts, the stack, a showdown) until the game is quiet again
function settle(s, P, issues) {
  for (let step = 0; step < 300; step++) {
    const q = s.pending;
    if (q) {
      if (!UI_KINDS.includes(q.kind)) { issues.push(`choix « ${q.kind} » que l'interface ne sait pas afficher (${q.card})`); return false; }
      const a = answerOf(s, q);
      if ((q.kind === 'target' && !q.opts.length) || (q.kind === 'bf' && !(q.opts || []).length)) { issues.push(`choix sans option possible : ${q.kind} (${q.card})`); return false; }
      const err = g.apply(s, { type: 'resolve', seat: q.to, ...a });
      if (err) { const e2 = (q.opt || q.kind === 'pick') ? g.apply(s, { type: 'resolve', seat: q.to, iids: [] }) : err; if (e2) { issues.push(`choix refusé (${q.kind}, ${q.card}) : ${err}`); return false; } }
      continue;
    }
    const top = s.chain && s.chain[s.chain.length - 1];
    if (top) {
      const by = top.cb.by, err = top.cb.seen ? g.apply(s, { type: 'chainResolve', seat: by }) : g.apply(s, { type: 'chainPass', seat: other(by) });
      if (err) { issues.push(`pile bloquée sur ${g.cd(s, top).name} : ${err}`); return false; }
      continue;
    }
    if (s.showdown) { const err = g.apply(s, { type: 'pass', seat: s.showdown.focus }); if (err) { issues.push(`affrontement bloqué : ${err}`); return false; } continue; }
    if (s.fxQueue && s.fxQueue.length) { issues.push(`effets en attente sans choix affiché (${s.fxQueue[0].kind} de ${s.fxQueue[0].card})`); return false; }
    return true;
  }
  issues.push('ne se termine pas (boucle)'); return false;
}

function tryCard(d, mode) {
  const { s, P, O } = base(), issues = [];
  s.cd[d.id] = d;
  const z = s.players[P].zones;
  for (const c of [byName('Cleave'), byName('Concentrate')].filter(Boolean)) { s.cd[c.id] = c; z.hand.push({ iid: 'h' + c.id, cid: c.id, owner: P, ex: false }); }
  if (mode === 'showdown') { // my unit attacks their battlefield, then the card is cast with Focus
    const u = z.base.find(c => g.cd(s, c).type === 'Unit');
    g.apply(s, { type: 'move', seat: P, iid: u.iid, to: { bf: 1, side: P } });
    if (!s.showdown) return [`l'affrontement ne s'ouvre pas`];
    if (s.showdown.focus !== P) g.apply(s, { type: 'pass', seat: s.showdown.focus });
  }
  z.hand.push({ iid: 'SW', cid: d.id, owner: P, ex: false });
  const before = sig(s), log0 = s.log.length;
  let err;
  try { err = g.apply(s, { type: 'play', seat: P, iid: 'SW' }); }
  catch (e) { return [`PLANTAGE au jeu : ${e.message} @ ${(e.stack.split('\n')[1] || '').trim()}`]; }
  if (err) return [`refusé : ${err}`];
  try { settle(s, P, issues); }
  catch (e) { return [`PLANTAGE à la résolution : ${e.message} @ ${(e.stack.split('\n')[1] || '').trim()}`]; }
  const dd = dup(s); if (dd) issues.push(`carte en double : ${dd}`);
  const f = g.find(s, 'SW');
  if (f && f.zone === 'hand') issues.push('la carte est restée en main');
  const logs = s.log.slice(log0).map(l => l.msg);
  if (logs.some(m => /À appliquer à la main/.test(m))) issues.push('effet laissé « à la main » en mode auto');
  // something visible must have happened besides the card moving
  const t = (d.text || '').replace(/\([^)]*\)/g, '');
  const hasPlayFx = d.type === 'Spell' ? t.trim().length > 0 && !/^\s*(\[[^\]]+\]\s*)+$/.test(t) : /When you play (me|this)/i.test(t);
  if (hasPlayFx && !issues.length) {
    const after = sig(s).replace(/"SW[^",/]*/g, ''), bef = before.replace(/"SW[^",/]*/g, '');
    const fx = [...R.playFx(d, { legion: true }), ...(((R.DEPLOY_FX[d.name] || {}).play) || [])];
    if (!fx.length && /^\s*(When|While|Your|Other|I have|Friendly)/i.test(t.replace(/^\s*(\[[^\]]+\]\s*)+/, '')) && d.type === 'Spell') return issues; // a passive printed as a spell: nothing to cast
    const touched = after !== bef || logs.some(m => /pioche|canalise|gagne|subit|détruit|étourdi|redress|déplace|crée|jeton|regarde|révèle|banni|contré|choisit|recycl|buff|XP|point/i.test(m) && !/lance|joue /.test(m));
    if (!fx.length) issues.push('texte non compris par le moteur (aucun effet)');
    else if (!touched) issues.push('aucun effet visible');
  }
  return issues;
}

const rows = [], t0 = Date.now();
let ok = 0;
for (const d of pool) {
  const k = R.kw(d.text), modes = ['main', ...(d.type === 'Spell' && (k.action || k.reaction) ? ['showdown'] : [])];
  for (const m of modes) {
    let issues;
    try { issues = tryCard(d, m); } catch (e) { issues = [`PLANTAGE préparation : ${e.message}`]; }
    if (issues.length) rows.push({ d, m, issues }); else ok++;
  }
}
const kinds = {};
for (const r of rows) for (const i of r.issues) { const k = i.split(/[:(]/)[0].trim(); kinds[k] = (kinds[k] || 0) + 1; }
const md = `# Balayage carte par carte

${pool.length} cartes, ${ok} essais sans problème, ${rows.length} en échec (${((Date.now() - t0) / 1000).toFixed(0)} s).

| Problème | Nombre |
|---|---|
${Object.entries(kinds).sort((a, b) => b[1] - a[1]).map(([k, n]) => `| ${k} | ${n} |`).join('\n')}

| Carte | Type | Situation | Problème |
|---|---|---|---|
${rows.map(r => `| ${r.d.name} | ${r.d.type} | ${r.m === 'main' ? 'mon tour' : 'affrontement'} | ${r.issues.join(' ; ').replace(/\|/g, '/')} |`).join('\n')}
`;
fs.writeFileSync('sweep-report.md', md);
console.log(`${pool.length} cartes, ${ok} OK, ${rows.length} en échec`); console.log(kinds);
process.exitCode = rows.length ? 1 : 0;
