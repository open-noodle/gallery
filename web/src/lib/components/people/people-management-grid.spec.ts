import { flushSync } from 'svelte';
import { expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';
import PeopleManagementGridWrapper from './people-management-grid.test-wrapper.svelte';

/**
Thumbnails never load in the unit tier: every request 404s within milliseconds, and that real `error`
event would free a deferred-thumbnail slot (and swap the image for the broken-asset fallback) before
a test could look at the queue. Swallow the browser's own image load/error events in the capture
phase, before they reach the image, so a slot is released only by the events a test dispatches.
*/
const swallowBrowserImageEvents = (event: Event) => {
  if (event.isTrusted && event.target instanceof HTMLImageElement) {
    event.stopImmediatePropagation();
  }
};

const mouseEnter = () => {
  page.getByRole('group').element().dispatchEvent(new MouseEvent('mouseenter'));
  flushSync();
};

const fire = (title: string, type: 'load' | 'error') => {
  page.getByTitle(title, { exact: true }).element().dispatchEvent(new Event(type));
  flushSync();
};

describe('PeopleManagementGrid', () => {
  beforeEach(() => {
    addEventListener('load', swallowBrowserImageEvents, { capture: true });
    addEventListener('error', swallowBrowserImageEvents, { capture: true });
  });

  afterEach(() => {
    removeEventListener('load', swallowBrowserImageEvents, { capture: true });
    removeEventListener('error', swallowBrowserImageEvents, { capture: true });
  });

  it('renders shared person tiles with an editable canonical name footer', async () => {
    const onNameSubmit = vi.fn();
    await render(PeopleManagementGridWrapper, { props: { onNameSubmit } });

    await expect.element(page.getByRole('link', { name: 'Ada Lovelace' })).toHaveAttribute('href', '/people/person-1');

    const input = page.getByRole('textbox');
    await expect.element(input).toHaveValue('Ada Lovelace');
    await userEvent.fill(input, 'Ada Byron');
    (input.element() as HTMLInputElement).blur();

    await vi.waitFor(() => {
      expect(onNameSubmit).toHaveBeenCalledWith('Ada Byron', expect.objectContaining({ id: 'person-1' }));
    });
  });

  it('renders readonly names when editing is disabled', async () => {
    await render(PeopleManagementGridWrapper, { props: { canEditNames: false } });

    await expect.element(page.getByText('Ada Lovelace')).toBeInTheDocument();
    expect(page.getByRole('textbox').query()).toBeNull();
  });

  it('uses the shared tile action slot and can disable actions per page', async () => {
    const onAction = vi.fn();
    const { rerender } = await render(PeopleManagementGridWrapper, {
      props: { canShowActions: false, onAction },
    });

    mouseEnter();
    expect(page.getByRole('button', { name: 'Actions' }).query()).toBeNull();

    await rerender({ canShowActions: true, onAction });
    mouseEnter();
    await page.getByRole('button', { name: 'Actions' }).click();

    expect(onAction).toHaveBeenCalledWith(expect.objectContaining({ id: 'person-1' }));
  });

  it('does not assign thumbnail src for deferred offscreen tiles', async () => {
    class NeverIntersectingObserver {
      observe = vi.fn();
      disconnect = vi.fn();
      unobserve = vi.fn();
    }
    vi.stubGlobal('IntersectionObserver', NeverIntersectingObserver);

    await render(PeopleManagementGridWrapper, {
      props: {
        deferThumbnails: true,
        people: Array.from({ length: 3 }, (_, index) => ({ id: `person-${index}`, name: `Person ${index}` })),
      },
    });

    await expect.element(page.getByTitle('Person 0', { exact: true })).not.toHaveAttribute('src');
    await expect.element(page.getByTitle('Person 1', { exact: true })).not.toHaveAttribute('src');
    await expect.element(page.getByTitle('Person 2', { exact: true })).not.toHaveAttribute('src');

    vi.unstubAllGlobals();
  });

  it('only starts the configured number of visible deferred thumbnails at once', async () => {
    let callback!: IntersectionObserverCallback;
    class VisibleObserver {
      observe = vi.fn((target: Element) => {
        callback(
          [{ isIntersecting: true, target } as IntersectionObserverEntry],
          this as unknown as IntersectionObserver,
        );
      });
      disconnect = vi.fn();
      unobserve = vi.fn();
      constructor(cb: IntersectionObserverCallback) {
        callback = cb;
      }
    }
    vi.stubGlobal('IntersectionObserver', VisibleObserver);

    await render(PeopleManagementGridWrapper, {
      props: {
        deferThumbnails: true,
        thumbnailConcurrency: 2,
        people: Array.from({ length: 4 }, (_, index) => ({ id: `person-${index}`, name: `Person ${index}` })),
      },
    });

    await expect
      .element(page.getByTitle('Person 0', { exact: true }))
      .toHaveAttribute('src', '/api/people/person-0/thumbnail');
    await expect
      .element(page.getByTitle('Person 1', { exact: true }))
      .toHaveAttribute('src', '/api/people/person-1/thumbnail');
    await expect.element(page.getByTitle('Person 2', { exact: true })).not.toHaveAttribute('src');
    await expect.element(page.getByTitle('Person 3', { exact: true })).not.toHaveAttribute('src');

    fire('Person 0', 'load');
    await expect
      .element(page.getByTitle('Person 2', { exact: true }))
      .toHaveAttribute('src', '/api/people/person-2/thumbnail');

    vi.unstubAllGlobals();
  });

  it('releases a deferred thumbnail slot when an image fails', async () => {
    let callback!: IntersectionObserverCallback;
    class VisibleObserver {
      observe = vi.fn((target: Element) => {
        callback(
          [{ isIntersecting: true, target } as IntersectionObserverEntry],
          this as unknown as IntersectionObserver,
        );
      });
      disconnect = vi.fn();
      unobserve = vi.fn();
      constructor(cb: IntersectionObserverCallback) {
        callback = cb;
      }
    }
    vi.stubGlobal('IntersectionObserver', VisibleObserver);

    await render(PeopleManagementGridWrapper, {
      props: {
        deferThumbnails: true,
        thumbnailConcurrency: 1,
        people: [
          { id: 'person-1', name: 'Ada Lovelace' },
          { id: 'person-2', name: 'Grace Hopper' },
        ],
      },
    });

    await expect.element(page.getByTitle('Ada Lovelace', { exact: true })).toHaveAttribute('src');
    await expect.element(page.getByTitle('Grace Hopper', { exact: true })).not.toHaveAttribute('src');
    fire('Ada Lovelace', 'error');
    await expect.element(page.getByTitle('Grace Hopper', { exact: true })).toHaveAttribute('src');

    vi.unstubAllGlobals();
  });

  it('does not start every thumbnail at once when a new people page is appended', async () => {
    let callback!: IntersectionObserverCallback;
    class VisibleObserver {
      observe = vi.fn((target: Element) => {
        callback(
          [{ isIntersecting: true, target } as IntersectionObserverEntry],
          this as unknown as IntersectionObserver,
        );
      });
      disconnect = vi.fn();
      unobserve = vi.fn();
      constructor(cb: IntersectionObserverCallback) {
        callback = cb;
      }
    }
    vi.stubGlobal('IntersectionObserver', VisibleObserver);

    const { rerender } = await render(PeopleManagementGridWrapper, {
      props: {
        deferThumbnails: true,
        thumbnailConcurrency: 2,
        people: [
          { id: 'person-1', name: 'Ada Lovelace' },
          { id: 'person-2', name: 'Grace Hopper' },
        ],
      },
    });
    await expect.element(page.getByTitle('Ada Lovelace', { exact: true })).toHaveAttribute('src');
    await expect.element(page.getByTitle('Grace Hopper', { exact: true })).toHaveAttribute('src');

    await rerender({
      deferThumbnails: true,
      thumbnailConcurrency: 2,
      people: [
        { id: 'person-1', name: 'Ada Lovelace' },
        { id: 'person-2', name: 'Grace Hopper' },
        { id: 'person-3', name: 'Katherine Johnson' },
        { id: 'person-4', name: 'Dorothy Vaughan' },
        { id: 'person-5', name: 'Mary Jackson' },
      ],
    });

    await expect.element(page.getByTitle('Katherine Johnson', { exact: true })).not.toHaveAttribute('src');
    await expect.element(page.getByTitle('Dorothy Vaughan', { exact: true })).not.toHaveAttribute('src');
    await expect.element(page.getByTitle('Mary Jackson', { exact: true })).not.toHaveAttribute('src');

    fire('Ada Lovelace', 'load');
    await expect.element(page.getByTitle('Katherine Johnson', { exact: true })).toHaveAttribute('src');
    await expect.element(page.getByTitle('Mary Jackson', { exact: true })).not.toHaveAttribute('src');

    vi.unstubAllGlobals();
  });
});
