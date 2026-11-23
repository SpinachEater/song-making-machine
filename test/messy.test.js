// Messy, human-like humming: big scoops, slides between notes, wobbly pitch,
// uneven loudness, breath noise and the odd crack. Run: node test/messy.test.js
const E = require('../src/engine.js');
const SR = 16000;
function rng(seed) { return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296); }
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const parse = (s) => s.split(' ').map((x) => { const m = x.match(/^([A-G]#?)(\d)$/); return 12 * (+m[2] + 1) + NAMES.indexOf(m[1]); });

function messyHum(midis, o) {
  const rand = rng(o.seed);
  const out = [];
  let phase = 0, wander = 0;
  midis.forEach((midi, k) => {
    const dur = o.dur * (0.8 + 0.4 * rand());
    const len = Math.round(dur * SR);
    const next = midis[k + 1];
    const slide = next !== undefined && rand() < o.slideP; // slur into the next note
    const scoopDepth = -(0.5 + rand() * o.scoop);
    const crackAt = rand() < o.crackP ? Math.floor(len * (0.3 + 0.4 * rand())) : -1;
    const vibRate = 4.5 + rand() * 2;
    const offset = (rand() - 0.5) * 2 * o.offKey; // this note sung a bit off
    for (let i = 0; i < len; i++) {
      const t = i / SR;
      wander += (rand() - 0.5) * 0.004; wander *= 0.999;
      const scoop = t < 0.12 ? scoopDepth * Math.pow(1 - t / 0.12, 2) : 0;
      const tail = slide && dur - t < 0.09 ? (next - midi) * (1 - (dur - t) / 0.09) : 0;
      const vib = o.vib * Math.sin(2 * Math.PI * vibRate * t) * Math.min(1, t / 0.2);
      const m = midi + offset + scoop + tail + vib + wander;
      phase += (2 * Math.PI * E.midiToFreq(m)) / SR;
      const amp = Math.min(1, t / 0.04, (len - i) / SR / 0.05) * (0.75 + 0.25 * Math.sin(2 * Math.PI * 2.3 * t + k));
      const cracking = crackAt >= 0 && i >= crackAt && i < crackAt + SR * 0.035;
      const s = cracking ? Math.sin(2 * phase) : Math.sin(phase) + 0.4 * Math.sin(2 * phase) + 0.15 * Math.sin(3 * phase);
      out.push(0.3 * amp * s + 0.01 * (rand() * 2 - 1));
    }
    const gap = slide ? 0 : Math.round(SR * (0.03 + 0.06 * rand()));
    for (let i = 0; i < gap; i++) out.push((i < SR * 0.02 ? 0.04 : 0.01) * (rand() * 2 - 1)); // breath
  });
  return Float32Array.from(out);
}

const tunes = [
  ['Twinkle (female)', 'C4 C4 G4 G4 A4 A4 G4 F4 F4 E4 E4 D4 D4 C4'],
  ['Ode to Joy (male)', 'E3 E3 F3 G3 G3 F3 E3 D3 C3 C3 D3 E3 E3 D3 D3'],
  ['Happy Birthday (mid)', 'G3 G3 A3 G3 C4 B3 G3 G3 A3 G3 D4 C4'],
  ['Scale with leaps', 'D4 F#4 A4 D5 A4 F#4 E4 C#4 D4'],
];
const levels = ['off', 'light', 'medium', 'strong'];
const o = { dur: 0.42, scoop: 1.0, slideP: 0.35, vib: 0.4, crackP: 0.25, offKey: 0.25 };

const strength = process.argv[2];
let fail = 0;
for (const lvl of strength ? [strength] : levels) {
  let correct = 0, total = 0, extra = 0;
  for (const [label, tune] of tunes) {
    for (let seed = 1; seed <= 5; seed++) {
      const want = parse(tune);
      const res = E.analyze(messyHum(want, { ...o, seed: seed * 101 + label.length }), SR, { cleanup: lvl });
      const got = res.notes.map((n) => n.midi);
      total++;
      if (JSON.stringify(got) === JSON.stringify(want)) correct++;
      extra += Math.max(0, got.length - want.length);
      if (lvl === 'medium' && JSON.stringify(got) !== JSON.stringify(want) && process.env.VERBOSE) {
        console.log(`  ${label} seed ${seed}\n    want ${want.map(E.midiToName).join(' ')}\n    got  ${got.map(E.midiToName).join(' ')}`);
      }
    }
  }
  console.log(`${lvl.padEnd(7)} ${correct}/${total} tunes exactly right, ${extra} extra notes`);
  if (lvl === 'medium' && correct < total * 0.8) fail++;
}
process.exit(fail ? 1 : 0);
