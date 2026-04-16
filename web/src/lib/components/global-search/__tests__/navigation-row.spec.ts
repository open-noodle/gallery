import type { NavigationItem } from '$lib/managers/navigation-items';
import { render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import NavigationRow from '../rows/navigation-row.svelte';

const baseItem: NavigationItem = {
  id: 'nav:systemSettings:classification',
  category: 'systemSettings',
  labelKey: 'admin.classification_settings',
  descriptionKey: 'admin.classification_settings_description',
  icon: 'M12 2L1 12h3v9h7v-6h2v6h7v-9h3L12 2z',
  route: '/admin/system-settings?isOpen=classification',
  adminOnly: true,
};

describe('navigation-row', () => {
  it('renders the translated label (fallback locale renders the key)', () => {
    render(NavigationRow, { props: { item: baseItem } });
    // svelte-i18n's `fallbackLocale: 'dev'` in setup renders the literal key.
    expect(screen.getByText('admin.classification_settings')).toBeInTheDocument();
  });

  it('renders the translated description', () => {
    render(NavigationRow, { props: { item: baseItem } });
    expect(screen.getByText('admin.classification_settings_description')).toBeInTheDocument();
  });

  it('renders an Icon element with an svg', () => {
    const { container } = render(NavigationRow, { props: { item: baseItem } });
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('does NOT set role="option" (Command.Item wraps this row)', () => {
    const { container } = render(NavigationRow, { props: { item: baseItem } });
    expect(container.querySelector('[role="option"]')).toBeNull();
  });

  it('has transition-colors class for the 80ms active-tint animation', () => {
    const { container } = render(NavigationRow, { props: { item: baseItem } });
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain('transition-colors');
    expect(root.className).toContain('duration-[80ms]');
  });

  it('uses group-data-[selected] to inherit the selected highlight from Command.Item', () => {
    // bits-ui Command.Item sets `data-selected=""` (empty string) when selected —
    // `data-[selected=true]:` would NOT match because it looks for the literal "true".
    // Using `group-data-[selected]:` on the row with `group` on the Command.Item
    // matches any (including empty) value of data-selected on the parent.
    const { container } = render(NavigationRow, { props: { item: baseItem } });
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain('group-data-[selected]:bg-primary/10');
  });
});
