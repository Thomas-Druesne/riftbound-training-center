// Replay a "Signaler un blocage" report: node replay.js reports/<file>.json
// Shows what the game is waiting for and what each seat may do now (the AI's own choice, and the engine's answer to it).
const fs = require('fs'), g = require('./game'), AI = require('./ai');
const f = process.argv[2]; if (!f) { console.log('Usage : node replay.js reports/<fichier>.json'); process.exit(1); }
const rep = JSON.parse(fs.readFileSync(f, 'utf8')), s = rep.state; s.history = [];
const who = p => (rep.ai && rep.ai.seat === p ? 'IA' : 'humain') + ' (' + p + ')';
console.log('Note :', rep.note || '-', '| decks :', JSON.stringify(rep.decks), '| tour', s.turn, 'actif', who(s.active), '| auto', JSON.stringify(s.auto));
console.log('Choix en attente :', s.pending ? `${s.pending.kind} pour ${who(s.pending.to)} (${s.pending.card})` : '-');
console.log('Pile :', (s.chain || []).map(c => `${g.cd(s, c).name} [${who(c.cb.by)}${c.cb.seen ? ', vu' : ''}]`).join(' > ') || '-');
console.log('Affrontement :', s.showdown ? JSON.stringify(s.showdown) : '-', '| effets en file :', (s.fxQueue || []).map(e => e.kind + ' ' + e.card).join(', ') || '-');
console.log('Journal :'); for (const l of s.log.slice(-15)) console.log('  ' + l.msg);
for (const p of ['p1', 'p2']) {
  const c = structuredClone(s);
  let a; try { a = AI.next(c, p, 'normal', {}); } catch (e) { a = 'ERREUR ' + e.message; }
  const err = a && typeof a === 'object' ? g.apply(c, { ...a, seat: p, p }) : null;
  console.log(`${who(p)} pourrait jouer :`, JSON.stringify(a), a && typeof a === 'object' ? (err ? '-> refusé : ' + err : '-> accepté') : '');
}
