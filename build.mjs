// Renders Aidan's Canvas, its button and coordinate map, the README, and the issue form. Run: npm run build
// Text lives in native Markdown so GitHub styles it. Graphics use GitHub's own component values.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as fontkit from 'fontkit';
import { COLORS, COLUMNS, DAILY_LIMIT, DEFAULT_TILES, DOT_CELL, EMPTY_TILE, ROW_LETTERS, USER, cellId } from './scripts/canvas.mjs';

const OUT = process.env.CANVAS_OUT ?? '.';
const STATE = process.env.CANVAS_STATE ?? 'canvas/state.json';
const STEP = 15; // GitHub's contribution graph spacing.
const TILE = 11; // GitHub's contribution graph tile.
const W = COLUMNS * STEP - (STEP - TILE);
const H = ROW_LETTERS.length * STEP - (STEP - TILE);
const MAP_GUTTER = 32;
const MAP_TOP = 32;
const DOT_X = (Number(DOT_CELL.slice(1)) - 1) * STEP;
const DOT_Y = ROW_LETTERS.indexOf(DOT_CELL[0]) * STEP;
const NAME = 'Aidan’s Canvas';
const REPO_URL = `https://github.com/${USER}/${USER}`;
const FORM_URL = `${REPO_URL}/issues/new?template=place-tile.yml`;
const MAP_URL = `${REPO_URL}/blob/main/assets/canvas-map.svg?raw=true`;
const BUTTON = {
  light: { bg: '#f6f8fa', border: '#d1d9e0', fg: '#25292e', muted: '#59636e' },
  dark: { bg: '#212830', border: '#3d444d', fg: '#f0f6fc', muted: '#9198a1' },
};
const CURSOR = { light: '#0969da', dark: '#1f6feb' };

const { roles } = JSON.parse(readFileSync('design/project.tokens.json', 'utf8'));
const state = JSON.parse(readFileSync(STATE, 'utf8'));
const placed = state.placed ?? 0;
const tileWord = placed === 1 ? 'tile' : 'tiles';
const description = `${NAME}, a multiplayer pixel canvas that starts with the words Design Eng. and a smiley face. ${placed} custom ${tileWord} placed.`;

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Mona Sans is drawn as outlines: SVGs on GitHub cannot load web fonts, and the
// font's Reserved Font Name rules out embedding a trimmed copy.
const monaSans = fontkit.openSync('design/fonts/MonaSansVF[opsz,wght].woff2');
const outlined = { action: [14, 500], label: [14, 600] };
const instances = new Map();
function instance(size, wght) {
  const key = `${size}/${wght}`;
  if (!instances.has(key)) {
    const { min, max } = monaSans.variationAxes.opsz;
    instances.set(key, monaSans.getVariation({ wght, opsz: Math.min(max, Math.max(min, size)) }));
  }
  return instances.get(key);
}
const round = (d) => d.replace(/-?\d*\.\d+(e-?\d+)?/g, (n) => String(+(+n).toFixed(2)));

function measure(value, cls) {
  const [size, wght] = outlined[cls];
  const font = instance(size, wght);
  return font.layout(String(value)).positions.reduce((sum, p) => sum + p.xAdvance, 0) * size / font.unitsPerEm;
}

function outline(x, y, value, cls) {
  const [size, wght] = outlined[cls];
  const font = instance(size, wght);
  const run = font.layout(String(value));
  const scale = size / font.unitsPerEm;
  let pen = x;
  let d = '';
  run.glyphs.forEach((glyph, i) => {
    const p = run.positions[i];
    d += glyph.path.scale(scale, -scale).translate(pen + p.xOffset * scale, y - p.yOffset * scale).toSVG();
    pen += p.xAdvance * scale;
  });
  return `<path class="${cls}" d="${round(d)}"/>`;
}

const tileTokens = (m) => [
  `--contribution-0:${EMPTY_TILE[m]}`,
  ...Object.entries(COLORS).map(([key, value]) => `--tile-${key}:${value[m]}`),
].join(';');
const tileCss = `.tile{rx:var(--tile-radius)}
.empty{fill:var(--contribution-0)}
${Object.keys(COLORS).map((key) => `.c-${key}{fill:var(--tile-${key})}`).join('\n')}`;

function tiles(left, top, { animate = false, guides = false } = {}) {
  const fresh = new Set(state.fresh);
  let order = 0;
  let out = '';
  ROW_LETTERS.forEach((_, r) => {
    for (let c = 0; c < COLUMNS; c++) {
      const id = cellId(c, r);
      const custom = state.tiles[id];
      const color = custom?.color ?? DEFAULT_TILES.get(id);
      const dot = animate && id === DOT_CELL;
      const enter = animate && color && !dot && (!custom || fresh.has(id));
      const base = color ? `c-${color}` : guides && (c + 1) % 4 === 0 ? 'guide' : 'empty';
      const style = enter ? ` style="--i:${order++}"` : '';
      const geometry = `x="${left + c * STEP}" y="${top + r * STEP}" width="${TILE}" height="${TILE}"`;
      if (dot) out += `<rect class="tile empty" ${geometry}/>`;
      out += `<rect class="tile ${base}${enter ? ' enter' : ''}${dot ? ' dot' : ''}"${style} ${geometry}/>`;
    }
  });
  return out;
}

function renderCanvas(m) {
  const tipX = DOT_X + TILE / 2;
  const tipY = DOT_Y + TILE / 2;
  const tagWidth = Math.ceil((measure('Aidan', 'label') + 12) / 4) * 4;
  const cursor = `<rect class="selection" x="${DOT_X - 2.5}" y="${DOT_Y - 2.5}" width="16" height="16"/>
<g class="cursor"><g class="cursor-y"><path class="pointer" d="M0 0V20L5.4 14.8H13.5Z"/><g class="cursor-tag"><rect class="tag" x="13" y="18" width="${tagWidth}" height="24"/>${outline(19, 35, 'Aidan', 'label')}</g></g></g>`;

  // X and Y run on separate curves so the path arcs like a hand instead of following a straight line.
  const timing = 'var(--motion-cursor) var(--easing-linear) var(--motion-cursor-delay) both';
  const motion = `.cursor{opacity:0;animation:cursor-x ${timing}}
.cursor-y{animation:cursor-y ${timing}}
.pointer{fill:var(--cursor);stroke:var(--on-emphasis);stroke-width:1.5;stroke-linejoin:round;transform-origin:0 0;animation:pointer ${timing}}
.cursor-tag{animation:cursor-tag ${timing}}
.tag{fill:var(--cursor);rx:var(--tag-radius)}
.label{font-size:var(--type-label-size);font-weight:600;fill:var(--on-emphasis)}
.selection{opacity:0;fill:none;stroke:var(--cursor);stroke-width:2;rx:var(--tag-radius);animation:selection ${timing}}
.dot{transform-box:fill-box;transform-origin:center;animation:dot ${timing}}
@keyframes cursor-x{0%{opacity:1;transform:translateX(${W + 24}px);animation-timing-function:var(--easing-arriveX)}26%{opacity:1;transform:translateX(${tipX - 3}px);animation-timing-function:var(--easing-easeInOut)}33%,66%{opacity:1;transform:translateX(${tipX}px);animation-timing-function:var(--easing-leaveX)}100%{opacity:1;transform:translateX(${W + 24}px)}}
@keyframes cursor-y{0%{transform:translateY(${H + 48}px);animation-timing-function:var(--easing-arriveY)}29%{transform:translateY(${tipY + 2}px);animation-timing-function:var(--easing-easeInOut)}36%,68%{transform:translateY(${tipY}px);animation-timing-function:var(--easing-leaveY)}100%{transform:translateY(-64px)}}
@keyframes pointer{0%{transform:rotate(-12deg) scale(1);animation-timing-function:var(--easing-easeOut)}32%,41%{transform:rotate(0) scale(1);animation-timing-function:var(--easing-easeInOut)}45%{transform:rotate(0) scale(.84);animation-timing-function:var(--easing-easeOut)}52%,66%{transform:rotate(0) scale(1);animation-timing-function:var(--easing-easeInOut)}100%{transform:rotate(10deg) scale(1)}}
@keyframes cursor-tag{0%{transform:translate(10px,8px);animation-timing-function:var(--easing-easeOut)}34%,68%{transform:translate(0,0);animation-timing-function:var(--easing-easeInOut)}100%{transform:translate(-8px,7px)}}
@keyframes selection{0%,37%{opacity:0;animation-timing-function:var(--easing-easeOut)}41%,62%{opacity:1;animation-timing-function:var(--easing-easeInOut)}72%,100%{opacity:0}}
@keyframes dot{0%,45%{opacity:0;transform:scale(.4);animation-timing-function:var(--easing-easeOut)}51%{opacity:1;transform:scale(1.1);animation-timing-function:var(--easing-easeInOut)}58%,100%{opacity:1;transform:scale(1)}}`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(description)}">
<title>${esc(description)}</title>
<style>
:root{${tileTokens(m)};--cursor:${CURSOR[m]};--on-emphasis:#ffffff;--tile-radius:2px;--tag-radius:3px;--type-label-size:14px;--easing-linear:linear;--easing-easeOut:cubic-bezier(.3,.8,.6,1);--easing-easeInOut:cubic-bezier(.65,0,.35,1);--easing-arriveX:cubic-bezier(.16,.84,.28,1);--easing-arriveY:cubic-bezier(.42,0,.18,1);--easing-leaveX:cubic-bezier(.56,0,.86,.42);--easing-leaveY:cubic-bezier(.34,0,.72,.3);--motion-enter:400ms;--motion-stagger:8ms;--motion-cursor:3000ms;--motion-cursor-delay:1500ms}
${tileCss}
.enter{transform-box:fill-box;transform-origin:center;animation:enter var(--motion-enter) var(--easing-easeOut) calc(var(--i)*var(--motion-stagger)) both}
@keyframes enter{from{opacity:0;transform:scale(.72)}to{opacity:1;transform:scale(1)}}
${motion}
@media (prefers-reduced-motion:reduce){.enter,.cursor,.cursor-y,.pointer,.cursor-tag,.selection,.dot{animation:none}}
</style>
${tiles(0, 0, { animate: true })}
${cursor}
</svg>
`;
}

// GitHub's default medium button at 1:1, matching Edit profile.
function renderButton(m) {
  const text = 'Place a tile';
  const iconSize = 16;
  const gap = 8;
  const textWidth = measure(text, 'action');
  const width = Math.ceil((12 + iconSize + gap + textWidth + 12) / 4) * 4;
  const height = 32;
  const startX = (width - (iconSize + gap + textWidth)) / 2;
  const border = `M6 .5h${width - 12}a5.5 5.5 0 0 1 5.5 5.5v${height - 12}a5.5 5.5 0 0 1-5.5 5.5h-${width - 12}a5.5 5.5 0 0 1-5.5-5.5v-${height - 12}a5.5 5.5 0 0 1 5.5-5.5Z`;
  const c = BUTTON[m];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${text}">
<title>${text}</title>
<style>
:root{--button-bg:${c.bg};--button-border:${c.border};--button-fg:${c.fg};--button-icon:${c.muted};--button-radius:6px;--type-action-size:14px}
.bg{fill:var(--button-bg);rx:var(--button-radius)}
.border{fill:none;stroke:var(--button-border)}
.icon{fill:var(--button-icon)}
.action{font-size:var(--type-action-size);font-weight:500;fill:var(--button-fg)}
</style>
<rect class="bg" width="${width}" height="${height}"/>
<path class="border" d="${border}"/>
<path class="icon" transform="translate(${startX} 8)" d="M7.75 2a.75.75 0 0 1 .75.75V7h4.25a.75.75 0 0 1 0 1.5H8.5v4.25a.75.75 0 0 1-1.5 0V8.5H2.75a.75.75 0 0 1 0-1.5H7V2.75A.75.75 0 0 1 7.75 2Z"/>
${outline(startX + iconSize + gap, 21, text, 'action')}
</svg>
`;
}

// Shown inside the tile form. It has an opaque background so it stays legible in any GitHub theme.
function renderMap() {
  const mapW = Math.ceil((MAP_GUTTER + W + 8) / 4) * 4;
  const mapH = Math.ceil((MAP_TOP + H + 8) / 4) * 4;
  const label = (x, y, value, anchor) => `<text class="map-label" x="${x}" y="${y}" text-anchor="${anchor}">${esc(value)}</text>`;
  let body = `<rect class="canvas" width="${mapW}" height="${mapH}"/>`;
  for (let c = 3; c < COLUMNS; c += 4) body += label(MAP_GUTTER + c * STEP + TILE / 2, MAP_TOP - 10, c + 1, 'middle');
  ROW_LETTERS.forEach((letter, r) => { if (r % 2 === 0) body += label(MAP_GUTTER - 10, MAP_TOP + r * STEP + 10, letter, 'end'); });
  body += tiles(MAP_GUTTER, MAP_TOP, { guides: true });
  const title = `Map of ${NAME} with row letters A to M and column numbers 1 to ${COLUMNS}.`;
  const modeTokens = (m) => `${tileTokens(m)};--map-bg:${roles['bg.primary'][m]};--map-guide:${roles['fill.secondary'][m]};--map-label:${roles['label.secondary'][m]}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${mapW} ${mapH}" width="${mapW}" height="${mapH}" role="img" aria-label="${esc(title)}">
<title>${esc(title)}</title>
<style>
:root{${modeTokens('light')};--tile-radius:2px;--type-map-size:12px;--fontStack-monospace:ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,"Liberation Mono",monospace}
@media (prefers-color-scheme:dark){:root{${modeTokens('dark')}}}
.canvas{fill:var(--map-bg)}
.guide{fill:var(--map-guide)}
.map-label{font-family:var(--fontStack-monospace);font-size:var(--type-map-size);fill:var(--map-label)}
${tileCss}
</style>
${body}
</svg>
`;
}

const dropdown = (id, label, options) => `  - type: dropdown
    id: ${id}
    attributes:
      label: ${label}
      options:
${options.map((o) => `        - "${o}"`).join('\n')}
    validations:
      required: true
`;

const issueForm = `name: Place a tile
description: Add a tile to Aidan's Canvas.
title: "Place a tile"
labels: [tile]
body:
  - type: markdown
    attributes:
      value: |
        ![Map of the canvas with row letters and column numbers](${MAP_URL})

        Choose a spot and a shade. You can place up to ${DAILY_LIMIT} tiles a day, one per submission. New tiles appear daily, and the canvas resets weekly.

        Aidan takes no responsibility for what is drawn here.
${dropdown('row', 'Row', ROW_LETTERS)}${dropdown('column', 'Column', Array.from({ length: COLUMNS }, (_, i) => i + 1))}${dropdown('color', 'Color', Object.values(COLORS).map((c) => c.label))}`;

mkdirSync(join(OUT, 'assets'), { recursive: true });
// GitHub's CDN caches images by path for five minutes, so each canvas version gets its own filename.
for (const file of readdirSync(join(OUT, 'assets'))) {
  if (/^canvas-(?:light|dark)(?:-[a-f0-9]{10})?\.svg$/.test(file)) rmSync(join(OUT, 'assets', file));
}
const canvasFile = {};
for (const mode of ['light', 'dark']) {
  const svg = renderCanvas(mode);
  canvasFile[mode] = `canvas-${mode}-${createHash('sha256').update(svg).digest('hex').slice(0, 10)}.svg`;
  writeFileSync(join(OUT, 'assets', canvasFile[mode]), svg);
  writeFileSync(join(OUT, 'assets', `button-${mode}.svg`), renderButton(mode));
}
writeFileSync(join(OUT, 'assets', 'canvas-map.svg'), renderMap());

const themed = (render) => ['light', 'dark'].map((mode) => render(mode, `${FORM_URL}#gh-${mode}-mode-only`)).join('');
const button = themed((mode, href) => `<a href="${href}"><img align="right" src="assets/button-${mode}.svg" alt="Place a tile"></a>`);
const canvas = themed((mode, href) => `[![${description} Select to place a tile.](assets/${canvasFile[mode]})](${href})`);
writeFileSync(join(OUT, 'README.md'), `<h3>${button}${NAME}</h3>

A collaborative experiment. Place up to three tiles a day. Resets weekly.

${canvas}

<sub><b>${placed}</b> custom ${tileWord} placed &middot; New tiles appear daily &middot; Aidan takes no responsibility for what is drawn here.</sub>
`);

if (OUT === '.') {
  mkdirSync('.github/ISSUE_TEMPLATE', { recursive: true });
  writeFileSync('.github/ISSUE_TEMPLATE/place-tile.yml', issueForm);
}
console.log(`Built ${NAME}: ${placed} custom ${tileWord} placed, ${DEFAULT_TILES.size} default tiles, ${W}x${H}`);
