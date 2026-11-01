// First-time help is remembered as device preferences (never in a room or a save): the island practice,
// the board-game sample (js/sample.js) and the Sketch Party warm-up all use these.
// Browser tests (automation) never see first-time help unless they set localStorage gn-onboard-force = 1.
export const suppressed = () => {
  try { if (localStorage.getItem('gn-onboard-force') === '1') return false; } catch {}
  return !!navigator.webdriver;
};
// Storage that can't be read counts as seen, so nobody is nagged on every visit.
export const seen = (k) => { try { return localStorage.getItem('gn-ob-' + k) === '1'; } catch { return true; } };
export const mark = (k) => { try { localStorage.setItem('gn-ob-' + k, '1'); } catch {} };
