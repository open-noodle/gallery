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
- Invert: `sharp().negate()`. Already an exact match with CSS `invert()`
  — both are plain per-channel 255-minus-value, no design needed.

**A real sharp gotcha found in testing, not obvious from its docs**:
`.linear(a, b)` and `.negate()` are single option slots on the pipeline,
not a queue of operations — sharp's native code always applies recomb,
then linear, then negate, regardless of the order these are called in
JS, and a second `.linear()` call silently *overwrites* the first rather
than composing with it. Two consequences, both handled in
`applyAdjust()`: exposure and contrast must be pre-combined into a single
equivalent `(a, b)` pair before the one `.linear()` call (calling it
twice for exposure then contrast was dropping exposure entirely whenever
contrast was also set), and because negate always runs *last*, making
invert *feel* like it runs first — so a negative exposure darkens an
inverted film negative instead of brightening it — means algebraically
pre-adjusting `(a, b)` to simulate inverting the input before exposure
and contrast are applied, not literally reordering any calls.

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
