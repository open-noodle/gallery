# Slice 13 — Migration reconciliation and operational safety

**Spec:** [`2026-07-30-face-review-unification-remediation-slices.md`](../specs/2026-07-30-face-review-unification-remediation-slices.md)
(Slice 13, findings F33–F35)
**Branch:** `feat/face-review-unified`
**Worktree:** `/Users/pierre/dev/gallery/.claude/worktrees/pr834-rebase`

**Runs concurrently with Slices 1 and 2.** Its file set is disjoint from theirs. Do not touch
`server/src/services/person.service.ts`, anything under `server/src/repositories/`, or the spec
file — concurrent agents own those.

## Goal

An instance that ran an earlier RC of this branch is repaired rather than silently wrong; switching
back to upstream Immich is verified as well as attempted; and an inverted suggestion band in a
config file is reported instead of silently disabling the feature.

## Background the implementer needs

`server/src/schema/migrations-gallery/1787000000000-AddFacePersonVerdict.ts` was edited **in place
after it had already been deployed to RC and staging instances**. Two commits did it:

- `7ed4e8c4bc6` flipped the `face_person_verdict_identityId_fkey` foreign key from
  `ON DELETE CASCADE` to `ON DELETE SET NULL`;
- `4a64b158139` rewrote the four `migration_overrides` INSERT payloads from
  `WHERE "personId" IS NOT NULL` to the parenthesized `WHERE ("personId" IS NOT NULL)` form that
  `sql-tools`' `asIndexCreate` actually emits.

Kysely records migrations by **name only**, with no checksum, so `1787000000000` never re-runs.
Those instances therefore keep `ON DELETE CASCADE` — and deleting a `face_identity` row, which every
people merge does, CASCADE-deletes the verdicts keyed to it. That is precisely the data loss
`7ed4e8c4bc6` was written to prevent. They also log four override-drift warnings on every boot.

The schema-drift check is warn-only (`server/src/services/database.service.ts:119-127`) and the
drift gate (`server/test/medium/specs/schema-drift.spec.ts`) only ever sees a freshly-migrated
database, so neither can catch this.

Four other migration names recorded by RC databases were deleted or renamed on this branch
(`1782000000000-AddFaceRepairScanFlaggedFace`, `1783000000000-AddFaceRepairScanInFlightIndex`,
`1785000000000-AddFaceRepairLock`, `1786000000000-FaceRepairLockPersonNullable`). Those cause a hard
boot failure (`corrupted migrations: previously executed migration … is missing`) and the accepted
remedy stays "reset the instance" — this slice only makes that remedy _documented in the repo_
rather than living solely in a PR description.

## Files

| File                                                                                          | Change           |
| --------------------------------------------------------------------------------------------- | ---------------- |
| `server/src/schema/migrations-gallery/1788000000000-ReconcileFacePersonVerdictConstraints.ts` | new              |
| `server/test/medium/specs/migrations/face-person-verdict.migration.spec.ts`                   | tests            |
| `scripts/revert-to-immich.sql`                                                                | guards           |
| `server/src/utils/config.ts`                                                                  | invariant        |
| `server/src/utils/config.spec.ts`                                                             | tests            |
| `docs/docs/administration/face-cleanup.md`                                                    | RC note          |
| `docs/docs/install/config-file.md`                                                            | reference config |

## Part 1 — the reconciliation migration

Read `1787000000000-AddFacePersonVerdict.ts` first and mirror its exact style (it is the source of
truth for the constraint name and the four override payloads). **Do not edit it.**

Create `1788000000000-ReconcileFacePersonVerdictConstraints.ts`. It must be a no-op on a fresh
install and idempotent on every run.

`up()`:

1. **The FK.** Conditionally repair only when it is currently `CASCADE`, so a fresh install does no
   DDL at all:

   ```sql
   DO $$
   BEGIN
     IF EXISTS (
       SELECT 1
       FROM pg_constraint
       WHERE conname = 'face_person_verdict_identityId_fkey'
         AND confdeltype = 'c'   -- 'c' = CASCADE, 'n' = SET NULL
     ) THEN
       ALTER TABLE "face_person_verdict"
         DROP CONSTRAINT "face_person_verdict_identityId_fkey";
       ALTER TABLE "face_person_verdict"
         ADD CONSTRAINT "face_person_verdict_identityId_fkey"
         FOREIGN KEY ("identityId") REFERENCES "face_identity" ("id") ON DELETE SET NULL;
     END IF;
   END $$;
   ```

   Verify `confdeltype`'s encoding against the Postgres docs before relying on it (`a` = no action,
   `r` = restrict, `c` = cascade, `n` = set null, `d` = set default). If you prefer, query
   `information_schema.referential_constraints.delete_rule` instead — either is fine, but the
   condition must be exact.

2. **The four override rows.** Re-write them with the parenthesized payloads using
   `INSERT … ON CONFLICT … DO UPDATE`, copying the exact `value` strings from `1787000000000`'s
   current (post-`4a64b158139`) source. On a fresh install these are already correct and the
   `DO UPDATE` is a no-op write; on an RC database they are repaired. The four index names are:
   - `index_face_person_verdict_personId_assetFaceId_uq`
   - `index_face_person_verdict_spacePersonId_assetFaceId_uq`
   - `index_face_person_verdict_spacePersonId_status_distance_idx`
   - `index_face_person_verdict_identityId_assetFaceId_idx`

`down()`: restore the `CASCADE` FK and the unparenthesized override payloads, so the migration is
genuinely reversible.

**Tests** in `server/test/medium/specs/migrations/face-person-verdict.migration.spec.ts` (extend the
existing file; it already pins the 1787 schema and shows the idiom for running migrations against a
real database):

- **S13.1** — set the FK back to `CASCADE` by hand, run `1788000000000`, assert it is `SET NULL`;
  run it a second time and assert it is still `SET NULL` and no error is raised.
- **S13.2** — on a freshly-migrated database, capture the constraint definition and all four override
  `value` strings **before** running `1788000000000`, run it, and assert every one is byte-identical
  afterwards.
- **S13.3** — set the four override rows to the unparenthesized payloads by hand, run the migration,
  then assert `getSchemaDrift()` reports empty. Use the same drift entry point
  `server/test/medium/specs/schema-drift.spec.ts` uses.
- **S13.4** — `down()` restores both the `CASCADE` FK and the unparenthesized payloads.
- **S13.5 — BDD, the data-loss case.** **Given** a database whose FK is `CASCADE` and which holds a
  `face_person_verdict` row keyed to identity `I` (with a live `assetFaceId`), **When**
  `1788000000000` runs and `I` is then deleted, **Then** the verdict row still exists with
  `identityId` NULL. Add the control: assert that **without** the migration the same delete removes
  the row, so the test cannot pass for the wrong reason.
- **S13.6** — the existing whole-schema drift assertion in `schema-drift.spec.ts` still reports zero
  drift after the new migration is part of the chain. (Run that spec; do not modify it unless it
  genuinely needs it.)

## Part 2 — the suggestion-band invariant on the config-file path

**Defect.** The invariant `suggestions.maxDistance > facialRecognition.maxDistance` is enforced only
by the `ConfigValidate` event hook (`server/src/services/person.service.ts:111-119`), which is
emitted from exactly one place — `system-config.service.ts:68`, inside `updateSystemConfig`, which
is itself hard-refused in config-file mode. `FaceSuggestionConfigSchema`
(`server/src/dtos/model-config.dto.ts:32-43`) carries no cross-field check. So a config file with
`suggestions: { enabled: true, maxDistance: 0.4 }` and `facialRecognition.maxDistance: 0.5` boots
cleanly, the feature is silently inert (the repository read short-circuits), and the admin cannot
diagnose it because the settings page is read-only in that mode.

**Approach — explicit check in `buildConfig`, not a Zod refinement.** `buildConfig`
(`server/src/utils/config.ts:115-160`) already has exactly the right shape: it parses, and on
failure **throws** when `configFile` is set and **logs** otherwise. Add the invariant check
immediately after the existing `safeParse` block, reusing that same throw-vs-log split.

Do **not** reach for `.superRefine` on `FacialRecognitionConfigSchema` or `SystemConfigSchema`.
Both are consumed by `createZodDto` and by the OpenAPI generator, and wrapping them turns them into
a `ZodEffects` that cannot be `.extend()`ed and may lose its `.meta({ id })` — which would silently
change the generated spec. The explicit check carries no such risk. Record this reasoning in a
comment at the check.

Requirements:

- The check binds **only when `suggestions.enabled` is true**. A disabled feature with an inverted
  band is not an error.
- It runs **after** `foldLegacyFaceSuggestionConfig` (which already happens — the fold is at
  `:120`, well before the parse), so a legacy config is judged on its folded values.
- The message names both values and both keys, the way the `ConfigValidate` hook's does.
- Keep the `ConfigValidate` hook exactly as it is. It produces the better message for the settings
  page, and it is pinned by an existing test. **Do not edit `person.service.ts`.**

**Tests** in `server/src/utils/config.spec.ts` (follow the existing idioms there for driving
`buildConfig` with a config file vs. database source):

- **S13.7** — config-file source, `suggestions: { enabled: true, maxDistance: 0.4 }` with
  `facialRecognition.maxDistance: 0.5` ⇒ `buildConfig` **throws**, and the message names both values.
- **S13.8** — the same config with `suggestions.enabled: false` ⇒ no throw (the invariant only binds
  when the feature is on).
- **S13.9** — database source with the same inverted band ⇒ does **not** throw, logs an error
  (mirrors how the existing parse failure is handled on that path).
- **S13.10 (pin)** — a valid band (`suggestions.maxDistance: 0.7`, `facialRecognition.maxDistance: 0.5`)
  passes on both sources.
- **S13.11 (pin)** — the legacy `suggestionMaxDistance` fold still runs before the check: a legacy
  config whose folded value is valid is accepted, not rejected on the pre-fold value.

## Part 3 — `revert-to-immich.sql` verification guards

The DROP section (`:123-141`) and the exact-name `kysely_migrations` DELETE list (`:390-407`) are
already complete for this PR. The two abort guards are not:

- `fork_tables_left` (`:465-486`) lists only `face_person_verdict`. Add `face_repair_scan`,
  `face_repair_decline`, `face_repair_scan_flagged_face` and `face_repair_lock` — all four are
  dropped at `:136-139` but never verified.
- `fork_rows_left` (`:441-460`) has `%AddPersonFaceSuggestion%`, `%AddSpacePersonFaceSuggestion%`,
  `%AddFaceSuggestionIntentStatuses%` and `%AddFacePersonVerdict%`. Add `%AddFaceRepairScan%`,
  `%AddFaceRepairDecline%`, `%AddFaceRepairLock%`, `%AddFaceRepairScanFlaggedFace%` and
  `%AddFaceRepairScanInFlightIndex%`.

Also add the four pre-rename / deleted migration names to the exact-name DELETE list so an RC
database is cleaned rather than tripping the LIKE guard:
`1782000000000-AddFaceRepairScanFlaggedFace`, `1783000000000-AddFaceRepairScanInFlightIndex`,
`1785000000000-AddFaceRepairLock`, `1786000000000-FaceRepairLockPersonNullable`.

**S13.12** — there is no automated harness for this script. Verify by inspection: enumerate every
new schema object this PR adds and confirm each appears in both the DROP section and the relevant
guard. Write that enumeration into your report as a table so it can be checked. Do not execute the
script against any database.

## Part 4 — documentation

- `docs/docs/administration/face-cleanup.md` — add a short, factual note that instances which ran a
  pre-release build of this feature must be reset rather than upgraded in place, and why (recorded
  migration names that no longer exist on disk). Keep the tone mechanical; this is a public repo.
- `docs/docs/install/config-file.md:143-149` — the reference `machineLearning.facialRecognition`
  block still lists only `enabled/maxDistance/minFaces/minScore/modelName`. Add the `suggestions`
  block with its defaults (`enabled: false`, `maxDistance: 0.7` — confirm against
  `server/src/config.ts:353`) so config-file operators, who cannot use the admin UI, have the key
  name.

Run `npx prettier --write` on both files afterwards — CI Docs Build is strict.

## Verification

```bash
cd server
pnpm exec vitest --config test/vitest.config.medium.mjs --run \
  test/medium/specs/migrations/face-person-verdict.migration.spec.ts \
  test/medium/specs/schema-drift.spec.ts
pnpm exec vitest --config test/vitest.config.mjs --run src/utils/config.spec.ts
cd .. && npx prettier --check 'docs/**/*.md'
```

## Constraints

- **Never** run `make sql` / `mise //:sql` — it deletes every query file when no database is running.
- `pnpm test -- --run <path>` silently drops the path filter — use the `pnpm exec vitest --config …`
  forms above.
- Fork migrations live in `server/src/schema/migrations-gallery/` with a round timestamp. Never amend
  an existing one.
- Do not add `Co-Authored-By` or "Generated with" trailers.
- Do not commit — the controlling session commits.

## Commit

```
fix(server): reconcile face_person_verdict constraints and enforce the suggestion band everywhere
```
