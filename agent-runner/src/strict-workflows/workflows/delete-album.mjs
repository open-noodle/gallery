import { buildCandidateContinuation, resumeFromCandidates } from '../candidate-disambiguation.mjs';
import { failed, needsInput } from '../protocol.mjs';
import { gatePlanResult, safeFailureText } from './plan-gate.mjs';

// delete_album (strict): "delete/remove/get rid of the <name> album" →
// resolves the album by name via listAlbums (durable disambiguation when
// multiple albums share the name) and proposes album.delete (container
// removed; photos preserved in the library).
//
// Boundary decision: trash_assets already declines container-ending sources via
// `containerSourcePattern = /\b(?:album|space)$/i`, so "delete the Beach album"
// is already ceded by trash_assets. This workflow NEVER steals a photo-deletion
// intent: `delete_album.match()` DECLINES when the captured reference contains a
// photo-source word (photos/pics/images/videos/screenshots/clips) or an "in the"
// frame ("delete the photos in the Beach album" stays with trash_assets' existing
// handling). "delete the Family space" is declined too — that belongs to
// delete_space (slice 3.4, not yet shipped).

const KIND = 'delete_album';

const clean = (value) => (typeof value === 'string' ? value.trim() : '');

// Strip leading article and trailing "album" noun from a user reference.
// "the Beach album" → "Beach", "the album" → "" (empty → invalid).
const normalizeAlbumRef = (value) => {
  const stripped = clean(value)
    .replace(/^(?:the|my|this|that)\s+/i, '')
    .replace(/(?:\s+)?album$/i, '')
    .trim();
  // If remaining text is itself just an article (e.g. parseSlots receives 'the'),
  // treat it as empty so callers can reject it.
  return /^(?:the|my|this|that)$/i.test(stripped) ? '' : stripped;
};

// Require the trailing "album" noun. Capture everything before it as the ref.
const DELETE_ALBUM =
  /\b(?:delete|remove|get\s+rid\s+of)\s+(?<ref>.+?\s+album)\s*[.?!]*$/i;

// Photo-source words that indicate the user means "delete the photos inside the
// album" (a trash intent), not the album container itself.
const PHOTO_SOURCE_PATTERN =
  /\b(?:photos?|pics?|pictures?|images?|videos?|screenshots?|clips?)\b/i;

// "in (the)" or "from (the)" frame — "delete the photos in the Beach album" or
// "remove my newest 20 from the Italy album" → those are photo-ops, not album-delete.
const IN_OR_FROM_FRAME_PATTERN = /\b(?:in|from)\s+(?:the\s+)?/i;

export const deleteAlbumWorkflow = () => ({
  kind: KIND,
  flow: 'strict',

  match(prompt) {
    const text = clean(prompt);
    if (!text) {
      return undefined;
    }

    const m = DELETE_ALBUM.exec(text);
    if (!m?.groups?.ref) {
      return undefined;
    }

    const rawRef = m.groups.ref;

    // Decline photo-source words in the captured ref ("delete the videos album"
    // is unlikely but "delete the Beach album videos" must not match).
    if (PHOTO_SOURCE_PATTERN.test(rawRef)) {
      return undefined;
    }

    // Decline "in (the)" or "from (the)" frame — prevents stealing
    // "delete the photos in the Beach album" (photo-op) and
    // "remove my newest 20 from the Italy album" (remove_photos_from_album).
    if (IN_OR_FROM_FRAME_PATTERN.test(rawRef)) {
      return undefined;
    }

    const albumRef = normalizeAlbumRef(rawRef);

    // Empty ref after normalization — e.g. "delete the album" → decline so the
    // agent can ask which album the user means via open orchestration.
    if (!albumRef) {
      return undefined;
    }

    // Decline space targets — those belong to delete_space (slice 3.4).
    if (/\bspace\b/i.test(albumRef)) {
      return undefined;
    }

    return { slots: { albumRef } };
  },

  parseSlots(rawSlots) {
    const albumRef = normalizeAlbumRef(rawSlots?.albumRef);
    if (!albumRef) {
      return null;
    }
    return { albumRef };
  },

  async run({ client, slots, resolvedAlbumId, signal, nowMs }) {
    // Continuation path: resolvedAlbumId is already known, skip listAlbums.
    if (resolvedAlbumId) {
      const albumRef = clean(slots?.albumRef);
      return this._proposeDelete({ client, albumId: resolvedAlbumId, albumName: albumRef, signal });
    }

    const ref = normalizeAlbumRef(slots?.albumRef);

    let listed;
    try {
      listed = await client.call('listAlbums', {}, { signal });
    } catch (error) {
      return failed({ text: safeFailureText(error?.message ?? 'The album lookup tool failed.') });
    }

    const albums = Array.isArray(listed?.albums) ? listed.albums : [];
    const matches = albums.filter(
      (album) => clean(album?.albumName).toLowerCase() === ref.toLowerCase(),
    );

    if (matches.length === 0) {
      return needsInput({
        text: `I could not find an album called "${ref}". Which album do you mean?`,
      });
    }

    if (matches.length > 1) {
      const candidates = matches.map((a) => ({ id: a.id, name: a.albumName }));
      const continuation = buildCandidateContinuation({
        kind: 'delete_album_album',
        candidates,
        nowMs: nowMs ?? Date.now(),
        slots,
      });
      return needsInput({
        text: `Multiple albums are called "${ref}". Which one do you mean?\n${candidates.map((c, i) => `${i + 1}. ${c.name}`).join('\n')}`,
        continuation,
      });
    }

    const album = matches[0];
    return this._proposeDelete({ client, albumId: album.id, albumName: clean(album.albumName) || ref, signal });
  },

  // Internal: propose the album.delete operation and gate on a persisted plan id.
  async _proposeDelete({ client, albumId, albumName, signal }) {
    let planResult;
    try {
      planResult = await client.call(
        'proposeAlbumOperations',
        {
          summary: `Delete the "${albumName}" album.`,
          operations: [
            {
              type: 'album.delete',
              targetKind: 'existing_album',
              targetId: albumId,
              summary: `Delete the "${albumName}" album.`,
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
      successText: `I prepared a plan to delete the "${albumName}" album. Your photos stay in your library — only the album is removed. Review the plan before applying it.`,
      successSummary: { workflowKind: KIND, albumName },
    });
  },

  resumeContinuation({ pending, prompt, nowMs }) {
    if (pending?.kind !== 'delete_album_album') {
      return {
        status: 'needs_input',
        text: 'I no longer have pending candidates for this request. Please start over.',
      };
    }

    const result = resumeFromCandidates({
      pending,
      prompt,
      nowMs: nowMs ?? Date.now(),
      kind: 'delete_album_album',
    });

    if (result.status !== 'matched') {
      return result;
    }

    return {
      status: 'matched',
      ctx: {
        slots: pending.slots,
        resolvedAlbumId: result.choice.id,
      },
    };
  },
});
