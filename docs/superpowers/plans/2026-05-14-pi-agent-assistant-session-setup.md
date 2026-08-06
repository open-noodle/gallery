# Pi Agent Assistant Session Setup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build vertical slice 6 exactly as specified by `docs/superpowers/specs/2026-05-14-pi-agent-album-assistant-design.md`: add a minimal Assistant page UI for selecting a credential/model, permission preset, and approval mode; start a session; and cover form behavior plus API calls with tests.

**Architecture:** This is a web-only session setup slice that consumes the server contracts already shipped by slices 1-4. Gallery server remains the authority for credential ownership, runner status, session creation, and permission-plan snapshots. The page constructs a valid `AgentSessionCreateDto` and displays the created session result. It does not introduce new server APIs, migrations, generated SDK changes, tool calls, approval UI, chat UI, runner protocol, streaming, or album plan behavior.

**Tech Stack:** Svelte 5, SvelteKit page load, `@immich/sdk`, `@immich/ui`, `svelte-i18n`, Testing Library, Vitest.

---

## Design Source

The design spec defines slice 6 as:

```text
Assistant page session setup
- minimal UI for selecting credential/model, permission preset, and approval mode;
- starts a session;
- tests for form behavior and API calls.
```

This plan intentionally stays inside that boundary.

## Scope

This slice implements:

- Assistant page load data for runner status and provider credentials.
- A minimal session setup form that:
  - is disabled when the runner is not configured or unhealthy;
  - is disabled when the user has no agent provider credentials;
  - selects an existing provider credential;
  - selects or enters a model for the selected credential;
  - selects a supported permission preset;
  - selects a supported approval mode;
  - creates an agent session via `createAgentSession`.
- A created-session confirmation/summary after successful session creation.
- Focused web tests for page load, form behavior, payload construction, API calls, success behavior, and error behavior.

This slice intentionally does not implement:

- Listing, resuming, or selecting existing sessions.
- Chat transcript rendering or message append UI.
- `agent_tool_call` APIs or approval prompts.
- Pi SDK/runtime calls.
- Runner protocol/session creation.
- Streaming events.
- Custom permission-plan editor.
- `dangerously-skip-permissions` / YOLO read mode.
- Album operation plans or album mutations.
- New OpenAPI generation or generated SDK changes.

## Conflict Boundaries

Slice 5 is expected to touch server tool DTOs, service/controller/repository files, migrations, OpenAPI, and generated SDK artifacts. This slice should avoid those areas.

Expected write set:

- `web/src/routes/(user)/assistant/+page.ts`
- `web/src/routes/(user)/assistant/+page.svelte`
- `web/src/routes/(user)/assistant/page-load.spec.ts`
- `web/src/routes/(user)/assistant/agent-runner-status-panel.svelte`
- `web/src/routes/(user)/assistant/agent-runner-status-panel.spec.ts`
- New assistant setup/page-content helper/component/spec files under `web/src/routes/(user)/assistant/`
- `i18n/en.json`
- This plan file

Avoid touching:

- `server/**`
- `open-api/**`
- `mobile/openapi/**`
- `web/src/lib/__mocks__/sdk.mock.ts` unless the current automatic function mock cannot support the tests.
- Slice 5 files such as `agent-tool*`, `agent_tool_call`, and any approval/tool controller.

If generated SDK changes appear during implementation, stop and investigate. Slice 6 should use only SDK exports that already exist on the green `explore/pi-agent-brainstorm` base:

- `getAgentRunnerStatus`
- `getAgentProviderCredentials`
- `createAgentSession`
- `AgentApprovalMode`
- `AgentPermissionPreset`
- `AgentRunnerStatusReason`
- `AgentSessionStatus`

## Existing Contracts

The web page can rely on these SDK shapes from slices 1-4:

```ts
type AgentProviderCredentialResponseDto = {
  id: string;
  providerType: ProviderType;
  label: string;
  baseUrl: string | null;
  models: string[];
  defaultModel: string | null;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string | null;
};

type AgentSessionCreateDto = {
  providerCredentialId: string;
  model: string;
  permissionPreset: AgentPermissionPreset;
  approvalMode: AgentApprovalMode;
  permissionPlan?: AgentPermissionPlan;
  runnerEndpoint?: string | null;
  initialContext?: Record<string, unknown>;
};

type AgentSessionResponseDto = {
  id: string;
  status: AgentSessionStatus;
  providerCredentialId: string | null;
  credentialSnapshot: AgentCredentialSnapshot;
  modelSnapshot: AgentModelSnapshot;
  permissionPreset: AgentPermissionPreset;
  approvalMode: AgentApprovalMode;
  createdAt: string;
  updatedAt: string;
  endedAt: string | null;
};
```

Create-session payloads in this slice must omit `permissionPlan`, `runnerEndpoint`, and `initialContext`:

```ts
{
  providerCredentialId: selectedCredential.id,
  model,
  permissionPreset,
  approvalMode,
}
```

## UI Behavior

The Assistant page should remain an application page, not a landing page. Use compact, work-focused panels with dense but readable information.

### Page Layout

- Keep `UserPageLayout title={data.meta.title}`.
- Render the existing assistant header and runner status panel.
- Render one setup panel below the status panel.
- Render a compact created-session summary after successful creation.
- Stack cleanly on mobile.
- Avoid nested cards.

### Runner Status

The existing `AgentRunnerStatusPanel` should be status-only. The actual start action belongs to the setup form.

Disabled behavior:

- If `runnerStatus.configured === false`, show the runner-not-configured reason and disable session creation.
- If `runnerStatus.configured === true && runnerStatus.healthy === false`, show runner-unavailable and disable session creation.
- If healthy, show version/capability details and allow the setup form to proceed when credential/model state is valid.

### Credential And Model Selection

Default selection rules:

1. If there are credentials, default to the first credential returned by `getAgentProviderCredentials`.
2. For the selected credential's model:
   - if `defaultModel` exists and `models` is empty, use `defaultModel`;
   - if `defaultModel` exists and is included in `models`, use `defaultModel`;
   - if `models` has values but `defaultModel` is missing or not included, use the first model;
   - if neither `defaultModel` nor `models` is present, leave the model empty and require user entry.

Model input behavior:

- Use a text input with a datalist or a select-plus-input pattern so credentials without a model list can still start sessions.
- Trim model text before submit.
- Disable submit for an empty model.
- When the selected credential changes, reset the model using the default selection rules above. This prevents sending a stale model from the previous credential.

Server contract reminder:

- If a credential has a non-empty `models` list, the server rejects models not in that list.
- The UI should guide toward listed models, but the server remains the source of truth.

### Permission Preset

Expose supported first-party presets:

- `AgentPermissionPreset.Careful`
- `AgentPermissionPreset.VisualOrganizer`
- `AgentPermissionPreset.LocalPowerUser`

Do not expose `AgentPermissionPreset.Custom` in this slice. `Custom` requires a `permissionPlan`, and building a permission-plan editor is outside slice 6.

### Approval Mode

Expose supported modes:

- `AgentApprovalMode.Strict`
- `AgentApprovalMode.AskOnEscalation`
- `AgentApprovalMode.PlanOnly`

Default: `AgentApprovalMode.Strict`.

Do not expose `AgentApprovalMode.DangerouslySkipPermissions` in this slice. It belongs with YOLO read mode and policy/audit tests in a later slice.

### Session Creation

On submit:

- Do nothing if the form is invalid or disabled.
- Set an `isCreating` state and disable submit while the request is in flight.
- Call `createAgentSession({ agentSessionCreateDto })`.
- On success:
  - store the returned session in local page state;
  - render a compact created-session summary with credential label, model, status, preset, and approval mode;
  - show success feedback using the existing toast pattern if appropriate.
- On failure:
  - keep the form state intact;
  - leave any previously created session summary unchanged;
  - surface the error with `handleError(error, $t('assistant_session_create_error'))` or an inline error that tests can assert.

Double-submit guard:

- A fast double click must produce only one `createAgentSession` call.

## File Plan

Create:

- `web/src/routes/(user)/assistant/agent-session-ui.ts`
- `web/src/routes/(user)/assistant/agent-session-ui.spec.ts`
- `web/src/routes/(user)/assistant/agent-session-setup-panel.svelte`
- `web/src/routes/(user)/assistant/agent-session-setup-panel.spec.ts`
- `web/src/routes/(user)/assistant/agent-session-page-content.svelte`
- `web/src/routes/(user)/assistant/agent-session-page-content.spec.ts`

Modify:

- `web/src/routes/(user)/assistant/+page.ts`
- `web/src/routes/(user)/assistant/+page.svelte`
- `web/src/routes/(user)/assistant/page-load.spec.ts`
- `web/src/routes/(user)/assistant/agent-runner-status-panel.svelte`
- `web/src/routes/(user)/assistant/agent-runner-status-panel.spec.ts`
- `i18n/en.json`

## Test Coverage Matrix

### Page Load

`web/src/routes/(user)/assistant/page-load.spec.ts`

Cover:

- authenticates the user with the current URL;
- returns translated metadata;
- calls `getAgentRunnerStatus`;
- calls `getAgentProviderCredentials`;
- returns runner status and credentials in `PageData`;
- empty credential list is returned as `credentials: []`;
- if `authenticate` rejects, no agent SDK calls are made;
- SDK failures are not swallowed in load; existing route error handling should apply.

### Pure Helpers

`agent-session-ui.spec.ts`

Cover:

- default credential id chooses first credential;
- default model uses included `defaultModel`;
- default model falls back to first listed model when default is absent;
- default model falls back to first listed model when default is not in a non-empty model list;
- default model uses `defaultModel` when the model list is empty;
- default model returns empty string when no model information exists;
- supported permission presets exclude `Custom`;
- supported approval modes exclude `DangerouslySkipPermissions`;
- label helpers cover every exposed preset/mode.

### Runner Status Panel

`agent-runner-status-panel.spec.ts`

Update existing tests to cover status-only behavior:

- not configured status reason;
- configured but unhealthy status reason;
- healthy status with protocol/version details;
- protocol fallback to translated `unknown`;
- no permanently disabled "Start session" button remains in this panel if the action moves to the setup form.

### Session Setup Panel

`agent-session-setup-panel.spec.ts`

Cover:

- disables submit when runner is not configured;
- disables submit when runner is unhealthy;
- disables submit when no credentials exist;
- disables submit when selected credential has no default/listed model and model input is blank;
- disables submit when manual model input is whitespace-only;
- enables submit when runner is healthy, credentials exist, and model is valid;
- chooses first credential by default;
- chooses default model when it is valid for the selected credential;
- falls back to first model when default model is missing or invalid for a non-empty model list;
- supports manual model entry when the selected credential has no model list;
- resets model when credential changes;
- defaults permission preset to `Careful`;
- defaults approval mode to `Strict`;
- lets the user choose `VisualOrganizer` and `AskOnEscalation`;
- does not render `Custom` preset as a selectable enabled option;
- does not render `DangerouslySkipPermissions` as a selectable enabled option;
- submits exactly:

```ts
{
  providerCredentialId,
  model,
  permissionPreset,
  approvalMode,
}
```

and does not include:

```ts
permissionPlan;
runnerEndpoint;
initialContext;
```

- trims the model before submitting the payload;
- does not call `createAgentSession` when disabled or invalid;
- disables submit while `createAgentSession` is in flight;
- fast double click makes one SDK call;
- on success, calls the parent success callback exactly once with the returned session;
- on failure, keeps the form values and shows/handles the error;
- on failure, clears the in-flight state so the user can retry.

### Page Composition

Create `agent-session-page-content.svelte` as the testable page body so `+page.svelte` stays a thin SvelteKit wrapper around `PageData`.

`agent-session-page-content.spec.ts`

Cover:

- healthy runner with credentials renders setup;
- successful create renders the created-session summary;
- created-session summary contains credential label, model, status, permission preset, and approval mode from the returned session;
- unavailable runner renders setup disabled;
- no-credentials state renders the disabled setup state.

## Implementation Tasks

### 1. Plan Branch And Baseline

- [ ] Work from a branch off green `explore/pi-agent-brainstorm`, for example `plan/pi-agent-slice-6` for this plan and `feat/pi-agent-slice-6` for implementation.
- [ ] Confirm no local worktree changes before implementation.
- [ ] Run current focused assistant tests to establish baseline:

```sh
pnpm --dir web test -- 'web/src/routes/(user)/assistant'
```

Expected: current assistant status/page-load tests pass before changing behavior.

### 2. Page Load TDD

- [ ] Update `page-load.spec.ts` first to expect `credentials` in addition to `runnerStatus`.
- [ ] Assert the SDK call to `getAgentProviderCredentials`.
- [ ] Run:

```sh
pnpm --dir web test -- page-load.spec.ts
```

Expected: fail because `+page.ts` only loads runner status.

- [ ] Update `+page.ts` to import and call `getAgentProviderCredentials`.
- [ ] Prefer `Promise.all` after authentication/formatter setup:

```ts
const [runnerStatus, credentials] = await Promise.all([getAgentRunnerStatus(), getAgentProviderCredentials()]);
```

- [ ] Return `{ meta, runnerStatus, credentials }`.
- [ ] Re-run `page-load.spec.ts`.

### 3. Pure Helper TDD

- [ ] Create `agent-session-ui.spec.ts` with helper tests from the matrix.
- [ ] Run:

```sh
pnpm --dir web test -- agent-session-ui.spec.ts
```

Expected: fail because helper module does not exist.

- [ ] Create `agent-session-ui.ts`.
- [ ] Export:
  - `getDefaultModel(credential)`
  - `getInitialCredentialId(credentials)`
  - `permissionPresetOptions`
  - `approvalModeOptions`
  - label helpers for exposed preset/mode/status values.
- [ ] Re-run helper tests.

### 4. Runner Status Panel Refactor

- [ ] Update `agent-runner-status-panel.spec.ts` to remove the old permanent disabled start button assertion and pin status-only behavior.
- [ ] Run:

```sh
pnpm --dir web test -- agent-runner-status-panel.spec.ts
```

Expected: fail while the old disabled button is still rendered.

- [ ] Refactor `agent-runner-status-panel.svelte`:
  - keep assistant title/status/capability details or make it a compact status section;
  - remove the disabled start button;
  - preserve accessible status text and existing runner-state copy.
- [ ] Re-run the status panel spec.

### 5. Session Setup Panel TDD

- [ ] Create `agent-session-setup-panel.spec.ts` covering disabled states, selection defaults, model reset, payload construction, success, error, and double-submit behavior.
- [ ] Run:

```sh
pnpm --dir web test -- agent-session-setup-panel.spec.ts
```

Expected: fail because the component does not exist.

- [ ] Create `agent-session-setup-panel.svelte`.
- [ ] Props:

```ts
interface Props {
  runnerStatus: AgentRunnerStatusDto;
  credentials: AgentProviderCredentialResponseDto[];
  onSessionCreated: (session: AgentSessionResponseDto) => void;
}
```

- [ ] Use Svelte 5 runes consistently with nearby code.
- [ ] Use `Field`, `Input`, `Select`, `Button`, `Icon`, and `Text` from `@immich/ui` where they fit existing app patterns.
- [ ] Disable submit from a single derived `canCreateSession`.
- [ ] Use `createAgentSession` from `@immich/sdk`.
- [ ] Handle errors with existing `handleError` pattern or a local inline error that does not fight global toast behavior.
- [ ] Re-run the setup panel spec until green.

### 6. Page Composition

- [ ] Create `agent-session-page-content.spec.ts` covering page-body wiring and created-session summary behavior.
- [ ] Run:

```sh
pnpm --dir web test -- agent-session-page-content.spec.ts
```

Expected: fail because the component does not exist.

- [ ] Create `agent-session-page-content.svelte` to own local page state:
  - `createdSession` initialized to `null`;
  - `handleSessionCreated(session)` sets `createdSession`.
- [ ] Render:
  - `AgentRunnerStatusPanel`;
  - `AgentSessionSetupPanel`;
  - created-session summary only after a successful create.
- [ ] Re-run `agent-session-page-content.spec.ts`.
- [ ] Update `+page.svelte` to render `AgentSessionPageContent` with `data.runnerStatus` and `data.credentials`.

### 7. i18n Copy

- [ ] Add required English keys in `i18n/en.json`.
- [ ] Keep copy short and operational. Candidate keys:

```json
"assistant_approval_mode": "Approval mode",
"assistant_approval_mode_ask_on_escalation": "Ask on escalation",
"assistant_approval_mode_plan_only": "Plan review only",
"assistant_approval_mode_strict": "Strict",
"assistant_created_session": "Created session",
"assistant_model": "Model",
"assistant_no_credentials": "Add an agent provider credential before starting a session.",
"assistant_permission_preset": "Permission preset",
"assistant_permission_preset_careful": "Careful",
"assistant_permission_preset_local_power_user": "Local power user",
"assistant_permission_preset_visual_organizer": "Visual organizer",
"assistant_provider_credential": "Provider credential",
"assistant_session_create_error": "Unable to start assistant session",
"assistant_session_created": "Assistant session started",
"assistant_session_setup": "Session setup"
```

- [ ] Do not add visible explanatory paragraphs describing how to use the app. Labels, disabled-state messages, and concise field descriptions are acceptable.

### 8. Focused Verification

- [ ] Run focused assistant tests:

```sh
pnpm --dir web test -- 'web/src/routes/(user)/assistant'
```

- [ ] Run web type checks:

```sh
pnpm --dir web check:svelte
pnpm --dir web check:typescript
```

- [ ] Run web lint:

```sh
pnpm --dir web lint
```

- [ ] Run formatting check:

```sh
pnpm --dir web format
```

- [ ] Run whitespace check:

```sh
git diff --check
```

If the implementation touches only assistant web files and i18n, server/OpenAPI checks should not be necessary before PR. If any server or generated SDK file changes unexpectedly, run the appropriate server/OpenAPI checks and document why the scope changed.

## Review Checklist

- [ ] No `server/**`, `open-api/**`, or `mobile/openapi/**` changes.
- [ ] No session list/resume/select behavior.
- [ ] No slice 5 tool-call/approval API assumptions.
- [ ] `Custom` preset is not exposed or sent without a permission plan.
- [ ] `DangerouslySkipPermissions` is not exposed.
- [ ] Create payload omits `permissionPlan`, `runnerEndpoint`, and `initialContext`.
- [ ] Runner unavailable states prevent creating a session.
- [ ] Empty credential state prevents creating a session.
- [ ] Auth failure prevents runner/credential SDK calls in page load.
- [ ] Model selection resets on credential change.
- [ ] Whitespace-only model input cannot be submitted.
- [ ] Submitted model is trimmed.
- [ ] Failed session creation clears in-flight state and allows retry.
- [ ] Created-session summary is covered by tests.
- [ ] Fast double-submit is guarded.
- [ ] Tests cover form behavior and API calls.

## Future Slice Handoff

After slice 6:

- A later session navigation/chat slice can add listing/resuming existing sessions.
- Slice 7 can attach runner protocol and streaming.
- Slice 10 can expose YOLO read mode with server-side policy/audit support.
- Slice 12 can add approval/plan review UI once slice 5 and plan storage exist.
