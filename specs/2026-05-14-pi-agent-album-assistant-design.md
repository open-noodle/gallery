# Pi Agent Album Assistant Design

Status: approved design, pending written spec review
Date: 2026-05-14
Worktree: `/home/pierre/dev/gallery/.worktrees/pi-agent-brainstorm`
Branch: `explore/pi-agent-brainstorm`

## Problem

Gallery should support a personal AI assistant that can help users organize photos into albums without giving the assistant uncontrolled write access.

The motivating workflow is:

```text
Organize the photos from my recent holiday into albums.
```

The assistant should be able to inspect the user's accessible library, reason about possible album groupings, and propose a concrete set of album changes. The user can then approve, disable, or revise individual proposed operations before anything mutates Gallery state.

This needs to feel similar to Codex or Claude Code permission flows:

- the agent asks for tool access when policy requires it;
- the user can approve once, approve for the session, approve matching requests, deny, or deny with feedback;
- a permissive `--dangerously-skip-permissions` mode can skip read/tool prompts inside the chosen policy;
- writes still require final explicit approval.

## Goals

- Build a personal, session-scoped album organization assistant.
- Keep Gallery server as the authority for auth, access checks, permission policy, audit logs, chat persistence, proposed operations, and final apply.
- Run model and agent execution in a first-party sidecar runner so compute is separate from the serve layer.
- Let users configure multiple encrypted provider credentials and choose a credential/model per session.
- Support permission presets and fully custom permission plans.
- Support strict per-tool approvals, escalation-only approvals, plan-only reads, and a YOLO `--dangerously-skip-permissions` read mode.
- Persist durable agent state in Gallery Postgres, including chat messages and audit logs.
- Use structured, dependency-aware proposed album operations that can be toggled individually.
- Start with albums only, and implement in many small vertical slices using TDD.

## Non-Goals

- Do not build an admin/global assistant in the MVP.
- Do not create long-lived reusable agent profiles in the MVP.
- Do not give the runner direct database, filesystem, storage, or unrestricted API access.
- Do not expose direct write tools to the agent loop.
- Do not support tags, ratings, archive/favorite, deletes, metadata edits, or album removals in the MVP.
- Do not run autonomous background agents without an active user session.
- Do not require built-in self-hosted model hosting for MVP.

## Existing Context

Gallery already has several primitives that should shape the implementation:

- API keys have granular permissions in `server/src/enum.ts` and are enforced during auth.
- Object access checks are centralized through `server/src/utils/access.ts` and `server/src/repositories/access.repository.ts`.
- Album create/update/add-asset behavior lives in `server/src/services/album.service.ts`.
- Background work uses BullMQ through `server/src/repositories/job.repository.ts`.
- A workflow/plugin system exists, but it is event-triggered automation rather than interactive chat with approvals.
- Web already has workflow, user settings, system settings, and API key management surfaces that can inform the Assistant UI.

The MVP should reuse access-control concepts and album service behavior, but should not force the interactive agent design into the existing workflow/plugin model.

## Product Shape

The first version is a dedicated Assistant page for signed-in users.

Session setup:

1. Select a provider credential and model.
2. Select a permission preset or customize a plan.
3. Select an approval mode.
4. Start a personal agent session.

Session workflow:

1. User chats with the assistant.
2. The runner requests Gallery tools.
3. Gallery gates each tool through access, session policy, and approval state.
4. The assistant proposes structured album operations.
5. The user toggles proposed operations or gives feedback.
6. The user applies approved operations through a deliberate apply action.

No chat message can directly mutate albums. Applying writes is separate from the agent loop.

## Architecture

Use a server-mediated tool model with a first-party sidecar runner.

```text
Web Assistant UI
  -> Gallery server
    -> Gallery Postgres
    -> Gallery storage/media APIs
    -> Agent runner sidecar
      -> Pi runtime
      -> selected provider/model
```

Responsibilities:

- **Gallery server** owns user auth, normal Gallery access checks, session policy, approval prompts, durable state, proposed operations, audit logs, and final apply.
- **Agent runner sidecar** owns Pi/model execution, active conversation runtime, streaming, and orchestration of tool calls.
- **Provider/model** receives only the data allowed by the session permission plan.

The runner is first-party and disabled until configured. The protocol should allow a local sidecar or a remote runner endpoint without changing Gallery's policy model.

## Sessions

Each run creates a server-owned `agent_session` for the signed-in user.

The session captures immutable snapshots of:

- selected provider credential metadata;
- selected model;
- permission plan;
- approval mode;
- runner endpoint/capability snapshot;
- initial context.

Changing user settings after session creation must not silently alter an active session.

Session statuses should include at least:

- `created`
- `running`
- `waiting_for_tool_approval`
- `waiting_for_plan_review`
- `applying`
- `completed`
- `cancelled`
- `interrupted`
- `failed`

If the runner restarts, Gallery should preserve the transcript, tool calls, and current plan. The session can be marked `interrupted`; a future runner can resume from Gallery's durable state.

## Permission Plans

Permission plans are preset-based but fully customizable.

Read scope:

- metadata
- thumbnails/previews
- originals

Provider exposure rules:

- which provider credentials can receive metadata;
- which can receive previews;
- which can receive originals;
- whether originals are restricted to local/self-hosted providers.

Asset scope:

- owned assets;
- accessible shared-space assets;
- locked assets only if explicitly enabled and the user has elevated access.

Write proposal scope for MVP:

- create album;
- add assets to new or existing album;
- update album title/description;
- set album cover.

Limits:

- max assets scanned per tool call/session;
- max previews/originals read per tool call/session;
- optional provider budget/cost guardrails;
- optional session expiration.

### Suggested Presets

- **Careful**: metadata only, no previews/originals, writes only as drafts.
- **Visual Organizer**: metadata plus previews, album proposals only.
- **Local Power User**: originals allowed for local/self-hosted providers, album proposals only.
- **Custom**: user edits all knobs.

## Approval Modes

Approvals are per logical Gallery tool call, not per asset row.

Modes:

- **Strict**: every tool call pauses for approval.
- **Ask on escalation**: metadata can be auto-approved, previews/originals require approval.
- **Plan-only**: reads inside the selected permission plan are auto-approved; writes still require final approval.
- **YOLO / `--dangerously-skip-permissions`**: skips interactive read/tool prompts inside the selected permission plan.

Hard boundaries:

- YOLO never bypasses normal Gallery access control.
- YOLO never bypasses the selected permission plan.
- YOLO never allows direct writes.
- All reads are still audited.
- All writes still require final explicit approval.

Approval decisions:

- allow once;
- allow for this session;
- allow matching requests within a bounded scope;
- deny;
- deny with feedback.

## Tool Model

The runner can only request narrow Gallery tools exposed by the server.

Initial read tools:

- `searchAssets(filters, limit)`
- `readAssetMetadata(assetIds)`
- `readAssetPreviews(assetIds)`
- `readAssetOriginals(assetIds)`
- `listAlbums()`
- `readAlbum(albumId)`

Planning tools:

- `proposeAlbumOperations(operations)`
- `reviseProposedOperations(planId, operations)`
- `summarizePlan(planId)`

The final apply endpoint is not an agent tool. It is a user action from Gallery UI.

Every tool call passes through a tool gate:

1. Check that the session belongs to the signed-in user.
2. Check normal Gallery access for requested albums/assets.
3. Check the selected permission plan.
4. Check whether an existing grant covers the request.
5. If approval is needed, persist a pending `agent_tool_call`.
6. If approved, execute the tool and append audit data.
7. Return a redacted success, denial, or approval-required result to the runner.

Tool call audit entries must store summaries and IDs, not full media bytes.

## Album Operation Model

All proposed writes are structured operations.

Operation fields:

- `id`
- `planId`
- `type`
- `summary`
- `targetKind`
- `targetId` when targeting an existing album
- `temporaryTargetId` when targeting a newly proposed album
- `assetIds`
- `payload`
- `dependencyIds`
- `riskLevel`
- `enabled`
- `status`
- `result`
- `error`

MVP operation types:

- `album.create`
- `album.addAssets`
- `album.updateDetails`
- `album.setCover`

Dependency examples:

- `album.addAssets` for a newly proposed album depends on the matching `album.create`.
- `album.setCover` for a newly proposed album depends on the matching `album.create`.
- Disabling a dependency should disable or block dependent operations.

The review UI can toggle individual operations or operation groups. Apply receives only approved operation IDs, validates dependencies, rechecks current access/state, and then executes mutations through existing album service behavior.

Apply-time drift must be handled explicitly. If an album was deleted, assets became inaccessible, or an operation no longer applies cleanly, that operation should fail independently where possible and report a clear result.

## Durable Data Model

Durable agent state lives in Gallery Postgres. The runner is ephemeral.

Tables:

### `agent_provider_credential`

User-owned provider credentials.

Fields:

- `id`
- `userId`
- `providerType`
- `label`
- `baseUrl`
- `encryptedSecret`
- `secretVersion`
- `models`
- `defaultModel`
- `createdAt`
- `updatedAt`
- `lastUsedAt`

Secrets must be encrypted at rest. Gallery currently has hashing helpers for secrets, but this feature needs reversible encryption. Add a small encrypted-secret service keyed by an instance secret/env key, with room for KMS or external secret storage later.

### `agent_session`

Session state and immutable snapshots.

Fields:

- `id`
- `userId`
- `credentialSnapshot`
- `modelSnapshot`
- `permissionPlanSnapshot`
- `approvalMode`
- `runnerEndpoint`
- `runnerSessionId`
- `status`
- `createdAt`
- `updatedAt`
- `endedAt`

Snapshots must not include raw provider secrets. Store only the credential metadata needed to explain and audit which credential/model was selected.

### `agent_message`

Persisted chat transcript.

Fields:

- `id`
- `sessionId`
- `role`
- `content`
- `providerMessageId`
- `toolCallId`
- `createdAt`

Content should support structured blocks so future messages can include text, redacted tool references, asset references, and plan references.

### `agent_tool_call`

Audit and approval state for tool requests.

Fields:

- `id`
- `sessionId`
- `toolName`
- `status`
- `approvalDecision`
- `requestSummary`
- `responseSummary`
- `redactedRequestMetadata`
- `redactedResponseMetadata`
- `dataClass`
- `assetCount`
- `albumCount`
- `providerSnapshot`
- `startedAt`
- `completedAt`
- `error`

### `agent_tool_grant`

Session-scoped approval grants.

Fields:

- `id`
- `sessionId`
- `toolName`
- `matchPolicy`
- `expiresAt`
- `createdAt`

### `agent_operation_plan`

Current and historical proposed plans.

Fields:

- `id`
- `sessionId`
- `revision`
- `status`
- `summary`
- `createdAt`
- `updatedAt`

### `agent_operation`

Individual proposed operations.

Fields:

- `id`
- `planId`
- `type`
- `summary`
- `payload`
- `dependencyIds`
- `enabled`
- `status`
- `result`
- `error`
- `createdAt`
- `updatedAt`

Do not store previews, originals, or bulky model request bodies in these tables.

## API Surface

Credential APIs:

- create/list/update/delete provider credentials;
- validate credential/model where possible;
- mark default model/credential.

Session APIs:

- create session;
- list user sessions;
- get session detail;
- cancel session;
- send message;
- stream session events.

Approval APIs:

- list pending tool calls;
- approve once;
- approve for session;
- approve matching request;
- deny;
- deny with feedback.

Plan APIs:

- get current plan;
- toggle operation;
- toggle operation group;
- request revision with user feedback;
- apply approved operations.

The OpenAPI and SDK generation should expose these as normal typed Gallery APIs, but the runner-facing tool endpoint should remain internal and authenticated separately from browser user traffic.

## Runner Protocol

The server-runner protocol should be small and explicit.

Gallery to runner:

- create or resume session;
- send user message;
- cancel session;
- provide approval result;
- request runner health/capabilities.

Runner to Gallery:

- stream assistant tokens/events;
- request tool execution;
- report model/provider errors;
- report session completion/failure.

Provider credentials:

- users can save multiple credentials per account;
- Gallery decrypts the selected credential when starting a session;
- Gallery sends session-scoped credential material to the runner;
- runner must not persist credentials;
- runner logs must redact secrets and provider request headers.

The MVP can use direct runner use of decrypted credentials. The protocol should leave room for a future provider proxy where the runner never sees raw provider secrets.

## User Experience

Dedicated Assistant page:

- credential/model selector;
- permission preset selector plus customize flow;
- approval mode selector;
- chat thread;
- pending tool approval panel;
- proposed album plan panel;
- per-operation toggles;
- apply button;
- audit/details drawer.

Tool approval prompt should show:

- tool name;
- human-readable reason;
- data class requested: metadata, previews, or originals;
- asset count and album count;
- provider/model receiving the data;
- matching existing grant if any;
- allow once, allow for session, allow matching, deny, and deny with feedback actions.

Final plan review should show:

- new albums to create;
- existing albums to update;
- assets to add per album;
- cover/title/description changes;
- dependencies and blocked operations;
- sampled thumbnails/previews where permitted;
- approve all, disable all, and individual toggles.

The UI should make existing-album changes especially explicit, for example:

```text
Add 42 assets to existing album "Portugal"
```

## Vertical Slice Roadmap

This feature must not be implemented as one large plan. Implementation should be split into small vertical slices that each ship a tested piece of user-visible or system-visible behavior.

Each slice must follow TDD:

1. Write focused failing tests for the behavior.
2. Implement the smallest code change that passes those tests.
3. Run the relevant server/web checks.
4. Review before moving to the next slice.

Suggested slices:

1. **Credential storage foundation**
   - encrypted credential table;
   - credential CRUD APIs;
   - tests for ownership, redaction, and encryption/decryption boundaries.

2. **Session shell**
   - session table and APIs;
   - create/list/get/cancel personal sessions;
   - permission plan and approval mode snapshots;
   - tests for user isolation and snapshot immutability.

3. **Persisted chat transcript**
   - `agent_message` table and APIs;
   - append/list messages;
   - tests for ordering, ownership, and content shape.

4. **Runner health and disabled-until-configured state**
   - server config/env for runner endpoint;
   - health/capability checks;
   - Assistant page disabled state;
   - tests for unavailable runner behavior.

5. **Internal tool gate without Pi**
   - implement one metadata read tool behind session policy;
   - strict approval path;
   - `agent_tool_call` audit rows;
   - tests for access checks, approval-required responses, approvals, denials, and audit persistence.

6. **Assistant page session setup**
   - minimal UI for selecting credential/model, permission preset, and approval mode;
   - starts a session;
   - tests for form behavior and API calls.

7. **Runner protocol stub**
   - sidecar service skeleton;
   - create session and echo messages;
   - streaming event path from runner through Gallery to UI;
   - tests around server-runner contract.

8. **Pi runtime integration**
   - runner calls Pi/model with a constrained tool registry;
   - no write tools;
   - tests with mocked provider/runner boundaries.

9. **Read tools expansion**
   - search assets, list albums, read album, read previews;
   - permission plan enforcement for metadata/previews/originals;
   - tests for each data class and approval mode.

10. **YOLO read mode**
    - skip interactive read approvals inside policy;
    - preserve audit logging;
    - tests proving normal access and permission plan checks still apply.

11. **Structured album plan storage**
    - operation plan and operation tables;
    - propose/revise operations;
    - dependency validation;
    - tests for operation shape and dependency blocking.

12. **Plan review UI**
    - grouped operation review;
    - individual toggles;
    - dependency-aware disabled states;
    - component tests for toggles and payloads.

13. **Apply approved operations**
    - server apply endpoint;
    - revalidate permissions/current state;
    - execute album operations through existing services;
    - tests for partial failures, dependency handling, and no unapproved writes.

14. **End-to-end album organizer flow**
    - mocked runner proposes album operations from a user prompt;
    - user toggles operations and applies;
    - focused e2e coverage for the happy path and one denial path.

These slices can be combined or split further during implementation planning, but they should preserve the same vertical behavior and TDD discipline.

## Testing Strategy

Server tests:

- credential encryption/redaction and ownership;
- session ownership and snapshot immutability;
- tool gate access checks;
- approval modes and grants;
- audit persistence;
- operation dependency validation;
- final apply revalidation and partial failure behavior.

Runner tests:

- runner protocol contract;
- no credential persistence;
- redacted logging;
- tool request/approval correlation;
- provider error propagation.

Web tests:

- session setup UI;
- approval prompt behavior;
- plan operation toggles;
- blocked dependency states;
- apply flow request payload.

E2E tests:

- create session with mocked runner;
- strict approval read path;
- YOLO read path with audit;
- propose, toggle, and apply album operations.

## Security And Privacy

- All server APIs must enforce signed-in user ownership.
- The runner must not receive raw database or storage credentials.
- The runner must not call normal album mutation APIs directly.
- Tool results must be scoped and minimized for the selected provider/model.
- Secrets must be encrypted at rest and redacted from logs.
- Tool call audits must avoid storing full media data or full provider payloads.
- Original media access must be explicit in the permission plan.
- Locked assets require explicit permission plan support and normal elevated access.
- Apply must revalidate every operation at execution time.

## Open Risks

- Secure encryption key management for stored provider credentials.
- Large-library context limits and summarization strategy.
- Provider privacy expectations for previews/originals.
- Runner restart/resume semantics.
- Streaming and approval UX complexity.
- Dependency handling for operation review.
- Apply-time drift when albums/assets changed after plan generation.
- Cost controls and provider rate-limit feedback.

## References

- Pi SDK documentation: https://pi.dev/docs/latest/sdk
- Pi usage and tool-call event documentation: https://pi.dev/docs/latest/usage
- Pi extensions and custom tools documentation: https://pi.dev/docs/latest/extensions
