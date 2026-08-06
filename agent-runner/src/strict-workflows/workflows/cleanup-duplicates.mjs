import { failed, handoffOpen } from '../protocol.mjs';
import { gatePlanResult, safeFailureText } from './plan-gate.mjs';

// cleanup_duplicates (hybrid): reads listDuplicateGroups, picks ONE keeper per
// group by a deterministic rule (favorite > higher rating > larger resolution >
// older fileCreatedAt > lexicographic id), and proposes ONE reversible,
// High-risk asset.trash over the explicit non-keeper assetIds.
//
// Must require the "duplicate(s)/dupe(s)" keyword so trash_assets/others don't
// own it. This workflow is registered BEFORE trash_assets so "trash duplicates"
// routes here, not to the generic trash workflow.

const KIND = 'cleanup_duplicates';

const clean = (v) => (typeof v === 'string' ? v.trim() : '');

const PATTERNS = [
  // "clean up/remove/delete/trash/find/get rid of/merge … duplicate(s)/dupe(s)"
  /\b(?:clean\s*up|remove|delete|trash|find|get\s+rid\s+of|merge)\b[^]*\bdup(?:licate|e)s?\b/i,
  // "duplicate(s)/dupe(s) … cleanup/removal"
  /\bdup(?:licate|e)s?\b[^]*\b(?:clean\s*up|cleanup|removal)\b/i,
  // standalone dedupe/deduplicate verb (implies duplicates in context)
  /\bdedupe\b|\bdeduplicate\b/i,
];

/**
 * Deterministic keeper selection: favorite > higher rating > higher sharpness
 * > larger resolution > older fileCreatedAt (keep the original) > lexicographic id.
 * Sharpness (from the quality scorer) is nullable; a null/absent score sorts
 * lowest, so duplicate groups without quality scores keep their prior behavior.
 * @param {Array} assets
 * @returns {{ keeper: object, nonKeepers: object[] }}
 */
export const pickKeeper = (assets) => {
  const score = (a) => [
    a.isFavorite ? 1 : 0,
    typeof a.rating === 'number' ? a.rating : -1,
    typeof a.sharpness === 'number' ? a.sharpness : -1,
    (a.width ?? 0) * (a.height ?? 0),
  ];
  const sorted = [...assets].sort((a, b) => {
    const [fa, ra, sha, sa] = score(a);
    const [fb, rb, shb, sb] = score(b);
    if (fa !== fb) return fb - fa; // favorite first
    if (ra !== rb) return rb - ra; // higher rating
    if (sha !== shb) return shb - sha; // sharper first
    if (sa !== sb) return sb - sa; // larger resolution
    const ta = Date.parse(a.fileCreatedAt) || 0;
    const tb = Date.parse(b.fileCreatedAt) || 0;
    if (ta !== tb) return ta - tb; // older first (keep the original)
    return String(a.id).localeCompare(String(b.id));
  });
  return { keeper: sorted[0], nonKeepers: sorted.slice(1) };
};

export const cleanupDuplicatesWorkflow = () => ({
  kind: KIND,
  flow: 'hybrid',
  match(prompt) {
    const text = clean(prompt);
    if (!text) return undefined;
    return PATTERNS.some((p) => p.test(text)) ? { slots: {} } : undefined;
  },
  parseSlots() {
    return {}; // no slots; the duplicate set is read from the tool
  },
  async run({ client, signal }) {
    let result;
    try {
      result = await client.call('listDuplicateGroups', {}, { signal });
    } catch (error) {
      return failed({ text: safeFailureText(error?.message ?? 'The duplicate lookup failed.') });
    }
    const groups = Array.isArray(result?.groups) ? result.groups : [];
    if (groups.length === 0) {
      return handoffOpen({ reason: 'No duplicate groups were found to clean up.' });
    }
    const nonKeeperIds = [];
    for (const group of groups) {
      const assets = Array.isArray(group?.assets) ? group.assets : [];
      if (assets.length < 2) continue;
      const { nonKeepers } = pickKeeper(assets);
      for (const a of nonKeepers) if (a?.id) nonKeeperIds.push(a.id);
    }
    if (nonKeeperIds.length === 0) {
      return handoffOpen({ reason: 'Every duplicate group has only one keeper; nothing to trash.' });
    }

    let planResult;
    try {
      planResult = await client.call(
        'proposeAlbumOperations',
        {
          summary: `Trash ${nonKeeperIds.length} duplicate photos, keeping the best of each group.`,
          operations: [
            {
              type: 'asset.trash',
              summary: 'Move duplicate photos to Trash (recoverable), keeping one per group.',
              targetKind: 'asset_batch',
              assetIds: nonKeeperIds,
              riskLevel: 'high',
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
      successText: `I found ${groups.length} duplicate ${groups.length === 1 ? 'group' : 'groups'} and prepared a plan to move ${nonKeeperIds.length} duplicate ${nonKeeperIds.length === 1 ? 'photo' : 'photos'} to Trash — keeping the favorite / highest-rated / largest of each group. They can be restored from Trash. Review the plan before applying it.`,
      successSummary: { workflowKind: KIND, groupCount: groups.length, trashCount: nonKeeperIds.length },
    });
  },
});
