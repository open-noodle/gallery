import { SUBJECTIVE_PATTERN, resolveAssetSource } from '../asset-source-resolver.mjs';
import { failed, handoffOpen, needsInput } from '../protocol.mjs';
import { gatePlanResult, safeFailureText } from './plan-gate.mjs';

const KIND = 'remove_photos_from_album';

const clean = (value) => (typeof value === 'string' ? value.trim() : '');
const cleanSource = (value) => clean(value).replace(/[.?!]+$/u, '').trim();

// Strip a leading article and a trailing "album" noun so "the Family album" → "Family".
const normalizeAlbumRef = (value) =>
  clean(value)
    .replace(/^(?:the|my|this|that)\s+/i, '')
    .replace(/\s+album$/i, '')
    .trim();

const resolveAlbum = async ({ client, albumRef, signal }) => {
  const ref = normalizeAlbumRef(albumRef);
  const result = await client.call('listAlbums', {}, { signal });
  const albums = Array.isArray(result?.albums) ? result.albums : [];
  const matches = albums.filter((album) => clean(album?.albumName).toLowerCase() === ref.toLowerCase());
  return { ref, albums, matches };
};

const tripSourcePattern = /\brecent\s+trip\b/i;

// "remove <source> from <album>" / "remove <source> out of <album>" /
// "take <source> out of <album>". Greedy source binds the FINAL from/out-of.
const REMOVE_FROM = /\b(?:remove|delete|drop)\s+(?<source>.+)\s+(?:from|out\s+of)\s+(?<album>.+?)$/i;
const TAKE_OUT_OF = /\btake\s+(?<source>.+)\s+out\s+of\s+(?<album>.+?)$/i;

// "remove … from …" is shared by member removal, out-of-favorites, and tag removal.
// Decline those so registry order + this gate keep the seam clean even in isolation.
// Also decline when the "album" slot contains trip language — that's a trip workflow prompt.
const albumIsOwnedElsewhere = (album) =>
  /\bspaces?\b/i.test(album) || /\bfavou?rites?\b/i.test(album) || tripSourcePattern.test(album);
const sourceIsOwnedElsewhere = (source) =>
  SUBJECTIVE_PATTERN.test(source) || tripSourcePattern.test(source) || /\btags?\b/i.test(source);

const tryMatch = (prompt) => {
  const match = REMOVE_FROM.exec(prompt) ?? TAKE_OUT_OF.exec(prompt);
  if (!match?.groups) {
    return undefined;
  }
  const sourceDescription = cleanSource(match.groups.source);
  const albumRaw = clean(match.groups.album);
  if (!sourceDescription || !albumRaw) {
    return undefined;
  }
  if (albumIsOwnedElsewhere(albumRaw) || sourceIsOwnedElsewhere(sourceDescription)) {
    return undefined;
  }
  const albumRef = normalizeAlbumRef(albumRaw);
  return albumRef ? { albumRef, sourceDescription } : undefined;
};

export const removePhotosFromAlbumWorkflow = () => ({
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
    const albumRef = normalizeAlbumRef(rawSlots?.albumRef);
    const sourceDescription = cleanSource(rawSlots?.sourceDescription);
    if (!albumRef || !sourceDescription) {
      return null;
    }
    return { albumRef, sourceDescription };
  },

  async run({ client, slots, signal }) {
    const sourceDescription = cleanSource(slots?.sourceDescription);

    // 1. Resolve the target album (none/ambiguous → ask).
    const { ref, matches } = await resolveAlbum({ client, albumRef: slots?.albumRef, signal });
    if (matches.length === 0) {
      return needsInput({ text: `I could not find an album called "${ref}". Which album do you mean?` });
    }
    if (matches.length > 1) {
      return needsInput({ text: `Multiple albums are called "${ref}". Which one do you mean?` });
    }
    const album = matches[0];
    const albumName = clean(album.albumName) || ref;

    // 2. Resolve the source into a selection handle (shared resolver).
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
    // EMPTY-REMOVAL SAFETY: never propose removing nothing (a silent no-op).
    if (resolution.status === 'empty') {
      return needsInput({
        text: `I could not find any photos matching "${sourceDescription}" to remove from the "${albumName}" album. Can you describe them differently?`,
      });
    }
    const { selectionHandleId, assetCount } = resolution;

    // 3. Propose the removal via the selection handle. No raw asset ids reach the model.
    let planResult;
    try {
      planResult = await client.call(
        'proposeAlbumOperations',
        {
          summary: `Remove matching photos from "${albumName}".`,
          operations: [
            {
              type: 'album.removeAssets',
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

    return gatePlanResult({
      planResult,
      successText: `I prepared a plan to remove ${assetCount} matching ${assetCount === 1 ? 'photo' : 'photos'} from the "${albumName}" album. Review the plan before applying it.`,
      successSummary: { workflowKind: KIND, albumName, assetCount },
    });
  },
});
