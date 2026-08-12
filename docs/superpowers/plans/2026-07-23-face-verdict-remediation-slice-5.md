# Face Verdict Remediation — Slice 5: Schema-drift silence and revert hygiene — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Close **D5** (four `face_person_verdict` partial-index overrides stored with a bare `WHERE "col" IS NOT NULL`, which `schemaFromCode` emits parenthesized → perpetual boot-time drift spam that the drift spec's single-index filter can't see) and **D13** (the revert-to-immich override cleanup omits `index_face_repair_scan_in_flight_uq`). Prove zero drift on a fresh migrated DB.

**Architecture:** Byte-match the four override `sql` strings to `asIndexCreate`'s parenthesized form (the exact fix migration `1784`/`1778800000000` already applied for the sibling indexes — proof that `schemaFromCode` parenthesizes both `IN (...)` and `IS NOT NULL` predicates). Flip the drift spec from "no drift for one named index" to **zero offenders overall**. Add the missing index name to the revert script.

**Tech Stack:** Kysely migrations (edit in place — RC DBs are reset), `@immich/sql-tools` `schemaDiff`, Vitest medium (migrated template DB).

## Global Constraints

- `src/` alias; eslint `--max-warnings 0`; Prettier.
- Medium run: `cd server && pnpm exec vitest --config test/vitest.config.medium.mjs --run test/medium/specs/schema-drift.spec.ts`. The medium global setup migrates a fresh template DB, so the drift check reflects a real boot.
- Edit migration `1787` **in place** (spec decision; nothing has shipped, RC DBs reset). Do NOT add a fix-forward migration.
- **R3 — zero-offender may surface PRE-EXISTING drift** unrelated to this PR. If so: fix it in-slice if it's a real fork bug; if it's genuinely upstream/unavoidable, add a **documented, dated code comment + a narrow exclusion for that specific offender** — never re-introduce an index-name filter that would re-hide the four verdict overrides. Report every offender the zero assertion surfaces so the controller can adjudicate.
- One commit. No `Co-Authored-By` trailers.

---

## File Structure

- **Modify** `server/src/schema/migrations-gallery/1787000000000-AddFacePersonVerdict.ts` — parenthesize the `WHERE ... IS NOT NULL` inside the four `migration_overrides` `sql` values (~lines 78, 83, 88, 93). The `CREATE ... INDEX` statements themselves (~34-57) stay bare (Postgres normalizes the live index regardless); ONLY the stored override strings need to byte-match.
- **Modify** `server/test/medium/specs/schema-drift.spec.ts` — replace the single-index-filter test with a zero-offenders assertion.
- **Modify** `scripts/revert-to-immich.sql` — add `'index_face_repair_scan_in_flight_uq'` to the override-deletion `IN (...)` list (near the other `index_*` entries, ~242-252).

---

## Task 1: Red — zero-offender drift assertion

**Files:** Modify `server/test/medium/specs/schema-drift.spec.ts`.

- [ ] **Step 1:** Replace the `it('does not report drift for face_repair_scan_in_flight_uq', ...)` block with:

```ts
it('reports no schema drift at all (decorator/override vs a freshly-migrated DB)', async () => {
  const drift = await computeDrift();
  expect(drift.asHuman()).toEqual([]);
});
```

Update the comment above it to describe the general contract (any override whose stored `sql` doesn't byte-match `schemaFromCode` produces boot-time drift; this gate catches all of them, not one named index).

- [ ] **Step 2: Run RED** — `cd server && pnpm exec vitest --config test/vitest.config.medium.mjs --run test/medium/specs/schema-drift.spec.ts`. Expected RED: the assertion fails listing the four `face_person_verdict_*` override/index offenders (OverrideUpdate + possibly IndexDrop/IndexCreate). **Record the FULL list of offenders** the assertion prints — if anything OTHER than the four verdict indexes appears, note it for the controller (R3). Confirm the file executed.

---

## Task 2: Green — parenthesize the four override strings

**Files:** Modify `server/src/schema/migrations-gallery/1787000000000-AddFacePersonVerdict.ts`.

- [ ] **Step 1:** In each of the four `INSERT INTO "migration_overrides"` values (~78, 83, 88, 93), change the trailing predicate inside the escaped `sql` string from bare to parenthesized. Example for the first (`personId`):

```
... ON \"face_person_verdict\" (\"personId\", \"assetFaceId\") WHERE \"personId\" IS NOT NULL;
```

becomes

```
... ON \"face_person_verdict\" (\"personId\", \"assetFaceId\") WHERE (\"personId\" IS NOT NULL);
```

Apply the identical `WHERE \"col\" IS NOT NULL` → `WHERE (\"col\" IS NOT NULL)` transform to all four:

- `index_face_person_verdict_personId_assetFaceId_uq` → `WHERE ("personId" IS NOT NULL)`
- `index_face_person_verdict_spacePersonId_assetFaceId_uq` → `WHERE ("spacePersonId" IS NOT NULL)`
- `index_face_person_verdict_spacePersonId_status_distance_idx` → `WHERE ("spacePersonId" IS NOT NULL)`
- `index_face_person_verdict_identityId_assetFaceId_idx` → `WHERE ("identityId" IS NOT NULL)`

(Compare against `1784000000000-FixFaceRepairScanInFlightIndexOverride.ts` and `1778800000000-ReconcileFaceIdentityIndexOverrides.ts` for the exact expected byte form.)

- [ ] **Step 2: Run GREEN** — re-run the drift spec. Expected: `[]`.
- [ ] **Step 3 (R3):** If offenders REMAIN after Step 1, they are pre-existing. Investigate each: if it's a real fork override bug (same byte-mismatch class), fix that override string too (in its own migration, edited in place if it's a fork migration; if upstream, STOP and report to the controller — an upstream migration edit needs adjudication). Do NOT re-add an index-name filter. Report what you found and did.

---

## Task 3: Green — revert script hygiene (D13) + done gate + commit

**Files:** Modify `scripts/revert-to-immich.sql`.

- [ ] **Step 1:** Confirm `index_face_repair_scan_in_flight_uq` is absent from the override-deletion `IN (...)` list (`grep -n 'index_face_repair_scan_in_flight_uq' scripts/revert-to-immich.sql` → no hit in the deletion list). Add it among the `index_*` entries (e.g. after `'index_face_person_verdict_identityId_assetFaceId_idx'`):

```sql
   'index_face_person_verdict_identityId_assetFaceId_idx',
   'index_face_repair_scan_in_flight_uq',
```

- [ ] **Step 2: Done gate:**

```
cd server && pnpm exec vitest --config test/vitest.config.medium.mjs --run test/medium/specs/schema-drift.spec.ts   # []
cd server && pnpm check && pnpm lint
```

(The Revert-to-Immich Validation _workflow_ is a CI job — dispatched in Slice 10; known to false-fail on Docker Hub rate limits. Not run locally here.)

- [ ] **Step 3: Commit:**

```bash
cd /Users/pierre/dev/gallery/.claude/worktrees/face-unified
git add server/src/schema/migrations-gallery/1787000000000-AddFacePersonVerdict.ts \
        server/test/medium/specs/schema-drift.spec.ts \
        scripts/revert-to-immich.sql \
        docs/superpowers/plans/2026-07-23-face-verdict-remediation-slice-5.md
git commit -m "fix(server): byte-match face_person_verdict index overrides; drift gate covers everything"
```

---

## Self-review (author)

- **Spec coverage:** D5 (4 override strings parenthesized + zero-offender drift gate) and D13 (revert index added) each have a task + the drift-spec proof. ✅
- **Placeholder scan:** the exact transform (`WHERE "col" IS NOT NULL` → `WHERE ("col" IS NOT NULL)`) and the zero-offender assertion are concrete. The R3 branch is a real contingency with a named rule (fix or documented exclusion, never a name-filter), not a placeholder. ✅
- **Scope:** migration edited in place; no fix-forward migration; no unrelated schema change beyond fixing any genuine drift the gate surfaces (R3). ✅
- **Risk:** R3 — if the zero-offender assertion surfaces unrelated drift, the implementer reports it and the controller adjudicates before the slice commits. Flagged in Task 2 Step 3.
