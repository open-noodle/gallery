# Spaces in Workflows — Design

**Date:** 2026-08-12
**Status:** Implemented. Seam figures in §1 and §5.1 are measured from the implemented branch, not estimated.
**Scope:** Add shared-space actions to upstream's workflows feature, with a fork/upstream boundary that does not grow as more fork features are added.

## 1. Summary

Upstream Immich ships a workflow engine driven by WASM plugins. Gallery's shared spaces are invisible to it: a workflow can add an uploaded asset to an album, but not to a space or to a space album.

This design adds two action steps — **Add to space** and **Add to space album** — via a fork-owned plugin and a single generic host-function seam. The cost to upstream-owned files is **9 files, +27/−5 lines** (measured on the implemented branch).

That number is a **one-time cost of introducing a new package**, not a per-feature cost. Four of the nine files exist purely to build and ship `packages/plugin-gallery` (`Dockerfile`, `docker-compose.dev.yml`, `mise.toml`, `test.yml`'s path filters) and one is a test mock. The claim the design actually rests on is narrower and still holds: **every future fork action or filter adds zero upstream lines**, because they are new methods in a package that is already built, shipped and routed through the one generic `gallery(method, args)` dispatcher.

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

| #   | Decision                                                                                                    | Rationale                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | A separate fork-owned plugin package, not new methods inside `packages/plugin-core`                         | `plugin-core/manifest.json` is a large JSON array upstream keeps appending to; JSON arrays have no semantic merge, so every upstream method addition would conflict. A separate package also keeps fork features off a plugin titled "Immich Core Plugin".                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| D2  | **One** generic host function `gallery(method, args)`, not one per action                                   | The three lines in `onPluginLoad()` are written once and never grow. Every future fork action and filter routes through the same dispatcher.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| D3  | The wasm shim carries no business logic                                                                     | Logic in a sandbox can only be tested through Docker. All logic lives in a fork-owned NestJS service, unit-testable with `newTestService()` plus the D10 seam.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| D4  | The dispatcher calls **services**, never repositories                                                       | Access control is enforced once, in the same place the HTTP API enforces it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| D5  | The dispatcher **never throws** for user-fixable conditions                                                 | See §7 — throwing would abort the rest of the workflow, contradicting the chosen failure mode.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| D6  | Album targeting is `spaceId` + `albumName` (resolve-or-create), never an album **id**                       | Targeting by id needs a composite `{spaceId, albumId}` object value, and `SchemaConfiguration.svelte` renders `schema.type === 'object'` at line 67 **above** the `uiHint` branch at line 81 — so our branch would have to be hoisted above upstream's, position-sensitive in an if-chain upstream may reorder. A string property drops in beside the existing `AlbumId` branch and is order-independent. An id also dangles when the album is deleted, silently breaking the workflow, whereas a name always resolves. **Amended (D14): this constrains the stored value, not the editor.**                                                                                                      |
| D14 | The `albumName` **editor** is a combobox scoped to the chosen space, not a bare text input                  | D6 originally concluded "not an album picker", and the first cut therefore shipped free text. That over-read it: the objection was to composite-object _values_, not to a richer editor over a string one. In the object branch each child receives `bind:config` pointing at the **parent** object, so a `SpaceAlbumName` renderer reads the sibling `spaceId` by name — reactively, since the root `config` is a `$state` proxy. It sits beside the `SpaceId` branch, so D6's ordering concern still holds. The existing `Combobox` already does list-or-create via `allowCreate`, and the stored value stays a plain name, so the server contract is unchanged.                                |
| D15 | The album-name field commits on **keystroke**, via a new optional `onTextInput` on `Combobox`               | `Combobox` calls `onSelect` only from `handleSelect` — an option click or Enter on a highlighted option — and its blur handler resets the input to the selected option's label, discarding unselected text. The interaction users actually perform is "type a new album name, click Save", which selects nothing, so a commit-on-select field silently persisted `albumName: ""` and the dispatcher rejected it as invalid config. This is the one place the feature costs an extra upstream file; the prop is optional and defaults to a no-op, so no existing consumer changes. Covered by a component test that types without selecting, and by a Playwright test that drives the real editor. |
| D7  | `manifest.json` is the single source of truth for method names; a parity test enforces dispatcher agreement | Avoids making the server depend on the plugin package (which would add Dockerfile copy + pnpm filter + `server/package.json` lines to the seam). A unit test reading the JSON gives the same protection for free.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| D8  | Failure mode: log and skip, keep going                                                                      | Chosen by the maintainer. Matches upstream's existing silence; §12 records the follow-up.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| D9  | Duplicate-name races are accepted, resolution is deterministic                                              | Upstream's `assetAddToAlbums` has the identical exposure. "Oldest wins" makes later runs converge on one album rather than fan out.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| D10 | Collaborator services are reached through a `protected collaborators()` seam                                | `newTestService` injects **repositories** (`server/test/utils.ts:401-426`); `BaseService.create` then builds **real** services from that context. Without a seam, asserting "`linkAlbum` was not called" is impossible — the real 2,800-line `SharedSpaceService` would run against repository mocks. Corroboration: `BaseService.create` is used in exactly one file and there is **no** `workflow-execution.service.spec.ts` — upstream does not unit-test it either. See §6.2.                                                                                                                                                                                                                 |
| D11 | `reason` is advisory, for logs only — never a control-flow or assertion target                              | This codebase's access layer commonly rejects non-owners with **400 `BadRequestException`** through the bulk-access pattern (documented at `e2e/src/specs/server/api/workflow.e2e-spec.ts:13-14`), so `no-access` and `not-found` are not reliably distinguishable from exception types. Tests assert `ok === false`; only dispatcher-produced reasons are asserted exactly.                                                                                                                                                                                                                                                                                                                      |
| D12 | Ship **no** templates in this cut (`templates: []`)                                                         | Templates are user-visible in `WorkflowTemplatePickerModal` and would need their own scenarios and ten-locale strings. Adding one later costs zero upstream lines.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| D13 | The album is linked **before** any asset is added, and creation is compensated on link failure              | See §8.2 — the create-then-link order can otherwise strand an orphan personal album when the owner may not link into the space.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

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

Measured on the implemented branch (`git diff --stat <merge-base>..HEAD` over these paths): **9 files, 27 insertions, 5 deletions.**

Two of the nine were discovered only during implementation, and both are recorded below rather than quietly folded in: `config.repository.mock.ts` (a required field breaks its full-object literal) and `mise.toml` (without it the dev bind-mount points at a folder with no wasm, and the feature is silently absent in every dev stack — `importFolder` only warns).

| File                                                 | Lines | Change                                                                                                                              |
| ---------------------------------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `server/src/services/workflow-execution.service.ts`  | +10   | `gallery` in `functions` and `stubs`; one `BaseService.create`; one `importFolder(resourcePaths.galleryPlugin)` in `onPluginSync`   |
| `server/Dockerfile`                                  | +5/−2 | Build and copy inside the **existing** `plugins` stage; the two deletions are existing pnpm invocations gaining one more `--filter` |
| `web/src/lib/components/SchemaConfiguration.svelte`  | +3    | One import and one branch beside the existing `AlbumId` branch                                                                      |
| `server/src/repositories/config.repository.ts`       | +2    | `resourcePaths.galleryPlugin` — type line plus value line                                                                           |
| `server/test/repositories/config.repository.mock.ts` | +1    | The mock's full-object `EnvData` literal needs the new required field, or `tsc` fails                                               |
| `docker/docker-compose.dev.yml`                      | +1    | Bind-mount, mirroring the `plugin-core` one                                                                                         |
| `web/src/lib/types.ts`                               | +1/−1 | `uiHint.type` union gains `'SpaceId'`                                                                                               |
| `mise.toml`                                          | +2/−2 | `[tasks.plugins]` builds the new package, so `mise dev`'s bind-mount has a wasm to serve                                            |
| `.github/workflows/test.yml`                         | +2    | `packages/plugin-gallery/**` in the server and e2e path filters, so a manifest-only change still runs the drift guards              |

Every one of these is registered in `docs/fork/ownership.yml` — the last two were already declared as fork-extended infrastructure, so they needed no new entry.

**The seventh file was discovered during implementation, not designed in.** Making `galleryPlugin` a required field on `resourcePaths` breaks `config.repository.mock.ts`'s full-object literal. The alternative — declaring it optional — would push a non-null assertion or a runtime guard into `workflow-execution.service.ts`, the one file this design most wants to keep small, to describe an invariant that never actually holds (`getEnv()` always sets it). One mechanical line in a test mock is the cheaper trade, and it is the same edit upstream would make when adding a resource path.

`server/src/services/index.ts` is deliberately **not** on this list. The dispatcher is built with `BaseService.create` and never injected, and it declares no `@OnEvent` or `@OnJob`, so Nest never needs to know it exists — which removes the two lines every other fork service costs.

### 5.2 Fork-owned files

| Path                                                                                         | Purpose                                                                                                                                                                                         |
| -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/plugin-gallery/manifest.json`                                                      | Method declarations — source of truth for method names and config schemas. `templates: []` this cut (D12).                                                                                      |
| `packages/plugin-gallery/src/index.ts`                                                       | Two shims, each one `functions.gallery(...)` call, no branching (§10.4)                                                                                                                         |
| `packages/plugin-gallery/src/host.ts`                                                        | `declare module 'extism:host'` augmentation and the `gallery` caller                                                                                                                            |
| `packages/plugin-gallery/{package.json,tsconfig.json,esbuild.js}`                            | Build config, copied from `plugin-core`'s shape                                                                                                                                                 |
| `server/src/services/gallery-workflow-host.service.ts`                                       | The dispatcher and every current and future fork handler                                                                                                                                        |
| `server/src/services/gallery-workflow-host.service.spec.ts`                                  | Unit tests — manifest validity (U0), manifest/handler parity (U1), the rest of §10.1                                                                                                            |
| `web/src/lib/components/SchemaSpacePicker.svelte` + `.spec.ts` + `.test-wrapper.svelte`      | Space picker for the config form. The wrapper owns `$state` so tests can observe the bindable prop — a `$bindable` is not readable off the render result in runes mode.                         |
| `web/src/lib/components/SchemaSpaceAlbumPicker.svelte` + `.spec.ts` + `.test-wrapper.svelte` | Album-name combobox for the config form, scoped to the sibling space (D14). The wrapper also drives the space change, so the reload-and-keep-the-name behaviour is testable without `rerender`. |
| `web/src/lib/components/SchemaConfiguration.spec.ts`                                         | Guards the two fork `uiHint` branches in an otherwise upstream-owned file — a dropped branch degrades silently to the plain string `<Input>` rather than failing.                               |
| `e2e/src/specs/server/api/workflow-spaces.e2e-spec.ts`                                       | End-to-end guard (see §10.3)                                                                                                                                                                    |

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

**`reason` is advisory (D11).** It exists to make the server log actionable. It is never branched on, and tests assert `ok === false` rather than a specific reason — except `invalid-config` and `unknown-method`, which the dispatcher produces itself and which therefore _are_ asserted exactly. `no-access` and `not-found` are best-effort labels: this codebase's access layer commonly rejects non-owners with 400 `BadRequestException` via the bulk-access pattern, so the two are not reliably separable from exception types.

### 6.1 Security invariant

`wrap()` (`workflow-execution.service.ts:158-197`) verifies the step's JWT and produces an `AuthDto` carrying **the asset owner's** id — not the workflow owner's. With upload triggers these coincide, but the dispatcher must never assume it and must never read the workflow owner from anywhere. Every handler passes that `AuthDto` into a service call, so membership and contribution checks run exactly as they do for an HTTP request. **No handler may touch a repository directly.**

### 6.2 The testability seam

`newTestService` injects **repositories**, not services (`server/test/utils.ts:401-426`), while `BaseService.create` constructs **real** services from that same context. A dispatcher that called `BaseService.create(SharedSpaceService, this)` inline would therefore run the real `SharedSpaceService` against repository mocks, and assertions like "`linkAlbum` was never called" (U20) would have nothing to observe. This is not hypothetical: `BaseService.create` is used in exactly one file today, and that file has **no** unit spec.

So collaborators are reached through one overridable, memoised seam:

```ts
protected collaborators() {
  this.services ??= {
    sharedSpace: BaseService.create(SharedSpaceService, this),
    album: BaseService.create(AlbumService, this),
  };
  return this.services;
}
```

Spec files subclass `GalleryWorkflowHostService` and override `collaborators()` with `vi.fn()` doubles. This is fork-owned, costs no upstream lines, and makes every §10.1 assertion literally true. Memoisation also matters in production: a step must not rebuild both services per dispatch.

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
5. On no match: `albumService.create(auth, { albumName })`, then `sharedSpaceService.linkAlbum(auth, spaceId, album.id)` — **linking before any asset is added**, so a rejected link never leaves a half-populated album.
6. `albumService.addAssets(auth, albumId, { ids: [assetId] })`.

**`linkAlbum` must fire only on actual creation.** It enqueues `SharedSpaceAlbumGrantReconcile` and face-sync work; calling it per asset would flood the queue.

**The orphan-album compensation (D13).** `albumService.create` succeeds for anyone — it makes a personal album — but `linkAlbum` can be denied for a member without link rights. Step 5 would then strand a personal album the user never asked for. Pre-flighting is not reliable (there is no "can I link?" query that is not itself a race), so the handler **compensates**: on link failure it deletes the album it just created, then returns `{ ok: false, reason: 'no-access' }`. Two rules follow, both tested:

- Compensation deletes **only** an album this invocation created — never a pre-existing one.
- A failure _of the compensation itself_ is logged and swallowed. It must not throw, or §7 is violated and the rest of the workflow dies.

**`AssetMetadataExtraction` re-fires.** That trigger runs again whenever metadata is re-extracted, so a workflow on it is not once-per-asset. This makes the action's idempotency load-bearing (§10.1 U27), and it means that deleting an auto-created album will see it recreated on the next extraction. That is correct behaviour, documented here so it is not later filed as a bug.

## 9. Web

`SchemaConfiguration.svelte` gains one branch beside the `AlbumId` branch at line 81:

```svelte
{:else if schema.uiHint?.type === 'SpaceId'}
  <SchemaSpacePicker {label} {description} array={schema.array} bind:spaceIds={getUiHintValue, setUiHintValue} />
```

`SchemaSpacePicker.svelte` mirrors `SchemaAlbumPicker.svelte` exactly, reusing the fork's existing `SpacePickerModal` — which resolves `onClose(space?: SharedSpaceResponseDto)`, a **single** space, so array mode appends one per invocation. Space names come from `getAllSpaces()`.

The chosen-space chip is a plain name plus a remove button. It must **not** reuse `space-card.svelte`: that component is a full card with a collage, member avatars, a pin menu and a route link, none of which belong in a config form.

**i18n:** the picker's own label and empty-state strings are new keys and must land in all ten locales in the same commit (`en` plus `de`, `fr`, `it`, `nl`, `pl`, `es`, `ru`, `zh_Hans`, `zh_Hant`), alphabetically placed, followed by `npx prettier --write i18n/*.json`.

**Accepted gap:** manifest `title` and `description` render raw (`PluginMethodPicker.svelte:26`); upstream has no i18n layer for plugin metadata. "Add to space" will therefore be English in every locale. Building a fork-only translation layer for plugin manifests is out of scope; §12 records it.

## 10. Test plan

Written test-first throughout: each unit below starts as a failing test naming the behaviour, then the implementation that makes it pass. Scenarios are given in Given/When/Then form; each maps to one test case.

### 10.1 Unit — `gallery-workflow-host.service.spec.ts` (vitest, `newTestService()`)

**Structural**

| #   | Scenario                                                                                                                                                                                                                  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| U0  | **Given** `packages/plugin-gallery/manifest.json`, **when** it is parsed by `PluginManifestDto.schema`, **then** it validates — see the note below                                                                        |
| U1  | **Given** `manifest.json`, **when** the dispatcher's handler map is compared to it, **then** every manifest method has a handler and every handler appears in the manifest (both directions — this is the D7 drift guard) |
| U2  | **Given** an unrecognised method name, **when** dispatched, **then** it resolves `{ ok: false, reason: 'unknown-method' }` and does **not** reject                                                                        |

U0 exists because manifest failure is **silent**: `importFolder` catches everything and only logs a warning (`workflow-execution.service.ts:269-271`). A `name` breaking `/^[a-z0-9-]+[a-z0-9]$/`, a non-semver `version`, or a JSON-schema property using a type outside `JsonSchemaTypeSchema` would ship an image where the plugin simply never imports and the whole feature is absent, with a green test suite. U0 also guards the easily-confused pair of fields: method-level `uiHints: string[]` versus property-level `uiHint: { type, order }`.

**The never-throws invariant (§7)**

| #   | Scenario                                                                                                                                                       |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| U3  | **Given** any handler and any service that rejects with a `BadRequestException`, **when** dispatched, **then** the call resolves `ok: false` and never rejects |
| U4  | As U3 for `NotFoundException`, `ForbiddenException` and `UnauthorizedException`                                                                                |
| U5  | **Given** a service that rejects with a non-HTTP error, **when** dispatched, **then** the error **does** propagate (only expected failures are swallowed)      |

**`addToSpace`**

| #   | Scenario                                                                                                                                               |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| U6  | **Given** a member with contribution rights, **when** the step runs, **then** `addAssets` is called once per space with exactly `[assetId]`            |
| U7  | **Given** `spaceIds` containing the same id twice, **then** `addAssets` is called once for it                                                          |
| U8  | **Given** an empty `spaceIds`, **then** no service call is made and the result is `ok: true`                                                           |
| U9  | **Given** a malformed `spaceIds` (non-array, non-UUID member), **then** `{ ok: false, reason: 'invalid-config' }` and no service call                  |
| U10 | **Given** the owner is a viewer without contribution rights, **then** `ok: false` and the failure is logged (the `reason` label is not asserted — D11) |
| U11 | **Given** the space no longer exists, **then** `ok: false` and the failure is logged                                                                   |
| U12 | **Given** the asset is already in the space, **then** the result is `ok: true` and no error surfaces                                                   |
| U13 | **Given** three spaces where the second denies access, **then** the first and **third** are still attempted                                            |
| U14 | **Given** any outcome, **then** the returned value carries no `changes` key                                                                            |

**`addToSpaceAlbum`**

| #   | Scenario                                                                                                                                                                                                      |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| U15 | **Given** exactly one linked album named "Holidays 2026", **then** assets are added to it and neither `create` nor `linkAlbum` is called                                                                      |
| U16 | **Given** a linked album named "holidays 2026" and config " Holidays 2026 ", **then** it matches (trimmed, case-insensitive)                                                                                  |
| U17 | **Given** two linked albums with the same name, **then** the one with the older `createdAt` is used                                                                                                           |
| U18 | As U17 with identical `createdAt`, **then** the lower `id` is used — deterministic                                                                                                                            |
| U19 | **Given** no matching album, **then** `create` is called, then `linkAlbum` **once**, then `addAssets` — in that order                                                                                         |
| U20 | **Given** a matching album, **then** `linkAlbum` is **never** called (queue-flood guard)                                                                                                                      |
| U21 | **Given** `albumName` is `"   "`, **then** `{ ok: false, reason: 'invalid-config' }` and `create` is never called                                                                                             |
| U22 | **Given** `spaceId` is absent, **then** `{ ok: false, reason: 'invalid-config' }`                                                                                                                             |
| U23 | **Given** the owner may not link albums into the space, **then** `ok: false`, and the album created moments earlier is **deleted** (D13 compensation)                                                         |
| U24 | **Given** the album exists but is owned by another member and the owner lacks add rights, **then** `ok: false`                                                                                                |
| U25 | **Given** the asset is already in the album, **then** `ok: true` and no error surfaces                                                                                                                        |
| U26 | **Given** any handler, **then** the `AuthDto` passed to every service call is the one supplied by `wrap()` — asserting D4/§6.1                                                                                |
| U27 | **Given** a step that already created and linked the album on an earlier run, **when** the job is retried, **then** no second album is created and the asset is added once — BullMQ retries re-run every step |
| U28 | **Given** a matching **pre-existing** album and a failing `addAssets`, **then** the compensation does **not** delete it — only albums this invocation created are ever deleted                                |
| U29 | **Given** `linkAlbum` is denied **and** the compensating delete also fails, **then** the dispatcher still resolves `ok: false` and does not reject (§7 must survive a failing compensation)                   |
| U30 | **Given** `getLinkedAlbums` itself is denied, **then** `ok: false` and neither `create` nor `linkAlbum` is called                                                                                             |

### 10.2 Web — `SchemaSpacePicker.spec.ts` (vitest + testing-library)

| #   | Scenario                                                                                                                                                                                                                             |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| W1  | **Given** no selection, **then** a Choose button renders and no space chip is shown                                                                                                                                                  |
| W2  | **Given** the modal resolves a space, **then** the bound value becomes that space's id                                                                                                                                               |
| W3  | **Given** `array` is true and a space is already selected, **when** another is chosen, **then** the value **appends** rather than replaces                                                                                           |
| W4  | **Given** `array` is false, **when** a second space is chosen, **then** it **replaces** the first                                                                                                                                    |
| W5  | **Given** the modal is dismissed with no selection, **then** the bound value is unchanged                                                                                                                                            |
| W6  | **Given** a selected space, **when** its remove control is used, **then** it is dropped from the value                                                                                                                               |
| W7  | **Given** a configured space id that no longer resolves (the space was deleted after the workflow was saved), **then** the form renders a removable placeholder instead of crashing, and the rest of the step's fields stay editable |

W7 matters because a workflow outlives the spaces it points at, and `SchemaConfiguration` renders every property of the step in one form — an unhandled throw in the space chip would take the whole step editor down, including the field the user needs in order to fix it.

These assert through a `.test-wrapper.svelte` that owns the `$state` and renders it into a `data-testid`, following `space-albums-controls.test-wrapper.svelte`. Reading a `$bindable` off the render result does not work in Svelte 5 runes mode. `@immich/ui` and `@immich/sdk` are module-mocked, per the convention in this suite — an unmocked `getAllSpaces()` would attempt a real fetch under happy-dom, and would also make W2 fail while W7 passed for the wrong reason.

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

**The wasm shim is deliberately not unit-tested.** `packages/plugin-gallery/src/index.ts` runs inside extism and depends on the `Host` and `Memory` globals, so unit-testing it would mean mocking the runtime rather than exercising it. The shim is therefore held to a hard rule — **no branching, no logic, one `functions.gallery(...)` call per method** — and is covered end to end by §10.3. If a shim ever needs a conditional, that conditional belongs in the dispatcher instead. Do not attempt to TDD this file.

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

| Risk                                                                                                                                   | Mitigation                                                                                                                                                                              |
| -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Upstream is mid-build here — `AssetPersonV1` is stubbed, `execute()` carries several TODOs                                             | Keep fork lines inside `execute()` at exactly zero. The one recurring conflict is upstream appending a sixth host function beside our `gallery` line: a "keep both" resolution.         |
| The dispatcher is string-keyed across the wasm boundary, so a renamed handler breaks at runtime                                        | U1's bidirectional parity test against `manifest.json`                                                                                                                                  |
| Upstream deletes the seam entirely — zero conflicts, silent break                                                                      | §10.3 e2e. `fork-patches-check` covers pnpm patches only and `ci-invariants` matches forbidden patterns under `.github/workflows` only; neither fits.                                   |
| `BaseService.create` forwards repositories **positionally** and has gone stale before                                                  | The dispatcher touches only services, not repositories (D4), which sidesteps it. Verify at implementation time all the same.                                                            |
| An invalid manifest, a missing plugin folder, or a failed wasm build makes the feature **silently absent** — `importFolder` only warns | U0 validates the manifest in unit tests; step 6 of §13 requires reading the boot log for both plugins rather than trusting a healthy container; §10.3 fails if the plugin is not loaded |
| A silently dead rule — the user never learns their workflow stopped working (D8)                                                       | Deliberate for this cut. Follow-up: build-time validation of target spaces plus a run-history surface, which upstream lacks entirely.                                                   |
| Plugin manifest strings are untranslatable                                                                                             | Accepted (§9). Follow-up only if upstream adds an i18n layer for plugin metadata.                                                                                                       |

## 13. Implementation order

Test-first throughout: each step below names the tests that must be **red before** the code that turns them green. The only exceptions are declared, and they are declared because they cannot be unit-tested rather than because they are inconvenient.

1. **`manifest.json` + U0.** Write the manifest with both methods, then U0 (schema validation) — a failing parse is the first thing to catch, since every later failure mode is silent. No wasm build yet.
2. **`GalleryWorkflowHostService`, red first.** U1–U2 (structure, drift guard) → U3–U5 (never-throws) → U6–U14 (`addToSpace`) → U15–U30 (`addToSpaceAlbum`, including compensation and retry idempotency). The D10 `collaborators()` seam is written as part of step 2, because U6 cannot be expressed without it.
3. **Plugin scaffold — no tests, by §10.4.** package.json, tsconfig, esbuild, and the shims, held to "no branching, one call per method". Confirm `pnpm --filter @immich/plugin-gallery build` emits `dist/plugin.wasm`.
4. **The upstream seam** (§5.1 server rows) plus the dev bind-mount. Confirm the plugin imports at boot and its methods appear in the step picker. Verify here that every repository the dispatcher reaches is forwarded by `BaseService.create`'s positional list.
5. **Web, red first.** W1–W7 against `SchemaSpacePicker`, then the component, then the `uiHint` union line and the `SchemaConfiguration` branch, then all ten locales.
6. **Dockerfile plugins-stage rows.** Confirm a production image boots and imports **both** plugins — a missing plugin folder only produces a warning, so check the log line, not just a healthy container.
7. **`workflow-spaces.e2e-spec.ts` — E1–E5**, written last because they need the whole stack, and polling their own assertions rather than trusting `waitForQueueFinish`.
8. Register every new and modified path in `docs/fork/ownership.yml`.
9. Gates — **the `make` targets CLAUDE.md documents do not exist in this repo**; use the per-package scripts: `cd server && pnpm check && pnpm lint && pnpm test --run <path>`, `cd web && pnpm check:typescript && pnpm check:svelte && pnpm lint && pnpm test --run <path>`, the e2e suite, `make fork-ownership-coverage-check`, and `npx prettier --write i18n/*.json` plus prettier over `docs/`. Note `pnpm test -- --run <path>` (with `--`) silently runs the **entire** suite — a false green.
