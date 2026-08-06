# Pi Agent — Image Adjustments (brightness / contrast / saturation / auto-enhance / flip)

Status: design (approved for planning)
Date: 2026-06-06
Branch: `explore/pi-agent-brainstorm`
Spec: this file. Capability matrix: `docs/superpowers/specs/2026-05-19-pi-agent-capability-matrix.md`.

## Summary

This is the **image-edit operation family beyond rotate/crop** flagged as the #1 "Needs
New MCP Tool" direction in the capability matrix. v1 ships **tonal adjustments**
(brightness, contrast, saturation), **auto-enhance**, and **flip** (horizontal/vertical),
plus a **before/after preview on the agent plan card** that the user can iterate on.

**Straighten (arbitrary-angle rotate) is explicitly out of scope** for v1 — it breaks the
orthogonal-only assumptions in `server/src/utils/transform.ts` (output dimensions, face/OCR
bounding-box remapping) and needs auto-crop. It remains a documented follow-up.

### Decisions locked during brainstorming

1. **Scope:** brightness, contrast, saturation (named levels), auto-enhance, flip H/V. Defer straighten.
2. **Amount model:** discrete **named signed levels** (`slight | moderate | strong` × increase/decrease) mapping to fixed sharp factors. Auto-enhance is amountless. No raw numeric factors (small models guess numbers unreliably — the crop OQ-F1 lesson).
3. **Preview:** an **ephemeral, non-persisting** server render endpoint; the plan card shows before/after on representative assets; iterate via the **existing** `reviseProposedOperations` loop.
4. **UI scope:** API + agent plan preview only. **No** human web-editor sliders in this spec (the agent-created edits are still removable in the existing editor because they go through the same `asset_edit` table — that is inherent, not extra work).

### Why this is feasible on the current surface

- Edits are **non-destructive**: stored declaratively in the `asset_edit` table and re-applied at
  render time by `MediaRepository.applyEdits` via **sharp/libvips**. The "preview artifact" is just a
  re-render — no new artifact store.
- Tonal ops slot into the sharp pipeline as `.modulate()` / `.linear()` / `.normalise()`.
- **Flip already exists** in the editor as `AssetEditAction.Mirror` (horizontal/vertical) — v1 only
  exposes it as an agent op; no new geometry code.
- Reversal is the existing `removeAssetEdits` (DELETE `/assets/:id/edits`). New ops are therefore
  **Low risk**, exactly like the shipped `asset.crop`.

## TDD discipline (applies to every slice)

Every behavior below is implemented test-first:

1. **Red:** write the failing test(s) named in the slice's "Tests (write first)" list; run them; capture the expected red failure (assertion/▢not-implemented).
2. **Green:** minimal implementation to pass.
3. **Refactor:** clean up with tests green.

No behavior is added without a test that fails first. Each slice's "Verification" block lists the exact commands that must be green before commit. A test that passes on first run (was supposed to be red) is a red flag — investigate before continuing.

Cross-cutting gotchas baked into every slice:

- **OpenAPI regen runs TS _and_ Dart.** After any server DTO/enum/route change:
  `pnpm -C server build && pnpm -C server sync:open-api && make open-api` (TS SDK **and** `make open-api-dart`), then confirm `mobile/openapi/` carries the new types. (G2 burn: a TS-only regen left the Dart client stale.)
- **`make check-server && make lint-server`** (and `make check-web` for web slices) — vitest alone skips tsc/lint.
- **agent-runner is NOT in CI.** Runner slices run `node --test 'src/**/*.test.mjs'` locally and are gated by the L1/L3 evals; there is no GitHub CI for them.
- **Docs/markdown prettier is `pnpm -C docs exec prettier --write`**, never server prettier (server prettier rewrites double-quotes and churns the matrix table). Run server prettier (`make format-server`) only on server `.ts`.
- **Capability matrix is generated.** Never hand-edit the `<!-- generated:workflows -->` block; run `pnpm --dir server sync:agent-capabilities` after manifest changes.
- **New agent op labels** use the web `typeLabelKeys` fallback (no new i18n for the op name); add i18n keys only for net-new UI strings (the Before/After preview labels).

---

## Slice 1 — Editor core: the `Adjust` edit action (server)

Add a non-destructive `adjust` edit action rendered via sharp, alongside crop/rotate/mirror/trim.

### Files

- `server/src/dtos/editing.dto.ts` — new action + parameter schema + union/map wiring.
- `server/src/repositories/media.repository.ts` — `applyEdits` renders tonal ops.
- `server/src/utils/transform.ts` — **no functional change**; add a regression test that `adjust` is a geometric no-op.
- Specs: `editing.dto`-level tests (extend `server/src/utils/transform.spec.ts` and add/extend a dto spec), `media.repository.spec.ts`.

### Schema (`editing.dto.ts`)

```ts
export enum AssetEditAction {
  Crop = 'crop',
  Rotate = 'rotate',
  Mirror = 'mirror',
  Trim = 'trim',
  Adjust = 'adjust',
}

export enum TonalLevel {
  StrongDecrease = 'strong_decrease',
  ModerateDecrease = 'moderate_decrease',
  SlightDecrease = 'slight_decrease',
  SlightIncrease = 'slight_increase',
  ModerateIncrease = 'moderate_increase',
  StrongIncrease = 'strong_increase',
}
const TonalLevelSchema = z.enum(TonalLevel).meta({ id: 'TonalLevel' });

const AdjustParametersSchema = z
  .object({
    brightness: TonalLevelSchema.optional(),
    contrast: TonalLevelSchema.optional(),
    saturation: TonalLevelSchema.optional(),
    autoEnhance: z.boolean().optional(),
  })
  .superRefine((p, ctx) => {
    const manual = [p.brightness, p.contrast, p.saturation].filter((v) => v !== undefined);
    if (p.autoEnhance === undefined && manual.length === 0) {
      ctx.addIssue({ code: 'custom', message: 'At least one adjustment is required' });
    }
    if (p.autoEnhance && manual.length > 0) {
      ctx.addIssue({ code: 'custom', message: 'autoEnhance cannot be combined with manual adjustments' });
    }
  })
  .meta({ id: 'AdjustParameters' });
```

Wire `Adjust` into: `__AssetEditActionItemSchema` discriminated union, `AssetEditParametersSchema` union, `actionParameterMap`, and the `AssetEditActionItem`/`AssetEditParameters` types. Export `AdjustParameters` and `TonalLevel`.

### Rendering (`media.repository.ts` `applyEdits`)

`adjust` is **not affine** → it stays out of `createAffineMatrix` (its `default` branch already maps unknown actions to `identity()` — confirm, no change). After the existing crop-extract + affine steps, apply tonal ops from the single `adjust` edit (if present):

```ts
const adjust = edits.find((e) => e.action === AssetEditAction.Adjust)?.parameters;
if (adjust) {
  if (adjust.autoEnhance) pipeline = pipeline.normalise();
  else {
    const brightness = adjust.brightness ? BRIGHTNESS_FACTOR[adjust.brightness] : 1;
    const saturation = adjust.saturation ? SATURATION_FACTOR[adjust.saturation] : 1;
    if (brightness !== 1 || saturation !== 1) pipeline = pipeline.modulate({ brightness, saturation });
    if (adjust.contrast) {
      const { a, b } = contrastLinear(adjust.contrast /* working range */);
      pipeline = pipeline.linear(a, b);
    }
  }
}
```

**Factor tables (the contract — assert these exact values in tests):**

| TonalLevel        | brightness (modulate) | saturation (modulate) | contrast (linear slope `a`) |
| ----------------- | --------------------- | --------------------- | --------------------------- |
| strong_decrease   | 0.70                  | 0.40                  | 0.74                        |
| moderate_decrease | 0.82                  | 0.65                  | 0.84                        |
| slight_decrease   | 0.92                  | 0.85                  | 0.92                        |
| slight_increase   | 1.08                  | 1.15                  | 1.10                        |
| moderate_increase | 1.18                  | 1.30                  | 1.22                        |
| strong_increase   | 1.32                  | 1.55                  | 1.40                        |

- **Contrast** uses `.linear(a, b)` pivoting around mid-gray, via a **pure helper** `contrastLinear(level, mid): { a, b }` where `a` = the table slope and `b = mid * (1 - a)`. `mid` is the mid-point of the pipeline working colorspace (8-bit `srgb` → 128; 16-bit `rgb16` → 32768), read from the decode options/colorspace already in scope in `getImageDecodingPipeline` — **never hard-code 128 for the rgb16 path**. The helper is unit-tested in isolation (so the test is decoupled from sharp's internal value space); the `applyEdits` test asserts `.linear` is called with **whatever the helper returns**, not a hard-coded literal.
- **auto-enhance** = `.normalise()` only in v1 (per-image contrast stretch). No saturation bump.
- **Order:** geometry (crop/affine) first, tonal last — document inline; tonal is visually order-independent of geometry but this order is fixed and tested.

### Dedup / ordering invariants (`uniqueEditActions`)

- `adjust` is keyed by action ⇒ **one adjust per asset**; duplicate adjust ⇒ rejected. Mirror stays keyed by axis (one per axis). No change to crop/rotate keys.

### Tests (write first)

`editing.dto` schema tests:

- `adjust` with one field (brightness) parses; with all three manual fields parses.
- **empty** `{}` adjust → rejected ("At least one adjustment is required").
- `autoEnhance: true` alone → parses; `autoEnhance: true` + `brightness` → rejected (XOR).
- invalid `TonalLevel` value → rejected.
- two `adjust` actions in one `edits` array → `uniqueEditActions` rejects (duplicate).
- `adjust` coexisting with `crop` + `mirror` in one array → accepted.

`transform.spec.ts`:

- `getOutputDimensions` ignores `adjust` (dims unchanged).
- `transformPoints` / `transformFaceBoundingBox` / `transformOcrBoundingBox` with an `adjust` edit present → identical to without it (adjust moves nothing).
- mixed `[crop, adjust, rotate]` → same geometry result as `[crop, rotate]` (adjust is inert).

`media.repository.spec.ts` (mock sharp; assert calls):

- `autoEnhance` → `.normalise()` called, no `.modulate`/`.linear`.
- `brightness: moderate_increase` → `.modulate({ brightness: 1.18, saturation: 1 })`.
- `saturation: strong_decrease` → `.modulate({ brightness: 1, saturation: 0.40 })`.
- `contrast: slight_increase` → `.linear` called with `contrastLinear('slight_increase', mid)` for the active colorspace (assert against the helper's output, not a literal).
- **`contrastLinear` pure-helper unit test:** `contrastLinear('slight_increase', 128)` → `{ a: 1.10, b: -12.8 }`; `contrastLinear('slight_increase', 32768)` → `{ a: 1.10, b: -3276.8 }`; a decrease level (`a < 1`) yields `b > 0`.
- brightness + contrast together → both `.modulate` and `.linear` called; modulate before linear.
- **all three manual fields** (brightness + saturation + contrast) → one `.modulate({ brightness, saturation })` then one `.linear(...)`.
- no `adjust` edit → none of `.normalise/.modulate/.linear` called (existing crop/rotate path unaffected).

### Edge cases

- Adjust on a **non-image** input: the editor pipeline is image-only by construction (video uses Trim). The op-plan + workflow layers (Slices 3/5) guard image-only; the renderer is not reached for videos. Asserted at those layers.
- `modulate({ brightness: 1, saturation: 1 })` is a no-op — code skips the call when both are 1 (tested).

### Verification

```bash
pnpm -C server test -- --run src/dtos/editing.dto.spec.ts src/utils/transform.spec.ts src/repositories/media.repository.spec.ts
make check-server && make lint-server
pnpm -C server build && pnpm -C server sync:open-api && make open-api   # TS + Dart
git status --porcelain open-api/ mobile/openapi/   # MUST show the new TonalLevel/AdjustParameters types
make format-server   # server .ts only
```

### Commit

`feat(editing): non-destructive adjust edit action (brightness/contrast/saturation/auto-enhance)`

---

## Slice 2 — Ephemeral preview render endpoint (server)

A non-persisting render so the plan card's "after" exactly matches what apply will produce.

### Files

- `server/src/controllers/asset.controller.ts` — `POST /assets/:id/edits/preview`.
- `server/src/services/asset.service.ts` (or wherever `editAsset`/`getAssetEdits` live) — `previewAssetEdits`.
- A shared **merge util** extracted so apply (Slice 3) and preview use identical merge rules — `server/src/utils/asset-edit.ts` (new) with `mergeEdits(existing, incoming)`.
- Specs: `asset.controller.spec.ts`, `asset.service.spec.ts`, a medium test.

### Behavior

```
POST /assets/:id/edits/preview?size=thumbnail|preview   // size optional, default preview
body: AssetEditsCreateDto   // the proposed edit actions (reuses the existing DTO + validation)
200: image/* stream         // bounded render, persists nothing
```

**`size`** is the existing `AssetMediaSize` enum (`thumbnail` | `preview`), default `preview`,
never full-res. The plan-card strip requests `thumbnail` so the after-tile matches the before
thumbnail's resolution (cheap, no oversized renders per revise); a larger view (e.g. the photo-
review modal) may request `preview`. The caller is the **browser user** (cookie session), not the
runner.

`previewAssetEdits(auth, id, dto, size)`:

1. **Access-check** the asset (`Permission.AssetView`; reuse the same access predicate the thumbnail/original endpoints use). Inaccessible → 400/403 as the existing media endpoints do.
2. **Image-only** — non-image asset → `BadRequestException` (preview is for image edits).
3. Load existing persisted edits (`getAssetEdits`) and **merge** the incoming edits via the shared `mergeEdits` (same rules as apply: replace crop, replace adjust, replace rotate, ensure mirror-by-axis). This keeps before (current rendered thumbnail, which already reflects persisted edits) and after (current + proposed) **consistent** — same `size`, same merged-edit render path.
4. Render the **original** through the existing decode pipeline with `{ edits: merged, size }` to a buffer; stream it. **No `asset_edit` write.**
5. `Cache-Control: no-store`; bounded to the requested size (never full-res).

### Tests (write first)

`asset.controller.spec.ts`:

- empty `{ edits: [] }` → 400 (min-1, existing DTO rule).
- valid body → calls `service.previewAssetEdits(auth, id, { edits })`.
- malformed edit params → 400.

`asset.service.spec.ts`:

- inaccessible asset → throws (no render).
- non-image asset → `BadRequestException`.
- merges incoming with existing edits via `mergeEdits` before rendering (spy the merge util + the media call).
- **persists nothing** — `editAsset`/repository write is never called.
- passes the requested `size` (thumbnail vs preview) through to the media pipeline; default = preview when omitted; an out-of-enum `size` → 400.
- missing/unreadable original → surfaces as a clean error (not an unhandled 500).

`asset-edit.ts` (merge util) unit tests:

- incoming `adjust` replaces an existing `adjust`; keeps an existing `crop`.
- incoming `crop` replaces existing `crop` and stays first.
- incoming `mirror{horizontal}` when a `mirror{horizontal}` exists → single horizontal mirror (idempotent); a `mirror{vertical}` coexists.
- empty existing + incoming → incoming.

Medium test:

- `POST /assets/:id/edits/preview` on a real image returns image bytes and writes **no** `asset_edit` row (query the table before/after).

### Edge cases

- Asset with prior persisted edits → preview reflects merged result (before/after consistent).
- `autoEnhance` preview → rendered via `.normalise()` (same path as apply).
- Concurrent previews (the card fires ~3) → stateless, independent.
- Large source image → size cap (thumbnail/preview) bounds work; no full-res render.
- Missing/unreadable original file → clean error, no 500.

### Verification

```bash
pnpm -C server test -- --run src/controllers/asset.controller.spec.ts src/services/asset.service.spec.ts src/utils/asset-edit.spec.ts
pnpm -C server test:medium -- --run src/services/asset.service.medium.spec.ts   # add the preview round-trip case here (or the nearest existing asset medium spec)
make check-server && make lint-server
pnpm -C server build && pnpm -C server sync:open-api && make open-api
git status --porcelain open-api/ mobile/openapi/   # new preview route present
make format-server
```

### Commit

`feat(editing): ephemeral non-persisting edit-preview render endpoint`

---

## Slice 3 — Agent operation family: `asset.adjust` + `asset.flip` (server)

Two reviewable ops, same lifecycle as `asset.crop` (ImageEditBatch target, `editAssets` scope, **Low risk**, reversible).

### Files

- `server/src/enum.ts` — `AssetAdjust = 'asset.adjust'`, `AssetFlip = 'asset.flip'`.
- `server/src/dtos/agent-operation.dto.ts` — payload schemas + **both union sites**.
- `server/src/services/agent-operation-plan.service.ts` — apply + summary + target/scope/risk maps + proposeAssetBatch apply switch + the merge util from Slice 2.
- `server/src/services/agent-mcp-tool-contract.service.ts` — action descriptions + ≤2 examples each.
- Specs: `agent-operation.dto.spec.ts`, `agent-operation-plan.service.spec.ts`, `agent-mcp-tool-contract.service.spec.ts`.

### Payloads (`agent-operation.dto.ts`)

- `assetAdjustPayloadSchema` = a **`z.strictObject`** mirroring Slice 1's `AdjustParameters` fields (brightness/contrast/saturation/autoEnhance) **plus the same XOR `superRefine`**. Do **not** import the editing.dto schema directly — agent-operation.dto uses `z.strictObject` (reject unknown keys) and its own `.meta({ id })` conventions, unlike editing.dto's loose `z.object`. Reuse the `TonalLevel` enum, not a copy.
- `assetFlipPayloadSchema = z.strictObject({ axis: z.enum(['horizontal', 'vertical']) })`.

Register **both** new ops in **both** places (the crop-bug lesson — a missing entry in the second union lets the workflow classify but not propose):

1. The standalone operation schemas (`setCropOperationSchema` neighborhood ~line 553), each with `validateStandaloneTarget(operation, ctx, AgentOperationTargetKind.ImageEditBatch, AgentOperationType.AssetAdjust /* and .AssetFlip */)`.
2. The `proposeAssetBatch` action `extend` union (~line 891) used by `proposeAssetBatchFromSearch`/`FromSelection`.

### Plan service (`agent-operation-plan.service.ts`)

- `applyAdjustOperation` / `applyFlipOperation` mirroring `applyCropOperation`: per asset → `getAssetEdits` → `mergeEdits` (shared util) → `editAsset`. Adjust replaces any existing adjust; flip ensures one mirror of the axis. Non-image assets in the selection are **skipped** (same tolerance as crop).
- Summary mapping (the `AssetCrop` summary switch ~line 529): adjust → human string from the set fields (e.g. "Adjust matching photos: brighter, more contrast" / "Auto-enhance matching photos"); flip → "Flip matching photos horizontally/vertically".
- `targetKind` map: both → `ImageEditBatch`.
- `writeScope` map / `validateWriteScope`: both → `editAssets` (the existing `AssetCrop`/`AssetRotate` branch — extend the condition at ~line 1965).
- `risk` map: both → **Low** (reversible).
- proposeAssetBatch apply switch (~line 2836): add `AssetAdjust → applyAdjustOperation`, `AssetFlip → applyFlipOperation`.

### Contract (`agent-mcp-tool-contract.service.ts`)

Add `asset.adjust` and `asset.flip` to the `proposeAssetBatchFromSearch`/`FromSelection` action descriptions, each with **≤2 examples** (token-opt cap): adjust → one manual (brightness+contrast) + one autoEnhance; flip → one horizontal + one vertical.

### Tests (write first)

`agent-operation.dto.spec.ts`:

- adjust payload: one field parses; empty → rejected; autoEnhance+manual → rejected; bad level → rejected.
- flip payload: valid axis parses; missing axis → rejected; bad axis → rejected.
- adjust/flip with `AssetBatch` target (not `ImageEditBatch`) → rejected by `validateStandaloneTarget`.
- **both ops are members of the `proposeAssetBatch` action union** (parse a proposeAssetBatch request whose operation is `asset.adjust` and one that is `asset.flip`) — the explicit crop-bug regression.
- **iterate contract:** a `reviseProposedOperations` request whose replacement operation is an `asset.adjust` (different level) parses and validates — proves the headline preview-iterate loop round-trips through revise.
- `z.strictObject` rejects an unknown key in the adjust payload (e.g. `{ brightness, sharpen }` → rejected).

`agent-operation-plan.service.spec.ts`:

- `applyAdjustOperation`: merges + calls `editAsset` with the adjust edit; replaces an existing adjust; skips a non-image asset.
- `applyFlipOperation`: ensures one mirror of the axis; idempotent on repeat.
- summary strings for: brightness-only, brightness+contrast, autoEnhance, flip-horizontal, flip-vertical.
- target = ImageEditBatch; risk = Low; `editAssets` ungranted → blocked with disclosure; granted → proceeds.
- proposeAssetBatch apply routes `asset.adjust`/`asset.flip` to the right apply methods.

`agent-mcp-tool-contract.service.spec.ts`:

- new examples parse against the schema; ≤2 examples per tool preserved (token-opt invariant).

### Edge cases

- Mixed image/video selection → videos skipped (tested).
- `editAssets` off (Careful preset) → blocked + disclosed (no partial apply).
- Revising an adjust op to different levels → new plan; apply replaces (merge), never stacks.

### Verification

```bash
pnpm -C server test -- --run src/dtos/agent-operation.dto.spec.ts src/services/agent-operation-plan.service.spec.ts src/services/agent-mcp-tool-contract.service.spec.ts
make check-server && make lint-server
pnpm -C server build && pnpm -C server sync:open-api && make open-api   # TS + Dart — new op enums/payloads
git status --porcelain open-api/ mobile/openapi/
make format-server
```

### Commit

`feat(agent): asset.adjust + asset.flip reviewable operations`

---

## Slice 4 — Web plan card: before/after preview + iterate (web)

### Files

- `web/src/routes/(user)/assistant/agent-plan-thumbnail-strip.svelte` — before/after variant for image-edit ops.
- A preview-fetch helper (e.g. `web/src/routes/(user)/assistant/agent-plan-edit-preview.ts`): `POST /assets/:id/edits/preview?size=thumbnail` via a **direct authenticated `fetch`** (the generated SDK doesn't model a binary POST response) → `blob()` → object URL, with abort + URL revocation on teardown/payload-change.
- `web/src/lib/i18n/en.json` — Before/After preview strings.
- Specs: `agent-plan-thumbnail-strip.spec.ts` (extend), a helper spec.

### Behavior

- When the operation is an **ImageEditBatch** op (adjust/flip/crop/rotate — crop/rotate get previews for free), the strip renders representative assets (cap ~3) as **before → after** pairs:
  - **before** = `getAssetMediaUrl({ id, size: AssetMediaSize.Thumbnail })` (already reflects persisted edits).
  - **after** = object URL from the preview helper, requesting **`size=thumbnail`** so before/after match resolution, posting the op's edit actions for that asset id.
- Label "Preview · Before → After" + "Same adjustment applied to all N photos."
- Reuse the existing loading + failed-tile states; an after-tile fetch failure shows the failed state and keeps before visible.
- **Iterate (no new machinery):** the preview is **keyed on a hash of the operation's edit actions**. When the user says "more contrast" and the agent calls `reviseProposedOperations`, the new operation payload changes the hash → after-tiles re-fetch (old object URLs revoked). This is the existing revise loop; the card only needs to react to payload changes.
- The op **name** uses the existing `typeLabelKeys` fallback (no new i18n for "Adjust"/"Flip").

### Tests (write first)

- Strip renders before + after `<img>` for an adjust op; after src is the preview object URL.
- Non-edit ops (e.g. album.addAssets) render the existing single-thumbnail strip (no regression).
- After-tile fetch failure → failed state shown; before still rendered.
- Edit-actions hash change → after-tiles re-fetch; prior object URLs revoked (spy `URL.revokeObjectURL`).
- Preview helper: posts the edits, returns an object URL on 200; throws/marks-failed on error; aborts in-flight request on teardown.

### Edge cases

- Many assets → only ~3 previewed, overflow count shown ("applied to all N").
- Rapid revises → in-flight preview aborted before re-fetch (no stale image flashes).
- `check:svelte` is a local no-op (known); rely on `make check-web` + CI Test Web.

### Verification

```bash
pnpm -C web test -- --run src/routes/(user)/assistant/agent-plan-thumbnail-strip.spec.ts src/routes/(user)/assistant/agent-plan-edit-preview.spec.ts
make check-web
make format-web
```

### Commit

`feat(web): before/after edit preview on the agent plan card`

---

## Slice 5 — Runner workflows: `adjust_assets` + `flip_assets` (agent-runner)

### Files

- `agent-runner/src/strict-workflows/workflows/adjust-assets.mjs` (new).
- `agent-runner/src/strict-workflows/workflows/flip-assets.mjs` (new).
- `agent-runner/src/strict-workflows/manifest.mjs` — register both.
- Regenerate `manifest.generated.json` + matrix via `pnpm --dir server sync:agent-capabilities`.
- `docs/superpowers/specs/2026-05-19-pi-agent-capability-matrix.md` — Flow-Ownership + Core-Capability rows; move "Edits beyond rotation" out of Needs-New-Tool (note straighten remains).
- Tests: `adjust-assets.test.mjs`, `flip-assets.test.mjs`, dispatcher routing assertions.

### `adjust_assets` (hybrid)

- **Match** verb-anchored tonal/enhance intents: brighten/darken, "more/less contrast", "more vivid / saturated / make it pop / punchier", "desaturate / mute / less colour", and auto-enhance phrasings ("auto-enhance", "fix the lighting/exposure", "improve / clean up the lighting").
- **Source** via the shared resolver (containers like albums/spaces are legitimate **sources** — "brighten my Family album" = adjust assets in it; verb-anchoring already prevents stealing rename/share/delete-album prompts, so no blanket container guard).
- **Slot parse → `AdjustParameters`:** intensity words → level (`a touch/slightly`→slight, default→moderate, `a lot/way/much/really`→strong); direction from the verb; combined intents set multiple fields ("brighten and add contrast" → brightness + contrast). Auto-enhance phrasings → `{ autoEnhance: true }` (XOR with manual — never mix).
- **Propose** `asset.adjust` via `proposeAssetBatchFromSearch`/`FromSelection`.
- **Decline / needsInput:** no source → ask which photos; no recognized adjustment → handoff; conflicting "brighten and darken" → needsInput (ambiguous); vague aesthetic with no enhance verb ("make these look amazing/artistic") → handoff; video-only source → handoff (image-only).

### `flip_assets` (hybrid)

- **Match** "flip / mirror"; axis from phrasing ("flip vertically / upside down" → vertical; otherwise → **horizontal** as the common mirror).
- **Source** via shared resolver; **must not steal** "rotate / turn" (→ `rotate_assets`) or "crop" (→ `crop_assets`).
- **Propose** `asset.flip`. Video-only source → handoff.

### Tests (write first)

`adjust-assets.test.mjs` (`node:test`):

- "brighten my last 10 photos" → adjust, brightness=moderate_increase, recency source resolved.
- "make my Berlin photos pop" → saturation=moderate_increase, Berlin source.
- "increase contrast a lot on these" → contrast=strong_increase from a selection.
- "brighten and add a bit of contrast" → brightness=moderate_increase + contrast=moderate_increase (single op; combined-adjustment fields default to moderate — per-field intensity is out of scope).
- "auto-enhance my newest 5" / "fix the lighting on these" → `{ autoEnhance: true }`.
- "desaturate these" → saturation=moderate_decrease.
- negatives: "rotate these" → NOT adjust; "crop to 0,0,800,600" → NOT adjust; "make these look amazing" → handoff; "brighten" (no source) → needsInput; "brighten and darken these" → needsInput.
- video-only source → handoff.

`flip-assets.test.mjs`:

- "flip this horizontally" → axis=horizontal; "mirror these" → horizontal; "flip upside down" / "flip vertically" → vertical.
- negatives: "rotate this" → NOT flip; "crop this" → NOT flip; "flip" no source → needsInput.

**Mixed tonal + geometry prompt** ("brighten and flip these"): the dispatcher routes to a single workflow (registry-order winner) which proposes its one op; the other verb is **not** auto-applied. Documented limitation — the user applies/continues for the second. Test: "brighten and flip these" routes to exactly one of `adjust_assets`/`flip_assets` and proposes a single op (assert it does not silently drop the source or emit two plans).

Dispatcher: both kinds registered; chatter/negatives unaffected; classify still reached for non-matching prompts.

### Verification

```bash
cd agent-runner && node --test src/strict-workflows/workflows/adjust-assets.test.mjs src/strict-workflows/workflows/flip-assets.test.mjs
node --test 'src/**/*.test.mjs'                       # full runner suite green, count up
pnpm --dir server sync:agent-capabilities             # regen manifest + matrix
git diff --stat agent-runner/src/strict-workflows/manifest.generated.json docs/superpowers/specs/2026-05-19-pi-agent-capability-matrix.md
pnpm -C docs exec prettier --write docs/superpowers/specs/2026-05-19-pi-agent-capability-matrix.md  # docs prettier, NOT server
```

### Commit

`feat(agent): adjust_assets + flip_assets strict/hybrid workflows`

---

## Slice 6 — L3 live eval + integrated verify + finalize

### L1 (component, in `adjust-assets`/`flip-assets` tests above)

Routing + slot fidelity already covered in Slice 5. Add an L1 eval scenario file entry per the existing L1 harness (mirrors `crop`/`rotate` L1 entries) so the suite counts go up.

### L3 (live, propose-only, gemma4 on a personal-test clone)

Per `reference_pi_agent_clone_l3_setup`: build the branch RC, `clone-personal`, hand-wire agent-runner + gemma4 egress, run `eval:l3`.

Scenarios (preset = VisualOrganizer, which **grants** `editAssets` → these can propose live). Because the intents are **verb-driven** (not coordinate-driven like crop), they are expected to route reliably where crop's coordinate intent did not (OQ-F1). The L3 run confirms this live; **if any specific verb/level proves unreliable with the live model, document it as a known limitation** (the way crop's OQ-F1 was) rather than forcing a brittle assertion:

- `l3.plan.adjust.brightness` — "brighten my last 10 photos" → routes `adjust_assets`, proposes `asset.adjust`.
- `l3.plan.adjust.saturation` — "make these more vivid" → adjust, saturation increase.
- `l3.plan.adjust.autoenhance` — "auto-enhance my newest 5" → adjust, autoEnhance.
- `l3.plan.flip.horizontal` — "flip this horizontally" → routes `flip_assets`, proposes `asset.flip`.
- Negatives stay green: "rotate these" → rotate, "how many photos do I have?" → none, chatter → none.
- **Read-only audit clean** — propose-only; nothing applied (assert no `asset_edit` rows created during the run).

### Integrated verify

- Server full suite (`pnpm -C server test`), `make check-server && make lint-server`, `make check-web`.
- Runner full suite (`node --test 'src/**/*.test.mjs'`), L1 100%.
- OpenAPI clean (TS + Dart) — `git status --porcelain open-api/ mobile/openapi/` empty after regen.
- Capability matrix regenerated + docs-prettier clean.

### Finalize

- Capability matrix: adjust/flip rows in Flow-Ownership + Core-Capability; "Edits beyond rotation" moved to shipped (straighten noted as the remaining geometry follow-up); Next-Steps entry.
- Tear down the clone (`clone-personal.sh --down <slug>`); confirm gemma4 idle.

### Commit

`test(agent): L1 + live propose-only L3 for image adjustments; finalize capability matrix`

---

## Out of scope (v1)

- **Straighten** (arbitrary-angle rotate + auto-crop + face/OCR box remap) — documented follow-up.
- **Human web-editor sliders** for brightness/contrast/saturation — separate spec; the agent-created edits remain removable in the existing editor via `removeAssetEdits`.
- **Raw numeric** adjustment factors — named levels only.
- **Greyscale / hue-shift / sharpen / vignette / filters** — future image-edit families.
- **Permanent / destructive** edits — all edits stay non-destructive and reversible.

## Risk register

| Risk                                                                      | Mitigation                                                                                                                                         |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| New op missing from the second `proposeAssetBatch` union (crop-bug class) | Explicit dto test that adjust + flip parse inside a proposeAssetBatch request (Slice 3).                                                           |
| OpenAPI Dart left stale                                                   | Every server slice regen + asserts `mobile/openapi/` diff (G2 lesson).                                                                             |
| Contrast wrong on rgb16 pipeline                                          | `mid` from working colorspace via a pure `contrastLinear` helper, unit-tested both colorspaces; render test asserts the helper's output (Slice 1). |
| Preview ≠ apply (existing edits)                                          | Preview merges with persisted edits via the shared `mergeEdits` util (Slice 2).                                                                    |
| Before/after look mismatched (resolution)                                 | Preview endpoint takes a bounded `size`; the strip requests `thumbnail` for both tiles (Slices 2/4).                                               |
| Iterate (preview→revise) loop silently regresses                          | dto test: `reviseProposedOperations` accepts an `asset.adjust`; web test: after-tiles re-fetch on edit-payload hash change (Slices 3/4).           |
| Small model guesses numbers                                               | Named levels only; preview + revise loop lets the user correct by eye.                                                                             |
| Mixed tonal+geometry prompt drops a verb                                  | Documented single-op routing; explicit "brighten and flip" routing test (Slice 5).                                                                 |
| Runner not in CI                                                          | L1 100% + live L3 propose-only are the gates; full runner suite run locally each slice.                                                            |
| Server prettier churns the matrix                                         | Docs prettier only for markdown; `sync:agent-capabilities` owns the generated block.                                                               |

```

```
