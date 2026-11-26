// Long songs (Pro plan): several minutes of messy singing that slowly drifts flat,
// as unaccompanied singers do. Checks note accuracy, rhythm/bars, and speed.
// Run: node test/long.test.js
const E = require('../src/engine.js');
const N = require('../src/notation.js');
const SR = 16000;
function rng(seed) { return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296); }

// Notes of a few folk-style phrases, repeated with variations to fill the song
const PHRASES = [
  [60, 60, 67, 67, 69, 69, 67, 65, 65, 64, 64, 62, 62, 60],
  [64, 64, 65, 67, 67, 65, 64, 62, 60, 60, 62, 64, 64, 62, 62],
  [55, 55, 57, 55, 60, 59, 55, 55, 57, 55, 62, 60],
  [67, 67, 65, 64, 62, 64, 65, 67, 69, 67, 65, 64, 62, 60],
];

function song(seconds, o) {
  const rand = rng(o.seed);
  const want = [];
  const out = [];
  let phase = 0, t = 0;
  const totalSamples = seconds * SR;
  outer: for (let p = 0; ; p++) {
    const phrase = PHRASES[p % PHRASES.length].map((m) => m + (p % 3 === 2 ? 2 : 0));
    for (const midi of phrase) {
      const beats = rand() < 0.15 ? 2 : 1;
      const dur = (beats * 60) / o.bpm * (0.88 + 0.08 * rand());
      const len = Math.round(dur * SR);
      if (out.length + len > totalSamples) break outer;
      want.push(midi);
      const drift = (o.driftCents / 100) * (out.length / totalSamples); // slowly going flat
      const scoopDepth = -(0.4 + rand() * 0.8);
      const offset = (rand() - 0.5) * 0.4;
      for (let i = 0; i < len; i++) {
        const tt = i / SR;
        const scoop = tt < 0.1 ? scoopDepth * Math.pow(1 - tt / 0.1, 2) : 0;
        const m = midi + drift + offset + scoop + 0.35 * Math.sin(2 * Math.PI * 5.4 * tt) * Math.min(1, tt / 0.2);
        phase += (2 * Math.PI * E.midiToFreq(m)) / SR;
        const amp = Math.min(1, tt / 0.03, (len - i) / SR / 0.05);
        out.push(0.3 * amp * (Math.sin(phase) + 0.35 * Math.sin(2 * phase)) + 0.008 * (rand() * 2 - 1));
      }
      const gap = Math.round(((beats * 60) / o.bpm - dur) * SR);
      for (let i = 0; i < gap; i++) out.push(0.008 * (rand() * 2 - 1));
    }
    // breath between phrases
    for (let i = 0; i < SR * (60 / o.bpm); i++) out.push(0.008 * (rand() * 2 - 1));
  }
  return { samples: Float32Array.from(out), want };
}

function editDistance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

let fail = 0;
for (const [secs, drift, bpm] of [[120, -70, 96], [300, -90, 110]]) {
  const { samples, want } = song(secs, { seed: secs, driftCents: drift, bpm });
  const t0 = Date.now();
  const res = E.analyze(samples, SR);
  const ms = Date.now() - t0;
  const got = res.notes.map((n) => n.midi);
  const acc = 1 - editDistance(want, got) / want.length;
  const music = N.transcribe(res.notes);
  const t1 = Date.now() - t0 - ms;
  const ok = acc >= 0.95 && ms < 6000;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${secs / 60} min song, drifting ${drift} cents: ${(acc * 100).toFixed(1)}% notes right ` +
    `(${got.length} found, ${want.length} sung), drift measured ${res.driftCents}c, ${music.measures.length} bars at ♩=${music.bpm}, ` +
    `analysis ${ms} ms, notation ${t1} ms`);
}
console.log(fail ? `\n${fail} failed` : '\nAll passed');
process.exit(fail ? 1 : 0);
