# Pi Agent MCP Minimal Context Design

Status: approved design
Date: 2026-05-21
Branch: `explore/pi-agent-brainstorm`

## Purpose

Pi can now use Gallery MCP tools to search, inspect, and plan photo-library
changes, but broad tool results can quickly consume the model context window.
In one personal-instance session, the visible chat was tiny, but repeated
`searchAssets` and `readAssetMetadata` calls returned hundreds of full asset
metadata rows. MCP then represented the same large result both as text content
and as structured content, causing more than a megabyte of runner-only context
before the next model turn.

This design changes the MCP contract around one principle: Gallery tools should
return the smallest useful payload by default, and Pi should explicitly ask for
more detail only when it needs it.

## Goals

- Make MCP read tools minimal by default.
- Let Pi request additional fields, samples, pages, or media references
  explicitly.
- Preserve Gallery's safety model: reads are permission-scoped, writes only
  happen through reviewable plans.
- Keep broad searches and large plans workable for hundreds or thousands of
  photos.
- Prevent duplicate MCP payloads from entering runner context.
- Add context-budget observability and guardrails so large tool transcripts are
  visible before they fail a model request.
- Teach smaller models to use progressive discovery: resolve names, search
  compactly, inspect only the assets that actually need detail, then propose a
  plan.

## Non-Goals

- No direct apply/write MCP tools.
- No exposing original paths, storage keys, checksums, raw filesystem paths, or
  unredacted secrets.
- No automatic deletion/trash/archive behavior outside plan review.
- No requirement to load thumbnails, previews, or originals during ordinary
  metadata planning.
- No attempt to solve all long-running session memory issues outside the Pi
  runner and Gallery MCP boundary.

## Current Behavior

The current read tools often return full structured objects even when Pi only
needs IDs or counts:

- `searchAssets` returns full `AgentAssetMetadata[]`.
- `readAssetMetadata` returns full `AgentAssetMetadata[]`.
- `AgentMcpService.toolResult()` serializes the same result twice:
  - `content[0].text = JSON.stringify(structuredContent)`
  - `structuredContent = structuredContent`
- The Pi runner currently creates sessions with compaction disabled.
- The audit records stored in Gallery are compact, but the runner's internal
  Pi transcript keeps full MCP tool responses.

This means the UI can look simple while the runner context has become large.

## Design Principles

### Minimal By Default

Every read tool should have a compact default response that is enough for the
next likely decision, not every possible future decision.

For example, a broad `searchAssets` call should return:

- returned count;
- has-more/next-page state;
- asset IDs for the returned page;
- a small representative sample when requested or useful;
- a plain summary.

Later slices can add a stable result handle for large selections, but the first
compact-search implementation should keep page-level asset IDs because existing
planning tools already consume explicit IDs.

It should not return full EXIF, tags, filenames, and dates for hundreds of
assets unless Pi asked for those fields.

### Explicit Detail Expansion

Pi can request more data through explicit fields or detail levels:

- `fields`: named field groups such as `dates`, `location`, `camera`, `tags`,
  `rating`, `filename`, `visibility`, `dimensions`.
- `sample`: representative examples for reasoning or user explanation.
- `limit` and `page`: bounded paging.
- `assetIds`: direct inspection of a known subset.
- future `resultHandle`: inspection or planning against a saved bounded result.

If the model does not request a field, Gallery should omit it.

### Progressive Discovery

MCP examples and runner guidance should prefer this sequence:

1. Resolve names to IDs when needed.
2. Search using compact output.
3. Inspect only the missing fields for the smallest necessary subset.
4. If the result is broad, ask a narrowing question or propose a plan from a
   saved bounded selection rather than stuffing all metadata into context.
5. Propose reviewable operations only after the selected asset set is clear.

### Context Is A Budget

Gallery should treat MCP response size as part of the session budget:

- estimate bytes and approximate tokens per tool response;
- persist compact telemetry for tool-response size;
- expose a developer-visible activity/detail hint when a response is large;
- stop or truncate responses that exceed per-tool or per-turn budget;
- prefer a structured "more detail required" result over failing the next model
  call.

## Proposed MCP Contract Changes

### Shared Response Envelope

Read tools should return an envelope with compact metadata:

```ts
type AgentMcpReadSuccess<T> = {
  status: 'success';
  toolCall: AgentToolCallResponseDto;
  summary: string;
  data: T;
  resultSize: {
    returnedItems: number;
    hasMore: boolean;
    nextPage: string | null;
    estimatedBytes: number;
    truncated: boolean;
    omittedFields: string[];
  };
};
```

The exact DTOs can remain tool-specific, but every read response should expose
enough size/truncation metadata for Pi and Gallery UI to understand whether more
calls are needed.

### No Duplicate Structured Results

For MCP `tools/call` responses, Gallery should stop duplicating large results.

Preferred shape:

```json
{
  "content": [
    {
      "type": "text",
      "text": "Returned 250 compact asset IDs; more results available on page 2."
    }
  ],
  "structuredContent": {
    "status": "success",
    "summary": "Returned 250 compact asset IDs; more results available on page 2.",
    "data": {}
  }
}
```

The text content should be human-readable and short. The structured content
should carry machine-readable data once, not a JSON string copy of itself.

### `searchAssets`

Default behavior should be ID-first:

```ts
type SearchAssetsRequest = {
  mode?: 'metadata' | 'smart' | 'description' | 'ocr' | 'filename';
  query?: string;
  filters?: AgentSearchAssetsFilters;
  limit?: number;
  page?: number;
  order?: AgentSearchAssetsOrder;
  detail?: 'ids' | 'summary' | 'metadata';
  fields?: AgentAssetMetadataField[];
  sampleSize?: number;
};
```

Default:

- `detail: 'ids'`
- no full metadata;
- bounded `limit`;
- includes `assetIds`, `returnedCount`, `hasMore`, `nextPage`;
- optionally includes a tiny `sample` with only requested fields.

`detail: 'summary'` can include compact per-asset rows with only requested
fields. `detail: 'metadata'` can return richer rows, but still honors field
selection and hard response budgets.

### `readAssetMetadata`

`readAssetMetadata` should accept either:

- `fields`, or
- a detail preset such as `basic`, `descriptive`, `technical`, `allSafe`.

Default should be the conservative `basic` detail preset:

- IDs;
- type;
- dates;
- location if requested;
- people/tags only if requested and permissioned;
- no raw paths or storage internals.

Large reads should return a compact partial result with `omittedFields` and a
clear instruction to page or request fewer assets.

### Plan Tools

Plan tools often need concrete asset IDs, but Pi does not need full metadata
for every asset to propose a plan.

`proposeAlbumOperations` and future planning tools should accept:

- explicit `assetIds` for small/medium selections;
- a future `selectionHandle` for large selections created by `searchAssets`;
- operation summaries and counts that do not duplicate every asset detail in the
  chat transcript.

The initial implementation can keep explicit IDs, but the design should leave a
path to `selectionHandle` so thousands of photos do not have to be copied
through model context.

## Runner Behavior

The runner should be updated so Pi does not treat every tool result as permanent
high-value context.

Runner rules:

- enable Pi compaction or add a Gallery-owned compaction policy;
- summarize large tool results before the next model call;
- keep the latest user request, plan state, pending approval state, and compact
  tool summaries;
- avoid retaining large raw MCP payload text after it has been converted into a
  result handle or compact summary;
- surface a runner error with a useful cause if context budget is exceeded
  despite guardrails.

## UX And Observability

For normal users, this should be mostly invisible. Pi should simply keep
working.

For debugging and activity preview:

- tool cards can show "Returned 250 matching photos" rather than raw metadata;
- expanded technical details can show response size, omitted fields, page, and
  whether the result was truncated;
- session details can show an approximate runner-context size bucket:
  `small`, `medium`, `large`, `near limit`.

## Test Strategy

Use TDD for every slice. Each implementation slice starts with failing unit,
integration, or runner tests that lock the intended contract before production
code changes.

Coverage should include:

- MCP response shape and no large duplicate JSON text.
- `searchAssets` defaulting to compact ID output.
- explicit field selection and omitted-field behavior.
- large-result truncation and pagination.
- read permissions continuing to gate metadata, previews, and originals.
- inaccessible assets, people, albums, spaces, tags, and locked visibility not
  leaking through compact defaults, samples, handles, or error messages.
- generated OpenAPI/SDK and MCP docs staying consistent with DTO changes.
- runner behavior after large tool results.
- correction-hint examples that teach smaller models to request more detail
  incrementally.

## Slices

### Slice 1: Stop MCP Payload Duplication

Change `AgentMcpService.toolResult()` so `content[0].text` is a compact summary
and full data exists only in `structuredContent`.

TDD requirements:

- Add MCP service tests before implementation.
- Assert small results still include useful text content.
- Assert large structured results are not JSON-stringified into text.
- Assert text content stays below a fixed small maximum even for large
  structured results.
- Assert validation and error responses remain compatible.
- Assert approval-required responses still include enough user-facing text for
  the MCP client.
- Assert existing MCP clients still receive valid `content` and
  `structuredContent` fields.

Edge cases:

- Result without `summary`.
- Result with nested arrays.
- Result with `status: approval-required`.
- Result with validation errors.

### Slice 2: Compact `searchAssets` Defaults

Make `searchAssets` return IDs and paging metadata by default. Add `detail`,
`fields`, and `sampleSize` support without removing current capabilities.

TDD requirements:

- Add DTO tests for `detail`, `fields`, and `sampleSize`.
- Add service tests proving default search omits full metadata.
- Add tests proving requested fields are included and unrequested fields are
  omitted.
- Add tests for pagination, `hasMore`, and next page.
- Add tests for broad searches near the per-tool limit.
- Add permission-boundary tests for shared spaces, locked visibility, people,
  albums, and tags when compact defaults or samples are requested.
- Add OpenAPI/SDK snapshot or generation-drift tests for the new DTO fields.

Edge cases:

- No filters and no query.
- Empty results.
- `detail: metadata` with no fields.
- Unknown fields.
- Limit above max.
- Sample size greater than returned count.
- Requested sample contains inaccessible assets after filtering.
- `detail: metadata` requests fields not allowed by the session permission plan.

### Slice 3: Field-Selected Metadata Reads

Update `readAssetMetadata` to support field groups and conservative defaults.
Pi should ask for the exact metadata it needs instead of receiving every safe
metadata field for every asset.

TDD requirements:

- Add DTO and service tests before implementation.
- Verify default read is compact.
- Verify each field group maps to expected response fields.
- Verify permission plans still gate tags, people, previews, originals, locked
  assets, and shared-space scope.
- Verify large reads are truncated or rejected with actionable guidance.
- Verify generated API types and MCP docs describe every field group and detail
  preset.

Edge cases:

- Duplicate asset IDs.
- Missing/deleted/offline assets.
- Assets without EXIF.
- Assets without tags or people.
- Mixed accessible and inaccessible assets.
- Rich fields requested for assets whose data is null or partially missing.
- Field groups that overlap, such as `dates` plus `technical`.

### Slice 4: Context Budget Telemetry And Guards

Record estimated MCP response size and expose it through tool-call technical
details and runner activity. Add a per-tool response budget that returns a
partial/truncated result before the runner hits the model context limit.

TDD requirements:

- Add repository/service tests for persisted size metadata.
- Add DTO tests for response `resultSize`.
- Add UI tests for technical-detail display.
- Add integration tests where a large result returns truncated data with
  `omittedFields`.
- Add tests proving truncation does not alter permission checks or return
  hidden inaccessible items.
- Add tests proving approval-required and denied tool calls still report useful
  size metadata when no result payload exists.

Edge cases:

- Estimate unavailable.
- Result exactly at the budget.
- Result one item over the budget.
- Multiple pages adding up to a large session transcript.
- Truncation after sorting or paging; ordering must remain stable.
- Budget exceeded while serializing nested field groups.

### Slice 5: Runner Compaction And Large-Tool Summaries

Enable or implement runner-side compaction for Gallery sessions. Large MCP tool
results should be summarized before subsequent model calls.

TDD requirements:

- Add agent-runner tests before implementation.
- Verify compaction is enabled or Gallery summary compaction is applied.
- Verify the runner preserves current user intent, pending approval state, and
  plan references.
- Verify large raw tool payloads do not remain in the next model call.
- Verify context-window provider errors are surfaced as actionable runner
  errors.
- Verify resume-after-approval continues with a compact approved-result summary
  instead of replaying the full raw result.
- Verify streaming deltas and activity events still flow while compaction is
  active.

Edge cases:

- Compaction fails.
- Tool approval is pending during compaction.
- Resume after approval with a large approved result.
- Session reload after runner restart.
- Provider refuses the compaction request.
- A compacted session later asks for a field that was omitted from the summary.

### Slice 6: MCP Prompt And Examples For Progressive Detail

Update generated MCP docs and runner prompt cheat sheet so smaller models learn
the new minimal contract.

TDD requirements:

- Add prompt/doc generation tests before implementation.
- Verify examples use compact search first.
- Verify examples ask for `fields` only when needed.
- Verify correction hints discourage `limit: 1000` and full metadata reads for
  broad searches.
- Verify no examples use direct write/apply tools.
- Verify examples explain how to page or request more detail after a truncated
  result.
- Verify generated docs do not include private endpoints, bearer tokens,
  storage paths, or raw result handles.

Edge cases:

- Name resolution before search.
- Broad search with many results.
- User asks for visual curation.
- User asks for exact technical metadata.
- User asks to create a large album.
- User asks "all photos" without a narrowing criterion.
- User asks for a visual curation task where previews may be appropriate.

### Slice 7: Large Selection Handles

Add a server-side selection handle so Pi can plan changes against a bounded
large result without copying thousands of asset IDs through model context.

TDD requirements:

- Add service/repository tests before implementation.
- Verify handles are session-scoped, user-scoped, expiring, and permission
  checked.
- Verify plan tools can consume a handle and materialize asset IDs server-side.
- Verify handles cannot be reused across sessions or users.
- Verify plan review still shows counts, samples, and selected assets without
  eager thumbnail loading.
- Verify concurrent plan creation, revision, and apply attempts using the same
  handle are deterministic.
- Verify audit logs and activity cards show handle-derived counts without
  storing the entire asset set in chat messages.

Edge cases:

- Expired handle.
- Handle after assets changed/deleted.
- Handle from a truncated result.
- User deselects a subset before applying.
- Thousands of assets in the handle.
- Duplicate assets in the saved selection.
- User permissions change between handle creation and plan application.

## Decisions

- `searchAssets` defaults to returning page-level asset IDs for now because
  existing planning tools use explicit IDs and each page is bounded. Server-side
  selection handles are added later for truly large workflows.
- `readAssetMetadata` defaults to the `basic` detail preset for compatibility,
  but richer fields must be requested explicitly.
- Response-size budgets start as conservative global limits, then can derive
  from model metadata once model context windows are reliably available.

## Rollout

Roll this out incrementally:

1. Remove response duplication first because it is low risk and immediately
   reduces context size.
2. Add compact search defaults while preserving opt-in rich metadata.
3. Add compact metadata reads and prompt examples.
4. Add telemetry and runner compaction.
5. Add selection handles for truly large workflows.

Existing sessions may still contain large runner transcript state. New sessions
should benefit immediately after the first two slices.
