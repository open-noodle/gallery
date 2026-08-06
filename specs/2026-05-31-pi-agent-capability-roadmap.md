# Pi Agent Capability Roadmap — Quality, Geocode, Restore, Disambiguation, Screenshots, Edits & Sharing

Status: ready for impl-loop (large, multi-phase)
Date: 2026-05-31
Branch: `explore/pi-agent-brainstorm` (PR #574)
Builds on: the 19 strict/hybrid workflows + the reversible `asset.trash` foundation.

## How To Use This Spec

This is a roadmap of **six independent capabilities**, ordered by priority. Each
is a self-contained **phase** broken into small `/impl-loop` slices. Phases are
independent — they can be implemented in order, or a later phase deferred, without
blocking earlier ones. Treat completed slices as a baseline.

### TDD is mandatory for every slice

No production code before a failing test:

1. Write the listed failing tests first.
2. Run them and confirm the **expected red** failure (assert on the real error).
3. Implement the smallest change that makes them green.
4. Run the full relevant suite and confirm **green** with no regressions.
5. Refactor under green.
6. Commit with the slice tag, then push.

### Full test + edge-case coverage — including L1 and L3 — is required

Every slice must specify and cover the layers that apply to it:

- **L2 (unit + contract):** the primary gate. Server: vitest specs. agent-runner:
  `match`/`parseSlots`/`run` + a contract-fixture validator for any new op/tool.
  ML service: pytest. **Every edge case listed in the slice is a named test.**
- **L1 (classifier + slot eval, agent-runner/eval):** required for any slice that
  adds or changes routing or slot extraction — a new workflow, a new resolver
  token, or a changed `match`. Add recall + slot-fidelity scenarios and the
  disambiguation negatives that protect neighbors; run `eval/run.mjs --runs 5` and
  re-seed `baseline.json` to 100% in the same slice. A slice that changes routing
  without re-seeding L1 is incomplete.
- **L3 (live, read-only against personal):** required for any slice that adds a
  workflow or a server tool/op the agent reaches. Add `l3.recall.*` routing and a
  `l3.plan.*` scenario (gated `planProposed: SEEDED ? true : undefined` when
  data-dependent). **L3 is always propose-only** — the read-only audit must show
  no plan applied. For outward-facing ops (sharing) L3 asserts routing/propose
  only and NEVER applies.

### CI discipline (learned the hard way)

vitest does **not** type-check or lint. Any slice that changes server DTOs/code
must also green `make lint-server`, `make check-server` (tsc), `make check-web`
(new DTO fields break web fixtures + the i18n exhaustive `Record<AgentToolName>`
check + the prompt-length guard), and regenerate OpenAPI/SDK
(`pnpm -C server build && pnpm sync:open-api && make open-api`). Capability-matrix
changes must keep `agent-capability-matrix.spec.ts` green (regen the generated
block; update the line-~56 "Next expansion candidates" assertion if that line
changes). The matrix per-entry agreement test requires a Flow Ownership row for
every manifest entry — add it in the same slice that adds the manifest entry.

Commands:

```bash
/opt/homebrew/bin/mise exec -- pnpm -C server test
/opt/homebrew/bin/mise exec -- pnpm --dir agent-runner test
/opt/homebrew/bin/mise exec -- pnpm -C machine-learning run test   # ML pytest (confirm script)
/opt/homebrew/bin/mise exec -- make lint-server && make check-server && make check-web
/opt/homebrew/bin/mise exec -- node --env-file-if-exists=.env agent-runner/eval/run.mjs --runs 5   # L1
/opt/homebrew/bin/mise exec -- pnpm -C agent-runner eval:l3                                          # L3 (needs RC pinned)
```

## Priority Order

1. **Image quality scoring** (`analyzeAssetQuality`) — highest leverage; unlocks
   visual cleanup + objective best-photos + a sharper duplicate keep-rule.
2. **Forward geocoder** (place name → coordinates) — best effort-to-value.
3. **Restore from trash** — quick win; completes the trash story.
4. **Durable space/user disambiguation** — UX polish; no new tool.
5. **Screenshot/document cleanup** — common request; resolver token.
6. **Crop edits + sharing/export** — bigger, product-sensitive; last.

---

## Phase A — Image quality scoring (`analyzeAssetQuality`)

### Goal

Compute per-asset heuristic quality metrics (sharpness, exposure, brightness) in
the ML service, store them, and expose them so the agent can: (a) **visual
cleanup** ("delete my blurry/dark photos" → bounded trash), (b) **objective best
photos** (rank by quality), and (c) a **sharper duplicate keep-rule** (keep the
sharpest, not just the largest).

### Current state (grounded)

- **ML service** (`machine-learning/immich_ml/`): FastAPI `main.py:176`; predictors
  extend `InferenceModel` (`models/base.py`) with `identity = (ModelType, ModelTask)`
  and `_predict(*inputs)`; registered in `models/__init__.py:get_model_class()`;
  `ModelTask`/`ModelType` in `schemas.py`. `POST /predict` takes a pipeline + image
  bytes and returns `{ [ModelTask]: <output> }`. A heuristic quality scorer needs
  **no model download** — pure OpenCV/numpy (Laplacian variance = sharpness,
  luminance histogram = exposure/brightness).
- **Server ↔ ML** (`server/src/repositories/machine-learning.repository.ts`):
  `predict<T>()` (`:198`); methods like `ocr()` / `detectFaces()` are the template
  for a new `analyzeAssetQuality(imagePath, options)`.
- **Storage**: no quality column today (`server/src/schema/tables/asset-exif.table.ts`).
  Add nullable columns there (`sharpnessScore`, `exposureScore`, `qualityScore`) OR
  a new `asset_quality` table (OQ-A1). Job completion tracked in
  `asset_job_status.table.ts` (add `qualityScoredAt`).
- **Job wiring**: mirror `OcrService` (`@OnJob` per-asset + queue-all,
  `assetJobRepository.streamForOcrJob`/`getForOcr`); add `JobName.ImageQuality(+QueueAll)`
  - `QueueName.ImageQuality` to `enum.ts`; eligible = has preview + `qualityScoredAt IS NULL`.
- **Agent exposure**: extend `readAssetMetadata` to include the scores, or a new
  read tool; the resolver/curation/`cleanup_duplicates` consume them.

### Open Contract Questions

| #     | Question                                                                                                                                                                                     | Slice |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| OQ-A1 | Store scores as nullable columns on `asset_exif` vs a new `asset_quality` table? (Columns are simpler + ride the existing exif read; a table avoids widening exif.)                          | A2    |
| OQ-A2 | The heuristic formulas + normalization (0–100): Laplacian-variance → sharpness; histogram clipping/percentiles → exposure; mean luminance → brightness. Confirm thumbnail vs original input. | A1    |
| OQ-A3 | Expose via `readAssetMetadata` (add fields) vs a dedicated `analyzeAssetQuality` read tool?                                                                                                  | A4    |
| OQ-A4 | Quality job trigger: chained after metadata-extraction/thumbnail, or a standalone queue-all only? Backfill for existing assets.                                                              | A3    |

### Slices

**A1 — ML quality predictor (pytest).** New heuristic predictor in
`machine-learning/immich_ml/models/quality/` extending `InferenceModel`, identity
`(ModelType.QUALITY, ModelTask.IMAGE_QUALITY)` (add enums in `schemas.py`),
`_predict(image)` → `{ sharpness, exposure, brightness, quality }` (0–100). Pure
OpenCV/numpy, no download. Register in `models/__init__.py`.

- TDD (pytest): a sharp test image scores higher sharpness than a blurred one; a
  clipped/over-exposed image scores low exposure; a black/blank image scores low;
  output keys + ranges (0–100) validated; deterministic on a fixed image.
- Edge cases: grayscale image; tiny image; non-image bytes → error; all-white /
  all-black; CMYK/alpha.
- Exit: ML pytest green; `/predict` returns the quality block for an
  `IMAGE_QUALITY` pipeline (add an app-level test).

**A2 — Schema + migration (server).** Per OQ-A1: add nullable
`sharpnessScore`/`exposureScore`/`brightnessScore`/`qualityScore` (int 0–100) to
the exif table (or a new `asset_quality` table) + a fork migration in
`server/src/schema/migrations-gallery/` (round timestamp). Add `qualityScoredAt`
to `asset_job_status`.

- TDD: migration up/down (medium test or sql-shape); the repository read returns
  the new fields nullable; default null for existing rows. Add the migration to
  `scripts/revert-to-immich.sql` DELETE list.
- Edge cases: existing assets read null; revert drops the columns/table cleanly.

**A3 — ML-repo method + job wiring (server).** `machineLearningRepository.analyzeAssetQuality(imagePath, options)`
(mirror `ocr()`); `ImageQualityService` with `@OnJob` per-asset (fetch asset → call
ML → store scores → `upsertJobStatus({ qualityScoredAt })`) + queue-all; `JobName`/`QueueName`
enums; `streamForImageQualityJob`/`getForImageQuality` in `asset-job.repository.ts`;
wire the trigger (OQ-A4).

- TDD: per-asset job calls ML, stores scores, sets `qualityScoredAt`, returns
  Success; queue-all streams eligible assets; re-run skips already-scored (unless
  `force`); ML error → job failure (no partial write).
- Edge cases: asset without preview skipped; ML down → retry/fail; video asset
  skipped (images only).

**A4 — Agent read exposure (server).** Per OQ-A3: surface the scores to the agent
(add to `readAssetMetadata`'s scrubbed result, and to `listDuplicateGroups`'s
per-asset summary so the keep-rule can use sharpness). Register in the MCP contract.

- TDD: `readAssetMetadata` returns the quality fields when present (null otherwise);
  `listDuplicateGroups` includes `sharpness`; scrubbing preserved (no leak).
  Contract spec updated. OpenAPI regen.
- Edge cases: null scores (unscored asset); permission respected.

**A5 — `cleanup_duplicates` keeps the sharpest (agent-runner).** Extend `pickKeeper`
to rank by sharpness BEFORE resolution (favorite > rating > **sharpness** > resolution

> age > id). Backward-compatible when sharpness is absent (treat null as lowest).

- TDD (L2): `pickKeeper` prefers the sharper of two equal-resolution dupes; null
  sharpness falls back to resolution; ties deterministic. Update the existing
  keep-rule tests.
- Edge cases: all null sharpness → identical to current behavior; mixed null/present.

**A6 — `visual_cleanup` workflow (agent-runner).** New hybrid workflow: "delete/trash
my blurry photos", "clean up dark/low-quality photos" → resolve a bounded source
(default recent/all-with-a-cap), filter by a quality threshold (low sharpness /
poor exposure), propose a **High-risk reversible `asset.trash`** over the matches.
Requires a bounded scope (no whole-library without a count); subjective beyond
quality hands off.

- TDD (L2): match accepts "trash my blurry photos", "delete dark photos from last
  month"; rejects unbounded "delete all bad photos" (asks for scope) and subjective
  "delete the ugly ones" (handoff); run proposes `asset.trash` over the
  quality-filtered selection; empty → needs_input.
- **L1**: recall "trash my blurry photos" → `visual_cleanup`; negatives (doesn't
  steal `trash_assets` plain trash, `cleanup_duplicates`). Re-seed baseline.
- Edge cases: no low-quality matches (direct answer); quality not yet scored on the
  instance (handoff/needs_input disclosing scores aren't ready).

**A7 — Hardening: matrix + L3.** Move "Visual cleanup" Constrained → **Solid now**
and "objective best photos" note in the matrix; add Flow Ownership row for
`visual_cleanup`; regen. **L3**: `l3.recall.visualcleanup` routing + a
propose-only `l3.plan.visualcleanup` (gated SEEDED — needs scored low-quality
assets). RC + re-seed `baseline.l3.json`.

---

## Phase B — Forward geocoder (place name → coordinates)

### Goal

Let `update_asset_metadata` accept a place name for location edits ("set these
photos to Paris") by resolving the name to coordinates server-side, instead of
asking the user for raw lat/lng.

### Current state (grounded)

- **`geodata_places`** (`server/src/schema/tables/geodata-places.table.ts`):
  `name`, `latitude`, `longitude`, `countryCode`, `admin1Name`, `admin2Name`,
  `alternateNames`, with **GIN trigram indexes** on name/admin/alternate — forward
  lookup is `f_unaccent(name) % $q` ranked by similarity (and population if
  available). Reverse path is in `map.repository.ts:228`.
- **Agent today**: `update-asset-metadata.mjs:51` `LOCATION_RE` extracts numeric
  coordinates only; the `asset.updateMetadata` payload (`agent-operation.dto.ts:464`)
  requires both lat+lng and explicitly rejects place names; the resolver pattern to
  mirror is `resolveAssetSearchFilters` (`asset-source-resolver.mjs:359`).

### Open Contract Questions

| #     | Question                                                                                                                                                       | Slice |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| OQ-B1 | The forward-lookup ranking (similarity + population? country-bias?) and the ambiguity threshold (when to ask "Paris, France or Paris, Texas?").                | B1    |
| OQ-B2 | A new `resolveLocation` MCP read tool vs extending `resolveAssetSearchFilters`. (A dedicated tool is cleaner — mirror its request/response + ambiguity shape.) | B1    |

### Slices

**B1 — `resolveLocation` server read tool.** A `geodata_places` forward-lookup
repository method (trigram match → top matches with lat/lng + admin/country) + a
`resolveLocation(query)` MCP read tool returning `{ status:'matched'|'ambiguous'|'not_found', latitude?, longitude?, label?, choices? }` (mirror `resolveAssetSearchFilters`).

- TDD (L2): "Paris" → matched with FR coords (or ambiguous with choices per OQ-B1);
  "Tokyo" → matched; a nonsense string → not_found; ambiguous names → choices;
  trigram fuzzy ("Pariss") matches. Registered as a read tool; OpenAPI regen.
- Edge cases: accented names; alternate names; empty query; very small towns absent
  → not_found (disclose).

**B2 — `update_asset_metadata` accepts place names (agent-runner).** Extend the
location parser to recognize "set location/place on `<source>` to `<placeName>`";
in `run`, call `resolveLocation`; on matched → inject lat/lng into the
`asset.updateMetadata` payload; ambiguous/not_found → `needs_input`.

- TDD (L2): "set these to Paris" → resolveLocation → proposes updateMetadata with
  the resolved lat/lng; ambiguous → needs_input with choices; not_found →
  needs_input; explicit coordinates still work unchanged (regression).
- **L1**: recall + slot for "set the location on my newest 20 to Paris" →
  `update_asset_metadata`; the existing coordinate path stays. Re-seed.
- Edge cases: place + explicit coords both given (prefer explicit, or ask);
  place name that is also a person/album (don't misroute).

**B3 — Hardening: matrix + L3.** Move "Place-name-to-coordinate metadata edits"
out of "Needs New MCP Tool"; note `resolveLocation` in read tools; update the
metadata Core Capability row (place names now resolve). **L3**:
`l3.recall.geocode` + a propose-only `l3.plan.geocode` ("set my newest 20 to
Paris" proposes an updateMetadata with coords). RC + re-seed.

---

## Phase C — Restore from trash

### Goal

A reversible `asset.restore` operation + `restore_assets` workflow so the agent can
un-trash assets ("restore those", "get my photos back from trash"). Completes the
trash story shipped this session.

### Current state (grounded)

- `TrashService.restoreAssets(auth, { ids })` (`trash.service.ts:12`):
  Trashed → Active (`deletedAt: null`), `Permission.AssetDelete`, emits
  `AssetRestoreAll`, bulk via `trashRepository.restoreAll`.
- Trashed assets are queryable via the asset repo `isTrashed` option
  (`asset.repository.ts:1501`) — but confirm whether the agent `searchAssets`
  filter surface exposes it (OQ-C1).
- The `asset.trash` op (this session) is the exact template: enum, `trashOperationSchema`,
  `validateWriteScope` (`trashAssets` flag), apply case, `requiresWritableAssets`,
  the `trash_assets` workflow, the `validateAssetTrash` fixture.

### Open Contract Questions

| #     | Question                                                                                                                                          | Slice |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| OQ-C1 | Does the agent `searchAssets`/resolver expose an `isTrashed` filter so "my trashed photos" resolves? If not, add it (the asset repo supports it). | C1    |
| OQ-C2 | Risk level for restore (Low — non-destructive) and write-scope (reuse `trashAssets`).                                                             | C2    |

### Slices

**C1 — `isTrashed` search filter (server, if needed).** Add `isTrashed?: boolean`
to the agent `searchAssets` filter (`agent-tool.dto.ts`) wired to the asset repo
option, so a source like "my trashed photos" / "what I just trashed" resolves to
trashed assets. Resolver recognizes the "trashed"/"in the trash" token.

- TDD (L2): searchAssets with `isTrashed:true` returns only trashed; default
  excludes trashed (regression); the resolver maps "trashed photos" → `isTrashed:true`.
- Edge cases: combined with date ("trashed last week"); no trashed assets → empty.

**C2 — `asset.restore` operation (server).** Mirror `trashOperationSchema`: enum
`AssetRestore='asset.restore'`, schema (no payload, asset_batch, **Low** risk),
apply case `trashService.restoreAssets(auth, { ids })`, `validateWriteScope`
reusing `trashAssets`, `requiresWritableAssets`. MCP contract example. OpenAPI regen.

- TDD (L2): schema valid/invalid (no payload); apply calls `restoreAssets` with the
  ids; write-scope gate (reuse `trashAssets`); Low risk. Run lint/check-server/check-web.
- Edge cases: restoring a non-trashed asset (no-op / partial); permission gap → partial.

**C3 — `restore_assets` workflow (agent-runner) + fixture.** Mirror `trash_assets`:
"restore/recover/untrash/get back `<source>`" → resolve (likely an `isTrashed`
source) → propose `asset.restore`. Add `validateAssetRestore` fixture +
`'asset.restore'` to KNOWN_OPERATION_TYPES. Registry + manifest + matrix Flow
Ownership row + regen.

- TDD (L2): match accepts "restore my newest 20 from trash", "recover the photos I
  just trashed"; rejects non-restore phrasings; run proposes `asset.restore`;
  empty → needs_input.
- **L1**: recall "restore my trashed photos" → `restore_assets`; negatives (doesn't
  steal `trash_assets`). Re-seed.
- Edge cases: nothing in trash matching → direct answer; subjective source handoff.

**C4 — Hardening: L3.** `l3.recall.restore` + a propose-only `l3.plan.restore`
(gated SEEDED — needs trashed assets). RC + re-seed. (Restore is reversible +
propose-only, so L3 is safe.)

---

## Phase D — Durable space/user disambiguation

### Goal

When `manage_space_members`, `change_member_role`, `rename_or_describe_space`, or
`manage_space_assets` hit an ambiguous space or user name, offer a durable
candidate list ("1. Family 2. Family 2026 — which?") that the next turn resolves
("the first one" / "Family 2026"), instead of a bare re-prompt. Reuse the trip
workflow's continuation protocol.

### Current state (grounded)

- **Continuation protocol** exists and is generic: `protocol.mjs:58` `needsInput({ continuation })`;
  workflow `buildContinuation`/`resumeContinuation` (`protocol.mjs:75`); the dispatcher
  persists pending `{ workflowKind, kind:'selection', continuation }`
  (`dispatcher.mjs:111`) and resumes it next turn (`dispatcher.mjs:147`); the server
  persists `workflowState` jsonb (`agent-session.table.ts:64`,
  `agent-runner.service.ts:405`) with a 10-min TTL. The trip workflow
  (`create-recent-trip-album.mjs:62-86`, `strict-workflows.mjs:170-247`) is the
  complete model (ordinal + name matching against compacted candidates).
- **Today** the four space/user workflows return bare `needsInput()` with no
  continuation (`manage-space-members.mjs:178-217`, `change-member-role.mjs:114-147`,
  `rename-or-describe-space.mjs:99-102`, `manage-space-assets.mjs:119-124`).

### Open Contract Questions

| #     | Question                                                                                                                                                                        | Slice |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| OQ-D1 | A shared disambiguation-continuation helper (build + resume from a `{candidates:[{index,id,name}]}` list) reused by all four workflows, vs per-workflow. (Shared helper — DRY.) | D1    |

### Slices

**D1 — Shared disambiguation-continuation helper (agent-runner).** A helper that
builds a `{ kind, candidates:[{index,id,name}], ... }` continuation and a
`resumeFromCandidates(pending, prompt)` (ordinal "first/1", exact/substring name
match) → `{ status:'matched', choice } | { status:'needs_input'|'expired' }`,
mirroring `strict-workflows.mjs` candidate resolution. Pure unit-testable.

- TDD (L2): build compacts candidates (no raw asset ids); resume matches "first",
  "2", and a name substring; ambiguous follow-up → needs_input; expired (TTL) →
  expired; no-match → needs_input.
- Edge cases: single candidate (confirm yes/no); duplicate names; numeric name.

**D2 — `manage_space_members` adopts continuation.** On ambiguous space/user,
return `needsInput({ continuation })` with the candidate list; add `resumeContinuation`

- `supportsContinuation:true`; `run` accepts the resolved space/user context.

* TDD (L2): ambiguous space → continuation with candidates; next turn "the first
  one" resumes and proposes; ambiguous user likewise; non-ambiguous unchanged.
* **L3** (Phase-D hardening): live multi-turn resume on personal (the trip workflow
  already proves the mechanism; add a `l3.multiturn.spacepick`).
* Edge cases: user picks an out-of-range ordinal; picks a name not in the list.

**D3 — `change_member_role` adopts continuation.** Same pattern. TDD + edge cases as D2.

**D4 — `rename_or_describe_space` + `manage_space_assets` adopt continuation.** Same
pattern for the space disambiguation in both. TDD + edge cases.

**D5 — Hardening: L1 + L3.** L1: the disambiguation routing is unchanged (these are
run-time continuations, not routing) — confirm no L1 regression. L3: a
`l3.multiturn.*` candidate-resume scenario per adopted workflow (routing + the
two-turn resume); RC + re-seed. Matrix: note durable disambiguation in the Flow
Ownership invariants.

---

## Phase E — Screenshot/document cleanup

### Goal

Let the agent bound a source like "my screenshots" so existing workflows
(`archive_assets`, `trash_assets`, `cleanup_duplicates`) can act on them.

### Current state (grounded)

- **No `isScreenshot` column.** The fork's classification (`classification.service.ts:179`)
  auto-tags assets `Auto/{category}` when configured; an admin-configured
  "Screenshots" category yields an `Auto/Screenshots` tag. The agent can already
  filter by a resolved tag (`resolveAssetSearchFilters({ tags:['Screenshots'] })`
  → `tagIds`).
- Heuristic fallback signals: `asset_exif.make/model IS NULL`, `originalFileName`
  pattern, `.png`, `type=IMAGE`. The agent `searchAssets` filter
  (`agent-tool.dto.ts:318`) has `tagIds` but no `make:null`/filename filter today.

### Open Contract Questions

| #     | Question                                                                                                                                                                                                            | Slice |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| OQ-E1 | Tag-based (resolve the `Screenshots`/`Auto/Screenshots` tag — needs admin config) vs heuristic (add a `make:null` + filename filter). Recommend **tag-first with a heuristic fallback**, disclosing which was used. | E1    |

### Slices

**E1 — Resolver recognizes "screenshots" (agent-runner, tag-first).** Extend
`parseEntitySource` (`asset-source-resolver.mjs`) to recognize the "screenshots" /
"screen shots" / "screen captures" noun → resolve the `Screenshots` (or
`Auto/Screenshots`) tag via `resolveAssetSearchFilters`. If not found, fall back
to a heuristic and disclose (OQ-E1).

- TDD (L2): "archive my screenshots" → resolver emits a tag filter for Screenshots;
  tag not found → handoff/needs_input disclosing screenshots aren't tagged on this
  instance (or the heuristic path if E2 lands).
- **L1**: recall "archive my screenshots" → `archive_assets`; "trash my screenshots"
  → `trash_assets` (routing by verb; the screenshot source resolves at run time).
  Re-seed.
- Edge cases: "screenshot" singular; mixed "screenshots from last week" (tag + date).

**E2 — Heuristic `make:null` filter (server, optional fallback).** If OQ-E1 chooses
a heuristic fallback: add `noCamera`/`make:null` + filename-pattern support to the
agent `searchAssets` filter, wired to the asset repo. OpenAPI regen + lint/check.

- TDD (L2): searchAssets with the no-camera filter returns camera-less images; the
  resolver uses it as the screenshots fallback.
- Edge cases: scanned documents (also camera-less) — disclose the heuristic is
  approximate.

**E3 — Hardening: matrix + L3.** Move "Screenshot/document cleanup" feasibility to
solid (tag-based) in the matrix. **L3**: `l3.recall.screenshots` ("archive my
screenshots" → archive_assets) + a propose-only `l3.plan.screenshots` gated SEEDED
(needs a Screenshots tag on the instance). RC + re-seed.

---

## Phase F — Crop edits + sharing/export (product-sensitive — last)

### Goal

(F-edits) A reversible `asset.crop` agent operation (crop is already schema-ready).
(F-share) A privacy-reviewed `shareLink.create` operation. Enhance (filters) is
net-new edit infra and is **out of scope** here.

### Current state (grounded)

- **Edits** (`editing.dto.ts`): `AssetEditAction` has Crop `{x,y,width,height}`,
  Rotate, Mirror, Trim. Crop is fully schema-validated (bounds, image-only,
  must-be-first). `asset.rotate` (`agent-operation.dto.ts:521`, apply
  `agent-operation-plan.service.ts:3037` via `assetService.editAsset/getAssetEdits`,
  target `ImageEditBatch`) is the exact op template. **Crop reuses all of it.**
- **Sharing** (`shared-link.service.ts:68`): create `{ type: album|individual,
albumId|assetIds, password?, expiresAt?, allowDownload?, showMetadata? }`,
  `Permission.AlbumShare`/`AssetShare`. **No agent share op today.** Download is
  service-level (`download.service.ts`), not agent-facing.

### Open Contract Questions

| #     | Question                                                                                                                                                                                                                                                                                                      | Slice |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| OQ-F1 | Crop geometry from a natural-language prompt is hard (the agent rarely knows pixel coords). Scope crop to explicit/relative crops only, or defer crop and ship sharing first?                                                                                                                                 | F1    |
| OQ-F2 | Sharing is **outward-facing** (creates a public link). Risk level (High), write-scope (new `createSharedLinks` flag, default false, granted only in LocalPowerUser?), and the **L3 must never actually create a link** (propose-only, and the eval preset must not apply). Product/privacy sign-off required. | F3    |

### Slices

**F1 — `asset.crop` operation (server).** Mirror `rotateOperationSchema` (target
`ImageEditBatch`, payload `{x,y,width,height}`), apply via `assetService.editAsset`
(crop must be first edit; merge with existing). Reversible (clears via
`removeAssetEdits`). Risk Low/Medium. Per OQ-F1, support explicit geometry only.

- TDD (L2): schema valid/invalid (bounds, geometry required); apply calls editAsset
  with the crop edit; image-only; reversible. lint/check/OpenAPI.
- Edge cases: out-of-bounds crop rejected; video asset rejected; crop on an
  already-edited asset merges correctly.

**F2 — `crop_assets` workflow (agent-runner) + fixture + L1/L3.** A workflow for the
narrow explicit-crop case (likely single-asset, explicit geometry) + fixture +
manifest + matrix + L1 recall + propose-only L3. (May be small/edge given OQ-F1;
acceptable to scope tightly or defer if crop-by-NL proves impractical.)

**F3 — `shareLink.create` operation (server) — privacy-gated.** New op wrapping
`sharedLinkService.create` (individual assets), with a new `createSharedLinks`
write-scope (default false; granted per OQ-F2), High risk, password/expiry
support. **Outward-facing**: extra confirmation; L3 NEVER applies.

- TDD (L2): schema (assetIds + optional password/expiry/showMetadata); apply calls
  create with `type:individual`; write-scope gate; High risk. lint/check/OpenAPI/web.
- Edge cases: empty selection; expiry in the past rejected; showMetadata/allowDownload
  defaults; permission gate.

**F4 — `share_assets` workflow + hardening.** Workflow ("share these photos as a
link, expires in 7 days") → propose `shareLink.create`; manifest + matrix Flow
Ownership row + L1 + **propose-only L3 (never creates a link)**. Move sharing out of
"Needs New MCP Tool" only after the propose path is proven. RC + re-seed.

---

## Cross-Cutting Acceptance

- Each phase: full server + agent-runner (+ ML where touched) unit suites green;
  lint/tsc/check-web clean; OpenAPI/SDK regenerated for DTO changes.
- Every new workflow/resolver-token: **L1 100%** (re-seed) and **L3 audits clean**
  (propose-only; nothing applied; outward-facing ops never executed live).
- Capability matrix kept current per phase (generated block + Flow Ownership +
  Core Capability + Needs-New-Tool moves), `agent-capability-matrix.spec.ts` green.
- No regression to the 19 existing workflows (disambiguation sweep stays green).
- Destructive/outward-facing safety: quality scoring is read-only; restore + crop
  are reversible; trash stays reversible; **sharing requires explicit product
  sign-off and never auto-applies in any eval**.

## Sequencing Note

Phases are independent and prioritized A→F. A and F are the largest (A spans the ML
service + a migration; F is product-sensitive). B, C, D, E are smaller, high-value,
and low-risk — a good middle band if A's ML work needs to be scheduled separately.
