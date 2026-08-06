# Phase F — Crop edits + sharing/export — impl-loop plan

Spec: `docs/superpowers/specs/2026-05-31-pi-agent-capability-roadmap.md` (Phase F). Product-sensitive; last.

## Autonomous decisions (OQ)

- **OQ-F1 (crop geometry).** Scope crop to **explicit geometry only** (`x,y,width,height` supplied in the prompt).
  NL/relative crop is impractical (the agent rarely knows pixel coords) → the workflow requires explicit geometry
  and asks for it otherwise. Crop is reversible (clears via `removeAssetEdits`), Low/Medium risk.
- **OQ-F2 (sharing).** Implement the op + workflow **propose-only**: a new `createSharedLinks` write-scope that
  **defaults false in EVERY preset (granted nowhere by default)**, **High** risk, and **L3 NEVER applies** (routing
  - propose only; the eval preset must not carry the scope). No outward-facing link is created during
    implementation, tests (mocked), or eval. Enabling live link creation remains gated on the user's product/privacy
    sign-off (granting `createSharedLinks` in a preset) — explicitly OUT of scope here.

## Integration map (verified)

- Rotate op template: `agent-operation.dto.ts` `assetRotatePayloadSchema:403-410`, `rotateOperationSchema:521-530`
  (target ImageEditBatch via `validateStandaloneTarget(...ImageEditBatch, AssetRotate)`); union `:635`. Apply
  `agent-operation-plan.service.ts:2768-2770` → `applyRotateOperation:3037-3091` (`getAssetEdits`→merge→`editAsset`;
  AssetType.Image only); `validateWriteScope:1925` (editAssets); `requiresWritableAssets:1087`.
- Crop schema: `editing.dto.ts` `enum AssetEditAction { Crop='crop' }` `:4`; `CropParametersSchema:23-30`
  `{x:min0,y:min0,width:min1,height:min1}`; union entry `:62`. (Crop is must-be-first in the edit list.)
- Share: `shared-link.service.ts` `create(auth, SharedLinkCreateDto):68`; `Permission.AlbumShare:74`,
  `AssetShare:83`. Write-scope: `agent-session.dto.ts` `expandedWriteScopeShape:49-68`,
  `legacyWriteScopeDefaults:33-48`, `AgentWriteScopeSchema:70`; spec enumerates keys in
  `agent-session.dto.spec.ts:37`. Add `createSharedLinks` (default false).
- Rotate workflow template: `agent-runner/.../workflows/rotate-assets.mjs`.

## Slice F1 — `asset.crop` operation (server, TDD)

Mirror `asset.rotate`. `assetCropPayloadSchema` = reuse/match `CropParametersSchema` `{x,y,width,height}` (ints,
x/y≥0, w/h≥1). `cropOperationSchema` (target **ImageEditBatch**, payload, superRefine
`validateStandaloneTarget(...ImageEditBatch, AssetCrop)`); union; enum `AssetCrop='asset.crop'`;
`validateWriteScope` reuse **editAssets**; `requiresWritableAssets` add crop; apply `applyCropOperation`
(getAssetEdits → merge a Crop edit FIRST per editing rules → editAsset; image-only; reversible). Risk default Low.

Tests (`agent-operation.dto.spec.ts` mirror rotate describe + `agent-operation-plan.service.spec.ts` apply):
schema accepts valid crop {x,y,width,height}; rejects missing geometry, negative x/y, zero/neg width/height, wrong
targetKind, payload-less; apply calls editAsset with a Crop edit (first), image-only; reversible note; write-scope
editAssets; Low risk. Edge: out-of-bounds vs image dims — DTO only enforces x/y≥0,w/h≥1 (no image-dim check at DTO;
server editAsset validates against the image — assert the op forwards geometry, let editAsset reject impossible
crops); video asset rejected; crop on already-edited asset merges (crop-first).

Gates: lint-server/check-server/check-web (new op type — mirror what asset.trash/asset.restore needed for web
exhaustive maps/i18n; likely fallback label like restore); OpenAPI/SDK regen; full server unit green.
Commit `feat(agent): asset.crop reversible operation (explicit geometry) (F1)`; push.

## Slice F2 — `crop_assets` workflow (agent-runner, TDD) + fixture + L1 + matrix + L3

Single-quote style; NOT prettier/CI gated. `crop-assets.mjs` (hybrid) mirroring rotate-assets: parse EXPLICIT
geometry ("crop this to x,y,w,h" / "crop to 100,100,800,600" / "crop x=.. y=.. w=.. h=.."); resolve a (likely
single-asset) source; propose `asset.crop`. No explicit geometry → needs_input asking for x/y/width/height (do NOT
guess). Add `'asset.crop'` to KNOWN_OPERATION_TYPES + `validateAssetCrop` fixture; registry (ordering comment);
manifest entry (matrixRow 'Crop assets'); regen manifest.generated.json. Matrix: add Flow Ownership 'Crop assets'
row + move crop out of "Edits beyond rotation" partial; regen generated block; keep matrix spec green. L1: recall
"crop this photo to 100,100,800,600" → crop_assets; negatives (no-geometry crop declines/needs_input; not rotate);
re-seed 100%. L3: `l3.recall.crop` + propose-only `l3.plan.crop` (gated SEEDED — needs a real asset id/explicit
geometry; routing-only otherwise).
Tests: match accepts explicit-geometry crop, rejects no-geometry (→needs_input) and rotate phrasings; run proposes
asset.crop with the geometry; single-asset enforcement; reversible. Commit (F2); push.

## Slice F3 — `shareLink.create` operation (server, TDD) — privacy-gated, propose-only

New write-scope `createSharedLinks` in `agent-session.dto.ts` (`expandedWriteScopeShape` + `legacyWriteScopeDefaults`
false + update `agent-session.dto.spec.ts` expandedWriteScopeKeys). enum `ShareLinkCreate='shareLink.create'`;
`shareLinkCreatePayloadSchema` `{ password?: string, expiresAt?: ISO date (future), showMetadata?: bool,
allowDownload?: bool }`; `shareLinkCreateOperationSchema` (target **asset_batch**, payload, **High** risk default,
superRefine standardize); union; `validateWriteScope` gates on **createSharedLinks** (NOT trashAssets); apply
`applyShareLinkCreateOperation` → `sharedLinkService.create(auth, { type: SharedLinkType.Individual, assetIds,
password, expiresAt, showMetadata, allowDownload })` (inject SharedLinkService). `requiresWritableAssets`: include
(needs AssetShare perm). OUTWARD-FACING — never executed in tests (mock sharedLinkService.create) or L3.

Tests: schema accepts assetIds + optional password/expiry/showMetadata/allowDownload; rejects expiry in the past,
empty selection; apply calls create with type individual; write-scope: rejected unless createSharedLinks (assert a
default preset does NOT carry it → blocked); High risk; defaults (allowDownload/showMetadata). check-web for the new
op + write-scope flag (web write-scope UI may enumerate flags — add createSharedLinks; i18n). OpenAPI/SDK regen.
Commit `feat(agent): shareLink.create operation, privacy-gated createSharedLinks scope (default off) (F3)`; push.

## Slice F4 — `share_assets` workflow + hardening (agent-runner)

`share-assets.mjs` (hybrid): "share these photos as a link" / "create a share link for X, expires in 7 days" →
resolve source → propose `shareLink.create` (parse optional "expires in N days"/password/"hide metadata"). Add
`'shareLink.create'` to KNOWN_OPERATION_TYPES + `validateShareLinkCreate` fixture; registry; manifest entry
(matrixRow 'Share links', note outward-facing/High/propose-only); regen. Matrix: move "Sharing/export/download"
out of pure "Needs New MCP Tool" → propose-only path proven (keep export/download as remaining gap); regen block;
keep spec green. L1: recall "share these as a link" → share_assets; negatives. **L3: propose-only — assert routing
only; the L3 preset must NOT grant createSharedLinks so a plan is NEVER applied (no link created).** Add
`l3.recall.share` + (if the preset lacks the scope, the plan can't propose-apply) a `l3.plan.share` that asserts
routing/propose-attempt only, NEVER applied — mirror how outward-facing safety is documented; gate carefully.
Commit `feat(agent): share_assets propose-only workflow + matrix + L1/L3 (F4)`; push.
