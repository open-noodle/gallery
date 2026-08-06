# Pi Agent Workflow Expansion (Phase 2) — Slice 13 Implementation Plan

> **For agentic workers:** Implement test-first. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add the `manage_space_assets` (hybrid) router — `match()`/`parseSlots()` that
steals ONLY "add/remove `<photo-source>` to/from the `<space>` space" (requires BOTH the
space keyword AND a photo-ish source), declining member adds, album adds, and
subjective/trip sources. `run()` is a stub (Slice 14); registration is Slice 14.

**Spec scope:** Slice 13 of
`docs/superpowers/specs/2026-05-30-pi-agent-workflow-expansion-phase-2-design.md`.

**Tech stack:** Node.js ESM, `node:test`, `mise exec -- pnpm --dir agent-runner test`.

**Files (new):**

- `agent-runner/src/strict-workflows/workflows/manage-space-assets.mjs`
- `agent-runner/src/strict-workflows/workflows/manage-space-assets.test.mjs`

## Key regex insight

The space group is anchored to end in "space" (`(?<space>.+?space)`), so the source binds
the FINAL "to/from `<…> space`" AND a non-space target ("to Family", "to the Trips album")
simply fails to match — no separate "no space keyword" check needed at the pattern level.

## Implementation — full module

```js
import { SUBJECTIVE_PATTERN } from '../asset-source-resolver.mjs';
import { handoffOpen } from '../protocol.mjs';

const KIND = 'manage_space_assets';

const clean = (value) => (typeof value === 'string' ? value.trim() : '');
const cleanSource = (value) =>
  clean(value)
    .replace(/[.?!]+$/u, '')
    .trim();

const normalizeSpaceRef = (value) =>
  clean(value)
    .replace(/^(?:the|my|this|that|our)\s+/i, '')
    .replace(/^shared\s+space\s+/i, '')
    .replace(/\s+(?:shared\s+)?space$/i, '')
    .trim();

const mentionsSpace = (ref) => /\bspaces?\b/i.test(clean(ref));

// REQUIRE a photo-ish source (the inverse of manage_space_members' decline) so a bare
// member name ("Alex", "Alex and Sam") never matches.
const PHOTO_SOURCE_RE =
  /\b(?:photos?|pics?|pictures?|images?|videos?|clips?|screenshots?|snaps?|shots?|newest|latest|most\s+recent)\b/i;
const looksLikePhotoSource = (text) => PHOTO_SOURCE_RE.test(clean(text));

const tripSourcePattern = /\brecent\s+trip\b/i;
const declinesSource = (source) => SUBJECTIVE_PATTERN.test(source) || tripSourcePattern.test(source);

// Infer add/remove from the prompt verb when the LLM omits the action slot.
const inferAction = (prompt) => {
  const text = clean(prompt).toLowerCase();
  if (/\b(?:remove|take\s+out|drop|delete|pull)\b/.test(text)) {
    return 'remove';
  }
  if (/\b(?:add|put|move|include|stick)\b/.test(text)) {
    return 'add';
  }
  return undefined;
};

const ADD_PATTERN = /\b(?:add|put|move|stick)\s+(?<source>.+)\s+(?:to|into)\s+(?<space>.+?space)\b/i;
const REMOVE_PATTERN = /\b(?:remove|take|pull)\s+(?<source>.+)\s+(?:from|out\s+of)\s+(?<space>.+?space)\b/i;

const VALID_ACTIONS = new Set(['add', 'remove']);

const tryMatch = (prompt) => {
  let action;
  let match = ADD_PATTERN.exec(prompt);
  if (match?.groups) {
    action = 'add';
  } else {
    match = REMOVE_PATTERN.exec(prompt);
    if (match?.groups) {
      action = 'remove';
    }
  }
  if (!match?.groups) {
    return undefined;
  }
  const sourceDescription = cleanSource(match.groups.source);
  const spaceText = clean(match.groups.space);
  if (!sourceDescription || !mentionsSpace(spaceText)) {
    return undefined;
  }
  if (!looksLikePhotoSource(sourceDescription) || declinesSource(sourceDescription)) {
    return undefined; // member add / subjective / recent-trip → not ours
  }
  const spaceRef = normalizeSpaceRef(spaceText);
  return spaceRef ? { action, spaceRef, sourceDescription } : undefined;
};

export const manageSpaceAssetsWorkflow = () => ({
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

  parseSlots(rawSlots, prompt) {
    let action = clean(rawSlots?.action).toLowerCase();
    if (!VALID_ACTIONS.has(action)) {
      action = inferAction(prompt) ?? '';
    }
    if (!VALID_ACTIONS.has(action)) {
      return null;
    }
    const spaceRef = normalizeSpaceRef(rawSlots?.spaceRef);
    const sourceDescription = cleanSource(rawSlots?.sourceDescription);
    if (!spaceRef || !sourceDescription) {
      return null;
    }
    return { action, spaceRef, sourceDescription };
  },

  // Execution lands in Slice 14.
  async run() {
    return handoffOpen({ reason: 'manage_space_assets execution is implemented in Slice 14.' });
  },
});
```

## TDD steps

### Task 1: tests (red)

Create `manage-space-assets.test.mjs`. `const wf = manageSpaceAssetsWorkflow();`

- [ ] match cases:
  - `'add my newest 20 photos to the Family space'` → `{ slots:{ action:'add', spaceRef:'Family', sourceDescription:'my newest 20 photos' } }`
  - `'remove my screenshots from the Family space'` → `{ slots:{ action:'remove', spaceRef:'Family', sourceDescription:'my screenshots' } }`
  - `'add my photos from 2024 to the Trips space'` → `{ slots:{ action:'add', spaceRef:'Trips', sourceDescription:'my photos from 2024' } }`
  - `'add Alex to the Family space'` → `undefined` (member add — not a photo source)
  - `'add Alex and Sam to the Family space'` → `undefined` (members)
  - `'add my newest 20 photos to Family'` → `undefined` (no "space" keyword)
  - `'add my newest 20 photos to the Trips album'` → `undefined` (album keyword, no space)
  - `'archive my newest 50 photos'` → `undefined` (no space target)
  - `'remove my screenshots from Family'` → `undefined` (no "space" keyword)
  - `''` → `undefined`
  - `'add the best photos to the Family space'` → `undefined` (subjective source)
- [ ] parseSlots cases:
  - `parseSlots({ action:'add', spaceRef:'the Family space', sourceDescription:'my newest 20 photos' })` → `{ action:'add', spaceRef:'Family', sourceDescription:'my newest 20 photos' }`
  - `parseSlots({ action:'remove', spaceRef:'Family', sourceDescription:'  ' })` → `null`
  - `parseSlots({ spaceRef:'Family', sourceDescription:'my newest 20 photos' }, 'add my newest 20 photos to the Family space')` → `{ action:'add', spaceRef:'Family', sourceDescription:'my newest 20 photos' }` (action inferred)
  - `parseSlots({ action:'frobnicate', spaceRef:'Family', sourceDescription:'x' })` → `null`
  - `parseSlots({ action:'add', sourceDescription:'my newest 20 photos' })` → `null` (no spaceRef)
- [ ] identity: `wf.kind==='manage_space_assets'`, `wf.flow==='hybrid'`, `typeof wf.run==='function'`
- [ ] Run `mise exec -- pnpm --dir agent-runner test` → RED (module doesn't exist).

### Task 2: implement (green)

- [ ] Create the module. Run `mise exec -- pnpm --dir agent-runner test` → all green.

## Edge cases (covered above)

- Gate requires BOTH the space keyword AND a photo-source (never overlaps member ops).
- "screenshots" matches the router gate (photo-ish) even though the RESOLVER will hand it
  off at run-time (Slice 14) — the router must still MATCH so the right workflow gets to
  hand off (vs add_photos mis-routing).
- non-greedy/anchored `<space>` ends in "space" so a non-space target fails to match.
- subjective / recent-trip sources decline at the fast-path.
- `parseSlots` infers action from the prompt verb; an unknown action with no inferable
  verb → null.

## Acceptance

- `match`/`parseSlots` per the tests; `run` is a present stub.
- `mise exec -- pnpm --dir agent-runner test` green; not registered (Slice 14).

## Commit

- One commit: `feat(agent): add manage_space_assets router (space-keyword AND photo-source gate) (phase 2 slice 13)`.
