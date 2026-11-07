import {
  Action,
  ClassificationFaceExclusion,
  getConfig,
  scanClassification,
  updateConfig,
  type AdminConfigDto,
} from '@immich/sdk';
import { modalManager, toastManager } from '@immich/ui';
import { init, register, waitLocale } from 'svelte-i18n';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';
import ClassificationSettings from './ClassificationSettings.svelte';

vi.mock('@immich/sdk', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@immich/sdk')>()),
  getConfig: vi.fn(),
  updateConfig: vi.fn(),
  scanClassification: vi.fn(),
  Action: { Tag: 'tag', TagAndArchive: 'tag_and_archive' },
  ClassificationFaceExclusion: {
    Off: 'off',
    AnyAssignedFace: 'any_assigned_face',
    NamedPeople: 'named_people',
    NamedVisiblePeople: 'named_visible_people',
  },
}));

const mockFeatureFlags = { configFile: false, smartSearch: true, trash: true };
vi.mock(import('#lib/managers/feature-flags-manager.svelte.js'), () => ({
  featureFlagsManager: {
    init: vi.fn(),
    loadFeatureFlags: vi.fn(),
    get value() {
      return mockFeatureFlags;
    },
  } as never,
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

const makeConfig = (categories: AdminConfigDto['classification']['categories'] = []): AdminConfigDto =>
  ({
    classification: { enabled: true, categories },
  }) as unknown as AdminConfigDto;

const makeCategory = (
  overrides: Partial<AdminConfigDto['classification']['categories'][number]> = {},
): AdminConfigDto['classification']['categories'][number] => ({
  name: 'Screenshots',
  prompts: ['a screenshot'],
  similarity: 0.28,
  action: Action.Tag,
  faceExclusion: ClassificationFaceExclusion.Off,
  enabled: true,
  ...overrides,
});

// A range input cannot be filled; set its value and fire the `input` event Svelte's binding listens to.
const setSlider = (slider: HTMLElement | SVGElement, value: string) => {
  (slider as HTMLInputElement).value = value;
  slider.dispatchEvent(new Event('input', { bubbles: true }));
};

describe('ClassificationSettings', () => {
  beforeAll(async () => {
    // Load the real en bundle so the component's `$t('admin.classification_*')` / `$t('name')` etc.
    // resolve to English text. This spec asserts on the user-facing labels, button text, dialog
    // titles, toast copy and summary badges, so the translated output is load-bearing
    // (the global setup's `dev` locale returns raw keys).
    register('en-US', () => import('#i18n/en.json'));
    await init({ fallbackLocale: 'en-US' });
    await waitLocale('en-US');
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockFeatureFlags.configFile = false;
    vi.mocked(getConfig).mockResolvedValue(makeConfig());
    vi.mocked(updateConfig).mockResolvedValue(void 0 as unknown as AdminConfigDto);
    // @ts-expect-error mock returns void but SDK type is string
    vi.mocked(scanClassification).mockResolvedValue(void 0);
  });

  it('should render empty state when no categories', async () => {
    await render(ClassificationSettings);
    await vi.waitFor(() => {
      expect(
        page.getByText('No classification categories yet. Add one to get started.', { exact: true }).element(),
      ).toBeInTheDocument();
    });
  });

  it('should render categories from config', async () => {
    vi.mocked(getConfig).mockResolvedValue(makeConfig([makeCategory()]));
    await render(ClassificationSettings);
    await vi.waitFor(() => {
      expect(page.getByText('Screenshots', { exact: true }).element()).toBeInTheDocument();
    });
  });

  it('should show create form when Add Category is clicked', async () => {
    await render(ClassificationSettings);
    await vi.waitFor(() => {
      expect(page.getByText('Add Category', { exact: true }).element()).toBeInTheDocument();
    });

    await userEvent.click(page.getByText('Add Category', { exact: true }));

    expect(page.getByText('New Category', { exact: true }).element()).toBeInTheDocument();
    expect(page.getByLabelText('Name', { exact: true }).element()).toBeInTheDocument();
  });

  it('should save new category via updateConfig', async () => {
    await render(ClassificationSettings);
    await vi.waitFor(() => {
      expect(page.getByText('Add Category', { exact: true }).element()).toBeInTheDocument();
    });

    await userEvent.click(page.getByText('Add Category', { exact: true }));

    await userEvent.fill(page.getByLabelText('Name', { exact: true }), 'Receipts');
    await userEvent.fill(page.getByLabelText('Prompts (one per line)', { exact: true }), 'a receipt');

    await userEvent.click(page.getByText('Save', { exact: true }));

    await vi.waitFor(() => {
      expect(updateConfig).toHaveBeenCalledWith({
        adminConfigDto: expect.objectContaining({
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
    vi.mocked(modalManager.showDialog as (...args: unknown[]) => Promise<boolean>).mockResolvedValue(false);

    await render(ClassificationSettings);
    await vi.waitFor(() => {
      expect(page.getByText('Screenshots', { exact: true }).element()).toBeInTheDocument();
    });

    await userEvent.click(page.getByLabelText('Edit', { exact: true }));

    const slider = page.getByRole('slider').element();
    setSlider(slider, '0.40');

    await userEvent.click(page.getByText('Save', { exact: true }));

    await vi.waitFor(() => {
      expect(modalManager.showDialog).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Rescan photos?',
        }),
      );
    });
  });

  it('should trigger scan when rescan dialog is confirmed', async () => {
    vi.mocked(getConfig).mockResolvedValue(makeConfig([makeCategory({ similarity: 0.28 })]));
    vi.mocked(modalManager.showDialog as (...args: unknown[]) => Promise<boolean>).mockResolvedValue(true);

    await render(ClassificationSettings);
    await vi.waitFor(() => {
      expect(page.getByText('Screenshots', { exact: true }).element()).toBeInTheDocument();
    });

    await userEvent.click(page.getByLabelText('Edit', { exact: true }));
    setSlider(page.getByRole('slider').element(), '0.40');
    await userEvent.click(page.getByText('Save', { exact: true }));

    await vi.waitFor(() => {
      expect(scanClassification).toHaveBeenCalled();
      expect(toastManager.primary).toHaveBeenCalledWith('Rescan started. Existing auto-tags will be re-evaluated.');
    });
  });

  it('should NOT show rescan dialog when similarity is decreased', async () => {
    vi.mocked(getConfig).mockResolvedValue(makeConfig([makeCategory({ similarity: 0.35 })]));

    await render(ClassificationSettings);
    await vi.waitFor(() => {
      expect(page.getByText('Screenshots', { exact: true }).element()).toBeInTheDocument();
    });

    await userEvent.click(page.getByLabelText('Edit', { exact: true }));
    setSlider(page.getByRole('slider').element(), '0.20');
    await userEvent.click(page.getByText('Save', { exact: true }));

    await vi.waitFor(() => {
      expect(updateConfig).toHaveBeenCalled();
    });

    expect(modalManager.showDialog).not.toHaveBeenCalled();
  });

  it('should allow saving very loose similarity thresholds', async () => {
    vi.mocked(getConfig).mockResolvedValue(makeConfig([makeCategory({ similarity: 0.28 })]));

    await render(ClassificationSettings);
    await vi.waitFor(() => {
      expect(page.getByText('Screenshots', { exact: true }).element()).toBeInTheDocument();
    });

    await userEvent.click(page.getByLabelText('Edit', { exact: true }));

    const slider = page.getByRole('slider').element();
    expect(slider).toHaveAttribute('min', '0.01');
    expect(slider).toHaveAttribute('max', '1');
    expect(
      page
        .getByText('Start around 0.15-0.30, then lower it to match more loosely or raise it to match more strictly.', {
          exact: true,
        })
        .element(),
    ).toBeInTheDocument();

    setSlider(slider, '0.11');
    await userEvent.click(page.getByText('Save', { exact: true }));

    await vi.waitFor(() => {
      expect(updateConfig).toHaveBeenCalledWith({
        adminConfigDto: expect.objectContaining({
          classification: expect.objectContaining({
            categories: [expect.objectContaining({ similarity: 0.11 })],
          }),
        }),
      });
    });
  });

  it('should allow saving very strict similarity thresholds', async () => {
    vi.mocked(getConfig).mockResolvedValue(makeConfig([makeCategory({ similarity: 0.28 })]));

    await render(ClassificationSettings);
    await vi.waitFor(() => {
      expect(page.getByText('Screenshots', { exact: true }).element()).toBeInTheDocument();
    });

    await userEvent.click(page.getByLabelText('Edit', { exact: true }));
    setSlider(page.getByRole('slider').element(), '0.80');
    await userEvent.click(page.getByText('Save', { exact: true }));

    await vi.waitFor(() => {
      expect(updateConfig).toHaveBeenCalledWith({
        adminConfigDto: expect.objectContaining({
          classification: expect.objectContaining({
            categories: [expect.objectContaining({ similarity: 0.8 })],
          }),
        }),
      });
    });
  });

  it('should NOT show rescan dialog when creating a new category', async () => {
    await render(ClassificationSettings);
    await vi.waitFor(() => {
      expect(page.getByText('Add Category', { exact: true }).element()).toBeInTheDocument();
    });

    await userEvent.click(page.getByText('Add Category', { exact: true }));
    await userEvent.fill(page.getByLabelText('Name', { exact: true }), 'Test');
    await userEvent.fill(page.getByLabelText('Prompts (one per line)', { exact: true }), 'test prompt');
    await userEvent.click(page.getByText('Save', { exact: true }));

    await vi.waitFor(() => {
      expect(updateConfig).toHaveBeenCalled();
    });

    expect(modalManager.showDialog).not.toHaveBeenCalled();
  });

  it('should call scanClassification when Scan All Libraries is confirmed', async () => {
    vi.mocked(modalManager.showDialog as (...args: unknown[]) => Promise<boolean>).mockResolvedValue(true);

    await render(ClassificationSettings);
    await vi.waitFor(() => {
      expect(page.getByText('Scan All Libraries', { exact: true }).element()).toBeInTheDocument();
    });

    await userEvent.click(page.getByText('Scan All Libraries', { exact: true }));

    await vi.waitFor(() => {
      expect(scanClassification).toHaveBeenCalled();
    });
  });

  it('should NOT scan when Scan All Libraries dialog is cancelled', async () => {
    vi.mocked(modalManager.showDialog as (...args: unknown[]) => Promise<boolean>).mockResolvedValue(false);

    await render(ClassificationSettings);
    await vi.waitFor(() => {
      expect(page.getByText('Scan All Libraries', { exact: true }).element()).toBeInTheDocument();
    });

    await userEvent.click(page.getByText('Scan All Libraries', { exact: true }));

    await vi.waitFor(() => {
      expect(modalManager.showDialog).toHaveBeenCalled();
    });

    expect(scanClassification).not.toHaveBeenCalled();
  });

  it('should show face exclusion dropdown when creating a category', async () => {
    await render(ClassificationSettings);
    await vi.waitFor(() => {
      expect(page.getByText('Add Category', { exact: true }).element()).toBeInTheDocument();
    });

    await userEvent.click(page.getByText('Add Category', { exact: true }));

    expect(page.getByLabelText('Face exclusion', { exact: true }).element()).toBeInTheDocument();
    expect(page.getByLabelText('Face exclusion', { exact: true }).element()).toHaveValue('off');
  });

  it('should save selected face exclusion for a new category', async () => {
    await render(ClassificationSettings);
    await vi.waitFor(() => {
      expect(page.getByText('Add Category', { exact: true }).element()).toBeInTheDocument();
    });

    await userEvent.click(page.getByText('Add Category', { exact: true }));
    await userEvent.fill(page.getByLabelText('Name', { exact: true }), 'Nature');
    await userEvent.fill(page.getByLabelText('Prompts (one per line)', { exact: true }), 'a landscape photo');
    await userEvent.selectOptions(
      page.getByLabelText('Face exclusion', { exact: true }),
      ClassificationFaceExclusion.NamedVisiblePeople,
    );
    await userEvent.click(page.getByText('Save', { exact: true }));

    await vi.waitFor(() => {
      expect(updateConfig).toHaveBeenCalledWith({
        adminConfigDto: expect.objectContaining({
          classification: expect.objectContaining({
            categories: [
              expect.objectContaining({
                name: 'Nature',
                faceExclusion: ClassificationFaceExclusion.NamedVisiblePeople,
              }),
            ],
          }),
        }),
      });
    });
  });

  it('should default old categories without faceExclusion to Off in the editor', async () => {
    vi.mocked(getConfig).mockResolvedValue(
      makeConfig([
        {
          name: 'Legacy',
          prompts: ['legacy prompt'],
          similarity: 0.28,
          action: Action.Tag,
          enabled: true,
        } as AdminConfigDto['classification']['categories'][number],
      ]),
    );

    await render(ClassificationSettings);
    await vi.waitFor(() => {
      expect(page.getByText('Legacy', { exact: true }).element()).toBeInTheDocument();
    });

    await userEvent.click(page.getByLabelText('Edit', { exact: true }));

    expect(page.getByLabelText('Face exclusion', { exact: true }).element()).toHaveValue('off');
  });

  it('should show non-Off face exclusion in the category summary', async () => {
    vi.mocked(getConfig).mockResolvedValue(
      makeConfig([makeCategory({ faceExclusion: ClassificationFaceExclusion.NamedPeople })]),
    );

    await render(ClassificationSettings);
    await vi.waitFor(() => {
      expect(page.getByText('Named people', { exact: true }).element()).toBeInTheDocument();
    });
  });

  it('should render summary badges in a separate wrapping row under the category name', async () => {
    const categoryName = 'Very long category name that should not collide with controls';
    vi.mocked(getConfig).mockResolvedValue(
      makeConfig([
        makeCategory({
          name: categoryName,
          action: Action.TagAndArchive,
          faceExclusion: ClassificationFaceExclusion.NamedVisiblePeople,
        }),
      ]),
    );

    await render(ClassificationSettings);
    await vi.waitFor(() => {
      expect(page.getByText(categoryName, { exact: true }).element()).toBeInTheDocument();
    });

    const nameRow = page.getByText(categoryName, { exact: true }).element().closest('.min-w-0');
    expect(nameRow).toBeInTheDocument();
    expect(nameRow).not.toMatchTextContent('Tag and archive');
    expect(nameRow).not.toMatchTextContent('Named, visible people');

    const metadataRow = page.getByText('Tag and archive', { exact: true }).element().parentElement;
    expect(metadataRow).toContainElement(page.getByText('Named, visible people', { exact: true }).element());
    expect(metadataRow).toHaveClass('flex', 'flex-wrap', 'gap-2');
  });

  it('should disable controls when config file is active', async () => {
    mockFeatureFlags.configFile = true;
    vi.mocked(getConfig).mockResolvedValue(makeConfig([makeCategory()]));

    await render(ClassificationSettings);
    await vi.waitFor(() => {
      expect(page.getByText('Screenshots', { exact: true }).element()).toBeInTheDocument();
    });

    expect(page.getByText('Add Category', { exact: true }).element().closest('button')).toBeDisabled();
    expect(page.getByText('Scan All Libraries', { exact: true }).element().closest('button')).toBeDisabled();
  });

  it('should delete category via updateConfig', async () => {
    vi.mocked(getConfig).mockResolvedValue(
      makeConfig([makeCategory(), makeCategory({ name: 'Receipts', prompts: ['receipt'] })]),
    );

    await render(ClassificationSettings);
    await vi.waitFor(() => {
      expect(page.getByText('Screenshots', { exact: true }).element()).toBeInTheDocument();
      expect(page.getByText('Receipts', { exact: true }).element()).toBeInTheDocument();
    });

    const deleteButtons = page.getByLabelText('Delete', { exact: true }).elements();
    await userEvent.click(deleteButtons[0]);

    await vi.waitFor(() => {
      expect(updateConfig).toHaveBeenCalledWith({
        adminConfigDto: expect.objectContaining({
          classification: expect.objectContaining({
            categories: [expect.objectContaining({ name: 'Receipts' })],
          }),
        }),
      });
    });
  });
});
