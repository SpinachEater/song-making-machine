// Synthetic hum tests for the engine. Run: node test/engine.test.js
const E = require('../src/engine.js');

const SR = 16000;
function rng(seed) { return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296); }

// Make a hum-like signal: fundamental plus soft harmonics, vibrato, scoop-in, gaps, noise.
function hum(notes, o = {}) {
  const rand = rng(o.seed || 1);
  const out = [];
  let phase = 0;
  for (const n of notes) {
    const len = Math.round(n.dur * SR);
    const gap = Math.round((n.gap ?? 0.05) * SR);
    for (let i = 0; i < len; i++) {
      const t = i / SR;
      const scoop = t < 0.06 ? -0.4 * (1 - t / 0.06) : 0; // start slightly flat
      const vib = (o.vibrato ?? 0.2) * Math.sin(2 * Math.PI * 5.5 * t);
      const m = n.midi + (o.detune || 0) + scoop + vib;
      phase += (2 * Math.PI * E.midiToFreq(m)) / SR;
      const env = Math.min(1, t / 0.03, (len - i) / SR / 0.04);
      const h2 = o.h2 ?? 0.35;
      const s = Math.sin(phase) + h2 * Math.sin(2 * phase) + 0.15 * Math.sin(3 * phase);
      out.push(0.3 * env * s + (o.noise ?? 0.005) * (rand() * 2 - 1));
    }
    for (let i = 0; i < gap; i++) out.push((o.noise ?? 0.005) * (rand() * 2 - 1));
  }
  return Float32Array.from(out);
}

let fail = 0;
function check(label, notes, o) {
  const sig = hum(notes, o);
  const res = E.analyze(sig, SR);
  const want = notes.map((n) => E.midiToName(n.midi)).join(' ');
  const got = res.notes.map((n) => n.name).join(' ');
  const ok = want === got;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}\n  want: ${want}\n  got:  ${got}  (tuning ${res.tuningCents}c)`);
}

const N = (names, dur = 0.45, gap = 0.05) =>
  names.split(' ').map((s) => {
    const m = s.match(/^([A-G]#?)(\d)$/);
    const idx = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'].indexOf(m[1]);
    return { midi: 12 * (+m[2] + 1) + idx, dur, gap };
  });

check('C major scale, male range', N('C3 D3 E3 F3 G3 A3 B3 C4'));
check('Twinkle, female range', N('C4 C4 G4 G4 A4 A4 G4'));
check('Legato (no gaps) melody', N('E4 D4 C4 D4 E4 E4 E4', 0.4, 0));
check('Low bass hum', N('E2 G2 A2 C3', 0.5));
check('High soprano', N('C5 E5 G5 C6', 0.4));
check('Singer 35 cents sharp overall', N('G3 A3 B3 C4 D4'), { detune: 0.35 });
check('Strong 2nd harmonic (octave trap)', N('A3 C4 E4'), { h2: 1.2 });
check('Wide vibrato', N('D4 F4 A4'), { vibrato: 0.45 });
check('Noisy room', N('F3 G3 A3 A#3 C4'), { noise: 0.03 });
check('Fast notes', N('C4 D4 E4 F4 G4 A4 B4 C5', 0.18, 0.03));

console.log(fail ? `\n${fail} failed` : '\nAll passed');
process.exit(fail ? 1 : 0);
