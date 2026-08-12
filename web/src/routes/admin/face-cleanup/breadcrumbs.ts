import type { BreadcrumbItem } from '@immich/ui';
import type { Translations } from 'svelte-i18n';
import { Route } from '$lib/route';

// The single place the Face cleanup console's page hierarchy is written down. Before this module every page
// hand-wrote its own `BreadcrumbItem[]`, and two of them drifted: `/[personId]` and `/resolutions` both
// rendered the label "Face cleanup" on an href of /scan.
//
// NOT `(key: string) => string`. web/src/app.d.ts augments svelte-i18n so `$t` is
// `(id: Translations | MessageObject, options?) => string`. Under strictFunctionTypes `$t` is not assignable
// to a parameter typed over a widened `string` — tsc accepts it, `pnpm check:svelte` rejects it at every
// call site. See commit 2f89bc61232.
type Translate = (key: Translations) => string;

export const faceCleanupRootCrumb = (t: Translate): BreadcrumbItem => ({
  title: t('admin.face_cleanup'),
  href: Route.faceCleanup(),
});

export const guidedCrumb = (t: Translate): BreadcrumbItem => ({
  title: t('admin.face_cleanup_mode_guided'),
  href: Route.faceCleanupScan(),
});

export const manualCrumb = (t: Translate): BreadcrumbItem => ({
  title: t('admin.face_cleanup_mode_manual'),
  href: Route.faceCleanupPeople(),
});

/**
 * The root crumb followed by `tail`, with the LAST crumb's href removed — you never link to the page you are
 * standing on.
 *
 * That rule is what lets `guidedCrumb($t)` be written identically on /scan and on /[personId] and still
 * render unlinked on the first and linked on the second. No page decides for itself whether its own crumb
 * should be a link, so no page can get it wrong.
 *
 * Returns new objects; the caller's crumbs are never mutated.
 */
export const faceCleanupBreadcrumbs = (t: Translate, ...tail: BreadcrumbItem[]): BreadcrumbItem[] => {
  const trail = [faceCleanupRootCrumb(t), ...tail];

  return trail.map((crumb, index) => {
    if (index < trail.length - 1) {
      return { ...crumb };
    }
    // Named exactly `_`, not `_dropped`. web/eslint.config.js:105-110 sets
    // `varsIgnorePattern: '^_$'` — an anchored single underscore. `_dropped` fails the
    // zero-warnings lint gate; `_` passes. Verified against the real config.
    const { href: _, ...withoutHref } = crumb;
    return withoutHref;
  });
};
