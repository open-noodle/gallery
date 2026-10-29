# Library Cleanup on mobile

Brings Library Cleanup (`specs/2026-09-23-library-cleanup-design.md`, hub and rewind revised by
`specs/2026-10-28-cleanup-hub-redesign-design.md`, PR #1134) to the Flutter app. The server API from #1134 is used as
is; this design adds no endpoints. Branch `feat/mobile-cleanup`, stacked on #1134's branch (`worktree-library-cleanup`).

Mockups (placeholder photos and a fixed dark palette; build with the app's theme so light mode works, and match layout,
hierarchy and shape, not hex values), in `specs/mockups/2026-10-29-mobile-cleanup/`:

- `1-flow.html`: Library entry, Cleanup overview, rewind in swipe mode and in button mode
- `2-details.html`: the details sheet, half and fully open
- `3-queues.html`: Blurry, Screenshots and Bursts in the deck (its year screen is superseded by `4-calendar.html`)
- `4-calendar.html`: year of month cards, then a zoomed month with the day sheet
- `5-grid-and-finish.html`: grid mode and the end of a rewind

"The owner" is the project owner. Their decisions are marked as theirs; everything marked "my call" is the designer's
and may be revisited.

## Why

The owner wants the daily rewind and the cleanup queues usable from the phone, where most photos are taken and where a
few spare minutes happen. On the web the job is done with a mouse and keys; on a phone it should be done with a thumb,
fast enough that clearing one day takes a couple of minutes.

The primary job is today's rewind. The queues (Blurry, Screenshots, Bursts, Duplicates, Space hogs) are secondary, and
the year of other days is there for someone who wants to go further.

Success: from Library, two taps start today's rewind; each photo is decided in about a second with a swipe; you can
always see enough about the photo to decide, or jump to it in the main library; and every cleanup feels like the same
tool.

## Goals

- Today's rewind is the first thing on the Cleanup overview, with one obvious button.
- Deciding on a photo is one gesture: swipe right keep, left trash, up favourite (the owner's decision).
- Every cleanup uses the same deck, gestures, buttons, info strip and details sheet (the owner: "around the same way we
  go through the other photos").
- Many at once is possible too: a Grid mode for the rewind and every queue (the owner's decision).
- A rewind can be finished at any point, applying what has been done so far (the owner's decision).
- It feels sleek, fast and premium, using the mobile motion kit (`mobile/lib/gallery/motion/`,
  `specs/2026-10-23-mobile-motion-language-design.md`).

## Non-goals

- No server or API changes. If a slice finds it needs one, stop and raise it with the owner.
- No changes to upstream timeline, viewer or settings code beyond the registration lines in "Constraints".
- No cleanup admin settings on mobile. Per-queue filters (strictness etc.) are in scope, see Queues.
- No offline mode. Cleanup reads from the server; offline it shows an error state with retry.

## Anti-goals (fails even if it works)

- A wrong swipe must never cost a photo. No mark in any cleanup is applied until the user presses Done and applies
  (see "Applying changes"). Nothing is deleted permanently without an explicit confirmation
  (see "Trash confirmation").
- The overview must not wait on secondary data to show today's rewind and its button.
- No guilt copy or nagging around the streak (same as web).
- The year view must not ask for taps on tiny day cells (the owner's decision; see Your year).
- No stutter: a card is never thrown before the one behind it has decoded. "Decoded" means the card behind always has a
  decoded image to show, never a blank or half-drawn one: its preview once that has decoded, its thumbhash (decoded on
  the device, at once) and thumbnail until then. Throwing itself never waits on the network (see "The deck").
- A stock Immich server, or a Gallery server without cleanup, must never see a cleanup request beyond the one support
  probe, and the app must show no Cleanup entry for it.

## The design

### Where it lives

- **Entry:** a **Cleanup** button in the Library page's action grid (`mobile/lib/presentation/pages/library.page.dart`,
  `_ActionButtonGrid`), next to Favorites, Archived, Shared links and Trash, spanning the full row with a subtitle of
  today's count ("Today: 42 photos from 6 years"). The subtitle loads after the page; the button shows without it.
  (Owner: entry from Library; the shape is my call.)
- **Server support:** there is no cleanup flag in server info or `/server/features`, so the app probes
  `GET /cleanup/calendar` once per server connection and hides the entry on 404 or 403 (my call). The probe waits
  until the server version is known (not the `0.0.0` placeholder `serverSupportsSpaces` treats as "maybe") or the
  declared sync types have arrived, and is skipped when they say stock Immich. A network error or 5xx hides the entry
  for now and probes again the next time Library opens. Its response is cached and reused by the overview.
- **Time zone:** every calendar request needs the viewer's IANA zone (`tz`; a missing or invalid one is a 400). The app
  reads it with the `flutter_timezone` plugin (a new dependency, my call: the `timezone` package the app has cannot read
  the device zone), falling back to `UTC` if the plugin fails. The zone is re-read when the app resumes, so travelling
  moves "today" with the user.
- **Code:** new code goes in `mobile/lib/gallery/cleanup/` (`models/`, `repositories/`, `providers/`, `pages/`,
  `widgets/`). Upstream files get registration lines only (see Constraints).
- **Naming:** upstream mobile already has an unrelated "Free up space" feature called cleanup
  (`providers/cleanup.provider.dart`, `CleanupPreviewRoute`, upstream `cleanup_*` i18n keys). Fork classes and routes
  are prefixed `LibraryCleanup…` (`LibraryCleanupOverviewRoute`, …) so nothing collides or reads ambiguously; the
  fork's web `cleanup_*` overlay keys are reused as they already coexist with upstream's.

### Cleanup overview

Mockup `1-flow.html`, screen 2; mirrors the web hub.

- **Header:** "Cleanup", the streak and days reviewed ("5-day streak · 61 of 366 days"), and "Could free <size>" on
  the right, computed as the web hub computes its "Could still free" pill, counting up when it loads.
- **Today card:** a collage of up to three photos from today's date, the eyebrow "Today · <date>", "N photos from Y
  years", the estimate and the busiest year with its city ("About 3 min · 2019 in Lisbon has the most"), and the
  primary button "Start today's rewind". Same data and rules as the web banner: the estimate is the count times the
  web's per-photo pace, omitted below one minute; an empty date disables the button; a reviewed date shows "Reviewed"
  and the button still opens it.
- **Quick wins:** a horizontally scrolling row of photo cards, one per queue in the web order (Space hogs, Bursts,
  Screenshots, Duplicates, Blurry), each with a cover where the web loads one (bursts and duplicates use an icon tile,
  as on web), the name, the web's count label (including "so far" and the analysing percentage) and the bytes it frees. An
  empty queue says "All clear", is quieter, and still opens. Under the row: the trash size and "Empty trash", only when
  the trash is enabled (as on web).
- **Your year teaser:** the current month's days as a small strip, with "See all ›" opening Your year.
- Pull to refresh reloads everything.

### One session screen for every cleanup

The owner wants every cleanup to feel like the same tool, whatever kind of photo is being decided. So the rewind and
every queue run inside **one session screen** (`CleanupSessionScaffold`), and a queue only supplies its data, its
card signal and its filters. Nothing else differs.

- **Top bar, the same everywhere:** ‹ back on the left; the title saying what and where ("29 Oct · 16 of 42",
  "Blurry · 12 of 87", "Bursts · 3 of 24", "Duplicates · 5 of 31"); on the right **Done** with a badge of pending
  changes, and a ⋯ menu holding Swipe / Grid, swipe / button mode, filters (queues) and "How it works". The menu is
  one shape for every cleanup (`LibraryCleanupSessionMenu`: the view, the deck mode, "How it works", and the
  session's own items), and it never offers a choice that does nothing: the series card has one layout, so Bursts and
  Duplicates have no swipe / button entry (see "Queues: Bursts and Duplicates").
- **Swipe / Grid switch** under the top bar, in every cleanup, the rewind included: the same choice as the menu's,
  drawn by the session screen itself, and shown while loading too so the layout does not jump. Not on the finish
  screen.
- **Progress bar under it, the same everywhere:** fills on the gentle spring as cards are decided. In the rewind it is
  split into one segment per year with the current year's label above it ("2019 · 7 years ago"), so the user always
  knows which year they are in and how many are left. In queues whose total is still growing ("so far") the total
  updates in place.
- **The deck or the grid** in the middle (below), with the same info strip and details sheet everywhere.
- **Pending changes and Done:** see "Applying changes": every cleanup collects marks until Done.
- **Back always goes where the user came from:** to the overview, the month screen, or the day sheet they opened the
  rewind from. "Next day" after finishing replaces the session rather than stacking it, so back never walks through a
  chain of days. Back from "Open in library" returns to the same card in the same state; back from the finish screen
  returns to where the session was opened from.
- **The iOS back swipe** asks too. Flutter turns the system back swipe off outright for a route a `PopScope` holds
  (`popGestureEnabled` is false and no pop callback fires, as of Flutter 3.47), so while marks are pending the session
  screen lays its own edge-swipe strip over the leading edge: a swipe that would have popped the page (past half the
  screen, or a fling) shows the same Apply / Discard / Keep going prompt as ‹. With nothing pending the system swipe
  works as usual.
- **Loading** shows a skeleton of the card stack (or grid) in the real layout with the motion kit's sheen
  (`timeline_skeleton.dart` style), never a spinner on an empty screen. Errors show inline with retry and keep the
  top bar, so back still works.
- **First time:** the first session ever shows a short overlay over the first card: a hand demonstrates right = keep,
  left = trash, up = favourite, with one line, "Nothing is deleted until you press Done". Shown once, remembered on the
  device; "How it works" in the ⋯ menu replays it. It counts as seen as soon as it shows (same rule as the web
  explainer). Bursts and Duplicates get the series card's own lesson the first time either opens, with its own flag,
  because its swipes mean other things: right "Keep as set", up "Keep all", left "Trash all" (Duplicates: the hand only
  nudges left and the label reads "Keep at least one copy"), plus how frames are marked. A session that opens in the
  grid shows the grid's "Hold a photo for details" hint instead; that hint is one flag for every grid, also seen as
  soon as it shows.

What each cleanup supplies, and nothing more:

| Cleanup     | Unit on a card | Card signal                                        | Filters (⋯)                       | Suggested choice            |
| ----------- | -------------- | -------------------------------------------------- | --------------------------------- | --------------------------- |
| Rewind      | one photo      | "2019 · 7 years ago", city                         | none                              | none                        |
| Blurry      | one photo      | reason badge, sharpness bar                        | strictness, reason, hide faces    | none                        |
| Screenshots | one photo      | uncropped at its aspect ratio                      | as web                            | none                        |
| Space hogs  | one photo      | file size, large                                   | type, minimum size                | none                        |
| Bursts      | a series       | big frame, filmstrip, "★ Sharpest", sharpness      | as web                            | keep the sharpest           |
| Duplicates  | a group        | big frame, filmstrip, size and resolution per copy | none                              | keep `suggestedKeepAssetIds` |

### Applying changes (the owner's decision: one model everywhere)

Every cleanup, the rewind and all five queues, works the same way: marks build up locally and nothing reaches the
server until the user applies them from Done.

- **Marks:** keep, favourite and trash on a photo; for a series, the frame marks plus "keep all" (Bursts and
  Duplicates) or "dismiss" (Duplicates). Undo is local and steps back one decision.
- **Saved on the device** as they are made (per user and per day, or per user and per queue), so closing the app,
  a crash or a restart loses nothing; reopening restores marks and position with "Restored your marks". Saved marks
  are dropped once applied or discarded, and marks for assets no longer in the day or queue are ignored.
- **Done** opens the finish screen for every cleanup (mockup `5-grid-and-finish.html`, right): kept, favourited,
  marked for trash with its size, and how far the user got. It is a phase of the session page, not a route of its own,
  so back from it returns to the cards, and the session's state is never split across routes. Its actions:
  - **Apply** (queues; "Apply and stop for now" in an unfinished rewind) commits the marks and returns to where the
    session was opened from, with the "Saved" acknowledgement.
  - **Finish day** variants (rewind only; see Rewind).
  - **Review the N first** shows only the photos marked for trash as a grid; a tap rescues one.
- **Closing** with ‹, the iOS back swipe or the Android back button with pending marks asks: Apply / Discard marks /
  Keep going. With none it closes.
- **Large piles:** applying commits in chunks of at most `CLEANUP_MAX_IDS` with the finish screen showing progress; a
  failed chunk keeps the remaining marks pending and says how many were applied (chunks before it stay applied, as on
  web).
- **After applying** in a queue, applied photos leave the queue; marked keeps are recorded so they don't come back.
  Duplicates apply one `POST /duplicates/resolve` per batch of groups and one `DELETE /duplicates/{id}` per dismissed
  group.
- **No undo after applying**, except the trash's 5-second undo toast when the trash is on, which restores exactly the
  ids the server trashed (`restoreAssets`). Kept and favourited photos stay that way; this needs no undo endpoints.
- This differs from the web queues on purpose (they apply each action at once): on a phone, swipes are fast and easy
  to get wrong, and one model is easier to learn.

### The deck (shared by rewind and every queue)

One widget, used everywhere a single photo (or a burst series) is decided.

- **Stack:** the current card on top, the next one behind it, slightly smaller and dimmed.
- **Gestures (swipe mode, the default — the owner's decision):** drag right keep, drag left trash, drag up favourite.
  The card follows the finger 1:1 and rotates slightly; past a threshold a stamp fades in ("KEEP", "TRASH", "♥") with a
  light haptic tick when the threshold is crossed. Release past the threshold, or with enough velocity in that
  direction, throws the card off-screen; otherwise it springs back. A drag down does nothing (springs back).
- **Buttons** under the card do the same: Undo ↶, Trash ✕, Favourite ♥, Keep ✓, Open in library ⤢. A button press
  squishes the button and throws the card in that button's direction with its stamp, exactly as the swipe would, so
  buttons and gestures look and feel the same.
- **Undo** steps back one card and removes its effect, the card flying back in from where it left.
- **Ready before it is on top:** the deck decodes the previews of the top card and the next three, and the thumbhashes
  of the next ten. A card shows its preview only once the preview has decoded (or failed); until then it shows its
  thumbhash with the thumbnail over it, and the preview fades in when it lands. So a throw never uncovers a blank card,
  and a throw is never held back waiting for one.
- **Info strip** on the bottom of the card: the date line (rewind: "2019 · 7 years ago"; queues: the full date), city
  and time, and chips: file size, "In an album" (from `inAlbum`), and "ⓘ Details".
- **Videos:** the poster with a ▶ badge and the duration; tapping ▶ plays it muted inline (my call). The card can be
  swiped while it plays.
- **Tap on the photo** (not on ▶ or a chip) opens the details sheet (my call; drags are taken by the swipes).
- **Button mode:** the photo goes edge to edge, horizontal swipes move between photos without marking, and a floating
  translucent bar holds large labelled buttons: Trash, Favourite, Keep, Undo. Same effects, same info strip and
  details. The swipe / button choice is in the top bar's menu and remembered on the device, one setting for all decks
  (my call). The series card has no button mode: its buttons are always under it and its swipes always decide, so
  both modes would be the same layout, and its menu leaves the choice out.

### Details sheet

Mockup `2-details.html` (approved by the owner).

- Opens from "ⓘ Details", a tap on the photo, or dragging the info strip up; in Grid, a long press on a tile.
- **Half open:** the photo shrinks into the top of the screen, tied to the sheet's drag position, and the sheet shows
  the full date and time, how long ago, the position in the session ("photo 16 of 42 today"), the place with a small
  map, the people recognised, and the albums.
- **Fully open:** camera and lens, exposure, file name, dimensions, megapixels and size, and the queue's own signal
  (sharpness for Blurry and Bursts, the blur reason).
- **Links:** "Open in library" (the normal asset viewer, opened the way the fork's search results open it; back
  returns to the same card in the same state) and "Show that day" (every photo taken that day, not just the cleanup
  ones, in the fork's date-filtered search results view; my call: the main timeline has no jump-to-date, and adding
  one would mean a new hook in upstream timeline code). "Show that day" is a fork page
  (`LibraryCleanupDayPhotosRoute`) that runs the user's own timeline in the fork's search mode with the date filter set
  to the photo's wall-clock day.
- **Everywhere a decision is made, details are one gesture away:** the deck (ⓘ, tap, drag up), every grid (long
  press, with a one-time "Hold a photo for details" hint), the burst and duplicate big frame (ⓘ on the frame), and the
  finish screen's "Review the N first" grid (long press).
- **Actions:** Keep / Favourite / Trash pinned at the bottom of the sheet; choosing one closes the sheet and applies it
  to the card, as the button would.
- **Data:** the cleanup DTO already has date, city, size, dimensions and `inAlbum`. The rest loads when the sheet opens,
  with the same two calls the web photo window makes (`web/src/lib/gallery/asset-context/asset-context-details.svelte`):
  `GET /assets/{id}` for camera, exposure, file name and people, and `GET /albums?assetId={id}` for the albums (a
  failure there shows no albums row, as on web). The mobile viewer reads its details from local Drift, which may not
  hold every cleanup asset, so the sheet does not use it. The sheet opens at once with what the card has and fills the
  rest in place. Duplicates already carry the full asset, so only the albums call is made.
- Read-only: no edit pencils or filter links (same as web).

### Rewind

- **Start** opens the date's photos from every past year, newest year first (as on web), in the deck.
- Runs in the session screen above: "29 Oct · 16 of 42", the per-year progress segments, Done with its pending
  badge.
- **Resume:** photos already decided on an earlier visit (`kept: true`; trashed ones no longer come back) are skipped,
  so a resumed day starts at the first untouched photo. The progress counts them as done.
- **Marks** follow "Applying changes". With saved marks for a day, the overview's today card (or the day sheet)
  reads "Resume · 16 of 42".
- **Grid mode** (the owner's decision): the day's photos in year sections, newest first, each headed "X years ago ·
  city · N photos" with "Keep the rest". A tap cycles the tile's mark none → keep → favourite → trash → none, the
  web grid's order, so favourite is reachable without the details sheet; a long press opens the details sheet. Marks look as on web:
  keep and favourite as a ring plus a corner badge, trash as a desaturated tile with a "Trash" label. Switching between
  deck and grid keeps every mark.
- **Finishing at any point** (the owner's decision):
  - **Done** is always in the top bar and opens the finish screen (mockup `5-grid-and-finish.html`, right): kept,
    favourited, and marked for trash with its size, plus "16 of 42 gone through" when unfinished. Deciding the last
    card in the deck opens the same screen; in the grid it does not, since a tap only steps a tile's mark on and the
    user may still be cycling it, so Done opens it there.
  - All decided: **"Move N to trash and finish"** (or "Finish day" with nothing to trash) commits trash, favourites
    and keeps and sends `completeMonthDay`, which marks the day reviewed.
  - Unfinished: **"Apply and stop for now"** commits what was marked without `completeMonthDay`, so the day stays
    open and resumes at the first untouched photo. Unlike the web's partial apply (`RewindSession.commitTrash`, trash
    only), it sends keeps and favourites too, so resuming on any device skips them (`kept: true`); this difference is
    on purpose. **"Keep the rest and finish day"** adds every untouched photo to the
    keeps and sends `completeMonthDay`.
  - "Review the N first" and closing with pending marks work as in "Applying changes" (the close prompt's Apply reads
    "Apply and stop" here).
  - The commit batches like the web (`web/src/lib/gallery/cleanup/rewind-session.svelte.ts`: chunks of at most
    `CLEANUP_MAX_IDS`, `completeMonthDay` on the last chunk only) and reports skipped ids as the web does.
  - After finishing, the day is celebrated (see "Celebrating a finished day"). Then "Next: <date> · N photos" (the
    next unreviewed day with photos, going forward from this one and wrapping at year end) and "Back to Cleanup".
    Back on the overview (or the month screen), that day's cell turns green with `pop()`.
  - "Apply and stop for now" gets a lighter acknowledgement, not the celebration: the marks fly into the Done button,
    a toast "Saved · 8 moved to trash · pick up at photo 17 any time", and back to where the session was opened from.

### Celebrating a finished day

The owner wants finishing the daily rewind to feel like a reward. It plays once per finished day, only after the user
pressed finish (user-initiated, as the motion rules require), and never for "Apply and stop".

1. The photos marked for trash lift off the summary and fly into the trash icon (`removal.dart`; with the trash off
   they dissolve in place instead).
2. The ring fills on the gentle spring while the counts (kept, favourited, trashed, space freed) count up.
3. As the ring closes: a success haptic and a burst of confetti from the ring's centre in the app's primary colour and
   the mark colours (a new `GalleryCelebrate.dayComplete` in `celebrate.dart`, built like the existing `favorite`
   burst but larger, ~1 s, more pieces).
4. The streak line pops (`pop()`) and its number ticks up ("🔥 6-day streak"). No other streak copy, no nagging. (A "New
   best streak" line was dropped: the calendar response has no longest-streak figure to compare with.)
5. The "Next" and "Back to Cleanup" buttons rise in last on a short stagger.

Reduced motion: no flight, no confetti, no count-up; the ring and counts show filled, the haptic still plays.

Smaller wins get a smaller acknowledgement, never the confetti: emptying a queue shows "All clear" with its check
popping; finishing every day of a month makes the month card glow once on the year screen.

### Queues: Blurry, Screenshots, Space hogs

- **The deck, as above** (the owner's decision), with one queue signal on the card (mockup `3-queues.html`):
  - Blurry: a badge with the reason (Blurry, Too dark, Too bright) and a sharpness bar.
  - Screenshots: shown whole at their own aspect ratio, never cropped (9:19.5 portrait when width or height is
    missing), so the text is readable.
  - Space hogs: the file size large on the card.
- **⚙ filters** in the top bar: the per-queue filters the web has (Blurry: strictness and reason; Space hogs: type and
  minimum size; hide faces where the web offers it). Remembered per queue on the device.
- **When things are deleted:** as in "Applying changes": marks build up until Done → Apply. Favourite favourites and
  keeps (the commit endpoint takes favourites for any queue).
- **Paging:** the queue endpoints are cursor-paged; the deck fetches the next page when about ten cards remain. Marked
  photos stay out of the deck as it pages on.
- **End of a queue:** the last card leads to the finish screen; after applying, an emptied queue shows "All clear"
  with `pop()`, then back to the overview.
- **Grid mode** (the owner's decision: many at once as well as one by one; mockup `5-grid-and-finish.html`, left): a
  Swipe / Grid switch at the top, remembered per queue. Tap selects, drag across selects a run (as on the main
  timeline), long press opens the details sheet, "Select all" selects what is loaded. A floating bar shows "N selected
  · size" with Keep, ♥ and "Trash N", which mark the selection (marks look as in the rewind grid) and clear it; the
  Done badge counts up. Nothing is sent until Done → Apply. Screenshots keep their shape in the grid.

### Queues: Bursts and Duplicates (one series card)

A burst or a duplicate group does not fit one photo per card, so each card is a whole group, and both queues use the
same **series card** (mockup `3-queues.html`, third screen) so they feel the same.

- A big frame (uncropped, on black) with "frame i of N" and the group's badge on the suggested frame, a header, and a
  filmstrip of every frame below it. ⓘ on the big frame opens the details sheet for the frame shown.
- Marks start on the suggestion: the suggested frames kept, the rest marked for trash. A chip summarises "Keep 1 ·
  trash 5 (18 MB)".
- Tap a filmstrip thumbnail to show it in the big frame; tap the big frame to flip the mark of the frame shown.
  Horizontal swipes on the big frame step through the frames; swipes anywhere else on the card decide the group.
- **Swipe right: accept the marks as set. Swipe up: keep all.** Left differs per queue (below). Buttons: Undo, the
  left action, Keep as set, Keep all, and the queue's extra action. Like every other mark, these are pending until
  Done → Apply.
- **Grid mode** for both: a scrolling list of series cards, with "Keep the suggestion for all" for the loaded groups
  (my call).

**Bursts** (the web's `BurstGroupCard` behaviour):

- Header "N photos in S s · date · city"; badge "★ Sharpest"; the sharpness bar per frame in the details sheet.
- **Swipe left: trash the whole series** (my call; the web's resolve already allows zero kept).
- Extra action: Stack instead ▤ (pending like the rest; applied as a stack). Applying uses the same commit and stack
  calls the web `BurstGroupCard` uses.

**Duplicates** (upstream's duplicates API, already in the generated Dart client; no fork endpoint):

- Data: `GET /duplicates` returns every group with full asset info and `suggestedKeepAssetIds`; the count on the
  overview comes from `GET /cleanup/queues/duplicates/count`, as on web. The list is not paged by the server; the deck
  shows it in the server's order.
- The title counts the groups loaded ("Duplicates · 5 of 31"): the list arrives whole, so that is every group the
  server has.
- Header "N copies · date · city"; badge "Suggested"; each filmstrip frame carries its resolution and file size, with
  the largest and the highest resolution highlighted, so copies can be told apart without opening details. The
  details sheet has every field already (the response is a full asset).
- **Swipe left does not trash every copy**: trashing all copies deletes the photo, which is never what clearing
  duplicates means. The card resists (rubber-band) and shows "Keep at least one copy"; to drop a copy, flip its mark.
  This is the only place the left swipe differs, and the reason is shown on the card (my call).
- Swipe up "keep all" means "not duplicates": `DELETE /duplicates/{id}` dismisses the group without deleting anything.
- Applying sends `POST /duplicates/resolve` with each accepted group's keep and trash ids, in batches of at most 50
  groups, and `DELETE /duplicates/{id}` for each dismissed group. The trash rules in "Trash confirmation" apply (spaces lookup, trash
  off). The post-apply undo toast restores the trashed copies with `restoreAssets`; the groups themselves do not come
  back until the server detects them again (stated in the toast).
- A user without the duplicate permission (an API-key session) sees no Duplicates card.

### Trash confirmation

Ported from the web (`web/src/lib/gallery/cleanup/cleanup-actions.ts`, `confirmCleanupTrash`, `isTrashEnabled`,
`commitWithUndo`); every trash commit on mobile goes through the same rules.

- **Trash on** (the server's trash feature flag): trashed photos go to the trash and get a 5-second undo toast that
  restores exactly the ids the server trashed (`restoreAssets`).
- **Trash off:** the commit deletes permanently. Applying asks for a "permanently delete" confirmation first, offers
  no undo, and the photos dissolve in place (`removal.dart` delete kind) instead of flying into the trash. The
  confirmation is asked once, when the user applies or finishes, never per swipe.
- **Shared spaces:** before any trash commit the app asks `POST /cleanup/in-spaces` which of the ids are in a shared
  space. If any are, the user confirms that they will disappear for the space's members too (with the permanent
  sentence added when the trash is off). If the lookup fails, nothing is trashed and an error toast shows.
- **External libraries:** the same lookup returns `externalAssetIds`. If any are being trashed, the confirmation adds
  the web's `cleanup_external_library_warning` sentence (a read-only external library brings the file back at its next
  scan, and no space is freed). With only external photos and the trash on, that sentence alone is the prompt. The
  lookup is chunked at `CLEANUP_MAX_IDS` and the counts summed, as on web.
- Swiping never asks anything; all confirmations happen once, on the finish screen, when the user applies. Cancelling
  a confirmation commits nothing and returns to the finish screen with every mark intact.

### Your year

Mockup `4-calendar.html`; the two-step flow is the owner's decision, following the touch flow of the web calendar
(`CleanupCalendar.svelte`, uncommitted in the `library-cleanup` worktree as of this writing).

- **One look everywhere:** the overview's teaser, the year's cards and the month screen draw their cells with the same
  helpers (`widgets/cleanup_calendar_bits.dart`): the same days of the month from the 1st and the same colours, so the
  teaser never disagrees with the screen it opens.
- **Year:** twelve month cards, three across, scrolling. A month card is the only tap target. Each shows its days as a
  small grid in the web's colours (reviewed green, the web's quartile shades for photos to review, neutral for none,
  today outlined) and "reviewed/days" ("27/31"). The current month is outlined. Days fill from the 1st in seven
  columns and are never aligned under weekdays (a cell is a month-day across all years). February has 29 days.
- **Month:** tapping a card grows it into a full screen of large numbered day cells (at least 40 px tap targets, my
  call), with "‹ Year", the month name, ‹ › and a horizontal swipe to change month (wrapping December → January), and
  "27 of 31 days reviewed · 4 to go".
- **Day sheet:** tapping a day opens a sheet with the date, "N photos from Y years", the estimate and busiest year, up
  to four thumbnails, and "Rewind this day". Tapping another day swaps the sheet in place. A day with no photos says so
  and has no button. A reviewed day says "Reviewed" and the button still opens it.

### Motion

Everything uses the mobile motion kit and its rules (`specs/2026-10-23-mobile-motion-language-design.md`): tokens from
`motion_tokens.dart`, the springs from `spring_curve.dart`, and plain fades or nothing under reduced motion
(`GalleryMotionHost.reduced`). New helpers go in `mobile/lib/gallery/motion/`.

- **Overview arrival:** the today card, the quick-win row, then the year teaser rise in on a short stagger
  (`entrance.dart`); counts count up. Cards squish when pressed (`pressable.dart`).
- **Library → overview:** the Cleanup button squishes, the overview pushes with the app's standard route transition.
- **Overview → rewind:** the today card's collage flies into the first card (hero on the gentle spring,
  `hero_scope.dart`). **Overview → queue:** the quick-win card's cover flies into the first card the same way, so
  every session opens with the same motion. Back reverses the flight into the card it came from.
- **Loading → content:** the skeleton's sheen wipes away into the real cards (`timeline_skeleton.dart`,
  `wave_mask.dart`); no second entrance when data lands.
- **Session top bar:** the progress bar fills on the gentle spring; the title's position and the Done badge count tween
  (`swap.dart`); the badge pops the first time it goes above zero, then stays still. Crossing into a new year in the
  rewind slides the year label in from the right.
- **Swipe ↔ Grid:** the current card shrinks into its tile in the grid (shared-element flight), the other tiles fade
  and settle in on a short stagger; Grid → Swipe reverses it from the first undecided tile. Reduced motion:
  crossfade. The same flight in every cleanup (`widgets/cleanup_view_flight.dart`, on `motion/flight.dart`): the
  rewind and photo queues fly the photo between card and tile, Bursts and Duplicates fly the big frame between the deck
  and the series' card in the list.
- **The deck:** 1:1 drag with slight rotation; the stamp fades in with distance; a throw carries the release velocity
  onto the settle curve; a cancelled drag springs back on the bouncy spring; the card behind grows to full size as the
  top one leaves. Undo flies the card back on the same path.
- **Marks:** favouriting bursts hearts from the card (`celebrate.dart` `favorite`); the departing card tints red for
  trash, green for keep.
- **Details sheet:** the photo's shrink follows the sheet's drag position, so it never disagrees with the finger.
- **Grid:** marks fade in and their badge pops (`pop.dart`), the same mark layer in the rewind grid, the queue grid and
  "Review the N first". Marks are pending, so nothing leaves the grid when one is made; when marks are applied with
  the grid on screen (the close prompt's Apply), the trashed tiles fly into Done (`removal.dart`, or dissolve with the
  trash off) while the grid reflows over the gap.
- **Series card:** changing the big frame crossfades on `quick`; the filmstrip's current frame outline slides to the
  new thumbnail; flipping a mark fades the ring in and pops its check.
- **Applying:** "Apply and stop" flies the marks into the Done button; finishing plays "Celebrating a finished day".
  The finish screen's rows rise in on a short stagger.
- **Next day:** the next day's first card slides in from the right as the finished one leaves to the left.
- **Year → month:** the month card grows into the month screen and shrinks back; changing month slides in the
  direction of travel. The day sheet rises on the platform spring; tapping another day crossfades its contents and
  slides the date a few pixels in the direction of travel. A day finished in the meantime turns green with `pop()`.
- **Undo toast:** slides up from the bottom and its countdown bar drains; pressing Undo flies the photo back into
  its place.
- **Haptics:** a light tick when a swipe crosses its threshold, and on commit.
- **Reduced motion:** no rotation, throws or flights; the card fades out and the next fades in; sheets still slide
  (platform behaviour).

### Performance

- The overview shows the today card from the calendar and rewind-years calls; covers, counts and the trash total load
  after and never block it.
- The deck preloads the preview images of the next three cards and the thumbhashes of the next ten.
- Swiping never waits on the network: every mark is local until applied. A failed apply keeps the unapplied marks
  pending and says how many went through.

### i18n

Every new string goes in `i18n/gallery/en.json` and the nine maintained locales, per `CLAUDE.md`. Reuse the web's
cleanup keys wherever the wording is the same (queue names, count labels, reviewed progress, marks summary, the
calendar day labels) rather than adding mobile copies.

## Constraints

### Layering (`CLAUDE.md` "Gallery sits on top of Immich")

- All new code in `mobile/lib/gallery/cleanup/` and `mobile/lib/gallery/motion/`; tests in
  `mobile/test/gallery/cleanup/`.
- Upstream files get only:
  - `library.page.dart`: one widget line in `_ActionButtonGrid` (the button widget is fork code).
  - `routing/router.dart`: one route registration line per page (and the import). `router.gr.dart` is regenerated.
    Route arguments are plain strings and ints (the month-day, the queue slug, the hero asset id and thumbhash,
    "Show that day"'s `yyyy-MM-dd`), so the generated router imports no fork model or API type.
  - `domain/models/store.model.dart`: **one** key in the fork's existing 90000 block, `libraryCleanupPrefs`, holding
    every remembered cleanup choice as one JSON string (swipe/button mode, Swipe/Grid per queue, filters per queue,
    the first-run overlay and hint flags), read and written by `mobile/lib/gallery/cleanup/cleanup_prefs.dart`.
    Pending rewind marks are stored separately in a fork-owned file in the app's documents directory, not in the
    store, because they can be large.
  - `pubspec.yaml` / `pubspec.lock`: the `flutter_timezone` dependency.
  - `services/api.service.dart`: `late CleanupApi cleanupApi;` and `late DuplicatesApi duplicatesApi;` plus their two
    initialiser lines, next to the fork's existing `sharedSpacesApi` (the client is private, so fork APIs are
    declared there).
- Nothing else upstream: no settings switch, no timeline or viewer hook. A slice that finds it needs another upstream
  touch stops and raises it.
- Every slice that touches an upstream file reports `git diff --stat refs/upstream/vX.Y.Z -- <file>` before and after
  (`vX.Y.Z` is `upstream.version` in `branding/config.json`); the growth is the registration lines only.

### Compatibility

- Stock Immich and Gallery servers without cleanup: no entry, no cleanup requests beyond the probe (see "Where it
  lives").
- The generated Dart client is not committed; every slice that uses new endpoints relies on `mise //mobile:codegen`
  against the spec #1134 already updated.

### Strings, performance, tests

- Strings per "i18n" above, in the slice that adds them.
- Each slice adds its tests in the same commit; nothing is "tested later".

## Testing approach

Bugs here would hide at the seam: the app sending a commit the server reads differently (a `completeMonthDay` on a
partial apply, a page cursor lost, a favourite sent as a keep). So the end-to-end tests cover the mobile ↔ server seam
with recorded real-server traffic, as the mobile search redesign does (`specs/2026-10-23-mobile-search-redesign-design.md`,
"Testing approach").

- **Contract fixtures:** `mobile/test/fixtures/cleanup_contract/*.json`, one request and the real server's response
  per file.
- **Server side:** `e2e/src/specs/server/api/gallery-cleanup-contract.e2e-spec.ts` seeds one library (photos on
  several month-days across years, a reviewed day, blurry, screenshot, burst and large assets; reuse the seeding in
  `e2e/src/specs/server/api/cleanup.e2e-spec.ts`), sends every fixture's request to the real server and asserts the
  response matches. `CLEANUP_CONTRACT_RECORD=1` rewrites the fixtures. Ids and timestamps are normalised to
  fixture-local names, as `gallery-search-contract.e2e-spec.ts` does.
- **Mobile side:** a strict loopback server in `mobile/test/gallery/cleanup/` built like
  `mobile/test/gallery/search/search_contract_server.dart` serves only the fixtures; **a request that matches no
  fixture fails the test**. Tests drive real pages, providers and the generated Dart client with `flutter test`, so CI
  runs them without a device.
- **Widget tests** for gestures use `tester.drag` / `tester.fling` on the deck and assert the resulting effect, not
  internal state.
- **Manual check** (optional, noted in the PR): the slice on the iOS Simulator or Android Emulator against `mise dev`
  (the `mobile-emulator` skill), with seeded data (the `env-prep` skill).

## Gate

The full gate is CI on the PR, read by head SHA. Locally, run the parts the slice touched.

**Mobile:** in this worktree run the codegen steps directly, not through `mise //mobile:codegen` from the main
checkout. With the Flutter version from `mobile/mise.toml` first on `PATH`:

```bash
dart analyze --fatal-infos lib test
dart format --set-exit-if-changed <lib files>
flutter test <touched dirs>
```

Before the PR, run the full `flutter test`.

**E2E API** (slices that add fixtures): `make e2e-api-dev` against a running `mise dev`, scoped to the contract spec.

**Always:**

```bash
node i18n/gallery/merge.mjs --check
npx prettier --check i18n/
make spec-citation-check
make commit-autolink-check
```

## Slices

Each slice is one commit series (or PR) onto `feat/mobile-cleanup`, which goes to `main` as one PR only after every
slice is done and #1134 has landed, so no preview switch is needed. The branch must build and pass tests between
slices. Earlier slices are the baseline for later ones. Every slice that adds a screen or a transition also checks it
on a simulator under reduced motion.

### Slice 1 — Contract fixtures and cleanup core (no UI)

**Goal:** everything the screens need, with no visible change: models, a repository over the generated cleanup API,
the server-support probe, the rewind session, the queue pager, and providers.

**Touches:** new files in `mobile/lib/gallery/cleanup/{models,repositories,providers}/`;
`e2e/src/specs/server/api/gallery-cleanup-contract.e2e-spec.ts`; `mobile/test/fixtures/cleanup_contract/`;
`mobile/test/gallery/cleanup/`.

**Behaviours:**
- **Support probe.** Given a Gallery server with cleanup, the probe returns supported and its calendar is reused by the
  overview provider without a second request. Given a 404 or 403, unsupported. Given a stock Immich server, no request
  is sent and the result is unsupported. Given the server version is still the `0.0.0` placeholder, no request is sent
  until it is known. Given a network error or 5xx, unsupported for now and probed again on the next Library open.
- **Time zone.** Every calendar request carries the device's IANA zone; when the plugin fails it carries `UTC`.
- **Prefs.** `cleanup_prefs.dart` reads and writes the single `libraryCleanupPrefs` key; a missing or corrupt value
  gives the defaults (swipe mode, Swipe for every queue, no filters, overlay not seen).
- **Saved marks.** Pending marks are saved per user and day (rewind) or per user and queue as they change, restored
  on reopen, dropped once applied or discarded, and ignore assets no longer in the day or queue.
- **Rewind load.** For a month-day, the session loads the years, then each year's assets newest year first, and skips
  `kept: true` assets as already done.
- **Session marks.** keep, favourite, trash and undo build the pending marks in order; undo of the first action is a
  no-op; switching deck ↔ grid keeps the marks.
- **Apply and stop.** Sends trash, favourite and keep ids, chunked at `CLEANUP_MAX_IDS`, with **no**
  `completeMonthDay` on any chunk.
- **Finish.** Sends `completeMonthDay` on the last chunk only. "Keep the rest" adds every untouched id to the keeps.
- **Skipped ids** from the commit response are reported to the caller.
- **Trash confirmation.** Before a trash commit the session asks `POST /cleanup/in-spaces`; it reports whether
  confirmation is needed (any id in a space, or the trash off) and never commits when the lookup fails. With the trash
  on, undo restores exactly the ids the server returned as trashed; with it off, no undo is offered.
- **Queue pager.** Requests the first page, then the next page with `nextCursor` when ten items remain; stops at a null
  cursor; passes the queue's filters exactly as the web does.
- **Queue marks.** Queues use the same session as the rewind: marks and local undo send nothing. Apply sends the
  queue's trash, favourite and keep ids in chunks of at most `CLEANUP_MAX_IDS`, never `completeMonthDay`; a failed
  chunk leaves the rest pending and reports how many were applied. After apply, the trash's undo restores exactly the
  ids the server trashed (`restoreAssets`).
- **Next day.** Given the calendar, the next unreviewed day with photos after a month-day, wrapping at year end; none
  when every day is reviewed or empty.

**End-to-end test:** `mobile/test/gallery/cleanup/cleanup_core_contract_test.dart` runs the real providers and the
generated client against the strict contract server: probe, load a day, apply and stop, resume (kept skipped),
finish, page through Blurry, mark several and apply, then undo the trash. An unexpected parameter (a `completeMonthDay` on apply) fails because no
fixture matches. Adds a fixture for a server without cleanup (404) and asserts nothing else is requested.

**Done when:** contract e2e and mobile tests pass; the fixtures are committed; no upstream file changed.

### Slice 2 — Cleanup overview and Library entry

**Goal:** the Library button and the overview from "Cleanup overview". Start, quick-win cards and "See all" navigate
to placeholder routes until their slices land.

**Touches:** `mobile/lib/gallery/cleanup/pages/cleanup_overview.page.dart` and widgets; one line in
`library.page.dart`; route registration in `routing/router.dart`; i18n.

**Behaviours:**
- With the server unsupported, Library shows no Cleanup button.
- With it supported, the button shows at once; its subtitle fills in when today's counts arrive.
- With saved pending marks for today, the today card reads "Resume · 16 of 42".
- The today card renders from the calendar and rewind-years data alone; covers, quick-win counts and the trash total
  arrive after without moving it.
- Empty date: button disabled with the empty copy. Reviewed date: "Reviewed", button enabled.
- Quick wins in the order Space hogs, Bursts, Screenshots, Duplicates, Blurry; count labels and "All clear" use the
  web's wording; Duplicates is hidden without the duplicate permission; the trash line shows only when the trash is
  enabled.
- Pull to refresh reloads every section.
- Motion: staggered arrival; pressing cards squishes; reduced motion shows everything at once.

**End-to-end test:** `cleanup_overview_e2e_test.dart` against the contract server: an ordinary day, an empty day, a
reviewed day, and an unsupported server (no button).

**Done when:** tests pass; the upstream diff of `library.page.dart` and `router.dart` grew by one line each.

### Slice 3 — The deck and the rewind (swipe and button mode)

**Goal:** the shared session screen from "One session screen for every cleanup", the deck from "The deck", and the
rewind in swipe and button mode, with Done, the finish screen, the close guard, the first-run overlay and
"Celebrating a finished day". The details chip and photo tap are wired in Slice 4.

**Touches:** `mobile/lib/gallery/cleanup/widgets/cleanup_session_scaffold.dart`, `cleanup_deck.dart` (and its card,
stamp and button row); `pages/rewind.page.dart`; `pages/rewind_finish.page.dart` (or a sheet; builder's call);
`GalleryCelebrate.dayComplete` in `mobile/lib/gallery/motion/celebrate.dart`; i18n.

**Behaviours:**
- The top bar shows "29 Oct · 16 of 42", one progress segment per year with the current year's label, and Done with
  a pending badge that counts marks.
- Back from the rewind returns to the screen it was opened from; "Next day" replaces the session, so back after two
  "Next"s still lands on the overview.
- The first session shows the gesture overlay once; "How it works" replays it.
- Loading shows the deck skeleton; an error keeps the top bar and offers retry.
- Killing the app mid-session and reopening the day restores the marks and position with "Restored your marks".
- Fling right, left, up give keep, trash, favourite; a short drag springs back with no effect; a drag down does nothing.
- The stamp appears past the threshold; a haptic fires once per threshold crossing.
- The buttons give the same effects as the swipes; Undo brings back the last card with its mark removed.
- "Open in library" opens the asset viewer and back returns to the same card.
- Button mode: horizontal swipes move between photos without marking; the bar's buttons mark. The choice persists.
- Done mid-session shows "16 of 42 gone through" and the three actions; "Apply and stop for now" and "Keep the rest and
  finish day" call the session as Slice 1 defines; finishing the last card shows the all-decided actions.
- Close with pending marks asks Apply / Discard / Keep going; with none it closes. Android back and iOS back swipe do
  the same.
- After finishing: the celebration plays once in the order "Celebrating a finished day" gives (flight, ring and
  count-up, haptic and confetti, streak pop, buttons); reopening a finished day's finish screen does not replay it.
  Reduced motion shows the end state with the haptic only. "Apply and stop" never celebrates.
- "Next" opens the next day; "Back to Cleanup" shows the day's cell turning green.
- Applying with photos in a shared space, or with the trash off, shows the confirmation from "Trash confirmation";
  cancelling commits nothing and returns to the finish screen.
- The next three previews are requested before they are on top.
- Reduced motion: cards fade, no throws.

**End-to-end test:** `rewind_e2e_test.dart`: swipe through a seeded day mixing all three marks, apply midway, reopen
(resumes at the first untouched photo), finish; the requests match the fixtures exactly.

**Done when:** tests pass; tested by hand on one platform's simulator (noted in the PR).

### Slice 4 — Details sheet

**Goal:** the details sheet from "Details sheet", on the deck (and ready for Grid's long press).

**Touches:** `mobile/lib/gallery/cleanup/widgets/cleanup_details_sheet.dart`; the deck; i18n.

**Behaviours:**
- ⓘ, a tap on the photo, and an upward drag on the info strip open it half way; dragging up opens it fully.
- It shows the card's data at once, then camera, people and albums from the asset info call; a failed call leaves the
  card's data and shows no error over it.
- The sheet's Keep / Favourite / Trash close it and apply to the card.
- "Open in library" and "Show that day" navigate and return to the same card.
- The photo's shrink follows the sheet's drag.

**End-to-end test:** extend `rewind_e2e_test.dart`: open details on a card, check the rows, trash from the sheet.

### Slice 5 — Rewind Grid mode

**Goal:** Grid mode for the rewind, from "Rewind".

**Touches:** `mobile/lib/gallery/cleanup/widgets/rewind_grid.dart`; the rewind page; i18n.

**Behaviours:**
- Year sections newest first with "X years ago · city · N photos" and "Keep the rest" (marks every untouched photo of
  that year as keep).
- A tap cycles none → keep → favourite → trash → none; a long press opens the details sheet.
- Switching deck ↔ grid keeps every mark and the position.
- Done, the finish screen and the close guard behave as in Slice 3.
- "Review the N first" on the finish screen opens this grid filtered to trash marks; a tap rescues one.

**End-to-end test:** `rewind_grid_e2e_test.dart`: mark in grid, switch to deck, finish; the commit matches the
fixture.

### Slice 6 — Queues: Blurry, Screenshots, Space hogs

**Goal:** the three queues from "Queues: Blurry, Screenshots, Space hogs", in deck and grid, with filters.

**Touches:** `mobile/lib/gallery/cleanup/pages/cleanup_queue.page.dart`, queue widgets, the filters sheet; i18n.

**Behaviours:**
- Each card shows its queue's signal (reason badge and sharpness; whole screenshot at its aspect ratio with the
  9:19.5 fallback; size).
- Swipes and buttons mark; nothing is sent until Done → Apply; local undo steps back one mark.
- The deck pages on as ten cards remain; the last card leads to the finish screen; an emptied queue shows "All clear".
- Filters change the request exactly as the web does and are remembered per queue. Changing a filter with pending
  marks keeps them.
- Grid: tap selects, drag across selects a run, "Select all" selects what is loaded, the bar shows count and size;
  Keep, ♥ and Trash N mark the selection and the Done badge counts up.
- Apply follows "Applying changes" and "Trash confirmation": one confirmation on the finish screen for a space photo
  or trash off; trash off has no undo and dissolves.
- Killing the app with pending queue marks and reopening the queue restores them.

**End-to-end test:** `cleanup_queues_e2e_test.dart`: swipe through Blurry with a filter, marking all three ways, undo
one, apply, then undo the trash from the toast; select three screenshots in grid, mark them for trash, apply.

### Slice 7 — Bursts and Duplicates

**Goal:** the shared series card and its grid list, for both queues, from "Queues: Bursts and Duplicates".

**Touches:** `mobile/lib/gallery/cleanup/widgets/series_card.dart`; the queue page; a duplicates repository over the
generated upstream duplicates API; contract fixtures for `GET /duplicates`, `POST /duplicates/resolve` and
`DELETE /duplicates/{id}`; i18n.

**Behaviours (Duplicates):**
- Marks start on `suggestedKeepAssetIds`; each frame shows its resolution and size, the largest and sharpest-resolution
  highlighted.
- Swipe right accepts the marks; swipe up marks the group dismissed; swipe left rubber-bands with "Keep at least one
  copy" and marks nothing. Nothing is sent until Done → Apply, which sends `POST /duplicates/resolve` for accepted
  groups and `DELETE /duplicates/{id}` for dismissed ones.
- A group whose marks would trash every copy cannot be accepted (Keep as set is disabled with the same message).
- Trash follows "Trash confirmation"; the post-apply undo restores the trashed copies and says the groups will not
  come back.
- No duplicate permission: no Duplicates card on the overview and no duplicates request.

**Behaviours (Bursts):**
- The suggested frame starts kept, the rest trash; the chip shows the counts and size.
- Tapping a thumbnail shows it; tapping the big frame flips its mark; horizontal swipes on the big frame step frames.
- Swipe right accepts the marks as set; left marks every frame for trash; up keeps all; Stack instead marks the series
  to stack. Local undo steps back one series. On apply, each sends the same ids and calls the web `BurstGroupCard`
  sends.
- The post-apply undo restores the trashed frames, as the web's `restoreGroups` does; kept frames stay kept.
- Previews of a series load when it is next or on top, not for the whole page.
- Grid list: "Keep the suggestion for all" accepts every loaded series on its suggested frame (pending until apply).

**End-to-end test:** `cleanup_bursts_e2e_test.dart`: accept one series as set, change a mark on another, stack a
third, apply once; the requests match the fixtures. `cleanup_duplicates_e2e_test.dart`: accept a group on the
suggestion, flip a mark and accept another, dismiss a third, apply; try to trash every copy and assert it cannot be
accepted and nothing is sent.

### Slice 8 — Your year

**Goal:** the year, month and day sheet from "Your year", the overview teaser's "See all", and the day's rewind from
the sheet.

**Touches:** `mobile/lib/gallery/cleanup/pages/cleanup_year.page.dart`, `cleanup_month.page.dart`, the day sheet; the
overview teaser; i18n.

**Behaviours:**
- Only month cards are tappable on the year screen; each shows "reviewed/days" and the web's colours; today and the
  current month are outlined.
- Days fill from the 1st in seven columns with no weekday offset; February shows 29 days.
- The month screen's cells are at least 40 px; ‹ › and horizontal swipes change month and wrap at the year's ends.
- Tapping a day opens its sheet; tapping another swaps it in place; empty and reviewed days follow "Day sheet".
- "Rewind this day" opens that day's rewind; finishing it shows the day as reviewed on return.
- Accessible labels reuse the web's `cleanup_calendar_day_label*` wording.

**End-to-end test:** `cleanup_year_e2e_test.dart`: open a month, pick a day, rewind and finish it, return and see it
reviewed.

### Slice 9 — Consistency and polish pass, docs

**Goal:** walk every cleanup end to end on both platforms and make them match; write the user docs.

**Touches:** whatever the walk finds; `docs/docs/features/cleanup.md` (a mobile section; run prettier).

**Behaviours:**
- For each of Rewind, Blurry, Screenshots, Space hogs, Bursts and Duplicates: the same top bar, progress, Done badge,
  ⋯ menu, deck gestures and buttons, info strip, details sheet, grid switch, loading skeleton, error state, undo and
  back behaviour. A widget test per cleanup asserts the session scaffold's parts are present, so a later change cannot
  quietly drop one.
- Every transition in "Motion" plays on a simulator with no jank (no dropped frames in the profile build's
  performance overlay on a mid-range Android device or emulator) and degrades as described under reduced motion.
- With an unsupported server, nothing changes from today's app.

**Done when:** full `flutter test`, the full gate and CI pass; the upstream diff report for every upstream file in
"Constraints" is in the PR description and shows only the listed lines.

**Guard:** `cleanup_session_consistency_test.dart` walks all six cleanups the same way, with and without reduced
motion: loading (top bar, progress, Swipe / Grid, the deck skeleton, Done waiting), the inline error and Retry, the
title, the menu (with swipe / button mode only where the deck has both), "How it works", the deck's buttons, details,
a decision and Undo, the close prompt from ‹ and from the iOS back swipe, and the grid with its details on a hold.

## Decisions record

- **Queues collect marks until Done, like the rewind** (the owner, 2026-10-29). Rejected: applying each queue action at
  once with an undo toast (the web queues' behaviour), because it made the rewind and the queues behave differently
  and needed server-side undo for keeps and favourites. Accepted cost: the phone's queues differ from the web's, and
  long queues build a pending pile, saved on the device.
- **Duplicates are in scope** (the owner, 2026-10-29), through upstream's duplicates API with no fork endpoint.

## Left to the builder

- Exact sizes, spacing, thresholds, velocities, durations and haptic strength within the rules above.
- Where the Swipe / Grid and swipe / button switches sit in the top bar.
- Video inline playback details (muted, looping or not).
- Storage keys for the remembered choices.
