# Space Albums Parity — Slice 8: Reorder the /albums toolbar (upstream consistency)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** Bring the main `/albums` toolbar into the same functional-split order as the space page: move the **Create album** button out of the middle (between Search and Sort) to the **right-hand end** (after the Cover/List view toggle). No behavior change.

**Architecture:** A pure markup move in `web/src/routes/(user)/albums/AlbumsControls.svelte`. The button element (currently lines 130-139, the `<!-- Create Album --> <Button ...>{$t('create_album')}</Button>` block) moves to after the Cover/List toggle `{#if}...{/if}` (currently lines 198-219). Everything else — filter tabs, search, sort, group, expand/collapse — stays. This is the single deliberate upstream edit for this feature.

## Global Constraints

- Spec §3 (Honest cost / Slice 8), §11 (rebase table), Slice 8. Edge case #25: Create renders after the view toggle; existing behavior unchanged (`createAlbumAndRedirect`).
- **Upstream file** — keep the diff MINIMAL (move only; no refactor, no prop/behavior/option change). This is intentional (the one accepted upstream edit).
- New test file is fork-only (won't conflict on rebase).
- Verify: `pnpm test -- --run <file>`, `pnpm check:typescript`, eslint 0. No `Co-Authored-By`. Base: `62becb96ee`.

## File Structure

- Modify `web/src/routes/(user)/albums/AlbumsControls.svelte` (move the Create block only).
- Create `web/src/routes/(user)/albums/AlbumsControls.spec.ts` (DOM-order guard).

---

## Task 1: Move Create to the right + guard the order

**Files:** `AlbumsControls.svelte` (move block); `AlbumsControls.spec.ts` (new).

- [ ] **Step 1: Write the DOM-order test (red).** Render `AlbumsControls` with `{ albumGroups: [], searchQuery: '' }`. Assert the "Create album" button (`$t('create_album')` → "Create album") appears AFTER the view-toggle button ("List"/"Covers") in document order. Use `renderWithTooltips` from `$tests/helpers` (or `TestWrapper`) if the `@immich/ui` `Button`/`IconButton` need Tooltip context. Order check via `compareDocumentPosition`:

```ts
import { render, screen } from '@testing-library/svelte';
import { renderWithTooltips } from '$tests/helpers';
import AlbumsControls from './AlbumsControls.svelte';

it('renders Create album after the Cover/List view toggle', () => {
  renderWithTooltips(AlbumsControls, { albumGroups: [], searchQuery: '' });
  const create = screen.getByText('Create album').closest('button')!;
  const toggle = screen.getByText(/^(List|Covers)$/).closest('button')!;
  // create must come AFTER toggle in DOM order
  expect(toggle.compareDocumentPosition(create) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});
```

If `AlbumsControls` cannot render in happy-dom even with the tooltip wrapper (unresolvable `@immich/ui`/element context), STOP and report BLOCKED with the exact error — do NOT ship the reorder without a guard.

- [ ] **Step 2: Run — expect RED** (Create is currently before the toggle). `cd web && pnpm test -- --run "src/routes/(user)/albums/AlbumsControls.spec.ts"`.

- [ ] **Step 3: Move the block.** Cut the `<!-- Create Album --> <Button ...> ... </Button>` block (lines ~130-139) and paste it at the END of the file, AFTER the Cover/List toggle `{:else} ... {/if}` (after line ~219). Do not change the button's contents/handler. The resulting top-level order: filter tabs → search → sort → group → expand/collapse → view toggle → **Create**.

- [ ] **Step 4: Run — expect GREEN + tsc + lint.** `cd web && pnpm test -- --run "src/routes/(user)/albums/AlbumsControls.spec.ts" && pnpm check:typescript && npx eslint "src/routes/(user)/albums/AlbumsControls.svelte" "src/routes/(user)/albums/AlbumsControls.spec.ts"`.

- [ ] **Step 5: Confirm the diff is a pure move.** `git diff` should show only the Create block relocated (deletion at the old spot, insertion at the end) — no other lines changed.

- [ ] **Step 6: Commit.**

```bash
git add "web/src/routes/(user)/albums/AlbumsControls.svelte" "web/src/routes/(user)/albums/AlbumsControls.spec.ts"
git commit -m "refactor(albums): move Create album to the right of the toolbar (match space page)"
```

---

## Slice 8 exit gate

- `cd web && pnpm test` green; `pnpm check:typescript` exit 0; `pnpm lint` no new errors on touched files.
- The `/albums` toolbar order now matches the space page (shape-left, Create at the right); upstream diff limited to the block move.

## Self-review (author)

- Create renders after the view toggle (#25) ✓; behavior unchanged (`createAlbumAndRedirect`, same props) ✓; minimal upstream diff (pure move) ✓; fork-only guard test ✓.
