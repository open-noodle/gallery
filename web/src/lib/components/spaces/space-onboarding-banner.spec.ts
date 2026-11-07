import SpaceOnboardingBanner from '#lib/components/spaces/space-onboarding-banner.svelte';
import { dismissedOnboardingSpaceIds } from '#lib/stores/space-view.store.ts';
import type { SharedSpaceResponseDto } from '@immich/sdk';
import { get } from 'svelte/store';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';

const makeSpace = (overrides: Partial<SharedSpaceResponseDto> = {}): SharedSpaceResponseDto => ({
  id: 'space-1',
  name: 'Family Photos',
  description: 'Our family memories',
  createdById: 'user-1',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  memberCount: 1,
  assetCount: 0,
  thumbnailAssetId: null,
  recentAssetIds: [],
  recentAssetThumbhashes: [],
  lastActivityAt: null,
  newAssetCount: 0,
  members: [],
  ...overrides,
});

const defaultProps = {
  space: makeSpace(),
  gradientClass: 'from-indigo-400 to-cyan-600',
  onAddPhotos: vi.fn(),
  onInviteMembers: vi.fn(),
  onSetCover: vi.fn(),
};

describe('SpaceOnboardingBanner', () => {
  beforeEach(() => {
    localStorage.clear();
    dismissedOnboardingSpaceIds.reset();
  });

  it('should render banner when no steps are complete', async () => {
    await render(SpaceOnboardingBanner, { ...defaultProps, space: makeSpace() });
    expect(page.getByTestId('onboarding-banner').element()).toBeInTheDocument();
  });

  it('should hide banner when all 3 steps are complete', async () => {
    await render(SpaceOnboardingBanner, {
      ...defaultProps,
      space: makeSpace({ assetCount: 5, memberCount: 2, thumbnailAssetId: 'asset-1' }),
    });
    expect(page.getByTestId('onboarding-banner').query()).not.toBeInTheDocument();
  });

  it('should show progress text with translation key', async () => {
    await render(SpaceOnboardingBanner, { ...defaultProps, space: makeSpace() });
    const progressText = page.getByTestId('progress-text').element();
    expect(progressText).toMatchTextContent('spaces_setup_steps_done');
  });

  it('should still render progress text when one step complete', async () => {
    await render(SpaceOnboardingBanner, { ...defaultProps, space: makeSpace({ assetCount: 5 }) });
    const progressText = page.getByTestId('progress-text').element();
    expect(progressText).toBeInTheDocument();
  });

  it('should still render progress text when two steps complete', async () => {
    await render(SpaceOnboardingBanner, {
      ...defaultProps,
      space: makeSpace({ assetCount: 5, memberCount: 2 }),
    });
    const progressText = page.getByTestId('progress-text').element();
    expect(progressText).toBeInTheDocument();
  });

  it('should show checkmark for completed add-photos step', async () => {
    await render(SpaceOnboardingBanner, { ...defaultProps, space: makeSpace({ assetCount: 5 }) });
    expect(page.getByTestId('step-add-photos-check').element()).toBeInTheDocument();
  });

  it('should show checkmark for completed invite-members step', async () => {
    await render(SpaceOnboardingBanner, { ...defaultProps, space: makeSpace({ memberCount: 2 }) });
    expect(page.getByTestId('step-invite-members-check').element()).toBeInTheDocument();
  });

  it('should show checkmark for completed set-cover step', async () => {
    await render(SpaceOnboardingBanner, {
      ...defaultProps,
      space: makeSpace({ thumbnailAssetId: 'asset-1' }),
    });
    expect(page.getByTestId('step-set-cover-check').element()).toBeInTheDocument();
  });

  it('should show action button for incomplete steps', async () => {
    await render(SpaceOnboardingBanner, { ...defaultProps, space: makeSpace() });
    expect(page.getByTestId('step-add-photos-action').element()).toBeInTheDocument();
    expect(page.getByTestId('step-invite-members-action').element()).toBeInTheDocument();
    expect(page.getByTestId('step-set-cover-action').element()).toBeInTheDocument();
  });

  it('should hide action button for completed steps', async () => {
    await render(SpaceOnboardingBanner, {
      ...defaultProps,
      space: makeSpace({ assetCount: 5, memberCount: 2 }),
    });
    expect(page.getByTestId('step-add-photos-action').query()).not.toBeInTheDocument();
    expect(page.getByTestId('step-invite-members-action').query()).not.toBeInTheDocument();
  });

  it('should call onAddPhotos callback when add photos action clicked', async () => {
    const onAddPhotos = vi.fn();
    await render(SpaceOnboardingBanner, { ...defaultProps, onAddPhotos });
    await userEvent.click(page.getByTestId('step-add-photos-action'));
    expect(onAddPhotos).toHaveBeenCalledTimes(1);
  });

  it('should call onInviteMembers callback when invite action clicked', async () => {
    const onInviteMembers = vi.fn();
    await render(SpaceOnboardingBanner, { ...defaultProps, onInviteMembers });
    await userEvent.click(page.getByTestId('step-invite-members-action'));
    expect(onInviteMembers).toHaveBeenCalledTimes(1);
  });

  it('should call onSetCover callback when set cover action clicked', async () => {
    const onSetCover = vi.fn();
    await render(SpaceOnboardingBanner, { ...defaultProps, onSetCover });
    await userEvent.click(page.getByTestId('step-set-cover-action'));
    expect(onSetCover).toHaveBeenCalledTimes(1);
  });

  it('should toggle collapsed state when collapse button clicked', async () => {
    await render(SpaceOnboardingBanner, { ...defaultProps, space: makeSpace() });
    const banner = page.getByTestId('onboarding-banner').element();
    expect(banner.dataset.collapsed).toBe('false');

    await userEvent.click(page.getByTestId('banner-collapse-toggle'));
    expect(banner.dataset.collapsed).toBe('true');

    await userEvent.click(page.getByTestId('banner-collapse-toggle'));
    expect(banner.dataset.collapsed).toBe('false');
  });

  it('should set progress bar width to 0% when no steps complete', async () => {
    await render(SpaceOnboardingBanner, { ...defaultProps, space: makeSpace() });
    const fill = page.getByTestId('progress-bar-fill').element();
    expect(fill.style.width).toBe('0%');
  });

  it('should set progress bar width to 33% when one step complete', async () => {
    await render(SpaceOnboardingBanner, { ...defaultProps, space: makeSpace({ assetCount: 5 }) });
    const fill = page.getByTestId('progress-bar-fill').element();
    expect(fill.style.width).toBe('33%');
  });

  it('should update invite-members step when space.memberCount changes from 1 to 2', async () => {
    const { rerender } = await render(SpaceOnboardingBanner, { ...defaultProps, space: makeSpace({ memberCount: 1 }) });
    expect(page.getByTestId('step-invite-members-action').element()).toBeInTheDocument();
    expect(page.getByTestId('step-invite-members-check').query()).not.toBeInTheDocument();

    await rerender({ ...defaultProps, space: makeSpace({ memberCount: 2 }) });
    expect(page.getByTestId('step-invite-members-check').element()).toBeInTheDocument();
    expect(page.getByTestId('step-invite-members-action').query()).not.toBeInTheDocument();
  });

  it('should set progress bar width to 67% when two steps complete', async () => {
    await render(SpaceOnboardingBanner, {
      ...defaultProps,
      space: makeSpace({ assetCount: 5, memberCount: 2 }),
    });
    const fill = page.getByTestId('progress-bar-fill').element();
    expect(fill.style.width).toBe('67%');
  });

  describe('step completion combinations', () => {
    it('should show banner with only photos complete', async () => {
      await render(SpaceOnboardingBanner, {
        ...defaultProps,
        space: makeSpace({ assetCount: 5, memberCount: 1, thumbnailAssetId: null }),
      });
      expect(page.getByTestId('onboarding-banner').element()).toBeInTheDocument();
      expect(page.getByTestId('step-add-photos-check').element()).toBeInTheDocument();
      expect(page.getByTestId('step-invite-members-action').element()).toBeInTheDocument();
      expect(page.getByTestId('step-set-cover-action').element()).toBeInTheDocument();
    });

    it('should show banner with only members complete', async () => {
      await render(SpaceOnboardingBanner, {
        ...defaultProps,
        space: makeSpace({ assetCount: 0, memberCount: 2, thumbnailAssetId: null }),
      });
      expect(page.getByTestId('onboarding-banner').element()).toBeInTheDocument();
      expect(page.getByTestId('step-add-photos-action').element()).toBeInTheDocument();
      expect(page.getByTestId('step-invite-members-check').element()).toBeInTheDocument();
      expect(page.getByTestId('step-set-cover-action').element()).toBeInTheDocument();
    });

    it('should show banner with only cover complete', async () => {
      await render(SpaceOnboardingBanner, {
        ...defaultProps,
        space: makeSpace({ assetCount: 0, memberCount: 1, thumbnailAssetId: 'asset-1' }),
      });
      expect(page.getByTestId('onboarding-banner').element()).toBeInTheDocument();
      expect(page.getByTestId('step-add-photos-action').element()).toBeInTheDocument();
      expect(page.getByTestId('step-invite-members-action').element()).toBeInTheDocument();
      expect(page.getByTestId('step-set-cover-check').element()).toBeInTheDocument();
    });

    it('should show banner with photos + members complete but no cover', async () => {
      await render(SpaceOnboardingBanner, {
        ...defaultProps,
        space: makeSpace({ assetCount: 5, memberCount: 2, thumbnailAssetId: null }),
      });
      expect(page.getByTestId('onboarding-banner').element()).toBeInTheDocument();
      expect(page.getByTestId('step-add-photos-check').element()).toBeInTheDocument();
      expect(page.getByTestId('step-invite-members-check').element()).toBeInTheDocument();
      expect(page.getByTestId('step-set-cover-action').element()).toBeInTheDocument();
    });

    it('should show banner with photos + cover complete but no members', async () => {
      await render(SpaceOnboardingBanner, {
        ...defaultProps,
        space: makeSpace({ assetCount: 5, memberCount: 1, thumbnailAssetId: 'asset-1' }),
      });
      expect(page.getByTestId('onboarding-banner').element()).toBeInTheDocument();
      expect(page.getByTestId('step-add-photos-check').element()).toBeInTheDocument();
      expect(page.getByTestId('step-invite-members-action').element()).toBeInTheDocument();
      expect(page.getByTestId('step-set-cover-check').element()).toBeInTheDocument();
    });

    it('should show banner with members + cover complete but no photos', async () => {
      await render(SpaceOnboardingBanner, {
        ...defaultProps,
        space: makeSpace({ assetCount: 0, memberCount: 2, thumbnailAssetId: 'asset-1' }),
      });
      expect(page.getByTestId('onboarding-banner').element()).toBeInTheDocument();
      expect(page.getByTestId('step-add-photos-action').element()).toBeInTheDocument();
      expect(page.getByTestId('step-invite-members-check').element()).toBeInTheDocument();
      expect(page.getByTestId('step-set-cover-check').element()).toBeInTheDocument();
    });
  });

  describe('dismiss', () => {
    it('should render a dismiss button when the banner is shown', async () => {
      await render(SpaceOnboardingBanner, { ...defaultProps, space: makeSpace() });
      expect(page.getByTestId('banner-dismiss').element()).toBeInTheDocument();
    });

    it('should remove the banner from the DOM when dismiss is clicked', async () => {
      await render(SpaceOnboardingBanner, { ...defaultProps, space: makeSpace() });
      expect(page.getByTestId('onboarding-banner').element()).toBeInTheDocument();

      await userEvent.click(page.getByTestId('banner-dismiss'));

      expect(page.getByTestId('onboarding-banner').query()).not.toBeInTheDocument();
    });

    it('should persist the dismissed space id to localStorage when dismissed', async () => {
      await render(SpaceOnboardingBanner, { ...defaultProps, space: makeSpace({ id: 'space-1' }) });

      await userEvent.click(page.getByTestId('banner-dismiss'));

      expect(get(dismissedOnboardingSpaceIds)).toContain('space-1');
      expect(localStorage.getItem('dismissed-onboarding-space-ids')).toContain('space-1');
    });

    it('should not render when the space has already been dismissed', async () => {
      dismissedOnboardingSpaceIds.set(['space-1']);
      await render(SpaceOnboardingBanner, { ...defaultProps, space: makeSpace({ id: 'space-1' }) });
      expect(page.getByTestId('onboarding-banner').query()).not.toBeInTheDocument();
    });

    it('should be per-space: dismissing one space does not hide another', async () => {
      dismissedOnboardingSpaceIds.set(['space-1']);
      await render(SpaceOnboardingBanner, { ...defaultProps, space: makeSpace({ id: 'space-2' }) });
      expect(page.getByTestId('onboarding-banner').element()).toBeInTheDocument();
    });

    it('should not add duplicate ids when dismissed twice across renders', async () => {
      const { unmount } = await render(SpaceOnboardingBanner, { ...defaultProps, space: makeSpace({ id: 'space-1' }) });
      await userEvent.click(page.getByTestId('banner-dismiss'));
      await unmount();

      dismissedOnboardingSpaceIds.set(['space-1']);
      await render(SpaceOnboardingBanner, { ...defaultProps, space: makeSpace({ id: 'space-1' }) });

      expect(get(dismissedOnboardingSpaceIds).filter((id) => id === 'space-1')).toHaveLength(1);
    });
  });

  describe('banner disappears after completing all steps via rerender', () => {
    it('should disappear when going from 0/3 to 3/3', async () => {
      const { rerender } = await render(SpaceOnboardingBanner, { ...defaultProps, space: makeSpace() });
      expect(page.getByTestId('onboarding-banner').element()).toBeInTheDocument();

      await rerender({
        ...defaultProps,
        space: makeSpace({ assetCount: 5, memberCount: 2, thumbnailAssetId: 'asset-1' }),
      });
      expect(page.getByTestId('onboarding-banner').query()).not.toBeInTheDocument();
    });

    it('should disappear when completing steps one at a time', async () => {
      const { rerender } = await render(SpaceOnboardingBanner, { ...defaultProps, space: makeSpace() });
      expect(page.getByTestId('onboarding-banner').element()).toBeInTheDocument();
      expect(page.getByTestId('progress-bar-fill').element().style.width).toBe('0%');

      // Step 1: add photos
      await rerender({ ...defaultProps, space: makeSpace({ assetCount: 5 }) });
      expect(page.getByTestId('onboarding-banner').element()).toBeInTheDocument();
      expect(page.getByTestId('step-add-photos-check').element()).toBeInTheDocument();
      expect(page.getByTestId('progress-bar-fill').element().style.width).toBe('33%');

      // Step 2: invite members
      await rerender({ ...defaultProps, space: makeSpace({ assetCount: 5, memberCount: 2 }) });
      expect(page.getByTestId('onboarding-banner').element()).toBeInTheDocument();
      expect(page.getByTestId('step-invite-members-check').element()).toBeInTheDocument();
      expect(page.getByTestId('progress-bar-fill').element().style.width).toBe('67%');

      // Step 3: set cover — banner disappears
      await rerender({
        ...defaultProps,
        space: makeSpace({ assetCount: 5, memberCount: 2, thumbnailAssetId: 'asset-1' }),
      });
      expect(page.getByTestId('onboarding-banner').query()).not.toBeInTheDocument();
    });
  });
});
