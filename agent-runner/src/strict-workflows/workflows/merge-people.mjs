import { resolvePerson, resumePersonFromCandidates } from '../person-resolver.mjs';
import { failed, needsInput } from '../protocol.mjs';
import { gatePlanResult, safeFailureText } from './plan-gate.mjs';

// merge_people (hybrid): merge one person (source) into another (kept person).
// The source person's faces are reassigned to the kept person, then the source
// is deleted — this is IRREVERSIBLE. Always proposes at High risk.
//
// Two patterns:
//   "merge <A> into <B>" — source=A, keep=B (explicit direction)
//   "merge <A> and <B>"  — ambiguous; convention: keep=LAST-named (B), source=A
//
// Two-stage person resolution mirrors manage-space-members.mjs:
//   1. Resolve source person (A). Ambiguous → continuation (merge_people_source).
//   2. Resolve kept person (B). Ambiguous → continuation (merge_people_keep).
//
// Same-person guard: if A and B resolve to the same personId → decline.
//
// Ordered AFTER rename_person / set_person_birthdate / hide_person in the registry
// so "rename X to Y" does not fall into this workflow. The distinct "merge" verb
// (plus "into" or "and" between two names) is fully disjoint.

const KIND = 'merge_people';

const clean = (value) => (typeof value === 'string' ? value.trim() : '');

// Match: "merge <A> into <B>" or "merge <A> and <B>"
// Capture sourceRef (A) and keepRef (B).
const MERGE_INTO_PATTERN =
  /\bmerge\s+(?<sourceRef>.+?)\s+into\s+(?<keepRef>.+?)(?:\s*[.?!]*)?$/i;
const MERGE_AND_PATTERN =
  /\bmerge\s+(?<nameA>.+?)\s+and\s+(?<nameB>.+?)(?:\s*[.?!]*)?$/i;

const stripTrailingPunct = (value) => clean(value).replace(/[.?!]+$/u, '').trim();

export const mergePeopleWorkflow = () => ({
  kind: KIND,
  flow: 'hybrid',

  match(prompt) {
    const text = clean(prompt);
    if (!text) {
      return undefined;
    }

    // "merge <A> into <B>"
    const intoMatch = MERGE_INTO_PATTERN.exec(text);
    if (intoMatch?.groups) {
      const sourceRef = stripTrailingPunct(intoMatch.groups.sourceRef);
      const keepRef = stripTrailingPunct(intoMatch.groups.keepRef);
      if (sourceRef && keepRef) {
        return { slots: { sourceRef, keepRef } };
      }
    }

    // "merge <A> and <B>" — keep = last-named (B)
    const andMatch = MERGE_AND_PATTERN.exec(text);
    if (andMatch?.groups) {
      const nameA = stripTrailingPunct(andMatch.groups.nameA);
      const nameB = stripTrailingPunct(andMatch.groups.nameB);
      if (nameA && nameB) {
        return { slots: { sourceRef: nameA, keepRef: nameB } };
      }
    }

    return undefined;
  },

  parseSlots(rawSlots) {
    const sourceRef = clean(rawSlots?.sourceRef);
    const keepRef = clean(rawSlots?.keepRef);
    if (!sourceRef || !keepRef) {
      return null;
    }
    return { sourceRef, keepRef };
  },

  async run({ client, slots, resolvedSourcePersonId, resolvedKeepPersonId, signal, nowMs }) {
    const sourceRef = clean(slots?.sourceRef);
    const keepRef = clean(slots?.keepRef);

    if (!sourceRef || !keepRef) {
      return needsInput({ text: 'Please tell me which two people to merge and which one to keep.' });
    }

    // 1. Resolve source person (A) — skip if already resolved from a continuation.
    let sourcePersonId;
    let sourceName;

    if (resolvedSourcePersonId) {
      sourcePersonId = resolvedSourcePersonId;
      sourceName = sourceRef;
    } else {
      const resolved = await resolvePerson({
        client,
        name: sourceRef,
        signal,
        nowMs: nowMs ?? Date.now(),
        kind: `${KIND}_source`,
        slots,
      });

      if (resolved.status === 'matched') {
        sourcePersonId = resolved.personId;
        sourceName = resolved.name;
      } else if (resolved.status === 'candidates') {
        return needsInput({ text: resolved.text, continuation: resolved.continuation });
      } else if (resolved.status === 'needs_input') {
        return needsInput({ text: resolved.text });
      } else {
        return failed({ text: safeFailureText(resolved.text) });
      }
    }

    // 2. Resolve kept person (B) — skip if already resolved from a continuation.
    let keepPersonId;
    let keepName;

    if (resolvedKeepPersonId) {
      keepPersonId = resolvedKeepPersonId;
      keepName = keepRef;
    } else {
      const resolved = await resolvePerson({
        client,
        name: keepRef,
        signal,
        nowMs: nowMs ?? Date.now(),
        kind: `${KIND}_keep`,
        slots: { ...slots, resolvedSourcePersonId: sourcePersonId },
      });

      if (resolved.status === 'matched') {
        keepPersonId = resolved.personId;
        keepName = resolved.name;
      } else if (resolved.status === 'candidates') {
        return needsInput({ text: resolved.text, continuation: resolved.continuation });
      } else if (resolved.status === 'needs_input') {
        return needsInput({ text: resolved.text });
      } else {
        return failed({ text: safeFailureText(resolved.text) });
      }
    }

    // 3. Same-person guard.
    if (sourcePersonId === keepPersonId) {
      return needsInput({
        text: 'Those appear to be the same person. Please specify two different people to merge.',
      });
    }

    // 4. Propose the merge plan.
    let planResult;
    try {
      planResult = await client.call(
        'proposeAlbumOperations',
        {
          summary: `Merge "${sourceName ?? sourceRef}" into "${keepName ?? keepRef}" (irreversible).`,
          operations: [
            {
              type: 'person.merge',
              summary: `Merge "${sourceName ?? sourceRef}" into "${keepName ?? keepRef}" — faces reassigned, source deleted (irreversible).`,
              targetKind: 'person',
              targetId: keepPersonId,
              riskLevel: 'high',
              payload: { sourcePersonIds: [sourcePersonId] },
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
      successText: `I prepared a plan to merge "${sourceName ?? sourceRef}" into "${keepName ?? keepRef}". This permanently merges the two people and cannot be undone — review before applying.`,
      successSummary: { workflowKind: KIND, keepName: keepName ?? keepRef, mergeName: sourceName ?? sourceRef },
    });
  },

  // Resolve a candidate pick from a continuation follow-up.
  // Handles both merge_people_source and merge_people_keep continuation kinds.
  resumeContinuation({ pending, prompt, nowMs }) {
    const kind = pending?.kind;
    if (kind !== `${KIND}_source` && kind !== `${KIND}_keep`) {
      return {
        status: 'needs_input',
        text: 'I no longer have pending candidates for this request. Please start over.',
      };
    }

    const result = resumePersonFromCandidates({
      pending,
      prompt,
      nowMs: nowMs ?? Date.now(),
      kind,
    });

    if (result.status !== 'matched') {
      return result; // needs_input | expired | missing — pass through
    }

    if (kind === `${KIND}_source`) {
      return {
        status: 'matched',
        ctx: {
          slots: result.slots,
          resolvedSourcePersonId: result.personId,
        },
      };
    }

    // merge_people_keep: source was already resolved and stored in pending.slots
    return {
      status: 'matched',
      ctx: {
        slots: result.slots,
        resolvedSourcePersonId: pending.slots?.resolvedSourcePersonId,
        resolvedKeepPersonId: result.personId,
      },
    };
  },
});
