// Game state + reducer. Sandbox style: actions move cards, the players apply most rules themselves.
// Automated: rune payment ('play'), conquest on moving to an empty battlefield, combat resolution ('fight').
const R = require('./rules');
const SEATS = ['p1', 'p2'];
const ZONES = ['hand', 'main', 'runeDeck', 'runes', 'base', 'legend', 'champion', 'trash', 'banish'];
const HIDDEN_ZONES = ['main', 'runeDeck'];
const HISTORY_MAX = 60;

function newPlayer() {
  const z = {};
  for (const k of ZONES) z[k] = [];
  return { zones: z, score: 0, xp: 0, deckName: '', pool: newPool() };
}
// Rune pool: energy from runes exhausted by hand, power (by domain) from runes recycled by hand.
// 'play' spends it before paying the rest automatically. Emptied at the end of each turn.
const newPool = () => ({ e: 0, p: [] });

function newState() {
  return {
    phase: 'lobby', // lobby | playing
    seats: { p1: null, p2: null }, // { name, deckId }
    solo: false,
    players: { p1: newPlayer(), p2: newPlayer() },
    bfs: [],
    turn: 0, active: 'p1', first: 'p1',
    winScore: 8,
    log: [], history: [], seq: 0, iid: 0, rev: 0,
  };
}

const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const other = p => (p === 'p1' ? 'p2' : 'p1');

function mk(s, cid, owner) { return { iid: 'c' + ++s.iid, cid, owner, ex: false, dmg: 0, buff: 0, tb: 0, st: false, fd: false, rev: false }; }

const cd = (s, c) => (s.cd && s.cd[c.cid]) || {};
// effective might of a unit; role 'a' attacker (Assault), 'd' defender (Shield)
// equipment attached to a unit (gear stays listed in its controller's base, with att = unit iid)
const gearOn = (s, c) => SEATS.flatMap(p => s.players[p].zones.base.filter(g => g.att === c.iid && cd(s, g).type === 'Gear'));
function kwOf(s, c) {
  const k = { ...R.kw(cd(s, c).text) };
  for (const g of gearOn(s, c)) {
    const x = R.kw(cd(s, g).text);
    for (const n of ['assault', 'shield', 'hunt', 'deflect', 'disarm']) k[n] += x[n];
    for (const n of ['tank', 'ganking', 'backline']) k[n] = k[n] || x[n];
  }
  if (c.tg) k.ganking = true;
  const L = c.owner && legendOf(s, c.owner), ln = L && cd(s, L).name;
  if (ln === 'Rumble, Mechanized Menace' && (cd(s, c).tags || []).includes('Mech')) k.shield += 1;
  if (ln === 'Lucian, Purifier') k.assault += gearOn(s, c).filter(g => /\[Equip\]/.test(cd(s, g).text || '')).length;
  return k;
}
function hp(s, c, role) {
  const d = cd(s, c), k = kwOf(s, c);
  const eq = gearOn(s, c).reduce((t, g) => t + (cd(s, g).might || 0), 0);
  const perGear = /I have \+(\d+) :rb_might: for each friendly gear/.exec(d.text || ''); // Ornn, Forge God
  const own = perGear ? +perGear[1] * SEATS.flatMap(q => s.players[q].zones.base).filter(g => g.owner === c.owner && cd(s, g).type === 'Gear').length : 0;
  return Math.max(0, (d.might || 0) + own + eq + (c.buff || 0) + (c.tb || 0) + auraBonus(s, c, d) + (role === 'a' ? k.assault + (c.ta || 0) : role === 'd' ? k.shield + (c.ts || 0) : 0));
}
const lethal = (s, c) => (s.decree === s.turn && (c.dmg || 0) > 0 ? 1 : Math.max(1, hp(s, c)));
function auraBonus(s, c, d) {
  if (d.type !== 'Unit') return 0;
  let f = null;
  for (const p of SEATS) { if (s.players[p].zones.base.includes(c)) f = { p, bf: null }; s.bfs.forEach((b, i) => { if (b.units[p].includes(c)) f = { p, bf: i }; }); }
  if (!f) return 0;
  let n = 0;
  const xp = s.players[f.p].xp || 0;
  const srcs = [...s.players[f.p].zones.base.map(x => [x, null]), ...s.players[f.p].zones.legend.map(x => [x, null]), ...s.bfs.flatMap((b, i) => b.units[f.p].map(x => [x, i]))];
  for (const [src, at] of srcs) for (const a of R.auras(cd(s, src))) {
    if (a.who !== 'mine' || (a.level && xp < a.level) || (a.notSelf && src === c)) continue;
    if (a.here && (at == null || at !== f.bf)) continue;
    if ((a.tag && !(d.tags || []).includes(a.tag)) || (a.token && d.supertype !== 'Token')) continue;
    n += a.n;
  }
  const b = f.bf != null && s.bfs[f.bf].card;
  if (b) for (const a of R.auras(cd(s, b))) if (a.who === 'any' && (!a.champion || d.supertype === 'Champion')) n += a.n;
  const lg = legendOf(s, f.p) && cd(s, legendOf(s, f.p)).name, sd0 = s.showdown;
  if (lg === 'Master Yi, Wuju Bladesman' && sd0 && f.bf != null && sd0.bf === f.bf && sd0.att !== f.p && s.bfs[f.bf].units[f.p].length === 1) n += 2;
  if (lg === 'Master Yi, Wuju Master' && (s.players[f.p].xp || 0) >= 6) n += 1;
  // Ahri: an enemy unit attacking a battlefield I control gets -1 (to a minimum of 1)
  if (sd0 && f.bf != null && sd0.bf === f.bf && sd0.att === f.p && s.bfs[f.bf].ctrl === other(f.p)) { const al = legendOf(s, other(f.p)); if (al && cd(s, al).name === 'Ahri, Nine-Tailed Fox') n -= 1; }
  if (b) {
    const bn = cd(s, b).name, sd = s.showdown;
    if (bn === 'Kinkou Temple' && (kwOf(s, c).tank || c.tt)) n += 1;
    if (bn === 'Brush' && (d.tags || []).some(t => ['Bird', 'Cat', 'Dog', 'Poro', 'Ivern'].includes(t))) n += 1;
    if (bn === 'Forbidding Waste' && sd && sd.bf === f.bf && sd.att !== f.p && s.bfs[f.bf].units[f.p].length === 1) n -= 2;
  }
  return n;
}
const isToken = (s, c) => cd(s, c).supertype === 'Token';
function toTrash(s, c) {
  if (isToken(s, c) || c.reflect) return; // tokens (and Reflection copies) cease to exist outside the board
  Object.assign(c, { ex: false, dmg: 0, buff: 0, tb: 0, ta: 0, ts: 0, tt: false, st: false, fd: false, att: null, emp: false });
  s.players[c.owner].zones.trash.unshift(c);
}
// a permanent leaving the board: its equipment detaches (and stays in base)
function detach(s, c) { for (const g of gearOn(s, c)) g.att = null; c.att = null; }
// Scoring (rules 469-471): each battlefield scores at most once per player per turn.
// Final Point: conquering for the winning point requires having scored every battlefield this turn,
// otherwise the player draws a card instead. Hold is not restricted.
const scoredOf = (s, p) => ((s.scored || (s.scored = { p1: [], p2: [] }))[p]);
function conquer(s, b, p) {
  const bf = s.bfs[b], pl = s.players[p], nm = bf.card ? name(s, bf.card) : 'un champ de bataille';
  bf.ctrl = p;
  for (const c of bf.units[p].slice()) trigger(s, c, 'conquer', p, b);
  bfTrigger(s, b, 'conquer', p);
  legendTrigger(s, p, 'conquer', { bf: b });
  const sc = scoredOf(s, p);
  if (sc.includes(b)) { log(s, `${seatName(s, p)} reprend ${nm} (déjà marqué ce tour : pas de point).`); return; }
  sc.push(b);
  if (auto(s, p)) huntXp(s, b, p, 'conquête');
  if (pl.score >= s.winScore - 1 && !s.bfs.every((_, i) => sc.includes(i))) {
    const n = draw(s, p, 1);
    log(s, `⚔ ${seatName(s, p)} conquiert ${nm}. Point final : il faut avoir marqué chaque champ de bataille ce tour, ${seatName(s, p)} pioche ${n} carte à la place.`);
    return;
  }
  pl.score++;
  log(s, `⚔ ${seatName(s, p)} conquiert ${nm} (+1 point, total ${pl.score}).`);
  winCheck(s, p);
}
// Victory: at least the Victory Score and strictly more than the opponent
function winCheck(s, p) {
  const me = s.players[p].score, op = s.players[other(p)].score;
  if (me >= s.winScore && me > op && !s.winner) { s.winner = p; log(s, `🏆 ${seatName(s, p)} atteint ${me} points et gagne la partie !`); }
}
// a battlefield is only controlled while its controller has units there; a hidden card there is lost with control
function syncCtrl(s) {
  for (const b of s.bfs) {
    if (b.ctrl && !b.units[b.ctrl].length) b.ctrl = null;
    const h = b.hidden && b.hidden[0];
    if (h && b.ctrl !== h.owner) { b.hidden.splice(0); toTrash(s, h); log(s, `La carte cachée de ${seatName(s, h.owner)} (${name(s, h)}) est révélée et défaussée : champ de bataille perdu.`); }
  }
}
function kill(s, f) {
  if (f.c.retreat === s.turn && cd(s, f.c).type === 'Unit' && f.p) {
    f.arr.splice(f.i, 1); detach(s, f.c); Object.assign(f.c, { dmg: 0, ex: true, retreat: null }); s.players[f.p].zones.base.push(f.c);
    log(s, `${name(s, f.c)} échappe à la mort : soigné, épuisé et rappelé à la base (Tactical Retreat).`); return;
  }
  f.arr.splice(f.i, 1);
  detach(s, f.c);
  toTrash(s, f.c);
  log(s, `☠ ${name(s, f.c)} est détruit.`);
  if (f.p && cd(s, f.c).type === 'Unit' && (f.zone === 'bf' || f.zone === 'base')) legendTrigger(s, other(f.p), 'enemyDies');
  trigger(s, f.c, 'deathknell', f.c.owner, f.zone === 'bf' ? f.bf : null);
  if (f.p && cd(s, f.c).type === 'Unit') for (const u of mineOnBoard(s, f.p)) trigger(s, u, 'allyDies', f.p, null);
}
const mineOnBoard = (s, p) => [...s.players[p].zones.base, ...s.players[p].zones.legend, ...s.bfs.flatMap(b => b.units[p])];
// A unit's triggered ability: its effects are queued like play effects (choices become prompts).
const BF_EV = { conquer: 'conquête', hold: 'tenir', defend: 'défense', combat: 'combat', begin: 'début de tour', beginAll: 'début de tour', firstBegin: 'premier tour', hide: 'carte cachée' };
const bfName = (s, b) => (s.bfs[b] && s.bfs[b].card ? cd(s, s.bfs[b].card).name : '');
// A battlefield's ability: always written in the log; applied by the engine in auto mode, by hand otherwise.
function bfTrigger(s, b, ev, p) {
  const bf = s.bfs[b]; if (!bf || !bf.card) return;
  const d = cd(s, bf.card), fx = (R.BF_FX[d.name] || {})[ev];
  if (!fx || !fx.length) return;
  if (!auto(s, p)) { log(s, `↳ ${d.name} (${BF_EV[ev]}, ${seatName(s, p)}) : « ${d.text} » À appliquer à la main.`); return; }
  log(s, `↳ ${d.name} (${BF_EV[ev]}, ${seatName(s, p)}) : effet du champ de bataille.`);
  (s.fxQueue || (s.fxQueue = [])).push(...fx.map(e => ({ ...e, by: p, card: d.name, src: bf.card.iid, bfAt: b })));
  if (!s.fxRun) runFx(s);
}
// A legend's passive ability: written in the log; applied by the engine in auto mode, by hand otherwise.
const legendOf = (s, p) => s.players[p].zones.legend[0];
function legendTrigger(s, p, ev, ctx = {}) {
  const L = legendOf(s, p); if (!L) return;
  const d = cd(s, L), fx = ((R.LEGEND_FX || {})[d.name] || {})[ev];
  if (!fx || !fx.length) return;
  const q = fx.map(e => ({ ...e, by: p, card: d.name, src: L.iid, bfAt: ctx.bf, ctxCost: ctx.cost, ctxMighty: ctx.mighty }));
  const could = e => (!e.exMe || !L.ex) && (!e.cond || e.cond === 'oncePerTurn' || mayCond(s, p, e));
  if (!q.some(could)) return; // nothing would happen: no log line
  if (!auto(s, p)) { log(s, `↳ ${d.name} (légende) : « ${d.text} » À appliquer à la main.`); return; }
  log(s, `↳ ${d.name} (légende) : capacité déclenchée.`);
  (s.fxQueue || (s.fxQueue = [])).push(...q);
  if (!s.fxRun) runFx(s);
}
// can player p use this optional ("you may") effect now?
function mayCond(s, p, e) {
  const here = e.bfAt != null && s.bfs[e.bfAt] ? s.bfs[e.bfAt].units[p].filter(c => cd(s, c).type === 'Unit') : [];
  switch (e.cond) {
    case 'hand': return s.players[p].zones.hand.length > 0;
    case 'runes<=4': return runesOf(s, p).length <= 4;
    case 'mightyHere': return here.some(c => hp(s, c) >= 5);
    case 'buffed': return unitsOf(s, p).some(c => c.buff > 0);
    case 'unitsHere': return here.length > 0;
    case 'gear3': return s.players[p].zones.base.filter(g => cd(s, g).type === 'Gear' && g.iid !== e.src).length >= 3;
    case 'runes7': return runesOf(s, p).length >= 7;
    case 'otherMight5': return unitsOf(s, p).filter(c => c.iid !== e.src).reduce((t, c) => t + hp(s, c), 0) >= 5;
    case 'poro': return unitsOf(s, p).some(c => c.iid !== e.src && (cd(s, c).tags || []).includes('Poro'));
    case 'legion': return !!e.legion;
    case 'oppNear': return s.players[other(p)].score >= s.winScore - 3;
    case 'notMyTurn': return s.active !== p;
    case 'runeDeckEmpty': return !s.players[p].zones.runeDeck.length;
    case 'paidExtra': return !!e.paidExtra;
    case 'units4here': return e.bfAt != null && s.bfs[e.bfAt].units[p].filter(c => cd(s, c).type === 'Unit').length >= 4;
    case 'legendEx': { const L = legendOf(s, p); return !!L && L.ex; }
    case 'handUnitsHere': return s.players[p].zones.hand.length > 0 && here.length > 0;
    case 'hand<=1': return s.players[p].zones.hand.length <= 1;
    case 'cost5': return (e.ctxCost || 0) >= 5;
    case 'cost7': return (e.ctxCost || 0) >= 7;
    case 'mightyPlayed': return !!e.ctxMighty;
    case 'oncePerTurn': { const k = 'once:' + e.card; if ((s.onceT || {})[k] === s.turn) return false; (s.onceT || (s.onceT = {}))[k] = s.turn; return true; }
    case 'xp6': return (s.players[p].xp || 0) >= 6;
    case 'showHidden': return s.players[p].zones.hand.some(c => R.kw(cd(s, c).text).hidden);
    case 'hasGear': return s.players[p].zones.base.some(g => cd(s, g).type === 'Gear' && /\[Equip\]/.test(cd(s, g).text || ''));
    default: return true;
  }
}
const EV = { attack: 'attaque', defend: 'défend', conquer: 'conquête', hold: 'tient', move: 'déplacement', deathknell: 'à sa mort (Deathknell)', playSpell: 'sort joué', playUnit: 'unité jouée', allyDies: 'unité alliée détruite' };
function trigger(s, c, ev, p, bf) {
  if (cd(s, c).type === 'Unit') for (const g of gearOn(s, c)) trigger(s, g, ev, p, bf); // gear only: no loop
  const d = cd(s, c), fx = R.triggerFx(d, ev);
  if (!fx.length) return;
  log(s, `↳ ${d.name} (${EV[ev] || ev}) : capacité déclenchée.`);
  (s.fxQueue || (s.fxQueue = [])).push(...fx.map(e => ({ ...e, by: p, card: d.name, src: c.iid, bfAt: bf })));
  if (!s.fxRun) runFx(s);
}
// Token instances: an official token card when one exists (Recruit, Bird, Sprite, Gold), otherwise a drawn one.
function tokenCid(s, nm) {
  const ids = Object.keys(s.cd).filter(id => s.cd[id].supertype === 'Token' && s.cd[id].name === nm);
  return ids.sort((a, b) => (a.startsWith('tok-') ? 1 : 0) - (b.startsWith('tok-') ? 1 : 0))[0] || null;
}
// e: {name, n, ready, ex}; bf: battlefield index or null (base)
function makeTokens(s, p, e, bf, why) {
  const cid = tokenCid(s, e.name);
  if (!cid) return 0;
  const unit = s.cd[cid].type === 'Unit';
  const dest = bf != null && s.bfs[bf] ? s.bfs[bf].units[p] : s.players[p].zones.base;
  for (let i = 0; i < (e.n || 1); i++) { const c = mk(s, cid, p); c.ex = e.ex || (unit && !e.ready); dest.push(c); }
  log(s, `${seatName(s, p)} crée ${e.n > 1 ? e.n + ' jetons' : 'un jeton'} ${e.name}${bf != null && s.bfs[bf] ? ' sur le champ de bataille' : ' dans sa base'}${why ? ` (${why})` : ''}.`);
  if (bf != null && s.bfs[bf] && unit) arrive(s, bf, p, true);
  return e.n;
}
// buff: +1 Might if the unit has no buff yet (a unit holds at most one buff)
function buff(s, c) { if (!(c.buff > 0)) c.buff = (c.buff || 0) + 1; log(s, `${name(s, c)} reçoit un buff (+1 force).`); }
// [Hunt N]: gain N XP when the unit conquers or holds
function huntXp(s, b, p, why) {
  const xp = s.bfs[b].units[p].reduce((t, c) => t + kwOf(s, c).hunt, 0);
  if (xp) { s.players[p].xp = (s.players[p].xp || 0) + xp; log(s, `${seatName(s, p)} gagne ${xp} XP (Hunt, ${why}).`); }
}
// unit arrives at a battlefield: empty of enemies -> conquer, otherwise a showdown is pending
function arrive(s, b, side, quiet) {
  const bf = s.bfs[b];
  if (!bf.units[other(side)].length) {
    if (bf.ctrl === side) return;
    if (auto(s, side)) conquer(s, b, side);
    else if (!quiet) log(s, `↳ ${bf.card ? name(s, bf.card) : 'Champ de bataille'} libre : prenez-en le contrôle à la main (⚑, +1 point).`);
  } else { if (s.sdDone) s.sdDone = s.sdDone.filter(i => i !== b); openShowdown(s, b, side); }
}
// Seats played by the AI: they pay and resolve their card effects automatically. Humans do it by hand.
const auto = (s, p) => !!(s.auto && s.auto[p]);
// Showdown (rules 341-348, 464): units of both players at a battlefield. The attacker gets Focus first;
// the player with Focus plays an [Action]/[Reaction] or passes. Two passes in a row -> combat damage.
function openShowdown(s, b, att) {
  if (s.showdown) return; // one at a time; the others open once this one is over
  const bf = s.bfs[b];
  s.showdown = { bf: b, att, focus: att, passes: 0, fresh: true, last: null };
  log(s, `⚔ Affrontement sur ${bf.card ? name(s, bf.card) : 'le champ de bataille'} : ${seatName(s, att)} attaque. Chacun peut jouer des cartes [Action]/[Reaction], puis passer.`);
  for (const c of bf.units[att].slice()) trigger(s, c, 'attack', att, b);
  for (const c of bf.units[other(att)].slice()) trigger(s, c, 'defend', other(att), b);
  bfTrigger(s, b, 'defend', other(att));
  bfTrigger(s, b, 'combat', att);
}
function closeShowdown(s) {
  const sd = s.showdown; s.showdown = null;
  const bf = s.bfs[sd.bf], both = bf.units[sd.att].some(c => cd(s, c).type === 'Unit') && bf.units[other(sd.att)].some(c => cd(s, c).type === 'Unit');
  (s.sdDone || (s.sdDone = [])).push(sd.bf);
  if (!auto(s, sd.att)) log(s, both ? '↳ Combat à résoudre à la main (dégâts, morts, contrôle). Le bouton ⚔ fait le calcul si vous le souhaitez.' : '↳ Fin de l’affrontement : contrôle et points à la main.');
  else if (both) act(s, { type: 'fight', bf: sd.bf, att: sd.att }, sd.att);
  else if (bf.units[sd.att].length && !bf.units[other(sd.att)].length) { syncCtrl(s); if (bf.ctrl !== sd.att) conquer(s, sd.bf, sd.att); }
  nextShowdown(s);
}
// another battlefield still contested: the active player attacks there next
function nextShowdown(s) {
  if (s.showdown) return;
  const i = s.bfs.findIndex((b, k) => !(s.sdDone || []).includes(k) && b.units.p1.some(c => cd(s, c).type === 'Unit') && b.units.p2.some(c => cd(s, c).type === 'Unit'));
  if (i >= 0) openShowdown(s, i, s.active);
}
// Resolve the top of the stack. AI cards: full effects. Human cards: only what the opponent decides or reveals.
function resolveTop(s) {
  const c = s.chain.pop(), cb = c.cb, d = cd(s, c), p = cb.by;
  delete c.cb;
  if (cb.flow || /Banish this\./.test(d.text || '')) s.players[c.owner].zones.banish.unshift(c);
  else if (cb.recycle) s.players[c.owner].zones.main.push(c); else toTrash(s, c);
  log(s, `${d.name} (${seatName(s, p)}) se résout.`);
  let fx = R.playFx(d, { legion: cb.legion, xp: s.players[p].xp || 0 });
  if (cb.apply === false) fx = fx.filter(e => e.who === 'opp');
  else if (cb.repeat) fx = [...fx, ...fx.map(e => ({ ...e, grp: 1 }))];
  (s.fxPre || (s.fxPre = {}))[c.iid] = (cb.targets || []).slice();
  if ((cb.targets || []).length) (s.fxDeclared || (s.fxDeclared = {}))[c.iid] = true;
  s.fxQueue = [...fx.map(e => ({ ...e, by: p, card: d.name, src: c.iid, preBf: cb.bf })), ...(s.fxQueue || [])];
  runFx(s);
  if (s.chain.length) s.chain[s.chain.length - 1].cb.seen = false;
  // stack empty during a showdown: Focus goes to the other player (rule 346)
  if (!s.chain.length && s.showdown) { s.showdown.focus = other(s.showdown.last || p); s.showdown.passes = 0; }
  return null;
}
// units of p at the location of the effect's source card ("here")
function hereUnits(s, e, p) {
  const f = e.src && find(s, e.src), at = e.bfAt != null ? e.bfAt : f && f.zone === 'bf' ? f.bf : null;
  return (at != null ? s.bfs[at].units[p] : s.players[p].zones.base).filter(c => cd(s, c).type === 'Unit');
}
const unitsOf = (s, p) => [...s.players[p].zones.base, ...s.bfs.flatMap(b => b.units[p])].filter(c => cd(s, c).type === 'Unit');
// Resolve queued play effects in order; stop at the first one that needs a player's choice.
function runFx(s) {
  s.fxRun = true;
  try { runFxLoop(s); } finally { s.fxRun = false; }
  if (!s.pending && !(s.fxQueue && s.fxQueue.length)) { delete s.fxPre; delete s.fxDeclared; delete s.fxMark; delete s.fxHit; }
}
function runFxLoop(s) {
  while (s.fxQueue && s.fxQueue.length && !s.pending) {
    const e = s.fxQueue.shift(), to = e.who === 'self' ? e.by : other(e.by), T = seatName(s, to);
    if (e.ifHidden && !e.fromHidden) continue; // "when you play me from face down"
    if (e.cond && e.kind !== 'may' && !mayCond(s, to, e)) continue;
    if (e.kind === 'draw') { const n = draw(s, to, e.n + (e.per === 'bfCtrl' || e.per === 'bfCtrlOther' ? s.bfs.filter((b, i) => b.ctrl === to && !(e.per === 'bfCtrlOther' && i === e.bfAt)).length : e.per === 'mighty' ? unitsOf(s, to).filter(c => hp(s, c) >= 5).length : 0)); log(s, `${T} pioche ${n} (${e.card}).`); }
    else if (e.kind === 'reveal') { for (const c of s.players[to].zones.hand) c.rev = true; log(s, `${T} révèle sa main (${e.card}).`); }
    else if (e.kind === 'token') makeTokens(s, to, e, e.here ? e.bfAt : null, e.card);
    else if (e.kind === 'counter') { // counter the spell just below on the stack
      const t = s.chain && s.chain[s.chain.length - 1];
      if (!t) continue;
      const td = cd(s, t), tp = td.power || 0, te = td.energy || 0;
      const mine = (t.cb.targets || []).some(id => { const f = find(s, id); return f && f.p === e.by; });
      if ((e.maxE != null && te > e.maxE) || (e.maxP != null && tp > e.maxP) || (e.minP != null && tp < e.minP) || (e.mine && !mine)) { log(s, `${e.card} : ${td.name} ne peut pas être contré ainsi.`); continue; }
      s.chain.pop(); delete t.cb; toTrash(s, t); log(s, `${name(s, t)} est contré (${e.card}).`);
    }
    else if (e.kind === 'target') {
      let opts = candidates(s, to, e).filter(id => !deflectBlocked(s, to, id) && !(e.op === 'duel' && id === s.fxMark));
      // "different units" / "at the same location": compared with the units this card already chose
      const hit = (s.fxHit || {})[e.src + '#' + (e.grp || 0)];
      if (hit && e.distinct) opts = opts.filter(id => !hit.ids.includes(id));
      if (hit && e.sameLoc && hit.loc) opts = opts.filter(id => locOf(s, id) === hit.loc);
      if (hit && e.diffLoc) opts = opts.filter(id => !(hit.locs || []).includes(locOf(s, id)));
      if (!opts.length) { log(s, `${e.card} : aucune cible valide.`); continue; }
      const pre = s.fxPre && s.fxPre[e.src], k = pre ? pre.findIndex(id => opts.includes(id)) : -1;
      const lost = pre && k < 0 ? pre.findIndex(id => String(id).startsWith('gone:')) : -1;
      if (lost >= 0) { pre.splice(lost, 1); log(s, `${e.card} : sa cible n’est plus en jeu.`); continue; }
      // declared targets first; once they are used up an optional target is skipped; a single legal one is automatic
      const pick = k >= 0 ? pre.splice(k, 1)[0] : e.opt && (s.fxDeclared || {})[e.src] ? null : opts.length === 1 && !e.opt ? opts[0] : undefined;
      if (pick) { applyTarget(s, e, pick, to); continue; }
      if (pick === null) continue; // optional target, none declared
      s.pending = { kind: 'target', to, n: 1, by: e.by, card: e.card, fx: e, opts, opt: !!e.opt };
      log(s, `${T} choisit une cible (${e.card}).`);
    } else if (['aoe', 'bfBuff', 'bfRecall', 'foxfire', 'bulletTime'].includes(e.kind)) {
      const opts = s.bfs.map((b, i) => i).filter(i => (['aoe', 'foxfire', 'bulletTime'].includes(e.kind) ? s.bfs[i].units[other(to)].length : e.mine || e.kind === 'bfRecall' ? s.bfs[i].units[to].length : s.bfs[i].units.p1.length + s.bfs[i].units.p2.length));
      if (!opts.length) continue;
      const pick = opts.includes(e.preBf) ? e.preBf : opts.length === 1 ? opts[0] : null;
      if (pick != null) { bfEffect(s, e, pick, to); continue; }
      s.pending = { kind: 'bf', to, n: 1, by: e.by, card: e.card, fx: e, opts };
      log(s, `${T} choisit un champ de bataille (${e.card}).`);
    } else if (e.kind === 'aoeAll') {
      const sides = e.side === 'enemy' ? [other(to)] : SEATS, hit = [];
      if (e.scope === 'base') for (const q of sides) hit.push(...s.players[q].zones.base);
      else s.bfs.forEach((b, i) => { if (e.scope === 'bf' || (s.showdown && s.showdown.bf === i)) for (const q of sides) hit.push(...b.units[q]); });
      const us = hit.filter(c => cd(s, c).type === 'Unit');
      for (const c of us) c.dmg = (c.dmg || 0) + e.n;
      log(s, `${e.card} inflige ${e.n} à ${us.length} unité${us.length > 1 ? 's' : ''}.`);
      for (const c of us) if (c.dmg >= lethal(s, c)) { const f = find(s, c.iid); if (f) kill(s, f); }
      syncCtrl(s);
    } else if (e.kind === 'massBounce') {
      const list = SEATS.flatMap(p => unitsOf(s, p)).filter(c => hp(s, c) <= e.max);
      for (const c of list) applyTarget(s, { op: 'hand', card: e.card }, c.iid, to);
    } else if (e.kind === 'readyLegend') { for (const c of s.players[to].zones.legend) c.ex = false; log(s, `La légende de ${T} est redressée (${e.card}).`); }
    else if (e.kind === 'add') {
      const pool = s.players[to].pool || (s.players[to].pool = newPool());
      pool.e += e.cost.e; for (const x of e.cost.p) pool.p.push(x ? x[0] : 'any');
      log(s, `${T} ajoute ${costText(e.cost)} à sa réserve (${e.card}).`);
    } else if (e.kind === 'allKw') {
      for (const c of hereUnits(s, e, to).filter(c => !(e.notSelf && c.iid === e.src))) { if (e.kw === 'shield') c.ts = (c.ts || 0) + e.n; }
      log(s, `${e.card} : les autres unités de ${T} ici gagnent [Shield${e.n > 1 ? ' ' + e.n : ''}] ce tour.`);
    } else if (e.kind === 'readyAll' || e.kind === 'exhaustAll') {
      for (const c of unitsOf(s, to)) c.ex = e.kind === 'exhaustAll';
      log(s, `Les unités de ${T} sont ${e.kind === 'readyAll' ? 'redressées' : 'épuisées'} (${e.card}).`);
    } else if (e.kind === 'killGearAll') {
      for (const p of SEATS) for (const c of s.players[p].zones.base.filter(c => cd(s, c).type === 'Gear')) { const f = find(s, c.iid); if (f) kill(s, f); }
    } else if (e.kind === 'wheel') {
      for (const p of SEATS) { for (const c of s.players[p].zones.hand.splice(0)) toTrash(s, c); draw(s, p, e.n); }
      log(s, `Chaque joueur défausse sa main et pioche ${e.n} (${e.card}).`);
    } else if (e.kind === 'wipe') {
      for (const f of SEATS.flatMap(p => unitsOf(s, p)).map(c => find(s, c.iid))) kill(s, f);
      syncCtrl(s);
    } else if (e.kind === 'allMight') {
      const side = e.enemy ? other(to) : to;
      const us = (e.here ? hereUnits(s, e, side) : unitsOf(s, side)).filter(c => !(e.notSelf && c.iid === e.src));
      for (const c of us) { const n = e.min != null ? Math.max(e.n, Math.min(0, e.min - hp(s, c))) : e.n; c.tb = (c.tb || 0) + n; }
      log(s, `${e.enemy ? `Les unités adverses` : `Les ${e.notSelf ? 'autres ' : ''}unités de ${T}`}${e.here ? ' ici' : ''} gagnent ${e.n > 0 ? '+' : ''}${e.n} force ce tour (${e.card}).`);
    }
    else if (e.kind === 'channel') { const z = s.players[to].zones, k = channel(s, to, e.n); if (e.ex) z.runes.slice(-k).forEach(r => (r.ex = true)); log(s, `${T} canalise ${k} rune${k > 1 ? 's' : ''}${e.ex ? ' épuisée' + (k > 1 ? 's' : '') : ''} (${e.card}).`); }
    else if (e.kind === 'xp') { s.players[to].xp = (s.players[to].xp || 0) + e.n; log(s, `${T} gagne ${e.n} XP (${e.card}).`); }
    else if (e.kind === 'burn') { const k = burn(s, to, e.n); log(s, `${T} brûle ${k} carte${k > 1 ? 's' : ''} du dessus de son deck (${e.card}).`); }
    else if (e.kind === 'may') {
      if (!mayCond(s, to, e)) continue;
      if (e.exMe) { const f = e.src && find(s, e.src); if (!f || f.c.ex) continue; }
      if (e.pay && !R.planCost(runesOf(s, to), s.players[to].pool || newPool(), e.pay)) { log(s, `${e.card} : ${T} ne peut pas payer (${costText(e.pay)}).`); continue; }
      s.pending = { kind: 'confirm', to, n: 0, by: e.by, card: e.card, text: e.text, fx: e, ai: e.ai !== false };
      log(s, `${T} choisit d’utiliser ou non ${e.card}.`);
    }
    else if (e.kind === 'pick') {
      const z = s.players[to].zones, pool = e.from === 'top' ? z.main.slice(0, e.n) : z.trash, F = e.filter || {};
      const afford = c => e.then !== 'playPaid' || !auto(s, to) || !!R.planCost(runesOf(s, to), s.players[to].pool || newPool(), R.cardCost(cd(s, c)));
      const ok = c => { const d = cd(s, c); return afford(c) && ['Unit', 'Gear', 'Spell'].includes(d.type) && (!F.hidden || R.kw(d.text).hidden) && (!F.types || F.types.includes(d.type)) && (F.maxE == null || (d.energy || 0) <= F.maxE) && (F.maxP == null || (d.power || 0) <= F.maxP); };
      const cards = pool.filter(ok).map(c => c.iid);
      if (!cards.length) { log(s, `${e.card} : aucune carte possible.`); if (e.from === 'top') for (const c of z.main.splice(0, e.n)) z.main.push(c); continue; }
      s.pending = { kind: 'pick', to, n: 1, by: e.by, card: e.card, cards, from: e.from, fx: e, opt: true, top: e.from === 'top' ? pool.map(c => c.iid) : null };
      log(s, `${T} choisit une carte ${e.from === 'top' ? `parmi les ${pool.length} du dessus de son deck` : 'dans sa défausse'} (${e.card}).`);
    }
    else if (e.kind === 'readyRunes') { let k = 0; for (const r of s.players[to].zones.runes) if (r.ex && k < e.n) { r.ex = false; k++; } if (k) log(s, `${T} redresse ${k} rune${k > 1 ? 's' : ''} (${e.card}).`); }
    else if (e.kind === 'reflectHere') { // LeBlanc: a ready Reflection copy of the best other unit there, with [Temporary]
      const at = e.bfAt != null ? s.bfs[e.bfAt].units[to] : null; if (!at) continue;
      const best = at.filter(c => cd(s, c).type === 'Unit').sort((a, b) => hp(s, b) - hp(s, a))[0]; if (!best) continue;
      const cp = mk(s, best.cid, to); Object.assign(cp, { reflect: true, tmpT: true, ex: false }); at.push(cp);
      log(s, `${T} crée une copie de ${name(s, best)} (${e.card}).`);
    }
    else if (e.kind === 'decree') { s.decree = s.turn; log(s, `Ce tour, toute unité qui subit des dégâts est détruite (${e.card}).`); }
    else if (e.kind === 'freeHide') { s.freeHide = { p: to, turn: s.turn }; log(s, `${T} peut cacher des cartes sans payer ce tour (${e.card}).`); }
    else if (e.kind === 'spellDisc') { s.spellDisc = { p: to, turn: s.turn, n: e.n }; log(s, `Le prochain sort de ${T} ce tour coûte ${e.n} énergie de moins (${e.card}).`); }
    else if (e.kind === 'copiesOfMe') {
      const f = e.src && find(s, e.src); if (!f) continue;
      for (let i = 0; i < e.n; i++) { const cp = mk(s, f.c.cid, to); cp.reflect = true; (e.bfAt != null && s.bfs[e.bfAt] ? s.bfs[e.bfAt].units[to] : s.players[to].zones.base).push(cp); }
      log(s, `${T} crée ${e.n} copies de ${name(s, f.c)} (${e.card}).`);
    }
    else if (e.kind === 'extraTurn') { s.extraTurn = to; log(s, `${T} jouera un tour supplémentaire (${e.card}).`); }
    else if (e.kind === 'noSpellDmg') { s.noSpellDmg = s.turn; log(s, `Les dégâts des sorts et capacités sont prévenus ce tour (${e.card}).`); }
    else if (e.kind === 'sacGear') {
      for (const q of SEATS) { const g = s.players[q].zones.base.filter(x => cd(s, x).type === 'Gear').sort((a, b) => (cd(s, a).might || 0) - (cd(s, b).might || 0))[0]; if (g) kill(s, find(s, g.iid)); }
      syncCtrl(s);
    }
    else if (e.kind === 'arise') {
      const n = s.players[to].zones.base.filter(g => cd(s, g).type === 'Gear' && /\[Equip\]/.test(cd(s, g).text || '')).length;
      if (!n) continue;
      makeTokens(s, to, { name: 'Sand Soldier', n }, null, e.card);
      s.players[to].zones.base.slice(-n).slice(-2).forEach(c => (c.ex = false));
    }
    else if (e.kind === 'selfTemp') { const f = e.src && find(s, e.src); if (f) { f.c.tmpT = true; log(s, `${name(s, f.c)} gagne [Temporary] (${e.card}).`); } }
    else if (e.kind === 'counterUnless') { // counter the spell below unless its controller pays
      const t = s.chain && s.chain[s.chain.length - 1]; if (!t) continue;
      const c2 = t.cb.by, cost = { e: e.e, p: [] };
      if (auto(s, c2) && R.planCost(runesOf(s, c2), s.players[c2].pool || newPool(), cost) && pay(s, c2, cost)) { log(s, `${seatName(s, c2)} paie ${e.e} énergie : ${name(s, t)} n’est pas contré (${e.card}).`); continue; }
      s.chain.pop(); delete t.cb; toTrash(s, t); log(s, `${name(s, t)} est contré (${e.card}).`);
    }
    else if (e.kind === 'recycleSelf') {
      if (e.ifHidden && !e.fromHidden) continue;
      const f = e.src && find(s, e.src); if (!f || f.isBf) continue;
      f.arr.splice(f.i, 1); detach(s, f.c); Object.assign(f.c, { ex: false, dmg: 0, buff: 0, tb: 0, st: false, emp: false, fd: false });
      s.players[f.c.owner].zones.main.push(f.c); log(s, `${name(s, f.c)} est recyclé sous le deck de son propriétaire (${e.card}).`); syncCtrl(s);
    }
    else if (e.kind === 'equipBest') { // [Weaponmaster]: attach one of my Equipment to this unit, its Equip cost minus one power
      const u = e.src && find(s, e.src); if (!u) continue;
      const gear = s.players[to].zones.base.filter(g => cd(s, g).type === 'Gear' && /\[Equip\]/.test(cd(s, g).text || '') && g.att !== u.c.iid)
        .sort((a, b) => (!!a.att - !!b.att) || (cd(s, b).might || 0) - (cd(s, a).might || 0));
      for (const g of gear) {
        const cost = R.kwCost(cd(s, g).text, 'Equip') || { e: 0, p: [] }, less = { e: cost.e, p: cost.p.slice(1) };
        if (auto(s, to) && !pay(s, to, less)) continue;
        g.att = u.c.iid; log(s, `${name(s, g)} est attaché à ${name(s, u.c)} (${e.card}, Weaponmaster).`); break;
      }
    }
    else if (e.kind === 'recycleRune') {
      const z = s.players[to].zones; if (!z.runes.length) continue;
      const [r] = z.runes.splice(Math.max(0, z.runes.findIndex(x => x.ex)), 1); r.ex = false; z.runeDeck.push(r);
      log(s, `${T} recycle une rune (${e.card}).`);
    }
    else if (e.kind === 'readyRunesEnd') { const er = s.endReady || (s.endReady = {}); er[to] = (er[to] || 0) + e.n; log(s, `${T} redressera ${e.n} runes à la fin du tour (${e.card}).`); }
    else if (e.kind === 'scorePt') {
      if (e.cond === 'runeDeckEmpty' && s.players[to].zones.runeDeck.length) continue;
      s.players[to].score++; log(s, `${T} marque 1 point (${e.card}, total ${s.players[to].score}).`); winCheck(s, to);
    }
    else if (e.kind === 'champBack') {
      const z = s.players[to].zones, i = z.trash.findIndex(c => c.cid === s.players[to].champCid);
      if (z.champion.length || i < 0) continue;
      z.champion.push(...z.trash.splice(i, 1)); log(s, `${T} reprend son champion choisi depuis sa défausse (${e.card}).`);
    }
    else if (e.kind === 'unitsConquer') { for (const c of (s.bfs[e.bfAt] ? s.bfs[e.bfAt].units[to] : []).slice()) trigger(s, c, 'conquer', to, e.bfAt); }
    else if (e.kind === 'winIf') {
      const n = s.bfs[e.bfAt].units[to].filter(c => cd(s, c).type === 'Unit').length;
      if (n >= e.units && !s.winner) { s.winner = to; log(s, `🏆 ${T} a ${n} unités sur ${e.card} et gagne la partie !`); }
    }
    else if (e.kind === 'ravenbloom') {
      const z = s.players[to].zones, c = z.main.shift(); if (!c) continue;
      if (cd(s, c).type === 'Spell') { z.hand.push(c); log(s, `${T} révèle ${name(s, c)} : un sort, il va dans sa main (${e.card}).`); }
      else { z.main.push(c); log(s, `${T} révèle ${name(s, c)} et le recycle (${e.card}).`); }
    }
    else if (e.kind === 'aoeHere') {
      const b = s.bfs[e.bfAt], us = SEATS.flatMap(q => b.units[q]).filter(c => cd(s, c).type === 'Unit');
      if (!us.length) continue;
      for (const c of us) c.dmg = (c.dmg || 0) + e.n;
      log(s, `${e.card} inflige ${e.n} à chaque unité ici (${us.length}).`);
      for (const c of us) if (c.dmg >= lethal(s, c)) { const f = find(s, c.iid); if (f) kill(s, f); }
      syncCtrl(s);
    }
    else if (e.kind === 'spendBuff') { const c = unitsOf(s, to).find(x => x.buff > 0); if (!c) continue; c.buff = 0; log(s, `${T} dépense le buff de ${name(s, c)} (${e.card}).`); }
    else if (e.kind === 'predict') {
      const top = s.players[to].zones.main.slice(0, e.n);
      if (!top.length) continue;
      s.pending = { kind: 'predict', to, n: top.length, by: e.by, card: e.card, cards: top.map(c => c.iid) };
      log(s, `${T} regarde ${top.length > 1 ? `les ${top.length} cartes` : 'la carte'} du dessus de son deck (${e.card}).`);
    }
    else if (e.kind === 'buff') {
      if (e.me) { const f = e.src && find(s, e.src); if (f) buff(s, f.c); continue; }
      const units = unitsOf(s, to).filter(c => !(e.other && c.iid === e.src) && !(e.here && !(s.bfs[e.bfAt] && s.bfs[e.bfAt].units[to].includes(c))));
      if (!units.length) continue;
      if (units.length === 1) { buff(s, units[0]); continue; }
      s.pending = { kind: 'buff', to, n: 1, by: e.by, card: e.card, exclude: e.other ? e.src : null };
      log(s, `${T} choisit une unité à buffer (${e.card}).`);
    }
    else if (e.kind === 'discard') {
      const hand = s.players[to].zones.hand;
      if (!hand.length) continue;
      if (hand.length <= e.n) { for (const c of hand.splice(0)) toTrash(s, c); log(s, `${T} défausse toute sa main (${e.card}).`); continue; }
      s.pending = { kind: 'discard', to, n: e.n, by: e.by, card: e.card };
      log(s, `${T} doit défausser ${e.n} carte${e.n > 1 ? 's' : ''} (${e.card}).`);
    } else if (e.kind === 'sacrifice') {
      const units = unitsOf(s, to);
      if (!units.length) continue;
      if (units.length === 1) { kill(s, find(s, units[0].iid)); syncCtrl(s); continue; }
      s.pending = { kind: 'sacrifice', to, n: 1, by: e.by, card: e.card };
      log(s, `${T} doit détruire une de ses unités (${e.card}).`);
    }
  }
}

// Units (or gear) on the board that a targeted effect of player p may choose
function candidates(s, p, e) {
  const out = [];
  const take = (c, ctrl, where, bf) => {
    const d = cd(s, c);
    if (c.fd || (e.gear ? d.type !== 'Gear' : d.type !== 'Unit')) return;
    if (e.side === 'enemy' && ctrl === p) return;
    if (e.side === 'friendly' && ctrl !== p) return;
    if (ctrl !== p && /can't be chosen by enemy spells and abilities/i.test(d.text || '')) return;
    if (e.notSelf && c.iid === e.src) return;
    if (e.self && c.iid !== e.src) return;
    if (e.notHere && where === 'bf' && bf === e.bfAt) return;
    if (e.atMark) { const m = s.fxMark && find(s, s.fxMark); if (!m || m.c.iid === c.iid || (m.zone === 'bf' ? where !== 'bf' || bf !== m.bf : where !== 'base' || ctrl !== m.p)) return; }
    if (e.atBf && (e.bfAt == null || where !== 'bf' || bf !== e.bfAt)) return;
    if (e.crowd && (where !== 'bf' || s.bfs[bf].units.p1.length + s.bfs[bf].units.p2.length < e.crowd)) return;
    if (e.tag && !(d.tags || []).includes(e.tag)) return;
    if (e.where === 'bf' && where !== 'bf') return;
    if (e.where === 'base' && where !== 'base') return;
    if (e.where === 'here' && (where !== 'bf' || (e.bfAt != null && bf !== e.bfAt))) return;
    if (e.max != null && hp(s, c) > e.max) return;
    if (e.dom && !(d.domain || []).includes(e.dom)) return;
    const sd = s.showdown;
    if ((e.where === 'combat' || e.where === 'attacking') && !(sd && where === 'bf' && bf === sd.bf && (e.where === 'combat' || ctrl === sd.att))) return;
    out.push(c.iid);
  };
  for (const q of SEATS) for (const c of s.players[q].zones.base) take(c, q, 'base', null);
  s.bfs.forEach((b, i) => { for (const q of SEATS) for (const c of b.units[q]) take(c, q, 'bf', i); });
  return out;
}
// [Deflect N]: an opponent choosing this permanent must pay N extra Power (any domain)
function deflectBlocked(s, p, iid) {
  const f = find(s, iid);
  const n = f && f.p !== p ? kwOf(s, f.c).deflect : 0;
  return n ? !R.planCost(runesOf(s, p), s.players[p].pool, { e: 0, p: Array(n).fill(null) }) : false;
}
function payDeflect(s, p, iid) {
  const f = find(s, iid);
  const n = f && f.p !== p ? kwOf(s, f.c).deflect : 0;
  if (n && pay(s, p, { e: 0, p: Array(n).fill(null) })) log(s, `${seatName(s, p)} paie ${n} puissance (Deflect de ${name(s, f.c)}).`);
}
const locOf = (s, iid) => { const f = find(s, iid); return f ? (f.zone === 'bf' ? 'bf' + f.bf : f.zone === 'base' ? 'base:' + f.p : null) : null; };
function applyTarget(s, e, iid, p) {
  if (e.src) { // remember the units this card chose (different units / same location)
    const k = e.src + '#' + (e.grp || 0), h = (s.fxHit || (s.fxHit = {}))[k] || (s.fxHit[k] = { ids: [], loc: locOf(s, iid) });
    h.ids.push(iid); (h.locs || (h.locs = [])).push(locOf(s, iid));
  }
  payDeflect(s, p, iid);
  const f = find(s, iid); if (!f) return;
  const c = f.c, N = name(s, c), src = e.card ? ` (${e.card})` : '';
  if ((e.op === 'dmg' || e.op === 'dmgSplash') && s.noSpellDmg === s.turn) { log(s, `Dégâts prévenus (${e.card}).`); return; }
  if (e.op === 'dmg') { c.dmg = (c.dmg || 0) + e.n; log(s, `${N} subit ${e.n} dégât${e.n > 1 ? 's' : ''}${src}.`); }
  else if (e.op === 'kill') { kill(s, f); syncCtrl(s); return; }
  else if (e.op === 'stun') { c.st = true; log(s, `${N} est étourdi${src}.`); if (f.p && f.p !== p) legendTrigger(s, p, 'stunEnemy'); }
  else if (e.op === 'might' && e.perTags) { const n = e.perTags.filter(t => unitsOf(s, p).some(u => (cd(s, u).tags || []).includes(t))).length; c.tb = (c.tb || 0) + n; log(s, `${N} gagne +${n} force ce tour${src}.`); }
  else if (e.op === 'might') { let n = e.perEnemy ? e.n * (f.zone === 'bf' ? s.bfs[f.bf].units[other(f.p)].length : 0) : e.alone && f.zone === 'bf' && s.bfs[f.bf].units[f.p].length === 1 ? e.n + e.alone : e.n;
    if (e.min != null) n = Math.max(n, Math.min(0, e.min - hp(s, c))); c.tb = (c.tb || 0) + n; e = { ...e, n }; log(s, `${N} gagne ${e.n > 0 ? '+' : ''}${e.n} force ce tour${src}.`); }
  else if (e.op === 'ready') { c.ex = false; log(s, `${N} est redressé${src}.`); }
  else if (e.op === 'assault') { const n = e.n === 'might' ? hp(s, c) : e.n; c.ta = (c.ta || 0) + n; log(s, `${N} gagne [Assault ${n}] ce tour${src}.`); }
  else if (e.op === 'shield') { c.ts = (c.ts || 0) + e.n; if (e.tank) c.tt = true; log(s, `${N} gagne [Shield ${e.n}]${e.tank ? ' et [Tank]' : ''} ce tour${src}.`); }
  else if (e.op === 'double') { const n = hp(s, c); c.tb = (c.tb || 0) + n; log(s, `La force de ${N} est doublée ce tour (+${n})${src}.`); }
  else if (e.op === 'mark') { s.fxMark = c.iid; return; }
  else if (e.op === 'duelSelf') { const o = e.src && find(s, e.src); if (o && ['base', 'bf'].includes(o.zone)) duel(s, o, f); return; }
  else if (e.op === 'stunOrKill') { if (c.st) { kill(s, f); syncCtrl(s); return; } c.st = true; log(s, `${N} est étourdi${src}.`); }
  else if (e.op === 'duel') { const o = s.fxMark && find(s, s.fxMark); s.fxMark = null; if (o) duel(s, o, f); return; }
  else if (e.op === 'swap') { // Switcheroo: the two units' Mights are swapped this turn
    const o = s.fxMark && find(s, s.fxMark); s.fxMark = null; if (!o || o.c === c) return;
    const a = hp(s, o.c), b = hp(s, c);
    o.c.tb = (o.c.tb || 0) + b - a; c.tb = (c.tb || 0) + a - b;
    log(s, `${name(s, o.c)} et ${N} échangent leur force ce tour (${b} et ${a})${src}.`); return;
  }
  else if (e.op === 'swapPlaces') { // Tideturner: I go where that unit is, it goes where I was
    const me = e.src && find(s, e.src); if (!me || !['base', 'bf'].includes(me.zone) || !['base', 'bf'].includes(f.zone)) return;
    const la = me.zone === 'bf' ? me.bf : 'base', lb = f.zone === 'bf' ? f.bf : 'base';
    if (la === lb) return;
    placeUnit(s, me.c.iid, lb, { op: 'moveTo', card: e.card }); placeUnit(s, c.iid, la, { op: 'moveTo', card: e.card }); return;
  }
  else if (e.op === 'steal') { // Akshan: an enemy gear comes to my base (attached to me if it's an Equipment)
    f.arr.splice(f.i, 1); c.att = null; s.players[p].zones.base.push(c);
    if (/\[Equip\]/.test(cd(s, c).text || '') && e.src && find(s, e.src)) c.att = e.src;
    log(s, `${seatName(s, p)} prend le contrôle de ${N}${src}.`); return;
  }
  else if (e.op === 'retreat') { c.retreat = s.turn; log(s, `${N} sera soigné et rappelé au lieu de mourir ce tour${src}.`); }
  else if (e.op === 'alpha') { // its Might split among enemy units at battlefields: kill the most, 1 XP each
    let n = hp(s, c), xp = 0;
    const en = s.bfs.flatMap(b => b.units[other(f.p)]).filter(x => cd(s, x).type === 'Unit').sort((x, y) => (lethal(s, x) - (x.dmg || 0)) - (lethal(s, y) - (y.dmg || 0)));
    if (s.noSpellDmg === s.turn) return log(s, `Dégâts prévenus${src}.`);
    for (const x of en) { const need = lethal(s, x) - (x.dmg || 0); if (need > n) break; n -= need; x.dmg = (x.dmg || 0) + need; const k = find(s, x.iid); if (k) { kill(s, k); xp++; } }
    if (xp) s.players[p].xp = (s.players[p].xp || 0) + xp;
    log(s, `${N} détruit ${xp} unité${xp > 1 ? 's' : ''} (+${xp} XP)${src}.`); syncCtrl(s); return;
  }
  else if (e.op === 'storm') {
    const opts = s.bfs.map((b, i) => i).filter(i => s.bfs[i].units[other(p)].length);
    if (!opts.length) return;
    if (opts.length === 1) return stormAt(s, { ...e, unit: c.iid }, opts[0], p);
    s.pending = { kind: 'bf', to: p, n: 1, by: e.by, card: e.card, fx: { ...e, unit: c.iid }, opts };
    log(s, `${seatName(s, p)} choisit le champ de bataille (${e.card}).`); return;
  }
  else if (e.op === 'takeover') { // Hostile Takeover: mine until the end of the turn, then recalled
    if (f.zone !== 'bf') return;
    f.arr.splice(f.i, 1); c.borrow = f.p; c.ex = false; s.bfs[f.bf].units[p].push(c);
    log(s, `${seatName(s, p)} prend le contrôle de ${N} jusqu’à la fin du tour${src}.`); syncCtrl(s); return;
  }
  else if (e.op === 'mirror') { const cp = mk(s, c.cid, p); Object.assign(cp, { reflect: true, tmpT: true, ex: false }); s.players[p].zones.base.push(cp); log(s, `${seatName(s, p)} crée une copie de ${N} dans sa base${src}.`); return; }
  else if (e.op === 'empTurn') { c.emp = !c.emp; c.empBack = !c.emp; log(s, `${N} ${c.emp ? 'devient' : 'n’est plus'} Empowered ce tour${src}.`); }
  else if (e.op === 'kwTurn') { c.tg = true; log(s, `${N} gagne [Ganking] ce tour${src}.`); }
  else if (e.op === 'setMight') { const n = e.n - hp(s, c); c.tb = (c.tb || 0) + n; log(s, `La force de ${N} devient ${e.n} ce tour${src}.`); }
  else if (e.op === 'tempo') { c.tmpT = true; log(s, `${N} gagne [Temporary]${src}.`); }
  else if (e.op === 'dmgSplash') {
    c.dmg = (c.dmg || 0) + e.n; log(s, `${N} subit ${e.n} dégâts${src}.`);
    const others = f.zone === 'bf' ? s.bfs[f.bf].units[f.p].filter(x => x !== c && cd(s, x).type === 'Unit') : [];
    for (const x of others) x.dmg = (x.dmg || 0) + e.splash;
    for (const x of [c, ...others]) if (x.dmg >= lethal(s, x)) { const k = find(s, x.iid); if (k) kill(s, k); }
    syncCtrl(s); return;
  }
  else if (e.op === 'deck') { f.arr.splice(f.i, 1); detach(s, c); Object.assign(c, { ex: false, dmg: 0, buff: 0, tb: 0, st: false, emp: false }); if (!isToken(s, c)) s.players[c.owner].zones.main.push(c); log(s, `${N} est placé sous le deck de son propriétaire${src}.`); syncCtrl(s); return; }
  else if (e.op === 'blink' || e.op === 'moveTo') {
    if (e.to === 'here' && (e.bfAt == null || !s.bfs[e.bfAt])) return;
    if (e.markMoved) s.fxMark = c.iid;
    const loc = e.to === 'here' ? e.bfAt : e.to === 'base' ? 'base' : e.to === 'same' ? (f.zone === 'bf' ? f.bf : 'base') : e.preBf != null && s.bfs[e.preBf] ? e.preBf : s.bfs.length === 1 ? 0 : null;
    if (loc != null) { placeUnit(s, c.iid, loc, e); return; }
    s.pending = { kind: 'bf', to: p, n: 1, by: e.by, card: e.card, fx: { ...e, unit: c.iid }, opts: s.bfs.map((b, i) => i) };
    log(s, `${seatName(s, p)} choisit le champ de bataille de ${N} (${e.card}).`);
    return;
  }
  else if (e.op === 'attach') { c.att = null; const g = e.src && find(s, e.src); if (g) { g.c.att = c.iid; log(s, `${name(s, g.c)} est attaché à ${N}${src}.`); } return; }
  else if (e.op === 'hand' || e.op === 'recall') {
    f.arr.splice(f.i, 1);
    if (e.op === 'recall') { s.players[f.p].zones.base.push(c); log(s, `${N} est rappelé dans sa base${src}.`); }
    else { detach(s, c); if (!isToken(s, c)) { Object.assign(c, { ex: false, dmg: 0, buff: 0, tb: 0, st: false, emp: false }); s.players[c.owner].zones.hand.push(c); } log(s, `${N} retourne dans la main de son propriétaire${src}.`); }
    syncCtrl(s); return;
  }
  if (cd(s, c).type === 'Unit' && (c.dmg || 0) >= lethal(s, c)) { kill(s, f); syncCtrl(s); }
}
// Two units deal damage equal to their Might to each other (Challenge, Rampage, duels).
function duel(s, f, g) {
  const m1 = hp(s, f.c), m2 = hp(s, g.c);
  f.c.dmg = (f.c.dmg || 0) + m2; g.c.dmg = (g.c.dmg || 0) + m1;
  log(s, `⚔ ${name(s, f.c)} (${m1}) et ${name(s, g.c)} (${m2}) s’infligent des dégâts égaux à leur force.`);
  for (const c of [f.c, g.c]) if (c.dmg >= lethal(s, c)) { const k = find(s, c.iid); if (k) kill(s, k); }
  syncCtrl(s);
}
// A unit is banished and played again (blink) or moved by a spell (moveTo) to a battlefield index or 'base'.
function placeUnit(s, iid, loc, e) {
  const f = find(s, iid); if (!f) return;
  const c = f.c, o = c.owner, N = name(s, c);
  f.arr.splice(f.i, 1);
  if (e.op === 'blink') {
    detach(s, c); Object.assign(c, { dmg: 0, buff: 0, tb: 0, ta: 0, ts: 0, tt: false, st: false, emp: false }); c.ex = !R.entersReady(cd(s, c));
    const gone = id => (id === iid ? 'gone:' + iid : id);
    for (const x of s.chain || []) if (x.cb) x.cb.targets = (x.cb.targets || []).map(gone);
    for (const k of Object.keys(s.fxPre || {})) s.fxPre[k] = s.fxPre[k].map(gone);
  }
  else if (e.ready) c.ex = false;
  if (loc === 'base') s.players[o].zones.base.push(c); else s.bfs[loc].units[o].push(c);
  const where = loc === 'base' ? 'sa base' : s.bfs[loc].card ? name(s, s.bfs[loc].card) : 'un champ de bataille';
  log(s, e.op === 'blink' ? `${N} est banni puis rejoué sur ${where} (${e.card}).` : `${N} se déplace vers ${where}${e.ready ? ' et se redresse' : ''} (${e.card}).`);
  syncCtrl(s);
  if (loc !== 'base') arrive(s, loc, o);
}
// effects that choose a battlefield
function bfEffect(s, e, b, p) {
  if (e.kind === 'aoe') return aoe(s, e, b, p);
  if (e.kind === 'target' && e.op === 'storm') return stormAt(s, e, b, p);
  if (e.kind === 'target') return placeUnit(s, e.unit, b, e);
  if (e.kind === 'foxfire') { // kill enemy units here with total Might 4 or less (the most of them)
    let left = 4; const dead = [];
    for (const c of s.bfs[b].units[other(p)].filter(x => cd(s, x).type === 'Unit').sort((x, y) => hp(s, x) - hp(s, y))) if (hp(s, c) <= left) { left -= hp(s, c); dead.push(c); }
    for (const c of dead) { const f = find(s, c.iid); if (f) kill(s, f); }
    log(s, `${e.card} détruit ${dead.length} unité${dead.length > 1 ? 's' : ''}.`); syncCtrl(s); return;
  }
  if (e.kind === 'bulletTime') { // pay X Power (as much as needed, as much as you can) to deal X to every enemy here
    const en = s.bfs[b].units[other(p)].filter(x => cd(s, x).type === 'Unit'); if (!en.length) return;
    const pl = s.players[p], can = runesOf(s, p).length + ((pl.pool || {}).p || []).length;
    const x = Math.min(can, Math.max(...en.map(c => lethal(s, c) - (c.dmg || 0))));
    if (x <= 0 || (auto(s, p) && !pay(s, p, { e: 0, p: Array(x).fill(null) }))) return;
    if (s.noSpellDmg === s.turn) return log(s, `Dégâts prévenus (${e.card}).`);
    for (const c of en) c.dmg = (c.dmg || 0) + x;
    log(s, `${seatName(s, p)} paie ${x} puissance : ${x} dégâts à chaque ennemi (${e.card}).`);
    for (const c of en) if (c.dmg >= lethal(s, c)) { const f = find(s, c.iid); if (f) kill(s, f); }
    syncCtrl(s); return;
  }
  if (e.kind === 'bfRecall') { // Emperor's Divide: my units at a battlefield go back to base
    const us = s.bfs[b].units[p].splice(0); s.players[p].zones.base.push(...us);
    log(s, `${us.length} unité${us.length > 1 ? 's' : ''} de ${seatName(s, p)} retourne${us.length > 1 ? 'nt' : ''} à la base (${e.card}).`); syncCtrl(s); return;
  }
  if (e.kind === 'bfBuff') {
    const bf = s.bfs[b];
    for (const c of bf.units[p]) { if (e.friendly) c.tb = (c.tb || 0) + e.friendly; if (e.shield) c.ts = (c.ts || 0) + e.shield; }
    for (const c of bf.units[other(p)]) if (e.enemy) c.tb = (c.tb || 0) + Math.max(e.enemy, 1 - hp(s, c));
    log(s, `${e.card} : ${[e.friendly && `alliés +${e.friendly} force`, e.shield && `alliés [Shield ${e.shield}]`, e.enemy && `ennemis ${e.enemy} force`].filter(Boolean).join(', ')} sur ${bf.card ? name(s, bf.card) : 'le champ de bataille'} ce tour.`);
  }
}
// Stormbringer: my unit deals its Might to every enemy at the battlefield, then moves there
function stormAt(s, e, b, p) {
  const f = find(s, e.unit); if (!f) return;
  const n = hp(s, f.c), en = s.bfs[b].units[other(p)].filter(x => cd(s, x).type === 'Unit');
  if (s.noSpellDmg !== s.turn) { for (const c of en) c.dmg = (c.dmg || 0) + n; log(s, `${name(s, f.c)} inflige ${n} à chaque ennemi (${e.card}).`); for (const c of en) if (c.dmg >= lethal(s, c)) { const k = find(s, c.iid); if (k) kill(s, k); } }
  placeUnit(s, e.unit, b, { op: 'moveTo', card: e.card });
}
function aoe(s, e, b, p) {
  const bf = s.bfs[b];
  for (const c of bf.units[other(p)].slice()) c.dmg = (c.dmg || 0) + e.n;
  log(s, `${e.card} inflige ${e.n} à toutes les unités ennemies sur ${bf.card ? name(s, bf.card) : 'le champ de bataille'}.`);
  for (const c of bf.units[other(p)].slice()) if (c.dmg >= lethal(s, c)) kill(s, find(s, c.iid));
  syncCtrl(s);
}
// Cost reductions printed on the card ("I cost 2 less", with [Legion] / [Level N] / "for each ..." conditions).
// Conditions not listed here are left to the players. Returns {e, p, min} or null.
function discount(s, p, d, legion) {
  const pl = s.players[p], z = pl.zones;
  let best = null;
  for (const sent of (d.text || '').replace(/\([^)]*\)/g, '').split(/(?<=\.)\s*/)) {
    const m = /^\s*(?:\[[^\]]*\]\s*)*(?:—\s*)?(?:I|This) costs? ((?::rb_(?:energy_\d+|rune_\w+):)+) less\b(.*)$/i.exec(sent);
    if (!m) continue;
    const lv = /\[Level (\d+)\]/i.exec(sent);
    if (lv && (pl.xp || 0) < +lv[1]) continue;
    if (/\[Legion\]/i.test(sent) && !legion) continue;
    const rest = m[2].replace(/,?\s*to a minimum of :rb_energy_\d+:|\s*instead/gi, '').replace(/[.\s]+$/, '');
    let k = 1, t;
    if (/for each card you've played this turn/i.test(rest)) k = (s.played && s.played[p]) || 0;
    else if (/for each card in your trash/i.test(rest)) k = z.trash.length;
    else if (/for each gear you control/i.test(rest)) k = z.base.filter(c => cd(s, c).type === 'Gear').length;
    else if (/for each exhausted unit you control/i.test(rest)) k = unitsOf(s, p).filter(c => c.ex).length;
    else if (/for each of your .*Mighty/i.test(rest)) k = unitsOf(s, p).filter(c => hp(s, c) >= 5).length;
    else if (/for each battlefield you've conquered this turn/i.test(rest)) k = scoredOf(s, p).length;
    else if ((t = /^if you control an? ([A-Z][\w']+)$/i.exec(rest.trim()))) k = unitsOf(s, p).some(c => (s.cd[c.cid] && (s.cd[c.cid].tags || []).includes(t[1])) || name(s, c) === t[1]) ? 1 : 0;
    else if (rest.trim()) continue; // other conditions: up to the players
    const c = R.parseCost(m[1]), mn = /to a minimum of :rb_energy_(\d+):/i.exec(m[2]);
    const v = { e: c.e * k, p: Array.from({ length: k }, () => c.p).flat(), min: mn ? +mn[1] : 0 };
    if (!best || v.e >= best.e) best = v; // a higher [Level] "instead" replaces the lower one
  }
  return best && (best.e || best.p.length) ? best : null;
}
// Pay a cost {e, p:[domains|null]} from the pool then runes. Returns true if paid.
function pay(s, p, cost) {
  const pl = s.players[p], pool = pl.pool || (pl.pool = newPool());
  const plan = R.planCost(runesOf(s, p), pool, cost);
  if (!plan) return false;
  const rz = pl.zones;
  for (const r of rz.runes) if (plan.ex.includes(r.iid)) r.ex = true;
  for (const id of plan.rc) { const i = rz.runes.findIndex(r => r.iid === id); const [r] = rz.runes.splice(i, 1); r.ex = false; rz.runeDeck.push(r); }
  pool.e -= plan.usedE;
  pool.p = pool.p.filter((_, i) => !plan.usedP.includes(i));
  return { e: plan.ex.length + plan.usedE, p: plan.rc.length + plan.usedP.length };
}
const costText = c => `${c.e} énergie${c.p.length ? ` + ${c.p.length} puissance ${[...new Set(c.p.map(x => (x ? x.join('/') : 'au choix')))].join(', ')}` : ''}`;
// Burn N: top cards of the Main Deck to the trash (Burn Out if empty)
function burn(s, p, n) {
  const z = s.players[p].zones;
  let k = 0;
  for (; k < n; k++) { if (!z.main.length) burnOut(s, p); if (!z.main.length) break; toTrash(s, z.main.shift()); }
  return k;
}
// Burn Out (431): shuffle the trash into the Main Deck, the opponent gains 1 point
function burnOut(s, p) {
  const z = s.players[p].zones, o = other(p);
  for (const c of z.trash.splice(0)) z.main.push(c);
  shuffle(z.main);
  s.players[o].score++;
  log(s, `🔥 Burn Out : le deck de ${seatName(s, p)} est vide. Sa défausse est mélangée dans son deck et ${seatName(s, o)} gagne 1 point (${s.players[o].score}).`);
  winCheck(s, o);
}

function runesOf(s, p) { return s.players[p].zones.runes.map(r => ({ iid: r.iid, ex: r.ex, dom: (cd(s, r).domain || [])[0] })); }

// locate a card instance anywhere
function find(s, iid) {
  for (const p of SEATS) for (const z of ZONES) {
    const arr = s.players[p].zones[z], i = arr.findIndex(c => c.iid === iid);
    if (i >= 0) return { arr, i, c: arr[i], p, zone: z };
  }
  for (let b = 0; b < s.bfs.length; b++) {
    const bf = s.bfs[b];
    if (bf.card && bf.card.iid === iid) return { c: bf.card, bf: b, isBf: true };
    for (const p of SEATS) {
      const arr = bf.units[p], i = arr.findIndex(c => c.iid === iid);
      if (i >= 0) return { arr, i, c: arr[i], bf: b, p, zone: 'bf' };
    }
    const hd = bf.hidden || [], i = hd.findIndex(c => c.iid === iid);
    if (i >= 0) return { arr: hd, i, c: hd[i], bf: b, p: hd[i].owner, zone: 'hidden' };
  }
  const k = (s.chain || []).findIndex(c => c.iid === iid);
  if (k >= 0) return { arr: s.chain, i: k, c: s.chain[k], p: s.chain[k].cb ? s.chain[k].cb.by : s.chain[k].owner, zone: 'chain' };
  return null;
}

function target(s, to) {
  if (to.bf != null) { const bf = s.bfs[to.bf]; return bf && bf.units[to.side]; }
  const pl = s.players[to.p];
  return pl && pl.zones[to.zone];
}

function name(s, c) { return cd(s, c).name || 'carte'; }
function seatName(s, p) { return (s.seats[p] && s.seats[p].name) || (p === 'p1' ? 'Joueur 1' : 'Joueur 2'); }
function log(s, msg) { s.log.push({ t: Date.now(), msg }); if (s.log.length > 200) s.log.shift(); }

const ZLABEL = { hand: 'main', main: 'deck', runeDeck: 'deck de runes', runes: 'réserve de runes', base: 'base', legend: 'zone légende', champion: 'zone champion', trash: 'défausse', banish: 'zone de bannissement' };

function draw(s, p, n) {
  const z = s.players[p].zones;
  let k = 0;
  let got = 0;
  for (; k < n && !s.winner; k++) {
    if (!z.main.length) burnOut(s, p); // empty deck: Burn Out, then draw anyway
    if (!z.main.length) continue;
    const c = z.main.shift(); c.fd = false; c.ex = false; z.hand.push(c); got++;
  }
  return got;
}
function channel(s, p, n) {
  const z = s.players[p].zones;
  let k = 0;
  for (; k < n && z.runeDeck.length; k++) { const c = z.runeDeck.shift(); c.ex = false; c.fd = false; z.runes.push(c); }
  return k;
}
function readyAll(s, p) {
  const all = [...Object.values(s.players[p].zones).flat(), ...s.bfs.flatMap(b => b.units[p])];
  for (const c of all) c.ex = false;
}

function setup(s, a) {
  const byId = {};
  for (const c of [...a.cards, ...R.SYNTH_TOKENS]) byId[c.id] = c;
  s.cd = {};
  s.bfOpts = {};
  s.winner = null;
  s.players = { p1: newPlayer(), p2: newPlayer() };
  s.bfs = [];
  const decks = { p1: a.decks.p1, p2: a.decks.p2 || a.decks.p1 };
  const keep = c => ({ name: c.name, type: c.type, supertype: c.supertype, energy: c.energy, power: c.power, might: c.might, domain: c.domain, text: c.text, tags: c.tags || [] });
  for (const c of Object.values(byId)) if (c.supertype === 'Token' && !c.alt) s.cd[c.id] = keep(c);
  for (const p of SEATS) {
    const d = decks[p];
    if (!d) return `Aucun deck pour ${seatName(s, p)}`;
    const pl = s.players[p];
    pl.deckName = d.name;
    const add = (list, zone) => {
      for (const { id, n } of list || []) {
        if (!byId[id]) continue;
        s.cd[id] = keep(byId[id]);
        for (let i = 0; i < n; i++) pl.zones[zone].push(mk(s, id, p));
      }
    };
    add(d.cards.legend, 'legend');
    add(d.cards.champion, 'champion');
    pl.champCid = ((d.cards.champion || [])[0] || {}).id;
    add(d.cards.main, 'main');
    add(d.cards.runes, 'runeDeck');
    shuffle(pl.zones.main);
    shuffle(pl.zones.runeDeck);
    // battlefield: one random among the deck's battlefields
    // each player will pick one of their deck's battlefields
    s.bfOpts[p] = [...new Set((d.cards.battlefields || []).filter(x => byId[x.id]).map(x => x.id))];
    for (const id of s.bfOpts[p]) s.cd[id] = keep(byId[id]);
  }
  // pre-game: battlefield pick -> parity call + die roll -> simultaneous mulligan
  s.stage = 'bf';
  s.bfPick = { p1: null, p2: null };
  // vs AI the human always calls and rolls; between humans the caller is random
  s.dice = { caller: SEATS.includes(a.caller) ? a.caller : Math.random() < 0.5 ? 'p1' : 'p2', call: null, roll: null, winner: null };
  s.first = null; s.active = null;
  s.turn = 0;
  s.history = [];
  s.log = [];
  s.phase = 'playing';
  log(s, 'Choix des champs de bataille : chaque joueur en choisit un parmi les 3 de son deck.');
  for (const p of SEATS) if (s.bfOpts[p].length <= 1) s.bfPick[p] = s.bfOpts[p][0] || 'none';
  afterBfPick(s);
  return null;
}

function afterBfPick(s) {
  if (!s.bfPick.p1 || !s.bfPick.p2) return;
  s.bfs = SEATS.map(p => ({ card: s.bfPick[p] === 'none' ? null : mk(s, s.bfPick[p], p), units: { p1: [], p2: [] }, ctrl: null, hidden: [] }));
  for (const p of SEATS) if (s.bfs[SEATS.indexOf(p)].card) log(s, `${seatName(s, p)} choisit ${name(s, s.bfs[SEATS.indexOf(p)].card)}.`);
  if (s.bfs.some((b, i) => bfName(s, i) === "Aspirant's Climb")) { s.winScore++; log(s, `Aspirant's Climb : il faut ${s.winScore} points pour gagner.`); }
  s.stage = 'dice';
  log(s, `Qui commence ? ${seatName(s, s.dice.caller)} choisit pair ou impair.`);
}

// Start of turn, automatic: Awaken (ready units, gear, runes) -> Beginning (Temporary dies, then hold scores)
// -> Channel 2 runes (3 on the second player's first turn) -> Draw 1.
function startTurn(s, p) {
  const W = seatName(s, p);
  s.scored = { p1: [], p2: [] }; // each battlefield scores once per player per turn
  s.played = { p1: 0, p2: 0 };   // cards played this turn ([Legion])
  s.sdDone = [];
  s.bfs.forEach((b, i) => {
    bfTrigger(s, i, 'beginAll', p);
    if (b.units[p].length) bfTrigger(s, i, 'begin', p);
    if (!s.players[p].begun) bfTrigger(s, i, 'firstBegin', p);
  });
  s.players[p].begun = true;
  legendTrigger(s, p, 'begin');
  if (!auto(s, p)) { // manual mode: the player readies, scores holds, channels and draws by hand
    const second = s.turn <= 2 && p !== s.first && !s.players[p].channeledBonus;
    if (second) s.players[p].channeledBonus = true;
    const held = s.bfs.filter(b => b.ctrl === p).length;
    log(s, `— Tour ${s.turn} · ${W} : à vous de redresser, ${held ? `marquer ${held} point${held > 1 ? 's' : ''} (tenir), ` : ''}canaliser ${second ? 3 : 2} runes et piocher 1 carte.`);
    s.started = s.turn;
    s.bfs.forEach((b, i) => { if (b.ctrl === p) { for (const c of b.units[p].slice()) trigger(s, c, 'hold', p, i); bfTrigger(s, i, 'hold', p); legendTrigger(s, p, 'hold', { bf: i }); } });
    return;
  }
  readyAll(s, p);
  for (const c of [...s.players[p].zones.base, ...s.bfs.flatMap(b => b.units[p])]) {
    if (R.kw(cd(s, c).text).temporary || c.tmpT) { if (!auto(s, p)) { log(s, `↳ ${name(s, c)} est Temporary : à détruire à la main.`); continue; } const f = find(s, c.iid); if (f) kill(s, f); }
  }
  syncCtrl(s);
  let held = 0;
  s.bfs.forEach((b, i) => { if (b.ctrl === p) { held++; scoredOf(s, p).push(i); if (auto(s, p)) huntXp(s, i, p, 'tenir'); } });
  if (held) s.players[p].score += held;
  const second = s.turn <= 2 && p !== s.first;
  const ch = channel(s, p, second && !s.players[p].channeledBonus ? 3 : 2);
  if (second) s.players[p].channeledBonus = true;
  const d = auto(s, p) ? draw(s, p, 1) : 0; // a human draws by hand (click the deck)
  log(s, `— Tour ${s.turn} · ${W} : réveil, ${held ? `+${held} point${held > 1 ? 's' : ''} (tenir), ` : ''}canalise ${ch}, ${auto(s, p) ? `pioche ${d}` : "à vous de piocher (cliquez sur votre deck)"}.`);
  s.started = s.turn;
  s.bfs.forEach((b, i) => { if (b.ctrl === p) { for (const c of b.units[p].slice()) trigger(s, c, 'hold', p, i); bfTrigger(s, i, 'hold', p); legendTrigger(s, p, 'hold', { bf: i }); } });
  winCheck(s, p);
}

// pre-game actions (no undo)
function pregame(s, a, who) {
  const W = seatName(s, who);
  switch (a.type) {
    case 'chooseBf':
      if (s.stage !== 'bf' || !who) return 'Pas maintenant';
      if (s.bfPick[who]) return 'Déjà choisi';
      if (!s.bfOpts[who].includes(a.cid)) return 'Champ de bataille inconnu';
      s.bfPick[who] = a.cid;
      log(s, `${W} a choisi son champ de bataille.`);
      afterBfPick(s);
      return null;
    case 'callParity':
      if (s.stage !== 'dice' || who !== s.dice.caller || s.dice.call) return 'Pas maintenant';
      if (!['pair', 'impair'].includes(a.parity)) return 'pair ou impair';
      s.dice.call = a.parity;
      log(s, `${W} choisit ${a.parity} ; ${seatName(s, other(who))} a donc ${a.parity === 'pair' ? 'impair' : 'pair'}.`);
      return pregame(s, { type: 'rollDice' }, who); // the die is rolled right away
    case 'rollDice': {
      if (s.stage !== 'dice' || who !== s.dice.caller || !s.dice.call || s.dice.roll) return 'Pas maintenant';
      const n = 1 + Math.floor(Math.random() * 6), even = n % 2 === 0;
      s.dice.roll = n;
      s.dice.winner = (s.dice.call === 'pair') === even ? who : other(who);
      s.first = s.active = s.dice.winner;
      log(s, `🎲 ${W} lance le dé : ${n} (${even ? 'pair' : 'impair'}). ${seatName(s, s.first)} commence !`);
      for (const p of SEATS) draw(s, p, 4);
      s.stage = 'mulligan';
      log(s, 'Mulligan : chaque joueur peut renvoyer jusqu’à 2 cartes de sa main de départ.');
      return null;
    }
    case 'mulligan': {
      if (s.stage !== 'mulligan' || !who) return 'Pas maintenant';
      const pl = s.players[who];
      if (pl.mullDone) return 'Déjà fait';
      const ids = [...new Set(a.iids || [])];
      if (ids.length > 2) return 'Mulligan limité à 2 cartes';
      const z = pl.zones;
      if (pl.mullNew) return 'Mulligan déjà fait';
      const out = ids.map(id => z.hand.find(c => c.iid === id));
      if (out.some(c => !c)) return 'Carte introuvable';
      // set aside, draw the same number, then put the set-aside cards at the bottom
      z.hand = z.hand.filter(c => !ids.includes(c.iid));
      const before = new Set(z.hand.map(c => c.iid));
      draw(s, who, out.length);
      z.main.push(...out);
      log(s, out.length ? `${W} renvoie ${out.length} carte${out.length > 1 ? 's' : ''} et repioche.` : `${W} garde sa main.`);
      if (out.length && !auto(s, who)) { pl.mullNew = z.hand.filter(c => !before.has(c.iid)).map(c => c.iid); return null; } // shown before the game starts
      pl.mullDone = true;
      return mullEnd(s);
    }
    case 'mullConfirm': { // a human has seen the replacement cards: ready to play
      const pl = who && s.players[who];
      if (s.stage !== 'mulligan' || !pl || !pl.mullNew) return 'Pas maintenant';
      delete pl.mullNew; pl.mullDone = true;
      return mullEnd(s);
    }
  }
  return 'La partie n’a pas encore commencé';
}
// both players done with their mulligan: turn 1 starts
function mullEnd(s) {
  if (s.players.p1.mullDone && s.players.p2.mullDone) {
    s.stage = 'main'; s.turn = 1; s.history = [];
    log(s, `Tour 1 : ${seatName(s, s.active)}. Bonne partie !`);
    startTurn(s, s.active);
  }
  return null;
}

function snapshot(s, by) {
  const { history, ...rest } = s;
  s.history.push(JSON.stringify({ ...rest, _by: by })); // _by: who acted right after this snapshot
  if (s.history.length > HISTORY_MAX) s.history.shift();
}

// returns error string or null
function apply(s, a) {
  const P = a.seat === 'p1' || a.seat === 'p2' ? a.seat : null;
  const who = a.p || P;

  // seats are filled by the server (rooms); 'start' carries decks + card data
  if (a.type === 'start') {
    if (!s.seats.p1 || !s.seats.p2) return 'Il faut deux joueurs.';
    const e = setup(s, a);
    s.rev++;
    return e;
  }
  if (a.type === 'quit') {
    s.phase = 'ended';
    log(s, `${seatName(s, who)} a quitté la partie.`);
    s.rev++;
    return null;
  }
  if (s.phase !== 'playing') return 'pas de partie en cours';
  if (a.type === 'chat') return act(s, a, who) || (s.rev++, null);
  if (a.type === 'setAuto') {
    if (!who) return 'siège inconnu';
    (s.auto || (s.auto = {}))[who] = !!a.on;
    log(s, `${seatName(s, who)} passe en mode ${a.on ? 'automatique' : 'manuel'}.`);
    s.rev++;
    return null;
  }
  if (s.stage !== 'main') { const e = pregame(s, a, who); if (!e) s.rev++; return e; }

  if (a.type === 'undo') {
    // a.mine: go back to before this player's own last action (undoing the opponent's moves made since)
    let prev = null;
    if (a.mine) {
      const i = s.history.map(x => JSON.parse(x)._by).lastIndexOf(who);
      if (i < 0) return 'Rien à annuler';
      prev = s.history[i]; s.history.length = i;
    } else prev = s.history.pop();
    if (!prev) return 'Rien à annuler';
    const h = s.history, st = JSON.parse(prev);
    delete st._by;
    for (const k of Object.keys(s)) if (!(k in st)) delete s[k]; // e.g. a showdown opened after the snapshot
    Object.assign(s, st, { history: h });
    log(s, `${seatName(s, who)} annule la dernière action.`);
    s.rev++;
    return null;
  }

  if (s.pending && !['resolve', 'quit'].includes(a.type)) {
    const q = s.pending;
    return `En attente : ${seatName(s, q.to)} doit ${q.kind === 'discard' ? `défausser ${q.n} carte${q.n > 1 ? 's' : ''}` : q.kind === 'sacrifice' ? 'détruire une unité' : 'faire un choix'} (${q.card}).`;
  }
  snapshot(s, who);
  const err = act(s, a, who);
  if (err) s.history.pop();
  else s.rev++;
  return err;
}

function act(s, a, who) {
  const W = seatName(s, who);
  switch (a.type) {
    case 'move': {
      const f = find(s, a.iid);
      if (!f || f.isBf) return 'carte introuvable';
      const dest = target(s, a.to);
      if (!dest) return 'zone invalide';
      const c = f.c;
      const toZone = a.to.bf != null ? 'bf' : a.to.zone;
      // a unit moving between board locations (base <-> battlefield) is a Standard Move (rule 144):
      // on your turn, exhaust a ready unit; battlefield -> battlefield only with [Ganking]. a.free (Shift) bypasses it.
      const boardMove = (f.zone === 'base' || f.zone === 'bf') && (toZone === 'base' || toZone === 'bf') && !(f.zone === toZone && f.bf === a.to.bf);
      if (boardMove && !a.free && cd(s, c).type === 'Unit') {
        const why = f.p !== who ? 'ce n’est pas votre unité'
          : s.active !== who ? 'les déplacements se font pendant votre tour'
          : c.ex ? `${name(s, c)} est épuisé (un déplacement épuise l’unité, il faut qu’elle soit redressée)`
          : f.zone === 'bf' && toZone === 'bf' && !kwOf(s, c).ganking && bfName(s, a.to.bf) !== 'Baron Pit' && bfName(s, f.bf) !== 'Windswept Hillock' ? `${name(s, c)} ne peut pas aller d’un champ de bataille à un autre sans [Ganking]`
          : f.zone === 'bf' && toZone === 'base' && bfName(s, f.bf) === "Vilemaw's Lair" ? 'Vilemaw’s Lair : les unités ne peuvent pas en revenir à la base'
          : null;
        const sd = s.showdown;
        const why2 = why || (sd && !(sd.fresh && sd.att === who && toZone === 'bf' && a.to.bf === sd.bf) ? 'un affrontement est en cours (passez ou résolvez-le d’abord)' : null);
        if (why2) return `Déplacement impossible : ${why2}. (Maj + glisser pour forcer)`;
      }
      f.arr.splice(f.i, 1);
      if (f.zone === 'chain') { // taken off the stack by hand (e.g. countered)
        delete c.cb;
        if (!s.chain.length && s.showdown) { s.showdown.focus = other(s.showdown.last || who); s.showdown.passes = 0; }
      }
      if (isToken(s, c) && !['base', 'bf'].includes(toZone)) { log(s, `Le jeton ${name(s, c)} quitte le jeu.`); detach(s, c); syncCtrl(s); return null; }
      if (['hand', 'main', 'runeDeck', 'trash', 'banish'].includes(toZone)) { detach(s, c); Object.assign(c, { ex: false, dmg: 0, buff: 0, tb: 0, st: false, emp: false }); }
      if (boardMove && !a.noExhaust && cd(s, c).type === 'Unit') c.ex = true;
      if (cd(s, c).type === 'Gear' && c.att && boardMove) c.att = null; // moving equipment on its own detaches it
      if (toZone !== 'hand') c.rev = false;
      if (HIDDEN_ZONES.includes(toZone) || toZone === 'hand') c.fd = false;
      if (a.fd != null) c.fd = !!a.fd;
      let idx = a.pos === 'bottom' ? dest.length : a.pos === 'top' ? 0 : Number.isInteger(a.index) ? Math.max(0, Math.min(a.index, dest.length)) : dest.length;
      dest.splice(idx, 0, c);
      const where = a.to.bf != null ? `le champ de bataille « ${s.bfs[a.to.bf].card ? name(s, s.bfs[a.to.bf].card) : a.to.bf + 1} »` : ZLABEL[toZone] + (a.to.p !== who ? ` de ${seatName(s, a.to.p)}` : '');
      const hidden = (f.zone === 'hand' || f.zone === 'hidden' || HIDDEN_ZONES.includes(f.zone)) && (toZone === 'hand' || HIDDEN_ZONES.includes(toZone) || c.fd);
      if (!(f.zone === toZone && f.p === (a.to.p || a.to.side) && f.bf === a.to.bf))
        log(s, `${W} déplace ${hidden ? 'une carte' : name(s, c)} vers ${where}${a.pos === 'bottom' ? ' (dessous)' : ''}.`);
      // a unit put onto the board from hand/deck without paying still enters exhausted
      if (['hand', 'main', 'champion', 'trash', 'banish', 'hidden'].includes(f.zone) && (toZone === 'base' || toZone === 'bf') && cd(s, c).type === 'Unit' && !R.entersReady(cd(s, c))) c.ex = true;
      syncCtrl(s);
      const sd0 = s.showdown;
      if (a.to.bf != null && f.bf !== a.to.bf && cd(s, c).type === 'Unit') arrive(s, a.to.bf, a.to.side, a.quiet);
      if (boardMove && cd(s, c).type === 'Unit') {
        trigger(s, c, 'move', f.p, a.to.bf != null ? a.to.bf : null);
        if (sd0 && sd0 === s.showdown && sd0.fresh && sd0.att === f.p && sd0.bf === a.to.bf) trigger(s, c, 'attack', f.p, a.to.bf);
      }
      return null;
    }
    case 'play': { // AI: pays and resolves its effects automatically. Human: no payment, effects done by hand.
      const f = find(s, a.iid);
      const flow = a.flow && f && f.zone === 'trash';
      if (!f || !(['hand', 'champion', 'hidden'].includes(f.zone) || flow)) return 'carte introuvable';
      const d = cd(s, f.c), p = f.zone === 'hidden' ? f.c.owner : f.p, c = f.c;
      if (d.type === 'Rune' || d.type === 'Battlefield' || d.type === 'Legend') return 'Cette carte ne se joue pas ainsi';
      if (p !== who) return 'Ce n’est pas votre carte';
      const k = R.kw(d.text), fromHidden = f.zone === 'hidden', ai = auto(s, p);
      if (fromHidden && s.turn <= (c.hidT || 0)) return 'Une carte cachée se joue à partir du tour suivant.';
      // timing (rules 155, 806, 813): on the opponent's turn only [Reaction] / [Action] cards,
      // cards played from hiding (they gain Reaction), or Ambush units played to a battlefield where you have units.
      // During a showdown only Action / Reaction cards; on a pending stack only Reactions.
      let toBf = a.to && a.to.bf != null ? a.to.bf : fromHidden ? f.bf : null;
      const quick = k.reaction || fromHidden || (k.ambush && toBf != null && d.type === 'Unit');
      if (who !== s.active && !(quick || (k.action && s.showdown)))
        return `Ce n’est pas votre tour : seules les cartes [Reaction] ou [Action] se jouent pendant le tour adverse.`;
      if (s.chain && s.chain.length && !quick) return 'Une carte est sur la pile : seules les cartes [Reaction] peuvent y répondre.';
      if (s.showdown && !(quick || k.action)) return 'Affrontement en cours : seules les cartes [Action] ou [Reaction] se jouent.';
      // location (rule 355.2): units go to your base or a battlefield you control; Ambush adds battlefields
      // where you have units; a card played from hiding stays at its battlefield
      if (toBf != null && d.type === 'Unit') {
        const bf = s.bfs[toBf];
        if (!bf) return 'champ de bataille inconnu';
        if (bfName(s, toBf) === 'Rockfall Path') return 'Rockfall Path : aucune unité ne peut y être jouée.';
        if (fromHidden && toBf !== f.bf) return 'Une unité jouée depuis une carte cachée arrive sur ce champ de bataille.';
        if (!fromHidden && bf.ctrl !== p && !(k.ambush && bf.units[p].length) && !(k.toEnemyBf && bf.units[other(p)].length))
          return k.toEnemyBf ? `${d.name} se joue sur un champ de bataille où il y a des unités ennemies, où vous avez des unités, ou que vous contrôlez.` : k.ambush ? 'Embuscade : il faut contrôler ce champ de bataille ou y avoir déjà une unité.' : `${d.name} se joue dans votre base ou sur un champ de bataille que vous contrôlez (Embuscade/Ambush permet d’aller là où vous avez des unités).`;
      }
      const pl = s.players[p], legion = (s.played && s.played[p]) > 0;
      let paid = null, accel = false, repeat = null, paidExtra = !ai && !!a.extra;
      if (ai) { // cost: printed (ignored from hiding), Flow replaces it, discounts, + Accelerate / Repeat
        let base = fromHidden ? { e: 0, p: [] } : flow ? R.kwCost(d.text, 'Flow') : R.cardCost(d);
        if (!base) return 'Cette carte n’a pas de coût Flow';
        const disc = !fromHidden && !flow && discount(s, p, d, legion);
        if (disc) {
          const left = base.p.slice();
          for (const x of disc.p) { const i = left.findIndex(set => !x || !set || set.some(dm => x.includes(dm))); if (i >= 0) left.splice(i, 1); }
          base = { e: Math.max(Math.min(base.e, disc.min), base.e - disc.e), p: left };
        }
        repeat = a.repeat ? R.kwCost(d.text, 'Repeat') : null;
        accel = k.accelerate && d.type === 'Unit' && a.accel !== false;
        const plan = cost => R.planCost(runesOf(s, p), pl.pool || (pl.pool = newPool()), cost);
        let cost = R.sumCost(base, repeat, accel ? R.cardCost({ ...d, energy: 0, power: 0 }, true) : null);
        if (accel && !plan(cost)) { accel = false; cost = R.sumCost(base, repeat); }
        if (d.type === 'Spell' && s.spellDisc && s.spellDisc.p === p && s.spellDisc.turn === s.turn) { cost = { ...cost, e: Math.max(0, cost.e - s.spellDisc.n) }; delete s.spellDisc; }
        if (!plan(cost)) return `Pas assez de runes pour jouer ${d.name} (${costText(cost)}).`;
        const xc = R.extraCost(d.text); // "you may pay ... as an additional cost": paid when it can be, unless declined
        if (xc && a.extra !== false && plan(R.sumCost(cost, xc))) { cost = R.sumCost(cost, xc); paidExtra = true; }
        paid = pay(s, p, cost);
      }
      (s.played || (s.played = { p1: 0, p2: 0 }))[p]++;
      f.arr.splice(f.i, 1);
      c.rev = false; c.fd = false;
      const how = `${fromHidden ? ' (depuis sa carte cachée)' : flow ? ' depuis sa défausse (Flow)' : ''}${paid && (paid.e || paid.p) ? ` (${paid.e} énergie${paid.p ? `, ${paid.p} puissance` : ''})` : ''}${accel ? ', accéléré' : ''}${repeat ? ', avec Repeat' : ''}`;
      if (s.showdown) { s.showdown.passes = 0; s.showdown.fresh = false; s.showdown.last = p; }
      if (d.type === 'Spell') {
        // spells go on the stack: the opponent may respond with Reactions before it resolves
        const tg = (Array.isArray(a.targets) ? a.targets : []).filter(id => typeof id === 'string' && find(s, id)).slice(0, 4);
        c.cb = { by: p, seen: false, flow: !!flow, repeat: !!repeat, legion, targets: tg, bf: a.bf, fx: R.playFx(d, { legion, xp: pl.xp || 0 }).length > 0 };
        (s.chain || (s.chain = [])).push(c);
        log(s, `✦ ${seatName(s, p)} lance ${d.name}${how}. ${s.chain.length > 1 ? 'En réponse sur la pile.' : 'Sur la pile : l’adversaire peut réagir.'}`);
        for (const u of mineOnBoard(s, p)) trigger(s, u, 'playSpell', p, null);
        legendTrigger(s, p, 'playSpell', { cost: paid ? paid.e : d.energy || 0 });
        if (fromHidden) legendTrigger(s, p, 'playHidden');
        return null;
      }
      // units enter exhausted unless Accelerate was paid or the card says "I enter ready"; gear enters ready at base
      // Baron Nashor: "As you play me, add the Baron Pit battlefield token to the board if it's not there already. If you do, I enter there."
      if (d.type === 'Unit' && /add the Baron Pit battlefield token/i.test(d.text || '') && !s.bfs.some((b, i) => bfName(s, i) === 'Baron Pit')) {
        const pit = Object.keys(s.cd).find(id => s.cd[id].name === 'Baron Pit' && s.cd[id].type === 'Battlefield');
        if (pit) { s.bfs.push({ card: mk(s, pit, p), units: { p1: [], p2: [] }, ctrl: null, hidden: [] }); toBf = s.bfs.length - 1; log(s, `${d.name} ajoute le champ de bataille Baron Pit et y entre.`); }
      }
      c.ex = d.type === 'Unit' ? !(accel || R.entersReady(d)) : false;
      (toBf != null && d.type === 'Unit' ? s.bfs[toBf].units[p] : pl.zones.base).push(c);
      log(s, `✦ ${seatName(s, p)} joue ${d.name}${how}.`);
      if (toBf != null && d.type === 'Unit') arrive(s, toBf, p);
      if (s.showdown && s.showdown.last === p) s.showdown.focus = other(p);
      if (d.type === 'Unit') for (const u of mineOnBoard(s, p)) if (u !== c) trigger(s, u, 'playUnit', p, null);
      if (d.type === 'Unit') legendTrigger(s, p, 'playUnit', { cost: d.energy || 0, mighty: hp(s, c) >= 5 });
      if (fromHidden) legendTrigger(s, p, 'playHidden');
      // Riven, The Exile: units played to battlefields you control enter ready
      if (d.type === 'Unit' && toBf != null && s.bfs[toBf].ctrl === p && legendOf(s, p) && cd(s, legendOf(s, p)).name === 'Riven, The Exile') c.ex = false;
      // play effects: everything for the AI (a.targets / a.bf pre-select its choices); for a human, only
      // what the opponent must decide or reveal (discard, kill one of their units, reveal their hand)
      const bfAt = toBf != null && (d.type === 'Unit' || fromHidden) ? toBf : null;
      let fx = R.playFx(d, { legion, xp: pl.xp || 0 });
      if (d.type === 'Unit' && R.kw(d.text).weaponmaster) fx = [...fx, { who: 'self', kind: 'may', text: 'Équiper un de vos équipements à cette unité (Weaponmaster) ?', cond: 'hasGear', fx: [{ who: 'self', kind: 'equipBest' }] }];
      if (k.quickDraw && d.type === 'Gear') fx = [{ kind: 'target', op: 'attach', side: 'friendly', where: 'any', who: 'self' }, ...fx];
      (s.fxPre || (s.fxPre = {}))[c.iid] = (a.targets || []).slice();
      if ((a.targets || []).length) (s.fxDeclared || (s.fxDeclared = {}))[c.iid] = true;
      s.fxQueue = [...(s.fxQueue || []), ...fx.map(e => ({ ...e, by: p, card: d.name, src: c.iid, bfAt, preBf: a.bf, fromHidden, legion, paidExtra }))];
      runFx(s);
      return null;
    }
    case 'chainPass': { // the opponent of the top stack item lets it resolve (AI: after deciding not to react)
      const top = s.chain && s.chain[s.chain.length - 1];
      if (!top) return 'La pile est vide';
      if (top.cb.by === who) return 'C’est votre propre carte';
      top.cb.seen = true;
      if (auto(s, who)) log(s, `${seatName(s, who)} ne réagit pas à ${name(s, top)}.`);
      else return resolveTop(s);
      return null;
    }
    case 'chainResolve': { // resolve the top stack item (its owner, once the opponent had the chance to react)
      const top = s.chain && s.chain[s.chain.length - 1];
      if (!top) return 'La pile est vide';
      if (top.cb.by !== who) return 'Ce sort n’est pas le vôtre : laissez-le résoudre (ou répondez).';
      if (!top.cb.seen && auto(s, other(who))) return `${seatName(s, other(who))} réfléchit à une réponse…`;
      if (a.apply === false) top.cb.apply = false;
      return resolveTop(s);
    }
    case 'pass': { // showdown: the player with focus passes; two passes in a row -> combat damage
      const sd = s.showdown;
      if (!sd) return 'Pas d’affrontement en cours';
      if (s.chain && s.chain.length) return 'Résolvez d’abord la pile';
      if (sd.focus !== who) return `C’est à ${seatName(s, sd.focus)} d’agir`;
      sd.passes++; sd.fresh = false;
      log(s, `${seatName(s, who)} passe.`);
      if (sd.passes >= 2) { closeShowdown(s); return null; }
      sd.focus = other(who);
      return null;
    }
    case 'look': { // look at the top N cards of my deck (Predict from a battlefield, etc.): recycle any of them
      if (s.pending) return 'Un choix est déjà en attente.';
      const n = Math.max(1, Math.min(10, Math.floor(Number(a.n)) || 1)), top = s.players[who].zones.main.slice(0, n);
      if (!top.length) return 'Votre deck est vide.';
      s.pending = { kind: 'predict', to: who, n: top.length, by: who, card: 'Prédiction', cards: top.map(c => c.iid) };
      log(s, `${W} regarde ${top.length > 1 ? `les ${top.length} cartes` : 'la carte'} du dessus de son deck.`);
      return null;
    }
    case 'hide': { // [Hidden] (rule 811): pay 1 Power (any) to put the card face down at a battlefield you control
      const f = find(s, a.iid), bf = s.bfs[a.bf];
      if (!f || !['hand', 'champion'].includes(f.zone) || f.p !== who) return 'carte introuvable';
      const d = cd(s, f.c);
      if (!R.kw(d.text).hidden) return `${d.name} n’a pas [Hidden]`;
      if (s.active !== who) return 'On cache une carte pendant son tour.';
      if (bf && bf.ctrl !== who && !auto(s, who) && bf.units[who].length && !bf.units[other(who)].length) { bf.ctrl = who; log(s, `${W} contrôle ${bf.card ? name(s, bf.card) : 'le champ de bataille'}.`); }
      if (!bf || bf.ctrl !== who) return 'Il faut contrôler ce champ de bataille (y avoir vos unités) pour y cacher une carte.';
      bf.hidden = bf.hidden || [];
      if (bf.hidden.length) return 'Il y a déjà une carte cachée sur ce champ de bataille.';
      const freeHide = s.freeHide && s.freeHide.p === who && s.freeHide.turn === s.turn;
      if (auto(s, who) && !freeHide && !pay(s, who, { e: 0, p: [null] })) return 'Cacher coûte 1 puissance (n’importe quel domaine) : recyclez une rune.';
      f.arr.splice(f.i, 1);
      Object.assign(f.c, { fd: true, ex: false, hidT: s.turn, owner: f.c.owner });
      bf.hidden.push(f.c);
      log(s, `${W} cache une carte face cachée sur ${bf.card ? name(s, bf.card) : 'un champ de bataille'} (jouable gratuitement dès le tour suivant).`);
      bfTrigger(s, a.bf, 'hide', who);
      return null;
    }
    case 'equip': { // [Equip] cost: attach an Equipment you control to a unit you control
      const g = find(s, a.iid), u = find(s, a.unit);
      if (!g || !u || g.zone !== 'base' || g.p !== who) return 'équipement introuvable';
      if (!['base', 'bf'].includes(u.zone) || u.p !== who || cd(s, u.c).type !== 'Unit') return 'Choisissez une de vos unités';
      const cost = R.kwCost(cd(s, g.c).text, 'Equip') || { e: 0, p: [] };
      if (auto(s, who) && !pay(s, who, cost)) return `Pas assez de runes pour équiper (${costText(cost)}).`;
      g.c.att = u.c.iid;
      log(s, `${W} équipe ${name(s, u.c)} de ${name(s, g.c)} (+${cd(s, g.c).might || 0} force).`);
      return null;
    }
    case 'activate': { // "<cost>, :rb_exhaust:: <effect>" of a unit, gear or legend you control
      const f = find(s, a.iid);
      if (!f || !['base', 'bf', 'legend'].includes(f.zone) || f.p !== who) return 'carte introuvable';
      const d = cd(s, f.c), ab = R.abilities(d)[a.k || 0], pl = s.players[who];
      if (!ab) return `${d.name} n’a pas de capacité à activer`;
      if (f.c.ex) return `${d.name} est épuisé : redressez-le d’abord.`;
      if (ab.level && (pl.xp || 0) < ab.level) return `Capacité disponible à partir de ${ab.level} XP.`;
      const busy = (s.chain && s.chain.length) || s.showdown;
      if (s.chain && s.chain.length && !ab.reaction) return 'Seules les capacités [Reaction] répondent à la pile.';
      if (!ab.reaction && !(ab.action && (who === s.active || s.showdown)) && (who !== s.active || busy)) return 'Cette capacité s’active pendant votre tour, hors affrontement.';
      if (auto(s, who)) {
        if (ab.xp && (pl.xp || 0) < ab.xp) return `Il faut ${ab.xp} XP.`;
        if ((ab.cost.e || ab.cost.p.length) && !pay(s, who, ab.cost)) return `Pas assez de runes (${costText(ab.cost)}).`;
      }
      if (ab.xp) pl.xp = Math.max(0, (pl.xp || 0) - ab.xp);
      f.c.ex = true;
      log(s, `⚡ ${W} active ${d.name} : ${ab.text.replace(/:rb_energy_(\d+):/g, '$1 énergie').replace(/:rb_rune_rainbow:/g, '1 puissance au choix').replace(/:rb_rune_(\w+):/g, '1 puissance $1').replace(/:rb_might:/g, 'force')}`);
      const tg = (Array.isArray(a.targets) ? a.targets : []).filter(id => typeof id === 'string' && find(s, id));
      (s.fxPre || (s.fxPre = {}))[f.c.iid] = tg;
      if (tg.length) (s.fxDeclared || (s.fxDeclared = {}))[f.c.iid] = true;
      s.fxQueue = [...(s.fxQueue || []), ...ab.fx.map(e => ({ ...e, by: who, card: d.name, src: f.c.iid, bfAt: f.zone === 'bf' ? f.bf : null, preBf: a.bf }))];
      if (ab.kill) { kill(s, f); syncCtrl(s); }
      runFx(s);
      return null;
    }
    case 'unequip': { const g = find(s, a.iid); if (!g) return 'carte introuvable'; g.c.att = null; log(s, `${W} détache ${name(s, g.c)}.`); return null; }
    case 'empower': { // [Empower] cost: the permanent becomes Empowered (its [Empowered] text applies)
      const f = find(s, a.iid); if (!f) return 'carte introuvable';
      if (f.c.emp) { f.c.emp = false; log(s, `${name(s, f.c)} n’est plus Empowered.`); return null; }
      const cost = R.kwCost(cd(s, f.c).text, 'Empower') || { e: 0, p: [] };
      if (auto(s, who) && !pay(s, who, cost)) return `Pas assez de runes pour Empower (${costText(cost)}).`;
      f.c.emp = true;
      log(s, `${W} rend ${name(s, f.c)} Empowered.`);
      return null;
    }
    case 'gold': { // Gold token: kill this, exhaust: add 1 Power of any domain
      const f = find(s, a.iid); if (!f || f.p !== who || name(s, f.c) !== 'Gold') return 'jeton Gold introuvable';
      if (f.c.ex) return 'Ce Gold est épuisé';
      f.arr.splice(f.i, 1);
      const pl = s.players[who]; (pl.pool || (pl.pool = newPool())).p.push('any');
      log(s, `${W} utilise un Gold : +1 puissance (n’importe quel domaine) en réserve.`);
      return null;
    }
    case 'resolve': { // answer a prompt (discard / sacrifice / buff / target / battlefield / predict)
      const q = s.pending;
      if (!q) return 'Rien à résoudre';
      if (who !== q.to) return `C’est à ${seatName(s, q.to)} de choisir`;
      const ids = [...new Set(a.iids || [])];
      if (q.kind === 'pick') {
        if (ids.length > 1 || ids.some(id => !q.cards.includes(id))) return 'Choisissez une des cartes proposées';
        const e = q.fx, z = s.players[q.to].zones, W2 = seatName(s, q.to);
        s.pending = null;
        const i = ids[0] ? (e.from === 'top' ? z.main : z.trash).findIndex(c => c.iid === ids[0]) : -1;
        const c = i >= 0 ? (e.from === 'top' ? z.main : z.trash).splice(i, 1)[0] : null;
        if (e.from === 'top') { const rest = z.main.filter(x => q.top.includes(x.iid)); z.main = z.main.filter(x => !q.top.includes(x.iid)).concat(rest); }
        if (!c) log(s, `${W2} ne prend aucune carte (${q.card}).`);
        else if (e.then === 'hand') { z.hand.push(c); log(s, `${W2} prend ${name(s, c)} en main (${q.card}).`); }
        else if (e.then === 'playPaid' && auto(s, q.to) && !pay(s, q.to, R.cardCost(cd(s, c)))) { z.main.push(c); log(s, `${W2} ne peut pas payer ${name(s, c)} : recyclé (${q.card}).`); }
        else if (cd(s, c).type === 'Spell') { // cast for free: on the stack like any spell
          c.cb = { by: q.to, seen: false, flow: false, recycle: !!e.recycle, repeat: false, legion: false, targets: [], fx: true };
          (s.chain || (s.chain = [])).push(c);
          log(s, `✦ ${W2} lance ${name(s, c)} depuis sa défausse sans payer son énergie (${q.card}).`);
        } else {
          c.ex = cd(s, c).type === 'Unit' && !R.entersReady(cd(s, c)); z.base.push(c);
          log(s, `✦ ${W2} joue ${name(s, c)} depuis sa défausse sans payer son coût (${q.card}).`);
        }
        runFx(s);
        return null;
      }
      if (q.kind === 'confirm') {
        const e = q.fx;
        if (a.yes && e.pay && !pay(s, q.to, e.pay)) return `Pas assez de runes (${costText(e.pay)}).`;
        if (a.yes && e.exMe) { const f = e.src && find(s, e.src); if (f) f.c.ex = true; }
        s.pending = null;
        log(s, `${seatName(s, q.to)} ${a.yes ? 'utilise' : 'n’utilise pas'} ${q.card}.`);
        const then = a.yes ? e.fx : e.elseFx || [];
        if (then.length) s.fxQueue = [...then.map(x => ({ ...x, by: e.by, card: e.card, src: e.src, bfAt: e.bfAt })), ...(s.fxQueue || [])];
        runFx(s);
        return null;
      }
      if (q.kind === 'predict') {
        if (ids.some(id => !q.cards.includes(id))) return 'Carte introuvable';
        const z = s.players[q.to].zones;
        for (const id of ids) { const i = z.main.findIndex(c => c.iid === id); if (i >= 0) z.main.push(...z.main.splice(i, 1)); }
        log(s, `${seatName(s, q.to)} ${ids.length ? `recycle ${ids.length} carte${ids.length > 1 ? 's' : ''} sous son deck` : 'garde la carte du dessus'} (${q.card}).`);
      } else if (q.kind === 'bf') {
        if (!q.opts.includes(a.bf)) return 'Choisissez un champ de bataille';
        s.pending = null; bfEffect(s, q.fx, a.bf, q.to);
      } else if (q.kind === 'target' && q.opt && !ids.length) log(s, `${seatName(s, q.to)} ne choisit pas de cible (${q.card}).`);
      else if (ids.length !== q.n) return `Choisissez ${q.n} carte${q.n > 1 ? 's' : ''}`;
      else if (q.kind === 'target') {
        if (!q.opts.includes(ids[0])) return 'Cible invalide';
        s.pending = null; applyTarget(s, q.fx, ids[0], q.to);
      } else if (q.kind === 'discard') {
        const hand = s.players[q.to].zones.hand;
        const picked = ids.map(id => hand.find(c => c.iid === id));
        if (picked.some(c => !c)) return 'Carte introuvable dans la main';
        for (const c of picked) { hand.splice(hand.indexOf(c), 1); toTrash(s, c); }
        log(s, `${seatName(s, q.to)} défausse ${picked.map(c => name(s, c)).join(', ')} (${q.card}).`);
      } else {
        const f = find(s, ids[0]);
        if (!f || !(f.zone === 'base' || f.zone === 'bf') || f.c.owner !== q.to) return 'Choisissez une de vos unités';
        if (q.kind === 'buff') { if (f.c.iid === q.exclude) return 'Choisissez une autre unité'; buff(s, f.c); }
        else { kill(s, f); syncCtrl(s); }
      }
      s.pending = null;
      runFx(s);
      return null;
    }
    case 'damage': { // damage with automatic death check
      const f = find(s, a.iid); if (!f || f.isBf) return 'carte introuvable';
      f.c.dmg += Number(a.n) || 0;
      log(s, `${W} inflige ${a.n} à ${name(s, f.c)}.`);
      if (f.c.dmg >= lethal(s, f.c)) { kill(s, f); syncCtrl(s); }
      return null;
    }
    case 'token': { // create token(s) by hand: {name, n, ready, to:{bf}|undefined}
      const n = Math.max(1, Math.min(10, Number(a.n) || 1));
      const bf = a.to && a.to.bf != null ? a.to.bf : null;
      return makeTokens(s, who, { name: String(a.name || ''), n, ready: !!a.ready }, bf) ? null : 'Jeton inconnu';
    }
    case 'duel': {
      const f = find(s, a.iid), g = find(s, a.target);
      if (!f || !g || !['base', 'bf'].includes(f.zone) || !['base', 'bf'].includes(g.zone)) return 'unités introuvables';
      duel(s, f, g);
      return null;
    }
    case 'buff': { const f = find(s, a.iid); if (!f) return 'carte introuvable'; buff(s, f.c); return null; }
    case 'kill': { const f = find(s, a.iid); if (!f || f.isBf) return 'carte introuvable'; kill(s, f); syncCtrl(s); return null; }
    case 'stun': { const f = find(s, a.iid); if (!f) return 'carte introuvable'; f.c.st = !f.c.st; log(s, `${W} ${f.c.st ? 'étourdit' : 'retire l’étourdissement de'} ${name(s, f.c)}.`); return null; }
    case 'tbuff': { const f = find(s, a.iid); if (!f) return 'carte introuvable'; f.c.tb = (f.c.tb || 0) + (Number(a.n) || 0); log(s, `${name(s, f.c)} gagne +${a.n} force ce tour.`); return null; }
    case 'fight': { // resolve combat at a battlefield; attacker = player who arrived (a.att) or acting player
      const bf = s.bfs[a.bf]; if (!bf) return 'champ de bataille inconnu';
      if (s.showdown && s.showdown.bf === a.bf) s.showdown = null; // forced resolution closes the showdown
      const att = a.att || who, def = other(att);
      const A = bf.units[att], D = bf.units[def];
      const isU = c => cd(s, c).type === 'Unit';
      if (!A.some(isU) || !D.some(isU)) return 'Il faut des unités des deux côtés';
      // [Disarm N]: when attacking, an enemy unit here gets -N Might this turn (the strongest one)
      for (const c of A.filter(isU)) {
        const n = auto(s, att) && kwOf(s, c).disarm, t = n && D.filter(isU).sort((x, y) => hp(s, y, 'd') - hp(s, x, 'd'))[0];
        if (t) { t.tb = (t.tb || 0) - n; log(s, `${name(s, c)} désarme ${name(s, t)} (−${n} force ce tour).`); }
      }
      // combat damage (rule 465): each side assigns its total Might; Tank first, Backline last, stunned units deal none
      const wrap = c => { const k = kwOf(s, c); return { c, dmg: c.dmg || 0, stun: !!c.st, tank: k.tank || !!c.tt, backline: k.backline }; };
      const WA = A.filter(isU).map(wrap), WD = D.filter(isU).map(wrap);
      const before = { a: WA.filter(u => !u.stun).reduce((t, u) => t + hp(s, u.c, 'a'), 0), d: WD.filter(u => !u.stun).reduce((t, u) => t + hp(s, u.c, 'd'), 0) };
      const { deadA, deadD } = R.combat(WA, WD, u => hp(s, u.c, 'a'), u => hp(s, u.c, 'd'));
      for (const u of [...WA, ...WD]) u.c.dmg = u.dmg;
      log(s, `⚔ Combat sur ${bf.card ? name(s, bf.card) : 'le champ de bataille'} : ${seatName(s, att)} (${before.a}) contre ${seatName(s, def)} (${before.d}).`);
      for (const u of [...deadA, ...deadD]) { const g = find(s, u.c.iid); if (g) kill(s, g); }
      if (s.decree === s.turn) for (const u of [...WA, ...WD]) if (u.dmg > 0) { const g = find(s, u.c.iid); if (g && ['bf', 'base'].includes(g.zone)) kill(s, g); }
      for (const c of [...A, ...D]) c.dmg = 0; // combat cleanup heals all units
      if (A.some(isU) && !D.some(isU)) legendTrigger(s, att, 'winCombat', { bf: a.bf });
      else if (D.some(isU) && !A.some(isU)) legendTrigger(s, def, 'winCombat', { bf: a.bf });
      if (A.some(isU) && !D.some(isU)) { syncCtrl(s); conquer(s, a.bf, att); }
      else if (A.length && D.length) { // attackers survive but don't win: recalled to base
        for (const c of A.splice(0)) s.players[att].zones.base.push(c);
        log(s, `Les attaquants survivants retournent à la base.`);
        bf.ctrl = def;
      } else if (D.length) bf.ctrl = def;
      else bf.ctrl = null;
      return null;
    }
    case 'exhaust': {
      const f = find(s, a.iid); if (!f) return 'carte introuvable';
      const was = f.c.ex;
      f.c.ex = a.value != null ? !!a.value : !f.c.ex;
      // exhausting your own rune by hand adds 1 energy to your pool (readying it takes it back)
      const pool = f.zone === 'runes' && f.p === who && auto(s, who) && s.players[who].pool;
      if (pool && f.c.ex !== was) pool.e = Math.max(0, pool.e + (f.c.ex ? 1 : -1));
      log(s, `${W} ${f.c.ex ? 'épuise' : 'redresse'} ${f.c.fd ? 'une carte' : name(s, f.c)}${pool && f.c.ex ? ` (+1 énergie, réserve ${pool.e})` : ''}.`);
      return null;
    }
    case 'flip': {
      const f = find(s, a.iid); if (!f) return 'carte introuvable';
      f.c.fd = !f.c.fd;
      log(s, `${W} retourne ${f.c.fd ? 'une carte face cachée' : name(s, f.c) + ' face visible'}.`);
      return null;
    }
    case 'reveal': {
      const f = find(s, a.iid); if (!f) return 'carte introuvable';
      f.c.rev = !f.c.rev;
      if (f.c.rev) log(s, `${W} révèle ${name(s, f.c)} depuis sa main.`);
      return null;
    }
    case 'counter': {
      const f = find(s, a.iid); if (!f) return 'carte introuvable';
      const k = a.key === 'buff' ? 'buff' : 'dmg';
      f.c[k] = Math.max(k === 'buff' ? -99 : 0, f.c[k] + (Number(a.delta) || 0));
      return null;
    }
    case 'clearDamage': {
      for (const b of s.bfs) for (const p of ['p1', 'p2']) for (const c of b.units[p]) c.dmg = 0;
      for (const p of ['p1', 'p2']) for (const c of s.players[p].zones.base) c.dmg = 0;
      log(s, `${W} retire tous les dégâts.`);
      return null;
    }
    case 'draw': {
      const n = draw(s, who, a.n || 1);
      log(s, n ? `${W} pioche ${n} carte${n > 1 ? 's' : ''}.` : `${W} ne peut pas piocher : deck vide (règle du burn out !).`);
      return null;
    }
    case 'channel': {
      const n = channel(s, who, a.n || 1);
      log(s, `${W} canalise ${n} rune${n > 1 ? 's' : ''}.`);
      return null;
    }
    case 'recycle': { // rune back to bottom of rune deck
      const f = find(s, a.iid); if (!f) return 'carte introuvable';
      f.arr.splice(f.i, 1); f.c.ex = false;
      s.players[f.c.owner].zones.runeDeck.push(f.c);
      // recycling your own rune by hand adds 1 power of its domain to your pool
      const pool = f.zone === 'runes' && f.p === who && auto(s, who) && s.players[who].pool;
      if (pool) pool.p.push((cd(s, f.c).domain || [])[0]);
      log(s, `${W} recycle ${name(s, f.c)}${pool ? ' (+1 puissance en réserve)' : ''}.`);
      return null;
    }
    case 'shuffle': {
      const z = a.zone === 'runeDeck' ? 'runeDeck' : 'main';
      shuffle(s.players[who].zones[z]);
      log(s, `${W} mélange son ${ZLABEL[z]}.`);
      return null;
    }
    case 'readyAll': readyAll(s, who); s.players[who].pool = newPool(); log(s, `${W} redresse toutes ses cartes.`); return null;
    case 'score': {
      const pl = s.players[a.p || who];
      pl.score = Math.max(0, Math.min(99, pl.score + (Number(a.delta) || 0)));
      log(s, `${seatName(s, a.p || who)} : ${pl.score} point${pl.score > 1 ? 's' : ''}${a.reason ? ' (' + a.reason + ')' : ''}.`);
      if (s.winner === (a.p || who) && pl.score < s.winScore) s.winner = null;
      winCheck(s, a.p || who);
      return null;
    }
    case 'control': {
      const bf = s.bfs[a.bf]; if (!bf) return 'champ de bataille inconnu';
      bf.ctrl = a.p === bf.ctrl ? null : a.p;
      log(s, bf.ctrl ? `${seatName(s, bf.ctrl)} contrôle ${bf.card ? name(s, bf.card) : 'le champ de bataille'}.` : `${bf.card ? name(s, bf.card) : 'Le champ de bataille'} n'est plus contrôlé.`);
      return null;
    }
    case 'conquer': { // take control + 1 point
      if (!s.bfs[a.bf]) return 'champ de bataille inconnu';
      conquer(s, a.bf, who);
      return null;
    }
    case 'startTurn': {
      if (s.started === s.turn) return 'Le tour a déjà commencé';
      startTurn(s, s.active);
      return null;
    }
    case 'xp': { const pl = s.players[a.p || who]; pl.xp = Math.max(0, (pl.xp || 0) + (Number(a.delta) || 0)); return null; }
    case 'endTurn': {
      // Expiration: clear damage, stuns and "this turn" buffs, pass turn
      // a showdown left open at end of turn is resolved now (active player attacks)
      if (s.chain && s.chain.length) return 'Résolvez d’abord la pile.';
      while (s.showdown) closeShowdown(s);
      if (auto(s, s.active)) s.bfs.forEach((b, i) => { if (b.units.p1.some(c => cd(s, c).type === 'Unit') && b.units.p2.some(c => cd(s, c).type === 'Unit')) act(s, { type: 'fight', bf: i, att: s.active }, s.active); });
      for (const c of [...s.bfs.flatMap(b => [...b.units.p1, ...b.units.p2]), ...s.players.p1.zones.base, ...s.players.p2.zones.base]) { c.dmg = 0; c.tb = 0; c.ta = 0; c.ts = 0; c.tt = false; c.st = false; c.tg = false; }
      for (const p of SEATS) for (const c of s.players[p].zones.hand) c.rev = false;
      legendTrigger(s, s.active, 'endTurn');
      const er = s.endReady && s.endReady[s.active];
      if (er) { let k = 0; for (const r of s.players[s.active].zones.runes) if (r.ex && k < er) { r.ex = false; k++; } delete s.endReady[s.active]; log(s, `${seatName(s, s.active)} redresse ${k} rune${k > 1 ? 's' : ''} (Targon's Peak).`); }
      for (const p of SEATS) s.players[p].pool = newPool(); // unspent energy/power is lost
      for (const b of s.bfs) for (const q of SEATS) for (const c of b.units[q].slice()) if (c.borrow) { b.units[q].splice(b.units[q].indexOf(c), 1); s.players[c.borrow].zones.base.push(c); log(s, `${name(s, c)} revient à ${seatName(s, c.borrow)} (base).`); delete c.borrow; }
      for (const c of SEATS.flatMap(q => [...s.players[q].zones.base, ...s.bfs.flatMap(b => b.units[q])])) if (c.empBack != null) { c.emp = c.empBack; delete c.empBack; }
      syncCtrl(s);
      if (s.extraTurn === s.active) { delete s.extraTurn; log(s, `${W} prend un tour supplémentaire.`); } else s.active = other(s.active);
      s.turn++;
      log(s, `Fin du tour de ${W}. Tour ${s.turn} : ${seatName(s, s.active)}.`);
      startTurn(s, s.active); // the next turn starts on its own
      return null;
    }
    case 'roll': {
      const n = 1 + Math.floor(Math.random() * (a.sides || 6));
      log(s, `🎲 ${W} lance un dé ${a.sides || 6} : ${n}.`);
      return null;
    }
    case 'chat': { const m = String(a.msg || '').slice(0, 200).trim(); if (!m) return 'vide'; log(s, `💬 ${W} : ${m}`); return null; }
    case 'setWin': s.winScore = Math.max(1, Math.min(30, Number(a.value) || 8)); log(s, `Score de victoire : ${s.winScore}.`); return null;
    default: return 'action inconnue';
  }
}

// What a given seat is allowed to see.
function viewFor(s, seat) {
  const { history, ...v } = JSON.parse(JSON.stringify({ ...s, history: [] }));
  v.canUndo = s.history.length > 0;
  v.youAre = seat;
  const sees = p => s.solo || seat === p;
  const hide = c => ({ iid: c.iid, owner: c.owner, hidden: true, ex: c.ex });
  for (const p of SEATS) {
    const z = v.players[p].zones;
    if (!sees(p)) z.hand = z.hand.map(c => (c.rev ? c : hide(c)));
    for (const k of HIDDEN_ZONES) if (!sees(p)) z[k] = z[k].map(hide);
    for (const k of ZONES) if (k !== 'hand' && !sees(p)) z[k] = z[k].map(c => (c.fd ? hide(c) : c));
  }
  for (const b of v.bfs) for (const p of SEATS) if (!sees(p)) b.units[p] = b.units[p].map(c => (c.fd ? hide(c) : c));
  for (const b of v.bfs) b.hidden = (b.hidden || []).map(c => (sees(c.owner) ? c : hide(c)));
  // the cards a player predicts are only shown to that player
  if (v.pending && (v.pending.kind === 'predict' || (v.pending.kind === 'pick' && v.pending.top)) && !sees(v.pending.to)) v.pending = { ...v.pending, cards: [], top: [] };
  v.log = v.log.slice(-80);
  delete v.cd; delete v.fxQueue;
  // the opponent's battlefield pick stays secret until both have chosen
  if (v.bfPick) for (const p of SEATS) if (!sees(p) && v.bfPick[p]) v.bfPick[p] = 'hidden';
  return v;
}

// can player p answer the stack now? (a [Reaction] card they can pay, a hidden card ready to flip, a [Reaction] ability)
function canRespond(s, p) {
  const pl = s.players[p], runes = runesOf(s, p), pool = pl.pool || newPool();
  if (pl.zones.hand.some(c => { const d = cd(s, c); return R.kw(d.text).reaction && R.planCost(runes, pool, R.cardCost(d)); })) return true;
  if (s.bfs.some(b => (b.hidden || []).some(c => c.owner === p && s.turn > (c.hidT || 0)))) return true;
  return mineOnBoard(s, p).some(c => R.abilities(cd(s, c)).some(ab => ab.reaction && !c.ex));
}

module.exports = { canRespond, newState, apply, viewFor, hp, cd, other, runesOf, candidates, lethal, find };
