// Builds single-file pages from the app/ templates with the src/ modules inlined.
//   docs/index.html  + dist/hum-to-piano.html            Hum to Piano
//   docs/photo.html  + dist/photo-to-sheet-music.html    Photo to Sheet Music
// docs/ pages are full standalone pages (open in any browser, or host on GitHub Pages);
// dist/ pages are the page body only (for publishing as a Claude Artifact).
const fs = require('fs');
const path = require('path');
const read = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');
const inline = {
  '/*ENGINE*/': () => read('src/engine.js'),
  '/*NOTATION*/': () => read('src/notation.js'),
  '/*MUSICXML*/': () => read('src/musicxml.js'),
  '/*PIANO*/': () => read('src/piano.js'),
  '/*SCORE*/': () => read('src/score.js'),
  '/*EXAMPLE_PHOTO*/': () => 'data:image/jpeg;base64,' + fs.readFileSync(path.join(__dirname, 'app/assets/example-photo.jpg')).toString('base64'),
};
const pages = [
  { src: 'app/index.html', docs: 'docs/index.html', dist: 'dist/hum-to-piano.html' },
  { src: 'app/photo.html', docs: 'docs/photo.html', dist: 'dist/photo-to-sheet-music.html' },
];
fs.mkdirSync(path.join(__dirname, 'dist'), { recursive: true });
fs.mkdirSync(path.join(__dirname, 'docs'), { recursive: true });
for (const p of pages) {
  let body = read(p.src);
  for (const [marker, get] of Object.entries(inline)) if (body.includes(marker)) body = body.replace(marker, get);
  fs.writeFileSync(path.join(__dirname, p.dist), body);
  fs.writeFileSync(path.join(__dirname, p.docs), `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
</head>
<body>
${body}
</body>
</html>
`);
  console.log(`Built ${p.docs} and ${p.dist}`);
}
