import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DAILY_CAP, DAILY_LIMIT, DEFAULT_TILES, DOT_CELL, MAX_VISITORS, applyMoves, blankState, formatMoves, parseMoves, replyFor, resetState,
  visitorReplay,
} from '../scripts/canvas.mjs';

const body = (moves) => `### Tiles\n\n${moves}\n`;
let number = 0;
const issue = (login, text, extra = {}) => {
  number += 1;
  return { number, body: text, created_at: `2026-11-23T00:${String(Math.floor(number / 60) % 60).padStart(2, '0')}:${String(number % 60).padStart(2, '0')}Z`, user: { login, type: 'User' }, ...extra };
};
const day = '2026-11-23';
const outcomes = (result) => result.results.map((r) => r.outcome);

test('reads one to three tiles, including Windows line endings', () => {
  assert.deepEqual(parseMoves(body('M60:Soft')), [{ cell: 'M60', color: 'l2' }]);
  assert.deepEqual(parseMoves(body('A1:Strong, B2:Faint, C3:Medium').replace(/\n/g, '\r\n')), [
    { cell: 'A1', color: 'l4' }, { cell: 'B2', color: 'l1' }, { cell: 'C3', color: 'l3' },
  ]);
});

test('format and parse round-trip', () => {
  const moves = [{ cell: 'C12', color: 'l4' }, { cell: 'D12', color: 'l2' }];
  assert.deepEqual(parseMoves(body(formatMoves(moves))), moves);
});

test('rejects anything outside the allowlist', () => {
  for (const bad of [
    body('N1:Strong'), body('A61:Strong'), body('A0:Strong'), body('A1:Pink'), body('A1:Strong, A1:Soft'),
    body('A1:Strong, A2:Strong, A3:Strong, A4:Strong'), body('A1:Strong; rm -rf /'), body('<img src=x>:Strong'),
    body('A1:#fff'), body(''), '', null, 'x'.repeat(501),
  ]) assert.equal(parseMoves(bad), null);
});

test('default drawing fits the grid', () => {
  assert.ok(DEFAULT_TILES.size > 60);
  for (const id of DEFAULT_TILES.keys()) assert.match(id, /^[A-M](?:[1-9]|[1-5]\d|60)$/);
});

test('places every tile in one submission and counts them', () => {
  const result = applyMoves(blankState(), [issue('ada', body('A1:Medium, B1:Soft, C1:Strong'))], day);
  assert.deepEqual(outcomes(result), ['placed']);
  assert.equal(result.state.placed, 3);
  assert.deepEqual(result.state.fresh, ['A1', 'B1', 'C1']);
  const { at, ...tile } = result.state.tiles.A1;
  assert.deepEqual(tile, { color: 'l3', by: 'ada', day });
  assert.match(at, /^2026-11-23T/);
});

test('the period in Eng. is protected without using an allowance', () => {
  assert.equal(DOT_CELL, 'I46');
  assert.equal(DEFAULT_TILES.get(DOT_CELL), 'l4');
  const result = applyMoves(blankState(), [issue('ada', body('I46:Strong, A1:Soft'))], day);
  assert.deepEqual(outcomes(result), ['partial']);
  assert.equal(result.state.tiles.I46, undefined);
  assert.equal(result.state.placements.counts.ada, 1);
});

test('visitors can paint over the default drawing, and reset restores it', () => {
  const cell = [...DEFAULT_TILES.keys()].find((id) => id !== DOT_CELL);
  const result = applyMoves(blankState(), [issue('ada', body(`${cell}:Faint`))], day);
  assert.equal(result.state.tiles[cell].color, 'l1');
  const reset = resetState(result.state, day);
  assert.deepEqual(reset.tiles, {});
  assert.equal(reset.placed, 0);
});

test(`allows ${DAILY_LIMIT} tiles per person per day across submissions`, () => {
  const first = applyMoves(blankState(), [issue('ada', body('A1:Soft, A2:Soft')), issue('ada', body('A3:Soft, A4:Soft'))], day);
  assert.deepEqual(outcomes(first), ['placed', 'partial']);
  assert.equal(first.state.tiles.A4, undefined);
  assert.deepEqual(outcomes(applyMoves(first.state, [issue('ada', body('C1:Soft'))], day)), ['rejected']);
  assert.deepEqual(outcomes(applyMoves(first.state, [issue('ada', body('C1:Soft'))], '2026-11-24')), ['placed']);
});

test('the daily limit survives painted-over tiles and a same-day reset', () => {
  const first = applyMoves(blankState(), [issue('ada', body('A1:Soft, B1:Soft, C1:Soft'))], day);
  const painted = applyMoves(first.state, [issue('grace', body('A1:Strong'))], day);
  assert.deepEqual(outcomes(applyMoves(painted.state, [issue('ada', body('D1:Soft'))], day)), ['rejected']);
  const reset = resetState(painted.state, day);
  assert.deepEqual(outcomes(applyMoves(reset, [issue('ada', body('D1:Soft'))], day)), ['rejected']);
});

test('the daily cap holds later submissions open for the next run', () => {
  const start = { ...blankState(), placements: { day, counts: { crowd: DAILY_CAP - 1 } } };
  const first = issue('ada', body('A1:Soft'));
  const held = issue('grace', body('B1:Soft, B2:Soft'));
  const result = applyMoves(start, [first, held], day);
  assert.deepEqual(result.results.map((r) => r.number), [first.number]);
  assert.equal(result.state.tiles.B1, undefined);
  assert.deepEqual(outcomes(applyMoves(result.state, [held], '2026-11-24')), ['placed']);
});

test('the earliest submission wins a contested square in a batch', () => {
  const later = issue('grace', body('A1:Strong'), { created_at: '2026-11-23T09:00:00Z' });
  const earlier = issue('ada', body('A1:Medium'), { created_at: '2026-11-23T08:00:00Z' });
  const result = applyMoves(blankState(), [later, earlier], day);
  assert.equal(result.state.tiles.A1.by, 'ada');
  assert.deepEqual(result.results.map((r) => [r.number, r.outcome]), [[earlier.number, 'placed'], [later.number, 'rejected']]);
});

test('ignores bots and pull requests', () => {
  const bot = issue('robot', body('A1:Medium'), { user: { login: 'robot', type: 'Bot' } });
  const pr = issue('ada', body('B1:Medium'), { pull_request: {} });
  const result = applyMoves(blankState(), [bot, pr], day);
  assert.deepEqual(outcomes(result), ['invalid']);
  assert.deepEqual(result.state.tiles, {});
});

test('replies explain each tile and never echo raw issue text', () => {
  const mixed = applyMoves(blankState(), [issue('ada', body('I46:Strong, A1:Soft'))], day);
  const reply = replyFor(mixed.results[0]);
  assert.match(reply, /Placed Soft at A1/);
  assert.match(reply, /I46 is reserved/);
  const invalid = applyMoves(blankState(), [issue('ada', body('<img src=x>'))], day);
  assert.doesNotMatch(replyFor(invalid.results[0]), /img/);
});

test('one cursor per visitor, covering every submission they made', () => {
  const monday = applyMoves(blankState(), [issue('ada', body('A1:Soft, A3:Soft')), issue('grace', body('M60:Strong'))], day);
  const later = applyMoves(monday.state, [issue('Ada', body('A2:Medium'))], '2026-11-24');
  const replay = visitorReplay(later.state.tiles);
  assert.deepEqual(replay.map((v) => v.login), ['grace', 'ada']);
  // Starts at the first tile placed, then takes the nearest one next.
  assert.deepEqual(replay[1].cells.map((c) => c.cell), ['A1', 'A2', 'A3']);
});

test('the replay skips painted-over tiles and keeps only the latest visitors', () => {
  const first = applyMoves(blankState(), [issue('ada', body('A1:Soft'))], day);
  const painted = applyMoves(first.state, [issue('grace', body('A1:Strong'))], day);
  assert.deepEqual(visitorReplay(painted.state.tiles).map((v) => v.login), ['grace']);
  const crowd = Object.fromEntries(Array.from({ length: MAX_VISITORS + 2 }, (_, i) => [`B${i + 1}`, { color: 'l2', by: `p${i}`, at: `2026-11-23T00:00:0${i}Z` }]));
  const shown = visitorReplay(crowd).map((v) => v.login);
  assert.equal(shown.length, MAX_VISITORS);
  assert.equal(shown.at(-1), `p${MAX_VISITORS + 1}`);
});

test('the replay never renders a malformed name or a tile without a colour', () => {
  const tiles = { A1: { color: 'l2', by: '<script>' }, A2: { color: 'pink', by: 'ada' }, A3: { color: 'l2', by: 'ada', day } };
  assert.deepEqual(visitorReplay(tiles), [{ login: 'ada', cells: [{ cell: 'A3', color: 'l2' }] }]);
});
