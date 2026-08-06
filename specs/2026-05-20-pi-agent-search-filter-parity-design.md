# Pi Agent Search Filter Parity Design

Status: approved design
Date: 2026-05-20
Branch: `explore/pi-agent-brainstorm`

## Purpose

Pi should be able to find useful photo sets from natural language using the same
practical search and filter capabilities that Gallery exposes in the product UI.
Today the MCP `searchAssets` tool supports a useful metadata subset, but it does
not cover the full search surface users already rely on: people, shared-space
scope, smart search, OCR, description, filename, richer date ranges, pagination,
and search suggestions.

This design expands Pi's asset discovery layer so prompts such as “find photos
of Alex in Berlin from last summer that are not in any album” or “find
screenshots from 2024 that mention invoices” can be handled by structured tools
instead of brittle model guessing.

## Goals

- Let Pi translate natural language into Gallery-compatible search filters.
- Reuse existing Gallery search semantics wherever possible instead of
  maintaining a parallel agent-only query path.
- Give Pi a resolver path for names so models do not guess internal person, tag,
  album, or space IDs.
- Keep all search results permission-scoped to the assistant session's immutable
  permission plan.
- Support large result sets with pagination, samples, and clear truncation
  behavior.
- Preserve the existing write safety invariant: search tools can discover
  assets, but changes still require a user-reviewed operation plan.

## Non-Goals

- No direct mutation tools.
- No silent delete/trash behavior.
- No exposing storage/debug fields such as checksums, original paths, preview
  paths, encoded paths, or raw filesystem details to the model.
- No autonomous background library reorganization.
- No requirement that the model can inspect original files unless the permission
  preset already allows that through the existing direct-read tools.

## Current Gaps

Current Pi `searchAssets` supports a narrow metadata subset:

- taken date range
- city/state/country
- camera make/model/lens
- favorite
- not-in-album
- media type
- rating
- tag IDs
- album IDs
- bounded limit

Gallery's UI and search APIs already support broader behavior:

- people filters and scoped shared-space people filters
- shared-space scope and `withSharedSpaces`
- smart search query
- OCR text search
- description search
- original filename search
- created/updated/taken ranges
- timeline/archive/locked visibility semantics
- sort order and pagination
- filter suggestions/facets for people, tags, locations, camera makes/models,
  ratings, and media types

## Design

Pi's asset discovery layer should have three cooperating pieces:

1. `searchAssets`: a richer search tool that accepts Gallery-like filters and
   returns bounded, permission-safe result pages.
2. `resolveAssetSearchFilters`: a resolver tool that turns user-facing names
   into structured IDs or ambiguity choices.
3. MCP examples and correction hints that teach small models the correct search
   sequence: resolve names first, search with structured filters second, propose
   plans only after discovery.

## Search Tool Contract

`searchAssets` should support deterministic and text-search modes:

- `metadata`: structured filters only, no text query required.
- `smart`: semantic text query plus optional structured filters.
- `description`: description text query plus optional structured filters.
- `ocr`: OCR text query plus optional structured filters.
- `filename`: original filename text query plus optional structured filters.

Common filters should include:

- `takenAfter`, `takenBefore`
- `createdAfter`, `createdBefore`
- `updatedAfter`, `updatedBefore`
- `city`, `state`, `country`
- `make`, `model`, `lensModel`
- `isFavorite`
- `isNotInAlbum`
- `type`
- `rating`, including `null` for unrated assets
- `tagIds`
- `albumIds`
- `personIds`
- `spaceId`
- `spacePersonIds`
- `withSharedSpaces`
- `visibility` where the session permission plan allows it
- `order`
- `limit`
- `page`

The response should include:

- returned asset IDs
- compact metadata suitable for model reasoning
- a result count for the returned page
- total or approximate total when available
- `nextPage` when more results exist
- explicit `truncated` or `hasMore` flags
- a plain-language summary suitable for the chat activity preview

## Resolver Tool Contract

`resolveAssetSearchFilters` should accept user-facing filter intent and return
search-ready IDs or structured ambiguity states. It should resolve:

- people by name
- tags by name
- albums by name
- spaces by name
- cities and countries
- camera makes and models

Each resolved item should report one of:

- `matched`: one accessible entity matched.
- `ambiguous`: multiple accessible entities matched; return choices.
- `not_found`: no accessible entity matched.
- `denied`: the requested entity is not accessible, without leaking hidden
  details.

The resolver should be safe to call before `searchAssets`, and MCP examples
should teach models to call it whenever the user provides names instead of IDs.

## Permission And Safety Rules

- Search results must always be constrained by the session's permission plan.
- `spacePersonIds` requires `spaceId`.
- `spaceId` and broad `withSharedSpaces` must not be combined in ambiguous ways.
- Locked visibility requires elevated permission.
- Direct original-file access remains outside search and continues to be gated
  through `readAssetOriginals`.
- Inaccessible album, tag, person, or space filters should not leak which part
  was inaccessible. Return a generic accessible-filter error or resolver
  `denied` state.
- Plan creation still receives concrete asset IDs or a future bounded plan
  selection contract; it must not apply an unbounded search query directly.

## Scale Rules

- Default searches must stay bounded.
- Broad prompts should return a sample page and guidance such as “I found many
  matches; narrow by date, album, space, person, or count.”
- Pagination should support continuing discovery without rerunning from scratch.
- Plan review must not eagerly render hundreds or thousands of thumbnails.
- For large plans, the plan preview should use counts, representative thumbnails,
  and chunked application behavior rather than loading every asset into the UI.

## Slices

### Slice 1: Search Contract Foundation

Expand the MCP `searchAssets` schema with mode, order, pagination, common
filters, and structured result metadata. This slice should keep execution on the
current repository path if needed, but the contract should be shaped for the
full search surface.

TDD requirements:

- Write schema tests before implementation.
- Verify all filters must live under `filters`.
- Verify mode-specific required fields.
- Reject invalid dates, ratings, order values, limits, and root-level filters.
- Reject simultaneous new-search filters and approved retry `toolCallId`.
- Verify response encoding includes result counts, pagination/truncation flags,
  and compact asset IDs.

Edge cases:

- Empty metadata filters with default limit.
- Text mode without query.
- `rating: null` for unrated assets.
- Limit above max.
- Page with no further results.

### Slice 2: UI Filter Parity

Map Pi search filters onto Gallery's existing metadata search behavior instead
of expanding the custom agent-only search path indefinitely. Add deterministic
filter support for created/updated/taken ranges, visibility/archive-safe fields,
people, space scope, shared spaces, and unrated assets.

TDD requirements:

- Write service/repository tests before implementation.
- Verify Pi search produces the same effective search DTO semantics as Gallery
  metadata search for supported filters.
- Verify `spacePersonIds` requires `spaceId`.
- Verify `spaceId` and `withSharedSpaces` conflict handling.
- Verify inaccessible albums, tags, people, and spaces are rejected or hidden.
- Verify locked visibility requires elevated permission.

Edge cases:

- Shared-space-only permission plan.
- Owned-only permission plan.
- Favorites with shared-space inclusion.
- Empty people filter arrays.
- Ambiguous or stale space IDs.

### Slice 3: Filter Resolution Tool

Add `resolveAssetSearchFilters` so Pi can resolve names into IDs before search.
This is required for smaller models and normal user prompts because users do not
know internal IDs.

TDD requirements:

- Write DTO, MCP contract, service, and prompt-example tests first.
- Exact person/tag/album/space names resolve to IDs.
- Ambiguous matches return choices instead of guessing.
- No-match responses are actionable.
- Inaccessible entities are omitted or reported as denied without leaking hidden
  details.
- Malformed resolver calls return correction hints.

Edge cases:

- Two people with the same display name.
- Duplicate album names.
- Duplicate or similar space names.
- Tags with case-only differences.
- Camera make with multiple models.

### Slice 4: Natural Language Search Modes

Add first-class support for smart, OCR, description, and filename search modes
combined with structured filters.

TDD requirements:

- Write tests proving each mode routes to the intended Gallery search path.
- Smart search passes `query` and filters together.
- OCR mode does not fall back to filename search.
- Description and filename modes remain distinct.
- Empty query is rejected for text modes.
- Search results stay permission-scoped.

Edge cases:

- Smart search with sort order omitted for relevance.
- OCR search with no OCR index matches.
- Filename search with partial file names.
- Text query plus date/person/tag filters.
- Shared-space smart search.

### Slice 5: People-Based Organization

Move people-based organization from “needs new tool” to supported. Pi should be
able to find assets by global people and shared-space people, then use those
assets in album, space, tag, favorite, archive, or rotate plans.

TDD requirements:

- Write assistant-flow and service tests before implementation.
- Global people search works with resolved `personIds`.
- Shared-space people search works with `spaceId` + `spacePersonIds`.
- Hidden or inaccessible people are excluded.
- Ambiguous same-name people require clarification or resolver choices.
- Plans built from people search keep chat open after apply.

Edge cases:

- Person exists globally and in a shared space.
- Space person token used without space scope.
- Person has no matching assets.
- Multiple selected people.
- Mixed people + tag + date filters.

### Slice 6: Large Result Handling

Make search useful and safe for hundreds or thousands of assets.

TDD requirements:

- Write pagination and UI regression tests before implementation.
- Result truncation and `hasMore` are visible.
- Next page returns the next bounded batch.
- Plan preview does not render all assets eagerly.
- Applying a large plan uses existing chunking/limits and reports partial
  success/failure.

Edge cases:

- Search returns exactly one page.
- Search returns more than one page.
- User asks for “all” with thousands of results.
- Search page becomes stale before plan apply.
- User revises a large plan after excluding a subset.

### Slice 7: MCP Examples And Correction Hints

Update generated MCP documentation, examples, and correction hints so smaller
models learn the correct flow.

TDD requirements:

- Write contract/example tests first.
- Every documented example parses against the live schema.
- Common mistakes produce targeted hints.
- Examples cover resolver-first flows and text-search modes.

Example prompts:

- “Find unalbumed Berlin photos from May.”
- “Find 5-star videos.”
- “Find OCR invoice screenshots.”
- “Find photos of Alex in Family space.”
- “Search first, resolve IDs, then propose a plan.”

Common mistake hints:

- Filters placed at root instead of under `filters`.
- Name strings passed where IDs are required.
- Text query supplied in metadata mode.
- `spacePersonIds` used without `spaceId`.
- Search filters combined with approved retry `toolCallId`.

### Slice 8: Capability Matrix And Acceptance Coverage

Update the capability matrix and user-level regressions after the search
expansion lands.

TDD requirements:

- Add assistant-flow regressions for the new acceptance prompts.
- Verify messages stream, tool approvals appear, approvals resume the agent,
  plans render, applied-plan cards appear, and chat continues.
- Verify activity preview summarizes searches without exposing noisy raw
  payloads by default.

Acceptance prompts:

1. “Find photos of Alex in Berlin from last summer that are not in any album.”
2. “Create an album from 5-star videos from Japan.”
3. “Find screenshots from 2024 that mention invoices.”
4. “Add beach sunset photos from the Family space to a new album.”
5. “Find photos taken with my Sony camera in May.”

## Test Strategy

Every slice must use TDD:

1. Add failing DTO/contract/service/UI/assistant-flow tests for the slice.
2. Verify the tests fail for the expected reason.
3. Implement the smallest production change.
4. Run the focused tests until green.
5. Run relevant generated docs/OpenAPI checks when schemas change.
6. Update the capability matrix or MCP docs in the same slice when behavior
   changes.

Coverage should include:

- DTO schema validation.
- MCP registry and generated tool schema shape.
- MCP contract correction hints.
- Permission-plan enforcement.
- Search service mapping to Gallery search semantics.
- Resolver ambiguity behavior.
- Assistant runner flow with approvals and resumed execution.
- Plan review behavior for result sets from search.
- Large-result pagination and rendering caps.

## Decisions

- Pagination will use Gallery's existing one-based `page` request and `nextPage`
  response for this phase. The agent must repeat the same mode, query, filters,
  order, and limit with the returned `nextPage` value to continue. We will not
  introduce opaque cursor tokens until there is evidence that page-based
  continuation is unstable enough to block agent workflows.
- Search responses must always include `returnedCount` and `hasMore`.
  `totalCount` should be exact only where Gallery already computes it cheaply.
  Slices 1-4 should not add expensive count queries solely for Pi. If a future
  search path can provide a cheap estimate, it may expose `approximateTotal`,
  but the UI and model prompt should treat `hasMore` as the reliable scale
  signal.
- `metadata` is the default mode for structured filters. `smart`, `ocr`,
  `description`, and `filename` must be selected explicitly through the `mode`
  field and must include a non-empty `query`. The server must not silently
  upgrade metadata search into smart search or fall back from one text mode to
  another.
