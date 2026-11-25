// Reads a MusicXML score (plain .musicxml/.xml text, or a compressed .mxl file)
// and turns it into timed notes that the piano can play.
//
//   Score.parse(xmlText) -> { title, parts, staves, notes, measures, bpm, duration }
//     notes: [{ midi, start, dur, beat, beats, part, staff, voice, measure }]
//     start/dur are in seconds, beat/beats in quarter notes.
//   await Score.readFile(bytes) -> MusicXML text (unzips .mxl when needed)
(function (root) {
  'use strict';

  const STEP = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const DEFAULT_BPM = 90;

  function kids(el, name) {
    const out = [];
    for (let c = el.firstElementChild; c; c = c.nextElementSibling) if (c.localName === name) out.push(c);
    return out;
  }
  function kid(el, name) {
    for (let c = el.firstElementChild; c; c = c.nextElementSibling) if (c.localName === name) return c;
    return null;
  }
  function text(el, name, dflt) {
    const k = el && kid(el, name);
    return k ? k.textContent.trim() : dflt;
  }
  function num(el, name, dflt) {
    const v = parseFloat(text(el, name, ''));
    return Number.isFinite(v) ? v : dflt;
  }

  function getParser() {
    if (typeof DOMParser !== 'undefined') return new DOMParser();
    throw new Error('MusicXML reading needs a browser (DOMParser).');
  }

  function parse(xml) {
    const doc = getParser().parseFromString(xml, 'application/xml');
    const rootEl = doc.documentElement;
    if (!rootEl || rootEl.localName === 'parsererror' || doc.getElementsByTagName('parsererror').length) {
      throw new Error('This file is not valid MusicXML.');
    }
    if (rootEl.localName === 'score-timewise') throw new Error('Timewise MusicXML is not supported yet. Save it as partwise MusicXML.');
    if (rootEl.localName !== 'score-partwise') throw new Error('This file is not a MusicXML score.');

    const title = text(kid(rootEl, 'work') || rootEl, 'work-title', '') || text(rootEl, 'movement-title', '') ||
      (() => {
        const cr = rootEl.getElementsByTagName('credit-words');
        return cr.length ? cr[0].textContent.trim() : '';
      })();

    const partList = kid(rootEl, 'part-list');
    const names = {};
    if (partList) kids(partList, 'score-part').forEach((sp) => { names[sp.getAttribute('id')] = text(sp, 'part-name', ''); });

    const tempos = []; // { beat, bpm }
    const notes = [];
    const parts = [];
    let measureCount = 0;

    kids(rootEl, 'part').forEach((partEl, pi) => {
      const id = partEl.getAttribute('id') || 'P' + (pi + 1);
      let divisions = 1;
      let staves = 1;
      let measureStart = 0; // in quarter notes
      let beatsInBar = null;
      const open = {}; // tie bookkeeping: "staff|voice|midi" -> note
      const measures = kids(partEl, 'measure');
      measureCount = Math.max(measureCount, measures.length);

      measures.forEach((mEl, mi) => {
        let pos = 0; // in quarter notes from measure start
        let maxPos = 0;
        let lastStart = 0;
        for (let el = mEl.firstElementChild; el; el = el.nextElementSibling) {
          const tag = el.localName;
          if (tag === 'attributes') {
            divisions = num(el, 'divisions', divisions) || divisions;
            staves = Math.max(staves, num(el, 'staves', staves));
            const time = kid(el, 'time');
            if (time) {
              const b = num(time, 'beats', NaN), bt = num(time, 'beat-type', NaN);
              if (b && bt) beatsInBar = (b * 4) / bt;
            }
          } else if (tag === 'backup') {
            pos -= num(el, 'duration', 0) / divisions;
            if (pos < 0) pos = 0;
          } else if (tag === 'forward') {
            pos += num(el, 'duration', 0) / divisions;
            maxPos = Math.max(maxPos, pos);
          } else if (tag === 'direction' || tag === 'sound') {
            const snd = tag === 'sound' ? el : kid(el, 'sound');
            const t = snd && parseFloat(snd.getAttribute('tempo'));
            if (pi === 0 && t > 0) tempos.push({ beat: measureStart + pos, bpm: t });
            if (pi === 0 && !(t > 0) && tag === 'direction') {
              // metronome mark without a <sound tempo>
              const met = el.getElementsByTagName('metronome')[0];
              const pm = met && parseFloat(text(met, 'per-minute', ''));
              const unit = met && text(met, 'beat-unit', 'quarter');
              const mult = { half: 2, quarter: 1, eighth: 0.5, whole: 4 }[unit] || 1;
              const dotted = met && kid(met, 'beat-unit-dot') ? 1.5 : 1;
              if (pm > 0) tempos.push({ beat: measureStart + pos, bpm: pm * mult * dotted });
            }
          } else if (tag === 'note') {
            if (kid(el, 'grace') || kid(el, 'cue')) continue;
            const isChord = !!kid(el, 'chord');
            const dur = num(el, 'duration', 0) / divisions;
            const start = isChord ? lastStart : pos;
            if (!isChord) { lastStart = pos; pos += dur; maxPos = Math.max(maxPos, pos); }
            const pitch = kid(el, 'pitch');
            if (!pitch || kid(el, 'rest')) continue;
            const step = text(pitch, 'step', 'C').toUpperCase();
            const midi = 12 * (num(pitch, 'octave', 4) + 1) + (STEP[step] || 0) + Math.round(num(pitch, 'alter', 0));
            const staff = num(el, 'staff', 1);
            const voice = text(el, 'voice', '1');
            const ties = kids(el, 'tie').map((t) => t.getAttribute('type'));
            const key = staff + '|' + voice + '|' + midi;
            const keyAny = staff + '|*|' + midi;
            const prev = open[key] || open[keyAny];
            const beat = measureStart + start;
            if (ties.includes('stop') && prev && Math.abs(prev.beat + prev.beats - beat) < 1e-6) {
              prev.beats += dur;
              if (!ties.includes('start')) { delete open[key]; delete open[keyAny]; }
              continue;
            }
            const n = { midi, beat, beats: dur, part: pi, staff, voice, measure: mi + 1 };
            notes.push(n);
            if (ties.includes('start')) { open[key] = n; open[keyAny] = n; }
          }
        }
        // A bar lasts as long as its notes and rests; an empty bar uses the time signature.
        measureStart += maxPos > 0 ? maxPos : (beatsInBar || 0);
      });
      parts.push({ id, name: names[id] || '', staves });
    });

    // Tempo map (quarter notes -> seconds)
    tempos.sort((a, b) => a.beat - b.beat);
    // Before the first tempo mark, play at that first marked tempo (or a default when there is none)
    const map = [{ beat: 0, bpm: tempos.length ? tempos[0].bpm : DEFAULT_BPM, sec: 0 }];
    tempos.forEach((t) => {
      const last = map[map.length - 1];
      if (t.beat <= last.beat + 1e-9) { last.bpm = t.bpm; return; }
      map.push({ beat: t.beat, bpm: t.bpm, sec: last.sec + ((t.beat - last.beat) * 60) / last.bpm });
    });
    const toSec = (beat) => {
      let seg = map[0];
      for (const s of map) if (s.beat <= beat + 1e-9) seg = s; else break;
      return seg.sec + ((beat - seg.beat) * 60) / seg.bpm;
    };
    notes.forEach((n) => { n.start = toSec(n.beat); n.dur = toSec(n.beat + n.beats) - n.start; });
    notes.sort((a, b) => a.start - b.start || a.midi - b.midi);

    // One entry per playable line (a part's staff), so singers can pick their own line
    const staves = [];
    parts.forEach((p, pi) => {
      for (let s = 1; s <= p.staves; s++) {
        const count = notes.filter((n) => n.part === pi && n.staff === s).length;
        if (count) staves.push({ part: pi, staff: s, name: p.name, count });
      }
    });
    const end = notes.reduce((m, n) => Math.max(m, n.start + n.dur), 0);
    return {
      title, parts, staves, notes, measures: measureCount,
      tempoMap: map, bpm: Math.round(map[0].bpm), tempoGiven: tempos.length > 0, duration: end,
    };
  }

  // ---------- .mxl (zip) reading ----------
  async function inflateRaw(bytes) {
    if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot open .mxl files. Try Chrome, Safari or Firefox.');
    const ds = new DecompressionStream('deflate-raw');
    const stream = new Blob([bytes]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async function unzip(bytes) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let eocd = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('This .mxl file looks damaged.');
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const files = {};
    const dec = new TextDecoder();
    for (let i = 0; i < count; i++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true);
      const csize = dv.getUint32(p + 20, true);
      const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
      const local = dv.getUint32(p + 42, true);
      const name = dec.decode(bytes.subarray(p + 46, p + 46 + nlen));
      const lnl = dv.getUint16(local + 26, true), lxl = dv.getUint16(local + 28, true);
      const data = bytes.subarray(local + 30 + lnl + lxl, local + 30 + lnl + lxl + csize);
      files[name] = { method, data };
      p += 46 + nlen + xlen + clen;
    }
    return files;
  }

  async function readFile(bytes) {
    bytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (!(bytes[0] === 0x50 && bytes[1] === 0x4b)) {
      let s = new TextDecoder('utf-8').decode(bytes);
      if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
      return s;
    }
    const files = await unzip(bytes);
    const get = async (name) => {
      const f = files[name];
      if (!f) return null;
      const raw = f.method === 0 ? f.data : await inflateRaw(f.data);
      return new TextDecoder().decode(raw);
    };
    let path = null;
    const container = await get('META-INF/container.xml');
    if (container) {
      const m = container.match(/full-path="([^"]+)"/);
      if (m) path = m[1];
    }
    if (!path) path = Object.keys(files).find((n) => !n.startsWith('META-INF') && /\.(musicxml|xml)$/i.test(n));
    const xml = path && (await get(path));
    if (!xml) throw new Error('No score was found inside this .mxl file.');
    return xml;
  }

  const api = { parse, readFile, unzip };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Score = api;
})(typeof window !== 'undefined' ? window : globalThis);
