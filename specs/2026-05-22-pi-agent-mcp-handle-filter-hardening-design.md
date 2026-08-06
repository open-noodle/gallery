# Pi Agent MCP Handle And Filter Hardening Design

Status: draft design
Date: 2026-05-22
Branch: `explore/pi-agent-brainstorm`

## Production Failure

Session `181bee24-f0ee-471a-a23f-b057c6016a17` failed while handling:

> I went to South Africa in January this year - create an album for me with
> photos that have Pierre OR Aurelia in them

The persisted tool-call sequence showed three distinct problems:

1. Pi correctly called `resolveAssetSearchFilters` for `Pierre` and `Aurelia`,
   but the later `searchAssets` call did not include the returned `personIds`.
   The search only used country and date filters.
2. `searchAssets` created a valid server-side selection handle:
   `3facdeb4-ee83-4412-8fb2-6dcab5664de2`.
3. The final `proposeAlbumOperations` call used an invented/example-looking
   handle, `00000000-0000-4000-8000-000000000100`, so Gallery rejected the plan
   with `Selection handle is expired or not available for this session`.

No `agent_operation_plan` row was created. The session remained `running` and
the only persisted activity event stayed `start-processing/running`, which made
the UI look as if Pi was still working even after the assistant had sent a
failure response.

## Purpose

Make Pi's MCP tool use robust when smaller models plan from search results:

- prevent models from copying valid-looking example UUIDs into real tool calls;
- make resolved filters hard to drop between resolver and search calls;
- make invalid selection-handle errors actionable enough for the model to retry;
- ensure failed runner/tool flows do not leave stale "Pi is working" state;
- make Pi's background work understandable when the user opts into verbose
  activity, while keeping compact activity low-noise.

## Goals

- Keep all write behavior behind reviewable operation plans.
- Teach Pi to use the exact `selectionHandle.id` returned by `searchAssets`.
- Teach Pi to merge `resolveAssetSearchFilters.resolvedFilters` into the next
  `searchAssets.filters` call, including `personIds` and `spacePersonIds`.
- Avoid auto-applying or silently rewriting plans when Pi sends the wrong
  handle.
- Convert handle and placeholder mistakes into specific, recoverable MCP
  responses.
- Persist a terminal failed activity state and non-running session status when a
  runner turn ends after an unrecovered tool failure.
- Keep compact activity stable during tool-heavy runs, with no transient flash of
  raw log cards before the UI collapses back to "Pi is working".
- Provide an opt-in verbose activity view, implemented through the existing
  `expanded` activity mode, where users can see the detailed background tool
  timeline.
- Use TDD for every slice with full test and edge-case coverage: write failing
  tests first, verify the expected red failure, implement the smallest fix, then
  verify green. A slice is not complete until every edge case listed for that
  slice is covered by automated tests or explicitly documented as manual-only.

## Non-Goals

- No direct album/space/asset write MCP tools.
- No automatic plan creation by substituting a guessed handle server-side.
- No broad prompt rewrite unrelated to Gallery MCP tool use.
- No changing the user's existing permission preset or approval mode semantics.
- No broad UI redesign beyond accurate terminal state and explicit compact
  versus expanded/verbose activity behavior.

## Chosen Approach

Use contract hardening plus recoverable validation, not prompt-only fixes.

Prompt-only wording is too weak because models copy nearby examples under
pressure. Server-only rejection is also too weak because the model currently
turns the rejection into "Gallery had an internal issue" instead of retrying.
The design therefore changes three layers together:

- Generated MCP prompt/docs use obvious placeholder strings for values that must
  come from previous tool results.
- Tool validation responses identify copied-placeholder and invalid-handle
  mistakes, and include safe same-session recovery hints.
- Runner flow records a clean terminal state when the model does not recover.
- The activity UI treats "compact/thinking" and "expanded verbose timeline" as
  distinct modes. Compact mode stays stable and low-noise; the existing
  `expanded` mode intentionally exposes the tool-level work so users can inspect
  what Pi is doing.

## Design Details

### 1. Placeholder-Safe MCP Examples

The contract source can keep schema-valid fixture values for automated contract
tests, but model-facing generated examples must not expose real-looking UUIDs
for values the model should obtain from prior tool results.

Model-facing examples should render:

```json
{
  "assetSelectionHandleId": "<selectionHandle.id from searchAssets>"
}
```

instead of:

```json
{
  "assetSelectionHandleId": "00000000-0000-4000-8000-000000000333"
}
```

The same rule applies to example `assetIds`, `albumId`, `spaceId`, `tagId`,
`personId`, `spacePersonId`, `toolCallId`, `planId`, `operationIds`, and user
IDs wherever generated prompt/docs text is intended for model consumption.

Implementation should keep the existing contract validation value path, then add
a prompt/doc rendering layer that maps known fixture IDs to semantic placeholder
strings. This avoids weakening DTO/schema tests while making examples safer for
models.

### 2. Resolve-Then-Search Fidelity

`resolveAssetSearchFilters` already returns `resolvedFilters`. The generated
prompt should show an end-to-end example where the next `searchAssets` call
spreads those exact fields into `filters`:

```json
{
  "filters": {
    "country": "South Africa",
    "takenAfter": "2026-01-01T00:00:00.000Z",
    "takenBefore": "2026-01-31T23:59:59.999Z",
    "personIds": ["<Pierre personId>", "<Aurelia personId>"]
  },
  "detail": "ids",
  "createSelectionHandle": true
}
```

The prompt must explicitly state that user language like "Pierre OR Aurelia"
maps to a single `personIds` array containing both resolved IDs. If the resolver
returns `spaceId` and `spacePersonIds`, both must be carried into
`searchAssets.filters` together.

Gallery should not infer missing resolved filters from prior tool calls during
ordinary search execution. That would make the tool stateful in a way that hides
model mistakes and could surprise users. Instead, Gallery should make the
resolver output and examples clearer, and validation/recovery should remain
explicit.

### 3. Invalid Selection Handle Recovery

When `proposeAlbumOperations` receives an `assetSelectionHandleId` that is not
valid for the current session, Gallery should return a recoverable MCP error
that says:

- the provided handle is not available for this session;
- handles must be copied exactly from `searchAssets.selectionHandle.id`;
- if there are recent valid handles for this same session, list their IDs,
  asset counts, and created/source tool-call IDs;
- if the provided value matches a known generated-example fixture, say it looks
  like an example placeholder and must not be used directly.

The response should remain safe:

- only same-session handles are listed;
- expired handles are not suggested as usable. If the attempted handle belongs
  to the same session but is expired, the error should say it expired and should
  include compact `expiredSelectionHandle` metadata with `id`, `assetCount`,
  `sourceToolCallId`, and `expiresAt` plus an instruction to rerun
  `searchAssets`; if the attempted handle is not the expired same-session
  handle, expired handles stay omitted;
- no asset IDs are exposed through this recovery hint beyond what the original
  search result already returned;
- no server-side auto-substitution is performed.

The model-facing correction should be short enough to fit in context and
directive enough to cause a retry:

> Retry `proposeAlbumOperations` with the exact handle
> `3facdeb4-ee83-4412-8fb2-6dcab5664de2` if that is the intended search
> selection.

### 4. Tool Failure Language

The runner guidance should tell Pi that validation/denied MCP results are often
recoverable. Pi should not present them as "internal Gallery issue" until it has
either:

- retried with corrected arguments and failed again; or
- determined that required user information is missing.

For invalid handles, the intended model behavior is:

1. read the correction response;
2. retry `proposeAlbumOperations` with the exact returned handle;
3. only summarize a user-facing failure if the corrected retry also fails.

### 5. Terminal State Cleanup

If the runner turn completes with an assistant message after a tool failure and
no pending approval/plan state remains, Gallery should stop showing active
work. The session should not remain indefinitely `running` with only a
`start-processing/running` activity event.

Expected state after an unrecovered recoverable failure response:

- `agent_session.status` becomes `interrupted`, so the same chat remains
  appendable.
- A terminal `agent_session_activity_event` is recorded with `status: failed`.
- Activity polling and websocket updates stop showing "Pi is working" and expose
  the latest turn activity as failed.
- The user can still send another message to continue the same chat.

Use `agent_session.status = failed` only for unrecoverable infrastructure or
runner errors that should not be retried as normal chat. In both cases, the
activity state shown for the failed turn is terminal `failed`, not running.

### 6. Activity Preview Modes And Verbose Tool Logs

Tool-heavy assistant turns can produce many tool calls and activity events. That
detail is useful when a user wants to understand what Pi is doing, but it should
not leak into compact mode as a short flicker before collapsing back to the
summary.

The UI should make the distinction explicit without adding a second overlapping
mode. The current activity visibility contract is `off | compact | expanded`;
this design treats `expanded` as the verbose tool timeline.

- Compact/thinking mode: render one stable activity block for the active turn,
  for example `Pi is working`, plus the current plain-language step. It must not
  briefly render raw tool cards while polling, websocket events, or activity
  summarization are merging.
- Expanded/verbose activity mode: render a chronological timeline of meaningful
  activity rows/cards for the current turn. Many cards are acceptable here
  because the user intentionally opted in. The cards should use plain-language
  labels, status, timing, compact counts, and safe summaries of what each tool
  did.
- Off mode: hide passive activity while still showing required permission and
  plan-review cards.

Verbose cards should be more useful than the current low-information cards:

- show what Pi is trying to accomplish, not just the raw MCP tool name;
- show whether each step is running, completed, waiting, denied, failed, or
  skipped;
- show compact request/result summaries such as `Resolved 2 people`,
  `Found 250 matching photos`, `Prepared 1 album change`;
- keep technical MCP arguments behind an expand control;
- redact provider keys, original-file paths, private prompts, and oversized
  payloads;
- cap or virtualize very large timelines so hundreds of tool calls do not create
  a sluggish page.

Activity compaction/summarization should update the same turn-level view model
in place. It should not replace a compact block with raw rows for one render
frame and then replace those rows again with a summary.

## Data And Contract Changes

### Model-Facing Placeholder Rendering

Introduce a small helper responsible for rendering prompt-safe examples:

```ts
type AgentMcpPromptPlaceholderMap = Record<string, string>;
```

The helper maps known fixture values such as:

- `00000000-0000-4000-8000-000000000001` to `<asset-id-from-searchAssets>`
- `00000000-0000-4000-8000-000000000002` to `<another-asset-id-from-searchAssets>`
- `00000000-0000-4000-8000-000000000010` to `<album.id from listAlbums/readAlbum>`
- `00000000-0000-4000-8000-000000000020` to `<space.id from listSpaces/readSpace>`
- `00000000-0000-4000-8000-000000000021` to
  `<spacePersonIds value from resolveAssetSearchFilters>`
- `00000000-0000-4000-8000-000000000030` to
  `<tagIds value from resolveAssetSearchFilters>`
- `00000000-0000-4000-8000-000000000040` to
  `<personIds value from resolveAssetSearchFilters>`
- `00000000-0000-4000-8000-000000000111` to `<approved-toolCallId>`
- `00000000-0000-4000-8000-000000000222` to `<plan.id from proposed plan>`
- `00000000-0000-4000-8000-000000000333` to
  `<selectionHandle.id from searchAssets>`

If additional schema-valid fixture IDs are added to
`AgentMcpToolContractService`, Slice 1 should extend this map in the same change
that introduces the fixture. The mapping should be applied only to generated
prompt/docs rendering, not to the DTO schemas themselves or runtime tool
responses.

### Selection Handle Recovery Metadata

Extend failed planning responses or tool-call response metadata with compact
same-session handle hints:

```ts
type AgentSelectionHandleRecoveryHint = {
  attemptedSelectionHandleId: string;
  looksLikeExamplePlaceholder: boolean;
  availableSelectionHandles: Array<{
    id: string;
    assetCount: number;
    sourceToolCallId: string;
    createdAt: Date;
    expiresAt: Date;
  }>;
};
```

This metadata should be redacted and safe to persist in `agent_tool_call`.

### Activity State

No new table is required. The existing `agent_session_activity_event` table can
record a terminal failure event. The existing `agent_session.status` enum already
has `interrupted` and `failed`.

### Activity View Model Stability

No new database table is required for the `off | compact | expanded` distinction.
The frontend should derive a stable turn-level activity view model from messages,
tool calls, plans, and activity events before rendering. The view model should
preserve stable keys for the active turn and for individual expanded/verbose
rows, so polling and websocket updates merge into the existing UI instead of
causing a raw-card flash.

## Test Strategy

All implementation slices must use TDD:

1. Add or update the failing test first.
2. Run the narrow test and verify the expected red failure.
3. Implement the smallest production change.
4. Run the narrow test and verify green.
5. Run the relevant broader suite before committing.

Tests must cover both successful behavior and the production failure shape.
Every implementation plan derived from this spec must name the automated tests
for its slice before implementation starts. If an edge case is not testable at
the unit/integration/component level, the plan must state why and add a concrete
manual verification step.

Minimum coverage expectations:

- Unit tests for prompt/example rendering, resolver-to-search guidance,
  invalid-handle classification, same-session handle hinting, runner retry
  guidance, and activity view-model derivation.
- Service/integration tests for planning validation, selection-handle recovery,
  failed-turn cleanup, approval/plan wait states, and the deterministic
  production regression flow.
- Component tests for compact, expanded, and off activity rendering, including
  burst updates and mode changes while Pi is running.
- End-to-end or runner-flow regression coverage for the complete production
  sequence: resolve people, search with resolved filters, reject an example
  handle, retry with the real handle, and create a reviewable plan.

## Edge Cases

- A model submits a known example UUID as `assetSelectionHandleId`.
- A model submits a syntactically valid but nonexistent random UUID.
- A model submits a valid handle from a different session.
- A model submits an expired handle from the same session.
- Multiple valid handles exist in one session.
- No valid handles exist in the session.
- A search result created a handle but returned only sample IDs.
- Resolved `personIds` are omitted from the next search.
- Resolved `spacePersonIds` are supplied without `spaceId`.
- "A OR B" people language creates one search with both person IDs, not two
  separate searches that accidentally intersect.
- The runner returns an assistant failure message after a denied tool call.
- The runner pauses for approval and must not be marked failed/interrupted.
- A user can continue a session after a recoverable failure cleanup.
- Compact activity receives a burst of many tool calls and activity events.
- Websocket and polling updates arrive in either order for the same active turn.
- Activity summarization/compaction runs while the turn is still active.
- The user switches between compact, expanded/verbose, and off activity while Pi
  is running.
- Expanded/verbose mode receives dozens or hundreds of rows without freezing or
  rendering unsafe technical data by default.
- Reload during a tool-heavy turn reconstructs the same compact or
  expanded/verbose mode without a transient wrong state.

## Vertical Slices

### Slice 1: Prompt-Safe Placeholder Rendering

Scope:

- Add prompt/doc rendering that replaces schema-valid example UUIDs with
  semantic placeholders.
- Update generated MCP prompt and docs.
- Keep DTO/schema contract validation on real fixture values.

TDD coverage:

- Unit test that `AgentMcpPromptService.generatePromptCheatSheet()` does not
  contain known fixture UUIDs for selection handles, asset IDs, album IDs, space
  IDs, tag IDs, person IDs, space-person IDs, plan IDs, or tool-call IDs.
- Unit test that `AgentMcpDocsService.generateMarkdown()` does not contain known
  fixture UUIDs in model-facing JSON examples or JSON-RPC wrappers.
- Unit test that the prompt contains
  `<selectionHandle.id from searchAssets>`.
- Unit test that prompt/docs placeholders contain the expected semantic
  placeholders for each mapped fixture category.
- Unit test that contract examples are still schema-valid before placeholder
  rendering.
- Snapshot or focused generated-file test for the planning example.

Edge cases:

- Same fixture ID appearing in nested operation arrays.
- Placeholder rendering must not alter real IDs in runtime tool responses.
- Placeholder rendering must not mutate `listPromptExamples()`,
  `listDocumentedToolArgumentExamples()`, validation-correction
  `exampleArguments`, or any DTO/schema contract example.
- Generated docs marked JSON fences may contain placeholders and are no longer
  parsed as DTO examples after rendering; schema parsing remains on the
  pre-rendered contract/example objects.

### Slice 2: Resolve-Then-Search Guidance

Scope:

- Add an end-to-end generated prompt pattern for resolving named people and then
  searching with returned `personIds`.
- Clarify OR semantics for people filters.
- Clarify that `spacePersonIds` requires `spaceId`.

TDD coverage:

- Unit test that the generated prompt includes the resolver-to-search sequence.
- Unit test that the generated prompt names `personIds` and
  `spaceId`/`spacePersonIds`.
- Contract/docs test that the generated MCP docs include the same guidance.

Edge cases:

- Multiple people names.
- Shared-space people results.
- Resolver output with no matching person should lead to a question, not a broad
  unfiltered search.

### Slice 3: Invalid Selection Handle Recovery

Scope:

- Detect known example-placeholder handles during planning validation.
- Return compact same-session handle recovery hints for invalid handle errors.
- Preserve the denial/audit behavior for unsafe or unavailable handles.

TDD coverage:

- Unit test that `proposeAlbumOperations` with an example handle is denied with
  `looksLikeExamplePlaceholder: true`.
- Unit test that a same-session valid handle is listed in recovery hints.
- Unit test that cross-session handles are not listed as available.
- Unit test that expired handles are not suggested as usable.
- Unit test that no auto-substitution occurs and no plan row is created.

Edge cases:

- Multiple valid handles: list all compactly, do not choose one.
- No valid handles: instruct the model to rerun `searchAssets`.
- Attempted same-session expired handle: return expired-handle metadata and
  instruct the model to rerun `searchAssets`, without suggesting the expired
  handle as usable.
- Attempted handle is invalid UUID: return ordinary schema validation, not
  recovery metadata.

### Slice 4: Tool Failure Retry Guidance

Scope:

- Update runner prompt guidance so Pi treats validation/denied tool results as
  recoverable when a correction hint is present.
- Add examples of retrying `proposeAlbumOperations` with the corrected handle.
- Prevent "internal Gallery issue" language for first-pass validation mistakes.

TDD coverage:

- Unit test for generated runner prompt containing "retry with corrected
  arguments" guidance.
- Runner adapter test where a tool returns invalid-handle correction and the
  prompt context passed to Pi includes the correction.
- Regression test that unrecoverable provider errors still surface as
  actionable runner errors.

Edge cases:

- Approval-required tool calls must still pause instead of auto-retrying.
- Repeated corrected failure should produce a user-facing explanation.

### Slice 5: Failed Turn Activity Cleanup

Scope:

- When a runner turn ends with an assistant response after an unrecovered tool
  failure and no plan/approval wait state exists, mark the active work as failed
  or interrupted.
- Persist a terminal activity event.
- Keep the session appendable so the user can retry in the same chat.

TDD coverage:

- Integration test for the production shape: user message -> running activity ->
  denied planning tool -> assistant failure message -> session no longer appears
  busy.
- Test that waiting-for-approval state is not marked failed.
- Test that waiting-for-plan-review state is not marked failed.
- Test that user can append another message after cleanup.
- UI/service test that activity polling returns terminal failed activity for the
  turn while the recoverable session itself is `interrupted` and appendable.

Edge cases:

- Runner stream throws before assistant message.
- Runner completes with normal assistant message and no tool failure.
- Runner sends multiple activity events before failure.
- Session is cancelled while cleanup is happening.

### Slice 6: Activity Preview Stability And Expanded Verbose Timeline

Scope:

- Make compact/thinking activity render one stable active-turn block during
  high-volume tool execution.
- Make expanded/verbose activity intentionally render detailed, plain-language
  tool timeline rows/cards.
- Preserve the user's compact, expanded, or off activity choice while new tool
  calls, websocket events, polling results, and summaries arrive.
- Keep large verbose timelines performant with caps, grouping, or virtualization
  consistent with the existing activity UI.

TDD coverage:

- Pure view-model test where a burst of many tool calls and activity events
  produces one compact activity block with stable identity.
- Pure view-model test where the same burst in expanded mode produces ordered
  verbose rows/cards with plain-language labels, status, counts, and stable keys.
- Component test that compact mode never renders multiple raw tool cards between
  polling/websocket updates.
- Component test that expanded mode renders many rows only after the user selects
  expanded activity.
- Test that off mode hides passive activity while permission cards and
  plan-review cards still render.
- Test that polling-first and websocket-first update order produce the same
  compact and expanded/verbose view models.
- Test that activity summarization updates the existing active-turn block rather
  than replacing it with a transient raw-card state.
- Performance-focused test or component assertion that a large verbose timeline
  does not render an unbounded number of DOM nodes.

Edge cases:

- Fifty or more tool calls complete in one polling response.
- A running activity event arrives after completed tool-call rows.
- The user toggles compact -> expanded -> off -> compact while Pi is running.
- Reload during a tool-heavy turn keeps the selected activity mode.
- Technical details are available on demand but redacted and collapsed by
  default.
- Unknown MCP tools render safe fallback labels in expanded/verbose mode.

### Slice 7: End-To-End Regression

Scope:

- Add a deterministic runner/server flow that reproduces the production
  sequence without needing the real photo library:
  resolve people -> search creates selection handle -> model attempts example
  handle -> receives correction -> retries with real handle -> plan is created.

TDD coverage:

- End-to-end test that the first invalid handle does not create a plan.
- End-to-end test that the corrected retry creates a plan with the real handle.
- End-to-end test that the final session state is `waiting-for-plan-review`.
- Test that the search request includes resolved `personIds`.

Edge cases:

- The corrected retry should use the same temporary target IDs and album summary.
- The corrected retry should not duplicate the previous denied tool call as a
  visible plan.
- The test should not depend on the personal instance or real names.

## Manual Verification

After implementation and deployment to personal:

1. Start a new assistant chat.
2. Ask: `I went to South Africa in January this year - create an album for me
with photos that have Pierre OR Aurelia in them`.
3. Confirm Pi resolves people and searches with `personIds`.
4. Confirm broad results use a real `selectionHandle.id` in the plan.
5. Confirm the UI shows a reviewable plan instead of an internal-error apology.
6. If a deliberate invalid handle is injected in test mode, confirm the UI stops
   showing "Pi is working" and the chat remains usable.
7. During a tool-heavy run, confirm compact activity stays as one stable
   "Pi is working" block with no flash of many boxes.
8. Switch to expanded activity and confirm the detailed tool timeline is visible,
   understandable, and does not expose raw technical payloads unless the
   row-level technical details are expanded.
9. Switch activity off and confirm passive activity disappears while permission
   and plan-review cards still show.

## Open Decisions

None. This design chooses explicit retry guidance over automatic handle
substitution because album plans are write-intent data and should stay
traceable to model-provided arguments.
