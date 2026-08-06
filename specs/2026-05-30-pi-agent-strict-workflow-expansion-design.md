# Pi Agent Strict/Hybrid Workflow Expansion Design

Status: planning artifact
Date: 2026-05-30
Branch: `explore/pi-agent-brainstorm`

> **For agentic workers (`/impl-loop`):** This spec is written for slice-by-slice
> implementation. Each entry under **Test-Driven Development** is a self-contained
> vertical slice with a goal, the files it touches, a TDD test list, and acceptance
> criteria. Implement them **in order**, **test-first** (write the failing test,
> then the code, then green), one slice per loop. Every slice ends green
> (`pnpm --dir agent-runner test`, plus server checks where noted) and is
> independently shippable. Resume with "continue from slice N".

## Purpose

Three strict/hybrid workflows ship today (`create_recent_trip_album`,
`rename_or_describe_album`, `add_photos_to_album`). The
[capability matrix](./2026-05-19-pi-agent-capability-matrix.md) names ~15 more
rows that should be Gallery-owned procedures but currently fall to open
orchestration, where smaller models mis-sequence tools, fabricate plans, or call
tools with shapes the server rejects.

This spec productizes the three highest-priority candidate **groups** into
seven new strict/hybrid workflows, all feasible on the **current** MCP/plan-tool
surface (no new backend):

1. **Batch asset actions** — `archive_assets`, `favorite_assets`, `tag_assets`
   (hybrid, metadata-bound). "archive my newest 50 photos", "favorite my last 10",
   "tag my newest 20 as Travel".
2. **Space details & membership** — `rename_or_describe_space`,
   `manage_space_members`, `change_member_role` (strict). "rename the Family space
   to Family 2026", "add Alex to Family as editor", "make Alex a viewer".
3. **General album-from-source** — `create_album_from_source` (hybrid). "make an
   album of my newest 50 photos" — the generic album-create the trip workflow
   doesn't cover.

Groups 1 and 3 share one **asset source-resolver** (extracted and broadened from
`add_photos_to_album`). Group 2 reuses the album-rename pattern and the existing
operation proposer.

## Current State

- The strict/hybrid **foundation** (registry, manifest-driven LLM classifier with
  a regex fast-path, generic dispatcher, success-gating, durable continuation,
  copy delegation, Slice 6 observability events) is in place — see
  [foundation design](./2026-05-29-pi-agent-strict-hybrid-foundation-design.md).
  New workflows register into it; no foundation changes are required.
- The L1 (component) + L3 (live, read-only) **eval harness**
  (`agent-runner/eval/`) is the iteration loop. Every new workflow lands with L1
  recall/slot/negative scenarios and an L3 routing + plan-proposed scenario.
- **Hard lesson (baked into Slice 1):** `add_photos_to_album` shipped a source
  step that called `resolveAssetSearchFilters({ query })` and metadata-mode
  `searchAssets({ query })` — shapes the real tools **reject** — and never planned
  live, because its unit fixture ignored call args. **Every fixture in this spec
  validates call shapes against the real tool DTOs.** A workflow is not "done"
  until an L3 scenario proves it proposes a plan against the live server.

## Scope

In scope: the seven workflows above, the shared source-resolver and its
broadening (recency + relative dates + media type), manifest/capability-matrix
regeneration, and L1 + L3 eval coverage for each.

### Non-Goals

- **No new MCP tools or operation types.** Everything maps to existing plan tools
  (`proposeAssetBatchFromSelection`, `proposeAlbumOperations`,
  `proposeAlbumFromSelection`) and existing operation types.
- **Named-entity / semantic / location source resolution stays handoff.** The
  resolver deterministically handles recency, relative dates, and media type.
  Sources needing people/tag/album/location/camera resolution, or CLIP semantics
  ("beach pics"), hand off to open orchestration (a later spec may integrate
  `resolveAssetSearchFilters` for named entities).
- **Tag removal, favorite/archive of subjective sources** are out: `tag_assets`
  is add-only (the batch-from-selection action union has no `removeTag`);
  subjective ("best", "blurry") sources hand off.
- **No apply changes.** All workflows propose reviewable plans only; apply remains
  the existing gated path.

## Flow Ownership

| Workflow                   | Flow ownership | Closes capability-matrix row(s)                    |
| -------------------------- | -------------- | -------------------------------------------------- |
| `archive_assets`           | Hybrid         | Archive assets (strict when metadata-bound)        |
| `favorite_assets`          | Hybrid         | Mark favorites (strict once bounded)               |
| `tag_assets`               | Hybrid         | Add or remove tags (add arm)                       |
| `rename_or_describe_space` | Strict         | Update space details                               |
| `manage_space_members`     | Strict         | Add or remove space members                        |
| `change_member_role`       | Strict         | Change space member roles                          |
| `create_album_from_source` | Hybrid         | Create event/trip album (generic recency/date arm) |

Hard invariants (inherited from the foundation, asserted per workflow): no claimed
plan without a persisted plan id; no direct write tools; no raw asset-id lists in
model-facing args (selection handles only); recoverable tool mistakes retried only
when the correction is mechanical; subjective/unresolvable sources hand off rather
than fabricate.

## User-Facing Behavior

Each workflow produces a **reviewable plan card** (never auto-applied), or a
clarifying question, or a clean handoff. Representative flows:

- `archive_assets` — "archive my newest 50 photos" → metadata search (newest 50)
  → plan card with `asset.setArchive` over the selection, count, representative
  thumbnails, "review before applying". "archive the best ones" → handoff.
- `favorite_assets` — "favorite my last 10 photos" → `asset.setFavorite`. "unfavorite
  my newest 5" → `asset.setFavorite{favorite:false}`.
- `tag_assets` — `tag my newest 20 photos as "Travel"` → `asset.addTag{tagName:"Travel"}`.
- `rename_or_describe_space` — "rename the Family space to Family 2026" →
  `space.updateDetails` (name only; description/color preserved). Ambiguous space →
  asks which.
- `manage_space_members` — "add Alex to the Family space as editor" →
  `searchUsers` → `space.addMembers` (role default `viewer` unless specified).
  Already-member / ambiguous user / last-owner-removal → guarded.
- `change_member_role` — "make Alex an editor in Family" → `space.updateMemberRole`.
  No-op / self-demotion / last-owner-demotion → guarded.
- `create_album_from_source` — "make an album of my newest 50 photos called Recent"
  → `album.create` + `album.addAssets` from the handle.

## Architecture

### Shared asset source-resolver

A new `agent-runner/src/strict-workflows/asset-source-resolver.mjs` owns turning a
free-text asset source into a **selection handle** (or a handoff/needs-input
signal), via the **real** `searchAssets` contract:

```
resolveAssetSource({ client, sourceDescription, signal })
  -> { status: 'resolved', selectionHandleId, assetCount }
   | { status: 'empty' }                       // resolved filters, zero assets
   | { status: 'handoff', reason }             // subjective or not deterministically resolvable
```

Deterministic source classes (cumulative; combine where present):

- **Recency** — "newest/latest/last N" → `searchAssets({ mode:'metadata', order:'desc', limit:N, detail:'handle' })` (already implemented in `add_photos_to_album`; extracted here).
- **Relative date** — "from 2024", "in May 2024", "last weekend", "yesterday", "this month" → `{ takenAfter, takenBefore }` filters.
- **Media type** — explicit type words only: "videos"/"clips"/"movies" → `{ type:'VIDEO' }`, "images" → `{ type:'IMAGE' }` (generic "photos"/"pics" stay no-type/all-media); combined with recency/date, never a bound on its own.
- **Subjective** ("best/good/nice/blurry/…") → `handoff`.
- **Anything else** (people/tags/albums/locations/cameras/semantic) → `handoff`.

**Clean-source gate (precision).** A source resolves only when it is composed
**entirely** of recognized recency / date / (type, once Slice 4 lands) tokens plus
filler/stopwords. If any substantive residual remains after consuming those (a
place like "Berlin", a name, a tag), the source has an unresolvable qualifier and
**hands off** — it does NOT resolve by the recognized part alone. This prevents
over-resolution: "archive my Berlin photos from last weekend" hands off (never
"archive ALL of last weekend"), and "newest 20 Berlin photos" hands off rather
than newest-20-globally. The gate errs toward handoff (a false handoff just defers
to the LLM; a false resolve would be a wrong, over-broad plan). Generic media
nouns ("photos/pics/pictures/snaps/shots") are filler; type-specific nouns
("videos/images/clips") are substantive until Slice 4 makes them a `type` filter.

It **never** calls `resolveAssetSearchFilters` with a free-text `query` and never
sends `query` to metadata-mode `searchAssets` (the bugs Slice 1 pins). The
date/type parsing and the clean-source gate are pure and unit-tested without a
live server.

### Workflow registry & manifest

Each workflow is a module under `agent-runner/src/strict-workflows/workflows/`
exporting `{ kind, flow, match, parseSlots, run, resumeContinuation? }`, registered
in the existing registry and added to `WORKFLOW_MANIFEST` (drives the LLM
classifier) and `manifest.generated.json` (drives the capability-matrix table via
`pnpm --dir server sync:agent-capabilities`).

### Intent & slot extraction

Two-tier, matching the foundation: a deterministic regex `match(prompt)` fast-path
per workflow, and manifest entries (canonical + paraphrase examples, slot schema)
for the LLM classifier. `parseSlots` is the gate — a correctly-classified prompt
whose slots don't survive `parseSlots` is a recall miss (the L1 harness asserts
slot survival). Routers must **decline** overlapping intents (e.g. `archive_assets`
must not match "add to album"; `create_album_from_source` must not steal "recent
trip").

### Plan tools per group

- **Group 1** → `proposeAssetBatchFromSelection({ action, selectionHandleId })`,
  where `action` is `asset.setArchive{archived}`, `asset.setFavorite{favorite}`,
  or `asset.addTag{tagName|tagId}` (discriminated union; no raw ids).
- **Group 2** → `proposeAlbumOperations({ summary, operations:[…] })` with
  `space.updateDetails` / `space.addMembers` / `space.removeMembers` /
  `space.updateMemberRole` ops (the proposer accepts the full operation union).
- **Group 3** → `proposeAlbumFromSelection` (album.create + album.addAssets from
  the handle), mirroring `create_recent_trip_album`.

### Gating, continuation, handoff, observability

Reused unchanged from the foundation: `gatePlanResult` (no success copy without a
persisted plan id), `needsInput`/`handoffOpen`/`failed` outcomes, durable
continuation for "which space/user did you mean?" follow-ups, and the
`strict_router_decision` / `strict_workflow_outcome` / `strict_success_gate_block`
activity events the L3 harness reads.

### Contract-faithfulness principle

Every workflow's unit fixture **enforces the real tool DTO constraints** (rejects
unknown keys, rejects `query` to the resolver / metadata search, requires exactly
one of `tagId`/`tagName`, etc.), so a call the live server would reject also throws
in the test. This is the direct lesson from the `add_photos` recency bug.

### L3 live verification (mandatory per workflow)

Unit tests prove the deterministic plumbing; only the live L3 harness proves the
workflow actually runs against the real Gallery server + runner + model. **A
workflow is not "done" until its L3 scenario(s) pass live** (`pnpm --dir
agent-runner eval:l3`, read-only, `approvalMode: plan-only`). The L3 driver reads
everything from the read-only endpoints — no log scraping:

- **Routing** — assert the `strict_router_decision` activity event's `workflow=`
  matches the expected kind (or `matched=false` for negatives).
- **Plan-proposed** — assert `GET …/operation-plan` returns a `proposed` plan with
  the expected operation type(s); for negatives/handoff, assert no strict plan.
- **Never applied** — the run-wide `auditNoApply` (no plan reached `applied` in any
  harness session) and `auditGateBlocks` (`strict_success_gate_block` count == 0)
  must both stay clean.

Each new workflow ships an L3 scenario in `eval/scenarios/l3-readonly.mjs`, and the
`baseline.l3.json` is re-`--accept`ed at the end of each phase. To make
plan-proposed assertions robust, source-based workflows use **recency** sources
(self-contained: "newest N"), and target-based workflows use **read-only
discovery** (the `{album}` token; an analogous `{space}` token for spaces).

**L3 environments (per-slice vs periodic — do NOT rc-personal per slice).** The
local dev stack's agent-runner runs `node --watch src/server.mjs` over the
bind-mounted working tree (`..:/usr/src/app`), so a workflow edit hot-reloads the
runner with **no image build**. Use two tiers:

- **Per-slice (inner loop) → local dev stack.** `make dev` + seed once (the
  `env-prep` skill: photos with metadata, tags, shared spaces _with members and
  multiple users_). Point the harness local:
  `GALLERY_URL=http://localhost:2283/api`, a local token, and
  `GALLERY_MODEL_URL=http://host.docker.internal:8080/v1` (the driver creates a
  credential so the local runner reaches the host model). Edit → save → `--watch`
  reloads → `pnpm eval:l3`. No rc, no build. This is where every slice's L3
  verification runs during development.
- **Periodic (confidence) → rc-personal.** At phase boundaries and before merge,
  rc-N → personal to validate against the **real** library ("lots of data"). This
  is the only place the 5–8 min build is justified.

Because the **local seeded** stack has a _known_ member set, the membership/role
workflows assert **plan-proposed there** (you control the seeded members), even
though they stay routing-only against personal (where the member set is
unknowable). So group 2 gets full R + P coverage via the local seeded stack.

Per-workflow L3 coverage (R = routing asserted, P = plan-proposed asserted live):

| Workflow                   | L3 coverage | Live plan probe                                                                          |
| -------------------------- | ----------- | ---------------------------------------------------------------------------------------- |
| `archive_assets`           | R + P       | "archive my newest 20 photos" → `asset.setArchive` (seeded or personal)                  |
| `favorite_assets`          | R + P       | "favorite my newest 10 photos" → `asset.setFavorite`                                     |
| `tag_assets`               | R + P       | `tag my newest 20 photos as "eval-l3"` → `asset.addTag`                                  |
| `rename_or_describe_space` | R + P       | "set the description on the {space} space to …" → `space.updateDetails`                  |
| `manage_space_members`     | R + P\*     | "add {user} to the {space} space as editor" → `space.addMembers` (\*local seeded only)   |
| `change_member_role`       | R + P\*     | "make {user} an editor in {space}" → `space.updateMemberRole` (\*local seeded only)      |
| `create_album_from_source` | R + P       | "make an album of my newest 20 photos called eval-l3" → `album.create`+`album.addAssets` |
| negatives (per group)      | R           | subjective/cross-intent → `matched=false` / no strict plan                               |

\* Membership/role plan-proposed asserts against the **local seeded** stack only
(known members + a seeded non-owner via `{user}`/`{space}` discovery, never
applied); the personal run asserts routing-only for these two.

The L3 driver gains read-only `{space}` and `{user}` discovery helpers (mirroring
`{album}`): pick a stable seeded space and a seeded non-owner user from the list
endpoints, never mutate. Confirm those endpoints' real shapes in the Group 2 L3
slice (same contract-first discipline as the tools).

## Test-Driven Development

Conventions for every slice: Node ESM, `node:test` + `node:assert/strict`,
`pnpm --dir agent-runner test` green at the end; server-side changes (manifest
regen) additionally pass `pnpm --dir server check` and `sync:agent-capabilities`.
Write the listed tests **first** (red), then implement (green). Tasks use
checkbox syntax for impl-loop tracking.

### Coverage by eval layer (L1 / L2 / L3)

Every workflow is verified at all three layers of the
[smoke/eval harness](./2026-05-29-pi-agent-smoke-eval-harness-design.md):

- **L1 — component** (classifier + copy vs the local model, no Gallery): intent
  recall, slot fidelity, precision negatives. Slices 11, 19, 23, and the
  cross-workflow disambiguation in Slice 24.
- **L2 — workflow** (`run()` driven against a **contract-faithful fixture MCP
  client**, no DB): exact tool-call sequence, plan-op shape, gating, and the
  `needs_input` / `handoff_open` / `failed` paths and safety guards. The resolver
  Slices 2–4 and **every execution slice** (6, 8, 10, 14, 16, 18, 22). These run
  via `node:test` rather than a separate L2 driver, but the fixtures enforce the
  real tool DTO shapes (the `add_photos` lesson), so they are L2 in substance.
- **L3 — live** (real Gallery `/agent/*`, read-only, `plan-only`): routing +
  plan-proposed + never-applied against a running stack. Slices 12, 20, 23, with
  the local-seeded inner loop and periodic rc-personal described above.

A workflow slice is not complete until its **L2** unit tests are green; a phase is
not complete until its **L1** battery is ≥ baseline and its **L3** scenarios pass
live. (L2 is covered by per-workflow unit tests here, not a dedicated
`l2-workflow.mjs` eval driver — building that driver is out of scope.)

### Phase 0 — Shared foundation & resolver

#### Slice 1: Contract regression & capability scaffolding

- [ ] Pin the **real** tool contracts the new workflows depend on, so a wrong-shape
      call fails in unit tests (not only live). Add a `contract-fixtures.mjs`
      test helper whose fake MCP client mirrors the server DTOs:
      `proposeAssetBatchFromSelection` (action union; `asset.addTag` requires
      exactly one of `tagName`/`tagId`), `proposeAlbumOperations` (accepts
      `space.updateDetails`/`space.addMembers`/`space.removeMembers`/
      `space.updateMemberRole`), `proposeAlbumFromSelection`, and `searchAssets`
      (metadata mode rejects `query`; `detail:'handle'` returns `selectionHandle`).
- **Tests:** the fake client throws on `resolveAssetSearchFilters({ query })`, on
  metadata `searchAssets({ query })`, on `asset.addTag` with both/neither
  tag field, and on an unknown operation `type`; accepts the valid shapes.
- **Acceptance:** helper is importable by later slices; `add_photos_to_album` test
  migrated onto it and still green (proves the helper matches reality).

#### Slice 2: Extract the shared source-resolver

- [ ] Move the recency source resolution out of `add_photos_to_album` into
      `asset-source-resolver.mjs` (`resolveAssetSource`), returning the
      `resolved | empty | handoff` shape. Refactor `add_photos_to_album` to call
      it. **No behavior change.**
- **Tests:** resolver unit tests (recency "newest 20" → metadata search
  `order:desc limit:20`, no `query`; "the good ones" → handoff; "Berlin photos
  from last weekend" → handoff for now); `add_photos_to_album` suite unchanged and
  green against the contract fixtures.
- **Acceptance:** zero diff in `add_photos_to_album` observable behavior; resolver
  has its own test file.

#### Slice 3: Resolver — relative date ranges

- [ ] Add deterministic relative-date parsing to the resolver: explicit years
      ("from 2024", "in 2024"), month+year ("in May 2024"), and bounded relatives
      ("yesterday", "last weekend", "last week", "this month", "last month") →
      `{ takenAfter, takenBefore }`. Ambiguous/unparseable date phrases → handoff
      (never guess a range). Date math is pure (inject a `now`).
- **Tests:** each phrase → exact UTC `takenAfter/takenBefore`; "from 2024" → full
  year; "last weekend" relative to an injected `now`; "sometime recently" →
  handoff; combined "newest 20 photos from 2024" → recency limit + date filters.
- **Acceptance:** resolver returns a metadata search with date filters; no live
  server needed for the parsing tests.

#### Slice 4: Resolver — media type

- [ ] Add media-type parsing combined with recency/date. **Explicit type words
      only:** `videos`/`video`/`clips`/`clip`/`movies`/`movie` → `VIDEO`;
      `images`/`image` → `IMAGE`. The generic colloquial library words
      (`photos`/`pics`/`pictures`/`snaps`/`shots`) stay **generic = no type filter**
      (a person says "my photos" to mean their whole library, incl. videos) — this
      is the Slice 3 decision (those are `GENERIC_NOUNS` filler) and **must not
      regress**: recency-only `"my newest 20 photos"` keeps sending **no `filters`
      key**. Type words become consumable by the clean-source gate; type alone is
      **not** a bound (still needs recency/date), so `"my videos"` → handoff
      (unbounded). Non-type qualifiers (`screenshots`, places, names) stay handoff.
      Enum values are uppercase `AssetType` (`'IMAGE'`/`'VIDEO'`), matching
      `filters.type` in the metadata `searchAssets` DTO (a `strictObject`).
- **Tests:** `"my videos from last weekend"` → `filters:{ type:'VIDEO', takenAfter, takenBefore }`;
  `"newest 20 images"` → `{ order:'desc', limit:20, filters:{ type:'IMAGE' } }`;
  `"newest 20 photos"` → `{ order:'desc', limit:20 }` (**no `filters` key** —
  photos generic, unchanged from Slice 3); `"my videos from 2024"` → recency-less,
  `filters:{ type:'VIDEO', takenAfter:'2024-…', takenBefore:'2024-…' }`; `"my videos"`
  (type only, no count/date) → handoff (unbounded); `"screenshots"` → handoff (not a
  metadata type). The contract fixture rejects an unknown `filters` key and a
  `filters.type` outside the `AssetType` enum (strictObject + enum fidelity).
- **Acceptance:** resolver covers recency × date × type combinations
  deterministically; everything else handoff. Because `add_photos_to_album` now
  shares this resolver, it **also** gains type sources for free — add an L2 case
  ("add my videos from 2024 to X" → `album.addAssets` over a `type:'VIDEO'` +
  2024-date handle) and confirm no regression to its recency-only behavior (still
  no `filters` key). Date sources were already covered in Slice 3.

### Phase 1 — Batch asset actions

#### Slice 5: `archive_assets` router & slots

- [ ] New workflow module: `match`/`parseSlots` only (no execution). Match
      "archive <source>" / "unarchive <source>" / "move <source> out of archive";
      slot `{ archived: boolean, sourceDescription }`. Decline subjective-only and
      add-to-album/trip overlaps via the fast-path guard. Manifest entry with
      paraphrases.
- **Tests:** archive vs unarchive polarity; source captured; "archive the best
  ones" declines fast-path (→ classifier/handoff); "add … to album" does not
  match; `parseSlots` rejects empty source.
- **Acceptance:** routing only; no tool calls.

#### Slice 6: `archive_assets` execution

- [ ] `run`: resolver → `proposeAssetBatchFromSelection({ action: asset.setArchive{archived}, selectionHandleId })`
      → `gatePlanResult` → copy. `empty` → needs_input; `handoff` → handoffOpen;
      tool error → failed.
- **Tests (contract fixtures):** recency source → `planned` with one
  `asset.setArchive` op, correct `archived`, handle id, no raw ids; subjective →
  handoff (no propose); zero-asset → needs_input (no propose); planless propose →
  failed (gate) with no success copy.
- **Acceptance:** end-to-end strict plan for a recency/date/type archive source.

#### Slice 7: `favorite_assets` router & slots

- [ ] Match "favorite/like <source>", "unfavorite/remove favorite <source>"; slot
      `{ favorite: boolean, sourceDescription }`. Subjective "best" declines
      fast-path (handoff). Manifest entry.
- **Tests:** favorite vs unfavorite polarity; "favorite the best 3" declines
  fast-path; `parseSlots` rejects empty source.
- **Acceptance:** routing only.

#### Slice 8: `favorite_assets` execution

- [ ] `run`: resolver → `proposeAssetBatchFromSelection(asset.setFavorite{favorite})`
      → gate → copy; empty/handoff/failed paths.
- **Tests:** recency favorite → planned with `asset.setFavorite{favorite:true}`;
  "unfavorite my newest 5" → `{favorite:false}`; subjective → handoff; zero → needs_input.
- **Acceptance:** end-to-end strict favorite plan for a bounded source.

#### Slice 9: `tag_assets` router & slots

- [ ] Match `tag <source> as <tag>` / `add the tag <tag> to <source>` (add-only);
      slots `{ sourceDescription, tagName }`. Extract quoted tag names
      (`as "Spring Break"`). Decline tag-removal phrasings (→ handoff/out of scope).
      Manifest entry.
- **Tests:** `tag my newest 20 as Travel` → tagName "Travel"; quoted multi-word
  tag; "remove the Travel tag from …" does not match; `parseSlots` rejects empty
  tag or source.
- **Acceptance:** routing only.

#### Slice 10: `tag_assets` execution

- [ ] `run`: resolver → `proposeAssetBatchFromSelection(asset.addTag{tagName})` →
      gate → copy; empty/handoff/failed paths.
- **Tests:** recency tag → planned with `asset.addTag{tagName}` (exactly one tag
  field); subjective source → handoff; zero → needs_input.
- **Acceptance:** end-to-end strict tag-add plan.

#### Slice 11: Group 1 manifest, capability regen & L1 scenarios

- [ ] Register all three in the manifest + `manifest.generated.json`; run
      `pnpm --dir server sync:agent-capabilities` so the capability-matrix table
      lists them. Add L1 eval scenarios (`agent-runner/eval/scenarios/`): recall
      (canonical + paraphrase + uncommon-verb per action), slot fidelity (polarity,
      tag name, recency count), negatives (subjective → handoff/none; tag-removal →
      none).
- **Tests:** `pnpm --dir agent-runner test` green; capability-matrix generated
  block updated; L1 battery passes against the local model (recall + slots + negatives).
- **Acceptance:** the three workflows show in the matrix; L1 scores ≥ baseline.

#### Slice 12: Group 1 L3 read-only scenarios

- [ ] Add L3 scenarios (`eval/scenarios/l3-readonly.mjs`): routing (each action
      `kind`), plan-proposed for a recency source (`{ planProposed: true }`, never
      applied), and a subjective negative (→ handoff, no strict plan). Reuse the
      read-only driver (`{album}`-style discovery not needed; recency sources are
      self-contained).
- **Tests:** L3 battery green against a live stack; read-only + gate audits clean.
- **Acceptance:** each batch action proposes a real (never-applied) plan live.

### Phase 2 — Space details & membership

#### Slice 13: `rename_or_describe_space` router & slots

- [ ] Mirror `rename_or_describe_album` for spaces: match "rename the <space> space
      to <name>", "set the description on the <space> space to <text>", both;
      slots `{ spaceRef, newName?, description? }` (≥1 of name/description).
      Manifest entry.
- **Tests:** rename-only; describe-only; both; "this space" deixis; `parseSlots`
  rejects when neither name nor description present; must not match album phrasings.
- **Acceptance:** routing only.

#### Slice 14: `rename_or_describe_space` execution

- [ ] `run`: `listSpaces` → resolve by name (none → needs_input "which space";
      multiple → needs_input) → `proposeAlbumOperations([space.updateDetails])`
      preserving unspecified fields → gate → copy.
- **Tests (contract fixtures):** rename preserves description; describe preserves
  name; ambiguous space → needs_input (no propose); unknown space → needs_input;
  planless → failed (gate).
- **Acceptance:** end-to-end space-detail update plan.

#### Slice 15: `manage_space_members` router & slots

- [ ] Match "add <users> to <space> [as <role>]", "remove <users> from <space>";
      slots `{ action: add|remove, memberQueries:[…], spaceRef, role? }` (role
      default `viewer` on add). Manifest entry.
- **Tests:** add with/without role; remove; multiple members; `parseSlots` rejects
  empty member list or space; role normalization (editor/viewer/owner synonyms).
- **Acceptance:** routing only.

#### Slice 16: `manage_space_members` execution

- [ ] `run`: `listSpaces` resolve → `readSpace` (current members + roles, for the
      guards) → `searchUsers` resolve each member (ambiguous → needs_input; not
      found → needs_input) → `proposeAlbumOperations` (`space.addMembers` /
      `space.removeMembers`) → gate → copy. Guard rails from the readSpace member
      set: already-member (answer/needs_input, don't re-add), remove non-member,
      **remove-self rejected**, **last-owner removal blocked** (surface as
      failed/needs_input, never plan).
- **Tests:** unique add with role; ambiguous user → needs_input; already-member;
  remove non-member; self-removal rejected; last-owner removal blocked; no raw ids.
- **Acceptance:** end-to-end membership plan with the safety guards enforced
  deterministically.

#### Slice 17: `change_member_role` router & slots

- [ ] Match "make <user> an editor/viewer/owner in <space>", "change <user>'s role
      to <role> in <space>"; slots `{ memberQuery, role, spaceRef }`. Manifest entry.
- **Tests:** each role; possessive phrasing; `parseSlots` rejects missing role/user/space.
- **Acceptance:** routing only.

#### Slice 18: `change_member_role` execution

- [ ] `run`: `listSpaces` resolve space → `readSpace` (current members + roles) →
      `searchUsers` resolve the target member → `proposeAlbumOperations`
      (`[space.updateMemberRole]`) → gate → copy. Guards from the readSpace member
      set: **no-op role** (current == requested → answer, no plan),
      **self-demotion rejected**, **last-owner demotion blocked**, target not a
      member → needs_input.
- **Tests:** viewer→editor; editor→viewer; no-op role change; self-demotion
  rejected; last-owner demotion blocked; ambiguous user → needs_input.
- **Acceptance:** end-to-end role-change plan with guards.

#### Slice 19: Group 2 manifest, capability regen & L1 scenarios

- [ ] Register the three space workflows; regen manifest + capability matrix; add
      L1 recall/slot/negative scenarios (rename vs describe; add vs remove; role
      synonyms; album-vs-space disambiguation negatives).
- **Acceptance:** matrix lists them; L1 green.

#### Slice 20: Group 2 L3 read-only scenarios

- [ ] Add read-only `{space}` and `{user}` discovery helpers to the L3 driver
      (pick a stable seeded space + a seeded non-owner user from the list
      endpoints; confirm the real endpoint shapes first — contract discipline).
      L3 routing scenarios for all three workflows. Plan-proposed assertions:
      `rename_or_describe_space` against `{space}` (works on any instance);
      `manage_space_members` ("add {user} to {space} as editor") and
      `change_member_role` ("make {user} an editor in {space}") assert
      plan-proposed **against the local seeded stack only** (known members) and
      routing-only against personal — gate the plan assertion on a config/env flag.
      Preconditions the discovery must satisfy for a plan (else it correctly
      returns needs_input/no-op, not a plan): the add probe needs a `{user}` who is
      **not** already in `{space}`; the role probe needs a `{user}` who **is** a
      member with a **different** role than requested. `env-prep` must seed a space
      with at least one such non-member and one changeable-role member. Never
      applied.
- **Acceptance:** all three route correctly live; describe-space proposes a plan
  on any instance; membership/role propose a plan on the seeded local stack;
  no-apply + gate-block audits clean.

### Phase 3 — General album-from-source

#### Slice 21: `create_album_from_source` router & slots

- [ ] Match "make/create an album of/from <source> [called <name>]"; slots
      `{ sourceDescription, albumName? }`. **Decline** "recent trip" (owned by
      `create_recent_trip_album`) and "add … to <existing album>" (owned by
      `add_photos_to_album`). Default album name when omitted. Manifest entry +
      router-precedence note.
- **Tests:** "make an album of my newest 50 photos" matches; "...called Recent"
  captures name; "album for my recent trip" declines (→ trip workflow); "add my
  newest 20 to Family" declines (→ add workflow); `parseSlots` rejects empty source.
- **Acceptance:** routing only, with correct precedence vs trip/add.

#### Slice 22: `create_album_from_source` execution

- [ ] `run`: resolver → `proposeAlbumFromSelection` (album.create + album.addAssets
      from the handle, default/explicit name) → gate → copy. Non-resolvable source
      → handoff; zero → needs_input.
- **Tests:** recency source → planned with create+add ops, no raw ids; explicit
  name honored; subjective/location source → handoff; zero → needs_input; planless
  → failed.
- **Acceptance:** end-to-end generic album-from-recency plan.

#### Slice 23: Group 3 manifest, capability regen & eval

- [ ] Register; regen manifest + matrix; add L1 (recall/slots incl. trip/add
      disambiguation negatives) and L3 (routing + plan-proposed for a recency
      source) scenarios.
- **Acceptance:** matrix lists it; L1 + L3 green; trip/add still route to their own
  workflows (no regression).

### Phase 4 — Cross-cutting hardening

#### Slice 24: Router precedence & disambiguation sweep

- [ ] A dedicated cross-workflow disambiguation suite: every new + existing
      workflow's canonical and paraphrase prompts route to exactly one kind; no
      prompt cross-matches (e.g. "archive" vs "favorite" vs "tag" vs "add" vs
      "create album" vs "rename space"). Tighten fast-path guards where collisions
      surface. Add the colliding prompts as L1 negatives for the _other_ workflows.
- **Tests:** a table-driven test asserting `classify(prompt).kind` for ~40
  cross-cutting prompts; LLM-mode classifier recall stays ≥ threshold for each.
- **Acceptance:** no cross-matching across the full workflow set, regex and LLM modes.

#### Slice 25: End-to-end regression, edge sweep & acceptance

- [ ] Full edge-case sweep (below) wired as tests; regen the generated MCP
      cheat-sheet/docs; re-seed L1 + L3 baselines; confirm both eval audits
      (no-apply, no gate-block) clean across the expanded battery. Update the
      capability matrix "Implemented strict/hybrid workflows" table and Next Steps.
- **Acceptance:** all Acceptance Criteria below met; baselines committed; matrix current.

## Edge Case Coverage

Asserted across the slices above (full list, by theme):

**Source resolution (Groups 1 & 3)**

- Recency with/without count ("newest 20" vs "newest photos" → handoff on no count).
- Recency count clamp (> max → clamped); absurd count (> 4 digits) → handoff.
- Relative dates: explicit year, month+year, yesterday, last weekend/week, this/last
  month; unparseable date phrase → handoff (never guess).
- Media type image/video; "screenshots"/non-type → handoff.
- Combined recency × date × type.
- Subjective ("best/good/blurry") → handoff, never a fabricated search.
- Location/people/tag/album/camera/semantic source → handoff.
- Zero-asset resolved source → needs_input (never an empty plan).
- Never sends `query` to `resolveAssetSearchFilters` or metadata `searchAssets`.

**Batch actions (Group 1)**

- archive/unarchive and favorite/unfavorite polarity correct in the op payload.
- `tag_assets` add-only; exactly one of `tagName`/`tagId`; quoted multi-word tags;
  tag-removal phrasing → no match.
- One op per plan; selection handle only (no raw ids); gate blocks success copy
  when planless.

**Space details & membership (Group 2)**

- Rename-only preserves description; describe-only preserves name; both.
- Unknown space → needs_input; ambiguous space name → needs_input.
- Member add default role viewer; explicit role honored; role synonyms normalized.
- Ambiguous user → needs_input; user not found → needs_input; already-a-member add;
  remove a non-member.
- **Self-removal rejected; last-owner removal blocked; self-demotion rejected;
  last-owner demotion blocked; no-op role change** → never produce a plan.
- Album-vs-space disambiguation (rename album ≠ rename space).

**Album-from-source (Group 3)**

- Declines "recent trip" (→ trip) and "add to existing album" (→ add).
- Default vs explicit album name; create + add ops from one handle; no raw ids.

**Cross-cutting / foundation invariants**

- Continuation: "which space/user did you mean?" follow-up resumes and plans;
  expired/missing continuation asks to rerun.
- Gate: no `planned`/"I created" without a persisted plan id;
  `strict_success_gate_block` count == 0 across the battery.
- Observability: `strict_router_decision` + `strict_workflow_outcome` emitted per
  turn (L3 reads them).
- No raw asset-id lists or secrets in model-facing args or copy.

## Acceptance Criteria

- All seven workflows implemented test-first, registered, and shown in the
  capability matrix generated table.
- `pnpm --dir agent-runner test` green (new resolver, seven workflows, contract
  fixtures, disambiguation suite); `pnpm --dir server check` + `sync:agent-capabilities`
  clean.
- L1 eval: recall/slot/negative scenarios for all seven pass against the local
  model at or above the committed baseline; cross-workflow disambiguation has no
  collisions in regex and LLM modes.
- L3 eval (live, read-only): per-slice verification runs against the **local
  seeded dev stack** (`node --watch` hot-reload, no build); rc-personal is reserved
  for periodic real-data confidence at phase boundaries / pre-merge. Each workflow
  routes correctly; `archive_assets`, `favorite_assets`, `tag_assets`,
  `create_album_from_source`, and `rename_or_describe_space` propose a real,
  never-applied plan on any instance; `manage_space_members` and
  `change_member_role` propose a never-applied plan against the **local seeded**
  stack (known members) and are routing-only against personal; both audits
  (no-apply, no gate-block) clean. Re-seed `baseline.l3.json` per phase.
- No new MCP tools or operation types; no apply-path changes; no fixture that
  ignores call args (every fixture validates against the real tool DTOs).
- Adding the next workflow is a manifest entry + a workflow module + scenarios —
  no foundation changes.
