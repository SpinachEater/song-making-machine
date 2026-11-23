// Writes .mxl files for a few tunes so they can be checked by a MusicXML reader.
// Run: node test/musicxml.test.js [outDir]   (then: python3 test/check_mxl.py outDir)
const fs = require('fs');
const path = require('path');
const N = require('../src/notation.js');
const X = require('../src/musicxml.js');

const out = process.argv[2] || path.join(__dirname, '..', 'tmp-mxl');
fs.mkdirSync(out, { recursive: true });

function perform(seq, bpm) {
  const q = 60 / bpm;
  let t = 0.3;
  return seq.map(([midi, beats]) => { const n = { midi, start: t, dur: beats * q * 0.9 }; t += beats * q; return n; });
}
const tunes = {
  twinkle: { seq: [[60, 1], [60, 1], [67, 1], [67, 1], [69, 1], [69, 1], [67, 2], [65, 1], [65, 1], [64, 1], [64, 1], [62, 1], [62, 1], [60, 2]], bpm: 100 },
  gmajor_bass: { seq: [[43, 1], [45, 1], [47, 1], [48, 1], [50, 2], [54, 1], [55, 1]], bpm: 90 },
  accidentals_ties: { seq: [[60, 1], [61, 1], [60, 1], [62, 2], [63, 1.5], [65, 0.5], [67, 3]], bpm: 100 },
  waltz: { seq: [[67, 2], [64, 1], [64, 2], [65, 1], [67, 3]], bpm: 120, timeSig: '3/4' },
  flats: { seq: [[65, 1], [67, 1], [69, 1], [70, 1], [72, 2], [70, 1], [69, 1], [65, 2]], bpm: 100 },
};
const expected = {};
for (const [name, t] of Object.entries(tunes)) {
  const music = N.transcribe(perform(t.seq, t.bpm), { timeSig: t.timeSig || '4/4' });
  fs.writeFileSync(path.join(out, name + '.mxl'), X.toMXL(music, { title: name, date: new Date('2026-11-22') }));
  // What a reader should find: sounding pitches (tied notes count once) and total length in quarter notes
  expected[name] = {
    midis: t.seq.map(([m]) => m),
    key: music.key.acc,
    timeSig: music.timeSig,
    measures: music.measures.length,
  };
}
fs.writeFileSync(path.join(out, 'expected.json'), JSON.stringify(expected, null, 1));
console.log('Wrote', Object.keys(tunes).length, '.mxl files to', out);
