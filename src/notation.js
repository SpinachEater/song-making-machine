// Turns detected notes (start, dur, midi) into written music:
// tempo, key signature, note lengths, bars and ties. No dependencies.
(function (root) {
  'use strict';

  const SHARP_NAMES = ['c', 'c#', 'd', 'd#', 'e', 'f', 'f#', 'g', 'g#', 'a', 'a#', 'b'];
  const FLAT_NAMES = ['c', 'db', 'd', 'eb', 'e', 'f', 'gb', 'g', 'ab', 'a', 'bb', 'b'];
  const MAJOR = [0, 2, 4, 5, 7, 9, 11];
  // Major keys by number of sharps (+) or flats (-)
  const KEYS = [
    { name: 'C', tonic: 0, acc: 0 }, { name: 'G', tonic: 7, acc: 1 }, { name: 'D', tonic: 2, acc: 2 },
    { name: 'A', tonic: 9, acc: 3 }, { name: 'E', tonic: 4, acc: 4 }, { name: 'B', tonic: 11, acc: 5 },
    { name: 'F#', tonic: 6, acc: 6 }, { name: 'F', tonic: 5, acc: -1 }, { name: 'Bb', tonic: 10, acc: -2 },
    { name: 'Eb', tonic: 3, acc: -3 }, { name: 'Ab', tonic: 8, acc: -4 }, { name: 'Db', tonic: 1, acc: -5 },
  ];
  const SHARP_ORDER = ['f', 'c', 'g', 'd', 'a', 'e', 'b'];
  const FLAT_ORDER = ['b', 'e', 'a', 'd', 'g', 'c', 'f'];

  // Note length in eighths → VexFlow duration pieces (tied when more than one)
  const PIECES = { 1: ['8'], 2: ['q'], 3: ['qd'], 4: ['h'], 5: ['h', '8'], 6: ['hd'], 7: ['hd', '8'], 8: ['w'] };

  function median(a) {
    if (!a.length) return NaN;
    const s = a.slice().sort((x, y) => x - y);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  // Estimate the length of one eighth note (seconds) from the gaps between note starts.
  function estimateEighth(notes) {
    const iois = [];
    for (let i = 0; i + 1 < notes.length; i++) iois.push(notes[i + 1].start - notes[i].start);
    if (!iois.length) return notes.length ? Math.max(0.25, notes[0].dur / 2) : 0.25;
    // Try every tempo from 50 to 180 bpm. Score how well the gaps fit whole eighth notes,
    // preferring tempos where the typical note is a quarter note and tempos near 100 bpm.
    let best = 0.25, bestScore = Infinity;
    for (let bpm = 50; bpm <= 180; bpm++) {
      const u = 30 / bpm;
      let err = 0;
      const units = [];
      for (const d of iois) {
        const r = Math.max(1, Math.round(d / u));
        units.push(r);
        err += Math.pow(d / u - r, 2);
      }
      const score = err / iois.length + 0.05 * Math.abs(Math.log2(median(units) / 2)) + 0.02 * Math.abs(Math.log2(bpm / 100));
      if (score < bestScore) { bestScore = score; best = u; }
    }
    return best;
  }

  function chooseKey(notes) {
    let best = KEYS[0], bestScore = -1;
    for (const k of KEYS) {
      let s = 0;
      for (const n of notes) if (MAJOR.includes((((n.midi - k.tonic) % 12) + 12) % 12)) s += n.dur;
      // tie-break: fewer accidentals
      s -= Math.abs(k.acc) * 1e-3;
      if (s > bestScore) { bestScore = s; best = k; }
    }
    return best;
  }

  // Spell a MIDI note in a key: {letter, acc ('#','b',''), octave}
  function spell(midi, key) {
    const names = key.acc < 0 ? FLAT_NAMES : SHARP_NAMES;
    const pc = ((midi % 12) + 12) % 12;
    const nm = names[pc];
    return { letter: nm[0], acc: nm.slice(1), octave: Math.floor(midi / 12) - 1 };
  }
  function keySigAcc(letter, key) {
    if (key.acc > 0 && SHARP_ORDER.slice(0, key.acc).includes(letter)) return '#';
    if (key.acc < 0 && FLAT_ORDER.slice(0, -key.acc).includes(letter)) return 'b';
    return '';
  }

  // Main entry. opts.beatsPerBar (in quarter notes, or eighths for x/8), opts.timeSig e.g. '4/4'
  function transcribe(notes, opts) {
    opts = opts || {};
    const timeSig = opts.timeSig || '4/4';
    const [num, den] = timeSig.split('/').map(Number);
    const barUnits = den === 8 ? num : num * 2; // bar length in eighths
    if (!notes.length) return { measures: [], key: KEYS[0], clef: 'treble', bpm: 0, timeSig, barUnits, eighth: 0.25 };

    const u = opts.eighth || estimateEighth(notes);
    const key = chooseKey(notes);
    const clef = median(notes.map((n) => n.midi)) >= 57 ? 'treble' : 'bass';

    // Each note → {idx, units} followed by an optional rest
    const events = [];
    notes.forEach((n, i) => {
      const next = notes[i + 1];
      const span = next ? Math.max(1, Math.round((next.start - n.start) / u)) : Math.max(1, Math.round(n.dur / u + 0.35)); // singers often cut the last note short
      // A short gap (a breath or a consonant between notes) belongs to the note; a longer one is a rest
      const gap = next ? next.start - (n.start + n.dur) : 0;
      const restUnits = Math.min(span - 1, Math.max(0, Math.floor(gap / u + 0.25)));
      const len = next ? span - restUnits : span;
      events.push({ idx: i, midi: n.midi, units: len });
      if (span > len) events.push({ idx: -1, rest: true, units: span - len });
    });

    // Fill bars, splitting across barlines with ties
    const measures = [];
    let bar = [], used = 0;
    const pushPiece = (ev, units, tieStart, tieEnd) => {
      const pieces = piecesFor(units, used);
      for (const [p, d] of pieces.entries()) {
        const last = p === pieces.length - 1;
        bar.push({ ...ev, duration: d.dur, units: d.units, tieToNext: !ev.rest && (!last || tieStart), tiedFromPrev: !ev.rest && (p > 0 || tieEnd) });
        used += d.units;
      }
    };
    for (const ev of events) {
      let remaining = ev.units;
      let first = true;
      while (remaining > 0) {
        const room = barUnits - used;
        const take = Math.min(room, remaining);
        remaining -= take;
        pushPiece(ev, take, remaining > 0, !first);
        first = false;
        if (used >= barUnits) { measures.push(bar); bar = []; used = 0; }
      }
    }
    if (bar.length) {
      // pad the last bar with rests
      while (used < barUnits) pushPiece({ idx: -1, rest: true }, barUnits - used, false, false);
      measures.push(bar);
    }

    // Spelling and accidentals (accidentals last until the barline)
    for (const m of measures) {
      const carried = {};
      for (const el of m) {
        if (el.rest) continue;
        const s = spell(el.midi, key);
        el.key = `${s.letter}${s.acc}/${s.octave}`;
        const slot = s.letter + s.octave;
        const inForce = slot in carried ? carried[slot] : keySigAcc(s.letter, key);
        el.accidental = el.tiedFromPrev && slot in carried ? null : s.acc === inForce ? null : s.acc || 'n';
        carried[slot] = s.acc;
      }
    }
    return { measures, key, clef, bpm: Math.round(30 / u), timeSig, barUnits, eighth: u };
  }

  // Split a length (in eighths) into written durations, longest first, but keep
  // a note that starts off the beat from hiding the middle of the bar.
  function piecesFor(units, pos) {
    const out = [];
    const list = PIECES[units] || null;
    if (list) {
      const map = { '8': 1, q: 2, qd: 3, h: 4, hd: 6, w: 8 };
      // an off-beat start (odd position) with a long note reads better as 8th + rest of it
      if (pos % 2 === 1 && units > 2) {
        out.push({ dur: '8', units: 1 });
        return out.concat(piecesFor(units - 1, pos + 1));
      }
      return list.map((d) => ({ dur: d, units: map[d] }));
    }
    // longer than a whole note: whole notes then the rest
    let r = units;
    while (r > 8) { out.push({ dur: 'w', units: 8 }); r -= 8; }
    return out.concat(piecesFor(r, pos));
  }

  const api = { transcribe, estimateEighth, chooseKey, spell, KEYS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Notation = api;
})(typeof window !== 'undefined' ? window : globalThis);
