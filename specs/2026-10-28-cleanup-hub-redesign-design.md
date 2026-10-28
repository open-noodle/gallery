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
- The queue pages (space hogs, bursts, screenshots, blurry) keep their current design.
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
- Cells keep `data-no-press` (the site-wide hover scale fights their own) and the padding fix in
  `CleanupCalendar.svelte`; small cells may drop the hover scale entirely if it looks noisy.

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
- Motion details within the existing helpers (`data-motion-reveal` for the banner swap, `flipMotion`,
  `countMotion`).
