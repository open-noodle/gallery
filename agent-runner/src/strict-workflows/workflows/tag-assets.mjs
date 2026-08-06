import { SUBJECTIVE_PATTERN, resolveAssetSource } from '../asset-source-resolver.mjs';
import { failed, handoffOpen, needsInput } from '../protocol.mjs';
import { gatePlanResult, safeFailureText } from './plan-gate.mjs';

// tag_assets (hybrid, ADD-ONLY): "tag <source> as <tag>" / "add [the] tag <tag>
// to <source>" → a batch asset.addTag over a resolved selection handle. The batch
// action union has no removeTag, so removal phrasings hand off (no match here).
// This module is the router half; execution + registration land in later slices.

const KIND = 'tag_assets';

const clean = (value) => (typeof value === 'string' ? value.trim() : '');
const cleanSource = (value) => clean(value).replace(/[.?!]+$/u, '').trim();

// Strip a single pair of surrounding quotes (straight or smart) from a tag name.
const stripQuotes = (t) => (t.length >= 2 && /^["'“‘]/.test(t) && /["'”’]$/.test(t) ? t.slice(1, -1).trim() : t);
const cleanTag = (value) => stripQuotes(clean(value).replace(/[.?!]+$/u, '').trim());

const tripSourcePattern = /\brecent\s+trip\b/i;
const declinesSourceFastPath = (source) => SUBJECTIVE_PATTERN.test(source) || tripSourcePattern.test(source);

// `\btag` has no boundary inside "untag" (n→t), so an untag prompt never matches
// TAG_AS; "remove the X tag from …" matches none of the add-patterns.
const TAG_AS_PATTERN = /\btag\s+(?<source>.+?)\s+as\s+(?<tag>.+)$/i;
const ADD_TAG_NAMED_TO_PATTERN = /\badd\s+(?:the\s+)?tag\s+(?<tag>.+?)\s+to\s+(?<source>.+)$/i;
const ADD_NAMED_TAG_TO_PATTERN = /\badd\s+(?:the\s+)?(?<tag>.+?)\s+tag\s+to\s+(?<source>.+)$/i;

const PATTERNS = [TAG_AS_PATTERN, ADD_TAG_NAMED_TO_PATTERN, ADD_NAMED_TAG_TO_PATTERN];

export const tagAssetsWorkflow = () => ({
  kind: KIND,
  flow: 'hybrid',

  match(prompt) {
    const text = clean(prompt);
    if (!text) {
      return undefined;
    }
    for (const pattern of PATTERNS) {
      const m = pattern.exec(text);
      if (m?.groups?.source && m.groups.tag) {
        const sourceDescription = cleanSource(m.groups.source);
        const tagName = cleanTag(m.groups.tag);
        if (!sourceDescription || !tagName || declinesSourceFastPath(sourceDescription)) {
          return undefined;
        }
        return { slots: { sourceDescription, tagName } };
      }
    }
    return undefined;
  },

  parseSlots(rawSlots) {
    const sourceDescription = cleanSource(rawSlots?.sourceDescription);
    const tagName = cleanTag(rawSlots?.tagName);
    if (!sourceDescription || !tagName) {
      return null;
    }
    return { sourceDescription, tagName };
  },

  async run({ client, slots, signal }) {
    const tagName = cleanTag(slots?.tagName);
    const sourceDescription = clean(slots?.sourceDescription);
    // Defensive: parseSlots requires a tag, but never plan a tagless add.
    if (!tagName) {
      return needsInput({ text: 'What tag would you like to add?' });
    }

    // 1. Resolve the source into a selection handle (shared resolver).
    let resolution;
    try {
      resolution = await resolveAssetSource({ client, sourceDescription, signal });
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

    // 2. Propose a batch tag-add over the selection handle. Exactly one tag field
    //    (tagName); no raw asset ids reach the model.
    let planResult;
    try {
      planResult = await client.call(
        'proposeAssetBatchFromSelection',
        {
          summary: `Tag matching photos with "${tagName}".`,
          action: { type: 'asset.addTag', tagName },
          selectionHandleId,
        },
        { signal },
      );
    } catch (error) {
      return failed({ text: safeFailureText(error?.message ?? 'The planning tool failed.') });
    }

    // 3. Gate on a persisted plan id before any success copy.
    return gatePlanResult({
      planResult,
      planTool: 'proposeAssetBatchFromSelection',
      successText: `I prepared a plan to tag ${assetCount} matching ${assetCount === 1 ? 'photo' : 'photos'} with "${tagName}". Review the plan before applying it.`,
      successSummary: { workflowKind: KIND, assetCount, label: tagName },
    });
  },
});
