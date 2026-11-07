import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';
import FilterPanel from '../filter-panel.svelte';

describe('Cascade callbacks pass parent value', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('should call cities provider with the selected country', async () => {
    const citiesFn = vi.fn().mockResolvedValue(['Berlin', 'Munich']);

    await render(FilterPanel, {
      config: {
        sections: ['location'],
        providers: {
          locations: () =>
            Promise.resolve([
              { value: 'Germany', type: 'country' as const },
              { value: 'France', type: 'country' as const },
            ]),
          cities: citiesFn,
        },
      },
      timeBuckets: [],
    });

    // Wait for countries to load
    await expect.element(page.getByTestId('location-country-Germany')).toBeInTheDocument();

    // Click a country to trigger cascade fetch
    await userEvent.click(page.getByTestId('location-country-Germany'));

    await vi.waitFor(() => {
      expect(citiesFn).toHaveBeenCalledWith('Germany', undefined);
    });
  });

  it('should call cameraModels provider with the selected make', async () => {
    const modelsFn = vi.fn().mockResolvedValue(['X-T5', 'X-H2']);

    await render(FilterPanel, {
      config: {
        sections: ['camera'],
        providers: {
          cameras: () =>
            Promise.resolve([
              { value: 'Fujifilm', type: 'make' as const },
              { value: 'Sony', type: 'make' as const },
            ]),
          cameraModels: modelsFn,
        },
      },
      timeBuckets: [],
    });

    // Wait for makes to load
    await expect.element(page.getByTestId('camera-make-Fujifilm')).toBeInTheDocument();

    // Click a make to trigger cascade fetch
    await userEvent.click(page.getByTestId('camera-make-Fujifilm'));

    await vi.waitFor(() => {
      expect(modelsFn).toHaveBeenCalledWith('Fujifilm', undefined);
    });
  });

  it('should not call cities provider when no cities provider is configured', async () => {
    await render(FilterPanel, {
      config: {
        sections: ['location'],
        providers: {
          locations: () => Promise.resolve([{ value: 'Germany', type: 'country' as const }]),
        },
      },
      timeBuckets: [],
    });

    await expect.element(page.getByTestId('location-country-Germany')).toBeInTheDocument();

    // Click country — should not throw even without cities provider
    await userEvent.click(page.getByTestId('location-country-Germany'));
  });

  it('should not call cameraModels provider when no cameraModels provider is configured', async () => {
    await render(FilterPanel, {
      config: {
        sections: ['camera'],
        providers: {
          cameras: () => Promise.resolve([{ value: 'Fujifilm', type: 'make' as const }]),
        },
      },
      timeBuckets: [],
    });

    await expect.element(page.getByTestId('camera-make-Fujifilm')).toBeInTheDocument();

    // Click make — should not throw even without cameraModels provider
    await userEvent.click(page.getByTestId('camera-make-Fujifilm'));
  });

  it('should pass different country when a different country is clicked', async () => {
    const citiesFn = vi.fn().mockResolvedValue([]);

    await render(FilterPanel, {
      config: {
        sections: ['location'],
        providers: {
          locations: () =>
            Promise.resolve([
              { value: 'Germany', type: 'country' as const },
              { value: 'France', type: 'country' as const },
            ]),
          cities: citiesFn,
        },
      },
      timeBuckets: [],
    });

    await expect.element(page.getByTestId('location-country-France')).toBeInTheDocument();

    await userEvent.click(page.getByTestId('location-country-France'));

    await vi.waitFor(() => {
      expect(citiesFn).toHaveBeenCalledWith('France', undefined);
    });
    expect(citiesFn).not.toHaveBeenCalledWith('Germany', undefined);
  });
});
