// Writes transcribed music (from notation.js) as MusicXML, and packs it into a
// compressed .mxl file that MuseScore, Finale, Sibelius, Dorico and others can open.
(function (root) {
  'use strict';

  const TYPES = { '8': ['eighth', 0], q: ['quarter', 0], qd: ['quarter', 1], h: ['half', 0], hd: ['half', 1], w: ['whole', 0] };
  const ACC = { '#': ['sharp', 1], b: ['flat', -1], n: ['natural', 0], '': [null, 0] };

  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  function noteXml(el, barUnits, wholeBarRest) {
    if (el.rest) {
      if (wholeBarRest) return `      <note><rest measure="yes"/><duration>${barUnits}</duration></note>`;
      const [type, dots] = TYPES[el.duration];
      return `      <note><rest/><duration>${el.units}</duration><type>${type}</type>${'<dot/>'.repeat(dots)}</note>`;
    }
    const [letter, octave] = el.key.split('/');
    const step = letter[0].toUpperCase();
    const accSign = letter.slice(1); // '#', 'b' or ''
    const alter = ACC[accSign][1];
    const [type, dots] = TYPES[el.duration];
    const ties = [];
    const tied = [];
    if (el.tiedFromPrev) { ties.push('<tie type="stop"/>'); tied.push('<tied type="stop"/>'); }
    if (el.tieToNext) { ties.push('<tie type="start"/>'); tied.push('<tied type="start"/>'); }
    const accidental = el.accidental ? `<accidental>${ACC[el.accidental][0]}</accidental>` : '';
    return [
      '      <note>',
      `        <pitch><step>${step}</step>${alter ? `<alter>${alter}</alter>` : ''}<octave>${octave}</octave></pitch>`,
      `        <duration>${el.units}</duration>`,
      ties.length ? `        ${ties.join('')}` : '',
      `        <type>${type}</type>${'<dot/>'.repeat(dots)}${accidental}`,
      tied.length ? `        <notations>${tied.join('')}</notations>` : '',
      '      </note>',
    ].filter(Boolean).join('\n');
  }

  // music: the object returned by Notation.transcribe
  function toMusicXML(music, opts) {
    opts = opts || {};
    const title = opts.title || 'My hummed tune';
    const [beats, beatType] = music.timeSig.split('/');
    const clef = music.clef === 'bass' ? '<sign>F</sign><line>4</line>' : '<sign>G</sign><line>2</line>';
    const measures = music.measures.map((m, i) => {
      const parts = [`    <measure number="${i + 1}">`];
      if (i === 0) {
        parts.push(
          '      <attributes>',
          '        <divisions>2</divisions>', // 2 per quarter note, so an eighth note lasts 1
          `        <key><fifths>${music.key.acc}</fifths><mode>major</mode></key>`,
          `        <time><beats>${beats}</beats><beat-type>${beatType}</beat-type></time>`,
          `        <clef>${clef}</clef>`,
          '      </attributes>',
          '      <direction placement="above"><direction-type><metronome>' +
            `<beat-unit>quarter</beat-unit><per-minute>${music.bpm}</per-minute></metronome></direction-type>` +
            `<sound tempo="${music.bpm}"/></direction>`
        );
      }
      const wholeBarRest = m.length === 1 && m[0].rest && m[0].units === music.barUnits;
      m.forEach((el) => parts.push(noteXml(el, music.barUnits, wholeBarRest)));
      if (i === music.measures.length - 1) parts.push('      <barline location="right"><bar-style>light-heavy</bar-style></barline>');
      parts.push('    </measure>');
      return parts.join('\n');
    });
    return [
      '<?xml version="1.0" encoding="UTF-8" standalone="no"?>',
      '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">',
      '<score-partwise version="4.0">',
      `  <work><work-title>${esc(title)}</work-title></work>`,
      '  <identification><encoding><software>Song Making Machine</software>' +
        `<encoding-date>${(opts.date || new Date()).toISOString().slice(0, 10)}</encoding-date></encoding></identification>`,
      '  <part-list>',
      '    <score-part id="P1"><part-name>Voice</part-name>' +
        '<score-instrument id="P1-I1"><instrument-name>Piano</instrument-name></score-instrument>' +
        '<midi-instrument id="P1-I1"><midi-channel>1</midi-channel><midi-program>1</midi-program></midi-instrument></score-part>',
      '  </part-list>',
      '  <part id="P1">',
      measures.join('\n'),
      '  </part>',
      '</score-partwise>',
      '',
    ].join('\n');
  }

  // ---- Minimal ZIP writer (stored, no compression) ----
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }
  function utf8(s) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(s);
    return Uint8Array.from(Buffer.from(s, 'utf8'));
  }
  function zip(files) {
    const chunks = [];
    const central = [];
    let offset = 0;
    const u16 = (v) => [v & 0xff, (v >>> 8) & 0xff];
    const u32 = (v) => [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
    for (const f of files) {
      const name = utf8(f.name);
      const data = typeof f.data === 'string' ? utf8(f.data) : f.data;
      const crc = crc32(data);
      // DOS date 2024-01-01 00:00
      const time = 0, date = ((2024 - 1980) << 9) | (1 << 5) | 1;
      const local = new Uint8Array([
        ...u32(0x04034b50), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(time), ...u16(date),
        ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0),
      ]);
      chunks.push(local, name, data);
      central.push(new Uint8Array([
        ...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(time), ...u16(date),
        ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0), ...u16(0),
        ...u16(0), ...u16(0), ...u32(0), ...u32(offset),
      ]), name);
      offset += local.length + name.length + data.length;
    }
    const cdSize = central.reduce((a, c) => a + c.length, 0);
    const end = new Uint8Array([
      ...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length),
      ...u32(cdSize), ...u32(offset), ...u16(0),
    ]);
    const all = [...chunks, ...central, end];
    const out = new Uint8Array(all.reduce((a, c) => a + c.length, 0));
    let p = 0;
    for (const c of all) { out.set(c, p); p += c.length; }
    return out;
  }

  // Compressed MusicXML: a zip whose first entry is "mimetype", then the container and the score
  function toMXL(music, opts) {
    return xmlToMXL(toMusicXML(music, opts));
  }

  // Packs any MusicXML text (for example from the photo reader) as .mxl
  function xmlToMXL(xml) {
    return zip([
      { name: 'mimetype', data: 'application/vnd.recordare.musicxml' },
      {
        name: 'META-INF/container.xml',
        data: '<?xml version="1.0" encoding="UTF-8"?>\n<container><rootfiles>' +
          '<rootfile full-path="score.musicxml" media-type="application/vnd.recordare.musicxml+xml"/>' +
          '</rootfiles></container>\n',
      },
      { name: 'score.musicxml', data: xml },
    ]);
  }

  const api = { toMusicXML, toMXL, xmlToMXL, zip, crc32 };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MusicXML = api;
})(typeof window !== 'undefined' ? window : globalThis);
