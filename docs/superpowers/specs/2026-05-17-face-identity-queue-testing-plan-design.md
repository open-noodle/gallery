# Face Identity Queue Testing Plan Design

Date: 2026-05-17

## Context

Gallery has several independent paths that create, remove, reassign, or project face data. A bug in any one of these paths can be destructive: named people can be deleted, manual or EXIF faces can be overwritten, shared-space people can be wiped, identity links can merge incorrectly, and queued work can run after the data it was built for has changed.

The face pipeline is not one queue. It spans:

- `QueueName.FaceDetection`: `AssetDetectFacesQueueAll`, `AssetDetectFaces`
- `QueueName.FacialRecognition`: `FacialRecognitionQueueAll`, `FacialRecognition`, shared-space face matching, shared-space identity reconciliation, shared-space person deduplication
- `QueueName.PeopleBackfill`: `FaceIdentityBackfill`, `SharedSpaceFaceMatchFromBackfill`, `SharedSpacePersonMetadataBackfill`
- `QueueName.ThumbnailGeneration`: `PersonGenerateThumbnail`
- `QueueName.BackgroundTask`: `PersonCleanup`, `SharedSpaceBulkAddAssets`

The triggering surface is broad. Upload thumbnail completion, manual asset refresh, admin queue starts, nightly jobs, metadata face imports, linked-library sync, shared-space membership changes, duplicate resolution, pet detection, manual face edits, people merge/delete/reassign operations, and identity backfill can all touch the same people and face identity state.

## Production Regression Focus

Issue #597 reports an overnight state transition where Facial Recognition was stuck with about 87,000 waiting jobs, then by morning had about 274,000 waiting jobs and all Shared Space persons were empty while 359,274 faces still existed. The reported setup had EXIF face import enabled, ML facial recognition enabled, and no user interaction between the evening and morning observations.

This plan treats that as a first-class regression scenario. The relevant scheduled entry points are:

- nightly tasks at `nightlyTasks.startTime`, default `00:00`
- external library scan cron, default every day at midnight

The destructive shared-space wipe is not itself a scheduled branch. In the current code it is only in forced `FacialRecognitionQueueAll` handling. The scheduled nightly recognition job is `force=false` and `nightly=true`, so the tests must prove it never reaches the forced wipe path when a large or stuck Facial Recognition queue already exists.

Regression coverage must prove:

- scheduled `clusterNewFaces` queues only non-force `FacialRecognitionQueueAll`
- a non-force nightly coordinator with waiting, delayed, paused, or active recognition work skips before `unassignFaces`, `unlinkFacesBySourceType`, `deleteAllPersonFaces`, or `deleteAllPersons`
- recovered or retried non-force queue coordinators do not expand the queue with duplicate full-recognition fan-out while old work is still waiting
- an already-pending force-recognition follow-up is the only path allowed to clear `shared_space_person` state, and it must queue the full shared-space rebuild before maintenance/backfill
- library scans and EXIF face imports running on the same overnight window may add or repair projection work, but must not empty existing shared-space people without the forced recognition path

## Goals

- Build an extremely thorough test plan before implementation.
- Test every known path that queues face detection, face recognition, identity backfill, shared-space face matching, shared-space metadata backfill, person cleanup, or person thumbnail generation.
- Test manually triggered jobs when users already have populated data: named people, hidden people, manual faces, EXIF faces, pet faces, linked libraries, shared spaces, merged identities, and pending jobs.
- Pin destructive invariants so future queue changes cannot silently delete or corrupt user-managed people state.
- Break the implementation into independent slices that can be assigned, reviewed, and merged separately.
- Prefer deterministic service and medium database tests over real ML, real filesystem scans, or browser tests.
- Keep each test focused on one behavior and one failure mode.

## Non-Goals

- Do not change queue behavior as part of this spec.
- Do not add real ML inference tests.
- Do not add slow full-stack UI tests for the queue graph.
- Do not rework face clustering, identity merge rules, or shared-space access semantics.
- Do not rely on production Redis state or real background workers for correctness assertions.

## Current Coverage Snapshot

The current suite already has substantial coverage:

- Server small suite baseline passes with 4,388 tests and 9 skipped tests.
- `person.service.spec.ts` covers detection queueing, force recognition reset ordering, per-face recognition branches, maintenance marker behavior, face identity backfill pagination, pending targets, and metadata fallback.
- `shared-space.service.spec.ts` covers face-recognition toggle fan-out, asset-level face matching, identity-backed and legacy space person creation, pet faces, full-space paging, library face sync, dedup, and metadata inheritance.
- `job.repository.spec.ts` covers stable job ids, facial-recognition force replacement, shared-space face-match job ids, and paused stable job replacement.
- `queue.service.spec.ts` covers manual queue starts and nightly queueing.
- Medium specs cover many real database identity, shared-space, RBAC, linked-library, and backfill invariants.

The missing work is not "add first tests." The missing work is a deliberate matrix that proves all trigger paths compose safely and that destructive manual or forced reruns preserve the right data while intentionally removing only the right data.

## Testing Approach

Use three layers.

### Layer 1: Service Contract Tests

Use existing small service specs to assert queue decisions, branch behavior, and call ordering. These tests should not need Postgres, Redis, real ML, or real files.

Examples:

- `server/src/services/person.service.spec.ts`
- `server/src/services/shared-space.service.spec.ts`
- `server/src/services/job.service.spec.ts`
- `server/src/services/queue.service.spec.ts`
- `server/src/repositories/job.repository.spec.ts`
- `server/src/services/asset.service.spec.ts`
- `server/src/services/library.service.spec.ts`
- `server/src/services/metadata.service.spec.ts`
- `server/src/services/duplicate.service.spec.ts`
- `server/src/services/pet-detection.service.spec.ts`

### Layer 2: Medium Database Tests

Use medium tests when correctness depends on SQL constraints, cascades, identity projection, statistics, visibility scope, or destructive writes. These tests should use real repositories and compact fixtures.

Examples:

- `server/test/medium/specs/services/person.service.spec.ts`
- `server/test/medium/specs/services/people-identity-rbac.spec.ts`
- `server/test/medium/specs/services/shared-space-face-identity-repair.spec.ts`
- `server/test/medium/specs/repositories/face-identity.repository.spec.ts`
- `server/test/medium/specs/repositories/person.repository.spec.ts`
- `server/test/medium/specs/repositories/shared-space-face-matching.spec.ts`

### Layer 3: End-to-End Queue-Chain Simulations

Add a small number of medium tests that invoke service handlers in queue order with mocked ML and mocked queue repository calls. These are not full worker tests. They prove that the final database state is correct after a realistic chain.

Examples:

- upload thumbnail completion queues face detection, then detection creates faces, then recognition assigns people, then shared-space matching materializes space people
- force face recognition with populated personal and shared-space data clears only ML-derived state, rebuilds personal people, rebuilds shared-space projections, and leaves manual/EXIF data in the expected state
- identity backfill repairs identities, queues targeted shared-space rematches, and metadata backfill runs only after projection state is safe

## Destructive Invariants

Every slice must include tests for these invariants where relevant.

- Manual faces are never deleted by ML face detection refresh unless the explicit operation targets them.
- EXIF/imported faces are not deleted by ML face detection refresh; matching ML detections may add embeddings to them.
- Force face detection deletes only machine-learning faces before rerunning detection.
- Force facial recognition unassigns machine-learning faces, unlinks machine-learning identity links, clears shared-space person state by design, and then rebuilds shared-space projections.
- Nightly recognition skip must happen before any destructive reset.
- Non-force recognition must not clear people, shared-space people, or identity links.
- A queued job that runs after an asset, space, library link, member, or face has been removed must skip or repair idempotently.
- Disabled shared-space face recognition must stop new shared-space matching work and must make already queued shared-space face jobs skip without mutation.
- Stable job ids must dedupe pending duplicate work but must not block legitimate future work after completion.
- Failed jobs that represent correctness work must remain visible unless there is a specific remove-on-fail design.
- Identity merges must check personal-profile and space-profile conflicts before merging.
- Shared-space metadata backfill must not publish stale inherited names or birth dates after membership removal, asset removal, person deletion, or identity detachment.
- Person cleanup must not delete named people that still have faces through another source.
- Orphan cleanup may delete faceless people and their thumbnails, and that deletion must queue metadata backfill when identity-scoped visibility can change.
- Pet faces must not merge into human people, and human faces must not merge into pet people.

## Trigger Matrix

This matrix defines every trigger that should have explicit coverage.

### Upload And Thumbnail Completion

Source: `JobService.onDone(AssetGenerateThumbnails)`.

Coverage:

- upload image queues `SmartSearch`, `AssetDetectFaces`, `Ocr`, and `PetDetection`
- upload video additionally queues `AssetEncodeVideo`
- non-upload and non-notify thumbnail generation does not queue face detection
- generated thumbnail for a missing asset logs and stops without face jobs
- hidden or non-timeline upload notifications do not alter face queue decisions unexpectedly

### Manual Asset Jobs

Source: `AssetService.run`.

Coverage:

- `AssetJobName.REFRESH_FACES` queues one `AssetDetectFaces` per selected asset
- multiple selected assets preserve per-asset queue data
- access failure queues nothing
- populated asset with manual, EXIF, and ML faces is covered by downstream detection tests

### Admin Queue Starts

Source: `QueueService.start`.

Coverage:

- starting `QueueName.FaceDetection` queues `AssetDetectFacesQueueAll` with `force=false`
- starting `QueueName.FaceDetection` with `force=true` queues destructive forced detection
- starting `QueueName.FacialRecognition` queues `FacialRecognitionQueueAll`
- starting `QueueName.FacialRecognition` with `force=true` is allowed while one recognition job is active and replaces pending work
- non-force recognition start while active is rejected
- starting `QueueName.PeopleBackfill` queues `FaceIdentityBackfill`
- starting unrelated queues does not enqueue face jobs
- paused queues and failed job clearing do not silently lose stable face pipeline jobs

### Nightly Jobs

Source: `QueueService.handleNightlyJobs`.

Coverage:

- database cleanup queues `PersonCleanup`
- missing thumbnails queues `AssetGenerateThumbnailsQueueAll`; those generated thumbnail jobs are not upload/notify jobs and must not trigger face detection through thumbnail completion
- cluster new faces queues `FacialRecognitionQueueAll` with `nightly=true` and `force=false`
- nightly recognition skip with no new faces does not queue maintenance, backfill, or destructive reset work
- nightly recognition with existing waiting, delayed, paused, or active recognition work skips before any destructive reset or shared-space wipe
- nightly recognition recovered after a stuck queue does not enqueue duplicate full-recognition fan-out while old work is still waiting
- disabled nightly switches do not enqueue corresponding face jobs

### Manual Job Endpoint

Source: `JobService.create`.

Coverage:

- manual `face-identity-backfill` queues `FaceIdentityBackfill`
- manual `shared-space-person-metadata-backfill` queues `SharedSpacePersonMetadataBackfill`
- manual `person-cleanup` queues `PersonCleanup`
- invalid manual job queues nothing
- manual retrigger while a stable backfill job is active or pending dedupes correctly

### App Bootstrap

Source: `PersonService.onBootstrap`.

Coverage:

- backfill work queues one root `FaceIdentityBackfill`
- no backfill work queues nothing
- active, waiting, delayed, or paused backfill job prevents duplicate root queueing
- bootstrap does not start projection fan-out directly

### Metadata Face Import

Source: `MetadataService.applyTaggedFaces`.

Coverage:

- face import disabled skips face import
- no `RegionInfo` or unnamed regions skip face creation
- new names create people, create EXIF faces, link identities, and queue person thumbnails
- existing names attach EXIF faces to existing people and identities
- existing EXIF faces for the asset are removed before imported replacements are added
- imported faces queue `SharedSpaceFaceMatchFromBackfill` for spaces containing the asset
- imported faces on linked-library assets are covered by projection/backfill tests
- malformed or rotated face regions use existing orientation tests and do not corrupt face boxes

### Library Sync And Link

Sources: `LibraryService.handleSyncFiles`, `SharedSpaceService.linkLibrary`, `SharedSpaceService.unlinkLibrary`, `SharedSpaceService.handleSharedSpaceLibraryFaceSync`.

Coverage:

- importing new library assets queues normal post-sync jobs and shared-space face matches for enabled linked spaces
- scheduled library scan queues only library sync roots directly; any face identity effects must come from later sidecar, metadata, thumbnail, EXIF import, or shared-space projection handlers
- overnight library scan plus EXIF face import with pre-existing shared-space people does not empty shared-space people and queues only targeted projection/metadata repair work
- no linked spaces queues no shared-space face work
- disabled linked space queues no shared-space face work from library sync
- linking a library to an enabled space queues `SharedSpaceLibraryFaceSync`
- duplicate library link queues nothing
- unlink removes linked-library person-face rows, deletes orphaned space people, and queues metadata backfill
- queued library sync rechecks that the link still exists before every batch
- library sync with no affected people still queues or skips dedup according to current behavior and has an explicit test

### Shared Space Membership And Asset Changes

Sources: `SharedSpaceService`.

Coverage:

- toggling face recognition from false to true queues `SharedSpaceFaceMatchAll`
- toggling true to false queues no rebuild and makes queued face jobs skip
- adding a member queues metadata backfill, full-space face match when enabled, and member-scoped identity reconciliation
- removing a member queues metadata backfill and removes global accessibility for that member in medium tests
- adding assets queues one `SharedSpaceFaceMatch` per asset when enabled
- adding assets to a disabled space queues no face matches
- bulk add queues one stable `SharedSpaceBulkAddAssets` job
- bulk add handler queues `SharedSpaceFaceMatchAll` only when assets were added and face recognition is enabled
- removing assets removes selected-space person-face rows, deletes orphaned space people, and queues metadata backfill
- deleting a space queues metadata backfill and leaves no accessible stale space profiles

### Duplicate Resolution

Source: `DuplicateService.resolve`.

Coverage:

- keeper assets are added to editable spaces that contained trashed duplicate assets
- shared-space face matches are queued for keepers in each editable space
- no editable spaces queues no face matches
- no keepers skips the space sync branch
- `addAssets` failure prevents downstream destructive mutation
- queue failure after keeper insertion is reported as failure and retry remains idempotent
- disabled spaces are handled by the downstream shared-space face-match skip contract

### Pet Detection

Source: `PetDetectionService`.

Coverage:

- disabled pet detection skips
- missing asset or preview fails safely
- hidden asset skips
- new pet species creates a pet person and pet face
- existing species reuses the existing pet person
- first pet face queues `PersonGenerateThumbnail`
- pet faces can later project into shared spaces without human/pet type confusion
- no pet face identities are required for legacy pet matching

### Manual People And Face Operations

Sources: `PersonService` and `SharedSpaceService`.

Coverage:

- creating a manual face links the face to the target identity and may queue thumbnail generation
- deleting a face unlinks identity membership and respects soft versus force delete
- reassigning faces links them to the target identity with manual source
- reassigning a representative face queues thumbnail generation and updates identity representative face
- updating person name or birth date queues scoped shared-space metadata backfill
- deleting people queues file deletion and metadata backfill only when people existed
- merging personal people reassigns faces, links target identity, removes source person, merges identities, and queues metadata backfill
- merging scoped people enforces accessibility and scoped-profile conflict guards before merging identities
- detaching scoped people enforces repairability before moving profile evidence
- deleting shared-space people queues metadata backfill for identity-backed people
- merging shared-space people reassigns faces, merges compatible identities, inherits metadata, recounts, queues dedup, and rejects cross-type merges
- deduplicating shared-space people queues `SharedSpacePersonDedup` and requires owner access

## Independent Implementation Slices

Each slice below can be implemented independently. A slice should include its tests, focused verification command, and any minimal production fix revealed by the tests.

### Slice 1: Trigger Contract Coverage

Purpose: prove every trigger queues the expected face-related jobs and does not queue them when disabled or unauthorized.

Primary files:

- `server/src/services/job.service.spec.ts`
- `server/src/services/queue.service.spec.ts`
- `server/src/services/asset.service.spec.ts`
- `server/src/services/library.service.spec.ts`
- `server/src/services/metadata.service.spec.ts`
- `server/src/services/duplicate.service.spec.ts`
- `server/src/services/shared-space.service.spec.ts`
- `server/src/services/pet-detection.service.spec.ts`

Add tests for:

- upload thumbnail completion and non-upload no-op
- manual asset refresh faces with multiple assets
- admin queue starts for face detection, facial recognition, and people backfill
- nightly `PersonCleanup`, missing thumbnails, and cluster-new-faces trigger combinations
- manual job endpoint for identity and metadata backfills
- shared-space add member, add assets, bulk add, remove assets, delete space, link library, unlink library
- duplicate keeper propagation and queue-failure retry behavior

Completion criteria:

- every trigger in the trigger matrix has at least one explicit test
- access failure and disabled config paths queue nothing
- tests assert exact job names and data

### Slice 2: Face Detection Safety

Purpose: pin `AssetDetectFacesQueueAll` and `AssetDetectFaces`, especially destructive refresh behavior.

Primary files:

- `server/src/services/person.service.spec.ts`
- `server/test/medium/specs/services/person.service.spec.ts`
- `server/test/medium/specs/repositories/person.repository.spec.ts`

Add tests for:

- `force=true`, `force=false`, and omitted `force`
- force detection deletes only machine-learning faces and unlinks removed face identities
- force detection preserves manual and EXIF faces
- non-force detection does not delete people or shared-space people globally
- missing asset, no preview, multiple preview files, hidden asset, and ML-disabled skips
- no detected faces removes stale ML faces but not manual/EXIF faces
- matching detection adds embeddings to existing EXIF/manual face instead of creating a duplicate
- changed image dimensions and IOU matching preserve existing faces when boxes still overlap
- job status `facesRecognizedAt` is written only for successful processed assets
- new faces queue `FacialRecognitionQueueAll` plus per-face recognition when non-force
- new faces queue only forced `FacialRecognitionQueueAll` when force detection created them

Destructive medium tests:

- populated user with named people, manual faces, EXIF faces, ML faces, and shared-space projections
- force detection removes ML faces, leaves manual/EXIF faces and people expected to survive, deletes only orphaned people, and leaves identity projection repairable

### Slice 3: Recognition Coordinator

Purpose: pin `FacialRecognitionQueueAll` ordering, force replacement, nightly skip, and final maintenance behavior.

Primary files:

- `server/src/services/person.service.spec.ts`
- `server/src/repositories/job.repository.spec.ts`
- `server/src/services/queue.service.spec.ts`

Add tests for:

- waits for thumbnail and face detection queues before queueing recognition work
- nightly skip happens before queue drain and before destructive reset
- non-force nightly run with a large existing waiting queue skips before personal unassign, identity unlink, shared-space person-face delete, shared-space person delete, maintenance marker, and backfill
- recovered or retried non-force coordinator with stale waiting recognition work remains idempotent and does not multiply full-queue fan-out
- non-force run skips if recognition jobs are waiting
- force run drains pending recognition work before deleting assignments
- force run unassigns ML faces, unlinks ML identity links, cleans orphaned people, vacuums without vector reindex, clears shared-space person state, deletes unreferenced identities, queues per-face jobs with `skipSharedSpaceMatch`, queues `SharedSpaceFaceMatchAll`, queues maintenance marker, and writes last-run state
- force run with enabled and disabled spaces queues rebuild only for enabled spaces
- marker requeues itself while recognition jobs are waiting, delayed, paused, or active
- marker queues `FaceIdentityBackfill` only when recognition is drained and no backfill is already active or pending
- failed or paused stable jobs do not permanently block legitimate future coordinator work

Destructive medium tests:

- force recognition over populated data rebuilds ML assignments while preserving manual/EXIF identity evidence according to source semantics
- running force recognition twice is idempotent and does not compound deletes or duplicate shared-space projections

### Slice 4: Per-Face Recognition

Purpose: pin `FacialRecognition` behavior for every face state.

Primary files:

- `server/src/services/person.service.spec.ts`
- `server/test/medium/specs/services/person.service.spec.ts`
- `server/test/medium/specs/services/people-identity-rbac.spec.ts`

Add tests for:

- missing face or missing asset fails safely
- non-ML source skips
- missing embedding fails
- already assigned face repairs identity link and queues shared-space face matches unless `skipSharedSpaceMatch` is set
- min-face threshold skips self-only matches
- non-core faces defer once and preserve `skipSharedSpaceMatch`
- deferred non-core face can still attach to an existing person when evidence exists
- core face creates a new person, queues thumbnail generation, reassigns face, and links owner identity
- existing person match reassigns without creating a new person
- accessible shared identity match can merge identities only after conflict checks pass
- same-owner and same-space conflicts prevent automatic identity merge
- archive or hidden visibility does not create core people unexpectedly
- spaces for the asset queue `SharedSpaceFaceMatch` exactly once per space for successful incremental recognition

Destructive medium tests:

- member private upload after joining a space merges with accessible shared evidence only when strict conflict guards pass
- repeated recognition of already assigned faces does not create duplicate people or duplicate identity links

### Slice 5: Shared-Space Projection Pipeline

Purpose: pin `SharedSpaceFaceMatch`, `SharedSpaceFaceMatchFromBackfill`, `SharedSpaceLibraryFaceSync`, `SharedSpaceFaceMatchAll`, and `SharedSpaceFaceMatchPage`.

Primary files:

- `server/src/services/shared-space.service.spec.ts`
- `server/src/repositories/job.repository.spec.ts`
- `server/test/medium/specs/services/shared-space-face-identity-repair.spec.ts`
- `server/test/medium/specs/repositories/shared-space-face-matching.spec.ts`

Add tests for:

- missing or disabled space skips without mutation
- asset removed from space before job execution skips mutation but remains safe
- identity-backed face attaches to existing compatible space person
- identity-backed face creates a new compatible space person when none exists
- identity-backed face does not merge into a nearby different identity just because embeddings are close
- stale selected-space assignment is removed and replaced by the identity-correct person
- exact assignment from backfill refreshes inherited metadata
- legacy face with person but no identity uses legacy embedding path
- face with no person waits and does not create a space person
- pet face creates or reuses pet space person and never attaches to a human person
- type-incompatible existing identity-backed space person causes skip or compatible repair, not cross-type assignment
- affected people queue `SharedSpaceIdentityReconciliation`
- successful asset match queues `SharedSpacePersonDedup`
- from-backfill jobs run on `QueueName.PeopleBackfill`
- all other shared-space face pipeline jobs remain on `QueueName.FacialRecognition`
- full-space dispatcher queues only first page
- pages use keyset lookahead, process exactly the page, and queue final dedup/reconciliation once
- disabled space between pages stops the page chain without final follow-ups
- library face sync rechecks link existence between batches and stops after unlink
- library face sync creates one identity-backed space person across multiple linked libraries

Destructive medium tests:

- full-space rematch repairs missing, stale, and wrong-identity selected-space assignments without inflating counts
- linked-library relink rebuilds identity-backed selected-space assignments
- removing assets or unlinking libraries removes selected-space face rows and deletes orphaned space people
- same asset direct plus linked-library path materializes only one selected-space face assignment

### Slice 6: Identity Backfill And Metadata

Purpose: pin `FaceIdentityBackfill`, `SharedSpaceFaceMatchFromBackfill`, and `SharedSpacePersonMetadataBackfill`.

Primary files:

- `server/src/services/person.service.spec.ts`
- `server/src/services/shared-space.service.spec.ts`
- `server/src/repositories/job.repository.spec.ts`
- `server/test/medium/specs/repositories/face-identity.repository.spec.ts`
- `server/test/medium/specs/services/people-identity-rbac.spec.ts`

Add tests for:

- personal identity page with cursor queues only next personal page
- space-person identity page with cursor queues only next space-person page
- identity work remaining after final pages requeues backfill without projection fan-out
- projection work queues exact targeted `SharedSpaceFaceMatchFromBackfill` jobs
- pending durable targets from earlier pages are retained until queueing succeeds
- queueing failure does not delete pending targets
- duplicate targets from repair and projection discovery dedupe to one job
- no projection targets queues metadata backfill exactly once
- metadata backfill pages by cursor and scope
- metadata backfill inherits only from accessible and type-compatible candidates
- same-priority metadata conflicts leave existing metadata unchanged
- asset-adder metadata wins when priority is otherwise tied
- manual names and birth dates keep their manual source unless explicitly changed

Destructive medium tests:

- legacy identities are hydrated across global people, space people, filters, search, map, and album scope after backfill
- removing membership or disabling timeline prevents stale inherited metadata from surfacing in global people
- detach and scoped merge operations update metadata visibility without leaking inaccessible profiles

### Slice 7: Manual People Operations With Populated Data

Purpose: test destructive user operations while realistic people data already exists.

Primary files:

- `server/src/services/person.service.spec.ts`
- `server/src/services/shared-space.service.spec.ts`
- `server/test/medium/specs/services/person.service.spec.ts`
- `server/test/medium/specs/services/people-identity-rbac.spec.ts`

Add tests for:

- merge personal people where target has name and source has birth date
- merge personal people where source has representative face and target does not
- merge personal people with shared identity evidence and space metadata backfill
- delete named person with manual, EXIF, and ML faces
- delete faceless person and confirm thumbnail file deletion job
- reassign faces from one named person to another and repair identity links
- create manual face on edited asset and identity-link it
- delete manual face and confirm identity unlink
- update representative face and identity representative face
- shared-space person merge with aliases, manual representative face, identity merge, and dedup follow-up
- shared-space person delete with identity metadata backfill
- scoped merge and detach with inaccessible backing profiles rejected before mutation

Destructive medium tests:

- personal and shared-space people remain separated when identities cannot safely merge
- manual representative faces survive dedup and metadata backfill unless explicitly changed
- deleting a source person after merge does not leave face identity links pointing at the deleted profile

### Slice 8: Cross-Slice Queue-Chain Scenarios

Purpose: prove independently tested slices compose safely.

Primary files:

- a new medium spec such as `server/test/medium/specs/services/face-queue-pipeline.spec.ts`
- existing medium helper factories

Add tests for:

- upload-like chain: thumbnail completion, face detection, recognition, shared-space projection, dedup, metadata backfill
- force detection followed by force recognition on a populated user and enabled shared space
- issue #597 chain: overnight `clusterNewFaces` fires while a large non-force Facial Recognition queue is stuck or waiting; the coordinator skips without clearing shared-space people, does not multiply recognition jobs, and leaves EXIF-backed space people visible
- issue #597 force-follow-up chain: if a force recognition follow-up was already pending before the overnight window, it is the only allowed wipe path; it clears shared-space people, queues full-space rematch after personal recognition jobs, and the final state has rebuilt space people rather than remaining empty after the queue drains
- overnight library-scan chain: scheduled library scan, sidecar/metadata refresh, EXIF face import, targeted shared-space backfill, dedup, and metadata backfill preserve pre-existing shared-space people and do not convert all faces to unassigned
- metadata EXIF import followed by targeted shared-space backfill projection
- library link followed by library face sync, identity reconciliation, dedup, and global people visibility
- duplicate keeper propagation followed by shared-space face match and stats repair
- member removal while queued reconciliation exists; queued job must not leak metadata after membership removal
- space disabled while page rebuild is pending; queued page must skip mutation and not queue final follow-ups
- failed projection job retry remains idempotent and does not create duplicate selected-space assignments

Completion criteria:

- every scenario asserts final database state, not only queued job calls
- tests include populated data and at least one stale or already-existing row
- tests assert no duplicate face assignments, no stale accessible profiles, and no unintended people deletes

## Suggested Implementation Order

1. Slice 1: trigger contract coverage. This gives a complete map and catches missing queue paths early.
2. Slice 2: face detection safety. This covers the most direct destructive face-row mutations.
3. Slice 3: recognition coordinator. This covers force reset ordering and pending job replacement.
4. Slice 4: per-face recognition. This covers person creation, assignment, and identity merge safety.
5. Slice 5: shared-space projection. This covers space data integrity and linked-library behavior.
6. Slice 6: identity backfill and metadata. This covers repair, fan-out, and inherited metadata.
7. Slice 7: manual people operations. This covers user-initiated destructive operations over populated state.
8. Slice 8: cross-slice queue-chain scenarios. This is last because it relies on the contracts from the earlier slices.

The slices are independent enough to implement in parallel if each worker owns a distinct spec file or test group. Medium tests that share fixtures should coordinate on helper changes to avoid conflicts.

## Fixture Requirements

Use compact, explicit fixtures. Each destructive medium test should state which rows are expected to survive.

Canonical populated fixture:

```text
owner user U1
member user U2
space S, faceRecognitionEnabled = true
optional disabled space S2
library L1 linked to S
library L2 linked to S
asset A1 owned by U1 in timeline
asset A2 owned by U1 archived
asset A3 hidden or offline
ML face F1 on A1 with embedding and identity I1
EXIF face F2 on A1 assigned to named person P2
manual face F3 on A1 assigned to named person P3
pet face F4 on A1 assigned to pet person P4
shared_space_person SP1 for I1
stale shared_space_person SP_STALE for wrong or missing identity
selected-space face rows including one correct row and one stale row
pending or failed stable queue jobs when queue behavior is under test
```

Assertions should include:

- `asset_face` rows by `sourceType`
- `face_identity_face` rows by identity and source
- `person.identityId`, `person.faceAssetId`, and `person.thumbnailPath`
- `shared_space_person.identityId`, type, hidden state, representative face, and face count
- `shared_space_person_face` uniqueness by `(spaceId, assetFaceId)`
- global people statistics, space people statistics, and detailed face statistics when visibility can change
- queued job names, data, stable ids, and remove-on-complete or remove-on-fail behavior where relevant

## Verification Commands

For doc-only changes:

```bash
git diff --check
rg -n "T[B]D|TO[D]O|FIX[M]E|place[ ]holder|\\?\\?\\?" docs/superpowers/specs/2026-05-17-face-identity-queue-testing-plan-design.md
```

For Slice 1:

```bash
pnpm --filter immich test -- --run src/services/job.service.spec.ts src/services/queue.service.spec.ts src/services/asset.service.spec.ts src/services/library.service.spec.ts src/services/metadata.service.spec.ts src/services/duplicate.service.spec.ts src/services/shared-space.service.spec.ts src/services/pet-detection.service.spec.ts
```

For Slices 2 through 7, run the targeted small spec first, then the adjacent medium spec if database state is touched.

For Slice 8:

```bash
pnpm --filter immich test:medium -- --run test/medium/specs/services/face-queue-pipeline.spec.ts
```

Before merging any slice:

```bash
pnpm --filter immich check
pnpm --filter immich test -- --run <targeted-small-specs>
pnpm --filter immich test:medium -- --run <targeted-medium-specs>
```

## Review Checklist

- Every trigger in the trigger matrix is assigned to a slice.
- Every destructive invariant has at least one slice that can test it.
- Every slice has a clear primary file ownership boundary.
- Medium tests are reserved for database behavior and destructive-state assertions.
- Service tests cover queue contracts and call ordering.
- No slice requires real ML inference, real Redis workers, or browser automation.
- Cross-slice scenarios are last and depend on earlier contracts rather than duplicating them.
