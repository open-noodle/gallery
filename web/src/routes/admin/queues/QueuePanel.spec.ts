import { QueueName, type QueueResponseDto } from '@immich/sdk';
import '@testing-library/jest-dom';
import { fireEvent, screen, waitFor } from '@testing-library/svelte';
import { init, register, waitLocale } from 'svelte-i18n';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithTooltips } from '$tests/helpers';
import QueuePanel from './QueuePanel.svelte';

const mocks = vi.hoisted(() => ({
  showDialog: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock(import('@immich/sdk'), async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, runQueueCommandLegacy: vi.fn() };
});

vi.mock(import('$lib/managers/queue-manager.svelte'), () => ({
  queueManager: { refresh: mocks.refresh } as never,
}));

vi.mock(import('$lib/managers/feature-flags-manager.svelte'), () => ({
  featureFlagsManager: {
    get value() {
      return { sidecar: true, smartSearch: true, duplicateDetection: true, facialRecognition: true, ocr: true };
    },
  } as never,
}));

vi.mock('@immich/ui', async (original) => {
  const mod = await original<typeof import('@immich/ui')>();
  return {
    ...mod,
    modalManager: { showDialog: mocks.showDialog, show: vi.fn() },
    toastManager: { primary: vi.fn(), success: vi.fn(), danger: vi.fn() },
  };
});

const makeQueue = (overrides: Partial<QueueResponseDto> = {}): QueueResponseDto =>
  ({
    name: QueueName.PetRecognition,
    isPaused: false,
    jobTypes: [],
    statistics: { active: 0, completed: 0, delayed: 0, failed: 0, paused: 0, waiting: 0 },
    ...overrides,
  }) as unknown as QueueResponseDto;

describe('QueuePanel', () => {
  beforeAll(async () => {
    // Load the real en bundle: this test PINS the exact updated copy of
    // admin.confirm_reprocess_all_pet_recognition (R8.6), which only means something against real
    // translated text, not the raw dev-fallback key.
    register('en-US', () => import('$i18n/en.json'));
    await init({ fallbackLocale: 'en-US' });
    await waitLocale('en-US');
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.showDialog.mockResolvedValue(false);
  });

  // R8.6 (review-fixes F13, pin on NEW copy): the force-reset confirm must state that the purge
  // always happens and that reprocessing runs only while pet detection is enabled — the old copy
  // only mentioned the purge.
  it('shows the updated force-reset warning for pet recognition', async () => {
    renderWithTooltips(QueuePanel, { queues: [makeQueue()] });

    await fireEvent.click(screen.getByText('Reset'));

    await waitFor(() => {
      expect(mocks.showDialog).toHaveBeenCalledWith({
        prompt:
          'Are you sure you want to reprocess all pet recognition? This always deletes all named pets and their embeddings. Reprocessing only runs while pet detection is enabled.',
      });
    });
  });
});
