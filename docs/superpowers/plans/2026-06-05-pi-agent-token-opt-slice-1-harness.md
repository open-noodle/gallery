# Slice 1 — Catalog token-size harness + stable-order lock (test-only)

Spec: `docs/superpowers/specs/2026-06-05-pi-agent-prompt-token-optimization-design.md` (Slice 1).
**Zero production behavior change.** Adds the measurement + cache-stability guard every later
slice builds on. Server vitest only.

## Files

- `server/src/services/agent-mcp-tool-registry.service.spec.ts` (the registry spec; create if
  absent — there is a contract spec `agent-mcp-tool-contract.service.spec.ts`; add a registry
  spec or extend an existing one) + a small inline helper (no production file changes).

## Step 1 — token-size helper (in the spec file, or a tiny test util)

```ts
// chars/4 token estimate of the FULL tools/list payload as the model receives it.
const estimateCatalogTokens = (tools: unknown[]) => {
  const json = JSON.stringify(tools);
  return { tokens: Math.ceil(json.length / 4), bytes: json.length };
};
```

Build the real registry: `new AgentMcpToolRegistryService(new AgentMcpToolContractService())`
and call `listTools()` (the deterministic 26-tool array). The serialized form of `listTools()`
is what the gateway returns and the model sees.

## Step 2 (RED→GREEN) — baseline size test

In `agent-mcp-tool-registry.service.spec.ts`:

- `it('catalog token estimate is within the recorded baseline')`:
  - Compute `estimateCatalogTokens(registry.listTools())`.
  - Record the current value as an exported/module const `CATALOG_TOKENS_BASELINE` (the
    measured number — fill it in from the first run; this is the "before" the later slices
    must beat).
  - Assert the live estimate `=== CATALOG_TOKENS_BASELINE` (so the baseline is pinned and any
    drift is visible). Print the number + per-tool breakdown (`console.info`) so the biggest
    contributors are recorded in CI output. Per-tool: `listTools().map(t => ({ name: t.name,
tokens: Math.ceil(JSON.stringify(t).length/4) }))` sorted desc.
  - **Run once to discover the real number, then bake it into `CATALOG_TOKENS_BASELINE`** and
    re-run green. Report the discovered baseline number in your summary.

- Export `CATALOG_TOKENS_BASELINE` and the `estimateCatalogTokens` helper from the spec (or a
  shared `agent-mcp-tool-registry.test-helpers.ts`) so Slices 2–4 import it and assert
  `< CATALOG_TOKENS_BASELINE`.

## Step 3 (RED→GREEN) — stable-order lock at the registry level

- `it('listTools() returns tools in a fixed, deterministic order')`:
  - Assert `registry.listTools().map(t => t.name)` deep-equals the full expected 26-name order
    (16 read names from `expectedReadToolNames` + 10 planning from `expectedPlanningToolNames`
    — reuse/import those arrays from the contract spec or red`eclare). Comment: **order is the
    KV-cache key; do not reorder** (mirrors the spec's "Prompt caching" appendix).
  - Assert two successive `listTools()` calls produce byte-identical JSON (determinism →
    cache stability): `JSON.stringify(a) === JSON.stringify(b)`.

## Verify

```bash
pnpm -C server test -- --run src/services/agent-mcp-tool-registry.service.spec.ts
```

→ GREEN. Also run the contract spec to confirm nothing regressed:
`pnpm -C server test -- --run src/services/agent-mcp-tool-contract.service.spec.ts`.
`make check-server` + `make lint-server` green (run server prettier on the edited spec).

No OpenAPI/SDK change (test-only). No agent-runner change.

## Commit

```bash
git add server/ docs/superpowers/plans/2026-06-05-pi-agent-token-opt-slice-1-harness.md
git commit -m "test(agent): catalog token-size harness + stable-order lock (token-opt slice 1)"
```

## Done when

- The registry spec records `CATALOG_TOKENS_BASELINE` (the measured ~current catalog token
  count) and pins it; the per-tool breakdown is printed.
- The deterministic 26-tool order + byte-identical repeat is locked by a test.
- check-server + lint-server green. Report the discovered baseline token number.
