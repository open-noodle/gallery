import { Route } from '#lib/route.ts';
import { test } from '#test/unit/fixtures.ts';
import { AssetVisibility } from '@immich/sdk';
import { expect } from 'vitest';
import { page } from 'vitest/browser';
import Page from './+page.svelte';
import { load } from './+page.ts';

test('full path results query the existing metadata endpoint and display the searched folder', async ({
  router,
  render,
  api,
  settle,
}) => {
  const originalPath = '/mnt/external/panorama 1/original pics';
  await router.goto(Route.search({ originalPath, visibility: AssetVisibility.Timeline, withSharedSpaces: true }));
  await render(Page, load);
  await settle();
  expect(api.searchAssets).toHaveBeenCalledWith({
    body: {
      originalPath,
      visibility: AssetVisibility.Timeline,
      withSharedSpaces: true,
      page: 1,
      withExif: true,
    },
  });
  expect(api.searchSmart).not.toHaveBeenCalled();
  await expect.element(page.getByTestId('control-bar').getByText(originalPath, { exact: true })).toBeInTheDocument();
});

for (const scope of [
  { spaceId: '00000000-0000-4000-8000-000000000001' },
  { albumIds: ['00000000-0000-4000-8000-000000000002'] },
]) {
  test(`path results retain explicit ${'spaceId' in scope ? 'space' : 'album'} scope`, async ({
    router,
    render,
    api,
    settle,
  }) => {
    const terms = {
      ...scope,
      originalPath: '/panoramas',
      visibility: AssetVisibility.Timeline,
      withSharedSpaces: false,
    };
    await router.goto(Route.search(terms));
    await render(Page, load);
    await settle();
    expect(api.searchAssets).toHaveBeenCalledWith({ body: { ...terms, page: 1, withExif: true } });
    expect(api.searchSmart).not.toHaveBeenCalled();
  });
}
