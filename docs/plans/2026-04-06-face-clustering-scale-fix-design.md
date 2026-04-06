# Fix Face Clustering at Scale

**Date**: 2026-04-06
**Branch**: `fix/face-clustering-parameter-limit`
**Issue**: Faces detected but not assigned to persons at scale (~375k faces, ~13.5k persons)

## Problem

A user with two libraries (~177k and ~197k detected faces) reports that face clustering
assigns persons to 67% of Library 1 faces but only 3% of Library 2 faces. The remaining
191k faces have valid embeddings, are visible, and are marked as processed — the system
silently treats them as clustered when they are not.

The timeline shows degradation correlated with volume:

| Date  | Faces created | Assigned | Rate |
| ----- | ------------- | -------- | ---- |
| Apr 1 | 142,841       | 5,911    | 4.1% |
| Apr 2 | 46,556        | 55       | 0.1% |
| Apr 3 | 8,239         | 0        | 0%   |
| Apr 4 | 6             | 6        | 100% |

Re-running facial recognition does not help. No errors in server logs.

## Root Cause

The vectorchord IVF index on `face_search` is only rebuilt on server startup
(`reindexVectorsIfNeeded` in `database.service.ts`). When a large library scan adds
hundreds of thousands of new face embeddings between restarts, the index configuration
becomes stale:

1. Server starts with ~177k faces -> index built with `lists=256`, `probes=32`
2. Library 2 scan adds 197k faces -> total 375k, should be `lists=512`, `probes=64`
3. New faces are assigned to centroids calculated for the old data distribution
4. Recognition runs: vector search probes 32 partitions out of 256, but Library 2 faces
   are scattered across wrong partitions due to stale centroids
5. Search misses true nearest neighbors -> faces can't form core clusters -> no persons
   created -> deferred faces can't find existing persons -> left unassigned
6. Job returns `Success` with no logging -> silent failure

This is an **upstream Immich issue** — the face recognition code has no Gallery-specific
modifications.

## Changes

### 1. Reindex before recognition (primary fix)

**File**: `server/src/services/person.service.ts`

In `handleQueueRecognizeFaces`, add `reindexVectorsIfNeeded([VectorIndex.Face])` after
`waitForQueueCompletion` and before `prewarm`. This ensures the index configuration
matches the current face count before any recognition jobs run.

The method is already battle-tested (called on every server startup). It checks the
current `lists` value against `targetListCount(rowCount)` and only rebuilds if they
differ (accounting for a 1.2x slack factor to avoid churn at boundaries). When the index
is already correct, this is a no-op (milliseconds).

### 2. Shared-space repository chunking (defensive)

**File**: `server/src/repositories/shared-space.repository.ts`

Add `@Chunked()` to methods that pass arrays to `WHERE IN` without size protection:

- `recountPersons(personIds)` — `@Chunked()` (paramIndex 0)
- `removeAssets(spaceId, assetIds)` — `@Chunked({ paramIndex: 1 })`

Skipped methods:

- `removePersonFacesByAssetIds` — runs three dependent queries per call; chunking with
  `Promise.all` causes a race condition on intermediate recounts. Input sizes are
  realistically small (user-selected assets).
- `findSpacePersonsByLinkedPersonIds` — only called with 1-10 person IDs from single
  asset face lookups. YAGNI.

### 3. Diagnostic logging

**File**: `server/src/services/person.service.ts`

Add a debug log in `handleRecognizeFaces` when a face finishes processing without being
assigned to a person. Currently the job returns `Success` silently — this makes the
failure mode visible in logs.

### 4. Unit test

**File**: `server/src/services/person.service.spec.ts`

Test that `handleQueueRecognizeFaces` calls `reindexVectorsIfNeeded([VectorIndex.Face])`
before `prewarm`.

## What does not change

- Face recognition algorithm (upstream code)
- Vector search query (`searchFaces`)
- Clustering parameters (`minFaces`, `maxDistance`)
- Face detection pipeline
- API endpoints or DTOs (no OpenAPI regen)
- Database schema (no migration)

## Uncertainty

The stale vector index is the most likely root cause, but I cannot be 100% certain
without running diagnostics on the actual database. If the user's server restart
(which triggers `reindexVectorsIfNeeded` on startup) resolves the issue, that confirms
the theory. If not, the diagnostic logging from Change 3 will help identify the actual
cause.

Regardless, Change 1 is the right fix — the index should always be checked before
recognition runs, not only on server startup.
