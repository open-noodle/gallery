# Workflow Expansion — Slice 9: `tag_assets` router & slots (add-only)

> Implement test-first. Routing only — no execution/registration (Slice 10 adds
> `run`; Slice 11 registers + manifests).

**Goal:** New module `tag-assets.mjs` (router half). Match `tag <source> as <tag>`
and `add [the] tag <tag> to <source>` / `add [the] <tag> tag to <source>`
(**add-only**). Slots `{ sourceDescription, tagName }`. Extract quoted multi-word
tag names. Tag-removal phrasings do not match.

**Spec scope:** Slice 9. **Depends on:** `SUBJECTIVE_PATTERN`; archive module as a
structural template. **Non-goal:** tag removal (the batch action union has no
`removeTag`; removal phrasings hand off).

## Design — `agent-runner/src/strict-workflows/workflows/tag-assets.mjs`

```
KIND = 'tag_assets', flow = 'hybrid'
```

Helpers: `clean`, `cleanSource` (as archive). Tag cleaning:

```
const stripQuotes = (t) =>
  t.length >= 2 && /^["'“‘]/.test(t) && /["'”’]$/.test(t) ? t.slice(1, -1).trim() : t;
const cleanTag = (v) => stripQuotes(clean(v).replace(/[.?!]+$/u, '').trim());
```

`declinesSourceFastPath(source)` = `SUBJECTIVE_PATTERN.test(source) || /\brecent\s+trip\b/i.test(source)`.

Patterns. `\btag` has no boundary inside "untag" (n→t), so an untag prompt never
matches TAG_AS; removal phrasings ("remove the X tag from …") match no add-pattern:

| Pattern                                                                            | groups      |
| ---------------------------------------------------------------------------------- | ----------- |
| `TAG_AS = /\btag\s+(?<source>.+?)\s+as\s+(?<tag>.+)$/i`                            | source, tag |
| `ADD_TAG_NAMED_TO = /\badd\s+(?:the\s+)?tag\s+(?<tag>.+?)\s+to\s+(?<source>.+)$/i` | tag, source |
| `ADD_NAMED_TAG_TO = /\badd\s+(?:the\s+)?(?<tag>.+?)\s+tag\s+to\s+(?<source>.+)$/i` | tag, source |

`match(prompt)`: try patterns in order; first with both `source` and `tag` groups
wins. Build `sourceDescription = cleanSource(groups.source)`,
`tagName = cleanTag(groups.tag)`. Decline (return undefined) if either is empty or
`declinesSourceFastPath(sourceDescription)`. Return `{ slots: { sourceDescription, tagName } }`.

`parseSlots(rawSlots)`:

```
sourceDescription = cleanSource(rawSlots?.sourceDescription)
tagName = cleanTag(rawSlots?.tagName)
if (!sourceDescription || !tagName) return null
return { sourceDescription, tagName }
```

## TDD — exact tests (`tag-assets.test.mjs`)

```
import { tagAssetsWorkflow } from './tag-assets.mjs';
const wf = tagAssetsWorkflow();
```

- [ ] `wf.match('tag my newest 20 photos as Travel')` → `{ slots: { sourceDescription: 'my newest 20 photos', tagName: 'Travel' } }`.
- [ ] `wf.match('tag my newest 20 as "Spring Break"')` → `tagName: 'Spring Break'` (quoted multi-word).
- [ ] `wf.match('add the tag Travel to my newest 20 photos')` → `tagName: 'Travel'`, source `'my newest 20 photos'`.
- [ ] `wf.match('add the Travel tag to my newest 20')` → `tagName: 'Travel'`, source `'my newest 20'`.
- [ ] `wf.match('remove the Travel tag from my newest 20')` → `undefined` (removal does not match).
- [ ] `wf.match('untag my newest 20 photos')` → `undefined`.
- [ ] `wf.match('tag the best ones as Travel')` → `undefined` (subjective source declines).
- [ ] `wf.match('tag my photos as Travel.')` → `tagName: 'Travel'` (trailing punctuation stripped).
- [ ] `wf.match('')` → `undefined`.
- [ ] `wf.parseSlots({ sourceDescription: 'my newest 20', tagName: 'Travel' })` → `{ sourceDescription: 'my newest 20', tagName: 'Travel' }`.
- [ ] `wf.parseSlots({ sourceDescription: 'x', tagName: '"Spring Break"' })` → `tagName: 'Spring Break'` (quotes stripped on the LLM path).
- [ ] `wf.parseSlots({ sourceDescription: 'x', tagName: '   ' })` → `null` (empty tag rejected).
- [ ] `wf.parseSlots({ sourceDescription: '  ', tagName: 'Travel' })` → `null` (empty source rejected).
- [ ] `wf.parseSlots({ sourceDescription: 'x' })` → `null` (missing tag).
- [ ] `wf.kind === 'tag_assets'`, `wf.flow === 'hybrid'`, `typeof wf.run === 'undefined'`.

## Edge cases covered

- `tag … as …` and both `add … tag to …` phrasings.
- quoted multi-word tag; trailing punctuation stripped.
- removal / untag phrasings do not match (add-only).
- subjective source declines.
- parseSlots rejects empty tag OR empty source; strips quotes on the LLM path.

## Run / acceptance

```
export PATH="/Users/pierre/.local/share/mise/installs/node/24.14.1/bin:$PATH"
node --test 'agent-runner/src/**/*.test.mjs'
```

- New `tag-assets.test.mjs` green; all prior green.

## Commit

`feat: add tag_assets router + slot parsing (add-only) (slice 9)`
