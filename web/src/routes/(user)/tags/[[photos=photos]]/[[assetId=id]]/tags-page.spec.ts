import { renderWithTooltips } from '#test/unit/helpers.ts';
import { AssetVisibility, type TagResponseDto } from '@immich/sdk';
import { expect } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import TagsPage from './+page.svelte';

type TimelineStubGlobals = typeof globalThis & {
  __timelineStubAssetCount?: number;
};

const timelineStubGlobals = globalThis as TimelineStubGlobals;

const { mockAssetMultiSelectManager, mockAuthManager, mockRegisterSelectionContext } = vi.hoisted(() => ({
  mockAssetMultiSelectManager: {
    selectionActive: false,
    assets: [],
    clear: vi.fn(),
    isAllFavorite: false,
    isAllUserOwned: true,
  },
  mockAuthManager: {
    preferences: { tags: { enabled: true } },
  },
  mockRegisterSelectionContext: vi.fn(),
}));

vi.mock('$app/navigation', async () => ({
  ...(await import('#test/unit/mocks/app-navigation.ts')),
  goto: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('#lib/components/OnEvents.svelte', async () => {
  const { default: MockComponent } = await import('#lib/gallery/__mocks__/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('#lib/components/layouts/UserPageLayout.svelte', async () => {
  const { default: MockComponent } = await import('#lib/components/spaces/mock-user-page-layout.test-wrapper.svelte');
  return { default: MockComponent, headerId: 'page-header' };
});

vi.mock('#lib/components/shared-components/context-menu/ButtonContextMenu.svelte', async () => {
  const { default: MockComponent } = await import('#lib/gallery/__mocks__/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('#lib/components/shared-components/tree/breadcrumbs.svelte', async () => {
  const { default: MockComponent } = await import('#lib/gallery/__mocks__/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('#lib/components/shared-components/tree/TreeItemThumbnails.svelte', async () => {
  const { default: MockComponent } = await import('#lib/gallery/__mocks__/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('#lib/components/shared-components/tree/TreeItems.svelte', async () => {
  const { default: MockComponent } = await import('#lib/gallery/__mocks__/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('#lib/components/sidebar/sidebar.svelte', async () => {
  const { default: MockComponent } = await import('#lib/gallery/__mocks__/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('#lib/components/timeline/Timeline.svelte', async () => {
  const { default: MockComponent } = await import('#lib/gallery/__mocks__/bindable-timeline.stub.svelte');
  return { default: MockComponent };
});

vi.mock('#lib/components/timeline/AssetSelectControlBar.svelte', async () => {
  const { default: MockComponent } = await import('#lib/gallery/__mocks__/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('#lib/gallery/actions/ArchiveAction.svelte', async () => {
  const { default: MockComponent } = await import('#lib/gallery/__mocks__/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('#lib/components/timeline/actions/ChangeDateAction.svelte', async () => {
  const { default: MockComponent } = await import('#lib/gallery/__mocks__/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('#lib/components/timeline/actions/ChangeDescriptionAction.svelte', async () => {
  const { default: MockComponent } = await import('#lib/gallery/__mocks__/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('#lib/components/timeline/actions/ChangeLocationAction.svelte', async () => {
  const { default: MockComponent } = await import('#lib/gallery/__mocks__/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('#lib/components/timeline/actions/DeleteAssetsAction.svelte', async () => {
  const { default: MockComponent } = await import('#lib/gallery/__mocks__/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('#lib/components/timeline/actions/DownloadAction.svelte', async () => {
  const { default: MockComponent } = await import('#lib/gallery/__mocks__/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('#lib/components/timeline/actions/FavoriteAction.svelte', async () => {
  const { default: MockComponent } = await import('#lib/gallery/__mocks__/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('#lib/components/timeline/actions/RotateAction.svelte', async () => {
  const { default: MockComponent } = await import('#lib/gallery/__mocks__/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('#lib/components/timeline/actions/SelectAllAction.svelte', async () => {
  const { default: MockComponent } = await import('#lib/gallery/__mocks__/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('#lib/components/timeline/actions/SetVisibilityAction.svelte', async () => {
  const { default: MockComponent } = await import('#lib/gallery/__mocks__/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('#lib/components/timeline/actions/TagAction.svelte', async () => {
  const { default: MockComponent } = await import('#lib/gallery/__mocks__/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('#lib/managers/asset-multi-select-manager.svelte.js', () => ({
  assetMultiSelectManager: mockAssetMultiSelectManager,
}));

vi.mock('#lib/managers/auth-manager.svelte.js', () => ({ authManager: mockAuthManager }));

vi.mock('#lib/managers/command-context-manager.svelte.js', async (orig) => ({
  ...(await orig<typeof import('#lib/managers/command-context-manager.svelte.ts')>()),
  registerSelectionContext: mockRegisterSelectionContext,
}));

vi.mock('#lib/services/asset.service.js', () => ({
  getAssetBulkActions: vi.fn(() => ({})),
}));

vi.mock('#lib/services/tag.service.js', () => ({
  getTagActions: vi.fn(() => ({ Create: {}, Update: {}, Delete: {} })),
}));

vi.mock('@immich/sdk', async () => {
  const actual = await vi.importActual<typeof import('@immich/sdk')>('@immich/sdk');
  return {
    ...actual,
    getAllTags: vi.fn().mockResolvedValue([]),
  };
});

function makeTag(overrides: Partial<TagResponseDto> = {}): TagResponseDto {
  return {
    id: 'tag-1',
    value: 'Trips',
    color: 'primary',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as TagResponseDto;
}

function renderPage(overrides: { tags?: TagResponseDto[]; path?: string; title?: string } = {}) {
  const title = overrides.title ?? 'Trips';
  const props = {
    data: {
      tags: overrides.tags ?? [makeTag()],
      path: overrides.path ?? 'Trips',
      meta: { title },
    },
  };

  return renderWithTooltips(TagsPage, props);
}

describe('Tags page cmdk selection context', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAssetMultiSelectManager.selectionActive = false;
    mockAssetMultiSelectManager.assets = [];
  });

  it('registers add-to-album and visible toolbar callbacks without current-space support', async () => {
    await renderPage();

    expect(mockRegisterSelectionContext).toHaveBeenCalledOnce();
    const options = mockRegisterSelectionContext.mock.calls[0][0];
    expect(options.getAssets()).toBe(mockAssetMultiSelectManager.assets);
    expect(options.canAddToAlbum()).toBe(true);
    expect(options.getOnFavorite()).toEqual(expect.any(Function));
    expect(options.getOnArchive()).toEqual(expect.any(Function));
    expect(options.getOnDelete()).toEqual(expect.any(Function));
    expect(options.getOnUndoDelete()).toEqual(expect.any(Function));
    expect(options.getAddSelectedToCurrentSpace?.()).toBeUndefined();
  });
});

describe('Tags page timeline scope', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Non-admin space members can see a tag owned by the space creator, but the assets
  // under it belong to the creator and are only reachable through the shared space.
  // The timeline must opt into shared-space assets (and pin timeline visibility, which
  // withSharedSpaces requires) so the tag actually shows photos for them (issue #647).
  it('requests shared-space assets so non-admin members see photos under a tag', async () => {
    await renderPage();

    const options = page.getByTestId('timeline-options').element().textContent ?? '';
    expect(options).toContain('"tagId":"tag-1"');
    expect(options).toContain('"withSharedSpaces":true');
    expect(options).toContain(`"visibility":"${AssetVisibility.Timeline}"`);
  });
});

describe('Tags page timeline grouping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAssetMultiSelectManager.selectionActive = false;
    mockAssetMultiSelectManager.assets = [];
    timelineStubGlobals.__timelineStubAssetCount = undefined;
  });

  afterEach(() => {
    timelineStubGlobals.__timelineStubAssetCount = undefined;
  });

  it('selected tag with assets renders grouping controls, preserves tagId, and passes mobile grouping props', async () => {
    await renderPage({ tags: [makeTag({ id: 'tag-with-assets', value: 'Trips' })] });

    await expect.element(page.getByTestId('timeline-desktop-grouping-control')).toBeInTheDocument();
    await expect.element(page.getByTestId('timeline-grouping-day')).toHaveAttribute('aria-pressed', 'true');
    await expect.element(page.getByTestId('timeline-options')).toMatchTextContent('"tagId":"tag-with-assets"');
    await expect.element(page.getByTestId('timeline-options')).toMatchTextContent('"grouping":"day"');
    await expect
      .element(page.getByTestId('timeline-mobile-grouping-props'))
      .toMatchTextContent(JSON.stringify({ grouping: 'day', hasHandler: true }));
  });

  it('year bucket activation keeps tag scope and zooms without temporal chips', async () => {
    await renderPage({ tags: [makeTag({ id: 'tag-with-assets', value: 'Trips' })] });

    await userEvent.click(page.getByTestId('activate-year-bucket'));

    await expect.element(page.getByTestId('timeline-options')).toMatchTextContent('"tagId":"tag-with-assets"');
    await expect.element(page.getByTestId('timeline-options')).toMatchTextContent('"grouping":"month"');
    await expect.element(page.getByTestId('timeline-options')).not.toMatchTextContent('"takenAfter"');
    await expect.element(page.getByTestId('timeline-options')).not.toMatchTextContent('"takenBefore"');
    await expect.element(page.getByTestId('active-filters-bar')).not.toBeInTheDocument();
    await expect.element(page.getByTestId('timeline-anchor')).toMatchTextContent('{"year":2015}');
  });

  it('bucket activation keeps tag scope without rendering ActiveFiltersBar', async () => {
    await renderPage({ tags: [makeTag({ id: 'tag-with-assets', value: 'Trips' })] });

    await userEvent.click(page.getByTestId('activate-year-bucket'));

    await expect.element(page.getByTestId('timeline-options')).toMatchTextContent('"tagId":"tag-with-assets"');
    await expect.element(page.getByTestId('timeline-options')).toMatchTextContent('"grouping":"month"');
    await expect.element(page.getByTestId('active-filters-bar')).not.toBeInTheDocument();
    await expect.element(page.getByTestId('timeline-anchor')).toMatchTextContent('{"year":2015}');
  });

  it('ignores bucket activation while selection mode is active', async () => {
    mockAssetMultiSelectManager.selectionActive = true;

    await renderPage({ tags: [makeTag({ id: 'tag-with-assets', value: 'Trips' })] });
    await userEvent.click(page.getByTestId('activate-year-bucket'));

    await expect.element(page.getByTestId('timeline-options')).toMatchTextContent('"grouping":"day"');
    await expect.element(page.getByTestId('timeline-anchor')).toMatchTextContent('null');
    await expect.element(page.getByTestId('active-filters-bar')).not.toBeInTheDocument();
  });

  it('selected tag with only child tags does not render orphaned grouping controls', async () => {
    await renderPage({
      tags: [makeTag({ id: 'child-tag', value: 'Trips/Paris' })],
      path: 'Trips',
      title: 'Trips',
    });

    await expect.element(page.getByTestId('timeline-desktop-grouping-control')).not.toBeInTheDocument();
    await expect.element(page.getByTestId('timeline-stub')).not.toBeInTheDocument();
  });

  it('never shows the add-all-to-collection button (excluded surface)', async () => {
    timelineStubGlobals.__timelineStubAssetCount = 3;

    await renderPage({ tags: [makeTag({ id: 'tag-with-assets', value: 'Trips' })] });

    await expect.element(page.getByTestId('timeline-desktop-grouping-control')).toBeInTheDocument();
    await expect.element(page.getByTestId('add-all-to-collection')).not.toBeInTheDocument();
  });
});
