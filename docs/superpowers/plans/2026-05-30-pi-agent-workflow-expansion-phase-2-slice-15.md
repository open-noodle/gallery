# Pi Agent Workflow Expansion (Phase 2) — Slice 15 Implementation Plan

> **For agentic workers:** Implement test-first. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add the `create_space_from_source` (hybrid) router — `match()`/`parseSlots()`
recognizing "make/create a `<Name>` space of/from `<source>`" (and "space called/named
`<Name>`"), extracting `{ sourceDescription, spaceName? }`, declining subjective sources,
never colliding with album-from-source / rename-describe-space / member-add / photo-add.
`run()` is a stub (Slice 16); registration is Slice 17.

**Spec scope:** Slice 15 of
`docs/superpowers/specs/2026-05-30-pi-agent-workflow-expansion-phase-2-design.md`.

**Tech stack:** Node.js ESM, `node:test`, `mise exec -- pnpm --dir agent-runner test`.

**Files (new):**

- `agent-runner/src/strict-workflows/workflows/create-space-from-source.mjs`
- `agent-runner/src/strict-workflows/workflows/create-space-from-source.test.mjs`

## Three name forms (key design)

- TRAILING: "make a space of `<source>` called/named/titled `<Name>`" — `space` right
  after the article.
- INLINE: "make a `<Name>` space of `<source>`" — `<Name>` before `space`. A filler word
  ("shared", "new", "a", …) captured here is treated as NO name.
- NO-NAME: "make a [shared] space of `<source>`".

Try TRAILING → INLINE → NO-NAME. The forms are mutually exclusive on whether `space` sits
right after the article. **No `TRIP_LIKE` decline** (spaces have no trip workflow — a
trip-like source resolves via recency/date or hands off at the clean-source gate).

## Implementation — full module

```js
import { SUBJECTIVE_PATTERN } from '../asset-source-resolver.mjs';
import { handoffOpen } from '../protocol.mjs';

const KIND = 'create_space_from_source';
const DEFAULT_NAME = 'New Space';

const clean = (value) => (typeof value === 'string' ? value.trim() : '');
const cleanSource = (value) =>
  clean(value)
    .replace(/[.?!]+$/u, '')
    .trim();
const stripQuotes = (value) =>
  clean(value)
    .replace(/^["'“”‘’]+/, '')
    .replace(/["'“”‘’]+$/, '')
    .trim();

const declinesSource = (source) => SUBJECTIVE_PATTERN.test(source);

// An inline "name" that is really a filler adjective is NOT a name.
const FILLER_NAMES = new Set(['shared', 'new', 'a', 'an', 'the', 'my', 'this', 'that', 'our']);

const FORM_TRAILING_NAME =
  /\b(?:make|create|build)\s+(?:an?\s+)?(?:shared\s+)?space\s+(?:of|from|with|out\s+of)\s+(?<source>.+?)\s+(?:called|named|titled)\s+(?<name>.+)$/i;
const FORM_INLINE_NAME =
  /\b(?:make|create|build)\s+(?:an?\s+)?(?:shared\s+)?(?<name>.+?)\s+space\s+(?:of|from|with|out\s+of)\s+(?<source>.+)$/i;
const FORM_NO_NAME =
  /\b(?:make|create|build)\s+(?:an?\s+)?(?:shared\s+)?space\s+(?:of|from|with|out\s+of)\s+(?<source>.+)$/i;

const tryMatch = (prompt) => {
  let match = FORM_TRAILING_NAME.exec(prompt);
  let spaceName;
  if (match?.groups) {
    spaceName = match.groups.name;
  } else {
    match = FORM_INLINE_NAME.exec(prompt);
    if (match?.groups) {
      const candidate = clean(match.groups.name);
      spaceName = FILLER_NAMES.has(candidate.toLowerCase()) ? undefined : candidate;
    } else {
      match = FORM_NO_NAME.exec(prompt);
    }
  }
  if (!match?.groups) {
    return undefined;
  }
  const sourceDescription = cleanSource(match.groups.source);
  if (!sourceDescription || declinesSource(sourceDescription)) {
    return undefined;
  }
  const name = spaceName ? stripQuotes(spaceName) : '';
  return name ? { sourceDescription, spaceName: name } : { sourceDescription };
};

export const createSpaceFromSourceWorkflow = () => ({
  kind: KIND,
  flow: 'hybrid',

  match(prompt) {
    const text = clean(prompt);
    if (!text) {
      return undefined;
    }
    const matched = tryMatch(text);
    return matched ? { slots: matched } : undefined;
  },

  parseSlots(rawSlots) {
    const sourceDescription = cleanSource(rawSlots?.sourceDescription);
    if (!sourceDescription) {
      return null;
    }
    const name = stripQuotes(rawSlots?.spaceName);
    return { sourceDescription, spaceName: name || DEFAULT_NAME };
  },

  // Execution lands in Slice 16.
  async run() {
    return handoffOpen({ reason: 'create_space_from_source execution is implemented in Slice 16.' });
  },
});
```

## TDD steps

### Task 1: tests (red)

Create `create-space-from-source.test.mjs`. `const wf = createSpaceFromSourceWorkflow();`

- [ ] match cases:
  - `'make a Family space of my newest 50 photos'` → `{ slots:{ sourceDescription:'my newest 50 photos', spaceName:'Family' } }`
  - `'create a space from my newest 50 photos called Trips'` → `{ slots:{ sourceDescription:'my newest 50 photos', spaceName:'Trips' } }`
  - `'make a space of my newest 20 photos titled "South Africa"'` → `{ slots:{ sourceDescription:'my newest 20 photos', spaceName:'South Africa' } }`
  - `'create a space from my 2024 photos'` → `{ slots:{ sourceDescription:'my 2024 photos' } }`
  - `'create a shared space of my newest 50 photos'` → `{ slots:{ sourceDescription:'my newest 50 photos' } }` ("shared" tolerated, not a name)
  - `'make an album of my newest 50 photos'` → `undefined` (album noun)
  - `'create a space of the best photos from last weekend'` → `undefined` (subjective)
  - `'rename the Family space to Family 2026'` → `undefined` (rename verb)
  - `'add Alex to the Family space'` → `undefined` (member add)
  - `'add my newest 20 photos to the Family space'` → `undefined` (photo-add into existing space)
  - `''` → `undefined`
  - `'make a space of my photos.'` → `{ slots:{ sourceDescription:'my photos' } }` (trailing punctuation)
- [ ] parseSlots cases:
  - `parseSlots({ sourceDescription:'my newest 50 photos' })` → `{ sourceDescription:'my newest 50 photos', spaceName:'New Space' }`
  - `parseSlots({ sourceDescription:'my newest 50 photos', spaceName:'"Trips"' }).spaceName` === `'Trips'`
  - `parseSlots({ sourceDescription:'   ' })` → `null`
  - `parseSlots({ spaceName:'X' })` → `null` (missing source)
- [ ] identity: `wf.kind==='create_space_from_source'`, `wf.flow==='hybrid'`, `typeof wf.run==='function'`
- [ ] Run `mise exec -- pnpm --dir agent-runner test` → RED (module doesn't exist).

### Task 2: implement (green)

- [ ] Create the module. Run `mise exec -- pnpm --dir agent-runner test` → all green.

## Edge cases (covered above)

- "space" must be the matched noun; "album" never matches.
- "shared space" tolerated; "shared" is NOT captured as a name (FILLER_NAMES).
- inline name (pre-"space") vs trailing called/named/titled vs no-name — all three forms.
- subjective source declines; NO `TRIP_LIKE` decline (a trip-like space request routes in
  and the resolver hands off at run-time — Slice 16).
- trailing punctuation stripped; quotes stripped from the name.
- `parseSlots` defaults the name to "New Space".

## Acceptance

- `match`/`parseSlots` per the tests; `run` is a present stub.
- `mise exec -- pnpm --dir agent-runner test` green; not registered (Slice 17).

## Commit

- One commit: `feat(agent): add create_space_from_source router (3 name forms, no trip decline) (phase 2 slice 15)`.
