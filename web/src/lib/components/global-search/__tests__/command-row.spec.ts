import type { CommandItem } from '$lib/managers/command-items';
import { render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import CommandRow from '../rows/command-row.svelte';

const baseItem: CommandItem = {
  id: 'cmd:theme',
  labelKey: 'theme',
  descriptionKey: 'cmdk_cmd_theme_description',
  icon: 'M12 2L1 12h3v9h7v-6h2v6h7v-9h3L12 2z',
  handler: () => {},
};

describe('command-row', () => {
  it('renders the translated label (fallback locale renders the key)', () => {
    render(CommandRow, { props: { item: baseItem } });
    // svelte-i18n's `fallbackLocale: 'dev'` in setup renders the literal key.
    expect(screen.getByText('theme')).toBeInTheDocument();
  });

  it('renders the translated description', () => {
    render(CommandRow, { props: { item: baseItem } });
    expect(screen.getByText('cmdk_cmd_theme_description')).toBeInTheDocument();
  });

  it('renders an Icon element with an svg', () => {
    const { container } = render(CommandRow, { props: { item: baseItem } });
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('does NOT set role="option" (Command.Item wraps this row)', () => {
    const { container } = render(CommandRow, { props: { item: baseItem } });
    expect(container.querySelector('[role="option"]')).toBeNull();
  });

  it('has transition-colors class for the 80ms active-tint animation', () => {
    const { container } = render(CommandRow, { props: { item: baseItem } });
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain('transition-colors');
    expect(root.className).toContain('duration-[80ms]');
  });

  it('pending=true renders the confirm-hint text (not the description)', () => {
    render(CommandRow, { props: { item: baseItem, pending: true } });
    expect(screen.getByText(/cmdk_cmd_confirm_hint/)).toBeInTheDocument();
    expect(screen.queryByText('cmdk_cmd_theme_description')).toBeNull();
  });

  it('pending=true applies the text-danger token to the hint', () => {
    const { container } = render(CommandRow, { props: { item: baseItem, pending: true } });
    const hint = container.querySelector('.text-xs.text-danger');
    expect(hint).not.toBeNull();
    expect(hint?.textContent).toContain('cmdk_cmd_confirm_hint');
  });

  it('pending=false renders the normal description', () => {
    render(CommandRow, { props: { item: baseItem, pending: false } });
    expect(screen.getByText('cmdk_cmd_theme_description')).toBeInTheDocument();
    expect(screen.queryByText(/cmdk_cmd_confirm_hint/)).toBeNull();
  });

  it('pending flip false→true→false swaps description ↔ hint', async () => {
    const { rerender, container } = render(CommandRow, { props: { item: baseItem, pending: false } });
    expect(container.querySelector('.text-danger')).toBeNull();
    await rerender({ item: baseItem, pending: true });
    expect(container.querySelector('.text-danger')).not.toBeNull();
    await rerender({ item: baseItem, pending: false });
    expect(container.querySelector('.text-danger')).toBeNull();
  });

  it('uses group-data-[selected] to inherit the selected highlight from Command.Item', () => {
    // bits-ui Command.Item sets `data-selected=""` (empty string) when selected —
    // `data-[selected=true]:` would NOT match because it looks for the literal "true".
    // Using `group-data-[selected]:` on the row with `group` on the Command.Item
    // matches any (including empty) value of data-selected on the parent.
    const { container } = render(CommandRow, { props: { item: baseItem } });
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain('group-data-[selected]:bg-primary/10');
  });
});
