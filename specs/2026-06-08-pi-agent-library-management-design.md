# Pi Agent Library Management — Album Sharing, Lock Folder & Container Delete

Status: ready for impl-loop (multi-phase)
Date: 2026-06-08
Branch: `explore/pi-agent-brainstorm` (PR #574)
Builds on: the 33 strict/hybrid workflows. Mirrors the shipped `manage_space_members`,
`change_member_role`, `archive_assets`, and `share_assets` patterns.

## How To Use This Spec

This is a roadmap of **three independent capabilities**, each a self-contained
**phase** broken into small `/impl-loop` slices. Phases are independent — implement
in order or defer a later phase without blocking earlier ones. Treat completed
slices as a baseline.

### TDD is mandatory for every slice

No production code before a failing test:

1. Write the listed failing tests first.
2. Run them and confirm the **expected red** failure (assert on the real error).
3. Implement the smallest change that makes them green.
4. Run the full relevant suite and confirm **green** with no regressions.
5. Refactor under green.
6. Commit with the slice tag, then push.

### Full test coverage — including L1 and L3 — is required

The layer legend (`agent-runner/eval/README.md`):

- **L2 (unit + contract):** the primary gate. Server: vitest specs. agent-runner:
  `match`/`parseSlots`/`run` via `node --test` + a contract-fixture validator for
  every new op. **Every edge case listed in a slice is a named test.**
- **L1 (classifier + slot eval):** required for any slice that adds/changes routing
  or slot extraction. Add recall + slot-fidelity scenarios **and** the disambiguation
  negatives that protect neighbours; run `pnpm -C agent-runner eval -- --runs 5 --diff`
  and re-seed `baseline.json` to 100% **in the same slice**. A routing change that
  doesn't re-seed L1 is incomplete.
- **L3 (live, read-only against personal/clone):** required for any slice adding a
  workflow or a reachable op. Add an `l3.recall.*` routing scenario; add a gated
  `l3.plan.*` (`planProposed: SEEDED ? true : undefined`) **only when the op's scope
  is granted in the eval preset**. **L3 is always propose-only** — the read-only
  audit must show no plan applied.

### Self-verify each phase (do not trust per-slice "green")

Per `feedback_impl_loop_subagent_gaps_vs_gates`, after the last slice of a phase run
**all** of these yourself: `pnpm -C server test` (full vitest), `make lint-server`,
`tsc --noEmit` direct (the `make check-server` cache masks spec `TS2554`), `make
check-web` **and** the separate `eslint --max-warnings 0` _Lint Web_ job, _Test i18n_
(`pnpm --filter immich-i18n format:fix`), OpenAPI regen clean (TS **and** Dart), and
`pnpm -C agent-runner test`.

## Shared Conventions & Wiring Sites

These are the multi-site changes every phase repeats. Grep an existing op/scope to
find the exact lines.

**Adding a new agent operation** — the number of union sites in
`server/src/dtos/agent-operation.dto.ts` depends on the op shape:

1. **Union site(s) in `agent-operation.dto.ts`:**
   - **Asset-batch ops** (Phase 2 `asset.setVisibility`; mirror `asset.setArchive` at
     lines ~630 and ~952) appear in **TWO** union sites — the standalone operation
     discriminated union (~630, paired with its `validateStandaloneTarget` `AssetBatch`
     line) **and** the batch-operations union (~952). Use the `AssetBatch` target (not
     `ImageEditBatch`, which is for pixel edits).
   - **Container / member ops** (Phase 1 `album.addUsers/removeUsers/updateUserRole`,
     Phase 3 `album.delete/space.delete`; mirror `space.addMembers` at line ~353) appear
     in **ONE** discriminated-union member site. They target an existing container
     (`targetKind` `ExistingAlbum`/`ExistingSpace` + `targetId`) with a payload, exactly
     like `space.addMembers` / `space.updateDetails`.
   - Grep the named sibling op to find every site before editing.
2. **Every mapping site** in `server/src/services/agent-operation-plan.service.ts`:
   summary, target kind/id, payload, and **risk level** (grep an existing op name —
   missing one means the workflow can classify but not propose; this exact bug bit
   `asset.crop`).
3. A **`validateWriteScope` case** (`agent-operation-plan.service.ts:1969`) mapping the
   new `AgentOperationType` → its `writeScope.<field>` boolean, throwing
   `BadRequestException` with a clear message when ungranted. This is the **propose-time**
   gate (called from the operations loop ~line 1367).
4. **Contract fixtures** for the new op (valid examples parse; common malformed calls
   return actionable hints).
5. **OpenAPI regen** (agent ops ARE in the spec): build the server, run `sync:open-api`,
   then `make open-api` — regenerating **both** the TS SDK and the Dart client, or the
   _OpenAPI Clients_ CI check fails on the Dart diff.

**Adding a new write-scope** (mirror `manageStacks`):

1. `server/src/types/agent-session.types.ts` — the `writeScope` shape (both the
   optional-input and the resolved-snapshot interfaces).
2. `server/src/dtos/agent-session.dto.ts` — the zod schema **and** the defaults block.
3. `server/src/services/agent-session.service.ts` — the base defaults block **and**
   each preset grant block (which preset gets it).
4. `server/src/services/agent-operation-plan.service.ts` — `legacyWriteScopeDefaults`.
5. Runner workflows **propose the op regardless of scope** and let the server enforce
   (this is how `share_assets` behaves) — no runner-side scope gating is required.

**Adding a workflow:** create under `agent-runner/src/strict-workflows/workflows/`,
register in `registry.mjs`, regenerate the manifest
(`agent-runner/src/bin/sync-strict-workflow-manifest.mjs`), and add the Flow-Ownership
and Core matrix rows (`agent-capability-matrix.spec` cross-checks
`manifest.generated.json`: `matrixRow.capability` ⊆ the Flow-Ownership row + the
hard-coded phrase).

## New Write-Scopes

| Scope              | Risk   | Careful/base | VisualOrganizer (eval preset)            | LocalPowerUser |
| ------------------ | ------ | ------------ | ---------------------------------------- | -------------- |
| `shareAlbums`      | Medium | off          | **on** (L3 proves the full propose path) | on             |
| `lockAssets`       | High   | off          | off (L3 routing-only; propose-blocked)   | on             |
| `deleteContainers` | High   | off          | off (L3 routing-only; propose-blocked)   | on             |

"Off in the eval preset" means: the agent still routes the intent and drafts the op,
but `validateWriteScope` rejects the propose call server-side, so no plan is produced
and nothing is applied. The L3 scenario therefore asserts **routing-only** (no
`planProposed`), exactly like `share_album` / `share_assets` today.

---

## Phase 1 — Share albums with Gallery users

### Goal

Let users grant other Gallery users access to an album by name — "share Family with
mom", "give Alex edit access to the Trip album", "remove Sam from the Beach album",
"make Alex an editor on Family" — as a reviewable plan. Spaces already have member
management (`manage_space_members` + `change_member_role`); this closes the
**albums-only** gap.

### Current state (grounded)

- Server endpoints exist: `addUsersToAlbum` / `updateAlbumUser` / `removeUserFromAlbum`
  (`server/src/controllers/album.controller.ts:172/188/205`) → `album.service`
  `addUsers` / `update` / `removeUser`. `AlbumUserRole` = `editor` | `viewer`
  (`server/src/enum.ts:62`).
- No agent op exposes album-user sharing today (the existing `share_album` workflow
  means the **public album link** via `shareLink.createAlbum` — do not collide with it).
- `searchUsers` read tool already resolves Gallery users (used by `change-member-role.mjs`).

### Ops (3)

All three target the existing album (`targetKind: ExistingAlbum` + `targetId`), mirror
`space.addMembers` / `space.updateMemberRole`, and use `shareAlbums` scope + Medium risk.
The server `AddUsersDto` shape is `{ albumUsers: [{ userId, role }] }` with `role`
**required** (`AlbumUserRole` = `editor`|`viewer`) — so the agent-side default below is
applied in the plan mapping before calling the server.

- `album.addUsers` — payload `{ albumUsers: [{ userId, role }] }`; the workflow defaults
  `role` to `viewer` when the user didn't say "editor"/"can edit".
- `album.removeUsers` — payload `{ userIds: [...] }`.
- `album.updateUserRole` — payload `{ userId, role }`.

### Workflows (2)

- `manage_album_access` (add/remove) — clones `manage_space_members`. Pi resolves the
  album (`listAlbums`, durable disambiguation) + the user(s) (`searchUsers`, durable
  disambiguation). Default role `viewer`; "as editor" / "can edit" → `editor`.
- `change_album_member_role` — clones `change_member_role`. "make Alex an editor on
  the Family album".

### Routing guards

- Requires an **album** noun — "share the Family **space**" still routes to
  `manage_space_members`; "share these photos as a link" still routes to `share_assets`;
  "share the Family album **as a link**" still routes to `share_album` (public link).
- Owner/self guard (can't change the album owner's access). Already-a-member add →
  no-op disclosure. Removing a non-member → disclosure.

### Slices

**1.1 — `shareAlbums` write-scope.** Add the scope at all wiring sites (see Shared
Conventions). Grant in VisualOrganizer + LocalPowerUser; false in base/Careful.

- TDD (L2): `agent-session.service` preset-snapshot tests — `shareAlbums` true in
  VisualOrganizer and LocalPowerUser, false in base/Careful; `legacyWriteScopeDefaults`
  false. dto schema round-trips the field.
- Edge cases: omitted in input defaults to false; unknown preset → base defaults.

**1.2 — Album-sharing ops + plan mappings.** Add `album.addUsers` / `album.removeUsers`
/ `album.updateUserRole` as single discriminated-union members in
`agent-operation.dto.ts` (mirror `space.addMembers`; one site each), every
`agent-operation-plan.service.ts` mapping site (summary/target=ExistingAlbum/payload/risk=medium),
the three `validateWriteScope` cases (→ `shareAlbums`), and contract fixtures. Regen
OpenAPI (TS + Dart).

- TDD (L2): each op parses a valid example; malformed (`role` not in enum; empty
  `albumUsers`; missing `targetId`) returns an actionable hint; `validateWriteScope`
  throws the album-sharing message when `shareAlbums` is false; risk resolves to
  `medium`; contract-fixture validator passes.
- Edge cases: `album.addUsers` with no stated role maps to `viewer`; duplicate userIds
  collapse; `album.updateUserRole` no-op (same role) still proposes.

**1.3 — `manage_album_access` workflow.** `match` / `parseSlots` / `run`; resolve the
album and the user(s), then propose add/remove. Register + regenerate manifest.

- TDD (L2): "share Family with Alex" → add (viewer); "give Alex edit access to Family"
  → add (editor); "remove Sam from the Beach album" → remove; ambiguous album → durable
  disambiguation; ambiguous user → durable disambiguation; "share the Family space" →
  does NOT match (leaves it for `manage_space_members`); "share the Family album as a
  link" → does NOT match (leaves it for `share_album`).
- L1: `recall.albumaccess.*` (share/grant/remove phrasings) + slot fidelity (album,
  users, role) + negatives that protect `manage_space_members`, `share_album`,
  `share_assets`. Re-seed `baseline.json`.
- L3: `l3.recall.albumaccess.add` / `.remove` routing; gated `l3.plan.albumaccess.add`
  (`planProposed` SEEDED) — `shareAlbums` is **on** in the eval preset, so the full
  propose path is proven live (read-only audit confirms no apply).
- Edge cases: empty user resolution asks for input; already-a-member add discloses
  no-op; removing a non-member discloses no-op; the album owner can't be targeted
  (self/owner guard); **the requester must own (or co-manage) the album — sharing an
  album the requester doesn't own is declined/blocked server-side**.

**1.4 — `change_album_member_role` workflow.** Clone `change_member_role`. Register +
manifest.

- TDD (L2): "make Alex an editor on Family" → `album.updateUserRole(editor)`; "make
  Alex a viewer on Family" → viewer; ambiguous album/user → disambiguation; non-member
  target → disclosure; same-role → no-op disclosure.
- L1: `recall.albumrole.*` + negatives protecting `change_member_role` (space role).
  Re-seed.
- L3: `l3.recall.albumrole` routing + gated `l3.plan.albumrole` (scope on).
- Edge cases: demoting the album owner declines; role string variants ("can edit",
  "read-only").

**1.5 — Matrix + integrated verify (Phase 1).** Add Flow-Ownership rows
(`manage_album_access`, `change_album_member_role`) + Core Capability rows ("Share an
album with people", "Change an album member's role") + the implemented-workflows table
regenerates. Run the full phase self-verify list.

---

## Phase 2 — Move photos to the Locked folder (lock-only)

### Goal

Let users move a resolved set of photos into the private **Locked folder** — "move my
passport scans to the locked folder", "lock these photos", "put these in my private
folder" — as a reviewable, High-risk plan. Unlocking is deferred (it needs resolving a
locked-folder source past the read-side PIN gate).

### Current state (grounded)

- `AssetVisibility` = `timeline` | `archive` | `hidden` | `locked` (`server/src/enum.ts`).
  `Hidden` is a system state (Live/Motion-photo video parts) — **not** user-facing;
  excluded.
- The bulk `updateAll` (`server/src/services/asset.service.ts:220`) sets `visibility`
  with only `Permission.AssetUpdate` — **no PIN gate on the write path** (the PIN gates
  _viewing_ the locked folder, not setting visibility).
- `archive_assets` already owns Archive↔Timeline; locked is a distinct privacy state.
- **Locked-asset gate (important):** the plan service's readable/writable-id resolver
  computes `allowLockedAssets = plan.assetScope.locked && hasElevatedPermission` and,
  when false, strips already-locked ids via `assetRepository.getAgentLockedIds`
  (`agent-operation-plan.service.ts` ~1238/1309; `asset.repository.ts:905`). Because
  `lock_assets` operates on **timeline** sources (not yet locked), those sources stay in
  the writable set, so **locking is unaffected**. This same filter is exactly why
  **unlock** (a locked source) is deferred — locked sources would be stripped unless the
  session has `assetScope.locked` + elevated permission.

### Op (1)

- `asset.setVisibility` — payload `{ assetSource | selectionHandle, visibility }` with
  `visibility` **constrained to `locked`** for now (the schema rejects other values so
  the op can't be repurposed to silently unlock/archive). Risk: High. Scope: `lockAssets`.
  Mirrors `asset.setArchive` — a plain asset-batch op (summary/payload/risk mappings),
  **not** an ImageEditBatch pixel edit. Reversible in-app (the user can move them back
  out of the Locked folder); the success copy says so. (Precedent: `asset.setArchive`
  is itself High risk.)

### Workflow (1)

- `lock_assets` — Pi resolves a bounded, metadata-describable source; Gallery owns the
  `asset.setVisibility(locked)` plan. Subjective sources hand off.

### Routing guards (load-bearing)

- Must NOT steal `archive_assets` ("archive these" → archive) or `hide_person` ("hide
  Alex" → person). Triggers require a **locked/private-folder** cue ("locked folder",
  "private folder", "lock these (photos)") on an asset source. "Hide these photos"
  without a person noun is ambiguous — route to `lock_assets` only with a lock/private
  cue; otherwise leave to existing handling. A person-noun guard prevents stealing
  `hide_person`.

### Slices

**2.1 — `lockAssets` write-scope.** All wiring sites. Off in base/Careful/VisualOrganizer;
on in LocalPowerUser.

- TDD (L2): preset-snapshot tests — `lockAssets` true only in LocalPowerUser; false in
  VisualOrganizer (the eval preset) and base; `legacyWriteScopeDefaults` false.
- Edge cases: omitted → false.

**2.2 — `asset.setVisibility` op + plan mappings.** Add to **both** asset-batch union
sites (the standalone operation union with its `validateStandaloneTarget` `AssetBatch`
line, and the batch-operations union — mirror `asset.setArchive`); every plan mapping
(summary/target=AssetBatch/payload/risk=high); `validateWriteScope` case (→ `lockAssets`);
`visibility` constrained to `locked`; contract fixtures. Regen OpenAPI (TS + Dart).

- TDD (L2): valid `{ visibility: 'locked' }` parses; `{ visibility: 'archive' }` /
  `'timeline'` / `'hidden'` rejected with a hint; `validateWriteScope` throws when
  `lockAssets` false; risk = high; fixtures pass.
- Edge cases: empty source rejected; selectionHandle and declarative source both map.

**2.3 — `lock_assets` workflow + routing guards.** `match` / `parseSlots` / `run`;
register + manifest.

- TDD (L2): "move these to the locked folder" → `lock_assets`; "lock my passport scans"
  → `lock_assets`; "put my newest 10 in my private folder" → `lock_assets`; "archive
  these" → does NOT match (archive_assets); "hide Alex" → does NOT match (hide_person);
  "hide these photos" with no lock cue → does NOT match; subjective source declines;
  empty source asks for input.
- L1: `recall.lock.*` + slot fidelity (source) + negatives protecting `archive_assets`
  and `hide_person`. Re-seed.
- L3: `l3.recall.lock` routing-only (no `planProposed` — `lockAssets` is off in the eval
  preset; propose-blocked, matching `share_album`).
- Edge cases: source already (partly) in the Locked folder → no-op disclosure for those
  ids; source resolving to non-owned / shared-space assets → can't lock (only owned
  assets), disclose; non-image/video handling consistent with batch ops; bounded source
  cap.

**2.4 — Matrix + integrated verify (Phase 2).** Flow-Ownership row (`lock_assets`) +
Core Capability row ("Move photos to the Locked folder") with the High-risk,
LocalPowerUser-only, reversible-in-app framing. Full phase self-verify.

---

## Phase 3 — Delete an album or space (container, photos preserved)

### Goal

Let users delete an album or shared-space **container** by name — "delete the Test
album", "remove the Beach album", "delete the Family space" — as a reviewable, High-risk
plan that clearly states **the photos stay in the library; only the album/space is
removed**.

### Current state (grounded)

- Album delete: `AlbumController @Delete(':id')` (`Permission.AlbumDelete`) →
  `album.service.delete(auth, id)` — deletes the album, not its assets.
- Space delete: `SharedSpaceController.removeSpace` (`@Delete(':id')`,
  `Permission.SharedSpaceDelete`) → `shared-space.service.remove(auth, id)`.
- No agent op deletes a container. `trash_assets` **explicitly declines** album/space
  deletion today — these workflows now claim that intent, so the boundary is the key
  routing slice.
- Matrix lists "irreversible destructive changes" as out-of-scope; this phase carves
  out the **reviewed** container-delete case (photos preserved).

### Ops (2)

Both target the existing container by `targetId` (no payload), mirror
`space.updateDetails` / `album.updateDetails`.

- `album.delete` — `targetKind: ExistingAlbum` + `targetId`. Risk: High (irreversible
  container; photos preserved). Scope: `deleteContainers`.
- `space.delete` — `targetKind: ExistingSpace` + `targetId`. Risk: High (irreversible
  container; member access removed; underlying assets preserved). Scope: `deleteContainers`.

### Workflows (2, shared resolver helper)

- `delete_album` — Pi resolves the album (`listAlbums`, durable disambiguation); Gallery
  owns `album.delete`. Disclosure: "Your photos stay in your library; only the album is
  removed."
- `delete_space` — Pi resolves the space (`listSpaces`); Gallery owns `space.delete`.
  Disclosure: "The shared space and its membership are removed; photos stay in members'
  libraries." A shared `resolve-container.mjs`-style helper backs both.

### Routing guards (load-bearing)

- "delete/remove the X **album/space**" → `delete_album` / `delete_space`. "delete/trash
  the **photos** in X" / "trash my X photos" → `trash_assets`. Update `trash_assets` so
  its current album/space-deletion **decline** hands off cleanly (and confirm routing
  priority so the container workflows win on the container-noun phrasing).

### Slices

**3.1 — `deleteContainers` write-scope.** All wiring sites. Off in
base/Careful/VisualOrganizer; on in LocalPowerUser.

- TDD (L2): preset-snapshot tests — true only in LocalPowerUser; false in VisualOrganizer
  and base; `legacyWriteScopeDefaults` false.

**3.2 — `album.delete` + `space.delete` ops + plan mappings.** Single
discriminated-union member each (container ops, mirror `space.updateDetails` — one site,
`targetKind` `ExistingAlbum`/`ExistingSpace` + `targetId`, no batch union); every plan
mapping (summary/target/risk=high); two `validateWriteScope` cases (→ `deleteContainers`);
contract fixtures. Regen OpenAPI (TS + Dart).

- TDD (L2): each op parses; missing `targetId` rejected; `validateWriteScope` throws when
  `deleteContainers` false; risk = high; summary includes the photos-preserved
  disclosure; fixtures pass.

**3.3 — `delete_album` workflow + `trash_assets` hand-off.** `match` / `parseSlots` /
`run`; resolve album; register + manifest. Update `trash_assets` to cleanly cede
album-deletion phrasing.

- TDD (L2): "delete the Test album" → `delete_album`; "remove the Beach album" →
  `delete_album`; "delete the photos in the Beach album" → `trash_assets` (NOT
  `delete_album`); "trash my 2024 screenshots" → `trash_assets`; ambiguous album →
  durable disambiguation; album not found → disclosure.
- L1: `recall.deletealbum.*` + slot fidelity (album) + **negatives protecting
  `trash_assets`** (the container-vs-photos boundary). Re-seed.
- L3: `l3.recall.deletealbum` routing-only (scope off → propose-blocked).
- Edge cases: "empty the album" (remove assets) vs "delete the album" (delete container)
  — the former is not this workflow; multiple albums match the name / "delete my albums"
  (bulk) → disambiguate or decline (single-container only); stale album id at apply
  (album already deleted) surfaces as a visible apply failure, not a crash.

**3.4 — `delete_space` workflow.** Shared container-resolve helper. Register + manifest.

- TDD (L2): "delete the Family space" → `delete_space`; "remove the Trip space" →
  `delete_space`; "delete the photos in the Family space" → not `delete_space`; ambiguous
  space → disambiguation; not found → disclosure.
- L1: `recall.deletespace.*` + negatives protecting `manage_space_assets` /
  `manage_space_members`. Re-seed.
- L3: `l3.recall.deletespace` routing-only (scope off).
- Edge cases: deleting a space requires `Permission.SharedSpaceDelete` (owner-level) —
  a member/editor who lacks it is declined with disclosure; multiple spaces match /
  bulk → disambiguate or decline; stale space id at apply surfaces as a visible apply
  failure.

**3.5 — Matrix carve-out + integrated verify (Phase 3).** Flow-Ownership rows
(`delete_album`, `delete_space`) + Core Capability rows ("Delete an album", "Delete a
space") + **update the "Out Of Scope" note** to carve out reviewed, photos-preserved
container deletion. Full phase self-verify.

---

## Capability Matrix Updates (summary)

- Flow-Ownership rows: `manage_album_access`, `change_album_member_role`, `lock_assets`,
  `delete_album`, `delete_space`.
- Core Capability rows for each, with tier, prompt examples, required behavior, and
  regression scenarios.
- New read tool usage: album sharing reuses `searchUsers` + `listAlbums`; lock reuses
  the source resolver; delete reuses `listAlbums` / `listSpaces`.
- "Needs New MCP Tool" note: album-user sharing, locked-folder visibility, and reviewed
  container delete have shipped; remaining candidates are straighten and export/download.
- "Out Of Scope" note: carve out the **reviewed** container-delete case (photos
  preserved) from "irreversible destructive changes".
- Smoke prompts: add "Share the Family album with Alex as a viewer", "Make Alex an
  editor on the Family album", "Move these to my locked folder", "Delete the Test album",
  "Delete the Family space".

## Open Questions / Deferred

- **Unlock** (locked → timeline) is deferred — it needs resolving a locked-folder source
  past the read-side PIN gate. Revisit as a follow-up that restricts unlock to an
  explicit current selection.
- **`asset.setVisibility` generality:** kept `locked`-only on purpose. If `hidden`/
  `archive` are ever folded in, reconcile with `archive_assets` rather than duplicating.
- **Album-share recipient privacy:** `searchUsers` is already scrubbed for the
  space-member workflows; reuse as-is (no new PII surface).
