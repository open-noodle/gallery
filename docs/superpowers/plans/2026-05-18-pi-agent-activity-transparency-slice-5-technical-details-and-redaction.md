# Pi Agent Activity Transparency Slice 5 Technical Details And Redaction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Use TDD for every task: write the failing test first, run it red, implement the smallest fix, then run focused and regression commands.

**Goal:** Add explicit per-row technical details to the assistant activity block for debugging while keeping the default activity UI plain-language, calm, and safe. Technical details must be hidden by default, opt-in per row, redacted, bounded, and never expose provider secrets, runner tokens, raw prompts, raw JSON payloads, or hidden reasoning.

**Architecture:** This is a frontend safety and disclosure slice. Extend the existing Slice 1 activity view model with a small technical-row formatter/redactor, then render those rows behind per-activity disclosure controls inside `AgentActivityBlock`. Keep the derived-activity approach from Slices 1-4. Do not add backend activity events, server storage, OpenAPI changes, or runner protocol changes.

**Tech Stack:** Svelte 5, TypeScript, Vitest, Testing Library, generated `@immich/sdk` DTO types, existing assistant route test patterns, existing activity view model/block/visibility controls.

---

## Source Spec

Implements Slice 5 from:

- `docs/superpowers/specs/2026-05-18-pi-agent-activity-transparency-design.md`

Builds on:

- `docs/superpowers/plans/2026-05-18-pi-agent-activity-transparency-slice-1-view-model.md`
- `docs/superpowers/plans/2026-05-18-pi-agent-activity-transparency-slice-2-chat-activity-block.md`
- `docs/superpowers/plans/2026-05-18-pi-agent-activity-transparency-slice-3-session-activity-visibility-controls.md`
- `docs/superpowers/plans/2026-05-18-pi-agent-activity-transparency-slice-4-live-updates-and-coalescing.md`
- `web/src/routes/(user)/assistant/agent-activity-ui.ts`
- `web/src/routes/(user)/assistant/agent-activity-block.svelte`
- `web/src/routes/(user)/assistant/agent-session-chat-panel.svelte`

Spec anchors:

- Technical details are explicit and hidden by default.
- Default row copy must not expose raw tool names, JSON, DTOs, provider internals, or hidden reasoning.
- Expanded technical details may show tool name, tool call id, safe request summary, safe response summary, redacted error, and timestamps.
- API keys, bearer tokens, runner tokens, provider secrets, raw prompts, and chain-of-thought must not be displayed.
- Invalid, circular, or very large metadata must not crash or bloat the UI.

## Scope

In scope:

- Add failing tests first for technical detail formatting, redaction, and rendering.
- Add a typed `AgentActivityTechnicalRow` helper shape for display-safe key/value rows.
- Add a redaction helper for all technical text displayed in activity details.
- Build technical rows from existing `AgentActivityItem.technical` fields:
  - tool name;
  - tool call ids;
  - request summary;
  - response summary;
  - error;
  - asset count;
  - album count;
  - started timestamp;
  - completed timestamp.
- Add optional safe future metadata support only through an explicitly safe/allowlisted field, not by dumping arbitrary DTO payloads.
- Cap long strings and long id lists so a coalesced row cannot render a huge debug panel.
- Render per-row `Technical details` controls only when the activity block is expanded and that row has safe technical rows.
- Keep technical details hidden in default compact activity UI.
- Keep the activity visibility modes from Slice 3 intact:
  - `off` hides the activity block and therefore hides technical details;
  - `compact` shows only the calm activity teaser;
  - `expanded` can reveal per-row technical details.
- Add i18n keys for the disclosure control and technical row labels.
- Add chat-panel regression coverage that technical details do not leak in compact/default activity, while expanded activity can reveal safe details.

Out of scope:

- New backend activity event table or API.
- New runner activity protocol events.
- OpenAPI/codegen changes.
- Raw MCP request/response bodies.
- Raw provider message payloads.
- Raw prompt text or model reasoning traces.
- Full reload/turn anchoring hardening; Slice 6 owns that.
- Final accessibility/performance polish beyond the controls introduced here; Slice 8 owns the broader polish pass.

## Product Decisions For This Slice

- Technical details are a debugging affordance, not part of normal activity reading.
- The first opt-in level is the activity block itself: users must expand the activity block before seeing per-row technical disclosure controls.
- Per-row details use display-safe label/value rows, not raw JSON.
- Coalesced rows may show multiple tool call ids, but the displayed list must be capped with a `+N more` style summary to avoid huge debug panels.
- Existing `requestSummary`, `responseSummary`, and `error` fields are treated as summaries, but they still pass through redaction and length caps before rendering.
- Unknown future metadata is hidden unless it is explicitly mapped into safe technical display rows by code. Do not enumerate arbitrary object keys from DTOs.
- Redaction should be conservative. It is acceptable to hide too much debug text if it prevents leaking a secret.
- Timestamps can render as stable raw ISO strings in technical details for this slice. Locale formatting is not required and can make tests brittle.

## TDD Commands

Red command:

```bash
pnpm --dir web exec vitest run src/routes/\(user\)/assistant/agent-activity-ui.spec.ts src/routes/\(user\)/assistant/agent-activity-block.spec.ts src/routes/\(user\)/assistant/agent-session-chat-panel.spec.ts src/routes/\(user\)/assistant/agent-session-action-dock.spec.ts src/routes/\(user\)/assistant/agent-conversation-pane.spec.ts
```

Focused green command:

```bash
pnpm --dir web exec vitest run src/routes/\(user\)/assistant/agent-activity-ui.spec.ts src/routes/\(user\)/assistant/agent-activity-block.spec.ts src/routes/\(user\)/assistant/agent-session-chat-panel.spec.ts src/routes/\(user\)/assistant/agent-session-action-dock.spec.ts src/routes/\(user\)/assistant/agent-conversation-pane.spec.ts
```

Regression commands:

```bash
pnpm --dir web exec vitest run src/routes/\(user\)/assistant/agent-activity-ui.spec.ts src/routes/\(user\)/assistant/agent-activity-block.spec.ts src/routes/\(user\)/assistant/agent-activity-visibility-ui.spec.ts src/routes/\(user\)/assistant/agent-activity-visibility-menu.spec.ts src/routes/\(user\)/assistant/agent-tool-approval-ui.spec.ts src/routes/\(user\)/assistant/agent-session-header.spec.ts src/routes/\(user\)/assistant/agent-session-chat-panel.spec.ts src/routes/\(user\)/assistant/agent-session-action-dock.spec.ts src/routes/\(user\)/assistant/agent-conversation-pane.spec.ts src/routes/\(user\)/assistant/agent-operation-plan-review-panel.spec.ts
pnpm --dir web run check:typescript
pnpm --dir web run check:svelte
git diff --check
```

No server or runner test commands are required because this slice does not change backend contracts or runner behavior.

If the optional `agent-activity-technical-ui.ts` helper is extracted, add
`src/routes/\(user\)/assistant/agent-activity-technical-ui.spec.ts` to the red,
focused, and regression commands above before implementation continues.

## Edge Cases Covered In This Slice

| Spec area        | Case                                                    | Slice 5 expectation                                                                                                  |
| ---------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Default safety   | Compact activity row has technical metadata             | Raw tool name, ids, request summary, response summary, errors, and JSON are hidden                                   |
| Disclosure       | Expanded activity row has technical metadata            | Row shows a `Technical details` button                                                                               |
| Disclosure       | User opens details                                      | Safe labels/values render in a bounded details panel                                                                 |
| Disclosure       | User closes details                                     | Details disappear and focus remains on the toggle                                                                    |
| Disclosure       | Activity item has no technical rows                     | No empty details button renders                                                                                      |
| Tool data        | Known tool call                                         | Details can show tool name, capped tool call ids, counts, request/response summaries, redacted error, and timestamps |
| Coalescing       | Many tool call ids                                      | Display caps the list and summarizes hidden ids                                                                      |
| Redaction        | OpenAI/provider key appears                             | Key is replaced with `[redacted]`                                                                                    |
| Redaction        | Bearer/Basic token appears                              | Token is replaced with `[redacted]`                                                                                  |
| Redaction        | URL contains token query params                         | Secret query values are replaced with `[redacted]`                                                                   |
| Redaction        | Runner token/session secret appears                     | Secret value is replaced with `[redacted]`                                                                           |
| Redaction        | Error contains multiple secret forms                    | All supported patterns are redacted in the same string                                                               |
| Privacy          | Request summary contains raw prompt or reasoning marker | It is hidden or reduced to a redacted placeholder instead of displayed verbatim                                      |
| Unknown metadata | Arbitrary unknown DTO object exists                     | It is ignored by default and never stringified wholesale                                                             |
| Unknown metadata | Explicit safe future metadata exists                    | Only safe scalar key/value rows render after redaction and length caps                                               |
| Robustness       | Circular or invalid metadata shape                      | Formatter does not throw and omits unsupported values                                                                |
| Robustness       | Very large metadata payload                             | Values are capped; UI does not render thousands of characters                                                        |
| Visibility       | Mode is `off`                                           | No activity block or technical details render; required action surfaces remain separate                              |
| Visibility       | Mode is `compact`                                       | No technical-details controls render                                                                                 |
| Visibility       | Mode is `expanded`                                      | Per-row technical controls can render without forcing any row open                                                   |
| Accessibility    | Technical toggle                                        | Button has accessible name, `aria-expanded`, `aria-controls`, keyboard support, and visible focus                    |

## Edge Cases Deferred To Later Slices

- Reload-specific reconstruction of historical activity blocks.
- Explicit `turnId`/`triggerMessageId` migration if timestamp grouping fails.
- Persisted server-side activity events for non-tool progress gaps.
- Runner progress events for apply/retry/recovery details.
- Full responsive/a11y polish for large transcripts and mobile layouts.
- User-wide default technical-detail preference. This slice intentionally keeps details closed by default every time.

## File Structure

Modify:

- `web/src/routes/(user)/assistant/agent-activity-ui.ts`
- `web/src/routes/(user)/assistant/agent-activity-ui.spec.ts`
- `web/src/routes/(user)/assistant/agent-activity-block.svelte`
- `web/src/routes/(user)/assistant/agent-activity-block.spec.ts`
- `web/src/routes/(user)/assistant/agent-session-chat-panel.spec.ts`
- `i18n/en.json`

Optional extraction if `agent-activity-ui.ts` grows too large:

- `web/src/routes/(user)/assistant/agent-activity-technical-ui.ts`
- `web/src/routes/(user)/assistant/agent-activity-technical-ui.spec.ts`

If these optional files are created, include the extracted spec in every TDD
and regression command for this slice.

Do not modify:

- `server/src/**`
- `agent-runner/src/**`
- `open-api/**`
- database migrations

---

## Task 1: Add Technical Redaction Helper Red Tests

**Files:**

- Modify: `web/src/routes/(user)/assistant/agent-activity-ui.spec.ts`
- Optional create: `web/src/routes/(user)/assistant/agent-activity-technical-ui.spec.ts`

- [ ] **Step 1: Add tests for exported redaction behavior**

Add tests for a helper such as `redactAgentActivityTechnicalText()` or equivalent.

Assert that it redacts:

- `sk-...` and `sk-proj-...` style provider keys;
- `Bearer <token>`;
- `Basic <token>`;
- `token=...`, `api_key=...`, `apikey=...`, `api-key=...`, `access_token=...`, `refresh_token=...`;
- URL query params with those secret names;
- `runner token <value>` and `runner_token=<value>`;
- multiple secret patterns in the same string.

Assert that non-secret Gallery ids, tool names, and counts are preserved.

- [ ] **Step 2: Add tests for raw prompt/reasoning suppression**

Assert technical text containing obvious unsafe markers does not display verbatim:

- `raw prompt: ...`
- `system prompt: ...`
- `chain-of-thought: ...`
- `reasoning trace: ...`

Expected behavior can be a generic `[redacted]` value or omission from technical rows, but it must not render the unsafe text.

- [ ] **Step 3: Add tests for length bounds**

Assert a very long technical string is capped to a deterministic maximum and includes a clear truncated marker.

Include a secret near the end of the long string to ensure redaction happens before or during truncation and the secret does not survive.

- [ ] **Step 4: Run the red helper command**

```bash
pnpm --dir web exec vitest run src/routes/\(user\)/assistant/agent-activity-ui.spec.ts
```

Expected red failure: missing exported redaction/formatting helpers or insufficient redaction coverage.

## Task 2: Add Technical Row Formatter Red Tests

**Files:**

- Modify: `web/src/routes/(user)/assistant/agent-activity-ui.spec.ts`
- Optional create: `web/src/routes/(user)/assistant/agent-activity-technical-ui.spec.ts`

- [ ] **Step 1: Add tests for display rows from a normal tool activity**

Given an `AgentActivityItem` with technical details, assert a helper such as `buildAgentActivityTechnicalRows(item)` returns rows for:

- tool name;
- tool call id;
- request summary;
- response summary;
- error;
- asset count;
- album count;
- started;
- completed.

Assert row label keys are stable, values are redacted, and rows with empty/null values are omitted.
Assert the helper returns stable label keys, not hardcoded English labels, so
the Svelte component can localize row labels through `svelte-i18n`.

- [ ] **Step 2: Add tests for coalesced ids**

Given `toolCallIds` with many entries, assert:

- the first small deterministic subset is shown;
- hidden ids are summarized, for example `+7 more`;
- the full id array is not dumped into the DOM-facing value.

- [ ] **Step 3: Add tests for safe future metadata only**

If adding a `safeMetadata` or similar field, assert:

- scalar safe values render as key/value rows after redaction;
- arrays render only when short and scalar;
- objects, functions, symbols, circular structures, and unknown raw DTO payloads are ignored;
- unsupported shapes do not throw.

If not adding a future-metadata field, add a regression test proving arbitrary unknown properties on `technical` are ignored.

- [ ] **Step 4: Add tests for items without technical rows**

Assert plan/apply/message rows without `technical` return an empty row list and do not create an empty disclosure UI.

- [ ] **Step 5: Run the red formatter command**

```bash
pnpm --dir web exec vitest run src/routes/\(user\)/assistant/agent-activity-ui.spec.ts
```

Expected red failure: no formatter exists or it exposes unsafe fields.

## Task 3: Implement Redaction And Formatting Helpers

**Files:**

- Modify: `web/src/routes/(user)/assistant/agent-activity-ui.ts`
- Optional create: `web/src/routes/(user)/assistant/agent-activity-technical-ui.ts`

- [ ] **Step 1: Add technical display row types**

Add a narrow display shape:

```ts
export type AgentActivityTechnicalRow = {
  id: string;
  labelKey: string;
  value: string;
  valueKind?: 'text' | 'code' | 'timestamp' | 'number';
};
```

Keep this separate from `AgentActivityTechnicalDetails`, which is source-ish normalized metadata.
Do not import `svelte-i18n` in the helper. The helper should return stable
`labelKey` values, and `AgentActivityBlock` should translate those keys when
rendering.

- [ ] **Step 2: Implement conservative redaction**

Implement and export a helper with deterministic behavior.

Minimum supported patterns:

- provider keys: `sk-...`, `sk-proj-...`;
- auth headers: `Bearer ...`, `Basic ...`;
- query/key assignments: `token`, `api_key`, `apikey`, `api-key`, `access_token`, `refresh_token`, `runner_token`;
- runner-token prose: `runner token ...`;
- URLs containing sensitive query params.

Ensure redaction runs before display and before final truncation.

- [ ] **Step 3: Implement prompt/reasoning suppression**

If a technical value clearly contains raw prompt/reasoning labels, do not show it verbatim. Prefer a generic value such as `[redacted unsafe prompt/reasoning text]`.

Do not attempt to detect all possible prompts; cover obvious markers from tests and keep the helper easy to reason about.

- [ ] **Step 4: Implement bounded formatting**

Use deterministic caps:

- cap individual text values to a modest length, for example 500 characters;
- cap displayed tool call ids, for example first 5 ids plus `+N more`;
- omit empty values.

- [ ] **Step 5: Implement technical row builder**

Build rows from known safe fields only. Do not stringify arbitrary objects.

Recommended row ids/label keys:

- `tool-name` / `assistant_activity_technical_tool`
- `tool-call-ids` / `assistant_activity_technical_tool_call`
- `asset-count` / `assistant_activity_technical_assets`
- `album-count` / `assistant_activity_technical_albums`
- `request-summary` / `assistant_activity_technical_request`
- `response-summary` / `assistant_activity_technical_response`
- `error` / `assistant_activity_technical_error`
- `started-at` / `assistant_activity_technical_started`
- `completed-at` / `assistant_activity_technical_completed`

For multiple ids, use label key `assistant_activity_technical_tool_calls`.

- [ ] **Step 6: Run helper tests green**

```bash
pnpm --dir web exec vitest run src/routes/\(user\)/assistant/agent-activity-ui.spec.ts
```

## Task 4: Add Activity Block Disclosure Red Tests

**Files:**

- Modify: `web/src/routes/(user)/assistant/agent-activity-block.spec.ts`

- [ ] **Step 1: Add compact-hidden tests**

Render a compact activity block with a row containing technical details.

Assert:

- default visible text does not include tool name, tool ids, request summary, response summary, error, timestamps, or JSON-like content;
- no `Technical details` button renders in compact mode;
- `Show activity` still works as the first opt-in level.

- [ ] **Step 2: Add expanded disclosure tests**

Render expanded mode with a technical row.

Assert:

- a per-row `Technical details` button appears;
- clicking it reveals a bounded details panel;
- safe labels and values render;
- secrets are redacted;
- clicking `Hide technical details` hides the panel;
- button has `aria-expanded` and `aria-controls`.

- [ ] **Step 3: Add no-empty-disclosure tests**

Rows without technical display rows should not render a technical details button.

Include plan/apply/message rows to prove non-tool rows stay clean unless they explicitly carry technical metadata.

- [ ] **Step 4: Add multiple-row independence tests**

Render two technical rows.

Assert:

- expanding row A does not expand row B;
- row keys remain stable across rerender;
- toggling one row does not change activity visibility mode.

- [ ] **Step 5: Add long-content layout tests**

Assert long redacted values render in a wrapping container and are capped.

This is a DOM/text assertion test, not a screenshot test.

- [ ] **Step 6: Run the red component command**

```bash
pnpm --dir web exec vitest run src/routes/\(user\)/assistant/agent-activity-block.spec.ts
```

Expected red failure: no per-row technical disclosure UI exists.

## Task 5: Implement Activity Block Technical Disclosure

**Files:**

- Modify: `web/src/routes/(user)/assistant/agent-activity-block.svelte`
- Modify: `i18n/en.json`

- [ ] **Step 1: Add i18n keys**

Add concise keys:

- `assistant_activity_technical_details`
- `assistant_activity_hide_technical_details`
- `assistant_activity_technical_tool`
- `assistant_activity_technical_tool_call`
- `assistant_activity_technical_tool_calls`
- `assistant_activity_technical_assets`
- `assistant_activity_technical_albums`
- `assistant_activity_technical_request`
- `assistant_activity_technical_response`
- `assistant_activity_technical_error`
- `assistant_activity_technical_started`
- `assistant_activity_technical_completed`

Tests may mock only the keys they assert.

- [ ] **Step 2: Render controls only in expanded activity mode**

Inside each visible row:

- call the technical row builder;
- if the activity block is expanded and rows exist, render a small per-row button;
- do not render the button in compact mode;
- do not render the button for empty technical rows.

- [ ] **Step 3: Render safe details as a definition list**

Use a bounded `<dl>` with labels and values:

- render row labels with `$t(row.labelKey)`;
- wrap long values;
- avoid raw `<pre>` JSON dumps;
- use monospace only for values where useful, such as ids and timestamps.

- [ ] **Step 4: Preserve focus and accessibility**

The toggle should:

- keep focus on click;
- expose `aria-expanded`;
- point `aria-controls` at the details panel;
- use stable ids from the Svelte component id plus item id.

- [ ] **Step 5: Run block tests green**

```bash
pnpm --dir web exec vitest run src/routes/\(user\)/assistant/agent-activity-block.spec.ts
```

## Task 6: Add Chat Panel Regression Red Tests

**Files:**

- Modify: `web/src/routes/(user)/assistant/agent-session-chat-panel.spec.ts`
- Modify: `web/src/routes/(user)/assistant/agent-session-action-dock.spec.ts`
- Modify: `web/src/routes/(user)/assistant/agent-conversation-pane.spec.ts`

- [ ] **Step 1: Add compact no-leak regression**

Render a session with a current-turn tool call containing:

- raw tool name;
- request summary with a provider key;
- response summary with a bearer token;
- error with a URL token.

Assert compact/default chat shows the human activity row but none of the technical values or raw secrets.

- [ ] **Step 2: Add expanded reveal regression**

Render the same state with `activityVisibilityMode: 'expanded'`.

Assert:

- `Technical details` appears on the activity row;
- opening it shows safe tool name/count/timestamp values;
- all secrets are redacted.

- [ ] **Step 3: Add off-mode regression**

Render with `activityVisibilityMode: 'off'`.

Assert:

- activity block and technical controls do not render;
- no standalone current-turn technical tool card appears as a fallback.

Keep these assertions in `agent-session-chat-panel.spec.ts`; do not try to
assert action-dock-owned surfaces from the chat panel.

- [ ] **Step 4: Add required-surface owner regressions**

In `agent-session-action-dock.spec.ts` and/or `agent-conversation-pane.spec.ts`,
render pending permission and plan-review states while activity visibility is
`off`.

Assert:

- permission approval controls remain visible and actionable;
- plan review remains visible and actionable;
- applied-plan cards remain separate from activity details;
- no technical details from activity rows are required to operate those surfaces.

- [ ] **Step 5: Add live-update no-leak regression**

After Slice 4 live refresh events update the tool-call state, assert newly arrived request/response/error text still goes through the technical formatter and does not leak in compact or expanded views.

- [ ] **Step 6: Run red integration command**

```bash
pnpm --dir web exec vitest run src/routes/\(user\)/assistant/agent-session-chat-panel.spec.ts src/routes/\(user\)/assistant/agent-session-action-dock.spec.ts src/routes/\(user\)/assistant/agent-conversation-pane.spec.ts
```

Expected red failure: technical disclosure UI and redaction behavior are not wired through chat, and owner-surface regressions are not covered yet.

## Task 7: Implement Chat Integration Adjustments

**Files:**

- Modify only if tests require it:
  - `web/src/routes/(user)/assistant/agent-session-chat-panel.svelte`
  - `web/src/routes/(user)/assistant/agent-session-chat-panel.spec.ts`
  - `web/src/routes/(user)/assistant/agent-session-action-dock.spec.ts`
  - `web/src/routes/(user)/assistant/agent-conversation-pane.spec.ts`

- [ ] **Step 1: Prefer component-level integration**

Most work should be inside `AgentActivityBlock`. The chat panel should not need to know how to format technical details.

- [ ] **Step 2: Ensure compact/off behavior remains unchanged**

If tests reveal chat-panel leakage:

- keep current-turn tool cards suppressed as in Slice 2-4;
- do not reintroduce handled tool-call cards to expose details;
- rely on expanded activity block disclosure instead.

- [ ] **Step 3: Ensure live refreshed technical data stays redacted**

No special live-update path should bypass the helper. The activity model should carry normalized technical fields, and the block should render only formatted rows.

- [ ] **Step 4: Run focused tests green**

```bash
pnpm --dir web exec vitest run src/routes/\(user\)/assistant/agent-activity-ui.spec.ts src/routes/\(user\)/assistant/agent-activity-block.spec.ts src/routes/\(user\)/assistant/agent-session-chat-panel.spec.ts src/routes/\(user\)/assistant/agent-session-action-dock.spec.ts src/routes/\(user\)/assistant/agent-conversation-pane.spec.ts
```

## Task 8: Regression, Static Checks, And Manual QA Notes

**Files:**

- No new production files expected beyond earlier tasks.

- [ ] **Step 1: Run assistant activity regression**

```bash
pnpm --dir web exec vitest run src/routes/\(user\)/assistant/agent-activity-ui.spec.ts src/routes/\(user\)/assistant/agent-activity-block.spec.ts src/routes/\(user\)/assistant/agent-activity-visibility-ui.spec.ts src/routes/\(user\)/assistant/agent-activity-visibility-menu.spec.ts src/routes/\(user\)/assistant/agent-tool-approval-ui.spec.ts src/routes/\(user\)/assistant/agent-session-header.spec.ts src/routes/\(user\)/assistant/agent-session-chat-panel.spec.ts src/routes/\(user\)/assistant/agent-session-action-dock.spec.ts src/routes/\(user\)/assistant/agent-conversation-pane.spec.ts src/routes/\(user\)/assistant/agent-operation-plan-review-panel.spec.ts
```

- [ ] **Step 2: Run static checks**

```bash
pnpm --dir web run check:typescript
pnpm --dir web run check:svelte
git diff --check
```

- [ ] **Step 3: Manual QA in the assistant UI**

Use a local assistant session with at least one tool call.

Verify:

- compact activity shows only plain-language rows;
- expanding activity reveals per-row technical toggles;
- opening technical details shows redacted safe fields;
- plan review, permission cards, applied-plan cards, streamed text, and final messages remain separate;
- no secrets, raw prompts, raw JSON payloads, or provider reasoning appear.

## Acceptance Checklist

- [ ] Tests were written before implementation and failed for the expected reason.
- [ ] Default/compact activity UI still contains only human-readable activity copy.
- [ ] Expanded activity can reveal per-row technical details.
- [ ] Technical details show only safe fields and are redacted.
- [ ] API keys, bearer/basic tokens, runner tokens, URL secret params, raw prompts, and reasoning markers are not displayed.
- [ ] Large/circular/invalid metadata cannot crash or bloat the activity block.
- [ ] Visibility `off`, `compact`, and `expanded` behavior remains consistent with Slice 3.
- [ ] Live-update paths from Slice 4 cannot bypass redaction.
- [ ] Permission cards, plan reviews, applied-plan cards, streamed text, and final messages remain separate surfaces.
- [ ] Focus and accessibility semantics are covered for the new disclosure controls.
- [ ] Focused tests, assistant regression tests, TypeScript, Svelte, and `git diff --check` pass.
