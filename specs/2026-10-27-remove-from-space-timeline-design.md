# Remove from a space, from the timeline

## Why

The space badge (#1249) shows on a thumbnail that its photo is in one of your spaces. Taking the photo out
still means opening the space and finding it again. The owner of this work put it this way: you should be
able to remove one or more photos from their space from the timeline, when they are in one or more spaces.

## Goals

- From a selection outside a space, remove the selected photos from a space they are in, on web and mobile.
- Offer only what can work: the spaces that hold at least one selected photo and in which the user may
  remove photos (Owner or Editor, as the server requires).
- One such space: the action names it and acts on it directly. Several: the action asks which one.
- The removal itself behaves exactly as removing from inside a space does today: the same server call and
  rules, the same confirmation (on web) or lack of one (on mobile), the same explanation for photos that
  are in the space through a linked album.
- The badge, and the timeline when a photo is no longer visible to the user, follow at once.

## Non-goals

- Removing from every space at once.
- Removing a photo from a linked album or library, or unlinking either, from this action. Those photos are
  explained, not handled.
- Changing what removing from inside a space does (see "Calls made" for the one exception: wording on
  mobile).
- Saying which spaces hold a photo outside a selection (the info panel); left for later.
- Server changes. Everything needed exists: `POST /assets/spaces` from #1249, the space's remove route and
  the linked-albums lookup used by the in-space action.

## Anti-goals

- Offering a space where the user cannot remove anything because of their role (Viewer).
- Reporting a count the server did not achieve: the message counts what the server says it removed.
- A different removal flow from the in-space one: same confirmation behaviour per platform, same messages
  where they already exist.

## Behaviour

**Where.** The main Photos timeline only, on web and mobile (the owner's choice): it is where the whole
library shows and the badge matters most, and it keeps the change small. Other grids that offer "Add to
album or space" (favorites, archive, search, map, people, folders, albums, memories, the viewer) are left
for later. On web the action is a button of the Photos page's selection bar, shown whoever owns the selected
photos (an Editor may remove another member's photo, so it cannot live in the menu that only shows for an
all-owned selection). On mobile it belongs to the main timeline's selection sheet, not to the sheets of
other timelines that reuse the same picker. Never inside a space (it has its own remove action), the trash,
the locked folder or shared links.

**When it shows.** Only once the selection is known to hold at least one photo in at least one space where
the user is Owner or Editor. A selection in no such space shows no action. While the answer for a new
selection is pending, the action may simply appear when it arrives.

**One space.** The action reads "Remove from {space name}" and acts on that space.

**Several spaces.** The action reads "Remove from a space…" and opens a list of those spaces, each with its
colour and how many of the selected photos it holds. Choosing one acts on it.

**The removal.** Exactly the in-space flow, applied to the selected photos that are in the chosen space:

- web: the existing confirmation ("Remove N assets from this space?", or an equivalent naming the space),
  then the removal; mobile: no confirmation, as inside a space today;
- the server removes only photos added directly to the space (expanding stacks), and returns what it
  removed;
- a success message with the removed count; for photos left because they are in the space through a linked
  album, the existing message naming the album(s) to remove them from;
- the selection is cleared after a full success; on web it is kept when some photos could not be removed,
  as inside a space.

**After.** The badges update at once (web: the `SpaceRemoveAssets` event; mobile: the sync the space
repository already asks for after a removal). A photo of another member that the user only saw through that
space leaves their timeline, as it does for every other member; the user's own photos stay, without the
badge. On web, such a photo leaves the grid in place, as a deleted one does, rather than through a reload that
would scroll the timeline back to the top; it is the selection's answer that says it showed only through that
space, so a photo the user also sees through a partner stays off the grid until the next load.

## Constraints

- A separate pull request, built on #1249 (branch `feat/space-remove-from-timeline` from
  `feat/space-badge`): it reuses the badge's route and local queries rather than duplicating them, and can
  only merge after #1249. Its description says so.
- The fork's rules (`AGENTS.md`): code in the fork namespaces (`web/src/lib/gallery`, `mobile/lib/gallery`,
  `i18n/gallery`), upstream files carry hooks only and their growth is reported against
  `refs/upstream/v3.3.5`; every new or edited fork string goes into the nine overlay locales of
  `i18n/gallery` in the same commit, as `AGENTS.md` requires.
- No migration.
- Tests at the level of the other spaces work (unit, component, the real cache where it matters), the full
  suites green, English screenshots in the description, no AI attribution in public commits or PRs.

## Decided by the owner

- A separate PR built on the badge PR, for coherence and to avoid duplicating code.
- The main Photos timeline only, on both platforms; other surfaces later if needed.
- Several spaces: choose the space. One space: act on it directly.
- Keep the current confirmation behaviours: web confirms, mobile does not.

## Calls made (not discussed; check these)

- Only Owner and Editor spaces are offered, as the server would refuse the rest.
- A space that holds the selected photos only through a linked album is still offered: `POST /assets/spaces`
  does not say by which path a photo is in a space. The removal then explains which album to edit. On
  mobile the local tables could tell the direct path apart; both platforms keep the same rule for
  consistency.
- The mobile in-space action's message is in English and not translated, and counts the photos asked for
  rather than removed. The new action uses translated strings and the server's count; the in-space action
  shares that code, so its message becomes translated and accurate too. No confirmation is added there.
- Mobile gets the linked-album explanation too: its space repository returns the IDs the server removed
  (today it drops them) and the app asks the existing linked-albums lookup for the rest, as web does. The
  in-space mobile action shares this, so it gains the explanation and the accurate, translated count; it
  still asks for no confirmation.
- Photos that are in the chosen space only through a linked library cannot be removed either, and the
  linked-albums lookup returns nothing for them. They get their own explanation (remove them from the
  library's folder, or unlink the library), on both platforms, instead of today's fallback that speaks of
  albums. Such a space is still offered, as the badge route does not say the path.

## Left to the builder

- How web learns the spaces of the selection: the badge cache (`spaceBadges`) for the assets it has
  answered, or one request for the selected IDs (in batches for selections over 1000), or both.
- How mobile learns them: a local query in the spirit of `assetSpacesProvider`, over the selected assets.
- Reusing the existing pickers (`SpacePickerModal` on web, the spaces section of the collection picker on
  mobile) or a small dedicated list.
- String keys and exact wording, matching the existing space strings.
- Whether the in-space actions and the new one share a helper for the removal and its messages.

## Upstream files

Against `refs/upstream/v3.3.5`, before (on #1249) and after:

| File | Before | After |
| --- | --- | --- |
| `web/src/routes/(user)/photos/[[assetId=id]]/+page.svelte` | +44/−32 | +46/−32: the import and `<RemoveFromSpaceButton>` |
| `mobile/lib/presentation/widgets/bottom_sheet/general_bottom_sheet.widget.dart` | +2/−29 | +4/−29: the import and the action |
| `mobile/lib/providers/infrastructure/action.provider.dart` | +126 | +113: `removeFromSpace` moved to the fork's `SpaceRemovalService` |
| `mobile/lib/services/action.service.dart` | +40/−3 | +28/−3: the same, with its space repository |
| `mobile/test/services/action.service_test.dart` | +17/−2 | +5/−1 |
| `mobile/test/unit/mocks.dart` | +19 | +11 |

Everything else is in the fork namespaces and fork-owned files (`SpacePickerModal`, `SchemaSpacePicker`,
`RemoveFromSpaceAction` on both platforms, the filtered timeline controller, the space repository), tests,
docs and the strings.
