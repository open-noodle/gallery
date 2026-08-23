import { getAllSpaces, getSharedSpaceAlbums } from '@immich/sdk';
import { screen } from '@testing-library/svelte';
import { init, register, waitLocale } from 'svelte-i18n';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getIntersectionObserverMock } from '$lib/__mocks__/intersection-observer.mock';
import SchemaConfiguration from '$lib/components/SchemaConfiguration.svelte';
import type { JSONSchemaProperty } from '$lib/types';
import { renderWithTooltips } from '$tests/helpers';

vi.mock('@immich/sdk', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@immich/sdk')>()),
  getAllSpaces: vi.fn(),
  getSharedSpaceAlbums: vi.fn(),
}));

// The shape of `addToSpaceAlbum` in packages/plugin-gallery/manifest.json.
const spaceAlbumSchema = {
  type: 'object',
  properties: {
    spaceId: { type: 'string', title: 'Space', uiHint: { type: 'SpaceId', order: 1 } },
    albumName: { type: 'string', title: 'Album name', uiHint: { type: 'SpaceAlbumName', order: 2 } },
  },
  required: ['spaceId', 'albumName'],
} as JSONSchemaProperty;

beforeAll(async () => {
  register('en-US', () => import('$i18n/en.json'));
  await init({ fallbackLocale: 'en-US', initialLocale: 'en-US' });
  await waitLocale('en-US');
});

describe('SchemaConfiguration', () => {
  beforeEach(() => {
    vi.stubGlobal('IntersectionObserver', getIntersectionObserverMock());
    vi.stubGlobal('visualViewport', {
      height: 900,
      width: 1400,
      scale: 1,
      offsetLeft: 0,
      offsetTop: 0,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    vi.mocked(getAllSpaces).mockReset().mockResolvedValue([]);
    vi.mocked(getSharedSpaceAlbums).mockReset().mockResolvedValue([]);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const renderSchema = (config: Record<string, unknown>) =>
    renderWithTooltips(SchemaConfiguration, { schema: spaceAlbumSchema, config, root: true });

  it('scopes a SpaceAlbumName field to the sibling space that was chosen', async () => {
    // C1 — the branch reads the sibling property off the shared parent object. A missing branch
    // silently degrades to the plain string <Input>, which is exactly the field we replaced.
    renderSchema({ spaceId: 'space-1' });

    await vi.waitFor(() => expect(getSharedSpaceAlbums).toHaveBeenCalledWith({ id: 'space-1' }));
    expect(screen.getByRole('combobox')).toBeEnabled();
  });

  it('leaves a SpaceAlbumName field disabled until a space is chosen', async () => {
    // C2
    renderSchema({});

    expect(await screen.findByText('Choose a space first')).toBeInTheDocument();
    expect(screen.getByRole('combobox')).toBeDisabled();
    expect(getSharedSpaceAlbums).not.toHaveBeenCalled();
  });
});
