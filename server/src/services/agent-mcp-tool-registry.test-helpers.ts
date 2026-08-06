/**
 * Token-size measurement helpers for the MCP tool catalog.
 *
 * Imported by agent-mcp-tool-registry.service.spec.ts (Slice 1) and by later
 * slices (2–4) that assert the catalog shrinks below CATALOG_TOKENS_BASELINE.
 *
 * NOTE: do NOT import this from production code — test-helpers only.
 */

import { AgentMcpToolContractService } from 'src/services/agent-mcp-tool-contract.service';
import { AgentMcpToolRegistryService } from 'src/services/agent-mcp-tool-registry.service';

/**
 * Chars/4 token estimate of the full tools/list payload as the model receives it.
 * Returns both the rounded token count and the raw byte length for diagnostics.
 */
export const estimateCatalogTokens = (tools: unknown[]): { tokens: number; bytes: number } => {
  const json = JSON.stringify(tools);
  return { tokens: Math.ceil(json.length / 4), bytes: json.length };
};

/**
 * Frozen baseline measured on 2026-06-06 (token-opt Slice 4 — after stripping Zod .describe()
 * annotations from the model-facing MCP input schema via stripSchemaDescriptions).
 * History:
 *   CATALOG_TOKENS_ORIGINAL = 52_350 (Slice 1, 2026-06-05 — pre-prune baseline)
 *   47_065 (Slice 3, 2026-06-06 — after capping examples to ≤2)
 *   46_255 (Slice 4, 2026-06-06 — after stripping nested Zod descriptions)
 *   47_997 (image-adj Slice 3a, 2026-06-06 — added asset.adjust + asset.flip op schemas)
 *   48_241 (image-adj Slice 3b, 2026-06-06 — updated contract descriptions for adjust/flip)
 *   50_002 (lib-mgmt Slice 1.2, 2026-06-08 — added album.addUsers/removeUsers/updateUserRole op schemas)
 *   50_682 (lib-mgmt Slice 2.2, 2026-06-08 — added asset.setVisibility op schema)
 *   51_513 (lib-mgmt Slice 3.2, 2026-06-08 — added album.delete + space.delete op schemas)
 *   51_581 (rolling sync onto batch 290, 2026-06-25 — upstream enum/schema content drift across
 *           batches 268–290; +68 tokens of embedded structural content. Stripping integrity and
 *           schema structure (enum/type/required) verified intact, so this is a content re-baseline,
 *           not an optimization regression.)
 * Later slices must assert their catalog token count is strictly < CATALOG_TOKENS_BASELINE.
 * Update this const only when intentionally re-baselining (e.g. after a content addition).
 */
export const CATALOG_TOKENS_BASELINE = 51_581;

/**
 * Build a real (not mocked) registry for token and order tests.
 */
export const buildTestRegistry = (): AgentMcpToolRegistryService =>
  new AgentMcpToolRegistryService(new AgentMcpToolContractService());
