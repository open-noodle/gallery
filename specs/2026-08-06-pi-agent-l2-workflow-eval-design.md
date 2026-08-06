# Pi Agent — L2 Workflow Eval Layer

**Status:** design approved, not yet implemented
**Supersedes nothing.** Implements the `L2 — Workflow evals (fake MCP, no DB)` section of
`docs/superpowers/specs/2026-05-29-pi-agent-smoke-eval-harness-design.md`, which specified L2 but
left it unbuilt.

## Motivation

The eval harness has two of its three layers. L1 (component) scores the classifier and copy
adapters against a live model; L3 (live) drives the real Gallery `/agent/*` API end-to-end. The
middle rung is missing, and `agent-runner/eval/README.md` records it as `_not built yet_`.

That gap matters because L1 is saturated. The committed `eval/baseline.json` reports `overall
0.998` with `recall`, `negatives` and `slots` all at `1.0` — 140 of 141 scenarios perfect, the lone
miss being `copy.trip.italy.no-exclusions` at `0.667`. Routing is measured and solved. What is
**not** measured is whether a workflow, once correctly routed, actually executes correctly: the
tool sequence it issues, the shape of the plan it proposes, and its behaviour across the
approval/continuation arms.

Today a change to a workflow's `run()` is covered only by that workflow's own hand-written unit
test. Nothing scores the layer as a whole, so nothing catches a change that makes one workflow
better and two others worse. L2 is the pre-merge gate for workflow changes.

## Goals

- Score workflow **execution** — tool-call sequence, plan shape, outcome arm, copy — without a
  database, a Gallery server, or seeded photos.
- Run in seconds, against a local model only, reusing the existing scenario/scorecard/baseline
  machinery.
- Put the harness itself under model-free unit tests that run in CI.
- Assert the no-raw-asset-IDs invariant continuously rather than by inspection.

## Non-goals

- **Post-handoff open orchestration.** `handoff_open` is a terminal outcome for L2: the harness
  asserts the strict layer correctly declined and stops. It does not drive the open agent loop and
  does not score what happens afterwards. Measuring that is a separate follow-on that reuses this
  layer's fixtures.
- **All 38 workflows.** This build covers a representative slice of seven (below). The fixture and
  driver are designed to grow workflow-by-workflow.
- **The LLM `judge` rubric.** The 2026-05-29 spec reserves `judge` for fuzzy copy grading. With
  handoff terminal, every L2 assertion is exact, so nothing here needs fuzzy grading yet.
- **Replacing `strict-workflows/test-helpers.mjs`.** That helper is imported by two existing test
  files and stays untouched.

## Where L2 sits

| Layer  | Drives                                               | Needs                               |
| ------ | ---------------------------------------------------- | ----------------------------------- |
| **L1** | classifier + copy adapters                           | a local model only                  |
| **L2** | dispatcher + workflow `run()` with a fake MCP client | agent-runner code + a local model   |
| **L3** | the real Gallery `/agent/*` API, read-only           | Gallery server + DB + runner + data |

## Architecture

`createWorkflowDispatcher` (`agent-runner/src/strict-workflows/dispatcher.mjs:96`) already takes
every dependency L2 needs as an injected parameter. L2 drives production code through those seams
and reimplements nothing:

| Seam                        | L2 supplies                                                                 |
| --------------------------- | --------------------------------------------------------------------------- |
| `buildClient`               | the fake MCP client, seeded from an in-memory dataset                       |
| `observe`                   | a collector for `strict_router_decision` / `strict_workflow_outcome`        |
| `getPending` / `setPending` | a `Map`-backed store, so continuation survives across turns in one scenario |
| `now`                       | a fixed clock, so trip windows and date copy are deterministic              |
| `emit` / `appendTranscript` | collectors for assistant text and approval events                           |

The classifier is likewise injected. Production runs pass the real LLM-backed classifier; the
harness's own unit tests pass a deterministic stub. This is what lets the tests run without a model.

## Components

### New

**`agent-runner/eval/fixtures/dataset.mjs`** — a frozen in-memory library with fixed UUIDs and no
randomness. Contains albums (including two with deliberately similar names so album
disambiguation and the continuation arm can be exercised), assets, people, spaces, users,
duplicate groups, and trip candidates.

**`agent-runner/eval/fixtures/fake-mcp-client.mjs`** — exports
`createFakeMcpClient({ dataset, overrides }) -> { client, calls }`.

- `client.call(name, args, options)` answers the ten tools the slice needs (seven read, three
  plan) from `dataset`, and pushes `{ name, args, options }` onto `calls` in invocation order.
- An unrecognised tool name **throws**. A workflow reaching for something unseeded must fail
  loudly; silently returning `undefined` would let a broken scenario pass.
- `overrides` is a per-tool map letting a scenario inject a thrown error, an
  `{ status: 'approval-required', toolCall: { id } }` response, or an empty result set.

This is a generalisation of `createWorkflowClient` in
`agent-runner/src/strict-workflows/test-helpers.mjs` (65 lines, answers two tools, trip-specific).
It is a **new module** rather than an edit to that one. The existing helper is imported by
`strict-workflows.test.mjs` and `workflows/create-recent-trip-album.test.mjs`; widening its
contract in place would mean changing passing tests as a side effect of building the eval layer.
Once L2 is stable those two files can adopt the eval fixture, which is the right direction of
travel — but not in the same change.

**`agent-runner/eval/drivers/l2-workflow.mjs`** — exports
`createL2Driver({ classifier, dataset, now, copyMode })`.

Builds the real `createWorkflowRegistry({ classifier })` and `createWorkflowDispatcher`, then
exposes the same driver interface `score.mjs` already calls, so `run.mjs` needs no special-casing:

- `classify(prompt)` — one `routeTurn` against a fresh pending store.
- `converse(turns)` — several `routeTurn` calls sharing one pending store and one fake client, so
  `needs_input -> follow-up -> plan` and `approval_required -> approve -> plan` work.
- `polishCopy(summary)` / `templateCopy(summary)` — same behaviour as L1, so `copy` scenarios can
  run at either layer.

**`agent-runner/eval/scenarios/l2-workflow.mjs`** — the scenario list (below).

### Modified

- **`agent-runner/eval/score.mjs`** — `classificationPass` gains three `expect` keys.
- **`agent-runner/eval/run.mjs`** — accepts `--layer L2`, selects the L2 driver, scenarios, and
  `baseline.l2.json`. The existing layer guard (`layer !== 'L1' && layer !== 'L3'`) is widened.
- **`agent-runner/eval/config.mjs`** — an `l2` block (`runs`, defaulting lower than L1 since
  scenarios are slower).
- **`agent-runner/package.json`** — an `eval:l2` script, and the test glob widened (below).
- **`agent-runner/eval/README.md`** — L2 documented and its `_not built yet_` marker removed.

## The decision object

The driver returns a superset of L1's decision shape, so every existing `expect` key keeps working
unchanged:

```js
{
  // unchanged from L1
  kind, via, confidence, slots, parsedSlots,

  // added by L2
  outcomeStatus,   // 'planned' | 'needs_input' | 'approval_required' | 'failed' | 'handoff_open'
  planProposed,    // boolean
  planId,          // string | null
  planOps,         // [{ type: 'album.create', ... }, ...]
  toolSequence,    // ['findTripCandidates', 'proposeAlbumFromSelection']
  text,            // rendered assistant copy
  handled,         // dispatcher's { handled } — false means it fell through to open orchestration
}
```

## New `expect` keys in `score.mjs`

| Key            | Semantics                                                                                                                                                         |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `toolSequence` | **Exact, ordered** array equality against `decision.toolSequence`. Order-sensitive, and a length mismatch fails. This is what catches a redundant `searchAssets`. |
| `planOps`      | **Subset** match: every listed operation `type` must appear in `decision.planOps`, in any order. Extra ops do not fail; a scenario asserts what it cares about.   |
| `noPlan`       | Boolean. `noPlan: true` asserts `planProposed === false` and `planId === null`.                                                                                   |

These follow the existing convention in `classificationPass`: each key is only checked when the
scenario opts in, so L1 and L3 scenarios are unaffected.

## The global invariant

**No raw asset IDs may appear in model-facing tool arguments.** Gallery's tool registry
(`server/src/services/agent-mcp-tool-registry.service.ts`) actively prunes `assetIds` and the
explicit-assets source from provider-facing planning schemas so Gallery materialises IDs
server-side. The agent is supposed to pass `assetSelectionHandleId` or an `assetSource` reference
instead.

The L2 driver asserts this **on every scenario that proposes a plan**, not per-scenario. It
inspects the recorded `calls` for any plan tool and fails the scenario if an argument carries a raw
asset-ID array. A per-scenario opt-in would let someone add a workflow and forget it; as a global
assertion, a regression turns every plan scenario red at once.

## Coverage

Seven workflows, chosen so the fixture stays small while covering both flows, all three plan tools
reachable from that slice, continuation, and every outcome arm.

| Workflow                   | Flow   | Cont. | Read tools                                                | Plan tool                        |
| -------------------------- | ------ | ----- | --------------------------------------------------------- | -------------------------------- |
| `create_recent_trip_album` | strict | yes   | `findTripCandidates`                                      | `proposeAlbumFromSelection`      |
| `rename_or_describe_album` | strict | no    | `listAlbums`                                              | `proposeAlbumOperations`         |
| `delete_album`             | strict | yes   | `listAlbums`                                              | `proposeAlbumOperations`         |
| `manage_album_access`      | strict | yes   | `listAlbums`, `readAlbum`, `searchUsers`                  | `proposeAlbumOperations`         |
| `add_photos_to_album`      | hybrid | no    | `listAlbums`, `resolveAssetSearchFilters`, `searchAssets` | `proposeAlbumOperations`         |
| `archive_assets`           | hybrid | no    | `resolveAssetSearchFilters`, `searchAssets`               | `proposeAssetBatchFromSelection` |
| `cleanup_duplicates`       | hybrid | no    | `listDuplicateGroups`                                     | `proposeAlbumOperations`         |

Union: seven read tools plus three plan tools — the ten the fake client must answer.

### Outcome-arm matrix

Roughly 30 scenarios. Every arm is covered at least once:

| Arm                 | Representative scenario                                                                                                                 |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `planned`           | "create an album from my recent trip to Japan" → `findTripCandidates,proposeAlbumFromSelection`, ops `album.create` + `album.addAssets` |
| `needs_input`       | trip recommendation is `ask_user` → one question, no plan, pending state set                                                            |
| `approval_required` | a read tool returns `approval-required` → approval event emitted, continuation stored                                                   |
| continuation resume | multi-turn: `needs_input` → follow-up answer → `planned`                                                                                |
| approval denied     | multi-turn: `approval_required` → denial → no plan, explanatory copy                                                                    |
| `handoff_open`      | "make an album of the best shots from my recent trip" → declines, `noPlan: true`                                                        |
| `failed`            | plan tool throws → `failed`, `noPlan: true`, no success language                                                                        |
| negatives           | a question and a chatter greeting → `kind: 'none'`, no tool calls                                                                       |

## Determinism

Scenario outcomes must not drift for reasons unrelated to the change under test:

- **Fixed clock.** `now` is injected as a constant, so trip-window arithmetic and any date in the
  copy are stable.
- **Fixed UUIDs** throughout the dataset.
- **No wall-clock or randomness** in fixtures.
- Model-dependent scenarios still repeat `runs` times and pass on a threshold, exactly as L1 does —
  that machinery is unchanged and continues to absorb LLM variance.

## Testing strategy

`agent-runner`'s test script is currently `node --test 'src/**/*.test.mjs'`, so `eval/` is not under
test at all. It widens to `node --test '{src,eval}/**/*.test.mjs'`.

**Every harness test must run without a model**, matching the existing agent-runner suite (1782
tests in about a second). That is why `createL2Driver` takes `classifier` as a parameter: tests pass
a stub returning a fixed `{ kind, slots, confidence }`; the real run passes the LLM-backed one.

Three test files:

**`eval/fixtures/fake-mcp-client.test.mjs`** — dataset-backed responses for each of the ten tools;
`calls` records name, args and order; `overrides` inject a throw, an `approval-required`, and an
empty result; an unknown tool name throws; repeated calls accumulate in order.

**`eval/drivers/l2-workflow.test.mjs`** — each of the five outcome arms maps to the right decision
shape; `toolSequence` reflects real invocation order; `converse` carries pending state across turns
and resets it between scenarios; the raw-asset-ID assertion actually fires when fed a deliberately
leaky plan call (a test that would pass trivially if the assertion were absent is not a test).

**`eval/score.test.mjs`** — `toolSequence` exact match, including order-sensitivity and length
mismatch; `planOps` subset semantics including the extra-ops-allowed case; `noPlan`; and that
existing L1/L3 keys still behave when the new ones are absent.

### Edge cases covered deliberately

A workflow that issues no tool calls at all; a plan tool that throws; `approval_required` followed
by a **denied** approval; a continuation that expires before the follow-up turn; an unknown tool
name; an empty result set from a read tool (no albums match).

### Not covered, deliberately

Exhaustive permutations of dataset queries — that tests the fixture rather than the harness. Model
behaviour itself, which is L1's job. Anything requiring a database or a live Gallery, which is L3's.

## Acceptance criteria

1. `pnpm --dir agent-runner test` passes, including the new `eval/` tests, **with no model running**.
2. `pnpm --dir agent-runner eval -- --layer L2` produces a scorecard and a non-zero exit if any
   scenario fails its threshold.
3. `--layer L2 --accept` writes `eval/baseline.l2.json`; `--layer L2 --diff` reports per-scenario
   deltas against it.
4. `--layer L1` and `--layer L3` behaviour is byte-for-byte unchanged.
5. A deliberately introduced regression — adding a redundant `searchAssets` call to a covered
   workflow — turns the corresponding L2 scenario red.
