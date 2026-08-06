import { SUBJECTIVE_PATTERN, resolveAssetSource } from '../asset-source-resolver.mjs';
import { failed, handoffOpen, needsInput } from '../protocol.mjs';
import { gatePlanResult, safeFailureText } from './plan-gate.mjs';

const KIND = 'flip_assets';
const clean = (v) => (typeof v === 'string' ? v.trim() : '');
const cleanSource = (v) => clean(v).replace(/[.?!]+$/u, '').trim();

const FLIP_PATTERN =
  /^(?:can you |could you |please |)?(?:flip|mirror)\s+(?<source>.+?)(?:\s+(?<dir>horizontally|vertically|left[- ]?to[- ]?right|top[- ]?to[- ]?bottom))?\s*$/i;

const tryMatch = (prompt) => {
  if (/\bupside\s*down\b/i.test(prompt)) return undefined; // rotate_assets owns this (→ 180°)
  if (/\b(?:rotate|turn|spin|crop)\b/i.test(prompt)) return undefined;
  const m = FLIP_PATTERN.exec(prompt);
  if (!m?.groups?.source) return undefined;
  const dir = m.groups.dir ?? '';
  const axis = /vertical|top/i.test(dir) ? 'vertical' : 'horizontal';
  const source = cleanSource(m.groups.source);
  if (!source || SUBJECTIVE_PATTERN.test(source)) return undefined;
  return { axis, sourceDescription: source };
};

export const flipAssetsWorkflow = () => ({
  kind: KIND,
  flow: 'hybrid',

  match(prompt) {
    const text = clean(prompt);
    if (!text) return undefined;
    const matched = tryMatch(text);
    return matched ? { slots: matched } : undefined;
  },

  parseSlots(rawSlots) {
    const sourceDescription = cleanSource(rawSlots?.sourceDescription);
    const axis = rawSlots?.axis === 'vertical' ? 'vertical' : 'horizontal';
    if (!sourceDescription) return null;
    return { axis, sourceDescription };
  },

  async run({ client, slots, signal }) {
    const axis = slots?.axis === 'vertical' ? 'vertical' : 'horizontal';
    const sourceDescription = cleanSource(slots?.sourceDescription);
    if (!sourceDescription) {
      return needsInput({ text: 'Tell me which photos to flip (horizontally or vertically).' });
    }

    let resolution;
    try {
      resolution = await resolveAssetSource({ client, sourceDescription, signal });
    } catch (error) {
      return failed({ text: safeFailureText(error?.message ?? 'The search tool failed.') });
    }
    if (resolution.status === 'handoff') return handoffOpen({ reason: resolution.reason });
    if (resolution.status === 'needs_input') return needsInput({ text: resolution.text });
    if (resolution.status === 'empty') {
      return needsInput({
        text: `I could not find any photos matching "${sourceDescription}" to flip. Can you describe them differently?`,
      });
    }

    const { selectionHandleId, assetCount } = resolution;
    let planResult;
    try {
      planResult = await client.call(
        'proposeAssetBatchFromSelection',
        {
          summary: `Flip matching photos ${axis === 'horizontal' ? 'horizontally' : 'vertically'}.`,
          action: { type: 'asset.flip', axis },
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
      successText: `I prepared a plan to flip ${assetCount} matching ${assetCount === 1 ? 'photo' : 'photos'} ${axis === 'horizontal' ? 'horizontally' : 'vertically'}. Review the plan before applying it.`,
      successSummary: { workflowKind: KIND, assetCount, axis },
    });
  },
});
