# Slice 1.2 — album-sharing ops (`album.addUsers` / `removeUsers` / `updateUserRole`)

Spec: `docs/superpowers/specs/2026-06-08-pi-agent-library-management-design.md` (Phase 1).
Depends on: Slice 1.1 (`shareAlbums` write-scope already exists). No workflows yet
(1.3/1.4). This slice adds the three agent operations end-to-end: schema → validation →
plan mappings (summary/target/payload/risk) → write-scope gating → apply execution →
contract fixtures → OpenAPI regen.

TDD: failing tests first, confirm red, implement, confirm green, no regressions.

## Mirror these two existing op families (grep them to find EVERY site)

- **`album.updateDetails` (`AgentOperationType.AlbumUpdateDetails`)** — the template for an
  _album-targeted_ op: `ExistingAlbumTargetKindSchema`, `validateAlbumTarget`, target
  resolution groupings, and the apply case that calls `this.albumService.update(...)`.
- **`space.addMembers` / `space.updateMemberRole`** — the template for _member/role_
  payloads (`memberPayloads`, `uniqueUserIds`, the assignable-role enum).

`grep -n "AlbumUpdateDetails\|SpaceAddMembers\|SpaceUpdateMemberRole" server/src/services/agent-operation-plan.service.ts server/src/dtos/agent-operation.dto.ts` and add an album-sharing arm everywhere those appear.

## New enum members

`server/src/enum.ts`, `AgentOperationType` (after `AlbumSetCover`, line ~170):

```ts
  AlbumAddUsers = 'album.addUsers',
  AlbumRemoveUsers = 'album.removeUsers',
  AlbumUpdateUserRole = 'album.updateUserRole',
```

## DTO union members — `server/src/dtos/agent-operation.dto.ts`

Add an assignable album-role enum + payload (mirror `AgentAssignableSharedSpaceRoleSchema`

- `memberPayloads`, but with `AlbumUserRole`):

```ts
const AgentAssignableAlbumRoleSchema = z
  .enum([AlbumUserRole.Editor, AlbumUserRole.Viewer])
  .meta({ id: 'AgentAssignableAlbumUserRole' });
const albumUserPayloads = z
  .array(z.strictObject({ userId: uuid, role: AgentAssignableAlbumRoleSchema }))
  .min(1)
  .max(100)
  .superRefine(/* unique userIds, mirror memberPayloads */);
```

(Import `AlbumUserRole` from `src/enum` — it is already imported elsewhere; add it.)

Three operation schemas, mirroring the space-member schemas at lines ~351-391 but with
`targetKind: ExistingAlbumTargetKindSchema` + `.superRefine((op, ctx) => validateAlbumTarget(op, ctx))`:

- `albumAddUsersOperationSchema` — `type: AlbumAddUsers`, payload `z.strictObject({ albumUsers: albumUserPayloads })` (field name `albumUsers` matches the server `AddUsersDto`).
- `albumRemoveUsersOperationSchema` — `type: AlbumRemoveUsers`, payload `z.strictObject({ userIds: uniqueUserIds })` (reuse the existing `uniqueUserIds`).
- `albumUpdateUserRoleOperationSchema` — `type: AlbumUpdateUserRole`, payload `z.strictObject({ userId: uuid, role: AgentAssignableAlbumRoleSchema })`. **Single `userId`** (the server `updateUser` endpoint is per-user), NOT a `userIds` array — this is the one deliberate divergence from the space template.

Each carries `type`/`summary`/`targetKind`/`targetId: uuid.optional()`/`temporaryTargetId: temporaryTargetId.optional()`/`riskLevel: operationDefaults.riskLevel`/`enabled: operationDefaults.enabled`/`payload`.

Register all three in the discriminated-union list (the array near line ~839 where
`spaceUpdateMemberRoleOperationSchema` is listed). **One site** (container ops).

## Plan-service mappings — `server/src/services/agent-operation-plan.service.ts`

Add an album-sharing arm at every site the sibling ops appear:

1. **`validateWriteScope`** (~line 1984): three cases → `shareAlbums`, e.g.
   `if (type === AgentOperationType.AlbumAddUsers && !writeScope.shareAlbums) throw new BadRequestException('Agent permission policy does not allow sharing albums');`
   (and `AlbumRemoveUsers`, `AlbumUpdateUserRole`).
2. **Target-resolution groupings** (~1188 lists space-member ops; ~4393 lists album ops):
   add the three album-sharing ops to the **album** grouping(s) so the `ExistingAlbum`
   target resolves like `album.updateDetails` (grep where `AlbumUpdateDetails` is grouped
   and add them alongside).
3. **Summary mapping** (~2192, `case AlbumUpdateDetails`): add cases producing
   human summaries, e.g. `Share "<album>" with N people`, `Remove N people from "<album>"`,
   `Change a member's role on "<album>"`.
4. **Payload/target mapping** (the methods around ~2619-2639 that build the proposed op's
   payload/targetId for space members; and ~2300 for album setCover) — add album-sharing
   arms returning the right payload/targetId shape.
5. **Apply switch** (~2670-2850): add three cases calling the real album service:
   - `AlbumAddUsers` → `await this.albumService.addUsers(auth, albumId, { albumUsers: operation.payload.albumUsers });`
   - `AlbumRemoveUsers` → loop `operation.payload.userIds` → `await this.albumService.removeUser(auth, albumId, userId);`
   - `AlbumUpdateUserRole` → `await this.albumService.updateUser(auth, albumId, operation.payload.userId, { role: operation.payload.role });`
     `albumId` is resolved from `targetId` the same way the `AlbumUpdateDetails` apply case does (grep ~2720).
6. **`legacyWriteScopeDefaults`** already has `shareAlbums` (1.1) — no change.

Risk level for all three = **Medium** (`AgentOperationRiskLevel.Medium`). If the risk is
assigned in a dedicated risk-mapping method/switch (grep where `SpaceAddMembers` returns a
risk level), add the three album ops returning `Medium`.

## Contract fixtures

Add valid + malformed fixtures for the three ops wherever the existing space-member /
album op fixtures live (grep the fixtures dir/file for `space.addMembers`). Valid example
per op; malformed: bad role enum, empty `albumUsers`/`userIds`, missing `targetId`.

## OpenAPI regen (authoritative — reconciles the 1.1 hand-edits too)

```
cd server && pnpm build && pnpm sync:open-api && cd .. && make open-api
```

Commit the regenerated `open-api/immich-openapi-specs.json`, `open-api/typescript-sdk/**`,
and `mobile/openapi/**`. This supersedes any hand-edited generated files from slice 1.1.

## Tests (write first — expected RED)

In the agent-operation-plan service spec (`server/src/services/agent-operation-plan.service.spec.ts`)
and the DTO/contract spec — mirror the existing `space.addMembers` tests:

- DTO: each of the three ops parses a valid example; malformed (bad role, empty array,
  missing target) is rejected with the strict-object/enum error.
- `validateWriteScope`: proposing each op throws the album-sharing message when
  `shareAlbums` is false; succeeds (no throw) when true.
- Plan mapping: summary/targetKind(`existing_album`)/payload/riskLevel(`medium`) for each.
- Apply: each op calls the matching `albumService` method with the right args (mock
  `albumService`; assert `addUsers`/`removeUser`/`updateUser` called with the resolved
  `albumId` + payload). Mirror how the `SpaceAddMembers` apply test asserts
  `sharedSpaceService.addMembers`.
- Contract-fixture validator passes for the new fixtures.

RED run: `cd server && pnpm exec vitest run --config test/vitest.config.mjs src/services/agent-operation-plan.service.spec.ts src/dtos/agent-operation.dto.spec.ts` (+ the contract-fixture spec). Confirm the new cases fail because the ops/cases don't exist yet.

## Implement → GREEN

Apply enum + DTO + plan-service + fixtures. Re-run the specs → green.

## Validate

- `pnpm exec vitest run --config test/vitest.config.mjs src/services/agent-operation-plan.service.spec.ts src/dtos/agent-operation.dto.spec.ts <contract-fixture spec>` → green.
- `npx tsc --noEmit -p tsconfig.json` clean.
- OpenAPI regen produces a clean git state after commit (no further diff on a second regen).

## Commit

`feat(agent): album user-sharing ops (album.addUsers/removeUsers/updateUserRole)`

## Out of scope

No workflows (1.3 `manage_album_access`, 1.4 `change_album_member_role`); no matrix rows
(1.5). No runner changes.
