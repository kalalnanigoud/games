// Scratch checks for Mosaic Palace: scoring, tile conservation, bot strength.
//   node tools/mosaic-test.mjs
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const g = (await import(pathToFileURL(path.resolve('games', 'mosaic.js')).href)).default;
const MARKER = 100;
const colorOf = (t) => (t / 20) | 0;
const clone = (o) => JSON.parse(JSON.stringify(o));

function countTiles(s) {
  const all = [...s.bag, ...s.lid, ...s.factories.flat(), ...s.centre.filter((t) => t !== MARKER)];
  for (const b of s.boards) {
    all.push(...b.lines.flat(), ...b.floor.filter((t) => t !== MARKER));
    for (const row of b.wall) for (const t of row) if (t !== null) all.push(t);
  }
  return all;
}

function legalMoves(v, pid) {
  const seat = v.players.findIndex((p) => p.id === pid);
  const b = v.boards[seat];
  const out = [];
  const srcs = v.factories.map((f, i) => [i, f]).concat([['c', v.centre]]);
  for (const [src, ts] of srcs) {
    const cols = new Set(ts.filter((t) => t !== MARKER).map(colorOf));
    for (const k of cols) {
      out.push({ type: 'take', src, color: k, line: -1 });
      for (let r = 0; r < 5; r++) {
        const ln = b.lines[r];
        if (ln.length >= r + 1) continue;
        if (ln.length && colorOf(ln[0]) !== k) continue;
        if (b.wall[r][(k + r) % 5] !== null) continue;
        out.push({ type: 'take', src, color: k, line: r });
      }
    }
  }
  return out;
}
const randomBot = (v, pid) => { const m = legalMoves(v, pid); return m[Math.floor(Math.random() * m.length)]; };
// Greedy "fill any line, prefer more tiles placed" bot as a slightly better baseline.
const greedyBot = (v, pid) => {
  const seat = v.players.findIndex((p) => p.id === pid);
  const b = v.boards[seat];
  let best = null, bv = -1e9;
  for (const m of legalMoves(v, pid)) {
    const src = m.src === 'c' ? v.centre : v.factories[m.src];
    const n = src.filter((t) => t !== MARKER && colorOf(t) === m.color).length;
    let val;
    if (m.line < 0) val = -n * 2;
    else { const free = m.line + 1 - b.lines[m.line].length; val = Math.min(n, free) - 1.5 * Math.max(0, n - free); }
    val += Math.random() * 0.1;
    if (val > bv) { bv = val; best = m; }
  }
  return best;
};

function play(n, bots) {
  const players = Array.from({ length: n }, (_, i) => ({ id: 'P' + i, name: 'P' + i }));
  let s = g.setup(players);
  let steps = 0;
  while (!s.over) {
    if (++steps > 5000) throw new Error('stuck');
    const [pid] = g.turnOf(s);
    const seat = +pid.slice(1);
    const v = clone(g.view(s, pid));
    const a = bots[seat](v, pid);
    g.act(s, pid, a);
    const tiles = countTiles(s);
    assert.equal(tiles.length, 100, 'tile count');
    assert.equal(new Set(tiles).size, 100, 'tile uniqueness');
    for (const b of s.boards) {
      assert.ok(b.floor.length <= 7, 'floor <= 7');
      b.lines.forEach((ln, r) => { assert.ok(ln.length <= r + 1); assert.ok(ln.every((t) => colorOf(t) === colorOf(ln[0]))); });
      b.wall.forEach((row, r) => row.forEach((t, c) => { if (t !== null) assert.equal(colorOf(t), (c - r + 5) % 5, 'wall colour'); }));
      assert.ok(b.score >= 0);
    }
    s = clone(s);
  }
  return s;
}

// 1. tile scoring via a crafted board
{
  const s = g.setup([{ id: 'A', name: 'A' }, { id: 'B', name: 'B' }]);
  const b = s.boards[0];
  // wall row 0: place colours so that cols 0,1 are filled; row 1 col 1 filled
  const tile = (k, i = 0) => k * 20 + i;
  b.wall[0][0] = tile(0, 0); b.wall[0][1] = tile(1, 0); b.wall[1][1] = tile(0, 1);
  // line 0 gets colour at col 2 of row 0: colour (2-0+5)%5 = 2
  b.lines[0] = [tile(2, 5)];
  // line 1 full with colour for col 0 of row 1: (0-1+5)%5 = 4
  b.lines[1] = [tile(4, 5), tile(4, 6)];
  // empty the table so the next move ends the round
  s.factories = s.factories.map(() => []);
  s.factories[0] = [tile(3, 10)];
  s.centre = [100];
  s.cur = 0;
  const before = b.score;
  g.act(s, 'A', { type: 'take', src: 0, color: 3, line: 4 });
  // row 0: placing col 2 → horizontal run 3 (cols 0..2), vertical 1 → 3
  // row 1: placing col 0 → horizontal run 2 (cols 0..1), vertical run 2 (rows 0..1 at col 0) → 4
  assert.equal(s.boards[0].score - before, 7, 'scoring 3 + 4');
  assert.equal(s.tiling.rows[0][0].g, 3);
  assert.equal(s.tiling.rows[1][0].g, 4);
  console.log('scoring ok');
}

// 2. floor penalty and score floor at 0
{
  const s = g.setup([{ id: 'A', name: 'A' }, { id: 'B', name: 'B' }]);
  s.factories = s.factories.map(() => []);
  s.factories[0] = [0, 1, 2, 3];
  s.centre = [100, 20, 21, 22];
  s.cur = 0;
  g.act(s, 'A', { type: 'take', src: 'c', color: 1, line: -1 }); // marker + 3 → floor 4 tiles
  assert.equal(s.boards[0].floor.length, 4);
  g.act(s, 'B', { type: 'take', src: 0, color: 0, line: -1 }); // 4 → floor; round ends
  assert.equal(s.boards[0].score, 0, 'score never below 0');
  assert.equal(s.tiling.floor.find((f) => f.p === 1).pen, 0);
  assert.equal(s.start, 0, 'marker holder starts');
  assert.ok(s.centre.includes(100), 'marker back in centre');
  console.log('floor ok');
}

// 3. conservation + bot strength
for (const n of [2, 3, 4]) {
  let wins = 0, games = 40, botScore = 0, oppScore = 0, rounds = 0;
  for (let i = 0; i < games; i++) {
    const bots = Array.from({ length: n }, (_, j) => (j === 0 ? g.bot : randomBot));
    const s = play(n, bots);
    if (s.winners.includes('P0')) wins++;
    botScore += s.boards[0].score;
    oppScore += s.boards.slice(1).reduce((a, b) => a + b.score, 0) / (n - 1);
    rounds += s.round;
  }
  console.log(`${n}p bot vs random: won ${wins}/${games}, avg ${Math.round(botScore / games)} vs ${Math.round(oppScore / games)}, avg rounds ${(rounds / games).toFixed(1)}`);
}
for (const n of [2, 4]) {
  let wins = 0, games = 40, botScore = 0, oppScore = 0;
  for (let i = 0; i < games; i++) {
    const bots = Array.from({ length: n }, (_, j) => (j === 0 ? g.bot : greedyBot));
    const s = play(n, bots);
    if (s.winners.includes('P0')) wins++;
    botScore += s.boards[0].score;
    oppScore += s.boards.slice(1).reduce((a, b) => a + b.score, 0) / (n - 1);
  }
  console.log(`${n}p bot vs greedy: won ${wins}/${games}, avg ${Math.round(botScore / games)} vs ${Math.round(oppScore / games)}`);
}
{
  let total = 0, games = 40, rounds = 0;
  for (let i = 0; i < games; i++) { const s = play(2, [g.bot, g.bot]); total += s.boards[0].score + s.boards[1].score; rounds += s.round; }
  console.log(`2p bot vs bot: avg score ${Math.round(total / games / 2)}, avg rounds ${(rounds / games).toFixed(1)}`);
}
console.log('all checks passed');
