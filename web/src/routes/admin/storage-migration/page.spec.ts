import { RoutedTo, StorageMigrationDirection, type StorageRoutingStatusDto } from '@immich/sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent, type Locator } from 'vitest/browser';
import Page from './+page.svelte';

const findOne = async (locator: Locator) => {
  await expect.element(locator).toBeInTheDocument();
  return locator.element() as HTMLElement;
};

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

vi.mock('#lib/components/layouts/AdminPageLayout.svelte', async () => {
  const { default: stub } = await import('#lib/gallery/__mocks__/admin-page-layout.stub.svelte');
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

    await render(Page, { props: { data: makePageData() } });

    await vi.waitFor(() => expect(mocks.getRoutingStatus).toHaveBeenCalledTimes(1));

    await userEvent.click(page.getByRole('radio', { name: 'admin.storage_migration_s3_to_disk' }).element());

    for (const name of blockedThumbnailKindLabels) {
      await vi.waitFor(() => {
        const checkbox = page.getByRole('checkbox', { name }).element();
        expect(checkbox).toBeDisabled();
        expect(checkbox).toHaveAttribute('title', 'admin.storage_migration_blocked_by_routing');
      });
    }

    // originals-kind files (routedTo: 'disk' by default) still converge under a toDisk migration.
    const originalsCheckbox = page
      .getByRole('checkbox', { name: 'admin.storage_migration_file_type_originals' })
      .element();
    expect(originalsCheckbox).not.toBeDisabled();
    expect(originalsCheckbox).not.toHaveAttribute('title');
  });

  it('prefills direction and file types from query params', async () => {
    mockPage.url = new URL('https://gallery.test/admin/storage-migration?direction=toS3&fileTypes=thumbnails,previews');

    await render(Page, { props: { data: makePageData() } });

    await vi.waitFor(() =>
      expect(page.getByRole('radio', { name: 'admin.storage_migration_disk_to_s3' }).element()).toBeChecked(),
    );
    expect(page.getByRole('radio', { name: 'admin.storage_migration_s3_to_disk' }).element()).not.toBeChecked();

    expect(
      page.getByRole('checkbox', { name: 'admin.storage_migration_file_type_thumbnails' }).element(),
    ).toBeChecked();
    expect(page.getByRole('checkbox', { name: 'admin.storage_migration_file_type_previews' }).element()).toBeChecked();

    for (const name of [
      'admin.storage_migration_file_type_originals',
      'admin.storage_migration_file_type_full_size',
      'admin.storage_migration_file_type_encoded_videos',
      'admin.storage_migration_file_type_sidecars',
      'admin.storage_migration_file_type_person_thumbnails',
      'admin.storage_migration_file_type_profile_images',
    ]) {
      expect(page.getByRole('checkbox', { name }).element()).not.toBeChecked();
    }
  });

  // Disabling a checkbox never clears its bound value: thumbnails starts checked (the page's
  // default) and isn't blocked yet (direction is toS3, thumbnails routedTo 's3' — matches).
  // Flipping direction to "S3 to disk" makes it non-convergent, but its checkbox stays checked
  // (see the "disables ..." test above) — only handleStart's own `&& !isBlocked(key)` guard keeps
  // it out of the request actually sent to the server. Without that guard this test fails: the
  // stale `true` would be submitted and the server would reject the whole migration.
  it('excludes a now-blocked file type from the submitted migration even though its checkbox is still checked', async () => {
    mocks.getRoutingStatus.mockResolvedValue(
      makeRoutingStatus({ thumbnails: { routedTo: RoutedTo.S3, misplacedCount: 5 } }),
    );
    mocks.getEstimate.mockResolvedValue(
      JSON.stringify({ direction: 'toDisk', fileCounts: { total: 10 }, estimatedSizeBytes: 1000 }),
    );
    mocks.start.mockResolvedValue({ batchId: 'batch-1' });

    await render(Page, { props: { data: makePageData() } });

    await vi.waitFor(() => expect(mocks.getRoutingStatus).toHaveBeenCalledTimes(1));

    await userEvent.click(page.getByRole('radio', { name: 'admin.storage_migration_s3_to_disk' }).element());

    const thumbnailsCheckbox = page
      .getByRole('checkbox', { name: 'admin.storage_migration_file_type_thumbnails' })
      .element();
    await vi.waitFor(() => expect(thumbnailsCheckbox).toBeDisabled());
    expect(thumbnailsCheckbox).toBeChecked();

    const startButton = await findOne(page.getByRole('button', { name: 'admin.storage_migration_start_heading' }));
    await vi.waitFor(() => expect(startButton).not.toBeDisabled());
    await userEvent.click(startButton);

    await vi.waitFor(() => expect(mocks.start).toHaveBeenCalledTimes(1));
    expect(mocks.start).toHaveBeenCalledWith({
      storageMigrationStartDto: expect.objectContaining({
        direction: StorageMigrationDirection.ToDisk,
        fileTypes: expect.objectContaining({
          thumbnails: false, // blocked kind, checkbox still checked — excluded anyway
          originals: true, // still-convergent kind — included
        }),
      }),
    });
  });
});
