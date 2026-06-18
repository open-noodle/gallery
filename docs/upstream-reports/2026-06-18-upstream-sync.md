# Upstream Sync Report — 2026-06-18 (batches 268–269)

First sync of the day, on top of `2026-06-17-upstream-sync-batch-266-267.md`.

## Summary

- **Mode**: rolling-upstream-rebase on `rebase/upstream-rolling-20260509-active` (v3-cutover branch, held off `main`)
- **Fork commits synced**: 0 (`origin/main` unchanged at #709 `37224e0b`)
- **Out-of-band cherry-pick**: 1 — `#672` `fix(branding): brand nested admin.* i18n overrides` was hand-cherry-picked onto the rolling branch before this batch (by the maintainer). Carried through the rebase; **not yet on `origin/main`**.
- **Upstream commits pulled** (`cbe34d7931..9a3071ae5c`): 2 (batches 268–269)
- **Conflicts resolved**: 2 files — both **generated** clients (`mobile/openapi/lib/api/assets_api.dart`, `packages/sdk/src/fetch-client.ts`)
- **Post-rebase fixes**: 1 — OpenAPI client regeneration (`1885a72e`)
- **New migrations**: 0 — Gallery migration count steady at **33**, mobile Drift unchanged
- **Risk level**: LOW–MEDIUM
- **Recommendation**: PROCEED — local gate fully green (server 4657 + web 3166 unit tests, `tsc`/`svelte-check`, SDK build, structural audits); remote CI pending dispatch.

> **Scope note:** held rolling branch — not pushed to `main`, no `branding.upstream.version` bump (stays `v2.7.5`).

## Upstream commits (2)

| SHA        | PR     | Area   | Risk | Batch | Outcome                                                                                                                                                                                                                                                                                                            |
| ---------- | ------ | ------ | ---- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `7ef2de6b` | #29150 | server | MED  | 268   | feat: add HLS playlist hint. Touches `hls.service.ts`, `video-stream.controller.ts`, `streaming.dto.ts`, `transcoding.service.ts`, `constants.ts`, `enum.ts` (all upstream-owned; fork video-trim is in `media.service.ts`). **OpenAPI spec change** → triggered the 2 generated-client conflicts + regen (C1/C2). |
| `9a3071ae` | #29152 | ML     | LOW  | 269   | chore(deps): ML lockfile maintenance — only `machine-learning/mise.lock` (clean replay; no fork overlap).                                                                                                                                                                                                          |

## `.gitattributes` change affecting this rebase

The cherry-picked **#672** added a `.gitattributes` that marks generated files (`mobile/openapi/**/*.dart`, `mobile/lib/**/*.g.dart`, `*.drift.dart`, `packages/sdk/fetch-client.ts`, drift snapshots, etc.) as **`-diff -merge` + `linguist-generated`**. The `-merge` attribute disables 3-way text merging for those paths — on divergence git leaves them unmerged (stages 1/2/3) and you pick a side. This is **deliberate** (generated files shouldn't text-merge), but it means future rebases will surface generated-file divergences as pick-a-side conflicts rather than auto-merges. Resolution pattern: take the fork-commit side, then regenerate from the spec.

## Conflict resolutions (both generated clients)

The OpenAPI **spec** (`open-api/immich-openapi-specs.json`) is **not** under `-merge`, so it 3-way-merged normally and is the source of truth. Both conflicts were in clients generated _from_ that spec; resolution = take the fork-commit version to unblock, then regenerate authoritatively.

### C1 — `mobile/openapi/lib/api/assets_api.dart` (at fork `8ff9717f` — classification-to-config move)

Binary `-merge` conflict (upstream #29150 regenerated it for the HLS hint; the fork commit regenerated it for the classification move). Took `--theirs` (fork-commit version), continued.

### C2 — `packages/sdk/src/fetch-client.ts` (at fork `36c4102` — #700 library-manifest endpoint)

Text conflict (this path misses the `.gitattributes` `packages/sdk/fetch-client.ts` glob — note the missing `src/`). Upstream #29150 (HLS) vs fork #700 (manifest endpoint). Took `--theirs` (fork #700 version), continued. The spec auto-merged cleanly (#700's +226 lines + #29150's +9).

### Post-rebase reconciliation — `1885a72e`

Ran `mise //:open-api` to regenerate all clients from the final merged spec. **The spec itself produced no diff** — i.e. the auto-merged `immich-openapi-specs.json` exactly matches what the rebased server controllers emit (strong confirmation the merge was correct). Only the two manually-resolved clients changed (regen layered #29150's HLS hint back onto the fork-commit versions): `assets_api.dart` (+256 bytes) and `fetch-client.ts` (+6/−2). Committed as the post-rebase fix. Fork Dart patches re-applied by the generator.

## Audits & local verification

| Check                                   | Status  | Notes                                                                                                                                                                                              |
| --------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| postrebase-audit (268)                  | GREEN\* | \*Generated-Artifact-Review flagged `immich-openapi-specs.json` + `assets_api.dart` for review (the #29150 spec change) — **satisfied by no-diff spec regen + client regen**. All other checks OK. |
| postrebase-audit (269)                  | GREEN   | all OK incl. Generated-Artifact-Review (final state reconciled); 33 migrations, no collisions                                                                                                      |
| ci-invariants-check                     | GREEN   | no PUSH_O_MATIC; gallery image names; upstream docs-deploy disabled                                                                                                                                |
| fork-patches-check                      | GREEN   | `@immich/ui` patch metadata consistent                                                                                                                                                             |
| mobile-drift-rebase-check (269)         | GREEN   | schemaVersion / snapshots / callbacks consistent; no upstream mobile migration                                                                                                                     |
| svelte.config.js fork resolution        | INTACT  | replayed to fork's omit-`version.name` block (eb5a69f6 + rerere), not upstream's line                                                                                                              |
| OpenAPI regen (TS SDK + Dart)           | DONE    | spec no-diff; 2 clients reconciled & committed                                                                                                                                                     |
| SDK build (`tsc`)                       | PASS    | regenerated `fetch-client.ts` compiles                                                                                                                                                             |
| Web `check:typescript` / `check:svelte` | PASS    | tsc clean; svelte-check 0 errors / 0 warnings                                                                                                                                                      |
| Server `check` (`tsc`)                  | PASS    | —                                                                                                                                                                                                  |
| Server unit tests                       | GREEN   | 4657 passed, 9 skipped, 0 failed (141 files)                                                                                                                                                       |
| Web unit tests                          | GREEN   | 3166 passed, 2 skipped, 8 todo, 0 failed (239 files)                                                                                                                                               |

## Remote CI verification

_Pending dispatch on `rebase/upstream-batch-269`. To record after green._

| Workflow                            | Result  | Validates                                               |
| ----------------------------------- | ------- | ------------------------------------------------------- |
| Test                                | PENDING | server (#29150 hls.service) + web + OpenAPI Clients job |
| Docker                              | PENDING | server/web/ml image builds                              |
| Static Code Analysis                | PENDING | dart analyze + format + generated-file freshness        |
| Gallery Build Mobile                | PENDING | iOS + Android compile (regenerated `assets_api.dart`)   |
| Gallery Rebase Smoke                | PENDING | rebased server/web boot + e2e smoke                     |
| Storage Migration Tests             | PENDING | storage-migration suites                                |
| Gallery Revert-to-Immich Validation | PENDING | migration coverage (0 new migrations; verify locally)   |

## Post-rebase state

- Upstream base: `9a3071ae5c` (`cbe34d7931..9a3071ae5c`); fork commits ahead: **774**; behind: **0**.
- `integratedForkHead`: `37224e0b` (unchanged); `upstreamTargetHead`: `9a3071ae5c`.
- Tip `1885a72e` (regen fix) → `b2298b0d` (#672 cherry-pick) → prior 266–267 commits.
- Canonical `rebase/upstream-rolling-20260509-active` to be updated to the rebased tip; not pushed to `main` (held for v3 cutover).
