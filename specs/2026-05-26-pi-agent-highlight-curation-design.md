# Pi Agent Highlight Curation Design

Status: draft design
Date: 2026-05-26
Branch: `explore/pi-agent-brainstorm`

## Purpose

Pi can already search assets, inspect metadata and previews, and create
reviewable album, space, favorite, archive, tag, rotation, and metadata plans.
The next useful capability is letting users ask for a small set of suggested
highlights from a bounded source:

> Pick the best 15 photos from my Portugal trip and make a highlights album.

The assistant must not claim objective image-quality scoring. In this version,
"best" means "suggested highlights based on the available metadata, user
signals, optional preview inspection, and diversity across the bounded source."
The result is always a user-reviewed plan.

## Current State

The capability matrix already marks these building blocks as supported:

- Natural-language search with date, album, tag, person, place, camera, rating,
  favorite, media type, visibility, and shared-space filters.
- Album and shared-space lookup/read tools.
- Metadata reads for timestamps, location labels, camera fields, ratings,
  favorites, visibility, and tags.
- Preview reads behind the existing permission model.
- Reviewable plan operations for album create/add assets, favorite, and cover
  selection.
- Photo-first plan review with thumbnail review and per-item inclusion.

The matrix lists image quality scoring as a future new-tool candidate. This
design explicitly leaves that out. Highlight curation should work now with the
existing tool surface and should become better later when a full
`analyzeAssetQuality` capability exists.

## Goals

- Support "suggest highlights" workflows from a bounded candidate set.
- Keep all writes behind Gallery plan review and apply.
- Use existing MCP tools and operation types only.
- Require a concrete scope before selecting highlights.
- Prefer existing user intent signals such as favorites, ratings, people,
  places, tags, and album/space context.
- Use previews only when allowed by the session permission plan and provider.
- Make subjective selection transparent by explaining criteria and limitations.
- Preserve review-first UX: thumbnails, selected count, easy exclusion, and no
  auto-apply.
- Cover the behavior with TDD slices and assistant-flow regressions.

## Non-Goals

- No `analyzeAssetQuality` tool in this version.
- No blur, exposure, composition, aesthetic, or ML quality scoring.
- No duplicate or perceptual-similarity clustering.
- No whole-library "find my best photos" workflow without a narrowing question.
- No direct mutation MCP tool.
- No delete/trash operation.
- No raw original reads for curation; previews are enough for v1.
- No claim that Pi objectively determines the best photos.
- No new persisted score columns or background quality jobs.

## User-Facing Behavior

### Supported Prompts

- "Pick the best 15 photos from my Portugal trip and make an album."
- "Suggest 10 highlights from this album."
- "Favorite the best photos from last weekend."
- "Make a highlights album from the Family space."
- "Pick a cover from this album."
- "Choose 20 highlights from photos of Alex in Berlin last summer."

### Required Scope

If the user does not provide a bounded source, Pi asks one narrowing question
instead of searching the entire library:

> I can suggest highlights when you give me a scope, such as an album, shared
> space, date range, place, person, or selected photos. Which set should I use?

Valid sources:

- Explicit asset IDs or current user selection.
- Existing album.
- Existing shared space.
- Date or upload range.
- Natural-language search with filters.
- Previous search result or selection handle.

### Honest Language

The assistant should say "suggested highlights" or "recommended highlights,"
not "the objectively best photos." A good summary is:

> I selected 15 suggested highlights from 86 candidates, prioritizing existing
> ratings/favorites, matching trip context, and variety across the day. Review
> the selection before applying.

When previews are unavailable:

> I could not inspect previews in this session, so this recommendation is based
> on metadata, favorites, ratings, and variety.

## Selection Strategy

The selection algorithm is intentionally simple and explainable. It is a prompt
and orchestration contract, not a new server-side scoring service.

1. **Resolve the source.** Use existing album, space, filter, or selection
   tools to get candidate asset IDs. Ambiguous album/person/space/tag names
   require clarification.
2. **Apply hard constraints.** Honor explicit instructions such as "photos
   only," "skip videos," "exclude screenshots," "not already in this album," or
   "from last weekend." If the filter cannot be applied reliably, ask a
   clarification or disclose the limitation.
3. **Read metadata for candidates.** Use bounded metadata reads for rating,
   favorite state, date, location, tags, media type, and visibility.
4. **Use user preference signals.** Prefer assets that are already favorites or
   highly rated. Treat ratings and favorites as stronger signals than model
   taste.
5. **Use previews when allowed.** For a bounded candidate set, read previews and
   let the model inspect them for obvious relevance, subject clarity, and
   variety. This must be framed as a recommendation, not a quality score.
6. **Diversify.** Avoid selecting many adjacent near-identical timestamps when
   there are enough candidates. Spread selections across time buckets, places,
   people, tags, and scene descriptions when those signals are available.
7. **Produce a reviewable plan.** Create album/favorite/cover operations for the
   selected IDs only. The user can exclude individual assets before apply. When
   curation narrows a broader search to a subset, the plan must use explicit
   selected `assetIds` or an equivalent materialized selection that contains
   only those assets. Do not pass the original broad search source into a write
   plan, because that would apply to every candidate rather than the curated
   highlights.

### Candidate Limits

V1 should stay bounded:

- Up to 250 candidates for preview-assisted curation.
- Up to 500 candidates for metadata-only curation when the user gave a precise
  filter and no previews are needed.
- If the source exceeds the applicable limit, Pi asks the user to narrow the
  scope or explicitly choose metadata-only sampling. Sampling may be used only
  for recommendations and must be disclosed in the summary; it must not pretend
  to have considered every asset in the oversized source.

This avoids pretending Pi can visually curate thousands of assets without a
dedicated scoring pipeline.

## Operation Flows

### Create Highlights Album

Prompt:

> Pick the best 15 photos from my Portugal trip and make an album.

Flow:

1. Resolve "Portugal trip" with search filters, album context, or a clarification.
2. Search candidates with `searchAssets`.
3. Read metadata for candidates.
4. Read previews if allowed and candidate count is within the preview limit.
5. Select up to the requested count using the strategy above.
6. Propose `album.create` plus `album.addAssets` with selected asset IDs, not
   the original candidate search source.
7. Plan review shows selected thumbnails and lets the user remove items.

### Add Highlights To Existing Album

Prompt:

> Add 20 highlights from last weekend to Family.

Flow:

1. Resolve target album with `listAlbums` and clarify ambiguous names.
2. Search candidates for the source scope.
3. Avoid assets already in the target album where possible.
4. Propose `album.addAssets` for selected IDs, not the full source search.

### Favorite Suggested Highlights

Prompt:

> Favorite the best photos from this space.

Flow:

1. Resolve the shared space.
2. Read bounded candidate asset IDs.
3. Select highlights.
4. Propose `asset.setFavorite` for selected IDs, not the full source search.

### Set A Suggested Cover

Prompt:

> Pick a better cover for this album.

Flow:

1. Read the album and its bounded asset IDs.
2. Prefer preview inspection if allowed.
3. Select one asset and propose `album.setCover`.
4. Summary explains that the cover is a suggestion and can be revised.

## Permissions And Safety

- All reads use the existing session permission plan.
- Preview inspection requires the same approval and permission behavior as
  `readAssetPreviews`.
- No originals are requested.
- All writes are represented as operation plans and applied only by Gallery
  after user approval.
- If previews are denied, the assistant can still propose metadata-based
  highlights or ask whether the user wants to continue with metadata only.
- If write scope blocks the target operation, plan creation returns the existing
  denied behavior.

## Error Handling

- **No scope:** ask for album, space, date range, person, place, or selected
  photos.
- **Ambiguous source:** present choices or ask the user to clarify.
- **No candidates:** answer directly and do not create an empty plan unless the
  user explicitly wants an empty album.
- **Fewer candidates than requested:** propose all reasonable candidates and
  state the actual count.
- **Too many candidates:** ask to narrow or offer metadata-only sampling.
- **Requested count exceeds candidate limit:** ask the user to choose a smaller
  count or narrow the source before preview-assisted curation.
- **Requested count is missing:** choose a conservative default such as 10 only
  if the user clearly asked for highlights from a bounded source; otherwise ask
  for the desired count.
- **Requested count is zero or negative:** ask for a valid positive count and
  create no plan.
- **Preview denied:** continue with metadata-only criteria only if the user
  accepts that limitation or the original prompt can be satisfied without
  visual inspection.
- **Provider cannot inspect images:** treat previews as unavailable and use
  metadata-only criteria.
- **Stale assets at apply:** rely on existing plan apply error visibility and
  partial failure reporting.

## Prompt And Tool Guidance

The system prompt/tool guide should teach these rules:

- "Best" and "highlights" require a bounded source.
- Do not promise objective quality scoring.
- Prefer favorites and ratings over visual taste when available.
- Use previews only for small bounded sets and only when allowed.
- Explain the criteria used in the plan summary.
- If the candidate set is large, narrow first instead of requesting thousands of
  previews.
- After selecting a curated subset, propose writes with the selected IDs only.
  Do not reuse a broad search-backed source for the write plan unless it exactly
  represents the selected subset.
- Do not call or advertise `analyzeAssetQuality` as available; it is future
  work.

## UI Requirements

No new review UI is required for v1. Existing photo-first plan review must show:

- Suggested selected count.
- Representative thumbnails.
- Destination album or operation.
- `Review photos` / `Change selection` controls.
- Per-item inclusion/exclusion before apply.
- Plan summary text that includes the criteria used.

If the final implementation discovers that plan summaries are not visible enough
for curation criteria, the smallest acceptable UI change is to surface the
operation summary in the destination card header. Do not build a new curation
wizard in this version.

## Implementation Slices

Implementation must be split into the slices below. Each slice gets its own
implementation plan under `docs/superpowers/plans/` before code changes begin.
Do not combine these into one large plan. Each slice must follow TDD for new
behavior: add the listed failing tests, verify the expected red failures,
implement the smallest change, then verify green before committing. Some
slice-level regression guards protect existing non-goals, such as the absence
of `analyzeAssetQuality`; those may already pass, but each slice must still
start with at least one intentionally red test for new behavior.

### Slice 1: Prompt Contract And Capability Matrix Guardrails

Scope:

- Update MCP prompt/tool guidance so "best" and "highlights" require a bounded
  source.
- Document that `analyzeAssetQuality` is not available and must not be
  advertised as part of v1.
- Add examples that show highlight curation using existing search, metadata,
  preview, and plan tools.
- Update capability matrix text only enough to mark highlight curation as
  planned/behind implementation, not solid.

TDD coverage:

- Expected red: prompt-service tests fail until bounded-source guidance appears.
- Expected red: prompt/example tests fail until highlight examples show existing
  search, metadata, preview, and plan tools.
- Regression guard: prompt-service tests assert `analyzeAssetQuality` is absent
  from available tool guidance.
- Regression guard: capability matrix keeps quality scoring in `Needs new MCP
Tool` and keeps bounded highlight curation out of `Solid now` until
  implementation is complete.

Exit criteria:

- No runtime behavior changes beyond prompt/docs.
- Server prompt/capability tests pass.

### Slice 2: Bounded Source And Count Guardrails

Scope:

- Teach the assistant flow to ask for scope before curation when the prompt is
  unbounded.
- Add count handling for missing, zero, negative, too-large, and no-candidate
  cases.
- Keep this slice read-only: it may ask clarifying questions or answer directly,
  but it must not create highlight write plans yet.

TDD coverage:

- No-scope prompt asks one clarification and creates no plan.
- Missing count on a bounded source uses a conservative default only when the
  user's intent is clear.
- Zero or negative count asks for a positive count and creates no plan.
- Requested count above the applicable candidate limit asks to narrow or choose
  a smaller count.
- No matching candidates returns a direct answer and creates no plan.
- Fewer-candidates-than-requested is intentionally left to Slice 3 because the
  final behavior creates a write plan for the available candidates.

Exit criteria:

- Guardrail paths are deterministic enough for assistant-flow tests.
- No album/favorite/cover plans are introduced in this slice.

### Slice 3: Metadata-Only Highlight Planning

Scope:

- Implement metadata-only suggested-highlight planning for bounded sources.
- Support create-highlights-album, add-highlights-to-existing-album, and
  favorite-highlights flows when ratings, favorites, dates, places, tags, or
  explicit filters are enough.
- Preserve the selected-ID invariant: after curation narrows candidates to a
  subset, proposed write operations use selected `assetIds` only and do not
  carry the original broad `assetSource`.
- Avoid duplicate adds to an existing album where possible.

TDD coverage:

- Album highlight prompt produces `album.create` + `album.addAssets` with only
  selected IDs.
- Existing-album highlight prompt resolves the album, excludes already-present
  assets where possible, and proposes only selected IDs.
- Favorite highlight prompt proposes `asset.setFavorite` with only selected IDs.
- Ratings/favorites are preferred over model taste in prompt examples and
  scripted flow assertions.
- Curated subset regression proves the operation does not include the original
  broad `assetSource`.
- Fewer-candidates-than-requested creates a plan only for available candidates
  and states the count.

Exit criteria:

- Metadata-only album/favorite flows work without preview permissions.
- Plan summaries disclose metadata-only criteria.

### Slice 4: Preview-Assisted Curation And Cover Suggestions

Scope:

- Add preview-assisted highlight selection for bounded candidate sets within
  the preview limit.
- Implement cover suggestion flow from an album.
- Handle preview permission denial and providers that cannot inspect images by
  falling back to metadata-only behavior or asking for clarification.
- Preserve the no-originals rule.

TDD coverage:

- Preview-assisted album highlight prompt requests previews only after a bounded
  candidate set is known.
- Candidate set above preview limit asks to narrow before preview-assisted
  curation.
- Preview-denied flow either continues with metadata-only criteria and
  disclosure or asks for confirmation before continuing.
- Provider-without-image-input path behaves like previews are unavailable.
- Cover prompt proposes `album.setCover` with exactly one selected asset.
- Tests prove `readAssetOriginals` is not used.

Exit criteria:

- Preview-assisted flows still produce ordinary reviewable plans.
- No quality-scoring, duplicate-clustering, or original-read behavior is added.

### Slice 5: Plan Review UI And Sparse Apply Coverage

Scope:

- Reuse existing photo-first plan review for highlight plans.
- Ensure the plan review surface shows the selected count, representative
  thumbnails, destination/operation, review controls, and curation criteria.
- Extend sparse-selection coverage so removing suggested highlight assets before
  apply affects the final apply payload.

TDD coverage:

- Web unit tests show highlight plan criteria in the visible operation summary.
- Web unit tests show selected count and thumbnails for highlight album plans.
- Photo review modal can exclude suggested assets.
- Sparse apply sends the expected item selection payload and applies only the
  remaining selected highlight IDs.

Exit criteria:

- No new curation wizard exists.
- Existing plan review remains the only approval surface.

### Slice 6: Acceptance E2E, Docs, And Capability Matrix Completion

Scope:

- Add end-to-end smoke coverage for the accepted highlight workflows.
- Update the capability matrix after implementation is complete.
- Add final prompt/docs examples.

TDD coverage:

- E2E prompt: "Suggest 5 highlights from this album and make an album called
  Highlights."
- E2E prompt: "Favorite the best 3 photos from last weekend."
- E2E prompt: "Pick a cover from this album."
- E2E prompt: "Pick the best photos from my library." asks for scope and
  creates no plan.
- E2E prompt: album with only 7 eligible assets requested as 20 proposes 7 and
  states the actual count.
- E2E prompt: no matching source reports no matches and creates no plan.
- Capability matrix marks "Best photos curation" as solid only for bounded
  sources, keeps visual cleanup constrained, and keeps image quality scoring in
  `Needs new MCP Tool`.

Exit criteria:

- Full relevant server, web, and e2e checks pass.
- Branch is ready for CI babysitting.

## Testing Strategy

Implementation must be TDD. Each slice starts with a failing test that proves
the intended behavior, verifies the red failure, then implements the smallest
change needed to pass.

### Unit And Contract Tests

- Prompt guide includes bounded-source rules for highlights.
- Prompt guide explicitly does not advertise `analyzeAssetQuality`.
- Tool examples show highlight curation using existing search, metadata,
  preview, and plan tools.
- Candidate-limit handling asks to narrow instead of reading unbounded previews.
- Preview-denied path produces metadata-only guidance or a clarification.
- Curated subset guidance requires explicit selected IDs, preventing broad
  source-backed plans from applying to every candidate.
- Metadata-signal examples prove favorites and ratings are treated as stronger
  criteria than model taste.
- Count validation covers missing, zero, negative, and too-large requested
  counts.

### Server Flow Tests

- Album highlights prompt produces `album.create` and `album.addAssets` for
  selected IDs.
- Existing-album prompt resolves the album and avoids duplicate asset adds.
- Favorite highlights prompt proposes `asset.setFavorite`.
- Cover prompt proposes `album.setCover`.
- No-scope prompt asks a clarification and creates no plan.
- No-candidates prompt gives a direct answer and creates no plan.
- Fewer-candidates-than-requested prompt proposes the available candidates and
  states the actual count.
- Too-large candidate set asks to narrow.
- Curated subset flow verifies the proposed operation contains only selected
  asset IDs and does not carry the original broad `assetSource`.
- Preview permission denied does not block metadata-only highlight suggestions
  when ratings/favorites are enough.
- Provider-without-image-input path behaves like preview unavailable and uses
  metadata-only criteria.

### Web Tests

- Highlight album plan shows selected count and thumbnails.
- `Review photos` lets the user exclude suggested assets before apply.
- Operation summary includes the curation criteria.
- Applying a sparse selection sends the expected item selection payload.
- Existing sparse-selection tests are extended to prove only selected highlight
  IDs are applied after the user removes suggested assets.

### E2E Smoke Prompts

1. "Suggest 5 highlights from this album and make an album called Highlights."
2. "Favorite the best 3 photos from last weekend."
3. "Pick a cover from this album."
4. "Pick the best photos from my library."
5. "Suggest 20 highlights from the Family space, but skip videos."
6. "Suggest 20 highlights from this album." against an album with only 7
   eligible assets.
7. "Suggest highlights from last weekend." against a source with no matches.

Expected behavior for prompt 4: Pi asks for a scope and does not create a plan.
Expected behavior for prompt 6: Pi proposes 7 and states that only 7 eligible
assets were available.
Expected behavior for prompt 7: Pi reports no matches and creates no plan.

## Edge Case Coverage Checklist

| Edge case                        | Required behavior                                                          |
| -------------------------------- | -------------------------------------------------------------------------- |
| No source scope                  | Ask one narrowing question; create no plan.                                |
| Ambiguous album/person/space/tag | Ask for clarification or present choices.                                  |
| No matching candidates           | Answer directly; create no plan.                                           |
| Fewer candidates than requested  | Propose available candidates and state the actual count.                   |
| Candidate set above limits       | Ask to narrow or explicitly disclose metadata-only sampling.               |
| Missing requested count          | Use a conservative default only for a bounded source; otherwise ask.       |
| Invalid requested count          | Ask for a positive count; create no plan.                                  |
| Preview permission denied        | Use metadata-only criteria only with disclosure or clarification.          |
| Provider cannot inspect images   | Treat previews as unavailable and use metadata-only criteria.              |
| Curated subset from broad search | Write plan uses selected IDs only, never the original broad source.        |
| Already-in-target album assets   | Exclude or avoid duplicate add operations where possible.                  |
| User removes suggested assets    | Apply payload preserves the sparse user selection.                         |
| Stale assets or partial apply    | Existing plan apply failure and partial success reporting remains visible. |

## Capability Matrix Update

After implementation, update the capability matrix:

- Change "Best photos curation" from constrained to solid for bounded sources.
- Keep visual cleanup constrained.
- Keep image quality scoring in "Needs new MCP Tool."
- Add acceptance prompts for bounded highlight album, favorite highlights, and
  no-scope clarification.

## Future Work

- Full `analyzeAssetQuality` tool with explicit blur, exposure, composition,
  and aesthetic scores.
- Duplicate or near-duplicate grouping for burst cleanup.
- Cached quality scores or background analysis jobs.
- User preference profiles such as "favor people photos" or "favor landscapes."
- A dedicated curation review UI if plan review is not enough after user testing.
