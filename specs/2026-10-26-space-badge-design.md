# Space badge on thumbnails

## Problem

Nothing on a thumbnail says whether the photo is in a space. With a space on the timeline, your own photos,
the ones you shared and the other members' photos look the same in Photos, and finding out means opening
each photo.

## Behaviour

A small badge in the top-left corner of a thumbnail whose photo is in at least one of your spaces. It is
drawn like the thumbnail's other marks (favourite, stack): an icon on the photo, with no background, slightly
see-through (90 %) and with a thin dark shadow, so it hints without covering the photo.

- **One space**: the spaces icon in the space's colour.
- **Several spaces**: a white spaces icon and how many. Several spaces have several colours, so the icon
  stays neutral, as the other marks. On mobile tiles narrower than 90 points the count is left out, as it
  would run into a video's duration.

A space counts whatever the path: the photo added to it, in an album linked to it, or in a library linked to
it. Spaces you hide from your timeline and albums you hide count too: the photo is still in them, and the
badge answers who else can see it. A space you are not a member of never counts. Hidden, locked and trashed
photos are in no space, as everywhere else in the spaces code. An album linked to a space badges all of its
photos, which says the album is shared.

The badge is shown on the timelines and grids (Photos, albums, people, search, folders, ...), except:

- a space's own pages, its people, map and search, where every photo would carry it;
- the trash and the locked folder, which are out of the spaces;
- shared links, which have no spaces;
- thumbnails without selection, such as the web viewer's stack strip.

The selection check owns the top-left corner: the badge fades out while the photo is selected, and on web
while the pointer is over the thumbnail. On mobile it also fades with the tile's other marks while the photo
flies to or from the viewer. A stack shows its cover's spaces, as the stack follows its cover everywhere
else.

The badge is a hint, not a control: it takes no tap or click, and screen readers skip it (`aria-hidden` on
web, `ExcludeSemantics` on mobile), like the tile's other marks (favourite, stack, cloud) on mobile. Saying
which spaces hold a photo is left for later (the info panel lists albums only).

The icon's colour is the light end of the space card's gradient on each platform (Tailwind 300 or 400),
which reads on dark photos, while the shadow outlines it on bright ones. The default colour takes a light
indigo, as its gradient's light end is see-through on web and darker on mobile. Sizes follow each platform's
marks: 20 px on web (the others are 24), 16 points on mobile, placed as the favourite mark below it.

## Server

`POST /assets/spaces` (`GalleryAssetController`) takes 1 to 1000 asset IDs and returns, for each asset the
caller can read (`Permission.AssetRead`), the IDs of the caller's spaces that show it, sorted. Assets in none
are left out, and a shared-link session gets nothing. `SharedSpaceRepository.getMemberSpaceIdsByAssetIds`
crosses the requested assets with the caller's memberships and keeps the pairs `sharedWithViewer` admits
with no album gate: the three paths, the space visibility gate and not trashed. The query runs first and the
access check only on its hits, since most thumbnails are in no space. The RBAC oracle snapshots the answer
per actor.

## Web

`web/src/lib/gallery/space-badge/`: `SpaceBadge.svelte`, hooked into `Thumbnail.svelte`, and `spaceBadges`
(`space-badges.svelte.ts`), which batches what the mounted thumbnails ask (50 ms, 500 per request) and keeps
the answers.

- An answer is kept until it may have changed, and shown until a fresh one replaces it, so a badge never
  blinks. Adding or removing assets from a space or an album asks again about those assets at once; linking
  or unlinking an album, deleting one, editing a space and moving to another page ask again about every
  mounted thumbnail. A change made elsewhere (another member, another tab or device, a library) shows on the
  next page.
- Editing a space (`updateSpaceDetails`) emits a new `SpaceUpdate` event, which also drops the shared
  spaces list, so a new colour shows without a reload; the sidebar's list follows a rename the same way.
- An answer that arrives after a change it predates is asked again; one that arrives after a logout is
  dropped.
- Colours come from the spaces list the sidebar shares (`userInteraction.recentSpaces`), loaded only once an
  asset is in a space, and not more than once a minute after a failure (each failure shows an error). The last
  list stays in use while it reloads after a space change; a space no longer in the list drops out.
- A failed request shows no badge; the thumbnail asks again with the next batch or page.

## Mobile

`mobile/lib/gallery/space_badge.{provider,widget}.dart`. The badge reads the local database, so it needs no
server call, works offline and follows sync: one query per tile through the three paths, joined to the
caller's memberships, watched on the space tables (not on `remote_asset_entity`, whose writes are frequent and
do not move an asset between libraries) and passed on only when it changes. The widget sits in
`ThumbnailTile`'s indicator stack. The Space person timeline (`sharedSpacePerson`) now has the space origin,
since every photo on it is in the space.

A change the app makes to a space reaches the local tables at the next sync, so the badge (and the space's
own timeline) lagged behind an add from the timeline or a new colour. `SharedSpaceApiRepository` now takes an
`onSpaceChanged` callback, called once the server has taken an add, a removal or an edit; the provider wires it
to `syncRemote(enqueue: true)`, queued behind a sync already running. It sits in the repository, below the
action layer, so that every surface gets it, as `SpaceSyncRemoteAlbumService` does for linked albums; album
links keep their own nudge in `SpaceAlbumActions`. A change made on another device shows at the app's next
sync.

The local album rows carry no space, so a cross-owner contribution to an album linked to several spaces counts
in each of them on mobile, where the server counts only the space it went through. The space timelines read
the same rows and share this.

## Upstream files

Against `refs/upstream/v3.3.5`:

- `web/src/lib/components/assets/thumbnail/Thumbnail.svelte`: identical before, +2 now (the import and the
  component).
- `mobile/lib/presentation/widgets/images/thumbnail_tile.widget.dart`: identical before, +2 now (the import
  and the widget in the indicator stack).
- `web/src/lib/managers/event-manager.svelte.ts`: +8 before, +9 now (the `SpaceUpdate` event).
- `web/src/lib/stores/user.svelte.ts`: +54 before, +55 now (`SpaceUpdate` drops the spaces list, as the other
  space events do).
- Generated: `open-api/immich-openapi-specs.json` and `packages/sdk/src/fetch-client.ts` gain the route.

## Tests

- Server: the service against a real database (each path on its own, two paths into one space, a hidden
  space, a hidden album link and a personally hidden album, a contribution through one of two spaces, a
  deleted album, another user's space, own photos in no space, archived photos in and hidden, locked and
  trashed ones out even for an elevated owner, a removed member, a shared link); the RBAC oracle; the route
  (authentication, 1 to 1000 ids); the service (grouping, access on hits only, shared links).
- Web: the cache (one request per batch, batches of 500, the spaces list and its fallback, loading it only
  for hits and not again soon after a failure, asking again after each event, an answer that predates a
  change, logout, a failed request); the badge (icon colour, count, covered corner, the pages without it, no
  request when disabled); a mounted badge against the real cache (appearing, following a change without
  blinking, asking again on another page, taking a space's new colour without a reload); `updateSpaceDetails`
  emitting `SpaceUpdate` only on success.
- Mobile: the query (each path, hidden ones, a space reached twice, another user's space, every change in and
  out, no repeated values) and the widget (coloured icon and its place, white icon with a count, no count on
  small tiles, the colours, appearing late, screen readers, no badge for device-only assets, a backed-up device
  asset, the hidden origins, fading); a real `ThumbnailTile` fading it out while selected; the Space person
  timeline's origin; the repository telling the app after an add, a removal or an edit, not after a refusal or
  an album link.
