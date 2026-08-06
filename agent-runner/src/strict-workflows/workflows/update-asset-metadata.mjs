import { SUBJECTIVE_PATTERN, parseDateRange, resolveAssetSource } from '../asset-source-resolver.mjs';
import { failed, handoffOpen, needsInput } from '../protocol.mjs';
import { gatePlanResult, safeFailureText } from './plan-gate.mjs';

const KIND = 'update_asset_metadata';

const clean = (value) => (typeof value === 'string' ? value.trim() : '');
const cleanSource = (value) => clean(value).replace(/[.?!]+$/u, '').trim();
const stripQuotes = (value) =>
  clean(value)
    .replace(/^["'""'']+/, '')
    .replace(/["'""'']+$/, '')
    .trim();

const tripSourcePattern = /\brecent\s+trip\b/i;
const LOOSE_ASSET_HINT = /\b(?:photos?|pics?|pictures?|images?|snaps?|shots?|videos?|clips?|these|those)\b/i;
const RECENCY_HINT = /\b(?:newest|latest|last|recent|most\s+recent)\b/i;

// update_asset_metadata edits LOOSE assets — the inverse of rename_or_describe_*'s
// album/space gate. Require a photo/recency reference; decline album/space refs,
// subjective sources, and recent-trip sources.
const declinesTarget = (source) =>
  /\b(?:album|space)\b/i.test(source) || SUBJECTIVE_PATTERN.test(source) || tripSourcePattern.test(source);
const isLooseAssetSource = (source) => {
  const s = clean(source);
  if (!s || declinesTarget(s)) {
    return false;
  }
  return LOOSE_ASSET_HINT.test(s) || RECENCY_HINT.test(s);
};

const WORD_NUMBERS = { one: 1, two: 2, three: 3, four: 4, five: 5 };
const CLEAR_WORDS = new Set(['clear', 'remove', 'delete', 'none', 'reset', 'no']);
const parseRatingValue = (raw) => {
  if (typeof raw === 'number') {
    return Number.isInteger(raw) && raw >= 1 && raw <= 5 ? raw : undefined;
  }
  const text = clean(raw).toLowerCase();
  if (WORD_NUMBERS[text] !== undefined) {
    return WORD_NUMBERS[text];
  }
  const digits = text.match(/\d+/)?.[0];
  if (digits === undefined) {
    return undefined;
  }
  const n = Number(digits);
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : undefined;
};

const NUM = '-?\\d+(?:\\.\\d+)?';
const LOCATION_RE = new RegExp(
  `\\bset\\s+(?:the\\s+location\\s+(?:on|of|for)\\s+)?(?<source>.+?)\\s+to\\s+lat(?:itude)?\\s+(?<lat>${NUM})\\s+and\\s+lon(?:g|gitude)?\\s+(?<lng>${NUM})`,
  'i',
);

// Place-name location: "set [the] (location|place) on <source> to <placeName>"
// where <placeName> does NOT start with "lat" (which would be the numeric form above).
const PLACE_RE =
  /\bset\s+(?:the\s+)?(?:location|place)\s+on\s+(?<source>.+?)\s+to\s+(?<placeName>(?!lat(?:itude)?\s+-?\d)[\w\s,.\-']+?)$/i;

// Each extractor returns { field, ...typed, source } | undefined.
const EXTRACTORS = [
  (p) => {
    const m = /\b(?:clear|remove|delete)\s+(?:the\s+)?(?:description|caption)\s+(?:on|of|for|from)\s+(?<source>.+)$/i.exec(p);
    return m?.groups ? { field: 'description', description: '', source: m.groups.source } : undefined;
  },
  (p) => {
    const m = /\b(?:set|change|update|add|edit|give)\s+(?:the\s+|a\s+|its\s+|it\s+a\s+)?(?:new\s+)?(?:description|caption)\s+(?:on|of|for)\s+(?<source>.+?)\s+to\s+(?<value>.+)$/i.exec(p);
    return m?.groups ? { field: 'description', description: stripQuotes(m.groups.value), source: m.groups.source } : undefined;
  },
  (p) => {
    const m = /\b(?:clear|remove|delete)\s+(?:the\s+)?(?:star\s+)?rating\s+(?:on|of|for|from)\s+(?<source>.+)$/i.exec(p);
    return m?.groups ? { field: 'rating', rating: null, source: m.groups.source } : undefined;
  },
  (p) => {
    const m = /\brate\s+(?<source>.+?)\s+(?<rating>\d+|one|two|three|four|five)(?:\s*(?:out\s+of\s+5|\/\s*5))?\s+stars?\b/i.exec(p);
    if (!m?.groups) return undefined;
    const rating = parseRatingValue(m.groups.rating);
    return rating === undefined ? undefined : { field: 'rating', rating, source: m.groups.source };
  },
  (p) => {
    const m = /\bset\s+(?:the\s+)?(?:star\s+)?rating\s+(?:on|of|for)\s+(?<source>.+?)\s+to\s+(?<rating>\d+|one|two|three|four|five)\b/i.exec(p);
    if (!m?.groups) return undefined;
    const rating = parseRatingValue(m.groups.rating);
    return rating === undefined ? undefined : { field: 'rating', rating, source: m.groups.source };
  },
  (p) => {
    const m = /\bset\s+(?:the\s+)?(?:time\s?zone|tz)\s+(?:on|of|for)\s+(?<source>.+?)\s+to\s+(?<tz>[A-Za-z]+(?:\/[A-Za-z_]+)+)\b/i.exec(p);
    return m?.groups ? { field: 'timeZone', timeZone: clean(m.groups.tz), source: m.groups.source } : undefined;
  },
  (p) => {
    const m = LOCATION_RE.exec(p);
    return m?.groups
      ? { field: 'location', latitude: Number(m.groups.lat), longitude: Number(m.groups.lng), source: m.groups.source }
      : undefined;
  },
  (p) => {
    const m = PLACE_RE.exec(p);
    if (!m?.groups) return undefined;
    const placeName = clean(m.groups.placeName);
    return placeName ? { field: 'location', placeName, source: m.groups.source } : undefined;
  },
  (p) => {
    const m = /\bset\s+(?:the\s+)?(?:date|datetime|date\s*time|timestamp)\s+(?:on|of|for)\s+(?<source>.+?)\s+to\s+(?<date>.+)$/i.exec(p);
    if (!m?.groups) return undefined;
    const range = parseDateRange(m.groups.date);
    return range ? { field: 'date', dateTimeOriginal: range.takenAfter.toISOString(), source: m.groups.source } : undefined;
  },
  (p) => {
    const m = /\b(?:shift|move|adjust)\s+(?<source>.+?)\s+(?<dir>forward|back|backward|ahead|earlier|later)\s+by\s+(?<amt>\d+)\s+(?<unit>hours?|hrs?|minutes?|mins?)\b/i.exec(p);
    if (!m?.groups) return undefined;
    const amount = Number(m.groups.amt);
    const minutes = /^h/i.test(m.groups.unit) ? amount * 60 : amount;
    const sign = /back|backward|earlier/i.test(m.groups.dir) ? -1 : 1;
    return { field: 'date', dateTimeRelative: sign * minutes, source: m.groups.source };
  },
];

const tryMatch = (prompt) => {
  for (const extractor of EXTRACTORS) {
    const result = extractor(prompt);
    if (!result) {
      continue;
    }
    const source = cleanSource(result.source);
    if (!isLooseAssetSource(source)) {
      continue; // album/space/subjective/trip → let rename_* / open handling own it
    }
    const { source: _ignored, ...rest } = result;
    return { ...rest, sourceDescription: source };
  }
  return undefined;
};

const buildPayload = (rawSlots) => {
  if (!rawSlots || typeof rawSlots !== 'object') {
    return null;
  }
  if (rawSlots.description !== undefined) {
    return { description: stripQuotes(rawSlots.description) }; // '' is valid (clear)
  }
  if (rawSlots.rating !== undefined) {
    if (rawSlots.rating === null) {
      return { rating: null };
    }
    const rating = parseRatingValue(rawSlots.rating);
    return rating === undefined ? null : { rating };
  }
  if (rawSlots.timeZone !== undefined || rawSlots.timezone !== undefined) {
    const tz = clean(rawSlots.timeZone ?? rawSlots.timezone);
    return tz ? { timeZone: tz } : null;
  }
  if (rawSlots.latitude !== undefined || rawSlots.longitude !== undefined) {
    const lat = Number(rawSlots.latitude);
    const lng = Number(rawSlots.longitude);
    return Number.isFinite(lat) && Number.isFinite(lng) ? { latitude: lat, longitude: lng } : null;
  }
  if (rawSlots.dateTimeOriginal !== undefined) {
    const iso = clean(rawSlots.dateTimeOriginal);
    return iso ? { dateTimeOriginal: iso } : null;
  }
  if (rawSlots.dateTimeRelative !== undefined) {
    const n = Number(rawSlots.dateTimeRelative);
    return Number.isInteger(n) ? { dateTimeRelative: n } : null;
  }
  const field = clean(rawSlots.field).toLowerCase();
  if (!field) {
    return null;
  }
  const value = rawSlots.value;
  if (field === 'description' || field === 'caption') {
    if (CLEAR_WORDS.has(clean(value).toLowerCase())) {
      return { description: '' };
    }
    return { description: stripQuotes(value) };
  }
  if (field === 'rating') {
    if (value === null || CLEAR_WORDS.has(clean(value).toLowerCase())) {
      return { rating: null };
    }
    const rating = parseRatingValue(value);
    return rating === undefined ? null : { rating };
  }
  if (field === 'timezone') {
    const tz = clean(value);
    return tz ? { timeZone: tz } : null;
  }
  if (field === 'location') {
    const lat = Number(rawSlots.latitude);
    const lng = Number(rawSlots.longitude);
    return Number.isFinite(lat) && Number.isFinite(lng) ? { latitude: lat, longitude: lng } : null;
  }
  if (field === 'date') {
    const range = parseDateRange(clean(value));
    return range ? { dateTimeOriginal: range.takenAfter.toISOString() } : null;
  }
  return null;
};

// Field-specific before/after framing for the success copy + the plan summary target.
const describeChange = (payload, assetCount) => {
  const noun = assetCount === 1 ? 'photo' : 'photos';
  const scope = `${assetCount} ${noun}`;
  if (payload.description !== undefined) {
    return payload.description === ''
      ? { text: `clear the description on ${scope}`, target: 'description' }
      : { text: `set the description on ${scope} to "${payload.description}"`, target: 'description' };
  }
  if (payload.rating !== undefined) {
    return payload.rating === null
      ? { text: `clear the rating on ${scope}`, target: 'rating' }
      : { text: `set the rating on ${scope} to ${payload.rating} star${payload.rating === 1 ? '' : 's'}`, target: 'rating' };
  }
  if (payload.timeZone !== undefined) {
    return { text: `set the timezone on ${scope} to ${payload.timeZone}`, target: 'timezone' };
  }
  if (payload.latitude !== undefined) {
    return { text: `set the location on ${scope} to ${payload.latitude}, ${payload.longitude}`, target: 'location' };
  }
  if (payload.dateTimeOriginal !== undefined) {
    return { text: `set the date on ${scope} to ${payload.dateTimeOriginal}`, target: 'date' };
  }
  if (payload.dateTimeRelative !== undefined) {
    return { text: `shift the date on ${scope} by ${payload.dateTimeRelative} minutes`, target: 'date' };
  }
  return { text: `update metadata on ${scope}`, target: 'metadata' };
};

export const updateAssetMetadataWorkflow = () => ({
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
    // Place-name path: field='location' + placeName present but no numeric coords.
    const placeName = clean(rawSlots?.placeName);
    if (placeName && rawSlots?.latitude === undefined && rawSlots?.longitude === undefined) {
      return { sourceDescription, placeName, payload: {} };
    }
    const payload = buildPayload(rawSlots);
    return payload ? { sourceDescription, payload } : null;
  },

  async run({ client, slots, signal }) {
    const sourceDescription = clean(slots?.sourceDescription);
    const placeName = clean(slots?.placeName);
    let payload = slots?.payload && typeof slots.payload === 'object' ? { ...slots.payload } : null;

    // Place-name path: resolve via resolveLocation when placeName is present and no explicit coords.
    if (placeName && payload?.latitude === undefined && payload?.longitude === undefined) {
      if (!sourceDescription) {
        return needsInput({ text: 'Tell me which photos to update and what to change.' });
      }
      let locationResult;
      try {
        const locationResponse = await client.call('resolveLocation', { query: placeName }, { signal });
        locationResult = locationResponse?.location;
      } catch (error) {
        return failed({ text: safeFailureText(error?.message ?? 'The location lookup failed.') });
      }
      if (!locationResult || locationResult.status === 'not_found') {
        return needsInput({
          text: `I could not find a place called "${placeName}". Try a more specific name or provide explicit coordinates (latitude and longitude).`,
        });
      }
      if (locationResult.status === 'ambiguous') {
        const choiceList = (locationResult.choices ?? []).map((c) => `• ${c.label}`).join('\n');
        return needsInput({
          text: `"${placeName}" is ambiguous. Which location do you mean?\n${choiceList}`,
        });
      }
      // Matched: inject resolved lat/lng into payload.
      payload = { latitude: locationResult.latitude, longitude: locationResult.longitude };
    }

    if (!sourceDescription || !payload || Object.keys(payload).length === 0) {
      return needsInput({ text: 'Tell me which photos to update and what to change.' });
    }
    // Defensive half-coordinate / place-name guard (parseSlots already prevents it).
    if ((payload.latitude !== undefined) !== (payload.longitude !== undefined)) {
      return needsInput({ text: 'I need both a latitude and a longitude to set a location.' });
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
        text: `I could not find any photos matching "${sourceDescription}". Can you describe them differently?`,
      });
    }
    const { selectionHandleId, assetCount } = resolution;

    const change = describeChange(payload, assetCount);
    let planResult;
    try {
      planResult = await client.call(
        'proposeAssetBatchFromSelection',
        {
          summary: `Update photo ${change.target}.`,
          action: { type: 'asset.updateMetadata', ...payload },
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
      successText: `I prepared a plan to ${change.text}. Review the plan before applying it.`,
      successSummary: { workflowKind: KIND, assetCount, target: change.target },
    });
  },
});
