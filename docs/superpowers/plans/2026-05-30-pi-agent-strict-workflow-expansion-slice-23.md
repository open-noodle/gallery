# Workflow Expansion — Slice 23: Group 3 manifest, capability regen & eval

> Integration slice. Registers `create_album_from_source`, regenerates the manifest
> mirror + capability matrix, and adds L1 + L3 scenarios (incl. trip/add
> disambiguation).

**Goal:** `create_album_from_source` routable (regex + LLM) and in the matrix, with
L1 + L3 coverage; trip + add-to-existing still route to their own workflows.

**Spec scope:** Slice 23 (closes Phase 3). **Depends on:** Slices 21-22.

## 1. Registry (`registry.mjs`)

Insert `createAlbumFromSourceWorkflow` AFTER `createRecentTripAlbumWorkflow` (trip
owns "album for recent trip"; create_album declines trip sources anyway):

```
[ createRecentTripAlbumWorkflow,
  createAlbumFromSourceWorkflow,
  renameOrDescribeSpaceWorkflow,
  renameOrDescribeAlbumWorkflow,
  archiveAssetsWorkflow, favoriteAssetsWorkflow, tagAssetsWorkflow,
  manageSpaceMembersWorkflow, changeMemberRoleWorkflow,
  addPhotosToAlbumWorkflow ]
```

create_album matches "make/create album of/from <source>" — a distinct verb from
add_photos ("add <source> to <album>") and trip ("album for recent trip", declined).

## 2. Manifest entry (`manifest.mjs`)

```
kind: 'create_album_from_source', flow: 'hybrid', title: 'Create album from a source'
classifierDescription: 'User wants a NEW album built from a metadata-describable set of photos (recency/date/type), not a recent trip.'
positiveExamples: ['Make an album of my newest 50 photos', 'Create an album from my 2024 photos called Best of 2024', 'Build an album of my newest 100 photos']
negativeExamples: ['Create an album for my recent trip to USA', 'Add my newest 20 photos to Family', 'Make an album of the best photos']
slots: { sourceDescription:{string,required,'Metadata description of the photos.'}, albumName:{string,optional,'Album name (defaults to New Album).'} }
requiredReadTools: ['searchAssets']
planTool: 'proposeAlbumFromSelection'
supportsContinuation: false
matrixRow: { 'Create album from a source', 'Solid now', 'Pi resolves a recency/date/type source; Gallery owns album creation from the handle.' }
```

## 3. Regen mirror + matrix doc

```
node src/bin/sync-strict-workflow-manifest.mjs
cd ../server && node --experimental-strip-types src/bin/sync-agent-capabilities.ts && node --experimental-strip-types src/bin/sync-agent-capabilities.ts --check
```

Prettier-check the matrix doc.

## 4. L1 scenarios

**Recall** (`classification-recall.mjs`):

- `recall.createalbum.canonical`: 'make an album of my newest 50 photos' → `create_album_from_source`, `{ sourceDescription:/newest 50 photos/i }`.
- `recall.createalbum.named`: 'create an album from my 2024 photos called Best of 2024' → `create_album_from_source`, `{ albumName:/best of 2024/i }`.
- `recall.createalbum.llm`: 'put my newest 50 photos into a brand new album' → `create_album_from_source`, slotsSurvive.
- `recall.createalbum.trip-disambig`: 'create an album for my recent trip to USA' → `create_recent_trip_album` (NOT create_album_from_source).
- `recall.createalbum.add-disambig`: 'add my newest 20 photos to Family' → `add_photos_to_album` (NOT create_album_from_source).

**Slot fidelity** (`slot-fidelity.mjs`):

- `slots.createalbum.default-name`: 'make an album of my newest 50 photos' → `create_album_from_source`, `{ albumName:'New Album' }`.

**Negatives** (`classification-negatives.mjs`):

- `neg.createalbum.subjective`: 'make an album of the best photos from last year' → `none`.

## 5. L3 scenarios (`l3-readonly.mjs`)

- `l3.recall.createalbum`: 'make an album of my newest 20 photos called eval-l3' → `create_album_from_source`.
- `l3.plan.createalbum`: 'make an album of my newest 20 photos called eval-l3' → `{ create_album_from_source, planProposed: true }`, threshold 0.5.

## 6. Verify

```
node --test 'agent-runner/src/**/*.test.mjs'                       # unit (mirror parity)
cd agent-runner && node --env-file-if-exists=.env eval/run.mjs --diff   # L1
# then the combined Group 2+3 L3 run (separate step), --accept both baselines
```

- Unit green; L1 new scenarios pass + trip/add disambiguation holds; 0 regressions; `--accept`.
- matrix `--check` exits 0; matrix doc prettier-clean.
- L3 (combined run): create_album routes + proposes a never-applied recency plan;
  audits clean; re-seed `baseline.l3.json`.

## Edge cases covered

- create_album vs trip vs add disambiguation (regex + LLM); default vs explicit name.

## Commit

`feat: register + manifest create_album_from_source; L1 + L3 scenarios + matrix regen (slice 23)`
