// Riftbound AI. Plays through the same actions as a human (play / move / fight / damage...).
// Engine profiles: easy (random, wasteful; no longer offered), normal (greedy, sound trades), hard (exhaustive
// search of attacks, optimal spending), pro (hard + the opponent's best reply among several, stricter card economy,
// sharper tricks and counters). Menu levels map onto them: easy -> normal, normal -> hard, hard -> pro (PROFILE).
const PROFILE = { easy: 'normal', normal: 'hard', hard: 'pro' };
const hardish = l => l === 'hard' || l === 'pro';
const noUnitsHere = (s, i) => s.bfs[i] && s.bfs[i].card && G.cd(s, s.bfs[i].card).name === 'Rockfall Path'; // "Units can't be played here"
// the turn plan chosen by the pro's look-ahead (see planTurn): flags read by phaseMain / phaseAttack
let PLAN = {};
let SIM = 0; // > 0 while the pro simulates (no look-ahead inside a look-ahead)
// Limits: only keyword/simple effects are understood (see rules.js); other card text is ignored.
const R = require('./rules');
const G = require('./game');
const other = G.other;
const rnd = n => Math.floor(Math.random() * n);
const clone = m => structuredClone(m);

/* ---------------- board model for simulation ---------------- */
function unitOf(s, c, side) {
  const d = G.cd(s, c), k = R.kw(d.text);
  return { iid: c.iid, side, m: G.hp(s, c), as: k.assault + (c.ta || 0), sh: k.shield + (c.ts || 0), tank: k.tank || !!c.tt, backline: k.backline, ready: !c.ex, stun: !!c.st, dmg: c.dmg || 0 };
}
const isUnit = (s, c) => G.cd(s, c).type === 'Unit';
function model(s, me) {
  const op = other(me), m = { me, op, win: s.winScore, score: {}, base: {}, bfs: [], sc: {}, drew: { [me]: 0, [op]: 0 } };
  for (const p of [me, op]) {
    m.score[p] = s.players[p].score;
    m.sc[p] = s.active === p ? ((s.scored || {})[p] || []).slice() : []; // battlefields already scored this turn
    m.base[p] = s.players[p].zones.base.filter(c => isUnit(s, c)).map(c => unitOf(s, c, p));
  }
  m.bfs = s.bfs.map(b => ({ ctrl: b.ctrl, u: { [me]: b.units[me].map(c => unitOf(s, c, me)), [op]: b.units[op].map(c => unitOf(s, c, op)) } }));
  return m;
}
// a conquest scores once per battlefield per turn; the final point needs every battlefield scored this turn,
// otherwise a card is drawn instead (rule 471)
function score(m, side, i) {
  const sc = m.sc[side] || (m.sc[side] = []);
  if (sc.includes(i)) return;
  sc.push(i);
  if (m.score[side] >= m.win - 1 && !m.bfs.every((_, k) => sc.includes(k))) m.drew[side] = (m.drew[side] || 0) + 1;
  else m.score[side]++;
}
const hpA = u => Math.max(0, u.m + u.as), hpD = u => Math.max(0, u.m + u.sh);
const allUnits = (m, p) => [...m.base[p], ...m.bfs.flatMap(b => b.u[p])];
const mightOf = (m, p) => allUnits(m, p).reduce((t, u) => t + u.m, 0);

function simFight(m, i, att) {
  const b = m.bfs[i], def = other(att);
  const { deadA, deadD } = R.combat(b.u[att], b.u[def], hpA, hpD);
  b.u[att] = b.u[att].filter(u => !deadA.includes(u));
  b.u[def] = b.u[def].filter(u => !deadD.includes(u));
  if (b.u[att].length && !b.u[def].length) { b.ctrl = att; score(m, att, i); }
  else if (b.u[att].length) { m.base[att].push(...b.u[att].splice(0)); b.ctrl = def; }
  else b.ctrl = b.u[def].length ? def : null;
}
// moves: [{iid, to: bfIndex}] from base
function applyMoves(m, side, moves) {
  const hit = new Set();
  for (const mv of moves) {
    const i = m.base[side].findIndex(u => u.iid === mv.iid);
    if (i < 0) continue;
    const [u] = m.base[side].splice(i, 1);
    u.ready = false;
    m.bfs[mv.to].u[side].push(u);
    hit.add(mv.to);
  }
  for (const i of hit) {
    const b = m.bfs[i];
    if (b.u[other(side)].length) simFight(m, i, side);
    else if (b.ctrl !== side) { b.ctrl = side; score(m, side, i); }
  }
}

// Greedy attack: smallest strongest-first group that wins each contested battlefield, then grab empty ones.
function greedyAttack(m, side) {
  const enemy = other(side), moves = [];
  let avail = m.base[side].filter(u => u.ready && u.m > 0).sort((a, b) => hpA(b) - hpA(a));
  const order = m.bfs.map((b, i) => i).sort((a, b) => (m.bfs[b].ctrl === enemy) - (m.bfs[a].ctrl === enemy));
  for (const i of order) {
    if (!m.bfs[i].u[enemy].length) continue;
    for (let k = 1; k <= avail.length; k++) {
      const grp = avail.slice(0, k), t = clone(m);
      applyMoves(t, side, grp.map(u => ({ iid: u.iid, to: i })));
      if (t.bfs[i].ctrl === side && (t.score[side] > m.score[side] || t.drew[side] > m.drew[side])) {
        moves.push(...grp.map(u => ({ iid: u.iid, to: i })));
        avail = avail.slice(k);
        break;
      }
    }
  }
  for (const i of order) {
    const b = m.bfs[i];
    if (!b.u[enemy].length && b.ctrl !== side && !b.u[side].length && avail.length) moves.push({ iid: avail.pop().iid, to: i });
  }
  return moves;
}

// Position value for `me` after my turn, looking one turn ahead (opponent holds + best greedy reply, then my hold).
function evaluate(m, me) {
  const op = other(me);
  if (m.score[me] >= m.win) return 1e6 + m.score[me];
  const t = clone(m);
  for (const p of [me, op]) for (const u of allUnits(t, p)) { u.dmg = 0; u.stun = false; if (p === op) u.ready = true; }
  t.sc[op] = []; // the opponent's turn: holds score first (no final-point limit), then conquests
  t.bfs.forEach((b, i) => { if (b.ctrl === op) { t.score[op]++; t.sc[op].push(i); } });
  if (t.score[op] >= t.win) return -1e6;
  if (m.pro) { // the reply that hurts me most: greedy, all-in on one battlefield, or nothing
    const replies = [greedyAttack(t, op), ...t.bfs.map((b, i) => t.base[op].filter(u => u.ready && u.m > 0).map(u => ({ iid: u.iid, to: i })))];
    let worst = null;
    for (const r of replies) { const u = clone(t); applyMoves(u, op, r); const k = 10 * (u.score[op] - u.score[me]) + 0.6 * (mightOf(u, op) - mightOf(u, me)) + u.bfs.filter(b => b.ctrl === op).length * 3; if (!worst || k > worst.k) worst = { k, u }; }
    Object.assign(t, worst.u);
  } else applyMoves(t, op, greedyAttack(t, op));
  if (t.score[op] >= t.win) return -1e6 + t.score[me];
  let ctrl = 0;
  for (const b of t.bfs) { if (b.ctrl === me) { t.score[me]++; ctrl++; } else if (b.ctrl === op) ctrl--; }
  return 10 * (t.score[me] - t.score[op]) + (t.score[me] >= t.win ? 400 : 0) + 0.6 * (mightOf(t, me) - mightOf(t, op))
    + 0.3 * (allUnits(t, me).length - allUnits(t, op).length) + 1.5 * ctrl + 0.8 * ((m.drew[me] || 0) - (t.drew[op] || 0));
}

// Hard: try every assignment of up to 7 ready base units to {stay, battlefield 1..n}.
function searchAttack(m, me, top) {
  const movers = m.base[me].filter(u => u.ready && u.m > 0).sort((a, b) => hpA(b) - hpA(a)).slice(0, 7);
  const nb = m.bfs.length, opts = nb + 1;
  let best = { v: evaluate(m, me), moves: [] };
  const list = [best]; // top: the best few assignments, for the pro's look-ahead
  const total = opts ** movers.length;
  for (let code = 1; code < total; code++) {
    const moves = [];
    for (let k = 0, c = code; k < movers.length; k++, c = Math.floor(c / opts)) { const o = c % opts; if (o) moves.push({ iid: movers[k].iid, to: o - 1 }); }
    const t = clone(m);
    applyMoves(t, me, moves);
    const v = evaluate(t, me) - moves.length * 0.01 + (m.aggro ? 4 * (t.score[me] - m.score[me]) : 0); // prefer fewer moves on ties
    if (v > best.v) best = { v, moves };
    if (top && (list.length < top || v > list[list.length - 1].v)) { list.push({ v, moves }); list.sort((a, b) => b.v - a.v); list.length = Math.min(list.length, top); }
  }
  return top ? list : best.moves;
}

/* ---------------- resources ---------------- */
function runePool(s, me) { return G.runesOf(s, me).map(r => ({ ...r })); }
function spend(pool, plan) {
  for (const r of pool) if (plan.ex.includes(r.iid)) r.ex = true;
  for (const id of plan.rc) pool.splice(pool.findIndex(r => r.iid === id), 1);
}
function unitValue(d) {
  const k = R.kw(d.text);
  // card advantage from play effects: draws and opponent discards are worth ~1.5, own discards cost ~1.5
  const adv = R.playFx(d).reduce((t, e) => t + (e.kind === 'draw' ? e.n : e.kind === 'discard' ? (e.who === 'opp' ? e.n : -e.n) : e.kind === 'sacrifice' ? 2 : e.kind === 'target' && ['dmg', 'kill', 'stun'].includes(e.op) ? 1 : e.kind === 'token' ? 0.6 * e.n : 0), 0);
  return (d.might || 0) + 1.2 * (k.assault + k.shield) + (k.tank ? 1 : 0) + (k.ganking ? 0.5 : 0) + 1.5 * adv + (d.supertype === 'Champion' ? 1 : 0) + (R.entersReady(d) ? 0.8 : 0) + 0.2;
}

/* ---------------- phases ---------------- */
function enemyTargets(s, me, bfOnly) {
  const op = other(me), out = [];
  s.bfs.forEach((b, i) => b.units[op].forEach(c => out.push({ c, bf: i })));
  if (!bfOnly) s.players[op].zones.base.filter(c => isUnit(s, c)).forEach(c => out.push({ c, bf: null }));
  return out;
}

function phaseRemoval(s, me, level, pool) {
  const acts = [], z = s.players[me].zones, op = other(me);
  const spells = z.hand.filter(c => G.cd(s, c).type === 'Spell').map(c => ({ c, d: G.cd(s, c), fx: R.spellFx(G.cd(s, c).text) })).filter(x => x.fx && x.fx.kind !== 'draw');
  const killed = new Set();
  for (const sp of spells) {
    const plan = R.planPay(pool, sp.d);
    if (!plan) continue;
    const tg = enemyTargets(s, me, sp.fx.bfOnly).filter(t => !killed.has(t.c.iid));
    const hp = c => G.hp(s, c) - (c.dmg || 0);
    const val = t => G.hp(s, t.c) + (t.bf != null && s.bfs[t.bf].units[op].length === 1 ? 4 : 0);
    let fx = [];
    if (sp.fx.kind === 'wipe') {
      const mine = [...z.base, ...s.bfs.flatMap(b => b.units[me])].filter(c => isUnit(s, c)).reduce((a, c) => a + G.hp(s, c), 0);
      const theirs = tg.reduce((a, t) => a + G.hp(s, t.c), 0);
      if (level === 'easy' ? Math.random() < 0.5 : theirs - mine >= 4) fx = [{ type: 'wipe' }];
    } else if (sp.fx.kind === 'dmgAll') {
      let best = null;
      s.bfs.forEach((b, i) => { const v = b.units[op].filter(c => hp(c) <= sp.fx.n).reduce((a, c) => a + G.hp(s, c), 0); if (v && (!best || v > best.v)) best = { v, i }; });
      if (best) fx = s.bfs[best.i].units[op].map(c => ({ type: 'damage', iid: c.iid, n: sp.fx.n, bf: best.i }));
    } else {
      const ok = tg.filter(t => (sp.fx.kind === 'kill' ? G.hp(s, t.c) <= sp.fx.max : hp(t.c) <= sp.fx.n));
      let pick = null;
      if (level === 'easy') pick = (Math.random() < 0.6 ? tg : ok)[rnd(Math.max(1, (Math.random() < 0.6 ? tg : ok).length))];
      else pick = ok.sort((a, b) => val(b) - val(a))[0];
      if (hardish(level) && pick && val(pick) < 2) pick = null; // don't waste removal on chaff
      if (pick) { killed.add(pick.c.iid); fx = [sp.fx.kind === 'kill' ? { type: 'kill', iid: pick.c.iid } : { type: 'damage', iid: pick.c.iid, n: sp.fx.n }]; }
    }
    if (!fx.length) continue;
    spend(pool, plan);
    // the engine resolves the spell itself when it understands the text: just pass the chosen target
    const auto = R.playFx(sp.d).find(e => e.kind === 'target' || e.kind === 'wipe' || e.kind === 'aoe');
    if (auto) {
      if (auto.kind === 'aoe') acts.push({ type: 'play', iid: sp.c.iid, bf: fx[0].bf });
      else {
        const targets = [], gone = new Set(); // a second "deal N" goes elsewhere once the first one is lethal
        R.playFx(sp.d).filter(e => e.kind === 'target').forEach((e, i) => {
          const opts = G.candidates(s, me, { ...e, src: sp.c.iid }).filter(id => !gone.has(id));
          const id = i === 0 && fx[0].iid && opts.includes(fx[0].iid) ? fx[0].iid : opts.length ? chooseTarget(s, me, level, e, opts) : null;
          if (!id) return;
          targets.push(id);
          const t = enemyTargets(s, me).find(x => x.c.iid === id);
          if (e.op === 'kill' || (t && e.op === 'dmg' && hp(t.c) <= e.n)) gone.add(id);
        });
        acts.push({ type: 'play', iid: sp.c.iid, targets });
      }
      if (level === 'easy' && Math.random() < 0.5) break;
      continue;
    }
    acts.push({ type: 'play', iid: sp.c.iid });
    for (const f of fx) {
      if (f.type !== 'wipe') { acts.push(f); continue; }
      for (const p of [me, op]) for (const c of [...s.players[p].zones.base, ...s.bfs.flatMap(b => b.units[p])]) if (isUnit(s, c)) acts.push({ type: 'kill', iid: c.iid });
    }
    if (level === 'easy' && Math.random() < 0.5) break;
  }
  return acts;
}

function phaseDraw(s, me, level, pool) {
  const z = s.players[me].zones, acts = [];
  for (const c of z.hand) {
    const d = G.cd(s, c), fx = d.type === 'Spell' && R.spellFx(d.text);
    if (!fx || fx.kind !== 'draw') continue;
    const units = z.hand.filter(x => isUnit(s, x) && R.planPay(pool, G.cd(s, x)));
    if (level !== 'easy' && units.length >= 2 && pool.filter(r => !r.ex).length < (d.energy || 0) + 3) continue; // tempo first
    const plan = R.planPay(pool, d);
    if (!plan) continue;
    spend(pool, plan);
    acts.push({ type: 'play', iid: c.iid }); // the draw resolves automatically
  }
  return acts;
}

function phaseDeploy(s, me, level, pool) {
  const z = s.players[me].zones;
  // units first; gear is a cheap filler (its Equip/abilities stay manual)
  const cands = [...z.hand, ...z.champion].filter(c => isUnit(s, c) || G.cd(s, c).type === 'Gear')
    .map(c => { const d = G.cd(s, c); return { c, d, v: d.type === 'Gear' ? 0.6 + (d.might || 0) * 0.3 : unitValue(d) }; });
  let chosen = [];
  const affordSeq = (list, p) => {
    const pp = p.map(r => ({ ...r }));
    for (const x of list) { const plan = R.planPay(pp, x.d, x.accel ? 1 : 0, x.accel ? 1 : 0); if (!plan) return null; spend(pp, plan); }
    return pp;
  };
  if (level === 'easy') {
    for (const x of cands.sort(() => Math.random() - 0.5)) if (Math.random() < 0.65 && affordSeq([...chosen, x], pool)) chosen.push(x);
  } else if (level === 'normal') {
    for (const x of cands.sort((a, b) => (b.d.energy || 0) - (a.d.energy || 0))) if (affordSeq([...chosen, x], pool)) chosen.push(x);
  } else {
    const list = cands.sort((a, b) => b.v - a.v).slice(0, 10);
    let best = { v: 0, set: [] };
    for (let mask = 1; mask < 1 << list.length; mask++) {
      const set = list.filter((_, i) => mask & (1 << i));
      const v = set.reduce((a, x) => a + x.v, 0);
      if (v <= best.v) continue;
      const order = set.slice().sort((a, b) => (b.d.power || 0) - (a.d.power || 0));
      if (affordSeq(order, pool)) best = { v, set: order };
    }
    chosen = best.set;
  }
  // accelerate the strongest unit if the runes allow it (normal/hard)
  if (level !== 'easy') {
    for (const x of chosen.slice().sort((a, b) => b.v - a.v)) {
      if (!R.kw(x.d.text).accelerate) continue;
      x.accel = true;
      if (!affordSeq(chosen, pool)) x.accel = false; else break;
    }
  }
  const acts = [];
  for (const x of chosen) {
    const plan = R.planPay(pool, x.d, x.accel ? 1 : 0, x.accel ? 1 : 0);
    if (!plan) continue;
    spend(pool, plan);
    acts.push({ type: 'play', iid: x.c.iid, accel: !!x.accel }); // play effects (draw, discard...) resolve automatically
  }
  return acts;
}

function phaseAttack(s, me, level) {
  const m = model(s, me);
  let moves;
  if (level === 'easy') {
    moves = m.base[me].filter(u => u.ready && u.m > 0 && Math.random() < 0.45).map(u => ({ iid: u.iid, to: rnd(m.bfs.length) }));
  } else if (PLAN.noAttack) moves = [];
  else { m.pro = level === 'pro'; m.aggro = !!PLAN.aggro; moves = level === 'pro' && !SIM ? proAttack(s, me, m) : searchAttack(m, me); }
  return movesToActs(s, me, moves);
}
function movesToActs(s, me, moves) {
  const acts = [];
  const byBf = {};
  for (const mv of moves) (byBf[mv.to] = byBf[mv.to] || []).push(mv.iid);
  const contested = i => s.bfs[i].units[other(me)].length > 0;
  const order = Object.keys(byBf).sort((a, b) => contested(a) - contested(b));
  let fights = 0;
  for (const i of order) {
    if (contested(i) && fights++) break; // one showdown at a time: the attack phase runs again afterwards
    for (const iid of byBf[i]) acts.push({ type: 'move', iid, to: { bf: +i, side: me }, quiet: true });
  }
  return acts;
}

/* ---------------- card evaluation (normal / hard) ---------------- */
const unitsAll = (s, p) => [...s.players[p].zones.base, ...s.bfs.flatMap(b => b.units[p])].filter(c => isUnit(s, c));
const COMBAT_OPS = ['might', 'assault', 'shield', 'double', 'tank', 'blink', 'moveTo', 'mark', 'duel', 'stun', 'swap', 'setMight', 'kwTurn', 'swapPlaces'];
// what a unit on the board is worth to its controller: Might, + holding a battlefield alone / controlling it
function worth(s, c) {
  const f = G.find(s, c.iid); if (!f) return 0;
  let v = G.hp(s, c) + 1;
  if (f.zone === 'bf') { const b = s.bfs[f.bf]; if (b.units[f.p].length === 1) v += 2.5; if (b.ctrl === f.p) v += 1; }
  if (G.cd(s, c).type === 'Gear') v = 1.5 + (G.cd(s, c).might || 0);
  return v;
}
// value of one targeted effect on a unit outside combat (sim tracks damage already dealt / units already gone)
function tvMain(s, me, e, id, sim) {
  const f = G.find(s, id); if (!f || sim.gone.has(id)) return -0.2;
  const c = f.c, sign = f.p === me ? -1 : 1, w = worth(s, c);
  const left = G.lethal(s, c) - (c.dmg || 0) - (sim.dmg.get(id) || 0);
  switch (e.op) {
    case 'dmg': case 'dmgSplash':
      if (e.n >= left) { sim.gone.add(id); return sign * w; }
      // damage that doesn't kill is gone at the end of the turn: almost worthless outside combat
      sim.dmg.set(id, (sim.dmg.get(id) || 0) + e.n); return sign * 0.04 * e.n;
    case 'kill': sim.gone.add(id); return sign * w;
    case 'hand': sim.gone.add(id); return sign * w * (G.cd(s, c).supertype === 'Token' ? 1 : 0.6);
    case 'deck': sim.gone.add(id); return sign * w * 0.9;
    case 'recall': return f.zone === 'bf' ? sign * (s.bfs[f.bf].units[f.p].length === 1 ? 3 : 0.8) : -0.3;
    case 'ready': return sign < 0 && c.ex ? 1.5 : -0.2;
    case 'attach': return sign < 0 ? 1 + G.hp(s, c) * 0.05 : -1;
    case 'stun': return sign * 0.3;
    case 'duel': {
      const a = sim.mark && G.find(s, sim.mark); if (!a) return -1;
      let v = 0;
      if (G.hp(s, a.c) >= left) { sim.gone.add(id); v += sign * w; }
      if (G.hp(s, c) >= G.lethal(s, a.c) - (a.c.dmg || 0)) v -= worth(s, a.c) * (a.p === me ? 1 : -1);
      return v;
    }
  }
  return COMBAT_OPS.includes(e.op) ? 0.05 * -sign : 0; // combat tricks: kept for showdowns
}
// value of an untargeted effect
function kindValue(s, me, e) {
  const op = other(me), mine = e.who !== 'opp', P = mine ? me : op, sg = mine ? 1 : -1;
  const z = s.players[P].zones;
  switch (e.kind) {
    case 'draw': return sg * 1.5 * (e.n + (e.per === 'bfCtrl' ? s.bfs.filter(b => b.ctrl === P).length : e.per === 'mighty' ? unitsAll(s, P).filter(c => G.hp(s, c) >= 5).length : 0));
    case 'discard': return -sg * Math.min(e.n, z.hand.length) * 1.1;
    case 'reveal': return 0.3;
    case 'sacrifice': { const us = unitsAll(s, P); return us.length ? -sg * (1 + Math.min(...us.map(c => worth(s, c)))) : 0; }
    case 'token': return e.n * (e.name === 'Mech' ? 3 : e.name === 'Sand Soldier' ? 2 : e.name === 'Gold' ? 1 : 1.3) + (e.ready ? 0.5 : 0);
    case 'channel': return e.n * (s.players[me].zones.runes.length < 9 ? 1.4 : 0.3);
    case 'xp': return 0.3 * e.n;
    case 'predict': return 0.3;
    case 'buff': return 1.2;
    case 'readyAll': return unitsAll(s, me).filter(c => c.ex).length * 1.2;
    case 'exhaustAll': return -unitsAll(s, me).filter(c => !c.ex).length;
    case 'allMight': return 0.2 * unitsAll(s, me).length;
    case 'killGearAll': return 2 * (s.players[op].zones.base.filter(c => G.cd(s, c).type === 'Gear').length - s.players[me].zones.base.filter(c => G.cd(s, c).type === 'Gear').length);
    case 'wheel': return 1.4 * (s.players[op].zones.hand.length - s.players[me].zones.hand.length + 1);
    case 'wipe': return unitsAll(s, op).reduce((t, c) => t + worth(s, c), 0) - unitsAll(s, me).reduce((t, c) => t + worth(s, c), 0);
    case 'aoeAll': {
      let v = 0;
      for (const p of e.side === 'enemy' ? [op] : [me, op]) {
        const list = e.scope === 'base' ? s.players[p].zones.base : e.scope === 'combat' ? [] : s.bfs.flatMap(b => b.units[p]);
        for (const c of list.filter(c => isUnit(s, c))) if (G.lethal(s, c) - (c.dmg || 0) <= e.n) v += (p === me ? -1 : 1) * worth(s, c);
      }
      return v;
    }
    case 'aoe': { let best = 0; s.bfs.forEach((b, i) => { const v = b.units[op].filter(c => G.lethal(s, c) - (c.dmg || 0) <= e.n).reduce((t, c) => t + worth(s, c), 0); if (v > best) { best = v; e.bestBf = i; } }); return best; }
    case 'counter': return -2;
  }
  return 0;
}
// Plan a card's play effects for `me`: total value, the targets to declare, the battlefield to name.
// 'at the same location' effects: plan once per location and keep the best
function fxPlan(s, me, d, src, loc) {
  const fx = R.playFx(d, { legion: (s.played && s.played[me]) > 0, xp: s.players[me].xp || 0 });
  if (loc === undefined && fx.some(e => e.sameLoc)) {
    const at = id => { const f = G.find(s, id); return f && (f.zone === 'bf' ? 'bf' + f.bf : 'base:' + f.p); };
    const locs = [...new Set(G.candidates(s, me, { ...fx.find(e => e.sameLoc), src }).map(at))];
    return locs.map(l => fxPlan(s, me, d, src, l)).sort((a, b) => b.v - a.v)[0] || fxPlan(s, me, d, src, null);
  }
  const sim = { dmg: new Map(), gone: new Set(), mark: null }, targets = [];
  let v = 0, bf;
  const copy = x => ({ dmg: new Map(x.dmg), gone: new Set(x.gone), mark: x.mark });
  for (let i = 0; i < fx.length; i++) {
    const e = { ...fx[i], src };
    if (e.kind !== 'target') { v += kindValue(s, me, e); if (e.bestBf != null) bf = e.bestBf; continue; }
    let opts = G.candidates(s, me, e).filter(id => (e.op === 'dmg' && !e.distinct) || !targets.includes(id));
    const locOf = id => { const f = G.find(s, id); return f && (f.zone === 'bf' ? 'bf' + f.bf : 'base:' + f.p); };
    if (e.sameLoc && (loc || targets.length)) opts = opts.filter(id => locOf(id) === (loc || locOf(targets[0])));
    if (e.op === 'mark' && fx[i + 1] && ['duel', 'swap'].includes(fx[i + 1].op)) { // choose the pair together
      let best = null;
      for (const a of opts) for (const b of G.candidates(s, me, { ...fx[i + 1], src })) {
        if (a === b) continue;
        const sm = copy(sim); sm.mark = a;
        const tv = tvMain(s, me, fx[i + 1], b, sm);
        if (!best || tv > best.v) best = { v: tv, ids: [a, b], sm };
      }
      i++;
      if (!best) continue;
      v += best.v; targets.push(...best.ids); Object.assign(sim, best.sm);
      continue;
    }
    let best = null;
    for (const id of opts) { const sm = copy(sim); const tv = tvMain(s, me, e, id, sm); if (!best || tv > best.v) best = { v: tv, id, sm }; }
    if (!best || (best.v < 0 && e.opt)) continue;
    v += best.v; targets.push(best.id); Object.assign(sim, best.sm);
  }
  return { v, targets, bf, fx };
}
// static value of a unit's body
function bodyValue(d) {
  const k = R.kw(d.text);
  return (d.might || 0) + 1.2 * (k.assault + k.shield) + (k.tank ? 1 : 0) + (k.ganking ? 0.6 : 0) + (d.supertype === 'Champion' ? 1 : 0) + (R.entersReady(d) ? 0.8 : 0) + (k.deathDraw ? 1 : 0) + 0.3;
}
const costOf = d => R.cardCost(d);
const afford = (s, me, list) => { // can this sequence of cards be paid from runes + pool?
  const runes = G.runesOf(s, me).map(r => ({ ...r })), pool = { ...(s.players[me].pool || { e: 0, p: [] }) };
  pool.p = (pool.p || []).slice();
  for (const d of list) {
    const plan = R.planCost(runes, pool, d.cost || costOf(d));
    if (!plan) return false;
    for (const r of runes) if (plan.ex.includes(r.iid)) r.ex = true;
    for (const id of plan.rc) runes.splice(runes.findIndex(r => r.iid === id), 1);
    pool.e -= plan.usedE; pool.p = pool.p.filter((_, i) => !plan.usedP.includes(i));
  }
  return true;
};
// Main phase for normal / hard: every castable card is valued (body + play effects with their best targets);
// the best affordable set is chosen, keeping mana for a reaction when that costs little. One card per call.
function phaseMain(s, me, level) {
  const z = s.players[me].zones, op = other(me);
  const cands = [], FREE = { e: 0, p: [] };
  const hiddenMine = s.bfs.flatMap((b, i) => (b.hidden || []).filter(c => c.owner === me && s.turn > (c.hidT || 0) && !(noUnitsHere(s, i) && G.cd(s, c).type === 'Unit')).map(c => ({ c, i })));
  const hidFree = s.bfs.map((b, i) => i).filter(i => s.bfs[i].ctrl === me && !(s.bfs[i].hidden || []).length && !noUnitsHere(s, i));
  for (const c of [...z.hand, ...z.champion, ...hiddenMine.map(x => x.c)]) {
    const d = G.cd(s, c), fromHid = hiddenMine.some(x => x.c === c);
    if (!['Unit', 'Gear', 'Spell'].includes(d.type)) continue;
    if (d.type === 'Spell' && !R.playFx(d).length) continue; // effect not understood: not cast
    if (d.type === 'Spell' && PLAN.noSpell) continue;
    const plan = fxPlan(s, me, d, c.iid);
    let v = plan.v;
    if (d.type === 'Unit') v += bodyValue(d);
    else if (d.type === 'Gear') v += 0.6 + (d.might || 0) * (unitsAll(s, me).length ? 0.5 : 0.2);
    else {
      if (plan.fx.every(e => e.kind === 'target' && COMBAT_OPS.includes(e.op))) continue; // combat trick: kept for a showdown
      const k = R.kw(d.text);
      if ((k.reaction || k.action) && plan.fx.some(e => e.kind === 'target' && COMBAT_OPS.includes(e.op))) v -= 1.5;
      // a spell costs a card and its runes: no removal on chaff, no two cards to kill one unit
      if (plan.fx.some(e => e.kind === 'target' && e.side !== 'friendly')) v -= (level === 'pro' ? 0.9 : 0.6) + 0.12 * ((d.energy || 0) + (d.power || 0));
      if (v < (level === 'pro' ? 1 : hardish(level) ? 1.2 : 1.5)) continue;
    }
    cands.push({ c, d, v, plan, cost: fromHid ? FREE : costOf(d), pri: d.type === 'Spell' && plan.targets.some(id => { const f = G.find(s, id); return f && f.p === op; }) ? 0 : d.type === 'Unit' ? 1 : 2 });
  }
  // [Hidden]: put it face down now for 1 Power, play it later for free as a Reaction
  if (hidFree.length && level !== 'easy') for (const c of z.hand) {
    const d = G.cd(s, c); if (!R.kw(d.text).hidden) continue;
    const v = 0.5 + 0.5 * (d.type === 'Unit' ? bodyValue(d) : Math.max(1.5, fxPlan(s, me, d, c.iid).v));
    cands.push({ c, d, v, plan: { targets: [] }, cost: { e: 0, p: [null] }, hide: hidFree[0], pri: 3 });
  }
  // activated abilities (exhausting a ready unit costs it its attack this turn)
  for (const x of myAbilities(s, me)) {
    const plan = fxPlan(s, me, x.d, x.c.iid);
    if (plan.fx.every(e => e.kind === 'target' && COMBAT_OPS.includes(e.op))) continue;
    let v = plan.v - (x.ab.kill ? worth(s, x.c) : 0) - (x.owner.type === 'Unit' ? 1.5 : 0);
    if (v < (hardish(level) ? 1 : 1.3)) continue;
    cands.push({ c: x.c, d: x.d, v, plan, cost: x.ab.cost, ability: x.ab.i, pri: 2 });
  }
  if (!cands.length) return [];
  // a reaction worth holding (counter or combat trick) when the opponent has units or cards in hand
  const quick = z.hand.map(c => G.cd(s, c)).filter(d => d.type === 'Spell' && R.kw(d.text).reaction && R.playFx(d).length);
  const reserve = (unitsAll(s, op).length || s.players[op].zones.hand.length) && quick.length ? quick.sort((a, b) => (a.energy || 0) - (b.energy || 0))[0] : null;
  const list = cands.sort((a, b) => b.v - a.v).slice(0, 10);
  const best = keep => {
    let r = { v: 0, set: [] };
    for (let mask = 1; mask < 1 << list.length; mask++) {
      const set = list.filter((_, i) => mask & (1 << i));
      const v = set.reduce((a, x) => a + x.v, 0);
      if (v <= r.v || new Set(set.map(x => x.c.iid)).size < set.length || set.filter(x => x.hide != null).length > 1) continue;
      if (afford(s, me, [...set, ...(keep ? [keep] : [])])) r = { v, set };
    }
    return r;
  };
  let pick = best(null);
  if (reserve && !list.some(x => x.d === reserve)) { const kept = best(reserve); if (pick.v - kept.v < 1) pick = kept; }
  if (!pick.set.length) return [];
  const x = pick.set.sort((a, b) => a.pri - b.pri || (b.d.energy || 0) - (a.d.energy || 0))[0];
  if (x.hide != null) return [{ type: 'hide', iid: x.c.iid, bf: x.hide }];
  if (x.ability != null) return [{ type: 'activate', iid: x.c.iid, k: x.ability, targets: x.plan.targets, ...(x.plan.bf != null ? { bf: x.plan.bf } : {}) }];
  const act = { type: 'play', iid: x.c.iid, targets: x.plan.targets };
  if (x.plan.bf != null) act.bf = x.plan.bf;
  if (x.d.type === 'Unit' && R.kw(x.d.text).toEnemyBf) {
    const m = model(s, me);
    let best = null;
    s.bfs.forEach((b, i) => {
      if (!b.units[op].length || b.units[me].length || noUnitsHere(s, i)) return;
      const t = clone(m); t.bfs[i].u[me].push(unitOf(s, x.c, me));
      const v = fightValue(t, i, me, me);
      if (v > 2 && (!best || v > best.v)) best = { v, i };
    });
    if (best) act.to = { bf: best.i };
  }
  if (x.d.type === 'Unit' && x.cost !== FREE && R.kw(x.d.text).accelerate) act.accel = afford(s, me, [{ ...x.d, energy: (x.d.energy || 0) + 1, power: (x.d.power || 0) + 1 }]);
  return [act];
}

/* ---------------- driver ---------------- */
// Returns the next action for `me`, or null when it is not the AI's move.
function pregame(s, me, level) {
  if (s.stage === 'bf' && !s.bfPick[me]) { const o = s.bfOpts[me]; return { type: 'chooseBf', cid: o[rnd(o.length)] }; }
  if (s.stage === 'dice' && s.dice.caller === me) return s.dice.call ? null : { type: 'callParity', parity: Math.random() < 0.5 ? 'pair' : 'impair' };
  if (s.stage === 'mulligan' && !s.players[me].mullDone) return { type: 'mulligan', iids: mullPick(s, me, level) };
  return null;
}

// Answer a prompt aimed at the AI: discard the least useful cards / lose the weakest unit.
function answer(s, me, level) {
  const q = s.pending;
  if (q.kind === 'confirm') return { type: 'resolve', yes: q.ai !== false }; // battlefield "you may": take it
  if (q.kind === 'pick') {
    const z = s.players[me].zones, cs = q.cards.map(id => [...z.trash, ...z.main].find(c => c.iid === id)).filter(Boolean);
    const cost = c => (G.cd(s, c).energy || 0) + (G.cd(s, c).power || 0);
    // a spell cast from the trash (Fizz, Kai'Sa...): the one whose effects are worth the most right now, never one
    // that would only hurt my own units (a forced target on my unit, a bounce of my unit...)
    const val = c => { const d = G.cd(s, c); return d.type === 'Spell' && level !== 'easy' ? fxPlan(s, me, d, c.iid).v + 0.05 * cost(c) : cost(c); };
    const best = cs.map(c => ({ c, v: val(c) })).sort((a, b) => b.v - a.v)[0];
    return { type: 'resolve', iids: best && (best.v > 0 || G.cd(s, best.c).type !== 'Spell') ? [best.c.iid] : [] };
  }
  if (q.kind === 'discard') {
    const runes = s.players[me].zones.runes.length;
    const worth = c => {
      const d = G.cd(s, c);
      if (level === 'easy') return Math.random();
      let v = d.type === 'Unit' ? unitValue(d) : d.type === 'Spell' ? (R.spellFx(d.text) ? 3 : 1) : 1.5;
      if ((d.energy || 0) > runes + 2) v -= 2; // far from castable
      return v;
    };
    const ids = s.players[me].zones.hand.slice().sort((a, b) => worth(a) - worth(b)).slice(0, q.n).map(c => c.iid);
    return { type: 'resolve', iids: ids };
  }
  if (q.kind === 'predict') { // recycle cards far from castable
    const runes = s.players[me].zones.runes.length;
    const ids = level === 'easy' ? [] : q.cards.filter(id => { const c = s.players[me].zones.main.find(x => x.iid === id); return c && (G.cd(s, c).energy || 0) > runes + 2; });
    return { type: 'resolve', iids: ids };
  }
  if (q.kind === 'bf' && q.fx.kind !== 'aoe') { // where a unit goes / a battlefield buff applies
    const sd = s.showdown, op = other(me);
    const score = i => { const b = s.bfs[i]; return (sd && sd.bf === i ? 6 : 0) + (!b.units[op].length && b.ctrl !== me ? 4 : 0) + (q.fx.kind === 'bfBuff' ? b.units[me].length + b.units[op].length : 0) - (b.units[op].length > b.units[me].length + 1 ? 2 : 0); };
    return { type: 'resolve', bf: level === 'easy' ? q.opts[rnd(q.opts.length)] : q.opts.slice().sort((a, b) => score(b) - score(a))[0] };
  }
  if (q.kind === 'bf') { // the battlefield where the damage kills the most Might
    const val = i => s.bfs[i].units[other(me)].filter(c => G.hp(s, c) - (c.dmg || 0) <= q.fx.n).reduce((t, c) => t + G.hp(s, c), 0);
    const pick = level === 'easy' ? q.opts[rnd(q.opts.length)] : q.opts.slice().sort((a, b) => val(b) - val(a))[0];
    return { type: 'resolve', bf: pick };
  }
  if (q.kind === 'target') {
    const id = chooseTarget(s, me, level, q.fx, q.opts);
    if (q.opt && level !== 'easy') { const sim = { dmg: new Map(), gone: new Set(), mark: s.fxMark }; if (tvMain(s, me, q.fx, id, sim) < 0) return { type: 'resolve', iids: [] }; }
    return { type: 'resolve', iids: [id] };
  }
  const units = [...s.players[me].zones.base, ...s.bfs.flatMap(b => b.units[me])].filter(c => isUnit(s, c));
  if (q.kind === 'buff') { // buff the strongest unit that has no buff yet
    const ok = units.filter(c => c.iid !== q.exclude);
    const best = level === 'easy' ? ok[rnd(ok.length)] : ok.sort((a, b) => (a.buff > 0) - (b.buff > 0) || G.hp(s, b) - G.hp(s, a))[0];
    return { type: 'resolve', iids: [best.iid] };
  }
  const pick = level === 'easy' ? units[rnd(units.length)] : units.sort((a, b) => G.hp(s, a) - G.hp(s, b))[0];
  return { type: 'resolve', iids: [pick.iid] };
}

// Pick a target for a targeted effect: hurt the most valuable enemy, help my strongest unit.
function chooseTarget(s, me, level, e, opts) {
  if (level === 'easy') return opts[rnd(opts.length)];
  const mine = id => [...s.players[me].zones.base, ...s.bfs.flatMap(b => b.units[me])].some(c => c.iid === id);
  const card = id => { for (const p of ['p1', 'p2']) { const c = [...s.players[p].zones.base, ...s.bfs.flatMap(b => b.units[p])].find(x => x.iid === id); if (c) return c; } return null; };
  const harm = ['dmg', 'kill', 'stun', 'hand', 'recall', 'deck', 'dmgSplash', 'duel'].includes(e.op) || (e.op === 'might' && e.n < 0);
  const score = id => {
    const c = card(id); if (!c) return -99;
    const v = G.hp(s, c), dies = e.op === 'kill' || (e.op === 'dmg' && v - (c.dmg || 0) <= e.n);
    if (harm) return (mine(id) ? -100 - v : 0) + v + (dies ? 10 : 0) + (e.op === 'stun' && c.st ? -20 : 0);
    return (mine(id) ? 100 : 0) + v + (e.op === 'ready' && c.ex ? 10 : 0);
  };
  return opts.slice().sort((a, b) => score(b) - score(a))[0];
}

// Attach loose Equipment to the strongest unit (the ready ones first, they can still attack), if affordable.
function phaseEquip(s, me, level) {
  if (level === 'easy' && Math.random() < 0.5) return [];
  const z = s.players[me].zones, acts = [], pool = runePool(s, me);
  const units = [...z.base, ...s.bfs.flatMap(b => b.units[me])].filter(c => isUnit(s, c)).sort((a, b) => (a.ex - b.ex) || G.hp(s, b) - G.hp(s, a));
  if (!units.length) return acts;
  // [Empower]: a unit (or the legend) whose [Empowered] text helps, with Energy to spare
  for (const c of [...z.base, ...z.legend, ...s.bfs.flatMap(b => b.units[me])]) {
    const d = G.cd(s, c), cost = !c.emp && /\[Empower\]/.test(d.text || '') && R.kwCost(d.text, 'Empower');
    if (!cost || level === 'easy' || !R.statics(d.text).some(x => x.emp)) continue;
    const plan = R.planCost(pool, null, cost); if (!plan) continue;
    spend(pool, plan); acts.push({ type: 'empower', iid: c.iid });
  }
  for (const g of z.base.filter(c => !c.att && !c.anim && R.kw(G.cd(s, c).text).equip)) {
    const plan = R.planCost(pool, null, R.kwCost(G.cd(s, g).text, 'Equip') || { e: 0, p: [] });
    if (!plan) continue;
    spend(pool, plan);
    acts.push({ type: 'equip', iid: g.iid, unit: units[0].iid });
  }
  return acts;
}

/* ---------------- interaction: the stack and showdowns ---------------- */
const TRICKS = ['dmg', 'kill', 'stun', 'might', 'recall', 'hand'];
// cards in hand the AI could play right now with this timing, and can afford
function quickCards(s, me, reactionOnly) {
  const z = s.players[me].zones, runes = G.runesOf(s, me), pool = s.players[me].pool;
  const hid = s.bfs.flatMap((b, i) => (b.hidden || []).filter(c => c.owner === me && s.turn > (c.hidT || 0)).map(c => ({ c, d: G.cd(s, c), hidBf: i })));
  return [...z.hand.map(c => ({ c, d: G.cd(s, c) })).filter(({ d }) => {
    const k = R.kw(d.text);
    return (k.reaction || (!reactionOnly && (k.action || k.ambush))) && R.planCost(runes, pool, R.cardCost(d));
  }), ...hid];
}
function myAbilities(s, me, filter) {
  const pl = s.players[me], out = [];
  const cardsOn = [...pl.zones.base, ...pl.zones.legend, ...s.bfs.flatMap(b => b.units[me])];
  for (const c of cardsOn) {
    if (c.ex) continue;
    const d = G.cd(s, c);
    for (const ab of R.abilities(d)) {
      if (!ab.fx.length || ab.other || (ab.level && (pl.xp || 0) < ab.level) || (ab.xp && (pl.xp || 0) < ab.xp)) continue;
      if (ab.fx.some(e => e.kind === 'add')) continue; // mana abilities: not planned
      if (G.abilityBlocked(s, me, c, ab) || !R.planCost(G.runesOf(s, me), pl.pool, G.abilityCost(s, me, ab))) continue;
      if (filter && !filter(ab)) continue;
      out.push({ c, ab, d: { type: 'Spell', name: d.name + '@' + ab.i, text: ab.text }, owner: d });
    }
  }
  return out;
}
// value of the combat at battlefield i for `me`: enemy Might destroyed - mine, +-4 for who holds the battlefield
function fightValue(m, i, att, me) {
  const t = clone(m), op = other(me);
  simFight(t, i, att);
  const gone = p => m.bfs[i].u[p].filter(u => !t.bfs[i].u[p].some(x => x.iid === u.iid) && !t.base[p].some(x => x.iid === u.iid)).reduce((a, u) => a + Math.max(1, u.m), 0);
  return gone(op) - gone(me) + (t.bfs[i].ctrl === me ? 4 : 0) - (t.bfs[i].ctrl === op ? 4 : 0);
}
// Best combat trick at the showdown battlefield: try each castable card on each legal target there, simulate the fight.
function combatTrick(s, me, level, reactionOnly) {
  const sd = s.showdown; if (!sd) return null;
  const i = sd.bf, op = other(me), m = model(s, me);
  if (!m.bfs[i].u[me].length && !m.bfs[i].u[op].length) return null;
  const base = fightValue(m, i, sd.att, me);
  const opts = [];
  for (const { c, d, hidBf } of quickCards(s, me, reactionOnly)) {
    if (d.type === 'Unit') { // Ambush (where I already have units) or a hidden unit at this battlefield: reinforce
      const kd = R.kw(d.text);
      if (hidBf != null ? hidBf !== i || noUnitsHere(s, i) : !kd.ambush || noUnitsHere(s, i) || !(s.bfs[i].units[me].length || (kd.toEnemyBf && s.bfs[i].units[op].length))) continue;
      const t = clone(m); t.bfs[i].u[me].push(unitOf(s, c, me));
      opts.push({ v: fightValue(t, i, sd.att, me), act: hidBf != null ? { type: 'play', iid: c.iid } : { type: 'play', iid: c.iid, to: { bf: i } } });
      continue;
    }
    if (d.type !== 'Spell') continue;
    const r = trickPlan(s, m, i, sd.att, me, d, c.iid);
    if (r) opts.push({ v: r.v - (d.energy || 0) * 0.3 - (d.power || 0) * 0.3, act: { type: 'play', iid: c.iid, targets: r.targets, bf: i } });
  }
  // [Reaction] / [Action] abilities in the showdown (a unit fighting here can't use one: exhausting it is fine,
  // exhausted units still deal combat damage)
  if (!(s.chain && s.chain.length) || reactionOnly) for (const x of myAbilities(s, me, ab => ab.reaction || (ab.action && !reactionOnly))) {
    const r = trickPlan(s, m, i, sd.att, me, x.d, x.c.iid);
    if (r) opts.push({ v: r.v - (x.ab.cost.e + x.ab.cost.p.length) * 0.3 - (x.ab.kill ? 1 : 0), act: { type: 'activate', iid: x.c.iid, k: x.ab.i, targets: r.targets, bf: i } });
  }
  if (!opts.length) return null;
  if (level === 'easy') return Math.random() < 0.35 ? opts[rnd(opts.length)].act : null;
  const best = opts.sort((a, b) => b.v - a.v)[0];
  return best.v - base >= (level === 'pro' ? 0.4 : hardish(level) ? 0.5 : 0.8) ? best.act : null;
}
// Apply one effect to the showdown model (battlefield i). Returns false if it can't target that unit.
function simFx(t, i, me, e, id) {
  const b = t.bfs[i], all = [...b.u[me], ...b.u[other(me)]];
  let u = all.find(x => x.iid === id);
  if (e.kind === 'aoeAll') { if (e.scope === 'combat' || e.scope === 'bf') for (const p of e.side === 'enemy' ? [other(me)] : [me, other(me)]) for (const x of b.u[p]) x.dmg += e.n; }
  else if (e.kind === 'bfBuff') { for (const x of b.u[me]) { x.m += e.friendly || 0; x.sh += e.shield || 0; } for (const x of b.u[other(me)]) x.m = Math.max(1, x.m + (e.enemy || 0)); }
  else if (e.kind === 'allMight') for (const x of b.u[me]) x.m += e.n;
  else if (e.op === 'blink' || e.op === 'moveTo') { // a friendly unit from elsewhere joins this fight (or a damaged one comes back fresh)
    if (u && e.op === 'blink') { u.dmg = 0; return true; }
    const src = [...t.base[me], ...t.bfs.flatMap((x, k) => (k === i ? [] : x.u[me]))].find(x => x.iid === id);
    if (!src) return false;
    for (const arr of [t.base[me], ...t.bfs.map(x => x.u[me])]) { const k = arr.indexOf(src); if (k >= 0) arr.splice(k, 1); }
    if (e.op === 'blink') src.dmg = 0;
    b.u[me].push(src);
  } else {
    if (!u) return false;
    const side = b.u[me].includes(u) ? me : other(me);
    if (e.op === 'dmg') u.dmg += e.n;
    else if (e.op === 'dmgSplash') { u.dmg += e.n; for (const x of b.u[side]) if (x !== u) x.dmg += e.splash; }
    else if (e.op === 'stun') u.stun = true;
    else if (e.op === 'might') u.m = Math.max(e.min && u.m >= e.min ? e.min : 0, u.m + (e.perEnemy ? e.n * b.u[other(side)].length : e.n));
    else if (e.op === 'assault') u.as += e.n === 'might' ? u.m : e.n;
    else if (e.op === 'shield') { u.sh += e.n; if (e.tank) u.tank = true; }
    else if (e.op === 'double') u.m *= 2;
    else if (['kill', 'hand', 'deck', 'recall'].includes(e.op)) { b.u[side].splice(b.u[side].indexOf(u), 1); if (e.op === 'recall') t.base[side].push(u); }
    else if (e.op === 'mark') t.mark = u;
    else if (e.op === 'duel') { const a = t.mark; if (!a || a === u) return false; a.dmg += u.m; u.dmg += a.m; }
    else if (e.op === 'swap') { const a = t.mark; if (!a || a === u) return false; [a.m, u.m] = [u.m, a.m]; }
    else if (e.op === 'setMight') u.m = e.n;
    else return false;
  }
  for (const p of [me, other(me)]) b.u[p] = b.u[p].filter(x => x.dmg < Math.max(1, x.m));
  return true;
}
// Best use of a spell in the showdown at battlefield i: greedy target per effect, scored by the simulated combat.
function trickPlan(s, m, i, att, me, d, src) {
  const fx = R.playFx(d);
  if (!fx.length || fx.some(e => ['counter', 'wipe', 'wheel', 'killGearAll'].includes(e.kind))) return null;
  let t = clone(m); const targets = [];
  if (fx.length === 2 && fx[0].op === 'mark' && ['duel', 'swap'].includes(fx[1].op)) {
    let best = null;
    for (const a of G.candidates(s, me, { ...fx[0], src })) for (const b of G.candidates(s, me, { ...fx[1], src })) {
      if (a === b) continue;
      const u = clone(t); if (!simFx(u, i, me, fx[0], a) || !simFx(u, i, me, fx[1], b)) continue;
      const v = fightValue(u, i, att, me); if (!best || v > best.v) best = { v, ids: [a, b] };
    }
    return best && { v: best.v, targets: best.ids };
  }
  for (const e0 of fx) {
    const e = { ...e0, src };
    if (e.kind !== 'target') { if (['aoeAll', 'bfBuff', 'allMight'].includes(e.kind)) simFx(t, i, me, e); continue; }
    let best = null;
    for (const id of G.candidates(s, me, e)) {
      if (targets.includes(id) && (e.op !== 'dmg' || e.distinct)) continue;
      const u = clone(t);
      if (!simFx(u, i, me, e, id)) continue;
      const v = fightValue(u, i, att, me);
      if (!best || v > best.v) best = { v, id, u };
    }
    if (!best) { if (e.opt) continue; return null; }
    t = best.u; targets.push(best.id);
  }
  return { v: fightValue(t, i, att, me), targets };
}
// harm a spell on the stack would do to `me` (its declared targets included)
function threatOf(s, me, top) {
  const d = G.cd(s, top), fx = R.playFx(d), tg = (top.cb.targets || []).slice();
  let v = 0, hit = null;
  for (const e of fx) {
    if (e.kind === 'target') {
      const id = tg.shift(), f = id && G.find(s, id);
      if (!f || f.p !== me) continue;
      const c = f.c, left = G.lethal(s, c) - (c.dmg || 0);
      if (['kill', 'hand', 'deck'].includes(e.op) || (['dmg', 'dmgSplash'].includes(e.op) && e.n >= left)) { v += worth(s, c); hit = hit || { id, e }; }
      else if (e.op === 'recall' || e.op === 'stun') v += 1;
    } else if (e.who === 'opp' || ['wipe', 'aoeAll', 'aoe'].includes(e.kind)) v += e.kind === 'reveal' ? 1 : Math.max(0, kindValue(s, top.cb.by, e));
  }
  return { v: v + ((d.energy || 0) + (d.power || 0)) * 0.5, hit };
}
// The opponent put a card on the stack: counter it, save the unit it aims at, use a combat trick, or let it resolve.
function react(s, me, level, top) {
  const d = G.cd(s, top), cards = quickCards(s, me, true);
  const th = level === 'easy' ? { v: (d.energy || 0) + (d.power || 0), hit: null } : threatOf(s, me, top);
  const tp = d.power || 0, te = d.energy || 0;
  const counter = cards.find(x => x.d.type === 'Spell' && R.playFx(x.d).some(e => e.kind === 'counter' && !(e.maxE != null && te > e.maxE) && !(e.maxP != null && tp > e.maxP) && !(e.minP != null && tp < e.minP) && !(e.mine && !th.hit)));
  if (counter) {
    const go = level === 'easy' ? Math.random() < 0.25 : th.v >= (level === 'pro' ? 1.6 : hardish(level) ? 2 : 2.5);
    if (go) return { type: 'play', iid: counter.c.iid };
  }
  if (th.hit && level !== 'easy') { // save the unit: buff it out of reach, or blink / recall it
    const f = G.find(s, th.hit.id), c = f.c, incoming = th.hit.e.op === 'dmg' || th.hit.e.op === 'dmgSplash' ? th.hit.e.n : Infinity;
    for (const x of cards) {
      if (x.d.type !== 'Spell') continue;
      const e = R.playFx(x.d).find(y => y.kind === 'target' && (y.side !== 'enemy'));
      if (!e || !G.candidates(s, me, { ...e, src: x.c.iid }).includes(c.iid)) continue;
      const toughness = G.lethal(s, c) + (e.op === 'might' ? e.n : e.op === 'double' ? G.hp(s, c) : 0) - (c.dmg || 0);
      const saves = e.op === 'blink' || e.op === 'hand' || (e.op === 'recall' && f.zone === 'bf' && th.hit.e.where === 'bf') || (['might', 'double'].includes(e.op) && toughness > incoming);
      if (saves && worth(s, c) >= (x.d.energy || 0) * 0.6) return { type: 'play', iid: x.c.iid, targets: [c.iid], bf: f.zone === 'bf' ? f.bf : undefined };
    }
  }
  return s.showdown ? combatTrick(s, me, level, true) : null;
}

function next(s, me, menuLevel, mem) { return nextP(s, me, PROFILE[menuLevel] || menuLevel, mem); }
function nextP(s, me, level, mem) {
  const prev = PLAN;
  PLAN = mem.plan && mem.planTurn === s.turn && s.active === me ? mem.plan : {};
  try { return step(s, me, level, mem); } finally { PLAN = prev; }
}
// --- pro look-ahead ---
const VARIANTS = [{}, { noAttack: 1 }, { noSpell: 1 }, { aggro: 1 }, { noSpell: 1, aggro: 1 }];
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
// a copy of the game where what I can't see (opponent's hand, both decks' order) is guessed at random
function guess(s, me) {
  const { history, log, ...rest } = s, c = structuredClone(rest), op = other(me);
  c.history = []; c.log = [];
  c.auto = { p1: true, p2: true }; // a human in manual mode would stall the simulated game (no payment, no ready)
  const zo = c.players[op].zones, all = shuffle([...zo.hand.filter(x => !x.rev), ...zo.main]), k = zo.hand.filter(x => !x.rev).length;
  zo.hand = [...zo.hand.filter(x => x.rev), ...all.slice(0, k)]; zo.main = all.slice(k);
  shuffle(c.players[me].zones.main);
  return c;
}
function evalState(s, me) {
  const op = other(me);
  if (s.winner) return s.winner === me ? 1000 : -1000;
  const P = s.players, might = p => unitsAll(s, p).reduce((a, c) => a + G.hp(s, c), 0);
  const near = p => Math.max(0, P[p].score - s.winScore + 4) ** 2; // the last points weigh more
  return 10 * (P[me].score - P[op].score) + 2 * (near(me) - near(op)) + 2.5 * s.bfs.reduce((a, b) => a + (b.ctrl === me) - (b.ctrl === op), 0)
    + 0.6 * (might(me) - might(op)) + 0.8 * (P[me].zones.hand.length - P[op].zones.hand.length) + 0.3 * (G.runesOf(s, me).length - G.runesOf(s, op).length);
}
// play my turn with a plan, the opponent's turn, then my next turn (both sides 'hard'), and score the result
// the best few attacks, each played out on guessed copies of the game
const BUDGET = 1200; // ms of look-ahead per decision at most
function proAttack(s, me, m) {
  const key = me + '|' + s.turn + '|' + s.rev;
  if (proAttack.key === key) return proAttack.moves;
  const cands = searchAttack(m, me, 4);
  if (cands.length < 2) return cands[0] ? cands[0].moves : [];
  const guesses = Array.from({ length: 5 }, () => guess(s, me)), t0 = Date.now();
  let best = null;
  for (const cand of cands) {
    if (best && Date.now() - t0 > BUDGET) break;
    let v = 0;
    for (const g0 of guesses) {
      const c = structuredClone(g0);
      for (const a of movesToActs(c, me, cand.moves)) G.apply(c, { ...a, seat: me, p: me });
      v += rollout(c, me, { turn: c.turn, phase: 4, q: [], main: 99, att: 1 }, PLAN);
    }
    v /= guesses.length;
    if (!best || v > best.v + 0.01) best = { v, moves: cand.moves };
  }
  proAttack.key = key; proAttack.moves = best.moves;
  return best.moves;
}
function rollout(c, me, mem, plan) {
  SIM++;
  try { return rolloutRun(c, me, mem, plan); } finally { SIM--; }
}
function rolloutRun(c, me, mem, plan) {
  const t0 = c.turn, mems = { [me]: { ...structuredClone(mem), plan, planTurn: t0, sim: true }, [other(me)]: { sim: true } };
  for (let n = 0; n < 900 && !c.winner && c.turn < t0 + 3; n++) {
    let p = c.active, a = nextP(c, p, 'hard', mems[p]);
    if (!a) { p = other(p); a = nextP(c, p, 'hard', mems[p]); }
    if (!a) break;
    if (G.apply(c, { ...a, seat: p, p })) { mems[p].q = []; if ((mems[p].err = (mems[p].err || 0) + 1) > 20) { G.apply(c, { type: 'endTurn', seat: p, p }); mems[p].err = 0; } }
    if (c.history.length > 40) c.history.length = 0;
  }
  return evalState(c, me);
}
function planTurn(s, me, mem) {
  const key = me + '|' + s.turn + '|' + s.rev; // the server looks once before acting: same position, same plan
  if (planTurn.key === key) { mem.plan = planTurn.plan; mem.planTurn = s.turn; return; }
  const guesses = Array.from({ length: 6 }, () => guess(s, me)), t0 = Date.now();
  let best = null;
  for (const plan of VARIANTS) {
    if (best && Date.now() - t0 > BUDGET) break;
    const v = guesses.reduce((a, c) => a + rollout(structuredClone(c), me, mem, plan), 0) / guesses.length;
    if (!best || v > best.v + 0.01) best = { v, plan };
  }
  mem.plan = best.plan; mem.planTurn = s.turn; planTurn.key = key; planTurn.plan = best.plan;
}
function step(s, me, level, mem) {
  if (s.phase !== 'playing' || s.winner) return null;
  if (s.pending) return s.pending.to === me ? answer(s, me, level) : null; // otherwise wait for the human
  if (s.stage !== 'main') return pregame(s, me, level);
  // the stack: answer the opponent's card (or let it resolve); resolve mine once the opponent let it through
  const top = s.chain && s.chain[s.chain.length - 1];
  if (top) {
    if (top.cb.by !== me) return top.cb.seen ? null : react(s, me, level, top) || { type: 'chainPass' };
    return top.cb.seen ? { type: 'chainResolve' } : null;
  }
  if (mem.turn !== s.turn && s.active === me) { mem.turn = s.turn; mem.q = []; mem.phase = 0; mem.pool = null; mem.att = 0; mem.main = 0; }
  // showdown: finish bringing my attackers in, then act with Focus (trick or pass)
  const sd = s.showdown;
  if (sd) {
    const q = mem.q && mem.q[0];
    if (sd.fresh && sd.att === me && s.active === me && q && q.type === 'move' && q.to.bf === sd.bf) return mem.q.shift();
    if (sd.focus !== me) return null;
    return combatTrick(s, me, level, false) || { type: 'pass' };
  }
  if (s.active !== me) return null;
  if (mem.q.length) return mem.q.shift();
  const phases = [
    () => (s.started !== s.turn ? [{ type: 'startTurn' }] : []),
    () => { if (level === 'pro' && !mem.sim && mem.planTurn !== s.turn) { planTurn(s, me, mem); PLAN = mem.plan; } return []; },
    ...(level === 'easy' ? [
      () => phaseRemoval(s, me, level, (mem.pool = runePool(s, me))),
      () => phaseDraw(s, me, level, runePool(s, me)),
      () => phaseDeploy(s, me, level, runePool(s, me)),
    ] : [() => { const a = phaseMain(s, me, level); if (a.length && ++mem.main < 15) mem.phase--; return a; }]),
    () => phaseEquip(s, me, level),
    () => { const a = phaseAttack(s, me, level); if (a.length && ++mem.att < 3) mem.phase--; return a; },
    () => [{ type: 'endTurn' }],
  ];
  while (mem.phase < phases.length) {
    mem.q = phases[mem.phase++]();
    if (mem.q.length) return mem.q.shift();
  }
  return null;
}

function mullPick(s, me, level) {
  if (level === 'easy') return [];
  const hand = s.players[me].zones.hand.map(c => ({ c, e: G.cd(s, c).energy || 0 })).sort((a, b) => b.e - a.e);
  const limit = level === 'pro' ? 4 : hardish(level) ? 5 : 6;
  const out = hand.filter(x => x.e >= limit).slice(0, 2);
  if (hardish(level) && !hand.some(x => x.e <= 2) && out.length < 2) { const x = hand.find(y => !out.includes(y)); if (x) out.push(x); }
  return out.map(x => x.c.iid);
}

const mulligan = (s, me, menuLevel) => mullPick(s, me, PROFILE[menuLevel] || menuLevel);
module.exports = { next, mulligan, PROFILE, _test: { model, applyMoves, greedyAttack, searchAttack, evaluate, phaseMain, fxPlan, react, trickPlan } };
