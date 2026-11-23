// Tests for turning timed notes into written music. Run: node test/notation.test.js
const N = require('../src/notation.js');

let fail = 0;
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${ok ? '' : `\n  want: ${JSON.stringify(want)}\n  got:  ${JSON.stringify(got)}`}`);
}

// Build performed notes from (midi, beats) at a tempo, with human timing wobble.
function perform(seq, bpm, wobble = 0.03, legato = 0.9) {
  const q = 60 / bpm;
  let t = 0.3, i = 0;
  return seq.map(([midi, beats]) => {
    const jitter = (((i++ * 7919) % 13) / 13 - 0.5) * 2 * wobble;
    const n = { midi, start: t + jitter, dur: beats * q * legato };
    t += beats * q;
    return n;
  });
}
const render = (r) => r.measures.map((m) => m.map((e) => (e.rest ? e.duration + 'r' : e.key + ':' + e.duration + (e.accidental ? '(' + e.accidental + ')' : '') + (e.tieToNext ? '~' : ''))).join(' ')).join(' | ');

// Twinkle Twinkle in C, quarter notes with half notes at phrase ends
const twinkle = [[60, 1], [60, 1], [67, 1], [67, 1], [69, 1], [69, 1], [67, 2], [65, 1], [65, 1], [64, 1], [64, 1], [62, 1], [62, 1], [60, 2]];
let r = N.transcribe(perform(twinkle, 100));
eq('Twinkle: key', r.key.name, 'C');
eq('Twinkle: clef', r.clef, 'treble');
eq('Twinkle: tempo near 100', Math.abs(r.bpm - 100) <= 6, true);
eq('Twinkle: bar 1', render(r).split(' | ')[0], 'c/4:q c/4:q g/4:q g/4:q');
eq('Twinkle: bar 2', render(r).split(' | ')[1], 'a/4:q a/4:q g/4:h');
eq('Twinkle: 4 bars', r.measures.length, 4);

// G major melody with F#, sung low (bass clef)
const gMaj = [[43, 1], [45, 1], [47, 1], [48, 1], [50, 2], [54, 1], [55, 1]];
r = N.transcribe(perform(gMaj, 90));
eq('G major: key', r.key.name, 'G');
eq('G major: clef', r.clef, 'bass');
eq('G major: F# has no accidental (in key signature)', r.measures.flat().find((e) => e.midi === 54).accidental, null);

// Accidental outside the key, then natural in the same bar
const chromatic = [[60, 1], [61, 1], [60, 1], [62, 1], [64, 1], [65, 1], [67, 2]];
r = N.transcribe(perform(chromatic, 110));
eq('C# shows sharp', r.measures[0][1].accidental, '#');
eq('C after C# in same bar shows natural', r.measures[0][2].accidental, 'n');

// Dotted rhythm: dotted quarter + eighth
const dotted = [[64, 1.5], [62, 0.5], [60, 1], [62, 1], [64, 1], [64, 1], [64, 2]];
r = N.transcribe(perform(dotted, 96, 0.02));
eq('Dotted quarter + eighth', render(r).split(' | ')[0], 'e/4:qd d/4:8 c/4:q d/4:q');

// Note held across the barline is tied
const across = [[60, 1], [62, 1], [64, 1], [65, 2], [67, 1], [69, 1], [67, 1], [65, 1], [64, 4]];
r = N.transcribe(perform(across, 100, 0.01));
eq('Tie across barline', render(r).split(' | ').slice(0, 2), ['c/4:q d/4:q e/4:q f/4:q~', 'f/4:q g/4:q a/4:q g/4:q']);

// Waltz in 3/4
const waltz = [[67, 2], [64, 1], [64, 2], [65, 1], [67, 3]];
r = N.transcribe(perform(waltz, 120), { timeSig: '3/4' });
eq('3/4 bars', render(r), 'g/4:h e/4:q | e/4:h f/4:q | g/4:hd');

// Fast tempo is not halved into nonsense
r = N.transcribe(perform(twinkle, 150, 0.015));
eq('Fast tempo near 150', Math.abs(r.bpm - 150) <= 8, true);

// Rest from a long pause between phrases
const pause = [[60, 1], [62, 1], [64, 1], [65, 1], [67, 1], [67, 1]];
const pf = perform(pause, 100, 0.01);
pf.slice(4).forEach((n) => (n.start += 1.2)); // two beats of silence
r = N.transcribe(pf);
eq('Rest inserted for pause', render(r).split(' | ')[1].includes('hr') || render(r).split(' | ')[1].includes('qr'), true);

console.log(fail ? `\n${fail} failed` : '\nAll passed');
process.exit(fail ? 1 : 0);
