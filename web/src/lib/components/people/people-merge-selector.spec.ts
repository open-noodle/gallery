import TestWrapper from '#lib/components/TestWrapper.svelte';
import { modalManager, toastManager } from '@immich/ui';
import type { Component } from 'svelte';
import { expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import PeopleMergeSelector from './people-merge-selector.svelte';

type TestPerson = {
  id: string;
  name: string;
};

vi.mock('#lib/components/assets/thumbnail/ImageThumbnail.svelte', async () => {
  const { default: MockComponent } = await import('#lib/gallery/__mocks__/image-thumbnail.stub.svelte');
  return { default: MockComponent };
});

vi.mock('@immich/ui', async (importOriginal) => {
  const original = await importOriginal<typeof import('@immich/ui')>();
  return {
    ...original,
    modalManager: { showDialog: vi.fn() },
    toastManager: { warning: vi.fn() },
  };
});

const getDisplayName = (person: TestPerson) => person.name;
const getThumbnailUrl = (person: TestPerson) => `/people/${person.id}/thumbnail`;

function renderSelector(props: Record<string, unknown>) {
  return render(TestWrapper as Component<{ component: typeof PeopleMergeSelector; componentProps: typeof props }>, {
    component: PeopleMergeSelector,
    componentProps: props,
  });
}

describe('PeopleMergeSelector', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(modalManager.showDialog as (...args: unknown[]) => Promise<boolean>).mockResolvedValue(true);
  });

  it('loads merge candidates and merges selected people into the current target', async () => {
    const target = { id: 'p1', name: 'Alice' };
    const bob = { id: 'p2', name: 'Bob' };
    const carol = { id: 'p3', name: 'Carol' };
    const loadPeople = vi.fn().mockResolvedValue([target, bob, carol]);
    const mergePeople = vi.fn().mockResolvedValue(target);
    const onMerge = vi.fn();

    await renderSelector({
      person: target,
      getDisplayName,
      getThumbnailUrl,
      loadPeople,
      mergePeople,
      onBack: vi.fn(),
      onMerge,
    });

    await vi.waitFor(() => expect(loadPeople).toHaveBeenCalledWith(false, target));
    await page.getByRole('button', { name: 'Bob' }).click();
    await page.getByRole('button', { name: 'merge', exact: true }).click();

    await vi.waitFor(() => {
      expect(mergePeople).toHaveBeenCalledWith(target, [bob]);
    });
    expect(onMerge).toHaveBeenCalledWith(target);
  });

  it('auto-promotes a named candidate without triggering the manual swap callback', async () => {
    const unnamed = { id: 'p1', name: '' };
    const named = { id: 'p2', name: 'Alice' };
    const loadPeople = vi.fn().mockResolvedValue([unnamed, named]);
    const mergePeople = vi.fn().mockResolvedValue(named);
    const onSwapPerson = vi.fn();

    await renderSelector({
      person: unnamed,
      getDisplayName,
      getThumbnailUrl,
      loadPeople,
      mergePeople,
      onBack: vi.fn(),
      onMerge: vi.fn(),
      onSwapPerson,
    });

    await page.getByRole('button', { name: 'Alice' }).click();

    expect(onSwapPerson).not.toHaveBeenCalled();
    await page.getByRole('button', { name: 'merge', exact: true }).click();

    await vi.waitFor(() => {
      expect(mergePeople).toHaveBeenCalledWith(named, [unnamed]);
    });
  });

  it('calls the manual swap callback when the swap direction button is clicked', async () => {
    const target = { id: 'p1', name: 'Alice' };
    const candidate = { id: 'p2', name: 'Bob' };
    const loadPeople = vi.fn().mockResolvedValue([target, candidate]);
    const onSwapPerson = vi.fn();

    await renderSelector({
      person: target,
      getDisplayName,
      getThumbnailUrl,
      loadPeople,
      mergePeople: vi.fn(),
      onBack: vi.fn(),
      onMerge: vi.fn(),
      onSwapPerson,
    });

    await page.getByRole('button', { name: 'Bob' }).click();
    await page.getByRole('button', { name: 'swap_merge_direction' }).click();

    expect(onSwapPerson).toHaveBeenCalledWith(candidate);
  });

  it('reloads candidates with similarity sorting when enabled', async () => {
    const target = { id: 'p1', name: 'Alice' };
    const loadPeople = vi.fn().mockResolvedValue([]);

    await renderSelector({
      person: target,
      getDisplayName,
      getThumbnailUrl,
      loadPeople,
      mergePeople: vi.fn(),
      onBack: vi.fn(),
      onMerge: vi.fn(),
    });

    await vi.waitFor(() => expect(loadPeople).toHaveBeenCalledWith(false, target));
    await page.getByRole('button', { name: 'sort_people_by_similarity' }).click();

    await vi.waitFor(() => expect(loadPeople).toHaveBeenLastCalledWith(true, target));
  });

  it('warns instead of selecting more people than the merge limit', async () => {
    const target = { id: 'p1', name: 'Target' };
    const first = { id: 'p2', name: 'First' };
    const second = { id: 'p3', name: 'Second' };
    const loadPeople = vi.fn().mockResolvedValue([first, second]);

    await renderSelector({
      person: target,
      getDisplayName,
      getThumbnailUrl,
      loadPeople,
      mergePeople: vi.fn(),
      onBack: vi.fn(),
      onMerge: vi.fn(),
      mergeLimit: 1,
    });

    await page.getByRole('button', { name: 'First' }).click();
    await page.getByRole('button', { name: 'Second' }).click();

    expect(toastManager.warning).toHaveBeenCalledWith('merge_people_limit');
  });
});
