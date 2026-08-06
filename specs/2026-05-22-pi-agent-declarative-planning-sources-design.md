# Pi Agent Declarative Planning Sources Design

Status: draft design
Date: 2026-05-22
Branch: `explore/pi-agent-brainstorm`

## Purpose

Pi can now search Gallery, resolve people and other named filters, create
server-side selection handles, and propose reviewable operation plans. The weak
spot is that the model still has to move UUID-shaped values between tool calls:
person IDs, asset IDs, selection handle IDs, album IDs, space IDs, tag IDs, and
plan IDs all look similar. Smaller models confuse those domains, omit resolved
filters, copy examples, or pass a person ID where an asset ID is required.

The better contract is to let the model describe intent and source data while
Gallery handles ID plumbing internally. Pi should be able to say:

> Create an album from photos matching this search.

without seeing every matching asset ID or copying an intermediate selection
handle. Gallery should resolve names, execute bounded searches, materialize a
review snapshot, create a reviewable plan, and return a compact user-facing
summary.

## Production Motivation

Session `0e6ddfd0-3473-4659-bb43-da4697dc43d7` failed on the request:

> I went to South Africa in January this year - create an album for me with
> photos that have Pierre OR Aurelia in them

The persisted tool calls showed the core failure:

1. Pi resolved `Pierre` and `Aurelia` to person IDs.
2. It made invalid searches before eventually creating a valid search selection
   for 100 assets.
3. It then called `readAssetMetadata` with a `personId` in `assetIds`.
4. Gallery denied the call as inaccessible and the session became
   `interrupted`.
5. No reviewable operation plan was created.

This was not an isolated bug in one endpoint. It exposed a contract problem:
models are being asked to distinguish several UUID domains and copy the right
value across multi-step workflows.

## Goals

- Remove ordinary asset ID handling from Pi's planning path.
- Let Pi plan from declarative sources such as `assetSource: { kind: "search",
filters: ... }`.
- Let Pi reuse a prior search result through a typed source reference when it
  has already searched.
- Keep every Gallery mutation behind a reviewable plan and user approval.
- Preserve deterministic plan review by materializing asset sources at plan
  creation time.
- Make ambiguous names produce structured clarification results instead of
  broad searches or failed plans.
- Add typed ID/domain validation so wrong-domain IDs produce recoverable
  errors, not generic access failures.
- Keep MCP responses minimal by default and return counts/samples, not massive
  ID lists.
- Provide higher-level workflow tools for common tasks so smaller models can
  succeed with fewer steps.
- Use TDD for every implementation slice. Each slice must start by adding or
  updating failing tests, prove the expected red failure, implement the smallest
  useful change, then verify green. A slice is not complete until the listed
  tests and edge cases are covered by automated tests or explicitly documented
  as manual-only.

## Non-Goals

- No direct apply/write tool for the runner.
- No automatic album/space/asset mutations outside plan review.
- No unbounded "select everything forever" saved searches. Plans materialize a
  bounded snapshot for review.
- No raw original file access as part of ordinary planning.
- No prompt-only solution. Prompt/docs improvements are useful, but the server
  contract must make wrong behavior hard.
- No broad replacement of the existing operation-plan UI.

## Design Principles

### Models Describe Intent, Gallery Resolves IDs

The model should handle names, filters, operation intent, summaries, and user
clarifications. Gallery should handle database identifiers, access scopes,
materialized asset sets, deduplication, limits, and plan persistence.

### Source Objects Beat Copied IDs

Planning operations should accept typed source objects:

```json
{
  "assetSource": {
    "kind": "search",
    "filters": {
      "country": "South Africa",
      "takenAfter": "2026-01-01T00:00:00.000Z",
      "takenBefore": "2026-01-31T23:59:59.999Z",
      "people": { "match": "any", "names": ["Pierre", "Aurelia"] }
    }
  }
}
```

instead of:

```json
{
  "assetIds": ["..."],
  "assetSelectionHandleId": "..."
}
```

Explicit IDs remain available for advanced or already-supported paths, but they
should stop being the default model-facing path.

### Materialize At Plan Creation

A plan must review an exact asset set. Declarative sources are evaluated when
the plan is created, not at apply time. The persisted operation stores a
materialized server-side selection snapshot or the expanded asset IDs according
to existing scale limits. The UI shows the resulting count, sample thumbnails,
and technical details if expanded.

The materialized plan asset set must survive ordinary source expiration.
`sourceRef` and search-time handles may expire before they are used to create a
plan. Once a plan is created, apply must use the plan's durable materialized
snapshot, not a live re-query and not an expiring transient search result. If
Gallery cannot promote or copy the source into a durable plan-scoped snapshot,
plan creation must fail before showing a reviewable plan.

### Clarify Instead Of Guessing

If `Pierre` maps to multiple people, or "South Africa in January" produces too
many matches for the selected preset, the tool should return a structured
clarification response. The model should ask the user a concrete question with
Gallery-provided options rather than doing a broad or partial plan.

### Typed Failure Recovery

Wrong-domain IDs should be diagnosed precisely:

- `personId` passed as `assetId`
- `assetId` passed as `personId`
- expired or cross-session selection handle
- example placeholder copied into a real call
- previous search source reference that no longer exists

The response should include a short, safe retry instruction when recovery is
possible.

## Proposed Contract

### Asset Source

Add a model-facing `AgentAssetSourceInput` union used by planning tools and
workflow tools:

```ts
type AgentAssetSourceInput =
  | {
      kind: 'search';
      mode?: 'metadata' | 'smart' | 'description' | 'ocr' | 'filename';
      query?: string;
      filters?: AgentDeclarativeAssetFilters;
      order?: 'asc' | 'desc' | 'relevance';
      limit?: number;
      page?: number;
      materialization?: 'bounded-page' | 'all-matches-with-limit';
    }
  | {
      kind: 'previousSearch';
      sourceRef: string;
    }
  | {
      kind: 'selectionHandle';
      selectionHandleId: string;
    }
  | {
      kind: 'explicitAssets';
      assetIds: string[];
    };
```

`explicitAssets` and `selectionHandle` preserve backward compatibility and
advanced control. `search` and `previousSearch` are the preferred model-facing
paths.

### Declarative Filters

Declarative filters accept user-facing names for fields that currently require
IDs:

```ts
type AgentDeclarativeAssetFilters = {
  takenAfter?: string;
  takenBefore?: string;
  country?: string | null;
  city?: string | null;
  state?: string | null;
  people?: { match: 'any' | 'all'; names: string[] };
  tags?: { match: 'any' | 'all'; names: string[] };
  albums?: { match: 'any' | 'all'; names: string[] };
  space?: { name: string };
  camera?: { make?: string; model?: string; lensModel?: string };
  rating?: number | null;
  isFavorite?: boolean;
  isNotInAlbum?: boolean;
  type?: 'IMAGE' | 'VIDEO' | 'AUDIO' | 'OTHER';
  visibility?: string;
  withSharedSpaces?: boolean;
};
```

The server translates these to existing `AgentSearchAssetsFilters` by reusing
the same resolver logic behind `resolveAssetSearchFilters`.

### Source Reference

When `searchAssets` succeeds, it should return a model-facing source reference:

```json
{
  "sourceRef": "asset-source:search:01J...",
  "summary": "100 matching photos from January 2026 in South Africa with Pierre or Aurelia",
  "assetCount": 100,
  "sampleAssetIds": ["..."]
}
```

The reference is not a raw UUID and is explicitly typed. It points to the
server-side selection materialized by the search. A plan can then use:

```json
{
  "assetSource": {
    "kind": "previousSearch",
    "sourceRef": "asset-source:search:01J..."
  }
}
```

This is the closest MCP-friendly version of piping a search result into a plan:
the model copies one typed source token, not a list of IDs. For common
workflows, the model should not need even this because it can pass
`assetSource.kind = "search"` directly to the high-level planning tool.

### Plan Operation Input

Planning operation inputs gain optional `assetSource` alongside the existing
`assetIds` and `assetSelectionHandleId`:

```json
{
  "type": "album.addAssets",
  "summary": "Add January 2026 South Africa photos with Pierre or Aurelia",
  "targetKind": "album",
  "temporaryTargetId": "new-south-africa-album",
  "assetSource": {
    "kind": "search",
    "filters": {
      "country": "South Africa",
      "takenAfter": "2026-01-01T00:00:00.000Z",
      "takenBefore": "2026-01-31T23:59:59.999Z",
      "people": { "match": "any", "names": ["Pierre", "Aurelia"] }
    }
  }
}
```

The operation-plan service resolves the source before persistence, stores the
same durable operation model already used by review/apply, and adds source audit
metadata for review/debug views.

For asset-bearing operations, exactly one asset source mechanism is valid:

- `assetSource`;
- `assetIds`;
- `assetSelectionHandleId`.

The server must reject operations that provide more than one of these fields.
There is no precedence rule. The server must also reject asset-bearing
operations that provide none of them. Operations that do not operate on assets,
such as pure create-album or create-space operations, must omit all three.

### Workflow Tools

Add high-level workflow tools for smaller models. These tools create reviewable
plans and never apply changes:

- `proposeAlbumFromSearch`
- `proposeAddAssetsToAlbumFromSearch`
- `proposeSpaceFromSearch`
- `proposeAddAssetsToSpaceFromSearch`
- `proposeAssetBatchFromSearch`

Example:

```json
{
  "album": {
    "name": "South Africa - Jan 2026 (Pierre & Aurelia)",
    "description": "Photos from South Africa in January 2026 featuring Pierre or Aurelia."
  },
  "assetSource": {
    "kind": "search",
    "filters": {
      "country": "South Africa",
      "takenAfter": "2026-01-01T00:00:00.000Z",
      "takenBefore": "2026-01-31T23:59:59.999Z",
      "people": { "match": "any", "names": ["Pierre", "Aurelia"] }
    }
  }
}
```

Internally this maps to the same operation-plan service. The workflow tools are
thin, model-friendly wrappers, not separate mutation paths.

## Data Flow

### Direct Declarative Planning

1. User asks Pi to create an album from a natural-language search.
2. Pi calls `proposeAlbumFromSearch` with album metadata and a declarative
   `assetSource.search`.
3. Gallery resolves names to IDs.
4. Gallery validates ambiguity, permissions, and result-size limits.
5. Gallery materializes a bounded selection snapshot.
6. Gallery persists a proposed operation plan.
7. Gallery returns plan ID, counts, thumbnails/samples, and review summary.
8. User reviews and applies the plan through the existing UI.

### Search Then Plan

1. Pi calls `searchAssets` to inspect whether a selection is plausible.
2. Gallery returns compact count/sample plus `sourceRef`.
3. Pi calls a plan tool with `assetSource.previousSearch`.
4. Gallery validates the source belongs to the same session and is still valid.
5. Gallery persists a plan from that materialized source.

### Ambiguous Source

1. Pi calls a source-aware planning tool.
2. Gallery finds ambiguous names or broad unsafe results.
3. Gallery returns `status: "needs_clarification"` with structured choices.
4. Pi asks the user using those choices.
5. A follow-up call includes the selected choice references or clarified names.

## Persistence

Reuse existing tables wherever possible:

- `agent_selection_handle` can back materialized asset sources.
- `agent_operation.assetSelectionHandleId` can continue to point at the
  materialized selection.
- `agent_tool_call.redactedRequestMetadata` and
  `agent_tool_call.redactedResponseMetadata` should record compact source audit
  data.

Additive persistence may be needed for source references if selection handles
are too specific:

```ts
type AgentAssetSourceSnapshot = {
  sourceRef: string;
  sourceKind: 'search' | 'previousSearch' | 'selectionHandle' | 'explicitAssets';
  resolvedFilters?: AgentSearchAssetsFilters;
  declarativeFilters?: AgentDeclarativeAssetFilters;
  assetCount: number;
  sampleAssetIds: string[];
  sourceToolCallId: string | null;
  expiresAt: string;
};
```

The first implementation should prefer extending selection-handle metadata
before adding a new table. A new table is justified only if source references
need different lifecycle, audit, or deduplication semantics.

Transient search sources and durable plan snapshots have different lifecycles.
If existing selection handles back both concepts, the implementation must mark
or copy plan-backed handles so they remain usable until the plan reaches a
terminal state such as applied, superseded, cancelled, or deleted. Expiration of
the original `sourceRef` after plan creation must not change the plan contents
or make apply re-run the search.

## Error Handling

All source-aware tools should return structured statuses:

- `success`: a source was resolved and/or a plan was created.
- `needs_clarification`: user input is required before a safe plan can be
  created.
- `recoverable_error`: Pi can retry with corrected arguments.
- `denied`: permissions or policy prevent the requested access.

Examples:

```json
{
  "status": "needs_clarification",
  "summary": "I found two people named Pierre.",
  "clarification": {
    "kind": "person",
    "query": "Pierre",
    "choices": [
      { "choiceRef": "choice:person:1", "label": "Pierre", "thumbnailAssetId": "..." },
      { "choiceRef": "choice:person:2", "label": "Pierre M.", "thumbnailAssetId": "..." }
    ]
  }
}
```

```json
{
  "status": "recoverable_error",
  "summary": "That value is a person ID, not an asset ID.",
  "error": {
    "kind": "wrong_id_domain",
    "receivedDomain": "person",
    "expectedDomain": "asset",
    "instruction": "Use assetSource.search or asset IDs returned by searchAssets."
  }
}
```

## Security And Safety

- Source references are scoped to one session and user.
- Cross-session and cross-user source references are denied.
- Expired sources are denied with an instruction to rerun the search.
- The model never receives hidden asset IDs for large selections unless it asks
  for a bounded sample.
- Plans materialize the asset set before user review, so apply does not mutate a
  moving target.
- Existing permission presets still govern which filters, shared spaces,
  locked assets, previews, originals, and write scopes are allowed.
- High-level workflow tools create plans only; they do not apply plans.

## Testing Requirements

Every implementation plan derived from this spec must use TDD:

1. Write or update the relevant failing tests first.
2. Run the focused test command and confirm the expected red failure.
3. Implement the smallest behavior change for that slice.
4. Re-run the focused tests until green.
5. Run the slice's affected broader test set before committing.

The implementation plan for each slice must name the exact test files and test
commands it will use. It must also explicitly cover the edge cases listed under
that slice. If any edge case is impractical to automate in that slice, the plan
must say why and include a concrete manual verification step.

Expected test layers across the full project:

- DTO/schema tests for new source unions, declarative filters, source refs, and
  structured error shapes.
- Service unit tests for source resolution, ID-domain validation,
  materialization, plan creation, permission checks, and edge-case handling.
- Repository or medium tests for persistence, source-ref scoping, expiration,
  and operation-plan audit metadata.
- Runner flow integration tests for realistic smaller-model behavior, including
  the South Africa/Pierre/Aurelia failure path.
- Generated MCP docs/prompt tests to ensure examples prefer declarative sources
  and do not encourage copying raw UUIDs.
- Web component tests for clarification UI, source-backed plan review metadata,
  compact activity stability, and expanded activity detail.
- End-to-end tests for at least one successful source-backed album plan and one
  clarification-required flow.

Required regression scenarios:

- `personId` accidentally passed as an `assetId` returns a recoverable
  wrong-domain error.
- A valid previous search can be piped into a plan through `sourceRef`.
- Expired, cross-session, and cross-user `sourceRef` values are rejected safely.
- Declarative people OR filters resolve to the correct search filters.
- Ambiguous people return structured clarification choices.
- Empty and over-broad searches do not create misleading plans.
- Applying a source-backed plan uses the materialized asset snapshot, not a live
  re-query.
- A plan created from a source remains applyable after the original search
  `sourceRef` expires.
- Asset-bearing operations with multiple source mechanisms, or with no source
  mechanism, are rejected before plan persistence.
- Compact activity does not flicker while expanded activity shows detailed tool
  work.

## UX And Activity

The user-facing plan review should stay the main confirmation surface:

- show the created/changed destination;
- show materialized asset count;
- show representative thumbnails;
- show whether the asset set came from a search, prior search source, explicit
  assets, or selection handle;
- keep technical source details collapsed by default.

Verbose activity mode should show the source resolution steps:

- "Resolved people: Pierre, Aurelia"
- "Found 100 matching photos"
- "Prepared album plan"

Compact mode should continue to show low-noise "Pi is working" progress.

## Slices

Each slice below is intended to be independently plannable. Later slices build
on earlier ones, but each should leave the system in a useful, testable state.

### Slice 1: Typed Source And ID Domain Vocabulary

Introduce shared type definitions for:

- asset source kinds;
- declarative filters;
- source references;
- ID domains;
- structured source resolution statuses.

This slice can be type/schema-only plus contract tests. It does not need to
change runtime behavior.

Tests and edge cases:

- Zod/DTO schemas accept valid `search`, `previousSearch`, `selectionHandle`,
  and `explicitAssets` sources.
- Schemas reject missing `kind`, unknown source kinds, empty source refs, and
  malformed date strings.
- Declarative people/tag/album filters require non-empty names.
- ID-domain helper classifies known fixture IDs by table lookup or metadata
  source, and returns `unknown` safely for missing IDs.
- Shared source validation rejects asset-bearing operations with multiple source
  mechanisms and asset-bearing operations with no source mechanism.

### Slice 2: Wrong-Domain ID Validation

Harden existing ID-consuming tools before adding new declarative paths. When an
ID-shaped value is used in the wrong field, return a specific recoverable error.

Tests and edge cases:

- `readAssetMetadata(assetIds: [personId])` returns `wrong_id_domain` with
  expected `asset` and received `person`.
- `searchAssets.filters.personIds` with an asset ID returns a recoverable
  filter error.
- `proposeAlbumOperations.assetSelectionHandleId` with a person/asset ID
  returns an invalid handle/domain error.
- Unknown UUIDs still return a safe inaccessible/not-found response without
  leaking other users' data.
- Cross-user IDs do not reveal object names or ownership.

### Slice 3: Source References From Search

Extend `searchAssets(createSelectionHandle: true)` so the model-facing response
includes a typed `sourceRef` in addition to the existing selection handle.

Tests and edge cases:

- Search with a selection handle returns `sourceRef`,
  `selectionHandle.id`, count, sample IDs, and result size.
- `sourceRef` is not a raw UUID and clearly encodes the asset-source domain.
- Source refs are session-scoped and expire with the backing selection handle.
- Compact and metadata search modes both preserve source refs.
- Result truncation never removes `sourceRef` or corrupts source counts.

### Slice 4: Planning From `previousSearch`

Allow existing planning tools to accept `assetSource.previousSearch`, resolve it
to the backing materialized selection, and persist a normal operation plan.

Tests and edge cases:

- A plan created from `previousSearch.sourceRef` stores the correct materialized
  asset selection.
- Expired source refs are rejected with a recoverable rerun-search instruction.
- Cross-session and cross-user source refs are denied.
- Existing explicit `assetIds` and `assetSelectionHandleId` behavior remains
  unchanged.
- Operations that provide `assetSource` plus `assetIds` or
  `assetSelectionHandleId` are rejected instead of choosing a precedence order.
- Plan review response includes source audit metadata and no full asset ID dump.

### Slice 5: Declarative Filter Resolver

Add server-side conversion from `AgentDeclarativeAssetFilters` to existing
`AgentSearchAssetsFilters`, reusing resolver behavior for people, tags, albums,
spaces, camera fields, and shared-space people.

Tests and edge cases:

- `people.match = "any"` maps multiple names to one `personIds` OR filter.
- `people.match = "all"` is rejected or explicitly documented if unsupported by
  the current search backend.
- Ambiguous people return `needs_clarification` with choices.
- Missing people/tags/albums return `needs_clarification` or empty-result
  guidance, not a broad search.
- Date strings parse to stable UTC boundaries.
- Shared-space names resolve to `spaceId`; shared-space people resolve with
  both `spaceId` and `spacePersonIds`.
- Permission presets block disallowed scopes.

### Slice 6: Planning From `assetSource.search`

Allow existing planning tools to accept `assetSource.search`. The operation-plan
service resolves filters, runs the search, materializes a selection, and
persists the plan.

Tests and edge cases:

- The South Africa January Pierre/Aurelia request creates a reviewable album
  plan without exposing or copying asset IDs through the model.
- Broad searches over the configured cap return `needs_clarification` or
  bounded-selection guidance.
- Empty searches return a no-matches response and do not create a plan.
- Search result materialization is stable between plan creation and apply.
- Expiration of the original `sourceRef` after plan creation does not change the
  reviewed asset set and does not make apply fail due to source expiration.
- Plan audit records resolved filters, declarative filters, counts, and sample
  IDs.
- Existing apply behavior works with handle-backed operations.

### Slice 7: High-Level Album Workflow Tools

Add `proposeAlbumFromSearch` and `proposeAddAssetsToAlbumFromSearch` as thin
wrappers over source-aware planning.

Tests and edge cases:

- New album plus search source creates create-album and add-assets operations
  with correct dependencies.
- Existing album plus search source creates only add-assets operations.
- Duplicate existing album matches return clarification rather than guessing.
- Album name/description validation matches current plan constraints.
- All writes remain proposed plans; nothing applies automatically.
- Generated MCP docs show these as preferred tools for album-from-search tasks.

### Slice 8: High-Level Space Workflow Tools

Add `proposeSpaceFromSearch` and `proposeAddAssetsToSpaceFromSearch`.

Tests and edge cases:

- New space plus search source creates create-space and add-assets operations.
- Existing space plus search source uses `targetId`, not
  `temporaryTargetId`.
- Shared-space permission presets are enforced.
- Existing membership is handled consistently with current space planning
  semantics.
- Ambiguous space names return clarification choices.

### Slice 9: High-Level Asset Batch Workflow Tool

Add `proposeAssetBatchFromSearch` for actions such as favorite, archive, tag,
rotate, visibility changes, and future image edits.

Tests and edge cases:

- Favorite/archive/tag/rotate plans can be created from a declarative source.
- Unsupported batch operation types are rejected before plan persistence.
- Rotate angles and tag payloads reuse existing validation.
- Destructive/high-risk operations keep the correct risk level and review copy.
- Empty or over-broad sources do not create plans.

### Slice 10: Clarification Loop UI And Message Blocks

Represent `needs_clarification` responses in chat so Pi can present clear
choices and the user can answer naturally or click a choice.

Tests and edge cases:

- Ambiguous people render concise choices with optional thumbnails.
- Choice refs do not expose unsafe internal IDs.
- User selection can be included in the next tool call.
- Reloading the session preserves the clarification context.
- Text-only fallback works when thumbnails are unavailable.

### Slice 11: Prompt, Generated Docs, And Examples

Update MCP docs and runner instructions to make declarative planning the
default path:

- use high-level workflow tools first;
- use `assetSource.search` when the filter intent is known;
- use `previousSearch.sourceRef` after inspection;
- use explicit IDs only for small inspected sets;
- treat wrong-domain and clarification responses as recoverable.

Tests and edge cases:

- Generated docs include end-to-end examples for album, space, and batch
  workflows.
- Examples do not encourage copying raw UUIDs.
- Existing contract mistake tests still cover old low-level tools.
- The South Africa/Pierre/Aurelia prompt appears as a regression example.

### Slice 12: Observability And Activity Polish

Make source-aware workflows visible in expanded activity and quiet in compact
activity.

Tests and edge cases:

- Expanded activity shows resolver/search/materialization/plan steps in stable
  order.
- Compact activity does not flicker when multiple tool calls complete.
- Failed source resolution records terminal failed activity when unrecovered.
- Successful plan creation records "prepared plan" activity with counts.
- Redacted audit metadata contains source summaries, not huge ID lists.

## End-To-End Regression Matrix

These flows should become durable regression tests across slices:

1. "Create an album for South Africa in January this year with Pierre OR
   Aurelia" creates a plan from `assetSource.search`.
2. Same request with two matching people named Pierre returns clarification
   choices.
3. Same request with zero matching photos creates no plan and explains no
   matches.
4. Same request with too many matching photos asks to narrow or creates only a
   bounded reviewable selection according to preset limits.
5. Search-inspect-plan flow uses `previousSearch.sourceRef` and never pastes
   hundreds of asset IDs.
6. Wrong-domain ID calls return recoverable `wrong_id_domain` errors.
7. Cross-session source refs are denied without leaking data.
8. Expired source refs tell Pi to rerun the search.
9. Applying a source-backed plan adds the expected materialized assets and keeps
   the chat open.
10. Compact activity stays stable while expanded activity shows detailed source
    resolution steps.

## Design Decisions

### `people.match = "all"`

Gallery currently handles `personIds` as the practical "any of these people"
case for this workflow. Requiring every selected person in the same asset may
need additional search semantics. Implement `any` first. Reject `all` with a
clear unsupported clarification until the backend can prove it.

### Source Reference Storage

Back `sourceRef` with existing selection handles first. Add a new
`agent_asset_source` table only if selection handles cannot express the needed
lifecycle or audit semantics without becoming overloaded.

### High-Level Tool Count

Add a small set of high-level tools by domain, not one catch-all "do anything"
tool. Album, space, and batch workflows map cleanly to existing review plans and
are easier for smaller models to call correctly.

## Success Criteria

- Pi can create the South Africa January Pierre/Aurelia album plan on the first
  attempt with a smaller model.
- The model does not need to inspect, copy, or transform asset IDs for ordinary
  album/space/batch planning.
- Broad results stay compact in model context.
- Wrong-domain ID mistakes produce actionable, recoverable errors.
- Every proposed mutation remains a reviewable plan.
- Plans are deterministic because asset sources are materialized at plan
  creation.
- The feature is covered by TDD unit, service, integration, generated-docs, and
  UI tests for the edge cases listed above.
