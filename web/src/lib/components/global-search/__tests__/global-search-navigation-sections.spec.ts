import type { NavigationItem } from '$lib/managers/navigation-items';
import { render } from '@testing-library/svelte';
import { init, register, waitLocale } from 'svelte-i18n';
import { beforeAll, describe, expect, it } from 'vitest';
import CommandRootWrapper from './test-harness/command-root-wrapper.svelte';

beforeAll(async () => {
  // Load en so `$t('cmdk_section_*')` resolves to English headings
  // ("System Settings", "Admin", "Navigation", "Actions") rather than raw keys.
  register('en-US', () => import('$i18n/en.json'));
  await init({ fallbackLocale: 'en-US' });
  await waitLocale('en-US');
});

function makeItem(category: NavigationItem['category'], id: string): NavigationItem {
  return {
    id,
    category,
    labelKey: `label-${id}`,
    descriptionKey: `desc-${id}`,
    icon: 'M0 0',
    route: category === 'actions' ? '' : `/${id}`,
    adminOnly: category === 'systemSettings' || category === 'admin',
  };
}

describe('global-search-navigation-sections', () => {
  it('renders nothing when status is idle', () => {
    const { container } = render(CommandRootWrapper, {
      props: { status: { status: 'idle' } },
    });
    expect(container.querySelector('[data-command-group]')).toBeNull();
  });

  it('renders nothing when status is empty', () => {
    const { container } = render(CommandRootWrapper, {
      props: { status: { status: 'empty' } },
    });
    expect(container.querySelector('[data-command-group]')).toBeNull();
  });

  it('renders nothing when status is loading', () => {
    const { container } = render(CommandRootWrapper, {
      props: { status: { status: 'loading' } },
    });
    expect(container.querySelector('[data-command-group]')).toBeNull();
  });

  it('renders nothing when status is error', () => {
    const { container } = render(CommandRootWrapper, {
      props: { status: { status: 'error', message: 'boom' } },
    });
    expect(container.querySelector('[data-command-group]')).toBeNull();
  });

  it('renders four sub-sections in fixed order when all categories have items', () => {
    const items = [
      makeItem('actions', 'nav:theme'),
      makeItem('admin', 'nav:admin:users'),
      makeItem('userPages', 'nav:userPages:photos'),
      makeItem('systemSettings', 'nav:systemSettings:authentication'),
    ];
    const { container } = render(CommandRootWrapper, {
      props: { status: { status: 'ok', items, total: items.length } },
    });
    const headings = [...container.querySelectorAll('[data-command-group-heading]')];
    const order = headings.map((h) => (h as HTMLElement).textContent?.trim());
    // With the en bundle loaded in beforeAll, $t(key) renders the English string.
    expect(order).toEqual(['System Settings', 'Admin', 'Navigation', 'Actions']);
  });

  it('omits empty categories entirely (no heading, no group)', () => {
    const items = [makeItem('actions', 'nav:theme')];
    const { container } = render(CommandRootWrapper, {
      props: { status: { status: 'ok', items, total: 1 } },
    });
    const headings = [...container.querySelectorAll('[data-command-group-heading]')];
    expect(headings).toHaveLength(1);
    expect(headings[0].textContent?.trim()).toBe('Actions');
  });

  it('slices each category to topN=5', () => {
    const items: NavigationItem[] = [];
    for (let i = 0; i < 8; i++) {
      items.push(makeItem('systemSettings', `nav:systemSettings:k${i}`));
    }
    const { container } = render(CommandRootWrapper, {
      props: { status: { status: 'ok', items, total: items.length } },
    });
    const rows = container.querySelectorAll('[data-command-item]');
    expect(rows.length).toBe(5);
  });

  it('renders chip + heading count when a sub-section exceeds topN', () => {
    // Seed 6 matching items in ONE sub-section only (User Pages). Other sub-sections
    // have at most topN items and therefore must NOT render a chip or count suffix.
    const items: NavigationItem[] = [];
    for (let i = 0; i < 6; i++) {
      items.push(makeItem('userPages', `nav:userPages:k${i}`));
    }
    // Add a sibling category with < topN so we can verify the chip is scoped per-bucket.
    items.push(makeItem('actions', 'nav:actions:theme'));
    const { container } = render(CommandRootWrapper, {
      props: { status: { status: 'ok', items, total: items.length } },
    });

    const groups = [...container.querySelectorAll('[data-command-group]')] as HTMLElement[];
    // Two buckets render: userPages and actions.
    expect(groups).toHaveLength(2);

    // Identify the userPages group by its heading text.
    const userPagesGroup = groups.find((g) =>
      g.querySelector('[data-command-group-heading]')?.textContent?.includes('Navigation'),
    );
    const actionsGroup = groups.find((g) =>
      g.querySelector('[data-command-group-heading]')?.textContent?.includes('Actions'),
    );
    expect(userPagesGroup).toBeTruthy();
    expect(actionsGroup).toBeTruthy();

    // The userPages heading must contain "(5 of 6)" and exactly one chip element.
    const userPagesHeading = userPagesGroup!.querySelector('[data-command-group-heading]');
    expect(userPagesHeading?.textContent).toMatch(/\(5 of 6\)/);
    const userPagesChip = userPagesGroup!.querySelector('[data-testid="more-chip"]');
    expect(userPagesChip).not.toBeNull();
    expect(userPagesChip?.getAttribute('aria-hidden')).toBe('true');
    expect(userPagesChip?.textContent).toMatch(/×\s*1\s*more/);

    // The actions bucket must have NO chip and NO count suffix.
    const actionsHeading = actionsGroup!.querySelector('[data-command-group-heading]');
    expect(actionsHeading?.textContent).not.toMatch(/\(/);
    expect(actionsGroup!.querySelector('[data-testid="more-chip"]')).toBeNull();
  });

  it('does NOT render chip on first keystroke frame (hasResolvedOnce=false)', () => {
    // Before any filter pass has resolved, the provider's status is idle/loading/empty.
    // Each of these variants must produce zero chip elements anywhere in the tree.
    for (const status of [{ status: 'idle' as const }, { status: 'loading' as const }, { status: 'empty' as const }]) {
      const { container } = render(CommandRootWrapper, { props: { status } });
      expect(container.querySelector('[data-testid="more-chip"]')).toBeNull();
    }
  });

  it('only groups categories that are present — mixed 2-of-4 render', () => {
    const items = [
      makeItem('systemSettings', 'nav:systemSettings:authentication'),
      makeItem('userPages', 'nav:userPages:photos'),
    ];
    const { container } = render(CommandRootWrapper, {
      props: { status: { status: 'ok', items, total: items.length } },
    });
    const headings = [...container.querySelectorAll('[data-command-group-heading]')];
    expect(headings).toHaveLength(2);
    expect(headings[0].textContent?.trim()).toBe('System Settings');
    expect(headings[1].textContent?.trim()).toBe('Navigation');
  });

  it('renders Command.Item with data-value equal to the NavigationItem.id', () => {
    const items = [makeItem('userPages', 'nav:userPages:photos')];
    const { container } = render(CommandRootWrapper, {
      props: { status: { status: 'ok', items, total: 1 } },
    });
    const item = container.querySelector('[data-command-item]') as HTMLElement | null;
    expect(item).not.toBeNull();
    expect(item?.dataset.value).toBe('nav:userPages:photos');
  });
});
