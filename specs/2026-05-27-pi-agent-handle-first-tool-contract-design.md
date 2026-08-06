# Pi Agent Handle-First Tool Contract Design

Status: draft design
Date: 2026-05-27
Branch: `explore/pi-agent-brainstorm`

## Purpose

Pi currently has server-side selection handles, but search results still expose
raw asset IDs unless the model remembers to pass `createSelectionHandle: true`.
That opt-in contract is too fragile. In session
`7b881ccd-b8a3-42f3-bf4f-7568de57cf2b`, Pi searched a bounded USA trip date
range, found 80 valid assets, then called `readAssetMetadata` with 85 unrelated
UUIDs that did not exist in the `asset` table. The actual Gallery queries were
fast; the turn became slow because the model spent minutes recovering from its
own bad ID plumbing and eventually failed to create a plan.

The fix is to stop making the model traffic asset IDs. The model should
orchestrate user intent, criteria, and workflow choices. Gallery should own
search result materialization, asset identity, metadata reads, curation,
ranking, and plan materialization.

## Current State

The branch already has these pieces:

- `searchAssets` can create a server-side `agent_selection_handle` when
  `createSelectionHandle` is true.
- Planning operations accept `assetSelectionHandleId` and can materialize
  handle assets into reviewable operations.
- Workflow tools can create plans from declarative searches or previous search
  source refs.
- Prompt guidance tells Pi to use handles for large selections.

The gaps are structural:

- Handles are optional.
- `searchAssets` returns raw `assetIds` when handles are not requested.
- `readAssetMetadata`, preview reads, and planning examples still normalize the
  idea that Pi can copy asset IDs between tools.
- Candidate-set curation still relies on the model to select and paste IDs
  instead of asking Gallery to derive a smaller selection.
- Search limits are still sized as if every result might enter the prompt.

## Goals

- Make search-derived asset IDs invisible to the LLM by default.
- Make every `searchAssets` result materialize a selection handle, including
  one-asset and zero-asset result sets.
- Replace model-facing raw asset ID flows with handle-based read, curation, and
  planning flows.
- Let Gallery perform server-side narrowing so Pi can ask for "20 highlights"
  without seeing or copying 80 candidate IDs.
- Raise search limits where safe because prompt size is decoupled from result
  count.
- Preserve user review: no direct writes, no automatic apply.
- Keep enough compact evidence for Pi to explain what happened without exposing
  UUID lists.
- Use TDD for each implementation slice.

## Non-Goals

- No direct write/apply tool.
- No public model-facing bulk `assetIds` response from search tools.
- No immediate full image-quality scoring pipeline.
- No requirement that the LLM personally inspect every candidate.
- No unlimited whole-library operations. Handles remain bounded by session
  permissions, tool limits, and expiry.
- No removal of internal asset IDs from server logs, database rows, or review
  plan internals. This design is about the provider-visible MCP contract.

## Design Principles

### Handles Are The Unit Of Asset Set State

Any tool that produces an asset set returns a handle. Any tool that consumes an
asset set accepts a handle or a declarative source that Gallery materializes into
a handle. Raw asset IDs are internal implementation details.

### The LLM Orchestrates, Gallery Selects

Pi can say:

> Search photos from May 24 through today, then curate 20 metadata-based trip
> highlights with date/location variety.

Gallery should execute that as handles and server-side transforms. Pi should not
receive 80 UUIDs, choose 20 UUIDs, and paste them into a planning tool.

### Small Results Are Not Special

A one-asset result set is still a selection handle. The consistency is worth
more than the tiny savings from letting the model see one UUID. Small handles
also make cover selection, single-photo metadata edits, and exact-match searches
use the same planning path as large searches.

### Prompt Size And Search Size Are Separate

Search may return or materialize hundreds or thousands of assets server-side,
but Pi sees only counts, source refs, facets, criteria, and bounded samples. The
sample is for explanation and orientation, not for copying IDs.

## Proposed Contract

### `searchAssets`

`searchAssets` always creates a selection handle.

Model-facing response:

```ts
type SearchAssetsResult = {
  summary: string;
  detail: 'handle' | 'summary' | 'metadata';
  selectionHandle: {
    id: string;
    sourceRef: string;
    assetCount: number;
    sourceToolCallId: string;
    expiresAt: string;
  };
  resultSize: {
    returnedItems: number;
    hasMore: boolean;
    nextPage: string | null;
    truncated: boolean;
    omittedFields: string[];
  };
  sample?: AgentSelectionSample;
  facets?: AgentSelectionFacets;
};
```

Model-facing response must not contain `assetIds`. Server-side
`redactedResponseMetadata` may store handle IDs, counts, source refs, and sample
metadata. It should not store a full provider-visible asset ID list for
successful searches.

The request field `createSelectionHandle` becomes unnecessary and should be
ignored or deprecated. If a caller sends `createSelectionHandle: false`, Gallery
still creates a handle.

Existing requests that send `detail: "ids"` may be accepted as a compatibility
alias during migration, but the provider-visible response should be normalized to
`detail: "handle"` and must not contain IDs. Tool descriptions, generated docs,
and prompts should stop advertising `detail: "ids"` once Slice 2 lands.

### Selection Samples

Samples are allowed only for orientation. They should avoid database UUIDs.

```ts
type AgentSelectionSample = {
  sampleSize: number;
  items: Array<{
    itemRef: string;
    takenAt?: string;
    localDate?: string;
    city?: string | null;
    state?: string | null;
    country?: string | null;
    favorite?: boolean;
    rating?: number | null;
    type?: string;
    tags?: string[];
    albumNames?: string[];
  }>;
};
```

`itemRef` is handle-local and opaque, such as `item:001`. It is not an asset ID
and is not accepted by planning tools as an asset identifier. Future tools may
use item refs for explicit include/exclude adjustments within the same handle,
but the first version should prefer criteria-based server-side curation.

### Handle Read Tools

Add or reshape read tools so Pi can inspect a handle without raw IDs:

```ts
type ReadSelectionMetadataRequest = {
  selectionHandleId: string;
  fields: AgentSearchAssetsField[];
  sampleSize?: number;
  aggregate?: boolean;
};
```

The response returns aggregate counts, facets, and a bounded itemRef sample. It
does not return asset IDs.

Existing `readAssetMetadata(assetIds)` remains an internal/server capability
where needed, but the MCP contract exposed to external providers should move to
handle reads. If backward compatibility keeps the raw-ID mode temporarily, it
must be marked legacy, omitted from normal prompt guidance, and covered by tests
that prove search-derived IDs are not required for metadata inspection. The
target end state is that provider-facing reads use handles or server-created UI
context handles, not pasted UUID arrays.

### Selection Transform Tools

Add server-side selection transforms:

```ts
type CurateSelectionRequest = {
  selectionHandleId: string;
  targetCount: number;
  strategy: 'metadata-highlights' | 'date-spread' | 'favorites-first' | 'cover-candidate';
  criteria?: string;
  constraints?: {
    types?: Array<'IMAGE' | 'VIDEO'>;
    includeFavorites?: boolean;
    minRating?: number;
    excludeVideos?: boolean;
    diversifyBy?: Array<'date' | 'location' | 'people' | 'tags'>;
  };
};
```

Response:

```ts
type CurateSelectionResult = {
  selectionHandle: {
    id: string;
    sourceRef: string;
    assetCount: number;
    sourceToolCallId: string;
    expiresAt: string;
  };
  criteriaSummary: string[];
  sourceAssetCount: number;
  selectedAssetCount: number;
  sample?: AgentSelectionSample;
};
```

This tool is deterministic and metadata-based in the first version. It should
prefer favorites and ratings, then diversify across date/location signals. It
must disclose that it is metadata-based and not objective image-quality scoring.

Later, the same shape can support preview-assisted and
`analyzeAssetQuality`-assisted strategies without changing planning tools.

### Planning Tools

Planning tools should accept handles and source objects, not raw IDs, in
model-facing schemas.

Allowed model-facing asset mechanisms:

- `assetSelectionHandleId`
- `assetSource.search`
- `assetSource.previousSearch`
- `assetSource.selectionHandle`

Raw `assetIds` and `assetSource.explicitAssets` should become legacy/internal for
provider-facing calls. If an MCP provider sends raw `assetIds` or
`assetSource.explicitAssets` for any asset-bearing planning operation, Gallery
should return a recoverable validation error:

> Use a selection handle. Rerun `searchAssets` or `curateSelection` and pass the
> returned `selectionHandle.id` as `assetSelectionHandleId`.

Plan persistence can continue storing materialized asset IDs internally so
review/apply remains durable after transient handles expire.

Internal service calls, persisted plan rows, review UI APIs, and apply code may
continue using raw asset IDs after the provider-visible boundary. The important
rule is that Pi does not receive, choose, or paste UUID arrays while orchestrating
tools.

### Workflow Tools

Keep and expand high-level workflow tools for common tasks:

- `proposeAlbumFromSearch`
- `proposeAddAssetsToAlbumFromSearch`
- `proposeAssetBatchFromSearch`
- new `proposeAlbumFromSelection`
- new `proposeAssetBatchFromSelection`
- optional `proposeHighlightAlbumFromSearch`

The "from search" tools should internally materialize a handle and never expose
raw IDs. The "from selection" tools should accept an existing handle, often one
created by `curateSelection`.

## Example Flows

### USA Trip Highlights

User:

> Create an album of the top highlights for my recent trip to USA.

Flow:

1. Pi asks for dates/places/count if missing.
2. Pi calls `searchAssets` with the date/location filters.
3. Gallery returns handle `h1`, `assetCount: 80`, compact facets/sample.
4. Pi calls `curateSelection` with `h1`, `targetCount: 20`,
   `strategy: metadata-highlights`, and user criteria.
5. Gallery returns handle `h2`, `assetCount: 20`, criteria summary, sample.
6. Pi calls `proposeAlbumFromSelection` or `proposeAlbumOperations` with
   `assetSelectionHandleId: h2`.
7. Gallery creates a reviewable plan. The UI shows thumbnails from the
   materialized plan.

Pi never sees or copies the 80 candidate asset IDs or the final 20 asset IDs.

### Cover Selection

1. `readAlbum` returns album metadata and an album asset selection handle, not a
   full asset ID list.
2. Pi calls `curateSelection` with `strategy: cover-candidate`,
   `targetCount: 1`.
3. Gallery returns a one-asset handle.
4. Pi proposes `album.setCover` with the one-asset handle.

### Metadata Edit From Search

1. Pi calls `searchAssets` for "photos from Paris without coordinates."
2. Gallery returns a handle and count.
3. Pi asks for explicit coordinates if needed.
4. Pi calls `proposeAssetBatchFromSelection` with the handle and metadata
   update operation.

## Limits

Search limits should be reinterpreted:

- `maxAssetsPerToolCall` controls how many assets a tool may materialize into a
  handle, not how many IDs enter the prompt.
- Search page limits can increase beyond 200 for handle-only responses.
- Metadata samples remain small, for example 10-25 items.
- Curation transform inputs can be larger than prompt samples, but should have
  explicit caps and return a narrowing error when exceeded.
- Planning still has operation-specific safety limits. A handle with too many
  assets for a write operation should be rejected before plan creation.

Suggested first-pass limits:

- Search handle page: up to 1,000 assets when the session `maxAssetsPerToolCall`
  allows it.
- Curation input: up to 1,000 metadata-only candidates.
- Preview-assisted curation: keep current smaller bound until preview analysis
  is designed.
- Plan write handle: keep existing operation-plan maximums unless explicitly
  changed in a later slice.

## Error Handling

- Invalid or expired handle: return recoverable error with same-session valid
  handle options when available.
- Cross-session handle: reject as invalid and do not leak whether it exists.
- Empty handle: answer directly or ask for a broader source; do not create an
  empty write plan unless the user asked for an empty album.
- Oversized handle for operation: return a narrowing instruction and suggested
  transform.
- Legacy raw IDs from provider, including `assetSource.explicitAssets`: return a
  recoverable "use handle" validation error.
- Model requests metadata for non-existent item refs: return a handle-local
  itemRef validation error, not an asset access error.

## UI And Review

The review UI continues to use materialized plan asset IDs internally for
thumbnail display and apply. This design does not require hiding IDs from the
browser or from authenticated Gallery APIs. The important boundary is the
provider-facing MCP contract.

Plan review metadata should include:

- source handle count,
- curation criteria summary,
- sample thumbnails,
- whether previews or metadata-only signals were used,
- whether the source was sampled or fully considered.

## Testing Requirements

Every slice must use TDD:

1. Add failing tests that prove the current raw-ID behavior, missing handle
   behavior, or missing validation behavior for that slice.
2. Implement the smallest change that makes those tests pass.
3. Run the focused tests and relevant package checks before expanding the slice.
4. Add or update contract/prompt documentation tests in the same slice whenever a
   provider-facing schema, generated tool description, or runner prompt changes.
5. Add regression coverage for the USA-trip failure mode by the end of Slice 6:
   successful search result, no raw IDs exposed, curation returns a smaller
   handle, planning uses the handle and produces a plan.

Each implementation slice should be planned independently. A slice is done only
when its tests fail before implementation, pass after implementation, and the
verification command is recorded in the slice plan or commit notes.

Required coverage:

- `searchAssets` always creates a handle, including zero and one asset results.
- `searchAssets` provider-visible results never contain `assetIds`.
- `createSelectionHandle: false` cannot disable handle creation.
- `detail: "ids"` request compatibility returns a handle-only response and is not
  advertised in generated MCP docs or prompts.
- Runner compaction and tool-call redaction never expose raw asset IDs from
  search results.
- `readSelectionMetadata` returns aggregate/sample data without asset IDs, even
  for `metadata` detail requests.
- `curateSelection` produces a derived handle and records criteria metadata.
- Planning accepts selection handles and persists durable materialized plans.
- Planning rejects provider-facing raw `assetIds` with recoverable guidance.
- Expired/cross-session handles are rejected without leaking data.
- Search limits can be raised without increasing prompt payload size.

Edge-case coverage matrix:

| Area                         | Required edge cases                                                                                                                                                                                                                                                                                                                                                |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Search handle creation       | zero results; one result; exactly-at-limit results; over-limit/truncated results; `createSelectionHandle: true`; `createSelectionHandle: false`; omitted `createSelectionHandle`; `detail: "ids"` compatibility; `summary` and `metadata` detail responses; no UUID-shaped values in response samples.                                                             |
| Search pagination and limits | `hasMore` and `nextPage` still work without IDs; raised handle limits respect `maxAssetsPerToolCall`; oversized searches return narrowing guidance; prompt payload size stays bounded for 1,000-result handles.                                                                                                                                                    |
| Selection handle security    | missing handle; expired handle; cross-session handle; cross-user handle; wrong-domain UUID passed as a handle; deleted or no-longer-readable assets between handle creation and materialization.                                                                                                                                                                   |
| Handle reads                 | omitted fields; unknown fields rejected by DTO; `sampleSize` zero/negative/too large validation; aggregate-only reads; sample reads; item refs remain handle-local and cannot be used as asset IDs.                                                                                                                                                                |
| Curation transforms          | `targetCount < 1` rejected; `targetCount > sourceAssetCount` selects available assets with a warning; over-cap source handle returns narrowing guidance; missing dates/locations/ratings handled deterministically; ties are deterministic; videos are included/excluded according to constraints; empty source returns an empty derived handle and no write plan. |
| Planning                     | handle materializes to durable internal asset IDs; stale handle revalidation reports dropped or unavailable assets; empty handles are rejected for write operations unless the operation explicitly supports empty targets; cover operations require exactly one asset; metadata edits require explicit latitude and longitude rather than geocoding place names.  |
| Provider-visible redaction   | MCP responses, expected metadata, stored tool-call result metadata used for runner context, generated prompt cheat sheets, generated tool docs, and recovery guidance contain handles/counts/samples but no full asset ID arrays.                                                                                                                                  |
| UI context handles           | album assets, space assets, current selection, and previous search context are converted to session-scoped handles before Pi sees them; resumed sessions do not rehydrate raw asset arrays into provider context.                                                                                                                                                  |
| Regression flow              | the USA-trip session shape completes through search handle -> metadata-only curation handle -> reviewable album plan without any raw asset IDs entering the model-visible transcript.                                                                                                                                                                              |

## Implementation Slices

### Slice 1: Mandatory Handles For Search

- Change `searchAssets` to always create a selection handle.
- Remove full `assetIds` from provider-visible result metadata and MCP result
  payloads.
- Treat `detail: "ids"` as a deprecated request alias for compact handle-only
  responses, or rename it to `detail: "handle"` at the DTO boundary.
- Keep internal logs/audit safe and useful with handle IDs, counts, source refs,
  and sample metadata.
- TDD checks: zero/one/many-result searches create handles; explicit
  `createSelectionHandle: false` cannot suppress a handle; no provider-visible
  response path contains `assetIds`; compatibility `detail: "ids"` returns
  `detail: "handle"` or equivalent handle-only metadata.

### Slice 2: Runner And Prompt Redaction

- Update runner compaction so large tool results cannot leak raw asset IDs.
- Update prompt guidance to say search returns handles only.
- Remove prompt language that encourages selected raw `assetIds` after
  metadata-only curation.
- Regenerate MCP tool docs and prompt cheat sheets.
- TDD checks: prompt/docs tests fail on old `detail: "ids"`/`readAssetMetadata`
  guidance; runner compaction redacts nested search result ID arrays; activity
  metadata still exposes useful counts and handle IDs.

### Slice 3: Handle-Based Reads

- Add `readSelectionMetadata` or equivalent handle read mode.
- Mark raw `readAssetMetadata(assetIds)` as legacy in MCP docs.
- Add tests proving handle reads are bounded and ID-free.
- TDD checks: valid handle read returns aggregates and itemRef samples; expired,
  cross-session, and wrong-domain handles fail recoverably; sample-size and field
  validation are covered; no nested sample field contains asset UUIDs.

### Slice 4: Selection Transform Tools

- Add metadata-only `curateSelection`.
- Support highlight and cover-candidate strategies.
- Return a new derived selection handle and criteria summary.
- TDD checks: curation is deterministic; target-count bounds are validated;
  `targetCount` above available count returns available assets with a warning;
  oversized inputs ask for narrowing; missing metadata still produces stable
  criteria; output is a handle, not IDs.

### Slice 5: Planning Contract Hardening

- Make provider-facing planning prefer or require handles/sources.
- Reject raw `assetIds` from MCP calls with recoverable guidance.
- Hide or reject provider-facing `assetSource.explicitAssets` so Pi cannot bypass
  handles through a different raw-ID field.
- Preserve internal materialization so review/apply remains durable.
- TDD checks: raw `assetIds` and `assetSource.explicitAssets` fail before plan
  creation; `assetSelectionHandleId` and `assetSource.selectionHandle` succeed;
  stale/deleted assets are revalidated during materialization; operation-specific
  limits and cover-count rules are enforced.

### Slice 6: Workflow Tools And Limit Rebalance

- Add convenience tools for album/asset-batch plans from selection handles.
- Raise safe search handle limits.
- Add end-to-end assistant regressions for the failed USA-trip session shape.
- TDD checks: `proposeAlbumFromSelection` and
  `proposeAssetBatchFromSelection` delegate through handle materialization;
  handle-only search limits can reach the new cap without prompt growth; an
  assistant-flow regression for the USA-trip prompt creates the reviewable plan
  without any raw asset IDs in provider-visible transcript state.

## Implementation Decisions

- First-pass search and metadata-only curation limits are 1,000 assets when the
  session permission plan allows that many assets. Preview-assisted limits stay
  unchanged until preview scoring is redesigned.
- V1 samples are explanatory. They may include handle-local `itemRef` labels for
  traceability, but Pi does not use item refs to build plans.
- Raw `assetIds` remain in internal DTOs and persisted plan internals for
  compatibility, but provider-facing MCP planning calls reject raw asset IDs
  with recoverable handle guidance.
- Current UI context should be converted into session-scoped handles when a
  session is created or resumed. Album, space, current selection, and previous
  search context should therefore enter Pi as handles or declarative source
  refs, not as asset ID arrays.
