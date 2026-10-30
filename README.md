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

## Party games

- **Sketch Party** (2–8): each turn one player draws a secret word and everyone else races to type it.
  Letter hints appear as time runs down; faster guesses score more. The host picks rounds and drawing time.
- **Word Spies** (4–8): two teams, 25 words. Spymasters see the secret key and give one-word clues;
  teammates reveal words and must avoid the assassin.

`node tools/party-test.mjs` checks both games' rules, that guessers never receive the secret word or key,
and the tournament brackets.

## Voice chat

In an online room, tap 🎙 in the top bar to talk to everyone else who joined voice (tap again to mute,
📵 to leave). Audio goes directly between players' browsers, like the games. The browser asks for
microphone access the first time, and it needs the site on https (GitHub Pages is) or localhost.

## Tournaments

In the lobby, the host can open **🏆 Tournament**:
- **Series**: tick several games; everyone plays each one and every win scores a point.
- **Knockout**: one-on-one matches of the selected game in a bracket (byes for odd numbers, rematches
  after draws). Players not in the current match watch.
After each game the host presses **Next game ▸**; the last game crowns the champion.

## Chess computer levels

The host picks the computer's strength in the lobby: Easy (the built-in player) or Club, Strong and
Master, which use Stockfish at limited strength on the host's device.

## Spectators

Friends who open the room link after a game has started join as spectators: they see the live game
(without anyone's hidden cards or clues) but cannot move. In the lobby, anyone can press
**Just watch this game** to sit out the next game, or **Take a seat and play** to join it.

## Chess clocks

The host picks the chess clock in the lobby: no clock, 1, 3+2, 5, 10+5, 15+10 or 30 minutes. Each side's time
only runs on its own turn, White's starts after the first move, and running out loses (or draws if the
opponent has too little material to checkmate). Every screen's clock is synced to the host's time.

## If a friend can't connect
Most home Wi-Fi works directly. Some mobile networks block direct connections.
Add a free TURN relay (Cloudflare Realtime TURN or the Metered free plan) in `js/config.js`.
Board games use only a few KB per move, so a free plan is plenty.

## Cooperative collection

- **Sunken Temple** (2–4): recover three relics and get every explorer home before the flood gates fail. Explorer, Engineer, Scholar, and Diver have different abilities.
- **Emberwatch** (2–4): carry four rescued animals to River Camp while protecting villages from wind-driven wildfire. Ranger, Firefighter, Medic, and Weatherkeeper share the mission.

Both games offer Relaxed, Standard, and Daring expeditions, shared team victories and defeats,
computer teammates, illustrated boards, and in-game rules. To play alone, choose **One device**,
remove Player 2, and add a computer teammate. The first player chooses difficulty after Start game.

`node tools/coop-test.mjs` exercises all supported team sizes and difficulty levels, validates
illegal actions and JSON state, and checks selected victory, defeat, and role-ability scenarios.

## Escape rooms

- **The Missing Keeper** (1–4): locked inside an abandoned clocktower, search the workshop, study,
  gear loft and belfry, repair the great clock, and find out what happened to its keeper.
- **Signal from Below** (1–4): restore power to a deserted underwater station, compare recordings,
  decode a repeating signal and rescue the crew. Each diver's wrist terminal holds different clues,
  so the team has to talk (or share fragments into the journal).

There are no turns: everyone explores at once. Rooms are illustrated with tappable objects and close-ups,
items go into a shared inventory, clues anyone examines are copied to a team journal, and hints get more
specific each time the team asks. Codes are reshuffled every game. Computer teammates explore and share
straight away, but only solve a puzzle after the team has made no progress for 45 seconds.
Both games are built on `games/escape-kit.js`, which takes rooms, objects, items, puzzles and hints as data.

`node tools/escape-test.mjs` plays bot teams of every size, checks that answers and other players' private
clues never appear in a player's view, and runs scripted solves with wrong tries, locked rooms and hints.

## Adding another game
Each game is one file in `games/`. See the comment at the top of `games/index.js` for the format,
then add it to the `GAMES` list.
