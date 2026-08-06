import { buildCandidateContinuation, resumeFromCandidates } from '../candidate-disambiguation.mjs';
import { failed, needsInput } from '../protocol.mjs';
import { gatePlanResult, safeFailureText } from './plan-gate.mjs';

// manage_space_members (strict): "add <users> to <space> [as <role>]" /
// "remove <users> from <space>". The router is GATED so it never steals a photo
// add ("add <photos> to <album>") or a tag add — an add only matches when it
// mentions a "space" or carries an explicit role.
//
// Safety guards (deterministic, from the readSpace member set):
//   - owner is NOT assignable on add (role editor/viewer only).
//   - already-a-member add is skipped (never re-add).
//   - removing a non-member asks for input (never a no-op).
//   - removing the space OWNER is blocked — the runner has no current-user
//     identity, so the owner is the deterministic proxy for "self"; this subsumes
//     self-removal and last-owner removal, and the server is the backstop
//     ("Pi cannot remove or demote the owner of a space").

const KIND = 'manage_space_members';

const clean = (value) => (typeof value === 'string' ? value.trim() : '');

const normalizeSpaceRef = (value) =>
  clean(value)
    .replace(/^(?:the|my|this|that|our)\s+/i, '')
    .replace(/^shared\s+space\s+/i, '')
    .replace(/\s+(?:shared\s+)?space$/i, '')
    .trim();

const mentionsSpace = (ref) => /\bspace\b/i.test(clean(ref));

// A members capture that reads like a photo source ("my newest 20 photos") is NOT
// a member list — decline so "add <photos> to the X space" never becomes a member
// op (there is no add-photos-to-space workflow; it falls through to open handling).
const PHOTO_SOURCE_RE =
  /\b(?:photos?|pics?|pictures?|images?|videos?|clips?|screenshots?|snaps?|shots?|newest|latest|most\s+recent)\b/i;
const looksLikePhotoSource = (text) => PHOTO_SOURCE_RE.test(clean(text));

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

// Infer add/remove from the prompt verb when the LLM omits/garbles the action
// slot (e.g. it routes "invite Alex to the Family space" but sets no action).
const inferActionFromPrompt = (prompt) => {
  const text = clean(prompt).toLowerCase();
  if (/\b(?:remove|kick|take\s+off|drop|delete|revoke)\b/.test(text)) {
    return 'remove';
  }
  if (/\b(?:add|invite|include|share\s+with)\b/.test(text)) {
    return 'add';
  }
  return undefined;
};

const ADD_PATTERN = /\badd\s+(?<members>.+?)\s+to\s+(?<rest>.+)$/i;
const REMOVE_PATTERN = /\bremove\s+(?<members>.+?)\s+from\s+(?<rest>.+)$/i;

export const manageSpaceMembersWorkflow = () => ({
  kind: KIND,
  flow: 'strict',

  match(prompt) {
    const text = clean(prompt);
    if (!text) {
      return undefined;
    }

    const add = ADD_PATTERN.exec(text);
    if (add?.groups) {
      let rest = add.groups.rest;
      let role;
      const roleMatch = ROLE_SUFFIX.exec(rest);
      if (roleMatch) {
        const normalized = normalizeRole(roleMatch[1]);
        if (normalized) {
          role = normalized;
          rest = rest.slice(0, roleMatch.index);
        }
      }
      const spaceRef = normalizeSpaceRef(rest);
      const memberQueries = splitMembers(add.groups.members);
      // Gate: a space membership op mentions a "space" OR carries an explicit role,
      // so "add <photos> to <album>" / "add the tag … to …" fall through. A photo-ish
      // member capture (e.g. "my newest 20 photos") also declines.
      if (
        (mentionsSpace(rest) || role) &&
        spaceRef &&
        memberQueries.length &&
        !looksLikePhotoSource(add.groups.members)
      ) {
        return { slots: { action: 'add', memberQueries, spaceRef, ...(role ? { role } : {}) } };
      }
    }

    const remove = REMOVE_PATTERN.exec(text);
    if (remove?.groups) {
      const rest = remove.groups.rest;
      const spaceRef = normalizeSpaceRef(rest);
      const memberQueries = splitMembers(remove.groups.members);
      if (mentionsSpace(rest) && spaceRef && memberQueries.length && !looksLikePhotoSource(remove.groups.members)) {
        return { slots: { action: 'remove', memberQueries, spaceRef } };
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
    const spaceRef = normalizeSpaceRef(rawSlots?.spaceRef);
    if (!spaceRef) {
      return null;
    }
    const memberQueries = normalizeMemberQueries(rawSlots?.memberQueries);
    if (!memberQueries.length) {
      return null;
    }
    const slots = { action, spaceRef, memberQueries };
    if (action === 'add') {
      // Default to the least-privileged role when none is given.
      slots.role = normalizeRole(rawSlots?.role) ?? 'viewer';
    }
    return slots;
  },

  async run({ client, slots, resolvedSpaceId, resolvedUserId, signal, nowMs }) {
    const action = clean(slots?.action).toLowerCase();
    const memberQueries = Array.isArray(slots?.memberQueries) ? slots.memberQueries : [];
    const role = clean(slots?.role).toLowerCase();

    // Owner is not assignable to a member.
    if (action === 'add' && role === 'owner') {
      return needsInput({
        text: 'I can add members as an editor or a viewer, not an owner. Which role should I use?',
      });
    }

    // 1. Resolve the space (none/ambiguous → ask; skip when already resolved).
    let spaceSummary;
    let spaceName;
    if (resolvedSpaceId) {
      // Continuation path: skip listSpaces, read directly.
      let detail;
      try {
        detail = await client.call('readSpace', { spaceId: resolvedSpaceId }, { signal });
      } catch (error) {
        return failed({ text: safeFailureText(error?.message ?? 'The space lookup tool failed.') });
      }
      const space = detail?.space ?? detail ?? {};
      spaceName = clean(space.name) || resolvedSpaceId;
      spaceSummary = { id: resolvedSpaceId, name: spaceName };
      // Use already-fetched member list from readSpace.
      const members = Array.isArray(space.members) ? space.members : [];
      const memberById = new Map(members.map((member) => [member.userId, member]));
      return this._resolveUsersAndPropose({
        client, slots, slots_action: action, memberQueries, role,
        spaceSummary, spaceName, memberById, resolvedUserId, signal, nowMs,
      });
    }

    const ref = normalizeSpaceRef(slots?.spaceRef);
    let listed;
    try {
      listed = await client.call('listSpaces', {}, { signal });
    } catch (error) {
      return failed({ text: safeFailureText(error?.message ?? 'The space lookup tool failed.') });
    }
    const spaces = Array.isArray(listed?.spaces) ? listed.spaces : [];
    const spaceMatches = spaces.filter((space) => clean(space?.name).toLowerCase() === ref.toLowerCase());
    if (spaceMatches.length === 0) {
      return needsInput({ text: `I could not find a space called "${ref}". Which space do you mean?` });
    }
    if (spaceMatches.length > 1) {
      // Ambiguous space — offer durable candidate list.
      const candidates = spaceMatches.map((s) => ({ id: s.id, name: s.name }));
      const continuation = buildCandidateContinuation({
        kind: 'manage_space_members_space',
        candidates,
        nowMs: nowMs ?? Date.now(),
        slots,
      });
      return needsInput({
        text: `Multiple spaces are called "${ref}". Which one do you mean?\n${candidates.map((c, i) => `${i + 1}. ${c.name}`).join('\n')}`,
        continuation,
      });
    }
    spaceSummary = spaceMatches[0];
    spaceName = clean(spaceSummary.name) || ref;

    // 2. Read the current members (with roles) for the guards.
    let detail;
    try {
      detail = await client.call('readSpace', { spaceId: spaceSummary.id }, { signal });
    } catch (error) {
      return failed({ text: safeFailureText(error?.message ?? 'The space lookup tool failed.') });
    }
    const spaceDetail = detail?.space ?? detail ?? {};
    const members = Array.isArray(spaceDetail.members) ? spaceDetail.members : [];
    const memberById = new Map(members.map((member) => [member.userId, member]));

    return this._resolveUsersAndPropose({
      client, slots, slots_action: action, memberQueries, role,
      spaceSummary, spaceName, memberById, resolvedUserId, signal, nowMs,
    });
  },

  // Internal: resolves member queries and builds the plan proposal.
  // Called from both the direct path and the continuation-resumed path.
  async _resolveUsersAndPropose({
    client, slots, slots_action: action, memberQueries, role,
    spaceSummary, spaceName, memberById, resolvedUserId, signal, nowMs,
  }) {
    // 3. Resolve each member query to exactly one user (ambiguous/not-found → ask).
    const resolved = [];

    // If a single user was already resolved from a continuation, use it directly.
    if (resolvedUserId) {
      // The user is already known; look them up by id from a searchUsers call
      // (we need their full record for the member guards). We search by query that
      // will return at least this user; any that match are filtered to the exact id.
      // Simpler: call searchUsers with the first memberQuery to get the full record.
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
          // Ambiguous user — offer durable candidate list carrying the resolved space.
          const candidates = users.map((u) => ({ id: u.userId, name: u.name ?? u.email ?? u.userId }));
          const continuation = buildCandidateContinuation({
            kind: 'manage_space_members_user',
            candidates,
            nowMs: nowMs ?? Date.now(),
            slots,
            resolvedSpaceId: spaceSummary.id,
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
    let operation;
    let successText;
    if (action === 'add') {
      const toAdd = resolved.filter((user) => !memberById.has(user.userId));
      if (toAdd.length === 0) {
        return needsInput({ text: `Everyone you named is already in the "${spaceName}" space.` });
      }
      operation = {
        type: 'space.addMembers',
        summary: 'Update space members.',
        targetKind: 'existing_space',
        targetId: spaceSummary.id,
        payload: { members: toAdd.map((user) => ({ userId: user.userId, role })) },
      };
      successText = `I prepared a plan to add ${toAdd.length} ${toAdd.length === 1 ? 'member' : 'members'} to the "${spaceName}" space as ${role === 'editor' ? 'an editor' : 'a viewer'}. Review the plan before applying it.`;
    } else {
      const owners = resolved.filter((user) => clean(memberById.get(user.userId)?.role).toLowerCase() === 'owner');
      if (owners.length > 0) {
        // Owner = the deterministic proxy for self / last owner; never plan this.
        return needsInput({ text: `I can't remove the owner of the "${spaceName}" space.` });
      }
      const toRemove = resolved.filter((user) => memberById.has(user.userId));
      if (toRemove.length === 0) {
        return needsInput({ text: `No one you named is currently in the "${spaceName}" space.` });
      }
      operation = {
        type: 'space.removeMembers',
        summary: 'Update space members.',
        targetKind: 'existing_space',
        targetId: spaceSummary.id,
        payload: { userIds: toRemove.map((user) => user.userId) },
      };
      successText = `I prepared a plan to remove ${toRemove.length} ${toRemove.length === 1 ? 'member' : 'members'} from the "${spaceName}" space. Review the plan before applying it.`;
    }

    // 5. Propose and gate on a persisted plan id.
    let planResult;
    try {
      planResult = await client.call(
        'proposeAlbumOperations',
        { summary: 'Update space members.', operations: [operation] },
        { signal },
      );
    } catch (error) {
      return failed({ text: safeFailureText(error?.message ?? 'The planning tool failed.') });
    }

    return gatePlanResult({
      planResult,
      successText,
      successSummary: { workflowKind: KIND, target: spaceName, label: action },
    });
  },

  // Resolve a candidate pick from a continuation follow-up.
  // Returns { status:'matched', ctx } | { status:'needs_input'|'expired', text }.
  resumeContinuation({ pending, prompt, nowMs }) {
    const kind = pending?.kind;
    if (kind !== 'manage_space_members_space' && kind !== 'manage_space_members_user') {
      return { status: 'needs_input', text: 'I no longer have pending candidates for this request. Please start over.' };
    }

    const result = resumeFromCandidates({ pending, prompt, nowMs: nowMs ?? Date.now(), kind });
    if (result.status !== 'matched') {
      return result; // needs_input | expired | missing — pass through
    }

    const { choice } = result;
    if (kind === 'manage_space_members_space') {
      return {
        status: 'matched',
        ctx: {
          slots: pending.slots,
          resolvedSpaceId: choice.id,
        },
      };
    }
    // manage_space_members_user
    return {
      status: 'matched',
      ctx: {
        slots: pending.slots,
        resolvedSpaceId: pending.resolvedSpaceId,
        resolvedUserId: choice.id,
      },
    };
  },
});
