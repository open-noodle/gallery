# Adjust tool: exposure, contrast, saturation, invert

## Summary

Add a new edit action, `Adjust`, alongside the existing
`Crop`/`Rotate`/`Mirror`/`Trim`. Edits are stored as parameters and
applied on demand, so the original file is never modified and the edit
can always be reverted from within the app — but not once the asset
leaves it: a downloaded copy has the edit baked into its pixels with no
attached history, and re-uploading it (here or anywhere else) makes it a
fresh asset with no way to tell it was ever edited. Adds a mode toggle
below Orientation in the existing Transform tool panel, switching
between the current Crop UI and a new Edit UI with sliders.

## Roadmap

- **Starting sensibly: v1 (web)** — scope: exposure, contrast,
  saturation, invert. All four have an exact, already-worked-out server
  implementation (see Design).
- **v2 (web)**, shortly after v1's approved: highlights/shadows
  curve, sharpness, masking (each only if it works out well).
  All three need real design work beyond a single `sharp`
  call (no built-in tone-curve primitive, sharpness has no CSS preview
  equivalent, masking needs a selection/brush UI that doesn't exist).
- **v3 (mobile, Android)**: port whatever worked from v1+v2 to the
  Flutter mobile app. Not scoped in any detail yet. The design work
  starts once v1/v2 have proven the server-side model is right.

## Design (v1, web)

**Schema** (`editing.dto.ts`): add `Adjust = 'adjust'` to `AssetEditAction`,
plus an `AdjustParametersSchema` — three numeric fields (exposure,
contrast, saturation) each -100 to +100, plus a boolean invert flag,
default 0/off, all optional. This slots into the existing discriminated
union and parameter-key map like the other four actions, no changes
needed to the union/uniqueness logic itself.

Additive for v2: Zod object
schemas don't require uniform field types, so a future field is
non-breaking regardless of shape — a scalar like `sharpness: z.number()`
and a structured one like `curve: z.array(z.object({ x, y }))` for a
highlights/shadows tone curve are both just one more optional key on the
same object. The existing parameter-key-map validation pattern
(`Object.keys(Schema.shape)`) already walks whatever keys exist without
assuming they're numbers, so this holds through the whole validation
path, not just the raw type. No pre-emptive redesign needed when v2
is built. This forms part of ease of maintenance, more features can be added later. 

**Server processing**: implemented to match the CSS Filter
Effects spec pixel-for-pixel so the live preview and the saved result are accurate:
- Exposure, contrast: `sharp().linear(a, b)` with `a`/`b` computed from
  the same formulas CSS `brightness()`/`contrast()` use.
- Saturation: `sharp().recomb()` with the CSS `saturate()` matrix
  constants, **not** `.modulate({ saturation })` — modulate works in HSL
  space and visibly disagrees with CSS's RGB-matrix approach at the same
  parameter value.
- Invert: expressed as part of the same `linear(a, b)` call as
  exposure/contrast (`v -> range - v` is just `a = -1, b = range`), not
  `sharp().negate()` — see the gotcha below for why.

**Two real sharp gotchas found in testing, neither obvious from its
docs**:
1. `.linear(a, b)` is a single option slot on the pipeline, not a queue
   of operations — sharp's native code always applies recomb, then
   linear, regardless of the order these are called in JS, and a second
   `.linear()` call silently *overwrites* the first rather than composing
   with it. So exposure and contrast are pre-combined into a single
   equivalent `(a, b)` pair before the one `.linear()` call — calling it
   twice for exposure then contrast was dropping exposure entirely
   whenever contrast was also set.
2. `.recomb()` (used for saturation) followed by `.negate()` produces
   all-zero output — reproduced even with a plain identity recomb matrix,
   so it isn't specific to this formula, and it happens regardless of
   whether anything runs between the two calls. `.recomb()` then
   `.linear()` composes correctly, so invert is folded into the same
   `(a, b)` pair as exposure/contrast — substituting `range - v` for `v`
   in `amount * v + offset` gives `-amount * v + (amount * range +
   offset)`, still one linear() call, applied whenever invert is on even
   if exposure and contrast are both untouched. This is also what makes
   invert *feel* like it runs before exposure/contrast (a negative
   exposure value darkens an inverted film negative instead of
   brightening it) — folding it into the same transform as "invert the
   input first, then apply (amount, offset)" is what produces that,
   not any actual reordering of calls.

A third gotcha existed here briefly (`.recomb()` narrowing a non-sRGB
pipeline's data to 8-bit while `linear()`'s coefficients were still
computed for 16-bit, clipping saturation+contrast/invert to solid
black/white on any non-sRGB photo) but it's gone, not fixed-and-kept: the
2026-10-08 rebase below moved Adjust onto a pass that's unconditionally
8-bit, so the bug's precondition no longer exists. No code or test
describes it any more — see that section for the real current behaviour.

**Old mobile apps must not be sent `adjust` edits.** The new action flows
into the `AssetEditV1` delta-sync stream, and a mobile app built before
this feature has a generated Dart enum without `adjust`. Its `fromJson`
returns null for the unrecognized string and the non-null assertion on it
throws — inside `_parseLines()`, before any per-entity handling, so the
whole batch dies rather than the one edit. The batch is then never
acknowledged, the checkpoint never advances, and every retry replays the
same failure: one `adjust` edit saved on web permanently wedges that
user's phone sync. Server and mobile release independently, so there is no
way to ship the Dart fix to already-installed apps; the server has to
withhold what they cannot parse. `clientSupports()`
(`server/src/utils/client-capability.ts`) is the server-side counterpart
to mobile's `ServerCapability` and gates this on the app version parsed
from the request's `User-Agent`, with unknown counting as unsupported.
The websocket `AssetEditReadyV2` path needs no gate — its handler wraps
the same parse in a try/catch, so it degrades to "edit not applied"
instead of wedging.

**Where it runs (revised 2026-10-08, Immich v3.3.0 rebase)**: upstream
v3.3 stopped applying edits in the decode pipeline. `decodeImage()` now
returns an unedited 8-bit bitmap, and each output (thumbnail, preview,
fullsize, thumbhash) runs `transform()`, which applies crop/rotate/mirror
and the resize in **linear-light scRGB**. The CSS formulas above are
defined on gamma-encoded values, so Adjust can't join that pass without
drifting from the live preview. It runs as a separate pass
(`MediaRepository.adjust()`) on the bitmap `transform()` returns, after
geometry and resize. That matches the preview, which also filters the
scaled image on screen. Two consequences:
- The value range is always 0–255. `transform()`'s raw output is always
  8-bit, wide-gamut sources included; the colourspace is tagged on
  afterwards and isn't stored in the pixel depth. The old
  "16-bit midpoint for non-sRGB pipelines" rule no longer applies.
- The scRGB pass reports `premultiplied: true` on its output info but
  returns straight-alpha bytes. `adjust()` clears the flag before
  re-reading the bitmap; otherwise sharp un-premultiplies again and
  corrupts semi-transparent pixels (there is a regression test for this).

**Old mobile apps must also not be allowed to delete `adjust` edits.**
Not being sent the record is only half the problem: because mobile maps
`adjust` to its `other` sentinel and `remote_asset.repository.dart`'s
`getAssetEdits()` filters every `other` row out, the mobile editor opens
without ever knowing an `adjust` edit exists. It then submits the
crop/rotate/mirror it does know about, and `AssetEditRepository.replaceAll()`
is a true full replace — so saving a crop on the phone silently destroyed
an Adjust edit made on web. Both of the mobile editor's save paths are
affected: a non-empty edit list goes to `editAsset()`, and an empty one
(every spatial edit cleared) goes to `removeAssetEdits()` via
`applyEdits()` in `mobile/lib/domain/services/asset.service.dart`.
`withPreservedAdjustEdit()` (`asset.service.ts`) carries the stored
`adjust` edit over on both, appended last so crop stays the first action.

The gate there is **`session.isMobileApp` AND an unsupported
`appVersion`**, never the version alone, and that distinction is the whole
reason `isMobileAppUA()` exists alongside `getAppVersionFromUA()`.
Omission is how web *deletes* an action: `TransformManager.getEdits()`
drops `adjust` once all four sliders and invert are back at their
defaults, and `onActivate()` pre-populates them from the existing edit, so
a user can open the editor, see the saved values, zero them out and save —
a deliberate removal that must be honoured. A browser reports no
`appVersion` either, so `!clientSupports(appVersion, …)` is equally true
of every web save; preserving on that condition alone would undo every
deliberate web removal, a worse bug than the one being fixed. Only the
`User-Agent` scheme separates "is the mobile app, version unreadable"
from "is not the mobile app at all".

`trim` is mapped to `other` and filtered on mobile identically but needs
no such handling: it is video-only and `editAsset()` already rejects
mixing trim with spatial edits, so the mobile image editor can never
submit an action set that collides with a stored trim.

**Client**: not a new top-level tool. `EditManager.applyEdits()` only ever
submits the *selected* tool's manager's `.edits` — one manager per
top-level tool — and Edit/Crop are both modes inside Transform, not a
second icon in the top bar. A separate `EditToolManager` for Adjust would
never actually get its edits sent. Instead:
- `TransformManager` (`transform-manager.svelte.ts`) gains four new
  `$state` fields (`exposure`, `contrast`, `saturation`, `invert`) and
  folds an `Adjust` action into its existing `getEdits()` alongside
  Crop/Mirror/Rotate, same pattern those three already use (conditional
  push based on whether the value differs from default).
- `onActivate()` gains an adjust branch next to the existing
  rotate/mirror parsing, pre-populating the four fields from any
  existing `Adjust` edit — same mechanism, not a new one.
- `resetAllChanges()`/`reset()` clear the four fields alongside the
  existing rotation/mirror/crop reset.
- `AdjustPanel.svelte` is a new child component, rendered conditionally
  by `TransformTool.svelte` based on the mode toggle — a sibling to the
  existing crop-grid markup in the same file, not a new entry in
  `EditManager.tools`.

**UI placement**: inside `TransformTool.svelte`, a toggle below the
existing "Orientation" section switches between the new sliders (Edit,
left, default) and the current aspect-ratio grid (Crop, right). Both
remain part of the same Transform tool/edit set — Crop and Adjust actions
can coexist in one save button, this is purely which panel is shown.
Edit defaults to active since it's the reason someone opens this panel
in the new flow, not crop.

**Slider interaction**: double-click/double-tap a slider resets that one
field to 0, independent of the others. Invert is a plain on/off toggle,
not a slider — an `@immich/ui` `Switch`, the same control already used
for every other on/off setting in the app (e.g. Notifications), not a
button styled to look toggled.

**Live preview**: CSS `filter: saturate() invert() brightness() contrast()`
— native, cheap, and matches the server's actual pipeline order exactly
(saturation always first, negate always last relative to linear, per the
sharp gotcha above), so what's shown while dragging a slider is the same
result that gets saved, not an approximation.

## Testing (v1, web)

- Server: unit tests per adjustment op (known input to expected pixel
  output, sharp-level), schema validation tests (range limits, invalid
  combinations).
- Client: manager unit tests (edit-state transitions, reset behavior),
  matching the existing transform-manager test pattern.
- Manual: real round-trip on a live instance — apply, save, reload, download,
  confirm the persisted asset matches what was previewed.
