# Pi Agent Trip Candidate Detection Design

Status: draft design
Date: 2026-05-28
Branch: `explore/pi-agent-brainstorm`

## Purpose

Pi should be able to handle requests like:

> Create an album for my recent trip to USA.

without asking the user to provide dates, a count, and media-type preferences up
front. A trip request is already reviewable: Gallery can infer a likely source,
exclude obvious duplicates when possible, create an editable plan, and let the
user correct the plan before applying it.

The missing piece is a server-side trip detector. The LLM should not infer trip
windows from tiny samples or raw asset IDs. Gallery should detect likely trip
candidates from geotagged assets, return compact candidate summaries and
selection handles, and let Pi orchestrate the album workflow.

## Current State

Gallery already has useful recent-trip logic in `RecentTripMemoryRule`:

- It builds a likely home baseline from prior location clusters.
- It searches recent location clusters.
- It treats non-home clusters with enough assets and day coverage as trip
  candidates.
- It fetches assets for the chosen location.
- It curates representative assets by collapsing short bursts and spreading
  picks across days.

That logic is currently shaped for daily memory generation, not interactive
assistant workflows:

- It finds at most one recent city/country candidate for a memory.
- It uses a fixed 30-day recent window and a 90-day home baseline.
- It groups by `country + city`, which misses multi-city or multi-country trips
  that form one continuous travel window.
- It returns asset IDs for memory creation, while Pi needs selection handles and
  compact metadata.
- It is coupled to memory cooldown and dedupe behavior.

## Goals

- Add reusable backend trip candidate detection that is independent of Pi, MCP,
  memories, and future album suggestions.
- Support "my recent trip", "my recent trip to USA", and multi-country trips
  when the assets form a contiguous travel window.
- Use existing geotag/date metadata only; no image understanding or geocoding.
- Return compact trip candidates with date window, places, counts, score,
  confidence, dedupe key, and source descriptor.
- Add a handle-first MCP read tool so Pi can resolve trip sources without seeing
  raw asset IDs.
- Let Pi proceed with sensible defaults for trip album requests: include most
  eligible trip assets, exclude known duplicate variants and stack children when
  possible, and include photos/videos matching the source unless the user says
  otherwise.
- Keep highlight requests as a variant: if the user explicitly asks for "top",
  "best", or "highlights", curate a smaller suggested set from the trip handle.
- Reuse the detector from `RecentTripMemoryRule` where practical.
- Keep proactive album suggestions out of the shipped scope while preserving a
  candidate shape they can consume later.
- Use TDD for each implementation slice.

## Non-Goals

- No proactive album suggestion UI, database model, accept/dismiss endpoints, or
  background suggestion job in this feature.
- No place-name geocoding. Place matching uses existing asset metadata labels
  such as country, state, and city, plus safe normalization/aliases where
  already available.
- No flight, map-route, calendar, or semantic travel understanding.
- No direct album creation or automatic apply. All writes remain reviewable
  operation plans.
- No raw asset ID arrays in model-facing trip tool responses.
- No duplicate cleanup, trashing, or duplicate resolution. The album source may
  skip known duplicate variants, but it must not mutate duplicate groups.
- No new semantic duplicate detector. Duplicate exclusion uses existing
  `duplicateId`, stack primary/child state, and any current duplicate keeper
  heuristic already available in Gallery.
- No objective "best photo" scoring. Highlight selection remains
  metadata-based suggested curation until a future quality-analysis capability
  exists.
- No unbounded whole-library processing. The detector uses configured lookback
  and result limits.

## User-Facing Behavior

### Recent Trip Album

For:

> Create an album for my recent trip to USA.

Pi should:

1. Call the trip candidate tool with a place hint for USA.
2. If one high-confidence candidate exists, propose a reviewable album plan from
   that candidate's album-ready selection handle.
3. Use a concise album name, for example `USA Trip`.
4. Explain assumptions briefly:

> I found a likely USA trip from May 3-12 and proposed an album with 176 assets.
> I skipped 8 known duplicate or stacked variants. Review the album plan before
> applying it.

Pi should not ask for dates or count before trying this flow.

### Recent Trip Highlights Variant

For:

> Create an album of the top highlights for my recent trip to USA.

Pi should use the same trip candidate tool first. After a high-confidence trip
candidate is found, it should pass the album-ready selection handle to
`curateSelection` and default to 10 metadata-only suggested highlights when the
user does not specify a count. This is a narrower variant of the full trip album
flow, not the default behavior for generic "create an album for my trip"
requests.

### Recent Trip Without Place

For:

> Make an album from my recent trip.

Pi should call the same tool without a place hint. If the detector finds one
clear recent travel window, Pi proceeds. If multiple similarly strong candidates
exist, Pi asks one question that includes concrete options:

> I found a few likely trips: USA in May, France/Italy in April, and Berlin in
> March. Which one should I use?

### When To Ask

Pi should ask only after the detector runs when:

- no trip candidate is found;
- multiple candidates are too close in score/confidence;
- the best candidate exceeds safe album materialization limits and cannot be
  narrowed automatically;
- the user asks for an invalid count such as zero, negative, or more than the
  configured highlight maximum for an explicit highlights request;
- the place hint cannot match metadata labels with enough confidence.

## Backend Design

### `TripCandidateService`

Introduce a reusable domain service, not an agent-specific service:

```ts
type TripCandidateRequest = {
  ownerId: string;
  targetDate?: Date;
  lookbackDays?: number;
  placeHint?: string;
  maxCandidates?: number;
};

type TripCandidate = {
  dedupeKey: string;
  title: string;
  subtitle: string;
  countries: string[];
  states: string[];
  cities: string[];
  takenAfter: Date;
  takenBefore: Date;
  assetCount: number;
  albumAssetCount: number;
  excludedDuplicateCount: number;
  dayCount: number;
  score: number;
  confidence: 'high' | 'medium' | 'low';
  source: TripCandidateSource;
};
```

`TripCandidateSource` should be a stable descriptor that other consumers can
materialize later without depending on MCP or agent DTOs:

```ts
type TripCandidateSource = {
  kind: 'tripCandidate';
  dedupeKey: string;
  takenAfter: Date;
  takenBefore: Date;
  places: Array<{
    country: string;
    state?: string | null;
    city?: string | null;
  }>;
  placeLabels: string[];
};
```

The service may use asset IDs internally for scoring or memory representative
selection, but it must not expose raw IDs to model-facing callers.

Single-place candidates may be translated by an adapter into existing search
filters. Multi-country and other OR-style candidates should use the
`takenAfter`/`takenBefore` plus `places` descriptor and be materialized by a
dedicated repository query or selection-handle creation path.

### Algorithm

V1 should stay deterministic and metadata-based:

1. **Build home baseline.** Reuse the existing baseline idea from
   `RecentTripMemoryRule`: inspect location clusters before the recent window
   and identify the dominant home country/city. If the baseline is ambiguous,
   continue with lower confidence instead of failing the whole tool.
2. **Fetch recent geotagged day/place buckets.** Look back from `targetDate`
   using a bounded default, such as 180 days. Include timeline assets with
   location metadata and preview availability, matching existing memory
   constraints.
3. **Apply place hint.** If the user supplied "USA" or another place phrase,
   match it against normalized country/state/city labels. Do not geocode unknown
   places.
4. **Mark travel buckets.** Treat non-home buckets as travel. If a place hint is
   supplied, matching buckets may be travel even when they are in the home
   country, but home-city dominance lowers confidence.
5. **Merge contiguous travel days.** Merge buckets into trip windows when dates
   are close enough. Allow small gaps, such as one no-photo day, so travel days
   do not fragment.
6. **Support multi-place trips.** A candidate window can contain multiple
   countries, states, and cities. The candidate label should summarize the
   strongest places rather than splitting every city into separate trips.
7. **Score candidates.** Prefer recency, asset count, day count, place-hint
   match, non-home confidence, and continuity. Penalize tiny one-day clusters
   unless the user provided an exact place hint.
8. **Create source descriptors.** Convert each candidate to a search source
   using its date window and place constraints. For multi-country candidates,
   materialization may need a dedicated repository query or a selection handle
   from the candidate asset set because current search filters do not express
   country OR country cleanly.
9. **Build the album-ready asset set.** For generic trip album requests,
   materialize a handle that includes most eligible trip assets while skipping
   known duplicate variants and stack children. Use existing duplicate metadata
   only: prefer the same keeper heuristic as duplicate review, and prefer stack
   primary assets over stack children. Do not delete, trash, unstack, or resolve
   duplicate groups.
10. **Classify the recommendation.** Mark the result as auto-usable only when
    the top candidate is high confidence and clearly ahead of the runner-up. V1
    should use deterministic rules: a single high-confidence candidate is clear;
    otherwise the top high-confidence candidate must beat the runner-up by at
    least 20% score or 15 absolute score points. If not, return candidates but
    tell Pi to ask the user.

### Reusing Memory Logic

`RecentTripMemoryRule` should not remain the owner of trip detection. Extract
shared behavior into `TripCandidateService` and make the memory rule consume it.

Memory-specific behavior remains in the memory rule:

- daily rule cap;
- cooldown against recently created rule memories;
- memory title/subtitle formatting if different from Pi copy;
- representative memory asset selection.

Trip detection behavior moves to the shared service:

- home baseline detection;
- location/day bucketing;
- trip-window merging;
- scoring and confidence;
- candidate dedupe key generation.

The memory rule should remain conservative: it should create memory cards only
from high-confidence candidates and should continue to apply its cooldown and
daily rule cap. A low-confidence candidate can still be useful to Pi as an
option in a clarification question, but it should not silently create a memory.

### Access And Materialization

The detector must not bypass existing visibility rules.

V1 trip detection should use the same asset constraints as recent-trip memories
for candidate discovery: owned timeline assets with location metadata and
preview availability, excluding deleted assets. The MCP adapter must then
materialize each candidate through the agent selection-handle path so session
permissions, locked/offline asset filtering, and handle expiry are enforced in
one place.

Future shared-space trip detection can extend the detector, but it is out of
scope for this feature unless the existing agent search/materialization path
already supports it safely.

### Duplicate Exclusion

The default trip album selection should be "most useful trip photos", not every
row that matched the date/location window.

V1 duplicate exclusion is conservative:

- Exclude known stack children when the stack primary is in the same candidate.
- For assets sharing a non-null `duplicateId`, include one keeper when that
  duplicate group is fully inside the candidate. Use Gallery's existing
  duplicate keeper heuristic rather than inventing a new one.
- If a duplicate group is only partially inside the trip candidate, include the
  in-candidate asset and report no duplicate exclusion for that group unless the
  server can prove the better keeper is also in the candidate.
- Report exclusion counts in the trip candidate response.

This is not duplicate cleanup. The user can still use the existing duplicate UI
to resolve duplicate groups globally.

## MCP Tool

Add a read tool named `findTripCandidates`.

Request:

```ts
type FindTripCandidatesRequest = {
  placeHint?: string;
  lookbackDays?: number;
  maxCandidates?: number;
  targetDate?: string;
};
```

Defaults:

- `lookbackDays`: 180
- `maxCandidates`: 3
- `targetDate`: now

Validation:

- `lookbackDays` must be an integer from 7 through 730.
- `maxCandidates` must be an integer from 1 through 5.
- `targetDate` must be a valid ISO date or datetime and must not be more than
  one day in the future.
- `placeHint`, when provided, is trimmed and capped at 120 characters.

Response:

```ts
type FindTripCandidatesResponse = {
  status: 'success';
  summary: string;
  recommendation: {
    action: 'use_top_candidate' | 'ask_user' | 'none';
    candidateDedupeKey?: string;
    reason: string;
  };
  candidates: Array<{
    label: string;
    subtitle: string;
    countries: string[];
    states: string[];
    cities: string[];
    takenAfter: string;
    takenBefore: string;
    assetCount: number;
    albumAssetCount: number;
    excludedDuplicateCount: number;
    dayCount: number;
    score: number;
    confidence: 'high' | 'medium' | 'low';
    dedupeKey: string;
    selectionHandle: {
      id: string;
      sourceRef: string;
      assetCount: number;
      expiresAt: string;
    };
    exclusionSummary?: {
      knownDuplicateVariants: number;
      stackChildren: number;
    };
  }>;
};
```

If no candidates are found, return `status: 'success'` with an empty candidate
array and a useful summary. This is not an error.

When no candidates are found, `recommendation.action` should be `none`. When
multiple plausible candidates are returned, `recommendation.action` should be
`ask_user`. When Gallery has one clear best candidate, the action should be
`use_top_candidate` and `candidateDedupeKey` should identify it. Pi should
follow this recommendation instead of independently interpreting scores.

If the request is invalid, return the normal Gallery MCP validation result with
retryable hints.

The tool must create album-ready selection handles server-side. For generic trip
album requests, Pi should pass the selected candidate handle directly to
`proposeAlbumFromSelection`. For explicit highlight requests, Pi should pass the
selected candidate handle to `curateSelection`, then pass the curated handle to
`proposeAlbumFromSelection`.

## Pi Guidance

Update the runner prompt and generated MCP cheat sheet guidance:

- For "recent trip" requests, call `findTripCandidates` before asking for
  dates.
- For generic trip album requests, use the album-ready trip candidate handle
  directly and do not narrow to highlights.
- If the user explicitly asks for "top", "best", or "highlights" without a
  count, default to 10 after a trip candidate is found.
- If `recommendation.action` is `use_top_candidate`, proceed with a reviewable
  plan for that candidate.
- If `recommendation.action` is `ask_user`, ask one question with candidate
  labels.
- If `recommendation.action` is `none`, explain that no likely trip was found,
  ask for one concrete source such as a date range or place if the user still
  wants the album, and do not create a plan.
- Disclose assumptions and duplicate/stack exclusions in the final message.
- Disclose metadata-only curation only for explicit highlight variants.
- Never copy asset IDs from trip detection or search results.

## Future Album Suggestions

This feature should not implement album suggestions, but the architecture should
not block them.

Future album suggestions can consume `TripCandidateService` from a background
job and persist suggestion records with:

- dedupe key;
- title/subtitle;
- date window;
- place labels;
- source descriptor;
- preview asset references;
- accepted/dismissed state.

Because suggestions need lifecycle and persistence, they should be a Gallery
product feature, not a Pi conversation feature. Pi and suggestions should share
the detector, not share MCP plumbing.

## TDD And Implementation Slices

Every slice starts with focused failing tests before production code.

### Slice 1: Trip Candidate Service Extraction

Tests:

- Detects a single non-home trip using baseline and recent location buckets.
- Returns no high-confidence trip for home-only recent assets.
- Handles ambiguous home baseline by lowering confidence instead of crashing.
- Generates stable dedupe keys for the same trip window.
- Keeps `RecentTripMemoryRule` conservative: low-confidence candidates are not
  converted into memory cards.
- Preserves recent-trip memory cooldown and daily cap behavior.

Implementation:

- Add `TripCandidateService`.
- Move reusable home baseline and scoring logic out of
  `RecentTripMemoryRule`.
- Keep memory rule behavior unchanged from the user's point of view.

### Slice 2: Multi-Day And Multi-Place Trip Windows

Tests:

- Merges adjacent travel days into one candidate.
- Allows a small no-photo gap inside one trip.
- Keeps clearly separate trips as separate candidates.
- Produces one multi-country candidate when a continuous trip crosses borders.
- Summarizes countries/cities without duplicating labels.
- Separates trips that span the same place but are divided by a larger date gap.

Implementation:

- Add day/place bucketing.
- Add window merging and place summarization.
- Add scoring for recency, day count, asset count, place hint, and continuity.

### Slice 3: Album-Ready Trip Selection

Tests:

- Generic trip album candidates expose an album-ready selection count that is
  less than or equal to the full candidate asset count.
- Known duplicate groups inside the trip candidate keep one suggested keeper and
  exclude the other variants from the album-ready handle.
- Stack children are excluded when the stack primary is also inside the trip
  candidate.
- Duplicate groups that only partially overlap the trip candidate do not exclude
  the in-candidate asset unless the server can prove the keeper is also inside
  the candidate.
- Exclusion counts distinguish known duplicate variants from stack children.
- No duplicate records, stack records, or asset visibility fields are mutated.

Implementation:

- Add album-ready materialization on top of trip candidate sources.
- Reuse Gallery's existing duplicate keeper heuristic where possible.
- Keep duplicate exclusion internal to source materialization and response
  counts; do not expose raw asset IDs to Pi.

### Slice 4: Place Hint Filtering

Tests:

- `"USA"` matches assets whose country metadata is `USA` or an accepted
  normalized equivalent.
- A city hint matches city metadata without geocoding.
- An unknown place hint returns no candidates with a summary, not a server
  error.
- A place hint can find a trip in the home country but with lower confidence if
  it overlaps the home city.
- Overlong place hints are trimmed and rejected or capped without affecting
  query construction.

Implementation:

- Add conservative label normalization.
- Apply place hints before candidate scoring.
- Do not call external geocoding services.

### Slice 5: MCP Read Tool

Tests:

- `findTripCandidates` returns candidate summaries and selection handles.
- Response contains no raw asset IDs.
- Empty result returns `status: success` and `candidates: []`.
- Candidate responses include `assetCount`, `albumAssetCount`,
  `excludedDuplicateCount`, and duplicate/stack exclusion summary counts.
- Invalid `lookbackDays`, `maxCandidates`, and `targetDate` values return
  validation errors.
- Boundary values for `lookbackDays` and `maxCandidates` are accepted at the
  documented min/max and rejected just outside them.
- Selection handles are session-scoped and expire like other agent handles.
- Materialized handles exclude deleted, locked, offline, and otherwise
  inaccessible assets.
- Multi-country candidates materialize through a dedicated source path without
  dropping countries that cannot fit into a single current search filter.
- The selection handle asset count matches `albumAssetCount`, not the raw trip
  source count.

Implementation:

- Add DTOs, contract docs, registry entry, service method, and controller path.
- Materialize candidate sources into selection handles.
- Regenerate OpenAPI/client artifacts as required by the repo.

### Slice 6: Pi Flow Integration

Tests:

- Prompt: "Create an album for my recent trip to USA" calls
  `findTripCandidates -> proposeAlbumFromSelection`.
- The generic trip album flow uses the album-ready candidate handle directly and
  does not call `curateSelection`.
- Prompt: "Create an album of the top highlights for my recent trip to USA"
  calls `findTripCandidates -> curateSelection -> proposeAlbumFromSelection`.
- The explicit highlights flow defaults to 10 highlights when no count is
  provided.
- The flow creates a reviewable plan and does not ask for dates first.
- Multiple close candidates produce one clarifying question with labels.
- No candidate produces an explanatory answer, one concrete follow-up question,
  and no plan.
- The runner follows `recommendation.action` instead of independently deciding
  whether scores are close.
- Generic trip album final copy mentions skipped known duplicate/stacked
  variants when exclusion counts are non-zero.
- The provider-visible transcript contains no raw asset IDs.

Implementation:

- Update runner prompt guidance.
- Update deterministic e2e runtime for the new flow.
- Update generated prompt cheat sheet and relevant docs.

## Edge Cases

- Assets without location metadata are ignored by trip detection but remain
  available to normal search tools.
- One-day clusters are low confidence unless the user provides a precise place
  hint and the asset count is meaningful.
- Imported old scans may appear recent by upload date but should not affect trip
  detection because the detector uses taken dates.
- Multiple trips to the same place are separated by date windows and dedupe keys.
- Trips spanning a year boundary should produce one date window if the travel
  days are contiguous.
- A very large candidate should still return a handle when it is within album
  materialization limits; curation limits apply only to explicit highlight
  variants.
- A duplicate group spanning two trips should not cause the current trip album
  to exclude its only in-trip asset unless the kept variant is also in the same
  trip candidate.
- Existing memory cooldown should not suppress MCP trip candidates. Cooldown is
  only for creating memory cards.
- Future `targetDate` values beyond the validation grace period are rejected.
- Shared-space-only assets are not included in V1 trip candidates unless a
  future slice explicitly extends trip detection to shared-space access.
- Candidate handles can expire between trip detection and downstream planning or
  curation; Pi should rerun `findTripCandidates` if a handle-expired validation
  hint says to retry.

## Manual Testing

- On a local seeded library, create home assets plus a recent multi-day USA
  trip and verify Pi proposes a `USA Trip` album without asking for dates.
- Add a duplicate group and a stack inside the trip and verify the proposed
  album skips known duplicate/stacked variants without deleting or resolving
  duplicates.
- On a library with two recent trips, verify Pi asks which concrete trip to use.
- On a library with a multi-country continuous trip, verify one candidate is
  returned with multiple countries.
- On Pierre's personal instance, ask:
  "Create an album for my recent trip to USA."
  Confirm Pi uses trip detection, creates a reviewable plan, and avoids raw IDs.
- Also ask the explicit highlights variant and confirm it uses
  `curateSelection` only after resolving the trip candidate.
- Verify the existing recent-trip memory job still creates equivalent memory
  cards after the service extraction.

## Acceptance Criteria

- Pi can resolve "recent trip to USA" through a server-side trip candidate tool
  and create a reviewable full trip album plan with no up-front clarification.
- Generic trip album plans include most eligible trip assets and skip known
  duplicate/stacked variants when Gallery can identify them.
- Explicit highlight requests still create smaller suggested highlight albums
  from the same trip candidate source.
- Trip candidates are handle-first and do not expose asset ID arrays to the LLM.
- Multi-country trips can be represented as one candidate when date continuity
  indicates one trip.
- Existing recent-trip memory behavior is preserved or intentionally improved
  by tests.
- Album suggestions are not implemented, but future suggestion jobs can consume
  the same service without depending on Pi or MCP.
