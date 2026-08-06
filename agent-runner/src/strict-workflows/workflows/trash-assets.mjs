import { SUBJECTIVE_PATTERN, resolveAssetSource } from '../asset-source-resolver.mjs';
import { failed, handoffOpen, needsInput } from '../protocol.mjs';
import { gatePlanResult, safeFailureText } from './plan-gate.mjs';

// trash_assets (hybrid): "trash/bin/delete <source>", "move/send/put/throw
// <source> to the trash/bin" → a proposeAlbumOperations asset.trash over a
// resolved selection handle. Trash requires an explicit trash verb — bare
// "remove" belongs to remove_photos_from_album and untag_assets. Album/space-
// level deletion and subjective sources are declined.

const KIND = 'trash_assets';

const clean = (v) => (typeof v === 'string' ? v.trim() : '');
const cleanSource = (v) => clean(v).replace(/[.?!]+$/u, '').trim();

const tripSourcePattern = /\brecent\s+trip\b/i;
// Album/space-level deletion is out of scope (trash operates on assets, not containers).
const containerSourcePattern = /\b(?:album|space)$/i;
// "delete the X tag from Y" is untag territory; "<source> from <album/space>" is remove_photos.
const removalFramePattern = /\btag\s+from\b|\bfrom\s+(?:the\s+)?[\w\s]+\b(?:album|space)\b/i;
const declinesSourceFastPath = (s) =>
  SUBJECTIVE_PATTERN.test(s) || tripSourcePattern.test(s) || containerSourcePattern.test(s);

// trash/bin <source> ; delete <source> ; move/send/put/throw <source> to (the) trash/bin
const TRASH_BIN_PATTERN = /\b(?:trash|bin)\s+(?<source>.+)$/i;
const DELETE_PATTERN = /\bdelete\s+(?<source>.+)$/i;
const MOVE_TO_TRASH_PATTERN =
  /\b(?:move|send|put|throw)\s+(?<source>.+?)\s+(?:in|into|to)\s+(?:the\s+)?(?:trash|bin|recycle\s*bin)\b/i;

const PATTERNS = [MOVE_TO_TRASH_PATTERN, TRASH_BIN_PATTERN, DELETE_PATTERN];

export const trashAssetsWorkflow = () => ({
  kind: KIND,
  flow: 'hybrid',
  match(prompt) {
    const text = clean(prompt);
    if (!text) return undefined;
    for (const pattern of PATTERNS) {
      const m = pattern.exec(text);
      if (m?.groups?.source) {
        const sourceDescription = cleanSource(m.groups.source);
        if (!sourceDescription || declinesSourceFastPath(sourceDescription) || removalFramePattern.test(text)) {
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

    let planResult;
    try {
      planResult = await client.call(
        'proposeAlbumOperations',
        {
          summary: `Move matching photos to Trash.`,
          operations: [
            {
              type: 'asset.trash',
              summary: 'Move matching photos to Trash (recoverable).',
              targetKind: 'asset_batch',
              assetSource: { kind: 'selectionHandle', selectionHandleId },
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
      successText: `I prepared a plan to move ${assetCount} matching ${assetCount === 1 ? 'photo' : 'photos'} to Trash. They can be restored from Trash. Review the plan before applying it.`,
      successSummary: { workflowKind: KIND, assetCount },
    });
  },
});
