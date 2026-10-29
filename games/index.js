// Every game is one module. See GAME_GUIDE.md for the full contract.
//
//   id, name, description, minPlayers, maxPlayers, cover (SVG string)
//   setup(players)                -> initial state   (players: [{id, name}])
//   act(state, playerId, action)  mutate state, or throw Error('message')
//   turnOf(state)                 -> [playerIds who may act now]
//   view(state, playerId)         -> optional: copy of state with secrets hidden
//   bot(view, playerId)           -> a legal action for a computer player
//   render(el, view, ctx)         draw into el; ctx = {me, name(id), send(action), isBot(id), ...}
//
// Set state.over = true when the game ends.

import gems from './gems.js';
import mosaic from './mosaic.js';

export const GAMES = [gems, mosaic];

export const getGame = (id) => GAMES.find((g) => g.id === id) || GAMES[0];
