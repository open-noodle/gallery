# Slice 18 — LOW[16] + LOW[17]: document + guard the postbuild migration alias

**Spec:** `docs/superpowers/specs/2026-07-02-rolling-rebase-audit-remediation.md` §"Slice 18"
**Findings:** `docs/plans/2026-07-02-rolling-rebase-audit-findings.md` LOW#16 / LOW#17
**Branch / worktree:** `rebase/upstream-rolling-20260509-active`

---

## Step A — ground truth

Read `server/bin/sync-gallery-migrations.mjs` in full. It is the npm `postbuild` hook
(`server/package.json` → `"postbuild": "node bin/sync-gallery-migrations.mjs"`) and does
**three** things, in this order, inside `syncGalleryMigrations()`:

1. `removeStaleCopiedGalleryMigrations` — deletes any file previously copied into
   `dist/schema/migrations/` from `migrations-gallery/` whose *name* no longer exists in
   either `src/schema/migrations-gallery/` (by full name) or `src/schema/migrations/`
   (upstream source), but whose *timestamp suffix* still matches a current gallery
   migration — i.e. cleans up stale copies left behind when a fork migration file is
   renamed (only the suffix, e.g. class name, matches after the timestamp).
2. `copyGalleryMigrations` — copies `dist/schema/migrations-gallery/*.js` into
   `dist/schema/migrations/`, so the flat `dist/schema/migrations/` folder used by
   `sql-tools` contains both upstream and fork migrations (this is the behavior CLAUDE.md
   currently documents as "the postbuild hook... copies... (plain `cp`)").
3. `syncCompatibilityAliases` — for each entry in the module-level `compatibilityAliases`
   array, if `dist/schema/migrations/<from>.js` exists, copies it (plus its `.js.map` /
   `.d.ts` siblings, if present) to `dist/schema/migrations/<to>.js`. Currently exactly one
   entry:

   ```js
   const compatibilityAliases = [
     {
       from: '1777667825574-ChangeDurationToInteger',
       to: '1776735180298-ChangeDurationToInteger',
     },
   ];
   ```

   **Why this exists:** the fork's `ChangeDurationToInteger` migration was originally
   authored under the upstream timestamp `1777667825574` and shipped in a released v5-RC.
   It was later renamed/re-timestamped to `1776735180298` (to fix ordering/collision
   concerns elsewhere in the rebase). Databases that already ran the migration recorded it
   in their migration-history table under the *old* name
   (`1777667825574-ChangeDurationToInteger`). Kysely's migrator hard-fails on boot
   (`#ensureNoMissingMigrations`) if a migration name recorded in the DB has no matching
   file on disk. The alias makes both filenames resolve to (functionally identical, since
   it's a copy of the same compiled file) migration modules in `dist/schema/migrations/`,
   so both a fresh DB (which only ever runs `1776735180298-...`) and an existing RC DB
   (which recorded `1777667825574-...`) boot cleanly. **Removing the alias bricks any
   already-deployed RC/staging DB that recorded the old name** — this is why the
   remediation decision is to keep it, not delete it.

`syncGalleryMigrations()` logs a summary line and returns `{ aliased, copied, removed }`
counts; it's also directly callable/importable (used from `if (process.argv[1] === ...)`
guard for CLI use, and exported for tests).

Read `CLAUDE.md`'s "Fork migration layout" section (under "Database Migrations
(server/)"). The "How they come together — the `postbuild` script" subsection says only:

> After `nest build` compiles TypeScript to `dist/`, the npm `postbuild` hook
> (`server/package.json`) copies `dist/schema/migrations-gallery/*.js` into
> `dist/schema/migrations/`. This means the built `dist/schema/migrations/` folder
> contains ALL migrations (upstream + fork) in one flat directory.

This describes only behavior (2) above — a plain copy. It says nothing about the
stale-copy cleanup (1) or the compatibility alias (3), so a future rebase/reader has no
signal that the alias is load-bearing and must not be dropped.

**Guard home decision:** the spec's option (b) — a `server` vitest spec importing
`syncGalleryMigrations`/`syncCompatibilityAliases` — was probed and rejected:
`server/test/vitest.config.mjs` hardcodes `include: ['src/**/*.spec.ts']`, so a spec at
`server/bin/sync-gallery-migrations.spec.ts` is invisible to
`cd server && npx vitest run --config test/vitest.config.mjs bin/sync-gallery-migrations.spec.ts`
(confirmed empirically: "No test files found... include: src/**/*.spec.ts"). Widening
that include glob is a `server/test/vitest.config.mjs` edit, which is out of scope for
this slice's file allowlist. **Using option (a) instead**: a new
`tools/upstream-preflight/src/migration-alias.spec.ts`, following the exact pattern of
the sibling `migration-timestamps.spec.ts` guard (repo-root-relative `fs` read of the
source file, no build/import needed, runs standalone via
`cd tools/upstream-preflight && npx vitest run src/migration-alias.spec.ts`).

---

## Step B — RED guard

New file: `tools/upstream-preflight/src/migration-alias.spec.ts`.

- Reads `server/bin/sync-gallery-migrations.mjs` as text (`fs.readFileSync`, resolved via
  `path.resolve(process.cwd(), '../../server/bin/sync-gallery-migrations.mjs')` — same
  `process.cwd()`-relative convention as `migration-timestamps.spec.ts`, since vitest runs
  from `tools/upstream-preflight`).
- Parses the `compatibilityAliases` array out of the source with a regex tolerant of
  future additional entries (doesn't assert exact array equality — asserts the required
  `ChangeDurationToInteger` entry is *included*, per spec edge case: "guard tolerates
  future additional alias entries").
- Asserts the parsed aliases contain an entry with
  `from: '1777667825574-ChangeDurationToInteger'` and
  `to: '1776735180298-ChangeDurationToInteger'`.
- Second `it`: reads `CLAUDE.md` as text and asserts (a) it mentions
  `sync-gallery-migrations.mjs` by name, and (b) it no longer describes the postbuild hook
  as *only* copying files — asserted by requiring the doc to also mention "alias" (or
  "compatibility") in the same migration section, which is false against the current doc.

**Expected RED reasoning (demonstrated, not by leaving the assertion broken):** the
`CLAUDE.md` doc-guard assertion is checked against the *current* file content first — the
existing subsection contains no occurrence of `alias`/`compatibility`/
`ChangeDurationToInteger`, so asserting `claudeMd.includes('sync-gallery-migrations.mjs')
&& /alias|compatibility/i.test(claudeMd)` on the pre-edit doc evaluates to `false`,
confirming RED. The alias-array assertion is already true today (the alias exists in
source) — its RED case is hypothetical/regression-only: if a future edit removed the
`ChangeDurationToInteger` entry from `compatibilityAliases`, the regex-based extraction
would no longer find a match and the `toContainEqual`/`some(...)` assertion would fail.
Both are demonstrated in the report by reasoning + a scratch removal check (temporarily
comment out the entry, observe failure, restore) rather than shipping the test in a
failing state.

**Command:** `cd tools/upstream-preflight && npx vitest run src/migration-alias.spec.ts`

---

## Step C — GREEN

1. Add `tools/upstream-preflight/src/migration-alias.spec.ts` (passes immediately against
   the current `sync-gallery-migrations.mjs`, since the alias already exists — that half
   of the guard is already green and stays green).
2. Rewrite the "Fork migration layout" → postbuild subsection of `CLAUDE.md` to describe
   all three behaviors and the RC-compatibility rationale for the alias (see exact text in
   the diff). This flips the doc-guard assertion to green.
3. Re-run the guard scoped → both `it`s green.

---

## Edge cases covered

- Guard tolerates future additional alias entries (`some(...)` inclusion check, not
  exact-equality against the whole array).
- Alias is only written by `syncCompatibilityAliases` when the `from` source file exists
  in `dist/schema/migrations/` (`existsSync(source)` guard in the script) — the guard
  reads *source* (the `.mjs` script text), not `dist/` state, so it makes no assumption
  about a build having run.
- Doc guard checks content, not exact prose — resilient to minor rewording as long as the
  hook name and "alias"/"compatibility" concept are both present.

## GREEN commands

```
cd tools/upstream-preflight && npx vitest run src/migration-alias.spec.ts
```

(File-scoped only per parallel-mode rules — no whole-project `pnpm check`/`pnpm test`.)

## Commit

`docs(server): document + guard the migration compatibility alias (LOW #16/#17)`

(Left uncommitted per orchestrator instructions — this line records the intended message
for the orchestrator's commit.)
