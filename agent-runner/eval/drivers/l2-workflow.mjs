// L2 driver: drives the REAL workflow dispatcher and the REAL workflow run()
// implementations against a seeded fake MCP client. No Gallery server, no DB,
// and — when a classifier is injected or the regex fast-path matches — no model.
//
// Exposes the same driver interface score.mjs already calls for L1/L3, so
// run.mjs needs no special-casing beyond layer selection.
import { createWorkflowDispatcher } from '../../src/strict-workflows/dispatcher.mjs';
import { createWorkflowRegistry } from '../../src/strict-workflows/registry.mjs';
import { renderCopy } from '../../src/strict-workflows/copy.mjs';
import { DATASET } from '../fixtures/dataset.mjs';
import { createFakeMcpClient, PLAN_TOOLS } from '../fixtures/fake-mcp-client.mjs';

// A fixed instant so trip-window arithmetic and any date in the copy are stable.
export const FIXED_NOW_MS = Date.UTC(2026, 4, 20, 12, 0, 0);

// The subset of PLAN_TOOLS where a raw assetIds array is ALWAYS a bug: these
// tools exist specifically to take a selection handle (or a search-derived
// selection) instead of ids, so any assetIds array here means a workflow
// bypassed the handle plumbing. Deliberately narrower than PLAN_TOOLS —
// `proposeAlbumOperations` is excluded because two real production
// workflows legitimately pass a non-empty `assetIds` array as an operation
// payload (`set-album-cover.mjs`'s `album.setCover`, `cleanup-duplicates.mjs`'s
// `asset.trash`); Gallery's server-side tool-registry pruning of `assetIds`
// applies only to the schema the MODEL sees, not to what Gallery's own
// deterministic workflows may pass once ids are already materialised
// server-side. Scanning `proposeAlbumOperations` here would fail every
// correct `planned` run of either workflow.
const HANDLE_BASED_PLAN_TOOLS = Object.freeze(
  new Set([
    'proposeAlbumFromSelection',
    'proposeAssetBatchFromSelection',
    'proposeSpaceFromSearch',
    'proposeAddAssetsToSpaceFromSearch',
  ]),
);

const scanForAssetIds = (value, path) => {
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      const hit = scanForAssetIds(item, `${path}[${index}]`);
      if (hit) return hit;
    }
    return null;
  }
  if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      const next = path ? `${path}.${key}` : key;
      if (key === 'assetIds' && Array.isArray(item) && item.length > 0) return next;
      const hit = scanForAssetIds(item, next);
      if (hit) return hit;
    }
  }
  return null;
};

/**
 * The no-raw-asset-IDs invariant for HANDLE-BASED plan tools. These tools
 * (`proposeAlbumFromSelection`, `proposeAssetBatchFromSelection`,
 * `proposeSpaceFromSearch`, `proposeAddAssetsToSpaceFromSearch`) exist so a
 * workflow proposes a plan over a selection handle or search-derived
 * selection instead of enumerating raw asset ids — an assetIds array
 * anywhere in their args means that plumbing was bypassed. Deliberately does
 * NOT scan `proposeAlbumOperations`: two real workflows (`set-album-cover`'s
 * `album.setCover`, `cleanup-duplicates`'s `asset.trash`) legitimately pass a
 * materialised `assetIds` array as an operation payload, and flagging that
 * would fail every correct `planned` run of either. Applied to every plan
 * call in scope, so a regression turns every affected plan scenario red at
 * once.
 *
 * @returns {string|null} the offending path, or null when clean.
 */
export const findRawAssetIdLeak = (calls) => {
  for (const call of calls) {
    if (!HANDLE_BASED_PLAN_TOOLS.has(call.name)) continue;
    const hit = scanForAssetIds(call.args, '');
    if (hit) return `${call.name}.${hit}`;
  }
  return null;
};

const textOf = (event) => {
  const block = event?.content?.blocks?.find((b) => b?.type === 'text');
  return typeof block?.text === 'string' ? block.text : undefined;
};

export const createL2Driver = ({
  classifier,
  dataset = DATASET,
  now = () => FIXED_NOW_MS,
  copyMode = 'template',
  overrides = {},
} = {}) => {
  // One session = one fresh fake client and one fresh pending store. State must
  // never leak between scenarios or the suite becomes order-dependent.
  const runSession = async (turns) => {
    const { client, calls } = createFakeMcpClient({ dataset, overrides });
    const registry = createWorkflowRegistry(classifier ? { classifier } : {});
    const observed = [];
    const emitted = [];
    let pending;
    let handled = false;

    // Turns may advance the clock so TTL-dependent arms (continuation expiry)
    // are reachable. `now` is read more than once per turn by the dispatcher, so
    // an auto-incrementing clock would be unpredictable — advance it explicitly.
    let clockOffsetMs = 0;
    const sessionNow = () => now() + clockOffsetMs;

    const dispatcher = createWorkflowDispatcher({
      registry,
      buildClient: () => client,
      now: sessionNow,
      copyMode,
      observe: (event) => observed.push(event),
    });

    const common = {
      emit: (event) => emitted.push(event),
      appendTranscript: () => {},
      getPending: () => pending,
      setPending: (value) => {
        pending = value;
      },
    };

    for (const turn of turns) {
      if (turn && typeof turn === 'object' && typeof turn.advanceMs === 'number') {
        clockOffsetMs += turn.advanceMs;
        continue;
      }
      if (typeof turn === 'string') {
        ({ handled } = await dispatcher.routeTurn({ prompt: turn, ...common }));
        continue;
      }
      const approvalEvent = emitted.find((event) => event?.type === 'tool-approval-needed');
      ({ handled } = await dispatcher.routeApproval({
        toolCallId: turn.toolCallId ?? approvalEvent?.toolCallId,
        approvalDecision: turn.approve ? 'approved' : 'denied',
        toolResult: turn.toolResult ?? { status: 'success' },
        ...common,
      }));
    }

    const router = observed.find((event) => event.kind === 'strict_router_decision');
    const outcome = observed.filter((event) => event.kind === 'strict_workflow_outcome').at(-1);
    const planCall = calls.find((call) => PLAN_TOOLS.has(call.name));
    const planId = outcome?.status === 'planned' ? (outcome.planId ?? null) : null;

    return {
      kind: router?.workflowKind ?? 'none',
      via: router?.via ?? null,
      confidence: router?.confidence ?? null,
      slots: undefined,
      parsedSlots: undefined,
      outcomeStatus: outcome?.status ?? null,
      planProposed: outcome?.status === 'planned',
      planId,
      // No WorkflowOutcome carries operations — they are an ARGUMENT to the plan
      // tool, and only the proposeAlbumOperations family takes one. Selection-based
      // plan tools legitimately leave this empty.
      planOps: Array.isArray(planCall?.args?.operations) ? planCall.args.operations : [],
      toolSequence: calls.map((call) => call.name),
      rawAssetIdLeak: findRawAssetIdLeak(calls),
      text: emitted.map(textOf).filter(Boolean).at(-1),
      handled,
    };
  };

  return {
    model: 'l2-fake-mcp',
    baseUrl: 'in-memory',
    classify: (prompt) => runSession([prompt]),
    converse: (turns) => runSession(turns),
    polishCopy: (summary) =>
      renderCopy({ outcome: { status: 'planned', planId: 'eval-plan', successSummary: summary }, mode: 'template' }),
    templateCopy: (summary) =>
      renderCopy({ outcome: { status: 'planned', planId: 'eval-plan', successSummary: summary }, mode: 'template' }),
  };
};
