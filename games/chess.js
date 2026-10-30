// Chess for two: full rules (castling, en passant, promotion, check, mate, stalemate,
// fifty-move rule, threefold repetition, insufficient material), resign and draw offers.
//
// Private analysis: tapping the "Moves" heading three times quickly (or pressing ` on a keyboard)
// toggles a Stockfish evaluation bar and best-move arrows on this device only. The engine runs in
// this browser; nothing about it is stored in the game state or sent to anyone else.
import { esc, log, addFx, rand } from '../js/util.js';
import { injectCSS } from '../js/fx.js';
import { sound } from '../js/sound.js';

/* ---------------- rules ---------------- */

const FILES = 'abcdefgh';
const START = 'rnbqkbnrpppppppp' + '.'.repeat(32) + 'PPPPPPPPRNBQKBNR';
const VAL = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };
const KN = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
const DIAG = [[-1, -1], [-1, 1], [1, -1], [1, 1]], ORTH = [[-1, 0], [1, 0], [0, -1], [0, 1]], ALL = [...DIAG, ...ORTH];
const onBoard = (r, f) => r >= 0 && r < 8 && f >= 0 && f < 8;
const colorOf = (p) => (p === '.' ? null : p === p.toUpperCase() ? 'w' : 'b');
const other = (c) => (c === 'w' ? 'b' : 'w');
const sqName = (i) => FILES[i & 7] + (8 - (i >> 3));
const sqIndex = (n) => (8 - Number(n[1])) * 8 + FILES.indexOf(n[0]);
const NAMES = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };

// Is square i attacked by colour `by`?
function attacked(b, i, by) {
  const r = i >> 3, f = i & 7;
  const is = (p, t) => p === (by === 'w' ? t.toUpperCase() : t);
  const pr = by === 'w' ? r + 1 : r - 1;
  for (const df of [-1, 1]) if (onBoard(pr, f + df) && is(b[pr * 8 + f + df], 'p')) return true;
  for (const [dr, df] of KN) if (onBoard(r + dr, f + df) && is(b[(r + dr) * 8 + f + df], 'n')) return true;
  for (const [dr, df] of ALL) if (onBoard(r + dr, f + df) && is(b[(r + dr) * 8 + f + df], 'k')) return true;
  for (const [dirs, kinds] of [[DIAG, 'bq'], [ORTH, 'rq']]) for (const [dr, df] of dirs) {
    for (let rr = r + dr, ff = f + df; onBoard(rr, ff); rr += dr, ff += df) {
      const p = b[rr * 8 + ff];
      if (p === '.') continue;
      if (colorOf(p) === by && kinds.includes(p.toLowerCase())) return true;
      break;
    }
  }
  return false;
}
const kingSq = (b, c) => b.indexOf(c === 'w' ? 'K' : 'k');
const inCheck = (pos) => attacked(pos.board, kingSq(pos.board, pos.turn), other(pos.turn));

function pseudo(pos) {
  const b = pos.board, c = pos.turn, out = [];
  const enemy = (p) => p !== '.' && colorOf(p) !== c;
  for (let i = 0; i < 64; i++) {
    const p = b[i];
    if (p === '.' || colorOf(p) !== c) continue;
    const t = p.toLowerCase(), r = i >> 3, f = i & 7;
    if (t === 'p') {
      const d = c === 'w' ? -1 : 1, start = c === 'w' ? 6 : 1, last = c === 'w' ? 0 : 7;
      const add = (to, flag) => { if (to >> 3 === last) for (const q of 'qrbn') out.push({ from: i, to, promo: q, flag }); else out.push({ from: i, to, flag }); };
      const one = i + d * 8;
      if (onBoard(r + d, f) && b[one] === '.') {
        add(one);
        if (r === start && b[one + d * 8] === '.') out.push({ from: i, to: one + d * 8, flag: 'double' });
      }
      for (const df of [-1, 1]) if (onBoard(r + d, f + df)) {
        const to = (r + d) * 8 + f + df;
        if (enemy(b[to])) add(to);
        else if (to === pos.ep) out.push({ from: i, to, flag: 'ep' });
      }
    } else if (t === 'n' || t === 'k') {
      for (const [dr, df] of t === 'n' ? KN : ALL) if (onBoard(r + dr, f + df)) {
        const to = (r + dr) * 8 + f + df;
        if (b[to] === '.' || enemy(b[to])) out.push({ from: i, to });
      }
    } else {
      for (const [dr, df] of t === 'b' ? DIAG : t === 'r' ? ORTH : ALL) {
        for (let rr = r + dr, ff = f + df; onBoard(rr, ff); rr += dr, ff += df) {
          const to = rr * 8 + ff;
          if (b[to] === '.') { out.push({ from: i, to }); continue; }
          if (enemy(b[to])) out.push({ from: i, to });
          break;
        }
      }
    }
  }
  const back = c === 'w' ? 56 : 0, K = c === 'w' ? 'K' : 'k', R = c === 'w' ? 'R' : 'r', them = other(c);
  if (b[back + 4] === K && !attacked(b, back + 4, them)) {
    if (pos.castling.includes(c === 'w' ? 'K' : 'k') && b[back + 7] === R && b[back + 5] === '.' && b[back + 6] === '.' && !attacked(b, back + 5, them) && !attacked(b, back + 6, them))
      out.push({ from: back + 4, to: back + 6, flag: 'O-O' });
    if (pos.castling.includes(c === 'w' ? 'Q' : 'q') && b[back] === R && b[back + 1] === '.' && b[back + 2] === '.' && b[back + 3] === '.' && !attacked(b, back + 3, them) && !attacked(b, back + 2, them))
      out.push({ from: back + 4, to: back + 2, flag: 'O-O-O' });
  }
  return out;
}

function play(pos, m) {
  const b = pos.board.split(''), p = b[m.from], c = pos.turn;
  const epSq = m.flag === 'ep' ? m.to + (c === 'w' ? 8 : -8) : -1;
  const captured = epSq >= 0 ? b[epSq] : b[m.to];
  if (epSq >= 0) b[epSq] = '.';
  b[m.to] = m.promo ? (c === 'w' ? m.promo.toUpperCase() : m.promo) : p;
  b[m.from] = '.';
  if (m.flag === 'O-O') { b[m.from + 1] = b[m.from + 3]; b[m.from + 3] = '.'; }
  if (m.flag === 'O-O-O') { b[m.from - 1] = b[m.from - 4]; b[m.from - 4] = '.'; }
  let castling = pos.castling;
  for (const [sq, lose] of [[60, 'KQ'], [4, 'kq'], [63, 'K'], [56, 'Q'], [7, 'k'], [0, 'q']])
    if (m.from === sq || m.to === sq) for (const ch of lose) castling = castling.replace(ch, '');
  return {
    board: b.join(''), turn: other(c), castling, ep: m.flag === 'double' ? (m.from + m.to) / 2 : -1,
    half: p.toLowerCase() === 'p' || captured !== '.' ? 0 : pos.half + 1, full: pos.full + (c === 'b' ? 1 : 0), captured, epSq,
  };
}

function legal(pos) {
  return pseudo(pos).filter((m) => { const n = play(pos, m); return !attacked(n.board, kingSq(n.board, pos.turn), n.turn); });
}

function san(pos, m, moves = legal(pos)) {
  let s;
  if (m.flag === 'O-O' || m.flag === 'O-O-O') s = m.flag;
  else {
    const p = pos.board[m.from], t = p.toLowerCase(), cap = pos.board[m.to] !== '.' || m.flag === 'ep';
    if (t === 'p') s = (cap ? FILES[m.from & 7] + 'x' : '') + sqName(m.to) + (m.promo ? '=' + m.promo.toUpperCase() : '');
    else {
      const rivals = moves.filter((o) => o.to === m.to && o.from !== m.from && pos.board[o.from] === p);
      let dis = '';
      if (rivals.length) {
        const sameFile = rivals.some((o) => (o.from & 7) === (m.from & 7)), sameRank = rivals.some((o) => o.from >> 3 === m.from >> 3);
        dis = !sameFile ? FILES[m.from & 7] : !sameRank ? String(8 - (m.from >> 3)) : sqName(m.from);
      }
      s = t.toUpperCase() + dis + (cap ? 'x' : '') + sqName(m.to);
    }
  }
  const next = play(pos, m);
  if (inCheck(next)) s += legal(next).length ? '+' : '#';
  return s;
}

function fen(pos) {
  const rows = [];
  for (let r = 0; r < 8; r++) rows.push(pos.board.slice(r * 8, r * 8 + 8).replace(/\.+/g, (x) => x.length));
  return `${rows.join('/')} ${pos.turn} ${pos.castling || '-'} ${pos.ep >= 0 ? sqName(pos.ep) : '-'} ${pos.half} ${pos.full}`;
}
function fromFEN(str) {
  const [rows, turn, castling, ep, half = '0', full = '1'] = str.trim().split(/\s+/);
  const board = rows.split('/').map((r) => r.replace(/\d/g, (d) => '.'.repeat(+d))).join('');
  return { board, turn, castling: castling === '-' ? '' : castling, ep: ep === '-' ? -1 : sqIndex(ep), half: +half, full: +full };
}
function perft(pos, depth) {
  if (!depth) return 1;
  let n = 0;
  for (const m of legal(pos)) n += perft(play(pos, m), depth - 1);
  return n;
}
const posKey = (pos) => `${pos.board} ${pos.turn} ${pos.castling} ${pos.ep}`;
function insufficient(b) {
  const rest = b.replace(/[.kK]/g, '');
  return rest === '' || (rest.length === 1 && /[nbNB]/.test(rest));
}
const material = (b, c) => { let s = 0; for (const p of b) if (p !== '.') s += (colorOf(p) === c ? 1 : -1) * VAL[p.toLowerCase()]; return s; };

// Rules helpers, exported for the test suite.
export const rules = { fromFEN, fen, legal, play, perft, san, inCheck, START };

/* ---------------- game ---------------- */

const pos = (s) => ({ board: s.board, turn: s.turn, castling: s.castling, ep: s.ep, half: s.half, full: s.full });
const seatOf = (s, pid) => s.players.find((p) => p.id === pid);
function finish(s, winner, reason) {
  const c = s.clock;
  if (c?.since) { c.left[s.turn] = Math.max(0, c.left[s.turn] - (Date.now() - c.since)); c.since = 0; } // stop the clock
  s.over = true; s.phase = 'over'; s.reason = reason;
  s.winners = winner ? [winner.id] : [];
  s.result = winner ? (winner.color === 'w' ? '1-0' : '0-1') : '½-½';
  log(s, reason);
}

/* ---------------- clocks ---------------- */
// Each side has a time bank (plus an increment per move). White's clock starts after White's first
// move. Times use the host's clock: c.since is when the current player's turn began.
const CLOCKS = [['none', 'No clock'], ['1+0', '1 minute'], ['3+2', '3 min + 2 s per move'], ['5+0', '5 minutes'], ['10+5', '10 min + 5 s per move'], ['15+10', '15 min + 10 s per move'], ['30+0', '30 minutes']];
function makeClock(choice) {
  if (!CLOCKS.some(([v]) => v === choice)) choice = '10+5';
  if (choice === 'none') return null;
  const [min, inc] = choice.split('+').map(Number);
  return { name: choice, inc: inc * 1000, left: { w: min * 60000, b: min * 60000 }, since: 0 };
}
// A flag fall loses, unless the opponent has nothing left that could ever deliver mate.
function timeUp(s, loser) {
  const winner = s.players.find((p) => p !== loser);
  s.clock.left[loser.color] = 0; s.clock.since = 0;
  const army = s.board.split('').filter((p) => colorOf(p) === winner.color && p.toLowerCase() !== 'k');
  if (!army.length || (army.length === 1 && /[nb]/i.test(army[0]))) return finish(s, null, `${loser.name} ran out of time, but ${winner.name} cannot checkmate. Draw.`);
  return finish(s, winner, `${loser.name} ran out of time. ${winner.name} wins.`);
}

function setup(players, opts = {}) {
  if (players.length !== 2) throw Error('Chess needs exactly 2 players.');
  const white = rand(2);
  const s = {
    phase: 'play', over: false, winners: [], result: '', reason: '',
    players: players.map((p, i) => ({ id: p.id, name: p.name, color: i === white ? 'w' : 'b' })),
    board: START, turn: 'w', castling: 'KQkq', ep: -1, half: 0, full: 1,
    ids: Array.from({ length: 64 }, (_, i) => (START[i] === '.' ? 0 : i + 1)),
    sans: [], last: null, counts: {}, taken: { w: [], b: [] }, drawOffer: null, log: [],
    clock: makeClock(opts.clock),
    level: LEVELS.some(([v]) => v === opts.level) ? opts.level : 'easy',
  };
  s.counts[posKey(s)] = 1;
  log(s, `${s.players.find((p) => p.color === 'w').name} plays White and moves first.`);
  return s;
}

function act(s, pid, a) {
  if (s.over) throw Error('The game is over.');
  const me = seatOf(s, pid);
  if (!me) throw Error('You are not playing in this game.');
  if (!a || typeof a !== 'object') throw Error('Choose a move.');
  const them = s.players.find((p) => p !== me);
  if (a.type === 'wait') return; // a computer player still thinking
  if (a.type === 'flag') {
    // Either player's screen reports a clock that reached zero; the host's own clock decides.
    const c = s.clock;
    if (!c || !c.since || Date.now() - c.since < c.left[s.turn]) return;
    return timeUp(s, s.players.find((p) => p.color === s.turn));
  }
  if (a.type === 'resign') return finish(s, them, `${me.name} resigned. ${them.name} wins.`);
  if (a.type === 'offer') {
    if (s.drawOffer) throw Error('A draw offer is already on the table.');
    s.drawOffer = pid; log(s, `${me.name} offered a draw.`); return;
  }
  if (a.type === 'accept') {
    if (!s.drawOffer || s.drawOffer === pid) throw Error('There is no draw offer to accept.');
    return finish(s, null, `${me.name} accepted the draw.`);
  }
  if (a.type !== 'move') throw Error('Unknown action.');
  if (me.color !== s.turn) throw Error('It is not your move.');
  const P = pos(s), moves = legal(P);
  const m = moves.find((x) => x.from === a.from && x.to === a.to && (x.promo || null) === (a.promo || null));
  if (!m) throw Error(moves.some((x) => x.from === a.from && x.to === a.to) ? 'Choose a piece to promote to.' : 'That move is not legal.');
  if (s.clock) {
    const c = s.clock, now = Date.now();
    if (c.since) {
      c.left[me.color] -= now - c.since;
      if (c.left[me.color] <= 0) return timeUp(s, me); // the move arrived too late
      c.left[me.color] += c.inc;
    }
    c.since = now;
  }
  const notation = san(P, m, moves), next = play(P, m);
  // Piece identities, so moved pieces glide across the board.
  const ids = s.ids.slice();
  if (next.epSq >= 0) ids[next.epSq] = 0;
  ids[m.to] = ids[m.from]; ids[m.from] = 0;
  if (m.flag === 'O-O') { ids[m.from + 1] = ids[m.from + 3]; ids[m.from + 3] = 0; }
  if (m.flag === 'O-O-O') { ids[m.from - 1] = ids[m.from - 4]; ids[m.from - 4] = 0; }
  Object.assign(s, { board: next.board, turn: next.turn, castling: next.castling, ep: next.ep, half: next.half, full: next.full, ids });
  if (next.captured !== '.') s.taken[me.color].push(next.captured.toLowerCase());
  s.sans.push(notation);
  s.last = { from: m.from, to: m.to };
  if (s.drawOffer && s.drawOffer !== pid) { log(s, `${me.name} declined the draw by playing on.`); s.drawOffer = null; }
  log(s, `${me.name}: ${notation}`);
  const key = posKey(s);
  s.counts[key] = (s.counts[key] || 0) + 1;
  addFx(s, { kind: 'sound', sound: notation.includes('+') || notation.includes('#') ? 'chime' : next.captured !== '.' ? 'steal' : 'place' });
  const replies = legal(pos(s));
  if (!replies.length) return inCheck(pos(s)) ? finish(s, me, `Checkmate! ${me.name} wins.`) : finish(s, null, 'Stalemate. The game is drawn.');
  if (s.counts[key] >= 3) return finish(s, null, 'Draw by threefold repetition.');
  if (s.half >= 100) return finish(s, null, 'Draw by the fifty-move rule.');
  if (insufficient(s.board)) return finish(s, null, 'Draw: neither side can checkmate.');
}

/* ---------------- computer levels ---------------- */
// Easy is the quick built-in player below. Club, Strong and Master ask Stockfish (on the host's
// device) at limited strength. bot() must answer at once, so it returns 'wait' while the engine
// thinks and the platform asks again a moment later. Without a browser engine, Easy plays.
const LEVELS = [['easy', 'Easy'], ['club', 'Club (Stockfish)'], ['strong', 'Strong (Stockfish)'], ['master', 'Master (Stockfish)']];
const LEVEL_SETTINGS = { club: { skill: 3, depth: 4, ms: 300 }, strong: { skill: 11, depth: 10, ms: 700 }, master: { skill: 20, depth: 18, ms: 1500 } };
const BOT = { worker: null, broken: false, pending: null, since: 0, result: null };
function botEngine() {
  if (BOT.worker || BOT.broken) return BOT.worker;
  try {
    const w = new Worker(URL.createObjectURL(new Blob([`importScripts(${JSON.stringify(ENGINE_URLS[0])});`], { type: 'application/javascript' })));
    w.onmessage = (e) => {
      const line = String(e.data);
      if (line.startsWith('bestmove') && BOT.pending) { BOT.result = { fen: BOT.pending, uci: line.split(' ')[1] }; BOT.pending = null; }
    };
    w.onerror = () => { BOT.broken = true; BOT.worker = null; BOT.pending = null; };
    w.postMessage('uci');
    BOT.worker = w;
  } catch { BOT.broken = true; }
  return BOT.worker;
}
function engineMove(v, P) {
  const f = fen(P);
  if (BOT.result?.fen === f) {
    const m = legal(P).find((x) => sqName(x.from) + sqName(x.to) + (x.promo || '') === BOT.result.uci);
    BOT.result = null;
    return m ? { type: 'move', from: m.from, to: m.to, promo: m.promo } : null;
  }
  if (BOT.pending === f) return Date.now() - BOT.since > 8000 ? null : { type: 'wait' }; // a stuck engine: play Easy instead
  const w = botEngine();
  if (!w) return null;
  const L = LEVEL_SETTINGS[v.level];
  BOT.pending = f; BOT.since = Date.now(); BOT.result = null;
  w.postMessage('stop');
  w.postMessage(`setoption name Skill Level value ${L.skill}`);
  w.postMessage('position fen ' + f);
  w.postMessage(`go depth ${L.depth} movetime ${L.ms}`);
  return { type: 'wait' };
}

// Easy: a quick, honest club player that grabs safe material, avoids hanging pieces and finds mate in one.
function bot(v, pid) {
  const me = seatOf(v, pid), P = pos(v), moves = legal(P);
  if (v.level && v.level !== 'easy' && browser && typeof Worker !== 'undefined' && !(v.drawOffer && v.drawOffer !== pid)) {
    const a = engineMove(v, P);
    if (a) return a;
  }
  let best = null, bestScore = -Infinity;
  for (const m of moves) {
    const n = play(P, m);
    let score = material(n.board, me.color) + Math.random() * 18;
    const check = attacked(n.board, kingSq(n.board, n.turn), me.color);
    if (check) { if (!legal(n).length) return { type: 'move', from: m.from, to: m.to, promo: m.promo }; score += 25; }
    let threat = 0;
    for (const r of pseudo(n)) {
      const victim = n.board[r.to];
      if (victim === '.' || colorOf(victim) !== me.color) continue;
      const gain = VAL[victim.toLowerCase()] - (attacked(n.board, r.to, me.color) ? VAL[n.board[r.from].toLowerCase()] : 0);
      if (gain > threat) threat = gain;
    }
    score -= threat * 0.9;
    const t = P.board[m.from].toLowerCase(), toR = m.to >> 3, toF = m.to & 7;
    if (t === 'n' || t === 'b') score += 12 - 3 * (Math.abs(3.5 - toR) + Math.abs(3.5 - toF));
    if (t === 'p') score += 4;
    if (m.flag && m.flag.startsWith('O-')) score += 30;
    if (t === 'k' && v.sans.length < 40 && !m.flag) score -= 25;
    if (score > bestScore) { bestScore = score; best = m; }
  }
  if (v.drawOffer && v.drawOffer !== pid && material(v.board, me.color) < -300) return { type: 'accept' };
  return { type: 'move', from: best.from, to: best.to, promo: best.promo };
}

/* ---------------- pieces ---------------- */

const DEFS = `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
  <linearGradient id="chess-w" x1="0" y1="0" x2=".6" y2="1"><stop stop-color="#fffdf6"/><stop offset=".55" stop-color="#efe2c4"/><stop offset="1" stop-color="#c9b58c"/></linearGradient>
  <linearGradient id="chess-b" x1="0" y1="0" x2=".6" y2="1"><stop stop-color="#6a5a4c"/><stop offset=".45" stop-color="#2f2620"/><stop offset="1" stop-color="#110c09"/></linearGradient>
</defs></svg>`;
const BASE = '<path d="M22 90h56v-6q0-6-6-6H28q-6 0-6 6z"/>';
const SHAPES = {
  p: `${BASE}<path d="M30 78q2-20 13-28h14q11 8 13 28z"/><path d="M38 50h24q4-4 0-8H38q-4 4 0 8z"/><circle cx="50" cy="30" r="13"/>`,
  r: `${BASE}<path d="M31 78l4-36h30l4 36z"/><path d="M27 42V20h10v8h8v-8h10v8h8v-8h10v22z"/><path class="d" d="M36 50h28" fill="none"/>`,
  n: `${BASE}<path d="M29 78c0-16 8-24 15-31-8 3-15 7-21 3-5-4 1-14 10-21 8-7 14-13 22-15l3-7 6 9c13 7 16 24 12 44-2 8-3 14-3 18z"/><circle class="e" cx="45" cy="30" r="2.6"/><path class="d" d="M60 20c7 8 9 22 6 38" fill="none"/>`,
  b: `${BASE}<path d="M33 78q2-18 11-26h12q9 8 11 26z"/><path d="M50 12c17 12 18 30 7 40H43C32 42 33 24 50 12z"/><circle cx="50" cy="9" r="4.5"/><path class="d" d="M55 25l-9 11" fill="none"/>`,
  q: `${BASE}<path d="M30 78l6-30h28l6 30z"/><path d="M30 48l-8-26 14 12 6-20 8 18 8-18 6 20 14-12-8 26z"/>${[[22, 20], [42, 12], [58, 12], [78, 20]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="4.5"/>`).join('')}`,
  k: `${BASE}<path d="M30 78l6-30h28l6 30z"/><path d="M33 48c-6-18 12-22 17-12 5-10 23-6 17 12z"/><path d="M46 8h8v8h8v8h-8v12h-8V24h-8v-8h8z"/>`,
};
const pieceSVG = (p) => {
  const white = colorOf(p) === 'w';
  return `<svg viewBox="0 0 100 100" class="chess-${white ? 'w' : 'b'}" aria-hidden="true"><g fill="url(#chess-${white ? 'w' : 'b'})" stroke="${white ? '#2b1d10' : '#050302'}" stroke-width="3" stroke-linejoin="round">${SHAPES[p.toLowerCase()]}</g></svg>`;
};

/* ---------------- private analysis (this device only) ---------------- */

const ENGINE_URLS = ['https://cdn.jsdelivr.net/npm/stockfish.js@10.0.2/stockfish.js', 'https://unpkg.com/stockfish.js@10.0.2/stockfish.js'];
const SIGHT = 'gn-chess-sight';
const browser = typeof document !== 'undefined';
const A = { root: null, on: browser && localStorage.getItem(SIGHT) === '1', worker: null, url: 0, fen: null, pos: null, lines: [], depth: 0, status: '', taps: [], flip: false, me: 'w', frame: 0 };

function engine() {
  if (A.worker) return A.worker;
  const src = `importScripts(${JSON.stringify(ENGINE_URLS[A.url])});`;
  const w = new Worker(URL.createObjectURL(new Blob([src], { type: 'application/javascript' })));
  w.onmessage = (e) => onEngine(String(e.data));
  w.onerror = () => {
    w.terminate(); A.worker = null;
    if (++A.url < ENGINE_URLS.length) { const f = A.fen; A.fen = null; if (f) analyse(f, A.pos); }
    else { A.status = 'Engine could not load (offline?)'; paint(); }
  };
  ['uci', 'setoption name MultiPV value 3', 'isready'].forEach((c) => w.postMessage(c));
  A.status = 'Loading engine…';
  return (A.worker = w);
}
function analyse(f, P) {
  if (!A.on || A.fen === f) return;
  A.fen = f; A.pos = P; A.lines = []; A.depth = 0;
  const w = engine();
  w.postMessage('stop');
  w.postMessage('position fen ' + f);
  w.postMessage('go depth 20 movetime 3000');
}
function stopEngine() { try { A.worker?.terminate(); } catch {} A.worker = null; A.fen = null; A.lines = []; }
function onEngine(line) {
  if (!line.startsWith('info') || !line.includes(' pv ') || !A.pos) return;
  const pv = line.split(' pv ')[1].trim().split(' ');
  const k = Number(line.match(/ multipv (\d+)/)?.[1] || 1), sc = line.match(/ score (cp|mate) (-?\d+)/), depth = Number(line.match(/ depth (\d+)/)?.[1] || 0);
  if (!sc) return;
  // Ignore late output from the previous position: the first move must be legal here.
  const moves = legal(A.pos), first = pv[0], m = moves.find((x) => sqName(x.from) + sqName(x.to) + (x.promo || '') === first);
  if (!m) return;
  const sign = A.pos.turn === 'w' ? 1 : -1; // Stockfish scores from the side to move
  A.lines[k - 1] = { m, mate: sc[1] === 'mate' ? Number(sc[2]) * sign : null, cp: sc[1] === 'cp' ? Number(sc[2]) * sign : null, pv, depth };
  A.depth = Math.max(A.depth, depth);
  A.status = '';
  if (!A.frame) A.frame = requestAnimationFrame(() => { A.frame = 0; paint(); });
}
const scoreText = (l) => (l.mate != null ? `${l.mate > 0 ? '' : '-'}M${Math.abs(l.mate)}` : `${l.cp > 0 ? '+' : ''}${(l.cp / 100).toFixed(1)}`);
const whiteShare = (l) => (l.mate != null ? (l.mate > 0 ? 100 : 0) : 100 / (1 + Math.exp(-l.cp / 250)));
function pvSan(P, uci, n = 4) {
  const out = [];
  let p = P;
  for (const u of uci.slice(0, n)) {
    const moves = legal(p), m = moves.find((x) => sqName(x.from) + sqName(x.to) + (x.promo || '') === u);
    if (!m) break;
    out.push(san(p, m, moves)); p = play(p, m);
  }
  return out.join(' ');
}
const centre = (i) => { const r = i >> 3, f = i & 7; return A.flip ? [(7 - f) * 100 + 50, (7 - r) * 100 + 50] : [f * 100 + 50, r * 100 + 50]; };
function paint() {
  const root = A.root?.isConnected && A.root.querySelector('.chess-root');
  if (!root) return;
  const bar = root.querySelector('.chess-eval'), list = root.querySelector('.chess-lines'), arrows = root.querySelector('.chess-arrows');
  if (!A.on || !bar) return;
  const top = A.lines[0];
  const share = top ? whiteShare(top) : 50;
  bar.querySelector('i').style.height = (A.me === 'w' ? share : 100 - share) + '%';
  bar.querySelector('b').textContent = top ? scoreText(top) : '…';
  if (list) list.innerHTML = A.status ? `<p class="muted small">${esc(A.status)}</p>` : A.lines.filter(Boolean).map((l, i) =>
    `<div class="chess-line ${i ? '' : 'top'}"><b>${esc(scoreText(l))}</b><span>${esc(pvSan(A.pos, l.pv))}</span></div>`).join('') + (A.depth ? `<p class="muted small">depth ${A.depth}</p>` : '');
  if (arrows) arrows.innerHTML = A.lines.filter(Boolean).slice(0, 3).map((l, i) => {
    const [x1, y1] = centre(l.m.from), [x2, y2] = centre(l.m.to), len = Math.hypot(x2 - x1, y2 - y1), ux = (x2 - x1) / len, uy = (y2 - y1) / len;
    const ex = x2 - ux * 28, ey = y2 - uy * 28, w = i ? 12 : 18, c = i ? 'rgba(90,160,255,.55)' : 'rgba(60,210,120,.8)', h = i ? 26 : 34;
    return `<path d="M${x1} ${y1}L${ex} ${ey}" stroke="${c}" stroke-width="${w}" stroke-linecap="round"/><path d="M${x2} ${y2}L${ex - uy * h * 0.6 - ux * h * 0.2} ${ey + ux * h * 0.6 - uy * h * 0.2}L${ex + uy * h * 0.6 - ux * h * 0.2} ${ey - ux * h * 0.6 - uy * h * 0.2}z" fill="${c}"/>`;
  }).reverse().join('');
}
function toggleSight(redraw) {
  A.on = !A.on;
  localStorage.setItem(SIGHT, A.on ? '1' : '0');
  if (!A.on) stopEngine();
  redraw();
}
let redrawSight = null;
if (browser) addEventListener('keydown', (e) => {
  if (e.key === '`' && !e.target.closest?.('input,textarea,select') && document.querySelector('.chess-root') && redrawSight) toggleSight(redrawSight);
});

/* ---------------- interface ---------------- */

const UI = { sel: null, promo: null, key: null };

// Clock display: ticks locally between updates, corrected by the host's time sent with each view.
const CLK = { root: null, c: null, turn: 'w', over: true, offset: 0, hostNow: 0, send: null, canFlag: false, sentAt: 0 };
const remaining = (color) => {
  const c = CLK.c;
  if (!c) return 0;
  return c.left[color] - (!CLK.over && c.since && CLK.turn === color ? Date.now() + CLK.offset - c.since : 0);
};
const clockText = (ms) => {
  ms = Math.max(0, ms);
  if (ms < 20000) return (Math.floor(ms / 100) / 10).toFixed(1);
  const t = Math.ceil(ms / 1000);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};
function tickClocks() {
  if (!CLK.c || !CLK.root?.isConnected) return;
  CLK.root.querySelectorAll('.chess-clock').forEach((e) => {
    const ms = remaining(e.dataset.c), run = !CLK.over && !!CLK.c.since && CLK.turn === e.dataset.c;
    e.textContent = clockText(ms);
    e.classList.toggle('run', run);
    e.classList.toggle('low', run && ms < 20000);
  });
  // When the side to move hits zero, ask the host to check (it ignores early requests).
  if (!CLK.over && CLK.canFlag && CLK.c.since && remaining(CLK.turn) < -300 && Date.now() - CLK.sentAt > 2000) {
    CLK.sentAt = Date.now();
    CLK.send({ type: 'flag' });
  }
}
if (browser) setInterval(tickClocks, 200);

function render(el, v, ctx) {
  injectCSS('chess', STYLE);
  const redraw = () => render(el, v, ctx);
  redrawSight = redraw;
  A.root = el;
  const key = v.players.map((p) => p.id).join() + v.ids.join();
  if (UI.key && v.sans.length === 0 && UI.key !== key) Object.assign(UI, { sel: null, promo: null });
  UI.key = key;
  const me = seatOf(v, ctx.me);
  const myColor = me?.color || 'w';
  const flip = myColor === 'b';
  A.flip = flip; A.me = myColor;
  const opp = v.players.find((p) => p.color !== myColor), mine = v.players.find((p) => p.color === myColor);
  if (v.hostNow && v.hostNow !== CLK.hostNow) { CLK.hostNow = v.hostNow; CLK.offset = v.hostNow - Date.now(); }
  Object.assign(CLK, { root: el, c: v.clock, turn: v.turn, over: v.over, send: ctx.send, canFlag: !!me });
  const P = pos(v), moves = v.over ? [] : legal(P);
  const myTurn = !v.over && me && me.color === v.turn;
  if (!myTurn || (UI.sel != null && colorOf(v.board[UI.sel]) !== v.turn)) UI.sel = null;
  const targets = UI.sel != null ? moves.filter((m) => m.from === UI.sel) : [];
  const checkSq = !v.over && inCheck(P) ? kingSq(v.board, v.turn) : -1;
  const order = Array.from({ length: 64 }, (_, i) => (flip ? 63 - i : i));

  const squares = order.map((i, k) => {
    const p = v.board[i], dark = ((i >> 3) + (i & 7)) % 2 === 1, t = targets.find((m) => m.to === i);
    const cls = ['chess-sq', dark ? 'dark' : 'light', v.last && (v.last.from === i || v.last.to === i) ? 'last' : '', UI.sel === i ? 'sel' : '', t ? (p !== '.' || t.flag === 'ep' ? 'cap' : 'dot') : '', i === checkSq ? 'check' : '',
      myTurn && colorOf(p) === v.turn && moves.some((m) => m.from === i) ? 'mine' : ''].filter(Boolean).join(' ');
    const label = `${sqName(i)}${p !== '.' ? ', ' + (colorOf(p) === 'w' ? 'white ' : 'black ') + NAMES[p.toLowerCase()] : ''}`;
    return `<div class="${cls}" data-sq="${i}" role="button" aria-label="${label}">${k % 8 === 0 ? `<span class="chess-rank">${8 - (i >> 3)}</span>` : ''}${k >= 56 ? `<span class="chess-file">${FILES[i & 7]}</span>` : ''}${p !== '.' ? `<div class="chess-pc" data-k="pc-${v.ids[i]}">${pieceSVG(p)}</div>` : ''}</div>`;
  }).join('');

  const chip = (p) => {
    const taken = v.taken[p.color], diff = material(v.board, p.color);
    const active = !v.over && v.turn === p.color;
    return `<div class="pchip chess-chip ${active ? 'turn' : ''}"><span class="chess-dot ${p.color}"></span><b class="grow">${esc(p.name)}${p.id === ctx.me ? ' · you' : ''}</b>
      <span class="chess-taken">${taken.slice().sort((a, b) => VAL[b] - VAL[a]).map((t) => `<i>${pieceSVG(p.color === 'w' ? t : t.toUpperCase())}</i>`).join('')}${diff > 0 ? `<small>+${Math.round(diff / 100)}</small>` : ''}</span>${v.clock ? `<span class="chess-clock" data-c="${p.color}">${clockText(remaining(p.color))}</span>` : ''}</div>`;
  };
  const status = v.over ? `${esc(v.reason)} (${v.result})`
    : myTurn ? (checkSq >= 0 ? 'Check! Your move' : 'Your move') + ` · ${v.turn === 'w' ? 'White' : 'Black'}`
    : `${esc(v.players.find((p) => p.color === v.turn).name)} is thinking…${checkSq >= 0 ? ' (in check)' : ''}`;
  const rows = [];
  for (let i = 0; i < v.sans.length; i += 2) rows.push(`<li><span>${esc(v.sans[i])}</span><span>${esc(v.sans[i + 1] || '')}</span></li>`);
  const offerFromThem = v.drawOffer && v.drawOffer !== ctx.me;

  el.innerHTML = `${DEFS}<div class="chess-root"><div class="game-layout">
    <div class="chess-main">
      ${v.over ? `<div class="winner-banner">${v.winners.length ? (v.winners.includes(ctx.me) ? 'You win!' : esc(v.players.find((p) => p.id === v.winners[0]).name) + ' wins') : 'Draw'}</div>` : ''}
      ${chip(opp)}
      <div class="chess-boardrow">
        ${A.on ? '<div class="chess-eval" aria-hidden="true"><i></i><b>…</b></div>' : ''}
        <div class="chess-frame"><div class="chess-board">${squares}<svg class="chess-arrows" viewBox="0 0 800 800" aria-hidden="true"></svg></div></div>
      </div>
      ${chip(mine)}
      <div class="status ${myTurn ? 'myturn' : ''} chess-status">${status}</div>
    </div>
    <div class="side">
      ${me && !v.over ? `<div class="panel"><div class="row">
        ${offerFromThem ? '<button class="good small" data-act="accept">Accept draw</button>' : `<button class="small" data-act="offer" ${v.drawOffer ? 'disabled' : ''}>${v.drawOffer ? 'Draw offered' : '½ Offer draw'}</button>`}
        <button class="bad small" data-act="resign">Resign</button></div>
        ${offerFromThem ? `<p class="small muted" style="margin:8px 0 0">${esc(opp.name)} offers a draw. Playing a move declines it.</p>` : ''}</div>` : ''}
      ${A.on ? '<div class="panel chess-notes"><div class="chess-lines"></div></div>' : ''}
      <div class="panel"><h3 class="gold chess-movehead" style="margin:0 0 8px">Moves</h3>${rows.length ? `<ol class="chess-moves">${rows.join('')}</ol>` : '<p class="muted small" style="margin:0">White moves first.</p>'}</div>
      <div class="parchment log">${v.log.slice(0, 6).map((l) => `<div>${esc(l)}</div>`).join('')}</div>
    </div>
  </div>
  ${UI.promo ? `<div class="modal-bg"><div class="modal panel chess-promo"><h3 class="gold">Promote to</h3><div class="row">${'qrbn'.split('').map((q) => `<button data-promo="${q}" aria-label="${NAMES[q]}">${pieceSVG(myColor === 'w' ? q.toUpperCase() : q)}</button>`).join('')}</div><button class="small" data-promo="">Cancel</button></div></div>` : ''}</div>`;

  el.querySelectorAll('[data-sq]').forEach((d) => (d.onclick = () => {
    if (!myTurn) return;
    const i = Number(d.dataset.sq), t = targets.filter((m) => m.to === i);
    if (t.length) {
      if (t[0].promo) { UI.promo = { from: UI.sel, to: i }; sound('click'); return redraw(); }
      const from = UI.sel; UI.sel = null;
      return ctx.send({ type: 'move', from, to: i });
    }
    UI.sel = colorOf(v.board[i]) === v.turn && UI.sel !== i && moves.some((m) => m.from === i) ? i : null;
    if (UI.sel != null) sound('click');
    redraw();
  }));
  el.querySelectorAll('[data-promo]').forEach((b) => (b.onclick = () => {
    const q = b.dataset.promo, pr = UI.promo;
    UI.promo = null; UI.sel = null;
    if (q && pr) ctx.send({ type: 'move', from: pr.from, to: pr.to, promo: q }); else redraw();
  }));
  el.querySelectorAll('[data-act]').forEach((b) => (b.onclick = () => {
    if (b.dataset.act === 'resign' && !confirm('Resign this game?')) return;
    ctx.send({ type: b.dataset.act });
  }));
  // Three quick taps on the "Moves" heading toggle private analysis on this device.
  el.querySelector('.chess-movehead').onclick = () => {
    const now = Date.now();
    A.taps = A.taps.filter((t) => now - t < 900).concat(now);
    if (A.taps.length >= 3) { A.taps = []; toggleSight(redraw); }
  };
  tickClocks();
  if (A.on) { if (!v.over) analyse(fen(P), P); paint(); }
}

const STYLE = `
.chess-main{min-width:0;display:flex;flex-direction:column;gap:10px}
.chess-chip{min-height:44px}
.chess-clock{flex:none;min-width:66px;padding:5px 10px;border-radius:9px;text-align:center;font-family:var(--font-display);font-weight:800;font-size:1.05rem;font-variant-numeric:tabular-nums;color:var(--muted);background:rgba(0,0,0,.45);box-shadow:inset 0 1px 3px rgba(0,0,0,.6)}
.chess-clock.run{color:#1d1714;background:#f4ecd8;box-shadow:0 0 0 2px var(--gold),0 0 12px rgba(242,193,78,.4)}
.chess-clock.low{color:#2c0703;background:#ff9a8c;box-shadow:0 0 0 2px var(--bad)}
.chess-dot{width:16px;height:16px;border-radius:50%;flex:none;border:2px solid #000;box-shadow:0 1px 3px rgba(0,0,0,.6)}
.chess-dot.w{background:#f4ecd8}.chess-dot.b{background:#1d1714;border-color:#c8b89a}
.chess-taken{display:flex;align-items:center;flex-wrap:wrap;justify-content:flex-end;max-width:55%}
.chess-taken i{width:20px;height:20px;margin-left:-6px}.chess-taken i svg{width:100%;height:100%}
.chess-taken small{margin-left:6px;font-weight:800;color:var(--muted)}
.chess-boardrow{display:flex;gap:8px;align-items:stretch;justify-content:center}
.chess-frame{flex:0 1 auto;width:min(100%,calc(74vh + 20px),660px);min-width:0;padding:10px;border-radius:14px;background:linear-gradient(135deg,#8a5a33,#5a361d 30%,#7a4c2a 55%,#4a2c17 80%,#6d4426);box-shadow:0 18px 40px rgba(0,0,0,.55),inset 0 1px 0 rgba(255,220,170,.3)}
.chess-board{position:relative;display:grid;grid-template-columns:repeat(8,1fr);aspect-ratio:1;width:100%;max-width:640px;margin:0 auto;border-radius:4px;overflow:hidden;box-shadow:0 0 0 2px #2a170a,inset 0 0 30px rgba(0,0,0,.3);touch-action:manipulation;user-select:none;-webkit-user-select:none}
.chess-sq{position:relative;cursor:pointer}
.chess-sq.light{background:#ecd8b0;background-image:var(--grain);background-blend-mode:multiply}
.chess-sq.dark{background:#a6764b;background-image:var(--grain);background-blend-mode:multiply}
.chess-sq.last::before{content:'';position:absolute;inset:0;background:rgba(240,200,60,.42)}
.chess-sq.sel::before{content:'';position:absolute;inset:0;background:rgba(120,200,90,.5)}
.chess-sq.check{background-image:radial-gradient(circle,#ff4a3a 0%,rgba(255,74,58,.6) 40%,transparent 72%)}
.chess-sq.dot::after{content:'';position:absolute;left:36%;top:36%;width:28%;height:28%;border-radius:50%;background:rgba(40,70,20,.45);z-index:3}
.chess-sq.cap::after{content:'';position:absolute;inset:4%;border-radius:50%;border:5px solid rgba(40,70,20,.45);z-index:3}
.chess-pc{position:absolute;inset:5%;z-index:2;pointer-events:none}
.chess-pc svg{width:100%;height:100%;display:block;filter:drop-shadow(0 3px 2px rgba(0,0,0,.45))}
.chess-rank,.chess-file{position:absolute;font-size:.62rem;font-weight:800;z-index:1;opacity:.75;color:#3b2410}
.chess-sq.dark .chess-rank,.chess-sq.dark .chess-file{color:#f3e3c2}
.chess-rank{left:3px;top:2px}.chess-file{right:4px;bottom:1px}
.chess-arrows{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:4}
.chess-eval{position:relative;width:14px;flex:none;border-radius:7px;overflow:hidden;background:#1d1714;box-shadow:inset 0 0 0 1px rgba(0,0,0,.6),0 4px 10px rgba(0,0,0,.4)}
.chess-eval i{position:absolute;left:0;right:0;bottom:0;background:#f4ecd8;transition:height .4s var(--ease)}
.chess-eval b{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%) rotate(-90deg);font-size:.6rem;color:#888;mix-blend-mode:difference;white-space:nowrap}
.chess-notes{padding:10px 12px}
.chess-line{display:flex;gap:8px;font-size:.8rem;line-height:1.3;padding:3px 0;opacity:.75}
.chess-line.top{opacity:1}
.chess-line b{min-width:42px;font-family:var(--font-display)}
.chess-line span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.chess-moves{margin:0;padding-left:28px;max-height:220px;overflow-y:auto;font-size:.88rem;columns:2;column-gap:16px}
.chess-moves li{break-inside:avoid}
.chess-moves span{display:inline-block;min-width:52px}
.chess-movehead{cursor:default;user-select:none;-webkit-user-select:none}
.chess-status{text-align:center}
.chess-promo{max-width:360px;text-align:center}
.chess-promo .row{justify-content:center;margin:8px 0 12px}
.chess-promo button[data-promo]:not(.small){width:64px;height:64px;padding:6px}
.chess-promo svg{width:100%;height:100%}
@media (max-width:640px){.chess-frame{padding:6px}.chess-eval{width:10px}.chess-moves{columns:1}}
`;

export default {
  id: 'chess', name: 'Chess',
  description: 'The classic game of kings, on a walnut board. Full rules, chess clocks, draw offers, and a computer opponent.',
  minPlayers: 2, maxPlayers: 2,
  options: [{ id: 'clock', label: '⏱ Clock', default: '10+5', choices: CLOCKS }, { id: 'level', label: '🤖 Computer level', default: 'easy', choices: LEVELS }],
  cover: `<svg viewBox="0 0 320 200" role="img" aria-label="Chess pieces on a wooden board">${DEFS.replace(/<svg[^>]*>|<\/svg>/g, '')}<defs><linearGradient id="chess-cv" x2="0" y2="1"><stop stop-color="#3a2314"/><stop offset="1" stop-color="#140a04"/></linearGradient></defs>
    <rect width="320" height="200" fill="url(#chess-cv)"/><g transform="translate(160 150) scale(1 .42) rotate(45)">${Array.from({ length: 36 }, (_, i) => `<rect x="${(i % 6) * 34 - 102}" y="${Math.floor(i / 6) * 34 - 102}" width="34" height="34" fill="${(i % 6 + Math.floor(i / 6)) % 2 ? '#a6764b' : '#ecd8b0'}"/>`).join('')}</g>
    <circle cx="160" cy="70" r="90" fill="#ffd890" opacity=".08"/>
    ${[['k', 112, 46, 74], ['Q', 168, 40, 82], ['n', 70, 92, 54], ['P', 226, 100, 46], ['B', 258, 78, 54]].map(([p, x, y, s]) => `<g transform="translate(${x} ${y}) scale(${s / 100})"><g fill="url(#chess-${colorOf(p)})" stroke="${colorOf(p) === 'w' ? '#2b1d10' : '#050302'}" stroke-width="3" stroke-linejoin="round" style="filter:drop-shadow(0 6px 4px rgba(0,0,0,.6))">${SHAPES[p.toLowerCase()]}</g></g>`).join('')}</svg>`,
  howTo: {
    goal: 'Checkmate the other king: attack it so that it has no safe square to escape to.',
    turn: [
      ['♟', 'Pick a piece', 'Tap one of your pieces. The squares it can move to light up (rings mean a capture).'],
      ['🎯', 'Move it', 'Tap a highlighted square. Pawns reaching the far side choose a new piece.'],
      ['♚', 'Special moves', 'Castling (move the king two squares toward a rook) and en passant are supported automatically.'],
      ['½', 'Draws', 'Stalemate, threefold repetition, the fifty-move rule and bare kings end the game in a draw. You can also offer a draw, or resign.'],
    ],
    tips: ['Colours are drawn at random. White moves first.', 'The host picks the clock in the lobby. Your time only runs on your turn, White’s starts after the first move, and each move can add a few bonus seconds. Run out and you lose (it’s a draw if your opponent can’t possibly checkmate).', 'The captured-pieces row shows who is ahead in material.', 'Add a computer player to practise. The host picks its level in the lobby, from Easy up to Master.'],
  },
  setup, act, bot,
  turnOf: (s) => (s.over ? [] : [s.players.find((p) => p.color === s.turn).id]),
  // The host's time travels with the view so every screen's clock agrees.
  view: (s) => Object.assign(JSON.parse(JSON.stringify(s)), s.clock ? { hostNow: Date.now() } : {}),
  render,
};
