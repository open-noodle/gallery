# Workflow Expansion — Slice 17: `change_member_role` router & slots

> Routing only — no execution/registration (Slice 18 adds `run`; Slice 19
> registers + manifests). Test-first.

**Goal:** New module `change-member-role.mjs` (router half). Match "make <user> an
editor/viewer/owner in <space>" and "change/set <user>'s role to <role> in <space>".
Slots `{ memberQuery, role, spaceRef }`. The **role word is the gate** (so it can't
match non-role "make X …" phrasings).

**Spec scope:** Slice 17.

## Design — `change-member-role.mjs`

```
KIND = 'change_member_role', flow = 'strict'
```

Helpers (reuse the manage-members shapes): `clean`, `normalizeSpaceRef`,
`ROLE_SYNONYMS` (editor/edit/contributor→editor; viewer/view/reader/read-only→viewer;
owner/admin/manager→owner), `normalizeRole(word)`.

`ROLE_WORD = '(?<role>editor|edit|contributor|viewer|view|reader|read-only|owner|admin|manager)'`.

Patterns:

- `MAKE = /\bmake\s+(?<member>.+?)\s+(?:an?\s+|the\s+)?ROLE_WORD\s+(?:in|of|on|for)\s+(?<space>.+)$/i`
- `CHANGE_ROLE = /\b(?:change|set|update)\s+(?<member>.+?)(?:'s|s')?\s+role\s+to\s+(?:an?\s+|the\s+)?ROLE_WORD\s+(?:in|of|on|for)\s+(?<space>.+)$/i`
- `CHANGE_TO = /\b(?:change|set|update|make)\s+(?<member>.+?)\s+(?:in)?to\s+(?:an?\s+|the\s+)?ROLE_WORD\s+(?:in|of|on|for)\s+(?<space>.+)$/i`

`match(prompt)`: try MAKE, CHANGE_ROLE, CHANGE_TO in order. For the first with a
`role` that `normalizeRole` recognizes: `memberQuery = clean(member)`,
`role = normalizeRole(roleWord)`, `spaceRef = normalizeSpaceRef(space)`. Require all
three non-empty; else continue/return undefined. Return
`{ slots: { memberQuery, role, spaceRef } }`.

`parseSlots(rawSlots)`:

```
memberQuery = clean(rawSlots?.memberQuery)
role = normalizeRole(rawSlots?.role)
spaceRef = normalizeSpaceRef(rawSlots?.spaceRef)
if (!memberQuery || !role || !spaceRef) return null
return { memberQuery, role, spaceRef }
```

(`role` may be `owner` here — the router captures intent; the Slice-18 `run` rejects
promotion to owner since `updateMemberRole` accepts only editor/viewer.)

## TDD — exact tests (`change-member-role.test.mjs`)

- [ ] `wf.match('make Alex an editor in Family')` → `{ slots: { memberQuery:'Alex', role:'editor', spaceRef:'Family' } }`.
- [ ] `wf.match('make Alex a viewer in the Family space')` → `{ memberQuery:'Alex', role:'viewer', spaceRef:'Family' }`.
- [ ] `wf.match("change Alex's role to editor in Family")` → `{ memberQuery:'Alex', role:'editor', spaceRef:'Family' }`.
- [ ] `wf.match('make Alex the owner of Family')` → `{ memberQuery:'Alex', role:'owner', spaceRef:'Family' }` (router captures owner intent).
- [ ] `wf.match("change Bob's role to viewer in the Trips space")` → `{ memberQuery:'Bob', role:'viewer', spaceRef:'Trips' }`.
- [ ] `wf.match('make Alex a contributor in Family')` → `role:'editor'` (synonym).
- [ ] `wf.match('make Alex happy in Family')` → `undefined` (no valid role word).
- [ ] `wf.match('rename the Family space to Family 2026')` → `undefined` (not a role change).
- [ ] `wf.match('')` → `undefined`.
- [ ] `wf.parseSlots({ memberQuery:'Alex', role:'admin', spaceRef:'the Family space' })` → `{ memberQuery:'Alex', role:'owner', spaceRef:'Family' }`.
- [ ] `wf.parseSlots({ memberQuery:'Alex', role:'editor' })` → `null` (no space).
- [ ] `wf.parseSlots({ role:'editor', spaceRef:'Family' })` → `null` (no member).
- [ ] `wf.parseSlots({ memberQuery:'Alex', role:'bogus', spaceRef:'Family' })` → `null` (invalid role).
- [ ] `wf.kind === 'change_member_role'`, `wf.flow === 'strict'`, `typeof wf.run === 'undefined'`.

## Edge cases covered

- each role; possessive ("Alex's role"); `make … the owner` intent; role synonyms;
  "make X <non-role> in Y" does not match; album/space-rename phrasings do not match.
- parseSlots requires member + valid role + space.

## Run / acceptance

```
export PATH="/Users/pierre/.local/share/mise/installs/node/24.14.1/bin:$PATH"
node --test 'agent-runner/src/**/*.test.mjs'
```

- New `change-member-role.test.mjs` green; all prior green.

## Commit

`feat: add change_member_role router + slot parsing (slice 17)`
