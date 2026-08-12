# Face Verdict Remediation — Slice 4: `'manual'` survives every non-human write — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Close **D4**. A positive verdict (`face_identity_face.source='manual'`) can only be created or removed by an explicit human placement or `unconfirm` — never silently downgraded by an automatic merge, a recognition-race replace, or a backfill sweep. And per **R1 (SIGNED OFF: preserve prior source)**, a people-merge re-points identity while **preserving each rode-along face's prior source** (stops fabricating `'manual'` placements that blind the cleanup scan to whole clusters).

**Architecture — TWO deliberately different mechanisms (do not conflate):**

1. **Preserve-manual CASE** (D4a/D4b/D4c) at write sites whose incoming `source` is genuinely non-`'manual'` (`'shared-space-evidence'` / `'owner-person'` / `'backfill'`): `source = CASE WHEN existing='manual' THEN 'manual' ELSE <incoming> END`. Keeps a human placement while relabeling everything else. This is the `realignFacesToPersonIdentity` pattern.
2. **Full source preservation** (D4d / R1) at the human people-merge path, whose incoming `source` is _always_ `'manual'`: **omit `source` from the write entirely** so Postgres leaves each face's true prior source untouched. A CASE here is a **FALSE FIX** — `ELSE 'manual'` == the bug.

**Tech Stack:** Kysely (`sql` CASE; ON CONFLICT `doUpdateSet` — omitting a key leaves the column untouched), Vitest medium.

## Global Constraints

- `src/` alias; eslint `--max-warnings 0`; Prettier 120-col.
- Unit run: `cd server && pnpm exec vitest --config test/vitest.config.mjs --run <path>`. Medium: `cd server && pnpm exec vitest --config test/vitest.config.medium.mjs --run <path>`. Never the `-- --run` forms. Confirm each file executed.
- `FaceIdentityFaceSource = 'owner-person' | 'ml' | 'backfill' | 'shared-space-evidence' | 'manual' | 'import'` (plain varchar + CHECK — a CASE ELSE with a bound value needs no cast).
- **The trap:** at `mergeIdentitiesAfterProfileResolution` and its `linkPersonFaces` merge caller, `input.source` is compile-time `'manual'`. A `CASE ... ELSE input.source` there reproduces the bug. Use omission/preserveSource, NOT a CASE, on that path.
- **Cleanup coverage may legitimately improve:** with rode-along faces no longer stamped `'manual'`, cleanup/suggestion scans can now flag more faces on merged clusters. Some `face-repair.*` medium assertions on flagged counts over merged clusters may change — update them **deliberately** (understand why the count moved), never mechanically to make green.
- **R1 is signed off** (preserve prior source). Slice 4's commit may land. Scope: Slice 4 only — no read gates (Slice 6), no atomicity (Slice 9).
- One commit at the end. No `Co-Authored-By` trailers.

---

## File Structure

- **Create** `server/src/utils/face-verdict-merge.ts` already exists (Slice 1). Add `preserveManualSource(incoming)` there (SQL CASE helper), OR co-locate in `face-identity.repository.ts`. Prefer the repo file (all consumers are in it).
- **Modify** `server/src/repositories/face-identity.repository.ts`:
  - `mergeIdentities` write (~3047-3051): `source: preserveManualSource(input.source)` (D4a — incoming is `'shared-space-evidence'`).
  - `replaceFaceIdentity` `doUpdateSet` (~2337-2343): `source: preserveManualSource(input.source)` (D4b — closes the recognition race; incoming `'owner-person'`).
  - `linkPersonFaces` (~2384-2418): add `preserveSource?: boolean` to `LinkPersonFacesInput`. Insert branch keeps `eb.val(input.source)`. `doUpdateSet`: if `preserveSource` → `{ identityId, confidence: null }` (omit source → untouched, D4d); else → `{ identityId, source: preserveManualSource(input.source), confidence: null }` (D4c — backfill caller preserves manual).
  - `mergeIdentitiesAfterProfileResolution` write (~3150-3154): **drop `source: input.source`** from the `.set({...})` (keep the `source` param only for the ~3138 cross-type gate) — full preservation, D4d/R1.
- **Modify** `server/src/services/identity-merge-propagation.service.ts` (~329-332): pass `preserveSource: true` to the `linkPersonFaces` call. (The `mergeIdentitiesAfterProfileResolution` call at ~368 needs no change — the repo omission handles it.)
- **NO change to** `person.service.ts` `handleRecognizeFaces` — D4b is fixed for free inside `replaceFaceIdentity` (line 1340 already calls it with `'owner-person'`; the CASE preserves an existing `'manual'`).
- **Modify tests:** `server/test/medium/specs/repositories/face-identity.manual-durability.spec.ts` (D4a/b/c), `server/test/medium/specs/services/identity-merge-propagation.service.spec.ts` (D4d — parameterize `createIdentityLinkedFace` source + add a discriminating test).

**Interface produced:**

```ts
// face-identity.repository.ts (exported or module-private)
function preserveManualSource(incoming: FaceIdentityFaceSource): RawBuilder<FaceIdentityFaceSource>;
// LinkPersonFacesInput gains: preserveSource?: boolean
```

---

## Task 1: Red — durability tests for all four D4 sites

**Files:** Modify `face-identity.manual-durability.spec.ts` and `identity-merge-propagation.service.spec.ts`.

- [ ] **Step 1 (manual-durability spec):** add three `it(...)` (copy `setup`/`seedFace`/`linkRowFor`/`runPersonalBackfill` from the file):
  - **D4a "automatic shared-space-evidence merge preserves a manual loser-link"** — seed identities T and S; link face Fm to S with `source='manual'` and face Fml to S with `source='ml'` (direct `insertInto('face_identity_face')`); call `faceIdentityRepository.mergeIdentities({ targetIdentityId: T, sourceIdentityIds: [S], source: 'shared-space-evidence' })`; assert Fm's link source stays `'manual'` and Fml's becomes `'shared-space-evidence'` (relabeled, NOT manual → still cleanup-flaggable).
  - **D4b "replaceFaceIdentity cannot downgrade a manual link"** — face F linked `'manual'` to identity I(P); call `faceIdentityRepository.replaceFaceIdentity({ assetFaceId: F, identityId: I(P), source: 'owner-person' })` (the recognition-race value); assert source stays `'manual'`. Then a control: a face linked `'ml'` → `replaceFaceIdentity(..., 'owner-person')` → becomes `'owner-person'` (ELSE branch works).
  - **D4c "backfill linkPersonFaces preserves a drifted manual link"** — drive `runPersonalBackfill` on a fixture landing in the "resembling"/embedding-consistent branch (so `repairRemainingPersonalIdentityFaceLinks` calls `linkPersonFaces` with `source: 'backfill'`, NOT the realign branch the existing test at ~93-123 already covers) where a face carries a stale `'manual'` link; assert it stays `'manual'`.

- [ ] **Step 2 (identity-merge-propagation spec) — D4d/R1:** parameterize the `createIdentityLinkedFace` helper (~100-111) to accept `source?: FaceIdentityFaceSource` (default `'manual'`, so existing callers are unchanged). Add:
  - **"a people merge preserves each rode-along face's prior source"** — target T, source S (real profiles + identities); seed one S-linked face with `source: 'ml'`, one with `source: 'owner-person'`, one with `source: 'manual'`; `sut.mergePersonalPeople(auth, T, [S])`; assert the ml/owner-person faces KEEP `'ml'`/`'owner-person'` (re-keyed to T's identity, NOT stamped `'manual'`), and the manual face stays `'manual'`.

- [ ] **Step 3: Run RED**:

```
cd server && pnpm exec vitest --config test/vitest.config.medium.mjs --run \
  test/medium/specs/repositories/face-identity.manual-durability.spec.ts \
  test/medium/specs/services/identity-merge-propagation.service.spec.ts
```

Expected RED: D4a Fm downgraded to `'shared-space-evidence'`; D4b manual → `'owner-person'`; D4c manual → `'backfill'`; D4d ml/owner-person → `'manual'`. Confirm both files executed.

---

## Task 2: Green — preserve-manual CASE at the three non-manual write sites (D4a/b/c)

**Files:** Modify `face-identity.repository.ts`.

- [ ] **Step 1:** Add the helper:

```ts
// Keep a human placement (source='manual') intact; relabel everything else to the incoming source.
// Mirrors realignFacesToPersonIdentity. Do NOT use this where `incoming` is itself 'manual' (see linkPersonFaces preserveSource).
function preserveManualSource(incoming: FaceIdentityFaceSource) {
  return sql<FaceIdentityFaceSource>`CASE WHEN "face_identity_face"."source" = 'manual' THEN 'manual' ELSE ${incoming} END`;
}
```

- [ ] **Step 2 (D4a):** `mergeIdentities` write ~3047-3051: `source: input.source` → `source: preserveManualSource(input.source)`.
- [ ] **Step 3 (D4b):** `replaceFaceIdentity` `doUpdateSet` ~2337-2343: `source: input.source` → `source: preserveManualSource(input.source)`.
- [ ] **Step 4 (D4c):** `linkPersonFaces` — add `preserveSource?: boolean` to `LinkPersonFacesInput`; the `doUpdateSet` becomes:

```ts
.onConflict((oc) =>
  oc.column('assetFaceId').doUpdateSet(
    input.preserveSource
      ? { identityId: input.identityId, confidence: null }
      : { identityId: input.identityId, source: preserveManualSource(input.source), confidence: null },
  ),
)
```

(Insert/expression branch unchanged — a fresh row has no prior source, `eb.val(input.source)` is correct.)

- [ ] **Step 5:** `cd server && pnpm check`. Expected clean.

---

## Task 3: Green — full source preservation on the human people-merge path (D4d / R1)

**Files:** Modify `face-identity.repository.ts`, `identity-merge-propagation.service.ts`.

- [ ] **Step 1 (repo):** `mergeIdentitiesAfterProfileResolution` write ~3150-3154: remove `source: input.source` from the `.set({...})` so only `identityId` is written:

```ts
await db
  .updateTable('face_identity_face')
  .set({ identityId: input.targetIdentityId }) // R1: re-point identity, PRESERVE each face's prior source
  .where('identityId', 'in', sourceIdentityIds)
  .execute();
```

Keep the `source` param (still used by the cross-type gate ~3138 `input.source !== 'manual'`). Add a comment explaining the omission is intentional (the trap).

- [ ] **Step 2 (service):** `identity-merge-propagation.service.ts` ~329-332: add `preserveSource: true` to the `linkPersonFaces` call so the target person's own pre-existing links aren't stamped `'manual'` either:

```ts
await this.deps.faceIdentityRepository.linkPersonFaces(
  { personId: step.targetPersonId, identityId: plan.targetIdentityId, source: 'manual', preserveSource: true },
  db,
);
```

- [ ] **Step 3:** `cd server && pnpm check`.

---

## Task 4: Refactor, deliberate coverage reconciliation, done gate, commit

- [ ] **Step 1: Refactor** — `realignFacesToPersonIdentity`'s inline CASE (~2710) now duplicates `preserveManualSource('backfill')`; replace it with `source: preserveManualSource('backfill')` for a single source of truth. Re-run the manual-durability spec — the existing realign test (~93-123) must stay green.
- [ ] **Step 2: Run the D4 tests GREEN**:

```
cd server && pnpm exec vitest --config test/vitest.config.medium.mjs --run \
  test/medium/specs/repositories/face-identity.manual-durability.spec.ts \
  test/medium/specs/services/identity-merge-propagation.service.spec.ts
```

- [ ] **Step 3: Cleanup-suite reconciliation** — run the full cleanup + durability suites:

```
cd server && pnpm exec vitest --config test/vitest.config.medium.mjs --run \
  test/medium/specs/services/face-repair.service.spec.ts \
  test/medium/specs/services/face-repair.resolve.spec.ts \
  test/medium/specs/services/face-repair.resolutions.spec.ts \
  test/medium/specs/services/face-repair.merge-consistency.spec.ts \
  test/medium/specs/services/face-verdict.merge-durability.spec.ts \
  test/medium/specs/services/face-suggestion-exclusions.spec.ts
```

If any flagged-count assertion over a merged cluster changed, investigate WHY (rode-along faces are now flaggable), confirm the new count is correct behavior, and update the assertion with a comment. **Do NOT** revert the fix to keep an old count. If a test genuinely regresses (not a count-shift), STOP.

- [ ] **Step 4: Done gate:** `cd server && pnpm check && pnpm lint`; also run the unit `identity-merge-propagation` / `face-repair.person` specs if they assert source. All green.
- [ ] **Step 5: Commit:**

```bash
cd /Users/pierre/dev/gallery/.claude/worktrees/face-unified
git add server/src/repositories/face-identity.repository.ts \
        server/src/services/identity-merge-propagation.service.ts \
        server/test/medium/specs/repositories/face-identity.manual-durability.spec.ts \
        server/test/medium/specs/services/identity-merge-propagation.service.spec.ts \
        docs/superpowers/plans/2026-07-23-face-verdict-remediation-slice-4.md
git commit -m "fix(server): manual face placements survive merges, races, and backfill sweeps"
```

---

## Edge-case coverage map (spec §Slice 4 table → test)

| Edge case                                      | Covered by                                                                                                                                    |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Recognition race, face assigned but NOT linked | control in D4b test: a non-manual face → `'owner-person'` (ELSE branch, today's correct behaviour)                                            |
| Manual merge (user-driven people merge)        | D4d test — per-face sources preserved; the merge is recorded on identity keys, not by stamping faces                                          |
| `unconfirm` after this slice                   | still demotes manual→ml (sanctioned path) — add/keep an assertion that `unconfirm` is unaffected (run an existing resolutions unconfirm test) |
| Backfill after merge (Slice-1 scenario)        | realign CASE (now via `preserveManualSource`) unchanged; the existing realign test ~93-123 keeps it pinned                                    |

## Self-review (author)

- **Spec coverage:** D4a (mergeIdentities CASE), D4b (replaceFaceIdentity CASE, closes recognition race), D4c (linkPersonFaces backfill CASE), D4d/R1 (full-preserve on the human merge path) — each has a task + a red-first test. The two-mechanism distinction is called out explicitly with the trap. ✅
- **Placeholder scan:** all code is concrete; the CASE helper, the omit-source write, and the preserveSource branch are exact. Test bodies name the exact helpers/fixtures to copy. ✅
- **Type consistency:** `preserveManualSource(incoming)` and `LinkPersonFacesInput.preserveSource` used identically across tasks. ✅
- **Scope:** no read gates (Slice 6), no atomicity (Slice 9). The R1 product change is applied only to the human people-merge path per sign-off; the automatic merge keeps the spec-mandated CASE (D4a). ✅
- **Risk:** the cleanup-count reconciliation (Task 4 Step 3) is the one place a reviewer must confirm the changes are deliberate, not mechanical. Flagged.
