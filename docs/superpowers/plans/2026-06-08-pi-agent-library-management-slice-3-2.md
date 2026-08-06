# Slice 3.2 — `album.delete` + `space.delete` ops (container delete)

Spec: Phase 3. Depends on: 3.1 (`deleteContainers` scope). Adds two container-delete
operations (High risk, irreversible, photos preserved). These are CONTAINER ops (single
discriminated-union member each, like `album.updateDetails` / `space.updateDetails`) —
NOT asset-batch ops, so ONE union site each (no batch union).

TDD throughout. Grep the siblings to find every site:
`grep -n "AlbumUpdateDetails\|SpaceUpdateDetails" server/src/dtos/agent-operation.dto.ts server/src/services/agent-operation-plan.service.ts`.

## Enum (`server/src/enum.ts`, `AgentOperationType`)

```ts
  AlbumDelete = 'album.delete',
  SpaceDelete = 'space.delete',
```

(Add near the album/space op groups. Note: there is a SEPARATE `Permission` enum that
already has `AlbumDelete`/`SharedSpaceDelete` — do not confuse them; this is
`AgentOperationType`.)

## DTO — single union member each (mirror `album.updateDetails` / `space.updateDetails`)

`albumDeleteOperationSchema`: `type: AlbumDelete`, `summary`, `targetKind:
ExistingAlbumTargetKindSchema`, `targetId: uuid.optional()`, `temporaryTargetId:
temporaryTargetId.optional()`, `riskLevel`, `enabled`, NO payload (or empty
`z.strictObject({})` if the union requires a payload key — check how
`album.updateDetails` handles it). `.superRefine(validateAlbumTarget)`.
`spaceDeleteOperationSchema`: same with `ExistingSpaceTargetKindSchema` +
`validateSpaceTarget`. Register each in the discriminated-union list (ONE site each).

## Plan service — every `AlbumUpdateDetails`/`SpaceUpdateDetails` site

- **summary**: album → `Delete the "<name>" album (photos are kept in your library)`;
  space → `Delete the "<name>" space (photos stay in members' libraries)`.
- **target resolution groupings** (where album/space ops resolve `ExistingAlbum`/`ExistingSpace`): add both.
- **risk**: both → `AgentOperationRiskLevel.High`.
- **validateWriteScope**: `if (type === AlbumDelete && !writeScope.deleteContainers) throw …('… does not allow deleting albums')`; same for `SpaceDelete` ('… deleting spaces').
- **apply**: album → `await this.albumService.delete(auth, albumId);`; space →
  `await this.sharedSpaceService.remove(auth, spaceId);` (grep the `AlbumUpdateDetails`
  apply case `albumService.update` and the `SpaceUpdateDetails` apply for the albumId/
  spaceId resolution pattern; swap the call to delete/remove).
- `legacyWriteScopeDefaults` already has `deleteContainers` (3.1).

## Contract fixtures

Valid + malformed fixtures for both ops (grep where `album.updateDetails` fixtures live):
valid targets an existing album/space; malformed: missing `targetId`.

## ⚠️ Token baseline guard — may need REFRAMING, not just relaxing

Adding 2 op schemas raises `CATALOG_TOKENS` further. After slice 2.2 the count was 50_682,
only ~3.2% below the pre-optimization original (52_350); the guard
(`agent-mcp-tool-registry.service.spec.ts`) is at `52_350 * 0.97`. Two more ops likely push
the count to ~51_900–52_100 — which may EXCEED the `* 0.97` bound and could approach/cross
52_350 itself. Do this:

1. Measure the new count; update `CATALOG_TOKENS_BASELINE`.
2. If the count is still < 52_350 but above `* 0.97`: relax the guard to the smallest
   margin that passes AND add a comment that the token-optimization headroom is
   effectively exhausted (capability growth has consumed the prune savings).
3. If the count >= 52_350 (crosses the pre-opt original): DO NOT silently delete the guard.
   Change it to assert the count is below a NEW explicit ceiling (e.g. the measured value
   rounded up) and document that the "below pre-opt original" invariant no longer holds —
   capabilities outgrew it. Flag this prominently in the commit body for human review.

## OpenAPI regen

`cd server && pnpm build && pnpm sync:open-api && cd .. && make open-api` (TS + Dart).

## Tests (write first — RED, mirror updateDetails tests)

`agent-operation-plan.service.spec.ts` + `agent-operation.dto.spec.ts`:

- DTO: each op parses targeting an existing album/space; missing `targetId` rejected.
- validateWriteScope: throws the delete message when `deleteContainers` false; ok when true.
- summary/targetKind(`existing_album`/`existing_space`)/risk(`high`); summary contains the
  photos-preserved disclosure.
- apply: `album.delete` calls `albumService.delete(auth, albumId)`; `space.delete` calls
  `sharedSpaceService.remove(auth, spaceId)` (mock the services; mirror updateDetails apply).
- contract fixtures pass.

RED: `cd server && pnpm exec vitest run --config test/vitest.config.mjs src/services/agent-operation-plan.service.spec.ts src/dtos/agent-operation.dto.spec.ts src/services/agent-mcp-tool-registry.service.spec.ts`.

## Validate → GREEN

Re-run specs → green; `npx tsc --noEmit` clean; OpenAPI git-clean after commit.

## Commit

`feat(agent): album.delete + space.delete container ops (photos preserved)`

## Out of scope

No `delete_album`/`delete_space` workflows (3.3/3.4), no matrix carve-out (3.5).
