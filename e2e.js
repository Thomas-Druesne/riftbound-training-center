// End-to-end check through the real server (HTTP + SSE + the AI's timed turns), like the browser does.
// A simple human plays by hand against the AI; the test fails if the game stops moving.
// Usage: node e2e.js [games=6] [level=normal]
const { spawn } = require('child_process');
const cards = require('./data/cards.json');
const byId = Object.fromEntries(cards.map(c => [c.id, c]));
const PORT = 3900 + Math.floor(Math.random() * 90), B = `http://localhost:${PORT}`;
const GAMES = +process.argv[2] || 6, LEVEL = process.argv[3] || 'normal', STALL_MS = 4000;
const other = p => (p === 'p1' ? 'p2' : 'p1');
const post = (p, b) => fetch(B + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then(r => r.json());
const wait = ms => new Promise(r => setTimeout(r, ms));

// one decision of a human playing by hand (from what the browser shows to that player)
function human(v, me) {
  const z = v.players[me].zones, top = (v.chain || [])[(v.chain || []).length - 1];
  if (v.stage === 'bf') return v.bfPick && v.bfPick[me] ? null : { type: 'chooseBf', cid: v.bfOpts[me][0] };
  if (v.stage === 'dice') return v.dice.caller === me && !v.dice.call ? { type: 'callParity', parity: 'pair' } : null;
  if (v.stage === 'mulligan') { const pl = v.players[me]; return pl.mullNew ? { type: 'mullConfirm' } : pl.mullDone ? null : { type: 'mulligan', iids: z.hand.slice(0, 1).map(c => c.iid) }; }
  if (v.pending) {
    const q = v.pending; if (q.to !== me) return null;
    if (q.kind === 'bf') return { type: 'resolve', bf: q.opts[0] };
    if (q.kind === 'predict') return { type: 'resolve', iids: [] };
    if (q.kind === 'target') return { type: 'resolve', iids: q.opt ? [] : [q.opts[0]] };
    if (q.kind === 'discard') return { type: 'resolve', iids: z.hand.slice(0, q.n).map(c => c.iid) };
    const mine = [...z.base, ...v.bfs.flatMap(b => b.units[me])].filter(c => (byId[c.cid] || {}).type === 'Unit' && c.iid !== q.exclude);
    return { type: 'resolve', iids: mine.slice(0, 1).map(c => c.iid) };
  }
  const spell = c => (byId[c.cid] || {}).type === 'Spell';
  const reaction = c => /^\s*\[Reaction\]/.test((byId[c.cid] || {}).text || '');
  if (top) {
    if (top.cb.by === me) return top.cb.seen ? { type: 'chainResolve' } : null;
    const r = z.hand.find(c => spell(c) && reaction(c));
    return r && Math.random() < 0.3 ? { type: 'play', iid: r.iid } : { type: 'chainPass' };
  }
  if (v.showdown) return v.showdown.focus === me ? { type: 'pass' } : null;
  if (v.active !== me || v.winner) return null;
  // my turn: chores, then sometimes a card or an attack, then end the turn
  if (!v._chores) return null;
  const c = z.hand.find(c => ['Unit', 'Spell', 'Gear'].includes((byId[c.cid] || {}).type));
  if (c && Math.random() < 0.6) return { type: 'play', iid: c.iid };
  const u = z.base.find(c => (byId[c.cid] || {}).type === 'Unit' && !c.ex);
  if (u && Math.random() < 0.5) return { type: 'move', iid: u.iid, to: { bf: Math.floor(Math.random() * v.bfs.length), side: me } };
  return { type: 'endTurn' };
}

async function game(i, decks) {
  const d1 = decks[i % decks.length], d2 = decks[(i * 5 + 2) % decks.length];
  const r = await post('/api/room/create', { mode: 'ai', name: 'Humain', deckId: d1.id, deckId2: d2.id, level: LEVEL });
  const me = r.seat, room = r.tag;
  const res = await fetch(`${B}/api/events?room=${room}&seat=${me}`);
  const reader = res.body.getReader(), dec = new TextDecoder();
  let v = null, buf = '', last = Date.now(), lastKey = '', choresTurn = -1, busy = false, done = null;
  const pump = (async () => {
    for (;;) {
      const { value, done: end } = await reader.read(); if (end) return;
      buf += dec.decode(value);
      let k;
      while ((k = buf.indexOf('\n\n')) >= 0) { const msg = buf.slice(0, k); buf = buf.slice(k + 2); if (msg.startsWith('data: ')) v = JSON.parse(msg.slice(6)); }
    }
  })();
  while (!done) {
    await wait(30);
    if (!v) continue;
    const key = `${v.rev}|${v.log.length}|${v.log[v.log.length - 1] && v.log[v.log.length - 1].msg}`;
    if (key !== lastKey) { lastKey = key; last = Date.now(); }
    if (v.winner || v.turn > 25) { done = v.winner ? `gagnant ${v.winner === me ? 'humain' : 'IA'} au tour ${v.turn}` : `arrêt au tour ${v.turn}`; break; }
    if (Date.now() - last > STALL_MS) {
      done = `BLOCAGE tour ${v.turn}, actif ${v.active === me ? 'humain' : 'IA'}, étape ${v.stage}, pile ${(v.chain || []).length}, affrontement ${!!v.showdown}, choix ${v.pending ? v.pending.kind + '→' + (v.pending.to === me ? 'humain' : 'IA') : '-'}\n    ` + v.log.slice(-6).map(l => l.msg).join('\n    ');
      break;
    }
    if (busy) continue;
    // manual chores at the start of my turn: ready, channel, draw
    if (v.stage === 'main' && v.active === me && !(v.auto || {})[me] && v.started === v.turn && choresTurn !== v.turn && !(v.chain || []).length && !v.showdown && !v.pending) {
      choresTurn = v.turn; busy = true;
      for (const a of [{ type: 'readyAll' }, { type: 'channel', n: 2 }, { type: 'draw', n: 1 }]) await post('/api/action', { room, seat: me, p: me, ...a });
      busy = false; continue;
    }
    v._chores = choresTurn === v.turn || !!(v.auto || {})[me];
    const a = human(v, me);
    if (!a) continue;
    busy = true;
    await post('/api/action', { room, seat: me, p: me, ...a });
    busy = false;
  }
  await post('/api/action', { room, seat: me, p: me, type: 'quit' }).catch(() => {});
  reader.cancel().catch(() => {}); await pump.catch(() => {});
  return `${d1.name} (humain) vs ${d2.name} (IA) : ${done}`;
}

(async () => {
  const srv = spawn(process.execPath, [process.env.SERVER || 'server.js'], { env: { ...process.env, PORT, AI_SPEED: '0.02' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let errs = '';
  srv.stderr.on('data', d => (errs += d));
  try {
    for (let k = 0; k < 50; k++) { try { await fetch(B + '/api/info'); break; } catch { await wait(100); } }
    const decks = await (await fetch(B + '/api/decks')).json();
    let bad = 0;
    for (let i = 0; i < GAMES; i++) { const line = await game(i, decks); if (/BLOCAGE/.test(line)) bad++; console.log((/BLOCAGE/.test(line) ? '✗ ' : '✓ ') + line); }
    if (errs.trim()) console.log('\nErreurs du serveur :\n' + errs.trim().split('\n').slice(0, 15).join('\n'));
    console.log(`\n${GAMES - bad}/${GAMES} parties sans blocage.`);
    process.exitCode = bad || errs.trim() ? 1 : 0;
  } finally { srv.kill(); }
})();
