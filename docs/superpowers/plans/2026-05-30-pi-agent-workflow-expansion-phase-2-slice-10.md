# Pi Agent Workflow Expansion (Phase 2) — Slice 10 Implementation Plan

> **For agentic workers:** Implement test-first. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add the `remove_photos_from_album` (hybrid) router — `match()`/`parseSlots()`
extracting `{ albumRef, sourceDescription }` from "remove/take `<source>` from/out of
`<album>`". GATED: decline the three competing "remove … from …" intents — space-member
removal (`manage_space_members`, "space" keyword), out-of-favorites (`favorite_assets`,
"favorites" tail), and tag removal ("tag" phrasing) — plus subjective/recent-trip
sources. NOT registered yet (router-only); `run()` is a stub (Slice 11).

**Spec scope:** Slice 10 of
`docs/superpowers/specs/2026-05-30-pi-agent-workflow-expansion-phase-2-design.md`.

**Tech stack:** Node.js ESM, `node:test`, `mise exec -- pnpm --dir agent-runner test`.

**Files (new):**

- `agent-runner/src/strict-workflows/workflows/remove-photos-from-album.mjs`
- `agent-runner/src/strict-workflows/workflows/remove-photos-from-album.test.mjs`

## Key regex insight

The source is captured GREEDILY (`.+`) and the album non-greedily up to `$`, so a source
that itself contains "from" (e.g. "my photos from 2024") binds to the FINAL "from
`<album>`": `remove (?<source>.+) from (?<album>.+?)$`.

## Implementation — full module

```js
import { SUBJECTIVE_PATTERN } from '../asset-source-resolver.mjs';
import { handoffOpen } from '../protocol.mjs';

const KIND = 'remove_photos_from_album';

const clean = (value) => (typeof value === 'string' ? value.trim() : '');
const cleanSource = (value) =>
  clean(value)
    .replace(/[.?!]+$/u, '')
    .trim();

// Strip a leading article and a trailing "album" noun so "the Family album" → "Family".
const normalizeAlbumRef = (value) =>
  clean(value)
    .replace(/^(?:the|my|this|that)\s+/i, '')
    .replace(/\s+album$/i, '')
    .trim();

const tripSourcePattern = /\brecent\s+trip\b/i;

// "remove <source> from <album>" / "remove <source> out of <album>" /
// "take <source> out of <album>". Greedy source binds the FINAL from/out-of.
const REMOVE_FROM = /\b(?:remove|delete|drop)\s+(?<source>.+)\s+(?:from|out\s+of)\s+(?<album>.+?)$/i;
const TAKE_OUT_OF = /\btake\s+(?<source>.+)\s+out\s+of\s+(?<album>.+?)$/i;

// "remove … from …" is shared by member removal, out-of-favorites, and tag removal.
// Decline those so registry order + this gate keep the seam clean even in isolation.
const albumIsOwnedElsewhere = (album) => /\bspaces?\b/i.test(album) || /\bfavou?rites?\b/i.test(album);
const sourceIsOwnedElsewhere = (source) =>
  SUBJECTIVE_PATTERN.test(source) || tripSourcePattern.test(source) || /\btags?\b/i.test(source);

const tryMatch = (prompt) => {
  const match = REMOVE_FROM.exec(prompt) ?? TAKE_OUT_OF.exec(prompt);
  if (!match?.groups) {
    return undefined;
  }
  const sourceDescription = cleanSource(match.groups.source);
  const albumRaw = clean(match.groups.album);
  if (!sourceDescription || !albumRaw) {
    return undefined;
  }
  if (albumIsOwnedElsewhere(albumRaw) || sourceIsOwnedElsewhere(sourceDescription)) {
    return undefined;
  }
  const albumRef = normalizeAlbumRef(albumRaw);
  return albumRef ? { albumRef, sourceDescription } : undefined;
};

export const removePhotosFromAlbumWorkflow = () => ({
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
    const albumRef = normalizeAlbumRef(rawSlots?.albumRef);
    const sourceDescription = cleanSource(rawSlots?.sourceDescription);
    if (!albumRef || !sourceDescription) {
      return null;
    }
    return { albumRef, sourceDescription };
  },

  // Execution lands in Slice 11.
  async run() {
    return handoffOpen({ reason: 'remove_photos_from_album execution is implemented in Slice 11.' });
  },
});
```

## TDD steps

### Task 1: tests (red)

Create `remove-photos-from-album.test.mjs`. `const wf = removePhotosFromAlbumWorkflow();`
(router-only describe blocks).

- [ ] match cases:
  - `'remove my newest 20 photos from Family'` → `{ slots:{ albumRef:'Family', sourceDescription:'my newest 20 photos' } }`
  - `'take my newest 20 photos out of the Family album'` → `{ slots:{ albumRef:'Family', sourceDescription:'my newest 20 photos' } }`
  - `'remove my photos from 2024 from the Trips album'` → `{ slots:{ albumRef:'Trips', sourceDescription:'my photos from 2024' } }`
  - `'remove Bob from the Family space'` → `undefined` (space keyword)
  - `'remove my newest 20 from my favorites'` → `undefined` (favorites tail)
  - `'remove the Travel tag from my newest 20'` → `undefined` (tag phrasing)
  - `'remove the best ones from Family'` → `undefined` (subjective source)
  - `'remove my recent trip photos from Family'` → `undefined` (recent-trip source)
  - `'how many photos are in Family?'` → `undefined` (no remove/take verb)
  - `''` → `undefined`
- [ ] parseSlots cases:
  - `parseSlots({ albumRef:'the Family album', sourceDescription:'my newest 20 photos' })` → `{ albumRef:'Family', sourceDescription:'my newest 20 photos' }`
  - `parseSlots({ albumRef:'', sourceDescription:'newest 10' })` → `null`
  - `parseSlots({ albumRef:'Family', sourceDescription:'' })` → `null`
  - `parseSlots({ albumRef:'Family', sourceDescription:'my newest 20 photos.' })` → `{ albumRef:'Family', sourceDescription:'my newest 20 photos' }` (trailing punctuation stripped)
- [ ] identity: `wf.kind==='remove_photos_from_album'`, `wf.flow==='hybrid'`, `typeof wf.run==='function'`
- [ ] Run `mise exec -- pnpm --dir agent-runner test` → RED (module doesn't exist).

### Task 2: implement (green)

- [ ] Create the module. Run `mise exec -- pnpm --dir agent-runner test` → all green.

## Edge cases (covered above)

- multi-"from" source binds the FINAL "from `<album>`" (greedy source).
- "take … out of …" second surface verb.
- decline space-member removal, out-of-favorites, tag removal (registry order + gate).
- subjective / recent-trip source declines.
- trailing punctuation stripped from source.
- match does NOT resolve — extraction only (resolution in Slice 11).

## Acceptance

- `match`/`parseSlots` per the tests; `run` is a present stub.
- `mise exec -- pnpm --dir agent-runner test` green; not registered (Slice 12).

## Commit

- One commit: `feat(agent): add remove_photos_from_album router (gated remove … from …) (phase 2 slice 10)`.
