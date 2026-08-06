# Pi Agent Smoke / Eval Harness Design

Status: brainstorm / planning artifact
Date: 2026-05-29
Branch: `explore/pi-agent-brainstorm`

## Purpose

We need a repeatable, on-demand way to run a large battery of real prompts
through the Pi agent flow against a **locally running** stack (Gallery server +
agent-runner + local llama-server) and get a **scorecard** that tells us whether
a change improved or regressed agent behavior.

This is motivated directly by the slice-4/6 live smoke test: a 30-line harness
against the local llama-server found two recall bugs (invented slot keys; an
over-narrow actionable heuristic) that every fake-based unit test missed. Unit
tests prove the deterministic plumbing; they cannot tell us whether a real model
actually routes "stick my newest 20 photos into the Family album" to
`add_photos_to_album`. Only a live eval can, and only a scorecard-over-time can
tell us if our prompt/heuristic/model changes are net positive.

The headline deliverable is not "tests that pass/fail" but a **comparable
quality score** we can diff across runs.

## What we are testing (the flow)

Per turn, the agent flow is:

```
user message
  -> intent classification (regex fast-path -> LLM structured classify -> parseSlots)
  -> strict/hybrid workflow run() (deterministic tool sequence; MCP read + plan tools)
       OR open orchestration (LLM chooses MCP tools) for unsupported intents
  -> reviewable operation plan (persisted; gated on plan id)
  -> copy (template or llm-polish)  [+ approval / continuation across turns]
```

Every stage has both a **deterministic contract** (routed to the right workflow?
plan persisted with the right ops? safety invariants held?) and a **fuzzy,
model-dependent quality** (did the LLM classify the paraphrase? are the slots
usable? is the copy faithful?). The harness must measure both, differently.

## Core principles

1. **Separate deterministic asserts from fuzzy scores.** Routing decisions, plan
   shape, and safety invariants are asserted hard (must pass). Recall/quality of
   model-dependent steps is _scored_ as a pass-rate over repeated runs, never a
   single brittle assert.
2. **Score, then diff against a baseline.** Each run emits a JSON + markdown
   scorecard. A committed baseline lets any change report `+/-` deltas per
   category. "Did this help?" becomes a number.
3. **Layered by stack depth.** Most signal comes from the cheapest layer
   (classifier/copy, no Gallery). Deeper layers cost more setup and run less
   often. Don't gate fast iteration on the full stack.
4. **Config-driven endpoints, non-destructive by default.** All endpoints
   (llama baseUrl/model, Gallery URL+token, agent-runner URL) come from config.
   The harness never applies a plan against real data unless explicitly pointed
   at a disposable seeded namespace.
5. **Reproducible scenarios over a live library.** Deterministic scenarios need
   known data. We seed a small dedicated dataset rather than asserting against
   the user's real, changing library.

## Layered architecture

| Layer                     | Drives                                                                                    | Stack needed                                             | Speed                     | What it catches                                                                                                                               |
| ------------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| **L1 — Component**        | `createIntentClassifier` + `parseSlots`; `renderCopy`/polish                              | llama-server only                                        | ~1s/LLM prompt, 0ms regex | classification precision/recall, slot survival, copy fidelity, heuristic gates. This is the productized version of the slice-4 smoke harness. |
| **L2 — Workflow**         | `dispatcher.routeTurn` / workflow `run()` with a seeded **fake MCP client**               | agent-runner code + llama-server                         | seconds                   | classifier→workflow integration, tool-call sequences, plan-gate, handoff, redaction, copy — without a DB                                      |
| **L3 — Full session e2e** | Gallery server `/agent/*` HTTP API → websocket/activity events → persisted operation plan | Gallery server + DB + agent-runner + llama + seeded data | tens of seconds           | the real thing: routing, MCP tools, plan persistence, approval, apply, end-to-end safety                                                      |

L1 is the daily driver. L2 is the pre-merge gate for workflow changes. L3 is the
periodic "does it actually work against the running service" confidence check.

### L1 — Component evals (no Gallery)

Builds the real `createIntentClassifier({ getModel, classifyIntent, manifest,
workflows, mode })` against the llama-server (replicating `pi-runtime`'s provider
registration via `ModelRegistry` + the real `createPiClassifyIntent`/
`createPiPolishCopy` adapters), then for each scenario:

- runs `registry.classify(prompt)` and the workflow's `parseSlots` on the result;
- asserts the routing decision and slot survival;
- for copy scenarios, runs `renderCopy`/`polish` and scores fidelity.

To make the real adapters importable, export `createPiClassifyIntent` /
`createPiPolishCopy` from `pi-runtime.mjs` (currently internal). This is a
keepable testability improvement, not throwaway scaffolding.

### L2 — Workflow evals (fake MCP, no DB)

Constructs the dispatcher with the real classifier + a **fixture MCP client**
that answers `findTripCandidates`/`searchAssets`/`resolveAssetSearchFilters`/
`listAlbums`/`proposeAlbumOperations`/`proposeAlbumFromSelection` from a seeded
in-memory dataset. Drives `routeTurn`/`routeApproval` and asserts:

- exact tool-call sequence (e.g. `findTripCandidates,proposeAlbumFromSelection`,
  never a redundant `searchAssets`);
- plan ops shape (album.create + album.addAssets from a selection handle; no raw
  asset ids in model-facing args);
- gate (`planned` only with a plan id), `handoff_open`, `needs_input`,
  approval/continuation across turns;
- copy contents (date range, count, exclusions).

This reuses Slice 2's `test-helpers.mjs` fixtures and is the bridge between L1
(model only) and L3 (full stack).

### L3 — Full-session e2e (real Gallery)

Drives the **Gallery server** (not the agent-runner directly — the server mints
the MCP gateway token and owns plan persistence):

1. `POST /api/agent/provider-credentials` once → an `openai-compatible`
   credential pointing at the llama-server (`baseUrl`, `defaultModel`, dummy
   `secret`).
2. `POST /api/agent/sessions` `{ providerCredentialId, model, permissionPreset,
approvalMode }` → `runnerSessionId`.
3. Connect the Socket.IO `on_agent_session_event` channel (or poll
   `GET /agent/sessions/:id/activity-events` + `GET /agent/sessions/:id/operation-plan`).
4. `POST /api/agent/sessions/:id/messages` `{ content: { blocks:[{type:'text',
text}] } }`.
5. Collect streamed events (`assistant-message-delta/created`, `activity`
   including the `strict_router_decision`/`strict_workflow_outcome` kinds,
   `tool-approval-needed`, `operation-plan-ready`), then fetch the persisted
   `operation-plan` and assert ops + invariants.
6. Optionally approve (`/operation-plan/:planId/apply`) **only** in a seeded,
   disposable namespace; otherwise read-only.

Auth: a bearer token from `/api/auth/login` or an API key. The `activity` event
stream already carries our observability kinds (Slice 6), so L3 gets the router
decision and outcome for free — no log scraping.

## Scenario taxonomy ("a ton")

Scenarios are grouped by category; each category targets a specific failure mode.
Counts are starting targets, not caps.

**A. Classification — recall (per workflow, ~20-30 paraphrases each)**
Canonical + heavy paraphrase + uncommon verbs (the "throw/stick" class) + place
and album-name variants + multilingual-ish phrasings. Each asserts
`kind == expected` AND `parseSlots(slots) != null` (slot survival — the bug L1
exists to catch).

**B. Classification — precision / negatives**
Competing intents ("...and tag them Travel"), questions ("how many photos..."),
pure chatter ("thanks"), subjective ("the good ones"), unsupported-but-actionable
("find my Sony photos from May"). Assert `none`/`handoff` — must NOT fabricate a
workflow.

**C. Slot-extraction fidelity**
USA/US/United States aliasing; quoted album names ("called \"Spring Break!\"");
counts ("newest 20"); relative dates ("last week"); place-vs-name splitting
("recent trip to USA called Spring Break"). Assert normalized slot values.

**D. Trip workflow (`create_recent_trip_album`)**
place-given; no-place (`Recent Trip` default); `ask_user` (multiple candidates →
one question with labels); `none` (no detectable trip → ask for source);
explicit album name preserved; duplicate/stack exclusion copy; recommendation
key-mismatch → no fabricated plan.

**E. Rename/describe (`rename_or_describe_album`)**
rename-only (description preserved); describe-only (name preserved); both;
ambiguous album → `needs_input`; no-plan-id → `failed` without success copy.

**F. Add-photos hybrid (`add_photos_to_album`)**
metadata source → selectionHandle add; subjective source → `handoff_open` with
no plan; zero-asset source → `needs_input`; unresolved album → `needs_input`; no
raw ids in model-facing args.

**G. Open-orchestration fallback**
unsupported requests reach the provider and produce sensible tool use / answers
(favorites, search-only, metadata edits) — assert a plan or a direct answer, and
no crash / no false strict claim.

**H. Safety invariants (cross-cutting, asserted on every plan-producing run)**
no `planned`/"I created" without a persisted plan id; no raw asset id lists in
assistant text; secret/token redaction in errors; `strict_success_gate_block`
count == 0; approval pauses without leaking copy.

**I. Copy quality (fuzzy, judged)**
template success copy contains date range + count + exclusions; `llm-polish`
preserves all facts, invents nothing, and keeps "review before applying"
language; failure/needs_input copy never claims success.

**J. Multi-turn**
`ask_user` → follow-up selection resumes plan creation; approval → resume
continues deterministically; rename pending plan via follow-up; expired
continuation asks to rerun.

**K. Latency / cost budget (observational)**
per-category mean LLM latency and LLM-call count; regex fast-path stays 0-call;
chatter stays off the LLM. Not pass/fail, but tracked for regressions.

## Scenario format

Declarative, one file per category, plain data so non-engineers can add cases:

```js
// eval/scenarios/trip.mjs
export default [
  {
    id: 'trip.paraphrase.japan',
    layer: ['L1', 'L2', 'L3'], // which layers this runs in
    prompt: 'put my Japan trip from last week into an album',
    expect: {
      kind: 'create_recent_trip_album',
      slotsSurvive: true, // parseSlots(slots) != null
      slots: { placeHint: 'Japan' }, // subset match on normalized slots
    },
    runs: 3, // repeat for pass-rate (LLM scenarios)
    threshold: 0.67, // passes if >= 2/3 route correctly
  },
  {
    id: 'trip.subjective.handoff',
    layer: ['L1', 'L2'],
    prompt: 'make an album of the best shots from my recent trip',
    expect: { kind: 'none_or_handoff' }, // must NOT fabricate the strict trip plan
  },
];
```

For L2/L3, `expect` extends with `toolSequence`, `planOps`, `noPlan`,
`approval`, `judge` (a rubric string for the copy judge).

## Scoring & non-determinism

- **Repeat LLM scenarios `runs` times** (default 3); a scenario passes if its
  success rate ≥ `threshold`. Regex/deterministic scenarios run once.
- **Per-category metrics:** pass-rate, slot-survival rate, mean latency, LLM-call
  count, gate-block count (must be 0), handoff rate, judge score.
- **Top-line score:** a weighted aggregate (e.g. recall-weighted) plus the raw
  category table — one number to watch, with the table to explain it.
- **Fuzzy judge:** an LLM judge (same llama-server, or a stronger model if
  configured) scores copy fidelity against a rubric, returning
  `{ pass, reason }`. Judge prompts are temp-0 and few; the judge is itself
  spot-checked so we don't trust it blindly.
- **Flake handling:** report variance; a scenario whose success-rate sits near
  its threshold is flagged "unstable" rather than silently flipping.

## Baseline & reporting

- Each run writes `eval/results/<timestamp>.json` (full per-scenario detail) and
  prints a markdown scorecard.
- A committed `eval/baseline.json` holds the reference scorecard. `--diff`
  compares the current run to the baseline and prints per-category deltas:
  `recall.trip 0.81 -> 0.94 (+0.13)`, flagging regressions in red.
- Workflow: run before a change → snapshot; make the change; run with `--diff` →
  see if it helped. Promote a new baseline with `--accept` when satisfied.
- Because the model is local and fixed, run-to-run variance is the only noise;
  `runs`/`threshold` absorb it.

## Data & seeding strategy (the hard part)

Deterministic D/E/F/J and all of L3 need known assets/albums.

- **L1/L2 need no real data** — L1 only classifies; L2 uses fixture MCP responses
  (seeded trip candidates, albums) from in-memory data. Start here; they cover
  most of the taxonomy and run anywhere.
- **L3 seeding:** a `eval/seed.mjs` that, against the local Gallery API, creates a
  dedicated test user (or a `eval-*` album/space namespace) and uploads a small
  fixture asset set with controlled GPS + timestamps (so `findTripCandidates`
  yields a known USA trip), plus known albums/spaces. Everything is tagged/named
  with an `eval-` prefix and is idempotent + tear-down-able, so the harness never
  touches the user's real library. Reuse `e2e/test-assets` images where possible.
- **Read-only fallback:** an L3 mode that runs only non-mutating scenarios
  (classification + read + plan-proposed-but-not-applied) against the real
  library with tolerant asserts (kind + plan-exists, not exact counts), for a
  quick "is the live wiring healthy" check without seeding.

## Config & endpoints

A single `eval/config.mjs` (env-overridable), grounded in the local topology:

```js
export default {
  llama: { baseUrl: 'http://127.0.0.1:8080/v1', model: 'Qwen3-Coder-Next-Q8_0-...', secret: 'local' },
  gallery: { baseUrl: 'http://localhost:2283/api', token: process.env.GALLERY_TOKEN }, // bearer or x-api-key
  agentRunner: { baseUrl: 'http://localhost:4477' }, // L2 direct-runner option
  routerMode: 'hybrid',
  judgeModel: undefined, // defaults to llama; set to a stronger endpoint if available
};
```

L3 obtains/creates the provider credential via `/api/agent/provider-credentials`
and a session via `/api/agent/sessions`; auth via `/api/auth/login` or an API key.

## Harness layout

```
eval/
  config.mjs            # endpoints, model, thresholds
  run.mjs              # CLI: --layer L1|L2|L3 --diff --accept --filter <cat>
  drivers/
    l1-component.mjs   # classifier + copy against llama
    l2-workflow.mjs    # dispatcher + fixture MCP
    l3-session.mjs     # Gallery /agent/* + events + plan
  scenarios/*.mjs      # A..K, declarative
  judge.mjs            # LLM judge for fuzzy copy
  score.mjs            # aggregation + baseline diff
  seed.mjs             # L3 data seeding (idempotent, eval- namespace)
  baseline.json        # committed reference scorecard
  results/             # gitignored run outputs
```

pnpm scripts: `eval` (L1+L2 default), `eval:l1`, `eval:l3`, `eval:diff`,
`eval:seed`. Not wired into CI initially (needs a local model); designed so a
future mock-provider mode could run a deterministic subset in CI.

## Phased rollout

1. **P1 — L1 classifier + copy scorecard.** Productize the slice-4 smoke harness:
   export the real adapters, build categories A/B/C/I, scoring + baseline diff.
   Immediate value for prompt/heuristic/model iteration. (Smallest, highest ROI.)
2. **P2 — L2 workflow evals.** Fixture MCP client; categories D/E/F/G/H/J at the
   dispatcher level; tool-sequence + plan-op + gate asserts.
3. **P3 — L3 full session + seeding.** Gallery `/agent/*` driver, event collection,
   `seed.mjs`, read-only fallback mode.
4. **P4 — Judge + baseline workflow polish.** LLM judge for copy, unstable-scenario
   flagging, `--accept` baseline promotion, optional mock-provider CI subset.

## Safety / non-destructive guarantees

- Default mode is read-only: classify, propose plans, never apply.
- L3 mutation (apply) is gated behind an explicit `--allow-apply` + a seeded
  `eval-` namespace; never against the real library.
- The harness asserts the same safety invariants it tests (no raw ids in its own
  logs, redaction) so eval output is shareable.

## Open decisions

1. **L3 data: seed a dedicated dataset, or read-only against the real library
   first?** Recommendation: ship P1/P2 (no data) immediately; build `seed.mjs`
   for P3; offer read-only L3 as the interim live check.
2. **CI: local-only forever, or a mock-provider deterministic subset later?**
   Recommendation: local-only to start; design scenario/scoring so a mock
   provider could replay canned classifications for a CI smoke subset.
3. **Judge model.** Recommendation: default to the local llama for copy judging;
   allow pointing at a stronger endpoint when one is configured, since the judge
   gates fuzzy quality.
4. **Where the harness lives.** Recommendation: a top-level `eval/` package (or
   `agent-runner/eval/`) so it can import agent-runner modules directly and stay
   out of the unit-test glob.
5. **Baseline ownership.** Recommendation: commit `baseline.json`; treat a
   baseline change like a snapshot update (reviewed, intentional).

## Acceptance criteria (for the harness itself)

- One command runs a category battery against the local stack and prints a
  per-category scorecard + top-line score.
- `--diff` reports per-category deltas vs. a committed baseline.
- L1 reproduces the slice-4 findings: the pre-fix classifier scores low recall on
  paraphrases / slot-survival, the post-fix scores high — i.e. the harness would
  have caught the bug.
- Adding a scenario is a one-object edit to a category file.
- No scenario mutates the real library unless explicitly opted in against a
  seeded namespace.
