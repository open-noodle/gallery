# Workflow Expansion — Slice 13: `rename_or_describe_space` router & slots

> Routing only — no execution/registration (Slice 14 adds `run`; Slice 19
> registers + manifests). Test-first.

**Goal:** New module `rename-or-describe-space.mjs` (router half), mirroring
`rename-or-describe-album.mjs` but for spaces and **gated on the `space` keyword**
so it never matches album/generic phrasings (the album-vs-space disambiguation).
Slots `{ spaceRef, newName?, description? }` (≥1 of name/description).

**Spec scope:** Slice 13. **Depends on:** the album rename module as a template,
the `{ kind, flow, match, parseSlots }` shape.

## Design — `agent-runner/src/strict-workflows/workflows/rename-or-describe-space.mjs`

```
KIND = 'rename_or_describe_space', flow = 'strict'
```

Helpers:

- `clean(v)`.
- `normalizeSpaceRef(v)`: strip a leading article (`the|my|this|that|our`), a
  leading `shared space ` wrapper, and a trailing ` [shared] space` noun:
  ```
  clean(v)
    .replace(/^(?:the|my|this|that|our)\s+/i, '')
    .replace(/^shared\s+space\s+/i, '')
    .replace(/\s+(?:shared\s+)?space$/i, '')
    .trim();
  ```
- `mentionsSpace(ref)` = `/\bspace\b/i.test(ref)` — the regex gate.

Patterns (mirror the album module):

- `RENAME = /\b(?:rename|re-?name)\s+(?<spaceRef>.+?)\s+to\s+(?<newName>.+?)(?:\s+and\s+(?:add|set|give\s+it)\s+(?:a\s+)?description.*)?$/i`
- `DESCRIBE = /\b(?:change|set|update|add|edit)\s+(?:the\s+|a\s+|its\s+)?description\s+(?:on|of|for)\s+(?<spaceRef>.+?)(?:\s+to\s+(?<description>.+))?$/i`

`match(prompt)`:

```
text = clean(prompt); if (!text) return undefined
// rename
m = RENAME.exec(text)
if (m?.groups && mentionsSpace(m.groups.spaceRef)) {
  spaceRef = normalizeSpaceRef(m.groups.spaceRef)
  newName  = clean(m.groups.newName).replace(/[.?!]+$/u,'').trim()
  if (spaceRef && newName) return { slots: { spaceRef, newName } }
}
// describe
m = DESCRIBE.exec(text)
if (m?.groups && mentionsSpace(m.groups.spaceRef)) {
  spaceRef = normalizeSpaceRef(m.groups.spaceRef)
  description = clean(m.groups.description).replace(/[.?!]+$/u,'').trim()
  if (spaceRef) return { slots: description ? { spaceRef, description } : { spaceRef } }
}
return undefined
```

The `mentionsSpace` gate is what keeps album/generic phrasings out
(`rename the Family album to X` → spaceRef "the Family album" has no `space` →
decline; `rename Family to X` → no `space` → decline). The reciprocal — registering
this BEFORE `rename_or_describe_album` so the strict gate wins — is a Slice-19
concern (registration), noted there.

`parseSlots(rawSlots)` (LLM path — the classifier already chose space, so NO
`space`-keyword gate here; just validate):

```
spaceRef = normalizeSpaceRef(rawSlots?.spaceRef)
newName = clean(rawSlots?.newName)
description = clean(rawSlots?.description)
if (!spaceRef) return null
if (!newName && !description) return null
slots = { spaceRef }; if (newName) slots.newName = newName; if (description) slots.description = description
return slots
```

## TDD — exact tests (`rename-or-describe-space.test.mjs`)

```
import { renameOrDescribeSpaceWorkflow } from './rename-or-describe-space.mjs';
const wf = renameOrDescribeSpaceWorkflow();
```

- [ ] `wf.match('rename the Family space to Family 2026')` → `{ slots: { spaceRef: 'Family', newName: 'Family 2026' } }`.
- [ ] `wf.match('set the description on the Family space to Our shared memories')` → `{ slots: { spaceRef: 'Family', description: 'Our shared memories' } }`.
- [ ] `wf.match('rename the shared space Trips to Trips 2026')` → `{ spaceRef: 'Trips', newName: 'Trips 2026' }`.
- [ ] `wf.match('set the description on this space to Welcome')` → slots with `description: 'Welcome'` and a truthy `spaceRef` (deixis).
- [ ] `wf.match('rename the Family album to Family 2026')` → `undefined` (album phrasing — no `space` keyword).
- [ ] `wf.match('rename Family to Family 2026')` → `undefined` (generic — no `space` keyword; defaults to album).
- [ ] `wf.match('')` → `undefined`.
- [ ] `wf.parseSlots({ spaceRef: 'the Family space', newName: 'Family 2026' })` → `{ spaceRef: 'Family', newName: 'Family 2026' }`.
- [ ] `wf.parseSlots({ spaceRef: 'Family', newName: 'Family 2026', description: 'Welcome' })` → `{ spaceRef: 'Family', newName: 'Family 2026', description: 'Welcome' }` (both fields).
- [ ] `wf.parseSlots({ spaceRef: 'Family' })` → `null` (neither name nor description).
- [ ] `wf.parseSlots({ newName: 'X' })` → `null` (no spaceRef).
- [ ] `wf.kind === 'rename_or_describe_space'`, `wf.flow === 'strict'`, `typeof wf.run === 'undefined'`.

## Edge cases covered

- rename-only, describe-only, deixis (`this space`), `shared space <name>` wrapper.
- album-vs-space disambiguation: album/generic phrasings → undefined (space gate).
- parseSlots requires spaceRef + ≥1 of name/description; normalizes the ref.

## Run / acceptance

```
export PATH="/Users/pierre/.local/share/mise/installs/node/24.14.1/bin:$PATH"
node --test 'agent-runner/src/**/*.test.mjs'
```

- New `rename-or-describe-space.test.mjs` green; all prior green.

## Commit

`feat: add rename_or_describe_space router + slot parsing (slice 13)`
