# Slice 3 — Prune examples + trim contract descriptions (biggest win)

Spec: `docs/superpowers/specs/2026-06-05-pi-agent-prompt-token-optimization-design.md` (Slice 3).
The `examples` arrays are the bulk of the catalog and are OpenAPI-independent. Cap each tool's
examples and trim verbose prose. Server vitest. TDD. **Riskiest content slice → first L3
checkpoint follows.**

## Targets (from the Slice-1 measurement)

Catalog baseline = **52,350 tokens**. Biggest contributors:
`reviseProposedOperations` 12,216 · `proposeAlbumOperations` 11,543 · `searchAssets` 3,542 ·
`proposeAssetBatchFromSearch` 2,884 · `proposeAlbumFromSearch` 2,123.

The planning tools are dominated by the shared **22-entry proposal examples array**
(`agent-mcp-tool-contract.service.ts` ~line 1386+, the `create-empty-album` … `trash-assets`
set) referenced by `proposeAlbumOperations` (~2501) and `reviseProposedOperations` (~2513),
plus the per-search examples (`searchAssets` ~380, ~13 entries) and the from-search example
arrays (`proposeAlbumFromSearchExamples`, etc.).

## Implementation (`agent-mcp-tool-contract.service.ts`)

1. **Cap every tool's `examples` to ≤ 2**, keeping the highest-signal cases:
   - The shared **proposal examples array** (22 → 2): keep `create-album-and-add-assets`
     (the canonical create+add) + `add-assets-to-existing-album` (the most common op). Drop
     the other 20. Both `proposeAlbumOperations` and `reviseProposedOperations` then carry 2.
   - `searchAssets` (≈13 → 2): keep `empty-search` + one bounded
     (`bounded-date-location-search`).
   - Each `propose*FromSearch/FromSelection` example array → ≤ 2 (keep the empty/minimal + one
     representative).
   - `curateSelection`, `readAssetMetadata`, etc. → ≤ 2.
2. **Trim verbose `usage`/`description`** to a tight single statement where it's clearly
   redundant with the (already sent-once) generated cheat-sheet
   (`agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs` — do NOT edit that;
   just lean on it). Keep each tool's `description` non-empty and accurate.
3. Do NOT touch the Zod schema, `propertyDescriptions`, or tool order (Slice 4 / Slice 1).

If pruning leaves now-unused example consts, remove them to satisfy lint (no-unused).

## Tests (RED first — these will fail until the contract + the test expectations are updated)

`agent-mcp-tool-contract.service.spec.ts`:

- **Update** `expectedProposalExampleNames` (currently 22) to the kept 2 names; update any
  per-tool example-name/count assertions accordingly.
- Add `it('every tool contract has at most 2 examples')`: iterate all read + planning
  contracts, assert `examples.length <= 2`.
- Keep the existing "each example's arguments parse against the schema" fidelity checks (the
  kept examples must still validate) — confirm they pass with the reduced set.

`agent-mcp-tool-registry.service.spec.ts`:

- **Update the Slice-1 baseline pin**: the catalog token estimate drops a lot. Re-measure,
  set a NEW `CATALOG_TOKENS_BASELINE` to the post-prune number, and ALSO assert it is
  `< 52350 * 0.7` (≤ 70% of the original — a meaningful-margin guard). Keep printing the
  per-tool breakdown. (Record the original 52,350 as `CATALOG_TOKENS_ORIGINAL` in a comment
  for reference.)
- Stable-order + byte-identical tests stay green (order unchanged).

## Verify

```bash
pnpm -C server test -- --run src/services/agent-mcp-tool-contract.service.spec.ts src/services/agent-mcp-tool-registry.service.spec.ts
make check-server && make lint-server
```

No OpenAPI change (the Zod schemas/DTOs are untouched — confirm by NOT editing agent-tool.dto
or agent-operation.dto). Run server prettier on the edited contract + specs.

## Commit

```bash
git add server/ docs/superpowers/plans/2026-06-05-pi-agent-token-opt-slice-3-prune-examples.md
git commit -m "perf(agent): cap tool examples to <=2 + trim contract prose (token-opt slice 3)"
```

## Done when

- Every tool contract has ≤ 2 examples; the planning tools shed the bulk of the 22-example
  array; the catalog token estimate is ≤ 70% of the 52,350 baseline (report the new number +
  the per-tool breakdown).
- Contract example-fidelity tests pass on the reduced set; order unchanged.
- check-server + lint-server green. Report the new catalog token count.

## Out of scope

- Input-schema description stripping (Slice 4 — the op-union prose on the planning tools).
- Touching the cheat-sheet, Zod DTOs, or OpenAPI.
