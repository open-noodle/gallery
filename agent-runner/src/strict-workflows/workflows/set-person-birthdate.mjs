import { resolvePerson, resumePersonFromCandidates } from '../person-resolver.mjs';
import { failed, needsInput } from '../protocol.mjs';
import { gatePlanResult, safeFailureText } from './plan-gate.mjs';

// set_person_birthdate (hybrid): set a person's birthday/birthdate.
// Accepts ISO YYYY-MM-DD and natural English dates like "May 1 1990" or "1 May 1990".

const KIND = 'set_person_birthdate';

const clean = (value) => (typeof value === 'string' ? value.trim() : '');
const stripTrailingPunct = (value) => clean(value).replace(/[.?!]+$/u, '').trim();

// Matches: set <personRef>'s (birthday|birthdate|date of birth) to <date>
const PATTERN =
  /\bset\s+(?<personRef>.+?)'s?\s+(?:birthday|birthdate|date\s+of\s+birth)\s+to\s+(?<dateStr>.+?)$/i;

// Month names → zero-padded number
const MONTH_MAP = {
  january: '01', jan: '01',
  february: '02', feb: '02',
  march: '03', mar: '03',
  april: '04', apr: '04',
  may: '05',
  june: '06', jun: '06',
  july: '07', jul: '07',
  august: '08', aug: '08',
  september: '09', sep: '09', sept: '09',
  october: '10', oct: '10',
  november: '11', nov: '11',
  december: '12', dec: '12',
};

/**
 * Parse a date string into an ISO YYYY-MM-DD string.
 * Accepts:
 *   - YYYY-MM-DD (ISO)
 *   - "May 1 1990" / "May 1, 1990"
 *   - "1 May 1990" / "1st May 1990"
 * Returns null if unparseable.
 * Returns the string 'future' if the date is in the future.
 */
export const parseDateString = (raw) => {
  const s = stripTrailingPunct(clean(raw));
  if (!s) {
    return null;
  }

  // ISO date: YYYY-MM-DD
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (isoMatch) {
    const [, y, m, d] = isoMatch;
    const yr = Number(y);
    const mo = Number(m);
    const dy = Number(d);
    if (mo < 1 || mo > 12 || dy < 1 || dy > 31 || yr < 1000 || yr > 9999) {
      return null;
    }
    const date = new Date(`${y}-${m}-${d}`);
    if (Number.isNaN(date.getTime())) {
      return null;
    }
    if (date > new Date()) {
      return 'future';
    }
    return `${y}-${m}-${d}`;
  }

  // "Month Day Year" e.g. "May 1 1990" or "May 1, 1990"
  const mdy = /^([a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/i.exec(s);
  if (mdy) {
    const [, mon, day, yr] = mdy;
    const m = MONTH_MAP[mon.toLowerCase()];
    if (!m) {
      return null;
    }
    const d = String(Number(day)).padStart(2, '0');
    const date = new Date(`${yr}-${m}-${d}`);
    if (Number.isNaN(date.getTime())) {
      return null;
    }
    if (date > new Date()) {
      return 'future';
    }
    return `${yr}-${m}-${d}`;
  }

  // "Day Month Year" e.g. "1 May 1990" or "1st May 1990"
  const dmy = /^(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+)\s+(\d{4})$/i.exec(s);
  if (dmy) {
    const [, day, mon, yr] = dmy;
    const m = MONTH_MAP[mon.toLowerCase()];
    if (!m) {
      return null;
    }
    const d = String(Number(day)).padStart(2, '0');
    const date = new Date(`${yr}-${m}-${d}`);
    if (Number.isNaN(date.getTime())) {
      return null;
    }
    if (date > new Date()) {
      return 'future';
    }
    return `${yr}-${m}-${d}`;
  }

  return null;
};

export const setPersonBirthdateWorkflow = () => ({
  kind: KIND,
  flow: 'hybrid',

  match(prompt) {
    const text = clean(prompt);
    if (!text) {
      return undefined;
    }

    const m = PATTERN.exec(text);
    if (!m?.groups) {
      return undefined;
    }

    const personRef = clean(m.groups.personRef);
    const dateStr = clean(m.groups.dateStr);

    if (!personRef || !dateStr) {
      return undefined;
    }

    return { slots: { personRef, dateStr } };
  },

  parseSlots(rawSlots) {
    const personRef = clean(rawSlots?.personRef);
    const dateStr = clean(rawSlots?.dateStr);
    if (!personRef || !dateStr) {
      return null;
    }
    return { personRef, dateStr };
  },

  async run({ client, slots, resolvedPersonId, signal, nowMs }) {
    const personRef = clean(slots?.personRef);
    const dateStr = clean(slots?.dateStr);

    if (!personRef || !dateStr) {
      return needsInput({ text: "Please tell me whose birthday you'd like to set and the date." });
    }

    // Parse the date.
    const parsed = parseDateString(dateStr);
    if (!parsed) {
      return needsInput({
        text: `I couldn't parse "${dateStr}" as a date. Please use a format like "1990-05-01" or "May 1 1990".`,
      });
    }
    if (parsed === 'future') {
      return needsInput({ text: 'The birth date cannot be in the future. Please provide a past date.' });
    }

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
          summary: `Set ${personName}'s birthday to ${parsed}.`,
          operations: [
            {
              type: 'person.update',
              summary: `Set ${personName}'s birthday to ${parsed}.`,
              targetKind: 'person',
              targetId: personId,
              riskLevel: 'low',
              payload: { birthDate: parsed },
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
      successText: `I prepared a plan to set ${personName}'s birthday to ${parsed}. Review the plan before applying it.`,
      successSummary: { workflowKind: KIND, personName, birthDate: parsed },
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
