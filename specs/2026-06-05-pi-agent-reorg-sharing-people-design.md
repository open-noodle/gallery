# Pi Agent — Reorg, Sharing & People (Phases G–I)

Status: design / spec
Date: 2026-06-05
Branch: `explore/pi-agent-brainstorm`
Supersedes nothing; extends [the capability roadmap](./2026-05-31-pi-agent-capability-roadmap.md)
and the [capability matrix](./2026-05-19-pi-agent-capability-matrix.md).

## Purpose

Phases B–F shipped 23 strict/hybrid workflows. This spec defines the next three
phases — library reorganization, sharing round-out, and people/face management —
as a single sliced effort. **Phase G ships first.**

Every slice keeps the hard invariants: no direct write tools, every mutation is a
reviewable persisted plan applied only after user review, no raw asset-id lists in
model-facing text, selection handles as the asset-set boundary, and bounded reads.
New mutations become new reviewable operation types that wrap **existing** server
service methods — no new server business logic, only new agent-facing surface.

## Method: TDD

Every slice is implemented test-first. The ordering inside a slice is always:

1. Write the failing test(s) for the new op DTO / apply path / scope gate (server
   vitest) **or** the workflow match/parseSlots/run (agent-runner unit).
2. Watch them fail for the right reason.
3. Implement the minimum to pass.
4. Add edge-case tests, then the eval scenarios (L1 component, L3 live).

A slice is not "done" until: server unit + (where DB-backed) medium tests pass,
agent-runner unit tests pass, the L1 scenario routes with correct slots, and the
L3 propose-only live audit confirms no plan is applied. `make check-server`,
`make lint-server`, and `make check-web` (where the SDK/DTO changes ripple) must be
green, and OpenAPI specs/SDK regenerated (`pnpm -C server sync:open-api` +
`make open-api`) for any new op or read tool.

## Reused building blocks

- `asset-source-resolver.mjs` — resolves a free-text source into a bounded
  selection handle (named entities, dates, places, ratings, upload-date, tags).
- `candidate-disambiguation.mjs` — the Phase-D durable continuation helper
  (numbered candidate list, 10-min TTL, next-turn "the first one" / name / number).
- `plan-gate.mjs` (`gatePlanResult`, `safeFailureText`) and `protocol.mjs`
  (`needsInput`, `handoffOpen`, `failed`).
- `proposeAlbumOperations` for compound/heterogeneous plans;
  `proposeAssetBatchFromSelection` where a single batch action fits.

---

## Phase G — Library reorg (ships first)

### G1 · `move_photos_between_albums` (hybrid) — no new server work

Move a resolved source out of one album and into another in a single reviewable
plan. Pure composition of the already-mapped `album.removeAssets` +
`album.addAssets`; **no new operation type, DTO, scope, or server method**.

**User prompts**

- "Move these from Trips to Japan 2024."
- "Move my Berlin photos from Drafts to Berlin Weekend."

**Flow**: hybrid. Pi resolves source + both albums; Gallery owns the compound plan.

**Workflow** (`workflows/move-photos-between-albums.mjs`)

- Regex fast-path: `move <source> from <albumA> to <albumB>`. Source captured
  non-greedily; `from`/`to` album refs normalized (strip article + trailing
  "album") like the existing album workflows.
- Resolve both albums via `listAlbums` (none → ask which; ambiguous → ask which).
- Resolve source via `resolveAssetSource` (subjective → handoff; empty → ask).
- Propose one plan with two ops in order:
  `album.removeAssets(targetId: A, selectionHandle)` then
  `album.addAssets(targetId: B, selectionHandle)`.

**Edge cases / guards**

- `from` and `to` are **both required**. Bare "move X to B" (no `from`) does not
  match — it falls through to `add_photos_to_album` (treated as an add).
- `A == B` (same album, case-insensitive) → decline with a "those are the same
  album" message; never emit a no-op plan.
- Empty source → ask (never propose a no-op move).
- Source assets not in A: `album.removeAssets` is absent-safe (no-op per asset);
  add still applies. Disclosed in the plan summary ("moves matching photos; any
  not already in A are simply added to B").
- Subjective / recent-trip source → handoff (matches the add/remove workflows).
- Registry placement: **before `add_photos_to_album`** and `remove_photos_from_album`
  so "move … from … to …" is not shredded by the add/remove patterns; its distinct
  `move` verb + mandatory `from … to …` shape keeps the seam clean.

**Tests**

- _agent-runner unit_ (`move-photos-between-albums.spec.mjs`):
  - match: extracts `{source, fromAlbumRef, toAlbumRef}` from comma, "from…to…",
    and "the X album" forms.
  - parseSlots: rejects missing `from` or `to`; trims article/"album" noun.
  - decline: "move X to B" (no `from`) → no match; subjective source → no match.
  - run (mocked client): two-op plan, correct op order + targetIds; empty source
    → needsInput; `A == B` → decline; ambiguous album → needsInput; missing album
    → needsInput; tool error → failed (sanitized).
- _L1 scenario_ `l1.move.basic`: "Move my newest 20 from Drafts to Keepers" →
  routes `move_photos_between_albums`, slots `{source:"my newest 20",
fromAlbumRef:"Drafts", toAlbumRef:"Keepers"}`.
- _L1 decline_ `l1.move.no-from`: "Move my newest 20 to Keepers" → does **not**
  route to move (routes to `add_photos_to_album` or open).
- _L3 propose-only_ `l3.plan.move.basic`: live "move <source> from <A> to <B>"
  against two real albums → a two-op plan appears, audit confirms **not applied**;
  removeAssets target = A, addAssets target = B.

---

### G2 · `stack_assets` / `unstack_assets` (hybrid) — new ops `asset.stack` / `asset.unstack`

Group a resolved set of photos into a stack (burst grouping) or ungroup an
existing stacked set. Wraps `StackService.create` / `StackService.removeAsset` /
`StackService.delete`. Reversible, no data loss → **Low risk**.

**User prompts**

- "Stack these burst photos." / "Stack my 5 newest shots."
- "Unstack these." / "Ungroup the stack on these photos."

**Flow**: hybrid. Pi resolves the source; Gallery owns stack creation + the
primary-asset choice.

**Server changes**

- New op `asset.stack`:
  - DTO: `AssetStackPayloadSchema` — `assetSource` (selection handle), no extra
    payload. Discriminated-union member of the asset-batch action schema.
  - Apply: choose the **primary** by the disclosed rule
    **favorite > rating > newest** over the resolved assets, then call
    `StackService.create({ assetIds, primaryAssetId })` (server requires ≥2,
    first = primary; we pass the chosen primary first).
  - Risk: **Low**. Summary/target/payload/risk wired into the four exhaustive
    switches in `agent-operation-plan.service.ts` (the crop/OQ-F1 lesson:
    a new op must be added to **all** of summary, target-kind, payload, risk).
- New op `asset.unstack`:
  - Apply: for the resolved assets, call `StackService.removeAsset` per asset (or
    `StackService.delete` when a whole stack is cleared). Absent-safe (un-stacking
    an unstacked asset is a no-op).
  - Risk: **Low**.
- New write scope `manageStacks`. Granted in **VisualOrganizer + LocalPowerUser**,
  off in Careful. Checked at both propose (`prepareOperations`) and apply
  (`validateApplyAccess`).

**Workflow** (`workflows/stack-assets.mjs`, `workflows/unstack-assets.mjs`)

- `stack_assets` verbs: `stack`, `group into a stack`. `unstack_assets` verbs:
  `unstack`, `ungroup`, `un-stack`. Verb sets are fully disjoint from
  rotate/crop/trash/share, so registry order relative to other asset workflows is
  free; placed adjacent to the image-edit/lifecycle group for readability.
- Resolve source → selection handle. Propose `asset.stack` / `asset.unstack`
  through `proposeAssetBatchFromSelection`.
- Disclose the primary rule in the plan/success text ("keeps the favorite/
  highest-rated as the stack cover").

**Edge cases / guards**

- `< 2` resolved assets → ask for a broader source (a stack needs at least two);
  never propose a one-asset stack.
- Empty source → ask.
- Subjective source ("the best burst") → handoff.
- `manageStacks` ungranted → propose is blocked with a permission disclosure.
- Unstack on an unstacked source → still proposes (absent-safe apply), but the
  summary states it only affects currently-stacked assets.

**Tests**

- _server unit_ (`agent-operation-plan.service.spec.ts`):
  - `asset.stack` / `asset.unstack` parse in the action union; malformed (missing
    `assetSource`) rejected with an actionable hint.
  - propose maps to Image/AssetBatch target, Low risk; summary/payload populated.
  - apply: `asset.stack` picks primary by favorite > rating > newest (three
    ordered fixtures prove each tie-break); `< 2` assets → apply-time guard.
  - scope: `manageStacks` off → propose blocked at `prepareOperations` and apply
    blocked at `validateApplyAccess`.
- _server unit_ (`agent-session.service.spec.ts`): preset snapshot — `manageStacks`
  true in VisualOrganizer + LocalPowerUser, false in Careful.
- _agent-runner unit_ (`stack-assets.spec.mjs`, `unstack-assets.spec.mjs`):
  match/parseSlots for stack vs unstack; `< 2` → needsInput; subjective → handoff;
  decline cross-verbs ("rotate"/"trash" don't match).
- _L1_ `l1.stack.basic`: "Stack my 5 newest photos" → `stack_assets`;
  `l1.unstack.basic`: "Unstack these" → `unstack_assets`.
- _L1 decline_ `l1.stack.too-few` is asserted at unit level (count is a runtime
  resolution, not a routing fact).
- _L3 propose-only_ `l3.plan.stack.basic` + `l3.plan.unstack.basic`: live propose,
  audit-clean (not applied). Eval preset = VisualOrganizer (grants `manageStacks`),
  so the plan is created but never applied by the read-only audit.

---

## Phase H — Sharing round-out

### H1 · `share_album` (hybrid) — extend `shareLink.create` to album type

Create a public link for a whole album (not just a hand-picked asset set).
`SharedLinkService.create` already supports `SharedLinkType.Album` + `albumId`;
today the agent apply path hard-codes `SharedLinkType.Individual`. This slice
threads the type + album id through the existing op.

**User prompts**

- "Share the Family album as a link."
- "Make a public link for the Japan 2024 album that expires in 7 days."

**Flow**: hybrid. Pi resolves the album; Gallery owns the share-link plan.

**Server changes**

- Extend `shareLink.create`:
  - DTO gains an optional `shareType` (`individual` | `album`, default
    `individual`) and `albumId`. When `shareType: album`, `albumId` is required and
    `assetSource` is omitted; the existing individual path is unchanged.
  - Apply: branch on `shareType` → `SharedLinkService.create({ type: Album,
albumId, ...options })` vs the current individual path. Same optional
    expiry/password/`showMetadata`.
  - Reuse the existing **`createSharedLinks`** scope (LocalPowerUser only). Risk:
    **High**, OUTWARD-FACING (unchanged from individual links).
- No new scope. Space-level links are **out of scope** (no `SharedLinkType.Space`;
  OQ-H1).

**Workflow** (`workflows/share-album.mjs`)

- Patterns: `share the <X> album as a link`, `create/make a (public) link for the
<X> album`. Reuse `share_assets`' expiry/password/hide-metadata modifier parsing.
- Resolve album via `listAlbums` (none → ask; ambiguous → ask). Propose
  `shareLink.create{ shareType: album, albumId, ...modifiers }`.
- Registry placement: **before `share_assets`**. `share_assets` already _declines_
  container sources ("…album"/"…space"), so "share the X album" lands on
  `share_album`; `share_album` requires the literal `album` noun, so it never
  steals individual-asset shares.

**Edge cases / guards**

- Missing album → ask which album.
- Ambiguous album name → ask which one (numbered list; reuse disambiguation copy).
- `createSharedLinks` ungranted (Careful/VisualOrganizer) → propose blocked with an
  outward-facing disclosure; **no link ever created**. Eval preset keeps it off, so
  L3 is propose-only by construction.
- Past/!valid expiry → rejected by the op DTO (reuse existing validation).
- Empty album (no assets) → still allowed (an empty album link is valid), but the
  summary states the album currently has 0 assets.

**Tests**

- _server unit_ (`agent-operation-plan.service.spec.ts`):
  - `shareLink.create{shareType: album, albumId}` parses; `album` without
    `albumId` rejected; `album` with `assetSource` rejected (mutually exclusive).
  - apply maps album-type → `SharedLinkService.create` with `type: Album` +
    `albumId` (mock asserts the call shape); individual path unchanged
    (regression).
  - scope: `createSharedLinks` off → propose + apply both blocked.
  - risk = High; outward-facing flag set.
- _agent-runner unit_ (`share-album.spec.mjs`): match for the album forms +
  modifiers; "share these photos as a link" (no `album`) → no match (stays
  `share_assets`); ambiguous/missing album → needsInput.
- _L1_ `l1.share-album.basic`: "Share the Family album as a link" → `share_album`,
  slot `{albumRef:"Family"}`; `l1.share-album.expiry`: "+ expires in 7 days" →
  `expiryDays:7`.
- _L1 seam_ `l1.share-album.vs-assets`: "Share these photos as a link" →
  `share_assets`, not `share_album`.
- _L3 propose-only_ `l3.plan.share-album.basic`: live propose against a real album
  with the LocalPowerUser… **no** — eval preset is VisualOrganizer, which does not
  grant `createSharedLinks`, so the live assertion is that the plan is **blocked /
  not created** (same propose-only-by-construction guarantee as `share_assets`).
  The album-type apply mapping is proven at server-unit level.

---

## Phase I — People & face management

### I1 · `searchPeople` read tool — the resolution foundation

People workflows resolve a person **name → id** before proposing. There is no
server-side person name search today (`PersonService.getAll` is paginated with no
name filter), so this slice adds one.

**Server changes**

- `person.repository`: add a name-search query — trigram match on `person.name`
  (`f_unaccent(name) % f_unaccent($q)`, mirroring `searchPlaces`), scoped to the
  caller's visible people (own people + shared-space people, per the existing
  visibility rules). Bounded limit; ordered by similarity.
- New read tool `searchPeople`: returns `matched` (single) /
  `ambiguous` (candidate list) / `not_found`, mirroring `resolveLocation`.
  **Scrubbed fields only**: id, name, thumbnail reference, optional face count — no
  raw face vectors, no asset URLs.

**Edge cases / guards**

- Empty query → `not_found` with an ask.
- Hidden people excluded by default (a hidden person is resolvable only when the
  prompt is an explicit unhide — handled in I2).
- Same-name people → `ambiguous` candidate list (drives the Phase-D continuation).

**Tests**

- _server unit_ (read-tool contract): valid query → matched/ambiguous/not_found
  shapes; malformed → actionable hint; scrubbed-field assertion (no vectors/URLs).
- _server medium_ (`person.repository` name search, real DB): exact match;
  accent-insensitive match; multiple same-name → ordered candidates; hidden
  excluded; shared-space person visibility respected; caller isolation (cannot see
  another user's private people).
- _agent-runner unit_: a `searchPeople` client stub feeds the resolver in I2/I3
  tests (matched/ambiguous/not_found branches).
- _L1_ `l1.people.resolve`: a rename/hide prompt drives a `searchPeople` call with
  the right name slot (asserted via the recorded tool calls).

---

### I2 · `rename_person` / `set_person_birthdate` / `hide_person` (hybrid) — new op `person.update`

Wrap `PersonService.update` (`name` / `birthDate` / `isHidden`). All reversible →
**Low risk**. New `managePeople` scope (VisualOrganizer + LocalPowerUser).

**User prompts**

- "Rename this person to Alex." / "Rename Alejandra to Karina."
- "Set Alex's birthday to 1990-05-01." / "Set Alex's birthday to May 1 1990."
- "Hide this person." / "Hide Alex from my People list." / "Unhide Alex."

**Server changes**

- New op `person.update`:
  - DTO `PersonUpdatePayloadSchema` — `personId` + at least one of
    `name` / `birthDate` (ISO date) / `isHidden`. Reject empty payloads.
  - Apply: `PersonService.update(personId, { name?, birthDate?, isHidden? })`;
    preserves unspecified fields.
  - Risk: **Low**. Scope: `managePeople`. Wired into all four op switches.

**Workflows** (`workflows/rename-person.mjs`, `set-person-birthdate.mjs`,
`hide-person.mjs`)

- Each resolves the person via `searchPeople` (name; ambiguous → Phase-D
  candidate continuation; not_found → ask).
- `rename_person`: `rename <person> to <newName>` → `person.update{name}`. Decline
  album/space "rename" (those route to `rename_or_describe_album/space`; people
  rename requires a resolved person, not a container noun).
- `set_person_birthdate`: `set <person>'s birthday/birthdate to <date>` → parse the
  date (ISO or natural "May 1 1990"); ambiguous/unparseable date → ask →
  `person.update{birthDate}`.
- `hide_person`: `hide <person>` → `isHidden:true`; `unhide/show <person>` →
  `isHidden:false` (this is the one path allowed to resolve a hidden person).

**Edge cases / guards**

- Ambiguous person name → numbered candidate list + durable continuation.
- not_found person → ask (do not guess).
- Rename to the current name (no-op) → still proposes but discloses "no change".
- Unparseable / future birthdate → ask (future dates rejected by DTO).
- `managePeople` ungranted → propose blocked with disclosure.
- Registry: people verbs (`rename <person> to`, `hide <person>`,
  `set <person>'s birthday`) require a person-ish object; the album/space rename
  workflows own the container nouns and are ordered first.

**Tests**

- _server unit_: `person.update` parses; empty-payload rejected; `birthDate`
  future-date rejected; apply preserves unspecified fields (rename leaves birthDate
  intact); Low risk; `managePeople` scope block at propose + apply.
- _server unit_ (`agent-session.service.spec.ts`): `managePeople` true in
  VisualOrganizer + LocalPowerUser, false in Careful (snapshot).
- _agent-runner unit_ (three spec files): match/parseSlots per verb; date parsing
  matrix (ISO, "May 1 1990", "1 May 1990", ambiguous → needsInput); ambiguous
  person → continuation offered; hidden-person resolvable only on unhide; cross-verb
  declines (album rename, space rename).
- _L1_: `l1.person.rename`, `l1.person.birthdate`, `l1.person.hide`,
  `l1.person.unhide` — each routes to its workflow with correct slots.
- _L1 seam_ `l1.person.rename-vs-album`: "Rename the Family album to X" →
  `rename_or_describe_album`, not `rename_person`.
- _L3 propose-only_: `l3.plan.person.rename`, `l3.plan.person.birthdate`,
  `l3.plan.person.hide` — live propose against a real person (resolved via
  `searchPeople`), audit-clean (not applied). Eval preset (VisualOrganizer) grants
  `managePeople`, so the plan is created but the read-only audit applies nothing.

---

### I3 · `merge_people` (hybrid) — new op `person.merge`

Wrap `PersonService.mergePerson`. **High risk + irreversibility disclosure**
(faces reassigned, the merged person record deleted; not cleanly undoable). Same
`managePeople` scope.

**User prompts**

- "Merge these two people." / "Merge Alejandra into Karina."
- "Alex and Alexander are the same person — merge them."

**Server changes**

- New op `person.merge`:
  - DTO `PersonMergePayloadSchema` — `targetPersonId` + `sourcePersonIds`
    (≥1, excludes the target). Reject self-merge (`target ∈ sources`).
  - Apply: `PersonService.mergePerson(targetPersonId, { ids: sourcePersonIds })`.
  - Risk: **High**. Scope: `managePeople`. Wired into all four switches.
  - Plan summary carries the irreversibility disclosure ("merging cannot be undone;
    the other person's faces move to the kept person and the record is removed").

**Workflow** (`workflows/merge-people.mjs`)

- Patterns: `merge <A> into <B>`, `merge <A> and <B>`. Resolve **both** via
  `searchPeople` (each ambiguous/not_found handled; the **kept** person is the
  `into`/second when phrased, else asks which to keep).
- Propose `person.merge{ targetPersonId, sourcePersonIds }`.

**Edge cases / guards**

- Either name ambiguous → candidate continuation (resolve one at a time).
- Either name not_found → ask.
- Same person on both sides → decline (nothing to merge).
- "merge these two people" with no names + no prior context → ask which two.
- `managePeople` ungranted → blocked with disclosure.
- High-risk + outward-of-no-return → the success text states it is irreversible
  before review.

**Tests**

- _server unit_: `person.merge` parses; self-merge rejected; empty sources
  rejected; apply calls `mergePerson(target, {ids})` (mock asserts shape); risk =
  High; `managePeople` block at propose + apply.
- _agent-runner unit_ (`merge-people.spec.mjs`): match for "into" + "and" forms;
  both-ambiguous → sequential continuation; same-person → decline; "merge these two"
  (no names) → needsInput.
- _L1_ `l1.person.merge`: "Merge Alejandra into Karina" → `merge_people`, slots
  `{keep:"Karina", merge:["Alejandra"]}`.
- _L3 propose-only_ `l3.plan.person.merge`: live propose against two real people,
  audit-clean (**not applied** — merge is irreversible, so the read-only audit is
  load-bearing here: it must confirm the plan exists but was never applied).

---

## Cross-cutting work

### Permission model

| Scope                    | Careful | VisualOrganizer | LocalPowerUser |
| ------------------------ | ------- | --------------- | -------------- |
| `manageStacks` (G2)      | off     | on              | on             |
| `createSharedLinks` (H1) | off     | off             | on             |
| `managePeople` (I2, I3)  | off     | on              | on             |

`createSharedLinks` is reused unchanged (LocalPowerUser only). `manageStacks` and
`managePeople` are new flags added to the preset definitions and the `Custom`
expansion. Each is enforced at both propose (`prepareOperations`) and apply
(`validateApplyAccess`). Snapshot tests in `agent-session.service.spec.ts` assert
the per-preset values.

### New operation types (summary)

| Op              | Wraps                       | Risk | Scope          | Reversible |
| --------------- | --------------------------- | ---- | -------------- | ---------- |
| `asset.stack`   | `StackService.create`       | Low  | `manageStacks` | yes        |
| `asset.unstack` | `StackService.removeAsset`  | Low  | `manageStacks` | yes        |
| `person.update` | `PersonService.update`      | Low  | `managePeople` | yes        |
| `person.merge`  | `PersonService.mergePerson` | High | `managePeople` | **no**     |

`shareLink.create` is **extended** (not new) with `shareType: album` + `albumId`.
`move_photos_between_albums` introduces **no** new op (composes existing album ops).

Each new op MUST be added to all four exhaustive switches in
`agent-operation-plan.service.ts` (summary, target-kind, payload, risk) — the
crop/OQ-F1 regression proved that a partial wiring classifies but cannot propose.

### New read tool

`searchPeople` (I1) — scrubbed name resolution; returns matched/ambiguous/
not_found. Backed by a new trigram name-search query in `person.repository`.

### Routing / registry order

New entries and their seams (first-match-wins regex fast-path):

- `move_photos_between_albums` **before** `add_photos_to_album` /
  `remove_photos_from_album` (distinct `move … from … to …` shape).
- `share_album` **before** `share_assets` (container-noun gate; `share_assets`
  already declines "…album").
- `rename_person` after `rename_or_describe_album` / `rename_or_describe_space`
  (container nouns win their refs; people rename needs a resolved person).
- `stack_assets` / `unstack_assets` — disjoint verbs, grouped with the image-edit
  workflows for readability.
- `merge_people` — disjoint `merge` verb; placed with the people workflows.

### Generated artifacts

- `pnpm --dir server sync:agent-capabilities` to regenerate
  `manifest.generated.json` and the matrix's generated workflow table (target: **29
  workflows** — 23 + G1, G2×2, H1, I2×3, I3; `searchPeople` is a read tool, not a
  workflow).
- `pnpm -C server sync:open-api` + `make open-api` for the new ops + `searchPeople`
  read tool (new SDK types for stacks, people ops, album-share).
- Update the [capability matrix](./2026-05-19-pi-agent-capability-matrix.md):
  Flow Ownership rows (move/stack/share-album/people), Core rows, read-tool list
  (`searchPeople`), reviewable-op list, and the Phase-G/H/I Next-Steps summary.
- Do **not** run server prettier on `agent-runner/**` or `docs/**` (double-quote
  churn; agent-runner is not prettier-gated). Run `pnpm -C docs exec prettier
--write` on this spec and any matrix edits.

### Testing layers (every slice)

| Layer                | Coverage                                                                                  |
| -------------------- | ----------------------------------------------------------------------------------------- |
| MCP/op contract      | New-op DTOs parse valid + reject malformed with hints; scope-block at propose + apply.    |
| Server unit          | Apply path calls the right service method with the right shape; risk level; preset snaps. |
| Server medium        | `person.repository` name search against a real DB (I1).                                   |
| Agent-runner unit    | match/parseSlots slot fidelity; decline seams; run() with a mocked client per branch.     |
| L1 (component eval)  | Routing + slot extraction + decline seams (listed per slice above).                       |
| L3 (live, read-only) | Propose-only against the running instance; audit confirms **no plan is applied**.         |

L3 note: all new intents are **verb-driven** (move/stack/share/rename/hide/merge),
not coordinate-geometry, so — unlike crop (OQ-F1) — they are expected to route
under the live LLM agent and carry real L3 routing assertions.

## Resolved open questions

- **OQ-G2** — stack primary-asset rule = **favorite > rating > newest**, disclosed
  in the plan text.
- **OQ-H1** — **space-level** share links are out of scope (no `SharedLinkType.Space`).
  Album-level only.
- **OQ-I2** — `merge_people` shares the `managePeople` scope (High-risk +
  irreversibility disclosure) rather than a stricter LocalPowerUser-only gate. The
  reviewable-plan + High-risk disclosure is the safeguard; revisit if real use shows
  a need to tighten.

## Slice order (implementation sequence)

1. **G1** `move_photos_between_albums` (no server work — fastest; pure composition).
2. **G2** `asset.stack` / `asset.unstack` ops + `manageStacks` + stack/unstack
   workflows.
3. **H1** extend `shareLink.create` (album type) + `share_album` workflow.
4. **I1** `searchPeople` read tool + `person.repository` name search (foundation).
5. **I2** `person.update` op + `managePeople` + rename/birthdate/hide workflows.
6. **I3** `person.merge` op + `merge_people` workflow.

Each slice is independently shippable, test-first, and ends green (server unit +
medium where applicable, agent-runner unit, L1 routing, L3 propose-only audit-clean)
before the next begins.

## Out of scope (this spec)

- Export/download workflows (deferred to a future spec — `downloadArchive` streams,
  which does not fit the sync plan→apply→result-card model).
- Face-level reassignment ("this face is actually Bob").
- Space-level share links.
- Permanent / irreversible deletion of any asset or person beyond the documented
  High-risk reviewable merge.
