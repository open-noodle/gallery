# Person and pet cluster type switching

## Context

Gallery supports both human and individual-pet clusters, but the person detail page has no way to correct a cluster's type. Misclassification can already produce mixed clusters: faces may be reassigned across types, and manual merges intentionally let the target cluster's type win. Treating a switch as a full re-detection would therefore be unnecessary and destructive to manual cluster assignments.

## Decision

Add an owner-side action on the global person detail page to switch a personal cluster between `person` and `pet`. Its label describes the destination type. The action is hidden for space-primary profiles because those are projections, not the owner's cluster record.

This is a **cluster reclassification only**. It does not move, delete, detect, or re-embed faces, and it does not change `face_search` or `pet_search` rows. The update writes or removes the `person_pet` sidecar and synchronizes the associated `face_identity` type, every personal profile linked to that identity, and its shared-space projections. All of these changes happen atomically. Reclassification from person to pet leaves species unknown for profiles that did not already have a pet species; reclassification from pet to person removes pet species metadata.

### Listing a reclassified cluster

The people lists hide per-species pet buckets, which the pet detector alone produces and whose faces carry no embedding. They used to recognise an individual pet only by a `pet_search` row on one of its faces, which a human cluster switched to pet never has: it would vanish from the People page the moment it was switched. An individual is now a pet with an embedding of either kind: `pet_search` (pet recognition) or `face_search` (the human pipeline). Pet-detector faces never get a `face_search` row, so buckets stay hidden. The rule is `personIsListed` in `server/src/gallery/utils/person-sidecar.ts` for the owner's lists and counts, with twins in the identity list (`FaceIdentityRepository`, the `withSharedSpaces` People page) and the space list and count (`SharedSpaceRepository`).

### Known consequences

- **Other owners' profiles follow.** Every personal profile linked to the same face identity changes type with it, including another user's, because `face_identity.type` has one value per identity.
- **Pipelines follow the type, not the embeddings.** A cluster switched to pet is a pet face to every human-pipeline query (`petFacePredicate`), so a forced facial-recognition run leaves it alone, and the admin *Reset pets* purge deletes its faces like any pet's; they return only after face detection reruns on those assets. New photos keep being matched by the pipeline that produced their embeddings.

The optional `type` field extends the existing person-update contract. Requests from older clients remain valid. A newer client using this field with an older server may receive the server's normal validation error; the UI reports that failure without changing the displayed person.

## Verification

- DTO validation accepts `person` and `pet` and rejects other values.
- Server unit coverage verifies the update route forwards either destination type under the existing person-update permission check.
- Database-backed repository coverage verifies both transitions, type propagation across profiles and shared-space projections, and that face assignments remain unchanged.
- A pet whose faces carry only `face_search` embeddings stays on the owner's list, the identity list and the space list and count.
- Web coverage verifies both menu labels, submits the matching type, refreshes the page, and hides the action for a space-primary profile.
