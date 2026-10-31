// Computer difficulty, shared by every game (chess keeps its own Stockfish levels).
//
// Contract for a game (see GAME_GUIDE.md):
//   options: [..., levelOption()]            the host picks it in the lobby (default Normal)
//   setup(players, opts): s.level = levelOf(opts)
//   view(s, pid): include level: s.level     public, so computer players see it
//   bot(v, pid): read v.level                'normal' plays exactly as before; 'easy' weaker; 'hard' stronger
export const LEVEL_IDS = ['easy', 'normal', 'hard'];
export const levelOf = (opts) => (LEVEL_IDS.includes(opts?.level) ? opts.level : 'normal');
export function levelOption(label = 'Computer level', names = ['Easy', 'Normal', 'Hard']) {
  return { id: 'level', label, default: 'normal', choices: LEVEL_IDS.map((id, i) => [id, names[i]]) };
}
// For co-op games, where computer players are teammates.
export const teammateOption = () => levelOption('Computer teammates', ['Learning', 'Steady', 'Expert']);
