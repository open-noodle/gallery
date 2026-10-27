# Mobile motion language

Status: two waves implemented. Code: `mobile/lib/gallery/motion/`. Companion to
`specs/2026-10-23-web-motion-language-design.md` (web motion PR #1235); the goal, the rules and the token values are the
same, so the two apps move alike.

## Why

Opening the app felt cheap: a static splash logo cut to a spinning logo on an empty screen, then the
whole grid switched on at once (each tile faded from grey in 100ms). Tabs cross-faded for 600ms from
an empty frame, so a tab switch felt slow. Nothing responded to a finger.

## First wave: opening the app

| Moment                        | Before                                         | Now                                                                                                    | Where                                    |
| ----------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------- |
| Splash → app shell, login → shell | Platform push (iOS slides in from the right) | The shell fades in while settling from 104% (420ms, settle curve): the splash dissolves into the grid | `transitions.dart`, `router.dart` fork block |
| Timeline loading              | Rainbow-ring spinning logo, centred            | Skeleton grid in the real layout (columns, spacing, month headers) with a slow diagonal sheen           | `timeline_skeleton.dart`                 |
| Photos arriving               | Grid switches on                               | The skeleton's copy wipes away in a soft diagonal wave from the top-left (520ms); photos are live under it | `timeline_skeleton.dart`, `wave_mask.dart` |
| Each thumbnail decoding       | 100ms fade                                     | 160ms (`GalleryMotion.quick`) fade from the thumbhash                                                    | `thumbnail.widget.dart` (one token)       |
| Switching tabs                | 600ms linear fade from empty                   | 260ms: fade in over the first 60%, settle from 98.5%                                                    | `transitions.dart`, fork tab shell        |
| Pressing a nav tab / search   | Colour change only                             | Squish to 88% / 86%, spring back on the bouncy spring; a quick tap waits for the dip to land           | `pressable.dart`, fork nav widgets       |

## Second wave: touching and changing photos

| Moment                         | Before                                 | Now                                                                                                          | Where                                         |
| ------------------------------ | -------------------------------------- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------- |
| Opening / closing a photo      | Hero flight on a straight tween        | The same flight on the gentle spring: it lands with a slight (~7%) overshoot, both into the viewer and back into its tile | `hero_scope.dart`, `spring_curve.dart`       |
| Pressing a photo tile          | Nothing                                | Squish to 95% after a 70ms rest, spring back; moving past the touch slop (a scroll) lets go at once         | `gallery_tile.dart`, `pressable.dart`         |
| Pressing a space card          | Nothing                                | Squish to 96%, same rules                                                                                    | `pressable.dart`, fork `space_card.dart`      |
| Favouriting                    | Toast only                             | A ring and seven hearts burst from the tapped heart (780ms, bouncy spring)                                   | `celebrate.dart`                              |
| Trashing / archiving / unarchiving | Tiles vanish on sync               | Each visible photo lifts, then arcs along a Bézier into the button that was pressed, shrinking and turning   | `removal.dart`                                |
| Deleting permanently           | Tiles vanish on sync                   | Each visible photo loses its colour, blurs and dissolves where it stood                                      | `removal.dart`                                |

The hero spring comes from a `HeroController` given to the root navigator through a
`HeroControllerScope` in `MaterialApp.builder`. A hero's own `createRectTween` still wins, so no
upstream hero changes; every other hero flight in the app gets the spring. The flight is the
route's 300ms with the hero's `fastOutSlowIn`, and the spring is applied on top of that, so the
overshoot lands in the second half.

Removals copy, they do not move, and they only play for a real removal. `GalleryTile` registers
each mounted tile by remote id. The action calls `GalleryRemoval` before awaiting the server; each
visible tile gets a copy in the root overlay that rests exactly over it (indistinguishable from the
tile). A copy plays only when its tile leaves the grid, which is when the change has synced. If the
same photo is back on screen in the next frame, the grid merely rebuilt and the copy is dropped. If
no tile leaves within 6s (a failed request, demo mode's 403), the copies are removed unseen. While
copies wait, nothing redraws; frames run only while one flies. Only tiles on the current route, in
an active tab and on screen are copied, at most 24, in reading order. Actions run from the photo
viewer have no tile on screen and play nothing. The burst and the throw start or end at the last
pointer press, tracked by `GalleryMotionHost` through the global pointer route; the tab shell
attaches the root overlay. The favourite burst runs after the server accepted the change.

Pages pushed on top of the shell keep the platform's own transitions (iOS Cupertino slide with edge
swipe-back, Android predictive back with fade-forwards, both Flutter's defaults). They are already
good and changing them would touch the theme and the iOS swipe-back fix (#899) for no gain. The shell's
custom route hands its `secondaryAnimation` to the theme's builder so the shell still makes the
platform's exit when something is pushed over it.

## Tokens

`motion_tokens.dart` mirrors web's `tokens.ts`: durations `instant` 90ms, `quick` 160ms, `base` 240ms,
`slow` 400ms; curves `standard` (0.2, 0, 0, 1), `settle` (0.22, 1, 0.36, 1), `exit` (0.3, 0, 0.8,
0.15); springs `gentle` (k 300, c 22), `snappy` (k 600, c 34), `bouncy` (k 380, c 16), all mass 1.
Flutter runs the springs natively (`SpringSimulation`), so there is no sampled `linear()` table.

## Rules

Web's rules apply. On mobile in particular:

1. **Never block.** The load wave ignores touches and the photos under it are live from the first frame.
2. **Reduced motion** (`MediaQuery.disableAnimations`, the OS setting): no squish, no settle or scale;
   the sheen stands still, the wave becomes a 160ms fade, transitions only fade.
3. **Raw pointers for press feedback.** `GalleryPressable` listens with a `Listener`, so it never joins
   the gesture arena and cannot change what a tap, long-press or drag does.
4. **The wave departs from the skeleton, not around the timeline.** Wrapping the timeline body would
   re-indent ~250 lines of `timeline.widget.dart`. Instead the skeleton keeps an empty overlay entry
   while it shows (inserted after its first frame, since entries cannot be inserted mid-build). When
   the skeleton deactivates, it hands that entry the rect it last painted at and only marks it for
   repaint, so a frozen copy shows in the same frame the photos replace it, then wipes itself away.
   It is skipped when the skeleton's route is not current (a page was pushed over it, or it is being
   popped), and when the overlay already dropped the entry (the whole tree is being torn down). It
   stops `bottomNavHeightProvider` short of the bottom so it never paints over the floating nav pill.
6. **Press inside scrolling content waits.** Photo tiles and cards use a 70ms press delay and let go
   past the touch slop, so a fling never flashes the items it starts on. Controls outside scrolling
   content (nav tabs, search) dip at once.
7. **Removals never block and never claim a change that did not happen.** Copies are drawn in an
   `IgnorePointer` overlay, the real tiles are never touched, and a copy moves only once the timeline
   itself dropped its tile.
5. **Layering.** All logic lives in `mobile/lib/gallery/motion/`. Fork files (tab shell, nav pill,
   search blob, the `router.dart` fork block) call it directly.

## Upstream hooks

| Upstream file                                          | Change                                                                    |
| ------------------------------------------------------ | ------------------------------------------------------------------------- |
| `presentation/widgets/timeline/timeline.widget.dart`   | The loading sliver is `GalleryTimelineSkeleton()` instead of the spinner; one import swapped |
| `presentation/widgets/images/thumbnail.widget.dart`    | Fade duration reads `GalleryMotion.quick`; one import                      |
| `routing/router.dart`                                  | One import; the shell route change sits inside the existing fork block    |
| `main.dart`                                            | `MaterialApp.builder` wraps the app in `GalleryHeroScope`; one import     |
| `presentation/widgets/images/thumbnail_tile.widget.dart` | The hero's thumbnail is wrapped in `GalleryTile`; one import             |
| `presentation/actions/favorite.action.dart`            | `GalleryCelebrate.favorite(when: shouldFavorite)` after success; one import |
| `presentation/actions/delete.action.dart`              | `GalleryRemoval.send` before trashing, `GalleryRemoval.dissolve` before deleting; one import |
| `presentation/actions/archive.action.dart`             | `GalleryRemoval.send` before the visibility update; one import            |

## Next candidates

- A corner-radius morph during the photo-open flight needs a `flightShuttleBuilder`, which the
  upstream tile already sets for its indicators; it would mean editing that builder, not adding a hook.
- Press feedback on album cards and the Library page cards (upstream widgets, one wrapper each).
- Restoring from the trash could throw the photos back out of the restore button, and adding to an
  album or space could reuse the throw once the picker shows its destination.
- Other loading screens (Spaces list, albums) still show a spinner; a card skeleton would match.
- Search's motion (entrance, chip row, results wipe, folds) is described in
  `specs/2026-10-23-mobile-search-redesign-design.md`, "Motion"; its generic pieces (`entrance.dart`,
  `animated_row.dart`, `swap.dart`, `pop.dart`, `fold.dart`) live here in `lib/gallery/motion/`.
