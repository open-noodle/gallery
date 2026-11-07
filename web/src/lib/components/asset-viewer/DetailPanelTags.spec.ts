import { factory } from '#test/unit/factories.ts';
import { renderWithTooltips } from '#test/unit/helpers.ts';
import { expect } from 'vitest';
import { page } from 'vitest/browser';
import DetailPanelTags from './DetailPanelTags.svelte';

const { authManagerMock } = vi.hoisted(() => ({
  authManagerMock: {
    authenticated: true,
    user: { id: 'viewer-1' },
    isSharedLink: false,
    params: {},
    preferences: {
      tags: { enabled: true },
    },
  },
}));

vi.mock('#lib/managers/auth-manager.svelte.js', () => ({ authManager: authManagerMock }));

vi.mock('#lib/managers/feature-flags-manager.svelte.js', () => ({
  featureFlagsManager: {
    value: {
      map: true,
      smartSearch: false,
      tags: true,
    },
  },
}));

const taggedAsset = () =>
  factory.asset({
    id: 'asset-1',
    ownerId: 'owner-1',
    tags: [
      { id: 'tag-1', name: 'Beach', value: 'Beach', createdAt: '', updatedAt: '' },
      { id: 'tag-2', name: 'Egypt', value: 'Egypt', createdAt: '', updatedAt: '' },
    ],
  });

// Unlike the People section, the Tags data path genuinely reaches a non-owner: withTags is not
// user-scoped and AssetService.get applies no auth filter to `tags`, so a shared-album recipient
// receives the owner's tags. Pinned against a real database by
// server/test/medium/specs/services/asset.service.spec.ts ("get (shared-album recipient)").
describe('DetailPanelTags', () => {
  beforeEach(() => {
    authManagerMock.isSharedLink = false;
  });

  it('hides the section on a shared link even when tags are present', async () => {
    authManagerMock.isSharedLink = true;

    await renderWithTooltips(DetailPanelTags, { asset: taggedAsset(), isOwner: false });

    await expect.element(page.getByTestId('detail-panel-tags')).not.toBeInTheDocument();
  });

  it('hides the section on a shared link even for the owner', async () => {
    authManagerMock.isSharedLink = true;

    await renderWithTooltips(DetailPanelTags, { asset: taggedAsset(), isOwner: true });

    await expect.element(page.getByTestId('detail-panel-tags')).not.toBeInTheDocument();
  });

  it('shows existing tags to a non-owner with read access', async () => {
    await renderWithTooltips(DetailPanelTags, { asset: taggedAsset(), isOwner: false });

    await expect.element(page.getByTestId('detail-panel-tags')).toBeInTheDocument();
    await expect.element(page.getByText('Beach')).toBeInTheDocument();
    await expect.element(page.getByText('Egypt')).toBeInTheDocument();
  });

  it('offers no tag editing controls to a non-owner', async () => {
    await renderWithTooltips(DetailPanelTags, { asset: taggedAsset(), isOwner: false });

    const section = page.getByTestId('detail-panel-tags');
    await expect.element(section).toBeInTheDocument();
    expect(section.getByRole('button').elements()).toHaveLength(0);
  });

  it('offers tag editing controls to the owner', async () => {
    await renderWithTooltips(DetailPanelTags, { asset: taggedAsset(), isOwner: true });

    const section = page.getByTestId('detail-panel-tags');
    await expect.element(section).toBeInTheDocument();
    expect(section.getByRole('button').elements().length).toBeGreaterThan(0);
  });

  it('still renders the section for an owner whose asset has no tags', async () => {
    await renderWithTooltips(DetailPanelTags, {
      asset: factory.asset({ ownerId: 'owner-1', tags: [] }),
      isOwner: true,
    });

    await expect.element(page.getByTestId('detail-panel-tags')).toBeInTheDocument();
  });

  it('hides the section from a non-owner when the asset has no tags', async () => {
    await renderWithTooltips(DetailPanelTags, {
      asset: factory.asset({ ownerId: 'owner-1', tags: [] }),
      isOwner: false,
    });

    await expect.element(page.getByTestId('detail-panel-tags')).not.toBeInTheDocument();
  });

  // #734: a space editor may add a tag to a member's asset (`bulkTagAssets` checks `AssetUpdate`,
  // which has a space arm) but may not remove one (tag removal resolves to tag ownership, which
  // has none) — offering that control would present a 403-on-click button. `canEdit` therefore
  // widens ONLY the add-tag affordance; per-tag remove stays gated on the real `isOwner`.
  it('W-tags-1: offers add-tag but no per-tag remove to a non-owner editor', async () => {
    await renderWithTooltips(DetailPanelTags, { asset: taggedAsset(), isOwner: false, canEdit: true });

    const section = page.getByTestId('detail-panel-tags');
    await expect.element(section).toBeInTheDocument();
    // The add-tag control is the only button offered — one per tag badge would additionally
    // appear if remove leaked, so this also proves no per-tag remove renders.
    expect(section.getByRole('button').elements()).toHaveLength(1);
    expect(page.getByLabelText('remove_tag').elements()).toHaveLength(0);
  });

  it('still hides add-tag from a non-owner non-editor', async () => {
    await renderWithTooltips(DetailPanelTags, { asset: taggedAsset(), isOwner: false, canEdit: false });

    const section = page.getByTestId('detail-panel-tags');
    await expect.element(section).toBeInTheDocument();
    expect(section.getByRole('button').elements()).toHaveLength(0);
  });
});
