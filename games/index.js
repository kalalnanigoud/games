// Every game is one module. To add a game, create a file in this folder that
// exports an object with this shape, then add it to the list below:
//
//   id, name, emoji, description, minPlayers, maxPlayers
//   setup(players)          -> initial state   (players: [{id, name}])
//   act(state, playerId, action)  mutate state, or throw Error('message')
//   turnOf(state)           -> [playerIds who must act now]
//   view(state, playerId)   -> optional: state with secrets hidden
//   render(el, view, ctx)   draw into el; ctx = {me, name(id), send(action), ...}
//
// Set state.over = true when the game ends.

import connect4 from './connect4.js';

export const GAMES = [connect4];

export const getGame = (id) => GAMES.find((g) => g.id === id) || GAMES[0];
