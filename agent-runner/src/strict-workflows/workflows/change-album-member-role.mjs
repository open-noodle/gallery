import { buildCandidateContinuation, resumeFromCandidates } from '../candidate-disambiguation.mjs';
import { failed, needsInput } from '../protocol.mjs';
import { gatePlanResult, safeFailureText } from './plan-gate.mjs';

// change_album_member_role (strict): "make <user> an editor/viewer on the <album> album" /
// "change <user>'s role to <role> in the <album> album". The role word is the gate, so a
// non-role "make X … in the Y album" never matches.
//
// Routing gate: requires "album" in the target phrase; DECLINES "space" targets
// (those belong to change_member_role). A bare "make X an editor in Family" with
// no container noun is also declined.
//
// Guards (deterministic): promotion to owner refused; changing the album OWNER's role
// is blocked (owner guard); no-op (current == requested) → needsInput; non-member
// → needsInput; ambiguous album/user → durable continuation.

const KIND = 'change_album_member_role';

const roleArticle = (role) => (role === 'editor' ? 'an editor' : 'a viewer');

const clean = (value) => (typeof value === 'string' ? value.trim() : '');

const normalizeAlbumRef = (value) =>
  clean(value)
    .replace(/^(?:the|my|this|that|our)\s+/i, '')
    .replace(/\s+album$/i, '')
    .trim();

const mentionsAlbum = (text) => /\balbum\b/i.test(clean(text));
const mentionsSpace = (text) => /\bspace\b/i.test(clean(text));

const ROLE_SYNONYMS = {
  editor: 'editor',
  edit: 'editor',
  contributor: 'editor',
  viewer: 'viewer',
  view: 'viewer',
  reader: 'viewer',
  'read-only': 'viewer',
  owner: 'owner',
  admin: 'owner',
  manager: 'owner',
};
const normalizeRole = (word) => ROLE_SYNONYMS[clean(word).toLowerCase()];

// Longer synonyms first so e.g. "editor" wins over "edit".
const ROLE_ALT = 'editor|contributor|edit|viewer|reader|read-only|view|owner|admin|manager';

const MAKE_PATTERN = new RegExp(
  `\\bmake\\s+(?<member>.+?)\\s+(?:an?\\s+|the\\s+)?(?<role>${ROLE_ALT})\\s+(?:in|of|on|for)\\s+(?<album>.+)$`,
  'i',
);
const CHANGE_ROLE_PATTERN = new RegExp(
  `\\b(?:change|set|update)\\s+(?<member>.+?)(?:'s|s')?\\s+role\\s+to\\s+(?:an?\\s+|the\\s+)?(?<role>${ROLE_ALT})\\s+(?:in|of|on|for)\\s+(?<album>.+)$`,
  'i',
);
const CHANGE_TO_PATTERN = new RegExp(
  `\\b(?:change|set|update|make)\\s+(?<member>.+?)\\s+(?:in)?to\\s+(?:an?\\s+|the\\s+)?(?<role>${ROLE_ALT})\\s+(?:in|of|on|for)\\s+(?<album>.+)$`,
  'i',
);

const PATTERNS = [MAKE_PATTERN, CHANGE_ROLE_PATTERN, CHANGE_TO_PATTERN];

export const changeAlbumMemberRoleWorkflow = () => ({
  kind: KIND,
  flow: 'strict',

  match(prompt) {
    const text = clean(prompt);
    if (!text) {
      return undefined;
    }
    for (const pattern of PATTERNS) {
      const m = pattern.exec(text);
      if (!m?.groups) {
        continue;
      }
      const role = normalizeRole(m.groups.role);
      const memberQuery = clean(m.groups.member);
      const rawAlbum = clean(m.groups.album);

      // ROUTING GATE: requires "album" in the target phrase; decline "space" targets.
      if (!mentionsAlbum(rawAlbum)) {
        continue;
      }
      if (mentionsSpace(rawAlbum)) {
        return undefined;
      }

      const albumRef = normalizeAlbumRef(rawAlbum);
      if (role && memberQuery && albumRef) {
        return { slots: { memberQuery, role, albumRef } };
      }
    }
    return undefined;
  },

  parseSlots(rawSlots) {
    const memberQuery = clean(rawSlots?.memberQuery);
    const role = normalizeRole(rawSlots?.role);
    const albumRef = normalizeAlbumRef(rawSlots?.albumRef);
    if (!memberQuery || !role || !albumRef) {
      return null;
    }
    return { memberQuery, role, albumRef };
  },

  async run({ client, slots, resolvedAlbumId, resolvedUserId, signal, nowMs }) {
    const requestedRole = clean(slots?.role).toLowerCase();
    const memberQuery = clean(slots?.memberQuery);

    // Owner is not assignable via a role change.
    if (requestedRole === 'owner') {
      return needsInput({
        text: "I can set a member's role to editor or viewer, not owner. Which role should I use?",
      });
    }

    // 1. Resolve the album (skip when already resolved via continuation).
    let albumSummary;
    let albumName;
    let memberById;

    if (resolvedAlbumId) {
      // Continuation path: skip listAlbums, read directly.
      let detail;
      try {
        detail = await client.call('readAlbum', { albumId: resolvedAlbumId }, { signal });
      } catch (error) {
        return failed({ text: safeFailureText(error?.message ?? 'The album lookup tool failed.') });
      }
      const album = detail?.album ?? detail ?? {};
      albumName = clean(album.albumName) || resolvedAlbumId;
      albumSummary = { id: resolvedAlbumId, name: albumName, ownerId: album.ownerId ?? null };
      const albumUsers = Array.isArray(album.albumUsers) ? album.albumUsers : [];
      memberById = new Map(albumUsers.map((u) => [u.userId, u]));
    } else {
      const ref = normalizeAlbumRef(slots?.albumRef);
      let listed;
      try {
        listed = await client.call('listAlbums', {}, { signal });
      } catch (error) {
        return failed({ text: safeFailureText(error?.message ?? 'The album lookup tool failed.') });
      }
      const albums = Array.isArray(listed?.albums) ? listed.albums : [];
      const albumMatches = albums.filter(
        (album) => clean(album?.albumName).toLowerCase() === ref.toLowerCase(),
      );
      if (albumMatches.length === 0) {
        return needsInput({ text: `I could not find an album called "${ref}". Which album do you mean?` });
      }
      if (albumMatches.length > 1) {
        // Ambiguous album — offer durable candidate list.
        const candidates = albumMatches.map((a) => ({ id: a.id, name: a.albumName }));
        const continuation = buildCandidateContinuation({
          kind: 'change_album_member_role_album',
          candidates,
          nowMs: nowMs ?? Date.now(),
          slots,
        });
        return needsInput({
          text: `Multiple albums are called "${ref}". Which one do you mean?\n${candidates.map((c, i) => `${i + 1}. ${c.name}`).join('\n')}`,
          continuation,
        });
      }
      albumSummary = { id: albumMatches[0].id, name: albumMatches[0].albumName };
      albumName = clean(albumSummary.name) || ref;

      // 2. Read the current album users (with roles) for the guards.
      let detail;
      try {
        detail = await client.call('readAlbum', { albumId: albumSummary.id }, { signal });
      } catch (error) {
        return failed({ text: safeFailureText(error?.message ?? 'The album lookup tool failed.') });
      }
      const album = detail?.album ?? detail ?? {};
      const albumUsers = Array.isArray(album.albumUsers) ? album.albumUsers : [];
      memberById = new Map(albumUsers.map((u) => [u.userId, u]));
      albumSummary = { ...albumSummary, ownerId: album.ownerId ?? null };
    }

    // 3. Resolve the target member to exactly one user.
    let user;
    if (resolvedUserId) {
      // Continuation path: look up the user by id from a searchUsers call.
      let res;
      try {
        res = await client.call('searchUsers', { query: memberQuery }, { signal });
      } catch (error) {
        return failed({ text: safeFailureText(error?.message ?? 'The user lookup tool failed.') });
      }
      const users = Array.isArray(res?.users) ? res.users : [];
      user = users.find((u) => u.userId === resolvedUserId);
      if (!user) {
        return failed({ text: 'I could not find the selected user. Please try again.' });
      }
    } else {
      let res;
      try {
        res = await client.call('searchUsers', { query: memberQuery }, { signal });
      } catch (error) {
        return failed({ text: safeFailureText(error?.message ?? 'The user lookup tool failed.') });
      }
      const users = Array.isArray(res?.users) ? res.users : [];
      if (users.length === 0) {
        return needsInput({ text: `I could not find anyone matching "${memberQuery}". Who do you mean?` });
      }
      if (users.length > 1) {
        // Ambiguous user — offer durable candidate list carrying the resolved album.
        const candidates = users.map((u) => ({ id: u.userId, name: u.name ?? u.email ?? u.userId }));
        const continuation = buildCandidateContinuation({
          kind: 'change_album_member_role_user',
          candidates,
          nowMs: nowMs ?? Date.now(),
          slots,
          resolvedAlbumId: albumSummary.id,
        });
        return needsInput({
          text: `More than one person matches "${memberQuery}". Who do you mean?\n${candidates.map((c, i) => `${i + 1}. ${c.name}`).join('\n')}`,
          continuation,
        });
      }
      user = users[0];
    }

    const displayName = clean(user.name) || memberQuery;

    // 4. Guards from the readAlbum albumUsers set.
    const ownerId = albumSummary.ownerId ?? null;
    if (ownerId && user.userId === ownerId) {
      // Owner guard: never plan changing the album owner's role.
      return needsInput({ text: `I can't change the role of the owner of the "${albumName}" album.` });
    }

    const member = memberById.get(user.userId);
    if (!member) {
      return needsInput({ text: `${displayName} is not a member of the "${albumName}" album.` });
    }
    const currentRole = clean(member.role).toLowerCase();
    if (currentRole === requestedRole) {
      return needsInput({ text: `${displayName} is already ${roleArticle(requestedRole)} in the "${albumName}" album.` });
    }

    // 5. Propose and gate on a persisted plan id.
    let planResult;
    try {
      planResult = await client.call(
        'proposeAlbumOperations',
        {
          summary: "Update an album member's role.",
          operations: [
            {
              type: 'album.updateUserRole',
              summary: "Update an album member's role.",
              targetKind: 'existing_album',
              targetId: albumSummary.id,
              payload: { userId: user.userId, role: requestedRole },
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
      successText: `I prepared a plan to make ${displayName} ${roleArticle(requestedRole)} in the "${albumName}" album. Review the plan before applying it.`,
      successSummary: { workflowKind: KIND, target: albumName, label: requestedRole },
    });
  },

  // Resolve a candidate pick from a continuation follow-up.
  // Returns { status:'matched', ctx } | { status:'needs_input'|'expired', text }.
  resumeContinuation({ pending, prompt, nowMs }) {
    const kind = pending?.kind;
    if (kind !== 'change_album_member_role_album' && kind !== 'change_album_member_role_user') {
      return { status: 'needs_input', text: 'I no longer have pending candidates for this request. Please start over.' };
    }

    const result = resumeFromCandidates({ pending, prompt, nowMs: nowMs ?? Date.now(), kind });
    if (result.status !== 'matched') {
      return result; // needs_input | expired | missing — pass through
    }

    const { choice } = result;
    if (kind === 'change_album_member_role_album') {
      return {
        status: 'matched',
        ctx: {
          slots: pending.slots,
          resolvedAlbumId: choice.id,
        },
      };
    }
    // change_album_member_role_user
    return {
      status: 'matched',
      ctx: {
        slots: pending.slots,
        resolvedAlbumId: pending.resolvedAlbumId,
        resolvedUserId: choice.id,
      },
    };
  },
});
