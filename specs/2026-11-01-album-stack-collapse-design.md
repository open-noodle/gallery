# Album stack collapse (web)

## Problem

The library timeline collapses a stack to one thumbnail with a count badge (`withStacked`). An album
page showed every stacked photo separately: the album route passed `withStacked` to the `Timeline`
component (so the viewer shows the stack strip) but never sent it in the bucket query. Upstream Immich
does the same.

Sending upstream's `withStacked` with `albumId` is not enough. Its collapse keeps only the stack's
primary, so an album that holds stack members but not the primary would lose those photos.

## Rule

With `withStacked` and `albumId`, `withTimeBucketAssetFilters` (`server/src/gallery/utils/time-bucket-filter.ts`) calls `withAlbumStackCollapse`
(`server/src/gallery/utils/album-stack-collapse.ts`) instead of upstream's primary join. A photo is
hidden when another member of its stack ranks ahead of it **and** passes the same request's filters
(album membership with space contributions, visibility, trash, every filter chip). Rank: the primary,
then the earliest `fileCreatedAt`, then id.

- The album shows its primary when it holds it, otherwise its earliest member of the stack.
- A filter never hides a photo behind a sibling it excluded (the favourite special case on the library
  timeline is not needed here). With a filter active the stack's thumbnail can therefore change
  (unfiltered it is the primary; filtered to favourites it is the best-ranked favourite).
- The rank is album-wide, not per bucket, so bucket counts and bucket contents agree.
- **Only the viewer's own stacks collapse.** `Permission.StackRead` is owner-only (plus the space grant),
  so a shared-album viewer could not expand another user's stack in the viewer, and its hidden members
  would be unreachable. The badge (`getTimeBucket`'s `stack` lateral) is gated the same way through
  `albumStackBadge`, so another user's stacked photos show no badge.

## Settings

Two per-browser settings (`web/src/lib/gallery/stack/album-stack-preferences.svelte.ts`, local storage,
like the album's "show owners" toggle), in the album options menu (`AlbumStackMenuOptions.svelte`; the
space album page has a small menu of its own for them). Both default to the whole stack, the owner's
choice on 2026-11-01: the whole stack is how a user finds a photo's links from an album.

- **Count only this album's photos in stacks.** The album query adds `stackCountInAlbum`
  (`GalleryTimeBucketExtension`, an optional `TimeBucketDto` field), and `albumStackBadge` then counts only
  the members the album holds, by the grid's own membership. A stack with one member in the album shows
  no badge. Otherwise the badge counts every live, timeline-visible member.
- **Show only this album's photos when opening a stack.** The viewer reads
  `GET /albums/{id}/stacks/{stackId}` (`GalleryAlbumService.getStack`): the stack narrowed to the album's
  members as the caller sees them (`SpaceAlbumRepository.getAlbumAssetIdsForViewer`), behind `AlbumRead`
  and `StackRead`, so it never shows more than `GET /stacks/{id}`. Only the strip and its arrow keys are
  narrowed (`album-stack-strip.ts`); the stack the viewer's actions use stays whole, because unstack and
  "keep this, delete others" act on every member. Fewer than two album members means no strip; a failed
  lookup shows the whole stack.

Settings are not synced between devices or users. Server-side user preferences were not worth a new
preference, its mobile story and its version pairings for two web-only display choices.

## Web

`buildAlbumTimelineOptions` sends `withStacked: true`. It serves both `/albums/<id>` and
`/spaces/<sid>/albums/<id>`, so the space-album page keeps its parity with a normal album (E25 in
`2026-07-06-spaces-stacked-photos-design.md` now asserts the collapse). The space album page also passes
`withStacked` to its `Timeline`, without which it would collapse stacks but show neither badge nor strip.
The shared-link album page (`AlbumViewer.svelte`) builds its own options and is unchanged; the viewer
shows no stacks there.

The viewer knows its album from the `album` prop (album page) or the route's `albumId` (space album
page, which does not pass `album` to its timeline, since that turns on album activity and cover actions):
`viewerAlbumId` in `album-stack-strip.ts`.

`TimelineManager` patches the grid locally on `StackCreate`/`StackUpdate`/`StackDelete`. In an album that
patch is wrong: the server picks the member that stands for the stack, and the unstack path upserts every
member, including photos the album does not hold. With `albumId` and `withStacked` the manager reloads
the album instead (`reloadAlbumStacks()`, which hands the rule and its one-reload-per-task batching to
`AlbumStackReload` in `web/src/lib/gallery/stack/album-stack-reload.ts`). Closing the viewer scrolls back to the asset it showed.

Album membership changes reload for the same reason. Removing the photo that stands for a stack (remove
from album, trash, delete: every path ends in `removeAssets`) leaves its stack-mates in the album but never
loaded, and adding a photo from the viewer (the strip offers stack members the album does not hold) can
outrank the one shown, as the primary does. So `removeAssets` reloads when a removed photo carried a stack,
and `AlbumAddAssets` for this album reloads. The picker's own adds need no reload: its options carry no
`albumId`, and leaving the picker reloads anyway. Removing the shown photo from the album inside the viewer moves the viewer to the stack-mate that now
stands for the stack (`albumStackSuccessor`, from `GET /albums/{id}/stacks/{stackId}`, the server's rank),
and only when the album holds none of the stack to the album's next photo, as upstream does.

The reload triggers reach the manager twice. `TimelineManager` subscribes to the events in its constructor, and the
album pages also mount `AlbumStackEvents` (an `OnEvents` subscriber) that calls the public `reloadAlbumStacks()`. In
Safari the constructor's subscription, made while `Timeline` renders, was seen to miss `AlbumAddAssets` and
`AlbumRemoveAssets` while every `OnEvents` listener received them (console trace, 2026-11-01); a subscription made in
`onMount` does not. `reloadAlbumStacks()` runs one reload per task, so both firing costs nothing, and it reloads with the
current options instead of blanking them, which had let the page's options effect start extra reloads meanwhile.

Both album pages' selection menus offer **Stack** and **Unstack** (`AlbumStackBulkActions.svelte`, the
`/photos` bulk actions) when every selected photo is the caller's, since stacking is owner-only filing
(`StackService.create`), and not over search results.

What each stack action does inside an album, given that rule:

| Action                   | Album afterwards                                                                          |
| ------------------------ | ----------------------------------------------------------------------------------------- |
| Stack                    | One thumbnail; the first selected is primary. Album membership is unchanged.              |
| Unstack                  | Every member the album holds shows again; members it does not hold stay out.              |
| Remove from stack        | That photo shows on its own.                                                              |
| Set as primary           | It becomes the thumbnail only if the album holds it; otherwise the earliest member stays. |
| Add uploads to stack     | The badge grows (whole-stack count); the uploads are not added to the album.              |
| Keep this, delete others | Deletes the others from the library, including members the album does not hold.          |

"Keep this, delete others" therefore warns inside an album (`confirm_keep_this_delete_others_in_album`,
through `web/src/lib/gallery/stack/keep-this-delete-others.ts`): the photos leave the whole library, not
just the album. Outside an album the prompt is upstream's.

## Version pairings

- **Web and server** ship together, so they never mix.
- **Mobile** collapses on the device: its album timelines are local Drift queries, so
  `mobile/lib/gallery/stacks/album_stack_collapse.dart` applies the same rule (rank by primary, then
  `created_at`, which is synced from `fileCreatedAt`, then id; siblings must pass the same membership,
  visibility and temporal scope; only the signed-in user's stacks) to the album and space-album routes in
  `SharedSpaceTimelineRepository`. It needs no server change, so it works against older servers; an older app
  shows every photo, as before. Mobile has no settings: its stack badge has no count, and the viewer's strip
  always shows the whole stack. Local `stack_entity` holds only the user's and partners' stacks, which the
  owner-only rule needs anyway.
- **Stock Immich clients** do not send `withStacked` with `albumId`. A third-party client that does
  gets this collapse instead of upstream's primary-only one: the same result when the album holds the
  primary, one photo instead of none when it does not. `stackCountInAlbum` and the endpoint are additions
  no stock client sends.

## Tests

- `server/test/medium/specs/services/album-stack-timeline.spec.ts`: primary held, primary absent,
  no `withStacked`, filter-excluded sibling, trashed primary, shared-album viewer vs owner,
  `stackCountInAlbum`, and the album-stack endpoint (owner narrowed; non-owner viewer and stranger refused).
- `server/test/medium/specs/utils/rbac-oracle.medium.spec.ts` ("album stacks"): the endpoint per actor.
- `web/src/lib/managers/timeline-manager/timeline-manager.svelte.spec.ts` ("album timeline with stacked
  photos"): stack events and membership changes reload the album, and stack events never insert outside
  members.
- `web/src/lib/gallery/stack/*.spec.ts`, and "album stack count setting" in
  `filtered-timeline-controller.svelte.spec.ts`.
