# Song Making Machine

Make songs with your voice. Step 1 is **Hum to Piano**: hum a tune for up to 10 seconds, see each note you hummed, and hear it played back on piano.

## Try it

Open `docs/index.html` in Chrome, Safari or Firefox (or turn on GitHub Pages for the `docs/` folder to get a link you can open on your phone).

## How it works

- `src/engine.js` finds the pitch of your voice every 10 ms (the YIN method), then groups those pitches into notes. It ignores the little scoop at the start of each note, handles vibrato, and can allow for a singer who is a bit sharp or flat overall. A clean-up setting (off, light, medium, strong) takes each note's pitch from its steadiest stretch and removes the slides, scoops and short blips a real voice makes between notes.
- `src/notation.js` turns those notes into written music: it estimates the tempo, picks the key signature, rounds each note to a note length (eighth, quarter, dotted quarter, half and so on), fills bars and ties notes across barlines.
- `app/index.html` is the page: recording, two views (pitch over time, and sheet music drawn with [VexFlow](https://www.vexflow.com)), and a small piano synthesizer built with the Web Audio API.
- `build.js` puts them together into `docs/index.html` (standalone) and `dist/hum-to-piano.html`.

## Develop

```
node test/engine.test.js     # synthetic hum tests
node test/notation.test.js   # rhythm, key and bar tests
node test/messy.test.js      # messy human-like humming at each clean-up level
node build.js              # rebuild the pages
```
