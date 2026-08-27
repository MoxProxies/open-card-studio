# End-to-end tests

396 checks that drive the real app: `api/` hits a running backend with
curl, `browser/` drives the running editor with Playwright. There are no
unit tests here — these exist because every bug that actually shipped in
this codebase was one that reading the diff didn't catch and running the
app did.

## Running them

```sh
pnpm test:e2e            # everything
pnpm test:e2e:api        # just the curl suites
pnpm test:e2e:browser    # just the Playwright suites
```

`run.sh` boots **its own** backend (`:8001`) and editor (`:4174`) against
a throwaway SQLite database, then tears them down. It deliberately
ignores whatever `pnpm dev:editor` has running: a suite that inherits
rows from a previous run, or talks to a server whose database it can't
identify, produces failures that cost far more to diagnose than a fresh
boot costs to do.

To run against servers you already have:

```sh
E2E_API_URL=http://127.0.0.1:8000 E2E_EDITOR_URL=http://localhost:4173/ pnpm test:e2e
```

## Writing more

Every suite prints `PASS`/`FAIL` per check and ends with a
`== N passed, M failed ==` line — that line is what `run.sh` greps, so
keep it. `browser/helpers.mjs` has the shared driving code: `openApp`,
`signUp`, `go(page, tab)`, `fetchJson`, `publishTemplate`.

Two rules learned the hard way:

- **Assert shapes, not counts of shared state.** `badges.length === 6`
  broke the moment a phase added a seventh. `len(d) >= 6` and a check for
  the ids you care about doesn't.
- **Address rows by id, not by their text.** A dev database accumulates
  identically-named rows from earlier runs; `.first()` on a name once
  suspended the wrong account.

## What they don't cover

Anything needing real third-party credentials — OAuth round-trips against
a live provider, actual email delivery. Those are faked at the boundary
and the fake is what's asserted.
