# Slice 1.1 — `shareAlbums` write-scope

Spec: `docs/superpowers/specs/2026-06-08-pi-agent-library-management-design.md` (Phase 1).
Goal: introduce a new agent write-scope `shareAlbums` (Medium-risk album user-sharing),
granted in `VisualOrganizer` + `LocalPowerUser`, off in `Careful`/base. No ops or
workflows yet — this slice only wires the scope and proves the preset grants.

TDD: write the failing tests first, confirm red, implement, confirm green, no regressions.

## Wiring sites (exact)

Add `shareAlbums: boolean` (Medium risk is documentation-only; the field is a boolean
grant) at every site, placed immediately after `createSharedLinks` for consistency:

1. `server/src/types/agent-session.types.ts`
   - `AgentPermissionPlanSnapshot.writeScope` (optional block, ~line 57): add
     `shareAlbums?: boolean;` after `createSharedLinks?: boolean;`.
   - `AgentNormalizedPermissionPlanSnapshot.writeScope` (required block, ~line 92): add
     `shareAlbums: boolean;` after `createSharedLinks: boolean;`.
2. `server/src/dtos/agent-session.dto.ts`
   - `legacyWriteScopeDefaults` (~line 48): add `shareAlbums: false,`.
   - `expandedWriteScopeShape` (~line 71): add `shareAlbums: z.boolean(),`.
3. `server/src/services/agent-session.service.ts`
   - static `legacyWriteScopeDefaults` (~line 34): add `shareAlbums: false,`.
   - `Careful` preset `writeScope` (~line 68): add `shareAlbums: false,`.
   - `VisualOrganizer` preset `writeScope` (~line 110): add `shareAlbums: true,`.
   - `LocalPowerUser` preset `writeScope` (~line 152): add `shareAlbums: true,`.
4. `server/src/services/agent-operation-plan.service.ts`
   - static `legacyWriteScopeDefaults` (~line 222): add `shareAlbums: false,`.

## Tests (write first — expected RED)

`server/src/services/agent-session.service.spec.ts`:

- Update the test constants `carefulWriteScope` (~line 19) → add `shareAlbums: false`;
  `expandedWriteScope` (~line 42) → add `shareAlbums: true`. (These are compared to the
  resolved snapshots, so they must include the new field.)
- Add an explicit assertion block (new `describe`/`it`): resolving the permission plan
  for each preset yields the expected `shareAlbums`:
  - `Careful` → `writeScope.shareAlbums === false`
  - `VisualOrganizer` → `writeScope.shareAlbums === true`
  - `LocalPowerUser` → `writeScope.shareAlbums === true`
    Use the same `resolvePermissionPlan`/preset-map path the existing tests use (grep how
    the spec currently asserts `managePeople`/`manageStacks` and mirror it exactly).

Expected RED before implementation: the constants/assertions reference `shareAlbums`,
which doesn't exist → type error / assertion failure.

Run (RED): `cd server && pnpm test -- --run src/services/agent-session.service.spec.ts`

## Implement

Apply the wiring-site edits above. Re-run the spec → GREEN.

## Validate (no regressions)

- `cd server && pnpm test -- --run src/services/agent-session.service.spec.ts` → green.
- `cd server && pnpm test -- --run src/dtos/agent-session.dto.spec.ts` → green (the dto
  schema/defaults round-trip; add a `shareAlbums` case if the existing spec enumerates
  every scope field, else leave).
- Controller-level scope tests that snapshot the full writeScope (e.g.
  `agent-session.controller.spec.ts`, `agent-operation-plan.service.spec.ts`) may need
  the new field in their fixtures — run them and fix any missing-field fixtures the same
  way (add `shareAlbums: <preset-appropriate>`).
- `tsc --noEmit` (direct) clean for server.

## Commit

`feat(agent): add shareAlbums write-scope (VisualOrganizer + LocalPowerUser)`

## Out of scope (later slices)

No `album.addUsers/removeUsers/updateUserRole` ops (1.2), no workflows (1.3/1.4), no
`validateWriteScope` cases yet (1.2 adds them). OpenAPI regen happens in 1.2 when the
ops land. This slice does not touch agent-runner.
