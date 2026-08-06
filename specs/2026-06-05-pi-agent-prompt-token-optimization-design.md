# Pi Agent — Prompt / Tool-Catalog Token Optimization

Status: design / spec
Date: 2026-06-05
Branch: `explore/pi-agent-brainstorm`

## Problem

Each **open-orchestration** agent turn sends ~30k input tokens. The breakdown (measured
this session):

- System prompt (behavior rules + generated cheat-sheet): **~1.5k tokens** — fine.
- Strict-classifier turn: one `classifyTool` — cheap; not the issue.
- **MCP tool catalog (`tools/list`): ~25–28k tokens** — the whole problem. 26 tools
  (16 read + 10 planning), each with a description, a verbose `examples` array
  (`searchAssets` alone has ~13), an input JSON schema, and per-property descriptions —
  re-sent on every open-orchestration turn.

The catalog only reaches the model on the **open path** (a prompt that does not route to a
strict workflow). Strict-routed prompts never see it. The catalog content is identical
every turn, so a stable prefix + model-server KV-cache reuse matters as much as raw size.

## Architecture (verified)

- `tools/list` → `AgentMcpService.handle()` → `AgentMcpToolRegistryService.listTools()`
  (`server/src/services/agent-mcp-tool-registry.service.ts`). `buildTools()` builds a
  **fixed-order array** (deterministic) of 26 tools; each enriched from
  `agent-mcp-tool-contract.service.ts` (descriptions + `examples` + `propertyDescriptions`)
  and the Zod DTO (`agent-tool.dto.ts`) for the input schema.
- The **contract** (descriptions, examples, propertyDescriptions) is **independent** of the
  Zod schema. Trimming it does NOT touch OpenAPI.
- The **Zod schema** (`agent-tool.dto.ts`) IS shared with OpenAPI (`createZodDto`). Its
  `.describe()` prose flows into the MCP input schema too. Trimming the Zod schema directly
  would change OpenAPI — so we strip descriptions when building the **MCP-facing** schema
  instead, leaving the Zod DTO (and OpenAPI) untouched.
- `listTools()` is **not session-aware**; all tools go to everyone. Permission gating
  (`readAssetOriginals`, `readAssetPreviews`, shared-space tools) happens only at
  tool-**call** time. The gateway endpoint is session-scoped
  (`POST /agent/internal/mcp/sessions/:id`), so the session's permission snapshot is
  reachable at list time.
- The agent-runner (`pi-runtime.mjs`) consumes whatever the gateway returns via the SDK; it
  does not re-order or re-describe tools. So **most optimizations are server-side** (the
  contract + the registry's list builder), transparent to the runner.
- Dispatcher: `classify()` → `none` → `{ handled: false }` → full open orchestration. **No
  chatter short-circuit exists today.**

## Goal & success metric

Reduce the open-path catalog from **~28k → ≤ ~15k tokens** (≈ −45%) without degrading
routing or open-agent tool-use quality, and guarantee the catalog stays cache-stable.

**Primary per-slice gate (fast, clone-free):** a unit test serializes the full
`tools/list` output as the model receives it and asserts a token budget (chars/4 estimate).
Each token-affecting slice must show a measured decrease; a frozen baseline is recorded in
Slice 1.

**Behavior gate (checkpoints):** L3 against a personal-test clone (see "L3 cadence") to
confirm no routing regression and no worse open-agent behavior.

## Method: TDD

Every slice is test-first: write the failing size/behavior test, watch it fail, implement
the minimum, go green, then the eval checkpoints. Server changes run server prettier;
agent-runner changes do NOT (not prettier-gated). Regenerate OpenAPI only if an API DTO
changes (Slice 4 must regenerate and prove the diff is empty/intended).

---

## Slices

### Slice 1 — Catalog token-size harness + stable-order lock (foundation, zero behavior change)

Establish the measurement + cache-stability guarantee everything else builds on. **No
content change → token size unchanged here; this slice only measures and locks.**

- Add a test helper that builds the full `tools/list` payload (via the real
  `AgentMcpToolRegistryService`) and serializes it exactly as sent to the model, returning
  `{ tokenEstimate, perTool: [{ name, tokens }] }` (chars/4).
- `agent-mcp-tool-registry.service.spec.ts`:
  - **Baseline size test**: assert the current catalog token estimate and record it as the
    frozen baseline constant `CATALOG_TOKENS_BASELINE` (the "before" number). Print the
    per-tool breakdown so the biggest contributors are visible.
  - **Stable-order test**: `listTools()` returns tools in a fixed, documented order across
    repeated calls (lock the existing array order so future edits can't silently break
    KV-cache reuse).
- Add a short doc note (in this spec's "Prompt caching" appendix) on the model-server
  reliance: identical, stable-ordered prefix → llama.cpp `cache_prompt`/slot reuse avoids
  re-prefilling the catalog across turns. (No app code controls the model server; the
  guarantee we own is _stable bytes_.)

**Tests:** the two above. **Risk:** none. **L3:** none (no behavior change) — but this slice
captures the **baseline L3** scorecard (see cadence) as the comparison point.

### Slice 2 — Preset-gated tool listing

Hide tools the session may not use from `tools/list` (not just deny at call time). Smaller
catalog for restricted presets + honest advertising.

- Thread the session's `permissionPlanSnapshot` into the `tools/list` path (the handler
  already has the session id). `listTools(snapshot)` filters out:
  - `readAssetOriginals` when `!read.originals`.
  - `readAssetPreviews` when `!read.previews`.
  - `listSpaces` / `readSpace` / `searchUsers` when `!assetScope.sharedSpaces`.
  - `createSharedLinks`-only planning helpers stay (writes are review-gated), but any tool
    that is purely unusable under the preset is dropped.
- Keep **call-time enforcement unchanged** (defense in depth — a hidden tool that is somehow
  called still 403s).

**Tests** (`agent-mcp-tool-registry.service.spec.ts` / `agent-mcp.service.spec.ts`):

- per-preset list excludes exactly the gated tools (Careful drops originals + previews +
  space tools; VisualOrganizer/LocalPowerUser keep what they're entitled to);
- token-size test: Careful catalog measurably < full; the gated tools are absent from the
  serialized payload;
- call-time denial paths still behave as before (regression).

**Risk:** low (removes only forbidden tools). **L3:** unit-covered; no dedicated L3 (the eval
preset, visual-organizer, keeps the tools it uses — verified by the per-preset test).

### Slice 3 — Prune examples + trim contract descriptions (biggest safe win)

The `examples` arrays + verbose usage prose are the bulk and are OpenAPI-independent.

- In `agent-mcp-tool-contract.service.ts`: cap each tool's `examples` to **≤ 2** (keep the
  one or two highest-signal cases — typically an empty/minimal call + one representative
  bounded call), and trim `usage`/`description` to a tight single statement. Any genuinely
  shared guidance moves into the existing generated cheat-sheet (sent once), not per-tool.
- Do not touch the Zod schema or `propertyDescriptions` here (Slice 4 owns the schema).

**Tests** (`agent-mcp-tool-contract.service.spec.ts`):

- every tool has `examples.length <= 2`;
- the serialized catalog token estimate drops below a slice target (e.g. ≤ 70% of baseline)
  — assert `< CATALOG_TOKENS_BASELINE` by a meaningful margin;
- routing-critical fields preserved: each tool still has a non-empty `description`; the
  contract still parses + the registry builds all 26 tools;
- a golden test that the highest-value example per key tool (`searchAssets` empty + bounded)
  survives the prune.

**Risk:** medium — examples guide smaller models. **L3 checkpoint** (first risky slice):
full-ish run; compare to baseline; investigate any routing/behavior drop before Slice 4.

### Slice 4 — Decouple + compact the MCP-facing input schema descriptions

Strip the verbose Zod `.describe()` prose from the **model-facing** input schema while
leaving the Zod DTO (and OpenAPI) untouched. The contract's curated `propertyDescriptions`
becomes the single, terse field-doc channel for the model.

- In the registry's schema-building step (`toInputSchema` / `enrichToolFromContract`):
  produce the MCP tool `inputSchema` from the Zod DTO with **field descriptions stripped /
  shortened** (keep names, types, enums, required, bounds). Field docs the model needs come
  from the contract's `propertyDescriptions` (already terse), avoiding the description
  duplication that exists today.
- The Zod DTOs in `agent-tool.dto.ts` are **not modified** → OpenAPI spec + SDK unchanged.

**Tests**:

- the built MCP `inputSchema` for a representative tool (`searchAssets`) has no long prose
  `description` on its properties (or they're within a tight budget);
- **OpenAPI unchanged**: `pnpm -C server sync:open-api && make open-api` produces an empty
  diff (the API DTOs didn't change) — a regression guard in the slice;
- server input validation still accepts the same valid inputs and rejects the same invalid
  ones (the Zod schema is unchanged — assert via existing DTO parse tests);
- catalog token estimate drops further (assert below the Slice 3 number).

**Risk:** medium — the model needs enough schema signal to form correct tool calls.
**L3 checkpoint:** full-ish run; watch for malformed tool calls / wrong filters on the
open path; compare to the Slice 3 scorecard.

### Slice 5 — Chatter / actionability pre-filter (runner)

Avoid spinning up the 30k-catalog open agent for clearly non-actionable prompts.

- In `dispatcher.mjs` / `pi-runtime.mjs`, before open orchestration: a **conservative**
  chatter check (pure greetings / thanks / acknowledgements — e.g. "thanks", "ok cool",
  "that's perfect") returns a short no-tool conversational reply and stops. Everything else
  — including questions (which need tools to answer) — falls through unchanged.
- Implement as a tight allowlist/regex of acknowledgement patterns (high precision, low
  recall) so a real request is never swallowed. The classifier already returns `none` for
  these; this adds a no-tool fast reply instead of the full agent.

**Tests** (`dispatcher.test.mjs` / `pi-runtime.test.mjs`):

- chatter prompts ("thanks, that looks great", "ok cool", "perfect, thank you") →
  handled by the pre-filter, **no open fallthrough**, no tools requested;
- questions ("how many photos do I have?") and real requests still **fall through** to the
  open agent (must NOT be swallowed);
- the existing dispatcher routing tests stay green.

**Risk:** medium — false negatives swallow real intent; kept conservative + L3-checked.
**L3 checkpoint:** the negatives still behave (chatter answered without a tool storm; real
"unsupported" negatives still reach the open agent and don't fabricate plans); plus a final
full L3.

---

## L3 verification cadence (limit laptop load)

L3 routing/propose assertions mostly exercise the **strict** path (manifest-based), which
these catalog optimizations don't change — so L3's main value here is catching open-agent
regressions and confirming nothing else moved. To avoid hammering the local gemma4 (the
exact cost we're reducing), the cadence is:

1. **Baseline (Slice 1):** spin up ONE personal-test clone of the branch, wire the agent
   stack + laptop-gemma4 egress (see the `pi_agent_clone_l3_setup` memory), run the **full**
   L3 suite, save the scorecard as the baseline.
2. **After Slices 3, 4, 5** (the behavior-affecting ones): build an RC, `kubectl set image`
   the clone's server+runner to the new tag (no DB re-recovery), run a **focused L3 subset**
   (all routing `recall` + all `negatives` + a sample of `plan`/open scenarios) and compare
   to baseline. Skip dedicated L3 for Slices 1–2 (no behavior change / fully unit-covered).
3. **Final:** full L3 suite on the complete optimization set; confirm ≥ baseline. Tear the
   clone down.

The **per-slice token-size unit test is the primary size gate** (clone-free, runs every
slice). A scorecard regression vs baseline blocks proceeding until understood/fixed.

## Out of scope

- Reordering tools (would break cache stability — explicitly forbidden).
- Modifying the Zod DTOs / OpenAPI surface (Slice 4 strips only the MCP-facing copy).
- Removing call-time permission enforcement (Slice 2 only hides; deny still applies).
- Lazy/dynamic tool loading or splitting the catalog into sub-agents (larger redesign;
  revisit if ≤15k isn't reached).
- Changing the model server / llama.cpp config (not in this repo; documented as a
  recommendation only).

## Appendix — prompt caching

The catalog is byte-identical and stable-ordered every turn, so an OpenAI-compatible server
with prompt caching (llama.cpp `cache_prompt`, sufficient slots, stable prefix) reuses the
KV cache and skips re-prefilling the ~15k prefix on later turns of a session. Our code owns
only the **stable bytes** guarantee (Slice 1's order lock + the deterministic contract).
Across many _fresh_ sessions (e.g. an eval batch) cache reuse is limited by slot count — a
reason to also cut raw size (Slices 2–4) and avoid the open path entirely for chatter
(Slice 5).
