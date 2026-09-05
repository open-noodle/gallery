import { modalManager } from '@immich/ui';
import { render, screen } from '@testing-library/svelte';
import { init, register, waitLocale } from 'svelte-i18n';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import ShortcutsModal from '$lib/modals/ShortcutsModal.svelte';
import GlobalSearchFooter from '../global-search-footer.svelte';

describe('global-search-footer', () => {
  // The mode segmented control moved out of the footer and into `SearchModeControl`,
  // which renders as a rail under the palette input and as a chip in the inline search
  // field. Leaving a copy down here would be duplicate UI, and on a phone the extra
  // items overflowed this `justify-between` row.
  it('no longer renders the mode segmented control', () => {
    render(GlobalSearchFooter);
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
  });

  it('no longer advertises Ctrl+/, now that the control itself is on screen', () => {
    render(GlobalSearchFooter);
    expect(screen.queryByText(/ctrl\+\//i)).not.toBeInTheDocument();
  });
});

describe('prefix scoping — footer chrome', () => {
  // Load en so `$t('cmdk_scope_hint_footer')` resolves to "@ # / >" rather than the raw key.
  beforeAll(async () => {
    register('en-US', () => import('$i18n/en.json'));
    await init({ fallbackLocale: 'en-US' });
    await waitLocale('en-US');
  });

  it('keeps the @ # / > scope hint', () => {
    const { getByText } = render(GlobalSearchFooter);
    expect(getByText('@ # / >')).toBeInTheDocument();
    // The label next to the kbd is translated (cmdk_scope_hint_footer_label); beforeAll
    // loads en-US so it must resolve to "scope" and stay rendered — guards against
    // silently dropping the label node during future template edits.
    expect(getByText('scope')).toBeInTheDocument();
  });

  it('? icon button hidden below sm breakpoint (carries sm:block class)', () => {
    const { container } = render(GlobalSearchFooter);
    const btn = container.querySelector('[data-cmdk-shortcuts-trigger]');
    expect(btn?.className).toMatch(/sm:block|sm:flex|sm:inline-flex/);
  });

  it('clicking ? calls modalManager.show(ShortcutsModal, {})', () => {
    const showSpy = vi.spyOn(modalManager, 'show');
    const { container } = render(GlobalSearchFooter);
    const btn = container.querySelector('[data-cmdk-shortcuts-trigger]') as HTMLButtonElement;
    btn.click();
    expect(showSpy).toHaveBeenCalledWith(ShortcutsModal, {});
  });
});
