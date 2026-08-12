import { Route } from '$lib/route';
import { load } from './+page';

// The declines-only manage page was replaced by the unified Resolutions page (declines + locks). This route
// stays alive purely as a 307 redirect so old links/bookmarks don't 404 — it never authenticates or fetches
// anything of its own.
describe('face cleanup declined page load (redirect)', () => {
  it('redirects to the unified resolutions page with a 307', () => {
    let caught: unknown;
    try {
      load();
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({ status: 307, location: Route.faceCleanupResolutions() });
  });
});
