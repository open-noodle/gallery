# Workflow Expansion — Slice 16: `manage_space_members` execution + safety guards

> Safety-critical. Test-first against the contract-faithful fake client. After
> green, a review subagent checks it against the spec + the real server contract.

**Goal:** Add `run()`: `listSpaces` resolve → `readSpace` (members + roles) →
`searchUsers` resolve each member → guards → `proposeAlbumOperations`
(`space.addMembers` / `space.removeMembers`) → `gatePlanResult` → copy. No raw ids
in copy; selection-free (member ops carry resolved `userId`s, which is the contract
— there is no handle for users).

**Spec scope:** Slice 16. **Verified DTO contracts:**

- `space.addMembers`: `{ type, summary, targetKind:'existing_space', targetId, payload:{ members:[{ userId, role }] } }`; role ∈ **{editor, viewer}** only (owner NOT assignable); members ≥1.
- `space.removeMembers`: `payload:{ userIds:[uuid…] }` (≥1).
- `readSpace` → `{ space:{ members:[{ userId, name, role, … }], … } }` — **no self/current-user marker**.
- `searchUsers` → `{ users:[{ userId, name, email, … }] }` (field is **userId**, not id).
- **Server backstop:** `agent-operation-plan.service` throws "Pi cannot remove or
  demote the owner of a space"; `shared-space.service` throws "Cannot change your
  own role". So owner-removal/demotion + self-role-change are server-enforced too.

**Self-guard design (decision):** the runner has no current-user identity, and
`readSpace` exposes none. The deterministic proxy for "self" is the space **owner**
(the user managing their own space is its owner), and the server already blocks
removing/demoting any owner. So the workflow's deterministic guard is
**"removing an owner is blocked"**, which subsumes self-removal and last-owner
removal; the server is the backstop for any residual self case. This is the honest,
correct implementation given the contract.

## Contract fixture updates (`contract-fixtures.mjs`)

1. Default `users` → use `userId` (mirror the real shape):
   `[{ userId:'usr-1', name:'Alex', email:'alex@example.com' }]`.
2. `searchUsers` handler **filters by query** (case-insensitive substring on
   name/email) so distinct queries resolve distinct users / model ambiguity /
   not-found: `users.filter(u => !q || `${u.name} ${u.email}`.toLowerCase().includes(q))`.
3. `validateOperations`: add `space.addMembers` + `space.removeMembers` shape checks:
   - addMembers: `targetKind==='existing_space'`, `targetId`, `payload.members` a
     non-empty array; each member `{ userId, role }` with `role ∈ {editor,viewer}`.
   - removeMembers: `targetKind==='existing_space'`, `targetId`, `payload.userIds`
     a non-empty array.

## Design — `run({ client, slots, signal })`

```
action = clean(slots.action).toLowerCase()       // add | remove
memberQueries = slots.memberQueries (array)
role = clean(slots.role).toLowerCase()            // add only

// owner not assignable
if (action==='add' && role==='owner') return needsInput('I can add members as editor or viewer, not owner. Which role?')

// 1. resolve space
ref = normalizeSpaceRef(slots.spaceRef)
spaces = (await listSpaces).spaces
matches = spaces.filter(s => name === ref, ci)
0 → needsInput(which space); >1 → needsInput(which one)
spaceId = matches[0].id; spaceName = matches[0].name

// 2. readSpace members (try/catch → failed)
space = (await readSpace({spaceId})).space ?? detail
members = space.members; memberById = Map(userId → member)

// 3. resolve each query (try/catch → failed)
for q of memberQueries:
  users = (await searchUsers({query:q})).users
  0 → needsInput(could not find "q"); >1 → needsInput(multiple match "q")
  resolved.push(users[0])

// 4. guards + payload
if add:
  toAdd = resolved.filter(u => !memberById.has(u.userId))
  if toAdd.length===0 → needsInput(already members)
  op = space.addMembers { members: toAdd.map(u => ({ userId:u.userId, role })) }
  copy = add N members as <role>
else: // remove
  owners = resolved.filter(u => memberById.get(u.userId)?.role==='owner')
  if owners.length → needsInput("I can't remove the owner of …")   // self + last-owner
  toRemove = resolved.filter(u => memberById.has(u.userId) && role!=='owner')
  if toRemove.length===0 → needsInput(not members)
  op = space.removeMembers { userIds: toRemove.map(u => u.userId) }
  copy = remove N members

// 5. propose (try/catch → failed) → gatePlanResult
```

Imports: `failed`, `needsInput`; `gatePlanResult`, `safeFailureText`. Registry/
manifest: Slice 19.

## TDD — exact tests (`manage-space-members.test.mjs`)

`import { makeContractClient } from './contract-fixtures.mjs';`; flip router-only
`typeof wf.run` to `'function'`. Build a space client:
`makeContractClient({ spaces:[{ id:'spc-1', name:'Family', members:[{ userId:'u-owner', name:'Pierre', role:'owner' }, { userId:'u-bob', name:'Bob', role:'viewer' }] }], users:[…] })`.

- [ ] **unique add with role → planned (no raw ids in copy):** users include
      `{ userId:'u-alex', name:'Alex' }` not in the space; `slots:{ action:'add', memberQueries:['Alex'], spaceRef:'Family', role:'editor' }`
      → `planned`; op deepEquals `{ type:'space.addMembers', summary:…, targetKind:'existing_space', targetId:'spc-1', payload:{ members:[{ userId:'u-alex', role:'editor' }] } }`;
      `outcome.text` does not contain `'u-alex'`.
- [ ] **ambiguous user → needs_input (no propose):** two users match 'Al'
      (`Alex`, `Alice`); `memberQueries:['Al']` → `needs_input`; no `proposeAlbumOperations`.
- [ ] **user not found → needs_input:** `memberQueries:['Zzz']` (no match) → `needs_input`; no propose.
- [ ] **already-member add → needs_input (don't re-add):** `memberQueries:['Bob']`
      (Bob already a viewer member) → `needs_input`; no propose.
- [ ] **remove a member → planned:** `slots:{ action:'remove', memberQueries:['Bob'], spaceRef:'Family' }`
      → `planned`; op `{ type:'space.removeMembers', …, payload:{ userIds:['u-bob'] } }`.
- [ ] **remove a non-member → needs_input:** `memberQueries:['Alex']` (not a member)
      → `needs_input`; no propose.
- [ ] **remove the owner blocked (self / last-owner) → needs_input:**
      `memberQueries:['Pierre']` (role owner) → `needs_input`; no propose.
- [ ] **add as owner → needs_input (owner not assignable):** `role:'owner'` → `needs_input`; no propose.
- [ ] **unknown space → needs_input; ambiguous space → needs_input** (no propose).
- [ ] **searchUsers/readSpace tool error → failed.**
- [ ] **planless propose → failed (gate), no success copy.**
- [ ] **no raw ids:** for the planned add/remove, assert the resolved `userId`s do
      NOT appear in `outcome.text` (they belong only in the plan payload).

## Edge cases covered

- add with role; ambiguous/not-found user; already-member; remove member; remove
  non-member; **remove owner blocked** (self + last-owner); owner-not-assignable on
  add; unknown/ambiguous space; tool error → failed; gate blocks planless copy;
  userIds only in the payload, never in copy.

## Run / acceptance

```
export PATH="/Users/pierre/.local/share/mise/installs/node/24.14.1/bin:$PATH"
node --test 'agent-runner/src/**/*.test.mjs'
```

- New execution tests green; all prior green. Then a review subagent verifies the
  guards vs the spec + server contract before commit.

## Commit

`feat: add manage_space_members execution with safety guards (slice 16)`
