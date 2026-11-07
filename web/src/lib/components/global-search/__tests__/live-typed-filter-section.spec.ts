import { Command } from 'bits-ui';
import type { Snippet } from 'svelte';
import { init, register, waitLocale } from 'svelte-i18n';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';
import LiveTypedFilterSection from '../live-typed-filter-section.svelte';

type ComponentAnchor = Parameters<typeof Command.Root>[0];
type RenderSnippet = ($$anchor: ComponentAnchor) => void;
const snippet = (renderSnippet: RenderSnippet) => renderSnippet as unknown as Snippet;

beforeAll(async () => {
  register('en-US', () => import('#i18n/en.json'));
  await init({ fallbackLocale: 'en-US' });
  await waitLocale('en-US');
});

function LiveTypedFilterSectionHost($$anchor: ComponentAnchor, $$props: Record<string, unknown>) {
  Command.Root($$anchor, {
    children: snippet(($$anchor: ComponentAnchor) => {
      Command.List($$anchor, {
        children: snippet(($$anchor: ComponentAnchor) => {
          LiveTypedFilterSection($$anchor, {
            get status() {
              return $$props.status;
            },
            get onSelect() {
              return $$props.onSelect;
            },
          });
        }),
      });
    }),
  });
}

describe('LiveTypedFilterSection', () => {
  it('renders live choices as filter application rows', async () => {
    const onSelect = vi.fn();

    await render(LiveTypedFilterSectionHost, {
      props: {
        status: {
          status: 'ok',
          key: 'person',
          total: 1,
          items: [
            {
              id: 'person:0:10:p1',
              key: 'person',
              label: 'Anna Maria',
              value: 'Anna Maria',
              tokenStart: 6,
              tokenEnd: 16,
            },
          ],
        },
        onSelect,
      },
    });

    await expect.element(page.getByText(/person filter matches/i)).toBeInTheDocument();
    await userEvent.click(page.getByRole('option', { name: /Anna Maria/i }));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ label: 'Anna Maria' }));
  });

  it('renders a person thumbnail for live person choices with preview data', async () => {
    const { container } = await render(LiveTypedFilterSectionHost, {
      props: {
        status: {
          status: 'ok',
          key: 'person',
          total: 1,
          items: [
            {
              id: 'person:0:7:person:p1',
              key: 'person',
              label: 'Alice',
              value: 'Alice',
              tokenStart: 0,
              tokenEnd: 7,
              preview: {
                kind: 'person',
                data: {
                  id: 'p1',
                  filterId: 'person:p1',
                  name: 'Alice',
                  primaryProfile: { type: 'user-person', id: 'p1' },
                },
              },
            } as never,
          ],
        },
        onSelect: vi.fn(),
      },
    });

    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    expect(img?.getAttribute('src')).toMatch(/\/api\/people\/p1\/thumbnail/);
  });

  it('applies selected-state styling to live choice rows', async () => {
    await render(LiveTypedFilterSectionHost, {
      props: {
        status: {
          status: 'ok',
          key: 'person',
          total: 1,
          items: [
            {
              id: 'person:0:10:p1',
              key: 'person',
              label: 'Anna Maria',
              value: 'Anna Maria',
              tokenStart: 6,
              tokenEnd: 16,
            },
          ],
        },
        onSelect: vi.fn(),
      },
    });

    const option = page.getByRole('option', { name: /Anna Maria/i }).element();
    const row = option.firstElementChild as HTMLElement;
    expect(`${option.className} ${row.className}`).toContain('group-data-selected:bg-primary/10');
  });

  it('renders loading empty and error states', async () => {
    const { rerender } = await render(LiveTypedFilterSectionHost, {
      props: { status: { status: 'loading', key: 'tag' }, onSelect: vi.fn() },
    });
    await expect.element(page.getByText(/loading tag matches/i)).toBeInTheDocument();

    await rerender({ status: { status: 'empty', key: 'tag' }, onSelect: vi.fn() });
    await expect.element(page.getByText(/no matching tags/i)).toBeInTheDocument();

    await rerender({ status: { status: 'error', key: 'tag', message: 'network down' }, onSelect: vi.fn() });
    await expect.element(page.getByText(/couldn't load tag matches/i)).toBeInTheDocument();
  });

  it('renders secondary labels and timeout state copy', async () => {
    const { rerender } = await render(LiveTypedFilterSectionHost, {
      props: {
        status: {
          status: 'ok',
          key: 'city',
          total: 1,
          items: [
            {
              id: 'city:0:8:Berlin',
              key: 'city',
              label: 'Berlin',
              value: 'Berlin',
              secondaryLabel: 'Germany',
              tokenStart: 0,
              tokenEnd: 8,
            },
          ],
        },
        onSelect: vi.fn(),
      },
    });
    await expect.element(page.getByText('Germany')).toBeInTheDocument();

    await rerender({ status: { status: 'timeout', key: 'city' }, onSelect: vi.fn() });

    await expect.element(page.getByText(/city matches timed out/i)).toBeInTheDocument();
  });
});
