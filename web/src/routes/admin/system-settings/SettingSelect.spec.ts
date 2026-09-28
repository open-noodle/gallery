import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import SettingSelect from './SettingSelect.svelte';

describe('SettingSelect', () => {
  it('disables only the option marked disabled', () => {
    render(SettingSelect, {
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

    expect(screen.getByRole('option', { name: 'A' })).not.toBeDisabled();
    expect(screen.getByRole('option', { name: 'B' })).toBeDisabled();
  });

  it('leaves options without the field enabled', () => {
    render(SettingSelect, {
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

    expect(screen.getByRole('option', { name: 'B' })).not.toBeDisabled();
  });

  it('still disables the whole select via the component prop', () => {
    render(SettingSelect, {
      props: {
        value: 'a',
        name: 'test',
        label: 'Test',
        disabled: true,
        options: [{ value: 'a', text: 'A' }],
      },
    });

    expect(screen.getByRole('combobox')).toBeDisabled();
  });
});
