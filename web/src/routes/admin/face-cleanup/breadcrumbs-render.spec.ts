import { Breadcrumbs } from '@immich/ui';
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import { Route } from '$lib/route';
import { faceCleanupBreadcrumbs, guidedCrumb } from './breadcrumbs';

// Every other test asserts against admin-page-layout.stub.svelte, never the real @immich/ui
// Breadcrumbs. This closes that seam: it feeds a real builder trail into the real component and checks the
// rendered DOM, so a wrong assumption about how `href` is turned into a link cannot hide behind the stub.
const t = ((key: string) => key) as unknown as Parameters<typeof faceCleanupBreadcrumbs>[0];

describe('real @immich/ui Breadcrumbs integration', () => {
  it('renders ancestors as real links and the leaf as plain text', () => {
    render(Breadcrumbs, {
      props: { items: faceCleanupBreadcrumbs(t, guidedCrumb(t), { title: 'Aurelia' }) },
    });

    const root = screen.getByRole('link', { name: 'admin.face_cleanup' });
    expect(root).toHaveAttribute('href', Route.faceCleanup());

    const guided = screen.getByRole('link', { name: 'admin.face_cleanup_mode_guided' });
    expect(guided).toHaveAttribute('href', Route.faceCleanupScan());

    // The leaf is present but must NOT be clickable.
    expect(screen.getByText('Aurelia')).toBeInTheDocument();
    expect(screen.getAllByRole('link')).toHaveLength(2);
  });

  it('renders a mode page trail with the leaf unlinked', () => {
    render(Breadcrumbs, { props: { items: faceCleanupBreadcrumbs(t, guidedCrumb(t)) } });

    expect(screen.getByRole('link', { name: 'admin.face_cleanup' })).toHaveAttribute('href', Route.faceCleanup());
    expect(screen.getByText('admin.face_cleanup_mode_guided')).toBeInTheDocument();
    expect(screen.getAllByRole('link')).toHaveLength(1);
  });

  it('renders the landing trail with no links at all', () => {
    render(Breadcrumbs, { props: { items: faceCleanupBreadcrumbs(t) } });

    expect(screen.getByText('admin.face_cleanup')).toBeInTheDocument();
    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });
});
