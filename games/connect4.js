import { esc, log } from '../js/util.js';

const W = 7, H = 6;
const COLORS = ['#ef4444', '#facc15'];

function findWin(b, i) {
  const p = b[i];
  const x0 = i % W, y0 = Math.floor(i / W);
  for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
    const line = [i];
    for (const s of [1, -1]) {
      let x = x0 + dx * s, y = y0 + dy * s;
      while (x >= 0 && x < W && y >= 0 && y < H && b[y * W + x] === p) {
        line.push(y * W + x);
        x += dx * s; y += dy * s;
      }
    }
    if (line.length >= 4) return line;
  }
  return null;
}

export default {
  id: 'connect4',
  name: 'Connect Four',
  emoji: '🔴',
  description: 'Drop discs and get four in a row before your opponent does.',
  minPlayers: 2,
  maxPlayers: 2,

  setup(players) {
    return { players: players.map((p) => p.id), board: Array(W * H).fill(-1), turn: 0, winner: null, winLine: [], over: false, log: ['Game started'] };
  },

  turnOf: (s) => (s.over ? [] : [s.players[s.turn]]),

  act(s, pid, a) {
    if (s.over) throw new Error('The game is over.');
    if (pid !== s.players[s.turn]) throw new Error('Not your turn.');
    if (a.type !== 'drop') throw new Error('Unknown move.');
    const col = a.col | 0;
    if (col < 0 || col >= W) throw new Error('Bad column.');
    let row = -1;
    for (let y = H - 1; y >= 0; y--) if (s.board[y * W + col] === -1) { row = y; break; }
    if (row < 0) throw new Error('That column is full.');
    const i = row * W + col;
    s.board[i] = s.turn;
    const line = findWin(s.board, i);
    if (line) {
      s.winner = s.turn; s.winLine = line; s.over = true;
      log(s, 'Four in a row!');
    } else if (s.board.every((c) => c !== -1)) {
      s.winner = 'draw'; s.over = true;
      log(s, 'Board full — draw.');
    } else s.turn = 1 - s.turn;
  },

  render(el, s, ctx) {
    const myIdx = s.players.indexOf(ctx.me);
    const status = s.over
      ? s.winner === 'draw' ? 'Draw!' : `🏆 ${esc(ctx.name(s.players[s.winner]))} wins!`
      : s.turn === myIdx ? 'Your turn — tap a column' : `${esc(ctx.name(s.players[s.turn]))}'s turn`;
    el.innerHTML = `
      <div class="game-layout">
        <div class="board-wrap"><div class="c4">
          ${s.board.map((c, i) => `<div class="cell ${c >= 0 ? 'p' + c : ''} ${s.winLine.includes(i) ? 'win' : ''}" data-col="${i % W}"></div>`).join('')}
        </div></div>
        <div class="side">
          <div class="panel stack">
            <div class="status ${!s.over && s.turn === myIdx ? 'myturn' : ''}">${status}</div>
            ${s.players.map((p, i) => `<div class="pchip ${!s.over && s.turn === i ? 'turn' : ''}"><span class="swatch" style="background:${COLORS[i]};border-radius:50%"></span><span class="grow">${esc(ctx.name(p))}</span></div>`).join('')}
          </div>
        </div>
      </div>`;
    el.querySelectorAll('[data-col]').forEach((c) => (c.onclick = () => ctx.send({ type: 'drop', col: +c.dataset.col })));
  },
};
