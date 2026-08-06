import { SUBJECTIVE_PATTERN, resolveAssetSource } from '../asset-source-resolver.mjs';
import { failed, handoffOpen, needsInput } from '../protocol.mjs';
import { gatePlanResult, safeFailureText } from './plan-gate.mjs';

const KIND = 'adjust_assets';
const clean = (v) => (typeof v === 'string' ? v.trim() : '');
const cleanSource = (v) => clean(v).replace(/[.?!]+$/u, '').trim();

const INTENSITY_SLIGHT = /\b(?:a\s+touch|slightly|a\s+little|a\s+bit|subtle|subtly|gently|a\s+tad)\b/i;
const INTENSITY_STRONG = /\b(?:a\s+lot|much|way|really|significantly|a\s+ton|heavily|strongly|super)\b/i;
const intensityOf = (text) => (INTENSITY_SLIGHT.test(text) ? 'slight' : INTENSITY_STRONG.test(text) ? 'strong' : 'moderate');

// FILLER = intensity qualifiers + politeness only (NOT adjustment nouns).
const FILLER =
  /\b(?:a\s+touch|slightly|a\s+little|a\s+bit|subtle|subtly|gently|a\s+tad|a\s+lot|much|way|really|significantly|a\s+ton|heavily|strongly|super|please)\b/gi;
const stripFiller = (s) =>
  clean(s)
    .replace(FILLER, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^(?:and|on|to|of|for|in)\b\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();

const LEAD = '(?:can you |could you |would you |please |hey |)';

// Primary patterns: [regex (with <source>), field, direction|null(=autoEnhance)]
const PRIMARY = [
  [new RegExp(`^${LEAD}(?:brighten|lighten)\\s+(?<source>.+)$`, 'i'), 'brightness', 'increase'],
  [new RegExp(`^${LEAD}darken\\s+(?<source>.+)$`, 'i'), 'brightness', 'decrease'],
  [new RegExp(`^${LEAD}(?:auto-?enhance|enhance)\\s+(?<source>.+)$`, 'i'), 'autoEnhance', null],
  [
    new RegExp(
      `^${LEAD}(?:fix|improve|clean\\s+up)\\s+(?:the\\s+)?(?:lighting|exposure)\\s+(?:on|of|for|in)?\\s*(?<source>.+)$`,
      'i',
    ),
    'autoEnhance',
    null,
  ],
  [
    new RegExp(
      `^${LEAD}(?:add|increase|boost|raise|more)\\s+(?:the\\s+)?contrast\\s+(?:on|of|to|for|in)?\\s*(?<source>.+)$`,
      'i',
    ),
    'contrast',
    'increase',
  ],
  [
    new RegExp(
      `^${LEAD}(?:reduce|lower|soften|less)\\s+(?:the\\s+)?contrast\\s+(?:on|of|to|for|in)?\\s*(?<source>.+)$`,
      'i',
    ),
    'contrast',
    'decrease',
  ],
  [new RegExp(`^${LEAD}(?:saturate)\\s+(?<source>.+)$`, 'i'), 'saturation', 'increase'],
  [
    new RegExp(
      `^${LEAD}(?:desaturate|mute)\\s+(?:the\\s+colou?rs?\\s+(?:on|of|in)\\s+)?(?<source>.+)$`,
      'i',
    ),
    'saturation',
    'decrease',
  ],
];

// "make <source> <adjective>"
const MAKE = [
  [new RegExp(`^${LEAD}make\\s+(?<source>.+?)\\s+(?:more\\s+)?(?:vivid|saturated|colou?rful)\\s*$`, 'i'), 'saturation', 'increase'],
  [new RegExp(`^${LEAD}make\\s+(?<source>.+?)\\s+pop\\s*$`, 'i'), 'saturation', 'increase'],
  [new RegExp(`^${LEAD}make\\s+(?<source>.+?)\\s+(?:less\\s+saturated|muted|washed\\s+out)\\s*$`, 'i'), 'saturation', 'decrease'],
  [new RegExp(`^${LEAD}make\\s+(?<source>.+?)\\s+brighter\\s*$`, 'i'), 'brightness', 'increase'],
  [new RegExp(`^${LEAD}make\\s+(?<source>.+?)\\s+darker\\s*$`, 'i'), 'brightness', 'decrease'],
];

// Apply secondary adjustments from a trailing "and <secondary>" clause.
// Returns true on success, false on conflict.
const applySecondary = (params, primaryField, primaryDir, tail) => {
  if (/contrast/i.test(tail)) {
    const sdir = /\b(?:less|reduce|lower|soften)\b/i.test(tail) ? 'decrease' : 'increase';
    if (primaryField === 'contrast' && primaryDir !== sdir) return false;
    params.contrast = `moderate_${sdir}`;
  }
  if (/\b(?:de-?saturate|mute|washed\s*out|less\s+colou?r)\b/i.test(tail)) params.saturation = 'moderate_decrease';
  else if (/\b(?:vivid|pop|saturate[d]?|colou?rful)\b/i.test(tail)) params.saturation = 'moderate_increase';
  if (/\b(?:brighten|lighten|brighter)\b/i.test(tail)) {
    if (primaryField === 'brightness' && primaryDir === 'decrease') return false;
    params.brightness = 'moderate_increase';
  }
  if (/\bdark(?:en|er)\b/i.test(tail)) {
    if (primaryField === 'brightness' && primaryDir === 'increase') return false;
    params.brightness = 'moderate_decrease';
  }
  return true;
};

const tryMatch = (prompt) => {
  for (const [re, field, dir] of PRIMARY) {
    const m = re.exec(prompt);
    if (!m?.groups?.source) continue;
    let src = m.groups.source;
    if (field === 'autoEnhance') {
      return { params: { autoEnhance: true }, sourceDescription: cleanSource(stripFiller(src)) };
    }
    // Split off a trailing "and <secondary>" — source is the part BEFORE "and".
    let tail = '';
    const andMatch = /\s+and\s+/i.exec(src);
    if (andMatch) {
      tail = src.slice(andMatch.index);
      src = src.slice(0, andMatch.index);
    }
    const intensity = intensityOf(src);
    const params = { [field]: `${intensity}_${dir}` };
    if (tail && !applySecondary(params, field, dir, tail)) return { conflict: true };
    return { params, sourceDescription: cleanSource(stripFiller(src)) };
  }
  for (const [re, field, dir] of MAKE) {
    const m = re.exec(prompt);
    if (!m?.groups?.source) continue;
    return {
      params: { [field]: `${intensityOf(prompt)}_${dir}` },
      sourceDescription: cleanSource(stripFiller(m.groups.source)),
    };
  }
  return undefined;
};

export const adjustAssetsWorkflow = () => ({
  kind: KIND,
  flow: 'hybrid',

  match(prompt) {
    const text = clean(prompt);
    if (!text) return undefined;
    // Never steal flip/rotate/crop.
    if (/\b(?:flip|mirror|rotate|turn|spin|crop)\b/i.test(text)) return undefined;
    // Opposite brightness directions in one prompt → ask, don't guess.
    if (/\b(?:brighten|lighten|brighter)\b/i.test(text) && /\b(?:darken|darker)\b/i.test(text)) {
      return { slots: { conflict: true } };
    }
    const matched = tryMatch(text);
    if (!matched) return undefined;
    if (matched.conflict) return { slots: { conflict: true } };
    if (matched.sourceDescription && SUBJECTIVE_PATTERN.test(matched.sourceDescription)) return undefined;
    return { slots: matched };
  },

  parseSlots(rawSlots) {
    if (rawSlots?.conflict) return { conflict: true };
    const sourceDescription = cleanSource(rawSlots?.sourceDescription);
    if (!sourceDescription || !rawSlots?.params) return null;
    return { params: rawSlots.params, sourceDescription };
  },

  async run({ client, slots, signal }) {
    if (slots?.conflict) {
      return needsInput({ text: 'Did you want them brighter or darker? Tell me one adjustment and which photos.' });
    }
    const params = slots?.params;
    const sourceDescription = cleanSource(slots?.sourceDescription);
    if (!params || !sourceDescription) {
      return needsInput({ text: 'Tell me which photos to adjust and how (brighten, more contrast, more vivid, or auto-enhance).' });
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
        text: `I could not find any photos matching "${sourceDescription}" to adjust. Can you describe them differently?`,
      });
    }

    const { selectionHandleId, assetCount } = resolution;
    let planResult;
    try {
      planResult = await client.call(
        'proposeAssetBatchFromSelection',
        { summary: 'Adjust matching photos.', action: { type: 'asset.adjust', ...params }, selectionHandleId },
        { signal },
      );
    } catch (error) {
      return failed({ text: safeFailureText(error?.message ?? 'The planning tool failed.') });
    }

    return gatePlanResult({
      planResult,
      planTool: 'proposeAssetBatchFromSelection',
      successText: `I prepared a plan to adjust ${assetCount} matching ${assetCount === 1 ? 'photo' : 'photos'}. Review the plan before applying it.`,
      successSummary: { workflowKind: KIND, assetCount },
    });
  },
});
