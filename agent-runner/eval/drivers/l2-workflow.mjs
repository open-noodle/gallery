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
 * The no-raw-asset-IDs invariant. Gallery prunes `assetIds` from provider-facing
 * planning schemas so ids are materialised server-side; a workflow must pass a
 * selection handle or source ref instead. Applied to every plan call, so a
 * regression turns every plan scenario red at once.
 *
 * @returns {string|null} the offending path, or null when clean.
 */
export const findRawAssetIdLeak = (calls) => {
  for (const call of calls) {
    if (!PLAN_TOOLS.has(call.name)) continue;
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

    const dispatcher = createWorkflowDispatcher({
      registry,
      buildClient: () => client,
      now,
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
