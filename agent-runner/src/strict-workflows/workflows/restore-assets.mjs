import { SUBJECTIVE_PATTERN, resolveAssetSource } from '../asset-source-resolver.mjs';
import { failed, handoffOpen, needsInput } from '../protocol.mjs';
import { gatePlanResult, safeFailureText } from './plan-gate.mjs';

// restore_assets (hybrid): "restore/recover/untrash/bring back <source> from
// trash" → a proposeAlbumOperations asset.restore over a trashed-asset
// selection handle. The source is ALWAYS resolved with isTrashed:true injected
// so only trashed assets are matched, even when the user omits "from trash".
// Album/space-level restores and subjective sources are declined.

const KIND = 'restore_assets';

const clean = (v) => (typeof v === 'string' ? v.trim() : '');
const cleanSource = (v) => clean(v).replace(/[.?!]+$/u, '').trim();

// Subjective or container sources decline immediately (they would hand off
// inside the resolver anyway, but declining early keeps the match contract clean).
const containerSourcePattern = /\b(?:album|space)$/i;
const declinesSourceFastPath = (s) => SUBJECTIVE_PATTERN.test(s) || containerSourcePattern.test(s);

// Core restore verbs + source capture patterns:
//
//   restore <source>
//   recover <source>
//   untrash <source>
//   get/bring <source> back (from the trash)
//
// "from the trash" / "from trash" is a trailing connector that gets stripped
// from the captured source (it is injected as isTrashed:true instead).
const TRASH_CONNECTOR = /\s+(?:from\s+(?:the\s+)?(?:trash|bin|recycle\s*bin))\s*$/i;

const RESTORE_PATTERN = /\brestore\s+(?<source>.+)$/i;
const RECOVER_PATTERN = /\brecover\s+(?<source>.+)$/i;
const UNTRASH_PATTERN = /\buntrash\s+(?<source>.+)$/i;
// "get/bring <source> back" or "bring back <source>" — must contain "back" to
// distinguish from plain "get/bring <source>" which is not a restore intent.
const GET_BACK_PATTERN = /\b(?:get|bring)\s+(?:back\s+)?(?<source>.+?)\s*(?:\s+back\b|$)/i;

const PATTERNS = [RESTORE_PATTERN, RECOVER_PATTERN, UNTRASH_PATTERN, GET_BACK_PATTERN];

export const restoreAssetsWorkflow = () => ({
  kind: KIND,
  flow: 'hybrid',
  match(prompt) {
    const text = clean(prompt);
    if (!text) return undefined;
    for (const pattern of PATTERNS) {
      const m = pattern.exec(text);
      if (m?.groups?.source) {
        // Strip the trailing "from the trash" connector so it does not leak
        // into the source description (isTrashed:true is injected at run time).
        const rawSource = m.groups.source.replace(TRASH_CONNECTOR, '').trim();
        const sourceDescription = cleanSource(rawSource);
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
    return sourceDescription ? { sourceDescription } : null;
  },
  async run({ client, slots, signal }) {
    const sourceDescription = clean(slots?.sourceDescription);
    let resolution;
    try {
      // Always inject isTrashed:true so only trashed assets are included,
      // regardless of whether the user said "from trash" explicitly.
      resolution = await resolveAssetSource({
        client,
        sourceDescription,
        signal,
        extraFilters: { isTrashed: true },
      });
    } catch (error) {
      return failed({ text: safeFailureText(error?.message ?? 'The search tool failed.') });
    }
    if (resolution.status === 'handoff') return handoffOpen({ reason: resolution.reason });
    if (resolution.status === 'needs_input') return needsInput({ text: resolution.text });
    if (resolution.status === 'empty') {
      return needsInput({
        text: `I could not find any trashed photos matching "${sourceDescription}". Can you describe them differently?`,
      });
    }
    const { selectionHandleId, assetCount } = resolution;

    let planResult;
    try {
      planResult = await client.call(
        'proposeAlbumOperations',
        {
          summary: `Restore matching photos from Trash.`,
          operations: [
            {
              type: 'asset.restore',
              summary: 'Restore matching photos from Trash (move back to library).',
              targetKind: 'asset_batch',
              assetSource: { kind: 'selectionHandle', selectionHandleId },
              riskLevel: 'low',
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
      successText: `I prepared a plan to restore ${assetCount} matching ${assetCount === 1 ? 'photo' : 'photos'} from Trash back to your library. Review the plan before applying it.`,
      successSummary: { workflowKind: KIND, assetCount },
    });
  },
});
