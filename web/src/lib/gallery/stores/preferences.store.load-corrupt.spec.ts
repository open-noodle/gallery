import { get } from 'svelte/store';

// `persisted()` reads localStorage once, when the store is first created, and caches the store by key for the
// page's lifetime; browser mode cannot reset modules. Seed storage before this file's only import of the module.
const CROP_KEY = 'crop-faces-from-asset';

describe('cropFacesFromAsset on load', () => {
  afterAll(() => {
    localStorage.removeItem(CROP_KEY);
  });

  it('degrades a corrupt localStorage value to the default instead of throwing', async () => {
    localStorage.setItem(CROP_KEY, 'not-valid-json');
    const parseError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const reloaded = await import('#lib/gallery/stores/preferences.store.ts');

    expect(get(reloaded.cropFacesFromAsset)).toBe(true);
    // The corrupt value was actually read (and rejected), not skipped.
    expect(parseError).toHaveBeenCalledWith(expect.stringContaining(CROP_KEY), expect.anything());
  });
});
