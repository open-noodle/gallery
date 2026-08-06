# Phase D — Durable space/user disambiguation — impl-loop plan

Spec: `docs/superpowers/specs/2026-05-31-pi-agent-capability-roadmap.md` (Phase D). agent-runner ONLY (no server,
no SDK regen). Reuses the trip workflow's continuation protocol.

## Autonomous decision (OQ-D1)

Shared helper (DRY) reused by all four workflows — `candidate-disambiguation.mjs` with
`buildCandidateContinuation` + `resumeFromCandidates`. Generalizes the trip model for `{index,id,name}` candidates.

## How the trip continuation model works (verified — mirror it)

- `protocol.mjs`: `needsInput({text, continuation})` (:58-62) carries an optional `continuation`.
- Dispatcher (`dispatcher.mjs`): when an outcome has `continuation`, persists
  `{workflowKind, kind:'selection', continuation}` (:111-115). Next turn, if `pending.kind !== 'approval'`,
  calls `wf.resumeContinuation({pending: pending.continuation, prompt, nowMs})`; on `{status:'matched', ctx}`
  re-calls `wf.run({client, ...ctx, signal, nowMs})`; on `needs_input` keeps pending; else clears (:160-182).
- Trip workflow (`create-recent-trip-album.mjs`): `normalizeOutcome` attaches `continuation` to needs_input
  outcomes that have candidates; `buildContinuation` → `createRecentTripCandidateSelectionState`;
  `resumeContinuation` → `resolveRecentTripCandidateSelection` then returns `{status:'matched', ctx}`.
- `strict-workflows.mjs`: `ordinalChoice` (1/first…5/fifth), single-candidate yes-pattern, name substring match,
  TTL (`strictWorkflowPendingTtlMs`), `kind`-guard, `createdAtMs`.

## Target workflows (bare `needsInput` on ambiguity today — add continuation only to the "multiple X" cases)

- `manage-space-members.mjs`: multiple spaces (:184), multiple persons (:214). [two-stage: space then user]
- `change-member-role.mjs`: multiple spaces (:118), multiple persons (:146). [two-stage]
- `rename-or-describe-space.mjs`: multiple spaces (:99/:102). [space only]
- `manage-space-assets.mjs`: multiple spaces (:123/:142). [space only]
  ("not found" cases keep bare needs_input — no candidates to offer.)

## Slice D1 — Shared disambiguation-continuation helper (TDD)

New `agent-runner/src/strict-workflows/candidate-disambiguation.mjs` (single-quote style). Self-contained
(own small ordinal + normalize helpers, OR import `ordinalChoice` from strict-workflows.mjs — prefer self-contained
to avoid coupling). Exports:

- `buildCandidateContinuation({ kind, candidates, nowMs, ...extra })` → `{ kind, createdAtMs: nowMs,
candidates: candidates.map((c,i)=>({index:i+1, id:c.id, name:c.name})).slice(0,5), ...extra }`. `extra` carries
  already-resolved context for multi-stage flows (e.g. `resolvedSpaceId`).
- `resumeFromCandidates({ pending, prompt, nowMs, ttlMs, kind })` → guards `pending.kind===kind`; TTL → `{status:'expired', text}`;
  ordinal pick; single-candidate yes; exact/substring name match → `{status:'matched', choice:{index,id,name}, pending}`
  (returns `pending` so the caller can read `extra`); ambiguous/no-match → `{status:'needs_input', text}`.

Tests (`candidate-disambiguation.test.mjs`): build compacts to {index,id,name}, caps at 5, drops raw extra asset
ids (only id+name+whitelisted extra kept); resume matches "first"/"1"/"2"; single-candidate "yes"; name exact +
substring; ambiguous follow-up ("either") → needs_input; expired (createdAtMs older than ttl) → expired; wrong
`kind` → needs_input/missing; numeric name candidate (e.g. a space literally named "2") — ordinal still wins by
index but document the rule; duplicate names → needs_input asking to use the number.

Gates: `cd agent-runner && node --test src/strict-workflows/candidate-disambiguation.test.mjs` red→green; full
agent-runner suite green. Commit `feat(agent): shared candidate disambiguation continuation helper (D1)`; push.

## Slice D2 — `manage_space_members` adopts continuation (TDD, two-stage)

`run()` accepts optional `resolvedSpaceId`/`resolvedUserId` (skip the matching disambiguation when present). On
"multiple spaces" → `needsInput({text, continuation: buildCandidateContinuation({kind:'manage_space_members_space',
candidates: spaces, slots})})`. On "multiple persons" (space already resolved) →
`buildCandidateContinuation({kind:'manage_space_members_user', candidates: users, slots, resolvedSpaceId})`.
Add `resumeContinuation({pending, prompt, nowMs})`: dispatch by `pending.kind` → `resumeFromCandidates(...)`; on
matched return `{status:'matched', ctx:{slots, resolvedSpaceId|resolvedUserId, ...carry}}`. Set manifest
`supportsContinuation:true`.

Tests (`manage-space-members.test.mjs`): ambiguous space → continuation (candidates, no raw ids); next turn "the
first one" resumes → resolves space → proposes (or asks user if user also ambiguous); ambiguous user (space
resolved) → continuation; "2" picks the 2nd user; non-ambiguous path unchanged (regression); out-of-range ordinal
→ needs_input; name not in list → needs_input; expired → expired message. Full agent-runner suite green.
Commit `feat(agent): durable space/user disambiguation in manage_space_members (D2)`; push.

## Slice D3 — `change_member_role` adopts (same two-stage pattern). TDD + same edge cases. Commit (D3); push.

## Slice D4 — `rename_or_describe_space` + `manage_space_assets` adopt (space-only, one stage each). TDD + edge

cases (out-of-range ordinal, name-not-in-list, expired). Commit (D4); push.

## Slice D5 — Hardening: L1 + L3 + matrix

- L1: routing is unchanged (continuations are run-time, not routing) — run `node eval/run.mjs --runs 5`, confirm
  NO regression (no re-seed expected; if the new code changes any classifier text, re-seed to 100%).
- L3: add `l3.multiturn.spacepick.*` scenarios (single-quote) in `l3-readonly.mjs` for each adopted workflow — a
  two-turn resume (turn 1 routes + asks with candidates; turn 2 "the first one" re-enters the workflow). Use the
  multi-turn assertion fields already in the file (`minTurnsWithOutcome`/`minOutcomeCount` — see file header). Gate
  data-dependent picks on SEEDED; routing + re-entry are data-independent.
- Matrix: note durable disambiguation in the Flow Ownership invariants / the space-capability rows; keep
  `agent-capability-matrix.spec.ts` green (do not run prettier on the .md).
  Commit `test(agent): disambiguation L1/L3 + matrix note (D5)`; push.
