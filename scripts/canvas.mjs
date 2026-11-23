// Canvas rules. Issue text is untrusted: only exact, allowlisted values get through.
export const USER = 'AidanPhilpott';
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
export const blankState = (updated = null, placements = null) => ({ version: 3, updated, placed: 0, placements, fresh: [], tiles: {} });

// A reset clears the drawing but must not hand people a fresh daily allowance.
export const resetState = (state, today) => blankState(today, state.placements?.day === today ? state.placements : null);

const colorByLabel = new Map(Object.entries(COLORS).map(([key, { label }]) => [label, key]));

export function parseMove(body) {
  const source = String(body ?? '').replace(/\r/g, '');
  if (source.length > 500) return null;
  const read = (heading) => source.match(new RegExp(`^### ${heading}\\n+(.+)$`, 'm'))?.[1]?.trim();
  const column = read('Column');
  const row = read('Row');
  const color = colorByLabel.get(read('Color'));
  if (!/^(?:[1-9]|[1-5]\d|60)$/.test(column ?? '') || !/^[A-M]$/.test(row ?? '') || !color) return null;
  return { cell: `${row}${column}`, color };
}

const byCreated = (a, b) => String(a.created_at).localeCompare(String(b.created_at)) || a.number - b.number;

export function applyMoves(state, issues, today) {
  const next = { ...state, tiles: { ...state.tiles }, fresh: [] };
  const counts = new Map(state.placements?.day === today ? Object.entries(state.placements.counts) : []);
  const claimed = new Set();
  const results = [];

  for (const issue of issues.filter((i) => !i.pull_request).sort(byCreated)) {
    const login = issue.user?.login;
    const move = issue.user?.type === 'User' ? parseMove(issue.body) : null;
    let outcome = 'placed';
    if (!login || !move) outcome = 'invalid';
    else if (move.cell === DOT_CELL) outcome = 'locked';
    else if ((counts.get(login) ?? 0) >= DAILY_LIMIT) outcome = 'limit';
    else if (claimed.has(move.cell)) outcome = 'taken';

    if (outcome === 'placed') {
      next.tiles[move.cell] = { color: move.color, by: login, day: today };
      next.fresh.push(move.cell);
      counts.set(login, (counts.get(login) ?? 0) + 1);
      claimed.add(move.cell);
      next.updated = today;
    }
    results.push({ number: issue.number, outcome, cell: move?.cell ?? null, color: move?.color ?? null });
  }
  if (next.fresh.length) {
    next.placed = (state.placed ?? 0) + next.fresh.length;
    next.placements = { day: today, counts: Object.fromEntries(counts) };
  }
  return { state: next, results };
}

export function replyFor({ outcome, cell, color }) {
  switch (outcome) {
    case 'placed': return `Placed ${COLORS[color].label} at ${cell}. It's on the canvas now.`;
    case 'locked': return `${cell} is reserved for Aidan's cursor. Choose another tile.`;
    case 'limit': return `You've placed ${DAILY_LIMIT} tiles today. Try again tomorrow.`;
    case 'taken': return `${cell} was claimed earlier in this update. Choose another tile.`;
    default: return 'This move could not be read. Use the Place a tile link on the profile.';
  }
}
