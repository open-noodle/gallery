# Family Relationships — Design & Implementation Slices

> **For agentic workers:** This spec is written for `/impl-loop`. It is organised into numbered slices (`## Slice 1` … `## Slice 15`); each slice is independently plannable, testable and committable. `/impl-loop` will produce one plan per slice under `docs/superpowers/plans/2026-08-31-family-relationships-slice-<n>.md` and execute it with `superpowers:subagent-driven-development`. Steps use checkbox (`- [ ]`) syntax for tracking. Slices may be started at any point; the only ordering constraints are recorded under "Ordering constraints between slices".
>
> **Sections `D1`–`D8` are the design.** Read them before planning any slice. Every slice references the edge cases it must cover by their `E<n>` identifiers from the **Edge case register**; that register is the acceptance surface for "full coverage", and a slice is not done until every `E<n>` it claims has a named test.

**Goal:** Let people record how the people in their photos are related, and surface those relationships where they are useful — on the person page and on the asset viewer's people strip — so a space member looking at a photo of half-familiar faces can see how each one relates to them.

**Non-goals, deliberately:**

- **No family-tree object.** There is no document to own, name, share, copy, merge or delete. See `D8` for why this is also the more extensible choice.
- **No people without photos.** The feature cannot mint identities; `face_identity` keeps its current meaning as a recognition artifact. Relationships _through_ an unphotographed person still work via partner-less unions (`D1.3`).
- **No genealogy import/export** (GEDCOM and friends).
- **No memories integration.** The graph is built so memories can consume it later; wiring that up is not in this release.
- **No real-time updates.** The web app has socket.io live events; family relationships do not emit them. A co-contributor's edit appears on reload. Stated explicitly so nobody assumes otherwise from the collaborative framing.

**Architecture:** Relationships are stored as **unions** — a marriage or partnership as a first-class row — with partners and children attached by `identityId`. Nothing relative to a speaker is ever stored: "aunt", "cousin" and "half-brother" are computed at read time from wherever the viewer is standing. Access is a two-layer gate that is entirely independent of shared spaces: an admin enables the feature and grants users `view` or `contribute`; what a granted user actually _sees_ then falls out of the person visibility the fork already computes, so redaction is automatic rather than configured.

**Tech Stack:** NestJS 11 + Kysely (server), SvelteKit + Svelte 5 runes (web), Flutter + Riverpod (mobile), Vitest (unit + medium), Playwright (e2e), Zod DTOs, PostgreSQL 14.

---

# Design

## D1 — The data model

### D1.1 Four new tables, all fork-owned

```
family_union
  id             uuid  pk
  status         varchar not null default 'partnered'
  startDate      date null
  endDate        date null
  partnerKey     text null            -- see D1.5; NULL unless exactly 2 partners
  createdById    uuid null  -> user(id)         ON DELETE SET NULL
  createdAt / updatedAt

family_union_partner
  unionId        uuid  -> family_union(id)      ON DELETE CASCADE
  identityId     uuid  -> face_identity(id)     ON DELETE CASCADE
  PRIMARY KEY (unionId, identityId)

family_union_child
  unionId        uuid  -> family_union(id)      ON DELETE CASCADE
  identityId     uuid  -> face_identity(id)     ON DELETE CASCADE
  PRIMARY KEY (unionId, identityId)

family_access
  userId         uuid  pk -> user(id)           ON DELETE CASCADE
  level          varchar not null               -- 'none' | 'view' | 'contribute'
  grantedById    uuid null -> user(id)          ON DELETE SET NULL
  grantedAt      timestamptz
```

`status` ∈ `married` · `partnered` · `separated` · `divorced` · `widowed`.

Plus one column on the existing fork-owned identity table:

```
face_identity.gender   varchar null   -- 'male' | 'female' | NULL
```

**`createdById` is `ON DELETE SET NULL`, never `CASCADE`.** Deleting a user must not delete the family history they recorded (`E23`). This is the single most damaging thing to get wrong in the migration.

**`family_union` carries `updateId`, and must.** An earlier draft of this spec forbade it, reasoning that `@UpdateIdColumn` is the mobile sync mechanism and relations are deliberately not synced (`D5`). That reasoning was wrong on the mechanics: the shared `updated_at()` trigger function unconditionally executes `new."updateId" = immich_uuid_v7(clock_timestamp)` (`server/src/schema/functions.ts:46-47`), so **any** table with `@UpdatedAtTrigger` must have the column or every `UPDATE` fails at runtime — including the `SET NULL` cascade when a creating user is deleted, which is `E23`.

Having the column implies nothing about sync: a Drift sync stream exists only when one is registered in `sync.repository.ts`, and none is. The alternative — dropping the trigger to avoid the column — would leave `updatedAt` frozen at insert time, which is worse than a spare change token.

**Why `family_access` is a table and not a column on `user`.** `server/src/schema/tables/user.table.ts` is pure upstream — it carries no fork columns today. Adding one would conflict on every rebase for the life of the fork. A fork-owned table is rebase-safe and gives us `grantedById` for an audit trail at no extra cost.

### D1.2 There is no grouping key

`family_union` has **no `treeId`, no `familyId`, and no owner**. This is load-bearing, not an omission — see `D8`.

### D1.3 A union may have 0, 1 or 2 partners

This is what makes the "no people without photos" restriction survivable, and it is the same mechanism that powers redaction:

| Partners | Meaning                                                                   |
| -------- | ------------------------------------------------------------------------- |
| 2        | The ordinary case — a marriage or partnership                             |
| 1        | One parent known, the other never photographed, or unknown                |
| 0        | Neither parent known; the union exists purely to say "these are siblings" |

A partner seat that is empty — or occupied by someone the viewer cannot resolve — renders as an **anonymous seat**. One renderer serves three features: divorce/remarriage, unphotographed people, and redaction.

### D1.4 Children attach to the union, not to parents

This is what makes half-siblings and step-parents fall out for free. Given `union(Johan, Marie) → {Pierre, Elise}` and `union(Johan, Petra) → {Max}`, Max is derivably Pierre's **half-brother** and Petra his **stepmother**, with nobody having recorded either word.

### D1.5 Duplicate prevention

When a union has exactly two partners, the service writes

```
partnerKey = "<sorted idA>:<sorted idB>:<startDate ?? ''>"
```

A **partial unique index** on `partnerKey WHERE partnerKey IS NOT NULL` makes "you add Johan + Marie, your sister adds Johan + Marie" resolve to one row instead of two, including under concurrency.

**`startDate` is part of the key so the same couple can marry twice** (`E60`). Married 1998, divorced 2007, remarried 2011 is an ordinary case — and `D7` records remarriage as one of the reasons union objects were chosen, so a key that forbade it would contradict the design. Two unions for the same pair with the same start date (or both dates unknown) still collapse, which is the duplicate we actually want to prevent.

`partnerKey` is `NULL` for 0- and 1-partner unions, so those are never deduplicated — two separate partnerships with unknown partners are legitimately distinct (`E5`). The service must recompute `partnerKey` on every partner-membership change **and on every `startDate` change**; a stale key is a correctness bug, and `E4`/`E5`/`E17`/`E60` exist to catch it.

> The partial-index migration must be checked against `schema-drift.spec.ts`. If the index predicate does not round-trip through `pg_get_expr`, add a `migration_overrides` row following the exact pattern in `server/src/schema/migrations-gallery/1783050000000-AddFaceRepairScanInFlightIndex.ts`.

### D1.6 Identity merge — the highest-risk integration

`server/src/services/identity-merge-propagation.service.ts` already exists and owns merging identities across personal and space profiles. **Any table keyed on `identityId` must participate in that merge**, and family relationships are not exempt. Getting this wrong does not merely make the family tree wrong — it breaks face merging, which is an existing shipped feature.

Three distinct failures, each with its own edge case:

1. **Silent data loss** (`E56`). `family_union_partner.identityId` and `family_union_child.identityId` are `ON DELETE CASCADE`. When a merge deletes the source identity, memberships are **deleted, not re-pointed**, and the relationship vanishes with no error. The merge must re-point memberships to the surviving identity **before** the source row is deleted, inside the same transaction.
2. **The merge transaction aborts** (`E57`). Merging B into A when `union(A, C)` and `union(B, C)` both exist produces two rows with identical `partnerKey` → unique-index violation → the whole merge rolls back. The merge must detect the collision and fold the two unions into one (union their children, keep the earliest `startDate`, keep the non-null `status`) rather than letting Postgres refuse.
3. **The merge forges an invalid graph** (`E58`). A merge can produce a self-union (`union(A, B)` where B merges into A) or close a parent cycle (A parent of B, C parent of A, B merges into C). The write path rejects both (`E7`, `E9`); the merge path bypasses that validation entirely because it never goes through it. Self-unions must be deleted; cycles must be broken by dropping the offending child edge, and the merge must not fail because of it — a merge is a user correcting recognition, not asserting a family fact.

The rule for all three: **a merge must never fail because of family data, and must never silently lose it.**

## D2 — Access control

Two independent layers. Neither involves shared spaces.

**Layer 1 — instance (admin).** New config block in `server/src/config.ts`:

```ts
familyTree: {
  enabled: boolean; // default false
  defaultAccess: "none" | "view" | "contribute"; // default 'none'
}
```

**Layer 2 — per user.** A row in `family_access` overrides the instance default. No row means "inherit `defaultAccess`". A row with `level: 'none'` is a real, meaningful override — it denies a user on an instance whose default is permissive (`E19`).

**Effective access** resolves as:

```
enabled === false                     ->  'none'   (always, overrides any grant)
family_access row exists              ->  row.level
otherwise                             ->  config.familyTree.defaultAccess
```

**Admins get no implicit bypass** (`E21`). An admin who wants to read the graph grants themselves `view` like anyone else, and that grant is visible in the same list everyone else's is. This is deliberate: silent admin visibility into family structure is precisely the kind of thing this design exists to avoid, and an admin can always grant themselves in one click.

**Write authority is the grant, not a space role** (`E24`, `E25`). A space editor gains no ability to record relationships from their space role. Conversely, a `contribute` user may edit or delete a union somebody else created — decided deliberately so a wrong relationship your cousin entered is not stuck until they fix it. `createdById` is retained for provenance so the UI can show "added by Anna".

This layer is why an ordinary user setting up a family server sets `defaultAccess: 'contribute'` once and never touches per-user settings again.

## D3 — Visibility: what a granted user actually sees

Access grants **capability**. Content is scoped separately, and automatically:

> **A union is visible to you if you can resolve at least two of its participants** (partners and children counted together).

"Resolve" means exactly what the fork already computes for thumbnails and the people list: you have an accessible profile for that identity — your own `person` row, or a `shared_space_person` in a space you belong to. **Reuse that resolution; do not re-derive it.**

**Why two and not one.** With one resolvable participant the union tells the viewer nothing useful ("Elise is in a union with three people you can't see") while leaking a headcount. Below the threshold the union is omitted entirely (`E27`, `E28`).

Participants inside a visible union that the viewer cannot resolve are returned as **anonymous seats**.

> **`E30` is a security requirement, not a nicety.** An anonymous seat must carry an opaque per-union slot index, never the real `identityId`. Leaking the id lets a client correlate the same hidden person across unions — and across users — reconstructing exactly the structure redaction is meant to withhold.

**Hidden people are unresolvable** (`E33`). If `person.isHidden` or `shared_space_person.isHidden`, the identity does not resolve for family-tree purposes.

**Pets are excluded entirely** (`E12`). `face_identity.type` must be `'person'`; a pet identity may not be a union participant, rejected at write time.

On a single-family instance everybody shares spaces, so everybody resolves everybody and this behaves indistinguishably from "granted users see everything". It only diverges on an instance with strangers on it — which is where it should.

## D4 — Derived relationship labels

Nothing relative to a speaker is stored. Labels are computed from the viewer's **root** — the identity they nominated as themselves, held in user preferences as a single identity id (not per-anything, since you are the same person everywhere).

> **Labels are derived from the viewer-projected subgraph only, never from the full graph** (`E59`). This is a security requirement of the same class as `E30`, and it is easy to get backwards: deriving on the full graph and then filtering the _output_ still leaks, because the label itself is the disclosure. "Your niece" derived through a union the viewer may not see tells them a relationship `D3` deliberately withheld.
>
> Mechanically: slice 5 produces the projection, slice 6 consumes it. `deriveRelationLabel` must never be handed a union the viewer cannot see, and its signature should make that hard to get wrong — take the already-projected graph, never a repository.
>
> The consequence is intended: a viewer who cannot see the connecting union gets no label, and rule 4 below takes over. A partly-visible family reads as partly-known rather than fully-known.

Rules, in order:

1. **No root set** → no relative labels at all; plain names (`E35`).
2. **Target is the root** → "that's you" (`E46`).
3. **Path exists from root to target** → the relative term.
4. **No path** → describe relative to the nearest person the viewer _does_ have a path to: "Pierre's sister" (`E36`). This is what stops the feature feeling broken for someone marginal to the graph.
5. **Beyond the supported degree** → "relative" (`E45`). Cap the walk; do not attempt "third cousin twice removed".

**Gender only affects wording** (`E37`, `E38`). Unset → the neutral term (`parent`, `sibling`, `partner`, `child`, `parent-in-law`). Set → the gendered one. Gender is **never inferred** from a name, a photo, or anything else.

**Ambiguity is resolved deterministically** (`E44`). Where two paths exist — someone who is both your cousin and your sister-in-law — take the shortest path; on a tie, order by a fixed relationship precedence, then by identity id. It must not vary between requests.

**Ex-partners are labelled from union status** (`E42`): `divorced`/`separated` yield "ex-husband"/"former partner" rather than "husband".

## D5 — Surfaces

**Mockups: `specs/mockups/2026-08-31-family-relationships.html`.** Every surface below is drawn there in Gallery's own tokens, with the section numbers referenced per slice. Open it before planning any UI slice — three of its decisions are load-bearing and are recorded in `D5.1`.

| Surface                           | Role                                            | Slice | Mockup |
| --------------------------------- | ----------------------------------------------- | ----- | ------ |
| Person page — relations panel     | **The payoff.** Relations with derived labels   | 8     | §4     |
| Asset viewer — people strip       | **The payoff.** "your niece" under each face    | 9     | §5     |
| `/family` canvas                  | Authoring: drag-and-drop, pan/zoom              | 10–11 | §1–3   |
| Admin settings                    | Feature toggle, default access, per-user grants | 12    | §7     |
| Mobile person page + people strip | Read-only mirror of 8 and 9                     | 13–14 | §8     |
| Redaction and fallback states     | Cross-cutting; easy to forget                   | 5, 6  | §6, §9 |

### D5.1 Three UI decisions that follow from the model

1. **`/family` opens on a cluster, not a tree.** Chips across the top name the disconnected components — "Marais · 12 people", "Van Dijk · 8 people" — defaulting to the one containing the viewer's root. This is how "multiple family trees" surfaces without a tree object, and it is computed per request (`D8.3`).
2. **There are two kinds of blank and they must not look alike.** An _empty_ seat (nobody recorded) is a dashed `+ Add a parent` affordance. An _occupied but unresolvable_ seat is a solid grey "Someone" card. Conflating them makes redaction look like missing data; distinguishing them discloses that a hidden person exists, which is the structural leak already accepted as a fair trade (`D3`).
3. **The union bar is a control, not a connector.** Status and dates can only be set there, so it renders as a hoverable pill showing "m. 1988 · div. 2007" rather than a plain line.

**A user whose effective access is `none` sees no surface at all** — no relations panel, no strip labels, no `/family` entry point, and specifically _not_ a locked or empty version of any of them. An empty state would advertise a feature they cannot use and imply relationships exist.

### D5.2 How the mockup is enforced

A referenced mockup is advisory: an agent reads "see §4", builds something in the neighbourhood, and nothing fails. These are the mechanisms that make the parts that matter non-optional.

**Screenshot regression is not one of them, and must not be proposed.** `e2e/src/specs/web/reskin-visual.e2e-spec.ts` already implements exactly that, and every visual case is `test.fixme` — Mac-produced baselines differ from CI font rendering and the baselines were never generated or committed. The a11y half of that same file _is_ live and is used below. Do not revive the screenshot half for this feature.

**Fidelity comes from reuse, not from description.** In descending order of strength:

**1 — Component reuse is mandatory.** If the implementer reuses the component, the surface looks right by construction and no assertion is needed. Writing new markup that resembles the mockup is the failure mode.

| Surface                       | Must reuse                                                                         | Must not                                        |
| ----------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------- |
| Detail-panel relation line    | The existing tile in `DetailPanelPeople.svelte`, in the slot the age line occupies | A new person-tile component; a horizontal strip |
| Detail-panel person thumbnail | `ImageThumbnail` with `curve` + `shadow` (rounded-xl, shadow-lg)                   | Circles; a bare `<img>`                         |
| Person page relations         | A section beneath the existing header; `ImageThumbnail` `circle` + `shadow`        | A second header; a new avatar primitive         |
| Sidebar entry                 | `SidebarNavItem`, placed after People                                              | A bespoke link                                  |
| Canvas node avatars           | `ImageThumbnail` `circle`                                                          | Raw `<img>` with hand-written radius            |

**2 — The `data-testid` contract.** The repo already leans on testids (140 spec files use `getByTestId`). These names are fixed by this spec so tests pin structure rather than appearance:

`family-page` · `family-cluster-chip` · `family-canvas` · `family-node` · `family-union-bar` · `family-anonymous-seat` · `family-empty-seat` · `family-relations-panel` · `family-relation-row` · `family-add-relationship` · `detail-panel-person-relation` · `family-admin-access-row`

**3 — The live a11y gate.** Add `/family` to the **active** `a11y ·` cases in `reskin-visual.e2e-spec.ts` (not the `fixme` visual ones). The WCAG-AA contrast scan is the cheapest real catch for someone inventing a colour outside the token set.

**4 — No raw colour literals.** New components use theme tokens and Tailwind classes only. A grep for `#[0-9a-fA-F]{3,6}` across the feature's `.svelte` files must be empty — the fastest possible signal that styling drifted off the design system.

**What none of this guarantees** is that the _arrangement_ matches the mockup — where a card sits, how the tree lays out. That stays a human judgement against the mockup, made once. The list below is what must not be left to judgement.

### D5.3 UI acceptance list

Each item is owned by a slice and must be ticked before that slice is done, exactly like the `E<n>` register. Twelve items; everything not on this list is pixels nobody should be held to.

| #   | Requirement                                                                                                                                                                     | Slice     |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| A1  | Sidebar gains one `SidebarNavItem`, "Family", after People — and renders nothing at all when effective access is `none`                                                         | 10        |
| A2  | Person page relations are a section **beneath the existing header**, reusing its `circle` + `shadow` avatar treatment                                                           | 8         |
| A3  | The detail-panel relation is an **added** line above the age (both show), same `font-light`, truncating with ellipsis at the `grid-cols-4` / `text-xs` breakpoint past 6 people | 9         |
| A4  | Detail-panel tiles keep `ImageThumbnail curve shadow` — rounded-xl squares, no new tile component, no circles                                                                   | 9         |
| A5  | Anonymous seat: muted avatar with `?`, italic muted name, distinct from an empty seat                                                                                           | 8, 10, 13 |
| A6  | Empty seat: dashed border, no avatar, `+ Add a parent`, rendered **only** for `contribute`                                                                                      | 10        |
| A7  | Union connector is a pill carrying status and dates, and draws dashed amber once the union has ended                                                                            | 10        |
| A8  | One cluster chip per detected component; the active chip uses the accent container colour                                                                                       | 10        |
| A9  | Every derived label falls back to the neutral term when gender is unset — "your parent", not "your father"                                                                      | 6         |
| A10 | With no path to the root, the label takes the "X's parent" form rather than rendering blank                                                                                     | 6         |
| A11 | The admin table renders "Inherits default" as a state distinct from any explicit value                                                                                          | 12        |
| A12 | Effective access `none` renders no sidebar item, no relations section and no detail-panel relation lines — on web **and** mobile                                                | 8–14      |

**A9 deserves emphasis** because it is the one most likely to be "improved" into a bug: the mockup shows neutral labels everywhere on purpose. That is the correct out-of-the-box state, not a placeholder to be filled in with guessed genders.

**The canvas is the authoring tool, not the destination.** Most users will build the graph once and never open `/family` again; the value is delivered on the two surfaces they already use. When trading off effort, favour slices 8 and 9.

**Mobile is read-only in this release.** Relations are server-sourced (a provider in the shape of `getAllPeopleWithSharedSpaces`, per `CLAUDE.md`'s note that mobile people are already server-sourced for shared-space reasons), with a graceful empty state offline (`E54`). Editing stays on the web canvas; touch drag-and-drop on a pannable canvas is deliberately out of scope.

**Clusters, not trees.** `/family` lists the disconnected components of the graph the viewer can see — "Marais · 12 people", "Van Dijk · 8 people" — computed by a query, never stored (`D8.3`). This is how "multiple family trees" is satisfied without any tree object.

## D6 — Canvas interaction

Three drop gestures, and no others:

| Gesture                | Effect                                                                                      |
| ---------------------- | ------------------------------------------------------------------------------------------- |
| Drop **above** a card  | Add as a partner in the union that card is a **child** of; create that union if it has none |
| Drop **beside** a card | Create a new union with the two of them as partners                                         |
| Drop **below** a card  | Add as a **child** of that card's union; create a 1-partner union if it has none            |

A sibling needs no gesture of its own — it is "drop below the parent". Dropping a second parent **joins the existing union** rather than creating a competing one (`E52`), which is why two parents can never accidentally describe two separate families.

Node positions are **not stored**. With no container there is no shared arrangement to store, and a layout arranged around one person's root is wrong for anyone rooted elsewhere. Layout is computed per viewer from their root.

## D7 — Decisions, including the reversals

Recorded so the rationale is not lost, and so nobody re-opens a closed question.

| Decision                      | Outcome                                        | Note                                                                                         |
| ----------------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Primary job                   | Orientation first, record second               | Ship "who is this to you?"; keep the graph honest enough to grow                             |
| Ownership                     | **Nobody owns it**                             | Reversed twice: space-owned → personal-owned → containerless                                 |
| Sharing model                 | **None needed**                                | Sharing a family tree becomes sharing photos                                                 |
| People with no photos         | Out, deferred                                  | Reversed. Keeps `face_identity` semantics untouched — retired the largest risk in the design |
| Partnerships                  | Full union objects with status and dates       | Earns its cost three times over (`D1.3`)                                                     |
| Relationship terms            | Store primitives, derive the rest              | The reason conflicts cannot occur                                                            |
| Gendered labels               | Optional `gender`, neutral fallback            | Never inferred                                                                               |
| Access                        | Admin flag + per-user grant, space-independent | Also removed the "space editor can write about your family" objection                        |
| Editing others' relationships | Allowed for any `contribute` user              | `createdById` kept for provenance                                                            |
| Mobile                        | Read-only                                      | Whole orientation job, no touch canvas                                                       |
| Release shape                 | Everything in one release                      | Phase 1 (slices 1–7) is independently shippable as an API if timing gets tight               |

## D8 — Extensibility constraints

A future "define a subset of people and call them a family" must be **purely additive**: a new `family` / `family_member` table pointing at identities that already exist, with no migration and no reinterpretation of existing rows. Having no container now is what buys that. These five constraints preserve it, and each has a guard test:

1. **No grouping key on `family_union`.** No `treeId`, no `familyId`. Once relationships are grouped, ungrouping them is a migration.
2. **A future family is a label over _people_, not a container of _relationships_.** That orthogonality is what keeps it additive — and it composes with memories later ("the Marais family, summer 2019").
3. **Cluster detection is a query, never a stored column.** A cached "which family is this person in" is a fake container that drifts.
4. **Access is a three-value enum from day one.** Shipping a boolean and splitting it later is a migration for nothing.
5. **The API returns `{ unions: [...] }`, never `{ tree: {...} }`.** This is where extensibility usually dies. A flat, query-filtered collection makes a future `?familyId=` additive; a nested tree response breaks the contract.

---

# Global Constraints

- **Fork migrations go in `server/src/schema/migrations-gallery/`**, never `server/src/schema/migrations/`. Use a round timestamp above the current maximum — the newest fork migration is `1792123120451`, so start at **`1795000000000`**.
- **A migration that changes an index or constraint whose SQL does not round-trip through `pg_get_expr` must also write a `migration_overrides` row**, following the exact pattern in `1783050000000-AddFaceRepairScanInFlightIndex.ts`. Otherwise `schema-drift.spec.ts` goes red. This applies to the `partnerKey` partial unique index in slice 1.
- **New tables and indexes must be added to `scripts/revert-to-immich.sql`.** This spec adds four tables and one index. **Do not add an `ALTER TABLE "face_identity" DROP COLUMN "gender"`** — that script already drops `face_identity` wholesale with `CASCADE` (`:145`), so an `ALTER` against it would run after the table is gone and fail. The script is executed by the `gallery-revert-to-immich-validation.yml` CI job, so this is a red build, not a latent bug.
- **`mise sql` after any change under `server/src/repositories/`.** `@GenerateSql` tracks the _emitted SQL_, so editing a method body drifts the checked-in query files even when no method is added. The skip condition is "did anything touch `server/src/repositories/`?", not "did I add a method".
  - **`make sql` is removed** — `Makefile:140` is a stub that exits 1 and redirects to `mise sql`. Same for `make dev`, `make prod`, `make clean`, `make open-api`. `make e2e-web-dev` and the other `e2e-*-dev` targets _do_ still work. **`make lint-all`, `make format-all` and `make check-all` do not exist at all** — CLAUDE.md documents them but the Makefile has no such targets. Use the per-package tasks (`mise //web:check`, `mise //web:lint`, `mise //server:test`) or the explicit `pnpm exec` forms below.
- **A new repository must be registered in FIVE places.** The most error-prone mechanical step in the feature. An earlier version of this list said four — the fifth was found by a reviewer, after the slice that introduced it had already passed its own tests:
  1. `server/src/repositories/index.ts` — the import and the exported providers array.
  2. `server/src/services/base.service.ts` — a **positional** constructor parameter (63 and counting; position matters, names do not).
  3. `server/src/services/base.service.ts` again — the exported **`BASE_SERVICE_DEPENDENCIES`** array (`:101-159`), hand-maintained and consumed by the medium factory. **This one drifts silently:** it is not derived from the constructor, nothing typechecks the two against each other, and a mismatch surfaces only the first time a medium test constructs the service — potentially slices after the mistake.
  4. `server/test/utils.ts` — `newTestService()`'s own positional list (from `:401`), which must stay in the same order as (2).
  5. `server/test/medium.factory.ts` — a case in `newMockRepository`. **Do not copy `ClassificationRepository`'s placement:** it sits in the plain `automock(key)` group with no constructor args, which throws `Cannot read properties of undefined (reading 'setContext')` for any repository whose constructor calls `this.logger.setContext(...)`. That is a latent bug in the sibling, not a pattern to follow.

  Miss (2) or (4) and every argument after the insertion point silently shifts by one, so services receive the **wrong repositories** — `tsc` cannot catch it because they are all object types. Miss (3) or (5) and medium tests fail with `Mocked repository X is not a valid dependency`.

- **OpenAPI regen after any controller or DTO change**: run **`mise open-api`** from the repo root. It chains `//server:sync-open-api`, `:open-api-typescript` and `:open-api-dart` (`mise.toml:75-83`). Commit the generated TypeScript SDK and Dart client with the change.
  - **`make open-api` no longer exists** — `Makefile:136` errors out and redirects here. `pnpm sync:open-api` is not a server script either. CLAUDE.md is stale on both; trust `mise.toml`.
  - **Worktree trap:** a `//`-prefixed mise target (`mise //:open-api`) runs in the **main checkout**, not this worktree. Run the bare `mise open-api` from the worktree root, and check `git status` in the worktree afterwards to confirm the generated files actually landed here.
- **Any new or edited user-facing string must land in all ten locales in the same commit**: `en` plus `de · fr · it · nl · pl · es · ru · zh_Hans · zh_Hant`. Keys are alphabetically sorted, 2-space indent, unescaped Unicode; run `npx prettier --write i18n/*.json` from the repo root afterwards. Match each file's existing register — `de`/`it`/`es` are informal, `fr`/`ru` formal.
- **Never hand-edit the ~80 translator-owned locale files** (`mr.json`, `ms.json`, …).
- **Never add `Co-Authored-By` or `Generated-with` trailers to commits.**
- **Every slice ends green on its own gates.** A slice is not done until its own tests pass _and_ `pnpm exec eslint <changed files> --max-warnings 0` and `pnpm exec prettier --check <changed files>` are clean. ESLint green does not imply Prettier green; run both.
- **Pets are never part of the graph.** Every write path must reject a `face_identity` whose `type` is not `'person'`.
- **No raw colour literals in new UI.** `grep -rE '#[0-9a-fA-F]{3,6}' <the slice's new .svelte files>` must be empty; use theme tokens and Tailwind classes (`D5.2`). This is the cheapest signal that styling drifted off the design system.
- **Every UI slice ticks its `A<n>` items from `D5.3`** before it is done, and reuses the components named in `D5.2` rather than writing new markup that resembles the mockup.
- **Do not add screenshot regression tests.** The repo already has them in `reskin-visual.e2e-spec.ts` and they are `test.fixme` for a reason (`D5.2`). The a11y cases in that file are live and _should_ be extended.

# Ordering constraints between slices

Everything not listed here is independent and may be done in any order or in parallel.

- **Slice 1 before 4, 5** — they need the tables.
- **Slice 2 before 3** — access resolution reads the config block.
- **Slice 3 before 4, 5, 7** — every read and write path is gated on effective access.
- **Slice 6 may run in parallel with slices 4 and 5** — revised during execution. The label engine is a pure function in `server/src/utils/family-labels.ts` with a literal-fixture spec; it shares no file with the repository or service slices. **Slice 6 defines the projected-graph type it consumes, and slice 5 conforms to that type.** The original "slice 5 before 6" constraint existed only so the signature would be forced to take a projected graph rather than a repository — writing the type in slice 6 achieves the same guarantee without serialising the two.
- **Whichever of 5 or 6 lands second must verify the type actually matches**, since they are developed against a shared contract rather than a shared file. That check is cheap and belongs in slice 7, which composes them.
- **Slice 12 after slice 7**, not after 3 — revised during execution. The admin grants table needs the two grant endpoints, which live in slice 7.
- **Slices 5 and 6 before 7** — the controller composes the visibility query and the label engine.
- **Slice 7 before 8, 9, 10, 13, 14** — all clients need the API and the generated SDK.
- **Slice 10 before 11** — the editor builds on the renderer.
- **Slice 15 last** — e2e asserts the assembled feature.
- **Phase 1 (slices 1–7) is independently shippable.** It delivers a working, tested, access-gated API with no UI. If the release gets tight, it is the natural cut line.

# Test conventions — TDD and BDD

**TDD is mandatory and literal.** Every slice writes the test first, runs it to observe a _specific_ named failure, implements the minimum to pass, and re-runs. A test that passes on its first run is a red flag: it means the test does not exercise the behaviour, and it must be fixed before the implementation is written.

**BDD is expressed in the idiom this codebase already uses**, not in Gherkin. The repo has no Cucumber runner and introducing one would conflict with the "consistent with the codebase" requirement. Instead:

- `describe(...)` names the **context** — the unit and the state it is in.
- `it(...)` states an **observable behaviour in plain language**, phrased as what the system does, never as what the code contains. `it('hides a union when the viewer can resolve only one participant')`, not `it('calls resolveProfiles')`.
- Where the scenario has preconditions a reader cannot infer, a **GIVEN / WHEN / THEN comment** sits directly above the test.
- The body follows **arrange / act / assert** in that order, with no assertions interleaved into setup.

**Every negative assertion needs a positive control.** An assertion that something is absent, hidden, redacted or rejected proves nothing alone — a broken fixture, a typo'd testid or a query returning nothing produces the same green. Pair it with the case that _should_ be present. This is not stylistic: the visibility rule in `D3` and the redaction rule in `E30` are both "assert absence" by nature, and are exactly the assertions most likely to pass for the wrong reason.

**Prove redaction by flipping the flag.** For every `E26`–`E34` test, the paired positive control must be the _same_ fixture with the viewer's access to one person added or removed. A redaction test that never observes the un-redacted case is not evidence.

# Verification commands (use these exact forms)

```bash
# Server unit — a SINGLE file. The --config flag is required; without it vitest runs
# without globals and every spec dies with "describe is not defined".
cd server && pnpm exec vitest run --config test/vitest.config.mjs src/path/to/file.spec.ts

# TRAP — do NOT use. The file filter is silently dropped and the whole suite runs:
#   pnpm test -- --run src/path/to/file.spec.ts

# Server medium (needs Docker running)
cd server && pnpm exec vitest run --config test/vitest.config.medium.mjs test/medium/specs/path/file.spec.ts

# Server whole unit suite
cd server && pnpm test

# Web — single file
cd web && pnpm exec vitest run src/lib/components/path/File.spec.ts

# Web gates. Run check:svelte via the script — a bare `svelte-check` uses a different
# file set and reports hundreds of pre-existing errors that are not real.
cd web && pnpm run check:svelte
cd web && pnpm run check:typescript

# Mobile. Read the Flutter pin from mobile/mise.toml rather than trusting any doc.
# Generated localization/keys are gitignored and must exist before `flutter test`.
cd mobile && flutter pub get
cd mobile && dart run easy_localization:generate -S ../i18n
cd mobile && dart run bin/generate_keys.dart
cd mobile && flutter test test/path/to/file_test.dart
# `dart analyze` is NOT a substitute for `flutter test` — generated-code compile
# errors only surface when a test actually compiles.

# e2e web against a running `make dev` stack on :2283
make e2e-web-dev
```

---

# Edge case register

The acceptance surface for "full coverage". Every case is owned by exactly one slice, named in the last column. A slice is not complete until each case it owns has a test whose `it(...)` title describes that behaviour.

## Model and validation

| #   | Case                                                    | Expected                                                            | Slice |
| --- | ------------------------------------------------------- | ------------------------------------------------------------------- | ----- |
| E1  | Union with zero partners, two children                  | Legal; children are siblings                                        | 4     |
| E2  | Union with one partner                                  | Legal; the empty seat is anonymous                                  | 4     |
| E3  | One person a partner in several unions                  | Legal — remarriage                                                  | 4     |
| E4  | Same two partners added twice                           | Resolves to one row via `partnerKey`; concurrent writes too         | 4     |
| E5  | Two separate 0- or 1-partner unions                     | **Not** deduplicated — `partnerKey` is NULL                         | 4     |
| E6  | One child in two unions                                 | Legal — adoption or step-parentage                                  | 4     |
| E7  | A is parent of B, B is parent of A                      | Rejected — cycle                                                    | 4     |
| E8  | Cycle across three generations (A→B→C→A)                | Rejected — ancestor walk must be transitive, not one level          | 4     |
| E9  | A person as their own partner                           | Rejected                                                            | 4     |
| E10 | A person as both partner and child of the same union    | Rejected                                                            | 4     |
| E11 | A third partner added to a union                        | Rejected — arity is 2                                               | 4     |
| E12 | A pet identity as a participant                         | Rejected — `face_identity.type` must be `person`                    | 4     |
| E13 | An identity is deleted                                  | Memberships cascade; a union may drop below 2 participants          | 4     |
| E14 | Two identities are merged                               | Memberships re-point and collapse; no duplicate membership rows     | 4     |
| E15 | `endDate` before `startDate`                            | Rejected                                                            | 4     |
| E16 | `status: divorced` with no `endDate`                    | Legal — the date may be unknown                                     | 4     |
| E17 | Partner removed from a 2-partner union                  | `partnerKey` recomputed to NULL in the same transaction             | 4     |
| E60 | The same two partners marry, divorce and remarry        | Legal — `startDate` is part of `partnerKey`, so both unions coexist | 4     |
| E61 | Same pair, same (or both-null) `startDate`, added twice | Collapses to one row — the duplicate we do want to prevent          | 4     |
| E62 | A union's `startDate` is edited                         | `partnerKey` recomputed in the same transaction                     | 4     |

## Access

| #   | Case                                                           | Expected                                                                   | Slice |
| --- | -------------------------------------------------------------- | -------------------------------------------------------------------------- | ----- |
| E18 | Feature disabled instance-wide, user has explicit `contribute` | Effective access `none` — the flag always wins                             | 3     |
| E19 | No `family_access` row                                         | Inherits `config.familyTree.defaultAccess`                                 | 3     |
| E20 | Explicit `none` while default is `contribute`                  | `none` — the override is meaningful                                        | 3     |
| E21 | `view` user attempts any write                                 | 403                                                                        | 3, 4  |
| E22 | Admin with no grant                                            | No implicit access — treated exactly like any other user                   | 3     |
| E23 | The user who created a union is deleted                        | **Union survives**, `createdById` becomes NULL                             | 1     |
| E24 | `contribute` user edits a union someone else created           | Allowed                                                                    | 4     |
| E25 | `contribute` user deletes a union someone else created         | Allowed                                                                    | 4     |
| E26 | Grant revoked between requests                                 | Next request 403 — effective access is never cached across requests        | 3     |
| E66 | `defaultAccess` is changed while explicit grants exist         | Explicit grants are untouched — the default only affects users with no row | 12    |
| E67 | Access revoked from a user who authored unions                 | Their unions **survive**; only their ability to read and write is removed  | 12    |

## Visibility and redaction

| #   | Case                                                     | Expected                                                     | Slice |
| --- | -------------------------------------------------------- | ------------------------------------------------------------ | ----- |
| E27 | Viewer resolves exactly 2 participants                   | Union visible                                                | 5     |
| E28 | Viewer resolves exactly 1 participant                    | Union omitted entirely                                       | 5     |
| E29 | Viewer resolves 0 participants                           | Union omitted entirely                                       | 5     |
| E30 | Unresolvable participant inside a visible union          | **Opaque per-union slot index, never the real `identityId`** | 5     |
| E31 | Viewer resolves a person only via their own `person` row | Counts as resolvable                                         | 5     |
| E32 | Viewer resolves a person via `shared_space_person`       | Counts as resolvable                                         | 5     |
| E33 | Person is hidden (`isHidden`)                            | Not resolvable                                               | 5     |
| E34 | Viewer's space membership is revoked                     | Previously visible union is hidden or redacted on next read  | 5     |
| E63 | A person belongs to no union at all                      | Appears in no cluster; must not crash cluster detection      | 5     |
| E64 | A new union joins two previously separate clusters       | They become one cluster on the next read — never stored      | 5     |
| E65 | Several hundred unions in one graph                      | Read stays within budget; no per-union N+1 profile lookup    | 5     |

## Derived labels

| #   | Case                                            | Expected                                                                                | Slice |
| --- | ----------------------------------------------- | --------------------------------------------------------------------------------------- | ----- |
| E35 | No root set                                     | Plain names, no relative labels                                                         | 6     |
| E36 | Root set, no path to target                     | Relative to nearest reachable person — "Pierre's sister"                                | 6     |
| E37 | Gender unset                                    | Neutral term — parent, sibling, partner, child                                          | 6     |
| E38 | Gender set                                      | Gendered term — mother, sister                                                          | 6     |
| E39 | Shares one parent via a different union         | "half-brother"                                                                          | 6     |
| E40 | Parent's partner who is not your parent         | "stepmother"                                                                            | 6     |
| E41 | Partner's parent                                | "mother-in-law"                                                                         | 6     |
| E42 | Union status `divorced` / `separated`           | "ex-husband" / "former partner", never "husband"                                        | 6     |
| E43 | Cousin, second cousin, great-aunt               | Correct degree and removal                                                              | 6     |
| E44 | Two valid paths to the same person              | Shortest wins; ties broken deterministically                                            | 6     |
| E45 | Relationship beyond the supported degree        | "relative" — the walk is capped                                                         | 6     |
| E46 | Target is the root                              | "that's you"                                                                            | 6     |
| E47 | Anonymous seat lies on the path                 | Label still computed; the hidden person is never named                                  | 6     |
| E59 | Path runs through a union the viewer cannot see | **No label at all** — derivation runs on the projected subgraph, then rule 4 takes over | 6     |

## Identity merge (`D1.6`)

Added after review. These are the highest-severity cases in the register: a defect here breaks face merging, not just the family tree.

| #   | Case                                                           | Expected                                                                                    | Slice |
| --- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ----- |
| E56 | An identity that is a union participant is merged into another | Memberships **re-point before** the source row is deleted — nothing is lost to CASCADE      | 4     |
| E57 | Merge makes two unions collide on `partnerKey`                 | The two unions fold into one; the merge **must not** abort on a unique violation            | 4     |
| E58 | Merge produces a self-union, or closes a parent cycle          | Self-union deleted, cycle broken by dropping the offending child edge; merge still succeeds | 4     |

## API, canvas and mobile

| #   | Case                                           | Expected                                               | Slice |
| --- | ---------------------------------------------- | ------------------------------------------------------ | ----- |
| E48 | Response shape                                 | Flat `{ unions: [...] }`, never nested under a tree    | 7     |
| E49 | Very large graph                               | Paginated; a stable order across pages                 | 7     |
| E50 | Feature disabled                               | Every endpoint responds consistently (403), not 500    | 7     |
| E51 | A person in three unions on the canvas         | Renders without overlapping cards or edges             | 10    |
| E52 | Drop a parent onto a card that already has one | Joins the existing union; never creates a third parent | 11    |
| E53 | Drag a person already on the canvas            | Moves them; never creates a duplicate node             | 11    |
| E54 | Mobile offline                                 | Graceful empty state, no crash, no stale claim         | 13    |
| E55 | Person page for a pet                          | No relations section at all                            | 8     |

---

# Slice 1 — Schema and migration

**Delivers:** four tables, one column, one partial unique index, and a revert-script entry. No behaviour.

**Owns:** `E23`.

- [ ] **Step 1: Write the failing test**

Add `server/test/medium/specs/family/family-schema.spec.ts`. It must assert the constraint that matters most, not merely that tables exist:

```ts
describe("family_union schema", () => {
  // GIVEN a union created by a user
  // WHEN that user is deleted
  // THEN the union survives with a null creator — family history must outlive accounts.
  it("keeps a union when the user who created it is deleted", async () => {
    const { user, union } = await setupUnionCreatedBy();
    await deleteUser(user.id);

    const found = await db.selectFrom("family_union").where("id", "=", union.id).selectAll().executeTakeFirst();
    expect(found).toBeDefined();
    expect(found?.createdById).toBeNull();
  });

  // Positive control for the above: prove the cascade we DO want still fires.
  it("removes membership rows when the union itself is deleted", async () => {
    const { union } = await setupUnionWithPartners();
    await db.deleteFrom("family_union").where("id", "=", union.id).execute();

    const partners = await db.selectFrom("family_union_partner").where("unionId", "=", union.id).execute();
    expect(partners).toHaveLength(0);
  });

  it("rejects a second union with the same two partners and the same start date", async () => {
    const [a, b] = await createIdentities(2);
    await createUnion({ partners: [a, b], startDate: "1998-06-12" });

    // Assert the SQLSTATE, not the message. A Postgres unique violation names the
    // *index*, not the column, so /partnerKey/ would pass or fail for the wrong reason.
    await expect(createUnion({ partners: [a, b], startDate: "1998-06-12" })).rejects.toMatchObject({ code: "23505" });
  });

  it("allows the same two partners to marry again on a different date", async () => {
    // E60 — remarriage. startDate is part of partnerKey precisely so this works.
    const [a, b] = await createIdentities(2);
    await createUnion({ partners: [a, b], startDate: "1998-06-12", endDate: "2007-03-01" });
    await expect(createUnion({ partners: [a, b], startDate: "2011-09-04" })).resolves.toBeDefined();
  });

  it("allows two unions that each have a single, identical partner", async () => {
    // partnerKey is NULL below two partners, so these must NOT collide (E5).
    const [a] = await createIdentities(1);
    await createUnion({ partners: [a] });
    await expect(createUnion({ partners: [a] })).resolves.toBeDefined();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd server && pnpm exec vitest run --config test/vitest.config.medium.mjs test/medium/specs/family/family-schema.spec.ts
```

Expected: FAIL — relation `family_union` does not exist.

- [ ] **Step 3: Implement**

Add table classes under `server/src/schema/tables/`: `family-union.table.ts`, `family-union-partner.table.ts`, `family-union-child.table.ts`, `family-access.table.ts`. Add `gender` to `face-identity.table.ts`. Register them wherever the schema index enumerates tables.

Write `server/src/schema/migrations-gallery/1795000000000-AddFamilyRelationships.ts`. Exact column semantics are in `D1.1`; `createdById` is `ON DELETE SET NULL`.

- [ ] **Step 4: Verify green, then check for drift**

```bash
cd server && pnpm exec vitest run --config test/vitest.config.medium.mjs test/medium/specs/family/family-schema.spec.ts
cd server && pnpm exec vitest run --config test/vitest.config.medium.mjs test/medium/specs/schema-drift.spec.ts
```

If drift reports the partial index, add a `migration_overrides` row per `1783050000000-AddFaceRepairScanInFlightIndex.ts` and re-run.

- [ ] **Step 5: Update the revert script**

Append the four tables, the `face_identity.gender` column and the index to `scripts/revert-to-immich.sql`.

---

# Slice 2 — Config block

**Delivers:** `familyTree: { enabled, defaultAccess }` in system config, with defaults and validation.

- [ ] **Step 1: Write the failing tests** in `server/src/utils/config.spec.ts` (or the system-config DTO spec, matching where sibling feature flags are tested):
  - `it('defaults the family tree to disabled')`
  - `it('defaults new installs to no family tree access')`
  - `it('rejects a defaultAccess value outside none, view and contribute')`
  - `it('preserves an admin-set defaultAccess through a config round-trip')`
- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Implement** the block in `server/src/config.ts` and the matching Zod schema in `server/src/dtos/system-config.dto.ts`.

`system-config.dto.ts` is an **upstream file carrying fork additions** — `petDetection` and `classification` already live there (`:147`, `:194`, `:222`). Follow those exactly and keep the diff minimal; every line added is rebase surface.

- [ ] **Step 4: Verify green**, then regenerate OpenAPI (the system-config DTO is API surface).

---

# Slice 3 — Effective access resolution

**Delivers:** one function and one permission, used by every later slice.

**Owns:** `E18`, `E19`, `E20`, `E21`, `E22`, `E26`.

- [ ] **Step 1: Write the failing tests** in `server/src/services/family.service.spec.ts`:

```ts
describe('effective family access', () => {
  // GIVEN an instance where the admin disabled the feature entirely
  // WHEN a user with an explicit contribute grant is resolved
  // THEN the flag wins — a stale grant must never outlive the switch.
  it('returns none when the feature is disabled, even for an explicitly granted user', async () => { … });

  it('falls back to the instance default when the user has no grant', async () => { … });
  it('honours an explicit none grant on an instance whose default is contribute', async () => { … });
  it('gives an admin no access without a grant of their own', async () => { … });

  // Positive control for the two negatives above.
  it('returns contribute for a user granted contribute on an enabled instance', async () => { … });

  it('reflects a revoked grant on the very next request', async () => { … });
});

describe('write authority', () => {
  it('refuses a write from a view-only user', async () => { … });
  it('refuses a write from a user with no access, even one who edits the space the people are in', async () => { … });
  it('accepts a write from a contribute user who is in no shared space at all', async () => { … });
});
```

The last two are the load-bearing pair: together they prove authority comes from the grant and **not** from space roles (`D2`).

- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Implement** `resolveFamilyAccess(auth)` on a new `FamilyService` extending `BaseService`, plus a `FamilyAccess` permission the controller layer can require. Do not cache across requests (`E26`).

**This slice creates `FamilyRepository`, not slice 4.** Resolving a grant means reading the `family_access` row, which needs a repository — so the repository is born here with a single method (read one user's grant), and slice 4 extends it with the union write methods. Register it in all four places named in the Global Constraints. An earlier draft of this spec put the repository in slice 4, which would have left slice 3 with no way to read the table it depends on.

- [ ] **Step 4: Verify green.**

---

# Slice 4 — Union write path

**Delivers:** create, update and delete for unions and their membership, with every validation rule — plus participation in identity merge, which is the highest-risk part of the whole spec.

**Owns:** `E1`–`E17`, `E24`, `E25`, `E56`–`E58`, `E60`–`E62`, and the write half of `E21`.

> **This slice is larger than its neighbours and that is deliberate.** Merge participation (`D1.6`) cannot be split off: it shares the `partnerKey` invariant and the cycle check with the ordinary write path, and a plan that implements one without the other leaves face merging broken between commits.

- [ ] **Step 1: Write the failing tests.** Unit tests in `server/src/services/family.service.spec.ts` for validation; medium tests in `server/test/medium/specs/family/family-write.spec.ts` for anything needing real SQL (`E4` concurrency, `E13`, `E14`, `E17`).

Cover, one `it` each, phrased as behaviour:

- `it('creates a union with no partners so two children can be siblings')` (E1)
- `it('creates a union with a single known parent')` (E2)
- `it('lets one person be a partner in several unions')` (E3)
- `it('returns the existing union when the same two partners are added again')` (E4)
- `it('creates two independent unions when neither has two partners')` (E5)
- `it('lets a child belong to two unions')` (E6)
- `it('refuses to make someone the parent of their own parent')` (E7)
- `it('refuses a cycle that closes three generations up')` (E8)
- `it('refuses to make someone their own partner')` (E9)
- `it('refuses a person who is both partner and child of one union')` (E10)
- `it('refuses a third partner')` (E11)
- `it('refuses a pet identity as a participant')` (E12)
- `it('leaves the union in place when a participating identity is deleted')` (E13)
- `it('re-points membership without duplicating it when two identities are merged')` (E14)
- `it('refuses an end date earlier than the start date')` (E15)
- `it('accepts a divorced union with no end date')` (E16)
- `it('clears partnerKey when a union drops to one partner')` (E17)
- `it('lets a contributor edit a union another user created')` (E24)
- `it('lets a contributor delete a union another user created')` (E25)

`E8` deserves a comment; the naive implementation checks one level and passes `E7` while failing `E8`.

```ts
// GIVEN Johan is a parent of Pierre, and Pierre a parent of Sofie
// WHEN an editor tries to make Sofie a parent of Johan
// THEN it is refused: the ancestor check must walk the whole chain, not one hop.
it('refuses a cycle that closes three generations up', async () => { … });
```

- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Implement** the write methods on `FamilyService`, **extending the `FamilyRepository` that slice 3 created** (it is already registered in all four places; do not re-register it). `partnerKey` is recomputed inside the same transaction as any membership **or `startDate`** change.

- [ ] **Step 4: Write the failing merge tests** — `D1.6`, and the part most likely to be skipped.

Medium tests in `server/test/medium/specs/family/family-identity-merge.spec.ts`, driven through the **real** `identity-merge-propagation.service.ts`, never through a hand-rolled fake. The whole point is that the existing service does the right thing; a test against a stub proves nothing.

```ts
describe('family relationships under identity merge', () => {
  // GIVEN Johan appears twice as two identities, one of them a partner in a union
  // WHEN the duplicate is merged away
  // THEN the union keeps him — membership must re-point BEFORE the source row is
  // deleted, or ON DELETE CASCADE silently eats the relationship.
  it('keeps a union when one of its partners is merged into another identity', async () => { … });

  // Positive control: prove the merge itself actually happened, so the test above
  // cannot pass merely because nothing ran.
  it('leaves exactly one surviving identity after that merge', async () => { … });

  // E57 — the failure that breaks an unrelated shipped feature.
  // GIVEN union(A,C) and union(B,C) both exist
  // WHEN B is merged into A, making both unions key on the same pair
  // THEN they fold into one and the merge SUCCEEDS. A unique-violation abort here
  // would roll back the caller's face merge, not just the family data.
  it('folds two unions into one when a merge collides them on partnerKey', async () => { … });

  it('keeps the earliest start date and the non-null status when folding', async () => { … });

  // E58 — the merge path never runs write-path validation, so it can forge
  // graphs the write path would refuse.
  it('deletes a union that a merge would turn into a person partnered with themselves', async () => { … });
  it('breaks a parent cycle that a merge would close, without failing the merge', async () => { … });
});
```

- [ ] **Step 5: Run to verify they fail**, then implement by registering the family tables with `identity-merge-propagation.service.ts`. Re-point before delete; fold on collision; repair self-unions and cycles. **A merge must never fail because of family data, and must never silently lose it.**
- [ ] **Step 6: Verify green, then `mise sql`** — this slice touches `server/src/repositories/`, so the checked-in query files drift even though the change is not a new decorated method.
- [ ] **Step 7: Re-run the existing merge suite** — `person.service.spec.ts` and any medium spec covering `identity-merge-propagation`. This slice edits a shipped code path; its own tests passing is not evidence that merging still works.

---

# Slice 5 — Visibility query

**Delivers:** the read path that applies `D3`, returning redacted unions, plus cluster detection.

**Owns:** `E27`–`E34`, `E63`–`E65`.

- [ ] **Step 1: Write the failing tests.** Medium tests against a real DB in `server/test/medium/specs/family/family-visibility.spec.ts` — this rule is a join over profile resolution and unit mocks would test the mock.

Every case is paired with its positive control, per the test conventions:

```ts
describe('union visibility', () => {
  // GIVEN a union of Johan and Marie with children Pierre and Elise
  // WHEN a viewer can resolve only Elise
  // THEN the union is omitted: one participant says nothing and leaks a headcount.
  it('omits a union when the viewer can resolve only one participant', async () => { … });

  // Positive control — the SAME fixture, with the viewer given access to one more person.
  it('returns that union once the viewer can resolve a second participant', async () => { … });

  it('omits a union when the viewer can resolve none of its participants', async () => { … });
  it('counts a person the viewer holds only in their own library', async () => { … });
  it('counts a person the viewer reaches through a shared space', async () => { … });
  it('does not count a hidden person towards the threshold', async () => { … });
  it('hides a previously visible union after the viewer leaves the space', async () => { … });
});

describe('redaction', () => {
  // E30 — a security requirement. A leaked identityId lets a client correlate the
  // same hidden person across unions and reconstruct what redaction withholds.
  it('never returns the identity id of a participant the viewer cannot resolve', async () => {
    const result = await getUnions(viewerWhoCannotSeeJohan);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(johan.identityId);
  });

  it('returns a stable opaque slot for each unresolvable participant', async () => { … });

  // Positive control — the resolvable participant DOES come back with a real id.
  it('returns the real identity id for a participant the viewer can resolve', async () => { … });
});

describe('cluster detection', () => {
  // D8.3 — computed, never stored. These tests are the guard on that constraint.
  it('reports two families as separate clusters when nothing joins them', async () => { … });
  it('reports one cluster once a union joins two previously separate families', async () => { … });
  it('omits a person who belongs to no union from every cluster', async () => { … });
});
```

- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Implement** the query. Reuse the existing profile-resolution used by the people list and `getPersonThumbnailUrl`; do not re-derive it. Clusters are computed per request — **no cached column** (`D8.3`).
- [ ] **Step 4: Add the scale guard** (`E65`). Seed several hundred unions and assert profile resolution is a **single** query, not one per union. The people page in this repo already has a documented JIT-driven slowness problem on a superficially similar join; a per-union N+1 here would reproduce it. Assert the query count, not a wall-clock time — timing assertions flake in CI.
- [ ] **Step 5: Verify green, then `mise sql`.**

---

# Slice 6 — Derived label engine

**Delivers:** a pure function from (projected graph, root, target) to a label. The most test-dense slice, and the one most worth writing first.

**Owns:** `E35`–`E47`, `E59`. **UI acceptance:** `A9`, `A10` — both are label-engine behaviour, not styling, which is why they are enforced here rather than in a UI slice.

- [ ] **Step 1: Write the failing tests** in `server/src/utils/family-labels.spec.ts`. A pure function with no I/O — build the graph as a literal fixture and assert exhaustively. One `it` per register row, plus:
  - `it('prefers the shorter path when someone is both a cousin and a sister-in-law')` (E44)
  - `it('returns the same label on repeated calls when two paths are equally short')` (E44 — determinism)
  - `it('falls back to a plain relative beyond the supported degree')` (E45)
  - `it('describes a hidden intermediate person without naming them')` (E47)
  - `it('produces no label when the only path runs through a union the viewer cannot see')` (E59)
  - `it('says "your parent" rather than "your father" when gender is not recorded')` (A9) — with the paired control asserting it _does_ say "your father" once gender is set. A9 is the requirement most likely to be "improved" into a bug, so it needs a test that fails when someone starts inferring.
  - `it('describes an unreachable person relative to the nearest person the viewer can reach')` (A10)
  - Positive control for `E59`: `it('produces the label once that union becomes visible to the viewer')` — the **same** fixture with the viewer's access widened. Without this pairing, `E59` passes for a graph that simply has no path.
- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Implement** `deriveRelationLabel(projectedGraph, rootId, targetId, opts)`. Keep it pure and free of repository access so the tests stay fast and the edge-case matrix stays cheap to extend.

**The first parameter must be the projected graph from slice 5, never a repository or the full graph** (`D4`, `E59`). Type it so that passing an unprojected graph is a compile error if the codebase's types allow — the leak in `E59` is invisible at runtime and a signature is the cheapest guard available.

- [ ] **Step 4: Verify green.**

---

# Slice 7 — Controller, DTOs and OpenAPI

**Delivers:** the HTTP surface. **Owns:** `E48`, `E49`, `E50`.

- [ ] **Step 1: Write the failing tests** in `server/src/controllers/family.controller.spec.ts` and `e2e/src/api/specs/family.e2e-spec.ts`:
  - `it('returns a flat list of unions rather than a nested tree')` (E48) — assert `body.unions` is an array and `body.tree` is undefined. This is the `D8.5` guard.
  - `it('pages a large graph in a stable order')` (E49)
  - `it('refuses every family endpoint with 403 when the feature is disabled')` (E50)
  - `it('rejects a write from a view-only caller')`
- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Implement** `family.controller.ts` and `family.dto.ts` (Zod). Endpoints: list unions, create/update/delete union, add/remove participant, set the viewer's root, set an identity's gender, **list the per-user access grants, and set one user's grant**.

The last two were missing from an earlier draft of this spec, which left slice 12 (the admin UI for grants) with no API to call. They are admin-only: require an admin caller, independent of `familyTree` access level — an admin with no grant of their own must still be able to administer other people's.

Authority per endpoint: everything except "set the viewer's root" requires `contribute`; setting your own root requires only `view`, since it changes nothing anyone else can see. Setting an identity's `gender` requires `contribute` — it is shared data that alters the labels every viewer reads, not a personal preference.

- [ ] **Step 4: Verify green, then regenerate the API:**

```bash
mise open-api
```

Commit the generated SDK and Dart client with the change.

---

# Slice 8 — Person page relations panel (web)

**Delivers:** the first payoff surface. **Owns:** `E55`.

**Mockup:** `specs/mockups/2026-08-31-family-relationships.html` §4 — including the view-only variant with no "Add a relationship" row, and the anonymous entry. **UI acceptance:** `A2`, `A5`, `A12`.

Reuse the person header's `ImageThumbnail circle shadow` treatment and add the section beneath the existing header — do not introduce a second header or a new avatar primitive (`D5.2`). Testids: `family-relations-panel`, `family-relation-row`, `family-anonymous-seat`, `family-add-relationship`.

- [ ] **Step 1: Write the failing tests** in the person-page component spec:
  - `it('lists each relation with its derived label')`
  - `it('shows an anonymous entry for a participant the viewer cannot resolve')`
  - `it('renders no relations section for a pet')` (E55)
  - `it('renders no relations section when the viewer lacks family access')`
  - Positive control: `it('renders the relations section for a person when the viewer has view access')`
- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Implement** the panel. Add strings to all ten locales.
- [ ] **Step 4: Verify green** plus `pnpm run check:svelte` and `pnpm run check:typescript`.

---

# Slice 9 — People strip relation labels (web)

**Delivers:** the second payoff surface — "your niece" under a face in the asset viewer.

**Mockup:** `specs/mockups/2026-08-31-family-relationships.html` §5. **UI acceptance:** `A3`, `A4`, `A12`.

**This slice edits `DetailPanelPeople.svelte` in place.** The relation line goes in the sub-line slot the age currently occupies, in the same `font-light`, and follows the existing `text-xs` downshift above six people. Do not build a new tile component and do not change the tiles from `ImageThumbnail curve shadow` to circles (`D5.2`). Testid: `detail-panel-person-relation`. The unlabelled face uses a neutral dash, not a blank — a blank makes the grid ragged and reads as a loading state.

**Decided: show both.** The relation line is an **additional** line, not a replacement — a person with a birthdate and a relation shows name, relation, and age. The cost is ~18px per grid row (about 36px for a six-person panel), which is modest.

Two consequences to handle deliberately rather than discover:

- **Rows will differ in height** when only some people have a birthdate. CSS grid equalises tiles within a row, so this reads as normal variation, not breakage. Do **not** reserve an empty line to force uniformity — that costs every tile the height whether or not it's used.
- **Above six people the component switches to `grid-cols-4` and `text-xs`.** Four lines at four columns in a ~360px panel is tight, so the relation line must truncate with ellipsis at that breakpoint. Test the crowded case, not just the roomy one.

- [ ] **Step 1: Write the failing tests:**
  - `it('labels each face with how that person relates to the viewer')`
  - `it('leaves a face unlabelled when no relationship is known')`
  - `it('leaves every face unlabelled when the viewer has no family access')`
  - Positive control pairing the last two against a labelled fixture.
- [ ] **Step 2: Run to verify they fail.** Name the failure you observed in the commit body.
- [ ] **Step 3: Implement**, adding every new string to all ten locales.
- [ ] **Step 4: Verify green**, plus `pnpm run check:svelte`, `pnpm run check:typescript` and `npx prettier --check i18n/*.json`.

---

# Slice 10 — Canvas renderer (web)

**Delivers:** `/family` — cluster list, graph rendering, pan and zoom. Read-only. **Owns:** `E51`.

**Mockup:** `specs/mockups/2026-08-31-family-relationships.html` §1 (canvas, sidebar entry, cluster chips) and §10 (empty, no-root and no-path states). **UI acceptance:** `A1`, `A5`, `A6`, `A7`, `A8`, `A12`.

Testids: `family-page`, `family-cluster-chip`, `family-canvas`, `family-node`, `family-union-bar`, `family-empty-seat`, `family-anonymous-seat`. Add `/family` to the **live** `a11y ·` cases in `e2e/src/specs/web/reskin-visual.e2e-spec.ts` — not the `test.fixme` visual ones (`D5.2`).

- [ ] **Step 1: Write the failing tests:**
  - `it('lists each disconnected family as a separate cluster')`
  - `it('centres the graph on the viewer when a root is set')`
  - `it('renders a person who belongs to three unions without overlapping cards')` (E51)
  - `it('renders an anonymous seat for an unresolvable partner')`
  - `it('shows an empty state when the viewer has no relationships yet')`
- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Implement.** Layout is computed per viewer, never stored (`D6`). Cluster data comes from slice 5 — do not recompute clusters client-side.
- [ ] **Step 4: Verify green**, plus `pnpm run check:svelte`, `pnpm run check:typescript` and the ten locales.

---

# Slice 11 — Canvas editing (web)

**Delivers:** drag-and-drop authoring and the union editor. **Owns:** `E52`, `E53`.

**Mockup:** `specs/mockups/2026-08-31-family-relationships.html` §2 (union editor, status vocabulary) and §3 (the three drop zones).

- [ ] **Step 1: Write the failing tests:**
  - `it('creates a parent relationship when a person is dropped above a card')`
  - `it('creates a partnership when a person is dropped beside a card')`
  - `it('creates a child relationship when a person is dropped below a card')`
  - `it('joins the existing union when a second parent is dropped above a card')` (E52)
  - `it('moves a person already on the canvas instead of duplicating them')` (E53)
  - `it('records a marriage with its status and dates')`
  - `it('offers no drop targets to a view-only user')` — paired with a positive control for a contributor.
- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Implement** the three gestures from `D6`.
- [ ] **Step 4: Verify green**, plus `pnpm run check:svelte`, `pnpm run check:typescript` and the ten locales.

---

# Slice 12 — Admin settings (web)

**Delivers:** the feature toggle, the instance default, and per-user grants. **Owns:** `E66`, `E67`.

**Mockup:** `specs/mockups/2026-08-31-family-relationships.html` §8. **UI acceptance:** `A11`, `A12`. Testid: `family-admin-access-row`.

"Inherits default" renders as its own state, distinct from any explicit value — without that, changing the instance default appears to silently change individual users (`E66`).

- [ ] **Step 1: Write the failing tests:**
  - `it('turns the family tree feature on and off')`
  - `it('sets the instance-wide default access level')`
  - `it('grants an individual user contribute access')`
  - `it('shows a user as inheriting the default when they have no explicit grant')`
  - `it('records who granted access and when')`
  - `it('leaves explicit grants untouched when the instance default is changed')` (E66) — paired with the positive control that a user **without** a grant does follow the new default.
  - `it('keeps the relationships a user recorded after their access is revoked')` (E67) — revocation removes their ability to read and write, never their data. This is the grant-level sibling of `E23`, and the same class of mistake.
- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Verify green**, plus `pnpm run check:svelte`, `pnpm run check:typescript` and the ten locales.

---

# Slice 13 — Mobile relations provider and focus card

**Delivers:** the person-page mirror of slice 8. **Owns:** `E54`.

**Mockup:** `specs/mockups/2026-08-31-family-relationships.html` §9 — focus card, the redacted variant, and the offline state, which must say relationships aren't stored on the device rather than implying there are none. **UI acceptance:** `A5`, `A12`.

- [ ] **Step 1: Write the failing tests** in `mobile/test/`:
  - `it('shows each relation with its derived label')`
  - `it('shows an empty state when the device is offline')` (E54)
  - `it('shows no relations section when the viewer lacks family access')`
  - Positive control for both negatives.
- [ ] **Step 2: Run to verify they fail** — read the Flutter pin from `mobile/mise.toml`, run the localization and key codegen first, then `flutter test`. `dart analyze` is not a substitute.
- [ ] **Step 3: Implement** a server-sourced provider in the shape of `driftGetAllPeopleWithSharedSpacesProvider`; relations are **not** synced to Drift in this release.
- [ ] **Step 4: Verify green**, plus `dart analyze --fatal-infos` and `dart format`.

---

# Slice 14 — Mobile people strip labels

**Delivers:** the mobile mirror of slice 9.

**Mockup:** `specs/mockups/2026-08-31-family-relationships.html` §9, matching §5's web treatment. **UI acceptance:** `A12`.

- [ ] **Step 1: Write the failing tests:**
  - `it('labels each face on the strip with its relationship to the viewer')`
  - `it('leaves faces unlabelled when the viewer has no family access')`
  - Positive control.
- [ ] **Step 2: Run to verify they fail** — Flutter pin from `mobile/mise.toml`, localization and key codegen first, then `flutter test`. `dart analyze` is not a substitute.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Verify green**, plus `dart analyze --fatal-infos` and `dart format`.

---

# Slice 15 — End-to-end, i18n completeness and docs

**Delivers:** proof the assembled feature works, and the release hygiene.

- [ ] **Step 1: Write the failing tests.** Playwright in **`e2e/src/specs/web/`** (note the order — it is _not_ `e2e/src/web/specs/`; API specs live at `e2e/src/api/specs/`):
  - `it('records a family and shows a derived relationship on the person page')` — the full journey: admin enables the feature, grants contribute, a user builds three unions on the canvas, opens a person page and sees "your niece".
  - `it('redacts a person the second viewer cannot see')` — two accounts, one shared space, asserting redaction end to end with the un-redacted view as its positive control.

Plus an i18n completeness spec asserting every key this feature added exists in all ten locales, in the style of the existing fork locale specs.

- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Implement** whatever the journeys expose, then write user-facing documentation under `docs/docs/features/`. Run `npx prettier --write` over any markdown under `docs/` — CI Docs Build is strict.
- [ ] **Step 4: Verify green:**

```bash
make e2e-web-dev
npx prettier --check i18n/*.json
```

- [ ] **Step 5: Final sweep** — `mise //server:test`, `mise //web:check`, `mise //web:lint`, and confirm `scripts/revert-to-immich.sql` covers every table, column and index this spec added. (`make lint-all` / `make check-all` do not exist, despite CLAUDE.md.)
