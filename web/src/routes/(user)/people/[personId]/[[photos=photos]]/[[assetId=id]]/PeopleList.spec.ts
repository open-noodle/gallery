import TestWrapper from '#lib/components/TestWrapper.svelte';
import { type PersonResponseDto } from '@immich/sdk';
import type { Component } from 'svelte';
import { expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';
import PeopleList from './PeopleList.svelte';

vi.mock('#lib/components/assets/thumbnail/ImageThumbnail.svelte', async () => {
  const { default: MockComponent } = await import('#lib/gallery/__mocks__/image-thumbnail.stub.svelte');
  return { default: MockComponent };
});

const person = (id: string, name: string): PersonResponseDto =>
  ({ id, name, thumbnailPath: `/people/${id}/thumbnail`, birthDate: null, isHidden: false }) as PersonResponseDto;

const renderList = (props: Record<string, unknown>) =>
  render(TestWrapper as Component<{ component: typeof PeopleList; componentProps: typeof props }>, {
    component: PeopleList,
    componentProps: { onSelect: () => {}, peopleToNotShow: [], ...props },
  });

describe('PeopleList', () => {
  it('renders every candidate except the ones to hide, and reports the one that was picked', async () => {
    const onSelect = vi.fn();
    const alice = person('p1', 'Alice');
    const bob = person('p2', 'Bob');
    const carol = person('p3', 'Carol');

    await renderList({ people: [alice, bob, carol], peopleToNotShow: [bob], onSelect });

    await expect.element(page.getByText('Alice')).toBeInTheDocument();
    await expect.element(page.getByText('Carol')).toBeInTheDocument();
    await expect.element(page.getByText('Bob')).not.toBeInTheDocument();

    await userEvent.click(page.getByText('Carol'));

    expect(onSelect).toHaveBeenCalledWith(carol);
  });

  /**
  The candidate grid used to declare no unprefixed column count at all — its smallest-screen
  class was the singular of `grid-cols-2`, which Tailwind does not recognise and so compiles to
  nothing, and below `md` the grid fell back to a single column and rendered one enormous face
  per row on a phone (#1082). Dropping the base `grid-cols-*` again, or making the smallest one
  breakpoint-prefixed, brings that straight back, and the dead-utility guard would not notice
  (the remaining names would all still compile).
  
  The dead spelling is deliberately not written out here: the dead-utility guard scans comments
  too, so naming it would fail that guard from this file.
  */
  it('declares a column count for the smallest screens, not only from a breakpoint up', async () => {
    await renderList({ people: [person('p1', 'Alice')] });

    const grid = page.getByTestId('reassign-people-grid').element();

    expect(grid.className).toMatch(/(?:^|\s)grid-cols-[1-9]/);
    // The regression shipped as "columns only from `md:` up", so pin that the base count is more
    // than one: a base `grid-cols-1` would satisfy the assertion above and still be the bug.
    expect(grid.className).not.toMatch(/(?:^|\s)grid-cols-1(?![\d.])/);
  });
});
