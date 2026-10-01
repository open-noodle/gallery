# Upstream Sync Report — 2026-10-01

## Summary

- **Branch**: `rebase/upstream-rolling-v3.3.0` (continued; pre-cycle backup `backup/rolling-pre-2026-10-01` = `83704cfeaab`)
- **Upstream source changed**: the rolling branch now tracks **`upstream/release/v3.3`**, not `upstream/main`
  (`docs/fork/ownership.yml` `upstream_branch`). Only changes that ship in the v3.3.0 release candidates are pulled.
- **Upstream commits pulled**: 49 (batches 40–74), `6b978d0c0d3` → **`3af49d9b4fa`** = the `release/v3.3` tip,
  through `v3.3.0-rc.0` and `v3.3.0-rc.1`. Three later release-line commits (`112c5e190f7`, `882da7cab8b`,
  `843051f0f5b`) landed during the cycle and are left for the next one.
- **Person sharing (immich-31620 + 31902/31930/31931/31960)**: first quarantined, then pulled **dormant** after a
  product decision (`specs/2026-10-01-upstream-person-sharing-dormant-design.md`).
- **Fork synced**: #1151 (Immich v3.2.3/v3.2.4 backport, hand-resolved), #1145
- **Risk level**: MEDIUM-HIGH (one silent-break ML port; the person-sharing dormancy port; several zero-conflict
  fork-test breaks fixed)
- **Recommendation**: PROCEED — full local gates green; SQL docs and the base-image check rely on CI (no local Docker)

## Why `release/v3.3`

Upstream cut `release/v3.3` from `main` at `a9d102234b8` (`chore: version v3.3.0-rc.0`, 2026-09-28) and tags RCs there.
The rolling cursor (`6b978d0c0d3`) is an **ancestor of rc.0**, so nothing already integrated lies outside the release
line — no over-pull to undo. Of the 22 release-only commits, 19 carry cherry-pick trailers to `main` commits; the other
three are the rc.1 version bump, a typescript-projects bump and immich-31960 (bulk person management). 37 `main`
commits beyond rc.0 are **not** going into 3.3 and are no longer pulled.

This reverses the 2026-09-09 decision to keep `upstream/main` as the rebase source. That decision's proof (main is the
content superset) still holds; the change is a policy one — ship only what upstream ships in 3.3. At the next minor the
move is `rebase --onto` the next `vX.Y.0-rc.0`; release-line cherry-picks stay in the old base, so no duplicate-content
conflicts arise.

## Product-direction gate — QUARANTINED

| SHA           | Summary                                                         | Fork surface                             | Why it stops the batch                                                                                                                                                                                                  |
| ------------- | --------------------------------------------------------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `c12d5e6d35f` | feat: people management (immich-31620)                          | faces/people, Shared Spaces people, RBAC | Adds person **sharing**: `person_user` table, `PersonSharing` migration, access-model and partner-service changes. A second person-sharing model beside `shared_space_person` and the fork's space-scoped person edits. |
| `ceea058662a` | person management ids validation and permissions (immich-31902) | same                                     | builds on the above                                                                                                                                                                                                     |
| `d1a4c8bbe1a` | create all for owner (immich-31930)                             | same                                     | builds on the above                                                                                                                                                                                                     |
| `b20bc5ed822` | auto-sync name changes to connected users (immich-31931)        | people names, user preferences           | builds on the above                                                                                                                                                                                                     |
| `f32a891d407` | bulk person management (immich-31960)                           | people                                   | builds on the above                                                                                                                                                                                                     |

The batch was first held at `0f179b9914f`. After brainstorming, Pierre chose a **dormant pull** (approach A): take the
schema and code, refuse the sharing routes and `userId` overrides, keep Gallery's person access/read/merge paths, guard
with an invariant. Upstream's model needs several `person` rows per group, which Option M's `person_personGroupId_key`
forbids, and it shares only inside a cluster group, which Gallery keeps inert.

## Incoming Upstream Changes (pulled)

| SHA           | Summary                                                         | Area       | Risk   | Notes                                                               |
| ------------- | --------------------------------------------------------------- | ---------- | ------ | ------------------------------------------------------------------- |
| `970c496e55b` | keep other comments visible when deleting a comment             | web        | LOW    | clean                                                               |
| `aa023378477` | GeoNames for reverse-geocoded country names                     | server/e2e | LOW    | clean                                                               |
| `54987c764a3` | write tag updates to exif table                                 | server     | LOW    | clean                                                               |
| `ae499132238` | base-image v202609281550                                        | server     | LOW    | same digest #1151 backported; rolling took it from upstream         |
| `638b6ac5531` | don't stack an upload with itself                               | mobile     | LOW    | clean                                                               |
| `8ede1d54d85` | exclude hidden assets from large files search                   | server     | LOW    | generated `search.repository.sql` hand-merged at 2 fork commits     |
| `bf5b21b3619` | update node                                                     | deps       | MEDIUM | collided with the fork's `packages/scripts` deletion — kept deleted |
| `93ad3645e8e` | a few more album actions (immich-31839)                         | web        | HIGH   | album page rewrite vs ~18 fork commits — see resolutions            |
| `d73acbbfc0d` | favorite workflow step description                              | plugins    | LOW    | clean                                                               |
| `4d51dcafabd` | ui Select, remove old settings dropdown                         | web        | LOW    | clean                                                               |
| `ab159b81182` | ML stricter typing and request validation (immich-31856)        | ML         | HIGH   | **silent break** — ported, see below                                |
| `c25b6e30c27` | rating shortcuts action                                         | web        | LOW    | nav-bar conflict with fork RotateRight                              |
| `5f0c9a59963` | emit sidecarwrites and assetupdates consequently (immich-31777) | server     | MEDIUM | merged with fork visibility side-effects; 16 fork specs fixed       |
| `0733cc10ee7` | log assets deletion in background job                           | server     | LOW    | clean                                                               |
| `0f179b9914f` | album inconsistencies (immich-31857)                            | web        | MEDIUM | converges with fork #990 (editor can edit album)                    |

## Silent break: ML pipeline (immich-31856) — Shape X/J

Upstream replaced the `get_model_class` registry with a strict, typed `PipelineRequest` (`extra="forbid"`, slots for
`clip` / `facial-recognition` / `ocr` only) and moved every model onto `InferenceModel[Options]`. Pulled as-is, **every
`pet-detection` request from the server would 422** while the fork's tests stayed green (they built the models
directly). Ported in `chore(rebase): port the pet models onto upstream's typed ML pipeline`:

- `pipeline.py`: a `pet-detection` slot → `PetDetector` / `PetRecognizer`; server wire shape unchanged.
- `schemas.py`: `PetDetectionOptions` (`minScore`, default 0.3), `PetRecognitionOptions`.
- `GalleryHostedModel[O]` generic; pet models declare `sources` and read options per request.
- `metrics.labels_from_entries` reads `InferenceEntry` identities; `main.py` keeps all fork metrics hooks.
- Tests migrated; new wire-contract tests (minScore via request, pipeline resolution, wrong-source 422) proven red
  against a pipeline without the pet slot.

## Conflict Resolutions

### `web/src/routes/(user)/albums/[albumId=id]/…/+page.svelte` (immich-31839, ~18 fork stops)

- **Fork**: filter panel wrap, cmdk palette, Space album links, timeline grouping, contextual filters.
- **Upstream**: album actions via `getAlbumActions` (`Actions.Options/Share/Download/Delete/Leave`), removed inline
  modal/menu code.
- **Resolution**: a semantic transformer applying upstream's 13 intents to each replayed fork version, proven to
  reproduce upstream's commit byte-for-byte from its parent and to be idempotent. Fork-only owner menu items ("Link album
  to space") stay inside `{#if isOwned}`; Delete/Leave use upstream's gated actions.
- **Risk**: MEDIUM. **Verify**: album page menu (owner, editor, viewer, Space member), command palette entries.

### `web/src/lib/services/album.service.ts`

- Kept the fork's membership-gated `Leave` (`isNonOwnerMember`); took upstream's `Options` action and move.
- immich-31857 adds `isAlbumEditor(album)` / `isAlbumOwner` and gates `Edit` on editor — the same intent as fork #990.
  **Converged on upstream's gate**; dropped #990's import of `album-utils.isAlbumEditor` into this module (it would
  redeclare the name). The fork helper stays in `album-utils` for its own callers.

### `server/src/services/asset.service.ts`

- Single-asset update keeps both the fork's visibility-transition side-effects (security-4) and upstream's
  `on_asset_update` push when no metadata was written (side-effects first).
- `updateAll` auto-merged: upstream's `getByIds` + `mapAsset` push runs after the fork's prior-visibility read. Fork
  specs stubbed `getByIds` with partial objects → 16 failures; fixed by building assets with `AssetFactory`.

### `pnpm-lock.yaml` (fork #1151-era commits)

- The fork commit that re-deletes `packages/scripts` carried a lockfile delta generated against an older base (it would
  have downgraded `@types/node` across every importer). Resolved as HEAD minus the `packages/scripts` importer.
- The fork's stranded-marker commit and `@immich/ui` patch commit resolved to their intent on HEAD's lockfile (the known
  blemish from 2026-09-20 is gone from history).
- A fuzz-applied upstream hunk moved `^24.13.6` onto `tools/upstream-preflight`; manifest aligned. **The final lockfile
  regenerates byte-identical** (`pnpm install --lockfile-only`), `--frozen-lockfile` passes, `version: file:` = 0.

### Others

- `machine-learning/immich_ml/{models/__init__.py,schemas.py,main.py,test_main.py,conftest.py}` — ~10 fork stops;
  `__init__.py` → upstream (now empty), schemas via a fork-block transformer, `main.py` ported to the fork's final
  metrics form on upstream's new file.
- `AssetViewerNavBar.svelte` — upstream moved `RatingAction` out; kept the fork's `RotateRight` button.
- `server/test/medium.factory.ts` — both imports kept.
- `workflow-core-plugin.spec.ts` — the fork's revert of #749 resolved to upstream's form (upstream now carries the same
  `EventRepository` mock).
- `packages/scripts/package.json` — modify/delete; kept deleted (fork rule).
- #1151 fork sync: Dockerfiles kept rolling's side (upstream's own base-image commit followed); test file kept
  rolling's fork adaptation of immich-31642. `branding/config.json` `upstream.version` is now **3.2.4**.

## Fork Feature Verification

| Feature              | Status      | Notes                                                       |
| -------------------- | ----------- | ----------------------------------------------------------- |
| Shared Spaces        | OK          | visibility side-effects intact; album page Space links kept |
| Pet Detection        | OK (ported) | see ML section                                              |
| Storage Migration    | OK          | untouched                                                   |
| Image Editing        | OK          | untouched                                                   |
| Branding             | OK          | no i18n branding gaps; no literal no-op risks               |
| Google Photos Import | OK          | untouched                                                   |

## CI and Infrastructure Verification

| Check                 | Status | Notes                                                                    |
| --------------------- | ------ | ------------------------------------------------------------------------ |
| Workflow files        | OK     | none touched by the 15                                                   |
| Docker image refs     | OK     | base-image bump only                                                     |
| Fork CI modifications | OK     | `ci-invariants-check` all OK                                             |
| Ownership manifest    | OK     | `server/Dockerfile.dev` added; `last_verified_fork_head` → `da5480ae42b` |

## Database Migration Analysis

No new upstream server migrations in the 15 (the first, `PersonSharing`, is in the quarantined immich-31620). No
mobile Drift changes; `mobile-drift-rebase-check` OK. Revert-to-immich coverage unaffected.

## Pattern Propagation

Upstream's typed ML pipeline was propagated to the fork's pet models in this cycle (bundled).

## Local CI Verification

| Check                                                                  | Status  | Notes                                                                                                |
| ---------------------------------------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------- |
| server `pnpm build` / `pnpm check`                                     | PASS    | 67 Gallery migrations synced                                                                         |
| web `check:typescript` / `check:svelte`                                | PASS    | 631 files, 0 errors                                                                                  |
| server lint + prettier                                                 | PASS    |                                                                                                      |
| web eslint (`tscompat` off)                                            | PASS*   | *13 warnings, all "unused tscompat disable" — artifact of turning the rule off                       |
| web / e2e / i18n prettier, e2e `tsc`                                   | PASS    |                                                                                                      |
| server unit                                                            | PASS    | 6458 after the spec fix                                                                              |
| web unit                                                               | PASS    | 6412                                                                                                 |
| ML ruff / mypy --strict / pytest                                       | PASS    | 232 passed, 5 upstream skips                                                                         |
| mobile analyze --fatal-infos / format / flutter test                   | PASS    | 4016                                                                                                 |
| upstream-preflight vitest                                              | PASS    | 293                                                                                                  |
| post-rebase audits 40–48, fork-patches, ci-invariants, drift, autolink | PASS    | "Generated Artifact Review" on 42/45 = SQL docs                                                      |
| `server/src/queries/` regeneration                                     | NOT RUN | Docker unavailable locally; `search.repository.sql` was hand-merged — rely on CI's SQL Schema Checks |

## Follow-ups

1. Brainstorm + spec upstream person sharing (immich-31620 family) before advancing past `0f179b9914f`.
2. `updateAll` now reads `getByIds` twice when `visibility` is set and no sidecar is written; fold into one read.
3. Fork `album-utils.isAlbumEditor(album, userId)` duplicates upstream's `album.service.isAlbumEditor(album)`; migrate
   fork callers and drop the helper.
4. upstream `...Object.values(Actions)` adds all album actions to the command palette; check for duplicates with the
   fork's cmdk album commands (#384).

## Batches 49–74 (second half of the cycle)

### Person sharing, dormant

Implemented per the spec, across five commits (one per upstream person-sharing commit):

- `PersonService`/`PersonRepository` return to Gallery's versions; access keeps `checkOwnerAccess` beside upstream's
  inert `checkAccess`. Upstream hunks that merged **cleanly** but would have broken Space members were reverted:
  `createFace`/`reassignFaces` switching to `requirePersonAccess` (owner-row model), `getAllForUser` rebuilt on
  `person_group`, `update()` writing to `targetOwnerId`.
- `GET /people/users` → `[]`; `PUT|DELETE /people/users` → 400 (`personSharingUnsupported`), declared before `:id`.
  `userId` overrides naming anyone else → 400 (security: the owner-only check would otherwise be bypassed).
- Adopted: DTOs (`PeopleUsersUpsertDto`, `otherPeople/sharedBy/sharedWith` always `[]`), `SharingDirection`,
  `uniqueIds`, the `people.updateStrategy` preference (stored, no effect), the `PUT /people/users` validation test.
- Deleted and registered in `fork-deletions.spec.ts`: upstream's share/access/filter/edit/bulk modals,
  `person-user.service.ts`, the medium `person-user.repository.spec.ts`.
- Guards: invariant `person-sharing-dormant`; unit tests for every refusal/guard (proven red); medium spec
  `person-sharing-dormant.spec.ts` pinning the Option M collision and the delete trigger.
- `revert-to-immich.sql`: idempotent `PersonSharing` reversal; rows for `1790587508209-RenameGeoNamesCountries`,
  `1790616293884-PersonSharing`, `1790693088454-AddPersonUserTableSharedBySharedWithConstraint`.

### Other resolutions

| Batch | Upstream                                  | Resolution                                                                                                                                                                                                                                    |
| ----- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 50    | library watcher ignore patterns           | medium DI lists unioned (fork's `SharedSpaceRepository` + upstream's mocks)                                                                                                                                                                   |
| 52    | email template (immich-31859)             | converged on upstream's ESM import of the preset — the fork had made the same fix; kept the fork's `.d.ts`, so upstream's `@ts-expect-error` is dropped                                                                                       |
| 53    | Samsung video make/model                  | applied upstream's fallback chain to the fork's re-indented `ensureLocalFile` body (transformer, every stop)                                                                                                                                  |
| 54    | sync OAuth claims (immich-29013)          | imports unioned; fork's S3 profile-picture branch verified present in `auth`/`user` services                                                                                                                                                  |
| 56    | translations                              | i18n key-union, fork-changed keys win                                                                                                                                                                                                         |
| 57/70 | rc.0 / rc.1 version bumps                 | fork mobile versions kept (`1.0.0+1`, iOS `3.0.0`/`240`)                                                                                                                                                                                      |
| 58    | cull offscreen thumbnails on shared links | upstream's `max-h-screen` + fork's `enableGrouping`                                                                                                                                                                                           |
| 59    | release-workflow fix                      | `draft-release.yml` stays deleted (`git rm`)                                                                                                                                                                                                  |
| 63    | typescript-projects + birthdate tz        | lockfile conflicts → HEAD; `packages/scripts` stays deleted                                                                                                                                                                                   |
| 68    | mobile album editors (immich-31959)       | upstream's `FutureBuilder` app bar + `canEdit` gate merged with the fork's grouping header, `showEditAlbum` (#990) and Space link item (transformer proven byte-identical to upstream); converges with #990                                   |
| 72    | library exclusion docs                    | took upstream's new sentence (no upstream name to rebrand)                                                                                                                                                                                    |
| 73    | tag/shared-link actions (immich-31976)    | 12 pages converted by a transformer; `CreateSharedLinkAction.svelte` kept (Space surfaces, #1018); the bulk `CreateSharedLink` action now shares the owned subset (#853), tested red-first; `SelectionToolbar` uses the upstream `Tag` action |

### Zero-conflict breaks fixed at the tip

- **ML** — CI's mypy covers `test_main.py`; immich-31856 typed `session` as `ModelSession`: 33 casts, new cache key,
  gunicorn patch by path.
- **Medium** — immich-31777's `on_asset_update` push needs `WebsocketRepository` in the fork's visibility specs.
- **e2e** — GeoNames country names (`United States`).
- **Web** — `folders-page.spec` needs `beforeNavigate` (immich-31946); `branded-spinner` set follows the
  `AddUsersModal` rename.
- **Mobile** — album page test needs a `serverInfoProvider` override (immich-31959); store-disclosure policy:
  upstream's new ms/yue_Hant translations of two location keys omit "Noodle Gallery" → dropped (fall back to English).
- **Tooling** — `commit-autolink-check` now scans from the manifest's upstream ref; scanning from `upstream/main`
  counted upstream's own release-line cherry-picks as fork commits.
- **Lockfile** — regenerated once at the tip: canonical, frozen install passes, no injected workspace entries.

### Local verification at the tip (`83e15cfb795`)

| Check                                                                                                                 | Result                                                                   |
| --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| server tsc / lint / prettier / unit                                                                                   | 0 errors / clean / clean / 6484 passed                                   |
| web tsc / svelte-check / unit                                                                                         | 0 / 630 files 0 errors / 6414 passed                                     |
| e2e tsc, prettier (server/web/e2e/i18n/.github)                                                                       | clean                                                                    |
| ML ruff / mypy (CI scope) / pytest                                                                                    | clean / clean / 235 passed                                               |
| mobile analyze / format / flutter test                                                                                | clean / clean / 4016 (all pass after fixes)                              |
| preflight vitest                                                                                                      | 301 passed                                                               |
| audits 40–74, invariants (incl. person-sharing-dormant), fork patches, ownership, autolink, revert coverage, branding | all OK                                                                   |
| SQL docs                                                                                                              | hand-reconciled (no Docker) — CI SQL Schema Checks is the authority      |
| base-image bump (`v202609291109`) Shape H check                                                                       | **not run** (no Docker) — `docker.yml` + ML/mobile smoke cover the build |

### Follow-ups (added)

5. Pull the three newer release-line commits next cycle.
6. Fork `album-utils.isAlbumEditor(album, userId)` vs upstream's `album.service.isAlbumEditor(album)` — converge.
7. Upstream's `isFavorite`/`isHidden` people filters are no-ops in Gallery (they live in the declined query).

## Remote CI

- **Branch**: `rebase/upstream-rolling-v3.3.0`

| Workflow                            | Status | Commit        | Notes                                                                                                 |
| ----------------------------------- | ------ | ------------- | ----------------------------------------------------------------------------------------------------- |
| Test                                | GREEN  | `ec04543a926` | run 36910199798; Lint Web (runner cancel) and one e2e arm (`toomanyrequests` image pull) re-run green |
| Docker                              | GREEN  | `73359898b71` |                                                                                                       |
| Static Code Analysis                | GREEN  | `73359898b71` |                                                                                                       |
| Gallery Build Mobile                | GREEN  | `73359898b71` |                                                                                                       |
| Gallery Rebase Smoke                | GREEN  | `73359898b71` |                                                                                                       |
| Storage Migration Tests / E2E       | GREEN  | `73359898b71` |                                                                                                       |
| Gallery Revert-to-Immich Validation | GREEN  | `73359898b71` | PersonSharing reversal + three post-tag rows                                                          |
| Gallery ML Smoke / Mobile Smoke     | GREEN  | `73359898b71` |                                                                                                       |

Fixed from the first CI round on `73359898b71`: `person.repository.sql` block order (SQL Schema Checks), a `kmr` CTA
branding override for a string immich-31376 introduced, and the e2e camera-make expectation (Gallery's test-assets pin
holds a Samsung video that immich-29375 now labels `Samsung`). Changes after `73359898b71` touch only `Test`'s scope.
