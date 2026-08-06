# Slice 3.3 — `delete_album` workflow + trash_assets boundary

Spec: Phase 3. Depends on: 3.1 (`deleteContainers` scope), 3.2 (`album.delete` op). Adds
the agent-runner workflow that resolves an album by name and proposes deleting the
container (photos preserved).

TEMPLATE: `agent-runner/src/strict-workflows/workflows/rename-or-describe-album.mjs`
(strict album workflow: `listAlbums`, exact-name match, durable disambiguation, propose
`album.*` via `proposeAlbumOperations`). Read it fully. TDD throughout.

## Boundary decision (grounded)

`trash-assets.mjs` already declines container-ending sources
(`containerSourcePattern = /\b(?:album|space)$/i`), so "delete the Beach album" is already
ceded by trash_assets. Therefore **NO change to trash_assets is needed** — the hand-off
already exists. The one safety property to enforce in THIS slice: `delete_album` must
NEVER steal a photo-deletion intent. So `delete_album.match()` DECLINES when the captured
reference contains a photo-source word ("photos/pics/images/videos/screenshots") or an
"in the" frame ("delete the photos in the Beach album" → NOT delete_album; it stays with
trash_assets' existing handling). We do NOT expand trash_assets to claim "photos in X
album" (that is pre-existing behavior, out of scope, and risks regressing a shipped
workflow). Document this scope decision in the workflow header.

## `delete-album.mjs`

`KIND = 'delete_album'`, `flow: 'strict'`. Mirror rename-or-describe-album.mjs:

- `match(prompt)`:
  - `DELETE_ALBUM = /\b(?:delete|remove|get\s+rid\s+of)\s+(?<ref>.+?\s+album)\s*[.?!]*$/i`
    — requires the trailing "album" noun.
  - Normalize the ref: strip leading "the/my/this/that", strip trailing "album".
  - DECLINE (return undefined) when: empty ref; the ref contains a photo-source word
    (`/\b(?:photos?|pics?|pictures?|images?|videos?|screenshots?|clips?)\b/i`) or an
    "in (the)" frame; or the noun is "space" (that's `delete_space`, slice 3.4).
  - On match → `{ slots: { albumRef } }`.
- `parseSlots(rawSlots)` → `{ albumRef }` (normalized); missing → null.
- `run({ client, slots, signal, nowMs })`:
  - `listAlbums` → exact-name match (lower-cased) on `albumName`. Zero → needsInput
    ("I could not find an album called …"). >1 → durable candidate continuation
    (`delete_album_album`). One → propose.
  - Propose `proposeAlbumOperations` with `[{ type: 'album.delete', targetKind:
'existing_album', targetId: album.id, summary: 'Delete the "<name>" album.' }]`.
  - `gatePlanResult` with successText: `I prepared a plan to delete the "<name>" album.
Your photos stay in your library — only the album is removed. Review the plan before
applying it.`
  - `resumeContinuation` for the album pick (mirror the space-member continuation).

Register in `registry.mjs` + regenerate manifest. Add the "Delete an album" Flow Ownership
row to the capability matrix + `pnpm --dir server sync:agent-capabilities`.

## Tests (write first — RED)

`delete-album.test.mjs`:

- match: "delete the Test album" → {albumRef:'Test'}; "remove the Beach album" →
  {albumRef:'Beach'}; "get rid of the Trip album" → match.
- match DECLINES: "delete the photos in the Beach album" → undefined (photo source);
  "delete the Beach album photos" → undefined; "delete the Family space" → undefined
  (space → delete_space); "trash my 2024 screenshots" → undefined (no album noun);
  "delete the album" with no name still captures ref 'the' → ensure empty-after-normalize
  declines; empty → undefined.
- parseSlots: ref present → slots; missing → null.
- run (fake client mirroring rename-or-describe-album's fake): unique album → proposes
  `album.delete` + gated plan, success copy contains the photos-preserved disclosure;
  album not found → needsInput; ambiguous album → needsInput + continuation; multiple
  albums same name → continuation; listAlbums throws → failed; no plan id → failed.
- resumeContinuation: album pick → resolvedAlbumId ctx.
  Also a regression in `trash-assets.test.mjs` (if not already present): "delete the Beach
  album" → trash_assets.match() returns undefined (confirms the cede still holds).

RED: `cd agent-runner && export PATH="$HOME/.local/share/mise/shims:$PATH" && node --test 'src/**/delete-album.test.mjs'`.

## L1 / L3 (model-run at RC)

Add `recall.deletealbum.*` + slot + negatives protecting `trash_assets`
("delete the photos in X" stays away from delete_album) to `eval/scenarios/`. Add
`l3.recall.deletealbum` ROUTING-ONLY (no planProposed — `deleteContainers` OFF in eval
preset) to `l3-readonly.mjs`. Model-backed eval deferred to RC.

## Validate

- `cd agent-runner && node --test 'src/**/delete-album.test.mjs'` → green; full
  `node --test 'src/**/*.test.mjs'` → no regressions (manifest/registry/matrix pass).
- Server: `pnpm exec vitest run --config test/vitest.config.mjs src/services/agent-capability-matrix.spec.ts` → green; `npx tsc --noEmit` clean.
- No OpenAPI change (op already exists from 3.2).

## Commit

`feat(agent): delete_album workflow (container delete; photos preserved)`

## Out of scope

`delete_space` (3.4); matrix Core rows + integrated verify (3.5). No prettier on agent-runner/docs.
