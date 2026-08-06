# Slice 1.3 — `manage_album_access` workflow (+ readAlbum member exposure)

Spec: `docs/superpowers/specs/2026-06-08-pi-agent-library-management-design.md` (Phase 1).
Depends on: 1.1 (`shareAlbums` scope), 1.2 (album-sharing ops). Adds the agent-runner
workflow that resolves an album + user(s) and proposes `album.addUsers`/`album.removeUsers`.

TDD throughout: failing tests first, confirm red, implement, green, no regressions.

## Step A (server) — expose album members on `readAlbum` (prerequisite for the guards)

GROUNDED GAP: `AgentAlbumDetailSchema` (`server/src/dtos/agent-tool.dto.ts` ~875) exposes
`ownerId` but NOT the album's shared users — unlike `AgentSpaceMemberSummarySchema` /
readSpace. The workflow's "already-a-member" / "non-member" guards need the current
shared-user list with roles.

- Add `albumUsers: z.array(z.object({ userId: uuid, role: z.string() }))` to
  `AgentAlbumDetailSchema` (scrubbed — userId + role only; mirror the minimal
  `AgentSpaceMemberSummary` shape, no PII beyond what space members already expose).
- In the `readAlbum` descriptor `execute` (`agent-tool.service.ts` ~2145): map the
  album's shared users into `albumUsers`. Check `albumRepository.getAgentAlbumById` —
  if it already returns the album users (the `albumUsers` relation), map them; if not,
  extend that repository query to include `{ userId, role }` for each album user
  (grep how `readSpace`/`getAgentSpaceById` includes members and mirror it).
- TDD (L2, server): a `readAlbum` spec asserts the response includes `albumUsers` with
  `{ userId, role }` for a shared album (mirror the readSpace members test). Update the
  `agent-tool.dto.spec.ts` fixture for `AgentAlbumDetail` to include `albumUsers`.
- Regen OpenAPI (TS + Dart) for the schema change:
  `cd server && pnpm build && pnpm sync:open-api && cd .. && make open-api`.

## Step B (agent-runner) — `manage_album_access` workflow

Create `agent-runner/src/strict-workflows/workflows/manage-album-access.mjs` by mirroring
`manage-space-members.mjs` EXACTLY, with these substitutions and gates:

- `KIND = 'manage_album_access'`, `flow: 'strict'`.
- space → album: `listAlbums` (match by exact name, lower-cased) instead of `listSpaces`;
  `readAlbum` instead of `readSpace`; `album.albumUsers` (from Step A) for the member map;
  `album.ownerId` for the owner guard.
- Role: `AlbumUserRole` editor/viewer only (NO owner role). Default `viewer`. "as editor"
  / "can edit" / "edit access" → editor.
- Ops: `album.addUsers` payload `{ albumUsers: toAdd.map(u => ({ userId: u.userId, role })) }`,
  targetKind `existing_album`; `album.removeUsers` payload `{ userIds: [...] }`. Propose via
  `proposeAlbumOperations` and `gatePlanResult` (same as the space workflow).
- Guards (deterministic, from readAlbum): add → skip users already in `albumUsers` (all
  already-members → needsInput "everyone is already shared"); the album `ownerId` is never
  a target (needsInput); remove → removing a non-member asks; removing the owner blocked.

### Routing gates (LOAD-BEARING — must not collide with 3 existing workflows)

`match(prompt)` accepts these shapes, and ONLY these:

- `share <users> with <album>` (the new verb). Requires a user-ish target after "with".
- `give <users> (edit )?access to <album>` .
- `add <users> to <album>` — BUT only when the rest mentions "album" (NOT "space").
- `remove <users> from <album>` — only when rest mentions "album".

DECLINE (return undefined) when:

- the prompt says "as a link" / "public link" / "share link" → leave for `share_album`.
- the target noun is "space" → leave for `manage_space_members`.
- the captured users look like a photo source (reuse the `looksLikePhotoSource` guard) →
  e.g. "share my newest 20 photos as a link" must NOT match (that's `share_assets`).
- "share the Family album as a link" → DECLINE (share_album owns public-link album share).

Mirror `manage-space-members`'s `inferActionFromPrompt`, `splitMembers`, `ROLE_SUFFIX`,
and the candidate-disambiguation continuation (`manage_album_access_album` /
`manage_album_access_user` kinds; `resumeContinuation` + `_resolveUsersAndPropose`).

Register in `agent-runner/src/strict-workflows/registry.mjs` (import + add to the factory
list). Regenerate the manifest: `node agent-runner/src/bin/sync-strict-workflow-manifest.mjs`
(or the documented sync command) — this updates `manifest.generated.json`.

## Tests

### agent-runner (node --test) — write first, expected RED

In `agent-runner/src/strict-workflows/workflows/manage-album-access.test.mjs` (mirror
`manage-space-members.test.mjs`):

- match: "share Family with Alex" → add (viewer); "give Alex edit access to Family album"
  → add (editor); "add Alex to the Family album" → add; "remove Sam from the Beach album"
  → remove.
- match DECLINES: "share the Family album as a link" → undefined; "add Alex to the Family
  space" → undefined; "share my newest 20 photos as a link" → undefined; "add these photos
  to the Family album" → undefined (photo source).
- parseSlots: defaults role to viewer; editor synonyms; missing album/users → null.
- run (fake client mirroring the space test's fake): single user add (viewer/editor);
  already-a-member → needsInput; owner target → needsInput; remove non-member → needsInput;
  ambiguous album → needsInput + continuation; ambiguous user → needsInput + continuation;
  resolved add/remove → proposeAlbumOperations called with the right op + gated plan id.
- resumeContinuation: album pick → resolvedAlbumId ctx; user pick → resolvedUserId ctx.

RED: `cd agent-runner && export PATH="$HOME/.local/share/mise/shims:$PATH" && node --test 'src/**/manage-album-access.test.mjs'` → fails (file/workflow absent).

### L1 routing scenarios (regex-mode, no model needed)

Add to `agent-runner/eval/scenarios/` (grep where `manage_space_members` recall/negatives
live): `recall.albumaccess.share`, `.grant`, `.remove` (+ slot fidelity album/users/role),
and negatives that route the protected prompts to their owners (`share_album` for "as a
link", `manage_space_members` for "...space", `share_assets` for "...photos as a link").
Run `pnpm -C agent-runner eval -- --mode regex --filter albumaccess` (regex fast-path,
no model) → routing assertions pass. NOTE: full L1 (`--runs 5`) + `baseline.json` re-seed
needs a local model — run at RC, not in this slice; record that in the slice commit body.

### L3 (deferred to RC)

`l3.recall.albumaccess.add`/`.remove` routing + gated `l3.plan.albumaccess.add`
(`shareAlbums` is ON in the eval preset). Add the scenarios to `eval/scenarios/l3-readonly.mjs`
now; the live run happens at RC (needs the personal-clone + model).

## Validate

- `cd agent-runner && node --test 'src/**/manage-album-access.test.mjs'` → green; then full
  `node --test 'src/**/*.test.mjs'` → no regressions (registry/manifest tests pass).
- Server: `pnpm exec vitest run --config test/vitest.config.mjs src/services/agent-tool.service.spec.ts src/dtos/agent-tool.dto.spec.ts` → green; `npx tsc --noEmit` clean.
- Manifest committed + matches (the manifest.test.mjs cross-check passes).

## Commit

`feat(agent): manage_album_access workflow + readAlbum member exposure`

## Out of scope

`change_album_member_role` (1.4); matrix rows (1.5). Do not run prettier on agent-runner/docs.
