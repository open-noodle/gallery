import { SUBJECTIVE_PATTERN, resolveAssetSource } from '../asset-source-resolver.mjs';
import { failed, handoffOpen, needsInput } from '../protocol.mjs';
import { gatePlanResult, safeFailureText } from './plan-gate.mjs';

const KIND = 'rotate_assets';

const clean = (value) => (typeof value === 'string' ? value.trim() : '');
const cleanSource = (value) => clean(value).replace(/[.?!]+$/u, '').trim();

const tripSourcePattern = /\brecent\s+trip\b/i;
const declinesSource = (source) => SUBJECTIVE_PATTERN.test(source) || tripSourcePattern.test(source);

const ANGLES = new Set([90, 180, 270]);
const isCcw = (dir) => (dir ? /counter|anti|ccw|left/i.test(dir) : false);
const normalizeAngle = (n, ccw) => {
  if (!ANGLES.has(n)) {
    return undefined;
  }
  if (n === 180) {
    return 180;
  }
  const effective = (((ccw ? -n : n) % 360) + 360) % 360;
  return ANGLES.has(effective) ? effective : undefined;
};

const ROTATE_PATTERN =
  /\b(?:rotate|turn|spin)\s+(?<source>.+?)\s+(?<angle>\d{1,3})\s*(?:°|degrees?)?\s*(?<dir>clockwise|counter-?clockwise|anti-?clockwise|cw|ccw)?\s*$/i;
const FLIP_PATTERN = /\b(?:flip|rotate|turn)\s+(?<source>.+?)\s+upside\s*down\s*$/i;

const tryMatch = (prompt) => {
  let source;
  let angle;
  const rotate = ROTATE_PATTERN.exec(prompt);
  if (rotate?.groups) {
    angle = normalizeAngle(Number(rotate.groups.angle), isCcw(rotate.groups.dir));
    source = rotate.groups.source;
  } else {
    const flip = FLIP_PATTERN.exec(prompt);
    if (flip?.groups) {
      angle = 180;
      source = flip.groups.source;
    }
  }
  if (angle === undefined || source === undefined) {
    return undefined;
  }
  const sourceDescription = cleanSource(source);
  if (!sourceDescription || declinesSource(sourceDescription)) {
    return undefined;
  }
  return { angle, sourceDescription };
};

const coerceAngle = (raw) => {
  if (typeof raw === 'number') {
    return raw;
  }
  const text = clean(raw).toLowerCase();
  if (/^\d+$/.test(text)) {
    return Number(text);
  }
  if (/counter|anti|ccw/.test(text)) {
    return 270;
  }
  if (/clockwise|cw/.test(text)) {
    return 90;
  }
  if (/upside|flip|180/.test(text)) {
    return 180;
  }
  return Number(text);
};

export const rotateAssetsWorkflow = () => ({
  kind: KIND,
  flow: 'hybrid',

  match(prompt) {
    const text = clean(prompt);
    if (!text) {
      return undefined;
    }
    const matched = tryMatch(text);
    return matched ? { slots: matched } : undefined;
  },

  parseSlots(rawSlots) {
    const sourceDescription = cleanSource(rawSlots?.sourceDescription);
    if (!sourceDescription) {
      return null;
    }
    const angle = coerceAngle(rawSlots?.angle);
    if (!ANGLES.has(angle)) {
      return null;
    }
    return { angle, sourceDescription };
  },

  async run({ client, slots, signal }) {
    const angle = slots?.angle;
    const sourceDescription = cleanSource(slots?.sourceDescription);
    if (!ANGLES.has(angle) || !sourceDescription) {
      return needsInput({ text: 'Tell me which photos to rotate and by 90, 180, or 270 degrees.' });
    }

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
        text: `I could not find any photos matching "${sourceDescription}" to rotate. Can you describe them differently?`,
      });
    }
    const { selectionHandleId, assetCount } = resolution;

    let planResult;
    try {
      planResult = await client.call(
        'proposeAssetBatchFromSelection',
        {
          summary: `Rotate matching photos ${angle} degrees.`,
          action: { type: 'asset.rotate', angle },
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
      successText: `I prepared a plan to rotate ${assetCount} matching ${assetCount === 1 ? 'photo' : 'photos'} ${angle} degrees. Review the plan before applying it.`,
      successSummary: { workflowKind: KIND, assetCount, angle },
    });
  },
});
