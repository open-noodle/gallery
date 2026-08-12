# Face cleanup breadcrumb navigation — design

**Date:** 2026-08-02
**Branch:** `feat/face-review-unified` (PR #834)
**Status:** approved, ready for planning

## Problem

The admin Face cleanup console is three levels deep, but only one of its six pages renders a trail back
up. On `/admin/face-cleanup/scan` (Guided cleanup) and `/admin/face-cleanup/people` (Manual review) the
breadcrumb bar shows a single unlinked crumb, so an admin who has drilled into a mode has no way back to
the landing page short of the sidebar entry or the browser Back button.

`/admin/face-cleanup/people/[personId]` already renders the trail we want —
`Face cleanup / Manual review / Aurelia`, each ancestor a link. That page is the target pattern; the rest
of the console should match it.

A second, related defect: two crumbs and two in-page buttons carry a label that does not describe where
they go. `/admin/face-cleanup/[personId]` renders the crumb `Face cleanup` pointing at `/scan`, and the
Resolutions page renders both a crumb and an empty-state button labelled `Face cleanup` that also land on
`/scan`. Label and destination were written independently at each call site and drifted apart.

## Goal

Every page in the console shows a complete, clickable trail to its ancestors, and no label points
somewhere it does not describe.

## Trails

Only the final crumb is unlinked — you are standing on it.

| Route                                   | Trail                                    |
| --------------------------------------- | ---------------------------------------- |
| `/admin/face-cleanup`                   | `Face cleanup`                           |
| `/admin/face-cleanup/scan`              | `Face cleanup › Guided cleanup`          |
| `/admin/face-cleanup/[personId]`        | `Face cleanup › Guided cleanup › <name>` |
| `/admin/face-cleanup/people`            | `Face cleanup › Manual review`           |
| `/admin/face-cleanup/people/[personId]` | `Face cleanup › Manual review › <name>`  |
| `/admin/face-cleanup/resolutions`       | `Face cleanup › Resolutions`             |

`/admin/face-cleanup/declined` is a `redirect(307)` loader with no page component and needs nothing.

Two placements worth stating explicitly:

- **Guided cleanup is named, not repeated.** `/scan` currently titles itself `Face cleanup`, identical to
  the landing page. It becomes `Guided cleanup`, matching its own card on the landing page and mirroring
  the `Manual review` label the sibling mode already uses.
- **Resolutions hangs off the root, not off Guided cleanup.** It is only reachable from `/scan` today, but
  it lists negative verdicts from _both_ engines (`cleanup` and `suggestion` sources), so parenting it
  under the guided mode would misrepresent what it contains. It is a peer of the two modes.

## Design

### The builder

All six pages construct their trail through one module, `web/src/routes/admin/face-cleanup/breadcrumbs.ts`:

```ts
import { Route } from '$lib/route';
import type { BreadcrumbItem } from '@immich/ui';
import type { Translations } from 'svelte-i18n';

// NOT `(key: string) => string`. web/src/app.d.ts augments svelte-i18n so that
// `$t: (id: Translations | MessageObject, options?) => string`, where `Translations` is the key union
// generated from en.json. Under strictFunctionTypes, `$t` is not assignable to a parameter typed over a
// widened `string` — the target's parameter is wider than the source's. That is the exact failure this
// branch's HEAD commit (2f89bc61232, "type i18n keys as Translations so check:svelte passes") fixed
// elsewhere in the console: tsc accepts it, and `pnpm check:svelte` rejects it at every call site.
type Translate = (key: Translations) => string;

export const faceCleanupRootCrumb = (t: Translate): BreadcrumbItem => ({
  title: t('admin.face_cleanup'),
  href: Route.faceCleanup(),
});

export const guidedCrumb = (t: Translate): BreadcrumbItem => ({
  title: t('admin.face_cleanup_mode_guided'),
  href: Route.faceCleanupScan(),
});

export const manualCrumb = (t: Translate): BreadcrumbItem => ({
  title: t('admin.face_cleanup_mode_manual'),
  href: Route.faceCleanupPeople(),
});

/** Root crumb + tail, with the trailing crumb's href stripped — never link the page you are on. */
export const faceCleanupBreadcrumbs = (t: Translate, ...tail: BreadcrumbItem[]): BreadcrumbItem[] => { ... };
```

Two properties carry the design:

**Label and route travel together.** `guidedCrumb` and `manualCrumb` bind each mode's text to its own
route in one place, so the mismatch that exists today — the label `Face cleanup` on an href of `/scan` —
becomes unrepresentable at the call sites.

**The builder strips the last href.** `guidedCrumb($t)` is therefore written identically on `/scan` and on
`/[personId]`, and renders unlinked on the former, linked on the latter. No page decides for itself
whether its own crumb should be a link, so no page can get that wrong.

Stripping is defined as "the returned last item has no `href`", not "delete a property that is there" — a
tail item that never had one (every person-name leaf) passes through unchanged, and the root crumb keeps
its `href` in every trail except the one where it is itself last. The builder returns new objects rather
than mutating its arguments, so `guidedCrumb($t)` is not left href-less for a later caller.

Call sites:

```ts
faceCleanupBreadcrumbs($t); // landing
faceCleanupBreadcrumbs($t, guidedCrumb($t)); // /scan
faceCleanupBreadcrumbs($t, guidedCrumb($t), { title: personName }); // /[personId]
faceCleanupBreadcrumbs($t, manualCrumb($t)); // /people
faceCleanupBreadcrumbs($t, manualCrumb($t), { title: personName }); // /people/[personId]
faceCleanupBreadcrumbs($t, { title: $t('admin.face_cleanup_resolutions_title') }); // /resolutions
```

`AdminPageLayout` → `BreadcrumbActionPage` → `@immich/ui`'s `Breadcrumbs` already renders an item with an
`href` as an `<a>` and one without as plain text. No layout or component change is needed.

### Page title

`/scan`'s loader sets `meta.title` to `admin.face_cleanup`, so its browser tab is indistinguishable from
the landing page's. It becomes `admin.face_cleanup_mode_guided`, matching `/people`, whose loader already
uses `admin.face_cleanup_mode_manual`. `meta.title` continues to drive only the document title
(`web/src/routes/+layout.svelte`) — no page reads it for its breadcrumbs any more.

### The person-name leaf

Both person pages derive the leaf from an async fetch, and they currently guard it differently:

- `people/[personId]/+page.svelte:83` — `metadata?.name?.trim() ? metadata.name : $t('admin.face_cleanup_unnamed')`,
  carrying an explicit comment that "an empty or whitespace-only name must not render as a blank heading".
- `[personId]/+page.svelte:121` — `scanPerson?.personName ?? $t('admin.face_cleanup_review_unnamed')`.

`??` catches only `null`/`undefined`, so a person named `''` or `'   '` gives the guided page a **blank
breadcrumb leaf** and a blank heading — the defect its sibling explicitly guards against. Since this is the
line the breadcrumb change touches anyway, the guided page adopts the trim check. The two fallback keys
resolve to the identical string ("Unnamed cluster") and both stay as they are; consolidating them is a
separate concern.

Before metadata resolves, both pages render the fallback as the leaf and then swap to the real name. That
is pre-existing and accepted — the trail is never empty, and no navigation depends on the leaf, which is
the one crumb that is never a link. It is pinned by test rather than changed.

### In-page back affordances

The two mode pages get breadcrumbs only. They do not get an in-page `← Face cleanup` link: the breadcrumb
bar already answers the need, and a second back affordance directly beneath it is noise.

The person and resolutions pages keep the in-page back affordances they already have, but all three call
sites are corrected to match where they actually lead:

- `/[personId]` — the `←` link above the heading and the "no flagged faces" empty-state button both
  navigate to `/scan`. Both are relabelled from `admin.face_cleanup_review_back` ("Face cleanup") to
  `admin.face_cleanup_mode_guided` ("Guided cleanup").
- `/resolutions` — the empty-state button labelled `admin.face_cleanup_review_back` ("Face cleanup")
  navigates to `/scan`. Now that Resolutions sits under the root, it is retargeted to `Route.faceCleanup()`
  and relabelled `admin.face_cleanup`.

`/people/[personId]`'s back link already reads `Manual review` and needs no change.

**Consequence for the tests.** These relabels deliberately make an in-page link and a breadcrumb crumb
share both an accessible name and an href — that is the point, they lead to the same place — and
`@immich/ui`'s `Button` renders an `<a>` when given `href` (`internal/Button.svelte:165`). So on
`/[personId]` the crumb `admin.face_cleanup_mode_guided` → `/scan` collides with the `←` link above the
heading (unconditionally: that link sits outside every loading and error branch), and on `/resolutions` the
crumb `admin.face_cleanup` → `/admin/face-cleanup` collides with the empty-state button whenever the list
is empty — which is the cheapest fixture a breadcrumb test would use. `getByRole('link', { name })` throws
on multiple matches, so every breadcrumb assertion must be scoped to the trail. See the stub below.

## i18n

**No new keys.** The four labels the breadcrumbs need already exist and are already translated in all nine
fork-maintained locales (`de`, `es`, `fr`, `it`, `nl`, `pl`, `ru`, `zh_Hans`, `zh_Hant`) — verified against
`i18n/*.json`:

| key                              | de                   | fr                    | it                | es                | nl                     | pl                       | ru                | zh_Hans    | zh_Hant    |
| -------------------------------- | -------------------- | --------------------- | ----------------- | ----------------- | ---------------------- | ------------------------ | ----------------- | ---------- | ---------- |
| `face_cleanup`                   | Gesichtsbereinigung  | Nettoyage des visages | Pulizia dei volti | Limpieza de caras | Gezichten opschonen    | Porządkowanie twarzy     | Очистка лиц       | 人脸清理   | 臉孔整理   |
| `face_cleanup_mode_guided`       | Geführte Bereinigung | Nettoyage guidé       | Pulizia guidata   | Limpieza guiada   | Begeleid opschonen     | Porządkowanie prowadzone | Пошаговая очистка | 引导式清理 | 導引式整理 |
| `face_cleanup_mode_manual`       | Manuelle Prüfung     | Examen manuel         | Revisione manuale | Revisión manual   | Handmatige beoordeling | Przegląd ręczny          | Ручная проверка   | 手动审查   | 手動審查   |
| `face_cleanup_resolutions_title` | Entscheidungen       | Décisions             | Decisioni         | Decisiones        | Beslissingen           | Decyzje                  | Решения           | 处理结果   | 處理結果   |

Because nothing new is introduced, the i18n work is a **guard against future regression** rather than a
translation pass. `web/src/lib/i18n/face-cleanup-i18n-coverage.spec.ts` already iterates exactly this set
of nine locales plus `en`; the four breadcrumb labels are added to the presence assertion there, so a later
edit that drops one from a locale fails the suite instead of shipping an untranslated crumb.

**One key is retired.** With all three of its call sites relabelled, `admin.face_cleanup_review_back`
becomes unused. It is present in exactly the 10 fork-maintained locale files and no others, so it is
deleted from all 10 and pinned by **two** guards, which check different things:

- `slice-12-key-audit.spec.ts`'s `REMOVED_KEYS` — walks all of `web/` and `mobile/` asserting no source
  file still **references** it. This is the load-bearing one: a surviving reference renders a raw i18n key
  to a real user. That file's own comment records that later retirements were added to this list
  deliberately, "because this is the existing guard for exactly this class of regression". Keys there are
  fully qualified (`admin.face_cleanup_review_back`), unlike the coverage spec's bare names.
- `face-cleanup-i18n-coverage.spec.ts`'s `REMOVED_KEYS` — asserts no locale file still **carries** it.

Two existing mechanisms catch a missed call site for free, and are worth knowing about rather than
rediscovering:

- `Translations` is `NestedKeys<typeof en>`, so deleting the key from `en.json` turns any surviving
  `$t('admin.face_cleanup_review_back')` into a **compile error** under `check:svelte`.
- `slice-12-key-audit.spec.ts`'s `TOUCHED_FILES` already lists all three files being relabelled
  (`[personId]/+page.svelte`, `people/[personId]/+page.svelte`, `resolutions/+page.svelte`) and asserts
  every `$t('…')` key in them exists in `en.json`.

`fork-string-parity.spec.ts` is unaffected: it classifies a fork string as "in `en.json`, held by at least
one of the nine, held by no upstream-only locale", so a key removed from all 10 simply stops qualifying.
Removing it from only some of the 10 would fail that test — which is the desired behaviour.

## Testing

### Red-first order

Not every test below can be red first, and it matters which are which — four of the six pages are being
fixed, two are being pinned. Written honestly:

1. **`breadcrumbs.spec.ts`** — red: the module does not exist.
2. **`admin-page-layout.stub.svelte`** — infrastructure, no assertions of its own. Landing it is what makes
   any breadcrumb assertion possible; before it, every page test below fails for the uninteresting reason
   that the current stub discards the prop.
3. **The four genuinely-red page tests** — `/scan`, `/[personId]`, `/people`, `/resolutions`. Each fails
   against current code for the reason the page is being changed: no root link at all on the two mode
   pages, a root link pointing at `/scan` on the other two.
4. **`/people/[personId]` is a pure characterization test** — green the moment the stub lands, with **zero**
   production change, because that page already renders the correct three-level trail and already builds it
   from `$t(...)`. It is a regression guard for the pattern the other pages are being moved onto, not a
   driver.
5. **The landing page test is half red** (corrected during execution — it was originally specced as a second
   pure characterization test). Its link-count half is green from the start: the crumb is already an
   unlinked `<span>`. Its text half is red, because pre-change the crumb's title comes from
   `data.meta.title` — which the spec fixture hard-codes as the literal `'Face cleanup'` — and post-change
   it comes from `$t('admin.face_cleanup')`, which the raw-key mock renders as the key. Moving to the
   builder changes the crumb's text source, not its link-ness.
6. **The guided empty-name test** — red: `??` lets `''` through today.
7. **The relabelled back-link tests** — red: both the guided page's `←` link and the resolutions empty-state
   button currently carry a label that names somewhere other than where they go.
8. **The i18n guards** — the removal assertions are red until the key is deleted; the `BREADCRUMB_KEYS`
   presence assertions are green from the start (the keys are already translated) and exist to stay that
   way.

### 1. Builder unit tests — `web/src/routes/admin/face-cleanup/breadcrumbs.spec.ts` (new)

Pure, no rendering. A `t` stub returning its key keeps the assertions on stable identifiers.

- A root-only trail is a single crumb with **no** `href` — the landing page must not link to itself.
- Given a tail, the root crumb **gains** its `href` of `/admin/face-cleanup`.
- The last crumb never carries an `href`, whatever it is — asserted for a mode crumb tail
  (`guidedCrumb`) and a person-name tail alike.
- An intermediate mode crumb **keeps** its `href` — `guidedCrumb` in a person trail still points at
  `/admin/face-cleanup/scan`.
- `guidedCrumb` pairs `admin.face_cleanup_mode_guided` with `Route.faceCleanupScan()`, and `manualCrumb`
  pairs `admin.face_cleanup_mode_manual` with `Route.faceCleanupPeople()` — the pairing that is currently
  crossed on `/[personId]`.

Boundaries:

- A tail item that has no `href` and is last passes through unchanged — stripping must not throw on, or
  invent, a missing property.
- A tail item that has no `href` and is **not** last also passes through unchanged: the builder only ever
  removes an href, never adds one.
- The builder does not mutate its arguments — calling it twice with the same `guidedCrumb($t)` object
  yields a linked crumb both times. Asserted by building a person trail and a mode trail from one shared
  crumb object and checking the first still has its `href`.
- An empty-string leaf title is passed through, not dropped: the fix for a blank name belongs on the page
  that knows what a person is, not in a breadcrumb builder. This is asserted so the two cannot both assume
  the other handles it.

### 2. A layout stub that renders breadcrumbs — `web/src/test-data/mocks/admin-page-layout.stub.svelte` (new)

The six face-cleanup page specs currently stub `AdminPageLayout` with `sidebar.stub.svelte`, which accepts
`children` and `footer` and silently discards `breadcrumbs`. No existing test can therefore see a crumb at
all.

The new stub renders the trail the way `@immich/ui`'s `Breadcrumbs` does — an `<a href>` per item that has
one, plain text otherwise — alongside `children` and `footer`. The six face-cleanup specs move onto it.

It wraps the trail in `data-testid="breadcrumbs"`. This is **required**, not cosmetic: the relabels above
deliberately give an in-page link and a crumb the same accessible name and href, so an unscoped
`getByRole('link', { name: 'admin.face_cleanup' })` throws "found multiple elements" on `/resolutions` with
an empty list, and on `/[personId]` always. Every breadcrumb assertion runs inside
`within(screen.getByTestId('breadcrumbs'))`, which also stops a page test from passing because some
unrelated link on the page happened to match.

The stub deliberately does **not** invent an `aria-label` on the nav: the real `Breadcrumbs` has none, and
a test asserting one would be testing the stub rather than production.

`sidebar.stub.svelte` is left untouched: `user-sidebar.spec.ts` and `GalleryViewer.spec.ts` also import it,
and it is a sidebar stub in those, not a page-layout stub.

### 3. Per-page breadcrumb tests — the six existing `page.spec.ts` files

Each subpage asserts the trail a user can actually click, by role and accessible name, with the resolved
`href`:

- `/scan` — a link named `admin.face_cleanup` → `/admin/face-cleanup`; the leaf
  `admin.face_cleanup_mode_guided` present but **not** a link.
- `/[personId]` — links named `admin.face_cleanup` → `/admin/face-cleanup` and
  `admin.face_cleanup_mode_guided` → `/admin/face-cleanup/scan`; the person's name present, not a link.
- `/people` — a link named `admin.face_cleanup` → `/admin/face-cleanup`; leaf
  `admin.face_cleanup_mode_manual` not a link.
- `/people/[personId]` — the existing trail, now asserted rather than assumed.
- `/resolutions` — a link named **`Face cleanup`** → `/admin/face-cleanup` (not `/scan`); leaf
  **`Resolutions`** not a link.
- landing — its single crumb is present and is **not** a link.

**The six specs do not share one i18n strategy, and the accessible names differ accordingly.** Five mock
`svelte-i18n` so `$t` returns the raw key, giving names like `admin.face_cleanup`.
`resolutions/page.spec.ts` does not: it registers the real `$i18n/en.json` and awaits `waitLocale('en')`
(lines 41-44), so its names are the real English strings — `Face cleanup`, `Resolutions`. Writing raw keys
into that file's assertions yields a test that can never match. It also re-registers a synthetic locale
mid-file (lines 420-443), so any breadcrumb test added there must sit in a block that runs under `en`.

Every query is scoped with `within(screen.getByTestId('breadcrumbs'))` — see the stub above for why that is
mandatory rather than tidy.

Two rules keep these from becoming assertions that cannot fail:

- A "not a link" assertion is written as **"this text is present in the trail, and is not a link"**, never
  as `queryByRole('link', …)` returning null. The latter also passes when the crumb has vanished entirely,
  which is the failure it is supposed to catch.
- Each page test asserts the **full** expected trail — its length and its order — not just that some
  expected link exists. Otherwise `/[personId]` passes with the guided level silently missing, which is one
  of the two defects being fixed.

### 4. Person-name leaf tests — the two `[personId]` page specs

- `/[personId]` — a `personName` of `''` and of `'   '` each render the `admin.face_cleanup_review_unnamed`
  fallback as the leaf, not a blank crumb. Red today: `??` passes both through.
- both person pages — before the metadata fetch resolves, the leaf is the unnamed fallback; after it
  resolves, it is the person's name. Pins the accepted loading behaviour so a later refactor cannot turn
  the transient leaf into an empty crumb or a crash.

### 5. i18n coverage guard — `web/src/lib/i18n/face-cleanup-i18n-coverage.spec.ts` (extended)

- A `BREADCRUMB_KEYS` list — the four labels above — gets its own per-locale presence assertion across
  `en` + the nine. It is kept separate from the file's existing `NEW_KEYS`, which means "introduced by this
  feature"; these four predate it and are being pinned, not added.
- `face_cleanup_review_back` joins the existing `REMOVED_KEYS`, asserting all 10 files have dropped it.

### 6. Retired-key reference guard — `web/src/lib/i18n/slice-12-key-audit.spec.ts` (extended)

`admin.face_cleanup_review_back` joins that file's `REMOVED_KEYS`, which walks `web/` and `mobile/`
asserting nothing references it any more. Fully qualified, matching the entries already there.

## Out of scope

- E2E specs. `face-cleanup.e2e-spec.ts` and `face-review-cross-engine.e2e-spec.ts` navigate by URL and
  assert on page content, not on breadcrumbs or titles; neither needs changing.
- The sidebar `Face cleanup` entry, which already links to the landing page from anywhere.
- Any change to `AdminPageLayout`, `BreadcrumbActionPage`, or `@immich/ui`'s `Breadcrumbs`.

## Files

**New**

- `web/src/routes/admin/face-cleanup/breadcrumbs.ts`
- `web/src/routes/admin/face-cleanup/breadcrumbs.spec.ts`
- `web/src/test-data/mocks/admin-page-layout.stub.svelte`

**Modified**

- `web/src/routes/admin/face-cleanup/+page.svelte`
- `web/src/routes/admin/face-cleanup/scan/+page.svelte`, `scan/+page.ts`
- `web/src/routes/admin/face-cleanup/[personId]/+page.svelte`
- `web/src/routes/admin/face-cleanup/people/+page.svelte`
- `web/src/routes/admin/face-cleanup/people/[personId]/+page.svelte`
- `web/src/routes/admin/face-cleanup/resolutions/+page.svelte`
- the six sibling `page.spec.ts` files
- `web/src/lib/i18n/face-cleanup-i18n-coverage.spec.ts`
- `web/src/lib/i18n/slice-12-key-audit.spec.ts`
- `i18n/{en,de,es,fr,it,nl,pl,ru,zh_Hans,zh_Hant}.json` — delete `admin.face_cleanup_review_back`

`scan/page.spec.ts`'s `makePageData` hard-codes `meta: { title: 'Face cleanup' }`. Nothing breaks — the
page stops reading `meta.title` for its crumbs — but the fixture becomes a stale description of the loader,
so it is updated alongside it.

## Verification

Two local-gate traps apply here and have both bitten this branch before, so the commands are written out
literally:

- `pnpm test -- --run <path>` passes `--` through to vitest, which then **drops the path filter and runs
  the whole suite**. Use `pnpm test --run` with no `--`.
- A glob over a bracketed SvelteKit route — `'src/routes/admin/face-cleanup/**/*.spec.ts'` — matches
  **zero files** and reports a clean pass: `[personId]` is eaten as a glob character class. Pass explicit
  spec paths and check the reported file count.

From `web/`:

```bash
pnpm test --run \
  src/routes/admin/face-cleanup/breadcrumbs.spec.ts \
  src/routes/admin/face-cleanup/page.spec.ts \
  src/routes/admin/face-cleanup/scan/page.spec.ts \
  'src/routes/admin/face-cleanup/[personId]/page.spec.ts' \
  src/routes/admin/face-cleanup/people/page.spec.ts \
  'src/routes/admin/face-cleanup/people/[personId]/page.spec.ts' \
  src/routes/admin/face-cleanup/resolutions/page.spec.ts \
  src/lib/i18n/face-cleanup-i18n-coverage.spec.ts \
  src/lib/i18n/slice-12-key-audit.spec.ts \
  src/lib/i18n/fork-string-parity.spec.ts
```

Expect **10 spec files** to run — a lower count means a path was eaten, not that the work is done.

The last two are not optional. Deleting a key from `en.json` is exactly what `fork-string-parity` derives
its fork-string set from, and `slice-12-key-audit` is what proves no call site was missed; running only the
face-cleanup specs would leave both regressions to CI.

Then the type, lint and format gates (the `make check-web` / `make lint-web` targets in `CLAUDE.md` do not
exist; the root Makefile swallows unknown targets into `dev`):

- `cd web && pnpm check:typescript && pnpm check:svelte && pnpm lint`
- `npx prettier --check` over the touched web files and over `docs/` — CI Docs Build is strict about
  markdown under `docs/`.

`check:svelte` can scan zero files locally while still working in CI; treat it as a push-only gate rather
than proof.
