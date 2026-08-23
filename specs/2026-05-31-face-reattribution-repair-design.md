# Face re-attribution repair job — design + implementation plan

**Status:** approved (brainstorm + review 2026-05-31); ready for implementation
**Branch / PR:** `worktree-hagen-face-cluster-corruption`, **stacked on PR #652** (the prevention guards).
**Prereq:** the #652 guards (merge chokepoint + backfill write point + engine-agnostic centroid) must be
**deployed** before the repair runs — re-homing relies on the guarded recognition path so it can't re-corrupt.

## Motivation

PR #652 stops _new_ face-cluster corruption but does not un-corrupt rows already wrong in the live DB:
automatic `mergeIdentities` (SharedSpace reconciliation/dedup) fused embedding-distinct people, and the
personal backfill propagated the bad identity link into `asset_face.personId`, so one person's faces show
under another. `face_search.embedding` is intact, so the corruption is recoverable. See
`specs/2026-05-30-hagen-face-cluster-corruption-diagnosis.md`.

### What Hagen's true-centroid numbers told us (drives the approach)

Per-person distance-to-own-centroid (true centroid via array decomposition, pgvecto.rs), sample 1000:

| person                   |  total | avg   | >0.5  | >0.7  | >0.9  | >1.1   |
| ------------------------ | -----: | ----- | ----- | ----- | ----- | ------ |
| Isabell (clean control)  |  1,555 | 0.238 | 4.4%  | 1.7%  | 1.0%  | 0      |
| Alexia (case A, small)   |    774 | 0.497 | 43%   | 3.7%  | 0.39% | 0      |
| Angelinde (case B, huge) | 26,412 | 0.345 | 15.3% | 2.1%  | 0.07% | 0      |
| Ina (worst, fused)       | 32,716 | 0.450 | 30%   | 12.6% | 2.6%  | 0      |
| Dieter (control, huge)   | 24,260 | 0.349 | 15.9% | 2.8%  | 0.19% | 0      |
| system-wide (407,425)    |      — | —     | 36.7% | 7.26% | 1.09% | 0.016% |

Conclusions:

1. Real scope is **small and concentrated**, not the 36.67% the rep-face proxy suggested.
2. There is a **~1% clean false-positive floor** at >0.9 (even a healthy cluster has ~1% genuinely-hard faces).
3. **`>1.1` is empty for every person** including the worst — wrong-_person_ faces sit ~0.5–0.7 from the
   centroid (the A↔B centroid distance was 0.58), i.e. in the _same band as normal intra-person variation_.
4. **Contaminated centroids self-sabotage** any "distance-from-own-centroid" detector (case A has the highest
   avg but only 29 faces >0.7; the blend hides the contamination). The originally-agreed peel-by-own-distance
   idea is therefore rejected — it misses exactly the worst clusters and false-positives clean hard faces.
5. **The instance is one extended family (the Falkners).** Re-attribution's danger zone is similar-but-distinct
   people, so the detector must guard against shuffling faces between lookalike relatives (see flag rule).

The detector is therefore **re-attribution**: flag a face only when it clearly belongs to a _different_
existing person, which is robust both to the FP floor (a hard clean face still belongs to its own person and
is flagged by no one) and to contaminated centroids (the wrong faces are close to their _true_ person, whose
cluster is usually large and intact — e.g. Karina-main 14k).

**Self-healing rationale (why unassign + re-recognize is safe):** a wrongly-unassigned _clean_ face re-homes to
its own person (it is closest to its own cluster), so a false positive costs compute + a transient blank, not a
permanent mis-assignment. That justifies biasing the detector toward recall — bounded by the precision guards
below so we don't churn the whole instance.

## Goals / non-goals

**Goals:** an admin-triggered, full-instance, name-preserving repair that detects machine-misassigned faces by
re-attribution, unassigns them, and lets the (guarded) recognition re-home them to the correct existing person.
Dry-run/report first.

**Non-goals:** re-clustering from scratch / losing names; touching human (`manual`) or `exif` assignments; the
space-side repair (`repairSpacePersonIdentityAssignments` — deferred, lower priority, can't write
`asset_face.personId`); auto-repairing a fully-fused blob with no clean external owner or a person past the
contamination cap (both reported, not guessed).

## Trigger — parameterized admin API

`POST /admin/face-repair` (admin-guarded; **not** registered on any cron/auto path):

| param                    | default            | meaning                                                                                                                         |
| ------------------------ | ------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `dryRun`                 | **`true`**         | must explicitly set `false` to mutate                                                                                           |
| `maxDistance`            | recognition config | cosine radius for the k-NN vote window (recognition's `maxDistance`)                                                            |
| `minFaces`               | recognition config | min same-person neighbors to count as a claim                                                                                   |
| `voteMargin`             | calibrated         | how many more neighbors a rival owner `Q` needs than `P`                                                                        |
| `maxAttributionDistance` | calibrated (≈0.35) | only re-home `F` onto `Q` if `Q`'s nearest face to `F` is within this **absolute** cosine distance (resemblance / family guard) |
| `maxFlaggedFraction`     | `0.5`              | if >this share of a person's eligible faces flag, route the person to review-only                                               |
| `ownerId` / `personId`   | none               | optional scope — trial-run one user/person to calibrate + estimate runtime                                                      |

Returns the report (below) in all modes; mutates only when `dryRun=false`. Params are validated (margins ≥ 0,
`maxDistance` in (0,2], `maxFlaggedFraction` in [0,1]); invalid input is rejected.

## Detector (approach A — k-NN re-attribution)

Eligibility for a candidate face `F` (assigned to person `P`, owner `O`):

- `asset_face.personId = P`, `asset_face.deletedAt IS NULL`, `asset_face.isVisible = true`, asset not deleted;
- **`asset_face.sourceType = 'machine-learning'`** — skip `manual` and `exif` faces (never override a human's
  or external metadata's assignment; also the only source the corruption touched);
- has a `face_search` embedding (no embedding ⇒ cannot assess ⇒ not flagged).
- **Note (H2):** non-Timeline faces (Archive, Hidden, Locked) are intentionally eligible. They may be left
  unassigned after repair if recognition cannot re-home them — blank is the accepted outcome. Restricting
  eligibility to Timeline assets would silently skip corrupted faces on archived photos.

For each eligible `F`:

1. Indexed k-NN over `face_search` (`embedding <=> F.embedding`) among the **same owner's** assigned faces within
   `maxDistance`, **excluding `F` itself**. Reuse `SearchRepository.searchFaces` (`search.repository.ts:901`) with
   `userIds=[O]`, `hasPerson: true`, and a **vote-window `numResults`** (200 by default; large enough to see the
   true owner even when contamination is large) so the tally sees the whole local neighborhood, not just the nearest
   few. pgvecto.rs-safe (indexed `<=>`, no `avg(vector)`); owner-scoped, so another owner's faces never vote.
   `searchFaces` includes the query face itself, so drop the row whose `assetFaceId = F`.
   **Note (C1):** the vote uses the same `searchFaces` neighbor scope as recognition (same visibility/deleted
   filters), so detection and re-home are consistent. Aligning voter visibility/deleted filters independently of
   recognition would require changing shared recognition behavior and is intentionally out of scope.
2. Tally neighbors by `personId`; the **dominant nearby owner** `Q` = the person with the **most** assigned
   neighbors of `F` within `maxDistance` and `≥ minFaces`; record each candidate's neighbor count and
   nearest-neighbor distance (for `P` and for `Q`).
3. **Flag `F` (suspected true owner `Q`) iff:**
   - a confident external `Q` exists: `Q ≠ P`, `Q` has `≥ minFaces` neighbors of `F`, **and** `Q`'s nearest face to
     `F` is within `maxAttributionDistance` (the **absolute resemblance / family guard** — only re-home `F` onto
     someone it genuinely looks like), **and**
   - `Q` outvotes `P` by `voteMargin` **or** `P` has `< minFaces` neighbors (P doesn't even claim `F`).
   - **Why an absolute floor, not a relative "Q closer than P" margin (decision-2 reversal):** a relative guard
     measured against `P`'s own nearest face backfires on the exact corruption we target — when many wrong faces are
     co-located on `P`, `P`'s nearest face to a leaked face is _another co-located leaked sibling_ at the same
     distance as the true owner, so the relative guard suppresses the flag. The floor is measured **to `Q`, never
     to the contaminated `P`**, so co-located mass contamination stays detectable. The **vote margin** is the family
     guard for genuine faces (a real face's own cluster out-votes locally); very-similar relatives _closer_ than the
     floor are protected by the per-person contamination cap (step 5) + dry-run review, not by this rule.
4. **Un-attributable heuristic (C2):** faces where `ownCount < minFaces` (P doesn't claim F) AND a close other
   person exists (`topOtherNearest <= maxAttributionDistance`) but that person is also below confidence
   (`topOtherCount < minFaces`) — close-but-unconfident. These are surfaced in `plan.unAttributableFaces` and
   counted in `report.totals.reviewOnlyByReason.unAttributable` for operator review. They are never
   unassigned/guessed — this is a heuristic surface (bimodality/fused-cluster detection remains out of scope).
   The fully-fused Ina case (no confident external `Q` at all) also lands here or in the not-flagged path.
5. **Per-person contamination cap:** after scoring a person, if `flagged / eligible > maxFlaggedFraction`, route
   the **entire person** to review-only (don't auto-mutate). Guards against silently dissolving a whole cluster
   (pure duplicate) or thrashing a badly-fused legit person (Ina); the operator decides those from the report.
6. **Don't re-home into a known-bad cluster:** if a flagged face's suspected owner `Q` is _itself_ review-only
   (over-cap or fused), route that face to review-only too — never unassign a face toward a cluster we won't
   vouch for.

> **Known limitation (near-total fusion):** the vote is a _local-majority_ test — a face only flags when its true
> owner out-votes its current person within the `voteWindow` neighborhood. So (a) contamination exceeding
> `voteWindow` can crowd the true owner out of the window (mitigated by the 200 default; raise it for pathological
> instances), and (b) if a person's cluster is _predominantly_ another person's faces (a near-total duplicate),
> the wrong faces out-number the true owner locally and never flag — and because they don't flag, the per-person
> cap (which keys on flagged fraction) doesn't catch them either. Such near-total-duplicate persons are a manual
> merge, not an auto-repair case; the repair targets _partial_ contamination of an otherwise-coherent person.

**Detection is a vote tally; recognition re-homes — and they are deliberately not identical.** Recognition's own
selection (`person.service.ts:966`) is **nearest-assigned-neighbor** (`matches.find(m => m.personId)`), which a
single co-located wrong-sibling can hijack — so a literal "what recognition would do" detector would under-detect
co-located contamination. The vote tally is more robust: B-main's many faces outvote the few wrong-siblings sitting
on `P`, so the _whole_ wrong subset is flagged. `Q` is therefore **predictive only** — it drives the report and
identifies which faces to unassign. The actual placement is made by recognition _after_ the **batch** unassign
(next section): once the entire wrong subset (incl. the co-located siblings) is removed, each face's nearest
assigned neighbor is its true cluster (e.g. Karina-main), so recognition's nearest-neighbor rule lands it correctly.
"Flagged as Q" thus means "unassigned; recognition expected to re-home to Q", not "written to Q".

Exact `voteMargin` / `distanceMargin` / `minFaces` / `maxFlaggedFraction` are **calibrated via the dry-run**
against the known cases: flag roughly case A/B's contamination, route Ina to review-only (cap), and **≈0 for clean
Isabell** and **≈0 cross-flagging between similar relatives** before any mutation.

## Repair action (only when `dryRun=false`)

1. For all confidently-flagged faces across the sweep (excluding review-only persons/faces): set
   `asset_face.personId = NULL` and delete the corrupt `face_identity_face` row — **batched across the whole run
   first**. The unassign UPDATE re-asserts eligibility in its `WHERE` (`personId = P`, ML source, visible) so a
   face changed by a concurrent job between detection and write is skipped, not blindly overwritten.
2. **Reconcile denormalized state** for every affected person: recompute `person.faceAssetId` (the representative
   face — it may have been one of the unassigned faces) and `person` face/asset counts. Space projections
   (`shared_space_person_face`, space counts) are refreshed by the existing SharedSpaceFaceMatch backfill that
   re-home triggers; space-side identity repair stays the deferred follow-up.
3. Re-home: re-queue **FacialRecognition** for the affected faces/assets. Recognition (personId now null → not
   short-circuited at `person.service.ts:941`) re-homes each via the guarded path; the #652 merge + backfill
   guards prevent re-corruption. Faces with `< minFaces` support stay unassigned (acceptable — blank > wrong).
4. **Post-condition invariant:** after re-homing, no face is left with `personId` set but its
   `face_identity_face` link absent or pointing at a different identity (the `personId IS DISTINCT FROM` identity
   mismatch that caused #652's infinite backfill loop). The repair must leave the DB in a state where
   `getBackfillWork()` reports no residual personal work.
5. Review-only (un-attributable / over-cap / bad-target) faces and persons are left untouched and listed.

> **Load-bearing verification (do first in implementation — finding #1):** confirm that (a) re-queued
> FacialRecognition actually **reprocesses pre-existing `personId=NULL` faces** (not only newly-detected ones —
> use whatever "process missing/all" mode does this), and (b) re-homing **rebuilds the `face_identity_face`
> link** to the new person so invariant #4 holds. If recognition does _not_ re-home pre-existing unassigned
> faces or does not rebuild the link, fall back to driving the per-face guarded recognition/assignment path
> directly (assign to `Q` through the deployed `filterFacesResemblingPerson(Q)` guard + `linkFace`) instead of a
> blanket re-queue. This decision is made by the Slice 4 test, not assumed.

## Dry-run report (always computed)

Per affected person `P`: `total` eligible faces, `flagged` count, `flaggedFraction`, suspected true owners `Q`
with per-owner counts, `reviewOnly` reason (un-attributable / over-cap / bad-target) + count. Aggregate totals
across the instance. This is the calibration surface — confirm it matches the known clusters, routes Ina to
review-only, and is ~empty for clean clusters / cross-family before mutating.

## Engine & scale

- pgvecto.rs-safe: indexed `<=>` k-NN, no `avg(vector)`; reuse `faceSetCentroidsByGroup` only if a centroid
  pre-filter is added to cut the k-NN workload.
- Chunked by owner/face; a full pass is ≈ a recognition pass (heavy, one-time). The `ownerId`/`personId` scope
  param lets the operator trial-run a subset to estimate full-instance runtime first. Chunking neither drops nor
  double-counts faces at chunk boundaries.
- **Concurrency:** the sweep mutates `asset_face` and re-queues recognition; running it while other face jobs
  (recognition, identity backfill, SharedSpace reconciliation) are active risks races. The endpoint refuses (or
  warns) if those queues are non-idle; the operator runs it during a quiet window.
- **Idempotent:** re-running after a real pass flags ~nothing new (re-homed faces are now correctly assigned;
  faces left blank have `personId=NULL` and are no longer "assigned to P").

## Safety & sequencing

- Lands after #652 is deployed (guards live).
- `dryRun` defaults true; mutation is explicit; params validated.
- `manual` + `exif` faces untouched.
- Per-person contamination cap + bad-target rule → review-only protects whole clusters / fused persons.
- Resemblance / family guard: the absolute `maxAttributionDistance` floor (distance to `Q`) plus the per-person
  contamination cap prevent shuffling faces between similar relatives.
- Owner-scoped — a face can only be re-attributed among the same owner's people.

## Implementation slices (TDD — write the failing test first, watch it fail, then implement)

All behavior tests are **medium** (real DB) on the vchord harness unless noted; SQL touching vectors also gets a
**pgvecto.rs engine-compat** test (per `feedback_pgvecto_rs_no_avg_vector`). Disjoint-axis embeddings model
distinct people; **near-axis** embeddings (small inter-cluster distance) model similar relatives.

1. **Detector core (repository).** k-NN re-attribution query returning `{assetFaceId, currentPersonId,
suspectedOwnerId, votes, distances}` for an owner scope. Tests: Karina-on-Alexia leak (disjoint axes) flags
   with `Q=Karina`; a clean cluster flags nothing; `manual`/`exif` faces skipped; **a face with no `face_search`
   row is not flagged**; **an isolated face (no neighbors in `maxDistance`) is not flagged**; **deleted /
   not-visible faces and faces on deleted assets are neither considered nor returned**; **a near neighbor owned
   by a different owner is ignored**; **pgvecto.rs engine-compat** for the new SQL.
2. **Flag rule.** Apply `voteMargin` + absolute `maxAttributionDistance` floor + `< minFaces` branch. Tests: both
   flag branches (`Q` outvotes `P`; `P` doesn't claim `F`); a vote tie / within-`voteMargin` rival does not flag;
   `Q`-not-confident (`< minFaces`) does not flag; **`maxAttributionDistance` floor boundary** (`Q` just inside vs
   just outside the floor); **co-located mass leak** — many co-located leaked faces ARE all flagged (the case the
   rejected relative guard hid); **floor family guard** — a similar cluster _beyond_ the floor does **not**
   cross-flag even when it out-votes.
3. **Review-only routing.** Tests: a fused blob with no external owner → review-only, not flagged; a person with
   `>maxFlaggedFraction` flagged → whole person review-only (not mutated), **plus the cap boundary** (exactly at
   vs just over); **a flagged face whose suspected `Q` is itself review-only → routed to review-only** (don't
   re-home into a bad cluster).
4. **Repair action + invariants.** Batch unassign (`personId=NULL`) + delete `face_identity_face`; reconcile
   `faceAssetId`/counts; re-home via recognition (or the fallback path per the load-bearing verification). Tests:
   unassign + link cleared; `faceAssetId`/counts reconciled **incl. the case where the rep face was unassigned**;
   after re-home, `getBackfillWork()` reports **no residual personal work / no personId↔identity mismatch** (the
   #652 no-loop regression); a sub-`minFaces` face stays unassigned; the leaked face re-homes to Karina and
   Karina stays named; **no re-corruption** (a re-homed face is not placed on the wrong person); **review-only
   persons/faces are NOT mutated** in a real run; **multi-owner contamination** (one person leaking two different
   people → faces split to the correct owners); **a flagged face that is in a shared space leaves no dangling
   `shared_space_person_face` / stale space count** after repair; **eligibility re-checked at write** (a face
   whose `personId` changed between detect and repair is skipped).
5. **Dry-run report.** Tests: `dryRun=true` mutates nothing; report shape + matches the flagged set;
   review-only reasons (un-attributable / over-cap / bad-target) counted; **an empty owner / empty instance
   yields an empty report with no error**.
6. **Service orchestration + chunking + scope.** Wire detector → review-only → repair → report; chunk by
   owner/face; honor `ownerId`/`personId` scope; refuse/warn if face queues are non-idle. Tests: scope restricts
   the sweep; **idempotency** (a second real run flags ~nothing new); **refuses/warns when recognition / identity
   backfill / reconciliation queues are non-idle**; **a chunk boundary neither drops nor double-counts faces**.
7. **Admin API endpoint.** `POST /admin/face-repair`. Tests: non-admin rejected; `dryRun` defaults true; params
   parsed; **invalid params rejected** (negative/zero margins, `maxFlaggedFraction` outside [0,1],
   `maxDistance` outside (0,2]); returns the report; OpenAPI/SDK regenerated.
8. **End-to-end medium.** Synthetic contaminated instance: leak re-homes correctly; similar relatives preserved;
   fused blob + over-cap person review-only; dry-run then real run; idempotent re-run. Confirms the whole flow.

## Test & edge-case coverage matrix

| Behavior / edge case                                                                              | Slice |
| ------------------------------------------------------------------------------------------------- | ----- |
| Leak (wrong-person face) flagged with true owner `Q`                                              | 1, 8  |
| Clean cluster flags nothing (the ~1% FP floor)                                                    | 1     |
| `manual` / `exif` faces skipped                                                                   | 1     |
| Face with no embedding → not flagged                                                              | 1     |
| Isolated face (no neighbors in range) → not flagged                                               | 1     |
| Deleted / not-visible / deleted-asset faces excluded                                              | 1     |
| Cross-owner neighbor ignored (owner-scoped)                                                       | 1     |
| pgvecto.rs engine-compat for new vector SQL                                                       | 1     |
| `voteMargin` branch + `P`-doesn't-claim branch                                                    | 2     |
| Vote tie / within-margin rival → not flagged                                                      | 2     |
| `Q`-not-confident (`< minFaces`) → not flagged                                                    | 2     |
| `maxAttributionDistance` floor boundary (in vs out)                                               | 2     |
| Co-located mass leak → all flagged (rejected-guard regression)                                    | 2     |
| Similar cluster beyond the floor → no cross-flag                                                  | 2, 8  |
| Very-similar cluster within floor → cap protects                                                  | 3     |
| Un-attributable (no `Q`) → review-only                                                            | 3, 8  |
| Per-person cap → whole person review-only (+ boundary)                                            | 3, 8  |
| Suspected `Q` itself review-only → face review-only                                               | 3     |
| Batch unassign + `face_identity_face` link cleared                                                | 4     |
| `faceAssetId` reconciled (incl. rep face unassigned — no stored counts, computed on read)         | 4     |
| No-loop / no `personId`↔identity mismatch (getBackfillWork)                                       | 4     |
| Sub-`minFaces` face stays unassigned                                                              | 4     |
| Leaked face re-homes to true owner; name preserved                                                | 4, 8  |
| No re-corruption (re-home not placed on wrong person)                                             | 4, 8  |
| Review-only persons/faces untouched in a real run                                                 | 4, 8  |
| Multi-owner contamination → faces split to correct owners                                         | 4, 8  |
| Eligibility re-checked at write (concurrent change skipped)                                       | 4     |
| `dryRun=true` mutates nothing                                                                     | 5, 8  |
| Report shape + matches flagged set + review-only reasons                                          | 5     |
| Empty owner / empty instance → empty report, no error                                             | 5     |
| Scope (`ownerId`/`personId`) restricts the sweep                                                  | 6     |
| Idempotency (second real run flags ~nothing)                                                      | 6, 8  |
| Refuse/warn when face queues non-idle                                                             | 6     |
| Streaming (`.stream()` cursor) covers every eligible face exactly once (no pagination boundaries) | 6     |
| Endpoint admin-guard (non-admin rejected)                                                         | 7     |
| `dryRun` default true at the endpoint                                                             | 7     |
| Param parsing + invalid-param rejection                                                           | 7     |
| OpenAPI/SDK regenerated                                                                           | 7     |
| Full dry-run→real→idempotent flow end-to-end                                                      | 8     |

## Open / to calibrate

- Concrete `voteMargin` / `maxAttributionDistance` / `minFaces` / `maxFlaggedFraction` values — set defaults, then
  tune via dry-run on Hagen's clusters (flag A/B, route Ina to review-only, ~0 on clean + cross-family).
- Whether to add the centroid pre-filter (compute vs recall trade-off) — default off; revisit if the full k-NN
  pass is too slow on Hagen's box.
- The Slice 4 load-bearing verification decides re-queue-recognition vs direct guarded reassignment.
