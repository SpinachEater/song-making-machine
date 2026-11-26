// Tests src/score.js (MusicXML -> timed notes) in a real browser, since it uses DOMParser.
//   node test/score.test.js
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const fx = (f) => path.join(__dirname, 'fixtures', f);
let failed = 0;
function check(name, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
  if (!ok) failed++;
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent('<html><body></body></html>');
  await page.addScriptTag({ content: fs.readFileSync(path.join(__dirname, '../src/score.js'), 'utf8') });

  // 1. Bach chorale (4 voices, pickup bar, ties, tempo 96) against music21's reading of the same file
  const bachXml = fs.readFileSync(fx('bach-bwv66.6.musicxml'), 'utf8');
  const expected = JSON.parse(fs.readFileSync(fx('bach-bwv66.6.expected.json'), 'utf8'));
  const bach = await page.evaluate((x) => Score.parse(x), bachXml);
  const got = bach.notes.map((n) => [n.midi, n.beat, n.beats]).sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
  const same = got.length === expected.length && got.every((g, i) => g.every((v, j) => Math.abs(v - expected[i][j]) < 1e-6));
  check('Bach chorale: every note, start and length matches music21', same, `${got.length}/${expected.length} notes`);
  check('Bach chorale: four singable lines', bach.staves.length === 4, bach.staves.map((s) => s.name).join(', '));
  check('Bach chorale: tempo 96', bach.bpm === 96 && bach.tempoGiven);
  const first = bach.notes[0];
  check('Bach chorale: seconds follow the tempo', Math.abs(first.dur - first.beats * 60 / 96) < 1e-6);

  // 2. What homr read from a phone-style photo of the same chorale: same notes and lengths.
  //    (homr pairs four separate choir staves into two piano-style grand staves, so the
  //    timing of this file is not the original's; see README "Known limits".)
  const homrXml = fs.readFileSync(fx('bach-bwv66.6-homr.musicxml'), 'utf8');
  const homr = await page.evaluate((x) => Score.parse(x), homrXml);
  const key = (a) => a.map((n) => n.join('/')).sort();
  const bagE = key(expected.map(([m, , q]) => [m, q]));
  const bagH = key(homr.notes.map((n) => [n.midi, n.beats]));
  check('homr photo result: same notes and lengths as the original', JSON.stringify(bagE) === JSON.stringify(bagH), `${bagH.length} notes`);
  check('homr photo result: read as one grand-staff part', homr.parts.length === 1 && homr.staves.length === 2);
  check('homr photo result: no tempo given, uses default', !homr.tempoGiven && homr.bpm === 90);

  // 3. Compressed .mxl exported by Hum to Piano
  const mxl = [...fs.readFileSync(fx('twinkle.mxl'))];
  const tw = await page.evaluate(async (b) => Score.parse(await Score.readFile(new Uint8Array(b))), mxl);
  const names = tw.notes.map((n) => n.midi).join(',');
  check('.mxl: Twinkle opens from the zip', names === '60,60,67,67,69,69,67,65,65,64,64,62,62,60', names);
  check('.mxl: title kept', /Twinkle/.test(tw.title), tw.title);

  // 4. Joining pages: three copies of the homr result become one score three times as long
  const merged = await page.evaluate((x) => {
    const one = Score.parse(x);
    const three = Score.parse(Score.merge([x, x, x]));
    return { m1: one.measures, m3: three.measures, n1: one.notes.length, n3: three.notes.length, d1: one.duration, d3: three.duration };
  }, homrXml);
  check('merge: bars and notes triple', merged.m3 === 3 * merged.m1 && merged.n3 === 3 * merged.n1, `${merged.m3} bars, ${merged.n3} notes`);
  check('merge: pages play one after another', Math.abs(merged.d3 - 3 * merged.d1) < 0.5, `${merged.d1.toFixed(1)} s -> ${merged.d3.toFixed(1)} s`);

  // 4. Bad input gives a plain message
  const err = await page.evaluate(() => { try { Score.parse('<html>nope</html>'); return ''; } catch (e) { return e.message; } });
  check('Not MusicXML: clear error', /not a MusicXML score|not valid MusicXML/.test(err), err);

  await browser.close();
  console.log(failed ? `\n${failed} failed` : '\nAll score tests passed');
  process.exit(failed ? 1 : 0);
})();
