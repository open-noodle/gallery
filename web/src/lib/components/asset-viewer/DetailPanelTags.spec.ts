import '@testing-library/jest-dom';
import { screen, within } from '@testing-library/svelte';
import { renderWithTooltips } from '$tests/helpers';
import { assetFactory } from '@test-data/factories/asset-factory';
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

vi.mock('$lib/managers/auth-manager.svelte', () => ({ authManager: authManagerMock }));

vi.mock('$lib/managers/feature-flags-manager.svelte', () => ({
  featureFlagsManager: {
    value: {
      map: true,
      smartSearch: false,
      tags: true,
    },
  },
}));

const taggedAsset = () =>
  assetFactory.build({
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

  it('hides the section on a shared link even when tags are present', () => {
    authManagerMock.isSharedLink = true;

    renderWithTooltips(DetailPanelTags, { asset: taggedAsset(), isOwner: false });

    expect(screen.queryByTestId('detail-panel-tags')).not.toBeInTheDocument();
  });

  it('hides the section on a shared link even for the owner', () => {
    authManagerMock.isSharedLink = true;

    renderWithTooltips(DetailPanelTags, { asset: taggedAsset(), isOwner: true });

    expect(screen.queryByTestId('detail-panel-tags')).not.toBeInTheDocument();
  });

  it('shows existing tags to a non-owner with read access', () => {
    renderWithTooltips(DetailPanelTags, { asset: taggedAsset(), isOwner: false });

    expect(screen.getByTestId('detail-panel-tags')).toBeInTheDocument();
    expect(screen.getByText('Beach')).toBeInTheDocument();
    expect(screen.getByText('Egypt')).toBeInTheDocument();
  });

  it('offers no tag editing controls to a non-owner', () => {
    renderWithTooltips(DetailPanelTags, { asset: taggedAsset(), isOwner: false });

    const section = screen.getByTestId('detail-panel-tags');
    expect(within(section).queryAllByRole('button')).toHaveLength(0);
  });

  it('offers tag editing controls to the owner', () => {
    renderWithTooltips(DetailPanelTags, { asset: taggedAsset(), isOwner: true });

    const section = screen.getByTestId('detail-panel-tags');
    expect(within(section).queryAllByRole('button').length).toBeGreaterThan(0);
  });

  it('still renders the section for an owner whose asset has no tags', () => {
    renderWithTooltips(DetailPanelTags, { asset: assetFactory.build({ ownerId: 'owner-1', tags: [] }), isOwner: true });

    expect(screen.getByTestId('detail-panel-tags')).toBeInTheDocument();
  });

  it('hides the section from a non-owner when the asset has no tags', () => {
    renderWithTooltips(DetailPanelTags, {
      asset: assetFactory.build({ ownerId: 'owner-1', tags: [] }),
      isOwner: false,
    });

    expect(screen.queryByTestId('detail-panel-tags')).not.toBeInTheDocument();
  });

  // #734: a space editor may add a tag to a member's asset (`bulkTagAssets` checks `AssetUpdate`,
  // which has a space arm) but may not remove one (tag removal resolves to tag ownership, which
  // has none) — offering that control would present a 403-on-click button. `canEdit` therefore
  // widens ONLY the add-tag affordance; per-tag remove stays gated on the real `isOwner`.
  it('W-tags-1: offers add-tag but no per-tag remove to a non-owner editor', () => {
    renderWithTooltips(DetailPanelTags, { asset: taggedAsset(), isOwner: false, canEdit: true });

    const section = screen.getByTestId('detail-panel-tags');
    // The add-tag control is the only button offered — one per tag badge would additionally
    // appear if remove leaked, so this also proves no per-tag remove renders.
    expect(within(section).queryAllByRole('button')).toHaveLength(1);
    expect(screen.queryAllByLabelText('remove_tag', { exact: false })).toHaveLength(0);
  });

  it('still hides add-tag from a non-owner non-editor', () => {
    renderWithTooltips(DetailPanelTags, { asset: taggedAsset(), isOwner: false, canEdit: false });

    const section = screen.getByTestId('detail-panel-tags');
    expect(within(section).queryAllByRole('button')).toHaveLength(0);
  });
});
