// Canvas rules. Issue text is untrusted: only exact, allowlisted values get through.
export const USER = 'AidanPhilpott';
export const SITE_URL = 'https://aidanphilpott.github.io/AidanPhilpott/';
export const COLUMNS = 60; // A wide, short band that fills the README like the contribution graph.
export const ROW_LETTERS = 'ABCDEFGHIJKLM'.split('');

// GitHub's contribution graph scale, read from github.com.
export const EMPTY_TILE = { light: '#eff2f5', dark: '#151b23' };
export const COLORS = {
  l1: { label: 'Faint', light: '#aceebb', dark: '#033a16' },
  l2: { label: 'Soft', light: '#4ac26b', dark: '#196c2e' },
  l3: { label: 'Medium', light: '#2da44e', dark: '#2ea043' },
  l4: { label: 'Strong', light: '#116329', dark: '#56d364' },
};

export const cellId = (column, row) => `${ROW_LETTERS[row]}${column + 1}`;

const GLYPHS = {
  D: ['###.', '#..#', '#..#', '#..#', '#..#', '#..#', '###.'],
  E: ['####', '#...', '#...', '###.', '#...', '#...', '####'],
  e: ['....', '....', '.##.', '#..#', '####', '#...', '.###'],
  s: ['....', '....', '.###', '#...', '.##.', '...#', '###.'],
  i: ['#', '.', '#', '#', '#', '#', '#'],
  g: ['....', '....', '.###', '#..#', '#..#', '.###', '...#', '#..#', '.##.'],
  n: ['....', '....', '###.', '#..#', '#..#', '#..#', '#..#'],
  '.': ['.', '.', '.', '.', '.', '.', '#'],
};
const SMILEY = [
  '..#####..',
  '.#.....#.',
  '#..#.#..#',
  '#..#.#..#',
  '#.......#',
  '#.#...#.#',
  '#..###..#',
  '.#.....#.',
  '..#####..',
];
const DESIGN_COLUMN = 2;
const ENG_COLUMN = 30;
const TEXT_ROW = 2;
const SMILEY_COLUMN = 48;
const SMILEY_ROW = 2;

function drawDefault() {
  const tiles = new Map();
  const plot = (lines, column, row, color) => lines.forEach((line, r) => [...line].forEach((c, x) => {
    if (c === '#') tiles.set(cellId(column + x, row + r), color);
  }));
  for (const [word, start] of [['Design', DESIGN_COLUMN], ['Eng.', ENG_COLUMN]]) {
    let column = start;
    for (const letter of word) {
      plot(GLYPHS[letter], column, TEXT_ROW, 'l4');
      column += GLYPHS[letter][0].length + 1;
    }
  }
  plot(SMILEY, SMILEY_COLUMN, SMILEY_ROW, 'l3');
  return tiles;
}

export const DEFAULT_TILES = drawDefault();
// The period in "Eng." is placed by the cursor animation, so visitors can't take it.
export const DOT_CELL = cellId(ENG_COLUMN + 15, TEXT_ROW + 6);
export const DAILY_LIMIT = 3;
export const DAILY_CAP = 100; // Keeps spam from causing unbounded Actions work.
export const blankState = (updated = null, placements = null) => ({ version: 3, updated, placed: 0, placements, fresh: [], tiles: {} });

// A reset clears the drawing but must not hand people a fresh daily allowance.
export const resetState = (state, today) => blankState(today, state.placements?.day === today ? state.placements : null);

const colorByLabel = new Map(Object.entries(COLORS).map(([key, { label }]) => [label, key]));

export const formatMoves = (moves) => moves.map(({ cell, color }) => `${cell}:${COLORS[color].label}`).join(', ');

export function parseMoves(body) {
  const source = String(body ?? '').replace(/\r/g, '');
  if (source.length > 500) return null;
  const line = source.match(/^### Tiles\n+(.+)$/m)?.[1]?.trim();
  if (!line) return null;
  const parts = line.split(/\s*,\s*/);
  if (parts.length > DAILY_LIMIT) return null;
  const moves = [];
  for (const part of parts) {
    const match = part.match(/^([A-M])([1-9]|[1-5]\d|60):(Faint|Soft|Medium|Strong)$/);
    if (!match) return null;
    moves.push({ cell: `${match[1]}${match[2]}`, color: colorByLabel.get(match[3]) });
  }
  return new Set(moves.map((m) => m.cell)).size === moves.length ? moves : null;
}

const byCreated = (a, b) => String(a.created_at).localeCompare(String(b.created_at)) || a.number - b.number;

export function applyMoves(state, issues, today) {
  const next = { ...state, tiles: { ...state.tiles }, fresh: [] };
  const counts = new Map(state.placements?.day === today ? Object.entries(state.placements.counts) : []);
  let total = [...counts.values()].reduce((sum, n) => sum + n, 0);
  const claimed = new Set();
  const results = [];

  for (const issue of issues.filter((i) => !i.pull_request).sort(byCreated)) {
    const login = issue.user?.login;
    const moves = issue.user?.type === 'User' ? parseMoves(issue.body) : null;
    if (!login || !moves) {
      results.push({ number: issue.number, outcome: 'invalid', tiles: [] });
      continue;
    }
    // Over the daily cap, this issue and later ones stay open for the next day's run.
    if (total + moves.length > DAILY_CAP) break;

    const tiles = moves.map(({ cell, color }) => {
      let outcome = 'placed';
      if (cell === DOT_CELL) outcome = 'locked';
      else if ((counts.get(login) ?? 0) >= DAILY_LIMIT) outcome = 'limit';
      else if (claimed.has(cell)) outcome = 'taken';
      if (outcome === 'placed') {
        next.tiles[cell] = { color, by: login, day: today, at: String(issue.created_at ?? today) };
        next.fresh.push(cell);
        counts.set(login, (counts.get(login) ?? 0) + 1);
        claimed.add(cell);
        total += 1;
        next.updated = today;
      }
      return { cell, color, outcome };
    });
    const placed = tiles.filter((t) => t.outcome === 'placed').length;
    const outcome = placed === tiles.length ? 'placed' : placed ? 'partial' : 'rejected';
    results.push({ number: issue.number, outcome, tiles });
  }
  if (next.fresh.length) {
    next.placed = (state.placed ?? 0) + next.fresh.length;
    next.placements = { day: today, counts: Object.fromEntries(counts) };
  }
  return { state: next, results };
}

// Recent visitors replay their tiles as cursors. Each person gets one cursor that visits
// every tile of theirs still on the canvas, across all their submissions this week.
export const MAX_VISITORS = 5;
const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const gridPoint = (cell) => ({ row: ROW_LETTERS.indexOf(cell[0]), column: Number(cell.slice(1)) - 1 });
const distance = (a, b) => Math.hypot(a.row - b.row, a.column - b.column);

// Starts at the person's first tile, then always hops to the nearest one left, so the cursor never zigzags.
function route(cells) {
  const left = [...cells].sort((a, b) => a.at.localeCompare(b.at) || a.cell.localeCompare(b.cell));
  const path = [left.shift()];
  while (left.length) {
    const here = gridPoint(path.at(-1).cell);
    let best = 0;
    left.forEach((c, i) => {
      if (distance(here, gridPoint(c.cell)) < distance(here, gridPoint(left[best].cell))) best = i;
    });
    path.push(...left.splice(best, 1));
  }
  return path;
}

export function visitorReplay(tiles, max = MAX_VISITORS) {
  const people = new Map();
  for (const [cell, tile] of Object.entries(tiles ?? {})) {
    if (cell === DOT_CELL || !COLORS[tile?.color] || !LOGIN.test(tile?.by ?? '')) continue;
    const key = tile.by.toLowerCase();
    if (!people.has(key)) people.set(key, { login: tile.by, cells: [] });
    people.get(key).cells.push({ cell, color: tile.color, at: String(tile.at ?? tile.day ?? '') });
  }
  const latest = (person) => person.cells.reduce((last, c) => (c.at > last ? c.at : last), '');
  return [...people.values()]
    .sort((a, b) => latest(a).localeCompare(latest(b)) || a.login.localeCompare(b.login))
    .slice(-max)
    .map(({ login, cells }) => ({ login, cells: route(cells).map(({ cell, color }) => ({ cell, color })) }));
}

const list = (items) => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`);

export function replyFor({ outcome, tiles = [] }) {
  if (outcome === 'invalid') return `These tiles could not be read. Choose them on the canvas: ${SITE_URL}`;
  const cells = (kind) => tiles.filter((t) => t.outcome === kind).map((t) => t.cell);
  const placed = tiles.filter((t) => t.outcome === 'placed').map((t) => `${COLORS[t.color].label} at ${t.cell}`);
  const lines = [];
  if (placed.length) lines.push(`Placed ${list(placed)}. It's on the canvas now: https://github.com/${USER}`);
  if (cells('locked').length) lines.push(`${list(cells('locked'))} is reserved for Aidan's cursor.`);
  if (cells('taken').length) lines.push(`${list(cells('taken'))} was claimed moments earlier.`);
  if (cells('limit').length) lines.push(`You've reached ${DAILY_LIMIT} tiles today, so ${list(cells('limit'))} wasn't placed. Try again tomorrow.`);
  return lines.join('\n\n');
}
