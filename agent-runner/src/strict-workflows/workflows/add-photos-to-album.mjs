import { SUBJECTIVE_PATTERN, resolveAssetSource } from '../asset-source-resolver.mjs';
import { failed, handoffOpen, needsInput } from '../protocol.mjs';
import { gatePlanResult, safeFailureText } from './plan-gate.mjs';

const KIND = 'add_photos_to_album';

const clean = (value) => (typeof value === 'string' ? value.trim() : '');

const normalizeAlbumRef = (value) =>
  clean(value)
    .replace(/^(?:the|my|this|that)\s+/i, '')
    .replace(/\s+album$/i, '')
    .trim();

// Regex fast-path: "add <source> to <album>". The trailing album reference is
// captured non-greedily up to the final "to <album>"; the LLM classifier covers
// paraphrases via the manifest entry.
const ADD_PATTERN = /\badd\s+(?<source>.+?)\s+to\s+(?<albumRef>[^.?!]+?)(?:\s+album)?[.?!]*$/i;

// Conservative fast-path guard: a "recent trip" source is owned by the dedicated
// create_recent_trip_album workflow, and a subjective source must hand off. The
// fast-path declines both so they flow to the LLM classifier / open orchestration
// rather than being coerced into a metadata add here.
const tripSourcePattern = /\brecent\s+trip\b/i;
const declinesAddFastPath = (source) => tripSourcePattern.test(source) || SUBJECTIVE_PATTERN.test(source);

const resolveAlbum = async ({ client, albumRef, signal }) => {
  const ref = normalizeAlbumRef(albumRef);
  const result = await client.call('listAlbums', {}, { signal });
  const albums = Array.isArray(result?.albums) ? result.albums : [];
  const matches = albums.filter((album) => clean(album?.albumName).toLowerCase() === ref.toLowerCase());
  return { ref, matches };
};

export const addPhotosToAlbumWorkflow = () => ({
  kind: KIND,
  flow: 'hybrid',

  match(prompt) {
    const text = clean(prompt);
    const match = ADD_PATTERN.exec(text);
    if (!match?.groups) {
      return undefined;
    }
    const albumRef = normalizeAlbumRef(match.groups.albumRef);
    const sourceDescription = clean(match.groups.source);
    if (!albumRef || !sourceDescription || declinesAddFastPath(sourceDescription)) {
      return undefined;
    }
    return { slots: { albumRef, sourceDescription } };
  },

  parseSlots(rawSlots) {
    const albumRef = normalizeAlbumRef(rawSlots?.albumRef);
    const sourceDescription = clean(rawSlots?.sourceDescription);
    if (!albumRef || !sourceDescription) {
      return null;
    }
    return { albumRef, sourceDescription };
  },

  async run({ client, slots, signal }) {
    const sourceDescription = clean(slots?.sourceDescription);

    // 1. Resolve the target album (none/ambiguous → ask).
    const { ref, matches } = await resolveAlbum({ client, albumRef: slots.albumRef, signal });
    if (matches.length === 0) {
      return needsInput({ text: `I could not find an album called "${ref}". Which album do you mean?` });
    }
    if (matches.length > 1) {
      return needsInput({ text: `Multiple albums are called "${ref}". Which one do you mean?` });
    }
    const album = matches[0];

    // 2. Resolve the source into a selection handle (shared resolver): subjective
    //    and non-recency sources hand off; a recency source becomes a bounded
    //    metadata-search handle. A tool error surfaces as `failed`.
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

    // 3. Propose a duplicate-safe add via the selection handle (server owns the
    // duplicate-safe semantics). No raw asset ids ever reach the model.
    let planResult;
    try {
      planResult = await client.call(
        'proposeAlbumOperations',
        {
          summary: `Add matching photos to "${clean(album.albumName) || ref}".`,
          operations: [
            {
              type: 'album.addAssets',
              summary: 'Add matching photos.',
              targetKind: 'existing_album',
              targetId: album.id,
              assetSource: { kind: 'selectionHandle', selectionHandleId },
            },
          ],
        },
        { signal },
      );
    } catch (error) {
      return failed({ text: safeFailureText(error?.message ?? 'The planning tool failed.') });
    }

    const albumName = clean(album.albumName) || ref;
    return gatePlanResult({
      planResult,
      successText: `I prepared a plan to add ${assetCount} matching ${assetCount === 1 ? 'photo' : 'photos'} to the "${albumName}" album. Review the plan before applying it.`,
      successSummary: { workflowKind: KIND, albumName, assetCount },
    });
  },
});
