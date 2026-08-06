import { buildCandidateContinuation, resumeFromCandidates } from '../candidate-disambiguation.mjs';
import { failed, needsInput } from '../protocol.mjs';
import { gatePlanResult, safeFailureText } from './plan-gate.mjs';

// manage_album_access (strict): share/give/add/remove album users.
//
// Routing gates (NEVER collide with 3 neighbouring workflows):
//   - "share the Family album as a link" / "public link" / "share link" → DECLINE (share_album)
//   - "add/remove … space" → DECLINE (manage_space_members)
//   - photo-source member capture ("add my newest 20 photos …") → DECLINE (share_assets)
//   - "add <users> to <album>" accepted ONLY when the phrase mentions "album".
//   - "remove <users> from <album>" accepted ONLY when the phrase mentions "album".
//
// Safety guards (deterministic, from readAlbum albumUsers + ownerId):
//   - album ownerId is never targeted (owner guard).
//   - already-a-member add is skipped (needsInput when everyone is already shared).
//   - removing a non-member asks.

const KIND = 'manage_album_access';

const clean = (value) => (typeof value === 'string' ? value.trim() : '');

const normalizeAlbumRef = (value) =>
  clean(value)
    .replace(/^(?:the|my|this|that|our)\s+/i, '')
    .replace(/\s+album$/i, '')
    .trim();

const mentionsAlbum = (text) => /\balbum\b/i.test(clean(text));
const mentionsSpace = (text) => /\bspace\b/i.test(clean(text));
const mentionsLink = (text) => /\b(?:as\s+a\s+link|public\s+link|share\s+link|as\s+a\s+public\s+link)\b/i.test(clean(text));

// A members capture that reads like a photo source is NOT a member list.
const PHOTO_SOURCE_RE =
  /\b(?:photos?|pics?|pictures?|images?|videos?|clips?|screenshots?|snaps?|shots?|newest|latest|most\s+recent|these)\b/i;
const looksLikePhotoSource = (text) => PHOTO_SOURCE_RE.test(clean(text));

const ROLE_SYNONYMS = {
  editor: 'editor',
  edit: 'editor',
  contributor: 'editor',
  viewer: 'viewer',
  view: 'viewer',
  reader: 'viewer',
  'read-only': 'viewer',
  'can edit': 'editor',
  'can view': 'viewer',
};
const normalizeRole = (word) => ROLE_SYNONYMS[clean(word).toLowerCase()];

// A trailing "as [a/an] <role>".
const ROLE_SUFFIX = /\s+as\s+(?:an?\s+)?([a-z][a-z-]*)\s*[.?!]*$/i;

const splitMembers = (text) =>
  clean(text)
    .split(/\s*,\s*|\s+and\s+|\s*&\s*/i)
    .map((part) => clean(part).replace(/^the\s+/i, '').trim())
    .filter(Boolean);

const normalizeMemberQueries = (value) => {
  if (Array.isArray(value)) {
    return value.map((member) => clean(member)).filter(Boolean);
  }
  return splitMembers(value);
};

// Infer add/remove from the prompt verb when the LLM omits/garbles the action slot.
const inferActionFromPrompt = (prompt) => {
  const text = clean(prompt).toLowerCase();
  if (/\b(?:remove|kick|take\s+off|drop|revoke|unshare)\b/.test(text)) {
    return 'remove';
  }
  if (/\b(?:add|invite|include|give|grant|share)\b/.test(text)) {
    return 'add';
  }
  return undefined;
};

// "share <album> with <users>" — "with" introduces the user list, not the album.
// e.g. "share Family with Alex" or "share the Family album with Alex and Sam"
// `members` is captured loosely and parsed by `splitMembers` (comma / "and" / "&"),
// so a simple linear `.+` avoids the catastrophic backtracking (ReDoS) a nested
// quantifier alternation would introduce.
const SHARE_WITH_PATTERN = /\bshare\s+(?<albumPart>.+?)\s+with\s+(?<members>.+)$/i;

// "give <users> [(edit) ]access to <album>"
const GIVE_ACCESS_PATTERN = /\bgive\s+(?<members>.+?)\s+(?:edit\s+)?access\s+to\s+(?<rest>.+)$/i;
// "give <users> edit access to <album>" — role extracted separately
const GIVE_EDIT_PATTERN = /\bgive\s+(?<members>.+?)\s+edit\s+access\s+to\s+(?<rest>.+)$/i;

// "add <users> to <album>" — gated by "album" mention
const ADD_PATTERN = /\badd\s+(?<members>.+?)\s+to\s+(?<rest>.+)$/i;

// "remove <users> from <album>" — gated by "album" mention
const REMOVE_PATTERN = /\bremove\s+(?<members>.+?)\s+from\s+(?<rest>.+)$/i;

export const manageAlbumAccessWorkflow = () => ({
  kind: KIND,
  flow: 'strict',

  match(prompt) {
    const text = clean(prompt);
    if (!text) {
      return undefined;
    }

    // Hard declines: link-share prompts
    if (mentionsLink(text)) {
      return undefined;
    }

    // "share <album> with <users>"
    const shareWith = SHARE_WITH_PATTERN.exec(text);
    if (shareWith?.groups) {
      const albumPart = shareWith.groups.albumPart;
      const membersRaw = shareWith.groups.members;
      // Decline if the whole prompt mentions space (manage_space_members owns that)
      if (mentionsSpace(text)) {
        return undefined;
      }
      // Decline if members look like a photo source
      if (looksLikePhotoSource(membersRaw)) {
        return undefined;
      }
      const albumRef = normalizeAlbumRef(albumPart);
      const memberQueries = splitMembers(membersRaw);
      if (albumRef && memberQueries.length) {
        return { slots: { action: 'add', memberQueries, albumRef } };
      }
    }

    // "give <users> edit access to <album>"
    const giveEdit = GIVE_EDIT_PATTERN.exec(text);
    if (giveEdit?.groups) {
      const membersRaw = giveEdit.groups.members;
      const rest = giveEdit.groups.rest;
      if (!looksLikePhotoSource(membersRaw)) {
        const albumRef = normalizeAlbumRef(rest);
        const memberQueries = splitMembers(membersRaw);
        if (albumRef && memberQueries.length) {
          return { slots: { action: 'add', memberQueries, albumRef, role: 'editor' } };
        }
      }
    }

    // "give <users> access to <album>"
    const giveAccess = GIVE_ACCESS_PATTERN.exec(text);
    if (giveAccess?.groups) {
      const membersRaw = giveAccess.groups.members;
      const rest = giveAccess.groups.rest;
      if (!looksLikePhotoSource(membersRaw)) {
        const albumRef = normalizeAlbumRef(rest);
        const memberQueries = splitMembers(membersRaw);
        if (albumRef && memberQueries.length) {
          return { slots: { action: 'add', memberQueries, albumRef } };
        }
      }
    }

    // "add <users> to <album>" — only when "album" is mentioned (not "space")
    const add = ADD_PATTERN.exec(text);
    if (add?.groups) {
      const membersRaw = add.groups.members;
      const rest = add.groups.rest;
      if (
        mentionsAlbum(rest) &&
        !mentionsSpace(rest) &&
        !looksLikePhotoSource(membersRaw)
      ) {
        let role;
        let restClean = rest;
        const roleMatch = ROLE_SUFFIX.exec(restClean);
        if (roleMatch) {
          const normalized = normalizeRole(roleMatch[1]);
          if (normalized) {
            role = normalized;
            restClean = restClean.slice(0, roleMatch.index);
          }
        }
        const albumRef = normalizeAlbumRef(restClean);
        const memberQueries = splitMembers(membersRaw);
        if (albumRef && memberQueries.length) {
          return { slots: { action: 'add', memberQueries, albumRef, ...(role ? { role } : {}) } };
        }
      }
    }

    // "remove <users> from <album>" — only when "album" is mentioned (not "space")
    const remove = REMOVE_PATTERN.exec(text);
    if (remove?.groups) {
      const membersRaw = remove.groups.members;
      const rest = remove.groups.rest;
      if (
        mentionsAlbum(rest) &&
        !mentionsSpace(rest) &&
        !looksLikePhotoSource(membersRaw)
      ) {
        const albumRef = normalizeAlbumRef(rest);
        const memberQueries = splitMembers(membersRaw);
        if (albumRef && memberQueries.length) {
          return { slots: { action: 'remove', memberQueries, albumRef } };
        }
      }
    }

    return undefined;
  },

  parseSlots(rawSlots, prompt) {
    let action = clean(rawSlots?.action).toLowerCase();
    if (action !== 'add' && action !== 'remove') {
      action = inferActionFromPrompt(prompt);
    }
    if (action !== 'add' && action !== 'remove') {
      return null;
    }
    const albumRef = normalizeAlbumRef(rawSlots?.albumRef);
    if (!albumRef) {
      return null;
    }
    const memberQueries = normalizeMemberQueries(rawSlots?.memberQueries);
    if (!memberQueries.length) {
      return null;
    }
    const slots = { action, albumRef, memberQueries };
    if (action === 'add') {
      // Default to the least-privileged role when none is given.
      slots.role = normalizeRole(rawSlots?.role) ?? 'viewer';
    }
    return slots;
  },

  async run({ client, slots, resolvedAlbumId, resolvedUserId, signal, nowMs }) {
    const action = clean(slots?.action).toLowerCase();
    const memberQueries = Array.isArray(slots?.memberQueries) ? slots.memberQueries : [];
    const role = clean(slots?.role).toLowerCase() || 'viewer';

    // 1. Resolve the album (none/ambiguous → ask; skip when already resolved).
    let albumSummary;
    let albumName;
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
      const memberById = new Map(albumUsers.map((u) => [u.userId, u]));
      return this._resolveUsersAndPropose({
        client, slots, slots_action: action, memberQueries, role,
        albumSummary, albumName, memberById, resolvedUserId, signal, nowMs,
      });
    }

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
        kind: 'manage_album_access_album',
        candidates,
        nowMs: nowMs ?? Date.now(),
        slots,
      });
      return needsInput({
        text: `Multiple albums are called "${ref}". Which one do you mean?\n${candidates.map((c, i) => `${i + 1}. ${c.name}`).join('\n')}`,
        continuation,
      });
    }
    albumSummary = albumMatches[0];
    albumName = clean(albumSummary.albumName) || ref;

    // 2. Read the current shared users (with roles) for the guards.
    let detail;
    try {
      detail = await client.call('readAlbum', { albumId: albumSummary.id }, { signal });
    } catch (error) {
      return failed({ text: safeFailureText(error?.message ?? 'The album lookup tool failed.') });
    }
    const albumDetail = detail?.album ?? detail ?? {};
    const albumUsers = Array.isArray(albumDetail.albumUsers) ? albumDetail.albumUsers : [];
    const memberById = new Map(albumUsers.map((u) => [u.userId, u]));
    const ownerId = albumDetail.ownerId ?? null;

    return this._resolveUsersAndPropose({
      client, slots, slots_action: action, memberQueries, role,
      albumSummary: { ...albumSummary, ownerId },
      albumName, memberById, resolvedUserId, signal, nowMs,
    });
  },

  // Internal: resolves member queries and builds the plan proposal.
  async _resolveUsersAndPropose({
    client, slots, slots_action: action, memberQueries, role,
    albumSummary, albumName, memberById, resolvedUserId, signal, nowMs,
  }) {
    // 3. Resolve each member query to exactly one user.
    const resolved = [];

    if (resolvedUserId) {
      const query = memberQueries[0] ?? '';
      let res;
      try {
        res = await client.call('searchUsers', { query }, { signal });
      } catch (error) {
        return failed({ text: safeFailureText(error?.message ?? 'The user lookup tool failed.') });
      }
      const users = Array.isArray(res?.users) ? res.users : [];
      const user = users.find((u) => u.userId === resolvedUserId);
      if (!user) {
        return failed({ text: 'I could not find the selected user. Please try again.' });
      }
      resolved.push(user);
    } else {
      for (const query of memberQueries) {
        let res;
        try {
          res = await client.call('searchUsers', { query }, { signal });
        } catch (error) {
          return failed({ text: safeFailureText(error?.message ?? 'The user lookup tool failed.') });
        }
        const users = Array.isArray(res?.users) ? res.users : [];
        if (users.length === 0) {
          return needsInput({ text: `I could not find anyone matching "${query}". Who do you mean?` });
        }
        if (users.length > 1) {
          const candidates = users.map((u) => ({ id: u.userId, name: u.name ?? u.email ?? u.userId }));
          const continuation = buildCandidateContinuation({
            kind: 'manage_album_access_user',
            candidates,
            nowMs: nowMs ?? Date.now(),
            slots,
            resolvedAlbumId: albumSummary.id,
          });
          return needsInput({
            text: `More than one person matches "${query}". Who do you mean?\n${candidates.map((c, i) => `${i + 1}. ${c.name}`).join('\n')}`,
            continuation,
          });
        }
        resolved.push(users[0]);
      }
    }

    // 4. Apply the deterministic guards and build the operation.
    const ownerId = albumSummary.ownerId ?? null;
    let operation;
    let successText;

    if (action === 'add') {
      // Owner can't be targeted.
      const ownerTargeted = resolved.filter((user) => ownerId && user.userId === ownerId);
      if (ownerTargeted.length > 0) {
        return needsInput({
          text: `I can't change the access of the owner of the "${albumName}" album.`,
        });
      }
      const toAdd = resolved.filter((user) => !memberById.has(user.userId));
      if (toAdd.length === 0) {
        return needsInput({
          text: `Everyone you named already has access to the "${albumName}" album.`,
        });
      }
      operation = {
        type: 'album.addUsers',
        summary: 'Update album shared users.',
        targetKind: 'existing_album',
        targetId: albumSummary.id,
        payload: { albumUsers: toAdd.map((user) => ({ userId: user.userId, role })) },
      };
      successText = `I prepared a plan to share the "${albumName}" album with ${toAdd.length} ${toAdd.length === 1 ? 'person' : 'people'} as ${role === 'editor' ? 'an editor' : 'a viewer'}. Review the plan before applying it.`;
    } else {
      // remove
      // Owner guard: never plan removing the album owner.
      const ownerTargeted = resolved.filter((user) => ownerId && user.userId === ownerId);
      if (ownerTargeted.length > 0) {
        return needsInput({
          text: `I can't remove the owner of the "${albumName}" album.`,
        });
      }
      const toRemove = resolved.filter((user) => memberById.has(user.userId));
      if (toRemove.length === 0) {
        return needsInput({
          text: `No one you named currently has access to the "${albumName}" album.`,
        });
      }
      operation = {
        type: 'album.removeUsers',
        summary: 'Update album shared users.',
        targetKind: 'existing_album',
        targetId: albumSummary.id,
        payload: { userIds: toRemove.map((user) => user.userId) },
      };
      successText = `I prepared a plan to remove ${toRemove.length} ${toRemove.length === 1 ? 'person' : 'people'} from the "${albumName}" album. Review the plan before applying it.`;
    }

    // 5. Propose and gate on a persisted plan id.
    let planResult;
    try {
      planResult = await client.call(
        'proposeAlbumOperations',
        { summary: 'Update album shared users.', operations: [operation] },
        { signal },
      );
    } catch (error) {
      return failed({ text: safeFailureText(error?.message ?? 'The planning tool failed.') });
    }

    return gatePlanResult({
      planResult,
      successText,
      successSummary: { workflowKind: KIND, target: albumName, label: action },
    });
  },

  // Resolve a candidate pick from a continuation follow-up.
  resumeContinuation({ pending, prompt, nowMs }) {
    const kind = pending?.kind;
    if (kind !== 'manage_album_access_album' && kind !== 'manage_album_access_user') {
      return {
        status: 'needs_input',
        text: 'I no longer have pending candidates for this request. Please start over.',
      };
    }

    const result = resumeFromCandidates({ pending, prompt, nowMs: nowMs ?? Date.now(), kind });
    if (result.status !== 'matched') {
      return result; // needs_input | expired | missing — pass through
    }

    const { choice } = result;
    if (kind === 'manage_album_access_album') {
      return {
        status: 'matched',
        ctx: {
          slots: pending.slots,
          resolvedAlbumId: choice.id,
        },
      };
    }
    // manage_album_access_user
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
