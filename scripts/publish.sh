#!/usr/bin/env bash
# Applies an update on the latest main and pushes it, retrying if another run landed first.
set -euo pipefail

command="$1"
message="$2"

git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"

for attempt in 1 2 3 4 5; do
  git fetch --depth=1 origin main
  git reset --hard origin/main
  node scripts/update-canvas.mjs "$command"
  npm run --silent build
  git add canvas assets README.md
  if git diff --cached --quiet; then
    exit 0
  fi
  git commit -q -m "$message"
  if git push -q origin HEAD:main; then
    exit 0
  fi
  sleep $((attempt * 2))
done

echo "Could not push after 5 attempts" >&2
exit 1
