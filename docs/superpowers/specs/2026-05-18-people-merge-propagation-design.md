# People Merge Propagation Design

## Goal

Manual person merges should mean "these are the same real-world person" and should propagate through the identity graph instead of staying isolated to the scope where the user clicked merge.

The first version intentionally uses an open trust model:

- A personal merge is authoritative for the personal person owner.
- A shared-space merge by an editor or owner is authoritative identity evidence.
- Propagation can merge affected personal people and affected people in other shared spaces.
- If this becomes too permissive in practice, the same planner can later queue or require approval for some propagated merges.

## Current Context

The current data model already has a cross-scope identity layer:

- `person.identityId` links a personal person profile to `face_identity`.
- `shared_space_person.identityId` links a shared-space person profile to `face_identity`.
- `face_identity_face` links faces to identities.
- Unique indexes allow only one personal profile per `(ownerId, identityId)` and one shared-space profile per `(spaceId, identityId)`.

Today, identity merges are conservative. If merging identities would create two profiles for the same owner or same space, `FaceIdentityRepository.mergeIdentities()` reports conflicts and avoids collapsing the profiles. That prevents accidental damage, but it leaves duplicates behind after a user has manually confirmed a merge.

This design changes the manual merge path: conflicts become planned profile-merge work, not blockers.

Automatic reconciliation and ML-driven deduplication should stay conservative unless explicitly routed through the manual propagation engine.

## Scope

In scope:

- Personal people merge propagation.
- Shared-space people merge propagation.
- Space-to-space propagation when the same identities have duplicate people in multiple spaces.
- Propagation into personal profiles attached to affected identities.
- Metadata preservation for target profiles.
- Shared-space merge activity payload improvements.
- Testable dry-run style planning, even if no public dry-run API ships in v1.

Out of scope for v1:

- Approval queues.
- Per-member trust settings.
- Notifications for propagated merges.
- Undo UI.
- A large new audit/event table, unless implementation reveals that shared-space activity is insufficient.

## Policy

The v1 policy is intentionally open:

> Editor+ merges in shared spaces are authoritative identity merges. They propagate through all personal and shared-space profiles attached to the affected identities. Propagation preserves each scope's local metadata and records enough activity detail to debug what happened.

The minimum guardrails are:

- The initiating action must be authorized in its starting scope.
- A personal merge still requires `PersonMerge` on the target and source personal people.
- A shared-space merge still requires editor or owner role in the starting space.
- Propagated profile merges do not require separate permissions for every affected owner or space.
- `person` and `pet` identities must not be merged.
- Target profile metadata wins. Source metadata only fills blanks.
- Favorite, hidden, and manual representative-face choices must not be overwritten by propagation.
- Automatic reconciliation jobs keep using conservative conflict handling.

## Architecture

Add a central `IdentityMergePropagationService`.

Existing manual merge entry points should become permission validation plus a call into this service:

- `PersonService.mergePerson()`
- `SharedSpaceService.mergeSpacePeople()`

The new service owns the manual propagation workflow:

1. Resolve the initiating target profile and source profiles.
2. Ensure target and source identities exist.
3. Build a propagation plan from all profiles attached to those identities.
4. Apply profile merges first, within personal scopes and shared-space scopes.
5. Merge source identities into the selected target identity.
6. Update surviving profiles to the target identity.
7. Queue existing metadata backfill, deduplication, thumbnail, and count repair work.

The transaction boundary should live in `IdentityMergePropagationService`. Repository methods should accept a transaction handle where needed, because the propagation crosses personal people, shared-space people, aliases, faces, and identities.

## Propagation Plan

The planner should return a structured object before execution. The API does not need to expose it in v1, but tests should assert it directly.

The plan should include:

- origin: `person` or `space-person`
- actor user id
- target identity id
- source identity ids
- affected personal profile merges
- affected shared-space profile merges
- affected owner ids
- affected space ids
- follow-up jobs to queue
- activity payload summary

For each scope, group attached profiles like this:

- Personal scope key: `ownerId`
- Shared-space scope key: `spaceId`

If a scope has only one profile attached to the affected identities, it only needs to be updated to the final target identity.

If a scope has multiple profiles attached to the affected identities, they must be merged before identities are collapsed.

## Survivor Selection

Each scope needs one survivor profile.

Use this order:

1. If the initiating target profile is in this scope, keep it.
2. Else if a profile is already attached to the initiating target identity, keep it.
3. Else prefer the profile with more faces.
4. Else prefer a named profile over an unnamed profile.
5. Else use deterministic id ordering.

For a personal-origin merge, this means the user's selected target personal person survives in their personal people.

For a space-origin merge, this means the selected target space person survives in the initiating space. In other spaces, the profile already attached to the winning identity survives when possible. Otherwise the survivor is selected deterministically.

## Space-To-Space Propagation

Space-to-space propagation is first-class behavior, not a side effect.

Example:

- Personal people contain `X` and `Y`.
- Space A contains `space-X-a` and `space-Y-a`.
- Space B contains `space-X-b` and `space-Y-b`.
- A space editor merges `space-Y-a` into `space-X-a`.

The propagation plan should:

- merge `space-Y-a` into `space-X-a` in Space A
- merge `space-Y-b` into `space-X-b` in Space B
- merge personal `Y` into personal `X` for any owner with duplicate personal profiles attached to the same identity set
- collapse all source identities into the target identity
- queue metadata backfill for all affected spaces
- queue shared-space dedup for Space A and Space B

If Space C has only one profile attached to the affected identity set, that profile should not be deleted. It should simply end up linked to the final target identity.

This behavior is important because users expect a confirmed merge in one shared space to clean up the same duplicate in all other spaces where the same identity split is visible.

## Profile Merge Rules

### Personal Profiles

When merging one `person` row into another:

- Reassign `asset_face.personId` from source to survivor.
- Link moved faces to the final identity with source `manual`.
- Preserve survivor `name`, `birthDate`, `color`, `species`, `isFavorite`, `isHidden`, and `faceAssetId` unless a field is blank and the source has a useful value.
- Do not copy `isFavorite` from source to survivor.
- Do not copy `isHidden` from source to survivor.
- Do not replace a manual or existing feature face unless the survivor lacks a valid face.
- Delete the source `person`.
- Queue file cleanup for source person thumbnail paths using the existing deletion path.

### Shared-Space Profiles

When merging one `shared_space_person` row into another:

- Reassign `shared_space_person_face.personId` from source to survivor.
- Migrate `shared_space_person_alias` rows from source to survivor.
- Keep existing survivor aliases when there is a conflict.
- Preserve survivor `name`, `birthDate`, `isHidden`, `representativeFaceId`, and `representativeFaceSource`.
- Do not let a propagated merge overwrite manual `nameSource` or `birthDateSource`.
- If survivor metadata is blank or inherited, allow the existing metadata backfill flow to select a better inherited value after identity collapse.
- Delete the source `shared_space_person`.
- Recount survivor `faceCount` and `assetCount`.
- Repair representative face if the survivor has no valid representative face after merge.

## Identity Merge Rules

After all conflicting profiles have been merged:

- Update remaining profiles that point at source identities to the target identity.
- Update `face_identity_face.identityId` from source identities to target identity.
- Use source `manual` for manually initiated propagation.
- Delete source identities that no longer have attached faces or profiles.

Existing conflict-checking identity merge behavior should remain available for automatic reconciliation paths.

## Follow-Up Work

After execution:

- Queue `SharedSpacePersonMetadataBackfill` for the final target identity.
- Queue `SharedSpacePersonDedup` for every affected shared space.
- Recount affected shared-space people.
- Repair invalid shared-space representative faces.
- Refresh personal feature photos where needed.

The service should deduplicate affected space ids and person ids before queueing work.

## Activity And Audit

Keep the existing shared-space `PersonMerge` activity for the initiating space.

When propagation merges people in additional shared spaces, write a `PersonMerge` activity in each affected space as well. The payload should mark whether the activity is the initiating merge or a propagated merge from another scope. This matters because space-to-space propagation changes visible people in spaces whose members did not initiate the action.

Expand the activity payload to include:

- origin scope
- actor user id
- activity role: `initiating` or `propagated`
- originating space id when the merge started in a shared space
- target profile id
- source profile ids
- target identity id
- source identity ids
- affected personal profile merge count
- affected shared-space profile merge count
- affected shared-space ids

For v1, per-affected-space activity plus the summary payload is enough to understand a propagation event when investigating user reports. If we later add approval, undo, or admin history, the propagation plan can become the basis for a dedicated audit table.

## Error Handling

The propagation should execute atomically where possible.

- If identity resolution fails, reject the initiating merge.
- If mixed `person`/`pet` identities are found, reject the initiating merge.
- If a required source profile is missing from the initiating scope, reject the initiating merge.
- If any planned profile merge cannot be applied, roll back the whole merge.
- If follow-up queueing fails after the transaction, log and retry through existing job mechanisms where possible.

The initiating API should not return partial success for a manual propagation merge.

## Development Process

Use test-driven development for every implementation slice.

For each behavior in a slice:

1. Write the smallest failing test that describes the desired behavior.
2. Run that test and confirm it fails for the expected reason.
3. Implement the minimum production code needed to pass it.
4. Re-run the focused test and relevant surrounding tests.
5. Refactor only after the tests are green.

Do not write production merge propagation code before there is a failing test for that behavior. If implementation work reveals a missing edge case, add the failing test first, then update the code.

## Vertical Implementation Slices

Create separate implementation plans for these slices. Each slice should be testable on its own, should keep the branch green, and should end with a commit. The open propagation behavior should not be considered releasable until all slices are complete.

Suggested plan documents:

- `docs/superpowers/plans/2026-05-18-people-merge-propagation-slice-1-personal-origin.md`
- `docs/superpowers/plans/2026-05-18-people-merge-propagation-slice-2-space-to-personal.md`
- `docs/superpowers/plans/2026-05-18-people-merge-propagation-slice-3-space-to-space.md`
- `docs/superpowers/plans/2026-05-18-people-merge-propagation-slice-4-metadata-preservation.md`
- `docs/superpowers/plans/2026-05-18-people-merge-propagation-slice-5-transaction-hardening.md`

### Slice 1: Personal-Origin Propagation

**Goal:** A personal people merge propagates into shared spaces that contain duplicate people for the same affected identities.

**User-visible behavior:**

- When the owner merges personal `Y` into personal `X`, the selected personal target survives.
- Shared spaces with duplicate people for those identities merge their duplicates.
- Shared spaces with only one affected person keep that person and update it to the final identity.
- Personal merge responses remain compatible with the existing bulk response shape.

**Implementation scope:**

- Add the initial `IdentityMergePropagationService`.
- Add the structured propagation plan shape.
- Add planner support for personal-origin merges.
- Add executor support for personal profile merges, shared-space profile merges, and identity collapse as needed by the personal-origin path.
- Route `PersonService.mergePerson()` through the propagation service after existing `PersonMerge` access validation.

**TDD focus:**

- Start with planner tests, then repository/executor tests, then the service entry point.
- Use focused tests for the red-green loop before adding wider database-backed coverage.

**Tests and edge cases:**

- Personal merge propagates to duplicate shared-space people in multiple spaces.
- Spaces with only one affected profile keep that profile and update its identity.
- The initiating personal target survives.
- Non-initiating scopes prefer the profile already attached to the target identity.
- Survivor selection falls back deterministically by face count, named over unnamed, and id ordering.
- Missing initiating target rejects the merge.
- Missing or inaccessible initiating source returns the appropriate bulk failure and applies no profile or identity changes.
- Empty source list is rejected by DTO or service validation.
- Source id equal to target id is rejected as self-merge.
- Duplicate source ids are deduplicated without duplicate work.
- Source already attached to the target identity does not create redundant work unless duplicate profiles still exist in a scope.
- Target or source profile without an identity gets an identity before planning continues.
- Mixed `person` and `pet` identities reject and roll back.

**Exit criteria:**

- Personal-origin propagation works end-to-end in tests.
- Existing automatic reconciliation behavior is unchanged.
- The branch has no partially applied profile or identity changes on failure.

### Slice 2: Shared-Space-Origin Propagation To Personal People

**Goal:** An editor or owner merge in a shared space propagates into affected personal people.

**User-visible behavior:**

- Space viewers cannot initiate space people merges.
- Space editors and owners can merge people in the shared space.
- The selected target space person survives in the initiating space.
- Personal owners with duplicate personal profiles attached to the affected identities get those personal profiles merged.
- Personal owners with only one affected profile keep that profile and update it to the final identity.

**Implementation scope:**

- Add planner support for shared-space-origin merges.
- Route `SharedSpaceService.mergeSpacePeople()` through the propagation service after editor+ role validation.
- Preserve existing initiating-space merge activity.
- Keep the current conservative conflict behavior for automatic shared-space identity reconciliation.

**TDD focus:**

- First prove permission and initiating-space validation.
- Then prove the generated propagation plan includes personal profile merges.
- Then prove the executor applies those personal profile merges atomically.

**Tests and edge cases:**

- Space-origin merge rejects viewer-initiated requests.
- Space-origin merge allows editor and owner requests.
- Space-origin merge rejects source people outside the initiating space.
- Space-origin self-merge is rejected.
- Space editor merge propagates into personal people for affected members.
- Multiple owners are handled independently.
- Hidden source or target profiles preserve survivor hidden state.
- Favorite source profiles do not copy favorite state to the survivor.
- Blank survivor metadata is filled from useful source metadata, but non-blank survivor metadata wins.
- Automatic shared-space identity reconciliation still skips same-owner and same-space conflicts instead of invoking manual propagation.

**Exit criteria:**

- Space-origin merges can safely mutate personal people through the propagation engine.
- The initiating space behavior is covered by service tests.
- Automatic reconciliation remains conservative.

### Slice 3: Space-To-Space Propagation And Activity Fanout

**Goal:** A confirmed merge in one shared space cleans up the same duplicate in every other shared space attached to the affected identities.

**User-visible behavior:**

- If Space A merges `space-Y-a` into `space-X-a`, Space B also merges `space-Y-b` into `space-X-b` when both profiles exist there.
- If Space C has only one affected profile, it keeps that profile and updates it to the final identity.
- Every affected shared space gets a `PersonMerge` activity entry.
- Activity payloads distinguish the initiating merge from propagated merges.

**Implementation scope:**

- Extend the planner to fan out shared-space profile merge steps across all affected spaces.
- Extend activity payload generation with origin scope, activity role, originating space id, target/source profile ids, identity ids, propagation counts, and affected space ids.
- Deduplicate affected space ids before queueing jobs or writing activity.

**TDD focus:**

- Start with planner tests for multi-space layouts.
- Add executor/service tests for per-space activity fanout.
- Add integration coverage for a full space-origin merge that propagates to another space and personal people in one operation.

**Tests and edge cases:**

- Space editor merge propagates to other shared spaces with duplicate profiles for the same identity set.
- Other spaces with only one affected profile do not delete it.
- Multiple spaces are planned independently.
- Propagated space-to-space merges write activity in every affected shared space.
- Activity payload records origin, activity role, propagation counts, and affected spaces.
- Duplicate source ids do not create duplicate activity entries.
- Follow-up queues deduplicate repeated affected spaces and identities.

**Exit criteria:**

- Space-to-space propagation is not a side effect; it is explicitly planned, executed, tested, and visible in activity.

### Slice 4: Metadata, Aliases, And Representative Preservation

**Goal:** Propagated merges preserve local metadata and user choices while still cleaning up duplicate profiles.

**User-visible behavior:**

- The survivor profile's explicit metadata wins.
- Source metadata fills only blank survivor fields.
- Favorite, hidden, and manual representative choices are not overwritten.
- Shared-space aliases migrate from source to survivor without replacing existing survivor aliases.
- Invalid or missing representative faces are repaired after merge.

**Implementation scope:**

- Harden personal profile merge helpers.
- Harden shared-space profile merge helpers.
- Reuse existing feature-photo and shared-space representative-face repair paths.
- Ensure source person thumbnail cleanup is queued for deleted personal profiles.

**TDD focus:**

- Write repository-level tests for each metadata rule before changing helpers.
- Add service-level tests proving the same rules hold through personal-origin and space-origin propagation.

**Tests and edge cases:**

- Target `name`, `birthDate`, `color`, `species`, `isFavorite`, `isHidden`, and `faceAssetId` are preserved unless blank-fill is allowed.
- Manual personal feature face is preserved if still valid and repaired only when missing or invalid.
- Shared-space `name`, `birthDate`, `isHidden`, `representativeFaceId`, and `representativeFaceSource` are preserved.
- Manual shared-space `nameSource` and `birthDateSource` are not overwritten.
- Shared-space aliases migrate and existing survivor aliases win conflicts.
- Shared-space `faceCount` and `assetCount` are recounted after profile merges.
- Deleted personal source thumbnails are queued through the existing cleanup path.

**Exit criteria:**

- The propagation engine can collapse profiles without silently overwriting local user metadata or choices.

### Slice 5: Transactionality, Concurrency, And Follow-Up Hardening

**Goal:** Manual propagation is atomic, resilient to races, and keeps follow-up work consistent.

**User-visible behavior:**

- A failed propagation does not leave half-merged people or identities.
- Concurrent overlapping merges either serialize cleanly, retry, or fail without uniqueness violations or partial state.
- Follow-up jobs are queued once per affected identity/space.
- Automatic reconciliation keeps its existing conservative behavior.

**Implementation scope:**

- Make the propagation executor run profile merges and identity collapse in a single transaction where possible.
- Ensure transactional repository helpers accept a caller-provided transaction handle.
- Add the lower-level identity collapse path that assumes profile conflicts have already been resolved.
- Keep the existing conflict-checking identity merge path for automatic reconciliation.
- Define behavior for follow-up queue failures after the transaction and activity write failures inside the transaction.

**TDD focus:**

- Use medium/database-backed tests where mocks cannot prove unique-constraint ordering, transaction rollback, or concurrency behavior.
- Add failure injection tests before adding retry or rollback handling.

**Tests and edge cases:**

- Transaction rolls back if one planned profile merge fails.
- Executor error midway rolls back all profile and identity changes.
- Activity write failure during the transaction rolls back with profile and identity changes.
- Follow-up queue failure after the transaction leaves the core merge consistent and is logged/retryable.
- Database unique constraints for `(ownerId, identityId)` and `(spaceId, identityId)` are not violated during execution.
- Concurrent merge of overlapping identities results in one successful transaction and one clean retry/failure path.
- Identity cleanup deletes source identities only when no faces or profiles still reference them.
- Identity with faces but no profile in a scope collapses identity faces without creating profile work for that scope.
- Existing automatic reconciliation conflicts still skip and do not call manual propagation.

**Exit criteria:**

- The full feature can be considered releasable after this slice and its verification suite pass.

## Future Tightening

If open propagation causes problems, do not rewrite the merge logic. Change the planner policy.

Possible later policies:

- Auto-apply only in the initiating scope and spaces owned by the actor.
- Auto-apply to shared spaces, but queue personal profile merges for the owner.
- Trust specific spaces or members for automatic personal propagation.
- Require approval when a propagated personal merge would affect named people or many faces.

The v1 planner should preserve enough information to support these policies later.
