import { redirect } from '@sveltejs/kit';
import { Route } from '$lib/route';
import type { PageLoad } from './$types';

// The declines-only manage page was replaced by the unified Resolutions page (declines + locks). Keep this
// route alive as a redirect so old links/bookmarks don't 404.
export const load = (() => redirect(307, Route.faceCleanupResolutions())) satisfies PageLoad;
