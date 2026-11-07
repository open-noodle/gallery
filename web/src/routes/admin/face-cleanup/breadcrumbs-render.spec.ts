import { Route } from '#lib/route.ts';
import { Breadcrumbs } from '@immich/ui';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import { faceCleanupBreadcrumbs, guidedCrumb } from './breadcrumbs';
import { getAll } from './dom-queries.test-helpers';

// Every other test asserts against admin-page-layout.stub.svelte, never the real @immich/ui
// Breadcrumbs. This closes that seam: it feeds a real builder trail into the real component and checks the
// rendered DOM, so a wrong assumption about how `href` is turned into a link cannot hide behind the stub.
const t = ((key: string) => key) as unknown as Parameters<typeof faceCleanupBreadcrumbs>[0];

describe('real @immich/ui Breadcrumbs integration', () => {
  it('renders ancestors as real links and the leaf as plain text', async () => {
    await render(Breadcrumbs, {
      props: { items: faceCleanupBreadcrumbs(t, guidedCrumb(t), { title: 'Aurelia' }) },
    });

    const root = page.getByRole('link', { name: 'admin.face_cleanup', exact: true }).element();
    expect(root).toHaveAttribute('href', Route.faceCleanup());

    const guided = page.getByRole('link', { name: 'admin.face_cleanup_mode_guided', exact: true }).element();
    expect(guided).toHaveAttribute('href', Route.faceCleanupScan());

    // The leaf is present but must NOT be clickable.
    expect(page.getByText('Aurelia', { exact: true }).element()).toBeInTheDocument();
    expect(getAll(page.getByRole('link'))).toHaveLength(2);
  });

  it('renders a mode page trail with the leaf unlinked', async () => {
    await render(Breadcrumbs, { props: { items: faceCleanupBreadcrumbs(t, guidedCrumb(t)) } });

    expect(page.getByRole('link', { name: 'admin.face_cleanup', exact: true }).element()).toHaveAttribute(
      'href',
      Route.faceCleanup(),
    );
    expect(page.getByText('admin.face_cleanup_mode_guided', { exact: true }).element()).toBeInTheDocument();
    expect(getAll(page.getByRole('link'))).toHaveLength(1);
  });

  it('renders the landing trail with no links at all', async () => {
    await render(Breadcrumbs, { props: { items: faceCleanupBreadcrumbs(t) } });

    expect(page.getByText('admin.face_cleanup', { exact: true }).element()).toBeInTheDocument();
    expect(page.getByRole('link').elements()).toHaveLength(0);
  });
});
