# Pi Agent Workflow Expansion — Phase 2 (named-entity sources + asset/space operations)

Status: planning artifact
Date: 2026-05-30
Branch: `explore/pi-agent-brainstorm`

> **For agentic workers (`/impl-loop`):** This spec is written for slice-by-slice
> implementation. Each entry under **Test-Driven Development** is a self-contained
> vertical slice with a goal, the files it touches, an EXACT TDD test list, edge
> cases, and acceptance criteria. Implement them **in order**, **test-first**
> (write the failing test, then the code, then green), one slice per loop. Every
> slice ends green (`pnpm --dir agent-runner test`, plus server checks where
> noted) and is independently shippable. Resume with "continue from slice N".

## Purpose

Phase 1 shipped the strict/hybrid foundation plus seven workflows
([Phase-1 spec](./2026-05-30-pi-agent-strict-workflow-expansion-design.md)). Every
source-based workflow shares one **asset source-resolver**, but that resolver only
handles **recency / relative date / media type** — every named-entity or metadata
source ("my **Berlin** photos", "photos **of Alex**", "my **5-star** shots", "my
**Sony** photos") still **hands off** to open orchestration, where smaller models
mis-sequence tools or call them with shapes the server rejects.

This phase does two things:

1. **Phase 0 (the foundational priority): broaden the shared resolver** to resolve
   named-entity / metadata sources — people, places, tags, albums, cameras,
   ratings, favorites, visibility — by calling the **real** `resolveAssetSearchFilters`
   tool with **structured** entity args (never a free-text `query`) and feeding its
   `resolvedFilters` into metadata `searchAssets`. Because **every** source-based
   workflow (`add_photos_to_album`, `archive_assets`, `favorite_assets`,
   `tag_assets`, `create_album_from_source`) shares this one resolver, they ALL gain
   entity sources at once with **zero per-workflow changes** beyond a one-line
   `needs_input` branch.
2. **Phases 1–5: add five new asset/space operation workflows** on the existing
   plan-tool surface — batch metadata edits, remove-from-album, add/remove in a
   space, create-space-from-source, rotate + set-album-cover.

Phase 6 is cross-cutting hardening: extend the disambiguation sweep, full edge
sweep, re-seed L1+L3 baselines, regen the capability matrix, acceptance.

## Current State

- The strict/hybrid **foundation** (registry, manifest-driven LLM classifier with
  a regex fast-path, generic dispatcher, success-gating, durable continuation,
  copy delegation, observability events) is in place. New workflows register into
  it; **no foundation changes are required.**
- The **shared resolver** (`asset-source-resolver.mjs`) resolves recency / date /
  type and returns `{ status:'resolved' | 'empty' | 'handoff' }`. Phase 0 adds a
  **fourth** shape `{ status:'needs_input', text }` and the entity path; the five
  existing callers already branch on `resolution.status`, so each gains a one-line
  `needs_input → protocol.needsInput` mapping.
- The **contract-faithful fake MCP client** (`workflows/contract-fixtures.mjs`)
  enforces the real tool DTO constraints. Several gaps this phase must close are
  catalogued per slice (the resolver's structured-arg shape, `asset.updateMetadata`
  action shape, `space.addAssets/removeAssets` ops, `proposeSpaceFromSearch`,
  `proposeAddAssetsToSpaceFromSearch`, `readAlbum`, `album.setCover`).
- The L1 (component) + L2 (contract-faithful `run()`) + L3 (live, read-only) eval
  harness (`agent-runner/eval/`) is the iteration loop. Every new capability lands
  with L1 recall/slot/negative scenarios and an L3 routing + plan-proposed scenario.

**Hard lesson (carried forward from Phase 1, the `add_photos` recency bug):**
`add_photos_to_album` shipped a source step that called the resolver / metadata
search with shapes the real tools **reject**, and never planned live, because its
fixture ignored call args. **Every fixture in this spec validates call shapes
against the real tool DTOs.** A capability is not "done" until an L3 scenario proves
it proposes a plan against the live server.

## Scope

In scope: the broadened resolver (named-entity + direct-metadata sources), five new
workflows (`update_asset_metadata`, `remove_photos_from_album`, `manage_space_assets`,
`create_space_from_source`, `rotate_assets`, `set_album_cover` — six kinds across
five operation areas), the contract-fixture upgrades each requires, manifest /
capability-matrix regeneration, and L1 + L2 + L3 eval coverage for each.

### Non-Goals

- **No new MCP tools or operation types.** Everything maps to existing plan tools
  (`proposeAssetBatchFromSelection`, `proposeAlbumOperations`,
  `proposeAlbumFromSelection`, `proposeSpaceFromSearch`,
  `proposeAddAssetsToSpaceFromSearch`, `resolveAssetSearchFilters`) and existing
  operation/action types (`asset.updateMetadata`, `asset.rotate`,
  `album.removeAssets`, `album.setCover`, `space.addAssets`, `space.removeAssets`).
- **Place-name → coordinate geocoding stays OUT.** The resolver maps places to the
  `city` **search filter** (not coordinates). The `update_asset_metadata` location
  edit accepts **only explicit numeric `latitude`+`longitude`** — a place name is
  declined and the workflow asks for coordinates. No geocoder anywhere.
- **Subjective / unresolvable sources hand off.** "best", "blurry", "the good ones"
  → handoff. Ambiguous or not-found named entities → `needs_input` (never a guess,
  never an unbounded global search).
- **No apply changes.** All workflows propose reviewable plans only; apply remains
  the existing gated path. Selection handles only — **no raw asset-id lists in
  model-facing args.**

## Flow Ownership

New capabilities and the rows they close:

| Workflow                   | Flow   | Plan tool(s)                                                                                        | Closes capability-matrix row(s)                 |
| -------------------------- | ------ | --------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| _(resolver broadening)_    | —      | `resolveAssetSearchFilters` → metadata `searchAssets`                                               | Named-entity / metadata source resolution (all) |
| `update_asset_metadata`    | Hybrid | `proposeAssetBatchFromSelection` (`asset.updateMetadata`)                                           | Batch asset metadata edits                      |
| `remove_photos_from_album` | Hybrid | `proposeAlbumOperations` (`album.removeAssets`)                                                     | Remove photos from album                        |
| `manage_space_assets`      | Hybrid | `proposeAddAssetsToSpaceFromSearch` (add) / `proposeAlbumOperations` (remove, `space.removeAssets`) | Add/remove photos in a space                    |
| `create_space_from_source` | Hybrid | `proposeSpaceFromSearch` (selectionHandle `assetSource`)                                            | Create space from a source                      |
| `rotate_assets`            | Hybrid | `proposeAssetBatchFromSelection` (`asset.rotate`)                                                   | Rotate assets                                   |
| `set_album_cover`          | Strict | `proposeAlbumOperations` (`album.setCover`)                                                         | Set album cover                                 |

**Registry-ordering / disambiguation decisions** (load-bearing — locked by
`disambiguation.test.mjs` and registry order, first-match-wins):

- **`manage_space_members[members]` vs `manage_space_assets[photos]`** — the
  member workflow DECLINES photo-source captures (`looksLikePhotoSource`); the
  assets workflow REQUIRES a photo source. `manage_space_assets` registers BEFORE
  `add_photos_to_album` (which today mis-matches "… to the Family **space**" and
  resolves to `albumRef:'Family space'`, a silent dead end this phase fixes).
- **remove vs add** — `remove_photos_from_album` and `manage_space_assets[remove]`
  share the verb "remove … from …" with `manage_space_members` (member removal) and
  `favorite_assets` (out-of-favorites). Both registry order (remove workflows AFTER
  those owners) AND an explicit decline gate in each `match()` keep the seam clean.
- **`create_space_from_source` vs `create_album_from_source` vs trip** — discriminated
  by the noun (`space` vs `album`) and verb (`make/create` vs trip's recency/place).
  `create_space_from_source` does NOT import `create_album_from_source`'s `TRIP_LIKE`
  decline (there is no trip-space workflow): trip-like space requests route in and
  the resolver's clean-source gate hands off.
- **`update_asset_metadata` vs `rename_or_describe_album`/`rename_or_describe_space`**
  — both handle "set the description on X to Y". The seam is the X: an album/space
  ref → `rename_*`; a loose-asset/recency ref → `update_asset_metadata` (the
  loose-asset gate is INVERTED vs `rename_*`).

Hard invariants (inherited from the foundation, asserted per workflow): no claimed
plan without a persisted plan id; no direct write tools; **no raw asset-id lists in
model-facing args (selection handles only)**; recoverable tool mistakes retried only
when the correction is mechanical; subjective/unresolvable sources hand off rather
than fabricate; ambiguous/not-found named entities → `needs_input` (never guess).

## Architecture

### Shared asset source-resolver (Phase 0, broadened)

The shared `agent-runner/src/strict-workflows/asset-source-resolver.mjs` turns a
free-text source into a **selection handle** via the real `searchAssets` contract.
Phase 0 broadens it from three deterministic classes to **named-entity + direct
metadata**, splitting sources into three buckets:

- **(a) NAME-LOOKUP entities** (people / tags / albums / cameras) → resolved via the
  real `resolveAssetSearchFilters` tool with **structured** args (never `query`).
  Its `resolvedFilters` (server already maps matched names → ids) merge into the
  metadata `searchAssets.filters`.
- **(b) DIRECT metadata** (places → `city`; ratings → `rating`; favorites →
  `isFavorite`; visibility → `visibility`; type → `type`; date → `takenAfter/Before`)
  → mapped **straight** into `searchAssets.filters` by the resolver. These are NOT
  `resolveAssetSearchFilters` input fields (its request schema has people / tags /
  albums / spaces / cameraMakes / cameraModels / lensModels only) — sending a place
  to the resolver would throw on the `strictObject`.
- **(c) SUBJECTIVE** ("best" / "blurry") → still `handoff` (unchanged).

The resolver gains a **fourth** return shape so ambiguous / not-found entities carry
a clarifying question without inventing a plan tool:

```
resolveAssetSource({ client, sourceDescription, signal })
  -> { status: 'resolved', selectionHandleId, assetCount }
   | { status: 'empty' }                       // resolved filters, zero assets
   | { status: 'needs_input', text }           // NEW: ambiguous / not-found entity
   | { status: 'handoff', reason }             // subjective / unbounded / unresolvable residual
```

**Resolution discipline (never guess).** The resolver inspects
`resolveAssetSearchFilters` `results[].status`: if ANY is `'ambiguous'` (multiple
matches, `choices[]` populated) or `'not_found'`, it returns `needs_input` —
it does NOT blindly trust `resolvedFilters`, because the server may emit an empty /
partial `resolvedFilters` when something was ambiguous/not-found. Only when ALL are
`'matched'` does it proceed to `searchAssets`. This mirrors the
`manage-space-members.mjs` entity-resolution pattern (0 matches → ask, >1 → ask,
exactly 1 → use).

**Clean-source gate (evolved).** Entity tokens (a name after "of/with", a tag after
"tagged", an album after "in the … album", a camera after "shot on/with", a place
after "in/from", a rating like "5-star", "favorites", "archived") are now ACCEPTED
(no longer residual). Truly subjective sources and any un-consumable residual still
hand off. The gate stays CONSERVATIVE and prefers handoff on any unclassifiable
residual — a false handoff just defers to the LLM; a false resolve would be a wrong,
over-broad plan.

### Workflow registry & manifest

Each new workflow is a module under `agent-runner/src/strict-workflows/workflows/`
exporting `{ kind, flow, match, parseSlots, run, resumeContinuation? }`, registered
in the existing registry and added to `WORKFLOW_MANIFEST` (drives the LLM
classifier) and `manifest.generated.json` (drives the capability-matrix table via
`pnpm --dir server sync:agent-capabilities`). `manifest.generated.json` is a
hand-maintained mirror asserted by `manifest.test.mjs`; **forgetting to regenerate
it is the most likely CI break — make it the first red test of each registration
slice.**

### Plan tools per capability (contract-faithfulness principle)

Every workflow's unit fixture **enforces the real tool DTO constraints** (rejects
unknown keys, rejects `query` to the resolver / metadata search, mirrors cross-field
rules), so a call the live server would reject also throws in the test. The mapping
to existing tools (no new tools):

- `update_asset_metadata` → `proposeAssetBatchFromSelection({ action:{ type:'asset.updateMetadata', …flat fields }, selectionHandleId })`.
- `rotate_assets` → `proposeAssetBatchFromSelection({ action:{ type:'asset.rotate', angle }, selectionHandleId })`.
- `remove_photos_from_album` → `proposeAlbumOperations({ operations:[{ type:'album.removeAssets', targetKind:'existing_album', targetId, assetSource:{ kind:'selectionHandle', selectionHandleId } }] })`.
- `manage_space_assets[add]` → `proposeAddAssetsToSpaceFromSearch({ spaceId, assetSource:{ kind:'selectionHandle', selectionHandleId } })`; `[remove]` → `proposeAlbumOperations([{ type:'space.removeAssets', targetKind:'existing_space', targetId, assetSource:{ kind:'selectionHandle', selectionHandleId }, payload:{} }])`.
- `create_space_from_source` → `proposeSpaceFromSearch({ spaceName, assetSource:{ kind:'selectionHandle', selectionHandleId } })` (NO `proposeSpaceFromSelection` exists — the handle is **wrapped** as a `selectionHandle` `assetSource`).
- `set_album_cover` → `proposeAlbumOperations([{ type:'album.setCover', targetKind:'existing_album', targetId, assetIds:[coverId] }])` (cover rides in the asset selection `assetIds`, NOT a payload field).

### L3 live verification (mandatory per capability)

Unit/L2 tests prove the deterministic plumbing; only the live L3 harness proves the
workflow runs against the real Gallery server + runner + model. **A capability is
not "done" until its L3 scenario(s) pass live** (`pnpm --dir agent-runner eval:l3`,
read-only, `approvalMode: plan-only`). The L3 driver reads everything from read-only
endpoints (`strict_router_decision`, `GET …/operation-plan`), the run-wide
`auditNoApply` and `auditGateBlocks` audits must stay clean, and source-based
workflows prefer **recency** sources or the existing `{album}`/`{space}` discovery
tokens (data-independent / discoverable) so plan-proposed assertions don't flake on
a hard-coded name. `proposeSpaceFromSearch`'s selectionHandle `assetSource` is
**schema-valid but not example-documented** in the server contract, so its L3
plan-proposed scenario is **load-bearing** (the only proof the real server
materializes the handle into `space.create` + `space.addAssets`).

## Coverage by eval layer (L1 / L2 / L3)

Every capability is verified at all three layers:

- **L1 — component** (classifier + copy vs the local model, no Gallery): intent
  recall, slot fidelity, precision negatives. The registration slice of each phase
  (Slices 5, 9, 14, 18, 22, 24) plus the disambiguation sweep (Slice 25).
- **L2 — workflow** (`run()` driven against a **contract-faithful fixture MCP
  client**, no DB): exact tool-call sequence, plan-op shape, gating, and the
  `needs_input` / `handoff_open` / `failed` paths and safety guards. The resolver
  Slices 1–4 and **every execution slice** (6, 8, 11, 13, 17, 20, 23). These run via
  `node:test`, but the fixtures enforce the real tool DTO shapes (the `add_photos`
  lesson), so they are L2 in substance.
- **L3 — live** (real Gallery `/agent/*`, read-only, `plan-only`): routing +
  plan-proposed + never-applied against a running stack. Slices 5, 14, 18, 22, 24
  (entity probes via `{album}`/`{space}` discovery and recency sources).

A capability slice is not complete until its **L2** unit tests are green; a phase is
not complete until its **L1** battery is ≥ baseline and its **L3** scenarios pass
live. (No dedicated `l2-workflow.mjs` driver — L2 is per-workflow `node:test`.)

## Test-Driven Development

Conventions for every slice: Node ESM, `node:test` + `node:assert/strict`,
`pnpm --dir agent-runner test` green at the end; server-side changes (manifest
regen) additionally pass `pnpm --dir server check` and `sync:agent-capabilities`.
Write the listed tests **first** (red), then implement (green). Tasks use checkbox
syntax for impl-loop tracking. Slices are numbered **sequentially across phases**
(Slice 1..25).

### Phase 0 — Named-entity source resolver (cross-cutting, the foundation)

The five existing source workflows depend on this; it leads. Slices 1–4 build the
broadened resolver; Slice 5 wires manifests/fixtures/L1/L3 for all five callers.

#### Slice 1: Entity-source detection + clean-gate evolution (pure parser, no tool calls)

- [ ] Add a deterministic `parseEntitySource(source)` pure parser that classifies
      which named-entity / metadata classes a source mentions, and evolve
      `isCleanSource` so entity tokens are ACCEPTED while subjective sources still
      reject. **NO `resolveAssetSearchFilters` call yet** — this slice only
      classifies and gates. Three buckets: (a) NAME-LOOKUP (people "of/with <Name>",
      tags "tagged <Tag>", albums "in the <Album> album", cameras "shot on/with
      <Make/Model>") → resolver-name fields; (b) DIRECT metadata (places "in/from
      <Place>" → `city`; ratings "5-star"/"rated 5" → `rating:5`; favorites "my
      favorites" → `isFavorite:true`; visibility "archived" → `visibility:'archive'`)
      → straight into search filters; (c) subjective ("best"/"blurry") → still
      handoff via `SUBJECTIVE_PATTERN`.

- **Files:** `agent-runner/src/strict-workflows/asset-source-resolver.mjs`,
  `agent-runner/src/strict-workflows/asset-source-resolver.test.mjs`

- **Tests (input → expected):**
  - `parseEntitySource('photos of Alex')` → `{ people:['Alex'] }` (person via "of <Name>")
  - `parseEntitySource('my Berlin photos')` / `('photos from Paris')` → `{ directFilters:{ city:'Berlin' } }` / `{ directFilters:{ city:'Paris' } }` (place is a DIRECT filter, NOT a resolver name field)
  - `parseEntitySource('photos tagged Travel')` / `('my Travel-tagged photos')` → `{ tags:['Travel'] }`
  - `parseEntitySource('photos in the Italy album')` → `{ albums:['Italy'] }`
  - `parseEntitySource('my Sony photos')` / `('shot on Canon')` → `{ cameras:['Sony'] }` / `{ cameras:['Canon'] }`
  - `parseEntitySource('my 5-star photos')` / `('rated 5')` → `{ directFilters:{ rating:5 } }` (NO name lookup)
  - `parseEntitySource('my favorites')` / `('my favorite photos')` → `{ directFilters:{ isFavorite:true } }`
  - `parseEntitySource('my archived photos')` → `{ directFilters:{ visibility:'archive' } }` (lowercase enum)
  - `parseEntitySource('my newest 20 photos')` → `undefined`/empty (no entity; recency-only stays the existing clean path)
  - `parseEntitySource('the best ones')` → `undefined` (subjective handled by `SUBJECTIVE_PATTERN`, NOT an entity)
  - `isCleanSource('my Berlin photos')` → the gate now resolves (entity/direct detected) where it previously handed off; pure-subjective still handoff
  - `isCleanSource('my newest 20 photos')` still TRUE with NO entity (regression guard: recency-only path unchanged, NO `filters` key)

- **Edge cases:**
  - A place token must not swallow a date/type/filler word: `'photos from 2024'` is date (no place), `'my videos'` is type (no entity), `'my photos'` is filler — `parseEntitySource` returns no entity for these.
  - A word that is both filler and a name is resolved at the TOOL layer (Slice 2), not the parser: the parser only proposes candidate name strings; the server decides matched/ambiguous/not_found.
  - `resolverNameList` cap: the parser must not emit > 20 names per kind or a name > 120 chars (truncate/handoff) so the later resolver call cannot violate the `strictObject` caps (`MAX_RESOLVE_FILTER_NAMES_PER_KIND=20`, `MAX_RESOLVE_FILTER_NAME_LENGTH=120`).
  - Subjective + entity ("the best Berlin photos") → `SUBJECTIVE_PATTERN` wins → handoff (never resolve a subjective qualifier even with a place).
  - `rating` must clamp to 1..5 (DTO `z.number().int().min(1).max(5)`); "rated 7" → handoff/ignore, never an out-of-range filter.

- **Eval coverage:** L2 only — all parser/gate cases run as pure `node:test` units in
  `asset-source-resolver.test.mjs` (no client). No L1/L3 yet (no routing change, no
  live tool).

#### Slice 2: Resolve NAME-LOOKUP entities via `resolveAssetSearchFilters` → `searchAssets` handle

- [ ] When `parseEntitySource` detects name-lookup entities (people/tags/albums/
      cameras), call `client.call('resolveAssetSearchFilters', { people?, tags?,
albums?, cameraMakes?/cameraModels?/lensModels? }, { signal })` with
      **structured** args (never `query`), read `results`, then on all-matched merge
      `resolvedFilters` with the existing date/type AND the new direct
      (place/rating/favorite/visibility) filters and call `searchAssets({ mode:'metadata',
order:'desc', limit, filters, detail:'handle' })` for the selection handle.
      Direct-only sources (no name-lookup entity) **skip** `resolveAssetSearchFilters`
      entirely and go straight to `searchAssets`.

- **Files:** `agent-runner/src/strict-workflows/asset-source-resolver.mjs`,
  `agent-runner/src/strict-workflows/asset-source-resolver.test.mjs`,
  `agent-runner/src/strict-workflows/workflows/contract-fixtures.mjs`

- **Tests (input → expected):**
  - `'photos of Alex'` → `resolveAssetSearchFilters` called with `{ people:['Alex'] }` (assert NO `query` key); `resolvedFilters {personIds:['per-1']}` → `searchAssets({ mode:'metadata', order:'desc', limit:1000, filters:{ personIds:['per-1'] }, detail:'handle' })` → resolved handle
  - `'photos tagged Travel'` → `resolveAssetSearchFilters({ tags:['Travel'] })` → filters `{ tagIds:['tag-1'] }` → handle
  - `'photos in the Italy album'` → `resolveAssetSearchFilters({ albums:['Italy'] })` → `{ albumIds:['alb-1'] }` → handle
  - `'my Sony photos'` → `resolveAssetSearchFilters({ cameraMakes:['Sony'] })` → `{ make:'Sony' }` → handle
  - `'photos of Alex from 2024'` → `resolveAssetSearchFilters({ people:['Alex'] })` AND `searchAssets` filters merge `personIds` + `takenAfter`/`takenBefore` (entity + date combine)
  - direct-only `'my 5-star photos'` → NO `resolveAssetSearchFilters` call; `searchAssets` filters `{ rating:5 }` directly
  - direct `'my Berlin photos from last weekend'` → NO resolver call; `searchAssets { city:'Berlin', takenAfter, takenBefore }`
  - direct `'my favorites from last weekend'` → `searchAssets { isFavorite:true, takenAfter, takenBefore }`, no resolver call
  - resolver is called with exactly the entity kinds present (a people-only source does not send empty `tags`/`albums` arrays — `strictObject` + `resolverNameList.min(1)`)
  - `searchAssets` is still NEVER called with a `query` key for any entity source (contract fixture throws if it were)

- **Edge cases:**
  - The resolver passes date as a `searchAssets` filter, NOT as a `resolveAssetSearchFilters` `scope`, to keep one code path; assert date stays in `searchAssets.filters`.
  - Merge precedence: parser-derived direct filters (place/rating/isFavorite/visibility/type/date) MUST union with resolver-returned `resolvedFilters` (personIds/tagIds/…) into ONE filters object; assert no key collision drops a filter.
  - If `resolvedFilters` comes back empty `{}` but `results` all say matched (server omitted), fall back to `results[].id`/`searchFilter`; if neither yields a usable filter → handoff (never an unbounded global search).
  - A search tool error inside `resolveAssetSearchFilters` or `searchAssets` propagates (existing behavior: caller maps to `failed`) — `assert.rejects` on a throwing client.
  - `contract-fixtures.mjs` `resolveAssetSearchFilters` must now (a) enforce the `strictObject` arg shape (reject unknown keys incl. `query`, reject name arrays > 20 or names > 120), and (b) return a configurable `{ resolvedFilters, results }` so matched/ambiguous/not_found are testable. **Open contract question:** the research flags that the fixture today returns `{ resolvedFilters: {} }` and only throws on `'query' in args` — confirm the real `results[]` element shape (`{ kind, query, status, value?, id?, searchFilter?, choices, message }`) before modeling it.

- **Eval coverage:** L2 — entity-resolved happy paths + merge + no-query guards in
  `asset-source-resolver.test.mjs` and the upgraded `contract-fixtures.test.mjs`
  assertions. Sets up L3 in Slice 5.

#### Slice 3: Ambiguity + not-found → `needs_input` (never guess)

- [ ] Inspect `resolveAssetSearchFilters` `results[]`: if ANY result has status
      `'ambiguous'` return `{ status:'needs_input', text }` naming the ambiguous
      query (and `choices` labels); if ANY is `'not_found'` return `{ status:'needs_input',
text }` ("I could not find a `<kind>` called \"`<query>`\""); only when ALL are
      `'matched'` proceed to `searchAssets`. Add `resolveAssetSource`'s 4th return
      shape `{ status:'needs_input', text }` and wire the one-line caller mapping in
      all 5 source workflows (handoff/empty already branch; add a `needs_input` branch
      → `protocol.needsInput`).

- **Files:** `agent-runner/src/strict-workflows/asset-source-resolver.mjs`,
  `agent-runner/src/strict-workflows/asset-source-resolver.test.mjs`,
  `agent-runner/src/strict-workflows/workflows/add-photos-to-album.mjs`,
  `agent-runner/src/strict-workflows/workflows/archive-assets.mjs`,
  `agent-runner/src/strict-workflows/workflows/favorite-assets.mjs`,
  `agent-runner/src/strict-workflows/workflows/tag-assets.mjs`,
  `agent-runner/src/strict-workflows/workflows/create-album-from-source.mjs`,
  `agent-runner/src/strict-workflows/workflows/add-photos-to-album.test.mjs`,
  `agent-runner/src/strict-workflows/workflows/tag-assets.test.mjs`,
  `agent-runner/src/strict-workflows/workflows/create-album-from-source.test.mjs`

- **Tests (input → expected):**
  - `results [{ kind:'person', query:'Alex', status:'ambiguous', choices:[2 items] }]` → `{ status:'needs_input', text:/which.*Alex/i }`; `searchAssets` NOT called
  - `results [{ kind:'tag', query:'Trvel', status:'not_found', choices:[] }]` → `{ status:'needs_input', text:/could not find.*tag.*Trvel/i }`; `searchAssets` NOT called
  - mixed `results` (one matched person, one not_found tag) → `needs_input` (the not_found wins; never partial-resolve)
  - all `'matched'` → proceeds to `searchAssets` → resolved (regression of Slice 2 happy path)
  - `tag-assets run()`: an ambiguous entity source returns `protocol.needs_input` outcome (`status:'needs_input'`), gate never reached, no `proposeAssetBatchFromSelection` call
  - `add-photos run()`: a not_found person source returns `needs_input`, no `proposeAlbumOperations` call
  - `create-album run()`: ambiguous album source returns `needs_input`, no `proposeAlbumFromSelection` call
  - the existing `'empty'` (zero-asset) and `'handoff'` (subjective) caller branches are unchanged (regression)

- **Edge cases:**
  - `needs_input` copy must NOT leak raw ids or full choice payloads — only human labels/values from `results[].choices[].label` (model-facing-arg safety invariant).
  - ambiguous-vs-empty distinction: `'photos of Alex'` that resolves to a real single person with ZERO photos is `empty` (`searchAssets` handle `assetCount 0` → `needs_input` "no photos"), DIFFERENT from `ambiguous` (multiple Alexes). Assert both produce `needs_input` but via different branches/copy.
  - a result with status `'matched'` but missing `id`/`searchFilter` is treated as matched if `resolvedFilters` is populated; if ALL matched yet `resolvedFilters` empty AND no recency bound → handoff (cannot build a search) rather than an unbounded global search.
  - multiple ambiguous queries → a single `needs_input` listing them (don't loop-ask one at a time within one turn).

- **Eval coverage:** L2 — ambiguity/not-found/mixed branches in the resolver test;
  caller-mapping `needs_input` assertions in 3 representative workflow test files
  (tag, add, create-album). No new L1/L3 yet.

#### Slice 4: Entity × recency/date/type/direct combination matrix + over-resolution guards

- [ ] Lock the full combination behavior so entity sources combine correctly with
      the pre-existing recency/date/type and the new direct (place/rating/favorite/
      visibility) parsers, and prove the clean-gate still REFUSES to over-resolve
      when an UNRESOLVED residual remains after consuming entities. This slice
      intentionally FLIPS several existing handoff test expectations to resolved
      (the headline behavior change — call it out and re-baseline).

- **Files:** `agent-runner/src/strict-workflows/asset-source-resolver.mjs`,
  `agent-runner/src/strict-workflows/asset-source-resolver.test.mjs`

- **Tests (input → expected):**
  - `'newest 20 photos of Alex'` → `searchAssets { filters:{ personIds:['per-1'] }, limit:20, order:'desc' }` (recency bounds the entity search)
  - `'my Berlin photos from last weekend'` → `filters { city:'Berlin', takenAfter:'2026-05-09…', takenBefore:'2026-05-10…' }` resolved (NO longer a handoff — the headline win; UPDATE the old handoff case)
  - `'5-star videos from 2024'` → `filters { rating:5, type:'VIDEO', takenAfter, takenBefore }`
  - `'my Sony photos of Alex'` → `resolveAssetSearchFilters({ people:['Alex'], cameraMakes:['Sony'] })` → `filters { personIds, make:'Sony' }` merged
  - `'tagged Travel and favorited'` → `resolveAssetSearchFilters({ tags:['Travel'] })` + direct `{ isFavorite:true }` merged into `filters { tagIds, isFavorite:true }`
  - `'photos of Alex <unclassifiable residual token>'` where a residual survives entity AND date/type/direct parsing → handoff (gate errs toward handoff on un-consumed residual)
  - still-subjective `'the best Berlin photos'` → handoff (`SUBJECTIVE_PATTERN` precedes entity resolution)
  - regression: `'my newest 20 photos'` still sends NO `filters` key (recency-only untouched)

- **Edge cases:**
  - UPDATE the now-stale handoff expectations in `asset-source-resolver.test.mjs` (the `'Berlin photos from last weekend'`, `'newest 20 Berlin photos'`, `'photos of Alex from last week'` cases) — these become RESOLVED; an intentional behavior change the slice must call out and re-baseline.
  - over-resolution guard inverse: an entity that resolves to ALL not_found must NOT fall back to a recency/date-only search of everything — it returns `needs_input` (Slice 3), never a broadened plan.
  - place-vs-person collision (`'photos of Paris'`: Paris person vs city): the parser may emit both a people candidate and a city candidate; define deterministic precedence — try people via the resolver, and if person not_found fall to city; test both branches.
  - limit semantics with entities: no recency count → `limit` stays `MAX_RECENCY_LIMIT` (1000) cap, same as date/type sources.
  - empty merged filters guard: if after all parsing the filters object is empty AND there is no recency bound → handoff (never an unbounded global plan).

- **Eval coverage:** L2 — the full entity × recency × date × type × direct matrix as
  exact-args units; the updated (previously-handoff) cases re-asserted as resolved.
  This slice's green is the resolver's done-gate.

#### Slice 5: Manifest/eval wiring + contract-fixture entity modeling + L1/L3 coverage

- [ ] Make every source workflow advertise the new capability and prove it live. Add
      `'resolveAssetSearchFilters'` to `requiredReadTools` for archive/favorite/tag/
      create_album manifest entries (add_photos already has it) and broaden their
      `classifierDescription`/`positiveExamples` to include entity sources. Upgrade
      `contract-fixtures.mjs` `resolveAssetSearchFilters` to a configurable
      matched/ambiguous/not_found model returning real `{ resolvedFilters, results }`
      shapes (validating the `strictObject` arg + `resolverNameList` caps + rating
      range + visibility enum). Add L1 slot/recall scenarios for entity sources and
      L3 read-only entity probes via existing `{album}`/`{space}` discovery.

- **Files:** `agent-runner/src/strict-workflows/manifest.mjs`,
  `agent-runner/src/strict-workflows/manifest.generated.json`,
  `agent-runner/src/strict-workflows/manifest.test.mjs`,
  `agent-runner/src/strict-workflows/workflows/contract-fixtures.mjs`,
  `agent-runner/src/strict-workflows/workflows/contract-fixtures.test.mjs`,
  `agent-runner/eval/scenarios/slot-fidelity.mjs`,
  `agent-runner/eval/scenarios/classification-recall.mjs`,
  `agent-runner/eval/scenarios/l3-readonly.mjs`

- **Tests (input → expected):**
  - contract-fixtures `resolveAssetSearchFilters` rejects an unknown arg key, a name array of length 21 (`resolverNameList.max 20`), and a name > 120 chars; accepts `{ people:['Alex'] }`
  - contract-fixtures configured with `people:{ Alex:{ status:'matched', resolvedFilters:{ personIds:['per-1'] } } }` returns those; configured ambiguous returns `results[].status 'ambiguous'` with `choices`; default returns not_found
  - contract-fixtures `searchAssets` rejects `rating` out of 1..5 and a non-enum `visibility` (added to `validateSearchAssets`)
  - `manifest.test.mjs`: archive/favorite/tag/create_album entries now include `'resolveAssetSearchFilters'` in `requiredReadTools`; `manifest.generated.json` mirrors (`sync:agent-capabilities` clean)
  - L1 recall: `'archive my Berlin photos'` → `archive_assets`; `'tag photos of Alex as Family'` → `tag_assets`; `'favorite my 5-star shots'` → `favorite_assets`; `'make an album of my Sony photos from May'` → `create_album_from_source`
  - L3 routing (data-independent): `'archive my Berlin photos'` → `{ kind:'archive_assets' }` added to `l3-readonly.mjs` recall block
  - L3 plan-proposed (data-dependent, threshold 0.5): `'tag photos in the {album} album as eval-l3'` → `{ kind:'tag_assets', planProposed:true }` (uses `{album}` discovery so the album resolves; entity path proven live, never applied)

- **Edge cases:**
  - L3 entity plan-proposed must use a DISCOVERABLE entity (`{album}`/`{space}` tokens already wired in the driver) — a hard-coded person/place name may not exist on every instance and would flake; prefer `{album}` for the entity probe and keep recency probes for the others.
  - ambiguity L3 is intentionally NOT asserted plan-proposed (ambiguous → `needs_input` is correct, not a plan); assert routing-only for any deliberately-ambiguous probe.
  - manifest `positiveExamples` must not collide with another workflow's negatives — run `disambiguation.test.mjs` after broadening examples to confirm no cross-match.
  - `sync:agent-capabilities` + `pnpm --dir server check` must stay green after manifest edits (generated matrix block + json mirror).
  - contract-fixtures default behavior change (now models resolution) must not break the EXISTING add_photos/tag tests that relied on `resolveAssetSearchFilters` returning `{ resolvedFilters:{} }` — keep a default-empty mode and opt into entity modeling per-test.

- **Eval coverage:** L1 entity recall + slot fidelity for all 5 source workflows. L2
  contract-fixture entity modeling + manifest tests. L3 routing for an entity source
  on every source workflow + at least one entity plan-proposed via `{album}`
  discovery; no-apply + gate-block audits stay clean.

### Phase 1 — Batch metadata edits (`asset.updateMetadata`)

`update_asset_metadata` (hybrid) is the 4th member of the
`proposeAssetBatchFromSelection` group (mirrors archive/favorite/tag). It sets
description / rating / date-time / timezone / relative date-shift / explicit lat+lng
on a resolver-bound source via `action:{ type:'asset.updateMetadata', … }`. The seam
(verified live): every metadata-edit phrasing routes to `none` today because
`rename_or_describe_album`'s `looksLikeLooseAssetReference` DECLINES any loose-asset
target — album-ref describe → `rename_or_describe_album`; loose-asset describe →
`update_asset_metadata`.

#### Slice 6: Contract fixture — validate the `asset.updateMetadata` action shape

- [ ] Make the contract-faithful fake client reject every malformed
      `asset.updateMetadata` action exactly as the real
      `AgentAssetBatchWorkflowActionSchema` does, so the execution slice's wrong-shape
      calls THROW in L2 (the `add_photos` recency-bug lesson) rather than passing
      silently. `KNOWN_BATCH_ACTION_TYPES` already lists `'asset.updateMetadata'`; only
      `validateBatchAction` needs the branch.

- **Files:** `agent-runner/src/strict-workflows/workflows/contract-fixtures.mjs`,
  `agent-runner/src/strict-workflows/workflows/contract-fixtures.test.mjs`

- **Tests (input → expected):**
  - accepts `{ type:'asset.updateMetadata', description:'Berlin weekend' }` → returns `plan.id 'plan-1'`
  - accepts `{ type:'asset.updateMetadata', description:'' }` (empty string clears) → `plan.id 'plan-1'`
  - accepts `{ type:'asset.updateMetadata', rating:5 }` and `{ rating:null }` → `plan.id 'plan-1'`
  - accepts `{ type:'asset.updateMetadata', latitude:48.8566, longitude:2.3522 }` → `plan.id 'plan-1'`
  - accepts `{ type:'asset.updateMetadata', dateTimeRelative:120 }` → `plan.id 'plan-1'`
  - rejects `{ type:'asset.updateMetadata' }` (no field) → throws `/at least one metadata field/i`
  - rejects `{ …, latitude:48.8 }` (lng missing) → throws `/both latitude and longitude/i`
  - rejects `{ …, longitude:2.3 }` (lat missing) → throws `/both latitude and longitude/i`
  - rejects `{ …, dateTimeOriginal:'2024-01-01T00:00:00.000Z', dateTimeRelative:120 }` → throws `/dateTimeOriginal or dateTimeRelative/i`
  - rejects `{ …, dateTimeRelative:0 }` (sole field no-op) → throws `/no-op|dateTimeRelative/i`
  - rejects `{ …, rating:0 }` and `rating:6` → throws `/rating/i`
  - rejects `{ …, placeName:'Paris' }` (`strictObject` unknown key) → throws `/unknown|placeName/i`
  - `KNOWN_BATCH_ACTION_TYPES.has('asset.updateMetadata')` stays true

- **Edge cases:**
  - `validateBatchAction` must mirror exactly the 4 cross-field rules + per-field bounds (rating int 1..5|null, lat -90..90, lng -180..180, timeZone non-empty IANA, dateTimeRelative int) so no malformed live call slips through L2.
  - `description:''` is VALID (no min length) — assert it does NOT throw (the clear-description path).
  - keep the validator additive: existing setFavorite/setArchive/addTag branches and tests stay green.

- **Eval coverage:** L2 only (contract fixture). This is the guardrail the execution
  slice's L2 tests rely on.

#### Slice 7: `update_asset_metadata` router — match + parseSlots

- [ ] Add `update-asset-metadata.mjs` (kind `update_asset_metadata`, flow `hybrid`)
      with a regex fast-path that extracts (a) the metadata FIELD + VALUE and (b) a
      loose-asset `sourceDescription`. Reuse archive's `declinesSourceFastPath`.
      DECLINE album/space refs (so `rename_*` keep those), subjective/recent-trip
      sources, unsupported fields (title/filename/place-name), and place-name-only
      location prompts (ask for coords at run-time, not here). `parseSlots` normalizes
      LLM slots `{ field, value, sourceDescription }` into a typed payload-fragment +
      source, returning null when no supported field/value or no source.

- **Files:** `agent-runner/src/strict-workflows/workflows/update-asset-metadata.mjs`,
  `agent-runner/src/strict-workflows/workflows/update-asset-metadata.test.mjs`

- **Tests (input → expected):**
  - `match('set the description on my newest 20 photos to Berlin weekend')` → `{ slots:{ field:'description', description:'Berlin weekend', sourceDescription:'my newest 20 photos' } }`
  - `match('rate my newest 12 photos five stars')` → `{ slots:{ field:'rating', rating:5, sourceDescription:'my newest 12 photos' } }` (word-number "five"→5)
  - `match('clear the rating from my newest 20 photos')` → `{ slots:{ field:'rating', rating:null, sourceDescription:'my newest 20 photos' } }`
  - `match('set the description on these photos to "Berlin"')` strips quotes → `description:'Berlin'`
  - `match('set the timezone on my newest 20 photos to Europe/Berlin')` → `{ field:'timeZone', timeZone:'Europe/Berlin', sourceDescription:'my newest 20 photos' }`
  - `match('set my newest 20 photos to latitude 48.8566 and longitude 2.3522')` → `{ field:'location', latitude:48.8566, longitude:2.3522, sourceDescription:'my newest 20 photos' }`
  - `match('set the description on the Family album to Summer')` → `undefined` (album ref declined; `rename_or_describe_album` owns it)
  - `match('set the description on the Trips space to X')` → `undefined` (space ref declined)
  - `match('rename my newest 20 photos to Foo')` → `undefined` (rename is not a metadata field)
  - `match('set the location on these photos to Paris')` → `undefined` (place-name-only; resolver/run asks for coords — no fabricated coordinates)
  - `match('set the title on these photos to Foo')` → `undefined` (unsupported field)
  - `match('set the description on the best photos to X')` → `undefined` (subjective source declined at fast-path)
  - `match('')` → `undefined`
  - `parseSlots({ field:'description', value:'Berlin', sourceDescription:'my newest 20 photos' })` → `{ sourceDescription, payload:{ description:'Berlin' } }`
  - `parseSlots({ field:'rating', value:'5', sourceDescription:'x' }).payload` → `{ rating:5 }`
  - `parseSlots({ field:'rating', value:'clear', sourceDescription:'x' }).payload` → `{ rating:null }`
  - `parseSlots({ latitude:48.8566, sourceDescription:'x' })` → `null` (lng missing; never plan a half-coordinate)
  - `parseSlots({ sourceDescription:'x' })` → `null` (no field/value)
  - `parseSlots({ field:'description', value:'Berlin' })` → `null` (no source)
  - `kind === 'update_asset_metadata'`, `flow === 'hybrid'`, `typeof run === 'function'`

- **Edge cases:**
  - MUST decline any album/space-qualified describe so the regex precedence with `rename_or_describe_album`/`_space` holds (loose-asset gate INVERTED vs rename: require photos/pics/recency/date, reject "album"/"space").
  - place-name location prompts decline at match (no coords) — they fall to open orchestration; only explicit numeric lat+lng are captured.
  - word-number rating ("five stars"/"5 stars"/"5/5") normalizes to 1..5; out-of-range ("zero stars"/"six stars") → `undefined` match (no plan of an invalid rating).
  - "clear/remove the rating" → `rating:null`; "clear/remove the description" → `description:''` (empty-string clear).
  - date phrasings ("set the date on … to June 1998" → `dateTimeOriginal` ISO; "shift … forward by 2 hours" → `dateTimeRelative:+120` minutes; "back by 90 minutes" → -90) are captured but a bare ambiguous date with no parseable value → `needs_input` at run, not a guessed value.
  - strip trailing punctuation from value and source (mirror `cleanSource`).

- **Eval coverage:** L1 slot-fidelity (exact normalized slots: description value
  capture, rating word→int, polarity-free) + L1 classification-recall `slotsSurvive`
  for paraphrases. Disambiguation regex-precedence cases land in Slice 9.

#### Slice 8: `update_asset_metadata` execution — resolver → `asset.updateMetadata` → gate

- [ ] Implement `run()`: resolve the source via `resolveAssetSource` (handoff/empty/
      failed mapping identical to archive), then call `proposeAssetBatchFromSelection`
      with action `{ type:'asset.updateMetadata', …payloadFragment }` and gate on a
      persisted plan id. Success copy frames the change with field-specific phrasing.
      Place-name-without-coords and half-coordinate inputs (defensive) → `needs_input`
      asking for both latitude and longitude. **No raw asset ids ever reach the model.**

- **Files:** `agent-runner/src/strict-workflows/workflows/update-asset-metadata.mjs`,
  `agent-runner/src/strict-workflows/workflows/update-asset-metadata.test.mjs`

- **Tests (input → expected):**
  - plans a batch `asset.updateMetadata` over a recency handle: `action` deepEquals `{ type:'asset.updateMetadata', description:'Berlin weekend' }`, `selectionHandleId === 'handle-1'`, `outcome.status === 'planned'`, `JSON.stringify(calls).includes('assetIds') === false`
  - rating run: `action` deepEquals `{ type:'asset.updateMetadata', rating:5 }`
  - clear-rating run: `action` deepEquals `{ type:'asset.updateMetadata', rating:null }`
  - clear-description run: `action` deepEquals `{ type:'asset.updateMetadata', description:'' }` and does NOT throw in the contract client
  - timezone run: `action` deepEquals `{ type:'asset.updateMetadata', timeZone:'Europe/Berlin' }`
  - location run: `action` deepEquals `{ type:'asset.updateMetadata', latitude:48.8566, longitude:2.3522 }`
  - date-absolute run (June 1998): `action.dateTimeOriginal` is a 1998-06 ISO datetime; relative-shift run (+2h): `action.dateTimeRelative === 120`
  - date source (`'from 2024'`) still resolves via the shared resolver as the SOURCE (filters `takenAfter`/`Before`) while the metadata FIELD is applied — assert `searchAssets.filters` present AND `action` carries the field
  - success copy frames before/after: `outcome.text` matches `/set the description|rating|timezone|location|date/` and includes the value
  - hands off a subjective source (`'the best ones'`) without calling `proposeAssetBatchFromSelection` → `status 'handoff_open'`
  - `needs_input` when the source resolves to zero assets (`handleAssetCount:0`) — no propose call
  - `needs_input` asking for both latitude and longitude when only latitude is in slots (defensive)
  - gate: `planResult { status:'success', plan:{} }` → `status 'failed'` and text has NO success language (`/prepared|set the/` is false)
  - fails when `searchAssets` throws (resolver error → failed)
  - fails when `proposeAssetBatchFromSelection` throws → failed with `safeFailureText`
  - singular/plural copy: `assetCount === 1` → "photo", else "photos"

- **Edge cases:**
  - the action is FLAT (type + fields siblings) — a nested `{ type, payload:{} }` shape would throw in the Slice-6 contract client; the test asserts deepEqual on the flat shape.
  - never plan a half-coordinate or an empty payload — both must be caught before propose (defensive `needs_input` / `parseSlots` null).
  - map resolver `'empty'` → `needs_input` (describe-differently) and `'handoff'` → `handoff_open`, exactly like archive/favorite/tag.
  - `summary` string passed to the tool is field-appropriate ("Set photo description." etc.); `successSummary` carries `{ workflowKind:KIND, assetCount, target:<field> }`.

- **Eval coverage:** L2 (run against `makeContractClient` — proves the live-faithful
  call shape, the gate, and the no-raw-ids invariant). Feeds L3 plan-proposed in
  Slice 9.

#### Slice 9: `update_asset_metadata` registration + manifest + L1/L3 eval

- [ ] Register `updateAssetMetadataWorkflow` in `registry.mjs` AFTER
      `rename_or_describe_space`/`rename_or_describe_album` (so album/space describe
      wins their refs) and after the other batch workflows. Add the manifest entry
      (+ regenerate `manifest.generated.json`), the disambiguation precedence cases,
      and the L1/L3 eval scenarios.

- **Files:** `agent-runner/src/strict-workflows/registry.mjs`,
  `agent-runner/src/strict-workflows/manifest.mjs`,
  `agent-runner/src/strict-workflows/manifest.generated.json`,
  `agent-runner/src/strict-workflows/manifest.test.mjs`,
  `agent-runner/src/strict-workflows/disambiguation.test.mjs`,
  `agent-runner/eval/scenarios/slot-fidelity.mjs`,
  `agent-runner/eval/scenarios/classification-recall.mjs`,
  `agent-runner/eval/scenarios/classification-negatives.mjs`,
  `agent-runner/eval/scenarios/l3-readonly.mjs`,
  `agent-runner/eval/baseline.l3.json`

- **Tests (input → expected):**
  - `manifest.test.mjs`: `getWorkflowManifestEntry('update_asset_metadata')` has `flow:'hybrid'`, `planTool:'proposeAssetBatchFromSelection'`, `requiredReadTools:['searchAssets']`, non-empty positive/negative examples, `matrixRow.capability`
  - `manifest.test.mjs` JSON-mirror assert (`manifest.generated.json` deepEquals `WORKFLOW_MANIFEST`) stays green after regen
  - disambiguation: `'set the description on my newest 20 photos to Berlin'` → `'update_asset_metadata'`
  - disambiguation: `'rate my newest 12 photos five stars'` → `'update_asset_metadata'`
  - disambiguation: `'set the timezone on my newest 20 photos to Europe/Berlin'` → `'update_asset_metadata'`
  - disambiguation: `'set the description on the Family album to Summer 2026'` STILL → `'rename_or_describe_album'` (precedence preserved)
  - disambiguation: `'set the description on the Trips space to X'` STILL → `'rename_or_describe_space'`
  - disambiguation: `'set these photos to Paris'` (place-name only) → `'none'` (no fabricated coords)
  - disambiguation "exercises every registered kind" test now includes an `update_asset_metadata` case
  - L1 slot-fidelity: `'set the description on my newest 20 photos to Berlin weekend'` → exact slots; `'rate my newest 12 photos five stars'` → `rating 5` slot
  - L1 classification-recall: paraphrases ("add a caption … to …", "give my newest 20 photos five stars", "put a timestamp of June 1998 on …") route to `update_asset_metadata` with `slotsSurvive:true`
  - L1 negatives: `'set these photos to Paris'` → none; `'change the filename on these photos'` → none; `'set the description on the Family album to X'` → `rename_or_describe_album` (NOT `update_asset_metadata`)
  - L3 `l3.recall.metadata.describe` (`'set the description on my newest 20 photos to eval-l3'`) → kind `update_asset_metadata`
  - L3 `l3.plan.metadata.recency` (`'rate my newest 10 photos five stars'`) → kind `update_asset_metadata`, `planProposed:true`, threshold 0.5

- **Edge cases:**
  - registry ORDER: place after `rename_or_describe_space` and `rename_or_describe_album` (they decline loose-asset refs, the new workflow declines album/space refs — mutually exclusive, but order documents the intent and the disambiguation table locks it).
  - manifest `negativeExamples` must include an album-describe ("Set the description on the Family album to Summer") and a place-name location ("Set these photos to Paris") so the LLM classifier learns the boundary.
  - L3 plan scenario must use a non-destructive idempotent edit (a rating or a distinctive description) so repeated eval runs against the personal/seeded library stay safe — proposed, never applied.
  - update README capability matrix row "Batch asset metadata edits" if the eval README tracks it (mirror tag/archive rows).
  - `baseline.l3.json` updated with the new scenario scores.

- **Eval coverage:** L1 (classification-recall `slotsSurvive` + slot-fidelity exact
  slots + classification-negatives precision incl. the album/space/place-name
  boundaries) and L3 (`l3.recall.*` routing + `l3.plan.*` plan-proposed against a
  real library). Disambiguation regex-precedence is the unit-level regression lock.

### Phase 2 — Remove photos from album (`album.removeAssets`)

`remove_photos_from_album` (hybrid) is the inverse of `add_photos_to_album`: resolve
the existing album (`listAlbums`), resolve the free-text source into a SELECTION
HANDLE via the shared resolver, then `proposeAlbumOperations([album.removeAssets])`
over that handle, gated. **Never proposes an empty removal** (zero-asset → needs_input).
`removeAssets` MUST target `existing_album` + `targetId` (the DTO rejects `new_album`).

#### Slice 10: `remove_photos_from_album` router — match + parseSlots, gated against "remove … from …" collisions

- [ ] Add `remove-photos-from-album.mjs` exporting `removePhotosFromAlbumWorkflow()`
      with kind `remove_photos_from_album`, flow `hybrid`, and a `match()`/`parseSlots()`
      that extract `{ albumRef, sourceDescription }` from "remove/take `<source>`
      from/out of `<album>`". NOT registered yet (router-only slice). The router is
      GATED: it only owns a removal when the target is album-like, and DECLINES the
      three competing "remove … from …" intents — space-member removal
      (`manage_space_members`), out-of-favorites (`favorite_assets`), and tag removal
      (owned by nothing → none/handoff) — plus subjective/recent-trip sources.

- **Files:** `agent-runner/src/strict-workflows/workflows/remove-photos-from-album.mjs`,
  `agent-runner/src/strict-workflows/workflows/remove-photos-from-album.test.mjs` (router-only describe block)

- **Tests (input → expected):**
  - `match('remove my newest 20 photos from Family')` → `{ slots:{ albumRef:'Family', sourceDescription:'my newest 20 photos' } }`
  - `match('take my newest 20 photos out of the Family album')` → `{ albumRef:'Family', sourceDescription:'my newest 20 photos' }` (normalizeAlbumRef strips trailing " album" and leading the/my/this/that)
  - `match('remove my photos from 2024 from the Trips album')` → `{ albumRef:'Trips', sourceDescription:'my photos from 2024' }` (non-greedy source up to the FINAL " from <album>")
  - `match('remove Bob from the Family space')` → `undefined` (DECLINE: "space" keyword → owned by `manage_space_members`)
  - `match('remove my newest 20 from my favorites')` → `undefined` (DECLINE: "favorites" tail → owned by `favorite_assets`)
  - `match('remove the Travel tag from my newest 20')` → `undefined` (DECLINE: "tag" phrasing — tag removal owned by nothing)
  - `match('remove the best ones from Family')` → `undefined` (DECLINE via `SUBJECTIVE_PATTERN` on source)
  - `match('remove my recent trip photos from Family')` → `undefined` (DECLINE: recent-trip source)
  - `match('how many photos are in Family?')` → `undefined` (no remove/from verb)
  - `parseSlots({ albumRef:'the Family album', sourceDescription:'my newest 20 photos' })` → `{ albumRef:'Family', sourceDescription:'my newest 20 photos' }`
  - `parseSlots({ albumRef:'', sourceDescription:'newest 10' })` → `null`; `parseSlots({ albumRef:'Family', sourceDescription:'' })` → `null`

- **Edge cases:**
  - "remove … from …" verb is shared by 3 other workflows — the gate is the whole point. Decline when the album slot mentions "space", when the tail is "favorites"/"favourites", and when the source is a "tag"/"… tag" phrasing.
  - Registry order will place this workflow AFTER `favorite_assets`, `tag_assets`, and `manage_space_members` (defense in depth) — but the decline gate must still pass in isolation (router-only tests run `match()` directly).
  - "take … out of …" is a second surface verb; support both REMOVE_FROM and TAKE_OUT_OF patterns, each capturing source non-greedily up to the final album ref.
  - Source is the EXTRACTED source (verb stripped) — keep `cleanSource` trailing-punctuation strip.
  - Do NOT resolve here — `match` only extracts; resolution happens in `run()` (Slice 11).

- **Eval coverage:** No live eval yet (router-only). L2 unit coverage = the
  match/parseSlots tests above. Sets up L1/L3 in Slice 12.

#### Slice 11: `remove_photos_from_album` execution — album resolve → resolveAssetSource → `album.removeAssets`, gated; never an empty removal

- [ ] Implement `run({ client, slots, signal })` as the exact inverse of
      `add-photos-to-album.mjs`: (1) `resolveAlbum` via `listAlbums` + case-insensitive
      name match (none/>1 → needs_input). (2) `resolveAssetSource(sourceDescription)`
      — handoff → handoffOpen, **empty → needs_input (SAFETY: zero assets must NEVER
      propose an empty removal)**, resolved → handle. (3) `proposeAlbumOperations` with
      one op `{ type:'album.removeAssets', summary, targetKind:'existing_album',
targetId:album.id, assetSource:{ kind:'selectionHandle', selectionHandleId } }`
      (NO payload). (4) `gatePlanResult`. Drive all tests against `makeContractClient`.

- **Files:** `agent-runner/src/strict-workflows/workflows/remove-photos-from-album.mjs`,
  `agent-runner/src/strict-workflows/workflows/remove-photos-from-album.test.mjs` (run() describe block)

- **Tests (input → expected):**
  - `run({ client: makeContractClient(), slots:{ albumRef:'Family', sourceDescription:'my newest 20 photos' } })` → status `'planned'`; `searchAssets` called with `mode:'metadata'`, `order:'desc'`, `limit:20`, `query:undefined`; `proposeAlbumOperations operations[0] === { type:'album.removeAssets', targetKind:'existing_album', targetId:'alb-1', assetSource:{ kind:'selectionHandle', selectionHandleId:'handle-1' } }`; `JSON.stringify(client.calls).includes('assetIds') === false`; `resolveAssetSearchFilters` NOT called (recency source)
  - date source `'my photos from 2024'` → planned; `searchAssets.filters === { takenAfter:'2024-01-01T00:00:00.000Z', takenBefore:'2024-12-31T23:59:59.999Z' }`; op type still `'album.removeAssets'`
  - media-type source `'my videos from 2024'` → planned; `searchAssets.filters` includes `type:'VIDEO'`
  - `makeContractClient({ handleAssetCount: 0 })`, source `'newest 10 photos'` → status `'needs_input'` AND `proposeAlbumOperations` NOT called (SAFETY: no empty removal)
  - `makeContractClient({ albums: [] })`, albumRef `'Nope'` → status `'needs_input'` (album not found), NO `searchAssets`/`proposeAlbumOperations` call
  - two 'Family' albums in config → status `'needs_input'` (ambiguous album), no propose
  - qualified/unbounded source `'newest pics'` → status `'handoff_open'`; neither `searchAssets` nor `proposeAlbumOperations` called
  - subjective source `'the good ones'` → status `'handoff_open'`; `proposeAlbumOperations` NOT called
  - `searchAssets` throws → status `'failed'` with `safeFailureText`
  - `proposeAlbumOperations` returns `{ status:'error' }` → status `'failed'` (gatePlanResult), no "planned" copy
  - success copy asserts assetCount + albumName: `successSummary === { workflowKind:'remove_photos_from_album', albumName:'Family', assetCount:20 }` and text mentions "remove" + "20" + "Family" (no "add")

- **Edge cases:**
  - EMPTY-REMOVAL SAFETY is the headline invariant: `resolution.status === 'empty'` → needs_input, propose NOT called. Stronger guard than add-photos (removing nothing is a silent no-op the user would not catch).
  - `targetKind` MUST be `'existing_album'` with `targetId` — the DTO rejects `NewAlbum` for removeAssets. Never emit `temporaryTargetId` (assert the op has no `temporaryTargetId` key).
  - No payload key on the op (`emptyPayload` optional) — mirror add-photos which omits it.
  - Singular/plural copy: `assetCount === 1 ? 'photo' : 'photos'`.
  - A thrown `searchAssets`/propose error → failed (not handoff); a clean handoff reason → handoff_open. Keep the two error channels distinct.

- **Eval coverage:** L2 (component) — a wrong-shape op (e.g. accidental `'new_album'`
  targetKind, or a stray query) THROWS in unit tests, not only live. No L1/L3 yet (not
  registered).

#### Slice 12: `remove_photos_from_album` registration + manifest + disambiguation + L1/L3 eval

- [ ] Register the workflow AFTER `favorite_assets`, `tag_assets`,
      `manage_space_members` (so those win their "remove … from …" phrasings), just
      before `add_photos_to_album`. Add a `manifest.mjs` entry (+ regenerate
      `manifest.generated.json`). Extend `disambiguation.test.mjs`, classification-recall/
      negatives, slot-fidelity, and `l3-readonly.mjs`.

- **Files:** `agent-runner/src/strict-workflows/registry.mjs`,
  `agent-runner/src/strict-workflows/manifest.mjs`,
  `agent-runner/src/strict-workflows/manifest.generated.json`,
  `agent-runner/src/strict-workflows/manifest.test.mjs`,
  `agent-runner/src/strict-workflows/disambiguation.test.mjs`,
  `agent-runner/eval/scenarios/classification-recall.mjs`,
  `agent-runner/eval/scenarios/classification-negatives.mjs`,
  `agent-runner/eval/scenarios/slot-fidelity.mjs`,
  `agent-runner/eval/scenarios/l3-readonly.mjs`,
  `agent-runner/eval/baseline.l3.json`

- **Tests (input → expected):**
  - disambiguation CASES add: `['remove my newest 20 photos from Family','remove_photos_from_album']`, `['take my newest 20 photos out of the Family album','remove_photos_from_album']`, `['remove my Berlin photos from last weekend from the Trips album','remove_photos_from_album']`
  - disambiguation collision guards: `['remove Bob from the Family space','manage_space_members']`, `['remove my newest 20 from my favorites','favorite_assets']`, `['remove the Travel tag from my newest 20','none']` — MUST stay with their owners (proving registry order + decline gate)
  - disambiguation "exercises every registered workflow kind" test now requires a `remove_photos_from_album` case
  - `manifest.test.mjs`: `getWorkflowManifestEntry('remove_photos_from_album')` has `flow:'hybrid'`, `planTool:'proposeAlbumOperations'`, `requiredReadTools:['listAlbums','searchAssets']`, `supportsContinuation:false`, `matrixRow.capability` set; mirror-JSON deepEqual still passes after regen
  - classification-recall: `recall.remove.canonical` `'remove my newest 20 photos from Family'` → `{ kind:'remove_photos_from_album', slotsSurvive:true, slots:{ albumRef:'Family' } }`; `recall.remove.takeout` `'take my newest 20 photos out of the Family album'` → same kind slotsSurvive; `recall.remove.llm` `'pull my 2024 photos out of the Trips album'` → `{ kind:'remove_photos_from_album' }` (forces LLM path)
  - classification-negatives: `'remove the Travel tag from my newest 20'` stays `{ kind:'none' }`; `'remove the best ones from Family'` → `{ kind:'none' }`
  - slot-fidelity: `'remove my newest 5 photos from Family'` → `{ kind:'remove_photos_from_album', slots:{ albumRef:'Family', sourceDescription:'my newest 5 photos' } }`
  - L3 routing: `l3.recall.remove` `'remove my newest 20 photos from {album}'` → `{ kind:'remove_photos_from_album' }`
  - L3 plan-proposed: `l3.plan.remove.recency` `'remove my newest 20 photos from {album}'` → `{ kind:'remove_photos_from_album', planProposed:true, threshold:0.5 }` (recency handle → `album.removeAssets` plan, proposed never applied)

- **Edge cases:**
  - Registry placement is load-bearing: `remove_photos_from_album` AFTER `manage_space_members`/`favorite_assets`/`tag_assets`; `add_photos_to_album` stays LAST. Add a comment block mirroring the existing order-rationale comment.
  - `manifest.generated.json` MUST be regenerated in lockstep or the mirror check fails (generated file — do not hand-edit divergently).
  - manifest `positiveExamples` ("Remove my screenshots from the Family album" — screenshots is itself a handoff source at run-time, but L1 only observes routing), `negativeExamples` ("Remove the Travel tag from my newest 20", "Remove Bob from the Family space", "Add my newest 20 photos to Family") to teach the classifier the boundaries.
  - `l3.plan.remove.recency` is data-dependent (needs a real album with removable matching assets) — threshold 0.5; on an empty/personal stack it may legitimately not propose (missing-data, not a regression).
  - `requiredReadTools` listed as `['listAlbums','searchAssets']` — NOT `resolveAssetSearchFilters` (the resolver path uses it only when an entity source is present; the add-photos manifest lists it, but list only the tools this workflow's router/run guarantees). **Open question:** after Phase 0, recency-only removals never call `resolveAssetSearchFilters` but entity-source removals do — decide whether `requiredReadTools` advertises the conditional tool. Recommended: include it once Phase 0 lands (entity sources reach this workflow via the shared resolver).

- **Eval coverage:** L1 (classification-recall canonical + take-out + LLM paraphrase
  slotsSurvive; classification-negatives tag-removal + subjective decline;
  slot-fidelity exact albumRef+sourceDescription). L2 (disambiguation regex-precedence
  - manifest parity). L3 (`l3.recall.remove` routing + `l3.plan.remove.recency`
    plan-proposed end-to-end, threshold 0.5).

### Phase 3 — Add/remove photos in a space

`manage_space_assets` (hybrid) adds or removes PHOTOS in a shared space (not members).
`manage_space_members` DECLINES photo-source captures precisely so this workflow can
own them. **CRITICAL ROUTING GAP (confirmed live):** today `add_photos_to_album`
(registered LAST) matches "add my newest 20 photos to the Family space" and yields
`albumRef:'Family space'` — a silent dead end (no album literally named "Family
space") this workflow fixes by stealing the "… `<space>` space" phrasing ahead of
`add_photos_to_album`. ADD goes through `proposeAddAssetsToSpaceFromSearch`; REMOVE
has NO dedicated proposer and goes through `proposeAlbumOperations` with a
`space.removeAssets` op.

#### Slice 13: `manage_space_assets` router + slots (gated on space-keyword AND photo-source)

- [ ] `manage_space_assets.match()` steals ONLY "add/remove `<photo-source>` to/from
      the `<space>` space" (requires BOTH the space keyword AND a photo-ish source),
      declining member adds, album adds, and subjective/trip sources. `parseSlots`
      normalizes `action` + `spaceRef` + `sourceDescription`. New module exports the
      workflow factory (router half); `run()` lands in Slice 14.

- **Files:** `agent-runner/src/strict-workflows/workflows/manage-space-assets.mjs` (new),
  `agent-runner/src/strict-workflows/workflows/manage-space-assets.test.mjs` (new)

- **Tests (input → expected):**
  - `match('add my newest 20 photos to the Family space')` → `{ slots:{ action:'add', spaceRef:'Family', sourceDescription:'my newest 20 photos' } }`
  - `match('remove my screenshots from the Family space')` → `{ slots:{ action:'remove', spaceRef:'Family', sourceDescription:'my screenshots' } }`
  - `match('add my photos from 2024 to the Trips space')` → `{ action:'add', spaceRef:'Trips', sourceDescription:'my photos from 2024' }`
  - `match('add Alex to the Family space')` → `undefined` (member add — `looksLikePhotoSource` false on a bare name)
  - `match('add Alex and Sam to the Family space')` → `undefined` (members)
  - `match('add my newest 20 photos to Family')` → `undefined` (no "space" keyword — stays `add_photos_to_album`)
  - `match('add my newest 20 photos to the Trips album')` → `undefined` (album keyword, not space)
  - `match('archive my newest 50 photos')` → `undefined` (no space target)
  - `match('remove my screenshots from Family')` → `undefined` (no "space" keyword)
  - `match('')` → `undefined`
  - `match('add the best photos to the Family space')` → `undefined` (subjective source declined at fast-path)
  - `parseSlots({ action:'add', spaceRef:'the Family space', sourceDescription:'my newest 20 photos' })` → `{ action:'add', spaceRef:'Family', sourceDescription:'my newest 20 photos' }` (normalizeSpaceRef strips article + trailing space noun)
  - `parseSlots({ action:'remove', spaceRef:'Family', sourceDescription:'  ' })` → `null` (empty source)
  - `parseSlots({ spaceRef:'Family', sourceDescription:'my newest 20 photos' }, 'add my newest 20 photos to the Family space')` → action inferred `'add'` from verb
  - `parseSlots({ action:'frobnicate', spaceRef:'Family', sourceDescription:'x' })` → `null`
  - `parseSlots({ action:'add', sourceDescription:'my newest 20 photos' })` → `null` (no spaceRef)
  - `wf.kind === 'manage_space_assets'`, `wf.flow === 'hybrid'`, `typeof wf.run === 'function'`

- **Edge cases:**
  - Gate must require BOTH space keyword AND a photo-source so it never overlaps `manage_space_members` (members) or `change_member_role` (role word). Use the SAME photo-source family as `manage-space-members.mjs` but as a REQUIRE, not a decline.
  - "screenshots" is a photo-source token for the ROUTER gate but the RESOLVER hands it off (it is not a clean recency/date/type token) — Slice 14 covers that handoff. The router must still MATCH "remove my screenshots …" so the right workflow gets to hand off (vs add_photos mis-routing).
  - ADD_PATTERN/REMOVE_PATTERN must capture the source non-greedily up to "to/from the `<space>` space" and not swallow the "space" noun into `spaceRef` (normalizeSpaceRef trailing-strip handles it).
  - Decline subjective + "recent trip" sources at the fast-path so they flow to the trip workflow / open handling.
  - `parseSlots` does NOT re-apply the space-keyword gate (classifier already chose this kind).

- **Eval coverage:** L2 only in this slice (router unit tests). Sets up L1
  slot-fidelity + classification-recall entries in Slice 14.

#### Slice 14: `manage_space_assets` execution + contract-fixtures additions + registration + L1/L3

- [ ] `run()` resolves the space via `listSpaces` (none/ambiguous → needs_input),
      resolves the source via the shared resolver (handoff/empty), then for ADD calls
      `proposeAddAssetsToSpaceFromSearch({ spaceId, assetSource:{ kind:'selectionHandle',
selectionHandleId } })` and for REMOVE calls `proposeAlbumOperations` with one
      `space.removeAssets` op, gating on a persisted plan id. Extends contract-fixtures
      to validate `space.addAssets`/`space.removeAssets` ops AND add a
      `proposeAddAssetsToSpaceFromSearch` handler so a wrong-shape call THROWS in L2.
      Register `manage_space_assets` BEFORE `add_photos_to_album` (and after
      `manage_space_members`/`change_member_role`), add the manifest entry + regen, and
      land the L1/L3 scenarios (UPDATING the stale disambiguation:20 and
      `l3.neg.space.add-photos` assertions). **This is a large slice; it may be split
      execution-first / registration-second if it grows too big in a single loop.**

- **Files:** `agent-runner/src/strict-workflows/workflows/manage-space-assets.mjs`,
  `agent-runner/src/strict-workflows/workflows/manage-space-assets.test.mjs`,
  `agent-runner/src/strict-workflows/workflows/contract-fixtures.mjs`,
  `agent-runner/src/strict-workflows/workflows/contract-fixtures.test.mjs`,
  `agent-runner/src/strict-workflows/registry.mjs`,
  `agent-runner/src/strict-workflows/manifest.mjs`,
  `agent-runner/src/strict-workflows/manifest.generated.json`,
  `agent-runner/src/strict-workflows/manifest.test.mjs`,
  `agent-runner/src/strict-workflows/disambiguation.test.mjs`,
  `agent-runner/eval/scenarios/classification-recall.mjs`,
  `agent-runner/eval/scenarios/classification-negatives.mjs`,
  `agent-runner/eval/scenarios/slot-fidelity.mjs`,
  `agent-runner/eval/scenarios/l3-readonly.mjs`,
  `agent-runner/eval/baseline.l3.json`

- **Tests (input → expected):**
  - ADD `run({ slots:{ action:'add', spaceRef:'Family', sourceDescription:'my newest 20 photos' } })` → status `'planned'`; a `proposeAddAssetsToSpaceFromSearch` call with `args.spaceId === 'spc-1'`, `args.spaceName === undefined` (exactly-one rule), `args.assetSource === { kind:'selectionHandle', selectionHandleId:'handle-1' }`; `JSON.stringify(calls)` does NOT include `'assetIds'` and does NOT include the raw space name in a `spaceName` field
  - ADD `searchAssets` is metadata-mode, order desc, limit 20, NO query (`search.args.query === undefined`)
  - REMOVE `run({ slots:{ action:'remove', spaceRef:'Family', sourceDescription:'my photos from 2024' } })` → `'planned'`; `proposeAlbumOperations` op deepEquals `{ type:'space.removeAssets', summary:<string>, targetKind:'existing_space', targetId:'spc-1', assetSource:{ kind:'selectionHandle', selectionHandleId:'handle-1' }, payload:{} }`
  - REMOVE date source → `searchAssets.filters { takenAfter:'2024-01-01T00:00:00.000Z', takenBefore:'2024-12-31T23:59:59.999Z' }`
  - handoff: `run({ sourceDescription:'my screenshots' })` → `'handoff_open'` and NO propose call (screenshots is an unresolvable residual)
  - handoff: subjective `'the best ones'` → `'handoff_open'`, no propose
  - empty: `makeContractClient({ handleAssetCount:0 })`; ADD → `'needs_input'`, no propose
  - space unknown: `run({ spaceRef:'Nope' })` → `'needs_input'`, no `searchAssets`, no propose
  - space ambiguous: two spaces named 'Family' → `'needs_input'`, no propose
  - gate: `planResult { status:'success', plan:{} }` → `'failed'` and `!/prepared/i.test(text)` for BOTH add and remove
  - fails when `listSpaces` throws → `'failed'`; `searchAssets` throws → `'failed'`; propose tool throws → `'failed'`
  - contract-fixtures: `proposeAddAssetsToSpaceFromSearch` rejects when BOTH `spaceId` and `spaceName` present (exactly-one), rejects missing `assetSource`, accepts `{ spaceId, assetSource }` → `{ plan:{ id:'plan-1' } }`
  - contract-fixtures: `proposeAlbumOperations` now validates a `space.removeAssets` op — rejects `targetKind !== 'existing_space'`, rejects missing `targetId`, rejects a non-empty payload, accepts the valid op
  - disambiguation: `'add my newest 20 photos to the Family space'` → `'manage_space_assets'` (CHANGE the existing case that asserts `'add_photos_to_album'`)
  - disambiguation: `'remove my screenshots from the Family space'` → `'manage_space_assets'`
  - disambiguation UNCHANGED: `'add my newest 20 photos to Family'` → `'add_photos_to_album'`; `'add my newest 20 photos to the Trips album'` → `'add_photos_to_album'`; `'add Alex to the Family space'` → `'manage_space_members'`
  - disambiguation "exercises every registered workflow kind" now requires a `manage_space_assets` case
  - manifest: entry kind `'manage_space_assets'`, `flow:'hybrid'`, `planTool` present, `requiredReadTools` includes `'listSpaces'` and `'searchAssets'`; `manifest.generated.json` mirrors
  - L1 classification-recall: `'add my newest 20 photos to the {space} space'` / `'put my newest 20 photos into the Family space'` → `{ kind:'manage_space_assets', slotsSurvive:true }`; `'take my newest 20 photos out of the Family space'` → `manage_space_assets`
  - L1 slot-fidelity: `'remove my newest 20 photos from the Family space'` → `{ kind:'manage_space_assets', slots:{ action:'remove', spaceRef:'Family', sourceDescription:'my newest 20 photos' } }`
  - L1 classification-negatives: `'add Alex to the Family space'` must NOT classify as `manage_space_assets` (stays `manage_space_members`)
  - L3 routing: `l3.recall.space.add-photos` `'add my newest 20 photos to the {space} space'` → kind `manage_space_assets` (REPLACES `l3.neg.space.add-photos` which currently allows `anyKind:['none','add_photos_to_album']`)
  - L3 plan-proposed: `l3.plan.space.add` `'add my newest 20 photos to the {space} space'` → `{ kind:'manage_space_assets', planProposed:true, threshold:0.5 }` (gated on a real space the user is an Editor of)

- **Edge cases:**
  - ADD must pass `spaceId` ONLY (never `spaceName`) so the exactly-one superRefine passes; the Editor-role check happens server-side regardless.
  - ADD gate MUST set `planTool:'proposeAddAssetsToSpaceFromSearch'` so failure copy names the right tool; REMOVE uses the default `proposeAlbumOperations`.
  - `payload` MUST be `{}` (`emptyPayload` is `strictObject({})`); contract-fixtures must reject any non-empty payload.
  - Server requires Editor role (`validateExistingSpaceRoleAccess`) — the runner has NO role info from `listSpaces` (summary has no member/role), so it cannot pre-guard; a non-editor surfaces as a server error → `gatePlanResult` maps to `'failed'` (acceptable: server is the authority). Add a test that a propose throw → `'failed'`.
  - handleAssetCount default 20 in fixtures means an unbounded/handoff source must short-circuit BEFORE `searchAssets` when the resolver hands off — assert no `searchAssets` for subjective AND for "my screenshots" (clean-source gate runs before the search).
  - Registry insertion point: place `manage_space_assets` immediately BEFORE `addPhotosToAlbumWorkflow` and update the order-rationale comment to explain members(people)/assets(photos)/album precedence.
  - The `l3.neg.space.add-photos` negative and its comment ("Adding photos to a space is unsupported") are now STALE — flip it to a positive recall+plan scenario.
  - L3 plan scenario: on personal (single-user owner), the user is an Editor of their own spaces, so plan-proposed can hold unconditionally — confirm against `config.l3.seeded` usage before hardcoding.
  - **Open contract question (from research):** verify the `proposeAddAssetsToSpaceFromSearch` request accepts a `selectionHandle` `assetSource` (it IS `agentOperationPlanningAssetSourceInput`, so it should) and that the server's exactly-one `spaceId`/`spaceName` rule is `Boolean(spaceId) === Boolean(spaceName)` (both → fail, neither → fail).

- **Eval coverage:** L1 (classification-recall add+remove paraphrases slotsSurvive,
  slot-fidelity exact normalized slots, classification-negatives member-add stays
  members). L2 (full execution battery + contract-fixtures validators that make a
  wrong-shape space-asset call throw; disambiguation regex-precedence updated +
  manifest parity). L3 (routing add-to-space → `manage_space_assets`; plan-proposed
  add newest N to a real space → persisted plan, never applied).

### Phase 4 — Create space from a source (`proposeSpaceFromSearch`)

`create_space_from_source` (hybrid) is the space analog of `create_album_from_source`,
but it crosses an API boundary: there is NO `proposeSpaceFromSelection` tool, so the
handle must be **wrapped** as a `selectionHandle` `assetSource` and sent through
`proposeSpaceFromSearch` (the server expands it into `space.create` + `space.addAssets`).
`spaceName` max is 100 (album is 200); `description` is plain-optional (omit, do not
default `''`).

#### Slice 15: `create_space_from_source` router + slots

- [ ] Add `create-space-from-source.mjs` whose `match()` recognizes "make/create a
      `<Name>` space of/from `<source>`" (and "space called/named `<Name>`"), extracts
      `{ sourceDescription, spaceName? }`, declines subjective sources, and never
      collides with album-from-source, rename/describe-space, manage-space-members, or
      add_photos. `parseSlots` normalizes and defaults the name. (Combining A+B is
      acceptable, mirroring `create_album_from_source` which shipped router+exec
      together — but kept as separate slices here for impl-loop clarity.)

- **Files:** `agent-runner/src/strict-workflows/workflows/create-space-from-source.mjs`,
  `agent-runner/src/strict-workflows/workflows/create-space-from-source.test.mjs`

- **Tests (input → expected):**
  - `match('make a Family space of my newest 50 photos')` → `{ slots:{ sourceDescription:'my newest 50 photos', spaceName:'Family' } }` (inline name BEFORE the "space" noun)
  - `match('create a space from my newest 50 photos called Trips')` → `{ slots:{ sourceDescription:'my newest 50 photos', spaceName:'Trips' } }` (trailing called/named capture)
  - `match('make a space of my newest 20 photos titled "South Africa"')` → `{ slots:{ sourceDescription:'my newest 20 photos', spaceName:'South Africa' } }` (strips quotes)
  - `match('create a space from my 2024 photos')` → `{ slots:{ sourceDescription:'my 2024 photos' } }` (no name → omitted, defaulted later)
  - `match('create a shared space of my newest 50 photos')` → `sourceDescription 'my newest 50 photos'` ("shared" adjective tolerated)
  - `match('make an album of my newest 50 photos')` → `undefined` (album noun — owned by `create_album_from_source`)
  - `match('create a space of the best photos from last weekend')` → `undefined` (subjective declines at fast-path)
  - `match('rename the Family space to Family 2026')` → `undefined` (rename verb — owned by `rename_or_describe_space`)
  - `match('add Alex to the Family space')` → `undefined` (member add — owned by `manage_space_members`)
  - `match('add my newest 20 photos to the Family space')` → `undefined` (photo-add into existing space, NOT a create)
  - `match('')` → `undefined`; `match('make a space of my photos.')` → `{ slots:{ sourceDescription:'my photos' } }` (trailing punctuation stripped)
  - `parseSlots({ sourceDescription:'my newest 50 photos' })` → `{ sourceDescription:'my newest 50 photos', spaceName:'New Space' }` (DEFAULT_NAME)
  - `parseSlots({ sourceDescription:'my newest 50 photos', spaceName:'"Trips"' }).spaceName === 'Trips'` (quote strip)
  - `parseSlots({ sourceDescription:'   ' })` → `null`; `parseSlots({ spaceName:'X' })` → `null` (empty/missing source rejected)
  - `wf.kind === 'create_space_from_source'`, `wf.flow === 'hybrid'`, `typeof wf.run === 'function'`

- **Edge cases:**
  - "space" must be the matched noun; "shared space" wrapper tolerated but "album" must NOT match (regex requires `\bspace\b` after the create verb, not `\balbum\b`).
  - trip-like sources: do NOT import `create_album_from_source`'s `TRIP_LIKE` decline — spaces have no trip workflow, so trip-like CAN resolve via recency/date or hand off via the clean-source gate. Document this divergence with a test ("create a space from my recent trip" routes in and the resolver hands off, not force-declined at the router).
  - name capture must not swallow the date/recency source: "a Family space of my 2024 photos" → name='Family' (pre-noun), source='my 2024 photos' (post of/from).
  - `spaceName` max 100 enforced only at the server; `parseSlots` may keep a long name (server rejects) — add an edge test that a >100-char name still parses (boundary owned by the proposer/server), OR trim defensively; pick one and lock it.
  - precedence in registry: register AFTER `create_album_from_source` and BEFORE `rename_or_describe_space` (verbs differ, but keep create-verbs grouped).

- **Eval coverage:** L1 classification-recall (`recall.createspace.canonical`,
  `recall.createspace.named`, `recall.createspace.llm` paraphrase,
  `recall.createspace.album-disambig`, `recall.createspace.member-disambig`),
  classification-negatives (`neg.createspace.subjective` → none), slot-fidelity
  (`slots.createspace.default-name` → `{ sourceDescription, spaceName:'New Space' }`).
  L2: the disambiguation table (add `['make a Family space of my newest 50 photos','create_space_from_source']`,
  keep album/member rows green; "exercises every registered workflow kind" forces a row).

#### Slice 16: `create_space_from_source` execution + contract-fixture `proposeSpaceFromSearch` handler

- [ ] Implement `run()`: resolve the source via `resolveAssetSource`; handoff →
      handoffOpen; empty → needsInput; resolved → call `proposeSpaceFromSearch({ summary,
spaceName, assetSource:{ kind:'selectionHandle', selectionHandleId } })` then
      `gatePlanResult(planTool:'proposeSpaceFromSearch')`. Add a `proposeSpaceFromSearch`
      handler to `contract-fixtures.mjs` that validates the REAL DTO shape so a
      wrong-shape call throws in unit tests. **No raw assetIds and no bare top-level
      `selectionHandleId` may appear in any call.**

- **Files:** `agent-runner/src/strict-workflows/workflows/create-space-from-source.mjs`,
  `agent-runner/src/strict-workflows/workflows/create-space-from-source.test.mjs`,
  `agent-runner/src/strict-workflows/workflows/contract-fixtures.mjs`,
  `agent-runner/src/strict-workflows/workflows/contract-fixtures.test.mjs`

- **Tests (input → expected):**
  - `run({ slots:{ sourceDescription:'my newest 50 photos', spaceName:'Family' } })` → `outcome.status === 'planned'`; the `proposeSpaceFromSearch` call args deepEqual `{ summary:'Create the "Family" space.', spaceName:'Family', assetSource:{ kind:'selectionHandle', selectionHandleId:'handle-1' } }` (EXACT — no top-level `selectionHandleId`, no `description`/`color` keys when absent)
  - `run` with no `spaceName` uses DEFAULT_NAME `'New Space'` in `proposeSpaceFromSearch.spaceName`
  - `JSON.stringify(client.calls).includes('assetIds') === false` AND includes `'"selectionHandleId":"handle-1"'` with kind `'selectionHandle'` (handle wrapped in assetSource, never a bare top-level field, never raw ids)
  - date source: `run({ slots:{ sourceDescription:'my photos from 2024', spaceName:'X' } })` → `searchAssets.filters` deepEqual `{ takenAfter:'2024-01-01T00:00:00.000Z', takenBefore:'2024-12-31T23:59:59.999Z' }` and `outcome.status === 'planned'`
  - handoff: `'the good ones'` / `'my Berlin photos'` (pre-Phase-0 Berlin handed off; post-Phase-0 Berlin resolves as `city` — pick a still-handoff source like `'the good ones'`) → `outcome.status === 'handoff_open'` AND no `proposeSpaceFromSearch` call
  - empty: `makeContractClient({ handleAssetCount:0 })` → `outcome.status === 'needs_input'` AND no `proposeSpaceFromSearch` call
  - gate-block: `makeContractClient({ planResult:{ status:'success', plan:{} } })` → `outcome.status === 'failed'` AND `/prepared|created/i.test(outcome.text) === false`
  - search throws → `outcome.status === 'failed'`
  - contract-fixtures `proposeSpaceFromSearch` THROWS when `spaceName` missing; THROWS when `assetSource` missing; THROWS when `assetSource.kind === 'selectionHandle'` but `selectionHandleId` missing; THROWS on a bare top-level `selectionHandleId` with no `assetSource`; THROWS on `assetSource.kind === 'explicitAssets'`; ACCEPTS `{ spaceName, assetSource:{ kind:'selectionHandle', selectionHandleId } }` → `{ status:'success', plan:{ id:'plan-1' } }`; THROWS when `color` is not a `UserAvatarColor` value

- **Edge cases:**
  - `assetSource.kind` literal MUST be `'selectionHandle'` (not `'selection'` — note the DTO also defines a different `sourceRefKind` enum `['search','selection']` for source-ref tokens; do NOT confuse it with the assetSource discriminant).
  - `description`: only include the `description`/`color` keys when the user actually supplied them — `spaceDescription` is plain-optional (no `''` default), so passing `description:''` would persist an empty description. The workflow captures no description, so omit the key entirely; lock with a test that args has no `description` key.
  - singular/plural copy: `successText` pluralizes photo/photos by `assetCount`.
  - the contract-fixture handler must use `ok(config)` so `{ planResult }` override and the default flow through (mirror `proposeAlbumFromSelection`).
  - reject unknown top-level keys in the fixture handler the way `strictObject` would (e.g. `albumName`, `operations`, `assetIds`) so a copy-paste from the album workflow throws.

- **Eval coverage:** L2 is the core — every `run()` path against the contract-faithful
  fake client; a wrong-shape `proposeSpaceFromSearch` call (bare `selectionHandleId` /
  raw assetIds / missing assetSource) THROWS in unit tests, not only live. L3
  plan-proposed lands in Slice 17 and is the live proof the selectionHandle assetSource
  is accepted (handle form is schema-valid but not example-documented).

#### Slice 17: `create_space_from_source` registration + manifest + L1/L3 eval

- [ ] Register `createSpaceFromSourceWorkflow` in `registry.mjs` (after
      `createAlbumFromSourceWorkflow`, before `renameOrDescribeSpaceWorkflow`), add the
      `WORKFLOW_MANIFEST` entry + mirror into `manifest.generated.json`
      (`manifest.test.mjs` deep-equals them), and land the L1 recall/slot/negative
      scenarios plus the L3 routing + plan-proposed scenarios.

- **Files:** `agent-runner/src/strict-workflows/registry.mjs`,
  `agent-runner/src/strict-workflows/manifest.mjs`,
  `agent-runner/src/strict-workflows/manifest.generated.json`,
  `agent-runner/src/strict-workflows/manifest.test.mjs`,
  `agent-runner/src/strict-workflows/disambiguation.test.mjs`,
  `agent-runner/eval/scenarios/classification-recall.mjs`,
  `agent-runner/eval/scenarios/classification-negatives.mjs`,
  `agent-runner/eval/scenarios/slot-fidelity.mjs`,
  `agent-runner/eval/scenarios/l3-readonly.mjs`,
  `agent-runner/eval/baseline.l3.json`

- **Tests (input → expected):**
  - registry: `createWorkflowRegistry().getWorkflow('create_space_from_source')` is defined and `listWorkflows()` includes it; `classify('make a Family space of my newest 50 photos').kind === 'create_space_from_source'`
  - disambiguation: add `['make a Family space of my newest 50 photos','create_space_from_source']` and `['create a shared space from my 2024 photos','create_space_from_source']`; existing album/member/none rows stay green; "exercises every registered workflow kind" now requires the new kind
  - `manifest.test.mjs`: `WORKFLOW_MANIFEST` round-trips and deep-equals `manifest.generated.json` (adding the entry to only one file fails this test); entry asserts kind `'create_space_from_source'`, `flow:'hybrid'`, `planTool:'proposeSpaceFromSearch'`, `requiredReadTools:['searchAssets']`, slots `{ sourceDescription required, spaceName optional 'defaults to New Space' }`, `supportsContinuation:false`
  - L1 recall scenarios route + slotsSurvive; L1 negative routes to none; slot-fidelity locks `{ sourceDescription, spaceName:'New Space' }`
  - L3: `l3.recall.createspace` `'make a {name} space of my newest 20 photos'` → kind `create_space_from_source`; `l3.plan.createspace` `'make a space of my newest 20 photos called eval-l3-space'` → `{ kind:'create_space_from_source', planProposed:true }` threshold 0.5 (data-independent recency source, plan-only, never applied)

- **Edge cases:**
  - registry ORDER: place after `create_album_from_source` so both create-verb workflows are grouped; verify album-vs-space disambiguation still passes (album noun vs space noun is the discriminator).
  - `manifest.generated.json` is a hand-maintained mirror asserted by `manifest.test.mjs` — forgetting it is the most likely CI break; the slice's first red test is the manifest round-trip.
  - L3 plan scenario name must be a fresh space name (e.g. `'eval-l3-space'`); plan-only `approvalMode` guarantees it is never applied (no `/apply` call), so it leaves no real space behind.
  - `classifierDescription` must distinguish from `create_album_from_source` ("a NEW shared space" vs "a NEW album") and from `add_photos_to_album` ("a new space" vs "add to an existing space"); `negativeExamples` should include "Make an album of my newest 50 photos" and "Add my newest 20 photos to the Family space".

- **Eval coverage:** L1 (full recall + slot-fidelity + negative battery, model-scored).
  L2 (disambiguation table + manifest round-trip, model-free). L3 (live routing
  `l3.recall.createspace` + live plan-proposed `l3.plan.createspace` — the only proof
  `proposeSpaceFromSearch` accepts the selectionHandle assetSource against the real
  server and expands it to `space.create` + `space.addAssets`, proposed-not-applied).

### Phase 5 — Rotate assets (`asset.rotate`) + set album cover (`album.setCover`)

Two small workflows. (A) `rotate_assets` (hybrid): "rotate `<source>` 90 clockwise" →
`proposeAssetBatchFromSelection` action `asset.rotate` over a resolved handle. (B)
`set_album_cover` (strict): "set the cover of `<album>` to `<asset>`" →
`proposeAlbumOperations([album.setCover])`. Both plan only on fully-resolvable inputs
and hand off subjective cases. The angle enum is `{90,180,270}` only; the cover rides
in the asset SELECTION (`assetIds`), NOT a payload field.

#### Slice 18: `rotate_assets` router + angle extractor + execution + manifest (combined)

- [ ] Hybrid `rotate_assets` that matches an EXPLICIT-angle rotate over a resolvable
      source, extracts angle in `{90,180,270}`, resolves via the shared resolver, and
      proposes `proposeAssetBatchFromSelection { type:'asset.rotate', angle }` — handing
      off subjective/no-angle/non-resolvable sources. Add the `asset.rotate` angle
      branch to `validateBatchAction`. Register in `registry.mjs` + `manifest.mjs`
      (+ `manifest.generated.json`).

- **Files:** `agent-runner/src/strict-workflows/workflows/rotate-assets.mjs` (new),
  `agent-runner/src/strict-workflows/workflows/rotate-assets.test.mjs` (new),
  `agent-runner/src/strict-workflows/workflows/contract-fixtures.mjs`,
  `agent-runner/src/strict-workflows/workflows/contract-fixtures.test.mjs`,
  `agent-runner/src/strict-workflows/registry.mjs`,
  `agent-runner/src/strict-workflows/manifest.mjs`,
  `agent-runner/src/strict-workflows/manifest.generated.json`,
  `agent-runner/src/strict-workflows/manifest.test.mjs`,
  `agent-runner/src/strict-workflows/disambiguation.test.mjs`,
  `agent-runner/eval/scenarios/classification-recall.mjs`,
  `agent-runner/eval/scenarios/classification-negatives.mjs`,
  `agent-runner/eval/scenarios/slot-fidelity.mjs`,
  `agent-runner/eval/scenarios/l3-readonly.mjs`,
  `agent-runner/eval/baseline.l3.json`

- **Tests (input → expected):**
  - `match('rotate my newest 20 photos 90 clockwise')` → `{ slots:{ angle:90, sourceDescription:'my newest 20 photos' } }`
  - `match('rotate my last 10 photos 90 counterclockwise')` → `angle 270` (CCW90 == angle 270)
  - `match('rotate my 2024 photos 180')` → `angle 180`; `match('flip my newest 5 photos upside down')` → `angle 180`
  - `match('rotate the sideways photos clockwise')` → `undefined` (no explicit angle; keeps `neg.unsup.rotate` = none)
  - `match('rotate the best ones 90 clockwise')` → `undefined` (`SUBJECTIVE_PATTERN` declines at fast-path)
  - `match('rotate my newest 20 photos 45 clockwise')` → `undefined` (45 not in `{90,180,270}`)
  - `match('rotate my newest 20 photos 270 clockwise')` → `270`; `match('…90 anticlockwise')` → `270`
  - `match('')` → `undefined`
  - `parseSlots({ angle:90, sourceDescription:'my newest 20 photos' })` → `{ angle:90, sourceDescription:'my newest 20 photos' }`
  - `parseSlots({ angle:'90', sourceDescription:'x' }).angle === 90` (LLM string coerced); `parseSlots({ angle:'counterclockwise', sourceDescription:'x' }).angle === 270`
  - `parseSlots({ angle:45, sourceDescription:'x' })` → `null`; `parseSlots({ sourceDescription:'x' })` → `null`; `parseSlots({ angle:90, sourceDescription:'   ' })` → `null`
  - run plans batch `asset.rotate` over recency handle: status `'planned'`; `proposeAssetBatchFromSelection.args.action` deepEqual `{ type:'asset.rotate', angle:90 }`; `selectionHandleId === 'handle-1'`; `JSON.stringify(calls)` has no `'assetIds'`
  - run carries angle 270 into the op (deepEqual `{ type:'asset.rotate', angle:270 }`)
  - run plans a DATE source: `searchAssets.args.filters` deepEqual `{ takenAfter:'2024-01-01T00:00:00.000Z', takenBefore:'2024-12-31T23:59:59.999Z' }`
  - run hands off a subjective source: status `handoff_open`; no propose call
  - run needs_input on zero assets (`handleAssetCount:0`); no propose call
  - run fails (gate) when plan has no persisted id (`planResult { status:'success', plan:{} }`); success copy absent
  - run fails when `searchAssets` throws
  - CONTRACT: `makeContractClient().call('proposeAssetBatchFromSelection', { action:{ type:'asset.rotate', angle:45 }, selectionHandleId:'h' })` REJECTS `/angle/i`; angle 90/180/270 accepted
  - registry: `classify('rotate my newest 20 photos 90 clockwise')` → `{ kind:'rotate_assets', via:'regex' }`
  - manifest: `getWorkflowManifestEntry('rotate_assets').planTool === 'proposeAssetBatchFromSelection'`; `requiredReadTools` includes `'searchAssets'`; `flow === 'hybrid'`; registry↔manifest parity stays green; `manifest.generated.json` mirror equals `manifest.mjs`
  - L3: `l3.recall.rotate` (routing) + `l3.plan.rotate.recency` (`'rotate my newest 20 photos 90 clockwise'` → `{ kind:'rotate_assets', planProposed:true, threshold:0.5 }`)

- **Edge cases:**
  - CCW/anticlockwise/counter-clockwise MUST map to `angle 270` (schema has no negative/CCW; 270 == CCW90).
  - "upside down"/"flip"/"180" → 180.
  - No explicit angle declines/hands off (never an undefined-angle plan) — preserves `neg.unsup.rotate` = none and avoids guessing direction.
  - 45/30/360/0 out-of-enum; never coerced, never planned (`parseSlots` null).
  - registry ORDER: place among batch workflows (archive/favorite/tag) BEFORE `add_photos_to_album`; "rotate" is a unique verb (low collision) — add a guard test.
  - No raw asset ids ever sent (assert JSON has no `assetIds`).
  - Decline "recent trip" source at fast-path (tripSourcePattern) like archive/favorite.
  - positiveExamples carry an explicit angle; negativeExamples include "Rotate the sideways photos clockwise" (no angle → none) and "Rotate the best ones 90 clockwise" (subjective → none).

- **Eval coverage:** L1 classification-recall (`recall.rotate.canonical` 90,
  `recall.rotate.ccw` 270, `recall.rotate.flip` 180), classification-negatives (KEEP
  `neg.unsup.rotate` no-angle + `neg.rotate.subjective` + `neg.rotate.badangle`),
  slot-fidelity (`slots.rotate.ccw-polarity` → `{ angle:270, sourceDescription:'my newest 5 photos' }`).
  L2 (rotate-assets.test.mjs + contract-fixtures accept/reject). L3 (`l3.recall.rotate`
  routing + `l3.plan.rotate.recency` plan-proposed, threshold 0.5).

#### Slice 19: `set_album_cover` contract fixture — `readAlbum` handler + `album.setCover` validator

- [ ] Add a `readAlbum` handler to `contract-fixtures.mjs` returning `{ …album, assetIds }`
      (the album members + the current cover `albumThumbnailAssetId`), and a
      `validateAlbumSetCover` to `validateOperations` mirroring the real DTO: `targetKind
=== 'existing_album'`, `targetId` present, exactly one selection mechanism with a
      non-empty `assetIds` (≤ 500), no non-empty payload. This is the contract half of
      the `add_photos` lesson — without it a missing `targetId`/empty `assetIds` passes L2.

- **Files:** `agent-runner/src/strict-workflows/workflows/contract-fixtures.mjs`,
  `agent-runner/src/strict-workflows/workflows/contract-fixtures.test.mjs`

- **Tests (input → expected):**
  - `readAlbum({ albumId:'alb-1' })` returns `{ id:'alb-1', albumName:'Family', assetIds:[…], albumThumbnailAssetId:<uuid|null> }` (configurable via a `config.albums` member list)
  - `proposeAlbumOperations({ operations:[{ type:'album.setCover', targetKind:'existing_album' }] })` REJECTS `/targetId/i`
  - a setCover with non-empty `assetIds` + `targetId` + `existing_album` ACCEPTED → `{ status:'success', plan:{ id:'plan-1' } }`
  - setCover with `assetIds:[]` REJECTS `/assetId|cover/i`
  - setCover with `targetKind:'asset_batch'` REJECTS `/existing_album/i`
  - setCover with a non-empty `payload` REJECTS (`emptyPayload` strictObject)
  - `KNOWN_OPERATION_TYPES.has('album.setCover')` stays true

- **Edge cases:**
  - cover is the ASSET SELECTION (`assetIds:[coverId]`), NOT a payload field — payload stays absent/empty.
  - `uniqueCoverAssetIds` max is 500 (not 10000); single-element array is normal.
  - keep the validator additive: existing album/space op validators and tests stay green.

- **Eval coverage:** L2 only (contract fixture). The guardrail Slice 20's `run()` tests
  rely on.

#### Slice 20: `set_album_cover` router + cover-asset resolution + execution + manifest (combined)

- [ ] Strict `set_album_cover`: match "set/make the cover of `<album>` to `<assetRef>`",
      resolve album via `listAlbums` (0/>1 → needs_input), resolve the chosen cover
      asset to ONE uuid (explicit index/id only; else handoff), propose one
      `proposeAlbumOperations` `album.setCover` op `{ targetKind:'existing_album',
targetId, assetIds:[coverId] }`. Register in `registry.mjs` + `manifest.mjs`
      (+ `manifest.generated.json`).

- **Files:** `agent-runner/src/strict-workflows/workflows/set-album-cover.mjs` (new),
  `agent-runner/src/strict-workflows/workflows/set-album-cover.test.mjs` (new),
  `agent-runner/src/strict-workflows/registry.mjs`,
  `agent-runner/src/strict-workflows/manifest.mjs`,
  `agent-runner/src/strict-workflows/manifest.generated.json`,
  `agent-runner/src/strict-workflows/manifest.test.mjs`,
  `agent-runner/src/strict-workflows/disambiguation.test.mjs`,
  `agent-runner/eval/scenarios/classification-recall.mjs`,
  `agent-runner/eval/scenarios/classification-negatives.mjs`,
  `agent-runner/eval/scenarios/slot-fidelity.mjs`,
  `agent-runner/eval/scenarios/l3-readonly.mjs`,
  `agent-runner/eval/baseline.l3.json`

- **Tests (input → expected):**
  - `match('set the cover of the Family album to the first photo')` → `{ slots:{ albumRef:'Family', coverRef:'the first photo' } }`
  - `match('make the Family album cover the 3rd photo')` → `{ slots:{ albumRef:'Family', coverRef:'3rd' } }`
  - `match('pick a better cover for the Family album')` → `undefined` (subjective; no specific asset → declines)
  - `match('change the cover photo on my Italy album')` → `undefined` (no target asset → declines; falls to open/handoff, not a guess)
  - `match('')` → `undefined`; `match('rename the Family album to X')` → `undefined` (not a cover intent)
  - `parseSlots({ albumRef:'Family', coverRef:'3rd photo' })` → `{ albumRef:'Family', coverRef:'3rd photo' }`; `parseSlots({ albumRef:'Family' })` → `null`; `parseSlots({ coverRef:'3rd' })` → `null`
  - run: index "the 3rd photo" vs `readAlbum.assetIds=[a,b,c,d]` resolves `coverId=c`; `proposeAlbumOperations.operations[0]` deepEqual `{ type:'album.setCover', targetKind:'existing_album', targetId:<album.id>, assetIds:[c], summary:<str> }` (no payload key); status `'planned'`
  - run: ambiguous album (two 'Trip' albums) → needs_input; no propose call
  - run: album not found → needs_input; no propose call
  - run: index out of range ("the 9th photo", album has 4) → needs_input; no propose call
  - run: a cover that survived parseSlots but cannot map to a single asset ("a nicer one") → handoff_open; no propose call
  - run fails (gate) when plan has no persisted id (`planResult { status:'success' }`); no success copy (`/set|cover|ready/i` absent)
  - run fails when `listAlbums`/`readAlbum` throws
  - manifest: `getWorkflowManifestEntry('set_album_cover').planTool === 'proposeAlbumOperations'`; `requiredReadTools` deepEqual `['listAlbums','readAlbum']`; `flow === 'strict'`; registry↔manifest parity green; mirror matches
  - registry: `classify('set the cover of the Family album to the 3rd photo')` → `{ kind:'set_album_cover', via:'regex' }`
  - L3: `l3.recall.cover` (routing) + `l3.plan.cover.index` (`'set the cover of the {album} album to the first photo'` → `{ kind:'set_album_cover', planProposed:true, threshold:0.5 }`) on a real album with ≥ 1 asset; `l3.neg.cover.subjective` (`'pick a better cover for {album}'` → none)

- **Edge cases:**
  - cover is the ASSET SELECTION (`assetIds:[coverId]`), NOT a payload field — a `payload.coverAssetId` is rejected by the `emptyPayload` strictObject.
  - `targetKind` MUST be `'existing_album'` + `targetId`; never `'new_album'` here (no create op to pair `temporaryTargetId` with).
  - STRICT BOUNDARY: only an EXPLICIT unambiguous asset reference plans — an index ("3rd photo"/"first/last photo") resolvable against `readAlbum.assetIds`, or a session-pinned asset. Subjective "better/nicer cover" has no resolvable asset and hands off to open discovery. Resolving a free-text visual description ("the sunset one") to a uuid is NOT in scope and must handoff.
  - exactly-one selection mechanism: send `assetIds` only (not assetSource or handle).
  - registry ORDER: "set the cover …" must NOT be stolen by `rename_or_describe_album` DESCRIBE_PATTERN (which requires the literal word "description", so safe) — add a guard test; place adjacent to album workflows.
  - INDEX RESOLUTION: "first/last/Nth photo" maps against `readAlbum.assetIds` deterministically; out-of-range → needs_input (not a clamp). Album ordering of `assetIds` must match what the user sees — verify on L3.

- **Eval coverage:** L1 classification-recall (`recall.cover.index`, `recall.cover.first`),
  classification-negatives (`neg.cover.subjective` + `neg.cover.unspecified` → none),
  slot-fidelity (`slots.cover.index` → `{ albumRef:'Family', coverRef:/3rd|third/i }`).
  L2 (set-album-cover.test.mjs + contract-fixtures setCover accept/reject + readAlbum
  handler). L3 (`l3.recall.cover` routing + `l3.plan.cover.index` plan-proposed +
  `l3.neg.cover.subjective`).

### Phase 6 — Cross-cutting hardening

#### Slice 21: Disambiguation sweep across all new kinds

- [ ] Extend `disambiguation.test.mjs` so every new + existing workflow's canonical
      and paraphrase prompts route to exactly one kind; no prompt cross-matches across
      the full expanded set (entity sources, metadata edits, remove-from-album,
      space-assets, create-space, rotate, set-cover). Tighten fast-path guards where
      collisions surface; add the colliding prompts as L1 negatives for the OTHER
      workflows.

- **Files:** `agent-runner/src/strict-workflows/disambiguation.test.mjs`,
  `agent-runner/eval/scenarios/classification-negatives.mjs`

- **Tests (input → expected):**
  - a table-driven test asserting `classify(prompt).kind` for the full cross-cutting set, including: `'set the description on my newest 20 photos to X'` → `update_asset_metadata`; `'set the description on the Family album to X'` → `rename_or_describe_album`; `'remove my newest 20 from Family'` → `remove_photos_from_album`; `'remove Bob from the Family space'` → `manage_space_members`; `'add my newest 20 photos to the Family space'` → `manage_space_assets`; `'add my newest 20 photos to Family'` → `add_photos_to_album`; `'make a Family space of my newest 50 photos'` → `create_space_from_source`; `'make an album of my newest 50 photos'` → `create_album_from_source`; `'rotate my newest 20 photos 90 clockwise'` → `rotate_assets`; `'set the cover of the Family album to the first photo'` → `set_album_cover`
  - the "exercises every registered workflow kind at least once" assertion now covers all six new kinds
  - LLM-mode classifier recall stays ≥ threshold for each new kind after broadened examples

- **Edge cases:**
  - the four "remove … from …" owners (`remove_photos_from_album`, `manage_space_members`, `manage_space_assets[remove]`, `favorite_assets`) must each keep their phrasing — registry order + decline gates verified together here.
  - the two "set the description …" owners (`update_asset_metadata` vs `rename_*`) — album/space ref vs loose-asset is the seam.
  - the three create-verb owners (`create_album_from_source`, `create_space_from_source`, `create_recent_trip_album`) — noun + trip-detection discriminate.

- **Eval coverage:** L2 — the cross-workflow disambiguation table is the regex-mode
  regression lock; LLM-mode recall in the L1 battery (Slice 23).

#### Slice 22: Full edge sweep & resolver-broadening regression

- [ ] Wire the full Edge Case Coverage list (below) as tests, including the Phase-0
      behavior-change re-baseline (previously-handoff entity sources now resolve), and
      confirm both eval audits (no-apply, no gate-block) stay clean across the expanded
      battery. Update any L1/L3 baselines and `add_photos` negativeExamples that the
      resolver broadening flipped (e.g. "Add my Berlin photos from last weekend to the
      Trips album" was a positive that handed off at resolve-time and now resolves).

- **Files:** `agent-runner/src/strict-workflows/asset-source-resolver.test.mjs`,
  the per-workflow `*.test.mjs` files (edge additions),
  `agent-runner/eval/scenarios/classification-recall.mjs`,
  `agent-runner/eval/scenarios/classification-negatives.mjs`,
  `agent-runner/eval/baseline.json`,
  `agent-runner/eval/baseline.l3.json`

- **Tests:** the Edge Case Coverage themes below, asserted as `node:test` units; L1
  recall/negatives and L3 routing/plan re-asserted at-or-above the re-seeded baseline;
  `auditNoApply` + `auditGateBlocks` == 0 across the full battery.

- **Edge cases:** see the Edge Case Coverage section — this slice is its home.

- **Eval coverage:** L2 (edge units) + L1 (re-baselined recall/negatives) + L3
  (re-baselined routing/plan, audits clean).

#### Slice 23: Re-seed L1 + L3 baselines, capability-matrix regen & acceptance

- [ ] Run `pnpm --dir server sync:agent-capabilities` so the capability-matrix
      generated table lists all new kinds; re-`--accept` `baseline.json` (L1) and
      `baseline.l3.json` (L3) at the end of the phase; update the capability matrix
      "Implemented strict/hybrid workflows" table and Next Steps; confirm both eval
      audits clean. Final acceptance against the criteria below.

- **Files:** `agent-runner/eval/baseline.json`,
  `agent-runner/eval/baseline.l3.json`,
  `agent-runner/src/strict-workflows/manifest.generated.json`,
  `docs/superpowers/specs/2026-05-19-pi-agent-capability-matrix.md`

- **Tests:** `pnpm --dir agent-runner test` green; `pnpm --dir server check` +
  `sync:agent-capabilities` clean; L1 battery ≥ baseline; L3 scenarios pass live with
  clean audits.

- **Acceptance:** all Acceptance Criteria below met; baselines committed; matrix current.

## Edge Case Coverage

Asserted across the slices above (full list, by theme):

**Resolver broadening (Phase 0)**

- Named-entity name lookup: person ("of/with `<Name>`"), tag ("tagged `<Tag>`"), album
  ("in the `<Album>` album"), camera ("shot on/with `<Make/Model>`") → structured
  `resolveAssetSearchFilters` args (never `query`).
- Direct metadata mapped straight into `searchAssets.filters`: place → `city`; rating
  ("5-star"/"rated 5") → `rating:5`; favorites → `isFavorite:true`; visibility
  ("archived") → `visibility:'archive'` (lowercase enum); type → `type` (uppercase).
- Ambiguous entity (multiple matches) → `needs_input` (choices' labels only); not-found
  → `needs_input` ("could not find a `<kind>`"); mixed → not_found wins; all matched →
  resolve. Never guess; never an unbounded global search on partial resolution.
- Entity × recency/date/type/direct combine into ONE merged filters object; no key
  collision drops a filter.
- `resolverNameList` caps (≤ 20 names/kind, ≤ 120 chars) respected by the parser.
- place-vs-person collision ("Paris"): try people via resolver, fall to `city` on
  person not_found.
- BEHAVIOR CHANGE: "my Berlin photos from last weekend", "newest 20 Berlin photos",
  "photos of Alex from last week" now RESOLVE (re-baselined).
- Subjective + entity ("the best Berlin photos") → handoff (subjective wins).
- Un-consumable residual after entity+date+type+direct → handoff (over-resolution guard).

**Batch metadata edits (Phase 1)**

- description set / empty-string clear ('' is valid); rating 1..5 / null clear /
  out-of-range reject; absolute date / relative-minute shift (mutually exclusive);
  `dateTimeRelative:0` sole-field no-op rejected; timezone IANA; explicit lat+lng (both
  required — half-coordinate rejected); place-name location → ask for coords.
- FLAT action shape (`type` + fields siblings, not nested `payload`).
- album/space-ref describe stays with `rename_*`; loose-asset describe → metadata.

**Remove from album (Phase 2)**

- EMPTY-REMOVAL SAFETY: zero-asset resolution → needs_input, never an empty removal.
- `existing_album` + `targetId` required; `new_album` rejected; no `temporaryTargetId`;
  no payload.
- "remove … from …" collisions: space-member removal, out-of-favorites, tag removal
  all decline (registry order + decline gate).

**Space assets (Phase 3)**

- ADD via `proposeAddAssetsToSpaceFromSearch` (`spaceId` only, exactly-one rule);
  REMOVE via `proposeAlbumOperations` `space.removeAssets` (`existing_space` + `targetId`
  - empty payload).
- ROUTING FIX: "… to the `<space>` space" steals from `add_photos_to_album` (was a
  silent dead end); member adds stay with `manage_space_members`.
- "my screenshots" matches the router but the resolver hands off (recency/date source
  used for the plan-proposed probe).
- non-Editor → server error → failed (runner can't pre-guard role).

**Create space from source (Phase 4)**

- NO `proposeSpaceFromSelection` — handle wrapped as `selectionHandle` `assetSource` in
  `proposeSpaceFromSearch`; bare top-level `selectionHandleId` / raw assetIds /
  `explicitAssets` kind rejected.
- `spaceName` max 100 (album 200); `description` plain-optional (omit, no `''` default).
- no `TRIP_LIKE` decline (trip-space requests route in, resolver hands off).

**Rotate + set cover (Phase 5)**

- angle ∈ `{90,180,270}` only; CCW/anticlockwise → 270; flip/upside-down → 180;
  no-angle → none; 45/0/360 rejected.
- rotate target is `image_edit_batch` (server-assigned via the from-selection tool;
  run sends handle-only).
- cover rides in `assetIds` (`uniqueCoverAssetIds`, ≤ 500), NOT a payload field; only
  an explicit unambiguous asset (index resolvable against `readAlbum.assetIds`) plans;
  subjective "better cover" hands off; out-of-range index → needs_input.

**Cross-cutting / foundation invariants**

- No claimed plan without a persisted plan id; `strict_success_gate_block` count == 0.
- No raw asset-id lists in model-facing args or copy (selection handles only).
- `manifest.generated.json` mirrors `manifest.mjs` after every registration
  (`manifest.test.mjs` round-trip).
- Observability events emitted per turn (L3 reads them); no-apply audit clean.

## Acceptance Criteria

- The broadened resolver and all six new workflow kinds (`update_asset_metadata`,
  `remove_photos_from_album`, `manage_space_assets`, `create_space_from_source`,
  `rotate_assets`, `set_album_cover`) implemented test-first, registered, and shown in
  the capability-matrix generated table.
- `pnpm --dir agent-runner test` green (broadened resolver, six workflows, upgraded
  contract fixtures, disambiguation sweep); `pnpm --dir server check` +
  `sync:agent-capabilities` clean; `manifest.generated.json` mirrors `manifest.mjs`.
- L1 eval: recall/slot/negative scenarios for all new kinds pass against the local
  model at or above the committed baseline (incl. the entity-source recall for the five
  existing source workflows); cross-workflow disambiguation has no collisions in regex
  and LLM modes.
- L2 eval: every execution slice's `run()` drives the contract-faithful fixture client;
  a wrong-shape call (the resolver's structured args, `asset.updateMetadata` flat shape,
  `album.removeAssets` `existing_album` target, `space.addAssets/removeAssets`,
  `proposeSpaceFromSearch` selectionHandle assetSource, `album.setCover` `assetIds`)
  THROWS in unit tests, not only live.
- L3 eval (live, read-only, `plan-only`): each new capability routes correctly and
  proposes a real, never-applied plan; the resolver's entity path is proven live via an
  `{album}`-discovery probe; `create_space_from_source`'s selectionHandle assetSource is
  proven accepted by the real server (the load-bearing live proof); both audits
  (no-apply, no gate-block) clean. Re-seed `baseline.l3.json`.
- **NO new MCP tools or operation types**; **place-name → coordinate geocoding stays
  OUT** (location edits accept only explicit lat+lng); no apply-path changes; no fixture
  that ignores call args (every fixture validates against the real tool DTOs).
- Adding the next workflow remains a manifest entry + a workflow module + scenarios —
  no foundation changes.

## Open Contract Questions (surfaced from research, resolve in the named slice)

1. **`resolveAssetSearchFilters` `results[]` element shape (Slice 2).** The fixture
   today returns `{ resolvedFilters:{} }` and only throws on `'query' in args`. Confirm
   the real per-query `results` element (`{ kind, query, status, value?, id?,
searchFilter?, choices, message }`) and that `resolvedFilters` can come back
   empty/partial when something is ambiguous/not_found, before modeling matched/
   ambiguous/not_found.

2. **`proposeAddAssetsToSpaceFromSearch` selectionHandle assetSource + exactly-one rule
   (Slice 14).** Verify the request accepts `assetSource:{ kind:'selectionHandle',
selectionHandleId }` (it IS `agentOperationPlanningAssetSourceInput`) and that the
   exactly-one rule is `Boolean(spaceId) === Boolean(spaceName)` (both → fail, neither →
   fail). Pass `spaceId` only.

3. **`proposeSpaceFromSearch` selectionHandle assetSource is schema-valid but NOT
   example-documented (Slice 16/17).** The server contract's `proposeSpaceFromSearch`
   examples only show `kind:'search'/'previousSearch'`. The selectionHandle form is
   valid by schema (and endorsed by a `commonMistakes` hint) but under-exercised — the
   L3 plan-proposed scenario is the LOAD-BEARING proof the live server materializes the
   handle into `space.create` + `space.addAssets`. Do not consider Phase 4 done without it.

4. **`remove_photos_from_album` `requiredReadTools` and the conditional resolver tool
   (Slice 12).** After Phase 0, recency-only removals never call
   `resolveAssetSearchFilters` but entity-source removals do (via the shared resolver).
   Decide whether `requiredReadTools` advertises `resolveAssetSearchFilters`
   conditionally (recommended: include it once Phase 0 lands, since entity sources reach
   every source workflow through the shared resolver).

5. **`readAlbum.assetIds` ordering for cover index resolution (Slice 20).** "first/last/
   Nth photo" maps against `readAlbum.assetIds` deterministically; confirm the album's
   `assetIds` ordering matches what the user sees in the UI (else "first photo" picks the
   wrong asset) — verify on L3 before trusting index resolution.
