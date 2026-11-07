import { get } from 'svelte/store';

// `persisted()` reads localStorage once, when the store is first created, and caches the store by key for the
// page's lifetime; browser mode cannot reset modules. Seed storage before this file's only import of the module.
const CROP_KEY = 'crop-faces-from-asset';

describe('cropFacesFromAsset on load', () => {
  afterAll(() => {
    localStorage.removeItem(CROP_KEY);
  });

  it('reads a previously stored choice on load', async () => {
    localStorage.setItem(CROP_KEY, 'false');

    const reloaded = await import('#lib/gallery/stores/preferences.store.ts');

    expect(get(reloaded.cropFacesFromAsset)).toBe(false);
  });
});
