import SchemaSpacePickerWrapper from '#lib/components/SchemaSpacePicker.test-wrapper.svelte';
import { getAllSpaces } from '@immich/sdk';
import { modalManager } from '@immich/ui';
import { init, register, waitLocale } from 'svelte-i18n';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';

// Module mocks, matching the pattern used across this suite. `vi.spyOn` on these is not the
// convention here, and an unmocked @immich/sdk would attempt a real fetch.
vi.mock('@immich/sdk', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@immich/sdk')>()),
  getAllSpaces: vi.fn(),
}));

vi.mock('@immich/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@immich/ui')>()),
  modalManager: { show: vi.fn() },
}));

const space = (id: string, name: string) => ({ id, name }) as never;
const boundValue = () => page.getByTestId('wrapper-space-ids');

// The global test setup uses `fallbackLocale: 'dev'`, which renders literal translation keys.
// This suite asserts real button labels ("Choose"/"Remove") and the "Space unavailable"
// placeholder, so load actual English strings here, matching the convention established by
// space-albums-controls.spec.ts and its siblings.
beforeAll(async () => {
  register('en-US', () => import('#i18n/en.json'));
  await init({ fallbackLocale: 'en-US', initialLocale: 'en-US' });
  await waitLocale('en-US');
});

describe('SchemaSpacePicker', () => {
  beforeEach(() => {
    // This suite does not clear mocks between tests, so reset explicitly.
    vi.mocked(modalManager.show).mockReset();
    vi.mocked(getAllSpaces)
      .mockReset()
      .mockResolvedValue([space('space-1', 'Family')]);
  });

  const renderPicker = (props: { array?: boolean; initial?: string[] } = {}) =>
    render(SchemaSpacePickerWrapper, { array: props.array ?? false, initial: props.initial ?? [] });

  it('renders a choose button and no chip when nothing is selected', async () => {
    // W1
    await renderPicker();
    await expect.element(page.getByRole('button', { name: 'Choose' })).toBeInTheDocument();
    expect(page.getByTestId('space-chip').query()).toBeNull();
    await expect.element(boundValue()).toHaveTextContent('');
  });

  it('stores the chosen space id and shows its name', async () => {
    // W2
    vi.mocked(modalManager.show).mockResolvedValue(space('space-2', 'Friends'));
    await renderPicker();
    await userEvent.click(page.getByRole('button', { name: 'Choose' }));
    await expect.element(page.getByText('Friends')).toBeInTheDocument();
    await expect.element(boundValue()).toHaveTextContent('space-2');
  });

  it('appends in array mode', async () => {
    // W3
    vi.mocked(modalManager.show).mockResolvedValue(space('space-2', 'Friends'));
    await renderPicker({ array: true, initial: ['space-1'] });
    await userEvent.click(page.getByRole('button', { name: 'Choose' }));
    await expect.element(boundValue()).toHaveTextContent('space-1,space-2');
  });

  it('replaces in single mode', async () => {
    // W4
    vi.mocked(modalManager.show).mockResolvedValue(space('space-2', 'Friends'));
    await renderPicker({ array: false, initial: ['space-1'] });
    await userEvent.click(page.getByRole('button', { name: 'Choose' }));
    await expect.poll(() => boundValue().element().textContent).toBe('space-2');
  });

  it('leaves the value untouched when the modal is dismissed', async () => {
    // W5
    vi.mocked(modalManager.show).mockResolvedValue(undefined as never);
    await renderPicker({ initial: ['space-1'] });
    await userEvent.click(page.getByRole('button', { name: 'Choose' }));
    await expect.element(boundValue()).toHaveTextContent('space-1');
  });

  it('removes a selected space', async () => {
    // W6
    await renderPicker({ array: true, initial: ['space-1'] });
    await userEvent.click(page.getByRole('button', { name: 'Remove' }));
    await expect.element(boundValue()).toHaveTextContent('');
  });

  it('renders a removable placeholder for a space that no longer resolves', async () => {
    // W7 — a workflow outlives the spaces it points at; an unhandled throw here would take down
    // the whole step editor, including the field the user needs in order to fix it.
    vi.mocked(getAllSpaces).mockResolvedValue([]);
    await renderPicker({ array: true, initial: ['deleted-space'] });
    await expect.element(page.getByText('Space unavailable')).toBeInTheDocument();
    await expect.element(page.getByRole('button', { name: 'Remove' })).toBeInTheDocument();
  });
});
