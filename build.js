// Builds single-file pages from app/index.html with the engine inlined.
//   dist/hum-to-piano.html  - page body only (for publishing as a Claude Artifact)
//   docs/index.html         - full standalone page (open in any browser, or host on GitHub Pages)
const fs = require('fs');
const path = require('path');
const tpl = fs.readFileSync(path.join(__dirname, 'app/index.html'), 'utf8');
const engine = fs.readFileSync(path.join(__dirname, 'src/engine.js'), 'utf8');
const notation = fs.readFileSync(path.join(__dirname, 'src/notation.js'), 'utf8');
const body = tpl.replace('/*ENGINE*/', () => engine).replace('/*NOTATION*/', () => notation);
fs.mkdirSync(path.join(__dirname, 'dist'), { recursive: true });
fs.mkdirSync(path.join(__dirname, 'docs'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'dist/hum-to-piano.html'), body);
const full = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
</head>
<body>
${body}
</body>
</html>
`;
fs.writeFileSync(path.join(__dirname, 'docs/index.html'), full);
console.log('Built dist/hum-to-piano.html and docs/index.html');
