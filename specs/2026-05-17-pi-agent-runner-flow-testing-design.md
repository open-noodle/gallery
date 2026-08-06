# Pi Agent Runner Flow Testing Design

Status: draft design
Date: 2026-05-17
Worktree: `/home/pierre/dev/gallery/.worktrees/pi-agent-brainstorm`
Branch: `explore/pi-agent-brainstorm`

## Problem

Pi now spans four asynchronous surfaces:

- browser chat UI;
- Gallery session, message, tool, and websocket services;
- first-party `agent-runner` HTTP/SSE boundary;
- Pi runtime tool-call and continuation behavior.

The riskiest user-visible regressions happen between those surfaces. A user can
send a message, see it locally, then the agent may request tool access. If the
user approves, Gallery must record the decision, show the handled tool activity
in chat, trigger the runner to continue, stream the continued answer, and leave
the composer usable again.

We have tests for many individual pieces, but we need an explicit matrix that
guards the full flow and prevents gaps like:

- the user message is persisted but not displayed;
- the runner requests approval but the approval card never appears;
- approval updates the database but does not resume Pi;
- the handled tool call appears only in a separate pile, not in chat order;
- the assistant continuation arrives all at once or never replaces streaming
  text with the persisted assistant message;
- reload loses the correct pending or completed state.

## Goals

- Define a layered test matrix for the message -> tool approval -> continuation
  flow.
- Prefer behavior-oriented tests that match what users observe.
- Keep fast unit/component tests for local behavior and add narrower integration
  tests where cross-boundary regressions happen.
- Make every slice TDD-ready: each slice starts with failing tests before
  implementation changes.
- Cover edge cases around streaming order, approval idempotency, reload, errors,
  and timeline ordering.
- Avoid real provider calls. Tests should use deterministic fake runner/Pi
  runtime behavior.

## Non-Goals

- Do not introduce browser-driven full E2E tests that require a real LLM
  provider.
- Do not test Pi SDK internals beyond the events and calls Gallery depends on.
- Do not rewrite the agent architecture for testability unless a slice exposes a
  small, necessary boundary improvement.
- Do not duplicate every component assertion at every layer.
- Do not require Docker or one-click provisioning for the fast test suite.

## Testing Layers

Use the smallest layer that proves the behavior.

| Layer                    | Purpose                                                                      | Example files                                 |
| ------------------------ | ---------------------------------------------------------------------------- | --------------------------------------------- |
| Web component tests      | User-visible UI behavior, composer state, cards, transcript order            | `web/src/routes/(user)/assistant/*.spec.ts`   |
| Server service tests     | Persistence, status transitions, websocket bridging, runner calls            | `server/src/services/agent-*.spec.ts`         |
| Runner HTTP tests        | `/sessions`, `/messages`, SSE, validation, continuation route behavior       | `agent-runner/src/server.test.mjs`            |
| Pi runtime tests         | Mapping Pi events to Gallery runner events, pause/resume semantics           | `agent-runner/src/pi-runtime.test.mjs`        |
| Thin integration harness | One deterministic end-to-end flow across server service + fake runner client | New focused server-side test helper if needed |

The matrix should not force every row into every layer. It should ensure each
behavior has at least one high-signal test at the layer where it can fail.

## Canonical Happy Path

The main flow to protect is:

1. User sends `Organize my Portugal photos`.
2. Chat immediately shows the user message.
3. Server persists the user message and sends it to the runner.
4. Runner/Pi requests a Gallery tool that requires approval.
5. Browser shows a plain-language approval card above the composer.
6. Composer is disabled while approval is pending.
7. User approves.
8. Server records the approval and calls the runner continuation path exactly
   once.
9. Pending card disappears.
10. Completed tool activity appears inline in chat with details collapsed.
11. Runner streams continued assistant deltas.
12. Browser renders deltas incrementally.
13. Completion persists the assistant message and clears streaming text.
14. Composer re-enables when the session is no longer blocked.

## Test Matrix

### Message Send And Display

| Case                          | Web expectations                                                               | Server expectations                                                          | Runner expectations                                                 |
| ----------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| User sends non-empty message  | User bubble appears; composer clears; composer disables while assistant active | `appendAgentSessionMessage` persists one user message and starts runner send | `/messages` receives gallery session id, message id, and text block |
| Empty/whitespace message      | No append call; composer stays enabled                                         | No message row                                                               | No runner call                                                      |
| Send fails before runner call | Error shown; draft retained; composer recovers                                 | No partial runner state                                                      | No runtime invocation                                               |
| Page reload after send        | User message rehydrates from transcript                                        | `getAgentSessionMessages` returns persisted message                          | Not applicable                                                      |

### Streaming Assistant Responses

| Case                      | Web expectations                                                            | Server expectations                                   | Runner expectations                        |
| ------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------ |
| First delta arrives       | Streaming text appears before completion                                    | SSE delta becomes websocket `assistant-message-delta` | Runtime yields delta immediately           |
| Multiple deltas           | Text appends in order; no dropped chunks                                    | Sequence/order preserved                              | Runtime event order preserved              |
| Completion after deltas   | Streaming text clears; persisted assistant message appears once             | Completion creates one assistant message              | Runtime emits final content/provider id    |
| Completion without deltas | Assistant message still appears                                             | Completion persists content                           | Runtime can complete with no deltas        |
| Runner error mid-stream   | Error shown; streaming clears; composer recovers according to session state | `runner-error` websocket sent; secrets redacted       | Runtime error mapped to generic safe event |

### Tool Approval Request

| Case                             | Web expectations                                                 | Server expectations                                              | Runner expectations                               |
| -------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------- |
| Tool requires approval           | Plain-language approval card appears; technical details hidden   | Tool call persisted as `PendingApproval` with counts and summary | Runtime returns approval-needed/tool-pause result |
| Pending approval blocks composer | Composer disabled with review-pending message                    | Session status is `WaitingForToolApproval`                       | Runtime is paused                                 |
| Details expanded                 | Raw tool name, request summary, counts, data class, time visible | Stored metadata is complete                                      | Not applicable                                    |
| Multiple pending approvals       | Cards sorted oldest first; count reported                        | `getToolCalls` returns pending calls deterministically           | Runtime may have multiple blocked tool calls      |
| Reload during pending approval   | Same approval card rehydrates                                    | Pending call is returned by `getToolCalls`                       | No duplicate runtime call                         |

### Approval Decision And Continuation

| Case                            | Web expectations                                                            | Server expectations                                                 | Runner expectations                                                     |
| ------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Approve pending call            | Approve button disables while busy; card resolves                           | Decision recorded as approved                                       | Continuation endpoint/client called once with tool call id and decision |
| Runner continues after approval | Assistant streaming starts without another user prompt                      | Continuation SSE bridged to websocket                               | Runtime `continue()` or fallback prompt resumes Pi                      |
| Approval card moves to chat     | Pending card disappears; handled tool activity appears inline in transcript | Tool call status becomes handled and is returned as recent activity | Runtime may continue independently of card rendering                    |
| Deny pending call               | Denial recorded; optional reason sent; agent receives denial context        | Decision recorded as denied with trimmed reason                     | Runtime receives denial context and continues or stops cleanly          |
| Duplicate approve click         | Only one API decision call; no duplicate continuation                       | Idempotent handling or safe conflict response                       | Runtime continuation called once                                        |
| Approve after already handled   | UI shows recoverable state; no stuck composer                               | Server returns safe handled state or conflict                       | Runtime not called again                                                |

### Chat Timeline And Activity Cards

| Case                             | Web expectations                                                | Server expectations                            | Runner expectations                                  |
| -------------------------------- | --------------------------------------------------------------- | ---------------------------------------------- | ---------------------------------------------------- |
| User -> tool -> assistant        | Transcript order matches timestamps/ids                         | Messages and tool calls have stable timestamps | Event order does not matter after persisted ordering |
| Completed tool call default view | Low-info text like `Pi checked your albums`; details collapsed  | Response summary remains available             | Not applicable                                       |
| Completed tool details           | Request, result/error, data class, time visible after expand    | Full audit metadata returned                   | Not applicable                                       |
| Failed tool call                 | Shows failed status and safe error in details                   | Error stored without secrets                   | Runtime/server redacts sensitive data                |
| Denied tool call                 | Shows not-allowed status, optional reason in details if exposed | Denial state persisted                         | Runtime receives denial                              |
| Same timestamp items             | Deterministic id tie-break                                      | Sort stable across refresh                     | Not applicable                                       |

### Reload And Recovery

| Case                                                          | Expected                                                                                          |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Reload during assistant streaming                             | Persisted messages reload; transient streaming text is gone; session status drives disabled state |
| Reload during pending approval                                | Approval card returns and composer remains blocked                                                |
| Reload after approval before assistant continuation completes | Handled card appears; session remains running/interrupted according to server state               |
| Reload after completion                                       | User message, tool activity, and assistant message all appear in order                            |
| Runner sidecar restarts                                       | Server reports recoverable runner/session error instead of hanging UI                             |

### Security And Privacy

| Case                               | Expected                                                                      |
| ---------------------------------- | ----------------------------------------------------------------------------- |
| Provider secret in runtime error   | Redacted from runner event, server websocket, and UI                          |
| Runner tool token in error         | Redacted everywhere                                                           |
| Approval details collapsed         | No raw internal route/token/provider fields visible                           |
| Unknown/future tool name           | UI falls back to safe generic copy; details show raw value only when expanded |
| Unauthorized session/tool approval | Server rejects; UI shows error; runner not called                             |

## Vertical Slices

### Slice 1: Server Tool Approval Continuation Contract

Scope:

- Service-level tests around `AgentToolService`, approval decisions, runner
  continuation calls, session status, and websocket events.
- Introduce or tighten a fake runner client that records continuation requests.

TDD tests:

- Approving a pending tool call persists decision and calls runner continuation
  once.
- Denying persists trimmed reason and calls runner continuation with denial
  context.
- Already-handled approvals do not trigger duplicate continuation.
- Continuation stream deltas are forwarded to websocket.
- Continuation completion persists an assistant message.

Edge cases:

- Runner continuation throws.
- Tool call belongs to another session/user.
- Session no longer has a runner session id.
- Approval succeeds but follow-up refresh/websocket fails.

Acceptance:

- Server tests prove approval is not only a database state change; it resumes the
  agent.

### Slice 2: Pi Runtime Pause/Resume Semantics

Scope:

- `agent-runner/src/pi-runtime.test.mjs` tests for Pi SDK session behavior.
- Focus on mapping Pi events to Gallery runner events.

TDD tests:

- User message appends to Pi session and streams text deltas.
- Tool approval-needed pauses without emitting final assistant completion.
- Approved tool call resumes Pi and streams continued response.
- If Pi cannot `continue()` from the current role, runtime uses the existing
  approval-context fallback prompt.
- Denied tool call resumes with denial context.

Edge cases:

- Approval context contains only safe IDs/decision/reason, not provider secrets.
- Runtime receives approval for unknown tool call id.
- Runtime session disposed while awaiting approval.
- Multiple text chunks and message-end ordering.

Acceptance:

- Runtime tests prove the agent can continue after approval without requiring a
  new user message.

### Slice 3: Agent Runner HTTP/SSE Approval Resume

Scope:

- `agent-runner/src/server.test.mjs` coverage for message send and continuation
  endpoints.
- Keep the runtime fake deterministic.

TDD tests:

- `/sessions/:id/messages` streams deltas before completion.
- Continuation request includes `toolCallId` and `approvalDecision`.
- Continuation response streams resumed assistant deltas and completion.
- Unknown runner session returns JSON error without invoking runtime.
- Malformed continuation body is rejected before runtime call.

Edge cases:

- Client disconnect during continuation.
- Runtime throws during continuation and emits safe `runner-error`.
- Gallery session id mismatch.
- Non-streaming accept headers if supported or rejected explicitly.

Acceptance:

- Runner server tests prove the HTTP/SSE boundary preserves approval context and
  streaming behavior.

### Slice 4: Web Chat And Approval UI Contract

Scope:

- Component tests for user message display, pending approval card, approve/deny
  button states, completed tool activity cards, and transcript ordering.
- Keep this slice entirely in `web/src/routes/(user)/assistant`.

TDD tests:

- User message appears immediately after send and composer blocks while active.
- Pending approval renders plain-language copy and disables composer.
- Details expansion reveals raw tool information.
- Approving hides pending card and shows handled card in chat when tool calls
  refresh.
- Handled tool card details reveal request/result/error.
- Multiple transcript items sort deterministically.

Edge cases:

- Zero asset/album counts.
- Unknown future tool name.
- Failed and denied handled calls.
- Duplicate clicks while busy.

Acceptance:

- Focused assistant component tests pass.
- No server or runner production changes required.

### Slice 5: Thin End-To-End Flow Harness

Scope:

- One deterministic test that exercises the complete flow without a real browser
  or provider.
- Prefer server-side integration with fake runner transport, fake websocket
  collector, and real agent services/repositories where practical.

TDD test:

1. Create session.
2. Append user message.
3. Fake runner emits approval-required tool call.
4. Assert pending approval websocket/state.
5. Approve tool call.
6. Assert runner continuation was called once.
7. Fake runner emits delta and completion.
8. Assert websocket events, persisted assistant message, handled tool call, and
   final session state.

Edge cases:

- Approval followed by runner error.
- Reload-style queries after every major step.
- Duplicate approval attempt after handled state.

Acceptance:

- One test fails if approval no longer triggers continuation.
- One test fails if the UI/server state cannot be reconstructed from persisted
  data after reload.

### Slice 6: Regression And Hardening Pass

Scope:

- Fill gaps discovered while implementing Slices 1-5.
- Add targeted tests only; avoid broad snapshots.

Candidate tests:

- Secret redaction across runner -> server -> UI.
- Same-timestamp deterministic transcript ordering.
- Failed/denied tool cards in chat.
- Composer recovery after runner errors.
- Polling/websocket refresh race between pending and handled tool calls.

Acceptance:

- The matrix rows marked critical have at least one test.
- No test depends on wall-clock timing beyond controlled fake timers.

## Recommended Order

The slices are numbered in the intended execution order:

```text
Slice 1 -> Slice 2 -> Slice 3 -> Slice 4 -> Slice 5 -> Slice 6
```

That order proves the approval continuation mechanism first, locks down the
runtime and runner boundaries next, then polishes the web behavior and adds one
cross-boundary test after the lower layers are easier to diagnose.

## Test Data Strategy

- Use deterministic UUIDs and timestamps.
- Use fake runner events instead of a real model.
- Use fake Pi SDK sessions with explicit event scripts:
  - text delta;
  - approval-needed;
  - resumed delta;
  - completion;
  - error.
- Avoid snapshots for chat markup. Assert accessible roles, visible copy,
  disabled/enabled states, and persisted DTOs.
- Prefer helper builders for `AgentSessionResponseDto`,
  `AgentMessageResponseDto`, and `AgentToolCallResponseDto` so each test only
  states the fields that matter.

## Open Questions

- Should the thin end-to-end harness run in the normal unit suite or a slower
  integration target?
  - Recommendation: start in the normal server test suite if it can use fakes
    and complete quickly. Move only if it becomes slow or requires real
    infrastructure.
- Should handled tool calls be persisted as message blocks rather than merged
  into transcript at render time?
  - Recommendation: keep the current merged timeline for now. Test the behavior
    through `getAgentSessionMessages()` plus `getToolCalls()` until product
    requirements demand immutable transcript event rows.
- Should web tests mock websocket events or server refreshes for approval cards?
  - Recommendation: cover both narrowly. Component tests can mock refresh state;
    server tests should own websocket bridging.

## Definition Of Done

- Each slice is implemented with TDD: failing tests first, then implementation,
  then green verification.
- The critical approval continuation path has at least one test that fails if
  approving a tool call does not trigger runner continuation.
- The UI has tests for user-visible state transitions:
  message sent, approval requested, approval handled, assistant continued.
- Runner tests prove streaming deltas are delivered before completion for both
  initial messages and approval continuation.
- Server tests prove tool call decisions are persisted, scoped to the session
  owner, and redacted on errors.
- The test suite remains deterministic and does not require a real provider.
