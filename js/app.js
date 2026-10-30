// Game Night: lobby, rooms and peer-to-peer multiplayer on free static hosting.
// state.js holds the room, net.js the networking and host rules, ui.js the screens.

import { S, loadTabSession } from './state.js';
import { resume } from './net.js';
import { render } from './ui.js';

{
  // A refresh of this tab drops you straight back into your room.
  const tabSession = loadTabSession();
  if (tabSession && (tabSession.role === 'local' || (S.name && typeof Peer !== 'undefined'))) resume(tabSession);
  else render();
}
