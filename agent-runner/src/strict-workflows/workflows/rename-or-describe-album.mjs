import { failed, needsInput } from '../protocol.mjs';
import { gatePlanResult, safeFailureText } from './plan-gate.mjs';

const KIND = 'rename_or_describe_album';

const clean = (value) => (typeof value === 'string' ? value.trim() : '');

// Strip a leading article and a trailing "album" noun from a user reference so
// "the Family album" resolves against the album titled "Family".
const normalizeAlbumRef = (value) =>
  clean(value)
    .replace(/^(?:the|my|this|that)\s+/i, '')
    .replace(/\s+album$/i, '')
    .trim();

// Regex fast-path. Recognizes rename ("rename X to Y") and describe
// ("change/set the description on X [to Z]") phrasings. The LLM classifier
// handles paraphrases via the manifest entry; this only needs to cover the
// canonical forms without colliding with create_recent_trip_album or
// add_photos_to_album.
const RENAME_PATTERN =
  /\b(?:rename|re-?name)\s+(?<albumRef>.+?)\s+to\s+(?<newName>.+?)(?:\s+and\s+(?:add|set|give\s+it)\s+(?:a\s+)?description.*)?$/i;
const DESCRIBE_PATTERN =
  /\b(?:change|set|update|add|edit)\s+(?:the\s+|a\s+|its\s+)?description\s+(?:on|of|for)\s+(?<albumRef>.+?)(?:\s+to\s+(?<description>.+))?$/i;

// Conservative fast-path guard: a reference to loose photos ("recent trip
// photos", "my pictures") is NOT an album. Declining here keeps prompts the
// dedicated trip workflow or open read flow owns out of this workflow; the LLM
// classifier can still route a genuine album rename it paraphrases.
const looseAssetReferencePattern = /\b(?:photos?|pictures?|pics?|images?|shots?|videos?|trip)\b/i;
const looksLikeLooseAssetReference = (albumRef) => looseAssetReferencePattern.test(albumRef);

const tryRename = (prompt) => {
  const match = RENAME_PATTERN.exec(prompt);
  if (!match?.groups) {
    return undefined;
  }
  const albumRef = normalizeAlbumRef(match.groups.albumRef);
  const newName = clean(match.groups.newName).replace(/[.?!]+$/u, '').trim();
  if (!albumRef || !newName || looksLikeLooseAssetReference(albumRef)) {
    return undefined;
  }
  return { albumRef, newName };
};

const tryDescribe = (prompt) => {
  const match = DESCRIBE_PATTERN.exec(prompt);
  if (!match?.groups) {
    return undefined;
  }
  const albumRef = normalizeAlbumRef(match.groups.albumRef);
  if (!albumRef || looksLikeLooseAssetReference(albumRef)) {
    return undefined;
  }
  const description = clean(match.groups.description).replace(/[.?!]+$/u, '').trim();
  return description ? { albumRef, description } : { albumRef };
};

const resolveAlbum = async ({ client, albumRef, signal }) => {
  const ref = normalizeAlbumRef(albumRef);
  const result = await client.call('listAlbums', {}, { signal });
  const albums = Array.isArray(result?.albums) ? result.albums : [];
  const matches = albums.filter((album) => clean(album?.albumName).toLowerCase() === ref.toLowerCase());
  return { ref, albums, matches };
};

export const renameOrDescribeAlbumWorkflow = () => ({
  kind: KIND,
  flow: 'strict',

  match(prompt) {
    const text = clean(prompt);
    if (!text) {
      return undefined;
    }
    const rename = tryRename(text);
    if (rename) {
      return { slots: { albumRef: rename.albumRef, newName: rename.newName } };
    }
    const describe = tryDescribe(text);
    if (describe) {
      const slots = { albumRef: describe.albumRef };
      if (describe.description) {
        slots.description = describe.description;
      }
      return { slots };
    }
    return undefined;
  },

  // Normalize classifier/LLM slots into a validated slot set. Requires a target
  // album plus at least one field to change; otherwise returns null so the turn
  // falls through to open orchestration.
  parseSlots(rawSlots) {
    const albumRef = normalizeAlbumRef(rawSlots?.albumRef);
    const newName = clean(rawSlots?.newName);
    const description = clean(rawSlots?.description);
    if (!albumRef) {
      return null;
    }
    if (!newName && !description) {
      return null;
    }
    const slots = { albumRef };
    if (newName) {
      slots.newName = newName;
    }
    if (description) {
      slots.description = description;
    }
    return slots;
  },

  async run({ client, slots, signal }) {
    const newName = clean(slots?.newName);
    const description = clean(slots?.description);
    if (!newName && !description) {
      // Defensive: parseSlots should have rejected this, but never plan a no-op.
      return needsInput({
        text: 'Tell me the new album name or the description you would like to set.',
      });
    }

    const { ref, matches } = await resolveAlbum({ client, albumRef: slots.albumRef, signal });
    if (matches.length === 0) {
      return needsInput({
        text: `I could not find an album called "${ref}". Which album do you mean?`,
      });
    }
    if (matches.length > 1) {
      return needsInput({
        text: `Multiple albums are called "${ref}". Which one do you mean?`,
      });
    }
    const album = matches[0];

    // Include ONLY the fields the user set so unspecified ones are preserved.
    const payload = {};
    if (newName) {
      payload.albumName = newName;
    }
    if (description) {
      payload.description = description;
    }

    const changeParts = [];
    if (newName) {
      changeParts.push(`rename it to "${newName}"`);
    }
    if (description) {
      changeParts.push('update its description');
    }

    let planResult;
    try {
      planResult = await client.call(
        'proposeAlbumOperations',
        {
          summary: 'Update album details.',
          operations: [
            {
              type: 'album.updateDetails',
              summary: 'Update album details.',
              targetKind: 'existing_album',
              targetId: album.id,
              payload,
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
      successText: `I prepared a plan to ${changeParts.join(' and ')} for the "${clean(album.albumName) || ref}" album. Review the plan before applying it.`,
      successSummary: { workflowKind: KIND, albumName: newName || clean(album.albumName) || ref },
    });
  },
});
