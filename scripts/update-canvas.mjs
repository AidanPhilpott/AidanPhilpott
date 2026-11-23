// `apply` reads open tile issues, `respond` replies after the commit lands, `reset` restores the default drawing.
import { readFileSync, writeFileSync } from 'node:fs';
import { applyMoves, replyFor, resetState } from './canvas.mjs';

const [command] = process.argv.slice(2);
const today = new Date().toISOString().slice(0, 10);
const saveState = (state) => writeFileSync('canvas/state.json', `${JSON.stringify(state, null, 2)}\n`);

if (command === 'reset') {
  saveState(resetState(JSON.parse(readFileSync('canvas/state.json', 'utf8')), today));
  console.log('Canvas reset to the default drawing');
} else if (command === 'apply' || command === 'respond') {
  const { GITHUB_TOKEN: token, GITHUB_REPOSITORY: repo, CANVAS_RESULTS: resultsPath } = process.env;
  if (!token || !repo || !resultsPath) throw new Error('GITHUB_TOKEN, GITHUB_REPOSITORY, and CANVAS_RESULTS are required');

  const api = async (path, options = {}) => {
    const response = await fetch(`https://api.github.com/repos/${repo}${path}`, {
      ...options,
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'user-agent': 'profile-canvas',
        'x-github-api-version': '2022-11-28',
      },
    });
    if (!response.ok) throw new Error(`GitHub API ${response.status} on ${path}`);
    return response.json();
  };

  if (command === 'apply') {
    // One page caps each daily run at 100 moves; any extras wait for the next run.
    const issues = await api('/issues?state=open&labels=tile&sort=created&direction=asc&per_page=100');
    const state = JSON.parse(readFileSync('canvas/state.json', 'utf8'));
    const result = applyMoves(state, issues, today);
    saveState(result.state);
    writeFileSync(resultsPath, JSON.stringify(result.results));
    console.log(`Processed ${result.results.length} moves, placed ${result.state.fresh.length}`);
  } else {
    for (const result of JSON.parse(readFileSync(resultsPath, 'utf8'))) {
      await api(`/issues/${result.number}/comments`, { method: 'POST', body: JSON.stringify({ body: replyFor(result) }) });
      await api(`/issues/${result.number}`, {
        method: 'PATCH',
        body: JSON.stringify({ state: 'closed', state_reason: result.outcome === 'placed' ? 'completed' : 'not_planned' }),
      });
    }
  }
} else {
  throw new Error('Use: update-canvas.mjs apply|respond|reset');
}
