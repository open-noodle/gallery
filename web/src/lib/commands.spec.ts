import { getMyImmichLink } from '$lib/commands';

// `page` is a SvelteKit rune-backed object; the command only ever reads page.url.
const mockPage = { url: new URL('https://abc123.noodlegallery.de/photos?at=2026-08-07#hash') };
vi.mock('$app/state', () => ({
  get page() {
    return mockPage;
  },
}));

describe('getMyImmichLink', () => {
  it('builds the link on the instance the user is actually on', () => {
    // Upstream hardcodes https://my.immich.app, a proxy that redirects a visitor
    // to whichever instance THEY have configured there. A Noodle Gallery user has
    // configured nothing on that domain, so the copied link lands them on an
    // Immich-branded setup page — and the link they share names immich.
    expect(getMyImmichLink().origin).toBe('https://abc123.noodlegallery.de');
  });

  it('keeps the path and query so the link points at the same page', () => {
    expect(getMyImmichLink().href).toBe('https://abc123.noodlegallery.de/photos?at=2026-08-07');
  });

  it('drops the fragment, which is local to the sharer', () => {
    expect(getMyImmichLink().hash).toBe('');
  });
});
