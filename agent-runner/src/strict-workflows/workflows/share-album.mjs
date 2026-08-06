import { failed, needsInput } from '../protocol.mjs';
import { gatePlanResult, safeFailureText } from './plan-gate.mjs';

// share_album (hybrid): "share the <X> album as a (share|shareable|public) link" /
// "create a share link for the <X> album" → resolves the named album via listAlbums
// and proposes a shareLink.createAlbum op. Optional payload: "expires in N days" →
// expiresAt, "with password X" → password, "hide metadata" → showMetadata false.
//
// OUTWARD-FACING SAFETY: shareLink.createAlbum creates a public link visible to
// unauthenticated users. It is gated behind the `createSharedLinks` write-scope
// which defaults FALSE in every preset. The L3 eval preset never grants
// createSharedLinks, so this workflow is propose-only in all eval runs — no
// link is ever created during tests or evaluations.
//
// Routing: share_album must be registered BEFORE share_assets so that "share the
// Family album as a link" routes here (album noun required) rather than to
// share_assets. share_assets already declines when the source ends with "album".

const KIND = 'share_album';

const clean = (v) => (typeof v === 'string' ? v.trim() : '');

// Strip a leading article and a trailing "album" noun so "the Family album"
// resolves as "Family" against the album list.
const normalizeAlbumRef = (value) =>
  clean(value)
    .replace(/^(?:the|my|this|that)\s+/i, '')
    .replace(/\s+album$/i, '')
    .trim();

// "expires in N days" — captured anywhere in the prompt.
const EXPIRY_DAYS_PATTERN = /\bexpir(?:es?|ing)\s+in\s+(\d+)\s+days?\b/i;
// "with password <word>" — captured anywhere in the prompt.
const PASSWORD_PATTERN = /\bwith\s+password\s+(\S+)/i;
// "hide metadata" — captured anywhere in the prompt.
const HIDE_METADATA_PATTERN = /\bhide\s+metadata\b/i;

const stripModifiers = (s) =>
  s
    .replace(EXPIRY_DAYS_PATTERN, '')
    .replace(PASSWORD_PATTERN, '')
    .replace(HIDE_METADATA_PATTERN, '')
    .replace(/,\s*$/u, '')
    .trim();

const parseModifiers = (fullText) => {
  const modifiers = {};
  const expiryMatch = EXPIRY_DAYS_PATTERN.exec(fullText);
  if (expiryMatch) {
    modifiers.expiryDays = Number(expiryMatch[1]);
  }
  const passwordMatch = PASSWORD_PATTERN.exec(fullText);
  if (passwordMatch) {
    modifiers.password = passwordMatch[1];
  }
  if (HIDE_METADATA_PATTERN.test(fullText)) {
    modifiers.showMetadata = false;
  }
  return modifiers;
};

// The album ref must contain the literal word "album" — this is the gate that
// prevents "share these photos as a link" from routing here instead of share_assets.
const requiresAlbumNoun = /\balbum\b/i;

// share the <X> album as a (share|shareable|public) link
const SHARE_ALBUM_AS_LINK_PATTERN =
  /\bshare\s+(?<albumRef>.+?\balbum\b.*?)\s+as\s+a\s+(?:public\s+)?(?:share(?:able)?\s+)?link\b/i;
// create/make/generate a (public) (share|shareable) link for the <X> album
const CREATE_LINK_FOR_ALBUM_PATTERN =
  /\b(?:create|make|generate|build)\s+a\s+(?:public\s+)?share(?:able)?\s+link\s+for\s+(?<albumRef>.+?\balbum\b.*?)(?:\s*[.,!?].*)?$/i;

const PATTERNS = [SHARE_ALBUM_AS_LINK_PATTERN, CREATE_LINK_FOR_ALBUM_PATTERN];

const resolveAlbum = async ({ client, albumRef, signal }) => {
  const ref = normalizeAlbumRef(albumRef);
  const result = await client.call('listAlbums', {}, { signal });
  const albums = Array.isArray(result?.albums) ? result.albums : [];
  const matches = albums.filter((album) => clean(album?.albumName).toLowerCase() === ref.toLowerCase());
  return { ref, albums, matches };
};

export const shareAlbumWorkflow = () => ({
  kind: KIND,
  flow: 'hybrid',

  match(prompt) {
    const text = clean(prompt);
    if (!text) return undefined;
    for (const pattern of PATTERNS) {
      const m = pattern.exec(text);
      if (m?.groups?.albumRef) {
        const rawRef = m.groups.albumRef;
        // Gate: the captured reference must contain the literal word "album".
        if (!requiresAlbumNoun.test(rawRef)) return undefined;
        const albumRef = normalizeAlbumRef(stripModifiers(rawRef));
        if (!albumRef) return undefined;
        const modifiers = parseModifiers(text);
        return { slots: { albumRef, ...modifiers } };
      }
    }
    return undefined;
  },

  parseSlots(rawSlots) {
    const albumRef = normalizeAlbumRef(rawSlots?.albumRef);
    if (!albumRef) return null;
    const slots = { albumRef };
    if (typeof rawSlots?.expiryDays === 'number') slots.expiryDays = rawSlots.expiryDays;
    if (typeof rawSlots?.password === 'string' && rawSlots.password) slots.password = rawSlots.password;
    if (rawSlots?.showMetadata === false) slots.showMetadata = false;
    return slots;
  },

  async run({ client, slots, signal, nowMs }) {
    const albumRef = normalizeAlbumRef(slots?.albumRef);
    if (!albumRef) {
      return needsInput({ text: 'Which album should I create a share link for? Please name the album.' });
    }

    let resolution;
    try {
      resolution = await resolveAlbum({ client, albumRef, signal });
    } catch (error) {
      return failed({ text: safeFailureText(error?.message ?? 'The album list tool failed.') });
    }

    const { ref, matches } = resolution;
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
    const albumName = clean(album.albumName) || ref;

    // Build optional payload from slots.
    const payload = {};
    if (typeof slots?.expiryDays === 'number' && slots.expiryDays > 0) {
      const baseMs = typeof nowMs === 'number' ? nowMs : Date.now();
      payload.expiresAt = new Date(baseMs + slots.expiryDays * 24 * 60 * 60 * 1000).toISOString();
    }
    if (typeof slots?.password === 'string' && slots.password) {
      payload.password = slots.password;
    }
    if (slots?.showMetadata === false) {
      payload.showMetadata = false;
    }

    let planResult;
    try {
      planResult = await client.call(
        'proposeAlbumOperations',
        {
          summary: `Create a public share link for the "${albumName}" album.`,
          operations: [
            {
              type: 'shareLink.createAlbum',
              summary: 'Create an outward-facing album share link (High risk; requires createSharedLinks scope).',
              targetKind: 'existing_album',
              targetId: album.id,
              riskLevel: 'high',
              ...(Object.keys(payload).length > 0 ? { payload } : {}),
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
      planTool: 'proposeAlbumOperations',
      successText: `I prepared a plan to create a public share link for the "${albumName}" album. This creates an outward-facing link; review the plan before applying it.`,
      successSummary: { workflowKind: KIND, albumName },
    });
  },
});
