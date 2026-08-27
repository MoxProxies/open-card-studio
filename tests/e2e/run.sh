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

# Kills the whole process group, not just the job we started: `pnpm dev`
# spawns vite and `artisan serve` spawns php -S, so killing the wrapper
# leaves the actual server holding the port — which the next run then
# refuses to start against.
stop_group() {
  [ -n "${1:-}" ] || return 0
  kill -- "-$1" 2>/dev/null || kill "$1" 2>/dev/null
  return 0
}

cleanup() {
  [ "$OWN_API" = "1" ] && stop_group "${API_PID:-}"
  [ "$OWN_WEB" = "1" ] && stop_group "${WEB_PID:-}"
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

# A server already on our port is not ours: it has a different database
# and, more subtly, a different CORS origin — which surfaces as browser
# suites failing on requests rather than as anything that names the real
# cause. Refuse rather than reuse.
port_busy() { curl -sf -o /dev/null --max-time 2 "$1" 2>/dev/null; }

if [ -z "${E2E_API_URL:-}" ] && port_busy "http://127.0.0.1:$API_PORT/up"; then
  echo "!! Something is already listening on :$API_PORT. It isn't this run's server," >&2
  echo "   so it has the wrong database and CORS origin. Stop it, or set" >&2
  echo "   E2E_API_URL to use it deliberately." >&2
  exit 1
fi

if [ "$WHICH" != "api" ] && [ -z "${E2E_EDITOR_URL:-}" ] && port_busy "http://localhost:$WEB_PORT/"; then
  echo "!! Something is already listening on :$WEB_PORT. Stop it, or set E2E_EDITOR_URL." >&2
  exit 1
fi

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
  # Every suite signs up from 127.0.0.1, so the whole run shares one
  # registration bucket — at the production limit a long run eventually
  # 429s, and the symptom is a sign-up form that never completes rather
  # than anything that names a rate limit. See config/security.php.
  export REGISTER_PER_MINUTE=1000
  # The links in password-reset emails, and the allowlist social sign-in
  # returns tokens to, are both built from this — so it has to be the
  # editor this run actually started, not the dev default.
  export FRONTEND_URLS="http://localhost:$WEB_PORT"
  (cd "$ROOT/backend" && php artisan migrate --force --no-interaction) >"$LOGS/backend.log" 2>&1
  # setsid so the server gets its own process group for stop_group above.
  setsid bash -c "cd '$ROOT/backend' && exec php artisan serve --host=127.0.0.1 --port=$API_PORT" >>"$LOGS/backend.log" 2>&1 &
  API_PID=$!
fi

if [ "$WHICH" != "api" ] && [ -z "${E2E_EDITOR_URL:-}" ]; then
  OWN_WEB=1
  echo "== editor on :$WEB_PORT =="
  # VITE_API_BASE_URL points the app at the backend above rather than the
  # dev default, so the two halves of a run always match.
  setsid bash -c "cd '$ROOT' && VITE_API_BASE_URL='$API_URL' exec pnpm --filter @card-studio/editor dev --port $WEB_PORT --strictPort" >"$LOGS/editor.log" 2>&1 &
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
  # "0 passed, 0 failed" means the suite threw before asserting anything —
  # treat a suite that ran no checks as broken, not as passing.
  if [ -z "$summary" ] || echo "$summary" | grep -qv ', 0 failed' || echo "$summary" | grep -q '^== 0 passed'; then
    echo "FAILED ${summary:-(no summary — suite crashed)}"
    echo "$output" | grep -E 'FAIL|Error|error:' | head -20 | sed 's/^/    /'
    # A suite that *threw* reports one useless line ("Timeout exceeded")
    # — the locator it was waiting for is on the lines after it, which
    # the grep above drops. Show the tail as well, or the failure can't
    # be diagnosed without re-running by hand.
    if [ -z "$summary" ] || echo "$output" | grep -q 'threw:'; then
      echo "$output" | tail -25 | sed 's/^/    | /'
    fi
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
