import type { BreadcrumbItem } from '@immich/ui';
import { describe, expect, it } from 'vitest';
import { Route } from '$lib/route';
import { faceCleanupBreadcrumbs, faceCleanupRootCrumb, guidedCrumb, manualCrumb } from './breadcrumbs';

// The builder owns the console's page hierarchy. Two invariants carry the design and are asserted directly
// here rather than through six rendered pages: (1) a mode's label and its route are bound together, so the
// label `Face cleanup` can never again point at /scan; (2) the LAST crumb never carries an href, so a page
// cannot link to itself and every page can write its own crumb identically to how an ancestor writes it.

// `$t` is typed over the generated key union, so a test double must be cast rather than declared
// `(key: string) => string` — see the Translations note in breadcrumbs.ts.
const t = ((key: string) => key) as unknown as Parameters<typeof faceCleanupBreadcrumbs>[0];

describe('faceCleanupBreadcrumbs', () => {
  it('gives the landing page a single crumb that is not a link', () => {
    expect(faceCleanupBreadcrumbs(t)).toEqual([{ title: 'admin.face_cleanup' }]);
  });

  it('links the root crumb as soon as there is a tail', () => {
    const trail = faceCleanupBreadcrumbs(t, guidedCrumb(t));

    expect(trail[0]).toEqual({ title: 'admin.face_cleanup', href: Route.faceCleanup() });
  });

  it('strips the href from a trailing mode crumb', () => {
    const trail = faceCleanupBreadcrumbs(t, manualCrumb(t));

    expect(trail).toHaveLength(2);
    expect(trail[1]).toEqual({ title: 'admin.face_cleanup_mode_manual' });
  });

  it('keeps the href on an intermediate mode crumb', () => {
    const trail = faceCleanupBreadcrumbs(t, guidedCrumb(t), { title: 'Aurelia' });

    expect(trail).toEqual([
      { title: 'admin.face_cleanup', href: Route.faceCleanup() },
      { title: 'admin.face_cleanup_mode_guided', href: Route.faceCleanupScan() },
      { title: 'Aurelia' },
    ]);
  });

  it('pairs each mode label with its own route', () => {
    expect(guidedCrumb(t)).toEqual({ title: 'admin.face_cleanup_mode_guided', href: Route.faceCleanupScan() });
    expect(manualCrumb(t)).toEqual({ title: 'admin.face_cleanup_mode_manual', href: Route.faceCleanupPeople() });
    expect(faceCleanupRootCrumb(t)).toEqual({ title: 'admin.face_cleanup', href: Route.faceCleanup() });
  });

  // Boundaries.

  it('passes through a trailing crumb that never had an href', () => {
    const trail = faceCleanupBreadcrumbs(t, { title: 'Aurelia' });

    expect(trail[1]).toEqual({ title: 'Aurelia' });
  });

  it('never adds an href to an intermediate crumb that lacks one', () => {
    const trail = faceCleanupBreadcrumbs(t, { title: 'middle' }, { title: 'leaf' });

    expect(trail[1]).toEqual({ title: 'middle' });
  });

  it('passes an empty leaf title through rather than dropping the crumb', () => {
    // Guarding a blank person name belongs on the page that knows what a person is (see the guided page's
    // trim check), not here. Asserted so the two cannot both assume the other handles it.
    const trail = faceCleanupBreadcrumbs(t, manualCrumb(t), { title: '' });

    expect(trail).toHaveLength(3);
    expect(trail[2]).toEqual({ title: '' });
  });

  it('does not mutate the crumbs it is given', () => {
    const shared: BreadcrumbItem = guidedCrumb(t);

    faceCleanupBreadcrumbs(t, shared); // would strip `shared.href` if it mutated
    const personTrail = faceCleanupBreadcrumbs(t, shared, { title: 'Aurelia' });

    expect(shared.href).toBe(Route.faceCleanupScan());
    expect(personTrail[1].href).toBe(Route.faceCleanupScan());
  });
});
