# Game Night — how to build a game

Each game is **one ES module** in `games/<id>.js` that `export default`s an object.
The platform (`js/app.js`) handles rooms, networking, lobby, bots, animation playback and sound.

## How the platform runs a game

- The **host's browser** owns the real state. Other players send actions; the host runs
  `act()` and sends every player `view(state, theirId)`.
- After every change, the platform calls `render(el, view, ctx)` again, which replaces the game's DOM.
  Keep UI-only state (selected items, open dialogs) in a **module-level variable**, and reset it
  when it no longer makes sense.
- **Bots:** the host can add computer players. When a bot is in `turnOf(state)`, the host calls
  `bot(view, botId)` after a short delay and plays the returned action through `act()`.
- **One-device mode:** `ctx.me` switches to whichever human must act next.

## Module contract

```js
export default {
  id: 'gems',                 // must match the file name
  name: 'Gem Merchants',
  description: 'One or two enticing sentences for the home page.',
  minPlayers: 2, maxPlayers: 4,
  cover: '<svg viewBox="0 0 320 200">…</svg>',   // illustrated 16:10 cover art

  setup(players) { return state; },   // players: [{id, name}] in seat order
  act(state, pid, action) { … },      // mutate state; throw new Error('Friendly reason') if illegal
  turnOf(state) { return [ids]; },    // everyone who may act right now ([] when over)
  view(state, pid) { return copy; },  // hide secrets (others' hands, deck order). Optional.
  bot(view, pid) { return action; },  // a LEGAL action whenever pid is in turnOf
  render(el, view, ctx) { … },
};
```

`ctx` = `{ me, players, name(id), isBot(id), send(action), isHost, local }`.

### Lobby options (optional)
Export `options: [{ id: 'clock', label: '⏱ Clock', default: '10+5', choices: [['none', 'No clock'], ['10+5', '10 min + 5 s']] }]`
and the host picks each one in the lobby; guests see the choice. `setup(players, opts)` receives `{ clock: '10+5' }`
(unknown values fall back to the default). Chess uses this for its clock.

### Spectators
People who join after the start, or who press "Just watch" in the lobby, are spectators: they are not passed to
`setup`, cannot act, and get `view(state, theirId)` with an id that is not a player. Hide secrets accordingly and
make sure `render` works when `ctx.me` is not at the table. `tools/render-audit.js` checks this.

### Simultaneous games (optional)
Set `simultaneous: true` when `turnOf` lists every player all the time (the escape rooms do). The platform then
skips the "your turn" chime and title. Bots in such games should usually return an action that changes nothing
(the escape rooms use `{ type: 'think' }`); the platform doesn't save or resend a state that didn't change.
Escape rooms themselves are built from data with `games/escape-kit.js`; see `keeper.js` and `signal.js`.

### Turn timer (optional)
Export `onTimeout(view, pid)` (and optionally `defaultTimer: 30`) to give your game a per-move clock.
The host picks the length in the lobby. When a human's time runs out, the host plays
`onTimeout`'s action for them (falling back to `bot`), so keep it gentle: end the turn, pass, decline.
The countdown pill in the header is drawn by the platform.

### Performance
Endless CSS loops (`animation: … infinite`) are paused automatically after 8 seconds without a touch, and
resumed on the next tap, to keep phones cool. Never rely on an endless animation for something essential.
Avoid animating `filter`, `box-shadow` or `backdrop-filter` on large areas.

### Rules for state
- **Plain JSON only**: no Sets, Maps, class instances, functions or `undefined` holes. It is cloned and sent over the network.
- All randomness happens inside `setup`/`act` (on the host). Use `rand`, `shuffle`, `d6` from `js/util.js`.
- `act` must **validate everything**: whose turn it is, the phase, and that the move is legal. Never trust the client.
- Set `state.over = true` at the end, and store the winners, e.g. `state.winners = [pid]`.
- Keep `state.log` (newest first) using `log(state, msg)` from `js/util.js`. Write player names in messages.
- Put `state.phase` in the state; the simulator prints it when something fails.
- `turnOf` must list players who need to respond in reaction windows (challenges, discards, trade replies).
  Give them a simple "Pass" action so the game never stalls.

### Bots
`bot(view, pid)` only sees the view, so it can't cheat. It must always return a legal action. Make it
**reasonably smart** with greedy heuristics, not purely random. It should be fun to play against.

## Visual standards (important)

The site has a **rich tabletop** look: walnut table, green felt, leather panels, brass buttons, parchment.
Each game should feel like a premium board game app.

- Use the shared surfaces: `.felt` (main play area), `.panel` (leather side panels), `.parchment` (log/notes),
  `.game-layout` (board + 330px side column, stacks on mobile), `.side`, `.pchip`, `.status`, `.winner-banner`,
  buttons `button.primary` (brass), `.good`, `.bad`, `.small`.
- Fonts: `var(--font-display)` (Cinzel) for titles and numbers, `var(--font-body)` (Nunito) for text.
- Draw real art: **SVG or CSS with gradients, highlights, inner shadows and drop shadows**. Pieces should
  look like physical objects (wood, glazed ceramic, polished gems, embossed cards). Emoji may be used as small
  icons, but never as the main artwork.
- Colour-blind friendly: every colour also has a distinct shape, symbol or pattern.
- **Responsive**: it must look great at **375px wide (phone)** and **1280px (desktop)**. Tap targets are at least 40px.
  Nothing can rely on hover. The main board must fit the screen width on a phone without sideways scrolling.
- Clearly show whose turn it is, what the player can do now (glow on legal targets: class `pulse-glow`),
  and a short hint line ("Pick up to 3 different gems").
- Game-specific CSS goes in your module via `injectCSS('<id>', css)` from `js/fx.js`.
  **Prefix every class with your id** (e.g. `.gems-card`) so games don't clash.
  Don't name a top-level constant `CSS`: it shadows the browser's `CSS.escape`.
- If your game plays its own long animation sequence, export `isAnimating()`; the platform waits for it
  before the game-over confetti.

## Animation standards

All helpers are in `js/fx.js`, and sounds are in `js/sound.js`.

1. **Gliding pieces (FLIP):** put `data-k="unique-stable-key"` on every piece that can move (cards, tiles,
   tokens, meeples). If the same key renders somewhere else next time, it glides there automatically.
   New keys pop in. For SVG, put `data-k` on an element **without** a `transform` attribute
   (position it with x/y/cx/cy, or wrap it in an outer `<g transform>` that has no data-k).
2. **Effects everyone sees:** in `act()`, call `addFx(state, {...})` from `js/util.js`.
   - Flying item: `{ from: 'bank-red', to: 'p-<pid>-gems', html: '<div class="gems-gem red"></div>', n: 2, sound: 'gem' }`.
     `from`/`to` name elements marked `data-a="…"` (or `data-k`). Always provide `html` (HTML, not bare SVG elements;
     wrap SVG in `<svg>` if needed). The ghost takes the size of the `from` element unless you pass `size: [w, h]`.
   - `{ kind: 'float', at: 'p-<pid>-score', text: '+3', color: '#ffd76a' }`, `{ kind: 'shake', at }`,
     `{ kind: 'pulse', at }`, `{ kind: 'sound', sound: 'dice' }`, `{ kind: 'confetti' }`. Any of them can take a `delay` in ms.
   - Anchor names must exist on every player's screen (use stable ids, e.g. `p-${pid}-…`).
3. **Dice:** `dieHTML(value, sizePx)` renders a 3D die. Call `rollDice(containerEl)` after render **only when a new
   roll happened**. Detect that with `changed('mygame-roll', view.rollSeq)` from fx.js.
4. **Card flips:** use a CSS 3D flip (rotateY with backface-visibility).
5. **Sounds:** `sound(name)`. Names: click, gem, coin, card, flip, place, build, dice, turn, bad, win, steal, shuffle, chime.
   Effects can carry `sound`. For instant local feedback (selecting something), call `sound('click')` in the handler.
6. The platform already plays confetti and a fanfare when `view.over` becomes true, and a chime when it becomes your turn.

## Testing (required)

1. Add the game to `games/index.js` and run `node tools/build-catalog.mjs` (the site lists games from `games/catalog.js`).
   Rules: `node tools/sim.mjs <id> <players> <runs>` plays full bot games and checks every move.
   It must pass for **every** supported player count (e.g. 50 runs each).
2. Visuals: a dev server is running at http://localhost:8080. Open **your own browser tab** (`tabs_create`), choose
   your game → **One device**, remove "Player 2", and add bots so you can watch and play. Check it at desktop size and at
   phone size (`resize_window` preset `mobile`, then back to `desktop`). Take screenshots and refine until it looks premium.
   Never touch the tab named `seed`.
3. Don't edit shared files (`js/*`, `css/style.css`, `games/index.js`, `index.html`). If you need a helper, write it inside
   your module. Don't commit or push.

## Naming
Use original names and original art. Never use trademarked game names (Catan, Splendor, Azul, Coup, Love Letter, etc.).
