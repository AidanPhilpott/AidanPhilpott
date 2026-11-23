import {
  COLORS, COLUMNS, DAILY_LIMIT, DEFAULT_TILES, DOT_CELL, ROW_LETTERS, USER, cellId, formatMoves, parseMoves,
} from './canvas.mjs';

const API = document.querySelector('meta[name="canvas-api"]').content;
const FORM_URL = `https://github.com/${USER}/${USER}/issues/new?template=place-tile.yml&moves=`;
const POLL_MS = 8000;
const POLL_LIMIT_MS = 5 * 60 * 1000;

const $ = (id) => document.getElementById(id);
const grid = $('grid');
const status = $('status');
const cells = new Map();

const picks = new Map();
let shade = 'l4';
let tiles = {};
let pending = new Map();
let placedCount = 0;
let submitted = null;
let pollTimer = null;
let pollStarted = 0;

const rowCol = (cell) => ({ row: ROW_LETTERS.indexOf(cell[0]), column: Number(cell.slice(1)) - 1 });

function describe(cell) {
  const { row, column } = rowCol(cell);
  const place = `Row ${ROW_LETTERS[row]}, column ${column + 1}`;
  if (cell === DOT_CELL) return `${place}, reserved`;
  const picked = picks.get(cell);
  if (picked) return `${place}, selected, ${COLORS[picked].label}`;
  if (pending.has(cell)) return `${place}, pending, ${COLORS[pending.get(cell)].label}`;
  const color = tiles[cell]?.color ?? DEFAULT_TILES.get(cell);
  return color ? `${place}, ${COLORS[color].label}` : `${place}, empty`;
}

function paint(cell) {
  const el = cells.get(cell);
  const color = picks.get(cell) ?? pending.get(cell) ?? tiles[cell]?.color ?? DEFAULT_TILES.get(cell);
  if (color) el.dataset.color = color;
  else delete el.dataset.color;
  el.classList.toggle('picked', picks.has(cell));
  el.classList.toggle('pending', !picks.has(cell) && pending.has(cell));
  el.setAttribute('aria-selected', String(picks.has(cell)));
  el.setAttribute('aria-label', describe(cell));
}

const paintAll = () => cells.forEach((_, cell) => paint(cell));

function showStatus(message, action) {
  status.replaceChildren();
  if (!message) {
    status.hidden = true;
    return;
  }
  const text = document.createElement('span');
  text.textContent = message;
  status.append(text);
  if (action) status.append(action);
  status.hidden = false;
}

function updateTray() {
  const moves = [...picks.values()];
  $('count').textContent = `${moves.length} of ${DAILY_LIMIT} tiles`;
  $('undo').disabled = moves.length === 0;
  $('continue').disabled = moves.length === 0;
  $('slots').replaceChildren(...Array.from({ length: DAILY_LIMIT }, (_, i) => {
    const slot = document.createElement('span');
    slot.className = 'slot';
    if (moves[i]) slot.dataset.color = moves[i];
    return slot;
  }));
}

function toggle(cell) {
  if (cell === DOT_CELL) {
    showStatus('That square is reserved for Aidan’s cursor. Choose another tile.');
    return;
  }
  if (picks.get(cell) === shade) picks.delete(cell);
  else if (picks.has(cell) || picks.size < DAILY_LIMIT) picks.set(cell, shade);
  else {
    showStatus(`You’ve chosen ${DAILY_LIMIT} tiles. Select one to remove it, or continue on GitHub.`);
    return;
  }
  if (!submitted) showStatus('');
  paint(cell);
  updateTray();
}

function undo() {
  const last = [...picks.keys()].at(-1);
  if (!last) return;
  picks.delete(last);
  paint(last);
  updateTray();
}

function setShade(next) {
  shade = next;
  grid.dataset.shade = next;
  const input = document.querySelector(`input[name="shade"][value="${next}"]`);
  if (input) input.checked = true;
}

function moveFocus(from, dRow, dColumn) {
  const { row, column } = rowCol(from);
  const target = cellId(
    Math.max(0, Math.min(COLUMNS - 1, column + dColumn)),
    Math.max(0, Math.min(ROW_LETTERS.length - 1, row + dRow)),
  );
  cells.get(from).tabIndex = -1;
  const el = cells.get(target);
  el.tabIndex = 0;
  el.focus();
}

function buildGrid() {
  ROW_LETTERS.forEach((_, r) => {
    const row = document.createElement('div');
    row.setAttribute('role', 'row');
    for (let c = 0; c < COLUMNS; c++) {
      const cell = cellId(c, r);
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'cell';
      el.dataset.cell = cell;
      el.setAttribute('role', 'gridcell');
      el.tabIndex = r === 0 && c === 0 ? 0 : -1;
      if (cell === DOT_CELL) el.setAttribute('aria-disabled', 'true');
      cells.set(cell, el);
      row.append(el);
    }
    grid.append(row);
  });
  grid.addEventListener('click', (event) => {
    const el = event.target.closest('.cell');
    if (el) toggle(el.dataset.cell);
  });
  grid.addEventListener('keydown', (event) => {
    const el = event.target.closest('.cell');
    if (!el) return;
    const moves = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[event.key];
    if (!moves) return;
    event.preventDefault();
    moveFocus(el.dataset.cell, moves[0], moves[1]);
  });
}

function buildShades() {
  Object.entries(COLORS).forEach(([key, { label }]) => {
    const wrap = document.createElement('label');
    wrap.className = 'shade';
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'shade';
    input.value = key;
    input.addEventListener('change', () => setShade(key));
    const swatch = document.createElement('span');
    swatch.className = 'swatch';
    swatch.dataset.color = key;
    wrap.append(input, swatch, document.createTextNode(label));
    $('shades').append(wrap);
  });
  setShade(shade);
}

async function api(path, accept = 'application/vnd.github+json') {
  const response = await fetch(`${API}${path}`, { cache: 'no-cache', headers: { Accept: accept } });
  if (!response.ok) throw new Error(`GitHub API ${response.status}`);
  return response.json();
}

function renderCounter() {
  $('placed').textContent = placedCount;
  $('placed-label').textContent = `custom ${placedCount === 1 ? 'tile' : 'tiles'} placed`;
}

async function refresh() {
  const [state, issues] = await Promise.all([
    api('/contents/canvas/state.json', 'application/vnd.github.raw+json'),
    api('/issues?state=open&labels=tile&per_page=100'),
  ]);
  tiles = state.tiles ?? {};
  placedCount = state.placed ?? 0;
  pending = new Map();
  issues.filter((issue) => !issue.pull_request).forEach((issue) => {
    (parseMoves(issue.body) ?? []).forEach(({ cell, color }) => pending.set(cell, color));
  });
  if (submitted) submitted.moves.forEach(({ cell, color }) => {
    if (tiles[cell]?.color !== color || placedCount <= submitted.baseline) pending.set(cell, color);
  });
  renderCounter();
  paintAll();
  if (submitted && placedCount > submitted.baseline
    && submitted.moves.every(({ cell, color }) => tiles[cell]?.color === color)) finish();
}

function stopPolling() {
  clearTimeout(pollTimer);
  pollTimer = null;
}

function schedulePoll() {
  stopPolling();
  if (!submitted || document.hidden) return;
  if (Date.now() - pollStarted > POLL_LIMIT_MS) {
    showStatus('Still waiting on your tiles. If you selected Create, reload this page in a minute.', changeButton());
    return;
  }
  pollTimer = setTimeout(async () => {
    try { await refresh(); } catch { /* Keep waiting; the next poll can recover. */ }
    schedulePoll();
  }, POLL_MS);
}

function finish() {
  submitted = null;
  stopPolling();
  const link = document.createElement('a');
  link.href = `https://github.com/${USER}`;
  link.textContent = 'View on Aidan’s profile';
  link.className = 'btn';
  showStatus('Your tiles are on the canvas.', link);
}

function changeButton() {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn';
  button.textContent = 'Change tiles';
  button.addEventListener('click', () => {
    const { moves } = submitted;
    submitted = null;
    stopPolling();
    moves.forEach(({ cell, color }) => { pending.delete(cell); picks.set(cell, color); });
    showStatus('');
    paintAll();
    updateTray();
  });
  return button;
}

function submit() {
  const moves = [...picks].map(([cell, color]) => ({ cell, color }));
  if (!moves.length) return;
  window.open(`${FORM_URL}${encodeURIComponent(formatMoves(moves))}`, '_blank', 'noopener');
  submitted = { moves, baseline: placedCount };
  picks.clear();
  moves.forEach(({ cell, color }) => pending.set(cell, color));
  paintAll();
  updateTray();
  showStatus('Select Create on GitHub. Your tiles will appear here in about a minute.', changeButton());
  pollStarted = Date.now();
  schedulePoll();
}

document.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
    event.preventDefault();
    undo();
    return;
  }
  const index = ['1', '2', '3', '4'].indexOf(event.key);
  if (index >= 0 && !event.ctrlKey && !event.metaKey && !event.altKey) setShade(Object.keys(COLORS)[index]);
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    stopPolling();
    return;
  }
  refresh().catch(() => {});
  schedulePoll();
});

$('undo').addEventListener('click', undo);
$('continue').addEventListener('click', submit);

buildGrid();
buildShades();
paintAll();
updateTray();
const scroller = $('scroller');
scroller.scrollLeft = (scroller.scrollWidth - scroller.clientWidth) / 2;
refresh().catch(() => showStatus('Live tiles are unavailable right now. You can still place tiles.'));
