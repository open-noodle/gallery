# Pi agent eval harness (L1)

A live, scorecard-producing eval for the Pi agent's **classification + copy**
layer. It builds the real `createIntentClassifier` and `llm-polish` adapters
against a local OpenAI-compatible model (no Gallery server, no DB) and scores a
battery of real prompts so we can tell whether a change improved or regressed
agent behavior.

See the design: `docs/superpowers/specs/2026-05-29-pi-agent-smoke-eval-harness-design.md`.

### Layers (the `L1`/`L2`/`L3` legend)

The numbers are **stack depth** — how much of the real system each layer drives:

| Layer | aka | drives | needs |
| --- | --- | --- | --- |
| **L1** | component | the classifier + copy adapters | a local model only — no Gallery, no DB |
| **L2** | workflow | the dispatcher + workflow `run()` with a *fake* MCP client | agent-runner code + model (no DB) — _not built yet_ |
| **L3** | live | the real Gallery `/agent/*` API end-to-end, read-only | Gallery server + DB + runner + model |

L1 is the daily driver (fast, runs anywhere). L3 (`--layer L3`) is the periodic
"does it actually work against the running service" check.

## Run

Point it at any running OpenAI-compatible server (defaults to local llama.cpp on
`127.0.0.1:8080`):

```bash
# from the agent-runner package
pnpm eval                      # all scenarios, prints a scorecard
pnpm eval -- --filter recall   # only the "recall" category (or an id substring)
pnpm eval -- --runs 1          # one run per scenario (fast, noisier)
pnpm eval -- --mode regex      # force regex-only routing (no model calls)
pnpm eval -- --diff            # compare to eval/baseline.json
pnpm eval -- --accept          # write the current scorecard as the new baseline
pnpm eval -- --json            # also dump full results to eval/results/<iso>.json
```

Env overrides: `EVAL_LLAMA_URL`, `EVAL_LLAMA_MODEL`, `EVAL_LLAMA_KEY`,
`EVAL_ROUTER_MODE`, `EVAL_RUNS`.

Exit code is non-zero if any scenario fails its threshold, so it's script/CI
friendly. (Not in CI yet — it needs a local model.)

## How scoring works

- **Deterministic** decisions (regex fast-path / actionable heuristic) are scored
  once.
- **Model-dependent** decisions (LLM classify, polish) are repeated `--runs`
  times; a scenario passes if its success rate ≥ its `threshold` (default 0.67),
  which absorbs model variance.
- Categories: `recall` (right workflow + slots survive `parseSlots`),
  `negatives` (questions/chatter/unsupported → `none`), `slots` (exact normalized
  slot values), `copy` (polish preserves facts + review framing).

## Adding scenarios

Add an object to a file under `scenarios/` (or a new file wired into
`scenarios/index.mjs`):

```js
{
  id: 'recall.trip.greece',
  category: 'recall',
  prompt: 'make an album from my Greece trip',
  expect: { kind: 'create_recent_trip_album', slotsSurvive: true, slots: { placeHint: /greece/i } },
}
```

`expect` keys: `kind` (or `anyKind: [...]`), `slotsSurvive`, `slots` (subset;
string = case-insensitive equality, or a RegExp). Copy scenarios use
`{ summary, expect: { contains, notContains } }`.

## L3 — live read-only (against a running Gallery)

`--layer L3` drives the real Gallery server `/api/agent/*` API end-to-end:
creates a disposable agent session, sends each scenario prompt, then reads the
router decision and plan straight from the read-only endpoints (Slice 6's
`strict_router_decision` / `strict_workflow_outcome` activity events +
`GET .../operation-plan`). It asserts **routing** (right workflow `kind`, or
`none` for questions/chatter/unsupported) and **plan-proposed** — and it never
applies anything (`approvalMode: plan-only`, no `/apply` call, plus a post-run
audit that no plan reached `applied`). The only thing it writes is its own
disposable sessions, which it deletes on cleanup (`--keep-sessions` to keep).

```bash
# point at a stack + authenticate, then:
pnpm eval:l3                       # all L3 scenarios (or: pnpm eval -- --layer L3)
pnpm eval -- --layer L3 --filter l3.recall
pnpm eval -- --layer L3 --diff     # vs eval/baseline.l3.json (instance-specific)
```

Auth/config can live in a gitignored `agent-runner/.env` (copy `.env.example`);
`pnpm eval` / `pnpm eval:l3` auto-load it (`--env-file-if-exists=.env`), so no
shell exports are needed. Every run also prints two read-only safety audits — no
plan was applied, and no `strict_success_gate_block` fired — across all sessions.

Scenario shapes (beyond the L1 keys): `expect.planProposed` asserts a reviewable
plan was proposed (never applied); a `turns: ['…','…']` scenario drives one
session across multiple user messages (e.g. needs_input → follow-up → plan); and
a `{album}` token in a prompt is substituted read-only with the user's
most-populated album so plan scenarios resolve a real target.

Config (all env-overridable, see `config.mjs`):

| var | meaning |
| --- | --- |
| `GALLERY_URL` | API base (default `http://localhost:2283/api`) |
| `GALLERY_API_KEY` \| `GALLERY_TOKEN` \| `GALLERY_EMAIL`+`GALLERY_PASSWORD` | auth (pick one) |
| `GALLERY_CREDENTIAL_ID` | reuse an existing agent provider credential |
| `GALLERY_MODEL_URL` | else: a **server-reachable** model URL to create a credential for |
| `GALLERY_MODEL` | override the session model id |

Requirements: the target instance must have the agent feature, an agent **runner
built from this branch** (so the strict router emits the observability events),
and a model reachable **from the server** (not from this harness — L3 never talks
to the model directly). Routing scenarios (`l3.recall`, `l3.negatives`) are
data-independent; the `l3.plan` scenario needs a real library with a detectable
trip, so it's meant for an instance with data and may not propose on an empty
stack. `baseline.l3.json` is committed as a reference snapshot from the personal
instance — it's instance-specific, so re-`--accept` it when you run against a
different library rather than treating a diff as a regression.

## Baseline workflow

`pnpm eval -- --accept` once to snapshot, then after any change
`pnpm eval -- --diff` shows per-scenario and overall deltas
(`recall.trip.japan 33% -> 100%`). Treat a baseline update like a reviewed
snapshot change.
