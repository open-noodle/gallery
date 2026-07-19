# Slice 12 — Test hardening + R1 cleanup (M13, L19, R1) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. TDD where a new
> behavior is added; for test-hardening, the "RED" is proving the existing assertion is vacuous (passes
> with the bug present) before tightening it. Phase 2 (deferred). Server-only.

**Goal:** Close the test-suite soft spots the review flagged so the Phase-1/2 fixes can't silently
regress, and remove dead code (R1).

## Global Constraints (spec §0)

- No co-author trailers. Targeted specs + tsc + lint. `make sql` not expected (no query change). One
  commit per finding. Re-confirm exact lines before editing.

---

### M13 — motion-photo hide/show purge has no seam coverage

**File:** new medium test near `server/test/medium/specs/sync/sync-space-visibility-purge-cross-path.spec.ts`.
**Problem:** the #757 motion-photo purge (and the Slice-7 M3 motion retry fix) is pinned only by
mock-called unit tests (`asset.service.spec.ts:980`, `metadata.service.spec.ts`) — the real
`@OnEvent({name:'AssetHide'})` seam + the seeded-Timeline-prior invariant have zero medium/e2e coverage.
A refactor that renames the event or re-derives prior from the DB would keep unit tests green while motion
videos silently stop purging.

- [ ] **Test (medium):** seed a space-linked library with a **Timeline motion video**, sync + ack a
      member, emit the **real** `AssetHide` event (or drive `MetadataService.linkLivePhotos` /
      `updateAll {visibility:Hidden}`), assert the member's next `/sync` carries the **library-arm delete
      tombstone** for the motion asset; mirror with `AssetShow` → re-upsert. Prove it fails (RED) if the
      emit/handler is disconnected (temporarily comment the `@OnEvent` or the emit to confirm the test
      catches it), then restore.
- [ ] Commit: `test(spaces): pin motion-photo visibility purge through the real sync seam (M13)`

### L19 — four vacuous/mis-actor assertions

**Files:** `server/test/e2e`… wait — these are in `e2e/` and `server/`:

- **testq-2** (`e2e/src/specs/server/api/shared-space-visibility-negatives.e2e-spec.ts:605`): the
  PUT-locked album-removal test asserts `assetCount === 0`, which is vacuous (assetCount is
  visibility-filtered → 0 regardless of whether the `album_asset` row was deleted). **Fix:** after
  locking, PUT the asset back to Timeline and assert `assetCount` stays 0 (row deleted → no
  resurrection). Correct the false comment.
- **testq-4** (`server/src/services/search.service.spec.ts:626`): the `albumIds+personIds` bypass test
  was swapped from a space **member** to the **owner**, leaving the member person-filter path untested.
  **Fix:** re-add a member-actor test pinning the forced-empty outcome (members cannot person-filter
  album-scoped search).
- **testq-5** (`e2e/src/specs/server/api/shared-space-visibility-negatives.e2e-spec.ts:481`): the
  map-marker negative has no positive control that the _hidden_ asset would produce a marker. **Fix:**
  before hiding, drain metadataExtraction then assert the owner sees `hidden.id`'s marker; then flip to
  Hidden and run the negatives.
- **testq-6** (`server/src/services/shared-space.service.spec.ts:2033`): creator remove/demote
  protection has unit-only negatives, and most `updateMember`/`removeMember` tests stub
  `getById → undefined`, routing through the guard's **fail-open** branch as their happy path. **Fix:**
  add two e2e negatives (co-Owner DELETE / PATCH role=viewer on the creator → 403) in the shared-space
  e2e; **and** consider making the guard **fail-closed** (throw on a missing space row — safe, since the
  membership FK guarantees the space exists). If you make it fail-closed, update any unit test that
  relied on the fail-open happy path.
- [ ] Each: show the assertion is currently vacuous/absent (RED-equivalent) → tighten → GREEN.
- [ ] Commit: `test(spaces): de-vacuum visibility/creator-guard assertions (L19)`

### R1 — dead-code cleanup (refuted finding, cleanup only)

**File:** `server/src/services/duplicate.service.ts:307-311`.
**Problem:** the `Locked` entry in `visibilityOrder` and the `Hidden` fallback in `getSyncMergeResult`
are dead code — `duplicateRepository.get` applies `withDefaultVisibility` (Archive+Timeline only), so a
group/keeper can never be Hidden/Locked.

- [ ] **Fix:** remove the dead `Locked`/`Hidden` branches (or replace with an assertion/`never` that the
      keeper is always shareable). Keep it minimal. **Do NOT** do the optional "route visibility write
      through the shared transition helper" TOCTOU change unless it is trivial and clearly safe — it is
      out of scope for this cleanup; note it as a follow-up if skipped.
- [ ] **Test:** an existing duplicate.service.spec test still green; if a test asserted the dead branch,
      update it. Add a one-line assertion that the keeper is shareable if it clarifies intent.
- [ ] Commit: `refactor(spaces): remove dead Locked/Hidden branches in duplicate merge (R1 cleanup)`

---

## Definition of done

- M13 medium seam test added (proven to catch a disconnected emit). L19's four assertions tightened
  (each proven non-vacuous). R1 dead code removed. tsc + lint clean. Existing suites green. Commits
  pushed. Scope-clean (tests + the R1 cleanup only).
