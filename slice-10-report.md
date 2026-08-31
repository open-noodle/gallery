# Slice 10 — The `/family` canvas (read-only) — Report

Branch: `feat/family-relationships-slice-10` (based on `feat/family-relationships`)

## What was implemented

### Task 1 — Route, sidebar entry, cluster chips

- **Sidebar entry** (`web/src/lib/components/shared-components/side-bar/UserSidebar.svelte`): one `SidebarNavItem` labelled `family_canvas_nav_item`, placed immediately after People, gated on a new `familyAccessManager.granted` boolean. Renders nothing at all (no disabled row) when access is `none` (A1/A12).
- **`familyAccessManager`** (`web/src/lib/managers/family-access-manager.svelte.ts`): a small manager, initialized once from `web/src/lib/utils/server.ts`'s root `init()` (same place `featureFlagsManager` is initialized), alongside the existing bootstrap sequence, only when the caller is authenticated. It probes `GET /family/me` (requires only `view`) and records success/failure as `granted`. See "Concerns" below — this **cannot** distinguish `view` from `contribute`.
- **Route** (`web/src/lib/route.ts`): added `family: () => '/family'`.
- **`/family` route** (`web/src/routes/(user)/family/+page.ts` + `+page.svelte`):
  - `+page.ts` authenticates, then calls `getClusters()` + `getMyRoot()` in parallel, and (if both succeed) fully paginates `getUnions()` into one aggregated `{ unions, identities }`. Any failure (403 for `none` access) sets `granted: false` and returns empty data — never throws.
  - `+page.svelte` redirects to `/photos` when `!data.granted` (A12 — no error state, no locked view). Otherwise renders `UserPageLayout` with cluster chips (`family-cluster-chip`) and the `FamilyCanvas`. An empty `clusters` list renders `EmptyPlaceholder` instead (the "nothing recorded yet" state).
  - **Default cluster selection** ("opens on the cluster containing the viewer root"): reuses `assignGenerations` (see below) to test, for each server-returned cluster, whether the viewer's root is a member of that cluster's connected component — without ever recomputing the cluster *list* itself (D8.3). The chip whose label reads "Around you" (`family_canvas_cluster_around_you`) is whichever cluster actually contains the viewer, not necessarily the first one server-side.

### Task 2 — The graph renderer

- **`web/src/lib/utils/family-layout.ts`** — a pure, unit-tested layout function, `buildFamilyLayout(unions, rootId, canContribute)`:
  - `assignGenerations` (exported) does a BFS over **known** participants only, starting at `rootId` at generation 0: partners of a union share a generation, a union's children sit one generation below its partners, and co-children (siblings) share a generation. This is exactly a connected-component walk, which is also reused by the page to test cluster membership.
  - `buildFamilyLayout` does a second pass over every union: any union with no participant resolvable to a known generation (i.e., not reachable from `rootId`) is **skipped**, not guessed at — this is what keeps a single call scoped to one cluster without ever computing "which cluster is this" itself.
  - Each **known** identity is pushed into its generation's seat list **exactly once**, deduplicated by `identityId` — this is the direct mechanism that makes E51 (a person in three unions) render as one card, not three.
  - **Anonymous** seats get a synthetic key `${unionId}:${role}:${index}` and **never** carry `identityId` at all (not optional-and-undefined — the field is simply absent from the object), matching D3/E30.
  - **Empty** seats (missing partner slot) are added **only when `canContribute` is true** — up to 2 minus however many partners already exist.
  - The viewer's own root, if they belong to no union at all (E63), is still placed alone at generation 0 rather than silently vanishing.
- **`web/src/lib/components/family/FamilyCanvas.svelte`** — the renderer:
  - Renders one row per generation (label via `family_canvas_generation_label`), each a flex-wrap row of cards — deliberately **flow layout, not absolute pixel coordinates**. This was a design decision, not a shortcut: normal document flow cannot produce two elements occupying the same box, so "no overlapping cards" (E51) holds by construction rather than by an arrangement I would otherwise have to compute and verify by hand. The mockup's own precise pixel arrangement is explicitly *not* a graded requirement (D5.2: "What none of this guarantees is that the arrangement matches the mockup").
  - `family-node` (known), `family-anonymous-seat`, `family-empty-seat` render distinctly per A5/A6: anonymous = solid muted circle with `?` + italic "Someone"; empty = dashed 2px border box with "+ Add a parent", contributor-only.
  - `family-union-bar`: a pill carrying `data-status` and `data-ended` attributes (for robust testing regardless of i18n fallback behaviour — see below) plus human-readable status + year(s) text. `separated`/`divorced`/`widowed` count as "ended" (dashed amber styling); `married`/`partnered` are "current".
  - Display name for a known card is `identity.label ?? identity.name` — the renderer never derives a relation label itself (D4); it only displays whatever the server already computed, including the "no path" fallback string ("Mia's parent") and the `null`-when-no-root-set case (falls back to plain `name`).

## Multi-union layout (E51) — how I handled it, concretely

A person who is a partner in three separate unions (e.g. divorced/remarried multiple times) is the case that breaks a naive "draw a tree centred on one marriage" layout, because there are three different "other partners" and three different sets of children all needing to sit adjacent to the *same* card without colliding.

My approach:

1. `assignGenerations` visits the person once via BFS and gives them exactly one generation number — full stop, regardless of how many unions later reference them.
2. `buildFamilyLayout`'s per-union pass then pushes each union's *other* partner and children as their own seats. Since the person themselves is deduplicated by identity id, they can never be pushed a second or third time — the three unions each independently contribute their own new nodes (the other partners, the children), never a duplicate of the shared person.
3. Rendering happens by CSS flow (flex-wrap), not by computing `x`/`y` — so uniqueness of the seat list is *sufficient* to guarantee no visual overlap; there is no separate "did I place two things on top of each other" failure mode possible in flow layout.

I verified this both at the pure-function level (`family-layout.spec.ts`) and at the component level (`family-canvas.spec.ts`), asserting: the shared person renders exactly once (`getAllByText('Sam')` has length 1), all three other partners and all three children are present as distinct cards, and `family-node` count is exactly 7 (not 9, which is what a naive per-union rendering would produce).

## Tests and results

```
cd web && pnpm exec vitest run src/routes/\(user\)/family/
  → 2 files, 7 tests, all passing

cd web && pnpm exec vitest run src/lib/utils/family-layout.spec.ts src/lib/components/family/family-canvas.spec.ts \
    "src/routes/(user)/family/" src/lib/components/shared-components/side-bar/user-sidebar.spec.ts
  → 5 files, 33 tests, all passing

cd web && pnpm exec vitest run   (full web suite)
  → 376 files passed | 1 skipped, 5989 tests passed | 2 skipped | 8 todo — no regressions

cd server && pnpm test -- --run src/services/family.service.spec.ts   (whole suite runs regardless of the filter)
  → 187 files passed | 1 skipped, 6190 tests passed | 14 skipped — no regressions from the
    startDate/endDate DTO change described below

cd web && pnpm run check:svelte    → 615 files, 0 errors, 0 warnings
cd web && pnpm run check:typescript → clean
cd server && npx tsc --noEmit      → clean
npx prettier --check i18n/*.json   → all files formatted
cd web && npx eslint <every new/changed file> --max-warnings 0 → clean (after --fix)
```

## TDD evidence

Every test in the two spec files this slice's plan explicitly enumerates was **written first and observed red** before implementation:

- `user-sidebar.spec.ts`'s three new tests: written before `UserSidebar.svelte` was touched — ran and confirmed 2 of 3 failing (the third, "renders no Family item", passed trivially against the *unmodified* sidebar, which is expected — see "tests that pass in both directions" below), then implemented, then green (11/11).
- `family-canvas.spec.ts` (9 tests): written before `FamilyCanvas.svelte` existed — ran and got "Failed to resolve import" (file doesn't exist) for all 9, then implemented, then green.
- `page-load.spec.ts` (3 tests) and `family-page.spec.ts` (4 tests): same pattern — written before `+page.ts`/`+page.svelte` existed, observed the "Failed to resolve import" red state, then implemented, then green.
- `family-layout.spec.ts` (6 tests): written and implemented together as a design-validation layer underneath the component tests (not a strict red/green cycle on its own), since the algorithm's shape needed to be nailed down before the component could consume it. The component-level tests above are the ones with genuine, observed red states.

## Do any tests pass in both directions? — explicit statement

Yes, checked deliberately per the brief's warning about this exact failure mode. Every "renders nothing" assertion has a named positive control, and I flipped the underlying condition on each to confirm both branches are actually exercised, not just the negative one passing vacuously:

- **A12 (sidebar)**: `renders no Family sidebar item when the viewer has no family access` vs `renders the Family sidebar item for a viewer with view access` — same fixture, only `familyAccessManager.granted` flipped. Verified both directions pass with the real component (not a stub).
- **A6 (empty seat)**: `renders a dashed add-a-parent affordance for an empty seat` (`canContribute: true`) vs `renders no add-a-parent affordance for a view-only viewer` (`canContribute: false`) — identical union fixture, only the flag flipped. Verified both directions pass.
- **A7 ended-vs-current**: `draws an ended union differently from a current one` renders *two* unions (one `married`, one `divorced`) in the *same* test and asserts the two bars differ (`data-ended` attribute and CSS class), rather than testing "ended" in isolation — this is itself a paired-control test within one case.
- **Redaction guard**: `never renders an identity id for an anonymous card` asserts a specific, deliberately-fake id string is absent from both the anonymous card's own `outerHTML` and the whole container's `getHTML()` — a real regression (e.g. accidentally interpolating `seat.identityId` for an anonymous seat) would make this fail, since anonymous seats structurally never carry that field.

I did **not** find any test in this slice that passes regardless of the implementation. I specifically checked the "never renders an identity id" test against this risk (a `queryBy` that would pass whether or not the real bug exists) and used a substring absence check on `outerHTML`/`getHTML()` instead, which does fail if the id leaks in via any attribute or text node.

## Files changed

Web (the actual slice):

- `web/src/lib/route.ts` — `Route.family()`
- `web/src/lib/managers/family-access-manager.svelte.ts` — new
- `web/src/lib/utils/server.ts` — wires `familyAccessManager.init()` into the root bootstrap
- `web/src/lib/components/shared-components/side-bar/UserSidebar.svelte` + `.../user-sidebar.spec.ts`
- `web/src/lib/utils/family-layout.ts` + `family-layout.spec.ts` — new
- `web/src/lib/components/family/FamilyCanvas.svelte` + `family-canvas.spec.ts` — new
- `web/src/routes/(user)/family/+page.ts`, `+page.svelte`, `page-load.spec.ts`, `family-page.spec.ts` — new
- `i18n/{en,de,fr,it,nl,pl,es,ru,zh_Hans,zh_Hant}.json` — 15 new `family_canvas_*` keys, alphabetically inserted, prettier-formatted (7 landed in the Task 1 commit — nav/title/subtitle/empty state/cluster label/people count — the remaining 8 in the Task 2 commit)
- `e2e/src/specs/web/reskin-visual.e2e-spec.ts` — `/family` added to the **live** `a11y ·` loop only (a new `A11Y_SCREENS` array, kept separate from `SCREENS`, which still drives the untouched, still-all-`test.fixme` `visual ·` loop); `beforeAll` now also flips `familyTree.enabled`/`defaultAccess` via `updateConfig` so the admin used by this suite actually has access to `/family` rather than being redirected to `/photos` before the scan runs (admins get no implicit bypass — D2). **Not executed live** (requires the full e2e docker stack); verified only via `tsc --noEmit` on the e2e project.

Server (see "A pre-existing gap I fixed" below — not part of the plan's own task list, but load-bearing for A7):

- `server/src/repositories/family.repository.ts` — `getAllUnionsWithParticipants` now selects `startDate`/`endDate`; `RawUnionRow`/`VisibleUnion` carry them through.
- `server/src/services/family.service.ts` — `getVisibleGraph` threads them onto `ProjectedFamilyUnion`.
- `server/src/utils/family-labels.ts` — `ProjectedFamilyUnion.startDate`/`endDate` added as **optional** fields (so the ~34 existing fixtures in `family-labels.spec.ts`, which never needed dates, compile unchanged).
- `server/src/dtos/family.dto.ts` — `FamilyUnionSchema` gains `startDate`/`endDate` (reusing the existing `FamilyDateSchema`, moved earlier in the file since it's now needed before its old point of use).
- `server/src/controllers/family.controller.ts` — `getUnions` maps them through with an `?? null` guard.
- `server/src/queries/family.repository.sql` — hand-updated to match the new query (see "Residual verification gap" below — I could not safely run `mise sql` to regenerate it).
- `open-api/immich-openapi-specs.json`, `packages/sdk/src/fetch-client.ts` (+ built `packages/sdk/build/`, gitignored) — regenerated (TypeScript SDK only; **Dart/mobile openapi was deliberately not regenerated**, to stay out of the mobile agent's lane).

## Self-review findings

- The empty-seat "+ Add a parent" card is a plain `<div>`, not a `<button>` — correct for this slice (it has no click handler; slice 11 wires the gesture), but whoever implements slice 11 will need to either turn it into a real interactive element or wrap it, and should re-check its a11y semantics then.
- The generation label renders a raw signed number ("Gen -1") rather than the mockup's typographic minus/plus ("Gen −1" / "Gen +1"). Cosmetic only, not a tested acceptance item.
- I initially added three `family_canvas_union_meta_range/since/year` template keys but ended up composing the connector text with plain JS string interpolation for the numeric year(s) plus a translated status word instead (so tests aren't at the mercy of svelte-i18n's dev-locale fallback, which returns the raw key with no interpolation). I removed the three unused keys from all ten locale files before finishing rather than ship dead translations.
- I found and fixed one real, provable gap in an earlier slice's server code (see below) rather than working around it, since it directly blocks half of my own A7 acceptance item and no other slice depends on `family_union`'s dates staying dropped.

## Concerns — two real, unresolved gaps in the API surface

**1. No endpoint reports the caller's own `view` vs `contribute` level.** `GET /family/me` and `GET /family/clusters` both prove "at least `view`" (403 vs 200), but nothing in the shipped API distinguishes `view` from `contribute` for the *caller themselves* — only the admin-only `GET /family/access` (all grants) carries `level`, and that 403s for a non-admin. A6 explicitly requires the empty-seat affordance to render **only** for a contributor. I resolved this by:

- Giving `FamilyCanvas`/`buildFamilyLayout` a real, fully-tested `canContribute: boolean` prop/parameter (both directions tested, per above).
- At the actual page, passing `canContribute={false}` unconditionally, with an inline comment explaining why, rather than guessing or defaulting to `true` (which would silently show a non-functional "Add a parent" affordance to view-only users too — worse than under-showing it, since slice 10 has no editor behind it yet regardless).
- **Not** modifying the server to add this (unlike the dates gap below) because slice 11 needs the exact same view/contribute signal for its own drop-zone gating ("offers no drop targets to a view-only user" is explicitly one of *its* tests), so it is the natural place for whoever implements it to add a real one — duplicating that decision here felt like the wrong layer to make it. I did not treat this as license to skip it silently: it's called out in an inline code comment at the one call site, and here.

**2. `GET /family/unions` never returned `startDate`/`endDate` at all**, tracing back to the raw SQL in `family.repository.ts`'s `getAllUnionsWithParticipants` never selecting those columns, despite them existing on `family_union` and being fully write-supported (`FamilyUnionCreateDto`/`FamilyUnionUpdateDto`). This directly blocked A7 ("a pill carrying status **and dates**"). Given it's a provable, mechanical omission (not a design decision to relitigate) that only I need for this slice's acceptance criteria, I fixed it end-to-end (repository → service → labels type → DTO → controller → SQL doc → OpenAPI spec → TS SDK) rather than shipping a status-only pill. Full server test suite (6190 tests) and `tsc --noEmit` both stayed green after the change.

## Residual verification gap

I could not run `mise sql` to regenerate `server/src/queries/family.repository.sql` against a real Postgres instance — it requires a live DB connection and, per prior session notes, can silently **delete all query doc files** if misconfigured; the only Postgres containers running in this environment belong to other concurrent sessions/e2e stacks I did not want to disturb. I hand-edited the one affected block to match the new query exactly (two new selected columns, same style as the rest of the file), but this is unverified against the actual `sql-formatter` output. Recommend a maintainer run `mise sql` once from a clean dev DB to confirm it round-trips to the same content.

I also did not execute the e2e a11y test I added (`reskin-visual.e2e-spec.ts`) live — it type-checks cleanly, and I mirrored the existing `resetAdminConfig`-style `getConfigDefaults` + `updateConfig` pattern already used elsewhere in `e2e/src/utils.ts`, but the actual Playwright run against the family page (including its axe-core scan) has not been observed passing.

## One process note

Early on I ran `pnpm build` once against the *shared* `/Users/pierre/dev/gallery` checkout by mistake (a stray absolute path in one command) before switching to running everything inside this worktree. That only populated `server/dist/` there (gitignored build output) — no source files or git state in the shared checkout were touched — but flagging it for transparency.
