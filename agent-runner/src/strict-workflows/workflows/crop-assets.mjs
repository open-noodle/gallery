import { SUBJECTIVE_PATTERN, resolveAssetSource } from '../asset-source-resolver.mjs';
import { failed, handoffOpen, needsInput } from '../protocol.mjs';
import { gatePlanResult, safeFailureText } from './plan-gate.mjs';

const KIND = 'crop_assets';

const clean = (value) => (typeof value === 'string' ? value.trim() : '');
const cleanSource = (value) => clean(value).replace(/[.?!]+$/u, '').trim();

const tripSourcePattern = /\brecent\s+trip\b/i;
const declinesSource = (source) => SUBJECTIVE_PATTERN.test(source) || tripSourcePattern.test(source);

// Parse comma-form: "100,100,800,600" → {x,y,width,height}
const COMMA_GEOMETRY_RE = /\b(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\b/;

// Parse labeled-form: x=N y=N w=N h=N (or width=/height=)
const LABELED_GEOMETRY_RE =
  /\bx\s*=\s*(\d+)\s+y\s*=\s*(\d+)\s+(?:w|width)\s*=\s*(\d+)\s+(?:h|height)\s*=\s*(\d+)\b/i;

// Must contain the verb "crop" (not rotate/flip/spin)
const CROP_VERB_RE = /\bcrop\b/i;

const parseGeometry = (text) => {
  const labeled = LABELED_GEOMETRY_RE.exec(text);
  if (labeled) {
    return { x: Number(labeled[1]), y: Number(labeled[2]), width: Number(labeled[3]), height: Number(labeled[4]) };
  }
  const comma = COMMA_GEOMETRY_RE.exec(text);
  if (comma) {
    return { x: Number(comma[1]), y: Number(comma[2]), width: Number(comma[3]), height: Number(comma[4]) };
  }
  return undefined;
};

// Extract source description: text before "to <geometry>" or before x=/y= block.
const extractSourceDescription = (text) => {
  // Remove labeled geometry block + everything after
  let source = text.replace(LABELED_GEOMETRY_RE, '').trim();
  if (source !== text.trim()) {
    // Strip trailing "to" if left over
    source = source.replace(/\s+to\s*$/i, '').trim();
    source = clean(source).replace(/^crop\s+/i, '').trim();
    return cleanSource(source) || undefined;
  }
  // Comma geometry: match "crop <source> to N,N,N,N"
  const commaMatch = /^crop\s+(.+?)\s+to\s+\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*\d+/i.exec(text);
  if (commaMatch) {
    return cleanSource(commaMatch[1]) || undefined;
  }
  // Fallback: text after "crop " with geometry stripped
  const noGeom = text.replace(COMMA_GEOMETRY_RE, '').replace(/\bto\s*$/i, '').trim();
  const stripped = clean(noGeom).replace(/^crop\s+/i, '').trim();
  return cleanSource(stripped) || undefined;
};

const tryMatch = (prompt) => {
  if (!CROP_VERB_RE.test(prompt)) {
    return undefined;
  }
  const geometry = parseGeometry(prompt);
  if (!geometry) {
    return undefined;
  }
  const sourceDescription = extractSourceDescription(prompt);
  if (!sourceDescription || declinesSource(sourceDescription)) {
    return undefined;
  }
  return { ...geometry, sourceDescription };
};

const coerceInt = (raw) => {
  if (typeof raw === 'number') return raw;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
};

const isValidGeometry = (x, y, width, height) =>
  typeof x === 'number' && x >= 0 &&
  typeof y === 'number' && y >= 0 &&
  typeof width === 'number' && width >= 1 &&
  typeof height === 'number' && height >= 1;

export const cropAssetsWorkflow = () => ({
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
    const x = coerceInt(rawSlots?.x);
    const y = coerceInt(rawSlots?.y);
    const width = coerceInt(rawSlots?.width);
    const height = coerceInt(rawSlots?.height);
    if (!isValidGeometry(x, y, width, height)) {
      return null;
    }
    return { x, y, width, height, sourceDescription };
  },

  async run({ client, slots, signal }) {
    const x = coerceInt(slots?.x);
    const y = coerceInt(slots?.y);
    const width = coerceInt(slots?.width);
    const height = coerceInt(slots?.height);
    const sourceDescription = cleanSource(slots?.sourceDescription);

    if (!isValidGeometry(x, y, width, height)) {
      return needsInput({ text: 'Please provide the crop geometry: x, y, width, and height (e.g. "crop to x=0 y=0 width=800 height=600").' });
    }
    if (!sourceDescription) {
      return needsInput({ text: 'Which photo should I crop? Please describe the photo.' });
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
        text: `I could not find any photos matching "${sourceDescription}" to crop. Can you describe them differently?`,
      });
    }
    const { selectionHandleId, assetCount } = resolution;

    let planResult;
    try {
      planResult = await client.call(
        'proposeAssetBatchFromSelection',
        {
          summary: `Crop matching photos to x=${x} y=${y} width=${width} height=${height}.`,
          action: { type: 'asset.crop', x, y, width, height },
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
      successText: `I prepared a plan to crop ${assetCount} matching ${assetCount === 1 ? 'photo' : 'photos'} to the specified dimensions. Review the plan before applying it.`,
      successSummary: { workflowKind: KIND, assetCount, x, y, width, height },
    });
  },
});
