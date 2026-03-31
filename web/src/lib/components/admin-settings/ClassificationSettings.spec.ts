import ClassificationSettings from '$lib/components/admin-settings/ClassificationSettings.svelte';
import { Action2, getConfig, scanClassification, updateConfig, type SystemConfigDto } from '@immich/sdk';
import { modalManager, toastManager } from '@immich/ui';
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@immich/sdk', () => ({
  getConfig: vi.fn(),
  updateConfig: vi.fn(),
  scanClassification: vi.fn(),
  Action2: { Tag: 'tag', TagAndArchive: 'tag_and_archive' },
}));

vi.mock('@immich/ui', async (original) => {
  const mod = await original<typeof import('@immich/ui')>();
  return {
    ...mod,
    // Replace IconButton with a plain button to avoid Tooltip.Provider context requirement
    IconButton: mod.Button,
    toastManager: { primary: vi.fn(), success: vi.fn(), danger: vi.fn() },
    modalManager: { showDialog: vi.fn(), show: vi.fn() },
  };
});

const makeConfig = (categories: SystemConfigDto['classification']['categories'] = []): SystemConfigDto =>
  ({
    classification: { enabled: true, categories },
  }) as unknown as SystemConfigDto;

const makeCategory = (
  overrides: Partial<SystemConfigDto['classification']['categories'][number]> = {},
): SystemConfigDto['classification']['categories'][number] => ({
  name: 'Screenshots',
  prompts: ['a screenshot'],
  similarity: 0.28,
  action: Action2.Tag,
  enabled: true,
  ...overrides,
});

describe('ClassificationSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getConfig).mockResolvedValue(makeConfig());
    vi.mocked(updateConfig).mockResolvedValue(void 0 as unknown as SystemConfigDto);
    // @ts-expect-error mock returns void but SDK type is string
    vi.mocked(scanClassification).mockResolvedValue(void 0);
  });

  it('should render empty state when no categories', async () => {
    render(ClassificationSettings);
    await waitFor(() => {
      expect(screen.getByText('No classification categories yet. Add one to get started.')).toBeInTheDocument();
    });
  });

  it('should render categories from config', async () => {
    vi.mocked(getConfig).mockResolvedValue(makeConfig([makeCategory()]));
    render(ClassificationSettings);
    await waitFor(() => {
      expect(screen.getByText('Screenshots')).toBeInTheDocument();
    });
  });

  it('should show create form when Add Category is clicked', async () => {
    render(ClassificationSettings);
    await waitFor(() => {
      expect(screen.getByText('Add Category')).toBeInTheDocument();
    });

    await fireEvent.click(screen.getByText('Add Category'));

    expect(screen.getByText('New Category')).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toBeInTheDocument();
  });

  it('should save new category via updateConfig', async () => {
    render(ClassificationSettings);
    await waitFor(() => {
      expect(screen.getByText('Add Category')).toBeInTheDocument();
    });

    await fireEvent.click(screen.getByText('Add Category'));

    await fireEvent.input(screen.getByLabelText('Name'), { target: { value: 'Receipts' } });
    await fireEvent.input(screen.getByLabelText('Prompts (one per line)'), { target: { value: 'a receipt' } });

    await fireEvent.click(screen.getByText('Save'));

    await waitFor(() => {
      expect(updateConfig).toHaveBeenCalledWith({
        systemConfigDto: expect.objectContaining({
          classification: expect.objectContaining({
            categories: [
              expect.objectContaining({
                name: 'Receipts',
                prompts: ['a receipt'],
              }),
            ],
          }),
        }),
      });
    });
  });

  it('should show rescan dialog when similarity is increased', async () => {
    vi.mocked(getConfig).mockResolvedValue(makeConfig([makeCategory({ similarity: 0.28 })]));
    vi.mocked(modalManager.showDialog).mockResolvedValue(false);

    render(ClassificationSettings);
    await waitFor(() => {
      expect(screen.getByText('Screenshots')).toBeInTheDocument();
    });

    await fireEvent.click(screen.getByLabelText('Edit'));

    const slider = screen.getByRole('slider');
    await fireEvent.input(slider, { target: { value: '0.40' } });

    await fireEvent.click(screen.getByText('Save'));

    await waitFor(() => {
      expect(modalManager.showDialog).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Rescan photos?',
        }),
      );
    });
  });

  it('should trigger scan when rescan dialog is confirmed', async () => {
    vi.mocked(getConfig).mockResolvedValue(makeConfig([makeCategory({ similarity: 0.28 })]));
    vi.mocked(modalManager.showDialog).mockResolvedValue(true);

    render(ClassificationSettings);
    await waitFor(() => {
      expect(screen.getByText('Screenshots')).toBeInTheDocument();
    });

    await fireEvent.click(screen.getByLabelText('Edit'));
    await fireEvent.input(screen.getByRole('slider'), { target: { value: '0.40' } });
    await fireEvent.click(screen.getByText('Save'));

    await waitFor(() => {
      expect(scanClassification).toHaveBeenCalled();
      expect(toastManager.primary).toHaveBeenCalledWith('Rescan started — existing auto-tags will be re-evaluated');
    });
  });

  it('should NOT show rescan dialog when similarity is decreased', async () => {
    vi.mocked(getConfig).mockResolvedValue(makeConfig([makeCategory({ similarity: 0.35 })]));

    render(ClassificationSettings);
    await waitFor(() => {
      expect(screen.getByText('Screenshots')).toBeInTheDocument();
    });

    await fireEvent.click(screen.getByLabelText('Edit'));
    await fireEvent.input(screen.getByRole('slider'), { target: { value: '0.20' } });
    await fireEvent.click(screen.getByText('Save'));

    await waitFor(() => {
      expect(updateConfig).toHaveBeenCalled();
    });

    expect(modalManager.showDialog).not.toHaveBeenCalled();
  });

  it('should NOT show rescan dialog when creating a new category', async () => {
    render(ClassificationSettings);
    await waitFor(() => {
      expect(screen.getByText('Add Category')).toBeInTheDocument();
    });

    await fireEvent.click(screen.getByText('Add Category'));
    await fireEvent.input(screen.getByLabelText('Name'), { target: { value: 'Test' } });
    await fireEvent.input(screen.getByLabelText('Prompts (one per line)'), { target: { value: 'test prompt' } });
    await fireEvent.click(screen.getByText('Save'));

    await waitFor(() => {
      expect(updateConfig).toHaveBeenCalled();
    });

    expect(modalManager.showDialog).not.toHaveBeenCalled();
  });

  it('should call scanClassification when Scan All Libraries is confirmed', async () => {
    vi.mocked(modalManager.showDialog).mockResolvedValue(true);

    render(ClassificationSettings);
    await waitFor(() => {
      expect(screen.getByText('Scan All Libraries')).toBeInTheDocument();
    });

    await fireEvent.click(screen.getByText('Scan All Libraries'));

    await waitFor(() => {
      expect(scanClassification).toHaveBeenCalled();
    });
  });

  it('should NOT scan when Scan All Libraries dialog is cancelled', async () => {
    vi.mocked(modalManager.showDialog).mockResolvedValue(false);

    render(ClassificationSettings);
    await waitFor(() => {
      expect(screen.getByText('Scan All Libraries')).toBeInTheDocument();
    });

    await fireEvent.click(screen.getByText('Scan All Libraries'));

    await waitFor(() => {
      expect(modalManager.showDialog).toHaveBeenCalled();
    });

    expect(scanClassification).not.toHaveBeenCalled();
  });

  it('should delete category via updateConfig', async () => {
    vi.mocked(getConfig).mockResolvedValue(
      makeConfig([makeCategory(), makeCategory({ name: 'Receipts', prompts: ['receipt'] })]),
    );

    render(ClassificationSettings);
    await waitFor(() => {
      expect(screen.getByText('Screenshots')).toBeInTheDocument();
      expect(screen.getByText('Receipts')).toBeInTheDocument();
    });

    const deleteButtons = screen.getAllByLabelText('Delete');
    await fireEvent.click(deleteButtons[0]);

    await waitFor(() => {
      expect(updateConfig).toHaveBeenCalledWith({
        systemConfigDto: expect.objectContaining({
          classification: expect.objectContaining({
            categories: [expect.objectContaining({ name: 'Receipts' })],
          }),
        }),
      });
    });
  });
});
