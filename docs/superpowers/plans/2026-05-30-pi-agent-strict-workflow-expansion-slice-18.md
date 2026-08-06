# Workflow Expansion — Slice 18: `change_member_role` execution + guards

> Test-first against the contract-faithful fake client. Mirrors Slice 16's
> resolve→readSpace→searchUsers→guard→propose→gate shape.

**Goal:** Add `run()`: `listSpaces` resolve → `readSpace` (members+roles) →
`searchUsers` resolve the target → guards → `proposeAlbumOperations([space.updateMemberRole])`
→ `gatePlanResult` → copy.

**Spec scope:** Slice 18. **Verified DTO:** `space.updateMemberRole` =
`{ type, summary, targetKind:'existing_space', targetId, payload:{ userIds:[uuid], role } }`,
role ∈ **{editor, viewer}** only (owner NOT assignable). Server backstop: "Pi cannot
remove or demote the owner"; "Cannot change your own role".

**Guards (deterministic, never produce a plan when violated):**

1. Requested role `owner` → needs_input (not assignable).
2. Unknown/ambiguous space → needs_input.
3. Ambiguous/not-found user → needs_input.
4. Target not a member → needs_input.
5. Target is the **owner** → blocked (the deterministic proxy for self-demotion +
   last-owner demotion) → needs_input.
6. **No-op** (current role == requested) → needs_input ("already a …"), no plan.
7. Tool error → failed; planless propose → failed (no success copy); userId only in
   the payload, never in copy.

## Contract fixture — validate space.updateMemberRole

Add to `SPACE_OP_VALIDATORS` a `validateSpaceUpdateMemberRole`:
`requireExistingSpaceTarget`; `payload.userIds` non-empty array; `payload.role ∈ {editor,viewer}`.

## Design — `run({ client, slots, signal })`

```
requestedRole = clean(slots.role).toLowerCase()
memberQuery   = clean(slots.memberQuery)
if requestedRole === 'owner' → needsInput("editor or viewer, not owner")

ref = normalizeSpaceRef(slots.spaceRef)
listed = await listSpaces (try/catch → failed)
matches by name (ci); 0 → needsInput; >1 → needsInput; spaceSummary = matches[0]
detail = await readSpace({spaceId}) (try/catch → failed); space = detail.space ?? detail
memberById = Map(members → userId)
res = await searchUsers({query: memberQuery}) (try/catch → failed)
users = res.users; 0 → needsInput; >1 → needsInput; user = users[0]
member = memberById.get(user.userId)
if !member → needsInput(not a member)
currentRole = clean(member.role).toLowerCase()
if currentRole === 'owner' → needsInput("can't change the owner's role")   // self + last-owner
if currentRole === requestedRole → needsInput("already a/an <role>")        // no-op
op = space.updateMemberRole { targetKind:'existing_space', targetId, payload:{ userIds:[user.userId], role: requestedRole } }
planResult = await proposeAlbumOperations (try/catch → failed)
gatePlanResult(successText = `make <name> a/an <role> in "<space>"`, successSummary { workflowKind, target: spaceName, label: requestedRole })
```

Imports: `failed`, `needsInput`, `gatePlanResult`, `safeFailureText`. Registry/
manifest: Slice 19.

## TDD — exact tests (`change-member-role.test.mjs`)

`import { makeContractClient } from './contract-fixtures.mjs';`; flip router-only
`typeof wf.run` to `'function'`. Space client: members Pierre(owner), Bob(viewer),
Carol(editor); users Alex, Alice, Bob, Carol, Pierre.

- [ ] **viewer→editor planned (no ids in copy):** `slots:{ memberQuery:'Bob', role:'editor', spaceRef:'Family' }`
      → `planned`; op deepEquals `{ type:'space.updateMemberRole', summary:'Update a space member role.', targetKind:'existing_space', targetId:'spc-1', payload:{ userIds:['u-bob'], role:'editor' } }`; `outcome.text` excludes `'u-bob'`.
- [ ] **editor→viewer planned:** `{ memberQuery:'Carol', role:'viewer', spaceRef:'Family' }` → op `payload:{ userIds:['u-carol'], role:'viewer' }`.
- [ ] **no-op → needs_input (no propose):** `{ memberQuery:'Bob', role:'viewer', spaceRef:'Family' }` (Bob already viewer) → `needs_input`; no propose.
- [ ] **owner demotion blocked (self/last-owner) → needs_input:** `{ memberQuery:'Pierre', role:'editor', spaceRef:'Family' }` → `needs_input`; no propose.
- [ ] **request owner → needs_input (not assignable):** `{ memberQuery:'Bob', role:'owner', spaceRef:'Family' }` → `needs_input`; no propose (no tool calls).
- [ ] **target not a member → needs_input:** `{ memberQuery:'Alex', role:'editor', spaceRef:'Family' }` → `needs_input`; no propose.
- [ ] **ambiguous user → needs_input:** `{ memberQuery:'Al', role:'editor', spaceRef:'Family' }` → `needs_input`; no propose.
- [ ] **unknown space → needs_input:** `spaceRef:'Nope'` → `needs_input`.
- [ ] **tool error → failed:** listSpaces / readSpace / searchUsers throwing → `failed` (loop, like Slice 16).
- [ ] **planless → failed (gate), no success copy:** `planResult:{ status:'success', plan:{} }` on a viewer→editor → `failed`; text excludes `/prepared/i`.

## Edge cases covered

- viewer→editor, editor→viewer; no-op; owner-demotion-blocked (self+last-owner);
  owner-not-assignable; not-a-member; ambiguous/unknown; tool error → failed; gate
  blocks planless copy; userId only in payload.

## Run / acceptance

```
export PATH="/Users/pierre/.local/share/mise/installs/node/24.14.1/bin:$PATH"
node --test 'agent-runner/src/**/*.test.mjs'
```

- New execution tests green; all prior green; `typeof wf.run === 'function'`.

## Commit

`feat: add change_member_role execution with guards (slice 18)`
