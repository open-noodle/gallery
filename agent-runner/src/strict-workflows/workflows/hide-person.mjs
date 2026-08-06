import { SUBJECTIVE_PATTERN } from '../asset-source-resolver.mjs';
import { resolvePerson, resumePersonFromCandidates } from '../person-resolver.mjs';
import { failed, needsInput } from '../protocol.mjs';
import { gatePlanResult, safeFailureText } from './plan-gate.mjs';

// hide_person (hybrid): hide or unhide a person from the People view.
// `hide` → isHidden: true (person disappears from People view)
// `unhide` / `show` → isHidden: false (person reappears)
// For unhide, includeHidden:true is passed to searchPeople so a hidden person can be found.

const KIND = 'hide_person';

const clean = (value) => (typeof value === 'string' ? value.trim() : '');
const stripTrailingPunct = (value) => clean(value).replace(/[.?!]+$/u, '').trim();

// Match: hide <personRef> [from my People list / from People]
// Match: unhide|show <personRef>
const HIDE_PATTERN = /^\s*hide\s+(?<personRef>.+?)(?:\s+from\s+(?:my\s+)?(?:people\s*list|people))?\s*$/i;
const UNHIDE_PATTERN = /^\s*(?:unhide|un-?hide|show)\s+(?<personRef>.+?)\s*$/i;

const detectVerb = (text) => {
  const clean_text = clean(text);
  if (UNHIDE_PATTERN.test(clean_text)) {
    return 'unhide';
  }
  if (HIDE_PATTERN.test(clean_text)) {
    return 'hide';
  }
  return null;
};

const extractPersonRef = (text) => {
  const clean_text = clean(text);
  const unhide = UNHIDE_PATTERN.exec(clean_text);
  if (unhide?.groups) {
    return stripTrailingPunct(unhide.groups.personRef);
  }
  const hide = HIDE_PATTERN.exec(clean_text);
  if (hide?.groups) {
    return stripTrailingPunct(hide.groups.personRef);
  }
  return null;
};

// Decline if the ref contains a container noun (album/space).
const mentionsContainer = (ref) => /\b(?:album|space)\b/i.test(clean(ref));

// "show" is an unhide verb but overloads with photo-display intents ("show me the
// good ones", "show me my photos"). Keep the regex fast-path conservative: decline
// subjective refs and display-pronoun prefixes — a real unhide names a person.
const DISPLAY_PREFIX = /^(?:me|us|them|all|everything|my)\b/i;
const isNotAPerson = (ref) => SUBJECTIVE_PATTERN.test(clean(ref)) || DISPLAY_PREFIX.test(clean(ref));

export const hidePersonWorkflow = () => ({
  kind: KIND,
  flow: 'hybrid',

  match(prompt) {
    const text = clean(prompt);
    if (!text) {
      return undefined;
    }

    const verb = detectVerb(text);
    if (!verb) {
      return undefined;
    }

    const personRef = extractPersonRef(text);
    if (!personRef || mentionsContainer(personRef) || isNotAPerson(personRef)) {
      return undefined;
    }

    return { slots: { personRef, verb } };
  },

  parseSlots(rawSlots) {
    const personRef = clean(rawSlots?.personRef);
    const verb = clean(rawSlots?.verb);
    if (!personRef || (verb !== 'hide' && verb !== 'unhide')) {
      return null;
    }
    return { personRef, verb };
  },

  async run({ client, slots, resolvedPersonId, signal, nowMs }) {
    const personRef = clean(slots?.personRef);
    const verb = clean(slots?.verb);

    if (!personRef || (verb !== 'hide' && verb !== 'unhide')) {
      return needsInput({ text: "Please tell me which person to hide or unhide." });
    }

    const isHidden = verb === 'hide';
    // For unhide we must include hidden people in the search.
    const includeHidden = !isHidden;

    // Resolve person.
    let personId;
    let personName;

    if (resolvedPersonId) {
      personId = resolvedPersonId;
      personName = personRef;
    } else {
      const resolved = await resolvePerson({
        client,
        name: personRef,
        includeHidden,
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

    const actionVerb = isHidden ? 'hide' : 'unhide';
    const summary = `${isHidden ? 'Hide' : 'Unhide'} ${personName} from the People view.`;

    let planResult;
    try {
      planResult = await client.call(
        'proposeAlbumOperations',
        {
          summary,
          operations: [
            {
              type: 'person.update',
              summary,
              targetKind: 'person',
              targetId: personId,
              riskLevel: 'low',
              payload: { isHidden },
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
      successText: `I prepared a plan to ${actionVerb} "${personName}" ${isHidden ? 'from' : 'in'} the People view. Review the plan before applying it.`,
      successSummary: { workflowKind: KIND, personName, isHidden },
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
