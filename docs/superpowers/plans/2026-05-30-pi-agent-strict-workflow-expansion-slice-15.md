# Workflow Expansion — Slice 15: `manage_space_members` router & slots

> Routing only — no execution/registration (Slice 16 adds `run`; Slice 19
> registers + manifests). Test-first.

**Goal:** New module `manage-space-members.mjs` (router half). Match
`add <users> to <space> [as <role>]` and `remove <users> from <space>`. Slots
`{ action:'add'|'remove', memberQueries:[…], spaceRef, role? }` (role default
`viewer` on add, applied in parseSlots). Gated so it never steals
`add <photos> to <album>` (add_photos) or `add the tag …` (tag_assets).

**Spec scope:** Slice 15. **Depends on:** `normalizeSpaceRef`-style helpers.

## Design — `manage-space-members.mjs`

```
KIND = 'manage_space_members', flow = 'strict'
```

Helpers:

- `clean`, `normalizeSpaceRef` (same as the space-rename module: strip article /
  `shared space` wrapper / trailing ` [shared] space`).
- `mentionsSpace(ref)` = `/\bspace\b/i.test(ref)`.
- `ROLE_SYNONYMS` = `{ editor:'editor', edit:'editor', contributor:'editor', viewer:'viewer', view:'viewer', reader:'viewer', 'read-only':'viewer', owner:'owner', admin:'owner', manager:'owner' }`.
- `normalizeRole(word)` → `ROLE_SYNONYMS[clean(word).toLowerCase()]` (or undefined).
- `ROLE_SUFFIX = /\s+as\s+(?:an?\s+)?([a-z][a-z-]*)\s*[.?!]*$/i` — a trailing "as <role>".
- `splitMembers(text)` → split on `/\s*,\s*|\s+and\s+|\s*&\s*/`, trim, drop a leading
  `the `, drop empties. ("Alex and Sam" → `['Alex','Sam']`).

Patterns:

- `ADD = /\badd\s+(?<members>.+?)\s+to\s+(?<rest>.+)$/i`
- `REMOVE = /\bremove\s+(?<members>.+?)\s+from\s+(?<rest>.+)$/i`

`match(prompt)`:

```
text = clean(prompt); if (!text) return undefined
// ADD
m = ADD.exec(text)
if (m?.groups) {
  let rest = m.groups.rest, role
  const rm = ROLE_SUFFIX.exec(rest)
  if (rm) { const r = normalizeRole(rm[1]); if (r) { role = r; rest = rest.slice(0, rm.index) } }
  const spaceRef = normalizeSpaceRef(rest)
  const members = splitMembers(m.groups.members)
  // Gate: must look like a space membership op (space keyword OR an explicit role),
  // so "add <photos> to <album>" / "add the tag … to …" fall through.
  if ((mentionsSpace(rest) || role) && spaceRef && members.length) {
    return { slots: { action:'add', memberQueries: members, spaceRef, ...(role ? { role } : {}) } }
  }
}
// REMOVE (no role)
m = REMOVE.exec(text)
if (m?.groups) {
  const rest = m.groups.rest
  const spaceRef = normalizeSpaceRef(rest)
  const members = splitMembers(m.groups.members)
  if (mentionsSpace(rest) && spaceRef && members.length) {
    return { slots: { action:'remove', memberQueries: members, spaceRef } }
  }
}
return undefined
```

`parseSlots(rawSlots)`:

```
action = clean(rawSlots?.action).toLowerCase()
if (action !== 'add' && action !== 'remove') return null
spaceRef = normalizeSpaceRef(rawSlots?.spaceRef); if (!spaceRef) return null
members = normalizeMemberQueries(rawSlots?.memberQueries)   // array OR and/comma string
if (!members.length) return null
slots = { action, spaceRef, memberQueries: members }
if (action === 'add') slots.role = normalizeRole(rawSlots?.role) ?? 'viewer'   // default viewer; remove ignores role
return slots
```

`normalizeMemberQueries(v)`: if array → map clean+drop empties; if string → `splitMembers`.

## TDD — exact tests (`manage-space-members.test.mjs`)

- [ ] `wf.match('add Alex to the Family space as editor')` → `{ slots: { action:'add', memberQueries:['Alex'], spaceRef:'Family', role:'editor' } }`.
- [ ] `wf.match('add Sam to the Trips space')` → `{ action:'add', memberQueries:['Sam'], spaceRef:'Trips' }` (no role key).
- [ ] `wf.match('add Alex and Sam to the Family space')` → `memberQueries:['Alex','Sam']`.
- [ ] `wf.match('add Alex to Family as a viewer')` → `{ action:'add', memberQueries:['Alex'], spaceRef:'Family', role:'viewer' }` (role gate, no "space" word needed).
- [ ] `wf.match('remove Alex from the Family space')` → `{ action:'remove', memberQueries:['Alex'], spaceRef:'Family' }`.
- [ ] `wf.match('remove Alex from Family')` → `undefined` (no "space" keyword on remove).
- [ ] `wf.match('add my newest 20 photos to Family')` → `undefined` (photo add — no space/role gate).
- [ ] `wf.match('add the tag Spring Break to my newest 50 photos')` → `undefined` (tag add).
- [ ] `wf.match('')` → `undefined`.
- [ ] `wf.parseSlots({ action:'add', memberQueries:['Alex'], spaceRef:'Family' })` → `role:'viewer'` (default).
- [ ] `wf.parseSlots({ action:'add', memberQueries:['Alex'], spaceRef:'Family', role:'contributor' }).role` → `'editor'` (synonym).
- [ ] `wf.parseSlots({ action:'add', memberQueries:['Alex'], spaceRef:'Family', role:'admin' }).role` → `'owner'`.
- [ ] `wf.parseSlots({ action:'add', spaceRef:'Family', memberQueries:'Alex and Sam' }).memberQueries` → `['Alex','Sam']` (LLM string).
- [ ] `wf.parseSlots({ action:'remove', memberQueries:['Alex'], spaceRef:'Family', role:'editor' })` → no `role` key (remove ignores role).
- [ ] `wf.parseSlots({ action:'add', spaceRef:'Family', memberQueries:[] })` → `null`.
- [ ] `wf.parseSlots({ action:'add', memberQueries:['Alex'] })` → `null` (no space).
- [ ] `wf.parseSlots({ action:'frobnicate', spaceRef:'Family', memberQueries:['Alex'] })` → `null` (bad action).
- [ ] `wf.kind === 'manage_space_members'`, `wf.flow === 'strict'`, `typeof wf.run === 'undefined'`.

## Edge cases covered

- add with/without role; remove; multiple members; role synonym normalization;
  default viewer on add; remove ignores role.
- gate: photo-add / tag-add do not match (space keyword or role required).
- parseSlots rejects empty member list, empty space, bad action; accepts an LLM
  and/comma member string.

## Run / acceptance

```
export PATH="/Users/pierre/.local/share/mise/installs/node/24.14.1/bin:$PATH"
node --test 'agent-runner/src/**/*.test.mjs'
```

- New `manage-space-members.test.mjs` green; all prior green.

## Commit

`feat: add manage_space_members router + slot parsing (slice 15)`
