// Renders Aidan's Canvas, its button and coordinate map, the README, and the issue form. Run: npm run build
// Text lives in native Markdown so GitHub styles it. Graphics use GitHub's own component values.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as fontkit from 'fontkit';
import {
  COLORS, COLUMNS, DAILY_LIMIT, DEFAULT_TILES, DOT_CELL, EMPTY_TILE, MAX_VISITORS, ROW_LETTERS, SITE_URL, cellId, visitorReplay,
} from './scripts/canvas.mjs';

const OUT = process.env.CANVAS_OUT ?? '.';
const STATE = process.env.CANVAS_STATE ?? 'canvas/state.json';
const STEP = 15; // GitHub's contribution graph spacing.
const TILE = 11; // GitHub's contribution graph tile.
const W = COLUMNS * STEP - (STEP - TILE);
const H = ROW_LETTERS.length * STEP - (STEP - TILE);
const DOT_X = (Number(DOT_CELL.slice(1)) - 1) * STEP;
const DOT_Y = ROW_LETTERS.indexOf(DOT_CELL[0]) * STEP;
const NAME = 'Aidan’s Canvas';
const BUTTON = {
  light: { bg: '#f6f8fa', border: '#d1d9e0', fg: '#25292e', muted: '#59636e' },
  dark: { bg: '#212830', border: '#3d444d', fg: '#f0f6fc', muted: '#9198a1' },
};
const CURSOR = { light: '#0969da', dark: '#1f6feb' };
// Visitor cursors use GitHub's emphasis colours (done, sponsors, severe, danger, attention), never Aidan's blue or the tile greens.
const VISITOR_COLORS = {
  light: ['#8250df', '#bf3989', '#bc4c00', '#cf222e', '#9a6700'],
  dark: ['#8957e5', '#bf4b8a', '#bd561d', '#da3633', '#9e6a03'],
};
if (VISITOR_COLORS.light.length < MAX_VISITORS) throw new Error('Every visitor on screen needs its own cursor colour');
const VISITOR = {
  firstStart: 2300, // Aidan's cursor is mid-flight, so the canvas feels busy rather than queued.
  stagger: 650,
  // Entrances and exits take longer the further they fly, within these bounds.
  arrive: { base: 420, perPx: 0.75, min: 650, max: 1000 },
  leave: { base: 380, perPx: 0.6, min: 560, max: 860 },
  // Entrances and exits cross at least this much of the canvas, so a cursor bound for an edge tile
  // flies in across the drawing instead of popping in at the edge already landed.
  minVisible: 100,
  inset: 28, // Only path through the canvas interior counts, so cursors don't skim along an edge half clipped.
  backEdgePenalty: 80, // Mild preference for arriving from the bottom or sides and leaving by the top or sides.
  retracePenalty: 260, // Leaving along the line you came in on reads as a yo-yo.
  dwell: 340,
  hopBase: 240,
  hopPerPx: 0.9,
  hopMax: 380,
  activeMax: 5200, // Someone with a whole week of tiles speeds up instead of holding the stage.
  minDwell: 230,
  minHop: 170,
};

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

// clicks maps a replayed cell to the moment a visitor's cursor clicks it, and the cursor's colour slot.
function tiles(clicks = new Map()) {
  let order = 0;
  let out = '';
  ROW_LETTERS.forEach((_, r) => {
    for (let c = 0; c < COLUMNS; c++) {
      const id = cellId(c, r);
      const custom = state.tiles[id];
      const color = custom?.color ?? DEFAULT_TILES.get(id);
      const dot = id === DOT_CELL;
      const click = clicks.get(id);
      const geometry = `x="${c * STEP}" y="${r * STEP}" width="${TILE}" height="${TILE}"`;
      if (dot) {
        out += `<rect class="tile empty" ${geometry}/><rect class="tile c-${color} dot" ${geometry}/>`;
      } else if (click) {
        // What was there before shows until the visitor's cursor clicks.
        const before = DEFAULT_TILES.get(id);
        out += `<rect class="tile ${before ? `c-${before} enter" style="--i:${order++}"` : 'empty"'} ${geometry}/>`;
        out += `<rect class="tile c-${color} placed" style="--t:${click.at}ms" ${geometry}/>`;
        out += `<rect class="pick v${click.slot}-stroke" style="--t:${click.at}ms" x="${c * STEP - 2.5}" y="${r * STEP - 2.5}" width="16" height="16"/>`;
      } else {
        const style = color ? ` style="--i:${order++}"` : '';
        out += `<rect class="tile ${color ? `c-${color} enter` : 'empty'}"${style} ${geometry}/>`;
      }
    }
  });
  return out;
}

const tip = (cell) => ({ x: (Number(cell.slice(1)) - 1) * STEP + TILE / 2, y: ROW_LETTERS.indexOf(cell[0]) * STEP + TILE / 2 });
const slotFor = (login) => [...login.toLowerCase()].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7) % VISITOR_COLORS.light.length;

// Plans one visitor's flight: in from the nearest edge, a click on each tile, out the nearest edge.
function flight(cells, tagWidth) {
  const points = cells.map(({ cell }) => tip(cell));
  // Like Figma, the tag hops above or to the left of the pointer wherever it would be cut off.
  const shift = points.map((p) => ({ x: p.x + 13 + tagWidth > W ? -(tagWidth + 17) : 0, y: p.y + 42 > H ? -48 : 0 }));
  // The pointer and tag together, relative to the tip, with the tag nudged as it trails in or out.
  const reach = ({ x, y }, nudge) => ({
    left: Math.min(0, 13 + x + nudge.x),
    right: Math.max(14, 13 + x + nudge.x + tagWidth),
    top: Math.min(0, 18 + y + nudge.y),
    bottom: Math.max(20, 42 + y + nudge.y),
  });
  const margin = 8;
  // How much of a straight path from the tile to `to` runs through the canvas interior.
  const visible = (p, to) => {
    const { inset } = VISITOR;
    let enter = 0;
    let exit = 1;
    for (const [a, d, size] of [[p.x, to.x - p.x, W], [p.y, to.y - p.y, H]]) {
      if (d === 0) {
        if (a < inset || a > size - inset) return 0;
        continue;
      }
      const t1 = (inset - a) / d;
      const t2 = (size - inset - a) / d;
      enter = Math.max(enter, Math.min(t1, t2));
      exit = Math.min(exit, Math.max(t1, t2));
    }
    return Math.max(0, exit - enter) * Math.hypot(to.x - p.x, to.y - p.y);
  };
  // Off-canvas points all around the frame, far enough out that the whole cursor and tag are hidden.
  const ring = (box) => {
    const out = [];
    for (let y = -40; y <= H + 40; y += 30) {
      out.push({ edge: 'right', x: W - box.left + margin, y }, { edge: 'left', x: -box.right - margin, y });
    }
    for (let x = -40; x <= W + 40; x += 40) {
      out.push({ edge: 'bottom', x, y: H - box.top + margin }, { edge: 'top', x, y: -box.bottom - margin });
    }
    return out;
  };
  // The shortest flight that still crosses enough canvas to read as a flight.
  const direction = (from, to) => {
    const length = Math.hypot(to.x - from.x, to.y - from.y) || 1;
    return { x: (to.x - from.x) / length, y: (to.y - from.y) / length };
  };
  const pick = (p, box, backEdge, avoid) => {
    const cost = (c) => {
      const d = direction(p, c);
      const retrace = avoid && d.x * avoid.x + d.y * avoid.y > 0.8 ? VISITOR.retracePenalty : 0;
      return Math.hypot(c.x - p.x, c.y - p.y) + (c.edge === backEdge ? VISITOR.backEdgePenalty : 0) + retrace;
    };
    const options = ring(box);
    const good = options.filter((c) => visible(p, c) >= VISITOR.minVisible);
    return (good.length ? good : options).reduce((a, b) => (cost(b) < cost(a) ? b : a));
  };
  const start = pick(points[0], reach(shift[0], { x: 10, y: 8 }), 'top');
  // The exit avoids the line the cursor arrived on, measured from wherever it last touched down.
  const cameFrom = points.length > 1 ? points.at(-2) : start;
  const end = pick(points.at(-1), reach(shift.at(-1), { x: -8, y: 7 }), 'bottom', direction(points.at(-1), cameFrom));
  const timed = ({ base, perPx, min, max }, from, to) => Math.min(max, Math.max(min, base + Math.hypot(to.x - from.x, to.y - from.y) * perPx));
  const arrive = timed(VISITOR.arrive, start, points[0]);
  const leave = timed(VISITOR.leave, points.at(-1), end);

  const hops = points.slice(1).map((p, i) => Math.min(
    VISITOR.hopMax, VISITOR.hopBase + Math.hypot(p.x - points[i].x, p.y - points[i].y) * VISITOR.hopPerPx,
  ));
  const active = VISITOR.dwell * points.length + hops.reduce((a, b) => a + b, 0);
  const squeeze = Math.min(1, VISITOR.activeMax / active);
  const dwell = Math.max(VISITOR.minDwell, VISITOR.dwell * squeeze);

  const stops = [];
  let t = arrive;
  points.forEach((p, i) => {
    if (i) t += Math.max(VISITOR.minHop, hops[i - 1] * squeeze);
    stops.push({ ...p, arrive: t, click: t + dwell * 0.38, depart: t + dwell });
    t += dwell;
  });
  return { start, end, shift, stops, duration: t + leave };
}

function visitorCursors() {
  const used = new Set();
  const clicks = new Map();
  let markup = '';
  let css = '';
  visitorReplay(state.tiles).forEach(({ login, cells }, n) => {
    let slot = slotFor(login);
    while (used.has(slot)) slot = (slot + 1) % VISITOR_COLORS.light.length;
    used.add(slot);
    const tagWidth = Math.ceil((measure(login, 'label') + 12) / 4) * 4;
    const { start, end, shift, stops, duration } = flight(cells, tagWidth);
    const delay = VISITOR.firstStart + n * VISITOR.stagger;
    stops.forEach((s, i) => clicks.set(cells[i].cell, { at: Math.round(delay + s.click), slot }));

    const pct = (ms) => `${+(ms / duration * 100).toFixed(2)}%`;
    const axis = (key, from, to, arriveEase, hopEase, leaveEase) => [
      `0%{opacity:1;transform:${key}(${from}px);animation-timing-function:var(${arriveEase})}`,
      ...stops.flatMap((s, i) => [
        `${pct(s.arrive)}{opacity:1;transform:${key}(${s[key === 'translateX' ? 'x' : 'y']}px);animation-timing-function:var(--easing-linear)}`,
        `${pct(s.depart)}{opacity:1;transform:${key}(${s[key === 'translateX' ? 'x' : 'y']}px);animation-timing-function:var(${i === stops.length - 1 ? leaveEase : hopEase})}`,
      ]),
      `100%{opacity:1;transform:${key}(${to}px)}`,
    ].join('');
    const press = stops.flatMap((s) => {
      const gap = s.depart - s.arrive;
      return [
        `${pct(s.arrive + gap * 0.1)}{transform:rotate(0) scale(1);animation-timing-function:var(--easing-easeOut)}`,
        `${pct(s.click)}{transform:rotate(0) scale(.84);animation-timing-function:var(--easing-easeOut)}`,
        `${pct(s.arrive + gap * 0.8)}{transform:rotate(0) scale(1);animation-timing-function:var(--easing-easeInOut)}`,
      ];
    }).join('');
    const tagStops = stops.map((s, i) => `${pct(s.arrive)},${pct(s.depart)}{transform:translate(${shift[i].x}px,${shift[i].y}px);animation-timing-function:var(--easing-easeInOut)}`).join('');
    const timing = `${duration}ms var(--easing-linear) ${delay}ms both`;
    css += `.v${n}{animation:v${n}-x ${timing}}.v${n}-y{animation:v${n}-y ${timing}}.v${n}-p{animation:v${n}-p ${timing}}.v${n}-t{animation:v${n}-t ${timing}}
@keyframes v${n}-x{${axis('translateX', start.x, end.x, '--easing-arriveX', '--easing-easeInOut', '--easing-leaveX')}}
@keyframes v${n}-y{${axis('translateY', start.y, end.y, '--easing-arriveY', '--easing-hopY', '--easing-leaveY')}}
@keyframes v${n}-p{0%{transform:rotate(-12deg) scale(1);animation-timing-function:var(--easing-easeOut)}${press}100%{transform:rotate(10deg) scale(1)}}
@keyframes v${n}-t{0%{transform:translate(${shift[0].x + 10}px,${shift[0].y + 8}px);animation-timing-function:var(--easing-easeOut)}${tagStops}100%{transform:translate(${shift.at(-1).x - 8}px,${shift.at(-1).y + 7}px)}}
`;
    markup += `<g class="vcursor v${n}"><g class="v${n}-y"><path class="vpointer v${slot}-fill v${n}-p" d="M0 0V20L5.4 14.8H13.5Z"/><g class="v${n}-t"><rect class="vtag v${slot}-fill" x="13" y="18" width="${tagWidth}" height="24"/>${outline(19, 35, login, 'label')}</g></g></g>\n`;
  });
  return { clicks, markup, css };
}

function renderCanvas(m) {
  const visitors = visitorCursors();
  const visitorCss = `${VISITOR_COLORS[m].map((color, i) => `.v${i}-fill{fill:${color}}.v${i}-stroke{stroke:${color}}`).join('')}
.vcursor{opacity:0}
.vpointer{stroke:var(--on-emphasis);stroke-width:1.5;stroke-linejoin:round;transform-origin:0 0}
.vtag{rx:var(--tag-radius)}
.placed{transform-box:fill-box;transform-origin:center;animation:place var(--motion-place) var(--easing-easeOut) var(--t) both}
.pick{opacity:0;fill:none;stroke-width:2;rx:var(--tag-radius);animation:pick var(--motion-pick) var(--easing-easeInOut) calc(var(--t) - 160ms) both}
@keyframes place{0%{opacity:0;transform:scale(.4)}60%{opacity:1;transform:scale(1.1)}100%{opacity:1;transform:scale(1)}}
@keyframes pick{0%{opacity:0}20%,60%{opacity:1}100%{opacity:0}}
${visitors.css}`;
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
:root{${tileTokens(m)};--cursor:${CURSOR[m]};--on-emphasis:#ffffff;--tile-radius:2px;--tag-radius:3px;--type-label-size:14px;--easing-linear:linear;--easing-easeOut:cubic-bezier(.3,.8,.6,1);--easing-easeInOut:cubic-bezier(.65,0,.35,1);--easing-arriveX:cubic-bezier(.16,.84,.28,1);--easing-arriveY:cubic-bezier(.42,0,.18,1);--easing-leaveX:cubic-bezier(.56,0,.86,.42);--easing-leaveY:cubic-bezier(.34,0,.72,.3);--motion-enter:400ms;--motion-stagger:8ms;--motion-cursor:3000ms;--motion-cursor-delay:1500ms;--easing-hopY:cubic-bezier(.45,0,.25,1);--motion-place:300ms;--motion-pick:900ms}
${tileCss}
.enter{transform-box:fill-box;transform-origin:center;animation:enter var(--motion-enter) var(--easing-easeOut) calc(var(--i)*var(--motion-stagger)) both}
@keyframes enter{from{opacity:0;transform:scale(.72)}to{opacity:1;transform:scale(1)}}
${motion}
${visitorCss}
@media (prefers-reduced-motion:reduce){.enter,.cursor,.cursor-y,.pointer,.cursor-tag,.selection,.dot,.placed,.pick,.vcursor,.vcursor *{animation:none}}
</style>
${tiles(visitors.clicks)}
${visitors.markup}${cursor}
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

const issueForm = `name: Place a tile
description: Add up to ${DAILY_LIMIT} tiles to Aidan's Canvas.
title: "Place a tile"
labels: [tile]
body:
  - type: markdown
    attributes:
      value: |
        Your tiles are ready. Select **Create** and they will appear on the canvas in about a minute.

        Want to change them? [Go back to the canvas](${SITE_URL}). Aidan takes no responsibility for what is drawn here.
  - type: input
    id: moves
    attributes:
      label: Tiles
      description: Filled in by the canvas.
      placeholder: "C12:Strong, D12:Soft"
    validations:
      required: true
`;

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

const themed = (render) => ['light', 'dark'].map((mode) => render(mode, `${SITE_URL}#gh-${mode}-mode-only`)).join('');
const button = themed((mode, href) => `<a href="${href}"><img align="right" src="assets/button-${mode}.svg" alt="Place a tile"></a>`);
const canvas = themed((mode, href) => `[![${description} Select to place a tile.](assets/${canvasFile[mode]})](${href})`);
writeFileSync(join(OUT, 'README.md'), `<h3>${button}${NAME}</h3>

A collaborative experiment. Place up to three tiles a day. Resets weekly.

${canvas}

<sub><b>${placed}</b> custom ${tileWord} placed &middot; Tiles appear in about a minute &middot; Aidan takes no responsibility for what is drawn here.</sub>
`);

if (OUT === '.') {
  mkdirSync('.github/ISSUE_TEMPLATE', { recursive: true });
  writeFileSync('.github/ISSUE_TEMPLATE/place-tile.yml', issueForm);
}
console.log(`Built ${NAME}: ${placed} custom ${tileWord} placed, ${DEFAULT_TILES.size} default tiles, ${W}x${H}`);
