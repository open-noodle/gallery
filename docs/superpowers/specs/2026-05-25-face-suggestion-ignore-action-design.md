# Face Suggestion Ignore Action Design

## Problem

Face suggestions currently offer two review decisions: **Same person** and **Different person**. This works for clear matches and clear mismatches, but it does not fit high-quality detections of tiny or background faces.

For those cases, the suggested identity may be technically correct, but the user does not want the face assigned because it adds no useful library value. Choosing **Different person** dismisses the suggestion today, but the label tells the user they are providing a negative identity judgment. That weakens trust in the review loop.

The backend behavior is already suggestion-only: dismissing a suggestion does not train the model, does not alter embeddings, and does not suppress future suggestions for the person. It only resolves the current suggestion row. The design should make that semantic distinction visible and persist the user's intent for future ranking, analytics, or tuning work.

## Goals

1. Add a third review action for "this face is not useful here" without making the modal feel complex.
2. Persist the difference between "wrong person" and "not relevant" even if both actions currently suppress the suggestion in the same way.
3. Preserve the existing operational guarantees: ignored or rejected suggestions do not resurface for the same target, and neither action blocks normal automatic recognition.
4. Keep global people and shared-space people behavior consistent.
5. Maintain API compatibility for existing `dismiss` callers while moving the product language to clearer semantics.

## Non-Goals

This design does not add model retraining, dynamic threshold changes, bulk review, face-size filtering, or a way to hide all small faces automatically. Those can be evaluated later using the new persisted intent.

This design also does not introduce a "temporary skip this item" action inside the review modal. The existing banner-level **Not now** remains the temporary local snooze affordance.

## UX Design

The review modal should expose three choices:

1. **Same person**: primary action. Assigns the face to the person.
2. **Different person**: secondary action. Records that the suggested identity is wrong.
3. **Ignore face**: quiet tertiary action. Records that the suggestion should not be shown again, without making an identity judgment.

Recommended desktop layout:

```text
[ Ignore face ]   [ Different person ]   [ Same person ]
```

Recommended narrow/mobile layout:

```text
[ Same person ]
[ Different person ] [ Ignore face ]
```

The primary path stays obvious: **Same person** remains visually dominant. **Different person** remains available for true mismatches. **Ignore face** should use a quieter variant and an eye-off/hidden-style icon, because it is a dismissal of relevance rather than a judgment of identity.

Avoid labels such as **Skip** or **Not now** because the action is persistent. Avoid hiding **Ignore face** behind an overflow menu because the exact edge case happens frequently enough in group photos that users should not have to hunt for it.

Keyboard behavior can stay conservative:

- `ArrowRight`: Same person.
- `ArrowLeft`: Different person.
- No required shortcut for Ignore face in v1.
- Existing previous/next navigation buttons remain separate from review decisions.

## Data Model

The suggestion status model should move from:

```ts
'pending' | 'confirmed' | 'dismissed';
```

to:

```ts
'pending' | 'confirmed' | 'rejected' | 'ignored';
```

Semantics:

- `pending`: visible in suggestion queues.
- `confirmed`: user accepted and the face was assigned.
- `rejected`: user said this is a different person.
- `ignored`: user said this face should not be assigned or shown again for this target.

The migration should convert existing `dismissed` rows to `rejected`, because the old UI label was **Different person**. After migration, new code writes only `pending`, `confirmed`, `rejected`, or `ignored`.

Generation remains unchanged in principle: upsert only inserts new rows or updates existing `pending` rows. Resolved rows (`confirmed`, `rejected`, and `ignored`) are never resurrected.

Migration requirements:

- Add a follow-up migration for the status vocabulary change instead of relying on application code to tolerate both vocabularies.
- Update the table check constraint from `('pending', 'confirmed', 'dismissed')` to `('pending', 'confirmed', 'rejected', 'ignored')`.
- Update existing `dismissed` rows to `rejected` before installing the new check constraint.
- Update the schema table type and `@Check` expression in `person-face-suggestion.table.ts`.
- Add migration tests that assert the new check constraint accepts `rejected` and `ignored`, rejects unknown statuses, and leaves no `dismissed` rows after `up()`.
- The down migration should preserve suppression semantics by converting `rejected` and `ignored` back to `dismissed` before restoring the old check constraint. It can lose the new intent distinction on rollback.

## API Design

Add explicit endpoints:

- `POST /people/:id/face-suggestions/:assetFaceId/reject`
- `POST /people/:id/face-suggestions/:assetFaceId/ignore`
- `POST /shared-spaces/:id/people/:personId/face-suggestions/:assetFaceId/reject`
- `POST /shared-spaces/:id/people/:personId/face-suggestions/:assetFaceId/ignore`

Keep existing `dismiss` endpoints as compatibility aliases:

- `POST /people/:id/face-suggestions/:assetFaceId/dismiss`
- `POST /shared-spaces/:id/people/:personId/face-suggestions/:assetFaceId/dismiss`

Compatibility behavior: `dismiss` should map to `reject`, matching the old **Different person** label. All negative resolution endpoints remain idempotent and return `200` when the target row is already resolved or no longer pending.

Confirm behavior is unchanged: confirm marks the row `confirmed`, assigns the face through the existing manual reassignment path, and resolves other pending suggestions for the same face.

Reject and ignore behavior:

- Require the same permission currently used for dismiss.
- Update only a pending row for the target person or space person.
- Leave the face unassigned.
- Do not clear suggestions for other people or space people.
- Do not affect face identity embeddings or automatic recognition.

Repository/service naming should match the user intent:

- `markRejected(...)` / `markRejectedForSpacePerson(...)`
- `markIgnored(...)` / `markIgnoredForSpacePerson(...)`
- `dismiss...` service methods and endpoints remain as compatibility wrappers around reject.

Personal and shared-space behavior should stay aligned. If a stale client acts on a row that was pending when loaded but is now already resolved, assigned, deleted, no longer in the current distance band, or no longer visible through the shared space, the endpoint should return success without changing identity state. It should not resurrect the row or throw a user-visible error for normal review races.

## Web Design

`PersonSuggestionReviewModal` should accept three action callbacks:

- `confirm(assetFaceId)`
- `reject(assetFaceId)`
- `ignore(assetFaceId)`

The global person page and shared-space person page should wire those callbacks to their corresponding SDK functions. The modal's existing generic `dismiss` callback should be renamed to the clearer action names at the component boundary.

The banner can remain unchanged. The banner's **Not now** action is temporary local snooze of the banner, not a suggestion resolution, and should stay separate from **Ignore face** in the review modal.

To avoid overwhelming the user, the modal should not add explanatory body text. The button labels and hierarchy should carry the meaning. Documentation can explain the distinction in detail.

## TDD and Implementation Order

Implementation should follow test-driven development. Each phase starts by adding or updating the failing tests, running them to confirm they fail for the expected reason, then making the smallest implementation change that passes them.

Recommended order:

1. Migration/schema tests for the new statuses and `dismissed` conversion.
2. Repository tests for `markRejected`, `markIgnored`, upsert non-resurrection, and pending-only guards.
3. Personal service/controller tests for `reject`, `ignore`, and `dismiss` compatibility.
4. Shared-space service/controller tests for the same action matrix and permission boundaries.
5. OpenAPI generation tests or snapshot checks for TypeScript, Dart, and mobile client surfaces.
6. Web modal unit tests for the three actions and layout hierarchy.
7. Route/page tests that verify global and shared-space wiring calls the correct SDK functions.
8. E2E/API coverage for at least one global person flow and one shared-space flow.

Do not implement the UI first and backfill tests afterward. The status vocabulary is part of the persisted data contract, so migration and repository tests should lead the work.

## Documentation

Update the facial recognition docs to explain:

- **Same person** assigns the face.
- **Different person** means the suggestion is wrong and will not be shown again for that person.
- **Ignore face** means the face may be correct but is not useful to assign, and will not be shown again for that person.
- Neither negative action trains the model or blocks future automatic recognition.

The docs should avoid implying that the system learns model-level negative examples from user actions.

## Edge Cases

| Edge case                                                                  | Required behavior                                                                                                                                                                                                                     |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User marks a suggestion as **Different person**                            | Row becomes `rejected`; face stays unassigned; same suggestion does not return for that target.                                                                                                                                       |
| User ignores a technically correct but irrelevant face                     | Row becomes `ignored`; face stays unassigned; same suggestion does not return for that target.                                                                                                                                        |
| User clicks reject/ignore twice                                            | First request resolves the pending row; later requests return success and leave the first resolved status unchanged.                                                                                                                  |
| User clicks reject and ignore concurrently                                 | Only one pending-only update wins. The loser returns success and must not overwrite the first resolved status.                                                                                                                        |
| User confirms while another request rejects/ignores                        | Only the first pending-only resolution wins. If confirm wins, the face is assigned and sibling pending suggestions are resolved; if a negative action wins first, confirm becomes a benign stale action and must not assign the face. |
| Face is assigned elsewhere between load and action                         | Negative actions return success without changing assignment; confirm follows existing stale-confirm behavior and does not create a second assignment.                                                                                 |
| Face is deleted between load and action                                    | Negative actions return success with no-op semantics; the modal advances.                                                                                                                                                             |
| Person or space person is deleted between load and action                  | Existing not-found/access behavior is acceptable; the modal must keep treating stale action failures as benign and advance.                                                                                                           |
| Suggestion band is disabled or changed after the modal loads               | Already-visible review actions remain benign and do not resurrect or assign rows unexpectedly.                                                                                                                                        |
| Pending row is outside the current read band                               | It should not appear in fresh reads. If acted on from a stale modal, the endpoint should return success without creating a new pending row.                                                                                           |
| Existing `dismissed` data exists before migration                          | `up()` converts it to `rejected`; it stays suppressed and is not returned by pending reads.                                                                                                                                           |
| Rollback after new ignored/rejected rows exist                             | `down()` converts both to `dismissed` to preserve suppression under the old schema.                                                                                                                                                   |
| Shared-space reviewer is viewer                                            | GET returns no actionable suggestions, matching current behavior; POST reject/ignore/confirm requires editor and is denied.                                                                                                           |
| Shared-space reviewer is not a member                                      | GET and POST are denied by membership checks.                                                                                                                                                                                         |
| Shared-space asset is removed from the space between load and action       | Negative actions are benign and do not affect global identity state; confirm must not assign an inaccessible face.                                                                                                                    |
| Multiple people or space people have pending suggestions for the same face | Reject/ignore resolves only the target row. Confirm still resolves sibling pending rows because it assigns the face.                                                                                                                  |
| Old client calls `dismiss`                                                 | Endpoint records `rejected` and remains idempotent.                                                                                                                                                                                   |
| New client calls `reject` or `ignore`; old server is not upgraded          | This is not supported after SDK regeneration; deployment must upgrade server and web together as usual for branch-local API additions.                                                                                                |

## Testing

The test suite should be written fail-first in the order described above. Coverage should include both unit/medium tests and user-facing integration coverage.

Server tests:

- Migration/schema accepts `rejected` and `ignored` and rejects invalid statuses.
- The migration converts existing `dismissed` rows to `rejected`.
- The down migration converts `rejected` and `ignored` back to `dismissed`.
- `reject` changes a pending personal suggestion to `rejected` and is idempotent.
- `ignore` changes a pending personal suggestion to `ignored` and is idempotent.
- `dismiss` compatibility endpoint maps to `rejected`.
- The same coverage exists for shared-space people.
- Upsert never resurrects `rejected` or `ignored` rows.
- Reject/ignore do not overwrite `confirmed` or any other resolved status.
- Confirm still deletes sibling pending suggestions for the same face while preserving resolved history rows.
- Controller tests cover the new endpoints, the compatibility endpoints, UUID validation, and permission annotations.
- Service tests cover stale rows, deleted rows, concurrent/double-submit semantics, disabled suggestion band, and shared-space role boundaries.

Web tests:

- The review modal renders all three actions with the intended visual hierarchy.
- The modal does not add explanatory copy that crowds the review surface.
- Clicking **Same person** calls `confirm` and advances.
- Clicking **Different person** calls `reject` and advances.
- Clicking **Ignore face** calls `ignore` and advances.
- Keyboard behavior still maps `ArrowRight` to confirm and `ArrowLeft` to reject, with no accidental shortcut for ignore.
- Global person and shared-space person pages wire the correct SDK functions.
- Banner snooze remains temporary and does not call reject or ignore.
- Narrow/mobile layout keeps **Same person** visually dominant while keeping **Different person** and **Ignore face** available without overflow.

OpenAPI/SDK tests should verify the new endpoints are generated for TypeScript and Dart clients.

E2E/API tests:

- Seed a global person suggestion, click **Different person**, verify the row is `rejected`, the face is unassigned, and the banner count refreshes.
- Seed a global person suggestion, click **Ignore face**, verify the row is `ignored`, the face is unassigned, and the suggestion does not return.
- Seed a shared-space suggestion, verify editor can reject and ignore while viewer cannot act.
- Verify old `dismiss` API calls still suppress suggestions and now store `rejected`.

## Future Use

Persisting `rejected` separately from `ignored` enables future improvements without changing the user contract:

- ranking lower suggestions that resemble previously rejected wrong-person pairs;
- detecting users who often ignore tiny faces and offering a size/relevance filter;
- reporting review quality metrics without mixing true mismatches and irrelevant-but-correct faces;
- improving copy or ordering if one negative action is used far more than the other.

No future behavior should be introduced automatically in this change. The immediate product promise is only that the user can express the correct intent and suppress the current suggestion.
