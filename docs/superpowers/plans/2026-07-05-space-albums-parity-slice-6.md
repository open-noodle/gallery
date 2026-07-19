# Space Albums Parity — Slice 6: Create + Link toolbar + role gating

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** Editor+ members get **Create album** (creates → auto-links → navigates to the space album; failure toasts without navigating) and **Link album** buttons in the controls' add-albums cluster. Viewers see neither but keep search/sort/group/view. The duplicate header Link button is removed and the standalone count dropped (per spec §4).

**Architecture:** `SpaceAlbumsControls` gains `canManage`, `onCreate`, `onLink` props and renders the two buttons when `canManage`. `+page.svelte` implements `handleCreateAlbum` (reuse `createAlbum` from album-utils — NOT `createAlbumAndRedirect`, which routes to `/albums/{id}`), then `linkAlbum`, then `goto` the space album route; on link failure it toasts + reloads without navigating.

## Global Constraints

- Spec §4, §4.1, Slice 6. Edge cases: create-succeeds/link-fails → toast + no navigation + reload (#16); no auto-delete of the created album (#17, documented — the space list has no cleanup); viewer read-only, editor/owner full controls (#20 web).
- Fork-only: `space-albums-controls.svelte`(+spec), `+page.svelte`(+`space-albums-page.spec.ts`), `i18n/en.json` (reuse `create_album`, `spaces_linked_albums_link_album`; add an `spaces_linked_albums_error_link` key if none exists — grep).
- `createAlbum(name?, assetIds?)` returns `AlbumResponseDto | undefined` (it internally catches + toasts its own failure and returns `undefined`). So: `undefined` → create failed (already toasted) → return without navigating.
- The empty-state (0 albums) keeps its existing Link CTA unchanged (controls only render when albums exist). Do NOT add create-from-empty (out of scope; note as follow-up).
- Verify: `pnpm test -- --run <file>`, `pnpm check:typescript`, eslint 0. No `Co-Authored-By`. Base: `7f198e3d39`.

## File Structure

- Modify `web/src/lib/components/spaces/space-albums-controls.svelte` (+ `.spec.ts`).
- Modify `web/src/routes/(user)/spaces/[spaceId]/albums/+page.svelte` (+ `space-albums-page.spec.ts`).
- Modify `i18n/en.json` (if a link-error key is needed).

---

## Task 1: Create + Link buttons in controls (role-gated)

**Files:** `space-albums-controls.svelte` (+ spec).

**Interfaces:**

- Produces: `SpaceAlbumsControls` gains `canManage: boolean`, `onCreate?: () => void`, `onLink?: () => void`.

- [ ] **Step 1: Extend the controls spec (red).**

```ts
it('shows Create + Link for editors and invokes the callbacks', async () => {
  const onCreate = vi.fn();
  const onLink = vi.fn();
  render(SpaceAlbumsControls, { canManage: true, onCreate, onLink });
  await fireEvent.click(screen.getByTestId('create-album-button'));
  await fireEvent.click(screen.getByTestId('link-album-button'));
  expect(onCreate).toHaveBeenCalledOnce();
  expect(onLink).toHaveBeenCalledOnce();
});
it('hides Create + Link for viewers but keeps search/sort/group/view', () => {
  render(SpaceAlbumsControls, { canManage: false });
  expect(screen.queryByTestId('create-album-button')).not.toBeInTheDocument();
  expect(screen.queryByTestId('link-album-button')).not.toBeInTheDocument();
  expect(screen.getByTestId('space-albums-search')).toBeInTheDocument();
  expect(screen.getByTestId('space-albums-sort-btn')).toBeInTheDocument();
  expect(screen.getByTestId('space-albums-group-btn')).toBeInTheDocument();
  expect(screen.getByTestId('space-albums-view-toggle')).toBeInTheDocument();
});
```

(Confirm the exact existing testids for the search/sort/group/view controls and use them.)

- [ ] **Step 2: Run — RED.**

- [ ] **Step 3: Implement.** Add `canManage: boolean`, `onCreate?: () => void`, `onLink?: () => void` to `Props`. In the add-albums cluster (right), render when `canManage`:

```svelte
{#if canManage}
  <Button size="small" leadingIcon={mdiPlus} onclick={() => onCreate?.()} data-testid="create-album-button">
    {$t('create_album')}
  </Button>
  <Button size="small" variant="ghost" leadingIcon={mdiLinkVariantPlus} onclick={() => onLink?.()} data-testid="link-album-button">
    {$t('spaces_linked_albums_link_album')}
  </Button>
{/if}
```

Use `@immich/ui` `Button` (import if not already) and `mdiPlus`/`mdiLinkVariantPlus`.

- [ ] **Step 4: GREEN + tsc + lint. Step 5: Commit.**

```bash
git commit -m "feat(spaces): create + link buttons in space albums controls (editor-gated)"
```

---

## Task 2: create→link→navigate flow + page wiring

**Files:** `+page.svelte` (+ `space-albums-page.spec.ts`), `i18n/en.json`.

- [ ] **Step 1: Extend the page spec (red).** Mock `sdkMock.createAlbum` + `sdkMock.linkAlbum` + `goto` (`$app/navigation`).

```ts
it('create: creates an album, links it, and navigates to the space album route', async () => {
  sdkMock.createAlbum.mockResolvedValue({ id: 'new-1', albumName: '' } as any);
  sdkMock.linkAlbum.mockResolvedValue(undefined as never);
  renderPage([makeAlbum({ id: 'a' })], SharedSpaceRole.Owner);
  await fireEvent.click(screen.getByTestId('create-album-button'));
  await waitFor(() => expect(sdkMock.linkAlbum).toHaveBeenCalledWith({ id: BASE_SPACE.id, albumId: 'new-1' }));
  expect(goto).toHaveBeenCalledWith(`/spaces/${BASE_SPACE.id}/albums/new-1`);
});
it('create succeeds but link fails → toast, no navigation, reload', async () => {
  sdkMock.createAlbum.mockResolvedValue({ id: 'new-1', albumName: '' } as any);
  sdkMock.linkAlbum.mockRejectedValue(new Error('nope'));
  renderPage([makeAlbum({ id: 'a' })], SharedSpaceRole.Owner);
  await fireEvent.click(screen.getByTestId('create-album-button'));
  await waitFor(() => expect(sdkMock.linkAlbum).toHaveBeenCalled());
  expect(goto).not.toHaveBeenCalled();
  expect(sdkMock.getSharedSpaceAlbums).toHaveBeenCalled(); // reload
});
it('viewer sees no Create/Link', () => {
  renderPage([makeAlbum({ id: 'a' })], SharedSpaceRole.Viewer);
  expect(screen.queryByTestId('create-album-button')).not.toBeInTheDocument();
  expect(screen.queryByTestId('link-album-button')).not.toBeInTheDocument();
});
```

(Adapt to the file's existing `renderPage`/`BASE_SPACE`/`makeAlbum`/`goto` mock. `goto` is already mocked in `$app/navigation` in this spec.)

- [ ] **Step 2: Run — RED.**

- [ ] **Step 3: Implement in `+page.svelte`.** Add imports: `goto` from `$app/navigation` (already imports `invalidateAll` from there); `linkAlbum` from `@immich/sdk`; `createAlbum` from `$lib/utils/album-utils`. Add:

```ts
async function handleCreateAlbum() {
  const newAlbum = await createAlbum();
  if (!newAlbum) {
    return; // create failed; createAlbum already showed a toast
  }
  try {
    await linkAlbum({ id: space.id, albumId: newAlbum.id });
    await invalidateAll();
    await goto(`/spaces/${space.id}/albums/${newAlbum.id}`);
  } catch (error) {
    handleError(error, $t('spaces_linked_albums_error_link'));
    await reload();
    await invalidateAll();
  }
}
```

Wire the controls: `<SpaceAlbumsControls {groupIds} bind:searchQuery canManage={isEditor} onCreate={handleCreateAlbum} onLink={openLinkAlbumModal} />`. **Remove** the header `<div>` (the standalone count + the header `link-album-button` Button) — the Link action now lives in the controls; the count is dropped per spec §4. Keep the empty-state block (its `empty-link-album-button` CTA) unchanged.

- [ ] **Step 4: Update `space-albums-page.spec.ts`.** Any assertion referencing the OLD header `link-album-button` in the 0-albums/empty context must move to the controls context (albums present). Keep the empty-state `empty-link-album-button` test. Ensure `create-album-button`/`link-album-button` are asserted only when albums exist (controls rendered).

- [ ] **Step 5: i18n.** Ensure `create_album` + `spaces_linked_albums_link_album` exist (they do — used already). Add `spaces_linked_albums_error_link` = "Failed to link the album to the space" if absent.

- [ ] **Step 6: GREEN + tsc + lint. Step 7: Commit.**

```bash
git commit -m "feat(spaces): create+link album flow with failure handling; move link into controls"
```

---

## Slice 6 exit gate

- `cd web && pnpm test` green; `pnpm check:typescript` exit 0; `pnpm lint` no new errors on touched files.

## Self-review (author)

- Editor sees Create+Link, viewer neither (#20 web) ✓; create→link→navigate ✓; link-fail → toast + no goto + reload (#16) ✓; no auto-delete (#17, documented — nothing added) ✓; reuse `createAlbum` (empty name), not the personal redirect helper ✓.
