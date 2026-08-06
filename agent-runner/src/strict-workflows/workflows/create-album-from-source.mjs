import { SUBJECTIVE_PATTERN, resolveAssetSource } from '../asset-source-resolver.mjs';
import { failed, handoffOpen, needsInput } from '../protocol.mjs';
import { gatePlanResult, safeFailureText } from './plan-gate.mjs';

// create_album_from_source (hybrid): "make/create an album of/from <source>
// [called <name>]" — the generic album-create the trip workflow does not cover.
// Declines a "recent trip" source (owned by create_recent_trip_album) and a
// subjective source; "add … to <album>" never matches (no make-album verb). This
// module is the router half; execution + registration land in later slices.

const KIND = 'create_album_from_source';
const DEFAULT_NAME = 'New Album';

const clean = (value) => (typeof value === 'string' ? value.trim() : '');
const cleanSource = (value) => clean(value).replace(/[.?!]+$/u, '').trim();

const stripQuotes = (t) => (t.length >= 2 && /^["'“‘]/.test(t) && /["'”’]$/.test(t) ? t.slice(1, -1).trim() : t);
const cleanName = (value) => stripQuotes(clean(value).replace(/[.?!]+$/u, '').trim());

// Trip-like sources overlap create_recent_trip_album. Decline them at the
// fast-path so "build an album out of my weekend in Lisbon" / "my trip to
// Portugal" / "our recent road trip" fall through to the LLM → trip workflow.
const TRIP_LIKE =
  /\b(?:trips?|vacations?|holidays?|getaways?|honeymoons?|cruises?|safaris?|road\s*trips?|weekend\s+(?:in|at|away|getaway))\b/i;
const declinesSource = (source) => SUBJECTIVE_PATTERN.test(source) || TRIP_LIKE.test(source);

const CREATE_PATTERN =
  /\b(?:make|create|build|put\s+together|assemble|generate)\s+(?:me\s+)?(?:an?\s+|a\s+new\s+|another\s+)?album\s+(?:of|from|out\s+of|with|containing|for)\s+(?<source>.+?)(?:\s+(?:called|named|titled|with\s+the\s+(?:name|title))\s+(?<name>.+))?$/i;

export const createAlbumFromSourceWorkflow = () => ({
  kind: KIND,
  flow: 'hybrid',

  match(prompt) {
    const text = clean(prompt);
    if (!text) {
      return undefined;
    }
    const m = CREATE_PATTERN.exec(text);
    if (!m?.groups) {
      return undefined;
    }
    const sourceDescription = cleanSource(m.groups.source);
    if (!sourceDescription || declinesSource(sourceDescription)) {
      return undefined;
    }
    const albumName = cleanName(m.groups.name);
    return { slots: albumName ? { sourceDescription, albumName } : { sourceDescription } };
  },

  parseSlots(rawSlots) {
    const sourceDescription = cleanSource(rawSlots?.sourceDescription);
    if (!sourceDescription) {
      return null;
    }
    const albumName = cleanName(rawSlots?.albumName) || DEFAULT_NAME;
    return { sourceDescription, albumName };
  },

  async run({ client, slots, signal }) {
    const albumName = cleanName(slots?.albumName) || DEFAULT_NAME;
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

    // 2. Propose a new album from the selection handle. No raw asset ids reach the
    //    model — the handle is the only asset reference.
    let planResult;
    try {
      planResult = await client.call(
        'proposeAlbumFromSelection',
        { summary: `Create the "${albumName}" album.`, albumName, selectionHandleId },
        { signal },
      );
    } catch (error) {
      return failed({ text: safeFailureText(error?.message ?? 'The planning tool failed.') });
    }

    // 3. Gate on a persisted plan id before any success copy.
    return gatePlanResult({
      planResult,
      planTool: 'proposeAlbumFromSelection',
      successText: `I prepared a plan to create the "${albumName}" album with ${assetCount} matching ${assetCount === 1 ? 'photo' : 'photos'}. Review the plan before applying it.`,
      successSummary: { workflowKind: KIND, albumName, assetCount },
    });
  },
});
