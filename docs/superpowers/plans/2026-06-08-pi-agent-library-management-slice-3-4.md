# Slice 3.4 — `delete_space` workflow

Spec: Phase 3. Depends on: 3.1 (`deleteContainers`), 3.2 (`space.delete` op), 3.3
(`delete_album` is the direct template). Adds the agent-runner workflow that resolves a
shared space by name and proposes deleting the container (members' photos preserved).

TEMPLATES: `delete-album.mjs` (just built — the structure to mirror) and
`rename-or-describe-space.mjs` (space resolution via `listSpaces`). TDD throughout.

## `delete-space.mjs`

`KIND = 'delete_space'`, `flow: 'strict'`. Mirror `delete-album.mjs`, swapping album→space:

- `match(prompt)`:
  - `DELETE_SPACE = /\b(?:delete|remove|get\s+rid\s+of)\s+(?<ref>.+?\s+space)\s*[.?!]*$/i`
    — requires the trailing "space" noun.
  - Normalize: strip leading "the/my/this/that/our", strip leading "shared space", strip
    trailing "(shared) space".
  - DECLINE: empty/bare-article ref; photo-source word in ref; "in/from (the)" frame;
    the noun is "album" (→ delete_album). (delete_album already declines "space", so the
    two are mutually exclusive.)
  - On match → `{ slots: { spaceRef } }`.
- `parseSlots` → `{ spaceRef }`; missing → null.
- `run({ client, slots, signal, nowMs })`:
  - `listSpaces` → exact-name match (lower-cased) on `name`. Zero → needsInput. >1 →
    durable continuation (`delete_space_space`). One → propose.
  - Propose `proposeAlbumOperations` with `[{ type: 'space.delete', targetKind:
'existing_space', targetId: space.id, summary: 'Delete the "<name>" space.' }]`.
  - `gatePlanResult` successText: `I prepared a plan to delete the "<name>" space. The
shared space and its membership are removed; photos stay in members' libraries. Review
the plan before applying it.`
  - `resumeContinuation` for the space pick.

NOTE: the SERVER enforces owner-level permission (`Permission.SharedSpaceDelete` via
`sharedSpaceService.remove`, wired in 3.2) — a non-owner's apply is rejected server-side.
The workflow proposes regardless (propose-only; server is the backstop), matching how other
workflows propose and let the server enforce scope/role. Document this in the header.

Register in `registry.mjs` + regenerate manifest. Add "Delete a space" Flow Ownership row
to the capability matrix + `pnpm --dir server sync:agent-capabilities`.

## Tests (write first — RED)

`delete-space.test.mjs` (mirror delete-album.test.mjs):

- match: "delete the Family space" → {spaceRef:'Family'}; "remove the Trip space";
  "get rid of the Beach space".
- match DECLINES: "delete the photos in the Family space" → undefined; "delete the Family
  album" → undefined (album → delete_album); "delete the Family space photos" → undefined;
  empty / bare "delete the space".
- parseSlots; run (unique space → proposes space.delete + gated plan + members/photos
  disclosure; not-found → needsInput; ambiguous → continuation; listSpaces throws → failed;
  no plan id → failed); resumeContinuation space pick.

RED: `cd agent-runner && export PATH="$HOME/.local/share/mise/shims:$PATH" && node --test 'src/**/delete-space.test.mjs'`.

## L1 / L3 (model-run at RC)

Add `recall.deletespace.*` + slot + negatives protecting `manage_space_assets` /
`manage_space_members` / `delete_album` to `eval/scenarios/`. Add `l3.recall.deletespace`
ROUTING-ONLY to `l3-readonly.mjs`. Model-backed eval deferred to RC.

## Validate

- `cd agent-runner && node --test 'src/**/delete-space.test.mjs'` → green; full
  `node --test 'src/**/*.test.mjs'` → no regressions.
- Server: `pnpm exec vitest run --config test/vitest.config.mjs src/services/agent-capability-matrix.spec.ts` → green; `npx tsc --noEmit` clean.
- No OpenAPI change (op exists from 3.2).

## Commit

`feat(agent): delete_space workflow (container delete; photos preserved)`

## Out of scope

Matrix Core rows + out-of-scope carve-out + integrated verify (3.5). No prettier on agent-runner/docs.
