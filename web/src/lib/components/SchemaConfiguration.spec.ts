import SchemaConfiguration from '#lib/components/SchemaConfiguration.svelte';
import type { JSONSchemaProperty } from '#lib/types.ts';
import { renderWithTooltips } from '#test/unit/helpers.ts';
import { getAllSpaces, getSharedSpaceAlbums } from '@immich/sdk';
import { init, register, waitLocale } from 'svelte-i18n';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';

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
  register('en-US', () => import('#i18n/en.json'));
  await init({ fallbackLocale: 'en-US', initialLocale: 'en-US' });
  await waitLocale('en-US');
});

describe('SchemaConfiguration', () => {
  beforeEach(() => {
    vi.mocked(getAllSpaces).mockReset().mockResolvedValue([]);
    vi.mocked(getSharedSpaceAlbums).mockReset().mockResolvedValue([]);
  });

  const renderSchema = (config: Record<string, unknown>) =>
    renderWithTooltips(SchemaConfiguration, { schema: spaceAlbumSchema, config, root: true });

  it('scopes a SpaceAlbumName field to the sibling space that was chosen', async () => {
    // C1 — the branch reads the sibling property off the shared parent object. A missing branch
    // silently degrades to the plain string <Input>, which is exactly the field we replaced.
    await renderSchema({ spaceId: 'space-1' });

    await vi.waitFor(() => expect(getSharedSpaceAlbums).toHaveBeenCalledWith({ id: 'space-1' }));
    expect(page.getByRole('combobox').element()).toBeEnabled();
  });

  it('leaves a SpaceAlbumName field disabled until a space is chosen', async () => {
    // C2
    await renderSchema({});

    expect(
      await vi.waitFor(() => page.getByText('Choose a space first', { exact: true }).element()),
    ).toBeInTheDocument();
    expect(page.getByRole('combobox').element()).toBeDisabled();
    expect(getSharedSpaceAlbums).not.toHaveBeenCalled();
  });
});
