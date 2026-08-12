# Spaces in Workflows — Design

**Date:** 2026-08-12
**Status:** Approved design, not yet implemented
**Scope:** Add shared-space actions to upstream's workflows feature, with a fork/upstream boundary that does not grow as more fork features are added.

## 1. Summary

Upstream Immich ships a workflow engine driven by WASM plugins. Gallery's shared spaces are invisible to it: a workflow can add an uploaded asset to an album, but not to a space or to a space album.

This design adds two action steps — **Add to space** and **Add to space album** — via a fork-owned plugin and a single generic host-function seam. The permanent cost to upstream-owned files is **7 files, ~21 lines**, and that cost is **flat**: every future fork action or filter adds zero upstream lines.

## 2. How upstream's workflow engine works

Verified against the tree at `578dbeaab15`.

| Concern        | Location                                                                                | Notes                                                                                                       |
| -------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Trigger → job  | `server/src/services/workflow-execution.service.ts:296-320`                             | `@OnEvent` → `workflowRepository.search` → one `WorkflowAssetTrigger` job per matching workflow             |
| Step execution | `workflow-execution.service.ts:373-466`                                                 | Infers `WorkflowType` from step types, `read()`s the subject, calls each step's plugin method               |
| Plugin methods | `packages/plugin-core/manifest.json`                                                    | Declares `methods[]` (filters and actions) and `templates[]`; compiled to `dist/plugin.wasm`                |
| Host functions | `workflow-execution.service.ts:110-124`, `packages/plugin-sdk/src/host-functions.ts:44` | Five today: `searchAlbums`, `createAlbum`, `addAssetsToAlbum`, `addAssetsToAlbums`, `httpRequest`           |
| Plugin import  | `workflow-execution.service.ts:53-65, 214-272`                                          | Reads `manifest.json` + wasm from a folder at bootstrap; re-imports on hash change (always, in development) |
| Triggers       | `packages/plugin-sdk/src/types.ts:18`, `server/src/utils/workflow.ts:5`                 | `WorkflowTrigger` enum plus `triggerMap: Record<WorkflowTrigger, WorkflowType[]>`                           |
| Data shapes    | `server/src/enum.ts:1434`, `plugin-sdk/src/types.ts:11`                                 | Only `AssetV1` is live; `AssetPersonV1` is stubbed out in comments                                          |
| Config form    | `web/src/lib/components/SchemaConfiguration.svelte`                                     | Renders the manifest's JSON schema; `uiHint.type` selects a custom control                                  |
| Build          | `server/Dockerfile:65-106`, `docker/docker-compose.dev.yml:76`                          | A dedicated `plugins` stage; dev bind-mounts `packages/plugin-core` into `/build/plugins/`                  |

Four properties of this design make the fork's job cheap, and all four were verified rather than assumed:

1. **`uiHint.type` is `z.string().optional()`**, not an enum (`server/src/dtos/json-schema.dto.ts:20-25`). A `SpaceId` hint passes server-side manifest validation with **no server change at all**. The only place the set is closed is the hand-written web union at `web/src/lib/types.ts:103`.
2. **Host functions are supplied per plugin load** (`workflow-execution.service.ts:133, 145`), from one object built once. Adding a key there exposes it to every plugin — harmless, and it is the only place the host side must change.
3. **The plugin's method schema travels as opaque `jsonb`.** No DTO changes, therefore **no OpenAPI regeneration** and **no database migration** — plugin and method rows are written by the boot-time importer.
4. **`triggerMap` is `Record<WorkflowTrigger, WorkflowType[]>`.** If a future rebase drops a fork trigger's entry, **tsc fails**. Loud, not silent.

## 3. Goals and non-goals

**Goals**

- A workflow can add its triggering asset to one or more shared spaces.
- A workflow can add its triggering asset to a named album inside a space, creating and linking that album if it does not exist.
- The fork's footprint inside upstream-owned files is small, fixed, and does not grow per feature.
- Space membership and contribution rights are enforced by exactly the code paths the HTTP API uses.

**Non-goals for this cut**

- Space-aware **filter** steps ("asset is in space X"). The architecture supports them at zero upstream cost; they are simply not in this cut.
- **New triggers** (asset added to a space, member joined). Costed in §11 but not built.
- **Removing** assets from a space, or linking albums, as workflow steps.
- **Space-owned workflows.** `workflow.ownerId` is a user FK; workflows stay per-user.
- Creating a _space_ from a workflow. Spaces carry members, roles and notifications; a workflow must never conjure one.

## 4. Decisions

| #   | Decision                                                                                                    | Rationale                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | A separate fork-owned plugin package, not new methods inside `packages/plugin-core`                         | `plugin-core/manifest.json` is a large JSON array upstream keeps appending to; JSON arrays have no semantic merge, so every upstream method addition would conflict. A separate package also keeps fork features off a plugin titled "Immich Core Plugin".                                                                                                                                                                              |
| D2  | **One** generic host function `gallery(method, args)`, not one per action                                   | The three lines in `onPluginLoad()` are written once and never grow. Every future fork action and filter routes through the same dispatcher.                                                                                                                                                                                                                                                                                            |
| D3  | The wasm shim carries no business logic                                                                     | Logic in a sandbox can only be tested through Docker. All logic lives in a fork-owned NestJS service, unit-testable with `newTestService()` like every other fork service.                                                                                                                                                                                                                                                              |
| D4  | The dispatcher calls **services**, never repositories                                                       | Access control is enforced once, in the same place the HTTP API enforces it.                                                                                                                                                                                                                                                                                                                                                            |
| D5  | The dispatcher **never throws** for user-fixable conditions                                                 | See §7 — throwing would abort the rest of the workflow, contradicting the chosen failure mode.                                                                                                                                                                                                                                                                                                                                          |
| D6  | Album targeting is `spaceId` + `albumName` (resolve-or-create), not an album picker                         | `SchemaConfiguration.svelte` renders `schema.type === 'object'` at line 67, **above** the `uiHint` branch at line 81, so a composite object value would force our branch to be hoisted above upstream's — position-sensitive in an if-chain upstream may reorder. A string property drops in beside the existing `AlbumId` branch and is order-independent. It also needs only one new web component and matches the actual user story. |
| D7  | `manifest.json` is the single source of truth for method names; a parity test enforces dispatcher agreement | Avoids making the server depend on the plugin package (which would add Dockerfile copy + pnpm filter + `server/package.json` lines to the seam). A unit test reading the JSON gives the same protection for free.                                                                                                                                                                                                                       |
| D8  | Failure mode: log and skip, keep going                                                                      | Chosen by the maintainer. Matches upstream's existing silence; §12 records the follow-up.                                                                                                                                                                                                                                                                                                                                               |
| D9  | Duplicate-name races are accepted, resolution is deterministic                                              | Upstream's `assetAddToAlbums` has the identical exposure. "Oldest wins" makes later runs converge on one album rather than fan out.                                                                                                                                                                                                                                                                                                     |

## 5. Architecture

```
AssetCreate / AssetMetadataExtraction
  └─ WorkflowExecutionService.execute()             [upstream — zero fork lines]
      └─ step "gallery-core#addToSpaceAlbum"
          └─ plugin-gallery wasm shim               [fork] forwards config, no logic
              └─ host fn gallery(method, args)      [upstream seam — 3 lines]
                  └─ GalleryWorkflowHostService     [fork] validates, dispatches, never throws
                      ├─ SharedSpaceService         [fork]
                      └─ AlbumService               [upstream]
```

### 5.1 The permanent seam in upstream-owned files

| File                                                | Lines | Change                                                                                                                            |
| --------------------------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------- |
| `server/src/services/workflow-execution.service.ts` | ~5    | `gallery` in `functions` and `stubs`; one `BaseService.create`; one `importFolder(resourcePaths.galleryPlugin)` in `onPluginSync` |
| `server/src/repositories/config.repository.ts`      | 2     | `resourcePaths.galleryPlugin` — type line plus value line                                                                         |
| `server/src/services/index.ts`                      | 2     | Register the fork service — the same two lines every fork service already has                                                     |
| `server/Dockerfile`                                 | ~4    | Build and copy inside the **existing** `plugins` stage                                                                            |
| `docker/docker-compose.dev.yml`                     | 1     | Bind-mount, mirroring line 76                                                                                                     |
| `web/src/lib/types.ts`                              | 1     | `uiHint.type` union gains `'SpaceId'`                                                                                             |
| `web/src/lib/components/SchemaConfiguration.svelte` | ~6    | One branch beside the existing `AlbumId` branch at line 81                                                                        |

Every one of these is registered in `docs/fork/ownership.yml` under `upstream_extension_paths`.

### 5.2 Fork-owned files

| Path                                                              | Purpose                                                                              |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `packages/plugin-gallery/manifest.json`                           | Method + template declarations. Source of truth for method names and config schemas. |
| `packages/plugin-gallery/src/index.ts`                            | Two shims, each one `functions.gallery(...)` call                                    |
| `packages/plugin-gallery/src/host.ts`                             | `declare module 'extism:host'` augmentation and the `gallery` caller                 |
| `packages/plugin-gallery/{package.json,tsconfig.json,esbuild.js}` | Build config, copied from `plugin-core`'s shape                                      |
| `server/src/services/gallery-workflow-host.service.ts`            | The dispatcher and every current and future fork handler                             |
| `server/src/services/gallery-workflow-host.service.spec.ts`       | Unit tests, including the manifest-parity test                                       |
| `web/src/lib/components/SchemaSpacePicker.svelte` + `.spec.ts`    | Space picker for the config form                                                     |
| `e2e/src/specs/server/api/workflow-spaces.e2e-spec.ts`            | End-to-end guard (see §10.3)                                                         |

### 5.3 Naming

- npm package: `@immich/plugin-gallery`, so pnpm filters and Dockerfile lines read like their siblings.
- Manifest `name`: `gallery-core`. This is **user-visible** — steps render as `gallery-core#addToSpace` in the workflow JSON editor and summary. It must satisfy `/^[a-z0-9-]+[a-z0-9]$/` (`plugin-manifest.dto.ts:6`).
- `gallery-core`, not `gallery-spaces`: this package is the vehicle for every future fork step (pet detection, classification, video), so naming it for spaces would force a second plugin later.
- `branding/scripts/apply-branding.sh` rewrites only an enumerated file list and does **not** touch `packages/plugin-*`, so nothing rewrites these names at build time.

## 6. The dispatcher contract

```ts
type GalleryDispatchResult = { ok: true } | { ok: false; reason: GallerySkipReason };

type GallerySkipReason = 'invalid-config' | 'no-access' | 'not-found' | 'unknown-method';
```

- The shim passes the step's `config` through verbatim, plus `assetId`.
- The dispatcher validates each method's args with **zod**, consistent with the codebase's DTO convention. Invalid config yields `{ ok: false, reason: 'invalid-config' }`, never a throw.
- An unrecognised method name yields `{ ok: false, reason: 'unknown-method' }` rather than throwing, so a version skew between a stale externally-installed plugin and the server degrades gracefully.
- Handlers are held in a map keyed by method name. §10.1 asserts that map and `manifest.json` agree in both directions.
- The shim always returns `{}` — never `changes`. `execute()` re-reads the subject after any step reports changes (`workflow-execution.service.ts:448`); our actions do not mutate the asset, so returning nothing avoids a wasted read per step.

### 6.1 Security invariant

`wrap()` (`workflow-execution.service.ts:158-197`) verifies the step's JWT and produces an `AuthDto` carrying **the asset owner's** id — not the workflow owner's. With upload triggers these coincide, but the dispatcher must never assume it and must never read the workflow owner from anywhere. Every handler passes that `AuthDto` into a service call, so membership and contribution checks run exactly as they do for an HTTP request. **No handler may touch a repository directly.**

## 7. Failure semantics

The chosen behaviour is _log the failure, skip the step, let later steps run_. Tracing the machinery shows this does **not** happen for free:

> If a host function throws, `wrap()` returns `{success:false}`; the SDK's `call()` then throws **inside the wasm** (`host-functions.ts:68`); that propagates out of `callMethod` into `execute()`'s try/catch, which logs and returns `JobStatus.Failed` — **abandoning every remaining step**.

That is "stop the workflow", not "skip and continue". Therefore:

**The dispatcher catches every expected failure and returns `{ ok: false, reason }`.** The shim maps any `ok: false` to `{}` and the workflow continues to the next step. Only genuinely unexpected errors propagate and fail the run. Without this rule the chosen failure mode is unimplementable, so §10.1 tests it as an invariant rather than as a detail.

Per-space isolation follows the same rule: with several target spaces, a failure on one must not prevent the others.

## 8. The two actions

### 8.1 `gallery-core#addToSpace`

```jsonc
{
  "name": "addToSpace",
  "title": "Add to space",
  "description": "Add the asset to one or more shared spaces",
  "types": ["AssetV1"],
  "hostFunctions": true,
  "schema": {
    "type": "object",
    "properties": {
      "spaceIds": {
        "type": "string",
        "array": true,
        "title": "Spaces",
        "description": "Target shared spaces",
        "uiHint": { "type": "SpaceId" },
      },
    },
    "required": ["spaceIds"],
  },
}
```

Handler: de-duplicate `spaceIds`, then for each call `sharedSpaceService.addAssets(auth, spaceId, { assetIds: [assetId] })` (`SharedSpaceAssetAddDto`, `shared-space.dto.ts:178-182`). Failures are per-space and non-fatal.

`MAX_SPACE_ASSETS_PER_REQUEST` (50,000, `shared-space.dto.ts:176`) caps assets **per request**, not per space, so a one-asset call can never reach it. There is no space-capacity limit to handle.

### 8.2 `gallery-core#addToSpaceAlbum`

```jsonc
{
  "name": "addToSpaceAlbum",
  "title": "Add to space album",
  "description": "Add the asset to an album in a shared space, creating it if needed",
  "types": ["AssetV1"],
  "hostFunctions": true,
  "schema": {
    "type": "object",
    "properties": {
      "spaceId": {
        "type": "string",
        "title": "Space",
        "description": "The shared space that owns the album",
        "uiHint": { "type": "SpaceId", "order": 1 },
      },
      "albumName": {
        "type": "string",
        "title": "Album name",
        "description": "Uses this album if it exists in the space, otherwise creates and links it",
        "uiHint": { "order": 2 },
      },
    },
    "required": ["spaceId", "albumName"],
  },
}
```

Handler:

1. Trim `albumName`; if empty, return `{ ok: false, reason: 'invalid-config' }` — never create an album with a blank name.
2. `sharedSpaceService.getLinkedAlbums(auth, spaceId)` → `SharedSpaceLinkedAlbumDto[]`, which extends `AlbumResponseSchema` and so carries `id`, `albumName` and `createdAt` (`shared-space.dto.ts:166-174`).
3. Match on **trimmed, case-insensitive** `albumName`. Users type names inconsistently; an exact-match rule would silently create near-duplicates.
4. On multiple matches, take the **oldest by `createdAt`, tie-broken by `id`** so the choice is deterministic across runs.
5. On no match: `albumService.create(auth, { albumName })`, then `sharedSpaceService.linkAlbum(auth, spaceId, album.id)`.
6. `albumService.addAssets(auth, albumId, { ids: [assetId] })`.

**`linkAlbum` must fire only on actual creation.** It enqueues `SharedSpaceAlbumGrantReconcile` and face-sync work; calling it per asset would flood the queue.

## 9. Web

`SchemaConfiguration.svelte` gains one branch beside the `AlbumId` branch at line 81:

```svelte
{:else if schema.uiHint?.type === 'SpaceId'}
  <SchemaSpacePicker {label} {description} array={schema.array} bind:spaceIds={getUiHintValue, setUiHintValue} />
```

`SchemaSpacePicker.svelte` mirrors `SchemaAlbumPicker.svelte` exactly, reusing the fork's existing `SpacePickerModal` (which resolves `onClose(space?: SharedSpaceResponseDto)` — a **single** space, so array mode appends one per invocation) and `space-card.svelte` for the chosen-space chip.

**i18n:** the picker's own label and empty-state strings are new keys and must land in all ten locales in the same commit (`en` plus `de`, `fr`, `it`, `nl`, `pl`, `es`, `ru`, `zh_Hans`, `zh_Hant`), alphabetically placed, followed by `npx prettier --write i18n/*.json`.

**Accepted gap:** manifest `title` and `description` render raw (`PluginMethodPicker.svelte:26`); upstream has no i18n layer for plugin metadata. "Add to space" will therefore be English in every locale. Building a fork-only translation layer for plugin manifests is out of scope; §12 records it.

## 10. Test plan

Written test-first throughout: each unit below starts as a failing test naming the behaviour, then the implementation that makes it pass. Scenarios are given in Given/When/Then form; each maps to one test case.

### 10.1 Unit — `gallery-workflow-host.service.spec.ts` (vitest, `newTestService()`)

**Structural**

| #   | Scenario                                                                                                                                                                                                                  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| U1  | **Given** `manifest.json`, **when** the dispatcher's handler map is compared to it, **then** every manifest method has a handler and every handler appears in the manifest (both directions — this is the D7 drift guard) |
| U2  | **Given** an unrecognised method name, **when** dispatched, **then** it resolves `{ ok: false, reason: 'unknown-method' }` and does **not** reject                                                                        |

**The never-throws invariant (§7)**

| #   | Scenario                                                                                                                                                       |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| U3  | **Given** any handler and any service that rejects with a `BadRequestException`, **when** dispatched, **then** the call resolves `ok: false` and never rejects |
| U4  | As U3 for `NotFoundException`, `ForbiddenException` and `UnauthorizedException`                                                                                |
| U5  | **Given** a service that rejects with a non-HTTP error, **when** dispatched, **then** the error **does** propagate (only expected failures are swallowed)      |

**`addToSpace`**

| #   | Scenario                                                                                                                                    |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| U6  | **Given** a member with contribution rights, **when** the step runs, **then** `addAssets` is called once per space with exactly `[assetId]` |
| U7  | **Given** `spaceIds` containing the same id twice, **then** `addAssets` is called once for it                                               |
| U8  | **Given** an empty `spaceIds`, **then** no service call is made and the result is `ok: true`                                                |
| U9  | **Given** a malformed `spaceIds` (non-array, non-UUID member), **then** `{ ok: false, reason: 'invalid-config' }` and no service call       |
| U10 | **Given** the owner is a viewer without contribution rights, **then** `{ ok: false, reason: 'no-access' }`                                  |
| U11 | **Given** the space no longer exists, **then** `{ ok: false, reason: 'not-found' }`                                                         |
| U12 | **Given** the asset is already in the space, **then** the result is `ok: true` and no error surfaces                                        |
| U13 | **Given** three spaces where the second denies access, **then** the first and **third** are still attempted                                 |
| U14 | **Given** any outcome, **then** the returned value carries no `changes` key                                                                 |

**`addToSpaceAlbum`**

| #   | Scenario                                                                                                                                 |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| U15 | **Given** exactly one linked album named "Holidays 2026", **then** assets are added to it and neither `create` nor `linkAlbum` is called |
| U16 | **Given** a linked album named "holidays 2026" and config " Holidays 2026 ", **then** it matches (trimmed, case-insensitive)             |
| U17 | **Given** two linked albums with the same name, **then** the one with the older `createdAt` is used                                      |
| U18 | As U17 with identical `createdAt`, **then** the lower `id` is used — deterministic                                                       |
| U19 | **Given** no matching album, **then** `create` is called, then `linkAlbum` **once**, then `addAssets` — in that order                    |
| U20 | **Given** a matching album, **then** `linkAlbum` is **never** called (queue-flood guard)                                                 |
| U21 | **Given** `albumName` is `"   "`, **then** `{ ok: false, reason: 'invalid-config' }` and `create` is never called                        |
| U22 | **Given** `spaceId` is absent, **then** `{ ok: false, reason: 'invalid-config' }`                                                        |
| U23 | **Given** the owner may not link albums into the space, **then** `{ ok: false, reason: 'no-access' }` and no orphan album is left behind |
| U24 | **Given** the album exists but is owned by another member and the owner lacks add rights, **then** `{ ok: false, reason: 'no-access' }`  |
| U25 | **Given** the asset is already in the album, **then** `ok: true` and no error surfaces                                                   |
| U26 | **Given** any handler, **then** the `AuthDto` passed to every service call is the one supplied by `wrap()` — asserting D4/§6.1           |

### 10.2 Web — `SchemaSpacePicker.spec.ts` (vitest + testing-library)

| #   | Scenario                                                                                                                                   |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| W1  | **Given** no selection, **then** a Choose button renders and no space chip is shown                                                        |
| W2  | **Given** the modal resolves a space, **then** the bound value becomes that space's id                                                     |
| W3  | **Given** `array` is true and a space is already selected, **when** another is chosen, **then** the value **appends** rather than replaces |
| W4  | **Given** `array` is false, **when** a second space is chosen, **then** it **replaces** the first                                          |
| W5  | **Given** the modal is dismissed with no selection, **then** the bound value is unchanged                                                  |
| W6  | **Given** a selected space, **when** its remove control is used, **then** it is dropped from the value                                     |

Assertions must be failable — assert on rendered text and the bound value, never `queryBy…` alone, and re-set mocks per test (this suite does not clear mocks between tests).

### 10.3 End-to-end — `workflow-spaces.e2e-spec.ts`

This file is the **only** guard against the "patch point silently deleted" failure: if a rebase drops the `gallery` line from `onPluginLoad`, wasm instantiation fails, the plugin never loads, and these tests go red. Nothing else catches it. A sibling fork-authored file already exists at `e2e/src/specs/server/api/workflow.e2e-spec.ts`.

| #   | Scenario                                                                                                                                                                                                                                                              |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E1  | **Given** a space the user owns and a workflow with an `addToSpace` step, **when** an asset is uploaded, **then** the asset appears in the space                                                                                                                      |
| E2  | **Given** an `addToSpaceAlbum` step naming an album that does not exist, **when** an asset is uploaded, **then** an album with that name exists, is linked to the space, and contains the asset                                                                       |
| E3  | **Given** E2 has run, **when** a second asset is uploaded, **then** it lands in the **same** album and no second album is created                                                                                                                                     |
| E4  | **Given** a workflow whose target space the user has been removed from, **when** an asset is uploaded, **then** the upload succeeds, the asset is not in the space, and **subsequent steps in the same workflow still run** — the §7 invariant, observed from outside |
| E5  | **Given** a step referencing `gallery-core#noSuchMethod`, **when** the workflow is created, **then** the API rejects it with 400 (`resolveMethod`)                                                                                                                    |

**Do not trust `waitForQueueFinish`** — it reports "done" while the queue still has work. Poll the assertion itself with a bounded timeout.

### 10.4 Coverage of failure paths not otherwise reachable

`invalid-config` and `unknown-method` are unreachable through the UI (the config form and `resolveMethod` prevent them), so they are covered at the unit level only — U2, U9, U21, U22. They exist for externally-installed or version-skewed plugins and must not be dropped as "dead paths".

Two conditions are deliberately **not** covered here because they are upstream-owned and never reach a fork handler:

- **The asset is trashed or deleted between trigger and execution.** `execute()` calls `read()` before any step runs (`workflow-execution.service.ts:404`), so the run fails there, in upstream code.
- **A step whose plugin failed to import.** `resolveMethod` rejects the workflow at create time; E5 covers the API-visible half.

## 11. What future fork features will cost

| Capability                                                                           | Upstream lines, each time                                                                                              | Failure caught how                                                             |
| ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| New action (remove from space, share with group, auto-trim)                          | **0**                                                                                                                  | n/a                                                                            |
| New filter over fork data (classified as X, has pet Rex, in space Y)                 | **0**                                                                                                                  | n/a                                                                            |
| New trigger reusing `AssetV1` (pet recognised, classification done, duplicate found) | **4** across 3 files: `WorkflowTrigger` member, `triggerMap` entry, two label cases in `web/src/lib/utils/workflow.ts` | **tsc fails** if the `triggerMap` entry is lost — `Record<WorkflowTrigger, …>` |
| New `WorkflowType` data shape                                                        | 6+ files including `execute()`                                                                                         | partial                                                                        |

The last row is the one to design around: **fork triggers should reuse `AssetV1`** and carry extra context in step config rather than in a new payload shape. Spaces, pet detection and classification all fit that rule. `WorkflowTriggerSchema` is derived (`z.enum(WorkflowTrigger)`, `enum.ts:1429`), so validation and the generated OpenAPI enum follow the enum member automatically — there is no third place to remember.

A fork trigger's `@OnEvent` handler lives in a **fork-owned service** and re-queues upstream's existing `JobName.WorkflowAssetTrigger`; twenty fork services already use `@OnEvent`, including `shared-space.service.ts`.

## 12. Risks and follow-ups

| Risk                                                                                            | Mitigation                                                                                                                                                                      |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Upstream is mid-build here — `AssetPersonV1` is stubbed, `execute()` carries several TODOs      | Keep fork lines inside `execute()` at exactly zero. The one recurring conflict is upstream appending a sixth host function beside our `gallery` line: a "keep both" resolution. |
| The dispatcher is string-keyed across the wasm boundary, so a renamed handler breaks at runtime | U1's bidirectional parity test against `manifest.json`                                                                                                                          |
| Upstream deletes the seam entirely — zero conflicts, silent break                               | §10.3 e2e. `fork-patches-check` covers pnpm patches only and `ci-invariants` matches forbidden patterns under `.github/workflows` only; neither fits.                           |
| `BaseService.create` forwards repositories **positionally** and has gone stale before           | The dispatcher touches only services, not repositories (D4), which sidesteps it. Verify at implementation time all the same.                                                    |
| A silently dead rule — the user never learns their workflow stopped working (D8)                | Deliberate for this cut. Follow-up: build-time validation of target spaces plus a run-history surface, which upstream lacks entirely.                                           |
| Plugin manifest strings are untranslatable                                                      | Accepted (§9). Follow-up only if upstream adds an i18n layer for plugin metadata.                                                                                               |

## 13. Implementation order

1. `packages/plugin-gallery` scaffold — package.json, tsconfig, esbuild, manifest with both methods, shims. Confirm `pnpm --filter @immich/plugin-gallery build` emits `dist/plugin.wasm`.
2. `GalleryWorkflowHostService` — U1–U5 first (structure and the never-throws invariant), then U6–U14, then U15–U26.
3. The upstream seam (§5.1 server rows) plus dev bind-mount; confirm the plugin imports at boot and its methods appear in the step picker.
4. Web — `SchemaSpacePicker` with W1–W6, the `uiHint` union line, the `SchemaConfiguration` branch, and all ten locales.
5. Dockerfile plugins-stage rows; confirm a production image still boots and imports both plugins.
6. `workflow-spaces.e2e-spec.ts` — E1–E5.
7. Register every new and modified path in `docs/fork/ownership.yml`.
8. Gates: `make check-server`, `make check-web`, `make lint-all`, server and web unit suites, the e2e suite, and `npx prettier --write i18n/*.json` plus prettier over `docs/`.
