# Asset Viewer Contextual Filters — Slice 7 (the DetailPanel grammar) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**This is the feature the whole branch was built for.** Slices 1–6 are the foundation: the server can filter by every dimension the panel exposes, the URL is the source of truth on every surface, and every filter renders a removable chip. Slice 7 turns the asset viewer's metadata into a **filter grammar**:

> **Primary — click a value → filter the current context. Secondary — icons → today's action.**

Click the camera inside a Space → the viewer closes, you land on that Space's timeline filtered to that camera, with a removable chip. Click 🔍 instead → the same filter, but across the whole library.

**Spec:** `docs/superpowers/specs/2026-07-12-asset-viewer-contextual-filters-design.md` — §5.4 (`applyContextualFilter`), §5.5 (per-row patches), §5.6 (merge semantics + **P1**), §6 (the grammar table + the three exceptions), §8 (E2, E4, E5, E6, E7, E8, E14, E24, E25).

**Component path is `DetailPanel.svelte` (PascalCase)** — the spec's `detail-panel.svelte` is wrong.

---

## Reality check — seven things about the live code

Verified against the working tree. Read before writing any code.

### R1 — `applyContextualFilter` DOES NOT EXIST. This slice writes it.

Only the pure builder `buildContextualFilterUrl(url, patch, opts?)` shipped (Slice 2). A repo-wide grep for `applyContextualFilter` returns **zero code hits** — the three matches are prose in the spec and the 5b plan. Task 1 writes the navigating wrapper and its tests.

### R2 — The camera anchor bundles make+model into ONE link. Keep it that way.

`DetailPanel.svelte:224-234` is a **single** `<a>` whose href carries both `make` and `model`. Do **not** split it into two buttons: Slice 6's review found that `model` **without** `make` is a filter with **no UI at all** — every builder forwards it, `getActiveFilterCount` counts it, and no chip renders. A make-only or model-only click would create a silently-applied, unremovable filter. **The camera row emits `{ make, model }` together** (which is what §5.5 says anyway). Lens is its own row and its own patch.

### R3 — Location and Date are each ONE BIG `<button>`. They must be dismantled, not nested into.

- `DetailPanelLocation.svelte:34` — a single `<button>` wrapping the pin, **all three value lines** (city `:47`, state `:51`, country `:56`) **and the pencil** (a bare `<Icon>`, `:62-66`). Three buttons inside a button is invalid HTML, so the outer button must go and the pencil must become a real button.
- `DetailPanelDate.svelte:39` — same shape: the whole row is a `<button>` meaning "edit date".

⚠️ **`DetailPanelLocation` has TWO branches, and the second one is a live, untested feature.**

- `:33` `{#if asset.exifInfo?.country}` → the value row.
- `:68-83` `{:else if !asset.exifInfo?.city && isOwner}` → the **"Add a location"** button (`add_a_location`) — the **only** entry point to the geo picker for an asset with no GPS. It carries the **same** `data-testid="detail-panel-location"` (`:74`), and it has **zero** coverage.

**Do NOT write a test that says "no country ⇒ no `detail-panel-location`".** It would be red today, and an implementer would "fix" it by deleting the add-a-location branch — silently removing the feature. Pin **all three** cases instead: (a) country set → value row; (b) owner, no city, no country → the add-a-location button still renders; (c) city but **no** country → nothing renders (the genuinely dead case).

⚠️ `DetailPanelDate.svelte:23` **re-derives `isOwner` locally** instead of taking the prop the other children take. Unify it (take the prop) while you are in there.

### R4 — E2 is a LIVE LEAK today, not just a rule to honour

Shared links currently suppress **tags, people, rating, albums** — but **NOT** camera, lens, location, date or filename. The camera/lens `Route.search(...)` anchors are therefore already served to anonymous shared-link visitors. Every affordance this slice adds must be gated, and the two existing anchors must be gated too.

The gate: `authManager.isSharedLink` (`auth-manager.svelte.ts:18`, route-derived). Thread a single `canFilter = $derived(!authManager.isSharedLink)` from `DetailPanel.svelte` down to the children, exactly as `isOwner` is already threaded.

⚠️ On a shared link `authManager.user` **throws** if touched (`auth-manager.svelte.ts:28-31`). Never read `authManager.user.id` without the `authenticated` guard — `isOwner` (`DetailPanel.svelte:49`) already does this correctly; copy it, don't reinvent it.

### R5 — The existing DetailPanel spec MOCKS OUT the children this slice rewrites

`detail-panel.spec.ts:87-110` replaces `DetailPanelDate`, `DetailPanelDescription`, `DetailPanelLocation`, `DetailPanelStarRating` and `DetailPanelTags` with **noop components**. So a test written there **cannot see** the rows those children own. Either unmock them, or (preferred) write **per-child spec files**. Note `DetailPanelLocation` has **no spec file at all** today.

### R6 — Three rows are hostile to "click the value". The spec's icon exceptions are right.

| Row                  | Why the value can't be the filter                                                                                   | Filter via |
| -------------------- | ------------------------------------------------------------------------------------------------------------------- | ---------- |
| **Rating**           | the stars **are** the editing control — a star click already means "set rating to N"                                | ⚗️ icon    |
| **Description**      | for the owner it's a focusable `<Textarea>`; clicking places the caret                                              | ⚗️ icon    |
| **Appears-in album** | the **whole card** is an `<a>` to the album (`DetailPanel.svelte:357`); a nested button inside an anchor is invalid | ⚗️ icon    |

Two more shapes to respect:

- **Tags** (`DetailPanelTags.svelte:49-58`) — the chip is already a `<Badge>` (owner-only close ✕) wrapping a `<Link>` to `/tags`. **Repoint the existing `<Link>`**; do not add a third control.
- **People** (`DetailPanelPeople.svelte:117-126`) — the chip is an `<a>` to the person page **plus** face-highlight handlers (`onfocus`/`onblur`/`onpointerenter`/`onpointerleave`). Whatever you do, **preserve those handlers** — they drive the face overlay.

### R8 — ⚠️ THE SPEC IS WRONG ABOUT THE PERSON PATCH. Following §5.5/E4 literally **400s the Space timeline**.

§5.5 and E4 both say the person patch carries the **scoped token** (`space-person:<id>`). On a Space that is a **hard error**, not merely wrong results:

- `web/src/lib/utils/space-filter-options.ts:8-10` — the space builder sends `FilterState.personIds` as **`spacePersonIds`**, not `personIds`.
- `server/src/dtos/time-bucket.dto.ts:53-56` — **`spacePersonIds: z.array(z.uuidv4())` — bare uuid ONLY.** (`personIds` at `:49-52` is the only field that accepts `ScopedPersonTokenSchema`.)
- So `people=space-person:<uuid>` on `/spaces/{id}` → `spacePersonIds: ['space-person:<uuid>']` → **zod rejects → 400 → the Space timeline errors out.** Same for the space map and space search.
- What the space page actually stores today is the **bare space-person uuid** (`spaces/…/+page.svelte:286-289`, `:542-545`).

Second half: **`getPhotosPersonFilterId` cannot produce a scoped token from an asset-viewer person.** `mapPerson` (`server/src/dtos/person.dto.ts:294-307`) sets neither `filterId` nor `primaryProfile`; the asset path only adds `spacePersonId` (`server/src/services/asset.service.ts:198`). So it falls through to `person.id` — the **owner's** person uuid — which on `/photos` a viewer of a shared-space asset cannot see → **empty result → P1 violated on the very row P1 exists to protect.**

**The person patch is therefore a function of the resolved `FilterTarget`:**

| Target                                                            | `personIds` value                                                                    |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `space`, or `map` **with** a `spaceId`                            | **bare** `person.spacePersonId`. If it is missing, **do not render the affordance.** |
| `photos`, `album`, `map` without `spaceId`, or `{ global: true }` | `person.spacePersonId ? \`space-person:${person.spacePersonId}\` : person.id`        |

**Do NOT call `getPhotosPersonFilterId` on an asset-viewer person** — it is built for the suggestion DTO shape. Tests must assert the **shape per surface** (bare uuid in a Space; scoped token on `/photos`), not "always scoped". **Also correct the spec (§5.5 + E4) as part of this slice.**

### R7 — What is NOT filterable

`FilterState` has **no** field for ISO, exposure, ƒ-number, focal length, megapixels, dimensions or file size. Those rows stay plain text. Do not invent fields for them.

**Albums are not on the DTO** — `DetailPanel.svelte:63-76` fetches them (`getAllAlbums({ assetId })`), returning `[]` on shared links. The album affordance lives inside that `{#await}` block.

---

### R9 — E6/E7: an affordance whose patch is EMPTY is a trap. Gate every row on a non-empty value.

`make: '   '` is truthy at `DetailPanel.svelte:222`, so the row renders a clickable value — but the patch trims to nothing (`filter-url.ts:89-94`), so the click **closes the asset viewer and applies no filter**: you lose your place for nothing. Same for the rating ⚗️ on an **unrated** asset (`rating: 0`/`null` → `parseRating` rejects anything outside 1–5, `filter-url.ts:252-259`) and for a filename with an empty basename (`.jpg`).

**Every affordance renders only when its trimmed patch value is non-empty (and `rating >= 1`).** One test per row.

### R10 — Three existing Playwright/unit tests will go red unless the tasks below account for them

- **`detail-panel-edit-date-button`** sits on the outer `<button>` that Task 4 dismantles (`DetailPanelDate.svelte:39-45`). `e2e/src/specs/web/asset-viewer/detail-panel.e2e-spec.ts:118` **clicks it** to open the date modal and `:171` requires it visible. **The testid must move to the owner-gated pencil `IconButton`.**
- **The tag value must stay a link.** `e2e/src/ui/specs/asset-viewer/stack.e2e-spec.ts:68,81` do `getByTestId('detail-panel-tags').getByRole('link').first()` → `toHaveText('test/1')`. If the tag value becomes a `<button>`, or the new ↗ link renders **before** it, both go red. **Keep the tag value an `<a>`/`<Link>` whose `href` is the contextual-filter URL** (which also gives middle-click / open-in-new-tab for free) and put the ↗ **after** it.
- `detail-panel.spec.ts` noop-mocks Date/Description/Location/StarRating/Tags — but **not `DetailPanelPeople`**, and **`DetailPanelDescription.spec.ts` already exists**.

## Global Constraints

- Run web commands from `web/`. `pnpm test --run "<path>"` (NOT `-- --run`); quote bracketed paths.
- Web lint has **no** `--max-warnings 0` (~641 pre-existing tailwind warnings, exits 0) — required **0 errors**. **Never** `eslint --fix` across the package.
- `svelte/prefer-svelte-reactivity` is a real lint **ERROR** (bare `new URLSearchParams` / plain `Map` in a `.svelte` file) — keep URL surgery in `.ts` utils.
- `pnpm check:typescript` clean. (`check:svelte` is a known local no-op.)
- **i18n keys in `i18n/en.json` ONLY** (repo root — shared by web AND mobile).
- **Docker is UP** — Playwright and e2e can and should be run locally.
- Accessibility: every new click target is a real `<button>` (or `<a>` where it navigates) with an `aria-label`. No `<div onclick>`.
- Prettier 120 cols. No `Co-Authored-By` / `Generated-with` trailers.

---

### Task 1 — `applyContextualFilter`: the navigating wrapper (R1)

**Files:** `web/src/lib/utils/filter-target.ts`, `web/src/lib/utils/__tests__/filter-target.spec.ts`

- [ ] **Step 1 (RED):** tests for

  ```ts
  export function applyContextualFilter(patch: Partial<FilterState>, opts?: { global?: boolean }): void;
  ```

  - it `goto()`s the URL that `buildContextualFilterUrl(page.url, patch, opts)` returns — assert the exact `goto` argument, not just "was called".
  - `{ global: true }` lands on `/photos` and carries **nothing** over (no `q`, no `sort`, no existing filters).
  - it navigates to the target's **base path**, so a single `goto()` **closes the asset viewer** (the URL contains no `assetId`).
  - **E24 (idempotency):** applying the same patch twice produces the identical URL — the second click is a **no-op**, it does **not** toggle the filter off.
  - it does **not** throw when `resolveFilterTarget` returns `null` (non-filterable surface → `/photos` fallback).

- [ ] **Step 2 (GREEN):** implement it next to `buildContextualFilterUrl`, using `page` from `$app/state` and `goto` from `$app/navigation`. Keep it a **thin** wrapper — all the interesting logic already lives in the pure builder and is already tested. ⚠️ `no-floating-promises` is enforced: `void goto(...)`.
- [ ] **Step 3:** typecheck, lint, commit.

---

### Task 2 — 7a: Camera + Lens, the 🔍 icon, and the E2 gate

**Files:** `DetailPanel.svelte`, a new `web/src/lib/components/asset-viewer/__tests__/detail-panel-filters.spec.ts` (per R5 — do NOT try to test this through the child-mocking `detail-panel.spec.ts`)

- [ ] **Step 1 (RED):**
  - clicking the **camera value** emits `{ make, model }` **together** (R2) and `goto`s the current surface's base path with `make=` and `model=` in the query. Test on `/photos`, inside a **Space**, on an **album**, and on the **map** (the four `FilterTarget` kinds).
  - clicking the **lens value** emits `{ lensModel }`.
  - the **🔍 icon** applies the same patch with `{ global: true }` → lands on `/photos`, carrying nothing over.
  - **E5:** the 🔍 icon is **hidden when the current target is already `/photos`** (it would be a no-op there).
  - **E2:** on a **shared link**, neither the camera nor the lens renders any filter affordance — and the old `Route.search(...)` anchors are gone too (they leak today, R4).
  - **P1:** the emitted patch, applied to the asset's own metadata, still matches that asset (see Task 6 for the property test that generalises this).
- [ ] **Step 2 (GREEN):** replace the two `Route.search(...)` anchors (`DetailPanel.svelte:224-234` camera, `:256-266` lens) with a value `<button>` + a 🔍 `IconButton`. Thread `canFilter` (R4). Keep the existing `data-testid`s (`detail-panel-camera`, `detail-panel-lens`).
- [ ] **Step 3:** new i18n keys in `i18n/en.json` only (e.g. a "filter by this camera" aria-label and a "search everywhere" label). Typecheck, lint, full web suite, commit.

---

### Task 3 — 7b: Location (E8, E10)

**Files:** `DetailPanelLocation.svelte`, new `DetailPanelLocation.spec.ts` (none exists — R5)

- [ ] **Step 1 (RED):** three clickable value lines with the §5.5 patches:
  - **city** → `{ city, country }` (country included to disambiguate same-named cities)
  - **state** → `{ state, country }`
  - **country** → `{ country }`
  - a **🗺️ pin** icon → the map, **carrying the current context** (E10). Reuse `Route.map({ spaceId?, filters })` (shipped in Slice 4).
    ⚠️ **E10 only specifies the Space case — decide the others and test them.** From a **space** asset → `Route.map({ spaceId, filters })`. From `/photos` or the map → the global map with the filters. From an **album**: there is **no album-map URL** (`AlbumMap` is a modal), so a pin would land on the **global** map carrying the album's filters but **not its scope** — a silent widening. Either drop the pin on the album surface or document the widening explicitly; **do not ship it unnoticed.**
  - an **owner-gated ✏️** that still opens the geo picker (today's behavior).
  - **non-owner:** sees the three clickable values and the pin, but **no pencil** — and, critically, the row is **no longer an inert focusable `<button>`** (today a non-owner gets `onclick={undefined}` on the whole row).
  - **E2:** shared link → no filter affordances at all.
  - the row still renders **only when `country` is set** (R3) — pin that as a test so nobody "fixes" it by accident.
- [ ] **Step 2 (GREEN):** dismantle the outer `<button>` (R3). Three value buttons + a pin `IconButton` + an owner-gated pencil `IconButton`. Keep `data-testid="detail-panel-location"` on the container.
- [ ] **Step 3:** typecheck, lint, full web suite, commit.

---

### Task 4 — 7c: Date + Filename (E14)

**Files:** `DetailPanelDate.svelte`, `DetailPanel.svelte` (filename row), specs

- [ ] **Step 1 (RED):**
  - **Date:** clicking the date value emits `{ dateAfter: D, dateBefore: D }` where **`D` is the date the row actually DISPLAYS** (**E14**).
    ⚠️ **Not `asset.localDateTime`.** The row renders `dateTime`, which **prefers** `exifInfo.dateTimeOriginal` + `exifInfo.timeZone` and only falls back to `localDateTime` (`DetailPanelDate.svelte:17-22`). Derive `D` from that **same** `dateTime` (`dateTime.toISODate()`), or a click can filter a **different day than the one on screen**.
    ⚠️ **A "straddles a day boundary" fixture is NOT sufficient on its own** — `localDateTime` is already a naive local wall-clock stamped `Z`, so a wrong implementation that re-parses it as UTC produces the _same_ string and the test passes vacuously. Pin this exact fixture: `dateTimeOriginal: '2026-01-01T01:00:00+13:00'`, `timeZone: 'Pacific/Auckland'`, `fileCreatedAt: '2025-12-31T12:00:00Z'` → expected `from=to=2026-01-01`. Any UTC re-bucketing yields `2025-12-31` and the test fails.
  - The ✏️ still opens the change-date modal, still owner-gated.
  - Dismantle the outer `<button>` (R3) and make `DetailPanelDate` take `isOwner` as a **prop** instead of re-deriving it (R3).
  - **Filename:** clicking the filename emits `{ originalFileName: <basename WITHOUT extension> }` — this is what surfaces RAW/JPEG pairs and edited variants. Test `IMG_1234.jpg` → `IMG_1234`, and a name with **multiple dots** (`my.photo.v2.jpg` → `my.photo.v2`), and one with **no** extension.
  - Only the filename **text** becomes the trigger — the path-toggle `IconButton` sits inside the same `<p>` and must keep working (R6/9).
  - **E2:** shared link → no filter affordance on either row.
- [ ] **Step 2 (GREEN):** implement. Keep `data-testid="detail-panel-filename"`.
- [ ] **Step 3:** typecheck, lint, full web suite, commit.

---

### Task 5 — 7d: Tags, People, Shared-by, and the three inverted rows (E4, E25)

**Files:** `DetailPanelTags.svelte`, `DetailPanelPeople.svelte`, `DetailPanel.svelte` (shared-by + appears-in), `DetailPanelStarRating.svelte`, `DetailPanelDescription.svelte`, specs

- [ ] **Step 1 (RED) — the value rows:**
  - **Tag chip** → `{ tagIds: [tag.id] }`. **E25: the array is REPLACED, never appended.** Repoint the existing `<Link>` (R6); the owner-only close ✕ must still work. Add a ↗ affordance for the old `/tags/{path}` navigation.
  - **Person chip** → the patch is **target-dependent — see R8, and do NOT use `getPhotosPersonFilterId`.** In a Space (or the space map): **bare** `person.spacePersonId` (a scoped token would 400 the timeline); elsewhere: `space-person:<spacePersonId>` if the asset is a space asset, else `person.id`. Assert the **shape per surface**. If a Space person has no `spacePersonId`, **do not render the affordance**.
    **Structure (nesting hazard):** the chip **is** an `<a>` carrying the four face-highlight handlers (`DetailPanelPeople.svelte:117-126`). A ↗ "person page" link **cannot** live inside it. Use a relative wrapper `<div>` holding the filter `<a>` (handlers stay on it) with the ↗ as a **sibling** overlay control.
  - **E25 again:** clicking a second tag/person **replaces** the array. This is not cosmetic — the server treats `personIds` as AND and `tagIds` as OR, so appending would make two adjacent rows of the same panel move the result set in **opposite** directions.
  - **Shared by** → `{ ownerId: asset.owner.id }`. It is plain text today with zero interactivity; make the name a button. (Only renders when `currentAlbum` has `albumUsers`.)
- [ ] **Step 2 (RED) — the three inverted rows (R6):** the value keeps today's behavior; a **⚗️ filter icon** carries the patch.
  - **Rating** ⚗️ → `{ rating: asset.exifInfo.rating }` (server semantics are `>= N`).
  - **Description** ⚗️ → `{ description: <the description text> }`. **No truncation needed** — the codec already clamps to 200 **code points** on both encode and decode (`filter-url.ts:109,178`). Do not re-implement the clamp.
  - **Appears-in album** ⚗️ → `{ albumId: album.id }`. Must live **inside the `{#await albums}` block** (R7) and **beside** the card's `<a>`, never nested inside it.
    **E9 — do NOT offer the ⚗️ for the album you are already in.** On `/albums/A`, an `albumId=A` filter is a lie: `buildAlbumTimelineOptions` deliberately refuses to forward it (`album-filter-options.ts:70-72`) while `getActiveFilterCount` counts it and a chip renders — exactly the honesty violation this branch keeps killing. Hide the ⚗️ when `resolveFilterTarget(page.url)` is `{ kind: 'album', albumId: album.id }` (or `currentAlbum?.id === album.id`). Test it.
- [ ] **Step 3:** **E2** across all of them (shared link → nothing). Note tags/people/rating/albums are **already** shared-link-suppressed, so the new gate is belt-and-braces there — but **shared-by** is not.
- [ ] **Step 4 (GREEN):** implement. Typecheck, lint, full web suite, commit.

---

### Task 6 — P1: the universal property test, and the e2e (Slice 8's first half)

- [ ] **Step 1 — P1 (§5.6).** One property test across **every** filterable row type:

  > After clicking a metadata value on asset **A**, the resulting filter, applied to **A**'s own metadata, still **matches A**.

  ⚠️ **Do NOT write this as "decode the URL and compare to the patch"** — there is no result set client-side, so the naive version collapses to `decode(encode(patch)) === patch`, a **tautology that passes for every bug this test exists to catch** (including R8's 400). Specify the pipeline concretely:
  1. **Run the real pipeline:** `patch` → `buildContextualFilterUrl(surfaceUrl, patch)` → `decodeFilterParams(url)` → **the surface's REAL options builder** (`buildPhotosTimelineOptions` / `buildSpaceTimelineOptions` / `buildAlbumTimelineOptions` / `buildMapTimeBucketOptions`).
  2. **Assert the emitted options against a shared matcher** that mirrors the **server** predicates for the source asset's own DTO: `make` / `model` / `lensModel` / `city` / `state` / `country` / `ownerId` **exact**; `description` / `originalFileName` **substring** (ILIKE); `rating` **`>=`**; `tagIds` **any-of**; `personIds` / `spacePersonIds` **AND**; and `takenAfter <= localDateTime <= takenBefore` **after** running `buildFilterContext` (`filter-panel.ts:201-202` — `dateBefore` is expanded to an exclusive next-day UTC end, which is what makes a date-only `D` match at all).
  3. **Assert the ID SHAPE per surface** — this is the single assertion that catches R8: every value in `spacePersonIds` matches `^<uuid>$`, and every value in `personIds` matches `^(<uuid>|person:<uuid>|space-person:<uuid>)$`.

  Run the table over all four surfaces × every row type (camera, lens, city, state, country, date, filename, tag, person, owner, rating, description, album). **This is the cheapest guard against the whole class of "the filter I clicked hid the photo I clicked it on".**

- [ ] **Step 2 — e2e (Playwright).** The spec's headline scenario, end to end:
  - Inside a Space, open an asset, click the camera value → the **viewer closes**, you land on the **Space** timeline, the URL carries `make=` + `model=`, and a **removable camera chip** is shown.
  - Click 🔍 instead → you land on `/photos`, **not** the Space.
  - Also add the **person-in-a-Space** case — it is the one R8 says would 400 — and assert the timeline does **not** error.
  - **Docker is UP — run it locally.** Playwright web specs run against the **`make e2e` :2285** stack, not the dev :2283 stack. `mise e2e` is interactive (backgrounding it tears the stack down); start compose detached instead, poll `:2285/api/server/ping`, run, then `down`.

- [ ] **Step 3 — correct the spec.** §5.5 and E4 tell implementers to always send the scoped person token, which **400s a Space** (R8). Fix both to the target-dependent rule, and note that `getPhotosPersonFilterId` is for the suggestion DTO shape, not asset-viewer people. Run prettier over `docs/` (CI Docs Build is strict).
- [ ] **Step 4:** full gate; commit.

---

## Done When

- [ ] Clicking any filterable metadata value filters **the surface you are on** (photos / space / album / map) and closes the viewer in one `goto`.
- [ ] 🔍 escapes to `/photos` carrying nothing over, and is **hidden** on `/photos` (E5).
- [ ] **No filter affordance renders on a shared link** — and the two `Route.search(...)` anchors that leak today are gone (E2, R4).
- [ ] Rating / description / appears-in keep their existing primary action; filtering is the ⚗️ icon.
- [ ] Person patches carry the **scoped** token (E4); array patches **replace** (E25).
- [ ] The date patch uses the asset's **local** date (E14); the filename patch is the **basename without extension**.
- [ ] **P1 holds for every row type**: the filtered result set always contains the asset you clicked.
- [ ] Full web suite + Playwright green; typecheck clean; lint 0 errors.
