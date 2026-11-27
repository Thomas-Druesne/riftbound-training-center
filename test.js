// Self-check: node test.js  (reducer rules + AI vs AI games when the card cache exists)
const assert = require('assert');
const fs = require('fs');
const g = require('./game');
const AI = require('./ai');

const cards = [
  { id: 'L', name: 'Legend', type: 'Legend', domain: ['Fury'] }, { id: 'C', name: 'Champ', type: 'Unit', energy: 2, might: 3, domain: ['Fury'] },
  { id: 'U', name: 'Unit', type: 'Unit', energy: 2, might: 2, domain: ['Fury'], text: '[Assault 2]' },
  { id: 'R', name: 'Fury Rune', type: 'Rune', domain: ['Fury'] }, { id: 'B1', name: 'BF1', type: 'Battlefield' }, { id: 'B2', name: 'BF2', type: 'Battlefield' },
];
const deck = bf => ({ name: 'T', cards: { legend: [{ id: 'L', n: 1 }], champion: [{ id: 'C', n: 1 }], main: [{ id: 'U', n: 39 }], runes: [{ id: 'R', n: 12 }], battlefields: [{ id: bf, n: 1 }, { id: bf === 'B1' ? 'B2' : 'B1', n: 1 }] } });
function newGame(d1, d2, cs) {
  const s = g.newState();
  s.seats = { p1: { name: 'A' }, p2: { name: 'B' } };
  s.auto = { p1: true, p2: true }; // tests drive both seats like the AI unless a block says otherwise
  assert.equal(g.apply(s, { type: 'start', cards: cs, decks: { p1: d1, p2: d2 } }), null);
  return s;
}
// battlefield pick -> parity + die -> mulligan
function pregame(s, mull = { p1: [], p2: [] }) {
  for (const p of ['p1', 'p2']) if (s.stage === 'bf' && !s.bfPick[p]) assert.equal(g.apply(s, { type: 'chooseBf', seat: p, cid: s.bfOpts[p][0] }), null);
  const c = s.dice.caller;
  assert.ok(g.apply(s, { type: 'rollDice', seat: c }), 'must call parity before rolling');
  assert.ok(g.apply(s, { type: 'callParity', seat: other(c), parity: 'pair' }), 'only the caller calls');
  assert.equal(g.apply(s, { type: 'callParity', seat: c, parity: 'pair' }), null);
  assert.ok(s.dice.roll, 'choosing even/odd rolls the die');
  assert.equal(s.first, (s.dice.roll % 2 === 0) ? c : other(c));
  for (const p of ['p1', 'p2']) assert.equal(g.apply(s, { type: 'mulligan', seat: p, iids: mull[p](s) }), null);
  assert.equal(s.stage, 'main');
}
const other = p => (p === 'p1' ? 'p2' : 'p1');

/* ---- reducer ---- */
const s = newGame(deck('B1'), deck('B2'), cards);
s.auto = { p1: true, p2: true };
const z = s.players.p1.zones;
assert.equal(s.stage, 'bf'); assert.equal(s.bfs.length, 0);
assert.ok(g.apply(s, { type: 'move', seat: 'p1', iid: 'c1', to: { p: 'p1', zone: 'base' } }), 'no board action before the game starts');
g.apply(s, { type: 'chooseBf', seat: 'p1', cid: 'B1' });
assert.equal(g.viewFor(s, 'p2').bfPick.p1, 'hidden', 'opponent pick hidden');
assert.ok(g.apply(s, { type: 'mulligan', seat: 'p1', iids: ['c1', 'c2', 'c3'] }), 'mulligan not during bf pick');
pregame(s, { p1: s => s.players.p1.zones.hand.slice(0, 2).map(c => c.iid), p2: () => [] });
// the first player's turn starts automatically: ready, channel 2, draw 1
const p1First = s.first === 'p1';
assert.equal(z.hand.length, p1First ? 5 : 4); assert.equal(z.runes.length, p1First ? 2 : 0); assert.equal(s.bfs.length, 2);
assert.ok(g.apply(s, { type: 'startTurn', seat: s.first }), 'turn already started');
const v = g.viewFor(s, 'p2');
assert.ok(v.players.p1.zones.hand.every(c => c.hidden && !c.cid), 'opponent hand hidden');
assert.ok(v.players.p1.zones.main.every(c => !c.cid), 'opponent deck hidden');

if (!p1First) { assert.equal(g.apply(s, { type: 'endTurn', seat: 'p2' }), null); assert.equal(z.runes.length, 3, 'second player channels 3 on turn 1'); }
z.runes.forEach(r => (r.ex = true)); z.runes[0].ex = z.runes[1].ex = false; // exactly 2 ready runes
// autopay: unit costs 2 energy -> both ready runes exhausted, unit enters exhausted
const u = z.hand.find(c => c.cid === 'U') || (z.hand.push({ ...z.main[0], cid: 'U' }), z.hand[z.hand.length - 1]);
assert.equal(g.apply(s, { type: 'play', seat: 'p1', iid: u.iid }), null);
assert.ok(z.runes.every(r => r.ex) && z.base[0].ex);
assert.ok(g.apply(s, { type: 'play', seat: 'p1', iid: z.hand[0].iid }), 'no runes left');
// moving to an empty battlefield conquers (+1) and exhausts
z.base[0].ex = false;
g.apply(s, { type: 'move', seat: 'p1', iid: u.iid, to: { bf: 0, side: 'p1' } });
assert.equal(s.bfs[0].ctrl, 'p1'); assert.equal(s.players.p1.score, 1); assert.ok(u.ex);
// combat: 2 might + assault 2 = 4 vs a 3 might defender -> defender dies, attacker survives, conquer
const z2 = s.players.p2.zones;
const dfd = z2.champion[0];
g.apply(s, { type: 'move', seat: 'p2', iid: dfd.iid, to: { bf: 1, side: 'p2' }, free: true });
assert.equal(s.bfs[1].ctrl, 'p2');
assert.ok(g.apply(s, { type: 'move', seat: 'p1', iid: u.iid, to: { bf: 1, side: 'p1' } }), 'exhausted unit, no Ganking: standard move refused');
g.apply(s, { type: 'move', seat: 'p1', iid: u.iid, to: { bf: 1, side: 'p1' }, free: true });
assert.equal(s.bfs[0].ctrl, null, 'leaving a battlefield drops control');
assert.ok(s.showdown && s.showdown.bf === 1, 'moving into enemy units opens a showdown');
g.apply(s, { type: 'pass', seat: 'p1' }); g.apply(s, { type: 'pass', seat: 'p2' });
assert.equal(s.showdown, null, 'two passes: combat');
assert.equal(s.bfs[1].ctrl, 'p1'); assert.equal(z2.trash[0].iid, dfd.iid); assert.equal(s.players.p1.score, 2);
g.apply(s, { type: 'undo', seat: 'p1' });
assert.equal(s.bfs[1].ctrl, 'p2', 'undo restores the combat');
/* ---- play effects: opponent discard prompt, units enter exhausted ---- */
{
  const cs = [...cards, { id: 'BW', name: 'Bewitching Spirit', type: 'Unit', energy: 0, might: 2, domain: ['Fury'], text: 'When you play me, choose a player. They discard 1.' },
    { id: 'RD', name: 'Ready Guy', type: 'Unit', energy: 0, might: 1, domain: ['Fury'], text: 'I enter ready.' }];
  const t = newGame(deck('B1'), deck('B2'), cs);
  pregame(t, { p1: () => [], p2: () => [] });
  t.active = 'p1'; // p1 acts on its own turn
  const h1 = t.players.p1.zones.hand, h2 = t.players.p2.zones.hand;
  t.cd.BW = cs.find(c => c.id === 'BW'); t.cd.RD = cs.find(c => c.id === 'RD');
  h1.push({ iid: 'x1', cid: 'BW', owner: 'p1', ex: false, dmg: 0, buff: 0 }, { iid: 'x2', cid: 'RD', owner: 'p1', ex: false, dmg: 0, buff: 0 });
  assert.ok(g.apply(t, { type: 'play', seat: 'p1', iid: 'x1', to: { bf: 0 } }), 'non-Ambush units cannot be played to a battlefield');
  assert.equal(g.apply(t, { type: 'play', seat: 'p1', iid: 'x1' }), null);
  assert.ok(t.players.p1.zones.base.find(c => c.iid === 'x1').ex, 'units enter exhausted');
  assert.equal(t.pending.kind, 'discard'); assert.equal(t.pending.to, 'p2');
  assert.ok(g.apply(t, { type: 'draw', seat: 'p1' }), 'blocked while the opponent chooses');
  const n2 = h2.length;
  const ai = AI.next(t, 'p2', 'hard', {});
  assert.equal(ai.type, 'resolve', 'AI answers the discard prompt');
  assert.equal(g.apply(t, { ...ai, seat: 'p2' }), null);
  assert.equal(h2.length, n2 - 1); assert.equal(t.pending, null);
  g.apply(t, { type: 'play', seat: 'p1', iid: 'x2' });
  assert.equal(t.players.p1.zones.base.find(c => c.iid === 'x2').ex, false, '"I enter ready" units stay ready');
}
/* ---- rune pool, Deathknell tokens, buff prompt ---- */
{
  const cs = [...cards, { id: 'FF', name: 'Ferrous Forerunner', type: 'Unit', energy: 6, power: 1, might: 6, domain: ['Fury'], text: '[Deathknell] — Play two 3 :rb_might: Mech unit tokens to your base. (When I die, get the effect.)' },
    { id: 'PR', name: 'Pit Rookie', type: 'Unit', energy: 0, might: 2, domain: ['Fury'], text: "When you play me, buff another friendly unit. (If it doesn't have a buff, it gets a +1 :rb_might: buff.)" }];
  const t = newGame(deck('B1'), deck('B2'), cs);
  pregame(t, { p1: () => [], p2: () => [] });
  const P = t.first, Z = t.players[P].zones;
  t.auto = { p1: true, p2: true };
  t.cd.FF = cs[cs.length - 2]; t.cd.PR = cs[cs.length - 1];
  while (Z.runes.length < 7) g.apply(t, { type: 'channel', seat: P, n: 1 });
  // exhaust 6 runes by hand and recycle a 7th: the pool pays the whole cost
  Z.runes.slice(0, 6).forEach(r => g.apply(t, { type: 'exhaust', seat: P, iid: r.iid }));
  g.apply(t, { type: 'recycle', seat: P, iid: Z.runes[6].iid });
  assert.deepEqual([t.players[P].pool.e, t.players[P].pool.p.length], [6, 1]);
  Z.hand.push({ iid: 'ff', cid: 'FF', owner: P, ex: false, dmg: 0, buff: 0 });
  assert.equal(g.apply(t, { type: 'play', seat: P, iid: 'ff' }), null, 'pool pays 6 energy + 1 power');
  assert.deepEqual([t.players[P].pool.e, t.players[P].pool.p.length], [0, 0]);
  g.apply(t, { type: 'kill', seat: P, iid: 'ff' });
  const mechs = Z.base.filter(c => t.cd[c.cid].name === 'Mech');
  assert.equal(mechs.length, 2, 'Deathknell plays two Mech tokens'); assert.equal(g.hp(t, mechs[0]), 3);
  g.apply(t, { type: 'move', seat: P, iid: mechs[0].iid, to: { p: P, zone: 'trash' } });
  assert.ok(!Z.trash.some(c => c.iid === mechs[0].iid), 'tokens vanish outside the board');
  Z.hand.push({ iid: 'pr', cid: 'PR', owner: P, ex: false, dmg: 0, buff: 0 });
  g.apply(t, { type: 'token', seat: P, name: 'Recruit', n: 1 });
  assert.equal(g.apply(t, { type: 'play', seat: P, iid: 'pr' }), null);
  assert.equal(t.pending.kind, 'buff', 'two other units: choose one');
  assert.ok(g.apply(t, { type: 'resolve', seat: P, iids: ['pr'] }), 'not itself');
  assert.equal(g.apply(t, { type: 'resolve', seat: P, iids: [mechs[1].iid] }), null);
  assert.equal(g.hp(t, mechs[1]), 4, 'buffed +1');
}
/* ---- core rules: scoring once per turn, final point, Burn Out, timing, targets, Hidden, Equip ---- */
{
  const cs = [...cards,
    { id: 'BOLT', name: 'Bolt', type: 'Spell', energy: 0, domain: ['Fury'], text: 'Deal 3 to a unit at a battlefield.' },
    { id: 'RX', name: 'Quick', type: 'Spell', energy: 0, domain: ['Fury'], text: '[Reaction] (Play any time.) Draw 1.' },
    { id: 'HID', name: 'Sneak', type: 'Spell', energy: 5, domain: ['Fury'], text: '[Hidden] (Hide now.) Draw 2.' },
    { id: 'SW', name: 'Sword', type: 'Gear', energy: 0, might: 3, domain: ['Fury'], tags: ['Equipment'], text: '[Equip] :rb_rune_fury: (Attach.)' }];
  const t = newGame(deck('B1'), deck('B2'), cs);
  pregame(t, { p1: () => [], p2: () => [] });
  for (const c of cs.slice(-4)) t.cd[c.id] = c;
  t.auto = { p1: true, p2: true };
  const P = t.active, O = other(P), Z = t.players[P].zones, pl = t.players[P];
  const mkc = (id, cid, who = P) => ({ iid: id, cid, owner: who, ex: false, dmg: 0, buff: 0 });
  // conquer once per battlefield per turn
  const a = mkc('a1', 'U'); Z.base.push(a);
  g.apply(t, { type: 'move', seat: P, iid: 'a1', to: { bf: 0, side: P } });
  assert.equal(pl.score, 1);
  g.apply(t, { type: 'move', seat: P, iid: 'a1', to: { p: P, zone: 'base' }, free: true });
  g.apply(t, { type: 'move', seat: P, iid: 'a1', to: { bf: 0, side: P }, free: true });
  assert.equal(pl.score, 1, 'a battlefield scores once per turn');
  // final point: at 7, conquering without having scored every battlefield draws instead
  pl.score = 7; const h0 = Z.hand.length;
  const b = mkc('b1', 'U'); Z.base.push(b);
  t.scored[P] = []; // pretend bf 0 was not scored
  g.apply(t, { type: 'move', seat: P, iid: 'b1', to: { bf: 1, side: P } });
  assert.equal(pl.score, 7, 'final point refused'); assert.equal(Z.hand.length, h0 + 1, 'draws instead');
  // timing: a normal card cannot be played on the opponent's turn, a Reaction can
  const oz = t.players[O].zones; oz.hand.push(mkc('rx', 'RX', O), mkc('nx', 'U', O));
  assert.ok(g.apply(t, { type: 'play', seat: O, iid: 'nx' }), 'not your turn');
  assert.equal(g.apply(t, { type: 'play', seat: O, iid: 'rx' }), null, 'Reaction on the opponent turn');
  assert.equal(t.chain.length, 1, 'spells go on the stack');
  g.apply(t, { type: 'chainPass', seat: P }); g.apply(t, { type: 'chainResolve', seat: O });
  assert.equal(t.chain.length, 0);
  // targeted spell: pre-chosen target, damage kills
  const e1 = mkc('e1', 'U', O); t.bfs[1].units[O].push(e1);
  Z.hand.push(mkc('bolt', 'BOLT'));
  assert.equal(g.apply(t, { type: 'play', seat: P, iid: 'bolt', targets: ['e1'] }), null);
  g.apply(t, { type: 'chainPass', seat: O }); g.apply(t, { type: 'chainResolve', seat: P });
  assert.ok(oz.trash.some(c => c.iid === 'e1'), 'Bolt kills the 2 might unit');
  // Burn Out: empty deck -> trash shuffled in, opponent +1
  const os = t.players[O].score; Z.trash.push(...Z.main.splice(0));
  g.apply(t, { type: 'draw', seat: P, n: 1 });
  assert.equal(t.players[O].score, os + 1, 'Burn Out gives the opponent 1 point'); assert.ok(Z.main.length > 0);
  // Hidden: 1 power to hide at a controlled battlefield, played free next turn
  while (Z.runes.length < 3) g.apply(t, { type: 'channel', seat: P, n: 1 });
  Z.hand.push(mkc('hid', 'HID'));
  assert.equal(g.apply(t, { type: 'hide', seat: P, iid: 'hid', bf: 1 }), null);
  assert.equal(t.bfs[1].hidden.length, 1); assert.ok(g.viewFor(t, O).bfs[1].hidden[0].hidden, 'hidden from the opponent');
  assert.ok(g.apply(t, { type: 'play', seat: P, iid: 'hid' }), 'not the same turn');
  t.turn++;
  assert.equal(g.apply(t, { type: 'play', seat: P, iid: 'hid' }), null, 'free next turn');
  // Equip: +3 might
  Z.base.push(mkc('sw', 'SW'));
  Z.runes.forEach(r => (r.ex = false));
  assert.equal(g.apply(t, { type: 'equip', seat: P, iid: 'sw', unit: 'b1' }), null);
  assert.equal(g.hp(t, b), 5, 'equipment adds its Might');
}
/* ---- manual human vs AI: no payment, stack, AI reacts, opponent-side effects only ---- */
{
  const cs = [...cards,
    { id: 'SAB', name: 'Sabotage', type: 'Spell', energy: 1, power: 1, domain: ['Fury'], text: 'Choose an opponent. They reveal their hand. Choose a non-unit card from it, and recycle that card.' },
    { id: 'CTR', name: 'Nope', type: 'Spell', energy: 0, domain: ['Fury'], text: '[Reaction] (Play any time.) Counter a spell.' },
    { id: 'PUMP', name: 'Pump', type: 'Spell', energy: 0, domain: ['Fury'], text: '[Action] (Showdowns.) Give a unit +5 :rb_might: this turn.' }];
  const t = newGame(deck('B1'), deck('B2'), cs);
  pregame(t, { p1: () => [], p2: () => [] });
  for (const c of cs.slice(-3)) t.cd[c.id] = c;
  const H = t.active, A = other(H); t.auto = { [A]: true };
  const ZH = t.players[H].zones, ZA = t.players[A].zones;
  const mkc = (id, cid, who) => ({ iid: id, cid, owner: who, ex: false, dmg: 0, buff: 0 });
  const ready = ZH.runes.filter(r => !r.ex).length;
  ZH.hand.push(mkc('sab', 'SAB', H));
  assert.equal(g.apply(t, { type: 'play', seat: H, iid: 'sab' }), null, 'human plays without paying');
  assert.equal(ZH.runes.filter(r => !r.ex).length, ready, 'no rune touched');
  assert.ok(g.apply(t, { type: 'chainResolve', seat: H }), 'the AI decides first');
  assert.deepEqual(AI.next(t, A, 'hard', {}), { type: 'chainPass' }, 'nothing to answer with');
  g.apply(t, { type: 'chainPass', seat: A });
  assert.equal(g.apply(t, { type: 'chainResolve', seat: H }), null);
  assert.ok(ZA.hand.every(c => c.rev), 'Sabotage reveals the AI hand');
  assert.ok(g.viewFor(t, H).players[A].zones.hand.every(c => c.cid), 'the human sees it');
  // the AI counters a costly spell
  ZA.hand.push(mkc('ctr', 'CTR', A)); ZH.hand.push(mkc('sab2', 'SAB', H));
  g.apply(t, { type: 'play', seat: H, iid: 'sab2' });
  const r = AI.next(t, A, 'hard', {});
  assert.equal(r.iid, 'ctr', 'hard AI counters');
  assert.equal(g.apply(t, { ...r, seat: A }), null);
  g.apply(t, { type: 'chainPass', seat: H });
  assert.equal(t.chain.length, 0); assert.ok(ZH.trash.some(c => c.iid === 'sab2'), 'countered');
}
{
  const cs = [...cards, { id: 'PUMP', name: 'Pump', type: 'Spell', energy: 0, domain: ['Fury'], text: '[Action] (Showdowns.) Give a unit +5 :rb_might: this turn.' }];
  const t = newGame(deck('B1'), deck('B2'), cs);
  pregame(t, { p1: () => [], p2: () => [] });
  t.cd.PUMP = cs[cs.length - 1];
  const H = t.active, A = other(H); t.auto = { [A]: true };
  const mkc = (id, cid, who) => ({ iid: id, cid, owner: who, ex: false, dmg: 0, buff: 0 });
  t.bfs[0].units[A].push(mkc('a1', 'U', A)); t.bfs[0].ctrl = A;
  t.players[H].zones.base.push(mkc('h1', 'U', H));
  t.players[A].zones.hand.push(mkc('pump', 'PUMP', A));
  g.apply(t, { type: 'move', seat: H, iid: 'h1', to: { bf: 0, side: H } });
  assert.ok(t.showdown && t.showdown.focus === H, 'attacker has Focus');
  g.apply(t, { type: 'pass', seat: H });
  const r = AI.next(t, A, 'hard', {});
  assert.deepEqual([r.type, r.iid, r.targets[0]], ['play', 'pump', 'a1'], 'AI answers the attack with a combat trick');
  g.apply(t, { ...r, seat: A });
  g.apply(t, { type: 'chainPass', seat: H }); // let it resolve
  assert.equal(t.showdown.focus, H, 'Focus back to the attacker');
  g.apply(t, { type: 'pass', seat: H });
  g.apply(t, { ...AI.next(t, A, 'hard', {}), seat: A });
  assert.equal(t.showdown, null);
  assert.equal(t.bfs[0].units[H].length, 1, 'manual mode: no automatic combat damage');
  g.apply(t, { type: 'fight', seat: H, bf: 0, att: H }); // the human asks for the calculation (⚔)
  assert.ok(t.players[H].zones.trash.some(c => c.iid === 'h1'), 'attacker died'); assert.equal(t.bfs[0].ctrl, A);
}
/* ---- a human draws the opening hand and the mulligan replacements by hand ---- */
{
  const t = g.newState(); t.seats = { p1: { name: 'A' }, p2: { name: 'B' } }; t.auto = { p2: true };
  g.apply(t, { type: 'start', cards, decks: { p1: deck('B1'), p2: deck('B2') } });
  for (const p of ['p1', 'p2']) g.apply(t, { type: 'chooseBf', seat: p, cid: t.bfOpts[p][0] });
  g.apply(t, { type: 'callParity', seat: t.dice.caller, parity: 'pair' });
  const hand = () => t.players.p1.zones.hand;
  assert.equal(hand().length, 4, 'opening hand drawn for everyone');
  const out = [hand()[0].iid, hand()[1].iid];
  g.apply(t, { type: 'mulligan', seat: 'p1', iids: out });
  assert.equal(hand().length, 4, 'replacements drawn at once');
  assert.equal(t.players.p1.mullNew.length, 2, 'the new cards are shown'); assert.ok(!t.players.p1.mullDone);
  assert.ok(!hand().some(c => out.includes(c.iid)) && t.players.p1.zones.main.slice(-2).every(c => out.includes(c.iid)), 'sent under the deck');
  assert.equal(g.apply(t, { type: 'mullConfirm', seat: 'p1' }), null);
  assert.ok(t.players.p1.mullDone);
  g.apply(t, { type: 'mulligan', seat: 'p2', iids: [] });
  assert.equal(t.stage, 'main');
  const z = t.players[t.active].zones, n = z.hand.length;
  if (t.active === 'p1') assert.equal(n, 4, 'the human draws the turn card by hand');
}
{
  const t = newGame(deck('B1'), deck('B2'), cards);
  pregame(t, { p1: () => [], p2: () => [] });
  const mkc = (id, cid, who) => ({ iid: id, cid, owner: who, ex: false, dmg: 0, buff: 0 });
  const A = mkc('d1', 'C', 'p1'), B = mkc('d2', 'U', 'p2'); A.tb = 2; // champion 3 +2 = 5 vs unit 2
  t.players.p1.zones.base.push(A); t.bfs[0].units.p2.push(B);
  assert.equal(g.apply(t, { type: 'duel', seat: 'p1', iid: 'd1', target: 'd2' }), null);
  assert.ok(t.players.p2.zones.trash.some(c => c.iid === 'd2'), 'duel kills the weaker unit'); assert.equal(A.dmg, 2);
}
{ // declared targets stay on the stack item; Hidden in manual mode; Hidden without brackets
  assert.ok(require('./rules').kw('Hidden (Hide now for :rb_rune_rainbow: to react with later.) When you play me...').hidden);
  const cs = [...cards, { id: 'S', name: 'Zap', type: 'Spell', energy: 0, domain: ['Fury'], text: 'Deal 3 to a unit. Deal 3 to a unit.' },
    { id: 'H', name: 'Sneak', type: 'Unit', energy: 2, might: 2, domain: ['Fury'], text: '[Hidden] (Hide now.)' }];
  const t = newGame(deck('B1'), deck('B2'), cs);
  pregame(t, { p1: () => [], p2: () => [] });
  t.auto = { p2: true }; t.active = 'p1'; t.cd.S = cs[6]; t.cd.H = cs[7];
  const mkc = (id, cid, who) => ({ iid: id, cid, owner: who, ex: false, dmg: 0, buff: 0 });
  t.bfs[0].units.p1.push(mkc('h1', 'U', 'p1')); t.bfs[1].units.p2.push(mkc('h2', 'U', 'p2'), mkc('h4', 'U', 'p2'));
  t.players.p1.zones.hand.push(mkc('z1', 'S', 'p1'), mkc('z2', 'H', 'p1'));
  assert.equal(g.apply(t, { type: 'play', seat: 'p1', iid: 'z1', targets: ['h2', 'nope', 7, 'h4'] }), null);
  assert.deepEqual(t.chain[t.chain.length - 1].cb.targets, ['h2', 'h4'], 'only real targets are kept');
  g.apply(t, { type: 'chainPass', seat: 'p2' }); g.apply(t, { type: 'chainResolve', seat: 'p1' });
  assert.ok(!t.chain.length);
  assert.ok(!t.bfs[1].units.p2.length && t.bfs[0].units.p1.length === 1, 'the spell hits the declared targets only');
  t.bfs[1].units.p2.push(mkc('h5', 'U', 'p2'));
  assert.ok(g.apply(t, { type: 'hide', seat: 'p1', iid: 'z2', bf: 1 }), 'not where the opponent has units');
  assert.equal(g.apply(t, { type: 'hide', seat: 'p1', iid: 'z2', bf: 0 }), null, 'manual: your units there are enough');
  assert.equal(t.bfs[0].ctrl, 'p1'); assert.equal(t.bfs[0].hidden[0].iid, 'z2');
  // undo past the opening of a showdown removes it
  assert.ok(!t.showdown);
  assert.equal(g.apply(t, { type: 'move', seat: 'p1', iid: 'h1', to: { bf: 1, side: 'p1' }, free: true }), null);
  assert.ok(t.showdown, 'moving next to an enemy unit opens a showdown');
  assert.equal(g.apply(t, { type: 'undo', seat: 'p1' }), null);
  assert.ok(!t.showdown, 'undo removes the showdown');
  // the AI declares both targets of a two-target spell when casting
  const u = newGame(deck('B1'), deck('B2'), cs);
  pregame(u, { p1: () => [], p2: () => [] });
  u.cd.S = cs[6]; u.active = 'p2'; u.players.p2.zones.hand = [mkc('y1', 'S', 'p2')];
  u.bfs[0].units.p1.push(mkc('e1', 'C', 'p1'), mkc('e2', 'U', 'p1'));
  let cast = null;
  for (let i = 0; i < 20 && !cast; i++) { const a = AI.next(u, 'p2', 'normal', {}); if (!a) break; if (a.type === 'play' && a.iid === 'y1') cast = a; else break; }
  assert.ok(cast, 'the AI casts the spell'); assert.deepEqual(cast.targets.length, 2, 'two targets declared');
}
{ // card effects from the per-card table, on the real card texts
  const real = fs.existsSync('./data/cards.json') ? require('./data/cards.json') : null;
  const get = n => real && real.find(c => c.name === n);
  if (real) {
    const cs = [...cards, ...['Thrill of the Hunt', 'Challenge', 'Defy', 'Falling Star', 'Cannon Barrage', 'Singularity', 'Hush'].map(get)];
    const setup = () => {
      const t = newGame(deck('B1'), deck('B2'), cs);
      pregame(t, { p1: () => [], p2: () => [] });
      for (const c of cs) t.cd[c.id] = c;
      t.auto = {}; t.active = 'p1';
      return t;
    };
    const mkc = (id, name, who) => ({ iid: id, cid: name.length > 2 ? get(name).id : name, owner: who, ex: false, dmg: 0, buff: 0 });
    const cast = (t, who, iid, targets, extra = {}) => { assert.equal(g.apply(t, { type: 'play', seat: who, iid, targets, ...extra }), null); };
    const pass = (t, who) => assert.equal(g.apply(t, { type: 'chainPass', seat: other(who) }), null);
    // Thrill of the Hunt during a showdown: the unit is banished and played to the chosen battlefield
    let s1 = setup();
    s1.bfs[0].units.p1.push(mkc('a1', 'U', 'p1')); s1.bfs[1].units.p1.push(mkc('a2', 'C', 'p1')); s1.bfs[0].units.p2.push(mkc('b1', 'U', 'p2'));
    s1.showdown = { bf: 0, att: 'p1', focus: 'p1', passes: 0, fresh: false, last: null };
    s1.players.p1.zones.hand.push(mkc('th', 'Thrill of the Hunt', 'p1'));
    cast(s1, 'p1', 'th', ['a2']); pass(s1, 'p1');
    assert.equal(s1.pending.kind, 'bf', 'the human chooses the battlefield');
    assert.equal(g.apply(s1, { type: 'resolve', seat: 'p1', bf: 0 }), null);
    assert.ok(s1.bfs[0].units.p1.some(c => c.iid === 'a2') && !s1.bfs[1].units.p1.length, 'Thrill: unit joins the fight');
    // Challenge: the two chosen units deal their Might to each other (declared in any order)
    let s2 = setup();
    s2.bfs[0].units.p1.push(mkc('a1', 'C', 'p1')); s2.bfs[1].units.p2.push(mkc('b1', 'U', 'p2'));
    s2.players.p1.zones.hand.push(mkc('ch', 'Challenge', 'p1'));
    cast(s2, 'p1', 'ch', ['b1', 'a1']); pass(s2, 'p1');
    assert.ok(!s2.bfs[1].units.p2.length && s2.bfs[0].units.p1[0].dmg === 2, 'Challenge: 3 kills the 2, takes 2');
    // Defy counters a cheap spell, not one costing 2 Power (Hush does)
    let s3 = setup();
    s3.bfs[0].units.p2.push(mkc('b1', 'U', 'p2'), mkc('b2', 'U', 'p2'));
    s3.players.p1.zones.hand.push(mkc('fs', 'Falling Star', 'p1')); s3.players.p2.zones.hand.push(mkc('df', 'Defy', 'p2'), mkc('hu', 'Hush', 'p2'));
    cast(s3, 'p1', 'fs', ['b1', 'b2']);
    cast(s3, 'p2', 'df', []); pass(s3, 'p2');
    assert.equal(s3.chain.length, 1, 'Defy cannot counter a 2-Power spell');
    cast(s3, 'p2', 'hu', []); pass(s3, 'p2');
    assert.equal(s3.chain.length, 0, 'Hush counters it'); assert.equal(s3.bfs[0].units.p2.length, 2);
    // Cannon Barrage: 2 to every enemy unit in the combat only
    let s4 = setup();
    s4.bfs[0].units.p2.push(mkc('b1', 'U', 'p2')); s4.bfs[1].units.p2.push(mkc('b2', 'U', 'p2')); s4.bfs[0].units.p1.push(mkc('a1', 'C', 'p1'));
    s4.showdown = { bf: 0, att: 'p1', focus: 'p1', passes: 0, fresh: false, last: null };
    s4.players.p1.zones.hand.push(mkc('cb', 'Cannon Barrage', 'p1'));
    cast(s4, 'p1', 'cb', []); pass(s4, 'p1');
    assert.ok(!s4.bfs[0].units.p2.length && s4.bfs[1].units.p2.length === 1 && !s4.bfs[0].units.p1[0].dmg);
    // a blinked unit is a new object: Falling Star loses that target
    let s5 = setup();
    s5.bfs[0].units.p2.push(mkc('b1', 'U', 'p2'), mkc('b2', 'U', 'p2'));
    s5.players.p1.zones.hand.push(mkc('fs', 'Falling Star', 'p1')); s5.players.p2.zones.hand.push(mkc('th', 'Thrill of the Hunt', 'p2'));
    cast(s5, 'p1', 'fs', ['b1', 'b2']);
    cast(s5, 'p2', 'th', ['b1'], { bf: 0 }); pass(s5, 'p2');
    pass(s5, 'p1');
    assert.ok(s5.bfs[0].units.p2.some(c => c.iid === 'b1') && !s5.bfs[0].units.p2.some(c => c.iid === 'b2'), 'only the other target is hit');
    // optional targets: Singularity with one declared target hits only it
    let s6 = setup();
    s6.bfs[0].units.p2.push(mkc('b1', 'C', 'p2')); s6.bfs[0].units.p1.push(mkc('a1', 'C', 'p1'));
    s6.players.p1.zones.hand.push(mkc('si', 'Singularity', 'p1'));
    cast(s6, 'p1', 'si', ['b1']); pass(s6, 'p1');
    assert.ok(!s6.pending && !s6.bfs[0].units.p2.length && s6.bfs[0].units.p1.length === 1, 'the second hit is skipped');
    // the AI saves its unit: Thrill of the Hunt in answer to a lethal spell
    let s7 = setup(); s7.auto = { p2: true };
    s7.bfs[0].units.p2.push(mkc('b1', 'C', 'p2'));
    s7.players.p1.zones.hand.push(mkc('fs', 'Falling Star', 'p1')); s7.players.p2.zones.hand = [mkc('th', 'Thrill of the Hunt', 'p2')];
    s7.players.p2.pool = { e: 5, p: ['any', 'any'] };
    cast(s7, 'p1', 'fs', ['b1']);
    const r7 = AI.next(s7, 'p2', 'normal', {});
    assert.equal(r7.iid, 'th', 'the AI answers with Thrill of the Hunt');
  }
}
{ // abilities, auras, triggers, stack ownership (real card texts)
  const real = fs.existsSync('./data/cards.json') ? require('./data/cards.json') : null;
  const get = n => real && real.find(c => c.name === n);
  if (real) {
    const names = ['Garen, Commander', 'Iron Ballista', 'Vicious Snapjaws', 'Carnivorous Snapvine', 'Falling Star', 'Bilgewater Tracker'];
    const cs = [...cards, ...names.map(get)];
    const t = newGame(deck('B1'), deck('B2'), cs);
    pregame(t, { p1: () => [], p2: () => [] });
    for (const c of cs) t.cd[c.id] = c;
    t.auto = { p2: true }; t.active = 'p1'; t.started = t.turn;
    const mkc = (id, name, who) => ({ iid: id, cid: name.length > 2 ? get(name).id : name, owner: who, ex: false, dmg: 0, buff: 0 });
    // aura: Garen gives the other friendly units at his battlefield +1 Might
    const u1 = mkc('u1', 'U', 'p1'), u2 = mkc('u2', 'U', 'p1');
    t.bfs[0].units.p1.push(mkc('ga', 'Garen, Commander', 'p1'), u1); t.players.p1.zones.base.push(u2);
    assert.equal(g.hp(t, u1), 3, 'Garen: +1 here'); assert.equal(g.hp(t, u2), 2, 'not in base');
    // activated ability: Iron Ballista deals 2 to a unit at a battlefield (declared target)
    const e1 = mkc('e1', 'U', 'p2'); t.bfs[1].units.p2.push(e1);
    t.players.p1.zones.base.push(mkc('ib', 'Iron Ballista', 'p1'));
    assert.equal(g.apply(t, { type: 'activate', seat: 'p1', iid: 'ib', k: 0, targets: ['e1'] }), null);
    assert.ok(!t.bfs[1].units.p2.length && g.find(t, 'ib').c.ex, 'Ballista kills the 2-Might unit and is exhausted');
    assert.ok(g.apply(t, { type: 'activate', seat: 'p1', iid: 'ib', k: 0 }), 'not twice');
    // trigger: Vicious Snapjaws gains 1 XP when another friendly unit dies
    t.players.p1.zones.base.push(mkc('vs', 'Vicious Snapjaws', 'p1'));
    const xp = t.players.p1.xp || 0;
    assert.equal(g.apply(t, { type: 'kill', seat: 'p1', iid: 'u2' }), null);
    assert.equal(t.players.p1.xp, xp + 1, 'Snapjaws: +1 XP');
    // play effect: Carnivorous Snapvine duels an enemy unit at a battlefield
    const e2 = mkc('e2', 'U', 'p2'); t.bfs[1].units.p2.push(e2);
    t.players.p1.zones.hand.push(mkc('sv', 'Carnivorous Snapvine', 'p1'));
    assert.equal(g.apply(t, { type: 'play', seat: 'p1', iid: 'sv', targets: ['e2'] }), null);
    assert.ok(!t.bfs[1].units.p2.length, 'Snapvine kills the enemy');
    // stack: only the owner resolves its spell; the opponent lets it through
    t.players.p2.zones.hand.push(mkc('fs', 'Falling Star', 'p2'));
    t.active = 'p2'; t.auto = { p1: true }; // p2 casts without paying (manual), p1 lets it through
    assert.equal(g.apply(t, { type: 'play', seat: 'p2', iid: 'fs', targets: ['u1'] }), null);
    assert.ok(g.apply(t, { type: 'chainResolve', seat: 'p1' }), 'p1 cannot resolve p2 spell');
    assert.equal(g.apply(t, { type: 'chainPass', seat: 'p1' }), null);
    assert.equal(g.apply(t, { type: 'chainResolve', seat: 'p2' }), null);
    assert.ok(!t.chain.length);
    // Rengar, Trophy Hunter enters a battlefield where only the enemy has units; others can't
    const rg = get('Rengar, Trophy Hunter');
    t.cd[rg.id] = rg; t.active = 'p1'; t.auto = { p1: true, p2: true }; t.chain = []; t.showdown = null; t.pending = null; t.fxQueue = [];
    t.players.p1.pool = { e: 20, p: ['any', 'any', 'any'] };
    t.bfs[1].units.p1 = []; t.bfs[1].units.p2 = [mkc('e9', 'U', 'p2')]; t.bfs[1].ctrl = 'p2';
    t.players.p1.zones.hand.push(mkc('rg', 'Rengar, Trophy Hunter', 'p1'), mkc('u9', 'U', 'p1'));
    assert.ok(g.apply(t, { type: 'play', seat: 'p1', iid: 'u9', to: { bf: 1 } }), 'a normal unit cannot');
    assert.equal(g.apply(t, { type: 'play', seat: 'p1', iid: 'rg', to: { bf: 1 } }), null, 'Rengar can');
    assert.ok(t.bfs[1].units.p1.some(c => c.iid === 'rg') && t.showdown && t.showdown.att === 'p1', 'he attacks there');
  }
}
{ // Bellows Breath: 1 damage to up to three DIFFERENT units at the SAME location
  const real = fs.existsSync('./data/cards.json') ? require('./data/cards.json') : null;
  const bb = real && real.find(c => c.name === 'Bellows Breath');
  if (bb) {
    const t = newGame(deck('B1'), deck('B2'), [...cards, bb]);
    pregame(t, { p1: () => [], p2: () => [] });
    t.cd[bb.id] = bb; t.auto = {}; t.active = 'p1'; t.started = t.turn;
    const mkc = (id, cid, who) => ({ iid: id, cid, owner: who, ex: false, dmg: 0, buff: 0 });
    t.bfs[0].units.p2.push(mkc('x1', 'C', 'p2'), mkc('x2', 'C', 'p2')); t.bfs[1].units.p2.push(mkc('y1', 'C', 'p2'));
    t.players.p1.zones.hand.push(mkc('bb', bb.id, 'p1'));
    assert.equal(g.apply(t, { type: 'play', seat: 'p1', iid: 'bb' }), null);
    g.apply(t, { type: 'chainPass', seat: 'p2' });
    assert.equal(t.pending.kind, 'target');
    assert.equal(g.apply(t, { type: 'resolve', seat: 'p1', iids: ['x1'] }), null);
    assert.deepEqual(t.pending.opts, ['x2'], 'second hit: another unit, same battlefield');
    assert.ok(g.apply(t, { type: 'resolve', seat: 'p1', iids: ['x1'] }), 'not the same unit twice');
    assert.equal(g.apply(t, { type: 'resolve', seat: 'p1', iids: ['x2'] }), null);
    assert.ok(!t.pending, 'no third unit there: done');
    assert.deepEqual([t.bfs[0].units.p2.map(c => c.dmg), t.bfs[1].units.p2[0].dmg], [[1, 1], 0]);
  }
}
{ // undo 'mine': back to before my own last action, the opponent's moves since included
  const t = newGame(deck('B1'), deck('B2'), cards);
  pregame(t, { p1: () => [], p2: () => [] });
  const me = t.active, op = other(me), hand = t.players[me].zones.hand.length;
  assert.equal(g.apply(t, { type: 'draw', seat: me, n: 1 }), null);
  assert.equal(g.apply(t, { type: 'endTurn', seat: me }), null);
  assert.equal(g.apply(t, { type: 'draw', seat: op, n: 1 }), null);
  assert.equal(t.active, op);
  assert.equal(g.apply(t, { type: 'undo', seat: me, mine: true }), null);
  assert.equal(t.active, me, 'back to my turn'); assert.equal(t.players[me].zones.hand.length, hand + 1, 'my draw is kept');
  assert.equal(g.apply(t, { type: 'undo', seat: me, mine: true }), null);
  assert.equal(t.players[me].zones.hand.length, hand, 'then my draw is undone');
}
{ // BO3: a battlefield picked in an earlier game of the match is no longer offered
  const t = g.newState(); t.seats = { p1: { name: 'A' }, p2: { name: 'B' } };
  assert.equal(g.apply(t, { type: 'start', cards, decks: { p1: deck('B1'), p2: deck('B2') }, usedBf: { p1: ['B1'], p2: [] } }), null);
  assert.deepEqual(t.bfOpts.p1, ['B2']); assert.deepEqual(t.bfOpts.p2.sort(), ['B1', 'B2']);
}
{ // AI attack model: at 7, conquering one battlefield of two draws a card, it doesn't win
  const t = newGame(deck('B1'), deck('B2'), cards);
  pregame(t, { p1: () => [], p2: () => [] });
  const P = t.active, M = AI._test.model;
  t.players[P].score = 7; t.scored[P] = [];
  const m = M(t, P); m.base[P] = [{ iid: 'z', side: P, m: 3, as: 0, sh: 0, ready: true, dmg: 0 }];
  AI._test.applyMoves(m, P, [{ iid: 'z', to: 0 }]);
  assert.equal(m.score[P], 7, 'final point refused in the model'); assert.equal(m.drew[P], 1);
}
{ // real cards: Nidalee draws when she wins a combat; Fizz casts a spell from the trash and pays its Power
  const real = fs.existsSync('./data/cards.json') ? require('./data/cards.json') : null;
  const find = n => real && real.find(c => c.name === n && !c.alt);
  const nid = find('Nidalee, Cat Form'), fz = find('Fizz, Trickster');
  const sp = real && real.find(c => c.type === 'Spell' && !c.alt && (c.energy || 0) <= 3 && (c.power || 0) === 1 && /^Draw \d/.test(c.text || ''));
  if (nid && fz && sp) {
    const t = newGame(deck('B1'), deck('B2'), [...cards, nid, fz, sp]);
    pregame(t, { p1: () => [], p2: () => [] });
    for (const x of [nid, fz, sp]) t.cd[x.id] = x;
    const P = t.active, O = other(P), Z = t.players[P].zones, mkc = (id, cid, who = P) => ({ iid: id, cid, owner: who, ex: false, dmg: 0, buff: 0 });
    Z.base.push(mkc('nd', nid.id)); t.bfs[0].units[O].push(mkc('e1', 'U', O));
    const h0 = Z.hand.length;
    assert.equal(g.apply(t, { type: 'move', seat: P, iid: 'nd', to: { bf: 0, side: P } }), null);
    while (t.showdown) assert.equal(g.apply(t, { type: 'pass', seat: t.showdown.focus }), null);
    assert.ok(t.log.some(l => /Nidalee, Cat Form \(combat gagné\)/.test(l.msg)), 'Nidalee triggers'); assert.ok(Z.hand.length >= h0 + 1, 'Nidalee draws');
    const runeOf = dom => real.find(c => c.type === 'Rune' && !c.alt && (c.domain || []).includes(dom));
    [...fz.domain, ...sp.domain, ...fz.domain, ...sp.domain, ...fz.domain, ...sp.domain].forEach((dom, i) => { const r = runeOf(dom); t.cd[r.id] = r; Z.runes.push(mkc('fr' + i, r.id)); });
    Z.hand.push(mkc('fz', fz.id)); Z.trash.push(mkc('sp', sp.id));
    assert.equal(g.apply(t, { type: 'play', seat: P, iid: 'fz' }), null);
    while (t.chain && t.chain.length && !t.pending) { const top = t.chain[t.chain.length - 1]; g.apply(t, top.cb.seen ? { type: 'chainResolve', seat: P } : { type: 'chainPass', seat: O }); }
    assert.equal(t.pending && t.pending.kind, 'pick', 'Fizz offers the trash spell');
    const a = AI.next(t, P, 'hard', {}); assert.deepEqual(a.iids, ['sp'], 'AI takes the spell');
    const n0 = Z.runes.length; assert.equal(g.apply(t, { ...a, seat: P }), null);
    assert.equal(Z.runes.length, n0 - 1, 'its Power is paid (a rune recycled)'); assert.ok(t.chain.some(c => c.iid === 'sp'), 'the spell is cast');
  }
}
console.log('reducer OK');

/* ---- AI vs AI on real data ---- */
if (fs.existsSync('./data/cards.json') && fs.existsSync('./data/decks.json')) {
  const all = require('./data/cards.json'), decks = require('./data/decks.json');
  const play = (l1, l2) => {
    const d = decks[play.n = ((play.n || 0) + 1) % decks.length]; // mirror matches across all starter decks
    const s = newGame(d, d, all);
    s.auto = { p1: true, p2: true };
    const lv = { p1: l1, p2: l2 }, mem = { p1: {}, p2: {} };
    let steps = 0;
    while (s.stage !== 'main' && steps++ < 20) for (const p of ['p1', 'p2']) { const a = AI.next(s, p, lv[p], mem[p]); if (a) assert.equal(g.apply(s, { ...a, seat: p, p }), null); }
    assert.equal(s.stage, 'main', 'AI completes the pre-game');
    while (!s.winner && s.turn < 60 && steps++ < 5000) {
      let p = s.active, a = AI.next(s, p, lv[p], mem[p]);
      if (!a) { p = other(p); a = AI.next(s, p, lv[p], mem[p]); }
      assert.ok(a, 'some AI must always have an action');
      if (g.apply(s, { ...a, seat: p, p })) mem[p].q = [];
    }
    return s.winner || 'draw';
  };
  const t0 = Date.now();
  const res = { hard: 0, easy: 0, draw: 0 };
  for (let i = 0; i < 10; i++) {
    const hardFirst = i % 2 === 0, w = play(hardFirst ? 'hard' : 'easy', hardFirst ? 'easy' : 'hard');
    res[w === 'draw' ? 'draw' : (w === 'p1') === hardFirst ? 'hard' : 'easy']++;
  }
  const r2 = { normal: 0, easy: 0, draw: 0 };
  for (let i = 0; i < 10; i++) { const w = play('normal', 'easy'); r2[w === 'p1' ? 'normal' : w === 'p2' ? 'easy' : 'draw']++; }
  console.log('hard vs easy', res, '| normal vs easy', r2, `| ${Date.now() - t0} ms`);
  // menu levels play profiles normal / hard / pro, close in strength over 10 mirror games (see the bench in the
  // commit notes): only a collapse is a failure here
  assert.ok(res.hard >= 3 && res.draw <= 2, 'Pro Player must not collapse against the beginner');

  /* ---- real cards: hiding, blink vs a declared target, looking at the top of the deck ---- */
  const by = n => all.find(x => x.name === n);
  const mk = () => {
    const s = newGame(decks[0], decks[1], all);
    pregame(s, { p1: () => [], p2: () => [] });
    for (const n of ['Hextech Ray', 'Thrill of the Hunt', 'Elnuk Herd', 'Rengar, Pridestalker']) s.cd[by(n).id] = by(n);
    for (const p of ['p1', 'p2']) s.players[p].zones.runes.forEach(r => (r.ex = false));
    return s;
  };
  const card = (s, iid, n, p) => ({ iid, cid: by(n).id, owner: p, ex: false, dmg: 0, buff: 0 });
  { // hiding a [Hidden] unit is not playing it: "when you play a unit" (Rengar, Pridestalker) stays silent
    const s = mk(), P = s.active, Z = s.players[P].zones;
    s.auto = { p1: false, p2: false };
    Z.legend = [card(s, 'rg', 'Rengar, Pridestalker', P)];
    const u = Z.main.find(c => g.cd(s, c).type === 'Unit'); Z.main.splice(Z.main.indexOf(u), 1); s.bfs[0].units[P].push(u); s.bfs[0].ctrl = P;
    Z.hand.push(card(s, 'el', 'Elnuk Herd', P));
    const n = s.log.length;
    assert.equal(g.apply(s, { type: 'hide', seat: P, iid: 'el', bf: 0 }), null);
    assert.ok(!s.log.slice(n).some(l => /Rengar/.test(l.msg)), 'no trigger when hiding');
    s.turn++;
    assert.equal(g.apply(s, { type: 'play', seat: P, iid: 'el' }), null);
    assert.ok(s.log.some(l => /Rengar, Pridestalker \(unité jouée\)/.test(l.msg)), 'the trigger comes when it is played from face down');
  }
  { // Hextech Ray on my unit, I answer with Thrill of the Hunt: the unit is banished and replayed, Ray loses its target
    const s = mk(), H = 'p1', A = 'p2';
    s.auto = { p1: false, p2: false }; s.active = A;
    const Z = s.players[H].zones, u = Z.main.find(c => g.cd(s, c).type === 'Unit');
    Z.main.splice(Z.main.indexOf(u), 1); u.iid = 'vic'; s.bfs[0].units[H].push(u); s.bfs[0].ctrl = H;
    s.players[A].zones.hand.push(card(s, 'ray', 'Hextech Ray', A)); Z.hand.push(card(s, 'thr', 'Thrill of the Hunt', H));
    assert.equal(g.apply(s, { type: 'play', seat: A, iid: 'ray', targets: ['vic'] }), null);
    assert.equal(g.apply(s, { type: 'play', seat: H, iid: 'thr', targets: ['vic'] }), null);
    g.apply(s, { type: 'chainPass', seat: A }); g.apply(s, { type: 'chainResolve', seat: H });
    assert.equal(s.pending && s.pending.kind, 'bf', 'Thrill: choose where it comes back');
    assert.equal(g.apply(s, { type: 'resolve', seat: H, bf: 1 }), null);
    g.apply(s, { type: 'chainPass', seat: H }); g.apply(s, { type: 'chainResolve', seat: A });
    const f = g.find(s, 'vic');
    assert.ok(f && f.zone === 'bf' && f.bf === 1 && !f.c.dmg, 'Hextech Ray fizzles: the unit was banished and replayed');
  }
  { // look at the top N cards of my deck, recycle some
    const s = mk(), P = s.active, Z = s.players[P].zones, top = Z.main.slice(0, 3).map(c => c.iid);
    assert.equal(g.apply(s, { type: 'look', seat: P, n: 3 }), null);
    assert.deepEqual(s.pending.cards, top);
    assert.deepEqual(g.viewFor(s, other(P)).pending.cards, [], 'the opponent does not see them');
    assert.equal(g.apply(s, { type: 'resolve', seat: P, iids: [top[0]] }), null);
    assert.equal(Z.main[Z.main.length - 1].iid, top[0], 'recycled to the bottom');
  }
  { // Switcheroo hidden at my battlefield; a bigger enemy unit attacks; flipped in the showdown it swaps the Mights
    const s = mk(), H = 'p1', A = 'p2';
    for (const n of ['Switcheroo', 'Tideturner', 'Fizz, Trickster']) s.cd[by(n).id] = by(n);
    s.auto = { p1: true, p2: true };
    const unit = (p, id, m) => { const z = s.players[p].zones, c = z.main.find(x => g.cd(s, x).type === 'Unit'); z.main.splice(z.main.indexOf(c), 1); c.iid = id; s.cd['M' + m] = { ...g.cd(s, c), might: m, text: '' }; c.cid = 'M' + m; return c; };
    const mine = unit(H, 'small', 2), big = unit(A, 'big', 6);
    s.bfs[0].units[H].push(mine); s.bfs[0].ctrl = H;
    s.bfs[0].hidden = [{ ...card(s, 'sw', 'Switcheroo', H), fd: true, hidT: 1 }];
    s.active = A; s.turn = 5; big.ex = false; s.players[A].zones.base.push(big);
    assert.equal(g.apply(s, { type: 'move', seat: A, iid: 'big', to: { bf: 0, side: A } }), null);
    assert.ok(s.showdown, 'showdown');
    if (s.showdown.focus === A) g.apply(s, { type: 'pass', seat: A });
    const before = [g.hp(s, mine), g.hp(s, big)];
    assert.equal(g.apply(s, { type: 'play', seat: H, iid: 'sw', targets: ['small', 'big'] }), null, 'the hidden Switcheroo is cast');
    g.apply(s, { type: 'chainPass', seat: A }); if (s.chain.length) g.apply(s, { type: 'chainResolve', seat: H });
    assert.deepEqual([g.hp(s, mine), g.hp(s, big)], [before[1], before[0]], 'Mights swapped');
    while (s.showdown) { const f = s.showdown.focus; assert.equal(g.apply(s, { type: 'pass', seat: f }), null); }
    assert.deepEqual([g.find(s, 'small').zone, g.find(s, 'big').zone], ['bf', 'trash'], 'my unit survives, theirs dies');
  }
  { // Tideturner swaps places with a friendly unit; Fizz casts a spell from the trash for free, then recycles it
    const s = mk(), P = s.active, Z = s.players[P].zones;
    for (const n of ['Tideturner', 'Fizz, Trickster', 'Switcheroo']) s.cd[by(n).id] = by(n);
    s.auto = { p1: true, p2: true }; Z.runes.forEach(r => (r.ex = false));
    const u = Z.main.find(c => g.cd(s, c).type === 'Unit'); Z.main.splice(Z.main.indexOf(u), 1); Z.base.push(u);
    s.bfs[0].ctrl = P; s.bfs[0].hidden = [{ ...card(s, 'tt', 'Tideturner', P), fd: true, hidT: 0 }]; s.turn = 3;
    assert.equal(g.apply(s, { type: 'play', seat: P, iid: 'tt', targets: [u.iid] }), null);
    if (s.pending && s.pending.kind === 'target') g.apply(s, { type: 'resolve', seat: P, iids: [u.iid] });
    assert.equal(g.find(s, 'tt').zone, 'base'); assert.equal(g.find(s, u.iid).bf, 0, 'places swapped');
    Z.trash.push(card(s, 'sw2', 'Switcheroo', P)); Z.hand.push(card(s, 'fz', 'Fizz, Trickster', P));
    while (Z.runes.length < 6) Z.runes.push({ ...Z.runes[0], iid: 'xr' + Z.runes.length });
    Z.runes.forEach(r => (r.ex = false)); s.players[P].pool = { e: 9, p: ['any', 'any', 'any'] };
    assert.equal(g.apply(s, { type: 'play', seat: P, iid: 'fz' }), null);
    assert.equal(s.pending && s.pending.kind, 'pick');
    assert.equal(g.apply(s, { type: 'resolve', seat: P, iids: ['sw2'] }), null);
    assert.equal(s.chain[s.chain.length - 1].iid, 'sw2', 'Switcheroo cast from the trash');
    g.apply(s, { type: 'chainPass', seat: other(P) }); g.apply(s, { type: 'chainResolve', seat: P });
    assert.equal(Z.main[Z.main.length - 1].iid, 'sw2', 'then recycled');
  }
  { // legends: Rek'Sai on conquer (auto mode) asks, exhausts, reveals the top 2 and plays one; Draven draws on a won combat
    const s = mk(), P = s.active, Z = s.players[P].zones;
    for (const n of ["Rek'Sai, Void Burrower", 'Draven, Glorious Executioner']) s.cd[by(n).id] = by(n);
    s.auto = { p1: true, p2: true }; Z.runes.forEach(r => (r.ex = false));
    Z.legend = [card(s, 'lg', "Rek'Sai, Void Burrower", P)];
    const u = Z.main.find(c => g.cd(s, c).type === 'Unit' && !/conquer|move/i.test(g.cd(s, c).text || '')); Z.main.splice(Z.main.indexOf(u), 1); u.ex = false; Z.base.push(u);
    const cheap = Z.main.findIndex(c => ['Unit', 'Gear'].includes(g.cd(s, c).type) && (g.cd(s, c).energy || 0) <= 2 && !(g.cd(s, c).power));
    Z.main.unshift(...Z.main.splice(cheap, 1));
    assert.equal(g.apply(s, { type: 'move', seat: P, iid: u.iid, to: { bf: 0, side: P } }), null);
    assert.equal(s.pending && s.pending.kind, 'confirm', "Rek'Sai asks on conquer");
    assert.equal(g.apply(s, { type: 'resolve', seat: P, yes: true }), null);
    assert.ok(Z.legend[0].ex, "Rek'Sai exhausted");
    assert.equal(s.pending && s.pending.kind, 'pick', 'choose among the top 2');
    assert.equal(s.pending.top.length, 2, 'both revealed cards are shown');
    const top = s.pending.cards[0], other2 = s.pending.top.find(id => id !== top), played0 = s.played[P];
    assert.equal(g.apply(s, { type: 'resolve', seat: P, iids: [top] }), null);
    assert.ok(['base', 'bf'].includes(g.find(s, top).zone), 'the card is played');
    assert.equal(s.played[P], played0 + 1, 'it counts as a card played this turn ([Legion])');
    assert.equal(Z.main[Z.main.length - 1].iid, other2, 'the other one is recycled');
  }
  { // Imperial Decree: 1 damage kills; Tactical Retreat: recalled instead of dying; Pyke pays its additional cost
    const s = mk(), P = s.active, O = other(P), Z = s.players[P].zones;
    for (const n of ['Imperial Decree', 'Tactical Retreat', 'Pyke, Dockside Butcher']) s.cd[by(n).id] = by(n);
    s.auto = { p1: false, p2: false };
    const take = (p, id) => { const z = s.players[p].zones, c = z.main.find(x => g.cd(s, x).type === 'Unit' && (g.cd(s, x).might || 0) >= 3 && !/Deathknell/i.test(g.cd(s, x).text || '')); z.main.splice(z.main.indexOf(c), 1); c.iid = id; c.ex = false; return c; };
    const a = take(P, 'ua'), b = take(O, 'ub'); s.bfs[0].units[P].push(a); s.bfs[1].units[O].push(b);
    Z.hand.push(card(s, 'dec', 'Imperial Decree', P));
    assert.equal(g.apply(s, { type: 'play', seat: P, iid: 'dec' }), null); g.apply(s, { type: 'chainPass', seat: O });
    assert.equal(g.apply(s, { type: 'damage', seat: P, iid: 'ub', n: 1 }), null);
    assert.equal(g.find(s, 'ub').zone, 'trash', 'Imperial Decree: 1 damage kills');
    Z.hand.push(card(s, 'tr', 'Tactical Retreat', P));
    assert.equal(g.apply(s, { type: 'play', seat: P, iid: 'tr', targets: ['ua'] }), null); g.apply(s, { type: 'chainPass', seat: O });
    g.apply(s, { type: 'damage', seat: P, iid: 'ua', n: 9 });
    assert.deepEqual([g.find(s, 'ua').zone, g.find(s, 'ua').c.ex], ['base', true], 'Tactical Retreat: healed, exhausted, recalled');
    s.auto = { p1: true, p2: true }; Z.runes.forEach(r => (r.ex = false));
    const fury = all.find(c => c.name === 'Fury Rune'); s.cd[fury.id] = fury;
    while (Z.runes.length < 8) Z.runes.push({ iid: 'fr' + Z.runes.length, cid: fury.id, owner: P, ex: false });
    Z.hand.push(card(s, 'pk', 'Pyke, Dockside Butcher', P));
    assert.equal(g.apply(s, { type: 'play', seat: P, iid: 'pk' }), null);
    assert.ok(!g.find(s, 'pk').c.ex && g.hp(s, g.find(s, 'pk').c) === (by('Pyke, Dockside Butcher').might || 0) + 2, 'Pyke: additional cost paid, ready and +2');
  }
  { // Baron Nashor: 10 energy + 3 Chaos power from 12 runes (a rune exhausted for energy can then be recycled
    // for power); it adds Baron Pit and enters there; enemy spells can't choose it
    const s = mk(), P = s.active, Z = s.players[P].zones, rune = all.find(c => c.name === 'Chaos Rune');
    s.cd[rune.id] = rune; for (const n of ['Baron Nashor', 'Baron Pit']) s.cd[by(n).id] = by(n);
    s.auto = { p1: true, p2: true };
    Z.runes = Array.from({ length: 12 }, (_, i) => ({ iid: 'cr' + i, cid: rune.id, owner: P, ex: false }));
    Z.hand.push(card(s, 'baron', 'Baron Nashor', P));
    assert.equal(g.apply(s, { type: 'play', seat: P, iid: 'baron' }), null, 'Baron is payable with 12 runes');
    assert.equal(Z.runes.length, 9, '3 runes recycled');
    assert.equal(s.bfs.length, 3); assert.equal(s.cd[s.bfs[2].card.cid].name, 'Baron Pit');
    assert.equal(g.find(s, 'baron').bf, 2, 'Baron enters Baron Pit');
    assert.ok(!g.candidates(s, other(P), { side: 'enemy', where: 'any' }).includes('baron'), 'not chosen by enemy spells');
  }
  { // keywords on equipment are the unit's: [Ganking] from Blade of the Exile; [Action] only in showdowns on the
    // opponent's turn; Elnuk Herd played from face down is recycled; Irresistible Faefolk pulls an enemy unit
    const s = mk(), P = s.active, O = other(P), Z = s.players[P].zones;
    for (const n of ['Blade of the Exile', 'Irresistible Faefolk']) s.cd[by(n).id] = by(n);
    s.auto = { p1: false, p2: false };
    const u = Z.main.find(c => g.cd(s, c).type === 'Unit' && !/Ganking/.test(g.cd(s, c).text || '')); Z.main.splice(Z.main.indexOf(u), 1); u.ex = false; s.bfs[0].units[P].push(u); s.bfs[0].ctrl = P;
    assert.ok(g.apply(s, { type: 'move', seat: P, iid: u.iid, to: { bf: 1, side: P } }), 'no Ganking: no battlefield to battlefield move');
    Z.base.push({ ...card(s, 'boe', 'Blade of the Exile', P), att: u.iid });
    assert.equal(g.apply(s, { type: 'move', seat: P, iid: u.iid, to: { bf: 1, side: P } }), null, 'Blade of the Exile gives [Ganking]');
    // [Action] spell on the opponent's turn, outside a showdown: refused
    const act = all.find(c => c.type === 'Spell' && /^\[Action\]/.test(c.text || '') && !/\[Reaction\]/.test(c.text || ''));
    s.cd[act.id] = act; s.players[O].zones.hand.push({ iid: 'act', cid: act.id, owner: O, ex: false, dmg: 0, buff: 0 });
    assert.ok(g.apply(s, { type: 'play', seat: O, iid: 'act' }), '[Action] is not playable on the opponent\'s turn outside a showdown');
    // Irresistible Faefolk moves to a battlefield: it may bring an enemy unit there
    const e = s.players[O].zones.main.find(c => g.cd(s, c).type === 'Unit'); s.players[O].zones.main.splice(s.players[O].zones.main.indexOf(e), 1); s.players[O].zones.base.push(e);
    Z.base.push(card(s, 'fae', 'Irresistible Faefolk', P));
    assert.equal(g.apply(s, { type: 'move', seat: P, iid: 'fae', to: { bf: 0, side: P } }), null);
    assert.equal(s.pending && s.pending.kind, 'target', 'Faefolk: choose an enemy unit');
    assert.equal(g.apply(s, { type: 'resolve', seat: P, iids: [e.iid] }), null);
    assert.equal(g.find(s, e.iid).bf, 0, 'the enemy unit is pulled to that battlefield');
  }
  { // Elnuk Herd played from face down: +3 to another unit, then recycled to the bottom of its owner's deck
    const s = mk(), P = s.active, Z = s.players[P].zones;
    s.auto = { p1: false, p2: false };
    const u = Z.main.find(c => g.cd(s, c).type === 'Unit'); Z.main.splice(Z.main.indexOf(u), 1); s.bfs[0].units[P].push(u); s.bfs[0].ctrl = P;
    Z.hand.push(card(s, 'el2', 'Elnuk Herd', P));
    assert.equal(g.apply(s, { type: 'hide', seat: P, iid: 'el2', bf: 0 }), null);
    s.turn++;
    assert.equal(g.apply(s, { type: 'play', seat: P, iid: 'el2' }), null);
    if (s.pending) g.apply(s, { type: 'resolve', seat: P, iids: [u.iid] });
    assert.equal(Z.main[Z.main.length - 1].iid, 'el2', 'Elnuk Herd recycled');
  }
  { // battlefields: Zaun Warrens on conquer (discard 1, then draw 1), Ruined Monastery ("you may": yes / no),
    // and only a reminder in the log in manual mode
    const bfGame = (bfName, autoMode) => {
      const s = mk(), P = s.active, Z = s.players[P].zones;
      s.cd[by(bfName).id] = by(bfName); s.bfs[0].card.cid = by(bfName).id; s.auto = { p1: autoMode, p2: autoMode };
      const u = Z.main.find(c => g.cd(s, c).type === 'Unit' && !/conquer|move|attack/i.test(g.cd(s, c).text || '')); Z.main.splice(Z.main.indexOf(u), 1); u.ex = false; Z.base.push(u);
      s.bfs[0].units.p1 = []; s.bfs[0].units.p2 = []; s.bfs[0].ctrl = null;
      return { s, P, Z, u };
    };
    let { s, P, Z, u } = bfGame('Zaun Warrens', true);
    const hand = Z.hand.length;
    assert.equal(g.apply(s, { type: 'move', seat: P, iid: u.iid, to: { bf: 0, side: P } }), null);
    assert.equal(s.pending && s.pending.kind, 'discard', 'Zaun Warrens: discard first');
    assert.equal(g.apply(s, { type: 'resolve', seat: P, iids: [Z.hand[0].iid] }), null);
    assert.equal(Z.hand.length, hand, 'then draw 1');
    ({ s, P, Z, u } = bfGame('Ruined Monastery', true));
    const runes = Z.runes.length;
    g.apply(s, { type: 'move', seat: P, iid: u.iid, to: { bf: 0, side: P } });
    assert.equal(s.pending && s.pending.kind, 'confirm', 'Ruined Monastery asks');
    assert.equal(g.apply(s, { type: 'resolve', seat: P, yes: true }), null);
    assert.equal(s.pending.kind, 'discard');
    g.apply(s, { type: 'resolve', seat: P, iids: [Z.hand[0].iid] });
    assert.equal(Z.runes.length, runes + 1); assert.ok(Z.runes[Z.runes.length - 1].ex, 'channeled exhausted');
    ({ s, P, Z, u } = bfGame('Zaun Warrens', false));
    g.apply(s, { type: 'move', seat: P, iid: u.iid, to: { bf: 0, side: P } });
    g.apply(s, { type: 'conquer', seat: P, bf: 0 });
    assert.ok(!s.pending && s.log.some(l => /Zaun Warrens \(conquête.*À appliquer à la main/.test(l.msg)), 'manual mode: written in the log');
  }
  /* ---- every legend: hand-written abilities and passives, in auto mode ---- */
  const legendGame = n => {
    const s = mk(), P = s.active, O = other(P), Z = s.players[P].zones;
    s.cd[by(n).id] = by(n); s.auto = { p1: true, p2: true };
    Z.legend = [card(s, 'lg', n, P)];
    const fury = all.find(c => c.name === 'Fury Rune'); s.cd[fury.id] = fury;
    while (Z.runes.length < 8) Z.runes.push({ iid: 'fr' + Z.runes.length, cid: fury.id, owner: P, ex: false });
    Z.runes.forEach(r => (r.ex = false));
    const unit = (id, where = 'base', p = P) => { const z = s.players[p].zones, us = z.main.filter(x => g.cd(s, x).type === 'Unit'), c = us.find(x => !/conquer|move|play me|When|hold/i.test(g.cd(s, x).text || '')) || us[0]; z.main.splice(z.main.indexOf(c), 1); Object.assign(c, { iid: id, ex: false }); (where === 'base' ? z.base : s.bfs[where].units[p]).push(c); return c; };
    return { s, P, O, Z, unit, L: Z.legend[0] };
  };
  { // Ekko: empower (ability 1), then disempower: the next unit costs 2 Energy + 1 Power less and dies at end of turn
    const { s, P, Z, L } = legendGame('Ekko, Boy Who Shattered Time');
    assert.ok(g.apply(s, { type: 'activate', seat: P, iid: 'lg', k: 1 }), 'disempower needs Empowered');
    assert.equal(g.apply(s, { type: 'activate', seat: P, iid: 'lg', k: 0 }), null); assert.ok(L.emp, 'Ekko empowered');
    L.ex = false;
    assert.equal(g.apply(s, { type: 'activate', seat: P, iid: 'lg', k: 1 }), null); assert.ok(!L.emp && s.unitDisc, 'discount set');
    const u = Z.main.find(x => g.cd(s, x).type === 'Unit' && (g.cd(s, x).energy || 0) >= 3); Z.main.splice(Z.main.indexOf(u), 1); Z.hand.push(u);
    assert.equal(g.apply(s, { type: 'play', seat: P, iid: u.iid }), null);
    assert.equal(u.killEnd, s.turn, 'marked');
    while (s.pending) g.apply(s, { type: 'resolve', seat: s.pending.to, yes: false, iids: [] });
    g.apply(s, { type: 'endTurn', seat: P });
    assert.equal(g.find(s, u.iid).zone, 'trash', 'killed at end of turn');
  }
  { // Yasuo: to a battlefield and back; Miss Fortune: Ganking; Shen: Tank
    const { s, P, unit } = legendGame('Yasuo, Unforgiven'); const u = unit('y1');
    assert.equal(g.apply(s, { type: 'activate', seat: P, iid: 'lg', targets: ['y1'], bf: 1 }), null);
    assert.equal(g.find(s, 'y1').bf, 1, 'Yasuo: to a battlefield');
    s.players[P].zones.legend[0].ex = false;
    assert.equal(g.apply(s, { type: 'activate', seat: P, iid: 'lg', targets: ['y1'] }), null);
    assert.equal(g.find(s, 'y1').zone, 'base', 'Yasuo: back to base');
    const m = legendGame('Miss Fortune, Bounty Hunter'); m.unit('mf');
    assert.equal(g.apply(m.s, { type: 'activate', seat: m.P, iid: 'lg', targets: ['mf'] }), null); assert.ok(g.find(m.s, 'mf').c.tg, 'Ganking this turn');
    const sh = legendGame('Shen, Eye of Twilight'); sh.unit('sh');
    assert.equal(g.apply(sh.s, { type: 'activate', seat: sh.P, iid: 'lg', targets: ['sh'] }), null); assert.ok(g.find(sh.s, 'sh').c.tt, 'Tank this turn');
  }
  { // Jax: attach a detached Equipment
    const { s, P, Z, unit } = legendGame('Jax, Grandmaster at Arms'); unit('jx');
    const sw = by("Doran's Blade"); s.cd[sw.id] = sw; Z.base.push({ iid: 'sw', cid: sw.id, owner: P, ex: false });
    assert.equal(g.apply(s, { type: 'activate', seat: P, iid: 'lg', k: 0, targets: ['sw', 'jx'] }), null);
    assert.equal(g.find(s, 'sw').c.att, 'jx', 'Jax attaches the Equipment');
  }
  { // Irelia: choosing an exhausted friendly unit with a spell: pay 1 Power and exhaust her to ready it
    const { s, P, Z, unit, L } = legendGame('Irelia, Blade Dancer'); const u = unit('ir'); u.ex = true;
    const sp = by('Twilight Shroud'); s.cd[sp.id] = sp;
    Z.hand.push({ iid: 'sp', cid: sp.id, owner: P, ex: false });
    assert.equal(g.apply(s, { type: 'play', seat: P, iid: 'sp', targets: ['ir'] }), null);
    g.apply(s, { type: 'chainPass', seat: other(P) }); g.apply(s, { type: 'chainResolve', seat: P });
    assert.equal(s.pending && s.pending.kind, 'confirm', 'Irelia asks');
    assert.equal(g.apply(s, { type: 'resolve', seat: P, yes: true }), null);
    assert.ok(!u.ex && L.ex, 'unit readied, Irelia exhausted');
  }
  { // Sett: a buffed unit that would die is recalled exhausted instead
    const { s, P, unit, L } = legendGame('Sett, The Boss'); const u = unit('st', 0); u.buff = 1;
    assert.equal(g.apply(s, { type: 'damage', seat: P, iid: 'st', n: 20 }), null);
    assert.deepEqual([g.find(s, 'st').zone, u.buff, u.ex, L.ex], ['base', 0, true, true], 'Sett saves it');
  }
  { // Ivern: conquer -> Brush; Vi: no prompt without 3 excess damage
    const { s, P, unit } = legendGame('Ivern, Green Father'); const u = unit('iv');
    g.apply(s, { type: 'move', seat: P, iid: 'iv', to: { bf: 0, side: P } });
    while (s.pending && s.pending.card !== 'Ivern, Green Father') g.apply(s, { type: 'resolve', seat: s.pending.to, yes: false, iids: [] });
    assert.equal(s.pending && s.pending.kind, 'confirm', 'Ivern asks');
    g.apply(s, { type: 'resolve', seat: P, yes: true });
    assert.equal(g.cd(s, s.bfs[0].card).name, 'Brush', 'battlefield replaced by Brush');
    const v = legendGame('Vi, Piltover Enforcer'); v.unit('vi');
    g.apply(v.s, { type: 'move', seat: v.P, iid: 'vi', to: { bf: 0, side: v.P } });
    assert.ok(!(v.s.pending && v.s.pending.card === 'Vi, Piltover Enforcer'), 'Vi needs 3 excess damage');
  }
  { // Teemo: hiding costs 1 Energy instead of a recycled rune; Darius: [Legion] needed
    const { s, P, Z, unit } = legendGame('Teemo, Swift Scout'); unit('tm', 0); s.bfs[0].ctrl = P;
    const hc = all.find(c => /\[Hidden\]/.test(c.text || '') && c.type === 'Spell'); s.cd[hc.id] = hc; Z.hand.push({ iid: 'hc', cid: hc.id, owner: P, ex: false });
    const runes = Z.runes.length;
    assert.equal(g.apply(s, { type: 'hide', seat: P, iid: 'hc', bf: 0 }), null);
    assert.equal(Z.runes.length, runes, 'no rune recycled (paid 1 Energy)');
    const d = legendGame('Darius, Hand of Noxus');
    assert.ok(g.apply(d.s, { type: 'activate', seat: d.P, iid: 'lg' }), 'Darius: Legion needed');
    d.s.played[d.P] = 1;
    assert.equal(g.apply(d.s, { type: 'activate', seat: d.P, iid: 'lg' }), null);
  }
  { // Fiora: a unit becoming Mighty asks to channel; Jhin: 4 banished spells
    const { s, P, Z, unit } = legendGame('Fiora, Grand Duelist'); const u = unit('fi');
    u.tb = -20; // nobody Mighty before
    for (const x of [...s.players.p1.zones.base, ...s.players.p2.zones.base, ...s.bfs.flatMap(b => [...b.units.p1, ...b.units.p2])]) if (x !== u) x.tb = -20;
    const r0 = Z.runes[0].iid; g.apply(s, { type: 'exhaust', seat: P, iid: r0, value: false }); // first watch
    u.tb = 10; g.apply(s, { type: 'exhaust', seat: P, iid: r0, value: false });
    assert.equal(s.pending && s.pending.card, 'Fiora, Grand Duelist', 'Fiora asks when a unit becomes Mighty');
    const runes = Z.runes.length; g.apply(s, { type: 'resolve', seat: P, yes: true });
    assert.equal(Z.runes.length, runes + 1, 'channeled');
    const j = legendGame('Jhin, Virtuoso'), JZ = j.Z;
    const sp = by('Concentrate');
    {
      j.s.cd[sp.id] = sp;
      for (let i = 0; i < 4; i++) {
        j.Z.runes.forEach(r => (r.ex = false)); j.Z.hand.push({ iid: 'js' + i, cid: sp.id, owner: j.P, ex: false });
        assert.equal(g.apply(j.s, { type: 'play', seat: j.P, iid: 'js' + i }), null);
        assert.equal(j.s.pending && j.s.pending.card, 'Jhin, Virtuoso', 'Jhin asks'); g.apply(j.s, { type: 'resolve', seat: j.P, yes: true });
        g.apply(j.s, { type: 'chainPass', seat: j.O }); g.apply(j.s, { type: 'chainResolve', seat: j.P });
      }
      assert.ok(JZ.trash.filter(c => c.cid === sp.id).length === 4 && !JZ.banish.some(c => c.jhin), 'Jhin: the 4 spells go to the trash');
    }
  }
  { // a card taken from the top of the deck into the hand leaves the deck (no duplicate instance)
    const { s, P, Z } = legendGame('Annie, Dark Child');
    const tc = by('Trifarian Captain'); s.cd[tc.id] = tc; Z.hand.push({ iid: 'tc', cid: tc.id, owner: P, ex: false });
    const u = Z.main.find(x => g.cd(s, x).type === 'Unit' && (g.cd(s, x).energy || 0) <= 3 && !(g.cd(s, x).power > 1)); Z.main.splice(Z.main.indexOf(u), 1); Z.main.unshift(u);
    assert.equal(g.apply(s, { type: 'play', seat: P, iid: 'tc' }), null);
    assert.equal(s.pending && s.pending.kind, 'pick');
    assert.equal(g.apply(s, { type: 'resolve', seat: P, iids: [s.pending.cards[0]] }), null);
    const id = Z.hand[Z.hand.length - 1].iid;
    assert.ok(!Z.main.some(x => x.iid === id), 'not left in the deck');
  }
  { // Cleave on an attacker in a showdown: +3 counted by the engine AND shown in the view (attacker / defender role)
    const { s, P, O, Z, unit } = legendGame('Annie, Dark Child');
    const a = unit('at'), d = unit('df', 0, O); s.bfs[0].units[O].push(...s.bfs[0].units[O].splice(0)); s.bfs[0].ctrl = O;
    for (const n of ['Cleave', 'Shadow Fiend', 'Gustwalker']) s.cd[by(n).id] = by(n);
    assert.equal(g.apply(s, { type: 'move', seat: P, iid: 'at', to: { bf: 0, side: P } }), null);
    assert.ok(s.showdown && s.showdown.att === P, 'showdown opened by the attacker');
    const before = g.viewFor(s, P).bfs[0].units[P].find(c => c.iid === 'at').m;
    Z.hand.push({ iid: 'cl', cid: by('Cleave').id, owner: P, ex: false });
    assert.equal(g.apply(s, { type: 'play', seat: P, iid: 'cl', targets: ['at'] }), null);
    g.apply(s, { type: 'chainPass', seat: O }); g.apply(s, { type: 'chainResolve', seat: P });
    const va = g.viewFor(s, P).bfs[0].units[P].find(c => c.iid === 'at'), vd = g.viewFor(s, P).bfs[0].units[O].find(c => c.iid === 'df');
    assert.deepEqual([va.role, vd.role], ['a', 'd'], 'roles shown');
    assert.equal(va.m, before + 3, 'Cleave: +3 shown while attacking');
    assert.equal(g.hp(s, a, 'a'), va.m, 'and counted in combat');
    // [Empowered][>] I have [Assault 3] only while Empowered; [Level 3][>] +1 and [Ganking]
    const sf = { iid: 'sf', cid: by('Shadow Fiend').id, owner: P, ex: false, dmg: 0, buff: 0 }; Z.base.push(sf);
    assert.equal(g.hp(s, sf, 'a'), by('Shadow Fiend').might, 'Shadow Fiend: no Assault while not Empowered');
    sf.emp = true; assert.equal(g.hp(s, sf, 'a'), by('Shadow Fiend').might + 3, 'Assault 3 while Empowered');
    const gw = { iid: 'gw', cid: by('Gustwalker').id, owner: P, ex: false, dmg: 0, buff: 0 }; Z.base.push(gw);
    s.players[P].xp = 0; assert.equal(g.hp(s, gw), by('Gustwalker').might, 'Gustwalker below level 3');
    s.players[P].xp = 3; assert.equal(g.hp(s, gw), by('Gustwalker').might + 1, 'Gustwalker level 3: +1');
  }
  { // [Deploy]: Banner of Conquest on a battlefield gives [Assault]; killed when the opponent holds there. Bombs.
    const { s, P, O, Z, unit } = legendGame('Annie, Dark Child'); const u = unit('bu', 1);
    for (const n of ['Banner of Conquest', 'Lonely Poro']) s.cd[by(n).id] = by(n);
    Z.hand.push({ iid: 'ban', cid: by('Banner of Conquest').id, owner: P, ex: false });
    assert.equal(g.apply(s, { type: 'play', seat: P, iid: 'ban', to: { bf: 1 } }), null);
    assert.equal(g.find(s, 'ban').zone, 'bfgear', 'deployed on the battlefield');
    const m0 = g.hp(s, u); assert.equal(g.hp(s, u, 'a'), m0 + 1, 'friendly units here have [Assault]');
    s.bfs[1].units[P].splice(0); s.bfs[1].units[O].push({ iid: 'ou', cid: u.cid, owner: O, ex: false, dmg: 0, buff: 0 }); s.bfs[1].ctrl = O;
    g.apply(s, { type: 'endTurn', seat: P });
    assert.equal(g.find(s, 'ban').zone, 'trash', 'killed when the opponent holds there');
  }
  { // Bomb (Yordle, Hexplosives Expert): to a battlefield; when it dies, 2 to an enemy there; Lonely Poro dies alone
    const { s, P, O, Z, unit } = legendGame('Yordle, Hexplosives Expert');
    const e1 = unit('en', 0, O);
    assert.equal(g.apply(s, { type: 'activate', seat: P, iid: 'lg', bf: 0 }), null);
    while (s.pending && s.pending.kind === 'bf') g.apply(s, { type: 'resolve', seat: P, bf: 0 });
    const bomb = (s.bfs[0].gear || {})[P] && s.bfs[0].gear[P][0];
    assert.ok(bomb, 'Bomb deployed at the battlefield');
    const d0 = e1.dmg || 0;
    assert.equal(g.apply(s, { type: 'damage', seat: P, iid: bomb.iid, n: 9 }), null);
    assert.ok(!g.find(s, 'en') || g.find(s, 'en').zone === 'trash' || (g.find(s, 'en').c.dmg || 0) === d0 + 2, 'the Bomb deals 2 to an enemy there');
    const pz = legendGame('Annie, Dark Child');
    pz.s.cd[by('Lonely Poro').id] = by('Lonely Poro');
    pz.s.bfs[0].units[pz.P].push({ iid: 'lp', cid: by('Lonely Poro').id, owner: pz.P, ex: false, dmg: 0, buff: 0 });
    const h0 = pz.Z.hand.length; g.apply(pz.s, { type: 'damage', seat: pz.P, iid: 'lp', n: 9 });
    assert.equal(pz.Z.hand.length, h0 + 1, 'Lonely Poro: died alone, draw 1');
  }
  { // [Show Off]: Primordial Roar deals the Might of the unit shown; [Vision] granted by Gemcraft Seer
    const { s, P, O, Z, unit } = legendGame('Annie, Dark Child'); const mine = unit('me'), en = unit('en2', 0, O);
    for (const n of ['Primordial Roar', 'Gemcraft Seer']) s.cd[by(n).id] = by(n);
    const body = all.find(c => c.name === 'Body Rune'); s.cd[body.id] = body;
    for (let i = 0; i < 4; i++) Z.runes.push({ iid: 'br' + i, cid: body.id, owner: P, ex: false });
    Z.hand.push({ iid: 'pr', cid: by('Primordial Roar').id, owner: P, ex: false });
    assert.equal(g.apply(s, { type: 'play', seat: P, iid: 'pr', targets: ['en2'] }), null);
    g.apply(s, { type: 'chainPass', seat: O }); g.apply(s, { type: 'chainResolve', seat: P });
    assert.ok(s.log.some(l => /Show Off/.test(l.msg)), 'a card is shown');
    const f = g.find(s, 'en2'); assert.ok(f.zone === 'trash' || f.c.dmg >= 1, 'damage equal to the shown Might');
    Z.base.push({ iid: 'gs', cid: by('Gemcraft Seer').id, owner: P, ex: false, dmg: 0, buff: 0 });
    const v = Z.main.find(x => g.cd(s, x).type === 'Unit' && !/\[Vision\]/.test(g.cd(s, x).text || '') && (g.cd(s, x).energy || 0) <= 3); Z.main.splice(Z.main.indexOf(v), 1); Z.hand.push(v);
    Z.runes.forEach(r => (r.ex = false));
    assert.equal(g.apply(s, { type: 'play', seat: P, iid: v.iid }), null);
    assert.ok(s.log.some(l => /regarde la carte du dessus/.test(l.msg)), 'Vision granted: look at the top card');
  }
  { // signature spells: Void Rush, Curtain Call (choose one), Counter Strike, Noxian Guillotine, Public Execution, Last Breath
    const sig = n => { const G2 = legendGame('Annie, Dark Child'); s2 = G2; G2.s.cd[by(n).id] = by(n); for (const r of [...new Map(all.filter(c => / Rune$/.test(c.name) && c.type === 'Rune').map(r => [r.name, r])).values()]) { G2.s.cd[r.id] = r; for (let i = 0; i < 2; i++) G2.Z.runes.push({ iid: 'x' + r.id + i, cid: r.id, owner: G2.P, ex: false }); } G2.Z.hand.push({ iid: 'sg', cid: by(n).id, owner: G2.P, ex: false }); return G2; };
    let s2;
    const cast = (G2, targets) => { assert.equal(g.apply(G2.s, { type: 'play', seat: G2.P, iid: 'sg', targets }), null); g.apply(G2.s, { type: 'chainPass', seat: G2.O }); g.apply(G2.s, { type: 'chainResolve', seat: G2.P }); };
    // Void Rush: the top 2 are revealed, one is played for 2 Energy less, the other is drawn
    let G2 = sig('Void Rush'); const cheap = G2.Z.main.filter(x => g.cd(G2.s, x).type === 'Unit' && (g.cd(G2.s, x).energy || 0) >= 2).slice(0, 2);
    for (const x of cheap) { G2.Z.main.splice(G2.Z.main.indexOf(x), 1); G2.Z.main.unshift(x); }
    const hand0 = G2.Z.hand.length; cast(G2);
    assert.equal(G2.s.pending && G2.s.pending.kind, 'pick', 'Void Rush: choose among the top 2');
    assert.equal(G2.s.pending.top.length, 2);
    const played = G2.s.pending.cards[0], other2 = G2.s.pending.top.find(id => id !== played);
    assert.equal(g.apply(G2.s, { type: 'resolve', seat: G2.P, iids: [played] }), null);
    assert.ok(['base', 'bf'].includes(g.find(G2.s, played).zone), 'one is played');
    assert.equal(g.find(G2.s, other2).zone, 'hand', 'the other is drawn');
    assert.equal(G2.Z.hand.length, hand0, 'hand: -Void Rush +the other card');
    // Curtain Call: choose one
    G2 = sig('Curtain Call'); const h1 = G2.Z.hand.length; cast(G2);
    assert.equal(G2.s.pending && G2.s.pending.kind, 'mode', 'Curtain Call asks which effect');
    assert.equal(g.apply(G2.s, { type: 'resolve', seat: G2.P, modes: [0] }), null);
    assert.equal(G2.Z.hand.length, h1, 'drew 1 (the spell left the hand)');
    // Counter Strike: the next damage is prevented, then draw 1
    G2 = sig('Counter Strike'); const cs = G2.unit('cs'); cast(G2, ['cs']);
    g.apply(G2.s, { type: 'damage', seat: G2.P, iid: 'cs', n: 1 });
    assert.equal(cs.dmg || 0, 0, 'Counter Strike: damage prevented');
    // Noxian Guillotine: kill it the next time it takes damage this turn
    G2 = sig('Noxian Guillotine, Darius'); const ng = G2.unit('ng', 0, G2.O); cast(G2, ['ng']);
    assert.ok(g.find(G2.s, 'ng').zone !== 'trash', 'not killed yet (no Legion)');
    g.apply(G2.s, { type: 'damage', seat: G2.P, iid: 'ng', n: 1 });
    assert.equal(g.find(G2.s, 'ng').zone, 'trash', 'killed on the next damage');
    // Public Execution: kill an enemy with less Might than my unit
    G2 = sig('Public Execution'); const big = G2.unit('pe'); big.tb = 20; const small = G2.unit('pv', 0, G2.O); cast(G2, ['pe', 'pv']);
    assert.equal(g.find(G2.s, 'pv').zone, 'trash', 'Public Execution kills the smaller enemy');
    // Last Breath: ready my unit, it deals its Might to an enemy at a battlefield
    G2 = sig('Last Breath, Yasuo'); const lb = G2.unit('lb'); lb.ex = true; lb.tb = 20; G2.unit('lv', 0, G2.O); cast(G2, ['lb', 'lv']);
    assert.ok(!lb.ex && g.find(G2.s, 'lv').zone === 'trash', 'Last Breath: readied, enemy killed');
    // Wind and Ghosts: 3 Might or less is banished, bigger goes back to hand and stays revealed
    G2 = sig('Wind and Ghosts'); const wg = G2.unit('wg', 0, G2.O); wg.tb = 4 - g.hp(G2.s, wg); cast(G2, ['wg']);
    assert.equal(g.find(G2.s, 'wg').zone, 'hand', 'Wind and Ghosts: 4 Might returns to hand');
    assert.ok(g.find(G2.s, 'wg').c.rev, 'the returned card stays revealed');
    assert.ok(!g.viewFor(G2.s, G2.P).players[G2.O].zones.hand.find(c => c.iid === 'wg').hidden, 'the opponent sees it');
    G2 = sig('Wind and Ghosts'); const ws = G2.unit('ws', 0, G2.O); ws.tb = 3 - g.hp(G2.s, ws); cast(G2, ['ws']);
    assert.equal(g.find(G2.s, 'ws').zone, 'banish', 'Wind and Ghosts: 3 Might is banished');
    // Irresistible Faefolk: pulls an enemy when it moves to a battlefield, not when it goes back to base
    G2 = sig('Irresistible Faefolk'); const ff = G2.unit('ff', 0); G2.s.cd[by('Irresistible Faefolk').id] = by('Irresistible Faefolk'); ff.cid = by('Irresistible Faefolk').id; G2.unit('fe', 1, G2.O);
    assert.equal(g.apply(G2.s, { type: 'move', seat: G2.P, iid: 'ff', to: { zone: 'base', p: G2.P }, free: true }), null);
    assert.ok(!G2.s.pending && !(G2.s.fxQueue || []).length, 'Faefolk: nothing when leaving');
    assert.equal(g.apply(G2.s, { type: 'move', seat: G2.P, iid: 'ff', to: { bf: 0, side: G2.P }, free: true }), null);
    assert.equal(G2.s.pending && G2.s.pending.card, 'Irresistible Faefolk', 'Faefolk: asks when arriving');
  }
  { // Orianna: start of the Main Phase, pay 1 to animate a gear
    const { s, P, O, Z } = legendGame('Orianna, Lady of Clockwork');
    const gear = all.find(c => c.type === 'Gear' && (c.energy || 0) >= 2 && !/\[Equip\]/.test(c.text || '')); s.cd[gear.id] = gear;
    Z.base.push({ iid: 'og', cid: gear.id, owner: P, ex: false });
    while (s.pending) g.apply(s, { type: 'resolve', seat: s.pending.to, yes: false, iids: [] });
    g.apply(s, { type: 'endTurn', seat: P });
    while (s.pending && s.pending.to === O) g.apply(s, { type: 'resolve', seat: O, yes: false, iids: [] });
    s.active === O && g.apply(s, { type: 'endTurn', seat: O });
    while (s.pending && s.pending.card !== 'Orianna, Lady of Clockwork') g.apply(s, { type: 'resolve', seat: s.pending.to, yes: false, iids: s.pending.kind === 'discard' ? s.players[s.pending.to].zones.hand.slice(0, s.pending.n).map(c => c.iid) : [] });
    assert.equal(s.pending && s.pending.card, 'Orianna, Lady of Clockwork', 'Orianna asks at the start of the Main Phase');
    g.apply(s, { type: 'resolve', seat: P, yes: true });
    assert.equal(g.cd(s, g.find(s, 'og').c).type, 'Unit', 'the gear is a unit');
    assert.equal(g.hp(s, g.find(s, 'og').c), gear.energy, 'Might = Energy cost');
  }
}
console.log('self-check OK');
