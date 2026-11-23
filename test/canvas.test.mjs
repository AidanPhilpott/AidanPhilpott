import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DAILY_LIMIT, DEFAULT_TILES, DOT_CELL, applyMoves, blankState, parseMove, replyFor, resetState } from '../scripts/canvas.mjs';

const body = (row, column, color) => `### Row\n\n${row}\n\n### Column\n\n${column}\n\n### Color\n\n${color}\n`;
let number = 0;
const issue = (login, text, extra = {}) => {
  number += 1;
  return { number, body: text, created_at: `2026-11-23T00:00:${String(number % 60).padStart(2, '0')}Z`, user: { login, type: 'User' }, ...extra };
};
const outcomes = (result) => result.results.map((r) => r.outcome);

test('reads a valid issue form, including Windows line endings', () => {
  assert.deepEqual(parseMove(body('M', 60, 'Soft')), { cell: 'M60', color: 'l2' });
  assert.deepEqual(parseMove(body('A', 1, 'Strong').replace(/\n/g, '\r\n')), { cell: 'A1', color: 'l4' });
});

test('rejects anything outside the allowlist', () => {
  for (const bad of [
    body('N', 1, 'Medium'), body('A', 61, 'Medium'), body('A', 0, 'Medium'), body('A', 1, 'Pink'),
    body('A"><script>', 1, 'Medium'), body('A', '1; rm -rf /', 'Medium'), body('A', 1, '#fff'), '', null, 'x'.repeat(501),
  ]) assert.equal(parseMove(bad), null);
});

test('default drawing fits the grid', () => {
  assert.ok(DEFAULT_TILES.size > 60);
  for (const id of DEFAULT_TILES.keys()) assert.match(id, /^[A-M](?:[1-9]|[1-5]\d|60)$/);
});

test('the period in Eng. is protected and does not use up an allowance', () => {
  assert.equal(DOT_CELL, 'I46');
  assert.equal(DEFAULT_TILES.get(DOT_CELL), 'l4');
  const result = applyMoves(blankState(), [issue('ada', body('I', 46, 'Strong'))], '2026-11-23');
  assert.deepEqual(outcomes(result), ['locked']);
  assert.deepEqual(result.state.tiles, {});
  assert.equal(result.state.placed, 0);
});

test('places a tile, records who placed it, and counts it', () => {
  const result = applyMoves(blankState(), [issue('ada', body('A', 1, 'Medium'))], '2026-11-23');
  assert.deepEqual(result.state.tiles.A1, { color: 'l3', by: 'ada', day: '2026-11-23' });
  assert.deepEqual(result.state.fresh, ['A1']);
  assert.equal(result.state.placed, 1);
});

test('visitors can paint over the default drawing, and reset restores it', () => {
  const cell = [...DEFAULT_TILES.keys()][0];
  const result = applyMoves(blankState(), [issue('ada', body(cell[0], cell.slice(1), 'Strong'))], '2026-11-23');
  assert.equal(result.state.tiles[cell].color, 'l4');
  const reset = resetState(result.state, '2026-11-23');
  assert.deepEqual(reset.tiles, {});
  assert.equal(reset.placed, 0);
});

test(`allows ${DAILY_LIMIT} tiles per person per day, across repeat runs`, () => {
  const first = applyMoves(blankState(), [
    issue('ada', body('A', 1, 'Medium')), issue('ada', body('A', 2, 'Medium')),
    issue('ada', body('A', 3, 'Medium')), issue('ada', body('A', 4, 'Strong')),
  ], '2026-11-23');
  assert.deepEqual(outcomes(first), ['placed', 'placed', 'placed', 'limit']);
  assert.deepEqual(outcomes(applyMoves(first.state, [issue('ada', body('C', 1, 'Strong'))], '2026-11-23')), ['limit']);
  assert.deepEqual(outcomes(applyMoves(first.state, [issue('ada', body('C', 1, 'Strong'))], '2026-11-24')), ['placed']);
});

test('the daily limit survives tiles being painted over and a same-day reset', () => {
  const moves = ['A', 'B', 'C'].map((row) => issue('ada', body(row, 1, 'Medium')));
  const first = applyMoves(blankState(), moves, '2026-11-23');
  const paintedOver = applyMoves(first.state, [issue('grace', body('A', 1, 'Strong'))], '2026-11-23');
  assert.deepEqual(outcomes(applyMoves(paintedOver.state, [issue('ada', body('D', 1, 'Strong'))], '2026-11-23')), ['limit']);
  const reset = resetState(paintedOver.state, '2026-11-23');
  assert.deepEqual(outcomes(applyMoves(reset, [issue('ada', body('D', 1, 'Strong'))], '2026-11-23')), ['limit']);
});

test('the counter includes tiles placed over earlier custom tiles', () => {
  const first = applyMoves(blankState(), [issue('ada', body('A', 1, 'Medium'))], '2026-11-23');
  const second = applyMoves(first.state, [issue('grace', body('A', 1, 'Strong'))], '2026-11-24');
  assert.equal(Object.keys(second.state.tiles).length, 1);
  assert.equal(second.state.placed, 2);
});

test('the earliest move wins a contested cell', () => {
  const later = issue('grace', body('A', 1, 'Strong'), { created_at: '2026-11-23T09:00:00Z' });
  const earlier = issue('ada', body('A', 1, 'Medium'), { created_at: '2026-11-23T08:00:00Z' });
  const result = applyMoves(blankState(), [later, earlier], '2026-11-23');
  assert.equal(result.state.tiles.A1.by, 'ada');
  assert.deepEqual(result.results.map((r) => [r.number, r.outcome]), [[earlier.number, 'placed'], [later.number, 'taken']]);
});

test('ignores bots and pull requests', () => {
  const bot = issue('robot', body('A', 1, 'Medium'), { user: { login: 'robot', type: 'Bot' } });
  const pr = issue('ada', body('B', 1, 'Medium'), { pull_request: {} });
  const result = applyMoves(blankState(), [bot, pr], '2026-11-23');
  assert.deepEqual(outcomes(result), ['invalid']);
  assert.deepEqual(result.state.tiles, {});
});

test('replies never echo raw issue text', () => {
  const result = applyMoves(blankState(), [issue('ada', body('A', '<img src=x>', 'Medium'))], '2026-11-23');
  assert.doesNotMatch(replyFor(result.results[0]), /img/);
});
