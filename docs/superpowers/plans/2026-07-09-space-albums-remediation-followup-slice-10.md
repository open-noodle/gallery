# Slice 10 — Migration & self-declaration hygiene (M12, M14, L11, L18) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. TDD where a test
> guards the invariant. Phase 2 (deferred). Server + one mobile guard test. **L18's PR-body edit is done
> separately by the controller via `gh`, not in this plan.**

**Goal:** Remove the codegen-drift and self-declaration soft spots the review flagged so future
`migrations:generate` / rebases stay clean and the sync version-gate assumption is testable.

## Global Constraints (spec §0)

- TDD, no co-author trailers. Targeted specs + tsc + lint. Re-confirm exact lines. Server prettier
  (`//server:format` runs `prettier --check .`) and eslint must pass; run `dart analyze --fatal-infos lib test`
  for the mobile guard test.

---

### M12 — migration DDL + `migration_overrides` drift from `functions.ts` (TDD: pin equality)

**Files:** `server/src/schema/migrations-gallery/1782000000000-AddAlbumSoftDeleteSharedSpaceAlbumTrigger.ts`
(executed `CREATE OR REPLACE FUNCTION` at ~`:15-69`; `migration_overrides` function `sql` at `:77`; trigger
override at `:81`), `server/src/schema/functions.ts` (`album_soft_delete_shared_space_album` at `:735`,
via `asFunctionExpression`).
**Problem (verified):** the migration's executed DDL and its `migration_overrides` `sql` value both differ
from the registered function in `functions.ts` — they omit comment lines and the override's `sql` is
truncated (ends `...RETURN NULL;\n    END`, missing `\n  $$;`). `sql-tools` compares overrides by exact
string equality, so a future `migrations:generate` emits a spurious `FunctionCreate`+`OverrideUpdate`.
Sibling `1782100000000` matches byte-for-byte. No runtime impact (function behaviorally identical).

- [ ] **Test (unit) RED — the durable guard:** add a spec (e.g.
      `server/src/schema/migrations-gallery/migration-override-parity.spec.ts`) that imports
      `album_soft_delete_shared_space_album` from `functions.ts`, computes `asFunctionExpression(...)` (the
      same helper `functions.ts` uses to emit DDL), reads the migration file, extracts the
      `migration_overrides` function `sql` literal, and asserts it **equals** the registered function's DDL
      expression byte-for-byte. RED today (drift). (Do the same for the trigger override vs the registered
      trigger expression if a `asTriggerExpression` helper exists; else assert the function one — the review
      says the function override is the load-bearing one, `haveEqualOverrides` short-circuits on it.)
- [ ] **Implement:** regenerate the migration's executed `CREATE OR REPLACE FUNCTION` string (`:15-69`)
      AND the `migration_overrides` `sql` value (`:77`) to be **byte-identical** to
      `asFunctionExpression(album_soft_delete_shared_space_album)` — include the `-- soft-delete:` / `-- restore:`
      comment lines and the trailing `\n  $$;` tail (mirror `1782100000000`'s structure). The easiest reliable
      method: `console.log` the `asFunctionExpression(...)` output once, then paste the exact (JSON-escaped for
      the override) string. Verify the equality test goes GREEN.
- [ ] **Do NOT** run `make sql`/`migrations:generate` (needs a DB that ran this migration); the equality
      unit test is the local proof. Note in the commit that a scratch-DB `migrations:generate` should emit no
      spurious `FunctionCreate`/`OverrideUpdate` after this.
- [ ] Commit: `fix(spaces): align 1782000000000 trigger DDL + override with functions.ts (M12)`

### L11 — `revert-to-immich.spec.ts` guard blind spots

**File:** `server/src/schema/revert-to-immich.spec.ts` (~`:14-30`).
**Problem (verified):** (a) the table test derives the expected fork-table set **from the DROP statements
themselves** (`droppedForkTables = [...sql.matchAll(/DROP TABLE IF EXISTS "([^"]+)" CASCADE/g)]`), so a
fork table added WITHOUT a `DROP TABLE` line shrinks the expected set instead of failing → silent
incomplete revert. (b) the migration-name test uses whole-file `sql.includes`, not scoped to the step-8
DELETE block.

- [ ] **Test-hardening:** derive the expected fork-table set from the `migrations-gallery` / schema
      `CREATE TABLE` names (the actual source of truth — grep the schema table definitions or the
      `migrations-gallery` `createTable` calls for `shared_space*` / `*_audit` / `shared_space_face_match_backfill_target`),
      and assert each has **both** a `DROP TABLE ... CASCADE` line **and** a step-9 `fork_tables_left` guard
      entry in `revert-to-immich.sql`. Scope the migration-name assertion to the text between
      `DELETE FROM "kysely_migrations"` and its closing `);`.
- [ ] Run the spec — it must pass against the CURRENT `revert-to-immich.sql` (which was already extended in
      the first remediation + correctness-7). If it now flags a genuinely-missing DROP/guard entry, ADD it to
      `revert-to-immich.sql` (that's a real gap the hardened test caught — fix it).
- [ ] Commit: `test(spaces): derive revert-guard fork tables from schema, scope migration-name check (L11)`

### M14 — sync version-gate: add the Dart guard test (comment already fixed in Slice 9/L13)

**File:** `mobile/lib/infrastructure/repositories/sync_api.repository.dart` (the gated request-type list at
`:114`), new/edited mobile test under `mobile/test/...`.
**Problem (verified):** the only sync-outage protection is the client `serverVersion > 5.0.0` gate; there
is no test pinning WHICH request types must be version-gated, so a future dev can add a fork-only
`SyncRequestType` without a gate and silently reintroduce the 400-outage class. (The stale mobile comment +
`TODO(M14)` were already fixed in Slice 9's L13.)

- [ ] **Test (`flutter test`):** add a guard test asserting the set of **ungated** request types the client
      sends (below the version gate) equals the known-upstream `SyncRequestType` set (i.e. every fork-only
      `SharedSpaceAlbum*` type is INSIDE the `serverVersion > SemVer(...)` block). Build it so adding a new
      fork request type without gating it fails the test. Use the toolchain from Slice 9 (`mise exec -- flutter`,
      `flutter pub get` + l10n/keys gen first). Run `dart analyze --fatal-infos lib test` + `flutter test <path>`.
- [ ] Commit: `test(mobile): pin the fork-only sync request types to the version gate (M14)`

---

## Definition of done

- M12 override parity pinned by a passing equality unit test + the migration strings regenerated. L11
  revert-guard derives from schema + scopes the migration-name check (and any genuinely-missing revert
  entry added). M14 Dart guard test green (`dart analyze --fatal-infos lib test` clean). Server prettier +
  eslint clean. Commits pushed. (L18 PR-body update handled by the controller via `gh`.)
