import { resolvePerson, resumePersonFromCandidates } from '../person-resolver.mjs';
import { failed, needsInput } from '../protocol.mjs';
import { gatePlanResult, safeFailureText } from './plan-gate.mjs';

// rename_person (hybrid): rename a person in the People view.
// This workflow REQUIRES the `rename … to …` pattern with a person-ish ref.
// It is ordered AFTER rename_or_describe_album and rename_or_describe_space so
// those container workflows win their "album" / "space" refs. People rename
// requires neither keyword — it matches when no container noun is present.

const KIND = 'rename_person';

const clean = (value) => (typeof value === 'string' ? value.trim() : '');

// Matches: rename <personRef> to <newName>
// Deliberately fails when the ref contains "album" or "space" — those are
// container nouns and belong to the album/space rename workflows.
const RENAME_PATTERN =
  /\b(?:rename|re-?name)\s+(?<personRef>.+?)\s+to\s+(?<newName>.+?)$/i;

const stripTrailingPunct = (value) => clean(value).replace(/[.?!]+$/u, '').trim();

const mentionsContainer = (ref) =>
  /\b(?:album|space)\b/i.test(clean(ref));

export const renamePersonWorkflow = () => ({
  kind: KIND,
  flow: 'hybrid',

  match(prompt) {
    const text = clean(prompt);
    if (!text) {
      return undefined;
    }

    const m = RENAME_PATTERN.exec(text);
    if (!m?.groups) {
      return undefined;
    }

    const personRef = clean(m.groups.personRef);
    const newName = stripTrailingPunct(m.groups.newName);

    // Decline when the ref contains a container noun — those have their own workflows.
    if (mentionsContainer(personRef)) {
      return undefined;
    }

    if (!personRef || !newName) {
      return undefined;
    }

    return { slots: { personRef, newName } };
  },

  parseSlots(rawSlots) {
    const personRef = clean(rawSlots?.personRef);
    const newName = clean(rawSlots?.newName);
    if (!personRef || !newName) {
      return null;
    }
    return { personRef, newName };
  },

  async run({ client, slots, resolvedPersonId, signal, nowMs }) {
    const personRef = clean(slots?.personRef);
    const newName = clean(slots?.newName);

    if (!personRef || !newName) {
      return needsInput({ text: 'Please tell me who to rename and what the new name should be.' });
    }

    // If already resolved via continuation, skip the search.
    let personId;
    let personName;

    if (resolvedPersonId) {
      personId = resolvedPersonId;
      personName = personRef;
    } else {
      const resolved = await resolvePerson({
        client,
        name: personRef,
        signal,
        nowMs: nowMs ?? Date.now(),
        kind: `${KIND}_person`,
        slots,
      });

      if (resolved.status === 'matched') {
        personId = resolved.personId;
        personName = resolved.name;
      } else if (resolved.status === 'candidates') {
        return needsInput({ text: resolved.text, continuation: resolved.continuation });
      } else if (resolved.status === 'needs_input') {
        return needsInput({ text: resolved.text });
      } else {
        return failed({ text: safeFailureText(resolved.text) });
      }
    }

    let planResult;
    try {
      planResult = await client.call(
        'proposeAlbumOperations',
        {
          summary: `Rename person "${personName}" to "${newName}".`,
          operations: [
            {
              type: 'person.update',
              summary: `Rename person "${personName}" to "${newName}".`,
              targetKind: 'person',
              targetId: personId,
              riskLevel: 'low',
              payload: { name: newName },
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
      successText: `I prepared a plan to rename "${personName}" to "${newName}". Review the plan before applying it.`,
      successSummary: { workflowKind: KIND, personName, newName },
    });
  },

  resumeContinuation({ pending, prompt, nowMs }) {
    if (pending?.kind !== `${KIND}_person`) {
      return {
        status: 'needs_input',
        text: 'I no longer have pending candidates for this request. Please start over.',
      };
    }

    const result = resumePersonFromCandidates({
      pending,
      prompt,
      nowMs: nowMs ?? Date.now(),
      kind: `${KIND}_person`,
    });

    if (result.status !== 'matched') {
      return result;
    }

    return {
      status: 'matched',
      ctx: {
        slots: result.slots,
        resolvedPersonId: result.personId,
      },
    };
  },
});
