# Workflow Expansion — Slice 20: Group 2 L3 read-only scenarios

> Live verification of the three space workflows. Read-only `{space}`/`{user}`
> discovery + routing for all three; plan-proposed for describe-space on any
> instance; membership/role plan-proposed gated to the local seeded stack.

**Goal:** All three space workflows route live; `rename_or_describe_space` proposes
a never-applied plan against a discovered `{space}`; membership/role propose a plan
only against the **local seeded** stack (gated by `EVAL_L3_SEEDED=1`) and are
routing-only against personal (only 1 user = owner there, confirmed via
`GET /users`).

**Spec scope:** Slice 20 (closes Phase 2). **Verified endpoints (contract-first):**
`GET /shared-spaces` → `[{ id, name, memberCount, assetCount, members, … }]`;
`GET /users` → `[{ id, name, email, … }]`.

## L3 driver (`eval/drivers/l3-session.mjs`)

Add `{space}` + `{user}` read-only discovery mirroring `{album}`:

- `spaceNameCache` / `resolveSpaceName()`: `GET /shared-spaces`, rank by
  `(memberCount, assetCount)` desc, pick `[0].name`; cache; null if none.
- `userNameCache` / `resolveUserName()`: `GET /users`, pick the first user's `name`
  (on the seeded stack, env-prep ensures a non-owner exists; on personal it is the
  owner — fine for routing-only); cache; null if none.
- `substituteTokens(prompt)`: chain album → space → user replacement; each leaves
  its token if unresolved. Replace the line-229 call
  `await substituteAlbum(prompt)` with `await substituteTokens(prompt)`.

## Config (`eval/config.mjs`)

Add `l3.seeded: process.env.EVAL_L3_SEEDED === '1'` (default false). On personal it
stays false → membership/role assert routing-only; on the local seeded inner loop
set `EVAL_L3_SEEDED=1` → membership/role assert plan-proposed.

## Scenarios (`eval/scenarios/l3-readonly.mjs`)

`import config from '../config.mjs';` then `const SEEDED = config.l3.seeded;`.

**Routing:**

- `l3.recall.space.describe`: 'set the description on the {space} space to Shared memories' → `rename_or_describe_space`.
- `l3.recall.members.add`: 'add {user} to the {space} space as editor' → `manage_space_members`.
- `l3.recall.role`: 'make {user} an editor in the {space} space' → `change_member_role`.

**Plan-proposed:**

- `l3.plan.describe.space`: 'set the description on the {space} space to L3 eval note'
  → `{ rename_or_describe_space, planProposed: true }`, threshold 0.5 (any instance).
- `l3.plan.members.add`: 'add {user} to the {space} space as editor'
  → `{ manage_space_members, planProposed: SEEDED ? true : undefined }`, threshold 0.5.
- `l3.plan.role`: 'make {user} an editor in the {space} space'
  → `{ change_member_role, planProposed: SEEDED ? true : undefined }`, threshold 0.5.

(With `planProposed: undefined` the scorer asserts routing only — the personal run
asserts the kind for membership/role; the seeded run additionally asserts the plan.)

**Negative:**

- `l3.neg.space.add-photos`: 'add my newest 20 photos to the {space} space' →
  `{ anyKind: ['none','add_photos_to_album'] }` (photo-source guard keeps it out of
  manage). (Substituted `{space}` keeps the prompt realistic.)

## Run (against rc-16 personal — Phase 2 boundary)

```
export PATH="/Users/pierre/.local/share/mise/installs/node/24.14.1/bin:$PATH"
cd agent-runner && node --env-file-if-exists=.env eval/run.mjs --layer L3 --diff
```

- All three route; describe-space proposes a plan; membership/role route (routing-only
  on personal); the photo-to-space negative does not become a member op; no-apply +
  gate-block audits clean. Then `--accept` to re-seed `baseline.l3.json`.

## Acceptance

- describe-space proposes a never-applied plan live; membership/role route correctly
  (plan-proposed only on the seeded stack); audits clean; baseline re-seeded.

## Commit

`test: add Group 2 L3 read-only scenarios + {space}/{user} discovery (slice 20)`
