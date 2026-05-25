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
'pending' | 'confirmed' | 'dismissed'
```

to:

```ts
'pending' | 'confirmed' | 'rejected' | 'ignored'
```

Semantics:

- `pending`: visible in suggestion queues.
- `confirmed`: user accepted and the face was assigned.
- `rejected`: user said this is a different person.
- `ignored`: user said this face should not be assigned or shown again for this target.

The migration should convert existing `dismissed` rows to `rejected`, because the old UI label was **Different person**. After migration, new code writes only `pending`, `confirmed`, `rejected`, or `ignored`.

Generation remains unchanged in principle: upsert only inserts new rows or updates existing `pending` rows. Resolved rows (`confirmed`, `rejected`, and `ignored`) are never resurrected.

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

## Web Design

`PersonSuggestionReviewModal` should accept three action callbacks:

- `confirm(assetFaceId)`
- `reject(assetFaceId)`
- `ignore(assetFaceId)`

The global person page and shared-space person page should wire those callbacks to their corresponding SDK functions. The modal's existing generic `dismiss` callback should be renamed to the clearer action names at the component boundary.

The banner can remain unchanged. The banner's **Not now** action is temporary local snooze of the banner, not a suggestion resolution, and should stay separate from **Ignore face** in the review modal.

To avoid overwhelming the user, the modal should not add explanatory body text. The button labels and hierarchy should carry the meaning. Documentation can explain the distinction in detail.

## Documentation

Update the facial recognition docs to explain:

- **Same person** assigns the face.
- **Different person** means the suggestion is wrong and will not be shown again for that person.
- **Ignore face** means the face may be correct but is not useful to assign, and will not be shown again for that person.
- Neither negative action trains the model or blocks future automatic recognition.

The docs should avoid implying that the system learns model-level negative examples from user actions.

## Testing

Server tests:

- Migration/schema accepts `rejected` and `ignored` and rejects invalid statuses.
- The migration converts existing `dismissed` rows to `rejected`.
- `reject` changes a pending personal suggestion to `rejected` and is idempotent.
- `ignore` changes a pending personal suggestion to `ignored` and is idempotent.
- `dismiss` compatibility endpoint maps to `rejected`.
- The same coverage exists for shared-space people.
- Upsert never resurrects `rejected` or `ignored` rows.
- Confirm still deletes sibling pending suggestions for the same face while preserving resolved history rows.

Web tests:

- The review modal renders all three actions with the intended visual hierarchy.
- Clicking **Same person** calls `confirm` and advances.
- Clicking **Different person** calls `reject` and advances.
- Clicking **Ignore face** calls `ignore` and advances.
- Global person and shared-space person pages wire the correct SDK functions.
- Banner snooze remains temporary and does not call reject or ignore.

OpenAPI/SDK tests should verify the new endpoints are generated for TypeScript and Dart clients.

## Future Use

Persisting `rejected` separately from `ignored` enables future improvements without changing the user contract:

- ranking lower suggestions that resemble previously rejected wrong-person pairs;
- detecting users who often ignore tiny faces and offering a size/relevance filter;
- reporting review quality metrics without mixing true mismatches and irrelevant-but-correct faces;
- improving copy or ordering if one negative action is used far more than the other.

No future behavior should be introduced automatically in this change. The immediate product promise is only that the user can express the correct intent and suppress the current suggestion.
