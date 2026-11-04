# Person and pet cluster type switching

## Context

Gallery supports both human and individual-pet clusters, but the person detail page has no way to correct a cluster's type. Misclassification can already produce mixed clusters: faces may be reassigned across types, and manual merges intentionally let the target cluster's type win. Treating a switch as a full re-detection would therefore be unnecessary and destructive to manual cluster assignments.

## Decision

Add an owner-side action on the global person detail page to switch a personal cluster between `person` and `pet`. Its label describes the destination type. The action is hidden for space-primary profiles because those are projections, not the owner's cluster record.

This is a **cluster reclassification only**. It does not move, delete, detect, or re-embed faces, and it does not change `face_search` or `pet_search` rows. The update writes or removes the `person_pet` sidecar and synchronizes the associated `face_identity` type, every personal profile linked to that identity, and its shared-space projections. All of these changes happen atomically. Reclassification from person to pet leaves species unknown for profiles that did not already have a pet species; reclassification from pet to person removes pet species metadata.

The optional `type` field extends the existing person-update contract. Requests from older clients remain valid. A newer client using this field with an older server may receive the server's normal validation error; the UI reports that failure without changing the displayed person.

## Verification

- DTO validation accepts `person` and `pet` and rejects other values.
- Server unit coverage verifies the update route forwards either destination type under the existing person-update permission check.
- Database-backed repository coverage verifies both transitions, type propagation across profiles and shared-space projections, and that face assignments remain unchanged.
- Web coverage verifies both menu labels, submits the matching type, refreshes the page, and hides the action for a space-primary profile.
