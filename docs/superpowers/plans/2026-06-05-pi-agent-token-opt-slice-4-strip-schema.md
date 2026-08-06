# Slice 4 — Strip nested schema descriptions from the MCP input schema (big win)

Spec: `docs/superpowers/specs/2026-06-05-pi-agent-prompt-token-optimization-design.md` (Slice 4).
Strip the Zod `.describe()` prose from the **model-facing** input schema (especially the
op-union `$defs` on the planning tools, ~10k each), keeping structure + the curated top-level
`propertyDescriptions`. **OpenAPI is untouched** (the MCP schema is built by `z.toJSONSchema`,
the OpenAPI by `createZodDto` — different conversions of the same Zod DTO). Server vitest. TDD.

## Mechanism (verified)

`agent-mcp-tool-registry.service.ts`:

- `toInputSchema(schema)` (line 29) = `z.toJSONSchema(schema, …)` → JSON schema **with Zod
  `.describe()` text as `description` on every node** (top-level, nested, and `$defs`).
- `enrichToolFromContract` (line 166): clones that schema, sets the tool-level
  `inputSchema.description`, and **overrides only TOP-LEVEL properties** with curated
  `propertyDescriptions` (line 175-181). The **nested `$defs`** (e.g. the
  `AgentGalleryOperationInputSchema` op union referenced by `operations`) keep their verbose
  Zod prose → the planning-tool bloat (`proposeAlbumOperations` ~9.7k,
  `reviseProposedOperations` ~9.8k).
- Current catalog baseline after Slice 3: **47,065 tokens.**

## Implementation

Add a recursive description-stripper and apply it inside `toInputSchema` (so BOTH the base
schema and the existing `toProviderFacingPlanningInputSchema` transform see the stripped form):

```ts
const stripSchemaDescriptions = (value: unknown): void => {
  if (Array.isArray(value)) {
    for (const item of value) stripSchemaDescriptions(item);
    return;
  }
  if (!isJsonObject(value)) return;
  delete (value as Record<string, unknown>).description;
  for (const nested of Object.values(value)) stripSchemaDescriptions(nested);
};
```

In `toInputSchema`, after building `inputSchema` and `delete inputSchema['~standard']`, call
`stripSchemaDescriptions(inputSchema)` before returning. **Only `description` is removed** —
keep `type`, `enum`, `const`, `required`, `properties`, `$ref`, `$defs`, `format`, `minimum`,
`maximum`, `items`, etc.

`enrichToolFromContract` is unchanged: it re-adds the tool-level `inputSchema.description`
(contract) + the curated TOP-LEVEL `propertyDescriptions`. So after strip + enrich:

- tool-level description: present (contract).
- top-level args: curated terse descriptions (re-added by enrich).
- nested `$defs` / nested object fields: **no description** (just structure + enums) — the win.

## Tests (RED first)

`agent-mcp-tool-registry.service.spec.ts`:

- **New:** for a planning tool (`proposeAlbumOperations`), assert its built `inputSchema`
  `$defs` (the op union) have **no `description`** on nested op fields (walk `$defs`, assert no
  `description` key) — i.e. the strip took effect on the nested schema.
- **Preserved:** top-level args still carry curated descriptions — e.g.
  `inputSchema.properties.operations.description` is the curated string from
  `propertyDescriptions.operations`; `searchAssets` `properties.filters.description` is the
  curated one. And structure preserved: a known enum (e.g. asset.rotate `angle` enum
  `[90,180,270]`, or a `type` literal) still present in `$defs`.
- **Re-measure + update `CATALOG_TOKENS_BASELINE`** to the new (lower) number. Print the
  per-tool breakdown. Keep `CATALOG_TOKENS_ORIGINAL = 52350` as a reference comment and assert
  the new value is `< 47065` by a meaningful margin (report the actual number).
- Stable-order + byte-identical tests stay green.

`agent-mcp-tool-contract.service.spec.ts` / `agent-mcp.service.spec.ts`: update any assertion
that checked a now-stripped nested `description` (the curated top-level + tool-level
descriptions remain). Keep example-fidelity tests green.

## Verify — OpenAPI MUST be unchanged

```bash
pnpm -C server test -- --run src/services/agent-mcp-tool-registry.service.spec.ts src/services/agent-mcp-tool-contract.service.spec.ts src/services/agent-mcp.service.spec.ts
make check-server && make lint-server
# CRITICAL regression guard: the MCP-schema change must NOT alter the API spec/SDK.
pnpm -C server build && pnpm -C server sync:open-api && make open-api
git status --porcelain open-api/ mobile/openapi/   # MUST be empty (no diff)
```

If `open-api/` or `mobile/openapi/` shows a diff, a Zod DTO was changed by mistake — revert and
keep the change strictly inside `toInputSchema`. Run server prettier on edited server `.ts`.
No agent-runner change.

## Commit

```bash
git add server/ docs/superpowers/plans/2026-06-05-pi-agent-token-opt-slice-4-strip-schema.md
git commit -m "perf(agent): strip nested Zod descriptions from MCP input schema (token-opt slice 4)"
```

## Done when

- The planning tools' op-union `$defs` carry no prose descriptions; top-level + tool-level
  curated descriptions preserved; structure/enums intact.
- Catalog token estimate measurably below 47,065 (report the new number + per-tool breakdown +
  total reduction from the 52,350 original).
- **OpenAPI/SDK diff is empty** (proven by regen). check-server + lint-server green.

## Out of scope

- Omitting/condensing the low-level `proposeAlbumOperations` / `reviseProposedOperations`
  tools themselves (the op-union STRUCTURE is inherently large; removing those tools from the
  model catalog is a redesign — out of scope, note the residual if ~15k isn't reached).
