import { buildCandidateContinuation, resumeFromCandidates } from '../candidate-disambiguation.mjs';
import { failed, needsInput } from '../protocol.mjs';
import { gatePlanResult, safeFailureText } from './plan-gate.mjs';

// change_member_role (strict): "make <user> an editor/viewer in <space>" /
// "change <user>'s role to <role> in <space>". The role word is the gate, so a
// non-role "make X … in Y" never matches.
//
// Guards (deterministic): promotion to owner is refused (updateMemberRole accepts
// editor/viewer only); changing the OWNER's role is blocked (the deterministic
// proxy for self-demotion + last-owner demotion; server backstop: "Pi cannot
// remove or demote the owner"); a no-op (current == requested) never plans; a
// non-member asks for input.

const KIND = 'change_member_role';

const roleArticle = (role) => (role === 'editor' ? 'an editor' : 'a viewer');

const clean = (value) => (typeof value === 'string' ? value.trim() : '');

const normalizeSpaceRef = (value) =>
  clean(value)
    .replace(/^(?:the|my|this|that|our)\s+/i, '')
    .replace(/^shared\s+space\s+/i, '')
    .replace(/\s+(?:shared\s+)?space$/i, '')
    .trim();

// Decline when the target ref mentions "album" — those belong to change_album_member_role.
const mentionsAlbum = (text) => /\balbum\b/i.test(clean(text));

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
  `\\bmake\\s+(?<member>.+?)\\s+(?:an?\\s+|the\\s+)?(?<role>${ROLE_ALT})\\s+(?:in|of|on|for)\\s+(?<space>.+)$`,
  'i',
);
const CHANGE_ROLE_PATTERN = new RegExp(
  `\\b(?:change|set|update)\\s+(?<member>.+?)(?:'s|s')?\\s+role\\s+to\\s+(?:an?\\s+|the\\s+)?(?<role>${ROLE_ALT})\\s+(?:in|of|on|for)\\s+(?<space>.+)$`,
  'i',
);
const CHANGE_TO_PATTERN = new RegExp(
  `\\b(?:change|set|update|make)\\s+(?<member>.+?)\\s+(?:in)?to\\s+(?:an?\\s+|the\\s+)?(?<role>${ROLE_ALT})\\s+(?:in|of|on|for)\\s+(?<space>.+)$`,
  'i',
);

const PATTERNS = [MAKE_PATTERN, CHANGE_ROLE_PATTERN, CHANGE_TO_PATTERN];

export const changeMemberRoleWorkflow = () => ({
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
      const rawSpace = clean(m.groups.space);
      // Decline album targets — change_album_member_role owns those.
      if (mentionsAlbum(rawSpace)) {
        return undefined;
      }
      const spaceRef = normalizeSpaceRef(rawSpace);
      if (role && memberQuery && spaceRef) {
        return { slots: { memberQuery, role, spaceRef } };
      }
    }
    return undefined;
  },

  parseSlots(rawSlots) {
    const memberQuery = clean(rawSlots?.memberQuery);
    const role = normalizeRole(rawSlots?.role);
    const spaceRef = normalizeSpaceRef(rawSlots?.spaceRef);
    if (!memberQuery || !role || !spaceRef) {
      return null;
    }
    return { memberQuery, role, spaceRef };
  },

  async run({ client, slots, resolvedSpaceId, resolvedUserId, signal, nowMs }) {
    const requestedRole = clean(slots?.role).toLowerCase();
    const memberQuery = clean(slots?.memberQuery);

    // Owner is not assignable via a role change.
    if (requestedRole === 'owner') {
      return needsInput({
        text: "I can set a member's role to editor or viewer, not owner. Which role should I use?",
      });
    }

    // 1. Resolve the space (skip when already resolved via continuation).
    let spaceSummary;
    let spaceName;
    let memberById;

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
      const members = Array.isArray(space.members) ? space.members : [];
      memberById = new Map(members.map((member) => [member.userId, member]));
    } else {
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
          kind: 'change_member_role_space',
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
      const space = detail?.space ?? detail ?? {};
      const members = Array.isArray(space.members) ? space.members : [];
      memberById = new Map(members.map((member) => [member.userId, member]));
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
        // Ambiguous user — offer durable candidate list carrying the resolved space.
        const candidates = users.map((u) => ({ id: u.userId, name: u.name ?? u.email ?? u.userId }));
        const continuation = buildCandidateContinuation({
          kind: 'change_member_role_user',
          candidates,
          nowMs: nowMs ?? Date.now(),
          slots,
          resolvedSpaceId: spaceSummary.id,
        });
        return needsInput({
          text: `More than one person matches "${memberQuery}". Who do you mean?\n${candidates.map((c, i) => `${i + 1}. ${c.name}`).join('\n')}`,
          continuation,
        });
      }
      user = users[0];
    }

    const displayName = clean(user.name) || memberQuery;

    // 4. Guards from the readSpace member set.
    const member = memberById.get(user.userId);
    if (!member) {
      return needsInput({ text: `${displayName} is not a member of the "${spaceName}" space.` });
    }
    const currentRole = clean(member.role).toLowerCase();
    if (currentRole === 'owner') {
      // Owner = the deterministic proxy for self / last owner; never plan this.
      return needsInput({ text: `I can't change the role of the owner of the "${spaceName}" space.` });
    }
    if (currentRole === requestedRole) {
      return needsInput({ text: `${displayName} is already ${roleArticle(requestedRole)} in the "${spaceName}" space.` });
    }

    // 5. Propose and gate on a persisted plan id.
    let planResult;
    try {
      planResult = await client.call(
        'proposeAlbumOperations',
        {
          summary: 'Update a space member role.',
          operations: [
            {
              type: 'space.updateMemberRole',
              summary: 'Update a space member role.',
              targetKind: 'existing_space',
              targetId: spaceSummary.id,
              payload: { userIds: [user.userId], role: requestedRole },
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
      successText: `I prepared a plan to make ${displayName} ${roleArticle(requestedRole)} in the "${spaceName}" space. Review the plan before applying it.`,
      successSummary: { workflowKind: KIND, target: spaceName, label: requestedRole },
    });
  },

  // Resolve a candidate pick from a continuation follow-up.
  // Returns { status:'matched', ctx } | { status:'needs_input'|'expired', text }.
  resumeContinuation({ pending, prompt, nowMs }) {
    const kind = pending?.kind;
    if (kind !== 'change_member_role_space' && kind !== 'change_member_role_user') {
      return { status: 'needs_input', text: 'I no longer have pending candidates for this request. Please start over.' };
    }

    const result = resumeFromCandidates({ pending, prompt, nowMs: nowMs ?? Date.now(), kind });
    if (result.status !== 'matched') {
      return result; // needs_input | expired | missing — pass through
    }

    const { choice } = result;
    if (kind === 'change_member_role_space') {
      return {
        status: 'matched',
        ctx: {
          slots: pending.slots,
          resolvedSpaceId: choice.id,
        },
      };
    }
    // change_member_role_user
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
