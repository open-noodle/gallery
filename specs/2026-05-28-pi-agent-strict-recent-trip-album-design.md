# Pi Agent Strict Recent Trip Album Design

Status: draft design
Date: 2026-05-28
Branch: `explore/pi-agent-brainstorm`

## Purpose

`create_recent_trip_album` is the first productized strict Pi workflow. It
should make this request reliable:

> Create an album for my recent trip to USA.

The LLM may understand user intent and provide copy, but it must not own the
tool sequence. Once Gallery recognizes the supported recent-trip album intent,
deterministic workflow code finds the trip candidate and creates the reviewable
album plan from the candidate selection handle.

## Current Failure

Session `ff4d1de6-adfb-403e-88f3-331ac76dd8e6` showed why prompt guidance is
not enough.

- `findTripCandidates` found one USA trip candidate with 85 assets and a valid
  selection handle.
- Pi ignored that handle and ran a separate metadata search for `country:
"USA"` over a broad date window.
- That search returned a zero-asset selection handle.
- Planning tools rejected the empty source with `Search source did not match
any assets`.
- No row was created in `agent_operation_plan`, but the assistant still told the
  user that a reviewable plan had been created.

The UI did not show a plan because no persisted plan existed. The strict
workflow must make this class of failure impossible for supported intents.

## Goals

- Route generic recent-trip album requests into a deterministic
  `create_recent_trip_album` workflow before open LLM tool orchestration.
- Use `findTripCandidates` as the source of truth for recent-trip detection.
- For `recommendation.action === "use_top_candidate"`, create the album plan
  from the candidate `selectionHandle.id`; do not run a second search.
- Ask one concrete clarification only after the detector returns `ask_user`,
  `none`, no candidates, or no album-ready handle.
- Gate assistant success copy on a persisted operation plan id.
- Keep writes reviewable. The workflow creates a plan only; Gallery still
  applies after user review.
- Preserve open/flexible Pi behavior for unsupported requests.
- Use TDD for every slice and define full unit, integration, edge-case, and
  regression coverage before implementation.

## Non-Goals

- No direct apply/write tool.
- No change to operation-plan review UI semantics.
- No proactive album suggestion UI or background suggestion job.
- No objective best-photo or image-quality scoring.
- No place-name geocoding. `placeHint` is passed as text to the trip detector,
  which matches existing asset metadata.
- No generic event-album strict workflow beyond the recent-trip detector path.
- No replacement of all Pi tool use with strict workflows. Unsupported requests
  still use open orchestration with hard invariants.
- No strict implementation for explicit "top", "best", or "highlights" trip
  requests in this first workflow. Those remain routed to the existing bounded
  highlight curation path until they get their own strict workflow.

## Flow Ownership

`create_recent_trip_album` is strict:

- Pi may provide: user text, optional album name, optional place hint, and final
  explanation copy.
- Gallery workflow code owns: tool sequence, candidate selection, handle use,
  plan creation, error branching, and success gating.
- Open Pi tool orchestration is allowed only if the request does not match this
  supported workflow.

## User-Facing Behavior

For:

> Create an album for my recent trip to USA.

Gallery should:

1. Detect the `create_recent_trip_album` intent.
2. Extract `placeHint: "USA"` and default `albumName: "USA Trip"` unless the
   user supplied a name.
3. Call `findTripCandidates({ placeHint: "USA" })`.
4. If there is one high-confidence recommended candidate, call
   `proposeAlbumFromSelection` with that candidate's selection handle.
5. Show the reviewable plan.
6. Let the final assistant message state the assumed trip date range, selected
   count, and duplicate/stack exclusions only after the plan exists.

For:

> Create an album for my recent trip.

Gallery should call `findTripCandidates({})`. If there is one clear candidate,
it should create a `Recent Trip` album plan. If there are multiple plausible
candidates, it asks one question with concrete candidate labels.

For:

> Create an album for my recent trip to USA called Spring Break.

Gallery should preserve the supplied album name and still use the strict trip
workflow.

## Architecture

### Strict Workflow Registry

Add a runner-level registry:

```ts
type StrictWorkflowMatch =
  | {
      kind: 'create_recent_trip_album';
      albumName: string;
      placeHint?: string;
    }
  | { kind: 'unsupported' };
```

Production `pi-runtime` checks the registry before sending a user message to the
provider. If a workflow matches, the runner executes that workflow and bypasses
open provider tool orchestration for that turn.

The e2e runtime already contains deterministic recent-trip logic for acceptance
tests. Implementation should extract the shared workflow logic instead of
duplicating behavior in production and e2e runtimes.

### Intent And Slot Extraction

V1 should match only high-confidence generic album requests:

- includes an album creation phrase such as `create`, `make`, or `put together`;
- includes `album`;
- includes `recent trip`;
- does not include subjective highlight words: `top`, `best`, `highlight`,
  `favorite`, `pick`, `choose`;
- does not ask to add to an existing album or space.

Slot extraction:

- `albumName`: explicit `called "..."`, `called ...`, or default
  `<placeHint> Trip`; if no place hint exists, default `Recent Trip`.
- `placeHint`: raw text after common phrases such as `recent trip to X`,
  `recent trip in X`, or known normalized aliases like `USA`, `United States`,
  and `U.S.`. Extraction stops before album-name clauses such as `called`,
  `named`, or `as`, so `recent trip to USA called Spring Break` yields
  `placeHint: "USA"` and `albumName: "Spring Break"`. If extraction is
  uncertain, omit the hint rather than guessing.

If the router is uncertain, it returns `unsupported` and open Pi orchestration
continues.

### Workflow State Machine

```text
matched
  -> find_trip_candidates
  -> detector_result
    -> use_top_candidate
      -> validate_album_ready_handle
      -> propose_album_from_selection
      -> verify_persisted_plan
      -> success_message
    -> ask_user
      -> clarification_message
    -> none
      -> source_needed_message
    -> tool_error
      -> failure_message
```

The workflow must track state explicitly:

```ts
type StrictWorkflowState = {
  kind: 'create_recent_trip_album';
  planCreated: boolean;
  planId?: string;
  selectedCandidateDedupeKey?: string;
  selectionHandleId?: string;
  lastToolError?: string;
};
```

The assistant may say "I created/proposed a plan" only when `planCreated ===
true` and `planId` is present.

When `recommendation.action === "use_top_candidate"`, the workflow must select
the candidate whose `dedupeKey` exactly matches `recommendation.candidateDedupeKey`.
If the recommendation has no matching candidate, the workflow must not fall back
to `candidates[0]`; it should treat the detector result as inconsistent and ask
for a concrete source or surface a retryable detector failure.

### Tool Calls

The high-confidence path must use exactly:

```text
findTripCandidates
proposeAlbumFromSelection
```

It must not call:

- `searchAssets`;
- `proposeAlbumFromSearch`;
- `proposeAlbumOperations` with raw `assetIds`;
- any direct write/apply tool.

`proposeAlbumFromSelection` arguments:

```ts
{
  albumName: string;
  description: string;
  selectionHandleId: string;
  summary: string;
}
```

`selectionHandleId` must be copied from the chosen trip candidate, not from a
new search.

### Clarification Continuation

When the detector returns `ask_user`, the workflow stores the candidate labels
and dedupe keys in runner session state. A follow-up answer that selects one of
those candidates resumes the same strict workflow and calls
`proposeAlbumFromSelection` with the stored candidate handle.

If the follow-up does not clearly select a candidate, Pi asks one more concise
question or falls back to open orchestration without creating a plan.

### Error Handling

- `approval-required`: stop the turn and let Gallery approval UI resume the
  workflow. The strict workflow state must be persisted before pausing so the
  approved result can continue the same deterministic state machine without
  restarting open provider orchestration.
- `denied` or `unavailable` from `findTripCandidates`: explain that Gallery
  could not inspect trip candidates and ask for a concrete date/place source.
- `recommendation.action === "none"` or empty candidates: ask for one concrete
  source such as a date range or place.
- `recommendation.action === "ask_user"`: ask with candidate labels, not raw
  ids.
- Missing `selectionHandle.id`: explain that Gallery found a trip but could not
  prepare an album-ready selection.
- Zero-asset handle: do not call planning; ask for a different source.
- Planning failure: do not claim success; surface the failure and record
  `lastToolError`.
- Planning success: extract the persisted plan id from the tool result
  (`planId` or `plan.id`) and verify the session reaches plan-review state
  before emitting success copy.
- Provider errors should not occur on strict handled turns because the provider
  is bypassed. If final-copy generation is delegated to a provider later, the
  plan state still controls success language.

## Test-Driven Development

Implementation must begin with failing tests for each slice. No production code
for a slice should be written before the corresponding red tests exist.

### Slice 1: Matrix And Contract Regression

Tests:

- Capability matrix documents strict, hybrid, and open flow ownership.
- `create_recent_trip_album` is listed as the first strict workflow candidate.
- Hard invariants include persisted-plan gating and selection handles for asset
  sets.

### Slice 2: Workflow Router

Tests:

- Matches `Create an album for my recent trip to USA`.
- Matches `Make an album for my recent trip`.
- Matches explicit album names.
- Splits combined place and album-name clauses, for example `recent trip to USA
called Spring Break`.
- Extracts `USA`, `United States`, and `U.S.` as the same place hint.
- Omits the place hint when extraction is uncertain.
- Rejects highlight requests containing `top`, `best`, or `highlights`.
- Rejects add-to-existing-album, shared-space, question-only, and metadata-edit
  prompts.

### Slice 3: Deterministic Workflow Execution

Tests use a fake MCP client and assert exact tool calls:

- `use_top_candidate` calls `findTripCandidates` then
  `proposeAlbumFromSelection`.
- `selectionHandleId` equals the candidate handle id.
- Candidate selection uses `recommendation.candidateDedupeKey` exactly.
- If the recommended dedupe key is missing from `candidates`, no planning call
  occurs.
- No call to `searchAssets` occurs.
- No provider-visible `assetIds` are sent.
- Album name defaults to `USA Trip` or `Recent Trip`.
- Explicit album name is preserved.
- Description mentions duplicate/stack exclusion only when counts are present.

### Slice 4: Success Gating And Failure Paths

Tests:

- Success message is emitted only when the planning result contains a persisted
  plan id, either as `planId` or `plan.id`.
- If planning returns denied/error, the final message does not contain "plan is
  ready", "I created", or "I proposed".
- Empty candidates ask for a concrete date/place source.
- `ask_user` creates a single clarification question with candidate labels.
- Missing candidate handle does not call planning.
- Zero-asset candidate handle does not call planning.
- `approval-required` pauses without explanatory assistant copy.
- Approval resume continues the same strict workflow with the approved tool
  result and does not reroute the follow-up through open provider orchestration.
- Tool errors redact gateway tokens and secrets.

### Slice 5: Production Runtime Integration

Tests:

- Production `pi-runtime` routes strict recent-trip album prompts before calling
  the provider session.
- Unsupported prompts still reach open provider orchestration.
- A strict handled turn persists assistant output and leaves the session
  continue-able.
- A strict handled turn produces the same user-visible behavior as the e2e
  runtime.
- A successful strict handled turn leaves the session in plan-review state until
  the user applies or revises the plan.

### Slice 6: Session Continuation

Tests:

- `ask_user` stores candidate dedupe keys and handles in runner session state.
- A follow-up selecting a candidate resumes strict plan creation.
- A follow-up with an explicit album name can rename the pending strict plan.
- Expired or missing pending state asks the user to rerun the request rather
  than guessing.
- `approval-required` stores strict workflow state keyed by `toolCallId`.
- An approved strict planning result resumes through deterministic strict
  workflow code, validates the approved plan id, and does not call the provider.
- A denied strict planning approval clears pending state and emits deterministic
  failure copy without calling the provider.

### Slice 7: End-To-End Regression

Tests:

- Prompt: `Create an album for my recent trip to USA`.
- Tool sequence: `findTripCandidates,proposeAlbumFromSelection`.
- No `searchAssets` call.
- `agent_operation_plan` row exists after the turn.
- UI/session activity includes `operation-plan-ready`.
- The persisted plan contains exactly an album create operation and an album
  add-assets operation sourced from the trip candidate handle.
- Assistant text includes trip date range and selected asset count.
- Assistant text does not ask for dates before running the detector.
- Failed planning produces no plan card and no success copy.

## Edge Case Coverage

The final implementation is not complete until these cases have explicit tests:

| Case                                 | Expected behavior                                                                          |
| ------------------------------------ | ------------------------------------------------------------------------------------------ |
| Clear USA candidate                  | Create plan from candidate handle.                                                         |
| Clear no-place candidate             | Create `Recent Trip` plan from candidate handle.                                           |
| Explicit album name                  | Preserve user-provided name.                                                               |
| Combined place and name              | Parse `recent trip to USA called Spring Break` as USA source plus Spring Break album name. |
| Multiple close candidates            | Ask one choice question with labels.                                                       |
| No candidate                         | Ask for one concrete date/place source.                                                    |
| Low-confidence `none` recommendation | Ask for one concrete source.                                                               |
| Recommendation key mismatch          | Do not fall back to the first candidate; ask or surface a detector inconsistency.          |
| Candidate missing handle             | Explain that an album-ready selection was unavailable.                                     |
| Zero selected assets                 | Do not create a plan.                                                                      |
| Planning denied/error                | Do not claim plan creation.                                                                |
| Approval required                    | Pause for Gallery approval.                                                                |
| Approval resumed                     | Continue the same strict workflow from stored state.                                       |
| Highlight wording                    | Do not route to this strict workflow.                                                      |
| Unsupported prompt                   | Fall back to open Pi orchestration.                                                        |
| Duplicate/stack exclusion counts     | Mention them only after successful plan creation.                                          |
| Gateway/provider secret in error     | Redact before persisting or streaming.                                                     |
| Follow-up candidate selection        | Resume from stored candidate state.                                                        |

## Acceptance Criteria

- The production runner can satisfy `Create an album for my recent trip to USA`
  without provider-chosen MCP sequencing.
- The high-confidence path never searches by `country: "USA"` after
  `findTripCandidates` returns an album-ready handle.
- The UI shows a reviewable plan because a persisted operation plan exists.
- The assistant cannot claim success when no persisted plan exists.
- Open Pi behavior remains available for unsupported workflows.
- All tests listed above are implemented and passing before the feature ships.
