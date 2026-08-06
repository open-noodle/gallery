import { SUBJECTIVE_PATTERN, resolveAssetSource } from '../asset-source-resolver.mjs';
import { failed, handoffOpen, needsInput } from '../protocol.mjs';
import { gatePlanResult, safeFailureText } from './plan-gate.mjs';

// untag_assets (hybrid, REMOVE-ONLY): "remove [the] <tag> tag from <source>",
// "remove [the] tag <tag> from <source>", "untag <source> [as|from <tag>]" →
// a proposeAlbumOperations asset.removeTag over a resolved selection. The add
// arm lives in tag_assets; the two never overlap (add has no "remove"/"untag").

const KIND = 'untag_assets';

const clean = (value) => (typeof value === 'string' ? value.trim() : '');
const cleanSource = (value) => clean(value).replace(/[.?!]+$/u, '').trim();
const stripQuotes = (t) => (t.length >= 2 && /^["'"']/.test(t) && /["'"']$/.test(t) ? t.slice(1, -1).trim() : t);
const cleanTag = (value) => stripQuotes(clean(value).replace(/[.?!]+$/u, '').trim());

const tripSourcePattern = /\brecent\s+trip\b/i;
const declinesSourceFastPath = (source) => SUBJECTIVE_PATTERN.test(source) || tripSourcePattern.test(source);

// "remove [the] tag <tag> from <source>"
const REMOVE_TAG_NAMED_FROM = /\bremove\s+(?:the\s+)?tag\s+(?<tag>.+?)\s+from\s+(?<source>.+)$/i;
// "remove [the] <tag> tag from <source>"
const REMOVE_NAMED_TAG_FROM = /\bremove\s+(?:the\s+)?(?<tag>.+?)\s+tag\s+from\s+(?<source>.+)$/i;
// "untag <source> [as|from <tag>]" (tag optional → run asks which tag)
const UNTAG_PATTERN = /\buntag\s+(?<source>.+?)(?:\s+(?:as|from)\s+(?<tag>.+))?$/i;

const PATTERNS = [REMOVE_TAG_NAMED_FROM, REMOVE_NAMED_TAG_FROM, UNTAG_PATTERN];

export const untagAssetsWorkflow = () => ({
  kind: KIND,
  flow: 'hybrid',

  match(prompt) {
    const text = clean(prompt);
    if (!text) return undefined;
    for (const pattern of PATTERNS) {
      const m = pattern.exec(text);
      if (m?.groups?.source) {
        const sourceDescription = cleanSource(m.groups.source);
        const tagName = m.groups.tag ? cleanTag(m.groups.tag) : '';
        if (!sourceDescription || declinesSourceFastPath(sourceDescription)) return undefined;
        return { slots: { sourceDescription, tagName } };
      }
    }
    return undefined;
  },

  parseSlots(rawSlots) {
    const sourceDescription = cleanSource(rawSlots?.sourceDescription);
    const tagName = cleanTag(rawSlots?.tagName);
    if (!sourceDescription) return null;
    return { sourceDescription, tagName }; // tagName may be '' → run asks
  },

  async run({ client, slots, signal }) {
    const sourceDescription = clean(slots?.sourceDescription);
    const tagName = cleanTag(slots?.tagName);
    if (!tagName) {
      return needsInput({ text: 'Which tag should I remove?' });
    }

    // 1. Resolve the source into a selection handle (shared resolver).
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
        text: `I could not find any photos matching "${sourceDescription}". Can you describe them differently?`,
      });
    }
    const { selectionHandleId, assetCount } = resolution;

    // 2. Resolve the tag NAME → tagId (removeTag payload needs a UUID).
    let tagResolution;
    try {
      tagResolution = await client.call('resolveAssetSearchFilters', { tags: [tagName] }, { signal });
    } catch (error) {
      return failed({ text: safeFailureText(error?.message ?? 'The tag lookup failed.') });
    }
    const tagResult = (tagResolution?.results ?? []).find((r) => r?.kind === 'tag');
    if (!tagResult || tagResult.status === 'not_found') {
      return needsInput({ text: `I could not find a tag called "${tagName}". Which tag do you mean?` });
    }
    if (tagResult.status === 'ambiguous') {
      return needsInput({ text: `Multiple tags match "${tagName}". Which one do you mean?` });
    }
    const tagId = clean(tagResult.id);
    if (!tagId) {
      return failed({ text: safeFailureText(`The tag "${tagName}" did not resolve to an id.`) });
    }

    // 3. Propose a reviewable asset.removeTag over the resolved selection.
    let planResult;
    try {
      planResult = await client.call(
        'proposeAlbumOperations',
        {
          summary: `Remove the "${tagName}" tag from matching photos.`,
          operations: [
            {
              type: 'asset.removeTag',
              summary: `Remove the "${tagName}" tag.`,
              targetKind: 'asset_batch',
              assetSource: { kind: 'selectionHandle', selectionHandleId },
              payload: { tagId },
            },
          ],
        },
        { signal },
      );
    } catch (error) {
      return failed({ text: safeFailureText(error?.message ?? 'The planning tool failed.') });
    }

    return gatePlanResult({
      planResult,
      planTool: 'proposeAlbumOperations',
      successText: `I prepared a plan to remove the "${tagName}" tag from ${assetCount} matching ${assetCount === 1 ? 'photo' : 'photos'}. Review the plan before applying it.`,
      successSummary: { workflowKind: KIND, assetCount, label: tagName },
    });
  },
});
