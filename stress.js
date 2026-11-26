// Stress test: a bot plays the human seat in MANUAL mode (pays by hand, readies/channels/draws by hand,
// resolves its combats by hand, resolves its own spells) against the real AI, on every deck pair.
// Reports games where nobody can act (stalls), actions the engine keeps refusing, and crashes.
// Usage: node stress.js [games per deck=2] [level=normal] [filter on deck name]
// Env: AUTO=1 both seats in auto mode (human bot also fires random abilities), DUP=1 fail on a card in two places,
// LEG=1 count legend triggers / abilities, D2=<name> fix the opponent deck, DBG / DBG2 debug output
const g = require('./game'), AI = require('./ai'), R = require('./rules');
const cards = require('./data/cards.json'), decks = require('./data/decks.json');
const other = p => (p === 'p1' ? 'p2' : 'p1');
const N = +process.argv[2] || 2, LEVEL = process.argv[3] || 'normal', FILTER = process.argv[4] || '';

// what a careful human does by hand on top of the AI's choices
function humanNext(s, me, mem) {
  const pl = s.players[me];
  if (AUTO) return (Math.random() < CHAOS ? chaosPlay(s, me) || chaosActivate(s, me) : null) || AI.next(s, me, 'normal', mem); // auto mode: the engine pays and resolves
  if (mem.hq && mem.hq.length) return mem.hq.shift(); // my own queue: chores / manual payment, then the card
  if (s.stage === 'mulligan' && pl.mullNew) return { type: 'mullConfirm' };
  if (s.stage === 'main' && s.active === me && s.started === s.turn && mem.chores !== s.turn && !(s.chain || []).length && !s.showdown && !s.pending) {
    mem.chores = s.turn;
    const held = s.bfs.filter(b => b.ctrl === me).length;
    mem.hq = [{ type: 'readyAll' }, ...(held ? [{ type: 'score', delta: held, reason: 'tenir' }] : []), { type: 'channel', n: s.turn <= 2 && s.first !== me ? 3 : 2 }, { type: 'draw', n: 1 }];
    return mem.hq.shift();
  }
  // combats and conquests a manual player resolves by hand (the showdown is over)
  if (s.stage === 'main' && s.active === me && !(s.chain || []).length && !s.showdown && !s.pending) {
    const isU = c => g.cd(s, c).type === 'Unit';
    const i = s.bfs.findIndex(b => b.units[me].some(isU) && b.units[other(me)].some(isU));
    if (i >= 0) return { type: 'fight', bf: i, att: me };
    const j = s.bfs.findIndex(b => b.units[me].some(isU) && !b.units[other(me)].length && b.ctrl !== me);
    if (j >= 0) return { type: 'conquer', bf: j };
  }
  // like a human: sometimes any card, with any targets, at any legal moment (even ones the AI would never play)
  let a = Math.random() < CHAOS ? chaosPlay(s, me) : null;
  if (!a) a = AI.next(s, me, 'normal', mem); // the human bot always plays at the normal level
  if (a && a.type === 'chainResolve' && Math.random() < 0.15) a = { ...a, apply: false };
  if (!a || a.type !== 'play') return a;
  // pay by hand: exhaust runes for Energy, recycle runes for Power (from hand / champion only)
  const f = g.find(s, a.iid);
  if (!f || !['hand', 'champion'].includes(f.zone)) return a;
  const plan = R.planCost(g.runesOf(s, me), null, R.cardCost(g.cd(s, f.c)));
  if (!plan) { if (process.env.DBG) console.log('cannot pay', g.cd(s, f.c).name, JSON.stringify(R.cardCost(g.cd(s, f.c))), JSON.stringify(g.runesOf(s, me)), JSON.stringify(s.players[me].pool));
    // can't pay for it: a human would just let the spell resolve / pass
    const top = (s.chain || [])[(s.chain || []).length - 1];
    if (top && top.cb.by !== me) return { type: 'chainPass' };
    if (s.showdown && s.showdown.focus === me && !top) return { type: 'pass' };
    return s.active === me && !top && !s.showdown ? { type: 'endTurn' } : null; }
  mem.hq = [...plan.ex.map(iid => ({ type: 'exhaust', iid, value: true })), ...plan.rc.map(iid => ({ type: 'recycle', iid })), a];
  return mem.hq.shift();
}

const CHAOS = +(process.env.CHAOS || 0.35), AUTO = !!process.env.AUTO;
// like a human in auto mode: any ready legend / unit / gear ability, random targets
function chaosActivate(s, me) {
  if (s.stage !== 'main' || s.pending || (s.chain || []).length) return null;
  const pl = s.players[me], cs = [...pl.zones.legend, ...pl.zones.base, ...s.bfs.flatMap(b => b.units[me])].filter(c => !c.ex);
  const opts = cs.flatMap(c => R.abilities(g.cd(s, c)).map(ab => ({ c, ab }))).filter(x => !g.abilityBlocked(s, me, x.c, x.ab));
  if (!opts.length) return null;
  const x = opts[Math.floor(Math.random() * opts.length)];
  const units = [...['p1', 'p2'].flatMap(p => s.players[p].zones.base), ...s.bfs.flatMap(b => [...b.units.p1, ...b.units.p2])];
  return { type: Math.random() < 0.15 && /[Empower]/.test(g.cd(s, x.c).text || '') ? 'empower' : 'activate', iid: x.c.iid, k: x.ab.i, targets: units.length ? [units[Math.floor(Math.random() * units.length)].iid] : [], bf: s.bfs.length ? Math.floor(Math.random() * s.bfs.length) : undefined };
}
function chaosPlay(s, me) {
  if (s.stage !== 'main' || s.pending) return null;
  const top = (s.chain || [])[(s.chain || []).length - 1];
  if (top && top.cb.by === me) return null;
  const mine = s.active === me && !top && !s.showdown;
  const hand = s.players[me].zones.hand.filter(c => { const d = g.cd(s, c), k = R.kw(d.text); return ['Unit', 'Spell', 'Gear'].includes(d.type) && (mine || k.reaction || (!top && k.action)) && R.planCost(g.runesOf(s, me), null, R.cardCost(d)); });
  if (!hand.length) return null;
  const c = hand[Math.floor(Math.random() * hand.length)], d = g.cd(s, c);
  const units = [...['p1', 'p2'].flatMap(p => s.players[p].zones.base), ...s.bfs.flatMap(b => [...b.units.p1, ...b.units.p2])].filter(u => g.cd(s, u).type === 'Unit');
  const n = d.type === 'Spell' ? Math.floor(Math.random() * 3) : 0;
  const targets = Array.from({ length: n }, () => units[Math.floor(Math.random() * units.length)]).filter(Boolean).map(u => u.iid);
  return { type: 'play', iid: c.iid, targets: [...new Set(targets)], bf: s.bfs.length ? Math.floor(Math.random() * s.bfs.length) : undefined };
}
function play(d1, d2, humanSeat) {
  const s = g.newState();
  s.seats = { p1: { name: 'Humain' }, p2: { name: 'IA' } };
  const ai = other(humanSeat);
  s.auto = AUTO ? { p1: true, p2: true } : { [ai]: true };
  g.apply(s, { type: 'start', cards, decks: { [humanSeat]: d1, [ai]: d2 } });
  const mem = { p1: {}, p2: {} }, refused = {};
  let steps = 0, stall = null, lastErr = null;
  while (!s.winner && s.turn < 40 && steps++ < 6000) {
    const first = s.pending ? s.pending.to : Math.random() < 0.3 ? humanSeat : s.active || 'p1', order = [first, other(first)];
    let acted = false;
    for (const p of order) {
      let a;
      try { a = p === humanSeat ? humanNext(s, p, mem[p]) : AI.next(s, p, LEVEL, mem[p]); }
      catch (e) { return { crash: `${p === ai ? 'IA' : 'humain'} next(): ${e.stack.split('\n').slice(0, 3).join(' | ')}`, s }; }
      if (!a) continue;
      let err;
      try { err = g.apply(s, { ...a, seat: p, p }); }
      catch (e) { return { crash: `apply ${JSON.stringify(a)}: ${e.stack.split('\n').slice(0, 3).join(' | ')}`, s }; }
      if (err) {
        const k = `${p === ai ? 'IA' : 'humain'} ${a.type}: ${err}`;
        if (process.env.DBG2 && err === 'carte introuvable' && p === ai) { const f = g.find(s, a.iid); console.log('DBG2', JSON.stringify(a), f && f.zone, f && g.cd(s, f.c).name, s.log.slice(-4).map(l => l.msg).join(' / ')); }
        refused[k] = (refused[k] || 0) + 1;
        mem[p].q = []; mem[p].hq = [];
        if (refused[k] > 25) { lastErr = k; break; }
        acted = true; // refused: the player chooses again next round
        break;
      }
      if (process.env.DUP) { const d = dupIid(s); if (d) return { crash: `doublon ${d} après ${JSON.stringify(a)} (${p === ai ? 'IA' : 'humain'}) | ${s.log.slice(-4).map(l => l.msg).join(' / ')}`, s }; }
      acted = true;
      break;
    }
    if (lastErr) { stall = 'boucle de refus : ' + lastErr; break; }
    if (!acted) { stall = describe(s, humanSeat); break; }
  }
  return { s, stall, refused, winner: s.winner, turn: s.turn };
}
function dupIid(s) {
  const seen = new Map();
  const add = (c, where) => { if (!c) return null; if (seen.has(c.iid)) return `${c.iid} (${g.cd(s, c).name}) : ${seen.get(c.iid)} et ${where}`; seen.set(c.iid, where); return null; };
  for (const p of ['p1', 'p2']) for (const [z, arr] of Object.entries(s.players[p].zones)) for (const c of arr) { const r = add(c, p + '.' + z); if (r) return r; }
  for (const [i, b] of s.bfs.entries()) { for (const p of ['p1', 'p2']) for (const c of b.units[p]) { const r = add(c, 'bf' + i + '.' + p); if (r) return r; } for (const c of b.hidden || []) { const r = add(c, 'bf' + i + '.hidden'); if (r) return r; } }
  for (const c of s.chain || []) { const r = add(c, 'pile'); if (r) return r; }
  return null;
}
function describe(s, hs) {
  const who = p => (p === hs ? 'humain' : 'IA');
  const top = (s.chain || []).map(c => `${g.cd(s, c).name}[${who(c.cb.by)}${c.cb.seen ? ',vu' : ''}]`).join(' > ');
  if (process.env.DBG) console.log(JSON.stringify((s.chain || []).map(c => ({ n: g.cd(s, c).name, owner: c.owner, cb: c.cb }))), JSON.stringify(s.showdown), hs, s.log.slice(-12).map(l => l.msg));
  return `tour ${s.turn} (${who(s.active)}) pile: ${top || '-'} | affrontement: ${s.showdown ? `bf${s.showdown.bf} focus ${who(s.showdown.focus)}` : '-'} | choix: ${s.pending ? `${s.pending.kind} pour ${who(s.pending.to)} (${s.pending.card})` : '-'}\n    ${s.log.slice(-5).map(l => l.msg).join('\n    ')}`;
}

const list = decks.filter(d => !FILTER || d.name.toLowerCase().includes(FILTER.toLowerCase()));
const out = { games: 0, stalls: [], crashes: [], refused: {}, wins: { humain: 0, IA: 0, aucun: 0 }, turns: 0, fx: {}, leg: {} };
// the log lines that show card interactions really happened
const FX = [['légendes déclenchées', /\(légende\) : capacité déclenchée/], ['sorts', / lance /], ['contres', /est contré/], ['capacités activées', /^⚡/], ['capacités déclenchées', /capacité déclenchée/], ['choix de cible', /choisit (une cible|le champ|un champ)/]];
const t0 = Date.now();
list.forEach((d1, i) => {
  for (let k = 0; k < N; k++) {
    const d2 = (process.env.D2 && decks.find(d => d.name.includes(process.env.D2))) || decks[(i * 7 + k * 13 + 1) % decks.length], hs = k % 2 ? 'p2' : 'p1';
    const r = play(d1, d2, hs);
    out.games++;
    if (r.crash) { out.crashes.push(`${d1.name} vs ${d2.name}: ${r.crash}`); continue; }
    if (r.stall) out.stalls.push(`${d1.name} (humain) vs ${d2.name} (IA): ${r.stall}`);
    for (const [k2, n] of Object.entries(r.refused)) out.refused[k2] = (out.refused[k2] || 0) + n;
    out.wins[r.winner ? (r.winner === hs ? 'humain' : 'IA') : 'aucun']++;
    out.turns += r.turn;
    for (const { msg } of r.s.log) { for (const [k2, re] of FX) if (re.test(msg)) out.fx[k2] = (out.fx[k2] || 0) + 1; const m = /↳ (.+?) \(légende\) : capacité|⚡ .+? active (.+?) :/.exec(msg); if (m) { const k3 = m[1] ? m[1] + " (passif)" : m[2]; out.leg[k3] = (out.leg[k3] || 0) + 1; } }
  }
});
console.log(`${out.games} parties en ${((Date.now() - t0) / 1000).toFixed(1)} s, ${(out.turns / out.games).toFixed(1)} tours en moyenne. Victoires :`, out.wins);
console.log('Effets joués :', out.fx);
if (process.env.LEG) console.log('Légendes / capacités :', Object.entries(out.leg).sort((a, b) => b[1] - a[1]).map(([k, n]) => k + ' ' + n).join(', '));
console.log(`\nBlocages (${out.stalls.length}) :`); for (const x of out.stalls.slice(0, 15)) console.log(' - ' + x);
console.log(`\nPlantages (${out.crashes.length}) :`); for (const x of out.crashes.slice(0, 10)) console.log(' - ' + x);
console.log('\nActions refusées le plus souvent :');
for (const [k, n] of Object.entries(out.refused).sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(`  ${n}× ${k}`);
process.exitCode = out.stalls.length || out.crashes.length ? 1 : 0;
