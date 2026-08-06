import { SUBJECTIVE_PATTERN, resolveAssetSource } from '../asset-source-resolver.mjs';
import { failed, handoffOpen, needsInput } from '../protocol.mjs';
import { gatePlanResult, safeFailureText } from './plan-gate.mjs';

// unstack_assets (hybrid): "unstack/ungroup <source>" → a batch asset.unstack
// over a resolved selection handle. Dissolves any stacks containing the matched
// assets (assets with no stack are silently skipped). No minimum-count guard —
// a single asset can be in a stack.

const KIND = 'unstack_assets';

const clean = (value) => (typeof value === 'string' ? value.trim() : '');
const cleanSource = (value) => clean(value).replace(/[.?!]+$/u, '').trim();

const declinesSourceFastPath = (source) => SUBJECTIVE_PATTERN.test(source);

const UNSTACK_PATTERN = /\bun-?stack\s+(?<source>.+)$/i;
const UNGROUP_PATTERN = /\bungroup\s+(?<source>.+)$/i;

const VERB_PATTERNS = [UNSTACK_PATTERN, UNGROUP_PATTERN];

export const unstackAssetsWorkflow = () => ({
  kind: KIND,
  flow: 'hybrid',

  match(prompt) {
    const text = clean(prompt);
    if (!text) {
      return undefined;
    }
    for (const pattern of VERB_PATTERNS) {
      const m = pattern.exec(text);
      if (m?.groups?.source) {
        const sourceDescription = cleanSource(m.groups.source);
        if (!sourceDescription || declinesSourceFastPath(sourceDescription)) {
          return undefined;
        }
        return { slots: { sourceDescription } };
      }
    }
    return undefined;
  },

  parseSlots(rawSlots) {
    const sourceDescription = cleanSource(rawSlots?.sourceDescription);
    if (!sourceDescription) {
      return null;
    }
    return { sourceDescription };
  },

  async run({ client, slots, signal, now }) {
    const sourceDescription = clean(slots?.sourceDescription);

    // 1. Resolve the source into a selection handle.
    let resolution;
    try {
      resolution = await resolveAssetSource({ client, sourceDescription, signal, ...(now ? { now } : {}) });
    } catch (error) {
      return failed({ text: safeFailureText(error?.message ?? 'The search tool failed.') });
    }
    if (resolution.status === 'handoff') {
      return handoffOpen({ reason: resolution.reason });
    }
    if (resolution.status === 'needs_input') {
      return needsInput({ text: resolution.text });
    }
    if (resolution.status === 'empty') {
      return needsInput({
        text: `I could not find any photos matching "${sourceDescription}". Can you describe them differently?`,
      });
    }
    const { selectionHandleId, assetCount } = resolution;

    // 2. Propose a batch unstack over the selection handle.
    let planResult;
    try {
      planResult = await client.call(
        'proposeAssetBatchFromSelection',
        {
          summary: 'Unstack matching photos.',
          action: { type: 'asset.unstack' },
          selectionHandleId,
        },
        { signal },
      );
    } catch (error) {
      return failed({ text: safeFailureText(error?.message ?? 'The planning tool failed.') });
    }

    return gatePlanResult({
      planResult,
      planTool: 'proposeAssetBatchFromSelection',
      successText: `I prepared a plan to unstack ${assetCount} matching ${assetCount === 1 ? 'photo' : 'photos'}. Any stacks containing these photos will be dissolved. Review the plan before applying it.`,
      successSummary: { workflowKind: KIND, assetCount },
    });
  },
});
