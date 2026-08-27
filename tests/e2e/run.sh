#!/usr/bin/env bash
#
# Boots a backend and an editor of its own, runs every suite against them,
# and tears them down. This is what CI runs (.github/workflows/ci.yml) and
# what to run locally before pushing.
#
#   tests/e2e/run.sh              # everything
#   tests/e2e/run.sh api          # just the curl suites
#   tests/e2e/run.sh browser      # just the Playwright suites
#
# It deliberately uses its own ports and its own throwaway database rather
# than whatever `pnpm dev:editor` left running: a suite that inherits rows
# from a previous run, or talks to a server whose database it can't
# identify, produces failures that cost far more to diagnose than the
# thirty seconds a fresh boot costs. Point E2E_API_URL / E2E_EDITOR_URL at
# running servers to override that.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WHICH="${1:-all}"
LOGS="$(mktemp -d)"
API_PORT="${E2E_API_PORT:-8001}"
WEB_PORT="${E2E_WEB_PORT:-4174}"
API_URL="${E2E_API_URL:-http://127.0.0.1:$API_PORT}"
EDITOR_URL="${E2E_EDITOR_URL:-http://localhost:$WEB_PORT/}"
OWN_API=0
OWN_WEB=0

cleanup() {
  [ "$OWN_API" = "1" ] && [ -n "${API_PID:-}" ] && kill "$API_PID" 2>/dev/null
  [ "$OWN_WEB" = "1" ] && [ -n "${WEB_PID:-}" ] && kill "$WEB_PID" 2>/dev/null
  return 0
}
trap cleanup EXIT

wait_for() { # wait_for <url> <label>
  for _ in $(seq 1 90); do
    curl -sf -o /dev/null "$1" && return 0
    sleep 1
  done
  echo "!! $2 never came up at $1. Last 30 log lines:" >&2
  tail -30 "$LOGS/$2.log" >&2
  return 1
}

if [ -z "${E2E_API_URL:-}" ]; then
  OWN_API=1
  echo "== backend on :$API_PORT (fresh database) =="
  DB="$ROOT/backend/database/e2e.sqlite"
  rm -f "$DB"; touch "$DB"
  # Exported so everything downstream agrees on the database — including
  # the artisan the moderation suite shells out to. A real environment
  # variable wins over .env, since Dotenv doesn't override what's set.
  export DB_DATABASE="$DB"
  # The editor's origin has to be allowed or every browser suite fails on
  # CORS instead of on anything real.
  export CORS_ALLOWED_ORIGINS="http://localhost:$WEB_PORT,http://127.0.0.1:$WEB_PORT"
  (cd "$ROOT/backend" && php artisan migrate --force --no-interaction) >"$LOGS/backend.log" 2>&1
  (cd "$ROOT/backend" && php artisan serve --host=127.0.0.1 --port="$API_PORT") >>"$LOGS/backend.log" 2>&1 &
  API_PID=$!
fi

if [ "$WHICH" != "api" ] && [ -z "${E2E_EDITOR_URL:-}" ]; then
  OWN_WEB=1
  echo "== editor on :$WEB_PORT =="
  # VITE_API_BASE_URL points the app at the backend above rather than the
  # dev default, so the two halves of a run always match.
  (cd "$ROOT" && VITE_API_BASE_URL="$API_URL" pnpm --filter @card-studio/editor dev --port "$WEB_PORT" --strictPort) >"$LOGS/editor.log" 2>&1 &
  WEB_PID=$!
fi

wait_for "$API_URL/up" backend || exit 1
[ "$WHICH" = "api" ] || wait_for "$EDITOR_URL" editor || exit 1

export E2E_API_URL="$API_URL" E2E_EDITOR_URL="$EDITOR_URL"
failed=0

run() { # run <label> <command...>
  printf '%-34s ' "$1"
  local output summary
  output="$("${@:2}" 2>&1)"
  summary="$(echo "$output" | grep -E '^== [0-9]+ passed' | tail -1)"
  if [ -z "$summary" ] || echo "$summary" | grep -qv ', 0 failed'; then
    echo "FAILED ${summary:-(no summary — suite crashed)}"
    echo "$output" | grep -E 'FAIL|Error|error:' | head -20 | sed 's/^/    /'
    failed=1
  else
    echo "$summary"
  fi
}

if [ "$WHICH" != "browser" ]; then
  echo
  echo "== API suites =="
  for suite in "$ROOT"/tests/e2e/api/*.sh; do run "api/$(basename "$suite")" bash "$suite"; done
fi

if [ "$WHICH" != "api" ]; then
  echo
  echo "== browser suites =="
  for suite in "$ROOT"/tests/e2e/browser/*.mjs; do
    [ "$(basename "$suite")" = "helpers.mjs" ] && continue
    run "browser/$(basename "$suite")" node "$suite"
  done
fi

echo
if [ "$failed" = "0" ]; then echo "All suites passed."; else echo "Some suites failed — see above."; fi
exit "$failed"
