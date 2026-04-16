import { GlobalSearchManager } from '$lib/managers/global-search-manager.svelte';
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import GlobalSearchFooter from '../global-search-footer.svelte';

vi.mock('@immich/sdk', async () => {
  const actual = await vi.importActual<typeof import('@immich/sdk')>('@immich/sdk');
  return {
    ...actual,
    searchSmart: vi.fn().mockResolvedValue({ assets: { items: [], nextPage: null } }),
    searchAssets: vi.fn().mockResolvedValue({ assets: { items: [], nextPage: null } }),
    searchPerson: vi.fn().mockResolvedValue([]),
    searchPlaces: vi.fn().mockResolvedValue([]),
    getAllTags: vi.fn().mockResolvedValue([]),
  };
});

describe('global-search-footer', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('renders four segmented-control radios', () => {
    const manager = new GlobalSearchManager();
    render(GlobalSearchFooter, { props: { manager } });
    for (const label of ['cmdk_mode_smart', 'cmdk_mode_filename', 'cmdk_mode_description', 'cmdk_mode_ocr']) {
      expect(screen.getByRole('radio', { name: new RegExp(label, 'i') })).toBeInTheDocument();
    }
  });

  it('reflects manager.mode as the checked radio', () => {
    const manager = new GlobalSearchManager();
    manager.setMode('metadata');
    render(GlobalSearchFooter, { props: { manager } });
    const radios = screen.getAllByRole('radio') as HTMLInputElement[];
    const filenameRadio = radios.find((r) => r.value === 'metadata');
    expect(filenameRadio?.checked).toBe(true);
  });

  it('clicking a segment calls manager.setMode with the right value', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const manager = new GlobalSearchManager();
    const spy = vi.spyOn(manager, 'setMode');
    render(GlobalSearchFooter, { props: { manager } });
    const radios = screen.getAllByRole('radio') as HTMLInputElement[];
    const descriptionRadio = radios.find((r) => r.value === 'description');
    await user.click(descriptionRadio!);
    expect(spy).toHaveBeenCalledWith('description');
  });

  it('displays the Ctrl+/ keybind hint', () => {
    const manager = new GlobalSearchManager();
    render(GlobalSearchFooter, { props: { manager } });
    expect(screen.getByText(/ctrl\+\//i)).toBeInTheDocument();
  });
});
