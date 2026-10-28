# Library Cleanup: hub and rewind redesign

Revises the visual design of two pages from `specs/2026-09-23-library-cleanup-design.md`: the Cleanup hub
(`web/src/routes/(user)/utilities/cleanup/+page.svelte`) and the rewind day page
(`.../cleanup/rewind/[monthDay]/.../RewindDay.svelte`). Behaviour, endpoints and data stay as that design
describes unless this document says otherwise.

Mockups:

- Hub: `specs/mockups/2026-10-28-cleanup-hub-combined-v2-mockup.html`
- Rewind day: `specs/mockups/2026-10-28-cleanup-rewind-day-mockup.html`

The mockups use placeholder photos, numbers and a fixed dark palette. Build with the app's theme tokens
(`@immich/ui`, Tailwind theme colours) so light mode works too; match layout, hierarchy and shape, not hex
values.

## Why

The owner opens Cleanup to do the daily clean-up quickly, then to see whether anything else is quick to do.
The current hub reads as a utility screen: a 366-cell grid dominates the page, the day preview is a separate
card below it, and the queues are a plain list in a side rail. The owner likes being able to see every day,
but finds the full grid overwhelming, and wants the page to feel like a modern app that makes the job easier.

Success: opening Cleanup, the first thing on screen is today's rewind with one obvious button; the second is
a row of queues showing what is quick to win; the year is still there but no longer the centrepiece.

## Goals

- Today's rewind is the hero of the hub, with one primary action.
- Queues read as inviting, photo-led cards that show what each one frees.
- The year calendar stays, compact and secondary.
- Rewind explains itself to a first-time user: it shows every photo taken on this date in every past year.
- Both pages feel consistent with the motion language already wired into Cleanup
  (`specs/2026-10-23-web-motion-language-design.md`).

## Non-goals

- No new endpoints or changes to what the queues, calendar or rewind contain. (One exception may be needed
  for the banner collage; see "Today banner".)
- Space hogs keeps its current design. Blurry, Screenshots and Bursts change only as "Queue pages: seeing
  photos properly" describes.
- One-at-a-time rewind mode keeps its layout; it only picks up the shared styling (tile radius, floating
  bottom bar, header).
- Mobile app: unchanged.

## Anti-goals

- The hub must not get slower to show its primary action: the banner and the Start button render from data
  the page already loads; anything extra loads after and must not block them.
- No dark patterns around the streak (no guilt copy, no nagging).
- The calendar must not imply weekdays. A cell is a month-day across all years, so cells are not aligned to a
  weekday grid.

## Hub

Top to bottom (see the hub mockup). On narrow screens everything stacks into one column.

### Header

- Title "Cleanup".
- Subtitle: streak and days reviewed (the data the current subtitle shows: `calendar.streak`,
  `calendar.daysReviewed`, out of 366).
- The "Could still free" pill on the right, unchanged in meaning (it keeps counting up with `countMotion`).
- The page keeps its breadcrumbs (Utilities / Cleanup) for navigation, styled quietly.

### Today banner

A wide card with a subtle primary-tinted gradient:

- Left: a collage of up to five photos taken on this date (one large, four small; the last small cell shows
  "+N" when there are more).
- Right: an eyebrow "Today · <date>", a large line "N photos from Y years", a muted line with a time estimate
  and the year with the most photos plus its city when known (for example "About 3 minutes. 2019 in Lisbon
  has the most."), and the primary button "Start today's rewind" linking to today's rewind.
- **Hover preview replaces the separate peek card.** Hovering or focusing a calendar day swaps the banner to
  that day (eyebrow shows that date, button reads "Rewind this day"); leaving the calendar returns it to
  today. Reuse the current peek logic (`startPeek`, debounce, cache, abort).
- **The banner stays pinned at the top while the page scrolls** (the owner's decision), so a day hovered in
  the calendar further down is always previewed in view. My call on the shape: once pinned, it condenses
  into a slim bar (a few small thumbnails, the date, "N photos from Y years" and the button) so it does not
  cover the queue cards; scrolled back to the top it returns to full size. It pins below the app's top bar,
  not over it.
- Empty date (0 photos): the banner says so plainly and the button is disabled. A fully reviewed date shows a
  "Reviewed" state instead of the estimate, and the button still opens it.

Data: `getCleanupRewindYears` gives per-year counts (photos, years, which year has the most). The collage and
the city come from `getCleanupRewindAssets` for one year. The current peek loads only the most recent year;
the builder may load the year with the most photos instead (one request, gives both collage and city), or
mix photos across years if it costs at most one extra request. The time estimate is the photo count times a
fixed per-photo pace (builder's call, around 4 seconds), rounded to whole minutes, and omitted below one
minute.

### Quick wins

- A heading "Quick wins", with a small trash line on the right: the trash size and an "Empty" action, shown
  only when the trash is enabled (today's rail footer, moved here).
- One photo card per queue, in today's rail order: space hogs, bursts, screenshots, duplicates, blurry. The cover is
  the queue's first item where the hub already loads one (`COVER_QUEUES`); bursts and duplicates use an icon
  tile on a tinted background, as the rail does today. A gradient over the bottom carries the name, the count
  label (existing `countLabel` wording, including "so far" and the analysing percentage) and the bytes it
  frees.
- A queue with nothing in it shows "All clear" and is visually quieter, but still links to its page.
- Duplicates links to the duplicates utility, as today.
- Grid: five cards fit one row on wide screens; they wrap on narrower ones. Builder's call on exact columns.
- Loading: skeleton cards of the same shape.

### Your year

- A card titled "Your year" with a muted hint "Pick any day to rewind it".
- Twelve small months in one row on wide screens (six per row when narrow), each a month label over a grid of
  seven columns filled from the 1st in order. Days do not start under a weekday.
- Cell colours and states are today's: shades for photos to review (the quartile shading already in
  `cleanup.ts`), reviewed in success green, no photos in the neutral tone, today outlined. The current
  month's label is emphasised.
- Hover/focus previews the day in the banner; click opens its rewind. Keyboard focus and the existing
  accessible labels (`cleanup_calendar_day_label*`) carry over.
- The legend stays below the months.
- Cells keep `data-no-press` (the site-wide hover scale fights their own). See Motion for their hover.

## Rewind day

Top to bottom (see the rewind mockup).

### Header

- A back link to Cleanup (the breadcrumb, quieter).
- The date as the title, with an info button (ⓘ) next to it that opens the explainer.
- Subtitle: "N photos · taken on this day in Y different years".
- Right side: previous and next day buttons and the Grid / One at a time switch as a segmented control.

### Explainer

- A card with a stack of three photos from the date and:
  - a title "Every <date>, all in one place";
  - two sentences: Rewind gathers the photos taken on this date in every past year; going through one date a
    day tidies the whole library a little at a time;
  - the three marks with their keys (Keep K, Favourite F, Mark for trash Delete) and the line "Nothing is
    deleted until you press Move to trash."
- **Shown automatically once**, on the user's first rewind (the owner's decision). It counts as seen as soon
  as it has been shown, whether or not the user closes it with ×, so the next rewind opens without it. The ⓘ
  next to the title reopens it at any time; × closes it.
- It sits between the header and the progress bar, so it appears in both Grid and One at a time mode
  (builder's call: the first rewind may open in either mode, and the explainer is not part of either
  layout).
- "Seen" is remembered in browser storage (wrapped in try/catch like `cleanup.rewind.mode`), so a new browser
  shows it once more. This was a deliberate call: it is a hint, not account state.

### Progress

A thin progress bar with "N of M reviewed" on the left and the mark counts with the trash size on the right
(today's `cleanup_reviewed_progress` and `cleanup_marks_summary`).

### Year sections

- Newest year first, as today.
- Header: the year large, then "X years ago · <city> · N photos" muted, and "Keep the rest" on the right
  (or the "Year reviewed" badge).
- Tiles: rounded (about 12px), with today's marks restyled: keep and favourite as an inner ring plus a corner
  badge, trash as a desaturated photo with a "Trash" label. Focus outline in the primary colour.

### Bottom bar

- A floating, rounded, translucent bar (backdrop blur), sticky at the bottom.
- Left: the shortcut keys, always visible (the current legend), and the keyboard-shortcuts button.
- Right: "Move N to trash" (danger) and "Finish day" (primary).
- Behaviour unchanged (confirmation, undo toast, finish flow, leave guard).

## Motion

The owner wants both pages to feel premium and sleek, so motion is part of the design, not polish for later.
Everything uses the motion language (`specs/2026-10-23-web-motion-language-design.md`, helpers in
`web/src/lib/gallery/motion/`) and follows its rules: only `scale`, `translate`, `opacity`, `filter` and
colours; nothing the user waits on runs past `--motion-slow`; celebrations stay rare and user-initiated;
under `prefers-reduced-motion` movement drops to plain fades or nothing. New helpers go in that folder.

### Hub

- **Arrival.** The banner, then the quick-win cards, then the months rise in on a short stagger (about 40 ms
  apart, the whole sequence under 400 ms) with `data-motion-reveal`. Skeletons are replaced in place, with
  no second reveal when data lands.
- **Banner day swap.** Hovering a day crossfades the collage photos and slides the text a few pixels in the
  direction of travel (later day: from the right). Counts ("N photos from Y years") tween with `countMotion`.
  Returning to today plays the same swap in reverse. Fast hovering never queues swaps: only the latest day
  animates.
- **Banner pin.** Pinning condenses the banner on the settle curve: the collage shrinks into the slim bar's
  thumbnails and the headline scales down, with `translate`/`scale` and a crossfade between the two
  layouts. No height animation on layout properties: the condensed bar is a separate layer.
- **Quick-win cards.** Hover lifts and tilts the card (`data-motion-lift-group` / `data-motion-lift`, the
  existing tilt), and the cover zooms in slightly inside its frame. Counts and bytes count up the first
  time they load. A card that is empty shows its "All clear" check with `pop()`.
- **Calendar.** Cells do not scale on hover (they are too small, and the scale caused smearing): the hovered
  cell brightens and gets a soft primary ring instead. Today's cell pulses its outline once on arrival. When
  the user comes back from finishing a day, that day's cell turns green with `pop()`; the rewind page tells
  the hub which day it finished (navigation state or a store, builder's call).
- **"Could still free"** keeps its count-up; when a queue's bytes change after returning from a queue page,
  it tweens to the new value.

### Hub to rewind

- **Shared-element morph.** Pressing Start (or a calendar day) morphs the banner collage into the rewind
  header's photo stack and the banner date into the page title, using the View Transitions API through
  `page-transition.ts`. The elements get a `view-transition-name` only while the transition runs (rule 6),
  and everything else crossfades as today. Browsers without View Transitions, and reduced motion, swap pages
  instantly.

### Rewind day

- **Explainer.** Opens and closes by sliding its height (`slideMotion`) with a fade; the ⓘ button rotates
  slightly while open. On the first visit it reveals after the header, not with it.
- **Marking a photo.** The ring colour fades in, the corner badge pops (`pop()`), and a trash mark
  desaturates and dims the photo over `--motion-base` instead of snapping. A favourite still bursts hearts
  (already built). Undo reverses the same transitions.
- **Progress.** The bar fills on the gentle spring and the summary counts tween; reaching 100% gives the bar
  a single soft glow.
- **Year reviewed.** The "Year reviewed" badge pops in when the last photo of a year is marked.
- **Bottom bar.** Rises in on arrival. "Move N to trash" pulses once when its count first goes above zero,
  then stays still. Counts in the bar tween.
- **Move to trash and Finish day.** Unchanged from what is built: photos fly into the Trash link and the
  grids close the gap (`flipMotion`); finishing celebrates, then the next day arrives with the page
  crossfade.
- **Day to day.** Previous and next day slide the year sections in the direction of travel (next: from the
  right), instead of a plain crossfade.
- **One at a time.** Keeps its current motion (each photo fades and drops in); the shared styling picks up
  the bottom bar and badge motion above.

### Tests and checks

- Unit tests cover the new helpers' reduced-motion behaviour, as `list.spec.ts` does.
- Before handing over, check the motion in a real browser (dev stack on `:3000`): no layout shift, no
  scrollbars appearing during animations, no smearing on the calendar, and nothing stuck after fast
  hovering.

## Queue pages: seeing photos properly

The owner's request: on the queue pages the thumbnails are too small to decide, and there is no way to see a
photo bigger or learn anything about it. Double-click opens the full asset viewer today, but nothing on the
page says so, and the viewer gives no queue context. This follows the face suggestions review
(`specs/2026-09-03-face-cleanup-photo-context-design.md`, #1079), which solved the same problem there.

Mockup for the bursts layout and the photo window: `specs/mockups/2026-10-28-cleanup-bursts-mockup.html`
(option A, plus the "open any frame" window at the bottom; options B and C were not chosen).

### Photo window (shared)

One modal, used by the Blurry, Screenshots and Bursts queues.

- **Opening it:** each tile or frame gets a small round expand button in its corner, on a dark translucent chip
  so it reads on any photo. On pointer devices it appears on hover and keyboard focus; on touch it is always
  visible. Pressing it never toggles the tile's selection or mark. Space on a focused tile opens it too (my
  call: replaces Space opening the full viewer; double-click still opens the viewer).
- **Layout:** the photo on the left, as large as the viewport allows and never cropped (preview size, thumbhash
  while loading; videos show their poster with a ▶ badge and do not play). An information panel on the right,
  always visible (the owner wants to see information about the photo, not dig for it). On narrow screens the
  panel moves below the photo.
- **Information:** taken date and time, place, camera and exposure, file name, dimensions and size, people
  recognised, albums, and the queue's own signal: the reason for Blurry (Blurry, Too dark, Too bright), the
  sharpness bar and rank within the series for Bursts ("Sharpest of the 8"). Read-only, like face review: no
  edit pencils or filter links. The builder reuses the data loading and rows of face review's
  `suggestion-asset-details` / `suggestion-asset-summary` (`web/src/lib/gallery/people/`), moved to a neutral
  folder (for example `web/src/lib/gallery/asset-context/`) and given an always-open layout for this window,
  with face review's collapsible use unchanged.
- **Links:** "Open in new tab" (`Route.viewAsset`) and "Open in viewer" (the full viewer in place).
- **Actions:** Keep and Trash for the photo shown, through the queue's existing paths (`keep`, `trashWithUndo`,
  burst marks), with their confirmation, undo and animations. Blurry and Screenshots also get Select /
  Deselect, mirroring the tile. After Keep or Trash in Blurry and Screenshots the window moves to the next
  photo, and closes past the last. In Bursts, Keep and Trash set the frame's mark in its series (nothing is
  committed until the series' own button, as today) and the window stays on the frame.
- **Moving:** previous and next arrows and ← / →. In Blurry and Screenshots they step through the photos
  loaded on the page in grid order, loading the next page at the end as the grid does. In Bursts they step
  through the frames of that series only.
- **Keys** (shown in the window, face review's keycap style): ← → move, K keep, Delete trash, Space select
  (Blurry and Screenshots), O open in new tab, Esc close.
- **Motion:** the window grows out of the tile that opened it and shrinks back into it on close (reduced
  motion: fade). Stepping slides the photo in from the direction of travel.

### Bursts: big frame and filmstrip

Each series card (`BurstGroupCard`) becomes:

- **Header:** "N photos · S seconds" (the span between first and last frame), the date and city, and the
  existing actions on the right: Keep all, Stack instead, and "Keep X · trash Y".
- **Big frame:** the series' current frame shown large (preview size, 3:2 area, `object-fit: contain` on a
  black background so nothing is cropped), with "★ Sharpest" on the suggested frame, its keep or trash mark,
  and "Frame i of N · time". Clicking it, or K, toggles the mark of the frame shown. Its expand button opens
  the photo window.
- **Filmstrip:** every frame of the series as a row of square thumbnails under the big frame, with today's
  marks (kept ring and check, trashed greyed with a label). Hovering a thumbnail, or ← / → while the card has
  focus, shows that frame in the big frame. Clicking a thumbnail toggles its mark, as clicking a tile does
  today. The current frame has the focus outline.
- **Sharpness:** a small panel beside the big frame with a sharpness bar per frame, best first (the score is
  already in `CleanupAssetDto.sharpness`; frames without a score show none). On narrow screens it folds under
  the filmstrip. Builder's call whether it lists every frame or the best few plus the current one.
- **Defaults and commit:** unchanged: the suggested frame starts kept, the rest marked for trash, and the
  series' button commits through `commitWithUndo`.
- **Loading:** the big frame loads its preview only when the card nears the viewport, and the neighbouring
  frames' previews preload when the card is focused or hovered, so a long list does not fetch every preview up
  front.
- **Motion:** swapping the big frame crossfades on `--motion-quick`; marks fade and their check pops (`pop()`),
  as in rewind; a resolved series leaves with the existing trash animation and the list closes the gap
  (`flipMotion`).

### Tests

- The expand button opens the photo window for its own photo and changes no selection or mark; Space opens it;
  double-click still opens the viewer.
- In Blurry and Screenshots, ← / → step through the loaded photos, Keep and Trash call the queue's paths and
  advance, Select toggles the grid's selection.
- In Bursts, hovering or ← / → changes the big frame, clicking the big frame or K toggles its mark, the window
  steps only within the series, and committing still sends the same keep and trash ids.
- Face review's existing specs still pass after the components move.

## i18n

New and reworded strings go in the overlay, `i18n/gallery/en.json` plus the nine maintained locales, per
`CLAUDE.md`. Strings the redesign removes (for example `cleanup_day_peek_hovering` if the banner no longer
uses it) are deleted from the overlay in all locales after grepping web and mobile.

## Tests

- Update the existing hub, calendar, rail and rewind specs to the new structure; keep their behavioural
  assertions (counts settle before "Could still free" shows, covers are not loaded for bursts, peek debounce
  and abort, trash footer hidden when the trash is off).
- New: the banner swaps to a hovered day and back; the explainer shows on first visit, not on the second,
  and reopens from ⓘ; a queue with a count of zero shows "All clear".
- e2e (`e2e/src/specs/web/`): adjust selectors in the existing cleanup flows; keep their coverage.

## Left to the builder

- Exact spacing, breakpoints, card heights and the five-card grid columns.
- Which year the banner collage comes from (see "Today banner").
- The per-photo pace for the time estimate.
- Whether `CleanupQueueRail` is restyled into the quick-wins grid or replaced by a new component; the old
  rail can be deleted if nothing else uses it.
- Exact durations and stagger values within the limits above.
