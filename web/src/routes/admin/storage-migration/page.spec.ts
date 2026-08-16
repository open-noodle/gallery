import { RoutedTo, type StorageRoutingStatusDto } from '@immich/sdk';
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Page from './+page.svelte';

// Task 9: the migration page becomes routing-aware. A file type whose new writes go the OTHER
// way than the selected migration direction can never converge, and the server rejects the
// combination outright — this page must make it unreachable in the UI: disable the offending
// checkboxes (with a reason) and honour the ?direction=&fileTypes= prefill the storage-routing
// settings page's "migrate" link sends over (see StorageSettings.svelte's migrateHref).

const mocks = vi.hoisted(() => ({
  getEstimate: vi.fn(),
  getStatus: vi.fn(),
  start: vi.fn(),
  rollback: vi.fn(),
  getRoutingStatus: vi.fn(),
}));

vi.mock('@immich/sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@immich/sdk')>();
  return {
    ...actual,
    getEstimate: mocks.getEstimate,
    getStatus: mocks.getStatus,
    start: mocks.start,
    rollback: mocks.rollback,
    getRoutingStatus: mocks.getRoutingStatus,
  };
});

// Non-reactive stand-in for $app/state's `page` — the component only reads page.url.searchParams
// once, synchronously, inside onMount, so a plain mutable object (mutated per-test before render)
// is enough; no $state-backed reactivity needed here (contrast the map page's mock).
const mockPage = vi.hoisted(() => ({ url: new URL('https://gallery.test/admin/storage-migration') }));
vi.mock('$app/state', () => ({ page: mockPage }));

vi.mock('$lib/components/layouts/AdminPageLayout.svelte', async () => {
  const { default: stub } = await import('@test-data/mocks/admin-page-layout.stub.svelte');
  return { default: stub };
});

const makeRoutingStatus = (overrides: Partial<StorageRoutingStatusDto> = {}): StorageRoutingStatusDto => ({
  originals: { routedTo: RoutedTo.Disk, misplacedCount: 0 },
  thumbnails: { routedTo: RoutedTo.Disk, misplacedCount: 0 },
  encodedVideo: { routedTo: RoutedTo.Disk, misplacedCount: 0 },
  ...overrides,
});

const makePageData = () => ({ meta: { title: 'Storage Migration' } });

const blockedThumbnailKindLabels = [
  'admin.storage_migration_file_type_thumbnails',
  'admin.storage_migration_file_type_previews',
  'admin.storage_migration_file_type_full_size',
  'admin.storage_migration_file_type_person_thumbnails',
  'admin.storage_migration_file_type_profile_images',
];

describe('storage migration +page.svelte', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPage.url = new URL('https://gallery.test/admin/storage-migration');
    mocks.getEstimate.mockResolvedValue(
      JSON.stringify({ direction: 'toS3', fileCounts: { total: 0 }, estimatedSizeBytes: 0 }),
    );
    mocks.getStatus.mockResolvedValue(
      JSON.stringify({ isActive: false, active: 0, waiting: 0, completed: 0, failed: 0, delayed: 0, paused: 0 }),
    );
    mocks.getRoutingStatus.mockResolvedValue(makeRoutingStatus());
  });

  it('disables file types whose routing contradicts the selected direction', async () => {
    // thumbnails-kind files are routed to S3; switching the direction to "S3 to disk" (target
    // 'disk') makes that kind non-convergent, so every file type mapped to it must be disabled.
    mocks.getRoutingStatus.mockResolvedValue(
      makeRoutingStatus({ thumbnails: { routedTo: RoutedTo.S3, misplacedCount: 5 } }),
    );

    render(Page, { props: { data: makePageData() } });

    await waitFor(() => expect(mocks.getRoutingStatus).toHaveBeenCalledTimes(1));

    await fireEvent.click(screen.getByRole('radio', { name: 'admin.storage_migration_s3_to_disk' }));

    for (const name of blockedThumbnailKindLabels) {
      await waitFor(() => {
        const checkbox = screen.getByRole('checkbox', { name });
        expect(checkbox).toBeDisabled();
        expect(checkbox).toHaveAttribute('title', 'admin.storage_migration_blocked_by_routing');
      });
    }

    // originals-kind files (routedTo: 'disk' by default) still converge under a toDisk migration.
    const originalsCheckbox = screen.getByRole('checkbox', { name: 'admin.storage_migration_file_type_originals' });
    expect(originalsCheckbox).not.toBeDisabled();
    expect(originalsCheckbox).not.toHaveAttribute('title');
  });

  it('prefills direction and file types from query params', async () => {
    mockPage.url = new URL('https://gallery.test/admin/storage-migration?direction=toS3&fileTypes=thumbnails,previews');

    render(Page, { props: { data: makePageData() } });

    await waitFor(() =>
      expect(screen.getByRole('radio', { name: 'admin.storage_migration_disk_to_s3' })).toBeChecked(),
    );
    expect(screen.getByRole('radio', { name: 'admin.storage_migration_s3_to_disk' })).not.toBeChecked();

    expect(screen.getByRole('checkbox', { name: 'admin.storage_migration_file_type_thumbnails' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'admin.storage_migration_file_type_previews' })).toBeChecked();

    for (const name of [
      'admin.storage_migration_file_type_originals',
      'admin.storage_migration_file_type_full_size',
      'admin.storage_migration_file_type_encoded_videos',
      'admin.storage_migration_file_type_sidecars',
      'admin.storage_migration_file_type_person_thumbnails',
      'admin.storage_migration_file_type_profile_images',
    ]) {
      expect(screen.getByRole('checkbox', { name })).not.toBeChecked();
    }
  });
});
