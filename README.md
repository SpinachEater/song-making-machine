# Song Making Machine

Make songs with your voice. Step 1 is **Hum to Piano**: hum a tune for up to 10 seconds, see each note you hummed, and hear it played back on piano.

## Try it

Open `docs/index.html` in Chrome, Safari or Firefox (or turn on GitHub Pages for the `docs/` folder to get a link you can open on your phone).

## How it works

- `src/engine.js` finds the pitch of your voice every 10 ms (the YIN method), then groups those pitches into notes. It ignores the little scoop at the start of each note, handles vibrato, and can allow for a singer who is a bit sharp or flat overall.
- `app/index.html` is the page: recording, the piano roll, and a small piano synthesizer built with the Web Audio API.
- `build.js` puts them together into `docs/index.html` (standalone) and `dist/hum-to-piano.html`.

## Develop

```
node test/engine.test.js   # synthetic hum tests
node build.js              # rebuild the pages
```
