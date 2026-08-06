# Image Adjustments — Slice 4: Web plan-card before/after preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** On the agent plan card, show a **before → after** preview for `asset.adjust` / `asset.flip` operations (the "after" rendered by the Slice-2 `POST /assets/:id/edits/preview` endpoint), so users see the adjustment and iterate on it via the existing revise loop.

**Architecture:** A pure helper maps an operation `(type, payload)` → editor `AssetEditActionItem[]` (asset.adjust → `adjust`; asset.flip → `mirror`; else `null`). A second helper POSTs those edits to the preview endpoint and returns an object URL. `agent-plan-thumbnail-strip.svelte` auto-detects edit ops and renders before/after pairs, re-fetching when the edit payload changes (the iterate loop) and revoking old object URLs.

**Tech Stack:** SvelteKit, Svelte 5 runes (`$state`/`$derived`/`$effect`/`$props`), Vitest + @testing-library/svelte + happy-dom.

Spec: `docs/superpowers/specs/2026-06-06-pi-agent-image-adjustments-design.md` (Slice 4).

> **Scope note:** before/after is shown ONLY for `asset.adjust`/`asset.flip` groups (auto-detected by op type). All other operation groups render the existing single-thumbnail strip unchanged (no regression). Crop/rotate are NOT previewed here (their geometry doesn't compose correctly over a thumbnail — see Slice 2). The op label uses the existing `typeLabelKeys` fallback; only the Before/After UI strings are new i18n keys.

---

## File Structure

- **Create** `web/src/routes/(user)/assistant/agent-plan-edit-preview.ts` — `editActionsForOperation(type, payload)` + `fetchEditPreview(assetId, edits, signal)`.
- **Modify** `web/src/routes/(user)/assistant/agent-plan-thumbnail-strip.svelte` — before/after variant.
- **Modify** `web/src/lib/i18n/en.json` — Before/After strings.
- Tests: `agent-plan-edit-preview.spec.ts`, extend `agent-plan-thumbnail-strip.spec.ts`.

---

## Task 1: pure helper — `editActionsForOperation` + `fetchEditPreview`

**Files:**

- Create: `web/src/routes/(user)/assistant/agent-plan-edit-preview.ts`
- Test: `web/src/routes/(user)/assistant/agent-plan-edit-preview.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from 'vitest';
import { editActionsForOperation, fetchEditPreview } from './agent-plan-edit-preview';

describe('editActionsForOperation', () => {
  it('maps asset.adjust to an adjust edit action', () => {
    expect(
      editActionsForOperation('asset.adjust', { brightness: 'moderate_increase', contrast: 'slight_increase' }),
    ).toEqual([{ action: 'adjust', parameters: { brightness: 'moderate_increase', contrast: 'slight_increase' } }]);
  });
  it('maps asset.adjust autoEnhance', () => {
    expect(editActionsForOperation('asset.adjust', { autoEnhance: true })).toEqual([
      { action: 'adjust', parameters: { autoEnhance: true } },
    ]);
  });
  it('maps asset.flip to a mirror edit action', () => {
    expect(editActionsForOperation('asset.flip', { axis: 'horizontal' })).toEqual([
      { action: 'mirror', parameters: { axis: 'horizontal' } },
    ]);
  });
  it('returns null for a non-edit operation', () => {
    expect(editActionsForOperation('album.addAssets', {})).toBeNull();
  });
});

describe('fetchEditPreview', () => {
  it('posts edits and returns an object URL on 200', async () => {
    const blob = new Blob(['img'], { type: 'image/jpeg' });
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, blob: () => Promise.resolve(blob) });
    vi.stubGlobal('fetch', fetchSpy);
    vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:abc') });
    const url = await fetchEditPreview('asset-1', [
      { action: 'adjust', parameters: { brightness: 'moderate_increase' } },
    ]);
    expect(url).toBe('blob:abc');
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/assets/asset-1/edits/preview?size=thumbnail'),
      expect.objectContaining({ method: 'POST', credentials: 'include' }),
    );
    vi.unstubAllGlobals();
  });

  it('throws when the response is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 400 }));
    await expect(
      fetchEditPreview('asset-1', [{ action: 'adjust', parameters: { autoEnhance: true } }]),
    ).rejects.toThrow();
    vi.unstubAllGlobals();
  });
});
```

- [ ] **Step 2: Run → fail** (`module not found`).

Run: `pnpm -C web test -- --run "src/routes/(user)/assistant/agent-plan-edit-preview.spec.ts"`

- [ ] **Step 3: Implement**

```ts
import { getBaseUrl } from '@immich/sdk';

export type EditActionItem = { action: 'adjust' | 'mirror'; parameters: Record<string, unknown> };

/** Map an agent operation (type + payload) to editor edit actions, or null if it's not a previewable image-edit op. */
export const editActionsForOperation = (
  operationType: string,
  payload: Record<string, unknown> | undefined,
): EditActionItem[] | null => {
  if (!payload) return null;
  if (operationType === 'asset.adjust') {
    return [{ action: 'adjust', parameters: { ...payload } }];
  }
  if (operationType === 'asset.flip') {
    return [{ action: 'mirror', parameters: { axis: payload.axis } }];
  }
  return null;
};

/** POST the proposed edits to the ephemeral preview endpoint and return an object URL for the rendered image. */
export const fetchEditPreview = async (
  assetId: string,
  edits: EditActionItem[],
  signal?: AbortSignal,
): Promise<string> => {
  const response = await fetch(`${getBaseUrl()}/assets/${assetId}/edits/preview?size=thumbnail`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ edits }),
    signal,
  });
  if (!response.ok) {
    throw new Error(`Edit preview failed: ${response.status}`);
  }
  const blob = await response.blob();
  return URL.createObjectURL(blob);
};
```

> Confirm `getBaseUrl` is exported from `@immich/sdk` (it's imported in `web/src/lib/utils.ts`). If the test's `getBaseUrl` needs mocking, stub it; the assertion uses `stringContaining` so any base works.

- [ ] **Step 4: Run → pass.**

- [ ] **Step 5: Commit**

```bash
git add "web/src/routes/(user)/assistant/agent-plan-edit-preview.ts" "web/src/routes/(user)/assistant/agent-plan-edit-preview.spec.ts"
git commit -m "feat(web): agent edit-preview helper (op→edit-actions, preview fetch)"
```

---

## Task 2: before/after in the thumbnail strip

**Files:**

- Modify: `web/src/routes/(user)/assistant/agent-plan-thumbnail-strip.svelte`
- Modify: `web/src/lib/i18n/en.json`
- Test: `web/src/routes/(user)/assistant/agent-plan-thumbnail-strip.spec.ts` (extend)

**Behavior:**

- Derive the group's edit actions: read the group's first operation's raw DTO (`group.operations[0]?.operation` — verify the exact accessor by reading `OperationReviewItem` in `agent-operation-plan-ui.ts`; it exposes `.operation` with `.type` + `.payload`). `const editActions = $derived(op ? editActionsForOperation(op.type, op.payload as Record<string, unknown>) : null);`
- If `editActions` is non-null: render each `strip.assetIds` tile as a **before → after** pair (before = existing thumbnail `getAssetMediaUrl({ id, size: AssetMediaSize.Thumbnail })`; after = object URL from `fetchEditPreview`). Else render the existing strip unchanged.
- Manage after-URLs in `$state`. An `$effect` keyed on `(editActions, strip.assetIds)` aborts in-flight fetches, revokes prior object URLs, and fetches anew (the iterate loop: when the user revises, `op.payload` changes → `editActions` changes → re-fetch). Cleanup on unmount revokes all + aborts.

- [ ] **Step 1: Write the failing tests** (extend the existing spec; mirror its render/setup helpers)

```ts
// helper: build an OperationReviewGroup whose single operation is asset.adjust (match the spec's existing group factory)
it('renders before and after images for an asset.adjust group', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, blob: () => Promise.resolve(new Blob(['x'])) }));
  vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:after'), revokeObjectURL: vi.fn() });
  render(AgentPlanThumbnailStrip, { group: adjustGroup(['a1']) });
  // before tile (thumbnail) present
  expect(screen.getAllByTestId('agent-plan-thumbnail-image').length).toBeGreaterThan(0);
  // after tile resolves to the object URL
  await waitFor(() => expect(screen.getByTestId('agent-plan-after-image')).toHaveAttribute('src', 'blob:after'));
  vi.unstubAllGlobals();
});

it('renders the plain strip (no after) for a non-edit group', () => {
  render(AgentPlanThumbnailStrip, { group: addAssetsGroup(['a1']) });
  expect(screen.queryByTestId('agent-plan-after-image')).toBeNull();
});

it('revokes prior object URLs when the edit payload changes', async () => {
  const revoke = vi.fn();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, blob: () => Promise.resolve(new Blob(['x'])) }));
  vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:after'), revokeObjectURL: revoke });
  const { rerender } = render(AgentPlanThumbnailStrip, {
    group: adjustGroup(['a1'], { brightness: 'slight_increase' }),
  });
  await waitFor(() => expect(screen.getByTestId('agent-plan-after-image')).toBeInTheDocument());
  await rerender({ group: adjustGroup(['a1'], { brightness: 'strong_increase' }) });
  await waitFor(() => expect(revoke).toHaveBeenCalled());
  vi.unstubAllGlobals();
});

it('shows a failed state when the after fetch errors, keeping the before', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 400 }));
  render(AgentPlanThumbnailStrip, { group: adjustGroup(['a1']) });
  await waitFor(() => expect(screen.getByTestId('agent-plan-after-failed')).toBeInTheDocument());
  expect(screen.getAllByTestId('agent-plan-thumbnail-image').length).toBeGreaterThan(0);
});
```

> Build `adjustGroup`/`addAssetsGroup` factories by reading the existing `agent-plan-thumbnail-strip.spec.ts` group fixtures and adding an `operations: [{ operation: { type, payload, assetIds } }]` shape that matches `OperationReviewItem`. Use the file's existing `render`/`screen` imports.

- [ ] **Step 2: Run → fail.**

Run: `pnpm -C web test -- --run "src/routes/(user)/assistant/agent-plan-thumbnail-strip.spec.ts"`

- [ ] **Step 3: Implement** the component changes.

Add to the `<script>`: import `editActionsForOperation`, `fetchEditPreview`; derive `editActions`; add after-URL `$state` + the `$effect`. Add i18n keys `assistant_operation_preview_before`, `assistant_operation_preview_after`, `assistant_operation_preview_applies_to_all` to `en.json`. Render the before/after pair when `editActions` is set, each after-tile with `data-testid="agent-plan-after-image"` (ready) / `agent-plan-after-failed` (error) / a loading state. Keep the existing plain-strip markup as the `{:else}`.

> Object-URL lifecycle: in the `$effect`, capture the current `editActions`+`assetIds`, create an `AbortController`, fetch each asset's preview into the `$state` map; the effect's cleanup function revokes every URL it created and aborts. Keying the effect on `JSON.stringify(editActions)` + `assetIds.join(',')` makes a revise re-run it.

- [ ] **Step 4: Run → pass.**

- [ ] **Step 5: Commit**

```bash
git add "web/src/routes/(user)/assistant/agent-plan-thumbnail-strip.svelte" "web/src/routes/(user)/assistant/agent-plan-thumbnail-strip.spec.ts" web/src/lib/i18n/en.json
git commit -m "feat(web): before/after edit preview on the agent plan thumbnail strip"
```

---

## Task 3: gates

- [ ] **Step 1:** `make check-web` (svelte-check + tsc) green.
- [ ] **Step 2:** `make format-web` (prettier) — clean.
- [ ] **Step 3:** re-run both Slice-4 specs:

```bash
pnpm -C web test -- --run "src/routes/(user)/assistant/agent-plan-edit-preview.spec.ts" "src/routes/(user)/assistant/agent-plan-thumbnail-strip.spec.ts"
```

Expected: green.

- [ ] **Step 4: Commit** any formatting fixes.

> No server change, no OpenAPI change in this slice. `pnpm run check:svelte` is a known local no-op — rely on `make check-web` + CI Test Web.

---

## Edge cases covered (from the spec)

- before + after rendered for adjust/flip; after src is the object URL (Task 2).
- non-edit ops → existing plain strip, no after (Task 2 — no regression).
- after fetch failure → failed state shown, before kept (Task 2).
- edit-payload change (revise) → re-fetch + revoke old object URLs (Task 2 — the iterate loop).
- many assets → capped by the existing `maxVisible` slice; overflow count unchanged.
- helper maps adjust/flip/autoEnhance; null for non-edit ops (Task 1).

## Self-review checklist

- Spec Slice-4 tests mapped: before/after render → T2; non-edit no-regression → T2; failure state → T2; re-fetch+revoke on payload change → T2; helper mapping → T1. ✅
- Auto-detect by op type; no crop/rotate preview; `typeLabelKeys` op label unchanged; new i18n only for Before/After. ✅
- Object-URL lifecycle (create/abort/revoke) specified. ✅
- No server/OpenAPI/runner work. ✅

```

```
