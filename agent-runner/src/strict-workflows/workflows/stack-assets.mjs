import { SUBJECTIVE_PATTERN, resolveAssetSource } from '../asset-source-resolver.mjs';
import { failed, handoffOpen, needsInput } from '../protocol.mjs';
import { gatePlanResult, safeFailureText } from './plan-gate.mjs';

// stack_assets (hybrid): "stack/group <source>" → a batch asset.stack over a
// resolved selection handle. The server selects the stack cover automatically
// using the rule: favorite > highest rating (desc, nulls last) > newest > id.
// Stacking requires at least two assets — the workflow gates on assetCount < 2
// and asks the user to broaden the selection.

const KIND = 'stack_assets';

const clean = (value) => (typeof value === 'string' ? value.trim() : '');
const cleanSource = (value) => clean(value).replace(/[.?!]+$/u, '').trim();

const declinesSourceFastPath = (source) => SUBJECTIVE_PATTERN.test(source);

// "stack <source>" — optionally followed by "into a stack" (ignored)
const STACK_PATTERN = /\bstack\s+(?<source>.+?)(?:\s+into\s+a\s+stack)?$/i;
// "group <source> into a stack" — requires the "into a stack" tail to avoid
// stealing "group" in non-photo-stack contexts.
const GROUP_PATTERN = /\bgroup\s+(?<source>.+?)\s+into\s+a\s+stack$/i;

const VERB_PATTERNS = [STACK_PATTERN, GROUP_PATTERN];

export const stackAssetsWorkflow = () => ({
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

    // 2. Stacking requires at least two assets.
    if (assetCount < 2) {
      return needsInput({
        text: `A stack needs at least two photos — I only found ${assetCount}. Can you broaden the selection?`,
      });
    }

    // 3. Propose a batch stack over the selection handle.
    let planResult;
    try {
      planResult = await client.call(
        'proposeAssetBatchFromSelection',
        {
          summary: 'Stack matching photos.',
          action: { type: 'asset.stack' },
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
      successText: `I prepared a plan to stack ${assetCount} matching ${assetCount === 1 ? 'photo' : 'photos'}. The favorite or highest-rated photo will be kept as the stack cover. Review the plan before applying it.`,
      successSummary: { workflowKind: KIND, assetCount },
    });
  },
});
