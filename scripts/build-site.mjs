// Assembles the picker for GitHub Pages in _site/.
import { cpSync, mkdirSync, rmSync } from 'node:fs';

rmSync('_site', { recursive: true, force: true });
mkdirSync('_site/fonts', { recursive: true });
cpSync('site', '_site', { recursive: true });
cpSync('scripts/canvas.mjs', '_site/canvas.mjs');
cpSync('design/fonts/MonaSansVF[opsz,wght].woff2', '_site/fonts/MonaSansVF.woff2');
cpSync('design/fonts/OFL.txt', '_site/fonts/OFL.txt');
console.log('Built _site');
