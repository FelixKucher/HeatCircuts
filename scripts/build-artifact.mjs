// Erzeugt aus <dir>/index.html (Standard dist-single) ein Seitenfragment für die Vorschau auf claude.ai
// (dort wird das Dokumentgerüst <html>/<head>/<body> beim Veröffentlichen ergänzt).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const [dir = 'dist-single', out = 'heatcircuits.html'] = process.argv.slice(2);
const src = readFileSync(`${dir}/index.html`, 'utf8');
// eingebettete Skripte können „</body>“ als Text enthalten: von hinten suchen
const bodyOpen = src.lastIndexOf('<body>');
const bodyClose = src.lastIndexOf('</body>');
const headOpen = src.indexOf('<head>');
const headClose = src.lastIndexOf('</head>', bodyOpen);
if (bodyOpen < 0 || bodyClose < bodyOpen || headOpen < 0 || headClose < headOpen) throw new Error('Dokumentgerüst nicht gefunden');
const head = src.slice(headOpen + 6, headClose);
const body = src.slice(bodyOpen + 6, bodyClose);
const headClean = head
  .replace(/<meta charset="[^"]*"\s*\/?>/i, '')
  .replace(/<meta name="viewport"[^>]*>/i, '');
const title = headClean.match(/<title>[\s\S]*?<\/title>/i)?.[0] ?? '<title>HeatCircuits</title>';
const rest = headClean.replace(title, '');
mkdirSync('dist-artifact', { recursive: true });
writeFileSync(`dist-artifact/${out}`, `${title}\n${rest.trim()}\n${body.trim()}\n`);
console.log(`dist-artifact/${out}`, (title.length + rest.length + body.length) / 1024 | 0, 'KiB');
