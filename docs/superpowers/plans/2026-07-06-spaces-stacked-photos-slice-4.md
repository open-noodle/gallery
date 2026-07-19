# Stacked Photos in Spaces — Slice S4 Implementation Plan (Web guard test + user docs)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox syntax.

**Goal:** Lock in web's correct-by-default behavior (space timeline requests stack collapse; space-album detail does not) with a guard test, and document the whole-stack add/remove behavior + the re-add workaround for users. No web app code change.

**Tech Stack:** SvelteKit + Vitest (web unit), Docusaurus markdown.

Spec: `docs/superpowers/specs/2026-07-06-spaces-stacked-photos-design.md` (Slice S4; edge cases E24, E25).

## Global Constraints

- No web app source change expected — this slice is a guard test + docs only.
- `buildSpaceTimelineOptions(spaceId, filters)` returns `{ spaceId, withStacked: true, ... }` (`web/src/lib/utils/space-filter-options.ts:5`). `buildAlbumTimelineOptions(albumId, order, filters)` returns options WITHOUT `withStacked` (`web/src/lib/utils/album-filter-options.ts:42`).
- Empty filters via `createFilterState()` (`web/src/lib/components/filter-panel/filter-panel.ts:78`). `AssetOrder` from `@immich/sdk` (requires the SDK build; run `make build-sdk` if the import fails to resolve at test time).
- Prettier on any touched markdown under `docs/` (CI Docs Build is strict).

---

### Task 1: Web guard test (E24/E25)

**Files:**

- Create: `web/src/lib/utils/space-filter-options.spec.ts`

- [ ] **Step 1: Write the test**

```ts
import { AssetOrder } from '@immich/sdk';
import { createFilterState } from '$lib/components/filter-panel/filter-panel';
import { buildAlbumTimelineOptions } from '$lib/utils/album-filter-options';
import { buildSpaceTimelineOptions } from '$lib/utils/space-filter-options';
import { describe, expect, it } from 'vitest';

describe('space vs album timeline options — stack collapse (#751)', () => {
  it('space timeline requests stack collapse (withStacked: true) (E24)', () => {
    const options = buildSpaceTimelineOptions('space-1', createFilterState());

    expect(options.spaceId).toBe('space-1');
    expect(options.withStacked).toBe(true);
  });

  it('space-album detail does NOT collapse stacks (no withStacked) (E25)', () => {
    const options = buildAlbumTimelineOptions('album-1', AssetOrder.Desc, createFilterState());

    expect(options.withStacked).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run**

Run: `cd web && pnpm test -- --run src/lib/utils/space-filter-options.spec.ts`
Expected: PASS (guards existing correct behavior). If `@immich/sdk` import fails, run `make build-sdk` from repo root first, then re-run. This test passes on unchanged web code — it is a regression guard, so a first-run green is correct here.

- [ ] **Step 3: Commit**

```bash
git add web/src/lib/utils/space-filter-options.spec.ts
git commit -m "test(spaces): guard space timeline collapses stacks, album detail does not (#751)"
```

---

### Task 2: User documentation

**Files:**

- Modify: `docs/docs/features/shared-spaces.md` — insert a new `## Stacked Photos` section between `## Removing Photos from a Space` (ends line 150) and `## Timeline Integration` (line 152).

- [ ] **Step 1: Insert the section** (verbatim, after the Removing section's last line and its blank line, before `## Timeline Integration`):

```markdown
## Stacked Photos

Stacks (RAW+JPEG pairs, bursts, or manually grouped photos) are treated as a unit in a space:

- **Adding** any photo of a stack adds the **entire stack** to the space. In the space timeline the stack appears collapsed to its cover photo — exactly like your main timeline — with a badge showing how many frames it holds. Open the cover to page through every frame.
- **Removing** any photo of a stack removes the **whole stack** from the space.
- Changing which photo is the stack's cover keeps the stack in the space — the new cover simply takes its place.

Hidden and locked photos are never added to a shared space, even when they belong to a stack.

:::note
Stacks that were added to a space before this feature shipped — or stacks you re-group after adding them — may still show only their cover. Re-add the stack to bring in every frame.
:::
```

- [ ] **Step 2: Prettier**

Run: `cd docs && pnpm exec prettier --write docs/features/shared-spaces.md` (or the repo's markdown prettier command). Confirm no formatting diff remains.

- [ ] **Step 3: Commit**

```bash
git add docs/docs/features/shared-spaces.md
git commit -m "docs(spaces): document whole-stack add/remove in shared spaces (#751)"
```

## Slice S4 Verification Gate

- [ ] `cd web && pnpm test -- --run src/lib/utils/space-filter-options.spec.ts` — green (build SDK first if needed)
- [ ] `cd web && pnpm check:typescript` — clean (new spec typechecks)
- [ ] Prettier clean on `docs/docs/features/shared-spaces.md`
