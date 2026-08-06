# Pi Agent Strict/Hybrid Workflow Foundation Design

Status: draft design
Date: 2026-05-29
Branch: `explore/pi-agent-brainstorm`

## Purpose

`create_recent_trip_album` proved that owning the tool sequence for a
well-defined intent makes a class of LLM-reliability failures impossible. It is
a working vertical slice, not yet a platform. This spec turns that slice into a
foundation that future strict and hybrid workflows can be built on cheaply and
safely.

It covers five foundation changes, all of which should land before the second
strict workflow:

1. A single-source-of-truth **workflow registry/manifest**.
2. A generalized **strict/hybrid workflow protocol + runtime dispatcher**.
3. **LLM intent classification** (regex fast-path, structured-output fallback)
   replacing the regex-only router as the front door.
4. **Durable workflow continuation state** persisted server-side.
5. **Final-copy delegation** (LLM phrasing gated on plan state) and
   **observability** for router and gate behavior.

It does not define new user-facing capabilities. It defines the substrate that
makes `rename_or_describe_album`, `add_photos_to_album`, `manage_space_members`,
and metadata-batch workflows each a small, self-contained addition.

## Context

See [capability matrix](./2026-05-19-pi-agent-capability-matrix.md) and
[strict recent trip album design](./2026-05-28-pi-agent-strict-recent-trip-album-design.md).
The current implementation is:

- `agent-runner/src/strict-workflows.mjs`: regex matcher (`matchStrictWorkflow`),
  slot extraction, the `create_recent_trip_album` executor, candidate-selection
  continuation, success gating, redaction.
- `agent-runner/src/pi-runtime.mjs`: a 1,570-line runtime that inlines the
  strict-workflow branches into `sendMessage` (~318 lines) and `resumeSession`,
  holds continuation state in the in-memory `sessions` Map field
  `pendingStrictWorkflow`, and emits `strictCompletedEvent` /
  `strictApprovalEvent`.
- Server: `trip-candidate.service.ts`, selection handles
  (`agent_selection_handle`), revision-based operation plans
  (`agent_operation_plan`), activity events (`agent_session_activity_event`).

Five structural limits block the next workflow:

| #   | Limit                                                                                          | Symptom when adding workflow #2                                                                                                                                               |
| --- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L1  | Everything is keyed to `create_recent_trip_album` (state `kind`s, runtime branches).           | Copy ~400 lines + the runtime branches; find/replace the kind string.                                                                                                         |
| L2  | The router is English-only regex with a negative `nonGenericPattern` filter and no precedence. | Strict mode fires only on canonical phrasing; everything else falls back to the open path — the exact path that caused the original bug. Patterns interfere; no localization. |
| L3  | Continuation state is in-memory only.                                                          | A restart or a second runner instance loses `ask_user` / approval state; the design doc's "persist before pausing" intent is unmet.                                           |
| L4  | Matched turns bypass the provider, so copy is templated.                                       | Rigid, un-localizable copy; no same-turn side answers.                                                                                                                        |
| L5  | The capability matrix is validated by `expect(markdown).toContain(...)`.                       | Doc and behavior drift independently; no typed source of truth.                                                                                                               |

## Goals

- One declarative registry that the runtime router, the classifier prompt, the
  capability-matrix doc, and observability all derive from.
- A workflow protocol that expresses both **strict** (deterministic sequence)
  and **hybrid** (deterministic write-plan, bounded read/resolve) execution, so
  the same machinery serves both columns of the flow-ownership matrix.
- Adding a workflow means implementing `match`/`parseSlots`/`run`/optional
  `resume*` against the protocol and adding one manifest entry — no new runtime
  wiring.
- Higher router recall via LLM classification, with execution still fully
  deterministic, so recall improves without weakening any safety invariant.
- Continuation and approval state that survives runtime restart and works across
  multiple runner instances.
- Every existing `create_recent_trip_album` behavior and test is preserved by a
  migration onto the new protocol (the regression anchor).

## Non-Goals

- No new MCP write tools and no change to operation-plan review/apply semantics.
- No removal of open Pi orchestration; unmatched requests still use it with the
  current hard invariants.
- No subjective/visual resolution ("best", "blurry", "irrelevant") promoted into
  strict/hybrid; that stays in open orchestration until quality-scoring tools
  exist (see capability matrix "Needs New MCP Tool").
- No third-party MCP routing, no autonomous background reorganization.
- No per-workflow product copy decisions; this spec defines the copy _mechanism_,
  not the wording of future workflows.

## Foundation Pillars

| Pillar                   | Replaces                                    | Core deliverable                                                        |
| ------------------------ | ------------------------------------------- | ----------------------------------------------------------------------- |
| P1 Registry              | scattered constants + prose matrix          | `strict-workflows/manifest` shared by runtime + server                  |
| P2 Protocol + dispatcher | inlined `create_recent_trip_album` branches | `StrictWorkflow` interface, `WorkflowOutcome` union, generic dispatcher |
| P3 Classification        | regex-only `matchStrictWorkflow`            | regex fast-path → LLM structured classify → `parseSlots`                |
| P4 Durable state         | in-memory `pendingStrictWorkflow`           | `workflow-state-update` event + `agent_session` persistence             |
| P5 Copy + observability  | templated copy, untracked routing           | `CopyMode`, structured success summary, router/gate activity events     |

---

## P1 — Workflow Registry (single source of truth)

A declarative manifest is the spine. It holds _metadata_ (what workflows exist,
how to recognize them, what they require, where they sit in the flow-ownership
matrix). Execution code lives separately and references manifest entries by
`kind`.

Location: `agent-runner/src/strict-workflows/manifest.mjs` exporting a plain
object, importable by the runtime (`.mjs`) and readable by server tooling (TS
can import the same JSON-serializable object via a tiny generated `.json`
mirror, or read the file). Plain-data only, no functions, so both languages and
the doc generator can consume it.

```ts
type WorkflowManifestEntry = {
  kind: string; // 'create_recent_trip_album'
  flow: 'strict' | 'hybrid';
  title: string; // 'Create recent trip album'
  classifierDescription: string; // one line the classifier reads
  positiveExamples: string[]; // canonical + paraphrased prompts
  negativeExamples: string[]; // near-miss prompts that must NOT match
  slots: Record<string, { type: 'string'; required: boolean; description: string }>;
  requiredReadTools: string[]; // e.g. ['findTripCandidates']
  planTool: string; // e.g. 'proposeAlbumFromSelection'
  supportsContinuation: boolean; // multi-turn disambiguation
  matrixRow: { capability: string; tier: string; workflowOrBoundary: string };
};
```

Consumers:

- **Router (P3):** builds the classifier prompt from `classifierDescription` +
  `positiveExamples`/`negativeExamples`; iterates registered `match()` fast-paths.
- **Doc generation (P5/E5):** `sync-agent-capabilities` renders the Flow
  Ownership Matrix rows from `matrixRow`/`flow`, mirroring the existing
  `sync-agent-mcp-docs.ts` / `sync-agent-mcp-prompt.ts` generators. The
  `agent-capability-matrix.spec.ts` test then asserts against the typed manifest
  and that the rendered doc matches, replacing brittle `toContain` prose checks.
- **Observability (P5/E4):** tags every router decision and outcome by `kind`.
- **Contract tests:** assert every manifest `requiredReadTools`/`planTool` exists
  in `agent-mcp-tool-registry.service.ts`.

---

## P2 — Generalized Workflow Protocol + Dispatcher

### Outcome union

The current ad-hoc statuses (`planned`, `needs_input`, `approval_required`,
`failed`) become a typed discriminated union, plus one new arm for hybrid
hand-back:

```ts
type WorkflowOutcome =
  | { status: 'planned'; text: string; planId: string; successSummary: SuccessSummary }
  | { status: 'needs_input'; text: string; continuation?: ContinuationState }
  | { status: 'approval_required'; toolCallId: string; continuation: ApprovalState }
  | { status: 'failed'; text: string }
  | { status: 'handoff_open'; reason: string }; // hybrid only; fall through to open orchestration
```

`successSummary` is the scrubbed structured payload fed to copy generation
(P5): `{ workflowKind, albumName?, label?, dateRange?, assetCount?, exclusions?, target? }`
(`label` is the human place/source label, e.g. "New York, USA", so templated copy
can reproduce today's "I found a likely {label} trip…" string). Templated copy is
derived from it deterministically by default.

### Workflow interface

```ts
type WorkflowContext = {
  client: McpClient; // strict MCP client (signal-aware)
  slots: Record<string, string>;
  signal?: AbortSignal;
  candidate?: unknown; // present on a continuation-resolved run; run() then skips discovery
  approvedPlanResult?: unknown; // present on approval resume; run()/resumeApproval() reuse it instead of re-planning
  nowMs?: number; // injected clock for building continuation TTLs (dispatcher passes now())
};

type StrictWorkflow = {
  kind: string;
  flow: 'strict' | 'hybrid';

  // P3 fast-path; returns normalized slots or undefined. Reuses today's
  // regex extractors (e.g. normalizePlaceHint) as the slot layer.
  match(prompt: string): { slots: Record<string, string> } | undefined;

  // Validates/normalizes classifier-produced slots. Returns null to reject
  // (router then falls through to open orchestration).
  parseSlots(rawSlots: Record<string, string>, prompt: string): Record<string, string> | null;

  // Deterministic execution. Strict: fixed sequence, no provider tools.
  // Hybrid: may call a bounded whitelist of read/resolve tools, still owns the
  // write-plan procedure; may return handoff_open to defer to open orchestration.
  run(ctx: WorkflowContext): Promise<WorkflowOutcome>;

  // Multi-turn disambiguation continuation (optional).
  buildContinuation?(args: { slots; candidates; nowMs }): ContinuationState;
  resumeContinuation?(args: {
    pending;
    prompt;
    nowMs;
  }):
    | { status: 'matched'; ctx: Partial<WorkflowContext> }
    | { status: 'needs_input' | 'expired' | 'missing'; text: string };

  // Approval resume (optional).
  resumeApproval?(ctx: WorkflowContext & { pending: ApprovalState; approvalDecision }): Promise<WorkflowOutcome>;
};
```

`create_recent_trip_album` maps onto this exactly:
`match` = today's `matchStrictWorkflow` body (minus the dispatch),
`parseSlots` = `normalizePlaceHint`/`extractAlbumName`,
`run` branches on `ctx.candidate`: absent → `runCreateRecentTripAlbumWorkflow`
(full discovery), present → `runCreateRecentTripAlbumCandidateWorkflow` (skip
discovery, plan from the resolved candidate). On an `ask_user` result `run`
attaches the built `continuation` to the `needs_input` outcome,
`buildContinuation`/`resumeContinuation` = the candidate-selection helpers,
`resumeApproval` = `runCreateRecentTripAlbumCandidateWorkflow` with
`approvedPlanResult`. There is no separate `run_continuation_candidate` method —
the continuation-resolved path reuses `run` with `ctx.candidate` set.

### Strict vs hybrid execution

- **Strict**: deterministic tool sequence, no provider tool-calling. Examples:
  trip album, rename/describe album, space member management, metadata batch.
- **Hybrid**: the _write-plan_ procedure is deterministic and Gallery-owned, but
  `run` may call a **bounded, manifest-declared whitelist** of read/resolve MCP
  tools (`resolveAssetSearchFilters`, `searchAssets`, `readAlbum`, …) to resolve
  a source/target before planning. The "openness" is confined to (a) LLM slot
  extraction in P3 and (b) the workflow's own read calls — the provider never
  chooses the write sequence. If resolution is genuinely subjective/visual, `run`
  returns `handoff_open` and the dispatcher defers to open orchestration.

This keeps the strict/hybrid boundary crisp: hybrid is "deterministic plan over a
bounded resolved source," not "let the model improvise."

### Generic dispatcher

A single `dispatchStrictWorkflow(entry, turn)` module replaces the inlined
branches in `sendMessage`/`resumeSession`. Pseudocode:

```text
on user turn:
  if entry.pendingWorkflow:                      # P4 rehydrated, durable
    wf = registry.get(entry.pendingWorkflow.workflowKind)
    if pendingWorkflow.kind endsWith 'approval':  # only via resumeSession path
      ...handled in resume path...
    else:                                          # continuation follow-up
      r = wf.resumeContinuation({ pending, prompt, nowMs })
      if r.status == 'matched': outcome = await wf.run({ ...r.ctx })
      else: emit needs_input/expired/missing; clear or keep pendingWorkflow
  else:
    match = router.classify(prompt)                # P3: regex fast-path → LLM
    if match.kind == 'none': fall through to open orchestration
    wf = registry.get(match.kind)
    slots = wf.parseSlots(match.slots, prompt)
    if slots == null: fall through to open orchestration
    outcome = await wf.run({ client, slots, signal })

  handleOutcome(outcome):
    planned          -> persist plan-review state; copy via P5; clear pendingWorkflow; emit completed
    needs_input      -> set pendingWorkflow=outcome.continuation (P4 persist); emit completed(text)
    approval_required-> set pendingWorkflow=outcome.continuation (P4 persist); emit approval event
    failed           -> clear pendingWorkflow; emit completed(text)
    handoff_open     -> clear pendingWorkflow; fall through to open orchestration

on approval resume (resumeSession):
  wf = registry.get(entry.pendingWorkflow.workflowKind)
  outcome = await wf.resumeApproval({ ..., approvedPlanResult: toolResult })
  handleOutcome(outcome)   # may not call provider
```

`strictCompletedEvent` / `strictApprovalEvent` / `appendStrictWorkflowTranscript`
stay, now driven generically by `handleOutcome` rather than per-workflow code.

---

## P3 — Intent Classification

Two stages, in this order, to maximize recall while bounding cost:

1. **Regex fast-path (free, deterministic).** For each registered workflow, try
   `wf.match(prompt)`. A high-confidence hit short-circuits with zero LLM cost —
   canonical phrasings keep behaving exactly as today, and tests stay fast.
2. **LLM structured classify (recall).** If no fast-path hit and the message
   looks plausibly actionable (cheap imperative-verb heuristic), make one
   non-streaming, tool-free classification call:

```ts
// forced structured output
type ClassifyResult = {
  workflow: string | 'none'; // enum from manifest kinds + 'none'
  slots: Record<string, string>; // free-form; validated by wf.parseSlots
  confidence: 'high' | 'low';
};
```

The classifier prompt is built from the manifest (`classifierDescription`,
`positiveExamples`, `negativeExamples`). It has **no tool access**, low
temperature, and sees only the user message + workflow descriptions. On
`confidence: 'low'` or `workflow: 'none'`, or any classifier error, the router
falls back to the regex result, then to open orchestration. Classification is
therefore strictly **additive to recall** — it can never reduce safety because
execution stays deterministic and unmatched always routes to open.

**Provider integration.** The runtime today exposes only streaming
`session.prompt()`. Add a thin `classifyIntent()` that uses the Pi model handle
(`getModel(provider, model)`) for a one-shot structured generate, separate from
the agent session, reusing the session's credential. Constraints/costs:

- Reuses the user's configured model (no cheap-model tier exists). The regex
  fast-path keeps the _common_ canonical cases off the LLM entirely.
- Optional future: a `routerModel` override in the create-session request for a
  cheaper/faster classifier. Out of scope to implement now; the interface should
  not preclude it.
- A config flag (`STRICT_ROUTER_MODE = regex | llm | hybrid`) lets tests force
  deterministic regex-only routing and lets ops disable the LLM call.

**Composition fix.** This removes the brittle `nonGenericPattern` negative
filter. "Create an album for my recent trip to USA and tag them Travel" no longer
silently falls back; the classifier picks the dominant intent (or asks), and
precedence is decided by the classifier + a manifest-declared tiebreak order
rather than by regex interference.

---

## P4 — Durable Workflow State

### Problem

`pendingStrictWorkflow` lives only in the runtime's in-memory `sessions` Map,
keyed by `runnerSessionId`. It is lost on process restart and invisible to a
second runner instance, contradicting the trip-album spec's requirement that
strict state be "persisted before pausing." The server already persists
sessions, plans, selection handles, and activity events — but not continuation
state.

### Design

Make the **server the durable store** and the runtime stateless-by-default for
continuation:

1. The runtime emits a new stream event `workflow-state-update` carrying the
   scrubbed continuation/approval blob whenever `handleOutcome` sets or clears
   `pendingWorkflow`.
2. The server persists it on `agent_session` as a nullable JSONB column
   `workflow_state` (single active continuation per session, matching today's
   single-`pendingStrictWorkflow` model). The blob is already scrubbed of raw
   asset IDs and `sourceRef` by the existing compaction helpers; it references a
   `selectionHandleId` (itself persisted and session-scoped).
3. On the next turn, the server passes the rehydrated `workflow_state` into
   `sendMessage`/`resumeSession` (it already passes session context), and the
   runtime uses it as `entry.pendingWorkflow`. The in-memory Map becomes a
   write-through cache for the active turn, not the source of truth.

This makes continuation and approval resume survive restarts and work across
runner instances.

### TTL reconciliation

Continuation references a selection handle whose expiry is session-lifetime
(`getSelectionHandleExpiresAt`). The continuation `expiresAt` must be
`min(strictWorkflowPendingTtlMs default, handle expiry)`. Resume re-validates the
handle naturally: `proposeAlbumFromSelection` already validates via
`selectionHandleRepository.getValidForPlanning`, so a stale handle yields a
deterministic failure outcome, not a false success.

### Phasing

- **P4a (required):** generalize the in-memory state shape to `pendingWorkflow`
  (workflowKind + kind + slots + continuation/approval + expiresAt).
- **P4b (required for "solid foundation"):** add the `workflow-state-update`
  event + `agent_session.workflow_state` column + rehydration. This is the
  bigger lift; it can ship as its own slice but should not be deferred
  indefinitely — durability is the difference between dev-box and production.

---

## P5 — Final-Copy Delegation + Observability

### Copy delegation

A `CopyMode` setting:

- `template` (default): deterministic copy from `successSummary`, identical in
  spirit to today's strings. No LLM, no hallucination risk.
- `llm-polish`: after a `planned` outcome with a persisted `planId`, a tool-free
  LLM call rephrases **only** the scrubbed `successSummary` into friendlier /
  localized copy. Hard guardrails:
  - The success/failure decision and the "a plan exists" claim are chosen by
    deterministic code from `status === 'planned' && planId`; the LLM only
    rewords a pre-approved summary and never sees raw IDs or tools.
  - On LLM error/timeout, fall back to `template`.
  - `needs_input` / `failed` / `approval_required` copy stays templated (these
    are control-flow states, not narration).

This fixes rigid copy (L4) without touching the success gate.

### Observability

Emit structured logs (the fork ships structured JSON logging) and
`agent_session_activity_event` rows for:

- `strict_router_decision`: `{ matched, workflowKind|null, via: 'regex'|'llm'|'none', confidence?, latencyMs }` — measures router recall and LLM cost in the wild.
- `strict_workflow_outcome`: `{ kind, status, planId?, toolCalls, fellBackToOpen }`.
- `strict_success_gate_block`: fired whenever code wanted success copy but
  `planId` was missing. Expected count ≈ 0; any nonzero is a regression signal
  for the original-bug class.
- `strict_continuation`: `{ resumed, expired, missing }`.

These ride the existing activity-event table; no new infra.

---

## Capability Matrix from the Registry (E5 detail)

- Add `server/src/bin/sync-agent-capabilities.ts` (mirrors `sync-agent-mcp-docs.ts`)
  that renders the Flow Ownership Matrix and the strict-workflow list in
  `2026-05-19-pi-agent-capability-matrix.md` from the manifest.
- Rewrite `agent-capability-matrix.spec.ts` to assert against the typed manifest
  (kinds, flows, required tools) and that the rendered doc is in sync
  (generate-and-diff), replacing `expect(markdown).toContain(...)`.
- `make` target / CI check so the doc cannot drift from the registry.

---

## Worked Examples (validate the abstraction)

### 1. `create_recent_trip_album` (strict) — migration / regression anchor

Re-expressed against the protocol with no behavior change. All existing
`strict-workflows.test.mjs` and `pi-runtime.test.mjs` cases must pass unchanged.
This is the proof that the generalization is behavior-preserving.

### 2. `rename_or_describe_album` (strict, simplest) — proves no-detection path

- `match`/`parseSlots`: extract `{ albumName?, newName?, description? }` and an
  album reference.
- `run`: resolve album via `listAlbums`/`resolveAssetSearchFilters`; propose
  `album.updateDetails` preserving unspecified fields. No detection service, no
  continuation, no selection handle.
- Exercises the protocol with the minimal surface — the cheapest way to confirm
  the abstraction generalizes beyond trip detection.

### 3. `add_photos_to_album` (hybrid) — proves bounded read resolution + handoff

- `parseSlots`: `{ albumRef, sourceDescription }` (e.g. "my newest 20 photos").
- `run`: resolve album; resolve source via the bounded read whitelist
  (`resolveAssetSearchFilters` + `searchAssets`) into a selection handle;
  duplicate-safe `album.addAssets`. If the source is subjective ("the good
  ones"), return `handoff_open`.
- Validates hybrid mode, the read-tool whitelist, and `handoff_open`.

### 4. `manage_space_members` (strict, high-risk) — proves continuation + guards

- `parseSlots`: `{ spaceRef, userQuery, role?, action: add|remove|setRole }`.
- `run`: resolve space + user (`listSpaces`, `searchUsers`, `readSpace`); apply
  deterministic guards (last-owner protection, self-removal/demotion rejection,
  role defaults); propose `space.addMembers` / `space.removeMembers` /
  `space.updateMemberRole`. Ambiguous `userQuery` uses
  `buildContinuation`/`resumeContinuation` (the generalized disambiguation).
- Highest risk-weighted value; lands after the protocol + continuation are
  proven on #2/#3.

---

## Hard Invariants (carried forward + new)

Existing, unchanged:

- No claimed plan unless a persisted plan id exists.
- No direct write/apply MCP tools; writes go through reviewable plans.
- No large raw asset ID lists in model-facing data; selection handles for asset
  sets.
- Tool errors redact gateway tokens and secrets before persist/stream.

New for the foundation:

- Classification is advisory only: it selects a workflow but never executes
  tools; deterministic `run` owns the sequence. Unmatched/low-confidence → open
  orchestration.
- `handoff_open` is the only way a workflow returns control to the provider, and
  only before any write plan exists.
- Continuation/approval state is scrubbed (no raw IDs/`sourceRef`) before it
  leaves the runtime, and expires no later than its referenced selection handle.
- LLM copy generation is tool-free, fed only a scrubbed `successSummary`, and
  cannot alter the success/failure decision or the plan-exists claim.

---

## Test-Driven Development

Red tests precede production code per slice, matching the trip-album spec
discipline.

### Slice 1: Manifest + registry

- Manifest entry exists for `create_recent_trip_album` with correct flow/tools.
- Registry lookup by kind; every `requiredReadTools`/`planTool` exists in the MCP
  tool registry.
- `agent-capability-matrix.spec.ts` asserts against the manifest; rendered doc
  matches (generate-and-diff).

### Slice 2: Protocol + outcome union (pure)

- `WorkflowOutcome` arms construct and discriminate.
- `create_recent_trip_album` re-expressed as a `StrictWorkflow`; unit behavior
  identical to current `runCreateRecentTripAlbumWorkflow` (port existing tests).

### Slice 3: Generic dispatcher

- New-turn, continuation-turn, and approval-resume routing all flow through one
  dispatcher.
- `handleOutcome` maps each arm to the right events/state transitions.
- `handoff_open` falls through to open orchestration with no plan created.
- All current `pi-runtime.test.mjs` strict cases pass against the dispatcher.

### Slice 4: Classification

- Regex fast-path short-circuits canonical prompts with no LLM call.
- LLM classify returns structured `{workflow, slots, confidence}`; `parseSlots`
  validates/rejects.
- Paraphrases that today fall back now match (recall cases): e.g. "put my Japan
  trip from last week into an album."
- `confidence: low`, `workflow: none`, and classifier errors fall back to
  open orchestration.
- `STRICT_ROUTER_MODE=regex` disables the LLM path deterministically.

### Slice 5: Durable state

- `workflow-state-update` event persists/clears `agent_session.workflow_state`.
- Rehydration on the next turn reconstructs `pendingWorkflow`.
- Continuation survives a simulated runtime restart (new in-memory Map, state
  from DB).
- Continuation `expiresAt` ≤ selection-handle expiry; stale handle → deterministic
  failure, not false success.

### Slice 6: Copy + observability

- `CopyMode=template` reproduces current strings.
- `CopyMode=llm-polish` rephrases only the success summary; success language
  still gated on `planId`; LLM failure falls back to template.
- Router/outcome/gate/continuation activity events emitted with correct fields.

### Slice 7: Second + third workflow (abstraction proof)

- `rename_or_describe_album` strict workflow end-to-end with only a manifest entry
  - `StrictWorkflow` impl (no runtime edits).
- `add_photos_to_album` hybrid workflow: bounded read resolution, duplicate-safe
  add, `handoff_open` on subjective source.

## Edge Cases

| Case                                     | Expected behavior                                                                             |
| ---------------------------------------- | --------------------------------------------------------------------------------------------- |
| Two workflows plausibly match            | Classifier picks dominant intent or asks; manifest tiebreak order decides ties; never silent. |
| Classifier returns unknown kind          | Treated as `none`; open orchestration.                                                        |
| Classifier slots fail `parseSlots`       | Open orchestration; no plan.                                                                  |
| LLM classify timeout/error               | Fall back to regex, then open; no user-visible failure.                                       |
| Runtime restart mid-continuation         | Rehydrate from `agent_session.workflow_state`; resume deterministically.                      |
| Second runner instance                   | Reads continuation from DB; no in-memory dependency.                                          |
| Continuation past handle expiry          | Re-validation fails at plan tool → deterministic failure copy.                                |
| Hybrid subjective source                 | `handoff_open`; no plan; open orchestration.                                                  |
| `llm-polish` copy hallucinates success   | Impossible: success decided by deterministic gate; LLM only rewords approved summary.         |
| Doc/manifest drift                       | CI generate-and-diff fails.                                                                   |
| Same-name user in `manage_space_members` | Continuation disambiguation by label, never raw id.                                           |
| Last-owner removal / self-demotion       | Deterministic guard rejects before planning.                                                  |

## Confirmed Decisions

These are locked for implementation (confirmed 2026-05-29):

1. **Durable state: now, phased within the foundation.** P4a (generalized
   in-memory state shape) ships with the protocol in Slice 3; P4b (server
   persistence + rehydration) is its own Slice 5 and is in scope for this
   foundation, not deferred.
2. **Classifier model: reuse the session model behind the regex fast-path
   (`STRICT_ROUTER_MODE=hybrid`).** No separate cheap-model tier in v1. The
   interface reserves an optional `routerModel` create-session override for
   later without committing to it now.
3. **Copy default: `template`.** `llm-polish` ships behind an opt-in setting
   (default off) until copy quality is validated. Success language stays gated
   on `planId` in both modes.
4. **Registry: `.mjs` plain-data manifest in `agent-runner`**, mirrored to a
   generated `.json` consumed by server/doc tooling. No functions in the
   manifest.
5. **Workflow order after the foundation:** `rename_or_describe_album` (strict)
   first, `add_photos_to_album` (hybrid) second — both land in Slice 7 as
   abstraction proofs. `manage_space_members` (strict, high-risk) follows as its
   own spec once continuation + guards are proven here.

## Acceptance Criteria

- A new strict or hybrid workflow is added by implementing the `StrictWorkflow`
  interface + one manifest entry, with **no edits** to the runtime dispatcher.
- All existing `create_recent_trip_album` tests pass against the migrated,
  protocol-based implementation.
- Paraphrased recent-trip prompts that previously fell back to open orchestration
  now route to the strict workflow via LLM classification, while execution stays
  deterministic.
- Continuation and approval state survive a runtime restart.
- The capability matrix doc is generated from the manifest and cannot drift in
  CI.
- Router decisions, workflow outcomes, and success-gate blocks are observable per
  session.
- `rename_or_describe_album` and `add_photos_to_album` ship as proofs that the
  foundation generalizes to a second strict workflow and a first hybrid workflow.
