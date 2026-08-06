import { SUBJECTIVE_PATTERN, resolveAssetSource } from '../asset-source-resolver.mjs';
import { failed, handoffOpen, needsInput } from '../protocol.mjs';
import { gatePlanResult, safeFailureText } from './plan-gate.mjs';

const KIND = 'move_photos_between_albums';

const clean = (v) => (typeof v === 'string' ? v.trim() : '');
const cleanSource = (v) => clean(v).replace(/[.?!]+$/u, '').trim();

const normalizeAlbumRef = (value) =>
  clean(value)
    .replace(/^(?:the|my|this|that)\s+/i, '')
    .replace(/\s+album$/i, '')
    .trim();

const tripSourcePattern = /\brecent\s+trip\b/i;
const sourceIsOwnedElsewhere = (s) => SUBJECTIVE_PATTERN.test(s) || tripSourcePattern.test(s);

// "move <source> from <fromAlbum> to <toAlbum>". Greedy source binds the FINAL
// "from … to …" so a date source containing "from" (e.g. "my photos from 2024")
// is preserved. Both from and to are REQUIRED (bare "move … to …" never matches).
const MOVE_PATTERN =
  /\bmove\s+(?<source>.+)\s+from\s+(?<fromAlbum>.+?)\s+to\s+(?<toAlbum>[^.?!]+?)(?:\s+album)?[.?!]*$/i;

const tryMatch = (prompt) => {
  const m = MOVE_PATTERN.exec(prompt);
  if (!m?.groups) return undefined;
  const sourceDescription = cleanSource(m.groups.source);
  const fromAlbumRef = normalizeAlbumRef(m.groups.fromAlbum);
  const toAlbumRef = normalizeAlbumRef(m.groups.toAlbum);
  if (!sourceDescription || !fromAlbumRef || !toAlbumRef) return undefined;
  if (sourceIsOwnedElsewhere(sourceDescription)) return undefined;
  return { sourceDescription, fromAlbumRef, toAlbumRef };
};

const resolveAlbum = async ({ client, albumRef, signal }) => {
  const ref = normalizeAlbumRef(albumRef);
  const result = await client.call('listAlbums', {}, { signal });
  const albums = Array.isArray(result?.albums) ? result.albums : [];
  const matches = albums.filter((a) => clean(a?.albumName).toLowerCase() === ref.toLowerCase());
  return { ref, matches };
};

export const movePhotosBetweenAlbumsWorkflow = () => ({
  kind: KIND,
  flow: 'hybrid',

  match(prompt) {
    const text = clean(prompt);
    if (!text) return undefined;
    const matched = tryMatch(text);
    return matched ? { slots: matched } : undefined;
  },

  parseSlots(rawSlots) {
    const sourceDescription = cleanSource(rawSlots?.sourceDescription);
    const fromAlbumRef = normalizeAlbumRef(rawSlots?.fromAlbumRef);
    const toAlbumRef = normalizeAlbumRef(rawSlots?.toAlbumRef);
    if (!sourceDescription || !fromAlbumRef || !toAlbumRef) return null;
    return { sourceDescription, fromAlbumRef, toAlbumRef };
  },

  async run({ client, slots, signal }) {
    const sourceDescription = cleanSource(slots?.sourceDescription);
    const fromRef = normalizeAlbumRef(slots?.fromAlbumRef);
    const toRef = normalizeAlbumRef(slots?.toAlbumRef);

    // Same-album guard BEFORE any tool call (never a no-op plan).
    if (fromRef && toRef && fromRef.toLowerCase() === toRef.toLowerCase()) {
      return needsInput({
        text: `"${fromRef}" and "${toRef}" are the same album — tell me a different destination album to move into.`,
      });
    }

    // Resolve both albums (none/ambiguous → ask).
    const from = await resolveAlbum({ client, albumRef: fromRef, signal });
    if (from.matches.length === 0) {
      return needsInput({
        text: `I could not find an album called "${from.ref}". Which album should I move them out of?`,
      });
    }
    if (from.matches.length > 1) {
      return needsInput({
        text: `Multiple albums are called "${from.ref}". Which one should I move them out of?`,
      });
    }
    const to = await resolveAlbum({ client, albumRef: toRef, signal });
    if (to.matches.length === 0) {
      return needsInput({
        text: `I could not find an album called "${to.ref}". Which album should I move them into?`,
      });
    }
    if (to.matches.length > 1) {
      return needsInput({
        text: `Multiple albums are called "${to.ref}". Which one should I move them into?`,
      });
    }
    const fromAlbum = from.matches[0];
    const toAlbum = to.matches[0];
    const fromAlbumName = clean(fromAlbum.albumName) || from.ref;
    const toAlbumName = clean(toAlbum.albumName) || to.ref;

    // Resolve the source (subjective → handoff; empty → ask).
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
        text: `I could not find any photos matching "${sourceDescription}" to move. Can you describe them differently?`,
      });
    }
    const { selectionHandleId, assetCount } = resolution;

    let planResult;
    try {
      planResult = await client.call(
        'proposeAlbumOperations',
        {
          summary: `Move matching photos from "${fromAlbumName}" to "${toAlbumName}".`,
          operations: [
            {
              type: 'album.removeAssets',
              targetKind: 'existing_album',
              targetId: fromAlbum.id,
              assetSource: { kind: 'selectionHandle', selectionHandleId },
            },
            {
              type: 'album.addAssets',
              targetKind: 'existing_album',
              targetId: toAlbum.id,
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
      successText: `I prepared a plan to move ${assetCount} matching ${assetCount === 1 ? 'photo' : 'photos'} from "${fromAlbumName}" to "${toAlbumName}". Review the plan before applying it.`,
      successSummary: { workflowKind: KIND, fromAlbumName, toAlbumName, assetCount },
    });
  },
});
