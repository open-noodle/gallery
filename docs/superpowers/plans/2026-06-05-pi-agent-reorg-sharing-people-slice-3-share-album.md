# Slice H1 — `share_album` workflow + `shareLink.createAlbum` op (album share links)

Spec: `docs/superpowers/specs/2026-06-05-pi-agent-reorg-sharing-people-design.md` (Phase H1).

## Design decision (deviation from spec, documented)

The spec said "thread `shareType`/`albumId` through the existing `shareLink.create` op."
Making that op polymorphic (asset-batch vs album target on one `type` literal) complicates the
existing individual-share path, its tests, and the discriminated-union discriminator. Instead
we add a **clean sibling op `shareLink.createAlbum`** (album-targeted, reuses the
`createSharedLinks` scope). Strictly additive, zero regression to `share_assets`, identical
user capability. Update the spec/matrix H1 note in the consolidated docs pass to reflect this.

## Scope semantics (verified)

`validateWriteScope` runs at BOTH propose (line ~1312) and apply (~2572). `createSharedLinks`
is FALSE in the eval preset (VisualOrganizer), so `share_album` is **propose-blocked** in L3 —
the L3 scenario is **routing-only** (mirror `l3.recall.share`), no `planProposed`. The apply
mapping (album → `SharedLinkType.Album`) is proven at server-unit level. `createSharedLinks` is
granted only in LocalPowerUser; High risk; OUTWARD-FACING.

## Part A — Server

### A1. `src/enum.ts`

Add after `ShareLinkCreate`:

```ts
ShareLinkCreateAlbum = 'shareLink.createAlbum',
```

### A2. `src/dtos/agent-operation.dto.ts`

Add `shareLinkCreateAlbumOperationSchema` modeled on **`updateDetailsOperationSchema`**
(album.updateDetails: `existing_album` target + `targetId` + payload, NO asset source) but with
the share payload + High-risk default:

```ts
const shareLinkCreateAlbumOperationSchema = z
  .strictObject({
    type: z.literal(AgentOperationType.ShareLinkCreateAlbum).meta({ id: 'AgentShareLinkCreateAlbumOperationType' }),
    targetKind: z.literal(AgentOperationTargetKind.ExistingAlbum),
    targetId: uuid, // the album id
    riskLevel: AgentOperationRiskLevelSchema.optional().default(AgentOperationRiskLevel.High),
    payload: shareLinkCreatePayloadSchema, // password / expiresAt(future) / showMetadata / allowDownload
  })
  .superRefine((operation, ctx) => {
    validateStandaloneTarget(
      operation,
      ctx,
      AgentOperationTargetKind.ExistingAlbum,
      AgentOperationType.ShareLinkCreateAlbum,
    );
  });
```

(Confirm the exact `targetKind`/`targetId` field shape against `updateDetailsOperationSchema` /
`setCoverOperationSchema` — match whatever they use; do not invent fields.) Add
`shareLinkCreateAlbumOperationSchema` to the `AgentGalleryOperationInputSchema`
discriminatedUnion (~698, next to `shareLinkCreateOperationSchema`).

### A3. `src/services/agent-operation-plan.service.ts`

- **`validateWriteScope` (~1973)**: extend the existing shareLink gate:
  ```ts
  if (
    (type === AgentOperationType.ShareLinkCreate || type === AgentOperationType.ShareLinkCreateAlbum) &&
    !writeScope.createSharedLinks
  ) {
    throw new BadRequestException('Agent permission policy does not allow creating shared links');
  }
  ```
- **Apply switch (~2811)**: add
  `case AgentOperationType.ShareLinkCreateAlbum: { return this.applyShareLinkCreateAlbumOperation(auth, operation); }`.
- **New apply method** (mirror `applyShareLinkCreateOperation` ~3196):

  ```ts
  private async applyShareLinkCreateAlbumOperation(auth, operation): Promise<AgentOperationApplyUpdate> {
    const payload = this.requireObjectPayload(operation.payload) as {
      password?: string; expiresAt?: string; showMetadata?: boolean; allowDownload?: boolean;
    };
    await this.sharedLinkService.create(auth, {
      type: SharedLinkType.Album,
      albumId: operation.targetId,
      password: payload.password,
      expiresAt: payload.expiresAt ? new Date(payload.expiresAt) : undefined,
      showMetadata: payload.showMetadata,
      allowDownload: payload.allowDownload,
    });
    return this.appliedOperation(operation.id, { albumId: operation.targetId });
  }
  ```

  Verify `SharedLinkCreateDto` accepts `{ type: SharedLinkType.Album, albumId, ... }` (read
  `src/dtos/shared-link.dto.ts`; recon confirms `SharedLinkType.Album` + `albumId`). Confirm
  `operation.targetId` is the album id on a persisted op (album-targeted ops store it there).

- **Any propose-time mapping**: `shareLink.createAlbum` is proposed directly via
  `proposeAlbumOperations` (NOT a batch action), so the four `getAssetBatchWorkflow*` switches
  do NOT need a case. Confirm `proposeAlbumOperations` passes album-targeted ops through (album
  ops already flow through it). The op carries its own `riskLevel`/`summary` from the workflow.

### A4. Server unit tests (RED first)

- `agent-operation.dto.spec.ts`: union accepts a valid `shareLink.createAlbum` op
  (`existing_album` + `targetId` + payload); rejects one with an `assetSource`/`assetIds`;
  rejects a past `expiresAt`; defaults riskLevel High.
- `agent-operation-plan.service.spec.ts`: apply calls `sharedLinkService.create` with
  `{ type: SharedLinkType.Album, albumId: <targetId>, ...options }` (mock asserts shape);
  the existing individual `applyShareLinkCreateOperation` path is unchanged (regression);
  `createSharedLinks: false` → propose blocked (at `prepareOperations`) AND apply blocked;
  `createSharedLinks: true` → allowed.

## Part B — agent-runner

### B1. `contract-fixtures.mjs`

- `KNOWN_OPERATION_TYPES`: add `'shareLink.createAlbum'`.
- Add `validateShareLinkCreateAlbum(op)` (mirror `validateShareLinkCreate` but for album):
  `targetKind === 'existing_album'`, `targetId` required (string), NO `assetSource`/`assetIds`,
  optional `payload` with the same known keys (`password`/`expiresAt`/`showMetadata`/
  `allowDownload`). Register it in `ALBUM_OP_VALIDATORS`.

### B2. `workflows/share-album.mjs` (kind `share_album`)

Model on `share-assets.mjs` (reuse its expiry/password/hide-metadata modifier parsing) +
`rename-or-describe-album.mjs` (album resolution via `listAlbums`):

- Patterns: `share the <X> album as a (share|shareable|public) link`,
  `(create|make|generate) a (public )?(share|shareable) link for the <X> album`. Require the
  literal `album` noun. Decline if the captured ref does not contain an album reference (so
  "share these photos as a link" does NOT match → stays `share_assets`).
- Resolve album via `listAlbums` (none → ask; ambiguous → ask).
- Build optional `payload` from modifiers (expiry → `expiresAt` ISO from `nowMs`, password,
  `showMetadata:false`).
- Propose via `proposeAlbumOperations`:
  ```js
  { summary: `Create a public share link for the "${albumName}" album.`,
    operations: [{ type: 'shareLink.createAlbum', summary: 'Create an outward-facing album share link (High risk; requires createSharedLinks scope).',
      targetKind: 'existing_album', targetId: album.id, riskLevel: 'high',
      ...(Object.keys(payload).length ? { payload } : {}) }] }
  ```
- `gatePlanResult` success text discloses outward-facing; `successSummary: { workflowKind: 'share_album', albumName }`.

Tests (mirror `share-assets.test.mjs` + the album-resolution cases from
`rename-or-describe-album.test.mjs`): identity; match for the album forms + modifiers; decline
"share these photos as a link" (no album noun) → undefined; missing/ambiguous album →
needsInput; plan error → failed; success copy + summary; payload shape (expiry/password/
hide-metadata) reaches the op.

### B3. registry + manifest

- `registry.mjs`: import + register `shareAlbumWorkflow` **before** `shareAssetsWorkflow`
  (container-noun gate; `share_assets` already declines "…album"). Add ordering comment.
- `manifest.mjs`: entry (`flow: 'hybrid'`, `planTool: 'proposeAlbumOperations'`,
  `requiredReadTools: ['listAlbums']`, `supportsContinuation: false`, matrixRow capability
  "Album share links", tier "Solid now"). Regenerate `manifest.generated.json` (node one-liner
  per the G1/G2 plans). Add a `disambiguation.test.mjs` routing case if the gate requires it.

### B4. eval scenarios

- `classification-recall.mjs`: `recall.share-album.basic` ("share the Family album as a link"
  → `share_album`).
- `slot-fidelity.mjs`: `slots.share-album.ref` (`albumRef:'Family'`, `expiryDays` when "expires
  in 7 days").
- `classification-negatives.mjs`: `neg.share-album.assets` ("share these photos as a link" →
  `none` at regex level it routes to share_assets; for the LLM negative file assert it does NOT
  become `share_album` — use a negative on share_album specifically, or rely on the recall file
  asserting `share_assets`). Add `recall.share.assets-still-works` to confirm "share my newest
  20 as a link" → `share_assets`.
- `l3-readonly.mjs`: `l3.recall.share-album` — ROUTING ONLY ("share the {album} album as a
  link" → `share_album`). NO `planProposed` (createSharedLinks off in the eval preset →
  propose-blocked; document this, mirroring the `l3.recall.share` comment).

## Part C — regen + verify

1. `pnpm -C server build`.
2. `pnpm -C server sync:open-api && make open-api` (TS + Dart). If the Dart step needs it, run
   `make open-api-dart` (Java 21 is available) — the new `shareLink.createAlbum` enum value +
   op type must land in BOTH `open-api/typescript-sdk` and `mobile/openapi`. VERIFY
   `mobile/openapi/lib/model/agent_operation_type.dart` contains `shareLink.createAlbum`.
3. `pnpm -C server test -- --run src/services/agent-operation-plan.service.spec.ts src/services/agent-session.service.spec.ts src/dtos/agent-operation.dto.spec.ts` → GREEN.
4. `cd agent-runner && node --test 'src/**/*.test.mjs'` → GREEN, count up.
5. `make check-server`, `make lint-server`, `make check-web` → green.
6. Server prettier ONLY on edited server `.ts`. Never on `agent-runner/**`.

## Commit

```bash
git add server/ agent-runner/ open-api/ mobile/openapi/ docs/superpowers/plans/2026-06-05-pi-agent-reorg-sharing-people-slice-3-share-album.md
git commit -m "feat(agent): share_album workflow + shareLink.createAlbum op (H1) — album share links"
```

## Done when

- `shareLink.createAlbum` op parses (album target), applies to `SharedLinkType.Album`, gated on
  `createSharedLinks` at propose + apply; individual share path unchanged.
- `share_album` routes before `share_assets`, declines asset-only share, resolves album,
  proposes a High-risk outward-facing plan; modifiers reach the payload.
- Server build/tests/check/lint green; agent-runner green; OpenAPI TS + Dart regenerated
  (verified) and committed.

## Out of scope

- Space-level share links (no `SharedLinkType.Space`).
- Making the individual `shareLink.create` op polymorphic.
