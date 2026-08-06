import { SUBJECTIVE_PATTERN, resolveAssetSource } from '../asset-source-resolver.mjs';
import { failed, handoffOpen, needsInput } from '../protocol.mjs';
import { gatePlanResult, safeFailureText } from './plan-gate.mjs';

const KIND = 'visual_cleanup';

const QUALITY_CONFIG = Object.freeze({
  sharpness: Object.freeze({
    filter: Object.freeze({ maxSharpness: 20 }),
    label: 'blurry',
  }),
  brightness: Object.freeze({
    filter: Object.freeze({ maxBrightness: 30 }),
    label: 'dark',
  }),
  quality: Object.freeze({
    filter: Object.freeze({ maxQuality: 40 }),
    label: 'low-quality',
  }),
});

const QUALITY_METRICS = new Set(Object.keys(QUALITY_CONFIG));
const clean = (v) => (typeof v === 'string' ? v.trim() : '');
const cleanSource = (v) => clean(v).replace(/[.?!]+$/u, '').replace(/\s+/gu, ' ').trim();
const isTrashPermissionDenied = (message) => /permission policy does not allow moving assets to trash/i.test(message);
const continuationFor = (qualityMetric) => ({ qualityMetric });

const duplicatePattern = /\b(?:duplicates?|dupes?|dedupe)\b/i;
const cleanupPattern = /\b(?:clean\s*up|cleanup)\s+(?<source>.+)$/i;
const trashPattern = /\b(?:trash|bin|delete)\s+(?<source>.+)$/i;
const removePattern = /\bremove\s+(?<source>.+)$/i;
const moveToTrashPattern =
  /\b(?:move|send|put|throw)\s+(?<source>.+?)\s+(?:in|into|to)\s+(?:the\s+)?(?:trash|bin|recycle\s*bin)\b/i;
const verbPatterns = [moveToTrashPattern, cleanupPattern, trashPattern, removePattern];

const qualityPatterns = [
  { metric: 'sharpness', pattern: /\b(?:blurry|blurred|fuzzy|soft|out[-\s]?of[-\s]?focus)\b/i },
  {
    metric: 'brightness',
    pattern: /\b(?:dark|under[-\s]?exposed|poorly[-\s]?lit|badly[-\s]?lit|poor[-\s]?(?:light|lighting|exposure))\b/i,
  },
  { metric: 'quality', pattern: /\b(?:low[-\s]?quality|poor[-\s]?quality|bad[-\s]?quality)\b/i },
];

const stripQualityWords = (source) =>
  cleanSource(
    source
      .replace(/\b(?:blurry|blurred|fuzzy|soft|out[-\s]?of[-\s]?focus)\b/giu, ' ')
      .replace(
        /\b(?:dark|under[-\s]?exposed|poorly[-\s]?lit|badly[-\s]?lit|poor[-\s]?(?:light|lighting|exposure))\b/giu,
        ' ',
      )
      .replace(/\b(?:low[-\s]?quality|poor[-\s]?quality|bad[-\s]?quality)\b/giu, ' '),
  );

const detectQualityMetric = (text) => {
  for (const { metric, pattern } of qualityPatterns) {
    if (pattern.test(text)) return metric;
  }
  return undefined;
};

const extractSource = (text) => {
  for (const pattern of verbPatterns) {
    const match = pattern.exec(text);
    if (match?.groups?.source) {
      return stripQualityWords(match.groups.source);
    }
  }
  return '';
};

export const visualCleanupWorkflow = () => ({
  kind: KIND,
  flow: 'hybrid',
  match(prompt) {
    const text = clean(prompt);
    if (!text || duplicatePattern.test(text)) return undefined;

    const qualityMetric = detectQualityMetric(text);
    if (!qualityMetric) return undefined;

    const sourceDescription = extractSource(text);
    if (SUBJECTIVE_PATTERN.test(sourceDescription)) return undefined;
    return sourceDescription ? { slots: { qualityMetric, sourceDescription } } : undefined;
  },
  parseSlots(rawSlots) {
    const qualityMetric = clean(rawSlots?.qualityMetric);
    const sourceDescription = cleanSource(rawSlots?.sourceDescription);
    if (!QUALITY_METRICS.has(qualityMetric) || !sourceDescription) return null;
    return { qualityMetric, sourceDescription };
  },
  resumeContinuation({ pending, prompt, nowMs }) {
    const qualityMetric = clean(pending?.qualityMetric);
    const sourceDescription = cleanSource(prompt);
    if (!QUALITY_METRICS.has(qualityMetric)) {
      return { status: 'missing', text: 'I no longer have the pending visual-cleanup request. Please ask again.' };
    }
    if (!sourceDescription) {
      return {
        status: 'needs_input',
        text: 'Which photos should I check? Add a count, date range, album, tag, person, or recent-upload scope.',
      };
    }
    return {
      status: 'matched',
      ctx: {
        slots: { qualityMetric, sourceDescription },
        ...(Number.isFinite(nowMs) ? { now: new Date(nowMs) } : {}),
      },
    };
  },
  async run({ client, slots, signal, now }) {
    const parsed = this.parseSlots(slots);
    if (!parsed) {
      return needsInput({ text: 'Which photos should I check for visual quality, and what kind of quality issue?' });
    }

    const { qualityMetric, sourceDescription } = parsed;
    const config = QUALITY_CONFIG[qualityMetric];

    let resolution;
    try {
      resolution = await resolveAssetSource({
        client,
        sourceDescription,
        signal,
        ...(now ? { now } : {}),
      });
    } catch (error) {
      return failed({ text: safeFailureText(error?.message ?? 'The search tool failed.') });
    }

    if (resolution.status === 'handoff') {
      if (/bound|count|date|scope|could not be resolved|cannot resolve|metadata alone/i.test(resolution.reason ?? '')) {
        return needsInput({
          text: `Which ${config.label} photos should I check? Add a count, date range, album, tag, person, or recent-upload scope.`,
          continuation: continuationFor(qualityMetric),
        });
      }
      return handoffOpen({ reason: resolution.reason });
    }
    if (resolution.status === 'needs_input') return needsInput({ text: resolution.text });
    if (resolution.status === 'empty') {
      return needsInput({
        text: `I could not find any ${config.label} photos matching "${sourceDescription}". The matching photos may not be scored yet, or the scope may need to be broader.`,
      });
    }

    const { selectionHandleId, assetCount: sourceAssetCount } = resolution;
    let qualitySelection;
    try {
      qualitySelection = await client.call(
        'curateSelection',
        {
          selectionHandleId,
          targetCount: sourceAssetCount,
          strategy: 'metadata-highlights',
          constraints: { types: ['IMAGE'], ...config.filter },
          sampleSize: 0,
        },
        { signal },
      );
    } catch (error) {
      return failed({ text: safeFailureText(error?.message ?? 'The quality filtering tool failed.') });
    }

    const qualitySelectionHandleId = clean(qualitySelection?.selectionHandle?.id);
    const assetCount =
      typeof qualitySelection?.selectionHandle?.assetCount === 'number'
        ? qualitySelection.selectionHandle.assetCount
        : undefined;
    if (!qualitySelectionHandleId || typeof assetCount !== 'number' || assetCount === 0) {
      return needsInput({
        text: `I could not find any ${config.label} photos matching "${sourceDescription}". The matching photos may not be scored yet, or the scope may need to be broader.`,
      });
    }

    let planResult;
    try {
      planResult = await client.call(
        'proposeAlbumOperations',
        {
          summary: `Move low-quality matching photos to Trash.`,
          operations: [
            {
              type: 'asset.trash',
              summary: 'Move low-quality matching photos to Trash (recoverable).',
              targetKind: 'asset_batch',
              assetSource: { kind: 'selectionHandle', selectionHandleId: qualitySelectionHandleId },
              riskLevel: 'high',
            },
          ],
        },
        { signal },
      );
    } catch (error) {
      const message = error?.message ?? '';
      if (isTrashPermissionDenied(message)) {
        return needsInput({
          text:
            'This assistant session does not have trash permission. Start or switch to a Visual organizer session, then ask again to move the matching low-quality photos to Trash.',
        });
      }
      return failed({ text: safeFailureText(error?.message ?? 'The planning tool failed.') });
    }

    return gatePlanResult({
      planResult,
      planTool: 'proposeAlbumOperations',
      successText: `I prepared a plan to move ${assetCount} ${config.label} matching ${assetCount === 1 ? 'photo' : 'photos'} to Trash. They can be restored from Trash. Review the plan before applying it.`,
      successSummary: { workflowKind: KIND, assetCount, qualityMetric },
    });
  },
});
