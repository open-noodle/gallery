# Hagen face-cluster data corruption — diagnosis

**Reporter:** Hagen Meischner (fotos.meischner.info, v4.56.7, 563k assets, 3 spaces)
**Symptom:** On 2026-05-25 ~10:02 UTC, during the SharedSpace job flood, an automated process
overwrote `asset_face.personId` for a population of faces, assigning Karina's faces to Alejandra's
personal person `f0ef121e`. `face_search.embedding` is intact and still proves the faces are Karina
(0.80 sim to Karina, −0.085 to Alejandra). ~211 of Alejandra's 774 faces exceed minScore against
Karina; the contamination is broad, not a one-off.

Status: **FIXED (prevent-recurrence) — two layers: an embedding-consistency guard at the merge
chokepoint, and a per-face embedding guard at the backfill write point (`asset_face.personId`).**
A second report (Case 2) confirmed the same systematic bug; see the Case 2 section. Data repair of the
already-corrupted rows is a separate follow-up (see below).

## Root cause (confirmed)

A SharedSpace merge unified two **genuinely different people's identities**, and the personal
identity backfill then propagated that corrupted identity link into `asset_face.personId`.

### The write to `asset_face.personId`

`mergeIdentities` (`face-identity.repository.ts:2459`) never touches `asset_face.personId` — it only
rewrites `face_identity_face.identityId`, `person.identityId`, `shared_space_person.identityId`. The
`asset_face.personId` mutation comes from `repairPersonalIdentityAssignments`
(`face-identity.repository.ts:2151-2181`), which moves every face of a person to whichever **other
personal person owns the identity the face's `face_identity_face` row now points to**:

```
UPDATE asset_face SET personId = <targetPerson> WHERE personId = <person> AND id IN (<facesForIdentity>)
```

The identity layer is treated as source-of-truth. Corrupt the identity link and the repair faithfully
drags `asset_face.personId` along. So the real corruption is upstream, at the identity merge.

### The bad merge — two trigger sites, one defect class

**Trigger A — `handleSharedSpacePersonDedup` (`shared-space.service.ts:1704-1875`)**, dominant by job
volume during the 2026-05-25 flood:

1. Per space person it calls `findClosestSpacePerson(spaceId, person.embedding, {maxDistance, numResults:2})`
   (line 1758). `person.embedding` is the embedding of a **single representative face** — see
   `getSpacePersonsWithEmbeddings` (`shared-space.repository.ts:1934`), which joins
   `shared_space_person.representativeFaceId` only. Not a centroid.
2. `findClosestSpacePerson` (`shared-space.repository.ts:1898`) returns the closest **individual face**
   of other space persons (`face_search.embedding <=> ${embedding}`, `distance <= maxDistance`).
3. The only guard is `compatibleMatches.length === 1` (line 1784) — "merge if exactly one match within
   maxDistance." `maxDistance` defaults to `0.5` (`config.ts:296`).
4. On match: `reassignPersonFacesSafe(source, target)` moves **all** of source's faces (survivor =
   more faces, line 1791), then `mergeIdentitiesForSpacePersonEvidence` (line 1806) merges the backing
   identities, picking the **majority-face-count** identity as survivor (`shared-space.service.ts:2310-2316`)
   and merging the rest into it via `mergeIdentities`.

Hagen's query 3c proves the failure precondition: **336 of Alejandra's 774 faces sit within 0.5
distance of Karina.** The two real clusters overlap heavily, so one representative face is easily
within `maxDistance` of a single face in the other cluster → spurious wholesale merge. The
"exactly one match" guard only catches three-way ambiguity; it gives false confidence on two
overlapping clusters.

**Trigger B — `findStrictSpacePersonLocalIdentityClaim` / `applySharedSpaceIdentityReconciliationClaim`
(`shared-space.service.ts:1407-1504`)**: same shape — keys off the space person's single
representative `embedding`, searches local faces within `maxDistance`, same weak `candidates.length
!== 1` guard, same cascade into `mergeIdentities`. Recurs every 6h library scan.

**Which trigger actually corrupted the data — reconciliation (Trigger B), confirmed end-to-end.**
Trigger A is largely _self-limited_: `handleSharedSpacePersonDedup` deletes the source space person only
**after** `mergeIdentitiesForSpacePersonEvidence` (delete at :1844, merge at :1806), so at the
`mergeIdentities` call both space persons still exist and `countMergeConflicts`' same-space check blocks
any cross-identity fusion. Dedup therefore mostly merges _same-identity_ duplicate space persons.
Trigger B merges a member's **local** identity into the space person's identity; that source local
identity usually has no space person in the space, so the conflict check passes and the merge proceeds —
exactly how a contaminated representative face fuses two different people. The medium test
`reconciliation does not fuse a member identity into an embedding-distinct space identity`
(`people-identity-rbac.spec.ts`) reproduces this end-to-end and fails without the guard. The guard sits
at the shared `mergeIdentities` chokepoint and covers both triggers regardless of which fired.

### Why Karina's main cluster survived but the duplicate did not

`mergeIdentities` runs `countMergeConflicts` (`face-identity.repository.ts:2559`) and **returns early
without merging** if any source person (personal or space) would collide with the target identity for
the same owner/space. That guard protects Karina's **named main** person (it holds its own identity for
owner Hagen, so merging it into Alejandra conflicts → blocked). But a **duplicate/secondary Karina
identity** — backing the ~211 ambiguous faces, with no competing named personal person for the same
owner — has no such protection. It was silently absorbed into Alejandra (majority), and the backfill
moved those 211 faces' `asset_face.personId` onto `f0ef121e`. This exactly matches the survivor
direction (Alejandra 563 > Karina-dup 211) and the "main person untouched, duplicate absorbed" outcome.

## Defect summary

1. **Single-representative-face merge decision.** Both dedup and reconciliation decide a wholesale,
   irreversible merge from one representative face vs one neighbour face — no cluster-level agreement.
2. **`maxDistance` reused for merging.** Dedup/reconciliation use the detection threshold (0.5) for an
   irreversible global identity unification. The wrongly-merged faces are ~0.711 distance (0.289 sim)
   from the target on aggregate — a strict dedup band would never have merged them.
3. **No embedding-consistency guard on the identity-merge cascade.** `mergeIdentities` /
   `mergeIdentitiesForSpacePersonEvidence` never check that the two identities' aggregate embeddings
   actually agree before unifying them globally.
4. **`countMergeConflicts` protects only named main persons.** Duplicate/secondary identities backing
   a substantial, embedding-distinct face population are absorbed silently instead of being refused or
   flagged.

## What was implemented

**Embedding-consistency guard at the merge chokepoint** (`face-identity.repository.ts`,
`mergeIdentities`). For automatic merges only (`source === 'shared-space-evidence'` — the dedup,
reconciliation, and evidence-merge paths), before unifying identities we compare each source
identity's bounded-sample embedding **centroid** against the target centroid (`avg(embedding) <=>
avg(embedding)` over `face_identity_face ⋈ face_search`). Any source whose centroid is farther than
`MERGE_IDENTITY_MAX_CENTROID_DISTANCE = 0.5` is dropped from the merge; if all sources are dropped the
merge is a no-op. Manual merges (`source === 'manual'`) bypass the guard — a human overrides.

This is the universal sink for every automatic SharedSpace merge (dedup → `mergeIdentitiesForSpacePersonEvidence`,
reconciliation → `applySharedSpaceIdentityReconciliationClaim`), so one guard covers all trigger sites.
Refusing the identity merge keeps `face_identity_face` pointed at the real source identity, so the
personal backfill repair never drags `asset_face.personId` onto the wrong person — the reported
corruption. Identities with no embedded faces are treated as consistent (cannot assess → do not block).

Tests (medium, real DB):

- `face-identity.repository.spec.ts` (repository chokepoint): refuses an embedding-distinct automatic
  merge; still performs an embedding-consistent one; manual merges bypass the guard; **mixed-source call
  merges only the consistent source and leaves the distinct one** (per-source filtering, not
  all-or-nothing); a source with no embedded faces is allowed (cannot assess); a target with no embedded
  faces is allowed (cannot assess).
- `people-identity-rbac.spec.ts` (end-to-end): drives the real `handleSharedSpaceIdentityReconciliation`
  with a contaminated representative face and asserts the member's distinct identity is **not** fused
  into the space identity. Verified to fail when the guard is disabled (true reproduction).

Full server unit suite (4480), the face-identity medium spec (89), the people-identity-rbac medium spec
(67), and the shared-space face-matching medium spec (33) stay green; tsc + eslint clean.

Threshold rationale: the wrongly-fused clusters were ~0.71 centroid distance apart (Hagen 3b: 0.289
avg similarity), so 0.5 blocks them with margin while leaving same-person duplicate dedup (centroid
distance typically < 0.4) untouched. Tunable.

## Case 2 — second report (same systematic bug) + write-point guard

Hagen reported a second instance (Person A's page shows Person B; A↔B avg cross-similarity 0.419; 93%
of A's 5,835-face cluster re-`updatedAt`'d on 2026-05-25; whole assets re-written in one-second
windows; faces at 0.9999 similarity to B sitting on A). Investigation confirmed **the same root**:

- The only automatic writer that can overwrite an **already-assigned** face's `asset_face.personId` is
  `repairPersonalIdentityAssignments` (personal backfill). Facial recognition cannot: `handleRecognizeFaces`
  short-circuits when `face.personId` is already set (`person.service.ts:941`) and never rewrites it.
- `repairPersonalIdentityAssignments` moves faces **purely by their `face_identity_face.identityId`** with
  no embedding check, and that link only becomes wrong via a bad automatic `mergeIdentities` — i.e. the
  Case-1 chokepoint. So Case 2 is the same bug, amplified by Person B's huge (26k-face) cluster.

The chokepoint guard already refuses the dominant seeding path (reconciliation merges a member's **whole**
identity; B's whole-cluster centroid is `1 − 0.419 = 0.58 > 0.5`). But Case 2 exposed two residual gaps:
(a) the **write point itself is unguarded** — any wrong link, including one already corrupt in the live
DB, is faithfully written into `asset_face.personId`; (b) a tight "bridge" sub-cluster (B faces near A)
could pass the centroid guard, then backfill scatters it and the cascade amplifies.

**Second fix — per-face guard at the write point** (`repairPersonalIdentityAssignments` via new private
`filterFacesResemblingPerson`). Before moving candidate faces to `targetPerson`, drop any whose embedding
is farther than `REPAIR_FACE_MAX_PERSON_DISTANCE = 0.5` from the target person's existing-cluster
centroid; dropped faces stay put. Faces with no embedding, or a target with no embedded faces, are kept
(cannot assess → do not block legitimate consolidation). This enforces the invariant both cases violate
— `asset_face.personId` must be embedding-consistent — at the exact line the corruption is written,
independent of how the identity link became wrong, and contains links already corrupt in Hagen's DB.

**Loop-safety (critical):** a refused face keeps its current person but its `face_identity_face` link
still pointed elsewhere — a permanent `person.identityId IS DISTINCT FROM face_identity_face.identityId`
mismatch. `getBackfillWork()` (`face-identity.repository.ts:428-439`) reports that as outstanding work,
and `handleFaceIdentityBackfill` (`person.service.ts:552-559`) re-queues itself (toggling an `a`/`b`
continuation id to dodge job dedup) until there is no work — so an un-resolved refusal is an **infinite
backfill loop**. The guard therefore **realigns** each refused face's identity link to the person it
stays on (`realignFacesToPersonIdentity`): trust the embedding-consistent `personId` over the corrupt
identity link, which fully resolves the mismatch.

Tests (medium, real DB) in `face-identity.repository.spec.ts`: a face that does **not** resemble the
target is left on its current person, its identity link realigned, and **`getBackfillWork()` reports no
residual personal work** (this assertion fails without the realign — it pins the no-loop invariant); a
face that **does** resemble the target still moves (legitimate consolidation preserved); a single group
mixing both moves only the resembling face and realigns the rest. Full unit suite (4480) + all
face-identity / people-identity-rbac / shared-space-face-identity-repair / metadata medium specs green.

### Residual-coverage tests (added after a "is coverage full?" pass)

- **Job-level no-loop** (`people-identity-rbac.spec.ts`): drives the real `handleFaceIdentityBackfill`
  with a refused face and asserts it queues **no** `FaceIdentityBackfill` continuation. Verified to fail
  (a continuation _is_ queued) when the realign is disabled — i.e. it directly catches the loop, not just
  the `getBackfillWork()` invariant.
- **Threshold boundary** (both guards): using `blendedEmbedding`, a source/face at centroid distance
  ~0.453 is merged/moved while one at ~0.547 is refused — pinning the cutoff to ≈0.5 (a change to 0.3 or
  0.7 would fail these).
- **Contaminated-centroid limitation (documented, not silent):** once a person's cluster is 50/50
  contaminated, a pure other-person face sits only ~0.29 from the mixed centroid and is **not** blocked.
  The guard is strongest at first contamination (clean target) and weaker mid-cascade — the merge-chokepoint
  guard is the primary defense against seeding; this write-point guard is the safety net.

## Remaining: data repair (separate follow-up)

## Recommended remediation (not yet implemented)

**Code (prevent recurrence) — pick the chokepoint:**

- **(High leverage, low risk) Embedding-consistency guard at the merge chokepoint.** Before any
  `mergeIdentities` driven by automatic SharedSpace evidence, verify the two identities' aggregate
  (centroid or mutual k-NN majority) embeddings agree within a **strict** threshold; refuse otherwise.
  Protects all callers at once.
- **Require cluster agreement, not a single rep face**, in dedup/reconciliation (e.g. a majority of A's
  faces within threshold of B), and/or a **dedicated strict `dedupMaxDistance`** distinct from
  detection's 0.5.
- **Don't silently absorb embedding-distinct secondary identities** — refuse/flag for review.

**Data (repair existing corruption):** `face_search.embedding` is intact, so corruption is
recoverable. Identify affected faces by `asset_face.personId` ↔ embedding disagreement (face closer to
a different person's cluster by a margin) and reassign. **The code fix must land first / together** —
the reconciliation defect recurs every 6h and will re-corrupt any manual repair.

## Open verification items

- Confirm against prod logs which trigger (dedup vs reconciliation) actually fired at 10:02 UTC
  (`Dedup: merging person …` log at `shared-space.service.ts:1794`).
- Confirm the exact `machineLearning.facialRecognition.maxDistance` configured on Hagen's instance
  (default 0.5; report references minScore 0.6 which is a separate detection knob).
