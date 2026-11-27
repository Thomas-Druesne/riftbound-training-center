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
  const u = t.replace(/\[(?:Empowered|Level \d+)\]\s*\[(?:>|&gt;)\][^.]*\.?/g, ''); // unconditional part
  const n = re => { const m = re.exec(u); return m ? (m[1] ? +m[1] : 1) : 0; };
  const k = {
    assault: n(/\[Assault(?: (\d+))?\]/), shield: n(/\[Shield(?: (\d+))?\]/),
    tank: /\[Tank\]/.test(u), ganking: /\[Ganking\]/.test(u), deploy: /^\s*\[Deploy\]/.test(t), accelerate: /\[Accelerate\]/.test(t),
    onPlayDraw: n(/When you play me, draw (\d+)/i),
    // Ambush / "can be played to a battlefield": may enter directly where you already have units
    ambush: /\[Ambush\]|can be played to a battlefield/i.test(t),
    // Rengar, Trophy Hunter: "I can be played to a battlefield where there are enemy units"
    toEnemyBf: /can be played to a battlefield where there are enemy units/i.test(t),
    temporary: /\[Temporary\]/.test(t) && !/Give (?:a|it|that)[^.]*\[Temporary\]/i.test(t),
    hunt: n(/\[Hunt(?: (\d+))?\]/),
    deathDraw: n(/\[Deathknell\]\s*\[(?:>|&gt;)\]\s*Draw (\d+)\./),
    backline: /\[Backline\]/.test(u), disarm: n(/\[Disarm(?: (\d+))?\]/), deflect: n(/\[Deflect(?: (\d+))?\]/),
    weaponmaster: /\[Weaponmaster\]/.test(t),
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
  'Back to Back': [T('might', { n: 2, side: 'friendly', distinct: true }), T('might', { n: 2, side: 'friendly', distinct: true })],
  'Bellows Breath': [1, 2, 3].map(() => T('dmg', { n: 1, opt: true, distinct: true, sameLoc: true })),
  'Block': [T('shield', { n: 3, tank: true })],
  'Blood Rush': [T('assault', { n: 2 })],
  'Bonds of Strength': [T('might', { n: 1, side: 'friendly', distinct: true }), T('might', { n: 1, side: 'friendly', distinct: true })],
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
  'Death from Below': [T('kill', { where: 'bf' }), { who: 'self', kind: 'dfbMark' }],
  'Decree of Rage': [T('dmg', { n: 4, side: 'enemy', dom: 'Calm' })],
  'Decree of Unity': [T('kill', { side: 'enemy', dom: 'Chaos' })],
  'Decree of Insight': [T('might', { n: -5, side: 'enemy', dom: 'Body' })],
  'Defy': [{ kind: 'counter', maxE: 4, maxP: 1 }],
  'Hush': [{ kind: 'counter', minP: 2 }],
  'Not So Fast': [{ kind: 'counter', mine: true }],
  'Riposte': [{ kind: 'counter', store: true }, T('might', { side: 'friendly', n: 'stored' })],
  'En Garde': [T('might', { n: 1, side: 'friendly', alone: 1 })],
  'Existential Dread': [T('stun', { side: 'enemy', where: 'attacking' })],
  'Thwonk!': [T('stun', { where: 'attacking' })],
  'Fight or Flight': [T('recall', { where: 'bf' })],
  'Flash': [T('recall', { side: 'friendly', where: 'bf', opt: true, distinct: true }), T('recall', { side: 'friendly', where: 'bf', opt: true, distinct: true })],
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
  'Piercing Light': [T('dmg', { n: 2, where: 'bf', distinct: true }), T('dmg', { n: 2, opt: true, distinct: true })],
  'Portal Rescue': [T('blink', { side: 'friendly', to: 'base' })],
  'Thrill of the Hunt': [T('blink', { side: 'friendly', to: 'any' })],
  'Temporal Breach': [T('blink', { to: 'same' })],
  'Ride the Wind': [T('moveTo', { side: 'friendly', ready: true })],
  'Right of Conquest': [{ kind: 'draw', n: 1, per: 'bfCtrl' }],
  'Scorched Earth': [T('dmg', { n: 5, where: 'bf' })],
  'Show of Strength': [{ kind: 'draw', n: 0, per: 'mighty' }],
  'Singularity': [T('dmg', { n: 6, opt: true, distinct: true }), T('dmg', { n: 6, opt: true, distinct: true })],
  'Star-Crossed': [T('hand', { side: 'friendly' }), T('hand', { side: 'enemy' })],
  'Thermo Beam': [{ kind: 'killGearAll' }],
  'Twilight Step': [T('recall', { where: 'bf', max: 3 })],
  'Unchecked Power': [{ kind: 'exhaustAll' }, { kind: 'aoeAll', n: 12, scope: 'bf', side: 'all' }],
  'Vault Breaker': [T('assault', { n: 2 })],
  'Wind and Ghosts': [T('hand', { where: 'bf', banishMax: 3 })],
  'Invert Timelines': [{ kind: 'wheel', n: 4 }],
  'Shuriken Flip': [T('dmg', { n: 2, side: 'enemy', where: 'bf', opt: true }), T('moveTo', { side: 'friendly' })],
  'Skyward Strike': [T('recall', { side: 'enemy', where: 'bf' })],
  'Ntofo Strikes': [T('shield', { n: 2, side: 'friendly', setMark: true }), T('dmg', { n: 'markShield', side: 'enemy' })],
  'Stacked Deck': [{ kind: 'draw', n: 1 }],
  'Called Shot': [{ kind: 'draw', n: 1 }],
  'Lightning Rush': [{ kind: 'pick', from: 'top', n: 3, then: 'hand', restTo: 'trash', any: true }],
  'Against the Odds': [T('might', { n: 2, side: 'friendly', where: 'bf', perEnemy: true })],
};
Object.assign(CARD_FX, {
  'Solari Chief': [T('stunOrKill', { side: 'enemy' })],
  // swap / move / pick from trash or the top of the deck (see game.js runFx 'pick')
  'Switcheroo': [T('mark', { where: 'bf' }), T('swap', { where: 'bf', sameLoc: true, distinct: true })],
  'Tideturner': [T('swapPlaces', { side: 'friendly', notSelf: true, opt: true })],
  'Decree of Focus': [T('might', { n: 4, side: 'friendly' })],
  'Fizz, Trickster': [{ who: 'self', kind: 'pick', from: 'trash', filter: { types: ['Spell'], maxE: 3 }, then: 'playFree', recycle: true, payPower: true }],
  'Bedeviling Stranger': [T('hand', { side: 'enemy', where: 'bf', crowd: 4, opt: true })],
  'Gem Jammer': [T('kwTurn', { kw: 'ganking' })],
  'Patched Porobot': [{ who: 'self', kind: 'draw', n: 1, cond: 'gear3' }],
  'Edge of Night': [T('attach', { side: 'friendly', where: 'here', ifHidden: true })],
  'Repulse': [{ who: 'self', kind: 'counter', mine: true }],
  'Time Warp': [{ who: 'self', kind: 'extraTurn' }],
  'Tomb-Raider Barbara': [T('kill', { gear: true, side: 'enemy', cond: 'runes7' })],
  'Elder Dragon': [1, 2, 3].map(() => T('dmg', { n: 1, side: 'enemy', opt: true, distinct: true, diffLoc: true })),
  'Trifarian Captain': [{ who: 'self', kind: 'pick', from: 'top', n: 4, filter: { types: ['Unit', 'Gear'], maxE: 3, maxP: 1 }, then: 'hand' }],
  'Unyielding Spirit': [{ who: 'self', kind: 'noSpellDmg' }],
  'Kinkou Initiate': [{ who: 'self', kind: 'draw', n: 1, cond: 'otherMight5' }],
  'Acceptable Losses': [{ who: 'self', kind: 'sacGear' }],
  'Kennen, Keeper of Balance': [{ who: 'self', kind: 'may', text: 'Payer 2 énergie pour étourdir une unité ?', pay: { e: 2, p: [] }, fx: [T('stun', {})] }],
  'Turn to Dust': [T('tempo', { gear: true })],
  'Vanguard Captain': [{ who: 'self', kind: 'token', name: 'Recruit', n: 2, here: true, cond: 'legion' }],
  'Scrapyard Champion': [{ who: 'self', kind: 'discard', n: 2, cond: 'legion' }, { who: 'self', kind: 'draw', n: 2, cond: 'legion' }],
  'Hard Bargain': [{ who: 'self', kind: 'counterUnless', e: 2 }],
  'Mischievous Marai': [T('dmg', { n: 2, side: 'enemy', where: 'here', atBf: true })],
  "Emperor's Divide": [{ who: 'self', kind: 'bfRecall' }],
  'Evelynn, Entrancing': [T('moveTo', { side: 'enemy', to: 'here', opt: true, notHere: true, ifHidden: true })],
  'Sprite Queen': [{ who: 'self', kind: 'token', name: 'Sprite', n: 1, ready: true }],
  'Annie, Stubborn': [{ who: 'self', kind: 'pick', from: 'trash', filter: { types: ['Spell'] }, then: 'hand' }],
  'Arise!': [{ who: 'self', kind: 'arise' }],
  'Buhru Captain': [{ who: 'self', kind: 'may', text: 'Piocher 1 carte ? (Non : buffer cette unité)', fx: [{ who: 'self', kind: 'draw', n: 1 }], elseFx: [{ who: 'self', kind: 'buff', me: true }] }],
  'Herald of the Emperor': [T('setMight', { n: 5, side: 'friendly' })],
  'Dragon Form': [T('setMight', { n: 5 })],
  'Momentary Companion': [{ who: 'self', kind: 'selfTemp', cond: 'notMyTurn' }],
  'Mordekaiser, Dominating': [{ who: 'self', kind: 'may', text: 'Défausser 1 carte pour détruire une unité ?', cond: 'hand', fx: [{ who: 'self', kind: 'discard', n: 1 }, T('kill', {})] }],
  'Poro Herder': [{ who: 'self', kind: 'buff', me: true, cond: 'poro' }, { who: 'self', kind: 'draw', n: 1, cond: 'poro' }],
  'Rebuttal': [{ who: 'self', kind: 'counter', maxE: 4 }],
  'Relentless Pursuit': [T('moveTo', { side: 'friendly' })],
  'Safety Inspector': [{ who: 'self', kind: 'sacrifice' }, { who: 'opp', kind: 'sacrifice' }],
  'Shadow Dash': [T('moveTo', { side: 'enemy', toMine: true, dash: true })],
  'Void Assault': [T('moveTo', { side: 'friendly' }), T('moveTo', { side: 'enemy' })],
  'Aspiring Engineer': [{ who: 'self', kind: 'pick', from: 'trash', filter: { types: ['Gear'] }, then: 'hand' }],
  'Card Sharp': [{ who: 'self', kind: 'token', name: 'Gold', n: 1, ex: true }],
  'Factory Recall': [T('hand', { gear: true })],
  'Ivern, Nurturer': [{ who: 'self', kind: 'pick', from: 'top', n: 3, filter: { types: ['Unit'] }, then: 'hand' }],
  'Janna, Savior': [T('recall', { side: 'enemy', where: 'here', atBf: true })],
  'Poppy, Paragon': [T('ready', { self: true, cond: 'oppNear' }), { who: 'self', kind: 'xp', n: 3, cond: 'oppNear' }],
  'Tibbers, Annie': [{ who: 'self', kind: 'aoeAll', n: 3, scope: 'bf' }],
  'Cataclysm': [T('moveTo', { side: 'friendly' })],
  'Cemetery Attendant': [{ who: 'self', kind: 'pick', from: 'trash', filter: { types: ['Unit'] }, then: 'hand' }],
  'Downwell': [{ who: 'self', kind: 'massBounce', max: 99 }],
  'Kennen, Storm of Shuriken': [{ who: 'self', kind: 'burn', n: 2 }],
  'Lacerate': [T('kill', { max: 3 })],
  'Ornn, Blacksmith': [{ who: 'self', kind: 'pick', from: 'top', n: 4, filter: { types: ['Gear'] }, then: 'hand' }],
  'Remember the Fallen': [1, 2, 3].map(() => ({ who: 'self', kind: 'pick', from: 'trash', filter: { types: ['Unit', 'Gear'], maxE: 3, maxP: 1 }, then: 'playFree' })),
  'Spectral Matron': [{ who: 'self', kind: 'pick', from: 'trash', filter: { types: ['Unit'], maxE: 3, maxP: 1 }, then: 'playFree' }],
  'The Harrowing': [{ who: 'self', kind: 'pick', from: 'trash', filter: { types: ['Unit'] }, then: 'playFree' }],
  'Undying Loyalty': [{ who: 'self', kind: 'pick', from: 'trash', filter: { types: ['Unit'], maxE: 2, maxP: 1 }, then: 'playFree' }],
  'Temptation': [T('moveTo', { side: 'enemy' })],
  'Shakedown': [T('dmg', { n: 6, side: 'enemy' })],
  // "You may pay ... as an additional cost to play me. When you play me, if you paid the additional cost, ..."
  'Pyke, Dockside Butcher': [T('ready', { self: true, cond: 'paidExtra' }), T('might', { n: 2, self: true, cond: 'paidExtra' })],
  'Blast Corps Cadet': [T('dmg', { n: 2, where: 'bf', cond: 'paidExtra' })],
  'Sea Monkey': [{ who: 'self', kind: 'buff', me: true, cond: 'paidExtra' }],
  'Gust Monk': [T('assault', { n: 2, cond: 'paidExtra' })],
  'Akshan, Mischievous': [T('steal', { gear: true, side: 'enemy', cond: 'paidExtra' })],
  'Imperial Decree': [{ who: 'self', kind: 'decree' }],
  'Tactical Retreat': [T('retreat', { side: 'friendly' })],
  'Alpha Strike': [T('alpha', { side: 'friendly' })],
  'Fox-Fire, Ahri': [{ who: 'self', kind: 'foxfire' }],
  'Stormbringer, Volibear': [T('storm', { side: 'friendly', where: 'base' })],
  'Hostile Takeover': [T('takeover', { side: 'enemy', where: 'bf' })],
  'Mirror Image': [T('mirror', {})],
  'Keeper of Masks': [{ who: 'self', kind: 'copiesOfMe', n: 2 }],
  "Dragon's Rage, Lee Sin": [T('moveTo', { side: 'enemy', markMoved: true }), T('duel', { side: 'enemy', atMark: true })],
  'Friendship': [T('might', { n: 1, perTags: ['Bird', 'Cat', 'Dog', 'Poro'] })],
  'Bullet Time, Miss Fortune': [{ who: 'self', kind: 'bulletTime' }],
  // reveal the top 2, play one of them for 2 Energy less, draw the other(s)
  'Void Rush': [{ who: 'self', kind: 'pick', from: 'top', n: 2, then: 'playDisc', disc: 2, restTo: 'hand' }],
  'Acceleration Gate': [{ who: 'self', kind: 'readyAny', n: 4 }],
  // ---- cards the card-by-card sweep found unread ----
  'Profiteer': [{ who: 'self', kind: 'profiteer' }],
  'Albus Ferros': [{ who: 'self', kind: 'albus' }],
  'Amateur Demolitionist': [{ who: 'self', kind: 'token', name: 'Bomb', n: 1 }],
  'Ziggs, Short-Fused': [{ who: 'self', kind: 'token', name: 'Bomb', n: 1 }],
  'Satchel Charge': [T('moveTo', { side: 'friendly' }), { who: 'self', kind: 'token', name: 'Bomb', n: 1 }],
  'Bard, Mercurial': [{ who: 'self', kind: 'may', text: 'Épuiser votre légende pour déplacer vos unités vers un champ de bataille libre ?', cond: 'legendReady', fx: [{ who: 'self', kind: 'bardMove' }] }],
  'Blast Cone': [T('moveTo', { side: 'enemy', opt: true })],
  'Blind Fury': [{ who: 'self', kind: 'blindFury' }],
  'Drakehound Packmaster': [{ who: 'self', kind: 'blindFury' }],
  'Brynhir Thundersong': [{ who: 'self', kind: 'muzzle' }],
  'Call to Battle': [T('moveTo', { side: 'friendly', toCtrl: true, markMoved: true }), { who: 'self', kind: 'callToBattle' }],
  'Cataclysmic Duel': [{ who: 'self', kind: 'cataclysm' }],
  'Clocktower Guardian': [{ who: 'self', kind: 'predict', n: 3 }],
  'Conscription': [{ who: 'self', kind: 'may', text: 'Dépenser 5 XP pour choisir n’importe quelle unité ennemie ?', cond: 'xp5', ai: true, fx: [{ who: 'self', kind: 'xp', n: -5 }, T('conscript', { side: 'enemy', where: 'bf' })], elseFx: [T('conscript', { side: 'enemy', where: 'bf', max: 3 })] }],
  'Convergent Mutation': [T('mark', { side: 'friendly' }), T('copyMight', { side: 'friendly' })],
  'Crumbling Sands': [{ who: 'self', kind: 'counter', cond: 'oppSpell2' }],
  'Cursed Sarcophagus': [{ who: 'self', kind: 'sarcoBanish' }],
  'Decree of Discord': [{ who: 'self', kind: 'decree5' }],
  'Demon Shade': [T('demonShade', { side: 'friendly' })],
  'Divine Judgment': [{ who: 'self', kind: 'judgment' }],
  'Double Trouble': [{ who: 'self', kind: 'pick', from: 'top', n: 3, filter: { types: ['Unit'] }, then: 'hand' }],
  'Dropboarder': [T('ready', { self: true, cond: 'gear2' })],
  'Endless Riches': [{ who: 'self', kind: 'riches' }],
  'Fading Memories': [T('tempo', { where: 'bf' })],
  'Fae Dragon': [{ who: 'self', kind: 'buffN', n: 4 }],
  'Fate Weaver': [{ who: 'self', kind: 'pick', from: 'top', n: 4, filter: { types: ['Spell'], minE: 4 }, then: 'hand' }],
  'Firebrand Raider': [{ who: 'opp', kind: 'readyAll' }],
  'Frostcoat Cub': [T('might', { n: -2, cond: 'paidExtra' })],
  'Gentle Gemdragon': [{ who: 'self', kind: 'readyRunes', n: 2 }],
  'Heedless Resurrection': [T('kill', { side: 'friendly' }), { who: 'self', kind: 'pick', from: 'trash', filter: { types: ['Unit'], leKilled: true }, then: 'playFree', payPower: false }],
  'Here to Help': [{ who: 'self', kind: 'pick', from: 'hand', filter: { types: ['Unit'] }, then: 'playDisc', disc: 3, toCtrlBf: true }],
  'High Note': [T('might', { n: 'negExhausted' })],
  'Illaoi, Prophet of the Great Kraken': [{ who: 'self', kind: 'token', name: 'Tentacle', n: 1 }],
  'Jayce, Man of Progress': [{ who: 'self', kind: 'may', text: 'Détruire un de vos équipements pour jouer un équipement de votre main sans payer son énergie ?', cond: 'anyGearMine', ai: false, fx: [T('kill', { side: 'friendly', gear: true }), { who: 'self', kind: 'pick', from: 'hand', filter: { types: ['Gear'], maxE: 7 }, then: 'playFree', payPower: true }] }],
  'Kadregrin the Infernal': [{ who: 'self', kind: 'draw', n: 0, per: 'mighty' }],
  'Ki Barrier': [T('prevent', { amount: 7 })],
  "King's Edict": [{ who: 'self', kind: 'edict' }],
  'Kinkou Monk': [{ who: 'self', kind: 'buffN', n: 2, other: true }],
  'Lord Broadmane': [{ who: 'self', kind: 'allKw', kw: 'assault', n: 1, notSelf: true }],
  'Lotus Trap': [T('dblDmg')],
  'Masa, Crashing Thunder': [T('stun', { side: 'enemy', where: 'bf', cond: 'paidExtra' })],
  'Nami, Headstrong': [T('stun', { side: 'enemy', cond: 'paidExtra' })],
  'Morbid Return': [{ who: 'self', kind: 'pick', from: 'trash', filter: { types: ['Unit'] }, then: 'hand' }],
  'Morgana, Vindictive': [T('dmg', { n: 'marked' })],
  'Mysterious Chronomancer': [{ who: 'self', kind: 'predict', n: 2 }],
  'Mystic Reversal': [{ who: 'self', kind: 'takeSpell' }],
  'Ocean Drake': [T('hand', { opt: true, notTag: 'Dragon', notSelf: true })],
  'Overt Operation': [{ who: 'self', kind: 'overt' }],
  'Party Favors': [{ who: 'self', kind: 'party' }],
  'Possession': [T('conscript', { side: 'enemy', where: 'bf' })],
  'Promising Future': [{ who: 'self', kind: 'promise' }],
  'Reinforce': [{ who: 'self', kind: 'pick', from: 'top', n: 5, filter: { types: ['Unit'] }, then: 'playDisc', disc: 5 }],
  'Wild Claw': [{ who: 'self', kind: 'pick', from: 'top', n: 5, filter: { types: ['Unit', 'Gear'] }, then: 'playDisc', disc: 5, thenEmp: true }],
  'Resonating Strike': [T('moveTo', { side: 'friendly', toCtrl: true, plusMight: 2 })],
  'Royal Entourage': [{ who: 'self', kind: 'entourage' }],
  'Runeblade Anvil': [{ who: 'self', kind: 'anvil' }],
  'Scrutinizing Sergeant': [{ who: 'self', kind: 'xp', n: 0, per: 'units' }],
  'Seraphine, Not Alone': [{ who: 'self', kind: 'token', name: 'Recruit', n: 1 }],
  'Shadows of the Past': [1, 2].map(() => ({ who: 'self', kind: 'pick', from: 'trash', filter: { types: ['Unit'] }, then: 'hand' })),
  'Shimmering Swimmer': [{ who: 'self', kind: 'may', text: 'Détruire une de vos unités ou équipements pour infliger 2 à une unité ?', cond: 'unitsAny', ai: false, fx: [T('kill', { side: 'friendly', notSelf: true }), T('dmg', { n: 2 })] }],
  "Siren's Song": [T('moveTo', { side: 'enemy', movedThisTurn: true })],
  'Soulgorger': [{ who: 'self', kind: 'pick', from: 'trash', filter: { types: ['Unit'] }, then: 'playFree', payPower: true }],
  'Spirit of the Forge': [{ who: 'self', kind: 'may', text: 'Renvoyer un de vos équipements en main (Spirit of the Forge se redresse et gagne sa valeur en force) ?', cond: 'anyGearMine', fx: [{ who: 'self', kind: 'forge' }] }],
  'Starhound': [{ who: 'self', kind: 'pick', from: 'trash', filter: { types: ['Unit'], tags: ['Bird', 'Cat', 'Dog', 'Poro'] }, then: 'hand' }],
  'Stoic Ferryman': [T('moveTo', { side: 'friendly', where: 'here', notSelf: true, to: 'base', opt: true })],
  'Strike Down': [T('mark', { side: 'friendly', equipped: true }), T('strike', { side: 'enemy', detach: true })],
  'Suave Negotiator': [{ who: 'self', kind: 'draw', n: 1 }, { who: 'opp', kind: 'draw', n: 1 }],
  'Tricksy Tentacles': [{ who: 'self', kind: 'tentacles' }],
  'Whirlwind': [{ who: 'self', kind: 'whirlwind' }],
  'Wildclaw Shaman': [{ who: 'self', kind: 'may', text: 'Dépenser un buff pour buffer et redresser Wildclaw Shaman ?', cond: 'buffed', fx: [{ who: 'self', kind: 'spendBuff' }, { who: 'self', kind: 'buff', me: true }, T('ready', { self: true })] }],
  'Windsinger': [T('hand', { where: 'bf', max: 3, notSelf: true, opt: true })],
  'Zaun Punk': [{ who: 'self', kind: 'may', text: 'Détruire un de vos équipements pour détruire un équipement ?', cond: 'anyGearMine', ai: false, fx: [T('kill', { side: 'friendly', gear: true }), T('kill', { gear: true })] }],
  'Zed, From the Shadows': [{ who: 'self', kind: 'may', text: 'Défausser 1 carte pour un jeton Shadow Clone ?', cond: 'hand', fx: [{ who: 'self', kind: 'discard', n: 1 }, { who: 'self', kind: 'token', name: 'Shadow Clone', n: 1 }] }],
  'Shadow@0': [T('stun', { side: 'enemy', where: 'attacking', atBf: true })], // "[Stun] an enemy unit attacking here"
  'Arcane Shift': [T('blink', { side: 'friendly', to: 'same' }), T('dmg', { n: 3, side: 'enemy', where: 'bf' })],
  'Chronobreak': [1, 2, 3, 4, 5, 6].map(() => T('blink', { side: 'friendly', to: 'same', opt: true, distinct: true, pay1: true })),
  'Counter Strike': [T('prevent'), { who: 'self', kind: 'draw', n: 1 }],
  'Curtain Call': [{ who: 'self', kind: 'mode', n: 1, unique: true, opts: [
    { label: 'Piocher 1', fx: [{ who: 'self', kind: 'draw', n: 1 }] },
    { label: 'Infliger 2 à une unité sur un champ de bataille', fx: [T('dmg', { n: 2, where: 'bf' })] },
    { label: 'Infliger 3 à une unité dans une base', fx: [T('dmg', { n: 3, where: 'base' })] },
    { label: 'Donner −4 force ce tour à une unité sur un champ de bataille', fx: [T('might', { n: -4, where: 'bf' })] }] }],
  'Danger Zone': [{ who: 'self', kind: 'allMight', n: 1, tag: 'Mech' }],
  'Death Mark': [{ who: 'self', kind: 'burn', n: 3 }, { who: 'self', kind: 'token', name: 'Shadow Clone', n: 1 }],
  'Defiant Dance': [T('might', { n: 2 }), T('might', { n: -2, distinct: true })],
  'Encore': [{ who: 'self', kind: 'mode', n: 2, opts: [
    { label: 'Infliger 2 à une unité', fx: [T('dmg', { n: 2 })] },
    { label: 'Jouer deux jetons Recruit 1 force', fx: [{ who: 'self', kind: 'token', name: 'Recruit', n: 2 }] },
    { label: "Jusqu'à deux unités +1 force ce tour", fx: [T('might', { n: 1, opt: true }), T('might', { n: 1, opt: true, distinct: true })] },
    { label: 'Regarder les 2 cartes du dessus, en piocher 1', fx: [{ who: 'self', kind: 'pick', from: 'top', n: 2, then: 'hand', any: true }] }] }],
  'Hexplosive Minefield': [{ who: 'self', kind: 'minefield' }],
  'Highlander, Yi': [T('retreat', { side: 'friendly' })],
  'Last Breath, Yasuo': [T('mark', { side: 'friendly' }), T('strike', { side: 'enemy', where: 'bf', readyMark: true })],
  'Last Caress': [{ who: 'self', kind: 'lastCaress' }],
  'Lilting Lullaby': [{ who: 'self', kind: 'counter', silence: true }],
  'Noxian Guillotine, Darius': [T('doom', { cond: 'notLegion' }), T('kill', { cond: 'legion' })],
  'Public Execution': [T('mark', { side: 'friendly' }), T('kill', { side: 'enemy', lessThanMark: true })],
  'Realm of Death': [T('mark', { side: 'friendly' }), T('duel', { side: 'enemy', markMight: 2, preMight: -2 })],
  'Showstopper, Sett': [T('moveTo', { side: 'friendly', where: 'base', buffFirst: true })],
  'Siphoning Strike': [T('dmg', { n: 4, where: 'bf', n7: 7, deathChannel: true })],
  'Zenith Blade, Leona': [T('stun', { side: 'enemy', where: 'bf', setMark: true }), T('moveTo', { side: 'friendly', to: 'atMark', opt: true })],
  "Shurelya's Requiem": [{ who: 'self', kind: 'readyAll' }],
  'Guerilla Warfare, Teemo': [1, 2].map(() => ({ who: 'self', kind: 'pick', from: 'trash', filter: { hidden: true }, then: 'hand' })).concat([{ who: 'self', kind: 'freeHide' }]),
  'Sanction': [T('empTurn', {})],
  'Tornado Warrior': [T('empTurn', { where: 'here', ifHidden: true, opt: true })],
  'Raging Firebrand': [{ who: 'self', kind: 'spellDisc', n: 5 }],
  'Wuju Apprentice': [{ who: 'self', kind: 'draw', n: 1, cond: 'xp6' }],
  'Gutter Guardian': [{ who: 'self', kind: 'add', cost: { e: 0, p: [null] }, cond: 'showedOff' }],
  'The Empyrean': [{ who: 'self', kind: 'predict', n: 'showPower', cond: 'showedOff' }, { who: 'self', kind: 'draw', n: 2, cond: 'showedOff' }],
  'Battle Preparations': [T('might', { n: 2 }), { who: 'self', kind: 'readyRunes', n: 2, cond: 'showedOff' }],
  'Rousing Display': [{ who: 'self', kind: 'token', name: 'Recruit', n: 2, cond: 'notShowedOff' }, { who: 'self', kind: 'token', name: 'Recruit', n: 4, cond: 'showedOff' }],
  'Primordial Roar': [T('dmg', { n: 'showMight', cond: 'showedOff' })],
  'Incorrigible Construct': [T('ready', { self: true, cond: 'showedOff' })],
  'Forgotten Relic': [{ who: 'self', kind: 'burn', n: 1 }],
  'Jayce, Brilliant Inventor': [T('ready', { notSelf: true, opt: true })],
  'Elnuk Herd': [T('might', { n: 3, side: 'friendly', notSelf: true }), { who: 'self', kind: 'recycleSelf', ifHidden: true }],
  'Blitzcrank, Impassive': [T('moveTo', { side: 'enemy', to: 'here', opt: true, notHere: true })],
  'Walking Roost': [{ kind: 'token', who: 'opp', name: 'Bird', n: 1 }],
  'Chakram Dancer': [{ kind: 'allKw', kw: 'shield', n: 1, here: true, notSelf: true }],
  'Iridescent Avian': [], // its ability is in the table of abilities below
});
function playFx(card, ctx = {}) {
  if (CARD_FX[card.name]) return CARD_FX[card.name].map((e, i) => ({ who: 'self', ...e, at: i }));
  const text = card.text || '';
  const lv = /\[Level (\d+)\]/i.exec(text);
  const key = card.type + '|' + text + '|' + (ctx.legion ? 1 : 0) + '|' + (lv && (ctx.xp || 0) >= +lv[1] ? 1 : 0);
  if (fxCache.has(key)) return fxCache.get(key);
  // keyword headers with costs ("[Repeat] :rb_energy_1:", "[Flow] ...") are not effects
  const raw = text.replace(/\([^)]*\)/g, '').replace(/\[(Repeat|Flow|Equip|Empower|Deflect|Hidden|Action|Reaction|Accelerate|Ambush|Quick-Draw|Weaponmaster|Deploy|Ganking|Tank|Backline)\](\s*—)?\s*(:rb_(energy_\d+|rune_\w+):)*/gi, ' ');
  const risky = /\bif\b|\bmay\b|choose (one|two|three)|additional cost|for each|instead|unless|\bor\b(?! less)|\bto (give|deal|draw|play|ready|move|channel|buff|stun|kill|return|gain)\b/i; // "[do X] to [do Y]": a cost, left to the players
  let sentences = raw.split(/(?<=[.!])\s*/).reduce((a, x) => (/^(They|It|Then|We)\b/.test(x) && !/^Then,? if\b/i.test(x) && a.length ? (a[a.length - 1] += ' ' + x) : a.push(x), a), []);
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
    sentences = sentences.filter(x => /^\s*(\[[^\]]*\]\s*(—\s*)?)*When you play (me|this),/i.test(x)).map(x => x.replace(/^[^,]*,/, ''));
  }
  // "Choose a unit. Deal 3 to it." -> "Deal 3 to a unit."
  sentences = sentences.map(x => { const y = x.replace(/^(\s*(?:then,?\s*)?)you may /i, '$1OPTX '); return y !== x && !risky.test(y) ? y : x; });
  let t = sentences.filter(x => !risky.test(x)).join(' ')
    .replace(/\[(Buff|Stun|Predict|Burn|Recall|Ready|Add)\]/gi, (m, w) => w.toLowerCase())
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
  if ((m = /\bgive your other units( here)? ([+-]\d+) :rb_might: this turn/i.exec(t))) add(m.index, { kind: 'allMight', n: +m[2], who: 'self', notSelf: true, here: !!m[1] });
  if ((m = /\bgive enemy units( here)? ([+-−–]\d+) :rb_might: this turn(,? to a minimum of 1)?/i.exec(t))) add(m.index, { kind: 'allMight', n: -Math.abs(+m[2].replace(/[−–]/, '-')), who: 'self', enemy: true, here: !!m[1], min: m[3] ? 1 : null });
  // "deal 1 to each of up to 2 units", "deal 2 to up to two enemy units"
  if ((m = /\bdeal (\d+) to (?:each of )?up to (\w+) (enemy |friendly )?units?( at a battlefield| here| at the same location)?/i.exec(t))) {
    const k = NUM[m[2].toLowerCase()] || +m[2] || 1;
    for (let i = 0; i < k; i++) add(m.index + i / 10, { kind: 'target', who: 'self', op: 'dmg', n: +m[1], side: /enemy/i.test(m[3] || '') ? 'enemy' : /friendly/i.test(m[3] || '') ? 'friendly' : 'any', where: /battlefield/.test(m[4] || '') ? 'bf' : /here/.test(m[4] || '') ? 'here' : 'any', max: null, opt: true, distinct: true, sameLoc: /same location/.test(m[4] || '') });
  }
  if ((m = /\breturn all units with (\d+) :rb_might: or less to their owners'? hands/i.exec(t))) add(m.index, { kind: 'massBounce', max: +m[1], who: 'self' });
  if ((m = /\breturn another friendly unit and an enemy unit to their owners'? hands/i.exec(t))) {
    add(m.index, { kind: 'target', who: 'self', op: 'hand', n: 0, side: 'friendly', notSelf: true, where: 'any', max: null });
    add(m.index + 0.5, { kind: 'target', who: 'self', op: 'hand', n: 0, side: 'enemy', where: 'any', max: null });
  }
  // "choose an enemy unit (at a battlefield). We deal damage equal to our Mights to each other." (the unit itself duels)
  if ((m = /\bchoose an enemy unit( at a battlefield)?\.\s*We deal damage equal to our Mights to each other/i.exec(t))) add(m.index, { kind: 'target', who: 'self', op: 'duelSelf', n: 0, side: 'enemy', where: m[1] ? 'bf' : 'any', max: null });
  if ((m = /\bmove (?:a|an enemy) unit from a battlefield to its base/i.exec(t))) add(m.index, { kind: 'target', who: 'self', op: 'recall', n: 0, side: /enemy/.test(m[0]) ? 'enemy' : 'any', where: 'bf', max: null });
  if ((m = /\b[Rr]eady (?:another )?friendly ([A-Z][\w']+?)s?\b(?! unit)/.exec(t)) && !/^(unit|legend|gear|rune)/i.test(m[1])) add(m.index, { kind: 'target', who: 'self', op: 'ready', n: 0, side: 'friendly', notSelf: /another/.test(m[0]), tag: m[1], where: 'any', max: null });
  if ((m = /\bready a friendly legend\b/i.exec(t))) add(m.index, { kind: 'readyLegend', who: 'self' });
  if ((m = /\b(ready|buff) me\b/i.exec(t)) && m[1].toLowerCase() === 'ready') add(m.index, { kind: 'target', who: 'self', op: 'ready', n: 0, side: 'friendly', self: true, where: 'any', max: null });
  if ((m = /\bgive me ([+-]\d+) :rb_might: this turn/i.exec(t))) add(m.index, { kind: 'target', who: 'self', op: 'might', n: +m[1], side: 'friendly', self: true, where: 'any', max: null });
  if ((m = /\badd ((?::rb_(?:energy_\d+|rune_\w+):)+)/i.exec(t))) add(m.index, { kind: 'add', who: 'self', cost: parseCost(m[1]) });
  if ((m = /\bchannel (\d+) runes?( exhausted)?/i.exec(t))) add(m.index, { kind: 'channel', n: +m[1], ex: !!m[2], who: 'self' });
  if ((m = /\bgain (\d+) xp\b/i.exec(t))) add(m.index, { kind: 'xp', n: +m[1], who: 'self' });
  if ((m = /\bpredict(?: (\d+))?/i.exec(t))) add(m.index, { kind: 'predict', n: +(m[1] || 1), who: 'self' });
  if ((m = /\bburn (\d+)/i.exec(t))) add(m.index, { kind: 'burn', n: +m[1], who: 'self' });
  for (const e of fx) { const before = t.slice(0, Math.max(0, e.at)); if (before.lastIndexOf('OPTX') > before.lastIndexOf('.')) e.opt = true; }
  fx.sort((a, b) => a.at - b.at);
  fxCache.set(key, fx);
  return fx;
}
// Triggered abilities of a unit or gear: the effects of "When I attack, ...", "When I conquer, ...", "[Deathknell] — ..."
// (ev: attack | defend | conquer | hold | move | deathknell), read with the same parser as a spell.
const TRIGGER = {
  attack: /When I attack(?: or defend)?,\s*/i, defend: /When I (?:attack or )?defend,\s*/i, conquer: /When I conquer,\s*/i,
  hold: /When I hold,\s*/i, move: /When I move(?: to a battlefield)?,\s*/i,
  winCombat: /When I win a combat,\s*/i, playSpell: /When you play a spell,\s*/i, playUnit: /When you play a unit,\s*/i, allyDies: /When (?:another|a) friendly unit dies,\s*/i, deathknell: /\[Deathknell\]\s*(?:—|\[(?:>|&gt;)\])?\s*/i,
};
const TRIG_FX = {
  'Lucian, Merciless': { conquer: [T('ready', { self: true })] },
  'Clocktower Guardian': { hold: [{ who: 'self', kind: 'predict', n: 3 }], deathknell: [{ who: 'self', kind: 'pick', from: 'top', n: 1, then: 'playFree', payPower: true, restTo: 'banish' }] },
  'Dramatic Visionary': { deathknell: [{ who: 'self', kind: 'predict', n: 2 }] },
  'Ekko, Recurrent': { deathknell: [{ who: 'self', kind: 'recycleDead' }, { who: 'self', kind: 'readyRunes', n: 99 }] },
  'Glasc Mixologist': { deathknell: [{ who: 'self', kind: 'pick', from: 'trash', filter: { types: ['Unit'], maxE: 3, maxP: 1 }, then: 'playFree' }] },
  "Kog'Maw, Caustic": { deathknell: [{ who: 'self', kind: 'aoeHere', n: 4 }] },
  'Lonely Poro': { deathknell: [{ who: 'self', kind: 'draw', n: 1, cond: 'diedAlone' }] },
  'Loyal Poro': { deathknell: [{ who: 'self', kind: 'draw', n: 1, cond: 'notAlone' }] },
  'Mournful Spirit': { deathknell: [T('kill', { where: 'here', opt: true }), T('kill', { where: 'here', gear: true, opt: true })] },
  'Rift Herald': { move: [{ who: 'self', kind: 'pick', from: 'top', n: 3, filter: { types: ['Unit'] }, then: 'hand' }], deathknell: [{ who: 'self', kind: 'pick', from: 'hand', filter: { types: ['Unit'] }, then: 'playFree', payPower: true }] },
  'Sprite Fountain': { deathknell: [{ who: 'self', kind: 'token', name: 'Sprite', n: 1, ready: true }] },
  'The Zero Drive': { deathknell: [{ who: 'self', kind: 'banishDead' }] },
  'Unsung Hero': { deathknell: [{ who: 'self', kind: 'draw', n: 2, cond: 'wasMighty' }] },
  // Bomb gear token ([Deploy]): when it dies, deal 2 to an enemy there and kill your other Bombs there
  'Forgefire Cape': { attack: [{ who: 'self', kind: 'aoeEnemyHere', n: 2 }], defend: [{ who: 'self', kind: 'aoeEnemyHere', n: 2 }] },
  'Hextech Gauntlets': { conquer: [{ who: 'self', kind: 'draw', n: 1, cond: 'excess3' }] },
  'Daisy!': { attack: [T('stun', { side: 'enemy', where: 'here', cond: 'fourTags' })] },
  'Bomb': { deathknell: [T('dmg', { n: 2, side: 'enemy', where: 'here' }), { who: 'self', kind: 'killBombsHere' }] },
  'Irresistible Faefolk': { move: [T('moveTo', { side: 'enemy', to: 'here', opt: true, notHere: true })] },
};
function triggerFx(card, ev) {
  const hand = TRIG_FX[card.name]; if (hand) return (hand[ev] || []).map(e => ({ ...e }));
  const t = (card.text || '').replace(/\([^)]*\)/g, ''), m = TRIGGER[ev] && TRIGGER[ev].exec(t);
  if (!m) return [];
  const rest = t.slice(m.index + m[0].length).split(/(?<=[.!])\s+/);
  let body = rest[0];
  for (const x of rest.slice(1)) { if (/^(Then|It|They)\b/.test(x) && !/^Then,? if\b/i.test(x)) body += ' ' + x; else break; }
  return playFx({ type: 'Spell', name: card.name + '#' + ev, text: body });
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
  // a rune recycled for power can first be exhausted for energy (exhaust, then recycle)
  const left = runes.filter(r => !r.ex);
  if (left.length < needE) return null;
  // runes being recycled anyway first, then the most common domain (keep the rare ones for later power)
  const cnt = {}; for (const r of left) cnt[r.dom] = (cnt[r.dom] || 0) + 1;
  left.sort((a, b) => rc.includes(b.iid) - rc.includes(a.iid) || cnt[b.dom] - cnt[a.dom]);
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

// Activated abilities "<cost>, :rb_exhaust:: <effect>" (units, gear, legends). Costs other than Energy / Power /
// exhausting / killing this / spending XP are left to the player (the AI doesn't use those).
const abilCache = new Map();
function abilities(card) {
  const text = card.text || '';
  if (abilCache.has(text)) return abilCache.get(text);
  const out = [];
  const t = text.replace(/\([^)]*\)/g, '').replace(/\s+/g, ' ');
  const re = /((?:\[[^\]]*\](?:\[(?:>|&gt;)\])?\s*(?:—\s*)?)*)((?:[^.:\]]|:rb_\w+:)*?:rb_exhaust:)\s*:\s*((?:\[(?:Reaction|Action)\][^—]*—\s*)?)([^.]*\.(?:\s*(?:Then|It)\b[^.]*\.)*)/g;
  let m;
  while ((m = re.exec(t))) {
    const head = m[1] + m[3], costTxt = m[2], effect = m[4].trim();
    if (/\[Empowered\]/.test(m[1])) continue; // only while empowered: left to the player
    const lv = /\[Level (\d+)\]/.exec(m[1]);
    const cost = parseCost(costTxt);
    const fx = playFx({ type: 'Spell', name: (card.name || '') + '@' + out.length, text: effect });
    out.push({
      i: out.length, text: effect, cost, fx,
      kill: /Kill this/i.test(costTxt), xp: +((/Spend (\d+) XP/i.exec(costTxt) || [])[1] || 0),
      other: /Recycle|Discard|Exhaust (?:a|an|another)|Banish|Disempower|Return/i.test(costTxt),
      reaction: /\[Reaction\]/.test(head), action: /\[Action\]/.test(head), level: lv ? +lv[1] : 0,
    });
  }
  const ov = LEGEND_AB[card.name], fl = AB_FLAGS[card.name];
  const res = ov ? ov.map((o, i) => ({ i, kill: false, xp: 0, other: false, reaction: false, action: false, level: 0, ...o }))
    : fl ? out.map((a, i) => ({ ...a, ...(fl[i] || {}) })) : out;
  for (const a of res) if (ov) CARD_FX[card.name + '@' + a.i] = a.fx; // the AI plans abilities through playFx(name@i)
  abilCache.set(text, res);
  return res;
}
// Static Might bonuses: "Your units have +1 :rb_might:", "Other friendly units have +1 :rb_might: here.",
// "Your Mechs have +1 :rb_might:", "Your token units have +1", battlefields "Units here have +1".
const auraCache = new Map();
function auras(card) {
  const t = (card.text || '').replace(/\([^)]*\)/g, '');
  if (auraCache.has(t)) return auraCache.get(t);
  const out = [];
  for (const sent of t.split(/(?<=\.)\s+/)) {
    if (/\[Empowered\]|\bif\b|\bwhile\b/i.test(sent)) continue;
    const lv = /\[Level (\d+)\]/.exec(sent);
    let m;
    if ((m = /\b(Your|Other friendly|Friendly|Champion) (units|([A-Z][\w']*?)s|token units)( here)? have \+(\d+) :rb_might:( here)?/.exec(sent)))
      out.push({ n: +m[5], who: m[1] === 'Champion' ? 'any' : 'mine', notSelf: m[1] === 'Other friendly', here: !!(m[4] || m[6]), tag: m[3] && m[2] !== 'units' ? m[3] : null, token: m[2] === 'token units', champion: m[1] === 'Champion', level: lv ? +lv[1] : 0 });
    else if ((m = /^\s*Units here have \+(\d+) :rb_might:/.exec(sent))) out.push({ n: +m[1], who: 'any', here: true, level: 0 });
  }
  auraCache.set(t, out);
  return out;
}
// Battlefield abilities, by event: conquer / hold (the player who conquers or holds), defend (the defender),
// combat (the attacker), begin (start of the turn of a player with units here), beginAll (start of every turn),
// firstBegin (each player's first turn), hide (a card hidden here). 'may': optional, asked to the player
// (cond: when it can be used, pay: its cost, ai: false = the AI declines).
const SELF = o => ({ who: 'self', ...o });
const MAY = (text, fx, o = {}) => SELF({ kind: 'may', text, fx, ...o });
const BF_FX = {
  'Zaun Warrens': { conquer: [SELF({ kind: 'discard', n: 1 }), SELF({ kind: 'draw', n: 1 })] },
  'Seat of Power': { conquer: [SELF({ kind: 'draw', n: 0, per: 'bfCtrlOther' })] },
  'Sigil of the Storm': { conquer: [SELF({ kind: 'recycleRune' })] },
  'Minefield': { conquer: [SELF({ kind: 'burn', n: 2 })] },
  'Ruined Monastery': { conquer: [MAY('Défausser 1 carte et canaliser 1 rune épuisée ?', [SELF({ kind: 'discard', n: 1 }), SELF({ kind: 'channel', n: 1, ex: true })], { cond: 'hand' })] },
  "Targon's Peak": { conquer: [SELF({ kind: 'readyRunesEnd', n: 2 })] },
  'Treasure Hoard': { conquer: [MAY('Payer 1 énergie pour un jeton Gold épuisé ?', [SELF({ kind: 'token', name: 'Gold', n: 1, ex: true })], { pay: { e: 1, p: [] } })] },
  'Hall of Legends': { conquer: [MAY('Payer 1 énergie pour redresser votre légende ?', [SELF({ kind: 'readyLegend' })], { pay: { e: 1, p: [] } })] },
  'Protective Sands': { conquer: [MAY('Payer 1 énergie pour piocher 1 ?', [SELF({ kind: 'draw', n: 1 })], { pay: { e: 1, p: [] }, cond: 'runes<=4' })] },
  'Sunken Temple': { conquer: [MAY('Payer 1 énergie pour piocher 1 ?', [SELF({ kind: 'draw', n: 1 })], { pay: { e: 1, p: [] }, cond: 'mightyHere' })] },
  'Monastery of Hirana': { conquer: [MAY('Dépenser un buff pour piocher 1 ?', [SELF({ kind: 'spendBuff' }), SELF({ kind: 'draw', n: 1 })], { cond: 'buffed' })] },
  'The Candlelit Sanctum': { conquer: [SELF({ kind: 'predict', n: 2 })] },
  'Altar to Unity': { hold: [SELF({ kind: 'token', name: 'Recruit', n: 1 })] },
  'Amateur Recital': { hold: [T('recall', { where: 'bf', opt: true })] },
  'Cosmic Vista': { hold: [SELF({ kind: 'scorePt', cond: 'runeDeckEmpty' })] },
  'Grove of the God-Willow': { hold: [SELF({ kind: 'draw', n: 1 })] },
  'Hallowed Tomb': { hold: [SELF({ kind: 'champBack' })] },
  'Navori Fighting Pit': { hold: [SELF({ kind: 'buff', here: true })] },
  'Power Nexus': { hold: [MAY('Payer 4 puissance pour marquer 1 point ?', [SELF({ kind: 'scorePt' })], { pay: { e: 0, p: [null, null, null, null] } })] },
  "Reckoner's Arena": { hold: [SELF({ kind: 'unitsConquer' })] },
  'Shadow Temple': { hold: [SELF({ kind: 'burn', n: 3 })] },
  'Startipped Peak': { hold: [MAY('Canaliser 1 rune épuisée ?', [SELF({ kind: 'channel', n: 1, ex: true })])] },
  'The Papertree': { hold: [SELF({ kind: 'channel', n: 1, ex: true }), { who: 'opp', kind: 'channel', n: 1, ex: true }] },
  'The Grand Plaza': { hold: [SELF({ kind: 'winIf', units: 7 })] },
  'Durand Memorial': { defend: [T('shield', { n: 0, tank: true, side: 'friendly', where: 'here' })] },
  'Fortified Position': { defend: [T('shield', { n: 2, side: 'friendly', where: 'here' })] },
  'Ravenbloom Conservatory': { defend: [SELF({ kind: 'ravenbloom' })] },
  'Threshold of the Gray': { combat: [SELF({ kind: 'add', cost: { e: 1, p: [] } }), { who: 'opp', kind: 'add', cost: { e: 1, p: [] } }] },
  'Frozen Fortress': { beginAll: [SELF({ kind: 'aoeHere', n: 1 })] },
  'Dusk Rose Lab': { begin: [MAY('Détruire une de vos unités ici pour piocher 1 ?', [T('kill', { side: 'friendly', where: 'here' }), SELF({ kind: 'draw', n: 1 })], { cond: 'unitsHere', ai: false })] },
  'Obelisk of Power': { firstBegin: [SELF({ kind: 'channel', n: 1 })] },
  "The Arena's Greatest": { firstBegin: [SELF({ kind: 'scorePt' })] },
  "Bandle Scouts' Academy": { hide: [SELF({ kind: 'token', name: 'Gold', n: 1, ex: true })] },
};

// Legends' passive abilities, by event (the legend's player): conquer, hold, winCombat, endTurn, begin, playSpell,
// playUnit, playHidden, stunEnemy, enemyDies. exMe: "you may exhaust me" (asked, the legend must be ready).
const LMAY = (text, fx, o = {}) => ({ who: 'self', kind: 'may', text, fx, exMe: true, ...o });
const LEGEND_FX = {
  "Rek'Sai, Void Burrower": { conquer: [LMAY('Épuiser Rek\'Sai pour révéler les 2 cartes du dessus et en jouer une ?', [{ who: 'self', kind: 'pick', from: 'top', n: 2, then: 'playPaid' }])] },
  'Garen, Might of Demacia': { conquer: [{ who: 'self', kind: 'draw', n: 2, cond: 'units4here' }] },
  'Irelia, Blade Dancer': { conquer: [{ who: 'self', kind: 'may', text: 'Payer 1 énergie pour redresser Irelia ?', pay: { e: 1, p: [] }, cond: 'legendEx', fx: [{ who: 'self', kind: 'readyLegend' }] }] },
  'LeBlanc, Deceiver': { conquer: [LMAY('Défausser 1 carte et épuiser LeBlanc pour copier une unité ici ?', [{ who: 'self', kind: 'discard', n: 1 }, { who: 'self', kind: 'reflectHere' }], { cond: 'handUnitsHere' })],
    hold: [LMAY('Défausser 1 carte et épuiser LeBlanc pour copier une unité ici ?', [{ who: 'self', kind: 'discard', n: 1 }, { who: 'self', kind: 'reflectHere' }], { cond: 'handUnitsHere' })] },
  'Vex, Gloomist': { hold: [LMAY('Épuiser Vex pour piocher 1 ?', [{ who: 'self', kind: 'draw', n: 1 }])] },
  'Renata Glasc, Chem-Baroness': { hold: [LMAY('Épuiser Renata pour un jeton Gold épuisé ?', [{ who: 'self', kind: 'token', name: 'Gold', n: 1, ex: true }])] },
  'Poppy, Keeper of the Hammer': { hold: [{ who: 'self', kind: 'xp', n: 1 }] },
  'Draven, Glorious Executioner': { winCombat: [{ who: 'self', kind: 'draw', n: 1 }] },
  "Kha'Zix, Voidreaver": { winCombat: [{ who: 'self', kind: 'xp', n: 1 }] },
  'Annie, Dark Child': { endTurn: [{ who: 'self', kind: 'readyRunes', n: 2 }] },
  'Jinx, Loose Cannon': { begin: [{ who: 'self', kind: 'draw', n: 1, cond: 'hand<=1' }] },
  'Lux, Lady of Luminosity': { playSpell: [{ who: 'self', kind: 'draw', n: 1, cond: 'cost5' }] },
  'Nasus, Curator of the Sands': { playUnit: [LMAY('Épuiser Nasus pour redresser 2 runes ?', [{ who: 'self', kind: 'readyRunes', n: 2 }], { cond: 'cost7' })] },
  'Volibear, Relentless Storm': { playUnit: [LMAY('Épuiser Volibear pour canaliser 1 rune épuisée ?', [{ who: 'self', kind: 'channel', n: 1, ex: true }], { cond: 'mightyPlayed' })] },
  "Evelynn, Agony's Embrace": { playHidden: [{ who: 'self', kind: 'seq', cond: 'oncePerTurn', fx: [{ who: 'self', kind: 'draw', n: 1 }, { who: 'self', kind: 'discard', n: 1, cond: 'notMyTurn' }] }] },
  'Leona, Radiant Dawn': { stunEnemy: [{ who: 'self', kind: 'buff' }] },
  'Sivir, Battle Mistress': { enemyDies: [{ who: 'self', kind: 'readyLegend' }],
    recycleRune: [LMAY('Épuiser Sivir pour un jeton Gold épuisé ?', [{ who: 'self', kind: 'token', name: 'Gold', n: 1, ex: true }])] },
  'Ivern, Green Father': { conquer: [LMAY('Épuiser Ivern pour remplacer ce champ de bataille par Brush ?', [{ who: 'self', kind: 'brush' }])],
    hold: [LMAY('Épuiser Ivern pour remplacer ce champ de bataille par Brush ?', [{ who: 'self', kind: 'brush' }])] },
  'Jarvan IV, Exemplar of Demacia': { playGear: [LMAY('Épuiser Jarvan et payer 1 puissance pour déplacer une unité alliée ?', [T('moveTo', { side: 'friendly' })], { pay: { e: 0, p: [null] }, cond: 'deployGear' })] },
  'Fiora, Grand Duelist': { becomeMighty: [LMAY('Épuiser Fiora pour canaliser 1 rune épuisée ?', [{ who: 'self', kind: 'channel', n: 1, ex: true }])] },
  'Jhin, Virtuoso': { playSpell: [{ who: 'self', kind: 'may', text: 'Bannir ce sort avec Jhin ? (4 sorts bannis : ils vont à la défausse, canaliser 4 runes, piocher 1)', cond: 'spent4', fx: [{ who: 'self', kind: 'jhinMark' }] }] },
  'Sett, The Boss': { conquer: [{ who: 'self', kind: 'readyLegend', cond: 'legendEx' }] },
  'Vi, Piltover Enforcer': { conquer: [LMAY('Épuiser Vi pour redresser une unité ?', [T('ready', { side: 'friendly' })], { cond: 'excess3' })] },
  'Orianna, Lady of Clockwork': { mainStart: [{ who: 'self', kind: 'may', text: 'Payer 1 énergie pour animer un équipement (unité de force = son coût en énergie) ?', pay: { e: 1, p: [] }, cond: 'oriGear', fx: [T('animate', { gear: true, side: 'friendly' })] }] },
  'Yordle, Heart of the Tempest': { playNotHand: [{ who: 'self', kind: 'empowerMe', cond: 'legendNotEmp' }] },
  'Zed, Master of Shadows': { banishOwn: [{ who: 'self', kind: 'empowerMe', cond: 'legendNotEmp' }] },
  'Ambessa, Matriarch of War': { empowerOther: [{ who: 'self', kind: 'empowerMe', cond: 'legendNotEmp' }] },
  "Mel, Soul's Reflection": { empowerOther: [{ who: 'self', kind: 'empowerMe', cond: 'legendNotEmp' }] },
};
// Nasus / Dog: "a unit, gear, or activated ability with Energy cost 7 or more"
LEGEND_FX['Nasus, Curator of the Sands'].playGear = LEGEND_FX['Nasus, Curator of the Sands'].activate = LEGEND_FX['Nasus, Curator of the Sands'].playUnit;
LEGEND_FX['Dog, Curator of the Sands'] = LEGEND_FX['Nasus, Curator of the Sands'];
LEGEND_FX['Irelia, Blade Dancer'].chooseFriendly = [LMAY('Épuiser Irelia et payer 1 puissance pour redresser cette unité ?', [{ who: 'self', kind: 'readyIid' }], { pay: { e: 0, p: [null] }, cond: 'iidEx' })];

// Legends' activated abilities written by hand (Empower / Disempower costs, two choices, conditions).
// needEmp / notEmp: only while (not) Empowered; disemp: "Disempower me" is part of the cost; useIf: a condition;
// costLess: 'temporary' (Lillia: 1 Energy less per friendly unit with [Temporary]).
const EC = (e, p = 0) => ({ e, p: Array(p).fill(null) });
const LEGEND_AB = {
  'Miss Fortune, Bounty Hunter': [{ text: 'Give a unit [Ganking] this turn.', cost: EC(0), fx: [T('kwTurn')] }],
  'Shen, Eye of Twilight': [{ text: 'Give a friendly unit [Tank] this turn.', cost: EC(0), action: true, fx: [T('shield', { n: 0, tank: true, side: 'friendly' })] }],
  'Yasuo, Unforgiven': [{ text: 'Move a friendly unit to or from its base.', cost: EC(2), fx: [T('moveTo', { side: 'friendly', to: 'toggle' })] }],
  'Jax, Grandmaster at Arms': [
    { text: 'Attach a detached Equipment you control to a unit you control.', cost: EC(1), fx: [T('mark', { gear: true, side: 'friendly', equip: 'detached' }), T('attachMark', { side: 'friendly' })] },
    { text: 'Attach an attached Equipment you control to a unit you control.', cost: EC(0), fx: [T('mark', { gear: true, side: 'friendly', equip: 'attached' }), T('attachMark', { side: 'friendly' })] }],
  "Kha'Zix, Voidreaver": [
    { text: '[Buff] a unit.', cost: EC(0), xp: 1, fx: [{ who: 'self', kind: 'buff' }] },
    { text: 'Move an exhausted friendly unit from a battlefield to its base.', cost: EC(0), xp: 2, fx: [T('moveTo', { side: 'friendly', where: 'bf', exOnly: true, to: 'base' })] }],
  "K'Sante, Pride of Nazumah": [{ text: 'Give a friendly unit [Assault] equal to its [Shield] this turn.', cost: EC(1), fx: [T('assault', { n: 'shield', side: 'friendly' })] }],
  'Teemo, Swift Scout': [{ text: 'Put a Teemo unit you own into your hand from your Champion Zone or the board.', cost: EC(1), fx: [{ who: 'self', kind: 'teemoHome' }] }],
  'Yordle, Heart of the Tempest': [{ text: 'Give a unit [Assault 2] this turn.', cost: EC(0), action: true, disemp: true, fx: [T('assault', { n: 2 })] }],
  'Yordle, Hexplosives Expert': [{ text: 'Play a Bomb gear token to a battlefield.', cost: EC(1, 1), fx: [{ who: 'self', kind: 'token', name: 'Bomb', n: 1 }] }],
  'Akali, Rogue Assassin': [{ text: "If it's your turn, move a friendly unit in a showdown to base and if I'm [Empowered], ready it.", cost: EC(0), action: true, useIf: 'myTurn', fx: [T('moveTo', { side: 'friendly', where: 'combat', to: 'base', readyIfEmp: true })] }],
  'Ekko, Boy Who Shattered Time': [
    { text: 'Empower me.', cost: EC(1), notEmp: true, fx: [{ who: 'self', kind: 'empowerMe' }] },
    { text: 'Reduce the cost of the next unit you play this turn by 2 Energy and 1 Power and give it "Kill me at end of turn."', cost: EC(0), disemp: true, fx: [{ who: 'self', kind: 'unitDisc', e: 2, p: 1 }] }],
  'Jayce, Defender of Tomorrow': [
    { text: 'Ready a gear.', cost: EC(1), fx: [T('ready', { gear: true, side: 'friendly' })] },
    { text: 'Ready 2 gear.', cost: EC(1), needEmp: true, fx: [T('ready', { gear: true, side: 'friendly' }), T('ready', { gear: true, side: 'friendly', distinct: true })] }],
  'Pyke, Bloodharbor Ripper': [{ text: "Return a friendly unit at a battlefield to its owner's hand. Play a Gold gear token exhausted.", cost: EC(1), fx: [T('hand', { side: 'friendly', where: 'bf' }), { who: 'self', kind: 'token', name: 'Gold', n: 1, ex: true }] }],
  'Cursed Sarcophagus': [{ text: 'Play a unit banished with this.', cost: EC(0), fx: [{ who: 'self', kind: 'pick', from: 'banish', filter: { types: ['Unit'], sarco: true }, then: 'playFree' }] }],
  'Scrutinizing Scope': [{ text: 'Reveal the top card of your Main Deck: the opponent guesses its type; right, recycle it; wrong, draw it.', cost: EC(1), fx: [{ who: 'self', kind: 'scope' }] }],
  'Azir, Emperor of the Sands': [{ text: "Play a 2 Might Sand Soldier unit token to your base. Use only if you've played an Equipment this turn.", cost: EC(1), useIf: 'playedEquip', fx: [{ who: 'self', kind: 'token', name: 'Sand Soldier', n: 1, wm: true }] }],
};
// parsed abilities that only need a flag
const AB_FLAGS = {
  'Lillia, Bashful Bloom': [{ costLess: 'temporary' }],
  'Darius, Hand of Noxus': [{ useIf: 'playedCard' }],
  'Ezreal, Prodigal Explorer': [{ useIf: 'chose2' }],
  "Mel, Soul's Reflection": [{ disemp: true, other: false }],
  'Ambessa, Matriarch of War': [{ disemp: true, other: false }],
  'Zed, Master of Shadows': [{ disemp: true, other: false }],
};

// [Empowered] / [Level N] "I have ..." sentences: { emp, lv, might, kw, ready } ("[Level 3] I enter ready" too)
const statCache = new Map();
function statics(text) {
  const key = text || '';
  if (statCache.has(key)) return statCache.get(key);
  const out = [], t = key.replace(/\([^)]*\)/g, '');
  for (const m of t.matchAll(/\[(Empowered|Level (\d+))\]\s*\[(?:>|&gt;)\]\s*I (have|enter ready)([^.]*)\./g)) {
    const rest = m[4] || '', mt = /\+(\d+) :rb_might:/.exec(rest);
    out.push({ emp: m[1] === 'Empowered', lv: m[2] ? +m[2] : 0, might: mt && !/for each/.test(rest) ? +mt[1] : 0, kw: /\[/.test(rest) ? kw(rest) : null, ready: m[3] === 'enter ready' || /enter ready/.test(rest) });
  }
  statCache.set(key, out);
  return out;
}
// [Deploy] gear: "Friendly units here have [X]"
function deployKw(text) { const m = /Friendly units here have ((?:\[[^\]]+\]|\s|,|and)+)/.exec(text || ''); return m ? kw(m[1]) : null; }
// [Show Off] <what>: reveal a matching card from your hand (or choose a friendly card) for a bonus
function showOff(text) {
  const m = /\[Show Off\] (?:a |an )?([^.]*)\./.exec((text || '').replace(/\([^)]*\)/g, ''));
  if (!m) return null;
  const w = m[1];
  return /gear/i.test(w) ? 'Gear' : /\[Hidden\]/.test(w) ? 'hidden' : /Mech/.test(w) ? 'Mech' : /unit/i.test(w) ? 'Unit' : /:rb_energy_(\d+): or more/.test(w) ? 'e' + /:rb_energy_(\d+):/.exec(w)[1] : 'any';
}
// Deploy gear abilities, by event (its controller): play, conquer, hold, win (a combat here), attack (friendly units
// attack here), endTurn (end of your turn while you control this battlefield)
const DEPLOY_FX = {
  'Blossoming Dreamroot': { win: [SELF({ kind: 'draw', n: 1 })] },
  'Concert Poster': { play: [MAY('Payer 1 énergie pour un jeton Recruit dans votre base ?', [SELF({ kind: 'token', name: 'Recruit', n: 1 })], { pay: { e: 1, p: [] } })],
    conquer: [MAY('Payer 1 énergie pour un jeton Recruit dans votre base ?', [SELF({ kind: 'token', name: 'Recruit', n: 1 })], { pay: { e: 1, p: [] } })] },
  'Demacian Standard': { attack: [T('might', { n: 2, side: 'friendly', where: 'here' })], hold: [MAY('Reprendre Demacian Standard en main ?', [SELF({ kind: 'selfHand' })], { ai: false })] },
  'Detonation Amplifier': { play: [MAY('Détruire une autre de vos unités pour piocher 1 ?', [T('kill', { side: 'friendly' }), SELF({ kind: 'draw', n: 1 })], { ai: false, cond: 'unitsAny' })] },
  'Dockside Lock-Up': { play: [T('lockup', { where: 'here' })], hold: [SELF({ kind: 'lockupRelease' })] },
  'Hunting Blind': { play: [T('moveTo', { side: 'enemy', to: 'here', opt: true, notHere: true })] },
  'Pillaged Armory': { play: [SELF({ kind: 'buff' })], conquer: [SELF({ kind: 'buff' })] },
  'Portable Portal': { play: [MAY('Payer 1 puissance Body pour redresser une unité ici ?', [T('ready', { where: 'here' })], { pay: { e: 0, p: [['Body']] }, cond: 'unitsHereAny' })] },
  'Resource Extractor': { endTurn: [SELF({ kind: 'token', name: 'Gold', n: 1, ex: true })] },
  'The Ball': { play: [SELF({ kind: 'ballChoice' })] },
  'The Good Stuff': { hold: [SELF({ kind: 'selfHand' })] },
};

// "You may pay <cost> as an additional cost to play me"
function extraCost(text) {
  const m = /You may pay ((?::rb_(?:energy_\d+|rune_\w+):)+) as an additional cost to play me/.exec(text || '');
  return m ? parseCost(m[1]) : null;
}

module.exports = { statics, deployKw, showOff, DEPLOY_FX, LEGEND_FX, extraCost, BF_FX, abilities, auras, triggerFx, CARD_FX, parseCost, kwCost, cardCost, sumCost, planCost, tokensIn, deathTokens, SYNTH_TOKENS, kw, spellFx, planPay, combat, domOf, playFx, entersReady };
