import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import SettingSelect from './SettingSelect.svelte';

describe('SettingSelect', () => {
  it('disables only the option marked disabled', async () => {
    await render(SettingSelect, {
      props: {
        value: 'a',
        name: 'test',
        label: 'Test',
        options: [
          { value: 'a', text: 'A' },
          { value: 'b', text: 'B', disabled: true },
        ],
      },
    });

    expect(page.getByRole('option', { name: 'A' }).element()).not.toBeDisabled();
    expect(page.getByRole('option', { name: 'B' }).element()).toBeDisabled();
  });

  it('leaves options without the field enabled', async () => {
    await render(SettingSelect, {
      props: {
        value: 'a',
        name: 'test',
        label: 'Test',
        options: [
          { value: 'a', text: 'A' },
          { value: 'b', text: 'B' },
        ],
      },
    });

    expect(page.getByRole('option', { name: 'B' }).element()).not.toBeDisabled();
  });

  it('still disables the whole select via the component prop', async () => {
    await render(SettingSelect, {
      props: {
        value: 'a',
        name: 'test',
        label: 'Test',
        disabled: true,
        options: [{ value: 'a', text: 'A' }],
      },
    });

    expect(page.getByRole('combobox').element()).toBeDisabled();
  });
});
