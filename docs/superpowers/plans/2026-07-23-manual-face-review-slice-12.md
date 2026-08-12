# Slice 12 — Final gate + docs

Spec: §8, §9. Branch: `feat/face-manual-review`. Depends on slices 1-11.

No new red test — this is a verification sweep plus user-facing docs.

## Part A — Docs

Add a note to the user-facing docs describing the two modes: guided (scan finds likely mistakes,
triage worst-first) and manual (pick any person, audit every face, no scan needed). Keep it short and
put it wherever face cleanup is already documented under `docs/docs/`.

Run `cd docs && pnpm format:fix` afterwards — `pnpm format` is check-only.

## Part B — The full gate

CI runs these as **separate** jobs; a pass on one says nothing about another.

### Server (from `server/`)

```
pnpm lint                              # eslint, --max-warnings 0
pnpm exec prettier --check .           # WHOLE package, not just changed files — separate CI gate
pnpm check                             # tsc --noEmit
pnpm exec vitest --config test/vitest.config.mjs --run
pnpm exec vitest --config test/vitest.config.medium.mjs --run
```

`prettier --check .` over the whole package is deliberate: eslint green ≠ prettier green, and CI
checks `src/` and `test/` separately.

### Web (from `web/`)

```
pnpm check:typescript
pnpm check:svelte
pnpm lint                              # tailwind warnings tolerated; errors are not
pnpm exec vitest --run
```

If `check:svelte` reports **0 FILES**, treat that as an anomaly to investigate, not a pass — it has
produced a false green before.

If a web tsc failure mentions SDK symbols, the gitignored SDK build is stale: `make build-sdk`.

### Docs

```
cd docs && pnpm format                 # check; CI Docs Build is strict
```

This reaches `docs/superpowers/specs/` and `docs/superpowers/plans/`, so the spec and all twelve
slice plans must be docs-prettier clean.

### e2e

Run the API and web e2e suites against the **:2285** e2e stack (slice 11's notes apply).

## Part C — Sanity review of the whole branch

Read `git diff feat/face-review-unified...HEAD` end to end. Specifically confirm:

- the guided flow's nine web specs are **unmodified** except for slice 4's relocation
- no `.skip`, no deleted test, no weakened assertion anywhere in the branch
- `stay` is still snapshot-gated on the server
- no `@GenerateSql` was added and no `mise.lock` churn was committed

## Commit

`docs: document guided and manual face cleanup modes`
