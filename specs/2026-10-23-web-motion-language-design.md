# Web motion language

Status: first wave implemented (web only). Code: `web/src/lib/gallery/motion/`.

## Goal

Make the web app feel alive without making it busy. Pressing things should feel physical, things the
user sends somewhere should visibly go there, and rare good moments get a small reward. Motion is
never decoration: each animation answers "what just happened?" or "where did it go?".

The vocabulary comes from the usual families of UI motion (keyframes, springs, gestures, physics,
SVG paths, layout transitions, Rive/Lottie, skeletal rigs, flipbook, particles, shaders). Each family
below is assigned to the kind of interaction it serves in Gallery, so new UI picks motion by job, not
by taste.

## Interaction → motion map

| Interaction                                | Family                     | Treatment                                                                                                | Where it lives                                    |
| ------------------------------------------ | -------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Pressing any control                       | Spring                     | Squish ~14px while held (`pressScale`, 0.86–0.95); a tap waits for the dip to land, then the bouncy spring returns it | `press.ts`, site-wide                             |
| Toggling (switch, checkbox, select)        | Spring                     | Switch thumb on the snappy spring; checks pop in on the bouncy spring when a press turned them on        | `motion.css`                                      |
| Selecting a photo                          | Spring + layout            | Photo shrinks into its frame on the gentle spring; the check pops                                         | `motion.css`                                      |
| Something appearing (modal, menu, popover) | Keyframes                  | Modals rise 32px from 82% on the bouncy spring; menus grow from 85% out of their trigger (`--bits-floating-transform-origin`) | `motion.css`                                   |
| Hovering a button                          | Spring                     | Grows ~5px (`hoverScale`, 1.02–1.1) on the bouncy spring; mouse only; menu rows, tabs and checkboxes highlight instead | `press.ts`, site-wide |
| Hovering a timeline photo                  | Keyframes (transition)     | The photo, its gradient and icons lift 10% out of the grid over their neighbours with a shadow (not while selected). The clipping/stacking ancestors (image grid, day section, month) are raised while hovered and while it shrinks back. A photo at the scroll area's edge grows only toward the open side | `motion.css`, `thumbnail-lift.ts`                 |
| Hovering a card                            | Spring                     | Picture lifts 8px and grows 4% with a deeper shadow; the card rises above its neighbours                  | `motion.css`, `data-motion-lift`                  |
| Hovering a sidebar item                    | Spring                     | Pill fades in; icon grows 25% and tilts 8° on the bouncy spring                                          | `motion.css`                                      |
| Hovering a memory card                     | Spring                     | The card grows 4% down and sideways from a fixed top edge (every list of them clips above, and a gap to make room was rejected), tilts toward the mouse with a pointer-following glare and a deep shadow; colour deepens and the title floats up | `motion.css`, `tilt.ts`, `data-motion-memory`     |
| Hovering Explore places / people          | Keyframes (transition)     | Place photos zoom 12% inside their frame and brighten; avatars grow 8% on the bouncy spring               | `motion.css` (matched by link target)             |
| Expanding a sidebar group (Spaces, Albums) | Spring + keyframes         | Children fade and drop 16px into place; the chevron turns on the snappy spring                           | `motion.css`                                      |
| Selecting photos (selection bar)           | Spring                     | The selection bar fades and drops 16px in over the top bar on the bouncy spring                          | `motion.css`                                      |
| Changing section                           | Layout transition          | View Transition: old page fades and sinks to 98%, new one rises 28px; sidebar and top bar held still      | `page-transition.ts`, `motion.css`                |
| Opening / closing a photo                  | Layout transition (FLIP)   | A copy of the image flies from the thumbnail into the viewer and back on a fast ease-out (no overshoot: the photo never draws bigger than it is). The sharp preview fades in over the thumbnail during the flight, and the copy hands over once the viewer's own sharp image has loaded. Thumbnail off screen: the viewer fades | `viewer-zoom.ts`                                  |
| Trashing / archiving / restoring photos    | SVG-style path + physics   | Each photo lifts (anticipation), then arcs along a Bézier into the sidebar link it went to, which gulps   | `removal.ts`                                      |
| Deleting permanently / emptying trash      | Shader-style               | Photos lose colour, blur and dissolve where they stood                                                    | `removal.ts`                                      |
| Favoriting                                 | Particles                  | A ring and seven small hearts burst from the button                                                       | `celebrate.ts`                                    |
| Creating a space                           | Particles                  | A small confetti burst from the Create button                                                             | `celebrate.ts`                                    |
| Moving the mouse over a card               | Gestures                   | The lifted picture tilts up to 7° toward the cursor, like pressing a print; flat again on leaving         | `tilt.ts`, `motion.css`                           |
| Dragging, swiping, pinching                | Gestures                   | Track the finger 1:1; on release, settle with a spring (no new work in this wave; existing behaviour)     | rule for new code                                 |
| Loading                                    | Shader-style (CSS)         | Existing shimmer (`cmdk-shimmer`) and thumbhash fade-ins; no spinners where a skeleton fits               | rule for new code                                 |
| Mascots, onboarding, empty states          | Rive / Lottie, skeletal    | Not used. Needs designer-made assets; revisit if Gallery gets a character                                 | out of scope                                      |
| Memories                                   | Flipbook / video           | Already the memory viewer's job                                                                           | unchanged                                         |

"Combine them" is the trash throw: a spring press on the button, an anticipation keyframe, a physics-
eased path, then a spring gulp on the destination. That combination is the pattern for any future
"send it somewhere" action (add to album, move to a space) once the destination has a visible target.

## Tokens

Defined in `tokens.ts` and mirrored as CSS custom properties in `motion.css`; `tokens.spec.ts` fails
when the two drift.

| Token                     | Value                            | Use                                         |
| ------------------------- | -------------------------------- | ------------------------------------------- |
| `--motion-instant`        | 90ms                             | press-in, hover tints                        |
| `--motion-quick`          | 160ms                            | menus, tooltips, chips, page fade-out         |
| `--motion-base`           | 240ms                            | overlays, page fade-in, card lift            |
| `--motion-slow`           | 400ms                            | large surfaces; nothing blocking runs longer |
| `--ease-standard`         | `cubic-bezier(0.2, 0, 0, 1)`     | default                                     |
| `--ease-settle`           | `cubic-bezier(0.22, 1, 0.36, 1)` | arrive and rest (the filter panel's curve)   |
| `--ease-exit`             | `cubic-bezier(0.3, 0, 0.8, 0.15)` | leaving                                     |
| `--spring-gentle`         | k 300, c 22, 7.6% overshoot, 560ms | releases, entrances, selection             |
| `--spring-snappy`         | k 600, c 34, 4.8% overshoot, 360ms | toggles                                    |
| `--spring-bouncy`         | k 380, c 16, 24% overshoot, 780ms  | small pops only (a check, a heart)         |

Springs are CSS `linear()` easings sampled from a damped spring's step response (mass 1). On browsers
without `linear()`, CSS falls back to `ease` and `springEasing()` falls back to `--ease-settle`
(WAAPI throws on an unknown easing). To regenerate one:

```js
// node spring.mjs <stiffness> <damping> <points>
const [k, c, n] = process.argv.slice(2).map(Number);
const w0 = Math.sqrt(k), z = c / (2 * Math.sqrt(k)), wd = w0 * Math.sqrt(1 - z * z);
const x = (t) => 1 - Math.exp(-z * w0 * t) * (Math.cos(wd * t) + ((z * w0) / wd) * Math.sin(wd * t));
let T = 0; while (Math.exp(-z * w0 * T) > 0.002) T += 0.001;
console.log(Math.round(T * 1000), `linear(${Array.from({ length: n + 1 }, (_, i) => (i === n ? 1 : +x((T * i) / n).toFixed(3))).join(', ')})`);
```

## Rules

1. **Noticeable, not noisy.** The first wave was so restrained that nobody saw it, so everyday motion is
   tuned to be felt on a normal click: controls scale within 0.86–1.1, releases and hovers overshoot once
   on the bouncy spring, no wobble loops. Celebrations stay rare, positive and user-initiated; a burst on
   every click stops being a reward.
2. **Never block.** Nothing the user waits on runs past `--motion-slow`. Removals copy what is on screen
   into a `pointer-events: none` overlay, so the timeline reflows and stays usable underneath.
3. **Start from the user.** Bursts and fallback throws start or end at the last pointer press. Keyboard
   input clears that point, so a shortcut never bursts from a stale spot.
4. **Reduced motion.** `prefers-reduced-motion: reduce` keeps fades and drops movement: no squish, no
   springs, no bursts, no throws, no page crossfade.
5. **Only `scale`, `translate`, `opacity`, `filter`, colours.** Never layout properties. The individual
   transform properties compose with Tailwind's (`scale-*` is the `scale` property in v4), and press
   animations use `composite: 'add'` so they multiply onto a component's own scale.
6. **No permanent stacking contexts on chrome.** A `view-transition-name`, `translate` or `scale` on an
   element traps its dropdowns under later content. Name the sidebar and top bar only while a crossfade
   runs (`gallery-page-transition` class), and raise a hovered card (`z-index: 1`) while it is lifted.
7. **Hands off library-positioned elements.** Map markers are placed by MapLibre's own transforms, and a
   marker that grows under the cursor moves its hit area, so hover flickers and clicks miss. Nothing
   inside `.maplibregl-map` gets press or hover motion; markers keep upstream's own hover zoom.
   The same holds for anything that moves under the cursor: a hover that translates its own hit area
   away flickers on and off at the edge. Grow instead, or move an inner element.
   Small controls with a 1px rounded border (the filter panel's year and month chips) shimmer under the
   bouncy hover grow: the border is redrawn at a new fractional scale every frame of the wobble. They
   already show hover by colour, so they carry `data-no-hover-grow` (press squish kept).
8. **Upstream layering.** All logic lives in `web/src/lib/gallery/motion/`; `motion.css` is imported by
   the fork-owned `gallery-theme.css`. Upstream components are reached by stable hooks they already
   expose (bits-ui `data-*-content`/`data-state`, `data-thumbnail-focus-container`, `data-testid`,
   `#sidebar`) rather than by editing them. Fork components opt in with attributes
   (`data-motion-lift`, `data-motion-lift-group`, `data-press`, `data-no-press`).

## Upstream hooks

Each upstream file carries one import and one call:

| File                                                         | Hook                                          |
| ------------------------------------------------------------ | --------------------------------------------- |
| `routes/+layout.svelte`                                      | `setupMotion()` (press feedback + crossfade)  |
| `lib/utils/actions.ts` `deleteAssets`                        | `animateRemoval(ids, 'trash' \| 'delete')`    |
| `lib/utils/asset-utils.ts` `archiveAssets`                   | `animateRemoval(ids, 'archive')`              |
| `lib/services/asset.service.ts` `handleFavorite`             | `celebrate('favorite')`                       |
| `lib/services/trash.service.ts` empty / restore all          | `animateRemoval('visible', 'delete' \| 'restore')` |
| `routes/(user)/trash/.../RestoreAction.svelte`               | `animateRemoval(ids, 'restore')`              |
| `lib/components/asset-viewer/AssetViewer.svelte`             | `useViewerZoom(() => asset.id)`               |

`deleteAssets` is the single path for trashing from the timeline, the Delete key, the gallery grid and
the asset viewer, so one hook covers all four. The fork-owned command-palette handlers
(`selection-command-handlers.ts`) and `SpaceCreateModal` call the module directly.

### Removal timing contract

`animateRemoval` must run after the server confirmed the change and before the photos leave the DOM:
it snapshots each photo's on-screen rect and image. When removal comes later from a server event (empty
trash, restore all), pass `'visible'`: it animates every photo on screen and hides the originals at
once so they don't sit under their own animation.

## Known limits and next candidates

- Modal and menu exits are instant: bits-ui unmounts content on close, so a CSS exit would need
  `forceMount` in @immich/ui.
- Toasts keep @immich/ui's own fly-in.
- Opening and closing a photo is a FLIP with a copy of the image (`viewer-zoom.ts`), not a View
  Transition: the timeline stays mounted under the viewer, and snapshotting it stalls the open. Positions
  are read while they exist: the timeline is hidden while the viewer is open, so the thumbnail is recorded
  on click; the viewer's photo is gone before its teardown runs, so it is recorded on every input that
  could close it, into a hidden, pre-decoded standby copy (a copy made at close paints a black frame
  while decoding). The photo box is found through AdaptiveImage's markup classes; if upstream changes
  them, the viewer falls back to a plain fade.
- "Add to album / space" could reuse the throw once the picker shows the destination.
- Timeline reflow after a removal jumps rather than FLIPs, because the virtualised layout re-positions
  absolutely; animating it belongs in the timeline manager, not a hook.
