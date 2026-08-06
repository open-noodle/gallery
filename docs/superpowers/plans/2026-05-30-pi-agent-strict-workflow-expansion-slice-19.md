# Workflow Expansion — Slice 19: Group 2 manifest, capability regen & L1 scenarios

> Integration slice. Registers the three space workflows, regenerates the manifest
> mirror + capability matrix, adds the L1 battery, and tightens one disambiguation
> guard surfaced by registration.

**Goal:** rename_or_describe_space / manage_space_members / change_member_role
become routable (regex + LLM) and visible in the matrix, with L1 coverage.

**Spec scope:** Slice 19. **Depends on:** Slices 13-18, the manifest/registry/sync
machinery, the local model.

## 1. Registry ordering (`registry.mjs`)

Import the three space factories. New order (regex fast-path is first-match-wins):

```
[ createRecentTripAlbumWorkflow,
  renameOrDescribeSpaceWorkflow,    // BEFORE album: the `space` gate wins "rename the X space"
  renameOrDescribeAlbumWorkflow,
  archiveAssetsWorkflow,
  favoriteAssetsWorkflow,
  tagAssetsWorkflow,
  manageSpaceMembersWorkflow,       // BEFORE add_photos
  changeMemberRoleWorkflow,
  addPhotosToAlbumWorkflow ]        // LAST
```

- `rename_or_describe_space` before `rename_or_describe_album`: "rename the Family
  space to X" → space gate matches; "rename the Family album to X" → space declines
  (no `space` keyword) → album. Verified.
- `manage_space_members` before `add_photos`: a member add reaches manage first;
  a photo add ("add my newest 20 photos to Family") declines manage (no space/role)
  → add_photos.

## 2. Disambiguation guard (`manage-space-members.mjs`)

Registration surfaces: "add my newest 20 photos to **the Family space**" matches
manage (rest has "space"). Add a `looksLikePhotoSource(text)` guard so a photo-ish
member capture declines (→ falls through; no add-to-space workflow exists, so it
hands to open orchestration / add_photos):

```
const PHOTO_SOURCE_RE = /\b(?:photos?|pics?|pictures?|images?|videos?|clips?|screenshots?|snaps?|shots?|newest|latest|most\s+recent)\b/i;
const looksLikePhotoSource = (text) => PHOTO_SOURCE_RE.test(clean(text));
```

In both the ADD and REMOVE arms, decline when `looksLikePhotoSource(m.groups.members)`.
Add unit tests: "add my newest 20 photos to the Family space" → undefined;
"remove my screenshots from the Family space" → undefined; "add Alex to the Family
space" still matches.

## 3. Manifest entries (`manifest.mjs`)

Append three frozen entries. `planTool: 'proposeAlbumOperations'`,
`supportsContinuation: false`.

- **rename_or_describe_space** — strict, title "Rename or describe space".
  - desc: "User wants to rename a shared space and/or change its description, leaving members and assets unchanged."
  - positive: `['Rename the Family space to Family 2026', 'Set the description on the Trips space to Our adventures', 'Change the description on my Family space']`
  - negative: `['Rename the Family album to Family 2026', 'Add Alex to the Family space', 'Make Alex an editor in Family']`
  - slots: `{ spaceRef:{string,required}, newName:{string,optional}, description:{string,optional} }`
  - requiredReadTools: `['listSpaces']`
  - matrixRow: `{ 'Rename or describe space', 'Solid now', 'Direct space-detail update plan; preserve unspecified fields.' }`
- **manage_space_members** — strict, title "Add or remove space members".
  - desc: "User wants to add or remove members of a shared space, optionally with a role."
  - positive: `['Add Alex to the Family space as editor', 'Add Sam and Jo to the Trips space', 'Remove Bob from the Family space']`
  - negative: `['Add my newest 20 photos to the Family space', 'Make Alex an editor in Family', 'Rename the Family space to Family 2026']`
  - slots: `{ action:{string,required,'add or remove'}, memberQueries:{array,required,'member names or emails'}, spaceRef:{string,required}, role:{string,optional,'editor or viewer (default viewer on add)'} }`
  - requiredReadTools: `['listSpaces','readSpace','searchUsers']`
  - matrixRow: `{ 'Add or remove space members', 'Solid now', 'Resolve members; guard owner/self/last-owner removal; propose the membership plan.' }`
- **change_member_role** — strict, title "Change a space member's role".
  - desc: "User wants to change a shared-space member's role to editor or viewer."
  - positive: `['Make Alex an editor in the Family space', "Change Bob's role to viewer in Trips", 'Make Sam a viewer in Family']`
  - negative: `['Add Alex to the Family space', 'Remove Bob from the Family space', 'Rename the Family space to Family 2026']`
  - slots: `{ memberQuery:{string,required}, role:{string,required,'editor or viewer'}, spaceRef:{string,required} }`
  - requiredReadTools: `['listSpaces','readSpace','searchUsers']`
  - matrixRow: `{ "Change a space member's role", 'Solid now', 'Resolve the member; guard owner/self/no-op; propose the role-change plan.' }`

## 4. Regen mirror + matrix doc

```
node src/bin/sync-strict-workflow-manifest.mjs
cd ../server && node --experimental-strip-types src/bin/sync-agent-capabilities.ts && node --experimental-strip-types src/bin/sync-agent-capabilities.ts --check
```

Prettier-check the matrix doc.

## 5. L1 scenarios

**Recall** (`classification-recall.mjs`):

- `recall.space.rename`: 'rename the Family space to Family 2026' → `rename_or_describe_space`, `{ spaceRef:'Family', newName:'Family 2026' }`.
- `recall.space.describe`: 'set the description on the Trips space to Our adventures' → `rename_or_describe_space`, `{ spaceRef:'Trips', description:/adventures/i }`.
- `recall.members.add`: 'add Alex to the Family space as editor' → `manage_space_members`, `{ action:'add', spaceRef:'Family', role:'editor' }`.
- `recall.members.remove`: 'remove Bob from the Trips space' → `manage_space_members`, `{ action:'remove', spaceRef:'Trips' }`.
- `recall.role.make`: 'make Alex an editor in the Family space' → `change_member_role`, `{ memberQuery:/alex/i, role:'editor', spaceRef:'Family' }`.
- `recall.role.possessive`: "change Bob's role to viewer in Trips" → `change_member_role`, `{ role:'viewer', spaceRef:'Trips' }`.
- `recall.members.add.llm`: 'invite Alex to the Family space' (regex miss → LLM) → `manage_space_members`, slotsSurvive.

**Slot fidelity** (`slot-fidelity.mjs`):

- `slots.members.role-default`: 'add Alex to the Family space' → `manage_space_members`, `{ action:'add', role:'viewer', spaceRef:'Family' }`.
- `slots.role.synonym`: 'make Alex a contributor in Family' → `change_member_role`, `{ role:'editor' }`.

**Negatives** (`classification-negatives.mjs`):

- `neg.space.members.question`: 'who has access to the Family space?' → `none`.
- `neg.space.add-photos`: 'add my newest 20 photos to the Family space' → must NOT
  route to manage (photo-source guard); routing to add_photos OR none is acceptable —
  assert `anyKind: ['none','add_photos_to_album']` (i.e. NOT a member op).

## 6. Verify

```
node --test 'agent-runner/src/**/*.test.mjs'                       # unit (manifest mirror parity)
cd agent-runner && node --env-file-if-exists=.env eval/run.mjs --diff   # L1 ≥ baseline
```

- Unit green; L1 new scenarios pass, existing hold, 0 regressions; then `--accept`.
- `server` matrix `--check` exits 0; matrix doc prettier-clean.

## Edge cases covered

- registry precedence (space-rename before album-rename; manage/role before add_photos).
- photo-source guard keeps "add <photos> to <space>" out of manage.
- rename vs describe; add vs remove; role synonyms; album-vs-space disambiguation.

## Commit

`feat: register + manifest Group 2 space workflows; L1 scenarios + matrix regen (slice 19)`
