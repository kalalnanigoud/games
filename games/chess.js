// Chess for two: full rules (castling, en passant, promotion, check, mate, stalemate,
// fifty-move rule, threefold repetition, insufficient material), resign and draw offers.
//
// Private analysis: tapping the "Moves" heading three times quickly (or pressing ` on a keyboard)
// toggles a Stockfish evaluation bar and best-move arrows on this device only. The engine runs in
// this browser; nothing about it is stored in the game state or sent to anyone else.
import { esc, log, addFx, rand } from '../js/util.js';
import { injectCSS, morph } from '../js/fx.js';
import { sound } from '../js/sound.js';
import { icon } from '../js/icons.js';
import { portrait } from '../js/avatar.js';

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

// extra.previous: the game just finished, for a rematch. The players swap colours.
function setup(players, opts = {}, extra = {}) {
  if (players.length !== 2) throw Error('Chess needs exactly 2 players.');
  const wasWhite = extra.previous?.players?.find((p) => p.color === 'w')?.id;
  const white = players.some((p) => p.id === wasWhite) ? players.findIndex((p) => p.id !== wasWhite) : rand(2);
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

/* ---------------- cover art ---------------- */
// A late game in a lamplit study: she lifts a knight for the winning fork while her bow-tied
// opponent clutches his chin over his tea; the chess clock ticks between them. Ids are chc-…
// only, since covers appear several times on one page.
function coverSVG() {
  const f = (x) => Math.round(x * 10) / 10;
  const stop = ([o, c, a = 1]) => `<stop offset="${o}" stop-color="${c}"${a < 1 ? ` stop-opacity="${a}"` : ''}/>`;
  const lg = (id, stops, x2 = 0, y2 = 1) => `<linearGradient id="${id}" x1="0" y1="0" x2="${x2}" y2="${y2}">${stops.map(stop).join('')}</linearGradient>`;
  const rg = (id, stops, cx = 0.5, cy = 0.5, r = 0.5) => `<radialGradient id="${id}" cx="${cx}" cy="${cy}" r="${r}">${stops.map(stop).join('')}</radialGradient>`;
  const spark = (x, y, s, col = '#fff6d6') => `<path d="M${x} ${f(y - s)}L${f(x + s * 0.26)} ${f(y - s * 0.26)}L${f(x + s)} ${y}L${f(x + s * 0.26)} ${f(y + s * 0.26)}L${x} ${f(y + s)}L${f(x - s * 0.26)} ${f(y + s * 0.26)}L${f(x - s)} ${y}L${f(x - s * 0.26)} ${f(y - s * 0.26)}Z" fill="${col}"/>`;
  // the board lies in perspective: 8 x 8 squares, a1 at the left corner, h8 at the right
  const SQ = 10.5, BX = 160, BY = 147, SY = 0.4;
  const at = (file, rank) => { const u = (file - 3.5) * SQ, v = (3.5 - rank) * SQ; return [BX + (u - v) / Math.SQRT2, BY + (SY * (u + v)) / Math.SQRT2]; };
  const squares = Array.from({ length: 64 }, (_, i) => { const fl = i % 8, rk = Math.floor(i / 8); return `<rect x="${f((fl - 4) * SQ)}" y="${f((3 - rk) * SQ)}" width="${SQ}" height="${SQ}" fill="${(fl + rk) % 2 ? '#f0d9b5' : '#b58863'}"/>`; }).join('');
  const piece = (p, x, y, s, extra = '') => { const w = p === p.toUpperCase(); return `<g transform="translate(${f(x - 50 * s)} ${f(y - 90 * s)}) scale(${s})"${extra}><g fill="url(#chc-${w ? 'w' : 'b'})" stroke="${w ? '#2b1d10' : '#050302'}" stroke-width="4" stroke-linejoin="round">${SHAPES[p.toLowerCase()]}</g></g>`; };
  const onBoard = [['r', 0, 7], ['k', 6, 7], ['p', 5, 6], ['p', 6, 6], ['q', 3, 6], ['p', 4, 4], ['n', 5, 5], ['B', 2, 3], ['P', 4, 3], ['P', 5, 1], ['K', 6, 0], ['R', 4, 0], ['Q', 3, 0]]
    .map(([p, fl, rk]) => { const [x, y] = at(fl, rk); return { p, x, y }; }).sort((a, b) => a.y - b.y)
    .map(({ p, x, y }) => `<ellipse cx="${f(x)}" cy="${f(y)}" rx="3.8" ry="1.4" fill="#000" opacity=".3"/>${piece(p, x, y + 0.6, 0.18)}`).join('');
  const [ox, oy] = at(2, 2); // where the knight was lifted from (c3)
  const books = [[24, 34, 7, 18, '#e76f51'], [32, 30, 6, 22, '#2a9d8f'], [39, 36, 8, 16, '#e9c46a'], [48, 31, 5, 21, '#7c6cff'], [54, 34, 7, 18, '#ff6fae'], [62, 38, 10, 14, '#4cb8ff', -14],
    [24, 70, 9, 17, '#8ab17d'], [34, 67, 6, 20, '#ffcf5c'], [41, 69, 7, 18, '#e76f51'], [49, 66, 5, 21, '#5c7cfa'], [56, 72, 9, 15, '#f4a261'], [66, 68, 6, 19, '#2a9d8f'],
    [24, 104, 7, 18, '#ff8fab'], [32, 101, 8, 21, '#4cb8ff'], [41, 106, 6, 16, '#e9c46a'], [48, 102, 9, 20, '#7c6cff']]
    .map(([x, y, w, h, c, r]) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="1" fill="${c}"${r ? ` transform="rotate(${r} ${x + w} ${y + h})"` : ''}/><rect x="${x + 1}" y="${y + 3}" width="${w - 2}" height="1.2" fill="#fff" opacity=".35"/>`).join('');
  const stars = [[226, 30], [246, 24], [266, 40], [288, 28], [232, 56], [280, 62], [256, 70]].map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="${i % 2 ? 0.8 : 1.1}" fill="#fff" opacity=".85"/>`).join('');
  return `<svg viewBox="0 0 320 200" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid slice" role="img" aria-label="Two players at a chess board in a lamplit study; she lifts a knight while he ponders over his tea"><defs>` +
    lg('chc-wall', [[0, '#1b2758'], [0.6, '#131c44'], [1, '#0c1230']]) +
    lg('chc-sky', [[0, '#3a4fa0'], [0.7, '#1a2560'], [1, '#121a46']]) +
    lg('chc-shelf', [[0, '#3a2d4e'], [1, '#231a33']]) +
    lg('chc-wood', [[0, '#6b4a34'], [0.5, '#4e3424'], [1, '#2c1d14']]) +
    lg('chc-top', [[0, '#7a5640'], [1, '#55392a']]) +
    lg('chc-w', [[0, '#fffdf6'], [0.55, '#efe2c4'], [1, '#c9b58c']], 0.6, 1) +
    lg('chc-b', [[0, '#6a5a4c'], [0.45, '#2f2620'], [1, '#110c09']], 0.6, 1) +
    lg('chc-sweater', [[0, '#3ad1b2'], [1, '#1b7f73']]) +
    lg('chc-cardigan', [[0, '#c2415d'], [1, '#6e1a33']]) +
    lg('chc-shade', [[0, '#ffd98a'], [1, '#e0962f']]) +
    lg('chc-cone', [[0, '#ffe3a0', 0.42], [1, '#ffe3a0', 0]]) +
    lg('chc-metal', [[0, '#e8ecf6'], [1, '#8a93a8']]) +
    rg('chc-skin', [[0, '#fbe0c8'], [1, '#e2ab84']], 0.4, 0.35, 0.75) +
    rg('chc-skin2', [[0, '#f3cfae'], [1, '#c98f68']], 0.4, 0.35, 0.75) +
    rg('chc-pool', [[0, '#ffd27a', 0.42], [1, '#ffd27a', 0]]) +
    rg('chc-glow', [[0, '#fff2c0', 0.9], [1, '#ffcf70', 0]]) +
    rg('chc-vig', [[0.62, '#000', 0], [1, '#000', 0.5]], 0.5, 0.45, 0.75) +
    `</defs>` +
    // the study: bookshelf, night window, wainscot
    `<rect width="320" height="200" fill="url(#chc-wall)"/><path d="M0 128H320V200H0Z" fill="#101838"/><path d="M0 128H320" stroke="#ffffff" stroke-opacity=".07" stroke-width="2"/>` +
    `<rect x="18" y="16" width="62" height="114" rx="3" fill="url(#chc-shelf)"/><rect x="22" y="20" width="54" height="106" fill="#150f22"/>` +
    `<path d="M22 52H76M22 88H76M22 124H76" stroke="#3a2d4e" stroke-width="4"/>${books}` +
    `<rect x="216" y="16" width="86" height="98" rx="4" fill="#2a2244"/><rect x="221" y="21" width="76" height="88" rx="2" fill="url(#chc-sky)"/>${stars}` +
    `<circle cx="282" cy="40" r="8" fill="#f6f1dc"/><circle cx="285.5" cy="37.5" r="7" fill="#1f2a66" opacity=".5"/>` +
    `<path d="M221 72H297M259 21V109" stroke="#2a2244" stroke-width="3"/><path d="M221 96l14-8 10 6 14-12 12 9 12-5 14 8v15H221z" fill="#0e1534" opacity=".9"/>` +
    `<g fill="#ffd27a" opacity=".75"><rect x="230" y="98" width="2" height="2"/><rect x="246" y="96" width="2" height="2"/><rect x="266" y="100" width="2" height="2"/><rect x="284" y="99" width="2" height="2"/></g>` +
    // the pendant lamp and its warm cone of light
    `<path d="M160 0V22" stroke="#0a0f26" stroke-width="1.6"/><path d="M134 156L150 34H170L186 156Z" fill="url(#chc-cone)"/>` +
    `<circle cx="160" cy="36" r="30" fill="url(#chc-glow)" opacity=".55"/><path d="M142 36C142 26 150 20 160 20S178 26 178 36Z" fill="url(#chc-shade)"/><rect x="141" y="35" width="38" height="3" rx="1.5" fill="#b56f1f"/><ellipse cx="160" cy="38.5" rx="7" ry="2.4" fill="#fffbe6"/>` +
    // her: bun, round glasses, teal sweater; lifting a white knight high over the board
    `<path d="M26 152C26 126 42 112 62 112C82 112 96 126 98 152Z" fill="url(#chc-sweater)"/><path d="M50 114Q62 124 74 114" fill="none" stroke="#e8fffa" stroke-width="2.4" stroke-linecap="round"/>` +
    `<rect x="57" y="100" width="10" height="14" rx="4" fill="#e7b38c"/><circle cx="62" cy="70" r="8" fill="#5a3322"/>` +
    `<path d="M45 92C44 76 52 70 62 70C73 70 80 77 79 92Z" fill="#6b3d28"/><circle cx="62" cy="88" r="14" fill="url(#chc-skin)"/>` +
    `<path d="M48 86Q52 74 62 75Q74 74 77 86Q70 79 61 81Q54 81 48 86Z" fill="#6b3d28"/>` +
    `<g fill="none" stroke="#1d2340" stroke-width="1.4"><circle cx="57.5" cy="89" r="4"/><circle cx="68.5" cy="89" r="4"/><path d="M61.5 89h3"/></g>` +
    `<circle cx="58.6" cy="90" r="1.5" fill="#2a1c1a"/><circle cx="69.6" cy="90" r="1.5" fill="#2a1c1a"/><circle cx="54" cy="95" r="2.6" fill="#ff7f8f" opacity=".35"/><circle cx="72" cy="95" r="2.6" fill="#ff7f8f" opacity=".35"/>` +
    `<path d="M58.5 96.5q4 3.4 8.5 0" fill="none" stroke="#7a2e35" stroke-width="1.5" stroke-linecap="round"/>` +
    `<path d="M84 122C94 116 104 110 113 105" fill="none" stroke="url(#chc-sweater)" stroke-width="8" stroke-linecap="round"/>` +
    `<path d="M${f(ox)} ${f(oy - 4)}Q${f(ox - 6)} 118 121 108" fill="none" stroke="#fff" stroke-width="1.2" stroke-dasharray="2.4 2.4" opacity=".6"/>` +
    `<circle cx="121" cy="100" r="15" fill="url(#chc-glow)" opacity=".45"/>` + piece('N', 121, 103, 0.3) +
    `<circle cx="117" cy="104" r="4.6" fill="#e7b38c"/><path d="M114 102.5q2.4-2.6 6-1.6" fill="none" stroke="#c48a64" stroke-width="1.1" stroke-linecap="round"/>` +
    spark(136, 84, 4.2) + spark(106, 80, 2.8) + spark(139, 104, 2.4) +
    // him: bald dome, side tufts, spectacles, white moustache, bow tie; one hand clutching his chin
    `<path d="M222 152C222 126 238 112 258 112C278 112 292 126 294 152Z" fill="url(#chc-cardigan)"/><path d="M248 113L258 128L268 113Z" fill="#f4f1ea"/>` +
    `<path d="M251 116l7 4l-7 4zM265 116l-7 4l7 4z" fill="#ffcf5c"/><circle cx="258" cy="120" r="1.8" fill="#e0a23a"/><path d="M258 128V152" stroke="#4a0f22" stroke-width="1.2" opacity=".6"/>` +
    `<rect x="253" y="100" width="10" height="14" rx="4" fill="#d9a074"/><ellipse cx="243.6" cy="90" rx="2.6" ry="3.8" fill="#d9a074"/><ellipse cx="272.4" cy="90" rx="2.6" ry="3.8" fill="#d9a074"/>` +
    `<circle cx="258" cy="87" r="15" fill="url(#chc-skin2)"/><path d="M245 82Q244 92 247 96M271 82Q272 92 269 96" fill="none" stroke="#e8e6ef" stroke-width="4" stroke-linecap="round"/>` +
    `<ellipse cx="253" cy="76" rx="5" ry="2.4" fill="#fff" opacity=".28"/>` +
    `<path d="M248 79q4-3.4 8-1M260 78q4-2.4 8 1" fill="none" stroke="#e8e6ef" stroke-width="1.8" stroke-linecap="round"/>` +
    `<g fill="none" stroke="#1d2340" stroke-width="1.4"><circle cx="252.5" cy="86" r="4.2"/><circle cx="263.5" cy="86" r="4.2"/><path d="M256.7 86h2.6"/></g>` +
    `<circle cx="251.4" cy="87" r="1.6" fill="#2a1c1a"/><circle cx="262.4" cy="87" r="1.6" fill="#2a1c1a"/>` +
    `<path d="M248 95q5-4 10-1q5-3 10 1q-3 4-10 2q-7 2-10-2z" fill="#f4f1ea"/><ellipse cx="258" cy="99.5" rx="2" ry="2.4" fill="#7a2e35"/>` +
    `<path d="M238 128C232 122 236 110 246 104" fill="none" stroke="url(#chc-cardigan)" stroke-width="8" stroke-linecap="round"/><circle cx="248" cy="103" r="4.8" fill="#d9a074"/>` +
    `<path d="M233 66a3 3 0 1 0 .1 0zM226 54a4.4 4.4 0 1 0 .1 0z" fill="#eef1ff" opacity=".9"/><ellipse cx="208" cy="40" rx="15" ry="12" fill="#eef1ff"/>` +
    `<text x="208" y="46" text-anchor="middle" font-family="Fredoka, Nunito, system-ui, sans-serif" font-weight="700" font-size="16" fill="#e8486a">!?</text>` +
    // the table: lamplight pooling on the board, the chess clock, his tea
    `<path d="M0 156Q160 132 320 156V200H0Z" fill="url(#chc-wood)"/><path d="M0 156Q160 132 320 156" fill="none" stroke="url(#chc-top)" stroke-width="3"/>` +
    `<ellipse cx="160" cy="150" rx="86" ry="20" fill="url(#chc-pool)"/>` +
    `<g transform="translate(${BX} ${BY + 2.5}) scale(1 ${SY}) rotate(45)"><rect x="${-4 * SQ - 3}" y="${-4 * SQ - 3}" width="${8 * SQ + 6}" height="${8 * SQ + 6}" rx="2" fill="#1a2350"/></g>` +
    `<g transform="translate(${BX} ${BY}) scale(1 ${SY}) rotate(45)"><rect x="${-4 * SQ - 3}" y="${-4 * SQ - 3}" width="${8 * SQ + 6}" height="${8 * SQ + 6}" rx="2" fill="#2a3a78"/>${squares}</g>` +
    `<ellipse cx="${f(ox)}" cy="${f(oy)}" rx="4.5" ry="1.8" fill="#4cb8ff" opacity=".55"/>` + onBoard +
    `<g transform="translate(48 170)"><rect x="-22" y="-12" width="44" height="22" rx="5" fill="#141b3d" stroke="#3a4a8a" stroke-width="1"/>` +
    `<rect x="-15" y="-16" width="9" height="4" rx="1.5" fill="#ffcf5c"/><rect x="6" y="-14" width="9" height="2.4" rx="1.2" fill="#7c6cff"/>` +
    `<circle cx="-10" cy="-1" r="7" fill="#f6f4ee"/><circle cx="10" cy="-1" r="7" fill="#f6f4ee"/><path d="M-10 -1V-5.5M-10 -1L-7 1M10 -1V-6M10 -1L6.5 -2.4" stroke="#141b3d" stroke-width="1.3" stroke-linecap="round"/>` +
    `<path d="M5.2 -5.4l2.2 1.4" stroke="#e8486a" stroke-width="1.5" stroke-linecap="round"/></g>` +
    `<g transform="translate(286 166)"><ellipse cx="0" cy="6" rx="16" ry="4" fill="url(#chc-metal)"/><path d="M-10 -8H10L8 4Q0 8-8 4Z" fill="#eef1ff"/><path d="M10 -5Q17 -4 15 1Q13 4 8.5 2.5" fill="none" stroke="#eef1ff" stroke-width="2"/>` +
    `<ellipse cx="0" cy="-8" rx="10" ry="2.4" fill="#8a5a2a"/><path d="M-3 -13q-3-5 0-9t0-9M4 -14q-3-4 0-7t0-7" fill="none" stroke="#fff" stroke-width="1.2" stroke-linecap="round" opacity=".45"/></g>` +
    `<rect width="320" height="200" fill="url(#chc-vig)"/></svg>`;
}

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
function clockHTML(color) {
  const ms = remaining(color), run = !CLK.over && !!CLK.c?.since && CLK.turn === color;
  return `<span class="chess-clock${run ? ' run' : ''}${run && ms < 20000 ? ' low' : ''}" data-c="${color}" data-k="clock-${color}${run ? '-run' : ''}" data-noenter>${clockText(ms)}</span>`;
}

// The move list folds away on phones so the board gets the screen; it stays as the player left it.
let movesOpen = typeof matchMedia === 'function' ? matchMedia('(min-width: 901px)').matches : true;
const LAND = { game: null, n: -1 }; // the last game and move count drawn, for the landing pulse
// Small line icons in the shared style for the draw and resign buttons.
const svgIc = (d) => `<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${d}</svg>`;
const DRAW_IC = svgIc('<path d="M12 4v16M8 20h8M5 7h14M5 7l-2.5 6a2.6 2.6 0 0 0 5 0zM19 7l-2.5 6a2.6 2.6 0 0 0 5 0z"/>');
const FLAG_IC = svgIc('<path d="M6 21V4M6 4.5h11l-2.2 4 2.2 4H6"/>');

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
  // A new move arrived: the square it landed on gives one soft pulse (never on local redraws).
  const game = v.players.map((p) => p.id + p.color).join();
  const landed = LAND.game === game && v.sans.length > LAND.n && v.last ? v.last.to : -1;
  LAND.game = game; LAND.n = v.sans.length;
  // The piece just picked up lifts with a little spring; later redraws keep it lifted, still.
  const lift = UI.tap;
  UI.tap = null;

  const pieces = [];
  const squares = order.map((i, k) => {
    const p = v.board[i], dark = ((i >> 3) + (i & 7)) % 2 === 1, t = targets.find((m) => m.to === i);
    const held = p !== '.' && UI.sel === i;
    if (p !== '.' && !held) pieces.push(`<div class="chess-pc" data-k="pc-${v.ids[i]}" data-at="${i}" style="grid-area:${(k >> 3) + 1}/${(k & 7) + 1}/${(k >> 3) + 2}/${(k & 7) + 2}">${pieceSVG(p)}</div>`);
    const cls = ['chess-sq', dark ? 'dark' : 'light', v.last && (v.last.from === i || v.last.to === i) ? 'last' : '', UI.sel === i ? 'sel' : '', t ? (p !== '.' || t.flag === 'ep' ? 'cap' : 'dot') : '', i === checkSq ? 'check' : '',
      myTurn && colorOf(p) === v.turn && moves.some((m) => m.from === i) ? 'mine' : ''].filter(Boolean).join(' ');
    const label = `${sqName(i)}${p !== '.' ? ', ' + (colorOf(p) === 'w' ? 'white ' : 'black ') + NAMES[p.toLowerCase()] : ''}`;
    return `<div class="${cls}" data-sq="${i}" role="button" aria-label="${label}">${k % 8 === 0 ? `<span class="chess-rank">${8 - (i >> 3)}</span>` : ''}${k >= 56 ? `<span class="chess-file">${FILES[i & 7]}</span>` : ''}${i === landed ? `<i class="chess-land" data-k="land-${v.sans.length}" data-noenter aria-hidden="true"></i>` : ''}${held ? `<div class="chess-pc${i === lift ? ' lift' : ''}" data-k="pc-${v.ids[i]}">${pieceSVG(p)}</div>` : ''}</div>`;
  }).join('');

  // Player bars: the lobby portrait ringed in the side's colour, with a little king badge.
  const chip = (p) => {
    const taken = v.taken[p.color], diff = material(v.board, p.color);
    const active = !v.over && v.turn === p.color;
    return `<div class="pchip chess-chip ${p.color} ${active ? 'turn' : ''}"><span class="chess-face">${portrait({ id: p.id, bot: !!ctx.isBot?.(p.id) })}<span class="chess-dot ${p.color}" title="${p.color === 'w' ? 'White' : 'Black'}">${pieceSVG(p.color === 'w' ? 'K' : 'k')}</span></span>
      <span class="chess-who"><b>${esc(p.name)}</b>${p.id === ctx.me ? '<span class="tag t-you">You</span>' : ''}</span>
      <span class="chess-taken">${taken.slice().sort((a, b) => VAL[b] - VAL[a]).map((t) => `<i>${pieceSVG(p.color === 'w' ? t : t.toUpperCase())}</i>`).join('')}${diff > 0 ? `<small>+${Math.round(diff / 100)}</small>` : ''}</span>${v.clock ? clockHTML(p.color) : ''}</div>`;
  };
  const status = v.over ? `${esc(v.reason)} (${v.result})`
    : myTurn ? (checkSq >= 0 ? 'Check! Your move' : 'Your move') + ` · ${v.turn === 'w' ? 'White' : 'Black'}`
    : `${esc(v.players.find((p) => p.color === v.turn).name)} is thinking…${checkSq >= 0 ? ' (in check)' : ''}`;
  const n = v.sans.length;
  const rows = [];
  const cell = (j) => `<span${j === n - 1 ? ' class="now"' : ''}>${esc(v.sans[j] || '')}</span>`;
  for (let i = 0; i < n; i += 2) rows.push(`<li>${cell(i)}${cell(i + 1)}</li>`);
  const latest = n ? `${Math.ceil(n / 2)}.${n % 2 ? '' : '..'} ${esc(v.sans[n - 1])}` : '';
  const offerFromThem = v.drawOffer && v.drawOffer !== ctx.me;
  const banner = v.winners.length ? `${icon('trophy')} ${v.winners.includes(ctx.me) ? 'You win!' : esc(v.players.find((p) => p.id === v.winners[0]).name) + ' wins'}` : `${DRAW_IC} Draw`;

  // Redraw only what changed: kept squares and pieces aren't restyled or repainted.
  morph(el, `${DEFS}<div class="chess-root"><div class="game-layout">
    <div class="chess-main felt chess-felt">
      ${v.over ? `<div class="winner-banner">${banner}</div>` : ''}
      ${chip(opp)}
      <div class="chess-boardrow">
        ${A.on ? '<div class="chess-eval" aria-hidden="true"><i></i><b>…</b></div>' : ''}
        <div class="chess-frame"><div class="chess-board">${squares}<div class="chess-pcs">${pieces.join('')}</div><svg class="chess-arrows" viewBox="0 0 800 800" aria-hidden="true"></svg></div></div>
      </div>
      ${chip(mine)}
      <div class="status ${myTurn ? 'myturn' : ''} chess-status">${status}</div>
    </div>
    <div class="side chess-side">
      ${me && !v.over ? `<div class="panel chess-actions"><div class="row">
        ${offerFromThem ? `<button class="good" data-act="accept">${icon('check')}Accept draw</button>` : `<button data-act="offer" ${v.drawOffer ? 'disabled' : ''}>${DRAW_IC}${v.drawOffer ? 'Draw offered' : 'Offer draw'}</button>`}
        <button class="bad" data-act="resign">${FLAG_IC}Resign</button></div>
        ${offerFromThem ? `<p class="small muted" style="margin:8px 0 0">${esc(opp.name)} offers a draw. Playing a move declines it.</p>` : ''}</div>` : ''}
      ${A.on ? '<div class="panel chess-notes"><div class="chess-lines"></div></div>' : ''}
      <details class="panel drawer chess-movesbox" ${movesOpen ? 'open' : ''}><summary>${icon('book')}<span class="chess-movehead">Moves</span><span class="note">${latest}</span>${icon('chevron', 'chev')}</summary>
        <div class="drawer-body">${rows.length ? `<ol class="chess-moves">${rows.join('')}</ol>` : '<p class="muted small">White moves first.</p>'}
          <div class="log chess-log">${v.log.slice(0, 6).map((l) => `<div>${esc(l)}</div>`).join('')}</div></div></details>
    </div>
  </div>
  ${UI.promo ? `<div class="modal-bg"><div class="modal panel chess-promo"><h3>Promote to</h3><div class="row">${'qrbn'.split('').map((q) => `<button data-promo="${q}" aria-label="${NAMES[q]}">${pieceSVG(myColor === 'w' ? q.toUpperCase() : q)}</button>`).join('')}</div><button class="small ghost" data-promo="">${icon('close')}Cancel</button></div></div>` : ''}</div>`);

  el.querySelectorAll('[data-sq]').forEach((d) => (d.onclick = () => {
    if (!myTurn) return;
    const i = Number(d.dataset.sq), t = targets.filter((m) => m.to === i);
    if (t.length) {
      if (t[0].promo) { UI.promo = { from: UI.sel, to: i }; sound('click'); return redraw(); }
      const from = UI.sel; UI.sel = null;
      return ctx.send({ type: 'move', from, to: i });
    }
    UI.sel = colorOf(v.board[i]) === v.turn && UI.sel !== i && moves.some((m) => m.from === i) ? i : null;
    if (UI.sel != null) { sound('click'); UI.tap = UI.sel; }
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
  // Three quick taps on the "Moves" heading toggle private analysis on this device. The heading sits
  // in the drawer's summary: the third tap doesn't fold or unfold the drawer.
  el.querySelector('.chess-movehead').onclick = (e) => {
    const now = Date.now();
    A.taps = A.taps.filter((t) => now - t < 900).concat(now);
    if (A.taps.length >= 3) { A.taps = []; e.preventDefault(); toggleSight(redraw); }
  };
  // <details> toggle events don't bubble; a property (not a listener) since the drawer is kept between draws.
  const movesBox = el.querySelector('.chess-movesbox');
  if (movesBox) movesBox.ontoggle = (e) => { movesOpen = e.currentTarget.open; };
  tickClocks();
  if (A.on) { if (!v.over) analyse(fen(P), P); paint(); }
}

const STYLE = `
.chess-main{min-width:0;display:flex;flex-direction:column;gap:10px;--bw:min(100%,calc(74vh + 20px),660px)}
/* A calm study: deep navy baize under a warm desk lamp, with a faint pinstripe weave. */
.chess-felt{padding:14px 14px 12px;border-color:rgba(160,190,255,.16);background:
  radial-gradient(60% 50% at 14% -6%,rgba(255,206,140,.2),transparent 62%),
  radial-gradient(55% 45% at 100% 105%,rgba(76,184,255,.1),transparent 65%),
  repeating-linear-gradient(90deg,rgba(255,255,255,.016) 0 2px,transparent 2px 7px),
  radial-gradient(120% 100% at 50% 0%,#20366a 0%,#16284f 45%,#0d1736 100%)}
.chess-chip,.chess-status,.chess-main>.winner-banner{width:var(--bw);margin-left:auto;margin-right:auto}
.chess-main>.winner-banner{padding:4px}
.chess-main>.winner-banner .ic{width:1em;height:1em;vertical-align:-.12em}
/* player bars */
.chess-chip{min-height:52px;gap:10px;padding:7px 8px;background:rgba(8,14,38,.5);border-color:rgba(160,190,255,.14);transition:none}
.chess-chip.turn{border-color:rgba(255,207,92,.6);box-shadow:0 0 0 2px var(--gold),0 0 18px rgba(255,207,92,.28)}
.chess-face{position:relative;width:34px;height:34px;flex:none;border-radius:50%}
.chess-face .portrait{width:100%;height:100%;display:block;border-radius:50%}
.chess-chip.w .chess-face{box-shadow:0 0 0 2px #f4ecd8,0 2px 6px rgba(0,0,0,.45)}
.chess-chip.b .chess-face{box-shadow:0 0 0 2px #15131c,0 0 0 3.5px rgba(244,236,216,.55),0 2px 6px rgba(0,0,0,.45)}
.chess-dot{position:absolute;right:-6px;bottom:-5px;width:18px;height:18px;border-radius:50%;display:grid;place-items:center;background:#141b3d;box-shadow:0 0 0 1.5px rgba(160,190,255,.45),0 1px 3px rgba(0,0,0,.5)}
.chess-dot.b{background:#e9edfb;box-shadow:0 0 0 1.5px #141b3d,0 1px 3px rgba(0,0,0,.5)}
.chess-dot svg{width:15px;height:15px;display:block}
.chess-who{flex:1;min-width:0;display:flex;align-items:center;gap:7px}
.chess-who b{min-width:0;font-family:var(--font-display);font-weight:600;font-size:1rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.chess-taken{display:flex;align-items:center;flex-wrap:wrap;justify-content:flex-end;max-width:45%;min-width:0}
.chess-taken i{width:20px;height:20px;margin-left:-6px}.chess-taken i svg{width:100%;height:100%}
.chess-taken small{margin-left:6px;font-weight:800;color:var(--good)}
.chess-clock{flex:none;min-width:74px;padding:6px 12px;border-radius:12px;text-align:center;font-family:var(--font-display);font-weight:600;font-size:1.15rem;line-height:1.2;font-variant-numeric:tabular-nums;color:var(--muted);background:#0a1130;border:1px solid var(--line);box-shadow:inset 0 1px 3px rgba(0,0,0,.5);transition:background-color .2s,color .2s,box-shadow .2s}
.chess-clock.run{color:#141b3d;background:#eef1ff;border-color:transparent;box-shadow:0 0 0 2px var(--gold),0 0 14px rgba(255,207,92,.35)}
.chess-clock.low{color:#fff;background:var(--bad);box-shadow:0 0 0 2px #ffb3c0,0 0 16px rgba(255,107,129,.45)}
/* the board: classic two-tone squares in a crisp navy frame */
.chess-boardrow{display:flex;gap:8px;align-items:stretch;justify-content:center}
.chess-frame{flex:0 1 auto;width:var(--bw);min-width:0;padding:10px;border-radius:16px;background:linear-gradient(155deg,#364c94,#1e2c5e 45%,#111a3a);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.18),inset 0 -2px 0 rgba(0,0,0,.35),0 0 0 1px rgba(150,172,255,.28),0 22px 44px rgba(2,4,16,.6)}
.chess-board{position:relative;display:grid;grid-template-columns:repeat(8,1fr);aspect-ratio:1;width:100%;max-width:640px;margin:0 auto;border-radius:6px;overflow:hidden;box-shadow:0 0 0 1px rgba(5,8,24,.7),inset 0 0 24px rgba(0,0,0,.22);touch-action:manipulation;user-select:none;-webkit-user-select:none}
.chess-sq{position:relative;cursor:pointer}
.chess-sq.dot{width:auto;height:auto;border-radius:0;display:block}/* undo the shared status-light .dot rule */
.chess-sq.light{background:#f0d9b5;background-image:var(--grain);background-blend-mode:multiply}
.chess-sq.dark{background:#b58863;background-image:var(--grain);background-blend-mode:multiply}
.chess-sq.last::before{content:'';position:absolute;inset:0;background:rgba(255,214,90,.42)}
.chess-sq.sel::before{content:'';position:absolute;inset:0;background:rgba(76,184,255,.42);box-shadow:inset 0 0 0 3px rgba(255,255,255,.6)}
.chess-sq.check{background-image:radial-gradient(circle,#ff4a5e 0%,rgba(255,74,94,.6) 40%,transparent 72%)}
/* legal targets: a soft dot (a ring for captures) with a light rim, breathing slowly (opacity only) */
.chess-sq.dot::after{content:'';position:absolute;left:34%;top:34%;width:32%;height:32%;border-radius:50%;z-index:3;background:rgba(22,32,84,.45);box-shadow:0 0 0 3px rgba(255,255,255,.3);animation:chess-breathe 2.4s ease-in-out infinite;transition:scale .12s var(--ease)}
.chess-sq.cap::after{content:'';position:absolute;inset:5%;border-radius:50%;z-index:3;border:5px solid rgba(22,32,84,.45);box-shadow:0 0 0 2px rgba(255,255,255,.32),inset 0 0 0 2px rgba(255,255,255,.32);animation:chess-breathe 2.4s ease-in-out infinite;transition:scale .12s var(--ease)}
.chess-sq.dot:active::after,.chess-sq.cap:active::after{scale:.86}
@keyframes chess-breathe{50%{opacity:.5}}
/* pieces: the one you pick up lifts off the board; pressing dips it */
.chess-pc{position:absolute;inset:5%;z-index:2;pointer-events:none;transition:translate .2s var(--ease),scale .2s var(--ease)}
.chess-pc svg{width:100%;height:100%;display:block}
/* resting pieces sit in one layer over the board that casts all their shadows in a single pass */
.chess-pcs{position:absolute;inset:0;z-index:2;display:grid;grid-template-columns:repeat(8,1fr);grid-template-rows:repeat(8,1fr);pointer-events:none;filter:drop-shadow(0 3px 2px rgba(0,0,0,.45))}
.chess-sq .chess-pc svg{filter:drop-shadow(0 3px 2px rgba(0,0,0,.45))}
.chess-sq.sel .chess-pc{translate:0 -8%;scale:1.1;z-index:5}
.chess-sq.sel .chess-pc svg{filter:drop-shadow(0 9px 6px rgba(0,0,0,.4))}
.chess-pc.lift{animation:chess-lift .26s var(--spring)}
@keyframes chess-lift{from{translate:0 0;scale:1}}
.chess-sq.mine:active .chess-pc{scale:.94}
${Array.from({ length: 64 }, (_, i) => `.chess-sq.mine[data-sq="${i}"]:active~.chess-pcs>[data-at="${i}"]`).join(',')}{scale:.94}
.chess-sq.sel:active .chess-pc{scale:1.04}
/* where the latest move landed: one soft pulse */
.chess-land{position:absolute;inset:0;z-index:1;pointer-events:none;opacity:0;background:radial-gradient(circle,rgba(255,240,180,.95) 0%,rgba(255,214,90,.55) 42%,transparent 70%);animation:chess-land .8s var(--ease) .4s}
@keyframes chess-land{0%{opacity:.95;transform:scale(.5)}100%{opacity:0;transform:scale(1.35)}}
.chess-rank,.chess-file{position:absolute;font-family:var(--font-display);font-weight:600;font-size:.62rem;line-height:1;z-index:1;opacity:.9;color:#9a7552}
.chess-sq.dark .chess-rank,.chess-sq.dark .chess-file{color:#f6e7cc}
.chess-rank{left:3px;top:3px}.chess-file{right:4px;bottom:3px}
.chess-arrows{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:4}
.chess-eval{position:relative;width:14px;flex:none;border-radius:7px;overflow:hidden;background:#141b3d;box-shadow:inset 0 0 0 1px rgba(0,0,0,.6),0 4px 10px rgba(0,0,0,.4)}
.chess-eval i{position:absolute;left:0;right:0;bottom:0;background:#eef1ff;transition:height .4s var(--ease)}
.chess-eval b{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%) rotate(-90deg);font-size:.6rem;color:#888;mix-blend-mode:difference;white-space:nowrap}
.chess-notes{padding:10px 12px}
.chess-line{display:flex;gap:8px;font-size:.8rem;line-height:1.3;padding:3px 0;opacity:.75}
.chess-line.top{opacity:1}
.chess-line b{min-width:42px;font-family:var(--font-display)}
.chess-line span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.chess-status{text-align:center}
/* side: draw and resign, then the move list in a drawer */
.chess-actions .row{gap:8px;flex-wrap:nowrap}
.chess-actions button{flex:1 1 0;min-width:0;padding:8px 12px;white-space:nowrap}
.chess-movehead{cursor:inherit;user-select:none;-webkit-user-select:none}
.chess-movesbox>summary .note{min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-variant-numeric:tabular-nums}
.chess-moves{margin:0;padding-left:30px;max-height:220px;overflow-y:auto;font-size:.88rem;columns:2;column-gap:16px;color:var(--muted);font-variant-numeric:tabular-nums}
.chess-moves li{break-inside:avoid;padding:1px 0}
.chess-moves span{display:inline-block;min-width:52px;color:var(--text);font-weight:700}
.chess-moves span.now{color:var(--gold)}
.chess-log{max-height:150px;color:var(--muted);font-size:.82rem}
.chess-log div{border-bottom-color:var(--line)}
.chess-log div:first-child{color:var(--text)}
.chess-promo{max-width:360px;text-align:center}
.chess-promo h3{margin-top:0}
.chess-promo .row{justify-content:center;margin:8px 0 12px;gap:10px}
.chess-promo button[data-promo]:not(.small){width:68px;height:68px;padding:8px;border-radius:16px;background:radial-gradient(circle at 50% 35%,#34488c,#1a2753);border-color:rgba(160,190,255,.3)}
.chess-promo button[data-promo]:not(.small):hover:not(:disabled){background:radial-gradient(circle at 50% 35%,#3d54a0,#1f2e60)}
.chess-promo button[data-promo]:not(.small) svg{width:100%;height:100%}
@media (max-width:640px){.chess-felt{padding:8px}.chess-frame{padding:6px;border-radius:12px}.chess-eval{width:10px}.chess-moves{columns:1}
  .chess-chip{min-height:48px;gap:8px;padding:6px 7px}.chess-face{width:30px;height:30px}.chess-who b{font-size:.92rem}.chess-taken{max-width:36%}.chess-clock{min-width:62px;padding:5px 8px;font-size:1.02rem}}
`;

export default {
  id: 'chess', name: 'Chess',
  description: 'The classic game of kings in a quiet, lamplit study. Full rules, chess clocks, draw offers, and a computer opponent.',
  minPlayers: 2, maxPlayers: 2,
  options: [{ id: 'clock', label: '⏱ Clock', default: '10+5', choices: CLOCKS }, { id: 'level', label: '🤖 Computer level', default: 'easy', choices: LEVELS }],
  cover: coverSVG(),
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
