# Face Cleanup Breadcrumb Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every page of the admin Face cleanup console a clickable breadcrumb trail back to its ancestors, so an admin inside Guided cleanup or Manual review can always click back to the landing page.

**Architecture:** One pure builder module (`web/src/routes/admin/face-cleanup/breadcrumbs.ts`) owns the hierarchy; all six pages call it instead of hand-writing `BreadcrumbItem[]` literals. Each mode crumb binds its label and its route together so the two cannot drift apart, and the builder strips the trailing crumb's `href` so no page has to decide whether to link to itself. Rendering is unchanged — `AdminPageLayout` → `BreadcrumbActionPage` → `@immich/ui`'s `Breadcrumbs` already renders an item with an `href` as an `<a>`.

**Tech Stack:** SvelteKit 2 + Svelte 5 runes, TypeScript (strict), `@immich/ui`, `svelte-i18n`, Vitest 4 + `@testing-library/svelte` + happy-dom.

**Spec:** `docs/superpowers/specs/2026-08-02-face-cleanup-breadcrumb-navigation-design.md`

**Branch:** `feat/face-review-unified` (PR #834). Work in the existing worktree `/Users/pierre/dev/gallery/.claude/worktrees/pr834-rebase`. All commands below assume `cd web` from the repo root unless stated otherwise.

---

## Global Constraints

These apply to **every** task. Read them once, then assume them.

1. **`t` parameters are typed `Translations`, never `string`.** `web/src/app.d.ts` augments `svelte-i18n` so `$t` is `(id: Translations | MessageObject, options?) => string`, where `Translations = NestedKeys<typeof en>`. Under `strictFunctionTypes`, `$t` is **not** assignable to a parameter typed `(key: string) => string`. `tsc` accepts the widened form; `pnpm check:svelte` rejects it at every call site. Commit `2f89bc61232` on this branch exists solely to fix this class of error — do not reintroduce it.

2. **Never run `pnpm test -- --run <path>`.** This pnpm passes `--` through to vitest, which drops the path filter and runs the whole suite. Always `pnpm test --run <path>` with no `--`.

3. **Never glob a bracketed SvelteKit route.** `'src/routes/admin/face-cleanup/**/*.spec.ts'` matches **zero files** and reports a clean pass — `[personId]` is eaten as a glob character class. Always pass explicit spec paths, and always check the reported file count against what you expected.

4. **The six page specs do not share an i18n strategy.** Five mock `svelte-i18n` so `$t` returns the raw key (`admin.face_cleanup`). `resolutions/page.spec.ts` registers the real `$i18n/en.json` (lines 41-44), so its accessible names are the real English strings (`Face cleanup`, `Resolutions`). Each task below states which applies. Using the wrong one produces a test that can never match.

5. **Every breadcrumb query is scoped** with `within(screen.getByTestId('breadcrumbs'))`. The relabels in Task 7 deliberately give an in-page link and a crumb the same accessible name _and_ href, so an unscoped `getByRole('link', { name })` throws "found multiple elements".

6. **No new i18n keys.** All four labels already exist and are already translated in all nine fork locales. One key is _removed_ (Task 8).

7. **Prettier and ESLint are separate CI gates.** Green ESLint does not imply green Prettier. Both are run in Task 10.

8. **Test code is subject to the same zero-warning ESLint gate as production code.** Three rules have already bitten this plan's own test snippets: `unicorn/prefer-string-repeat` (write `' '.repeat(3)`, never a literal `'   '`), `@typescript-eslint/require-await` (do not declare a test callback `async` unless it actually awaits), and `@typescript-eslint/no-unused-vars` with `varsIgnorePattern: '^_$'` (an unused binding must be named exactly `_`). Run `npx eslint --max-warnings 0` from `web/` on every file you touch, including specs.

9. **`waitFor` runs its first attempt synchronously.** An assertion placed immediately after `render` is evaluated against the pre-fetch state, so any test asserting a post-fetch value must first await something that only appears once the fetch resolves. Several assertions in this plan would otherwise pass whether or not the fix exists. Where a step says to await a specific element before asserting, that line is load-bearing — do not remove it as redundant.

10. **Do not add `Co-Authored-By` or `Generated-with` trailers to any commit.**

---

## File Structure

**New files**

| File                                                    | Responsibility                                                                        |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `web/src/routes/admin/face-cleanup/breadcrumbs.ts`      | The only place the console's page hierarchy is written down. Pure, no Svelte, no DOM. |
| `web/src/routes/admin/face-cleanup/breadcrumbs.spec.ts` | Unit tests for the builder.                                                           |
| `web/src/test-data/mocks/admin-page-layout.stub.svelte` | Test double for `AdminPageLayout` that actually renders the `breadcrumbs` prop.       |

**Modified files**

| File                                                    | Change                                                      |
| ------------------------------------------------------- | ----------------------------------------------------------- |
| `admin/face-cleanup/+page.svelte`                       | Landing — use the builder.                                  |
| `admin/face-cleanup/scan/+page.svelte`, `scan/+page.ts` | Guided — builder + `meta.title`.                            |
| `admin/face-cleanup/[personId]/+page.svelte`            | Guided person — builder, name guard, two relabels.          |
| `admin/face-cleanup/people/+page.svelte`                | Manual — use the builder.                                   |
| `admin/face-cleanup/people/[personId]/+page.svelte`     | Manual person — use the builder (trail is already correct). |
| `admin/face-cleanup/resolutions/+page.svelte`           | Resolutions — builder + empty-state button retarget.        |
| the six sibling `page.spec.ts` files                    | Swap the layout stub; add breadcrumb tests.                 |
| `web/src/lib/i18n/face-cleanup-i18n-coverage.spec.ts`   | Pin the four labels; record the retired key.                |
| `web/src/lib/i18n/slice-12-key-audit.spec.ts`           | Record the retired key (reference guard).                   |
| `i18n/{en,de,es,fr,it,nl,pl,ru,zh_Hans,zh_Hant}.json`   | Delete `admin.face_cleanup_review_back`.                    |

**Task order is deliberate.** Task 1 builds the tool. Task 2 makes breadcrumbs visible to tests at all — without it every page test fails for the uninteresting reason that the current stub discards the prop. Tasks 3-6 take one page each. Tasks 4 and 5 are real fixes with fully red tests. Task 6 adopts an already-correct trail and its test is green throughout. Task 3 is in between — its link-count assertion is green from the start but its text assertion is red, because the landing crumb's text moves from a fixture literal to a translated key (see Task 3's framing note). Task 7 is the guided person page — the largest, with three distinct defects. Task 8 reparents Resolutions and, in doing so, orphans the retired key. Task 9 deletes that key and pins the four labels. Task 10 is the final gate.

---

### Task 1: The breadcrumb builder

**Files:**

- Create: `web/src/routes/admin/face-cleanup/breadcrumbs.ts`
- Test: `web/src/routes/admin/face-cleanup/breadcrumbs.spec.ts`

**Interfaces:**

- Consumes: `Route.faceCleanup()`, `Route.faceCleanupScan()`, `Route.faceCleanupPeople()` from `$lib/route` (all three already exist, `web/src/lib/route.ts:166-168`); `BreadcrumbItem` from `@immich/ui`; `Translations` from `svelte-i18n`.
- Produces:
  - `type Translate = (key: Translations) => string` (not exported; used in the signatures below)
  - `faceCleanupRootCrumb(t: Translate): BreadcrumbItem`
  - `guidedCrumb(t: Translate): BreadcrumbItem`
  - `manualCrumb(t: Translate): BreadcrumbItem`
  - `faceCleanupBreadcrumbs(t: Translate, ...tail: BreadcrumbItem[]): BreadcrumbItem[]`

- [ ] **Step 1: Write the failing test**

Create `web/src/routes/admin/face-cleanup/breadcrumbs.spec.ts`:

Import order matters — `prettier-plugin-organize-imports` puts the `@immich/ui` type import **before**
`vitest`. The order below is the one Prettier settles on; writing `vitest` first fails `prettier --check`.

```ts
import type { BreadcrumbItem } from '@immich/ui';
import { describe, expect, it } from 'vitest';
import { Route } from '$lib/route';
import { faceCleanupBreadcrumbs, faceCleanupRootCrumb, guidedCrumb, manualCrumb } from './breadcrumbs';

// The builder owns the console's page hierarchy. Two invariants carry the design and are asserted directly
// here rather than through six rendered pages: (1) a mode's label and its route are bound together, so the
// label `Face cleanup` can never again point at /scan; (2) the LAST crumb never carries an href, so a page
// cannot link to itself and every page can write its own crumb identically to how an ancestor writes it.

// `$t` is typed over the generated key union, so a test double must be cast rather than declared
// `(key: string) => string` — see the Translations note in breadcrumbs.ts.
const t = ((key: string) => key) as unknown as Parameters<typeof faceCleanupBreadcrumbs>[0];

describe('faceCleanupBreadcrumbs', () => {
  it('gives the landing page a single crumb that is not a link', () => {
    expect(faceCleanupBreadcrumbs(t)).toEqual([{ title: 'admin.face_cleanup' }]);
  });

  it('links the root crumb as soon as there is a tail', () => {
    const trail = faceCleanupBreadcrumbs(t, guidedCrumb(t));

    expect(trail[0]).toEqual({ title: 'admin.face_cleanup', href: Route.faceCleanup() });
  });

  it('strips the href from a trailing mode crumb', () => {
    const trail = faceCleanupBreadcrumbs(t, manualCrumb(t));

    expect(trail).toHaveLength(2);
    expect(trail[1]).toEqual({ title: 'admin.face_cleanup_mode_manual' });
  });

  it('keeps the href on an intermediate mode crumb', () => {
    const trail = faceCleanupBreadcrumbs(t, guidedCrumb(t), { title: 'Aurelia' });

    expect(trail).toEqual([
      { title: 'admin.face_cleanup', href: Route.faceCleanup() },
      { title: 'admin.face_cleanup_mode_guided', href: Route.faceCleanupScan() },
      { title: 'Aurelia' },
    ]);
  });

  it('pairs each mode label with its own route', () => {
    expect(guidedCrumb(t)).toEqual({ title: 'admin.face_cleanup_mode_guided', href: Route.faceCleanupScan() });
    expect(manualCrumb(t)).toEqual({ title: 'admin.face_cleanup_mode_manual', href: Route.faceCleanupPeople() });
    expect(faceCleanupRootCrumb(t)).toEqual({ title: 'admin.face_cleanup', href: Route.faceCleanup() });
  });

  // Boundaries.

  it('passes through a trailing crumb that never had an href', () => {
    const trail = faceCleanupBreadcrumbs(t, { title: 'Aurelia' });

    expect(trail[1]).toEqual({ title: 'Aurelia' });
  });

  it('never adds an href to an intermediate crumb that lacks one', () => {
    const trail = faceCleanupBreadcrumbs(t, { title: 'middle' }, { title: 'leaf' });

    expect(trail[1]).toEqual({ title: 'middle' });
  });

  it('passes an empty leaf title through rather than dropping the crumb', () => {
    // Guarding a blank person name belongs on the page that knows what a person is (see the guided page's
    // trim check), not here. Asserted so the two cannot both assume the other handles it.
    const trail = faceCleanupBreadcrumbs(t, manualCrumb(t), { title: '' });

    expect(trail).toHaveLength(3);
    expect(trail[2]).toEqual({ title: '' });
  });

  it('does not mutate the crumbs it is given', () => {
    const shared: BreadcrumbItem = guidedCrumb(t);

    faceCleanupBreadcrumbs(t, shared); // would strip `shared.href` if it mutated
    const personTrail = faceCleanupBreadcrumbs(t, shared, { title: 'Aurelia' });

    expect(shared.href).toBe(Route.faceCleanupScan());
    expect(personTrail[1].href).toBe(Route.faceCleanupScan());
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd web && pnpm test --run src/routes/admin/face-cleanup/breadcrumbs.spec.ts
```

Expected: FAIL — `Failed to resolve import "./breadcrumbs"`. **1 spec file** reported.

- [ ] **Step 3: Write the implementation**

Create `web/src/routes/admin/face-cleanup/breadcrumbs.ts`:

```ts
import type { BreadcrumbItem } from '@immich/ui';
import type { Translations } from 'svelte-i18n';
import { Route } from '$lib/route';

// The single place the Face cleanup console's page hierarchy is written down. Before this module every page
// hand-wrote its own `BreadcrumbItem[]`, and two of them drifted: `/[personId]` and `/resolutions` both
// rendered the label "Face cleanup" on an href of /scan.
//
// NOT `(key: string) => string`. web/src/app.d.ts augments svelte-i18n so `$t` is
// `(id: Translations | MessageObject, options?) => string`. Under strictFunctionTypes `$t` is not assignable
// to a parameter typed over a widened `string` — tsc accepts it, `pnpm check:svelte` rejects it at every
// call site. See commit 2f89bc61232.
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

/**
 * The root crumb followed by `tail`, with the LAST crumb's href removed — you never link to the page you are
 * standing on.
 *
 * That rule is what lets `guidedCrumb($t)` be written identically on /scan and on /[personId] and still
 * render unlinked on the first and linked on the second. No page decides for itself whether its own crumb
 * should be a link, so no page can get it wrong.
 *
 * Returns new objects; the caller's crumbs are never mutated.
 */
export const faceCleanupBreadcrumbs = (t: Translate, ...tail: BreadcrumbItem[]): BreadcrumbItem[] => {
  const trail = [faceCleanupRootCrumb(t), ...tail];

  return trail.map((crumb, index) => {
    if (index < trail.length - 1) {
      return { ...crumb };
    }
    // Named exactly `_`, not `_dropped`. web/eslint.config.js:106-111 sets
    // `varsIgnorePattern: '^_$'` — an anchored single underscore. `_dropped` fails the
    // zero-warnings lint gate; `_` passes. Verified against the real config.
    const { href: _, ...withoutHref } = crumb;
    return withoutHref;
  });
};
```

> This exact file was written to disk and verified before this plan was published: `pnpm test --run`
> reports **9 passed**, `npx eslint --max-warnings 0` is clean, and `npx prettier --check` is clean. Copy it
> verbatim.

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd web && pnpm test --run src/routes/admin/face-cleanup/breadcrumbs.spec.ts
```

Expected: PASS, **9 tests** in 1 file.

- [ ] **Step 5: Typecheck and lint this file**

```bash
cd web && pnpm check:typescript && npx eslint --max-warnings 0 src/routes/admin/face-cleanup/breadcrumbs.ts src/routes/admin/face-cleanup/breadcrumbs.spec.ts
```

Expected: both clean, with **zero** warnings. `pnpm lint` runs with `--max-warnings 0`, so a warning is a failure. If ESLint reports `'_dropped' is assigned a value but never used`, you copied an earlier draft — the binding must be named exactly `_`.

- [ ] **Step 6: Commit**

```bash
git add web/src/routes/admin/face-cleanup/breadcrumbs.ts web/src/routes/admin/face-cleanup/breadcrumbs.spec.ts
git commit -m "feat(face-cleanup): add a breadcrumb builder that owns the console hierarchy"
```

---

### Task 2: A layout stub that renders breadcrumbs

**Files:**

- Create: `web/src/test-data/mocks/admin-page-layout.stub.svelte`
- Modify: all six `page.spec.ts` files under `web/src/routes/admin/face-cleanup/` (the `vi.mock('$lib/components/layouts/AdminPageLayout.svelte', …)` block in each)

**Interfaces:**

- Consumes: nothing from Task 1.
- Produces: a stub accepting `breadcrumbs: BreadcrumbItem[]`, `children?: Snippet`, `footer?: Snippet`, rendering the trail inside `data-testid="breadcrumbs"`. Every later task queries it via `within(screen.getByTestId('breadcrumbs'))`.

**Why this task exists:** the six specs currently stub `AdminPageLayout` with `@test-data/mocks/sidebar.stub.svelte`, which accepts only `ariaLabel`, `children` and `footer` — it silently discards `breadcrumbs`. No existing test can see a crumb. This task changes no production code and adds no assertions of its own; it is what makes Tasks 3-8 possible.

- [ ] **Step 1: Create the stub**

Create `web/src/test-data/mocks/admin-page-layout.stub.svelte`:

```svelte
<script lang="ts">
  import type { BreadcrumbItem } from '@immich/ui';
  import type { Snippet } from 'svelte';

  // Test double for AdminPageLayout. Unlike sidebar.stub.svelte (which the face-cleanup specs used to share
  // with the sidebar's own tests), this one RENDERS the breadcrumbs prop, mirroring @immich/ui's Breadcrumbs:
  // an item with an href becomes a link, one without becomes plain text.
  //
  // The data-testid is required, not cosmetic. Several face-cleanup pages deliberately carry an in-page back
  // link with the SAME accessible name and href as a crumb — they lead to the same place — so an unscoped
  // getByRole('link', { name }) throws "found multiple elements". Scope every breadcrumb query with
  // `within(screen.getByTestId('breadcrumbs'))`.
  //
  // No aria-label on the nav: the real Breadcrumbs has none, and asserting one would test the stub rather
  // than production.
  interface Props {
    breadcrumbs?: BreadcrumbItem[];
    children?: Snippet;
    // Pages that pin an action bar to the bottom of the content region pass it as AdminPageLayout's `footer`
    // snippet, NOT as part of `children`. The stub has to render it too, or that whole bar — bulk actions,
    // tally, Apply — silently vanishes from the page under test.
    footer?: Snippet;
  }

  let { breadcrumbs = [], children, footer }: Props = $props();
</script>

<nav data-testid="breadcrumbs">
  {#each breadcrumbs as crumb, index (index)}
    {#if crumb.href}
      <a href={crumb.href}>{crumb.title}</a>
    {:else}
      <span>{crumb.title}</span>
    {/if}
  {/each}
</nav>

{@render children?.()}
{@render footer?.()}
```

- [ ] **Step 2: Point all six specs at the new stub**

In each of these six files, replace the import path inside the `AdminPageLayout` mock — `@test-data/mocks/sidebar.stub.svelte` becomes `@test-data/mocks/admin-page-layout.stub.svelte`:

- `web/src/routes/admin/face-cleanup/page.spec.ts`
- `web/src/routes/admin/face-cleanup/scan/page.spec.ts`
- `web/src/routes/admin/face-cleanup/[personId]/page.spec.ts`
- `web/src/routes/admin/face-cleanup/people/page.spec.ts`
- `web/src/routes/admin/face-cleanup/people/[personId]/page.spec.ts`
- `web/src/routes/admin/face-cleanup/resolutions/page.spec.ts`

The block in each currently reads:

```ts
vi.mock('$lib/components/layouts/AdminPageLayout.svelte', async () => {
  const { default: stub } = await import('@test-data/mocks/sidebar.stub.svelte');
  return { default: stub };
});
```

and becomes:

```ts
vi.mock('$lib/components/layouts/AdminPageLayout.svelte', async () => {
  const { default: stub } = await import('@test-data/mocks/admin-page-layout.stub.svelte');
  return { default: stub };
});
```

Leave `web/src/test-data/mocks/sidebar.stub.svelte` untouched — `user-sidebar.spec.ts` and `GalleryViewer.spec.ts` also import it, and it is a genuine sidebar stub in those.

- [ ] **Step 3: Run all six specs to verify nothing regressed**

```bash
cd web && pnpm test --run \
  src/routes/admin/face-cleanup/page.spec.ts \
  src/routes/admin/face-cleanup/scan/page.spec.ts \
  'src/routes/admin/face-cleanup/[personId]/page.spec.ts' \
  src/routes/admin/face-cleanup/people/page.spec.ts \
  'src/routes/admin/face-cleanup/people/[personId]/page.spec.ts' \
  src/routes/admin/face-cleanup/resolutions/page.spec.ts
```

Expected: PASS, **6 spec files** reported. A count below 6 means a bracketed path was eaten — fix the invocation, do not proceed.

The old stub wrapped `children` in `<nav aria-label={ariaLabel}>`; the new one does not wrap them at all. If any test breaks because it relied on that wrapper, fix the test to query the content directly rather than reintroducing the wrapper — the real `AdminPageLayout` puts children inside a `Container`, not a `nav`.

- [ ] **Step 4: Commit**

```bash
git add web/src/test-data/mocks/admin-page-layout.stub.svelte web/src/routes/admin/face-cleanup
git commit -m "test(face-cleanup): render breadcrumbs in the admin page layout stub"
```

---

### Task 3: Landing page — adopt the builder

**Files:**

- Modify: `web/src/routes/admin/face-cleanup/+page.svelte:92`
- Test: `web/src/routes/admin/face-cleanup/page.spec.ts`

**Interfaces:**

- Consumes: `faceCleanupBreadcrumbs` from Task 1.
- Produces: nothing later tasks depend on.

**Honest framing — this test is HALF red, and the two halves fail for different reasons.** Corrected after execution; the original claim that it was "green from the start" was wrong.

- The `queryAllByRole('link')).toHaveLength(0)` half **is** green from the start. The landing page already renders one crumb with no href, so this half is a pure regression guard.
- The `getByText('admin.face_cleanup')` half **is genuinely red**, and not for the reason the other pages are. Pre-change the crumb's title comes from `data.meta.title`, and this spec's fixture hard-codes that as the literal English `'Face cleanup'` (`page.spec.ts:108`). Post-change it comes from `$t('admin.face_cleanup')`, which this file's raw-key mock renders as the key itself. So the crumb text changes from `Face cleanup` to `admin.face_cleanup` purely by moving to the builder.

Expect Step 2 to fail with `Unable to find an element with the text: admin.face_cleanup`, showing `<span>Face cleanup</span>` in the DOM dump. That is correct and expected — do **not** weaken the assertion to `'Face cleanup'` to make it green early. The test as written is the correct post-change assertion.

**i18n:** raw-key mock — accessible names are `admin.face_cleanup`.

- [ ] **Step 1: Write the test**

Add to `web/src/routes/admin/face-cleanup/page.spec.ts`, inside the existing `describe('+page.svelte (face cleanup chooser)', …)` block. `screen` and `render` are already imported there; `within` is **not** — add it to the `@testing-library/svelte` import.

```ts
it('renders a single breadcrumb that does not link to itself', () => {
  render(Page, { props: { data: makePageData() } });

  const trail = within(screen.getByTestId('breadcrumbs'));

  // Present, and NOT a link. Written this way rather than as `queryByRole('link')` returning null, which
  // would also pass if the crumb had vanished entirely — the failure this is meant to catch.
  expect(trail.getByText('admin.face_cleanup')).toBeInTheDocument();
  expect(trail.queryAllByRole('link')).toHaveLength(0);
});
```

If `within` is not in the file's `@testing-library/svelte` import list, add it.

- [ ] **Step 2: Run it — expect a FAIL on the text, not on the link count**

```bash
cd web && pnpm test --run src/routes/admin/face-cleanup/page.spec.ts
```

Expected: **FAIL**, `1 failed | 23 passed (24)`, with:

```
TestingLibraryElementError: Unable to find an element with the text: admin.face_cleanup.
<nav data-testid="breadcrumbs">
  <span>Face cleanup</span>
</nav>
```

The DOM dump is the confirmation you want: the crumb is already a `<span>` and not an `<a>` (so the link-count half of the assertion was always going to pass), and the text is the fixture's literal `'Face cleanup'` rather than the raw key. Step 3 changes the text source, not the link-ness.

- [ ] **Step 3: Move the page onto the builder**

In `web/src/routes/admin/face-cleanup/+page.svelte`, add to the `<script>` imports:

```ts
import { faceCleanupBreadcrumbs } from './breadcrumbs';
```

and change line 92 from:

```svelte
<AdminPageLayout breadcrumbs={[{ title: data.meta.title }]}>
```

to:

```svelte
<AdminPageLayout breadcrumbs={faceCleanupBreadcrumbs($t)}>
```

`$t` is already in scope (the file imports `t` from `svelte-i18n` and uses `$t(...)` throughout). `data.meta.title` keeps driving the document title via `web/src/routes/+layout.svelte` — only the breadcrumb source changes.

- [ ] **Step 4: Run it again**

```bash
cd web && pnpm test --run src/routes/admin/face-cleanup/page.spec.ts
```

Expected: PASS, same count as Step 2. The test now passes for the right reason — the builder, not a coincidence of `meta.title`.

- [ ] **Step 5: Commit**

```bash
git add web/src/routes/admin/face-cleanup/+page.svelte web/src/routes/admin/face-cleanup/page.spec.ts
git commit -m "refactor(face-cleanup): build the landing breadcrumb from the shared builder"
```

---

### Task 4: Guided cleanup page (`/scan`) — add the root link

**Files:**

- Modify: `web/src/routes/admin/face-cleanup/scan/+page.svelte:370`, `web/src/routes/admin/face-cleanup/scan/+page.ts`
- Test: `web/src/routes/admin/face-cleanup/scan/page.spec.ts`

**Interfaces:**

- Consumes: `faceCleanupBreadcrumbs`, `guidedCrumb` from Task 1.
- Produces: nothing later tasks depend on.

**This one is genuinely red.** The page renders `[{ title: data.meta.title }]` — one crumb, no href, no way back.

**i18n:** raw-key mock.

- [ ] **Step 1: Write the failing test**

Add to `web/src/routes/admin/face-cleanup/scan/page.spec.ts` inside the top-level `describe`:

```ts
it('renders a breadcrumb trail back to the face cleanup landing page', () => {
  render(Page, { props: { data: makePageData() } });

  const trail = within(screen.getByTestId('breadcrumbs'));

  // The whole trail, in order — not merely "a link exists somewhere". A partial assertion would pass with
  // the guided level missing, which is half of what this change fixes.
  const root = trail.getByRole('link', { name: 'admin.face_cleanup' });
  expect(root).toHaveAttribute('href', Route.faceCleanup());

  expect(trail.getByText('admin.face_cleanup_mode_guided')).toBeInTheDocument();
  expect(trail.getAllByRole('link')).toHaveLength(1); // the leaf is not a link
});
```

Add `within` to the `@testing-library/svelte` import and `import { Route } from '$lib/route';` if not already present.

- [ ] **Step 2: Run it to verify it fails**

```bash
cd web && pnpm test --run src/routes/admin/face-cleanup/scan/page.spec.ts
```

Expected: FAIL — `Unable to find an accessible element with the role "link" and name "admin.face_cleanup"`. The page renders one unlinked crumb.

- [ ] **Step 3: Implement**

In `web/src/routes/admin/face-cleanup/scan/+page.svelte`, add to the `<script>` imports:

```ts
import { faceCleanupBreadcrumbs, guidedCrumb } from '../breadcrumbs';
```

and change line 370 from:

```svelte
<AdminPageLayout breadcrumbs={[{ title: data.meta.title }]}>
```

to:

```svelte
<AdminPageLayout breadcrumbs={faceCleanupBreadcrumbs($t, guidedCrumb($t))}>
```

In `web/src/routes/admin/face-cleanup/scan/+page.ts`, change the returned title so the browser tab stops being identical to the landing page's — `/people` already does exactly this with its own mode key:

```ts
    meta: {
      title: $t('admin.face_cleanup_mode_guided'),
    },
```

- [ ] **Step 4: Run it to verify it passes**

```bash
cd web && pnpm test --run src/routes/admin/face-cleanup/scan/page.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Refresh the now-stale fixture**

`makePageData` in that spec hard-codes `meta: { title: 'Face cleanup' }` (line ~183). Nothing breaks — the page no longer reads `meta.title` for its crumbs — but the fixture is now a stale description of the loader. Update it to `meta: { title: 'Guided cleanup' }` and re-run Step 4's command to confirm it still passes.

- [ ] **Step 6: Commit**

```bash
git add web/src/routes/admin/face-cleanup/scan
git commit -m "fix(face-cleanup): link the guided page's breadcrumb back to the console"
```

---

### Task 5: Manual review page (`/people`) — add the root link

**Files:**

- Modify: `web/src/routes/admin/face-cleanup/people/+page.svelte:179`
- Test: `web/src/routes/admin/face-cleanup/people/page.spec.ts`

**Interfaces:**

- Consumes: `faceCleanupBreadcrumbs`, `manualCrumb` from Task 1.
- Produces: nothing later tasks depend on.

**Genuinely red.** Renders `[{ title: data.meta.title }]` — the dead end in the reporter's screenshot.

**i18n:** raw-key mock. **Note:** `makePageData` here takes a `users` array — call it as `makePageData(users)`, matching the sibling tests in that file.

- [ ] **Step 1: Write the failing test**

Add to `web/src/routes/admin/face-cleanup/people/page.spec.ts` inside the top-level `describe`:

```ts
it('renders a breadcrumb trail back to the face cleanup landing page', () => {
  render(Page, { props: { data: makePageData([makeUser('u1', 'Alice')]) } });

  const trail = within(screen.getByTestId('breadcrumbs'));

  const root = trail.getByRole('link', { name: 'admin.face_cleanup' });
  expect(root).toHaveAttribute('href', Route.faceCleanup());

  expect(trail.getByText('admin.face_cleanup_mode_manual')).toBeInTheDocument();
  expect(trail.getAllByRole('link')).toHaveLength(1);
});
```

`within` and `Route` are already imported in this file. `makeUser` is its existing factory at line 117 with the signature `makeUser(id: string, name: string)` — hence `makeUser('u1', 'Alice')` above. `makePageData` takes the users array (line 143), unlike the other specs' zero-or-one-arg versions.

- [ ] **Step 2: Run it to verify it fails**

```bash
cd web && pnpm test --run src/routes/admin/face-cleanup/people/page.spec.ts
```

Expected: FAIL — no link named `admin.face_cleanup`.

- [ ] **Step 3: Implement**

In `web/src/routes/admin/face-cleanup/people/+page.svelte`, add to the `<script>` imports:

```ts
import { faceCleanupBreadcrumbs, manualCrumb } from '../breadcrumbs';
```

and change line 179 from:

```svelte
<AdminPageLayout breadcrumbs={[{ title: data.meta.title }]}>
```

to:

```svelte
<AdminPageLayout breadcrumbs={faceCleanupBreadcrumbs($t, manualCrumb($t))}>
```

Leave `people/+page.ts` alone — its `meta.title` is already `admin.face_cleanup_mode_manual`.

- [ ] **Step 4: Run it to verify it passes**

```bash
cd web && pnpm test --run src/routes/admin/face-cleanup/people/page.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/routes/admin/face-cleanup/people/+page.svelte web/src/routes/admin/face-cleanup/people/page.spec.ts
git commit -m "fix(face-cleanup): link the manual review breadcrumb back to the console"
```

---

### Task 6: Manual review person page — adopt the builder

**Files:**

- Modify: `web/src/routes/admin/face-cleanup/people/[personId]/+page.svelte:414-419`
- Test: `web/src/routes/admin/face-cleanup/people/[personId]/page.spec.ts`

**Interfaces:**

- Consumes: `faceCleanupBreadcrumbs`, `manualCrumb` from Task 1.
- Produces: nothing later tasks depend on.

**Honest framing:** like Task 3, this test is **green from the start** — this page already renders the correct three-level trail and is the pattern the other pages are being moved onto. The work is deduplication plus pinning the trail so a future edit cannot quietly break the one page that was right.

**i18n:** raw-key mock. The person name comes from `getFaceRepairPersonMetadata`, so the test must `await waitFor` before asserting the leaf.

- [ ] **Step 1: Write the test**

Add to `web/src/routes/admin/face-cleanup/people/[personId]/page.spec.ts` inside the top-level `describe`:

```ts
it('renders the full breadcrumb trail down to the person', async () => {
  vi.mocked(getFaceRepairPersonMetadata).mockResolvedValue(makeMetadata({ name: 'Aurelia' }));

  render(Page, { props: { data: makePageData() } });

  const trail = () => within(screen.getByTestId('breadcrumbs'));

  await waitFor(() => {
    expect(trail().getByText('Aurelia')).toBeInTheDocument();
  });

  expect(trail().getByRole('link', { name: 'admin.face_cleanup' })).toHaveAttribute('href', Route.faceCleanup());
  expect(trail().getByRole('link', { name: 'admin.face_cleanup_mode_manual' })).toHaveAttribute(
    'href',
    Route.faceCleanupPeople(),
  );
  // Two links and an unlinked leaf — the leaf must never be clickable.
  expect(trail().getAllByRole('link')).toHaveLength(2);
});

it('shows the unnamed fallback in the trail until metadata resolves', async () => {
  vi.mocked(getFaceRepairPersonMetadata).mockResolvedValue(makeMetadata({ name: 'Aurelia' }));

  render(Page, { props: { data: makePageData() } });

  // Accepted pre-existing behaviour: the leaf is the fallback before the fetch resolves, never blank.
  expect(within(screen.getByTestId('breadcrumbs')).getByText('admin.face_cleanup_unnamed')).toBeInTheDocument();

  await waitFor(() => {
    expect(within(screen.getByTestId('breadcrumbs')).getByText('Aurelia')).toBeInTheDocument();
  });
});
```

`within`, `waitFor`, `Route`, `getFaceRepairPersonMetadata` and `makeMetadata` are all already imported/defined in this file.

- [ ] **Step 2: Run to confirm both pass**

```bash
cd web && pnpm test --run 'src/routes/admin/face-cleanup/people/[personId]/page.spec.ts'
```

Expected: PASS, **1 spec file**. If it reports 0 files, the bracketed path was eaten — quote it.

- [ ] **Step 3: Move the page onto the builder**

In `web/src/routes/admin/face-cleanup/people/[personId]/+page.svelte`, add to the `<script>` imports:

```ts
import { faceCleanupBreadcrumbs, manualCrumb } from '../../breadcrumbs';
```

and replace lines 414-419:

```svelte
<AdminPageLayout
  breadcrumbs={[
    { title: $t('admin.face_cleanup'), href: Route.faceCleanup() },
    { title: $t('admin.face_cleanup_mode_manual'), href: Route.faceCleanupPeople() },
    { title: personName },
  ]}
>
```

with:

```svelte
<AdminPageLayout breadcrumbs={faceCleanupBreadcrumbs($t, manualCrumb($t), { title: personName })}>
```

Do **not** remove the `Route` import — the page still uses it for the in-page back link.

- [ ] **Step 4: Run again**

```bash
cd web && pnpm test --run 'src/routes/admin/face-cleanup/people/[personId]/page.spec.ts'
```

Expected: PASS, unchanged.

- [ ] **Step 5: Commit**

```bash
git add 'web/src/routes/admin/face-cleanup/people/[personId]'
git commit -m "refactor(face-cleanup): build the manual review trail from the shared builder"
```

---

### Task 7: Guided review person page — fix the crossed crumb, the blank name, and the labels

**Files:**

- Modify: `web/src/routes/admin/face-cleanup/[personId]/+page.svelte` — lines 121, 518-520, 528, 581
- Test: `web/src/routes/admin/face-cleanup/[personId]/page.spec.ts`

**Interfaces:**

- Consumes: `faceCleanupBreadcrumbs`, `guidedCrumb` from Task 1.
- Produces: nothing later tasks depend on. **Task 8 depends on this task having relabelled lines 528 and 581** — it deletes the key those lines use.

This is the largest task: three distinct defects on one page.

1. **Crossed crumb** — line 519 renders the label `admin.face_cleanup` on an href of `/scan`, and the guided level is missing entirely.
2. **Blank leaf** — line 121 uses `scanPerson?.personName ?? $t(…)`. `??` catches only `null`/`undefined`, so a person named `''` or `'   '` renders a blank crumb and a blank heading. Its sibling at `people/[personId]/+page.svelte:83` uses a `.trim()` check carrying an explicit comment that this must not happen.
3. **Mislabelled back links** — lines 528 and 581 both navigate to `/scan` but are labelled `admin.face_cleanup_review_back` ("Face cleanup"). Now that the level is called Guided cleanup, they read `admin.face_cleanup_mode_guided`.

**i18n:** raw-key mock. `personName` comes from `getLatestScan()` → `scan.persons.find(...)`, so use `makeCompletedScan([makeScanPerson({ personName: … })])` and `await waitFor`.

- [ ] **Step 1: Write the failing tests**

Add to `web/src/routes/admin/face-cleanup/[personId]/page.spec.ts` inside the top-level `describe`:

```ts
it('renders a three-level breadcrumb trail with a working root and guided link', async () => {
  vi.mocked(getLatestScan).mockResolvedValue(
    makeCompletedScan([makeScanPerson({ personName: 'Aurelia' })]) as unknown as object,
  );

  render(Page, { props: { data: makePageData() } });

  const trail = () => within(screen.getByTestId('breadcrumbs'));

  await waitFor(() => {
    expect(trail().getByText('Aurelia')).toBeInTheDocument();
  });

  // The root must go to the landing page — it used to be labelled "Face cleanup" while pointing at /scan.
  expect(trail().getByRole('link', { name: 'admin.face_cleanup' })).toHaveAttribute('href', Route.faceCleanup());
  // The guided level used to be missing from this trail entirely.
  expect(trail().getByRole('link', { name: 'admin.face_cleanup_mode_guided' })).toHaveAttribute(
    'href',
    Route.faceCleanupScan(),
  );
  expect(trail().getAllByRole('link')).toHaveLength(2);
});

it.each([
  ['an empty name', ''],
  // `' '.repeat(3)`, not a literal '   ' — eslint's unicorn/prefer-string-repeat errors on repeated
  // whitespace, and `pnpm lint` runs with --max-warnings 0.
  ['a whitespace-only name', ' '.repeat(3)],
])('falls back to the unnamed label for %s rather than a blank crumb', async (_label, personName) => {
  vi.mocked(getLatestScan).mockResolvedValue(makeCompletedScan([makeScanPerson({ personName })]) as unknown as object);

  render(Page, { props: { data: makePageData() } });

  // Wait for the scan to RESOLVE before asserting. `waitFor` runs its first attempt synchronously, so an
  // assertion made straight after `render` is satisfied by the transient pre-resolution fallback (what the
  // loading-state test below pins) and would pass whether or not the name guard exists at all.
  await waitFor(() => expect(screen.getByTestId('flagged-grid')).toBeInTheDocument());

  expect(within(screen.getByTestId('breadcrumbs')).getByText('admin.face_cleanup_review_unnamed')).toBeInTheDocument();
});

it('shows the unnamed fallback in the trail until the scan resolves', async () => {
  vi.mocked(getLatestScan).mockResolvedValue(
    makeCompletedScan([makeScanPerson({ personName: 'Aurelia' })]) as unknown as object,
  );

  render(Page, { props: { data: makePageData() } });

  // Accepted pre-existing behaviour, pinned so a later refactor cannot turn the transient leaf into an
  // empty crumb. Mirrors the sibling assertion on people/[personId].
  expect(within(screen.getByTestId('breadcrumbs')).getByText('admin.face_cleanup_review_unnamed')).toBeInTheDocument();

  await waitFor(() => {
    expect(within(screen.getByTestId('breadcrumbs')).getByText('Aurelia')).toBeInTheDocument();
  });
});
```

`within`, `waitFor`, `getLatestScan`, `makeCompletedScan` and `makeScanPerson` are already imported/defined in this file. **`Route` is not** — add `import { Route } from '$lib/route';`.

**Why the `waitFor(flagged-grid)` line is load-bearing.** Without it these two cases pass whether or not the guard exists, which is worse than having no test. `waitFor` runs its first attempt synchronously; at that instant `scanPerson` is still `null`, so `personName` is already the fallback and the assertion is satisfied before the scan ever resolves. Verified during execution: with the guard reverted to `??`, the corrected tests fail (`2 failed | 84 passed`); with the naive version they passed both before and after the fix, while a DOM probe showed the trail really did render `<span></span>` and `<span>   </span>`.

- [ ] **Step 2: Run to verify they fail**

```bash
cd web && pnpm test --run 'src/routes/admin/face-cleanup/[personId]/page.spec.ts'
```

Expected: **3 failures**, out of the 4 tests just added.

- the trail test fails on the root's href (`/admin/face-cleanup/scan`, expected `/admin/face-cleanup`);
- both `it.each` cases fail — `''` and `'   '` pass straight through `??` and render as an empty crumb.

The fourth (the loading-state test) **passes already** — the fallback is what renders before the scan
resolves today, and this change does not alter that. It is a pin, not a driver.

- [ ] **Step 3: Fix the name guard**

In `web/src/routes/admin/face-cleanup/[personId]/+page.svelte`, change line 121 from:

```ts
const personName = $derived(scanPerson?.personName ?? $t('admin.face_cleanup_review_unnamed'));
```

to:

```ts
// Trim-checked, not `??`: an empty or whitespace-only name must not render as a blank breadcrumb crumb or
// a blank heading. Matches people/[personId]/+page.svelte, which has guarded this since it shipped.
const personName = $derived(
  scanPerson?.personName?.trim() ? scanPerson.personName : $t('admin.face_cleanup_review_unnamed'),
);
```

- [ ] **Step 4: Fix the breadcrumbs**

Add to the `<script>` imports:

```ts
import { faceCleanupBreadcrumbs, guidedCrumb } from '../breadcrumbs';
```

and replace lines 518-520:

```svelte
<AdminPageLayout
  breadcrumbs={[{ title: $t('admin.face_cleanup'), href: Route.faceCleanupScan() }, { title: personName }]}
>
```

with:

```svelte
<AdminPageLayout breadcrumbs={faceCleanupBreadcrumbs($t, guidedCrumb($t), { title: personName })}>
```

- [ ] **Step 5: Relabel both back affordances**

Line 528 (the `←` link above the heading) and line 581 (the "no flagged faces" empty-state button) both navigate to `/scan` via `Route.faceCleanupScan()` and `handleCancel` respectively. Change the label in **both** from:

```svelte
      {$t('admin.face_cleanup_review_back')}
```

to:

```svelte
      {$t('admin.face_cleanup_mode_guided')}
```

Their destinations are already correct and do not change. After this step, `grep -rn "face_cleanup_review_back" web/src` must return only `resolutions/+page.svelte:205` — Task 8 handles that one.

- [ ] **Step 6: Pin the relabelled back link**

The relabel above changes a user-visible navigation label with nothing asserting it. Add a test so a later
edit cannot silently restore "Face cleanup" on a link that goes to Guided cleanup — the exact mismatch this
whole change exists to remove. Scoped **outside** the breadcrumbs so it cannot accidentally assert the crumb:

Note this callback is **not** `async` — the back link renders unconditionally, so there is nothing to await, and an `async` arrow with no `await` errors under `@typescript-eslint/require-await` at `--max-warnings 0`.

```ts
it('labels the in-page back link with where it actually goes', () => {
  vi.mocked(getLatestScan).mockResolvedValue(
    makeCompletedScan([makeScanPerson({ personName: 'Aurelia' })]) as unknown as object,
  );

  render(Page, { props: { data: makePageData() } });

  // Two links share this name and href by design — the crumb and the in-page back link. Exclude the trail
  // and assert on what is left, so this test is about the in-page link specifically.
  const backLinks = screen
    .getAllByRole('link', { name: 'admin.face_cleanup_mode_guided' })
    .filter((link) => !screen.getByTestId('breadcrumbs').contains(link));

  expect(backLinks).toHaveLength(1);
  expect(backLinks[0]).toHaveAttribute('href', Route.faceCleanupScan());
});
```

Run it — it fails before Step 5's relabel and passes after. If Step 5 is already applied, confirm it passes
now and note that it was not observed red.

- [ ] **Step 7: Run to verify all three pass**

```bash
cd web && pnpm test --run 'src/routes/admin/face-cleanup/[personId]/page.spec.ts'
```

Expected: PASS, whole file. Watch for pre-existing tests that asserted on the old back-link text — if one breaks, update its expected string to `admin.face_cleanup_mode_guided`; do not revert the relabel.

- [ ] **Step 8: Commit**

```bash
git add 'web/src/routes/admin/face-cleanup/[personId]'
git commit -m "fix(face-cleanup): give the guided review page a full trail and a non-blank person crumb"
```

---

### Task 8: Resolutions page — reparent under the console root

**Files:**

- Modify: `web/src/routes/admin/face-cleanup/resolutions/+page.svelte:153-158` and `:205`
- Test: `web/src/routes/admin/face-cleanup/resolutions/page.spec.ts`

**Interfaces:**

- Consumes: `faceCleanupBreadcrumbs` from Task 1.
- Produces: after this task, `admin.face_cleanup_review_back` has **zero references in source** — `web/src` and `mobile/lib`, which is what Task 9 relies on. It is still present as data in all ten `i18n/*.json` files; deleting it there is Task 9's job. Those two scopes are not the same thing, so do not read a clean source grep as meaning the locale files are already done.

**Genuinely red.** The crumb is labelled `Face cleanup` and points at `/scan`.

**Placement rationale:** Resolutions lists negative verdicts from _both_ engines (`cleanup` and `suggestion` sources), so it is a peer of the two modes, not a child of Guided cleanup — even though `/scan` is currently the only page linking to it.

> **i18n difference — read this before writing the test.** Unlike the other five specs, `resolutions/page.spec.ts` does **not** mock `svelte-i18n`. It registers the real `$i18n/en.json` and awaits `waitLocale('en')` (lines 41-44), so accessible names are the real English strings. Assert **`Face cleanup`** and **`Resolutions`**, not raw keys. That file also registers a synthetic locale part-way through (lines 420-443) — add the new test _before_ that block so it runs under `en`.

- [ ] **Step 1: Write the failing test**

Add to `web/src/routes/admin/face-cleanup/resolutions/page.spec.ts`, inside the top-level `describe` and above the synthetic-locale block:

```ts
it('renders a breadcrumb trail back to the face cleanup landing page', async () => {
  render(Page, { props: { data: { meta: { title: 'Resolutions' } } } });

  const trail = within(screen.getByTestId('breadcrumbs'));

  // Real en.json is loaded in this file, so these are English strings, not raw keys.
  // The root used to point at /scan; Resolutions is a peer of the two modes, not a child of guided.
  await waitFor(() => {
    expect(trail.getByRole('link', { name: 'Face cleanup' })).toHaveAttribute('href', Route.faceCleanup());
  });

  expect(trail.getByText('Resolutions')).toBeInTheDocument();
  expect(trail.getAllByRole('link')).toHaveLength(1);
});
```

Add `import { Route } from '$lib/route';` to the file if absent. `within` and `waitFor` are already imported.

- [ ] **Step 2: Run it to verify it fails**

```bash
cd web && pnpm test --run src/routes/admin/face-cleanup/resolutions/page.spec.ts
```

Expected: FAIL — the root link's href is `/admin/face-cleanup/scan`, expected `/admin/face-cleanup`.

- [ ] **Step 3: Implement**

Add to the `<script>` imports in `web/src/routes/admin/face-cleanup/resolutions/+page.svelte`:

```ts
import { faceCleanupBreadcrumbs } from '../breadcrumbs';
```

Replace lines 153-158:

```svelte
<AdminPageLayout
  breadcrumbs={[
    { title: $t('admin.face_cleanup'), href: Route.faceCleanupScan() },
    { title: $t('admin.face_cleanup_resolutions_title') },
  ]}
>
```

with:

```svelte
<AdminPageLayout breadcrumbs={faceCleanupBreadcrumbs($t, { title: $t('admin.face_cleanup_resolutions_title') })}>
```

Then retarget the empty-state button at line 205 — it is labelled "Face cleanup" but goes to `/scan`. Change:

```svelte
          <Button color="secondary" href={Route.faceCleanupScan()}>{$t('admin.face_cleanup_review_back')}</Button>
```

to:

```svelte
          <Button color="secondary" href={Route.faceCleanup()}>{$t('admin.face_cleanup')}</Button>
```

- [ ] **Step 4: Run it to verify it passes**

```bash
cd web && pnpm test --run src/routes/admin/face-cleanup/resolutions/page.spec.ts
```

Expected: PASS.

Note the collision this creates on purpose: with an empty resolutions list, the page now has **two** links named `Face cleanup` pointing at `/admin/face-cleanup` — the crumb and the empty-state button. The `within(...)` scoping in Step 1 is what keeps the assertion unambiguous. If a pre-existing test in this file breaks with "found multiple elements", scope it the same way rather than weakening it.

- [ ] **Step 5: Pin the retargeted empty-state button**

Like the guided page's back link, this changes a user-visible navigation target with nothing asserting it.
Add this immediately after the existing `it('shows the empty state when there are no verdicts', …)` at
line 347, whose fixture and empty-state string it deliberately mirrors:

```ts
it('sends the empty-state button to the console landing page', async () => {
  vi.mocked(getFaceRepairResolutions).mockResolvedValue({ total: 0, resolutions: [] } as unknown as Awaited<
    ReturnType<typeof getFaceRepairResolutions>
  >);

  render(Page, { props: { data: { meta: { title: 'Resolutions' } } } });

  // Real en.json is loaded in this file — 'No decisions recorded yet' is the actual value of
  // admin.face_cleanup_resolutions_empty, matching the sibling empty-state test above.
  await waitFor(() => {
    expect(screen.getByText('No decisions recorded yet')).toBeInTheDocument();
  });

  // The button used to point at /scan while being labelled "Face cleanup". Exclude the trail so this is
  // about the button, not the crumb that now shares its name and href.
  const buttons = screen
    .getAllByRole('link', { name: 'Face cleanup' })
    .filter((link) => !screen.getByTestId('breadcrumbs').contains(link));

  expect(buttons).toHaveLength(1);
  expect(buttons[0]).toHaveAttribute('href', Route.faceCleanup());
});
```

This test fails before Step 3's retarget (the button's href is `/admin/face-cleanup/scan`) and passes
after. If Step 3 is already applied, confirm it passes and note it was not observed red.

- [ ] **Step 6: Confirm the key is now orphaned**

```bash
cd /Users/pierre/dev/gallery/.claude/worktrees/pr834-rebase && grep -rn "face_cleanup_review_back" web/src mobile/lib
```

Expected: **no output.** If anything remains, fix that call site before proceeding — Task 9 deletes the key.

- [ ] **Step 7: Commit**

```bash
git add web/src/routes/admin/face-cleanup/resolutions
git commit -m "fix(face-cleanup): hang resolutions off the console root instead of the guided page"
```

---

### Task 9: Retire the orphaned key and pin the breadcrumb labels

**Files:**

- Modify: `i18n/en.json`, `i18n/de.json`, `i18n/es.json`, `i18n/fr.json`, `i18n/it.json`, `i18n/nl.json`, `i18n/pl.json`, `i18n/ru.json`, `i18n/zh_Hans.json`, `i18n/zh_Hant.json`
- Modify: `web/src/lib/i18n/face-cleanup-i18n-coverage.spec.ts`
- Modify: `web/src/lib/i18n/slice-12-key-audit.spec.ts`

**Interfaces:**

- Consumes: Task 7 and Task 8 having removed every reference to `admin.face_cleanup_review_back`.
- Produces: nothing later tasks depend on.

**Two different guards, two different jobs.** `slice-12-key-audit.spec.ts` walks `web/` and `mobile/` asserting nothing **references** the key — that is the regression that renders a raw i18n key at a real user, and it is the load-bearing one. `face-cleanup-i18n-coverage.spec.ts` asserts no locale file still **carries** it. Both get the entry; note their differing conventions — the audit uses fully-qualified names (`admin.face_cleanup_review_back`), the coverage spec uses bare ones (`face_cleanup_review_back`).

**No new translations are needed.** All four breadcrumb labels already exist in all nine fork locales; the additions below are regression guards, not a translation pass.

- [ ] **Step 1: Write the failing guard assertions**

In `web/src/lib/i18n/face-cleanup-i18n-coverage.spec.ts`, add a new list beside the existing `NEW_KEYS` and `REMOVED_KEYS` (keep it separate — `NEW_KEYS` means "introduced by this feature", and these four predate it):

```ts
// The four labels the console's breadcrumb trails are built from (breadcrumbs.ts). Not new — they predate
// the breadcrumb work and were already translated everywhere — but nothing pinned them, so a later edit
// could drop one from a locale and ship an untranslated crumb.
const BREADCRUMB_KEYS = [
  'face_cleanup',
  'face_cleanup_mode_guided',
  'face_cleanup_mode_manual',
  'face_cleanup_resolutions_title',
];
```

and a matching assertion block inside the existing `describe('face cleanup i18n coverage', …)`:

```ts
it.each(['en', ...TRANSLATED])('%s carries every breadcrumb label', (code) => {
  const messages = admin(code);
  const missing = BREADCRUMB_KEYS.filter((key) => !Object.hasOwn(messages, key));

  expect(missing, `${code}.json is missing: ${missing.join(', ')}`).toEqual([]);
});
```

Then add the retired key to that file's existing `REMOVED_KEYS` array (bare name, matching its neighbours):

```ts
  'face_cleanup_review_back',
```

In `web/src/lib/i18n/slice-12-key-audit.spec.ts`, add to its `REMOVED_KEYS` array (fully qualified, matching its neighbours):

```ts
  'admin.face_cleanup_review_back',
```

- [ ] **Step 2: Run to verify the removal assertions fail**

```bash
cd web && pnpm test --run src/lib/i18n/face-cleanup-i18n-coverage.spec.ts src/lib/i18n/slice-12-key-audit.spec.ts
```

Expected — and the three groups behave differently, because the two guards check different things:

- **`face-cleanup-i18n-coverage.spec.ts`'s removal assertion FAILS ×10**, once per locale: `en.json still carries: face_cleanup_review_back`. This is the red that Step 3 turns green.
- **`slice-12-key-audit.spec.ts`'s new entry PASSES immediately.** It guards _references_, walking `web/src` and `mobile/lib` — and Task 8 already removed the last one. It never opens a locale file, so "the key is still in the JSON" is irrelevant to it. It is a regression guard against a future reference, not a driver here. To prove it discriminates, append `face_cleanup_review_back` in a comment to any file under `web/src`, watch it fail, and revert.
- **The `BREADCRUMB_KEYS` presence assertions PASS immediately** — the four labels are already translated everywhere. Also a guard, not a driver. Prove it by deleting one breadcrumb key from one locale, confirming exactly one test fails and names the right locale and key, then restoring.

- [ ] **Step 3: Delete the key from all ten locale files**

The key occupies exactly one line in each of the ten files (verified — `grep -c` returns 1 everywhere, e.g. `i18n/de.json:260`). A line-oriented delete is therefore exact and, unlike re-serialising the JSON, cannot reformat the rest of the file. Do **not** parse-and-rewrite these files: a whole-file reformat buries the one real change in thousands of lines of noise.

Note the BSD `sed` invocation — on macOS `-i` requires an explicit empty backup suffix (`-i ''`); the GNU form (`sed -i`) fails here.

```bash
cd /Users/pierre/dev/gallery/.claude/worktrees/pr834-rebase
for f in en de es fr it nl pl ru zh_Hans zh_Hant; do
  sed -i '' '/"face_cleanup_review_back":/d' "i18n/$f.json"
done
git diff --stat i18n/
```

Expected: **10 files changed, 10 deletions, zero insertions.** Any insertion means something reformatted — `git checkout -- i18n/` and investigate before retrying.

Confirm it is gone everywhere:

```bash
grep -rl '"face_cleanup_review_back"' i18n/ ; echo "exit=$? (1 = found nowhere, which is what we want)"
```

- [ ] **Step 4: Confirm the locale files are still Prettier-clean**

```bash
cd /Users/pierre/dev/gallery/.claude/worktrees/pr834-rebase && npx prettier --check 'i18n/*.json'
```

Expected: "All matched files use Prettier code style!" — a `sed` line-delete leaves formatting untouched, so this passes with no `--write` needed. Verified in advance against `i18n/de.json`. If it reports a problem, the deletion did more than remove one line.

- [ ] **Step 5: Run the four i18n guards**

```bash
cd web && pnpm test --run \
  src/lib/i18n/face-cleanup-i18n-coverage.spec.ts \
  src/lib/i18n/slice-12-key-audit.spec.ts \
  src/lib/i18n/fork-string-parity.spec.ts \
  src/lib/i18n/placeholders.spec.ts
```

Expected: PASS, **4 spec files**.

`fork-string-parity` classifies a fork string as "in `en.json`, held by at least one of the nine, held by no upstream-only locale". Removing the key from all 10 makes it stop qualifying — clean. Removing it from only _some_ would fail this test, which is the desired behaviour and a useful check that Step 3 covered every file.

- [ ] **Step 6: Commit**

```bash
cd /Users/pierre/dev/gallery/.claude/worktrees/pr834-rebase
git add i18n web/src/lib/i18n
git commit -m "i18n(face-cleanup): retire the orphaned back-link string and pin the breadcrumb labels"
```

---

### Task 10: Full gate

**Files:** none modified unless a gate fails.

**Interfaces:** consumes everything above.

- [ ] **Step 1: Run every affected spec, and check the count**

```bash
cd web && pnpm test --run \
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

Expected: PASS, **10 spec files**. A lower count means a bracketed path was eaten — a "green" run of fewer files than you asked for is the worst outcome in this family, because nothing looks wrong. Do not accept it.

- [ ] **Step 2: Run the rest of the web suite for collateral damage**

```bash
cd web && pnpm test --run
```

Expected: PASS. Pay particular attention to `src/lib/components/shared-components/side-bar/user-sidebar.spec.ts` and `src/lib/components/shared-components/gallery-viewer/GalleryViewer.spec.ts` — they share `sidebar.stub.svelte`, which Task 2 deliberately left untouched. If either fails, the stub was edited when it should not have been.

Never accept "it's flaky, re-run it". A failure here is a real defect, usually leaked state between test files.

If a failure looks unrelated to breadcrumbs, **establish a baseline before chasing it**: stash the work
(`git stash`), re-run the same command, and compare. A failure present on the untouched branch is
pre-existing and not yours to fix inside this change — say so explicitly rather than silently absorbing it.
Restore with `git stash pop`.

- [ ] **Step 3: Typecheck, lint, format**

```bash
cd web && pnpm check:typescript && pnpm check:svelte && pnpm lint
```

Expected: all clean. `check:svelte` is the gate that catches a `t` parameter widened to `string` (Global Constraint 1) — if it reports "Argument of type 'string' is not assignable to parameter of type 'Translations'", that is exactly the failure the constraint warns about.

**Run the package scripts, not raw `svelte-check`.** `check:svelte` is `svelte-check --no-tsconfig …`, so it checks `.svelte` files only. A bare `npx svelte-check` (with tsconfig) additionally pulls in `.ts` spec files and reports ~228 **pre-existing** errors on this branch — mostly `Type '{ meta: … }' is not assignable to type 'never'` on `render(Page, { props: { data } })` calls, a pattern every face-cleanup spec already had before this work. That is not the gate and is not caused by this change; do not chase it.

Baseline measured on this branch at Task 8: `pnpm check:svelte` → **591 files, 0 errors, 0 warnings**; `pnpm check:typescript` → **clean**. Both should still read that way at the end of Task 10.

Prettier must be run **from `web/` for web files** and **from the repo root for everything else** — they
are two different Prettier configs. Running a `web/src/...` path from the root dies with
`Cannot find package '@trivago/prettier-plugin-sort-imports' imported from <root>/noop.js`, because the
root config's plugins are not resolvable there. Both invocations below were verified.

```bash
# web files — MUST run from web/
cd /Users/pierre/dev/gallery/.claude/worktrees/pr834-rebase/web
npx prettier --check 'src/routes/admin/face-cleanup/**/*.{ts,svelte}' 'src/test-data/mocks/admin-page-layout.stub.svelte' 'src/lib/i18n/*.ts'

# locale + docs — run from the repo root
cd /Users/pierre/dev/gallery/.claude/worktrees/pr834-rebase
npx prettier --check 'i18n/*.json' 'docs/superpowers/**/*.md'
```

Expected: both clean. ESLint green does not imply Prettier green — they are separate CI gates.

Note the first glob still contains `**` but no bracketed route segment, so it is safe; the zero-match glob
trap (Global Constraint 3) applies to `[personId]`-style paths, and Prettier reports "No files matching the
pattern were found" rather than passing silently.

- [ ] **Step 4: Verify the trails by hand**

The unit tests assert against a stub, not against `@immich/ui`'s real `Breadcrumbs`. Confirm the real thing once, against a running dev stack:

```bash
mise dev   # machine-wide singleton — if it is already running for another worktree, use that
```

Then visit each page as an admin and confirm the trail and that each ancestor navigates:

| URL                                     | Expected trail                           |
| --------------------------------------- | ---------------------------------------- |
| `/admin/face-cleanup`                   | `Face cleanup` (no links)                |
| `/admin/face-cleanup/scan`              | `Face cleanup › Guided cleanup`          |
| `/admin/face-cleanup/people`            | `Face cleanup › Manual review`           |
| `/admin/face-cleanup/people/<personId>` | `Face cleanup › Manual review › <name>`  |
| `/admin/face-cleanup/<personId>`        | `Face cleanup › Guided cleanup › <name>` |
| `/admin/face-cleanup/resolutions`       | `Face cleanup › Resolutions`             |

Also confirm the browser tab on `/scan` now reads "Guided cleanup", distinct from the landing page's "Face cleanup".

- [ ] **Step 5: Push**

```bash
cd /Users/pierre/dev/gallery/.claude/worktrees/pr834-rebase && git push origin feat/face-review-unified
```

This updates PR #834. CI's gating jobs run on `pull_request`, so the push is what actually exercises `check:svelte` and the Docs Build prettier gate.

---

## Notes for the implementer

**What is deliberately NOT in this plan:**

- **No E2E changes.** `face-cleanup.e2e-spec.ts` and `face-review-cross-engine.e2e-spec.ts` navigate by URL and assert `[data-testid="admin-page-header"]` is visible — the container around the breadcrumbs, never their content. Adding breadcrumb E2E coverage would duplicate the unit tests at 100× the runtime.
- **No changes to `AdminPageLayout`, `BreadcrumbActionPage`, or `@immich/ui`'s `Breadcrumbs`.** They already render an item with an `href` as an `<a>`.
- **No in-page `← Face cleanup` link on `/scan` or `/people`.** The breadcrumb bar answers the need; a second back affordance directly beneath it is noise. This was an explicit product decision, not an oversight.
- **No consolidation of `face_cleanup_unnamed` and `face_cleanup_review_unnamed`.** They are separate keys with the identical value ("Unnamed cluster"), one per page. Merging them is a separate concern; do not fold it in.

**Two traps that have already cost time on this branch:**

1. `pnpm test -- --run <path>` runs the whole suite. No `--`.
2. A glob over a bracketed route matches zero files and reports a clean pass. Explicit paths, and always check the count.
