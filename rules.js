// Shared rule helpers: keyword parsing, rune payment, combat damage assignment.
const kwCache = new Map();

function timing(t, k) {
  const head = /^(?:\s*\[[^\]]+\](?:\s*—)?\s*(?::rb_\w+:)*)*/.exec(t.replace(/\([^)]*\)/g, ''))[0];
  return new RegExp(String.raw`\[${k}\](?!\s*\[(?:>|&gt;)\])`).test(head) || (k === 'Reaction' && /\[Quick-Draw\]/.test(head));
}
// Keywords that change combat/movement. Unknown text is ignored (vanilla body).
function kw(text) {
  const t = text || '';
  if (kwCache.has(t)) return kwCache.get(t);
  const n = re => { const m = re.exec(t); return m ? (m[1] ? +m[1] : 1) : 0; };
  const k = {
    assault: n(/\[Assault(?: (\d+))?\]/), shield: n(/\[Shield(?: (\d+))?\]/),
    tank: /\[Tank\]/.test(t), ganking: /\[Ganking\]/.test(t), accelerate: /\[Accelerate\]/.test(t),
    onPlayDraw: n(/When you play me, draw (\d+)/i),
    // Ambush / "can be played to a battlefield": may enter directly where you already have units
    ambush: /\[Ambush\]|can be played to a battlefield/i.test(t),
    temporary: /\[Temporary\]/.test(t) && !/Give (?:a|it|that)[^.]*\[Temporary\]/i.test(t),
    hunt: n(/\[Hunt(?: (\d+))?\]/),
    deathDraw: n(/\[Deathknell\]\s*\[(?:>|&gt;)\]\s*Draw (\d+)\./),
    backline: /\[Backline\]/.test(t), disarm: n(/\[Disarm(?: (\d+))?\]/), deflect: n(/\[Deflect(?: (\d+))?\]/),
    hidden: /\[Hidden\]|(^|\n)Hidden \(/.test(t), quickDraw: /^[^.]*\[Quick-Draw\]/.test(t), equip: /\[Equip\]/.test(t),
    // timing permission of the card itself: a leading [Reaction] / [Action] keyword (not an "[Action][>]" ability)
    reaction: timing(t, 'Reaction'), action: timing(t, 'Action'),
  };
  kwCache.set(t, k);
  return k;
}

// Spell effects the AI understands. Anything else is not cast by the AI.
function spellFx(text) {
  const t = (text || '').replace(/\([^)]*\)/g, '');
  let m;
  if (/Kill all units/i.test(t)) return { kind: 'wipe' };
  if ((m = /Deal (\d+) to all enemy units at a battlefield/i.exec(t))) return { kind: 'dmgAll', n: +m[1] };
  if ((m = /Kill an? (?:enemy )?unit(?: at a battlefield)?(?: with (\d+) :rb_might: or less)?/i.exec(t))) return { kind: 'kill', max: m[1] ? +m[1] : 99, bfOnly: /at a battlefield/i.test(m[0]) };
  if ((m = /Deal (\d+) to an? (?:enemy )?unit( at a battlefield)?/i.exec(t))) return { kind: 'dmg', n: +m[1], bfOnly: !!m[2] };
  if ((m = /^\s*Draw (\d+)\.?\s*$/i.exec(t))) return { kind: 'draw', n: +m[1] };
  return null;
}

// Effects resolved automatically when a card is played, in text order.
// who: 'self' (the player who played it) or 'opp'. Choices (discard, targets, ...) become prompts.
// Units/gear: only the "When you play me/this, ..." part counts. Spells: the whole text.
// ctx: { legion: another card was played this turn, xp: controller's XP } for [Legion] / [Level N] text.
const fxCache = new Map();
const UNIT = String.raw`(a|an|any|an enemy|a friendly|another friendly|another) unit( at a battlefield| at a base| in a base| here)?(?: with (\d+) :rb_might: or less)?`;
const TARGETED = [
  ['dmg', new RegExp(String.raw`\bdeal (\d+) to ` + UNIT, 'gi'), 1],
  ['kill', new RegExp(String.raw`\bkill ()` + UNIT, 'gi'), 1],
  ['stun', new RegExp(String.raw`\bstun ()` + UNIT, 'gi'), 1],
  ['might', new RegExp(String.raw`\bgive ` + UNIT + String.raw` ([+-]\d+) :rb_might: this turn`, 'gi'), 4],
  ['ready', new RegExp(String.raw`\bready ()` + UNIT, 'gi'), 1],
  ['hand', new RegExp(String.raw`\breturn ()` + UNIT + String.raw` to (?:its|their) owners?'?s?'? hands?`, 'gi'), 1],
  ['recall', new RegExp(String.raw`\brecall ()` + UNIT, 'gi'), 1],
];
// Cards whose text the generic parser can't read: their effects, written by hand (same format as playFx).
// Target ops: dmg kill stun might ready hand recall deck attach | assault shield tank double (this turn)
//   mark + duel (two units deal their Might to each other) | blink (banish, then played again: to 'any' battlefield,
//   'same' location or 'base') | moveTo (a friendly unit to a battlefield, ready: also readies it) | dmgSplash.
// Target filters: side enemy|friendly|any, where any|bf|base|combat|attacking, max (Might), dom (domain), opt (may skip).
const T = (op, o = {}) => ({ kind: 'target', who: 'self', op, n: 0, side: 'any', where: 'any', max: null, ...o });
const CARD_FX = {
  'Avalanche': [{ kind: 'aoeAll', n: 3, scope: 'base', side: 'all' }],
  'Back to Back': [T('might', { n: 2, side: 'friendly' }), T('might', { n: 2, side: 'friendly' })],
  'Bellows Breath': [T('dmg', { n: 1, opt: true }), T('dmg', { n: 1, opt: true }), T('dmg', { n: 1, opt: true })],
  'Block': [T('shield', { n: 3, tank: true })],
  'Blood Rush': [T('assault', { n: 2 })],
  'Bonds of Strength': [T('might', { n: 1, side: 'friendly' }), T('might', { n: 1, side: 'friendly' })],
  'Brawl': [T('assault', { n: 'might' })],
  'Cannon Barrage': [{ kind: 'aoeAll', n: 2, scope: 'combat', side: 'enemy' }],
  'Challenge': [T('mark', { side: 'friendly' }), T('duel', { side: 'enemy' })],
  'Rampage': [T('mark', { side: 'friendly' }), T('duel', { side: 'enemy' })],
  'Marching Orders': [T('mark', { side: 'friendly' }), T('duel', { side: 'enemy', where: 'bf' })],
  'Clash of Giants': [T('mark'), T('duel')],
  'Charm': [T('recall', { side: 'enemy', where: 'bf' })],
  'Cleave': [T('assault', { n: 3 })],
  'Crescent Strike': [T('dmgSplash', { n: 4, splash: 1, side: 'enemy', where: 'bf' })],
  'Cull the Weak': [{ kind: 'sacrifice', n: 1, who: 'opp' }, { kind: 'sacrifice', n: 1, who: 'self' }],
  'Death from Below': [T('kill', { where: 'bf' })],
  'Decree of Rage': [T('dmg', { n: 4, side: 'enemy', dom: 'Calm' })],
  'Decree of Unity': [T('kill', { side: 'enemy', dom: 'Chaos' })],
  'Decree of Insight': [T('might', { n: -5, side: 'enemy', dom: 'Body' })],
  'Defy': [{ kind: 'counter', maxE: 4, maxP: 1 }],
  'Hush': [{ kind: 'counter', minP: 2 }],
  'Not So Fast': [{ kind: 'counter', mine: true }],
  'Riposte': [{ kind: 'counter' }],
  'En Garde': [T('might', { n: 1, side: 'friendly', alone: 1 })],
  'Existential Dread': [T('stun', { side: 'enemy', where: 'attacking' })],
  'Thwonk!': [T('stun', { where: 'attacking' })],
  'Fight or Flight': [T('recall', { where: 'bf' })],
  'Flash': [T('recall', { side: 'friendly', where: 'bf', opt: true }), T('recall', { side: 'friendly', where: 'bf', opt: true })],
  'Flurry of Blades': [{ kind: 'aoeAll', n: 1, scope: 'bf', side: 'all' }],
  'For Demacia!': [{ kind: 'bfBuff', shield: 2, mine: true }],
  'Siphon Power, Viktor': [{ kind: 'bfBuff', friendly: 1, enemy: -1 }],
  'Moonfall': [{ kind: 'bfBuff', enemy: -2, mine: true }],
  'Isolate': [T('recall', { side: 'enemy', where: 'bf' })],
  "Keeper's Verdict": [T('deck', { side: 'enemy', where: 'bf' })],
  'Last Stand': [T('double', { side: 'friendly' })],
  'Dominus': [T('double')],
  'On the Hunt': [{ kind: 'readyAll' }],
  'Raucous Anthem': [{ kind: 'readyAll' }, { kind: 'allMight', n: 3 }],
  'Piercing Light': [T('dmg', { n: 2, where: 'bf' }), T('dmg', { n: 2, opt: true })],
  'Portal Rescue': [T('blink', { side: 'friendly', to: 'base' })],
  'Thrill of the Hunt': [T('blink', { side: 'friendly', to: 'any' })],
  'Temporal Breach': [T('blink', { to: 'same' })],
  'Ride the Wind': [T('moveTo', { side: 'friendly', ready: true })],
  'Right of Conquest': [{ kind: 'draw', n: 1, per: 'bfCtrl' }],
  'Scorched Earth': [T('dmg', { n: 5, where: 'bf' })],
  'Show of Strength': [{ kind: 'draw', n: 0, per: 'mighty' }],
  'Singularity': [T('dmg', { n: 6, opt: true }), T('dmg', { n: 6, opt: true })],
  'Star-Crossed': [T('hand', { side: 'friendly' }), T('hand', { side: 'enemy' })],
  'Thermo Beam': [{ kind: 'killGearAll' }],
  'Twilight Step': [T('recall', { where: 'bf', max: 3 })],
  'Unchecked Power': [{ kind: 'exhaustAll' }, { kind: 'aoeAll', n: 12, scope: 'bf', side: 'all' }],
  'Vault Breaker': [T('assault', { n: 2 })],
  'Wind and Ghosts': [T('hand', { where: 'bf' })],
  'Invert Timelines': [{ kind: 'wheel', n: 4 }],
  'Shuriken Flip': [T('dmg', { n: 2, side: 'enemy', where: 'bf', opt: true })],
  'Skyward Strike': [T('recall', { side: 'enemy', where: 'bf' })],
  'Ntofo Strikes': [T('shield', { n: 2, side: 'friendly' }), T('dmg', { n: 2, side: 'enemy' })],
  'Stacked Deck': [{ kind: 'draw', n: 1 }],
  'Called Shot': [{ kind: 'draw', n: 1 }],
  'Lightning Rush': [{ kind: 'draw', n: 1 }],
  'Against the Odds': [T('might', { n: 2, side: 'friendly', where: 'bf', perEnemy: true })],
};
function playFx(card, ctx = {}) {
  if (CARD_FX[card.name]) return CARD_FX[card.name].map((e, i) => ({ who: 'self', ...e, at: i }));
  const text = card.text || '';
  const lv = /\[Level (\d+)\]/i.exec(text);
  const key = card.type + '|' + text + '|' + (ctx.legion ? 1 : 0) + '|' + (lv && (ctx.xp || 0) >= +lv[1] ? 1 : 0);
  if (fxCache.has(key)) return fxCache.get(key);
  // keyword headers with costs ("[Repeat] :rb_energy_1:", "[Flow] ...") are not effects
  const raw = text.replace(/\([^)]*\)/g, '').replace(/\[(Repeat|Flow|Equip|Empower|Deflect|Hidden|Action|Reaction|Accelerate|Ambush|Quick-Draw|Weaponmaster|Deploy|Ganking|Tank|Backline)\](\s*—)?\s*(:rb_(energy_\d+|rune_\w+):)*/gi, ' ');
  const risky = /\bif\b|\bmay\b|choose (one|two|three)|additional cost|for each|instead|unless|\bup to\b|\bor\b(?! less)|\bto (give|deal|draw|play|ready|move|channel|buff|stun|kill|return|gain)\b/i; // "[do X] to [do Y]": a cost, left to the players
  let sentences = raw.split(/(?<=[.!])\s*/).reduce((a, x) => (/^(They|It|Then)\b/.test(x) && !/^Then,? if\b/i.test(x) && a.length ? (a[a.length - 1] += ' ' + x) : a.push(x), a), []);
  // dependent keywords: [Legion] needs another card played this turn, [Level N] needs N XP
  sentences = sentences.filter(x => {
    const l = /^\s*(?:\[[^\]]*\]\s*)*\[Level (\d+)\]/i.exec(x);
    if (l && (ctx.xp || 0) < +l[1]) return false;
    if (/^\s*(?:\[[^\]]*\]\s*)*\[Legion\]/i.test(x) && !ctx.legion) return false;
    return true;
  });
  const fx = [];
  if (card.type !== 'Spell') {
    if (/(^|[.\]]\s*)\[Vision\]/.test(text.replace(/\([^)]*\)/g, ''))) fx.push({ kind: 'predict', n: 1, who: 'self', at: -1 });
    sentences = sentences.filter(x => /^\s*(\[[^\]]*\]\s*)*When you play (me|this),/i.test(x)).map(x => x.replace(/^[^,]*,/, ''));
  }
  // "Choose a unit. Deal 3 to it." -> "Deal 3 to a unit."
  sentences = sentences.map(x => { const y = x.replace(/^(\s*(?:then,?\s*)?)you may /i, '$1OPTX '); return y !== x && !risky.test(y) ? y : x; });
  let t = sentences.filter(x => !risky.test(x)).join(' ')
    .replace(/\[(Buff|Stun|Predict|Burn|Recall|Ready)\]/gi, (m, w) => w.toLowerCase())
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(new RegExp(String.raw`choose ` + UNIT + String.raw`\.\s*(deal \d+ to|stun|kill|ready|return|recall|give) it\b`, 'gi'), (m, who, where = '', max, verb) => `${verb} ${who} unit${where}${max ? ` with ${max} :rb_might: or less` : ''}`);
  const add = (idx, e) => fx.push({ ...e, at: idx });
  let m;
  const re = /choose a player\. They discard (\d+)|(?:each |an )?opponents? (?:must )?discards? (\d+)|an opponent reveals their hand|they reveal their hand|each opponent must kill one of their units|\bdiscard (\d+)|\bdraw (\d+)(?! for each)/gi;
  while ((m = re.exec(t))) {
    const s = m[0].toLowerCase();
    if (m[1] || m[2]) add(m.index, { kind: 'discard', n: +(m[1] || m[2]), who: 'opp' });
    else if (s.includes('reveal')) add(m.index, { kind: 'reveal', who: 'opp' });
    else if (s.includes('kill one')) add(m.index, { kind: 'sacrifice', n: 1, who: 'opp' });
    else if (m[3]) add(m.index, { kind: 'discard', n: +m[3], who: 'self' });
    else if (m[4]) add(m.index, { kind: 'draw', n: +m[4], who: 'self' });
  }
  if ((m = /\bcounter a spell\./i.exec(t))) add(m.index, { kind: 'counter', who: 'self' });
  if ((m = /\bbuff (another|a) friendly unit|\bbuff me\b/i.exec(t))) add(m.index, { kind: 'buff', who: 'self', other: /another/i.test(m[0]), me: /buff me/i.test(m[0]) });
  for (const tk of tokensIn(t)) add(t.search(new RegExp(tk.name, 'i')), tk);
  for (const [op, rx, numAt] of TARGETED) {
    rx.lastIndex = 0;
    while ((m = rx.exec(t))) {
      const g = m.slice(1), who = (op === 'might' ? g[0] : g[1]).toLowerCase(), where = ((op === 'might' ? g[1] : g[2]) || '').trim();
      const max = op === 'might' ? g[2] : g[3];
      if (op === 'kill' && /\bkill all\b/i.test(t.slice(Math.max(0, m.index - 1), m.index + 9))) continue;
      add(m.index, {
        kind: 'target', who: 'self', op, n: op === 'dmg' ? +g[0] : op === 'might' ? +g[3] : 0,
        side: /enemy/.test(who) ? 'enemy' : /friendly|another/.test(who) ? 'friendly' : 'any', notSelf: /another/.test(who),
        where: /battlefield/.test(where) ? 'bf' : /base/.test(where) ? 'base' : /here/.test(where) ? 'here' : 'any', max: max ? +max : null,
        ...(op === 'might' && /^,? to a minimum of 1\b/i.test(t.slice(rx.lastIndex)) ? { min: 1 } : {}),
      });
    }
  }
  if ((m = /\bkill an? (enemy )?gear\b/i.exec(t))) add(m.index, { kind: 'target', who: 'self', op: 'kill', gear: true, side: m[1] ? 'enemy' : 'any', where: 'any' });
  if ((m = /\bkill all units\b/i.exec(t))) add(m.index, { kind: 'wipe', who: 'self' });
  if ((m = /\bdeal (\d+) to all enemy units at a battlefield\b/i.exec(t))) add(m.index, { kind: 'aoe', n: +m[1], who: 'self' });
  if ((m = /\bgive friendly units ([+-]\d+) :rb_might: this turn/i.exec(t))) add(m.index, { kind: 'allMight', n: +m[1], who: 'self' });
  if ((m = /\bchannel (\d+) runes?( exhausted)?/i.exec(t))) add(m.index, { kind: 'channel', n: +m[1], ex: !!m[2], who: 'self' });
  if ((m = /\bgain (\d+) xp\b/i.exec(t))) add(m.index, { kind: 'xp', n: +m[1], who: 'self' });
  if ((m = /\bpredict(?: (\d+))?/i.exec(t))) add(m.index, { kind: 'predict', n: +(m[1] || 1), who: 'self' });
  if ((m = /\bburn (\d+)/i.exec(t))) add(m.index, { kind: 'burn', n: +m[1], who: 'self' });
  for (const e of fx) { const before = t.slice(0, Math.max(0, e.at)); if (before.lastIndexOf('OPTX') > before.lastIndexOf('.')) e.opt = true; }
  fx.sort((a, b) => a.at - b.at);
  fxCache.set(key, fx);
  return fx;
}
// "I enter ready" (unconditional) — otherwise units enter exhausted
const entersReady = card => /(^|[.\]]\s*)I enter ready/.test((card.text || '').replace(/\([^)]*\)/g, ''));

const domOf = d => (d && d.domain || []).filter(x => x !== 'Colorless');

// Costs. A cost is { e: energy, p: [domain set or null (any)] } — one entry per Power symbol.
const RUNE_DOM = { fury: 'Fury', calm: 'Calm', mind: 'Mind', body: 'Body', chaos: 'Chaos', order: 'Order' };
function parseCost(str) {
  let e = 0; const p = [];
  for (const m of (str || '').matchAll(/:rb_(?:energy_(\d+)|rune_(\w+)):/g)) { if (m[1]) e += +m[1]; else p.push(RUNE_DOM[m[2]] ? [RUNE_DOM[m[2]]] : null); }
  return { e, p };
}
// cost written right after a keyword: "[Equip] :rb_rune_order:", "[Repeat] :rb_energy_1::rb_rune_mind:", "[Empower] ..."
function kwCost(text, k) {
  const m = new RegExp(String.raw`\[${k}\]\s*(?:—\s*)?((?::rb_(?:energy_\d+|rune_\w+):)+)`).exec(text || '');
  return m ? parseCost(m[1]) : null;
}
// printed cost of a card: Energy + one Power of its domains per power symbol ([C]); domainless = any
function cardCost(d, accel) {
  const doms = domOf(d), P = () => (doms.length ? doms : null);
  const c = { e: (d.energy || 0) + (accel ? 1 : 0), p: Array.from({ length: (d.power || 0) + (accel ? 1 : 0) }, P) };
  return c;
}
const sumCost = (...cs) => cs.filter(Boolean).reduce((a, c) => ({ e: a.e + c.e, p: [...a.p, ...c.p] }), { e: 0, p: [] });
// Plan a payment. runes: [{iid, ex, dom}]; pool: {e, p:[domain|'any']}.
// Power: pool first, then recycle matching runes (exhausted ones first). Energy: pool, then exhaust ready runes.
// Returns {ex:[iid], rc:[iid], usedE, usedP:[pool indices]} or null.
function planCost(runes, pool, cost) {
  const ok = (set, dom) => !set || dom === 'any' || set.includes(dom);
  const usedP = [], rc = [];
  // most constrained power symbols first
  const req = cost.p.slice().sort((a, b) => (a ? a.length : 9) - (b ? b.length : 9));
  for (const set of req) {
    const i = (pool ? pool.p : []).findIndex((d, k) => !usedP.includes(k) && ok(set, d));
    if (i >= 0) { usedP.push(i); continue; }
    const r = runes.filter(r => !rc.includes(r.iid) && ok(set, r.dom)).sort((a, b) => (b.ex ? 1 : 0) - (a.ex ? 1 : 0))[0];
    if (!r) return null;
    rc.push(r.iid);
  }
  let needE = cost.e;
  const usedE = Math.min(pool ? pool.e : 0, needE); needE -= usedE;
  const left = runes.filter(r => !r.ex && !rc.includes(r.iid));
  if (left.length < needE) return null;
  // keep runes that could still produce useful power for later: spend the most common domain first
  const cnt = {}; for (const r of left) cnt[r.dom] = (cnt[r.dom] || 0) + 1;
  left.sort((a, b) => cnt[b.dom] - cnt[a.dom]);
  return { ex: left.slice(0, needE).map(r => r.iid), rc, usedE, usedP };
}
// legacy helper used by the AI: plan a card's printed cost (+ extra energy/power of its domains) from runes only
function planPay(runes, card, extraE = 0, extraP = 0) {
  const doms = domOf(card);
  const c = cardCost(card); c.e += extraE; for (let i = 0; i < extraP; i++) c.p.push(doms.length ? doms : null);
  return planCost(runes, null, c);
}

// Combat damage assignment: lethal damage in order, Tanks first, then the easiest kills.
// units: [{dmg, stun, tank, backline}] mutable; hp(u) = effective might in this role.
// Lethal damage is the unit's Might, at least 1 (a 0 Might unit needs 1). Tank first, Backline last.
const lethal = (u, hp) => Math.max(1, hp(u));
function assign(dmg, units, hp) {
  const rank = u => (u.tank ? 0 : u.backline ? 2 : 1);
  const order = units.slice().sort((a, b) => rank(a) - rank(b) || (lethal(a, hp) - a.dmg) - (lethal(b, hp) - b.dmg));
  for (const u of order) {
    if (dmg <= 0) break;
    const need = lethal(u, hp) - u.dmg;
    if (need <= 0) continue;
    const give = Math.min(dmg, need);
    u.dmg += give; dmg -= give;
  }
}
// Resolve one combat. A = attackers, D = defenders. Returns {deadA, deadD} (mutates dmg).
function combat(A, D, hpA, hpD) {
  const dA = A.filter(u => !u.stun).reduce((t, u) => t + hpA(u), 0);
  const dD = D.filter(u => !u.stun).reduce((t, u) => t + hpD(u), 0);
  assign(dA, D, hpD);
  assign(dD, A, hpA);
  return { deadA: A.filter(u => u.dmg >= lethal(u, hpA)), deadD: D.filter(u => u.dmg >= lethal(u, hpD)) };
}

// "Play two 3 :rb_might: Mech unit tokens to your base." -> [{kind:'token', name, n, ready, ex, here}]
// Only base / "here" / unspecified locations are automatic; "to a battlefield" / "there" stay manual.
const NUM = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5 };
function tokensIn(text) {
  const out = [], re = /\bplays? (a|an|one|two|three|four|five|\d+) (ready )?(?:\d+ :rb_might: )?(Recruit|Mech|Sand Soldier|Bird|Sprite|Gold|Bomb|Tentacle|Shadow Clone) (?:unit|gear) tokens?((?: with +\S*)?)( exhausted)?( (?:to|into|in|at) your base| here| to a battlefield| to a single battlefield| there)?/gi;
  let m;
  while ((m = re.exec(text || ''))) {
    const loc = (m[6] || '').trim();
    if (/battlefield|there/.test(loc)) continue;
    const name = m[3].toLowerCase().replace(/\b\w/g, x => x.toUpperCase());
    out.push({ kind: 'token', who: 'self', name, n: NUM[m[1].toLowerCase()] || +m[1] || 1, ready: !!m[2], ex: !!m[5], here: loc === 'here' });
  }
  return out;
}
// Deathknell effects: draw is handled by kw().deathDraw; tokens here.
const deathTokens = text => { const m = /\[Deathknell\][^A-Za-z]*([^.]*\.)/.exec(text || ''); return m && !/\bif\b|\bmay\b/i.test(m[1]) ? tokensIn(m[1]) : []; };
// Tokens with no card in the official data: drawn by the client from this data.
const SYNTH_TOKENS = [
  { id: 'tok-mech', name: 'Mech', might: 3, tags: ['Mech'] },
  { id: 'tok-sand-soldier', name: 'Sand Soldier', might: 2, tags: ['Sand Soldier'] },
  { id: 'tok-tentacle', name: 'Tentacle', might: 1, tags: ['Bilgewater'] },
  { id: 'tok-shadow-clone', name: 'Shadow Clone', might: 0, tags: [] },
  { id: 'tok-bomb', name: 'Bomb', type: 'Gear', might: null, tags: [] },
  // fallbacks only: the official Recruit / Bird / Sprite / Gold cards are used when present
  { id: 'tok-recruit', name: 'Recruit', might: 1, tags: [] },
  { id: 'tok-bird', name: 'Bird', might: 1, tags: ['Bird'], text: '[Deflect]' },
  { id: 'tok-sprite', name: 'Sprite', might: 3, tags: [], text: '[Temporary]' },
  { id: 'tok-gold', name: 'Gold', type: 'Gear', might: null, tags: [], text: 'Kill this, :rb_exhaust:: [Reaction] — [Add] :rb_rune_rainbow:.' },
].map(c => ({ type: 'Unit', supertype: 'Token', domain: [], energy: null, power: null, text: '', img: '', rarity: 'Token', set: 'TOK', code: c.id, alt: false, landscape: false, ...c }));

module.exports = { CARD_FX, parseCost, kwCost, cardCost, sumCost, planCost, tokensIn, deathTokens, SYNTH_TOKENS, kw, spellFx, planPay, combat, domOf, playFx, entersReady };
