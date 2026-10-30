// Rule checks for the cooperative escape rooms: node tools/escape-test.mjs
// Bot teams at every size, privacy of each player's view, illegal actions, hints, and scripted solves.
import assert from 'node:assert/strict';
import { GAMES } from '../games/index.js';

globalThis.escapeBotIdle = 0.3; // fewer idle ticks: faster simulated games
const games = GAMES.filter((g) => ['keeper', 'signal'].includes(g.id));
assert.equal(games.length, 2);
const team = (n) => Array.from({ length: n }, (_, i) => ({ id: 'P' + i, name: 'Player ' + i }));
const json = (x) => JSON.parse(JSON.stringify(x));

for (const g of games) {
  assert.equal(g.minPlayers, 1); assert.equal(g.maxPlayers, 4); assert.ok(g.simultaneous);
  assert.throws(() => g.setup([])); assert.throws(() => g.setup(team(5))); assert.throws(() => g.setup([{ id: 'A' }, { id: 'A' }]));
  for (let n = 1; n <= 4; n++) {
    let steps = 0;
    for (let run = 0; run < 30; run++) {
      let s = g.setup(team(n));
      assert.deepEqual(g.turnOf(s), s.players.map((p) => p.id), 'everyone may act at once');
      let turns = 0;
      while (!s.over) {
        const pid = 'P' + Math.floor(Math.random() * n), before = JSON.stringify(s);
        for (const bad of [null, {}, { type: 'go', room: '__proto__' }, { type: 'look', obj: 'constructor' }, { type: 'code', obj: 'nothing', value: [0] }, { type: 'share', frag: 'toString' }])
          assert.throws(() => g.act(s, pid, bad));
        assert.equal(JSON.stringify(s), before, 'illegal actions must not change the state');
        const v = json(g.view(s, pid));
        assert.equal(v.secret, undefined, 'answers never reach a player');
        for (const f of v.frags) assert.equal(!!f.text, f.owner === pid || f.shared, 'only owned or shared fragments are readable');
        g.act(s, pid, g.bot(v, pid));
        s = json(s);
        assert.ok(++turns < 5000, `${g.id} ${n}p did not finish`);
      }
      steps += turns;
      assert.equal(s.won, true); assert.deepEqual(s.winners, s.players.map((p) => p.id)); assert.deepEqual(g.turnOf(s), []);
      assert.throws(() => g.act(s, 'P0', { type: 'think' }));
    }
    console.log(`${g.id}, ${n} player${n > 1 ? 's' : ''}: 30/30 bot teams escaped, avg ${Math.round(steps / 30)} moves`);
  }
}

// Scripted solves straight from the hidden answers, plus wrong tries, locked doors and hints.
const play = (g, s, pid, actions) => actions.forEach((a) => g.act(s, pid, a));
const go = (room) => ({ type: 'go', room });
{
  const g = games.find((x) => x.id === 'keeper');
  const s = g.setup(team(2)), sec = s.secret;
  assert.throws(() => g.act(s, 'P0', go('study')), /locked/);
  assert.throws(() => g.act(s, 'P0', { type: 'take', obj: 'fireplace' }), /nothing like that/);
  g.act(s, 'P0', { type: 'hint' }); g.act(s, 'P1', { type: 'hint' }); g.act(s, 'P0', { type: 'hint' });
  assert.match(s.hints[2].text, new RegExp(String(sec.year)));
  assert.throws(() => g.act(s, 'P0', { type: 'hint' }), /no more hints/);
  const wrong = String(sec.year === 1842 ? 1857 : 1842).split('').map(Number);
  g.act(s, 'P0', { type: 'code', obj: 'toolbox', value: wrong });
  assert.equal(s.flags.toolbox, undefined); assert.equal(s.attempts, 1);
  assert.throws(() => g.act(s, 'P0', { type: 'code', obj: 'toolbox', value: [1, 2, 3] }), /dial/);
  play(g, s, 'P0', [{ type: 'take', obj: 'rack' }, { type: 'code', obj: 'toolbox', value: String(sec.year).split('').map(Number) }]);
  assert.deepEqual(s.inv, ['oilcan', 'brasskey']);
  assert.throws(() => g.act(s, 'P0', { type: 'use', obj: 'frontdoor', item: 'oilcan' }), /doesn't help/);
  play(g, s, 'P0', [{ type: 'use', obj: 'stairdoor', item: 'brasskey' }, go('study')]);
  assert.throws(() => g.act(s, 'P1', { type: 'take', obj: 'fireplace' }), /Go to the Study/);
  play(g, s, 'P1', [go('study'), { type: 'take', obj: 'fireplace' }, { type: 'code', obj: 'bookshelf', value: sec.window.slice().reverse() }, go('gears')]);
  play(g, s, 'P1', [{ type: 'use', obj: 'pendulum', item: 'oilcan' }, { type: 'use', obj: 'train', item: 'gear' }]);
  assert.ok(!s.open.includes('belfry'));
  play(g, s, 'P1', [{ type: 'use', obj: 'weights', item: 'crank' }, go('belfry')]);
  assert.throws(() => g.act(s, 'P1', { type: 'take', obj: 'keeper' }), /nothing like that/);
  play(g, s, 'P1', [{ type: 'code', obj: 'clockface', value: [sec.hour - 1, sec.minute / 5] }, { type: 'take', obj: 'keeper' }, go('workshop'), { type: 'use', obj: 'frontdoor', item: 'towerkey' }]);
  assert.equal(s.won, true); assert.equal(s.hintsUsed, 3);
}
{
  const g = games.find((x) => x.id === 'signal');
  const s = g.setup(team(3)), sec = s.secret;
  assert.deepEqual([s.owner.sheetA, s.owner.sheetB, s.owner.codebook, s.owner.calib], ['P0', 'P1', 'P2', 'P0']);
  const p1 = JSON.stringify(g.view(s, 'P1'));
  assert.ok(!p1.includes('top of the sonar screen points') && !p1.includes('BEACON PULSE CODE') && p1.includes('MAIN POWER') === false, 'teammates’ fragments stay private');
  assert.ok(p1.includes('continued from page 1'), 'your own fragment is readable');
  assert.throws(() => g.act(s, 'P1', { type: 'share', frag: 'sheetA' }), /not on your wrist/);
  g.act(s, 'P0', { type: 'share', frag: 'sheetA' });
  assert.ok(JSON.stringify(g.view(s, 'P1')).includes('MAIN POWER'));
  assert.throws(() => g.act(s, 'P0', { type: 'share', frag: 'sheetA' }), /already/);
  play(g, s, 'P2', [{ type: 'take', obj: 'crate' }, { type: 'use', obj: 'hatch', item: 'crowbar' }, go('gen')]);
  assert.throws(() => g.act(s, 'P2', { type: 'code', obj: 'breakers', value: [1, 1, 1, 1, 1] }), /dead/);
  g.act(s, 'P2', { type: 'use', obj: 'socket', item: 'fuse' });
  g.act(s, 'P2', { type: 'code', obj: 'breakers', value: [1, 1, 1, 1, 1] });
  assert.equal(s.flags.power, undefined, 'all breakers on is never right');
  assert.throws(() => g.act(s, 'P2', go('comms')), /locked/);
  play(g, s, 'P2', [{ type: 'code', obj: 'breakers', value: sec.breakers.map(Number) }, go('comms'), { type: 'code', obj: 'decoder', value: sec.code.map((d) => d - 1) }, go('obs')]);
  g.act(s, 'P2', { type: 'code', obj: 'winch', value: [(sec.sonar.b + sec.offset) % 8, sec.sonar.ring] });
  assert.equal(s.won, true); assert.equal(s.attempts, 1);
}
// One player holds every fragment.
for (const g of games) { const s = g.setup(team(1)); for (const f of g.view(s, 'P0').frags) assert.ok(f.text); }
console.log('Escape room scripted solves, privacy, locked rooms, wrong tries and hints passed.');
