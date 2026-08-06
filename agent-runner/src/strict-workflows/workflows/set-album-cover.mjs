import { failed, handoffOpen, needsInput } from '../protocol.mjs';
import { gatePlanResult, safeFailureText } from './plan-gate.mjs';

const KIND = 'set_album_cover';

const clean = (value) => (typeof value === 'string' ? value.trim() : '');

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

const WORD_ORDINALS = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5,
  sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10,
};

// Resolve an explicit position to a 1-based index, or undefined if the reference is not a
// position (e.g. "a nicer one" → not resolvable → handoff).
const parseCoverIndex = (coverRef, count) => {
  const text = clean(coverRef).toLowerCase();
  if (/\blast\b/.test(text)) {
    return count;
  }
  const digit = text.match(/\b(\d+)(?:st|nd|rd|th)?\b/);
  if (digit) {
    return Number(digit[1]);
  }
  for (const [word, n] of Object.entries(WORD_ORDINALS)) {
    if (new RegExp(`\\b${word}\\b`).test(text)) {
      return n;
    }
  }
  return undefined;
};

const SET_COVER_PATTERN =
  /\b(?:set|change|use)\s+(?:the\s+)?cover\s+(?:photo\s+)?(?:of|for|on)\s+(?<album>.+?)\s+to\s+(?<cover>.+)$/i;
const MAKE_COVER_PATTERN =
  /\bmake\s+(?<album>.+?)\s+(?:the\s+)?cover\s+(?:the\s+)?(?<cover>\d+(?:st|nd|rd|th)?|first|last|second|third|fourth|fifth)\b/i;

const tryMatch = (prompt) => {
  const match = SET_COVER_PATTERN.exec(prompt) ?? MAKE_COVER_PATTERN.exec(prompt);
  if (!match?.groups) {
    return undefined;
  }
  const albumRef = normalizeAlbumRef(match.groups.album);
  const coverRef = clean(match.groups.cover).replace(/[.?!]+$/u, '').trim();
  return albumRef && coverRef ? { albumRef, coverRef } : undefined;
};

export const setAlbumCoverWorkflow = () => ({
  kind: KIND,
  flow: 'strict',

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
    const coverRef = clean(rawSlots?.coverRef);
    if (!albumRef || !coverRef) {
      return null;
    }
    return { albumRef, coverRef };
  },

  async run({ client, slots, signal }) {
    const coverRef = clean(slots?.coverRef);

    let resolved;
    try {
      resolved = await resolveAlbum({ client, albumRef: slots?.albumRef, signal });
    } catch (error) {
      return failed({ text: safeFailureText(error?.message ?? 'The album lookup failed.') });
    }
    const { ref, matches } = resolved;
    if (matches.length === 0) {
      return needsInput({ text: `I could not find an album called "${ref}". Which album do you mean?` });
    }
    if (matches.length > 1) {
      return needsInput({ text: `Multiple albums are called "${ref}". Which one do you mean?` });
    }
    const album = matches[0];
    const albumName = clean(album.albumName) || ref;

    let detail;
    try {
      detail = await client.call('readAlbum', { albumId: album.id }, { signal });
    } catch (error) {
      return failed({ text: safeFailureText(error?.message ?? 'The album lookup failed.') });
    }
    const assetIds = Array.isArray(detail?.album?.assetIds) ? detail.album.assetIds : [];

    const index = parseCoverIndex(coverRef, assetIds.length);
    if (index === undefined) {
      return handoffOpen({ reason: `I could not map "${coverRef}" to a specific photo in the "${albumName}" album.` });
    }
    if (index < 1 || index > assetIds.length) {
      return needsInput({
        text: `The "${albumName}" album has ${assetIds.length} ${assetIds.length === 1 ? 'photo' : 'photos'}, so I cannot use "${coverRef}". Pick a position in range.`,
      });
    }
    const coverId = assetIds[index - 1];

    let planResult;
    try {
      planResult = await client.call(
        'proposeAlbumOperations',
        {
          summary: `Set the cover of "${albumName}".`,
          operations: [
            {
              type: 'album.setCover',
              summary: 'Set the album cover.',
              targetKind: 'existing_album',
              targetId: album.id,
              assetIds: [coverId],
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
      successText: `I prepared a plan to set the cover of the "${albumName}" album. Review the plan before applying it.`,
      successSummary: { workflowKind: KIND, albumName },
    });
  },
});
