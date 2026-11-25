# Song Making Machine

Make songs with your voice. Two modules so far:

- **Hum to Piano** (`docs/index.html`): hum a tune for up to 10 seconds, see each note you hummed, and hear it played back on piano.
- **Photo to Sheet Music** (`docs/photo.html`): photograph the pages of a score, see them as sheet music pages, read the notes into MusicXML (export as `.mxl`), and play them back on piano. Playback is a full-version feature; until store purchases exist, a free "preview" switch unlocks it.

## Try it

Open `docs/index.html` in Chrome, Safari or Firefox (or turn on GitHub Pages for the `docs/` folder to get a link you can open on your phone).

Photo to Sheet Music needs the sheet music reader server running somewhere the page can reach (see below). Opening a MusicXML file works without it.

## The sheet music reader (server)

Reading notes from a photo (optical music recognition) is too heavy for a web page, so `server/omr_server.py` does it. It runs the free [homr](https://github.com/liebharc/homr) reader (AGPL-3.0) as a separate, unmodified program and returns MusicXML. The engine is swappable (`ENGINES` in the server), so a hosted service such as Flat's OMR API can be added later.

```
python3 -m venv .venv && .venv/bin/pip install -r server/requirements.txt
PATH=.venv/bin:$PATH python3 server/omr_server.py     # http://localhost:8765
```

The first run downloads homr's models. A page takes about 5 to 15 seconds on a laptop CPU. The page looks for the reader at `http://localhost:8765`; change it under "Sheet music reader", or open the page with `?server=https://your-reader.example`. Settings: `OMR_PORT`, `OMR_HOST` (use `0.0.0.0` on a hosted server), `OMR_ALLOWED_ORIGINS` (for example `https://spinacheater.github.io`), `OMR_MAX_PAGES`.

**On a Windows computer.** Put `server/omr_server.py` in the same folder as `server/windows/Start sheet music reader.bat`, then double-click the .bat file. The first run installs homr (about 5 minutes). After that it starts the reader and opens the live Photo to Sheet Music page, which finds the reader at `http://localhost:8765`.

**Hosting.** `server/Dockerfile` packs the reader into a container. On every PR that touches `server/`, the "Sheet music reader" GitHub workflow builds it and checks that it reads `test/fixtures/twinkle-photo.jpg` correctly. Run the workflow by hand from the Actions tab to publish it to a Hugging Face Space. That needs the repository secret `HF_TOKEN` and a Hugging Face PRO plan ($9/month), because Docker Spaces are no longer free. A page read uses about 1.5 GB of memory, so small free hosts (512 MB) are too small.

Known limits of homr: it reads pitch and rhythm on treble and bass clef, not dynamics, articulations or lyrics. Hymn-style choir music (two staves) reads well; open scores with four separate choir staves get paired into two piano-style grand staves, so their timing comes out wrong. Handwritten music is not supported.

## How it works

- `src/engine.js` finds the pitch of your voice every 10 ms (the YIN method), then groups those pitches into notes. It ignores the little scoop at the start of each note, handles vibrato, and can allow for a singer who is a bit sharp or flat overall. A clean-up setting (off, light, medium, strong) takes each note's pitch from its steadiest stretch and removes the slides, scoops and short blips a real voice makes between notes.
- `src/notation.js` turns those notes into written music: it estimates the tempo, picks the key signature, rounds each note to a note length (eighth, quarter, dotted quarter, half and so on), fills bars and ties notes across barlines.
- `src/musicxml.js` writes that music as MusicXML and packs it into a compressed `.mxl` file for MuseScore, Finale, Sibelius, Dorico and other notation apps.
- `app/index.html` is the page: recording, two views (pitch over time, and sheet music drawn with [VexFlow](https://www.vexflow.com)), and a small piano synthesizer built with the Web Audio API.
- `src/piano.js` is the small piano synthesizer built with the Web Audio API, shared by both modules.
- `src/score.js` reads MusicXML (and compressed `.mxl`) into timed notes for playback, with ties, chords, several voices and staves, pickup bars and tempo marks.
- `app/photo.html` is the Photo to Sheet Music page: camera and photo input, a page view with a cleaner "scan look", the reader call, the score drawn with [OpenSheetMusicDisplay](https://opensheetmusicdisplay.org), `.mxl` export, and playback with a speed control and per-line on/off so a singer can hear just their part.
- `build.js` puts them together into `docs/index.html`, `docs/photo.html` (standalone) and `dist/` (page bodies).

## Develop

```
node test/engine.test.js     # synthetic hum tests
node test/notation.test.js   # rhythm, key and bar tests
node test/messy.test.js      # messy human-like humming at each clean-up level
node test/musicxml.test.js tmp-mxl && python3 test/check_mxl.py tmp-mxl   # .mxl export, checked with music21
node test/score.test.js     # MusicXML reading, checked against music21 (needs Playwright)
python3 test/omr_server.test.py   # reader server request checks and page merging
node build.js              # rebuild the pages
```
