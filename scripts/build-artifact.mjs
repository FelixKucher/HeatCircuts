// Erzeugt aus dist-single/index.html ein Seitenfragment für die Vorschau auf claude.ai
// (dort wird das Dokumentgerüst <html>/<head>/<body> beim Veröffentlichen ergänzt).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const src = readFileSync('dist-single/index.html', 'utf8');
const head = src.match(/<head>([\s\S]*?)<\/head>/i)?.[1] ?? '';
const body = src.match(/<body>([\s\S]*?)<\/body>/i)?.[1] ?? '';
const headClean = head
  .replace(/<meta charset="[^"]*"\s*\/?>/i, '')
  .replace(/<meta name="viewport"[^>]*>/i, '');
const title = headClean.match(/<title>[\s\S]*?<\/title>/i)?.[0] ?? '<title>HeatCircuits</title>';
const rest = headClean.replace(title, '');
mkdirSync('dist-artifact', { recursive: true });
writeFileSync('dist-artifact/heatcircuits.html', `${title}\n${rest.trim()}\n${body.trim()}\n`);
console.log('dist-artifact/heatcircuits.html', (title.length + rest.length + body.length) / 1024 | 0, 'KiB');
