import { SUBJECTIVE_PATTERN, resolveAssetSource } from '../asset-source-resolver.mjs';
import { failed, handoffOpen, needsInput } from '../protocol.mjs';
import { gatePlanResult, safeFailureText } from './plan-gate.mjs';

// favorite_assets (hybrid): "favorite/unfavorite <source>" → a batch
// asset.setFavorite over a resolved selection handle. This module is the router
// half (match + parseSlots); execution and registration land in later slices.

const KIND = 'favorite_assets';

const clean = (value) => (typeof value === 'string' ? value.trim() : '');
const cleanSource = (value) => clean(value).replace(/[.?!]+$/u, '').trim();

// Polarity from a boolean (regex/JSON LLM slot) or a string.
const coerceFavorite = (value) => {
  if (typeof value === 'boolean') {
    return value;
  }
  const text = clean(value).toLowerCase();
  if (['true', 'favorite', 'favourite', 'favorited', 'fave', 'like', 'liked', 'yes'].includes(text)) {
    return true;
  }
  if (['false', 'unfavorite', 'unfavourite', 'unfave', 'unlike', 'disliked', 'no'].includes(text)) {
    return false;
  }
  return undefined;
};

const tripSourcePattern = /\brecent\s+trip\b/i;
const declinesSourceFastPath = (source) => SUBJECTIVE_PATTERN.test(source) || tripSourcePattern.test(source);

// `\bfavou?rite` has no boundary inside "unfavorite" (n→f), so FAVORITE never
// matches an unfavorite prompt; the false-polarity patterns are tried first
// anyway. "like"/"unlike" are anchored to the start so a mid-sentence "like"
// ("photos like these") is not coerced into a favorite.
const UNFAVORITE_PATTERN = /\bun-?favou?rite\s+(?<source>.+)$/i;
const REMOVE_FAV_FROM_PATTERN =
  /\bremove\s+(?:the\s+)?(?:favou?rite|fave)\s+(?:status\s+)?(?:from|on|of)\s+(?<source>.+)$/i;
const OUT_OF_FAVS_PATTERN = /\bremove\s+(?<source>.+?)\s+from\s+(?:my\s+)?favou?rites\b/i;
const UNLIKE_PATTERN = /^\s*(?:please\s+)?unlike\s+(?<source>.+)$/i;
// "add <source> to [my] favorites" is a favorite intent, not an album add — but
// only when "favorites" is the end of the phrase (so "… to my Favorites album"
// stays an album add owned by add_photos_to_album).
const ADD_TO_FAVS_PATTERN = /\badd\s+(?<source>.+?)\s+to\s+(?:my\s+)?favou?rites\b\s*[.?!]*$/i;
const FAVORITE_PATTERN = /\bfavou?rite\s+(?<source>.+)$/i;
const LIKE_PATTERN = /^\s*(?:please\s+)?like\s+(?<source>.+)$/i;

const POLARITY_PATTERNS = [
  [UNFAVORITE_PATTERN, false],
  [REMOVE_FAV_FROM_PATTERN, false],
  [OUT_OF_FAVS_PATTERN, false],
  [UNLIKE_PATTERN, false],
  [ADD_TO_FAVS_PATTERN, true],
  [FAVORITE_PATTERN, true],
  [LIKE_PATTERN, true],
];

export const favoriteAssetsWorkflow = () => ({
  kind: KIND,
  flow: 'hybrid',

  match(prompt) {
    const text = clean(prompt);
    if (!text) {
      return undefined;
    }
    for (const [pattern, favorite] of POLARITY_PATTERNS) {
      const m = pattern.exec(text);
      if (m?.groups?.source) {
        const sourceDescription = cleanSource(m.groups.source);
        if (!sourceDescription || declinesSourceFastPath(sourceDescription)) {
          return undefined;
        }
        return { slots: { favorite, sourceDescription } };
      }
    }
    return undefined;
  },

  parseSlots(rawSlots) {
    const sourceDescription = cleanSource(rawSlots?.sourceDescription);
    if (!sourceDescription) {
      return null;
    }
    // Default to favorite when polarity is omitted (the workflow's primary action).
    const favorite = coerceFavorite(rawSlots?.favorite) ?? true;
    return { favorite, sourceDescription };
  },

  async run({ client, slots, signal }) {
    const favorite = Boolean(slots?.favorite);
    const sourceDescription = clean(slots?.sourceDescription);

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

    // 2. Propose a batch favorite over the selection handle (no raw asset ids).
    let planResult;
    try {
      planResult = await client.call(
        'proposeAssetBatchFromSelection',
        {
          summary: favorite ? 'Favorite matching photos.' : 'Unfavorite matching photos.',
          action: { type: 'asset.setFavorite', favorite },
          selectionHandleId,
        },
        { signal },
      );
    } catch (error) {
      return failed({ text: safeFailureText(error?.message ?? 'The planning tool failed.') });
    }

    // 3. Gate on a persisted plan id before any success copy.
    const verb = favorite ? 'favorite' : 'unfavorite';
    return gatePlanResult({
      planResult,
      planTool: 'proposeAssetBatchFromSelection',
      successText: `I prepared a plan to ${verb} ${assetCount} matching ${assetCount === 1 ? 'photo' : 'photos'}. Review the plan before applying it.`,
      successSummary: { workflowKind: KIND, assetCount, target: verb },
    });
  },
});
