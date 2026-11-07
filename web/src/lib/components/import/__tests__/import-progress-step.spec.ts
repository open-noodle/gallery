import type { ImportProgress } from '#lib/managers/import-manager.svelte.ts';
import { expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import ImportProgressStep from '../import-progress-step.svelte';

function makeProgress(overrides?: Partial<ImportProgress>): ImportProgress {
  return {
    imported: 25,
    skipped: 3,
    errors: 2,
    total: 100,
    currentFile: 'IMG_4567.jpg',
    currentAlbum: 'Vacation',
    albumsCreated: 2,
    errorLog: [],
    ...overrides,
  };
}

describe('ImportProgressStep', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('shows progress bar in importing mode', async () => {
    const { getByTestId } = await render(ImportProgressStep, {
      progress: makeProgress(),
      total: 100,
      isPaused: false,
      isComplete: false,
      onTogglePause: vi.fn(),
    });

    await expect.element(getByTestId('import-progress-bar')).toBeInTheDocument();
  });

  it('shows status counters', async () => {
    const { getByTestId } = await render(ImportProgressStep, {
      progress: makeProgress({ imported: 25, skipped: 3, errors: 2 }),
      total: 100,
      isPaused: false,
      isComplete: false,
      onTogglePause: vi.fn(),
    });

    await expect.element(getByTestId('status-imported')).toMatchTextContent('25');
    await expect.element(getByTestId('status-skipped')).toMatchTextContent('3');
    await expect.element(getByTestId('status-errors')).toMatchTextContent('2');
  });

  it('shows pause button', async () => {
    const onTogglePause = vi.fn();
    const { getByTestId } = await render(ImportProgressStep, {
      progress: makeProgress(),
      total: 100,
      isPaused: false,
      isComplete: false,
      onTogglePause,
    });

    await expect.element(getByTestId('pause-button')).toBeInTheDocument();
  });

  it('shows completion state when isComplete', async () => {
    const { getByText } = await render(ImportProgressStep, {
      progress: makeProgress({ imported: 95, skipped: 3, errors: 2, albumsCreated: 4 }),
      total: 100,
      isPaused: false,
      isComplete: true,
      onTogglePause: vi.fn(),
    });

    await expect.element(getByText('import_complete')).toBeInTheDocument();
  });

  it('shows View Photos/View Albums links in complete state', async () => {
    const { getByText } = await render(ImportProgressStep, {
      progress: makeProgress({ imported: 95, skipped: 3, errors: 2, albumsCreated: 4 }),
      total: 100,
      isPaused: false,
      isComplete: true,
      onTogglePause: vi.fn(),
    });

    await expect.element(getByText('import_view_photos')).toBeInTheDocument();
    await expect.element(getByText('import_view_albums')).toBeInTheDocument();
  });
});
