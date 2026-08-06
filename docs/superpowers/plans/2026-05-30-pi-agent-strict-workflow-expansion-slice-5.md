# Workflow Expansion — Slice 5: `archive_assets` router & slots

> Implement test-first. Routing only — **no execution, no tool calls, not registered**.

**Goal:** New workflow module `archive-assets.mjs` exporting a factory with
`kind`/`flow`/`match`/`parseSlots` (no `run` yet — added in Slice 6). The module is
NOT registered in the registry and NOT in the manifest yet (Slice 6 registers it;
Slice 11 adds the manifest entry), so this slice adds no routing/eval behavior
beyond the unit-tested `match`/`parseSlots`.

**Spec scope:** Slice 5. **Depends on:** `SUBJECTIVE_PATTERN` (resolver), the
`{ kind, flow, match, parseSlots }` module shape (see `add-photos-to-album.mjs`).

## Design — `agent-runner/src/strict-workflows/workflows/archive-assets.mjs`

```
KIND = 'archive_assets', flow = 'hybrid'
```

Helpers:

- `clean(v)` — trim or ''.
- `cleanSource(v)` — `clean(v)` minus trailing `.?!`.
- `coerceArchived(value)`:
  - boolean → as-is.
  - string (lowercased): `true|archive|archived|yes` → `true`;
    `false|unarchive|unarchived|no` → `false`; else `undefined`.
- `declinesSourceFastPath(source)` = `SUBJECTIVE_PATTERN.test(source) || /\brecent\s+trip\b/i.test(source)`
  (decline subjective + trip overlap at the fast-path; they flow to classifier/handoff).

Patterns (checked in order; first match wins):

| Pattern (regex)                                                                                                           | `archived` |
| ------------------------------------------------------------------------------------------------------------------------- | ---------- |
| `UNARCHIVE = /\bun-?archive\s+(?<source>.+)$/i`                                                                           | `false`    |
| `MOVE_OUT = /\b(?:move\|take\|pull\|get\|remove\|restore)\s+(?<source>.+?)\s+(?:out\s+of\|from)\s+(?:the\s+)?archive\b/i` | `false`    |
| `ARCHIVE = /\barchive\s+(?<source>.+)$/i`                                                                                 | `true`     |

`\barchive` has no word-boundary inside "unarchive" (n→a), so ARCHIVE never matches
an unarchive prompt; UNARCHIVE/MOVE_OUT are still checked first for safety.
`"move X out of archive"` is not caught by ARCHIVE (trailing "archive" has no
`\s+source` after it).

`match(prompt)`:

```
text = clean(prompt); if (!text) return undefined
for ([pattern, archived] of [[UNARCHIVE,false],[MOVE_OUT,false],[ARCHIVE,true]]):
  m = pattern.exec(text)
  if (m?.groups?.source):
    source = cleanSource(m.groups.source)
    if (!source || declinesSourceFastPath(source)) return undefined
    return { slots: { archived, sourceDescription: source } }
return undefined
```

`parseSlots(rawSlots)`:

```
sourceDescription = cleanSource(rawSlots?.sourceDescription)
if (!sourceDescription) return null
let archived = coerceArchived(rawSlots?.archived)
if (archived === undefined) archived = true   // default action is archive
return { archived, sourceDescription }
```

(`archived` is a real boolean in the returned slots — run() in Slice 6 reads it
directly. Default-to-true only bites the LLM path when the model omits polarity.)

## TDD — exact tests (`archive-assets.test.mjs`)

```
import { archiveAssetsWorkflow } from './archive-assets.mjs';
const wf = archiveAssetsWorkflow();
```

- [ ] `wf.match('archive my newest 50 photos')` → `{ slots: { archived: true, sourceDescription: 'my newest 50 photos' } }`.
- [ ] `wf.match('unarchive my last 10 photos')` → `archived: false`, source `'my last 10 photos'`.
- [ ] `wf.match('un-archive my newest 5')` → `archived: false`.
- [ ] `wf.match('move my newest 20 photos out of archive')` → `archived: false`, source `'my newest 20 photos'`.
- [ ] `wf.match('take my 2024 photos out of the archive')` → `archived: false`, source `'my 2024 photos'`.
- [ ] `wf.match('archive the best ones')` → `undefined` (subjective declines fast-path).
- [ ] `wf.match('add my newest 20 photos to Family')` → `undefined` (not an archive verb).
- [ ] `wf.match('archive my photos.')` → source `'my photos'` (trailing punctuation stripped).
- [ ] `wf.match('')` → `undefined`.
- [ ] `wf.parseSlots({ archived: true, sourceDescription: 'my newest 50 photos' })` → `{ archived: true, sourceDescription: 'my newest 50 photos' }` (boolean passthrough from match).
- [ ] `wf.parseSlots({ archived: 'unarchive', sourceDescription: 'my newest 5' })` → `archived: false` (LLM-string coercion).
- [ ] `wf.parseSlots({ archived: 'false', sourceDescription: 'x' })` → `archived: false`.
- [ ] `wf.parseSlots({ sourceDescription: 'my newest 5' })` → `archived: true` (default action when polarity omitted).
- [ ] `wf.parseSlots({ archived: true, sourceDescription: '   ' })` → `null` (empty source rejected).
- [ ] `wf.parseSlots({ archived: true })` → `null` (missing source rejected).
- [ ] `wf.kind === 'archive_assets'`, `wf.flow === 'hybrid'`, `typeof wf.run === 'undefined'` (router-only this slice).

## Edge cases covered

- archive vs unarchive vs move-out-of-archive polarity.
- subjective source declines fast-path; non-archive verb does not match.
- trailing punctuation stripped; empty prompt/source rejected.
- LLM-path polarity coercion + default-to-archive; boolean passthrough.

## Run / acceptance

```
export PATH="/Users/pierre/.local/share/mise/installs/node/24.14.1/bin:$PATH"
node --test 'agent-runner/src/**/*.test.mjs'
```

- New `archive-assets.test.mjs` green; all prior tests still green (the module is
  not imported anywhere but its own test).

## Commit

`feat: add archive_assets router + slot parsing (slice 5)`
