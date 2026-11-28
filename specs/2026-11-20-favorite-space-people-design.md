# Favorite space people

Fixes the report that "Add to Favorites" for a person is missing for regular users. A user who owns no `person` for an
identity (the usual case for a family member who sees the admin's people through a space) only ever gets the
`space-person` profile, which had no favorite state.

## Decision

A favorite is a fact about (user, face identity), stored in one of two places, never both:

1. `person."isFavorite"` when the user owns a person linked to the identity (`person_identity`). This stays the only
   home for personal favorites, so Immich's meaning of the column is untouched and stock Immich keeps working.
2. `face_identity_favorite(userId, identityId)` otherwise. A fork table keyed to Immich's `user` id, so no upstream
   table changes.

The owned person wins on read (`identityFavorite()` in `src/gallery/utils/identity-favorite.ts`). A face-less `person`
placeholder was rejected: `PersonCleanup` deletes people with no faces of their own, it breaks the meaning of `person`,
stock Immich would delete or show them empty, and it needs thumbnails, names and recognition collision handling.

## Write path

`PUT` / `DELETE /shared-spaces/{id}/people/{personId}/favorite`, `SharedSpaceRead`, any member (like the alias routes).
`GalleryPeopleService.setSpacePersonFavorite` requires membership, resolves the person's `identityId` (a person without
one is refused), then `GalleryPersonRepository.setIdentityFavorite` writes the owned person when there is one and the
fallback row otherwise, deleting the fallback row in the first case.

A personal person keeps `PATCH /people/{id}`.

## Cleanups when persons link

`reconcileIdentityFavorites` drops the fallback rows of users who now own a person for the identity and carries the
favorite onto that person. It runs wherever a person is linked to an identity: `setPersonIdentity`,
`getOrCreateOwnerPersonForIdentity`, and both identity-merge paths (`moveIdentityFavorites` first moves the fallback rows
of merged-away identities onto the survivor, deduplicated). Unlinking needs nothing: the invariant is "a fallback row
exists only while the user owns no linked person", and a removed link leaves no fallback row behind. Deleting the user or
the identity cascades.

## Reads

- Space profile `isFavorite` in the People list and the per-profile hydration uses `identityFavorite()`, so the global
  People page pins a space-only favorite first through the existing `identity_favorites` sort.
- `SharedSpacePersonResponseDto.isFavorite` (optional, additive) is the viewer's flag. `getSpacePeople` takes
  `viewerUserId` and sorts favorites first inside the space; the web also sorts client-side through `comparePeople`.

## Compatibility

Everything is additive. An older app ignores the new field and routes, and shows no favorite control for space people,
as before. A newer app against an older server gets no `isFavorite` on space people and no route; the web only
calls the new routes after the user picks the action, which an older server rejects with a 404, shown as an error toast.
Stock Immich never sees the table. `scripts/revert-to-immich.sql` drops it. The migration's `down()` drops the table:
an older Gallery has nowhere to keep a favorite for a person the user does not own.

## Authorization

The gate is membership only. `test/medium/specs/gallery/space-person-favorite.spec.ts` runs the real service over owner,
editor, viewer, non-member and server admin who is not a member, with and without an owned person, for favorite and
unfavorite, checks the database after every denied request, and snapshots the outcome grid.

## Not in this change

Mobile still shows no favorite control for space people.
