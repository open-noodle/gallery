# Slice 1.4 — `change_album_member_role` workflow (+ change_member_role hand-off)

Spec: Phase 1. Depends on: 1.2 (`album.updateUserRole` op), 1.3 (`readAlbum` exposes
`albumUsers`; `manage-album-access.mjs` album-resolution pattern). Adds the agent-runner
workflow for "make <user> an editor/viewer on the <album> album".

TDD throughout.

## Templates to mirror

- `agent-runner/src/strict-workflows/workflows/change-member-role.mjs` — the space
  role-change workflow (match patterns MAKE/CHANGE_ROLE/CHANGE_TO, owner-refusal guard,
  no-op guard, non-member ask, candidate-disambiguation continuation).
- `agent-runner/src/strict-workflows/workflows/manage-album-access.mjs` (just built) —
  album resolution via `listAlbums`/`readAlbum`, `album.albumUsers` member map,
  `album.ownerId` owner guard, the `proposeAlbumOperations` + `gatePlanResult` tail.

## Step A — `change_album_member_role.mjs`

`KIND = 'change_album_member_role'`, `flow: 'strict'`. Mirror change-member-role.mjs with:

- space → album: `listAlbums`/`readAlbum`; `album.albumUsers` for current roles;
  `album.ownerId` for the owner guard.
- Role: editor/viewer only (promotion to owner refused with needsInput).
- Op: `album.updateUserRole`, `targetKind: 'existing_album'`, `targetId: albumId`,
  payload `{ userId, role }` (single user — matches the op schema from 1.2).
- Guards: changing the album OWNER's role blocked (needsInput); no-op (current role ==
  requested) → needsInput disclosure; non-member → needsInput; ambiguous album/user →
  durable continuation (`change_album_member_role_album` / `_user`).

### Routing gate (LOAD-BEARING)

`match()` accepts the same MAKE/CHANGE patterns as change-member-role BUT **requires the
target to mention "album"** ("make Alex an editor on the Family album", "change Alex's role
to viewer in the Family album"). The album-ref normalizer strips a trailing "album" word.
DECLINE when the target mentions "space" (leave for change_member_role).

## Step B — hand-off: `change_member_role.mjs` must DECLINE album targets

GROUNDED COLLISION: `change-member-role.mjs`'s `match()` has NO "space" gate, so
"make Alex an editor on the Family **album**" currently matches it (then fails with a
confusing "could not find a space called Family album"). Add a guard: after extracting
the target ref, if the target mentions `\balbum\b`, `return undefined` (decline → let
`change_album_member_role` own it). Mirror the `mentionsSpace`-style helper but inverted
(`mentionsAlbum` → decline).

Add a regression test to `change-member-role.test.mjs`: "make Alex an editor on the Family
album" → `match` returns undefined (no longer stolen).

## Step C — register + manifest

Import `changeAlbumMemberRoleWorkflow` in `registry.mjs`, add to the factory list.
Regenerate the manifest (`node agent-runner/src/bin/sync-strict-workflow-manifest.mjs`).
Add the Flow-Ownership + the generated-table row will appear after
`pnpm --dir server sync:agent-capabilities` (do that here so the
`agent-capability-matrix.spec` cross-check passes — add the hand-authored
"Change an album member's role | Strict | listAlbums, readAlbum, searchUsers |
proposeAlbumOperations" Flow Ownership row to the matrix .md).

## Tests (write first — RED)

`change-album-member-role.test.mjs` (mirror change-member-role.test.mjs):

- match: "make Alex an editor on the Family album" → {member, role:editor, albumRef};
  "change Alex's role to viewer in the Family album" → viewer.
- match DECLINES: "make Alex an editor in the Family space" → undefined; "make Alex an
  editor in Family" (no album/space noun) → undefined (bare → not this workflow);
  non-role "make Alex happy in the Family album" → undefined.
- parseSlots: editor/viewer synonyms; owner → handled in run (refuse).
- run (fake client): promote to editor; demote to viewer; owner target → needsInput;
  no-op same-role → needsInput; non-member → needsInput; ambiguous album/user →
  continuation; resolved → `album.updateUserRole` proposed + gated plan.
- resumeContinuation: album pick / user pick.
  Plus the change-member-role.test.mjs regression (album target declined).

RED: `cd agent-runner && export PATH="$HOME/.local/share/mise/shims:$PATH" && node --test 'src/**/change-album-member-role.test.mjs' 'src/**/change-member-role.test.mjs'` → new cases fail.

## L1 / L3 (scenarios now, model-run at RC)

Add `recall.albumrole.*` + slot + negatives (protecting `change_member_role`) to
`eval/scenarios/`; add `l3.recall.albumrole` + gated `l3.plan.albumrole` to
`l3-readonly.mjs`. Model-backed eval + baseline re-seed deferred to RC (no local model).

## Validate

- `cd agent-runner && node --test 'src/**/*.test.mjs'` → all green (incl. manifest/registry/matrix cross-check).
- Server: `pnpm exec vitest run --config test/vitest.config.mjs src/services/agent-capability-matrix.spec.ts` → green; `npx tsc --noEmit` clean.
- No OpenAPI change (no new op — `album.updateUserRole` already exists from 1.2).

## Commit

`feat(agent): change_album_member_role workflow (+ change_member_role album hand-off)`

## Out of scope

Remaining Phase-1 matrix polish + integrated verify + push (1.5). No prettier on agent-runner/docs.
