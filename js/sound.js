// Tiny synthesized sound effects (Web Audio), so the site needs no audio files.
// Usage: import { sound } from '../js/sound.js'; sound('gem');
// Names: click, gem, coin, card, flip, place, build, dice, turn, bad, win, steal, shuffle, chime

let ac = null;
const browser = typeof window !== 'undefined';
let muted = browser && localStorage.getItem('gn-muted') === '1';

export const isMuted = () => muted;
export function setMuted(m) {
  muted = m;
  if (browser) localStorage.setItem('gn-muted', m ? '1' : '0');
}

function audio() {
  if (!ac) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ac = new AC();
  }
  if (ac.state === 'suspended') ac.resume();
  return ac;
}
// Browsers only allow audio after a user gesture.
if (browser) addEventListener('pointerdown', () => { if (!muted) audio(); }, { passive: true });

function tone(freq, dur, { type = 'sine', gain = 0.15, when = 0, slide = null } = {}) {
  const c = audio();
  const t = c.currentTime + when;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(c.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

let noiseBuf = null;
function noise(dur, { gain = 0.2, when = 0, freq = 2000, q = 1, type = 'bandpass' } = {}) {
  const c = audio();
  if (!noiseBuf) {
    noiseBuf = c.createBuffer(1, c.sampleRate, c.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const t = c.currentTime + when;
  const s = c.createBufferSource();
  s.buffer = noiseBuf;
  const f = c.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = c.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f).connect(g).connect(c.destination);
  s.start(t, Math.random() * 0.5, dur + 0.05);
}

const SOUNDS = {
  click: () => tone(700, 0.05, { type: 'triangle', gain: 0.06 }),
  gem: () => { tone(1568, 0.22, { gain: 0.09 }); tone(2349, 0.3, { gain: 0.05, when: 0.05 }); },
  coin: () => { tone(1400, 0.07, { type: 'square', gain: 0.03 }); tone(1900, 0.22, { type: 'square', gain: 0.03, when: 0.06 }); },
  card: () => noise(0.13, { gain: 0.35, freq: 2600, q: 0.6 }),
  flip: () => { noise(0.06, { gain: 0.3, freq: 4200, q: 0.8 }); noise(0.05, { gain: 0.2, freq: 2500, when: 0.06 }); },
  place: () => { tone(170, 0.14, { gain: 0.28, slide: 80 }); noise(0.04, { gain: 0.18, freq: 1100 }); },
  build: () => { tone(230, 0.1, { gain: 0.25, slide: 120 }); tone(320, 0.12, { gain: 0.16, when: 0.09, slide: 170 }); noise(0.05, { gain: 0.15, freq: 900, when: 0.09 }); },
  dice: () => { for (let i = 0; i < 8; i++) noise(0.035, { gain: 0.28, freq: 1800 + Math.random() * 2500, q: 2, when: i * 0.065 + Math.random() * 0.03 }); },
  shuffle: () => { for (let i = 0; i < 6; i++) noise(0.05, { gain: 0.15, freq: 3000, when: i * 0.05 }); },
  turn: () => { tone(784, 0.16, { gain: 0.08, type: 'triangle' }); tone(1175, 0.35, { gain: 0.08, type: 'triangle', when: 0.13 }); },
  chime: () => [880, 1109, 1319].forEach((f, i) => tone(f, 0.4, { gain: 0.06, when: i * 0.07 })),
  bad: () => tone(150, 0.28, { type: 'sawtooth', gain: 0.05, slide: 90 }),
  steal: () => { tone(500, 0.18, { type: 'triangle', gain: 0.08, slide: 250 }); noise(0.1, { gain: 0.15, freq: 1500, when: 0.05 }); },
  win: () => [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.45, { type: 'triangle', gain: 0.1, when: i * 0.11 })),
};

export function sound(name) {
  if (muted || !browser) return;
  try {
    if (!audio()) return;
    SOUNDS[name]?.();
  } catch {}
}
