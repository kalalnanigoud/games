// Browser-side render audit. In a page served by `node serve.js`, run:
//   const m = await import('/tools/render-audit.js'); await m.audit(['gems'], { maxSteps: 400 })
// Plays bot-vs-bot games and renders states from every seat's point of view,
// reporting render crashes, sideways overflow and tiny buttons at the current viewport width.
//
// Timed games (Name Place Animal Thing, Atlas, Antakshari, Tambola…) wait on Date.now() deadlines, which a loop
// of instant moves never reaches. So each game runs on a virtual clock: every move takes a quarter of a second,
// and a move that changes nothing (a computer waiting for the bell) lets a whole second pass. A game that still
// hasn't finished when maxSteps runs out is reported with limit: true, which the CI treats as a failure.

export async function audit(ids, { maxSteps = 600, every = 3 } = {}) {
  const realNow = Date.now;
  try { return await run(ids, maxSteps, every, realNow); } finally { Date.now = realNow; }
}

async function run(ids, maxSteps, every, realNow) {
  const host = document.createElement('div');
  host.style.cssText = 'position:absolute;left:0;top:0;width:100%;opacity:0;pointer-events:none;z-index:-1';
  document.body.appendChild(host);
  const W = () => document.documentElement.clientWidth;
  const out = [];
  for (const id of ids) {
    const g = (await import(`/games/${id}.js?audit=${Date.now()}`)).default;
    for (const n of Array.from({ length: g.maxPlayers - g.minPlayers + 1 }, (_, i) => g.minPlayers + i)) {
      const players = Array.from({ length: n }, (_, i) => ({ id: 'P' + i, name: 'Player ' + i }));
      const ctx = (pid) => ({ me: pid, players, name: (x) => players.find((p) => p.id === x)?.name || '?', isBot: () => false, send: () => {}, isHost: true, local: false });
      const r = { game: id, players: n, renders: 0, crashes: [], overflow: [], smallButtons: new Set(), steps: 0, finished: false, limit: false, idle: 0 };
      let clock = realNow();
      Date.now = () => clock;
      let s = g.setup(players);
      const draw = (pid, tag) => {
        const v = JSON.parse(JSON.stringify(g.view ? g.view(s, pid) : s));
        host.innerHTML = '<div id="gamebox"></div>';
        const el = host.firstChild;
        try { g.render(el, v, ctx(pid)); } catch (e) { if (r.crashes.length < 5) r.crashes.push(`${tag} (${s.phase}): ${e.message}`); return; }
        r.renders++;
        // Measure the settled layout: jump finite pop-in animations to their end.
        el.getAnimations({ subtree: true }).forEach((a) => { try { a.finish(); } catch {} });
        if (host.scrollWidth > W() + 1 && r.overflow.length < 5) {
          const wide = [...el.querySelectorAll('*')].filter((x) => x.getBoundingClientRect().right > W() + 1).slice(-1)[0];
          r.overflow.push(`${tag} (${s.phase}): ${host.scrollWidth}px > ${W()}px at ${wide ? wide.tagName.toLowerCase() + '.' + String(wide.className?.baseVal ?? wide.className).split(' ')[0] : '?'}`);
        }
        el.querySelectorAll('button').forEach((b) => {
          const br = b.getBoundingClientRect();
          if (br.width > 0 && (br.height < 30 || br.width < 30)) r.smallButtons.add(`${(b.innerText || b.title || b.getAttribute('aria-label') || '?').trim().slice(0, 20)} ${Math.round(br.width)}x${Math.round(br.height)}`);
        });
      };
      try {
        while (!s.over && r.steps < maxSteps) {
          const due = g.turnOf(s);
          if (!due.length) break;
          if (r.steps % every === 0) {
            draw(due[0], 'active');
            const other = players.find((p) => !due.includes(p.id));
            if (other) draw(other.id, 'waiting');
            draw('SPECTATOR', 'spectator'); // someone watching who is not at the table
          }
          const pid = due[Math.floor(Math.random() * due.length)];
          const a = g.bot(JSON.parse(JSON.stringify(g.view ? g.view(s, pid) : s)), pid);
          const before = JSON.stringify(s);
          const next = JSON.parse(before);
          g.act(next, pid, a);
          const idle = JSON.stringify(next) === before;
          if (idle) r.idle++;
          clock += idle ? 1000 : 250;
          s = next;
          r.steps++;
        }
        r.finished = !!s.over;
        r.limit = !s.over && r.steps >= maxSteps;
        players.forEach((p) => draw(p.id, 'final'));
      } catch (e) {
        r.crashes.push('logic: ' + e.message);
      }
      r.smallButtons = [...r.smallButtons].slice(0, 8);
      out.push(r);
      await new Promise((res) => setTimeout(res, 50));
    }
  }
  host.remove();
  return out;
}
