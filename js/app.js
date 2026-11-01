// Game Night: lobby, rooms and peer-to-peer multiplayer on free static hosting.
// state.js holds the room, net.js the networking and host rules, ui.js the screens.

import { S, loadTabSession } from './state.js';
import { resume } from './net.js';
import { render, onlineAction } from './ui.js';
import './report.js'; // anonymous crash reports, when switched on in config.js
import './sample.js'; // first-time board-game sample

{
  // A refresh of this tab drops you straight back into your room.
  const tabSession = loadTabSession();
  if (tabSession?.role === 'local') resume(tabSession);
  else {
    render();
    if (tabSession && S.name) onlineAction(() => resume(tabSession));
  }
}
