# Workflow Expansion — Slice 7: `favorite_assets` router & slots

> Implement test-first. Routing only — no execution/registration (Slice 8 adds
> `run`; Slice 11 registers + manifests).

**Goal:** New module `favorite-assets.mjs` (router half), mirroring
`archive-assets.mjs` with favorite/unfavorite polarity. Slot
`{ favorite: boolean, sourceDescription }`. Subjective sources decline the
fast-path.

**Spec scope:** Slice 7. **Depends on:** `SUBJECTIVE_PATTERN`; the archive module
as a structural template.

## Design — `agent-runner/src/strict-workflows/workflows/favorite-assets.mjs`

```
KIND = 'favorite_assets', flow = 'hybrid'
```

Helpers: `clean`, `cleanSource` (as archive). `coerceFavorite(value)`:

- boolean → as-is.
- string lowercased: `true|favorite|favourite|favorited|fave|like|liked|yes` → `true`;
  `false|unfavorite|unfavourite|unfave|unlike|disliked|no` → `false`; else `undefined`.

`declinesSourceFastPath(source)` = `SUBJECTIVE_PATTERN.test(source) || /\brecent\s+trip\b/i.test(source)`.

Patterns (checked in order; first match wins). Note `\bfavou?rite` has no boundary
inside "unfavorite" (n→f), so FAVORITE never matches an unfavorite prompt. "like"
is anchored to the start (`^`) to avoid mid-sentence "photos like these":

| Pattern                                                                                                             | `favorite` |
| ------------------------------------------------------------------------------------------------------------------- | ---------- |
| `UNFAVORITE = /\bun-?favou?rite\s+(?<source>.+)$/i`                                                                 | `false`    |
| `REMOVE_FAV_FROM = /\bremove\s+(?:the\s+)?(?:favou?rite\|fave)\s+(?:status\s+)?(?:from\|on\|of)\s+(?<source>.+)$/i` | `false`    |
| `OUT_OF_FAVS = /\bremove\s+(?<source>.+?)\s+from\s+(?:my\s+)?favou?rites\b/i`                                       | `false`    |
| `UNLIKE = /^\s*(?:please\s+)?unlike\s+(?<source>.+)$/i`                                                             | `false`    |
| `FAVORITE = /\bfavou?rite\s+(?<source>.+)$/i`                                                                       | `true`     |
| `LIKE = /^\s*(?:please\s+)?like\s+(?<source>.+)$/i`                                                                 | `true`     |

`match(prompt)`: same loop shape as archive — first pattern with a `source` group
wins; `cleanSource` it; decline if empty or `declinesSourceFastPath`; return
`{ slots: { favorite, sourceDescription } }`.

`parseSlots(rawSlots)`: `sourceDescription = cleanSource(...)`; if empty → `null`;
`favorite = coerceFavorite(rawSlots?.favorite) ?? true` (favorite is the primary
action); return `{ favorite, sourceDescription }`.

## TDD — exact tests (`favorite-assets.test.mjs`)

```
import { favoriteAssetsWorkflow } from './favorite-assets.mjs';
const wf = favoriteAssetsWorkflow();
```

- [ ] `wf.match('favorite my last 10 photos')` → `{ slots: { favorite: true, sourceDescription: 'my last 10 photos' } }`.
- [ ] `wf.match('favourite my newest 20 photos')` (British spelling) → `favorite: true`.
- [ ] `wf.match('unfavorite my newest 5 photos')` → `favorite: false`, source `'my newest 5 photos'`.
- [ ] `wf.match('remove favorite from my newest 5')` → `favorite: false`, source `'my newest 5'`.
- [ ] `wf.match('like my newest 10 photos')` → `favorite: true`.
- [ ] `wf.match('unlike my newest 10 photos')` → `favorite: false`.
- [ ] `wf.match('favorite the best 3')` → `undefined` (subjective declines).
- [ ] `wf.match('favorite my photos.')` → source `'my photos'` (trailing punct stripped).
- [ ] `wf.match('')` → `undefined`.
- [ ] `wf.match('I really like my photos')` → `undefined` (no leading "like" verb — mid-sentence "like" is not a fast-path favorite).
- [ ] `wf.parseSlots({ favorite: true, sourceDescription: 'my newest 5' })` → `{ favorite: true, sourceDescription: 'my newest 5' }`.
- [ ] `wf.parseSlots({ favorite: 'unfavorite', sourceDescription: 'x' }).favorite` → `false`.
- [ ] `wf.parseSlots({ favorite: 'false', sourceDescription: 'x' }).favorite` → `false`.
- [ ] `wf.parseSlots({ sourceDescription: 'my newest 5' }).favorite` → `true` (default).
- [ ] `wf.parseSlots({ favorite: true, sourceDescription: '  ' })` → `null`.
- [ ] `wf.parseSlots({ favorite: true })` → `null`.
- [ ] `wf.kind === 'favorite_assets'`, `wf.flow === 'hybrid'`, `typeof wf.run === 'undefined'`.

## Edge cases covered

- favorite vs unfavorite vs remove-from-favorites vs like/unlike polarity.
- British spelling (`favourite`).
- subjective "best" declines; mid-sentence "like" does not match.
- trailing punctuation stripped; empty prompt/source rejected.
- LLM polarity coercion + default-to-favorite.

## Run / acceptance

```
export PATH="/Users/pierre/.local/share/mise/installs/node/24.14.1/bin:$PATH"
node --test 'agent-runner/src/**/*.test.mjs'
```

- New `favorite-assets.test.mjs` green; all prior green.

## Commit

`feat: add favorite_assets router + slot parsing (slice 7)`
