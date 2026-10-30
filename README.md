# 🎲 Game Night

Free multiplayer board games in the browser, on phones and computers.
One player hosts a room, friends join with a 5-letter code. No sign-up, no game server.

## How it works (and why it's free)

| Piece | What it does | Cost |
|---|---|---|
| **GitHub Pages** (or Cloudflare Pages) | Serves the website files (HTML/JS/CSS) | Free for public repos, 100 GB/month traffic |
| **PeerJS cloud server** | Helps players find each other (matchmaking only) | Free community service |
| **WebRTC** | Players' browsers talk directly to each other | Free (built into browsers) |

The host's browser runs the game. Everyone else sends moves to the host and gets the updated board back.
If someone refreshes, they rejoin automatically. If the host refreshes, the room comes back with the same code.

## Put it online for free (GitHub Pages)

### Option A — no tools needed (upload in the browser)
1. Create a free account at https://github.com and click **New repository**.
   Name it e.g. `game-night`, choose **Public**, click **Create repository**.
2. Click **uploading an existing file**, then drag in everything in this folder
   (`index.html`, `css/`, `js/`, `games/`, `README.md`). Click **Commit changes**.
3. Go to **Settings → Pages**. Under *Build and deployment* pick **Deploy from a branch**,
   branch **main**, folder **/ (root)**, then **Save**.
4. After about a minute your site is live at `https://YOUR-USERNAME.github.io/game-night/`.

### Option B — with git
```bash
git init
git add .
git commit -m "Game Night"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/game-night.git
git push -u origin main
```
Then do step 3 above.

### Alternative: Cloudflare Pages
Create a free Cloudflare account → **Workers & Pages → Create → Pages → Upload assets**, and drag this folder in.

## Test it locally
```bash
node serve.js
```
Open http://localhost:8080 in two browser tabs: host in one, join with the code in the other.

Requires a current Node.js release (tested with Node 24). The development server binds to
`127.0.0.1` by default. Set `HOST` explicitly only if you intend to allow access from other machines.

## Checks

Run `node tools/test.mjs` for syntax checks, server and multiplayer regressions, rule scenarios,
and 50 simulated games at every supported player count. An optional number changes the simulation
count, for example `node tools/test.mjs 10`.

With the local server running, open `/tools/browser-test.html` and click **Run all games**
at phone and desktop viewport sizes. It reports render failures, horizontal overflow, and buttons
smaller than 30px. Open `/tools/local-boot-test.html` to exercise shared-device play without PeerJS.
Also verify hosting/joining in two tabs, moves in both directions, and guest/host refresh recovery.

Online rooms use the v2 protocol, with private reconnect credentials separate from public player IDs.
Both players must reload the updated site. Saved online sessions from v1 cannot be safely resumed;
create a new room. Saved shared-device games remain compatible.

## If a friend can't connect
Most home Wi-Fi works directly. Some mobile networks block direct connections.
Add a free TURN relay (Cloudflare Realtime TURN or the Metered free plan) in `js/config.js`.
Board games use only a few KB per move, so a free plan is plenty.

## Adding a game
Each game is one file in `games/`. See the comment at the top of `games/index.js` for the format,
then add it to the `GAMES` list.
