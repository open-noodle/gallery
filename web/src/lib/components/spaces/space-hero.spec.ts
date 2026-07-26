import type { SharedSpaceResponseDto } from '@immich/sdk';
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
// The hover edit control mounts a ButtonContextMenu → IconButton → Tooltip, which needs a
// TooltipProvider in context. The wrapper supplies it and forwards SpaceHero's props verbatim.
import SpaceHero from '$lib/components/spaces/space-hero.test-wrapper.svelte';

const makeSpace = (overrides: Partial<SharedSpaceResponseDto> = {}): SharedSpaceResponseDto => ({
  id: 'space-1',
  name: 'Family Trip',
  description: null,
  createdById: 'user-1',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  thumbnailAssetId: null,
  ...overrides,
});

describe('SpaceHero component', () => {
  // --- Identity (name / description) ---

  it('should render the space name', () => {
    render(SpaceHero, { space: makeSpace({ name: 'Alps Hiking' }) });
    expect(screen.getByTestId('hero-title')).toHaveTextContent('Alps Hiking');
  });

  it('should display description when present', () => {
    render(SpaceHero, { space: makeSpace({ description: 'A lovely trip' }) });
    expect(screen.getByTestId('hero-description')).toHaveTextContent('A lovely trip');
  });

  it('should not render a description block when there is no description', () => {
    render(SpaceHero, { space: makeSpace({ description: null }) });
    expect(screen.queryByTestId('hero-description')).not.toBeInTheDocument();
  });

  // --- Cover image vs gradient ---

  it('should render cover image when thumbnailAssetId is set', () => {
    render(SpaceHero, { space: makeSpace({ thumbnailAssetId: 'asset-1' }) });
    expect(screen.getByTestId('hero-cover-image')).toBeInTheDocument();
    expect(screen.queryByTestId('hero-gradient')).not.toBeInTheDocument();
  });

  it('should render gradient background when no cover photo', () => {
    render(SpaceHero, {
      space: makeSpace({ thumbnailAssetId: null }),
      gradientClass: 'from-blue-400 to-blue-600',
    });
    expect(screen.getByTestId('hero-gradient')).toBeInTheDocument();
    expect(screen.queryByTestId('hero-cover-image')).not.toBeInTheDocument();
  });

  // --- object-position from thumbnailCropY ---

  it('should apply default center position when thumbnailCropY is null', () => {
    render(SpaceHero, { space: makeSpace({ thumbnailAssetId: 'asset-1', thumbnailCropY: null }) });
    const img = screen.getByTestId('hero-cover-image');
    expect(img.style.objectPosition).toContain('50%');
  });

  it('should apply custom position from thumbnailCropY', () => {
    render(SpaceHero, { space: makeSpace({ thumbnailAssetId: 'asset-1', thumbnailCropY: 25 }) });
    const img = screen.getByTestId('hero-cover-image');
    expect(img.style.objectPosition).toContain('25%');
  });

  // --- Role badge ---

  it('renders the role badge', () => {
    render(SpaceHero, { space: makeSpace(), currentRole: 'owner' });
    expect(screen.getByTestId('hero-role-badge')).toBeInTheDocument();
  });

  it('should display role badge text when currentRole is provided', () => {
    render(SpaceHero, { space: makeSpace(), currentRole: 'editor' });
    expect(screen.getByTestId('hero-role-badge')).toHaveTextContent('editor');
  });

  it('should not display role badge when currentRole is not provided', () => {
    render(SpaceHero, { space: makeSpace() });
    expect(screen.queryByTestId('hero-role-badge')).not.toBeInTheDocument();
  });

  // --- The old pill row is gone ---

  it('does NOT render the old pill row (photo/member counts, manage-people, chevron)', () => {
    render(SpaceHero, { space: makeSpace(), currentRole: 'owner' });
    expect(screen.queryByTestId('hero-photo-count')).not.toBeInTheDocument();
    expect(screen.queryByTestId('hero-member-count')).not.toBeInTheDocument();
    expect(screen.queryByTestId('hero-manage-people')).not.toBeInTheDocument();
    expect(screen.queryByTestId('hero-collapse-toggle')).not.toBeInTheDocument();
  });

  // --- Photo count on the cover ---

  it('renders the photo count on the cover when assetCount is provided', () => {
    render(SpaceHero, { space: makeSpace(), assetCount: 35 });
    expect(screen.getByTestId('hero-photo-count')).toHaveTextContent('35');
  });

  it('does not render a photo count when assetCount is not provided', () => {
    render(SpaceHero, { space: makeSpace() });
    expect(screen.queryByTestId('hero-photo-count')).not.toBeInTheDocument();
  });

  // --- Edit control (✎) ---

  it('shows the edit control immediately for an editor with a cover, with no hover interaction', () => {
    render(SpaceHero, {
      space: makeSpace({ thumbnailAssetId: 'a1' }),
      canEdit: true,
      onChangeCover: () => {},
      onReposition: () => {},
    });
    const menu = screen.getByTestId('hero-edit-menu');
    expect(menu).toBeInTheDocument();
    expect(within(menu).getByLabelText('edit')).toBeEnabled();
  });

  it('shows the edit control only when canEdit', async () => {
    const { rerender } = render(SpaceHero, { space: makeSpace({ thumbnailAssetId: 'a1' }), canEdit: false });
    expect(screen.queryByTestId('hero-edit-menu')).not.toBeInTheDocument();
    await rerender({
      space: makeSpace({ thumbnailAssetId: 'a1' }),
      canEdit: true,
      onChangeCover: () => {},
      onReposition: () => {},
    });
    expect(screen.getByTestId('hero-edit-menu')).toBeInTheDocument();
  });

  it('shows the edit menu even when there is no cover, so renaming stays reachable', () => {
    render(SpaceHero, {
      space: makeSpace({ thumbnailAssetId: null }),
      canEdit: true,
      onChangeCover: () => {},
      onEditSpace: () => {},
    });
    expect(screen.getByTestId('hero-edit-menu')).toBeInTheDocument();
  });

  it('does not show the hover edit control during reposition mode', () => {
    render(SpaceHero, {
      space: makeSpace({ thumbnailAssetId: 'a1' }),
      canEdit: true,
      onChangeCover: () => {},
      onReposition: () => {},
      repositioning: true,
      onSavePosition: vi.fn(),
      onCancelReposition: vi.fn(),
    });
    expect(screen.queryByTestId('hero-edit-menu')).not.toBeInTheDocument();
  });

  it('offers Edit space in the hero menu for an editor', async () => {
    render(SpaceHero, {
      space: makeSpace({ thumbnailAssetId: 'a1' }),
      canEdit: true,
      onChangeCover: () => {},
      onReposition: () => {},
      onEditSpace: () => {},
    });

    await fireEvent.click(within(screen.getByTestId('hero-edit-menu')).getByLabelText('edit'));

    expect(await screen.findByText('spaces_edit')).toBeInTheDocument();
  });

  it('calls onEditSpace when Edit space is chosen', async () => {
    const onEditSpace = vi.fn();
    render(SpaceHero, {
      space: makeSpace({ thumbnailAssetId: 'a1' }),
      canEdit: true,
      onChangeCover: () => {},
      onReposition: () => {},
      onEditSpace,
    });

    await fireEvent.click(within(screen.getByTestId('hero-edit-menu')).getByLabelText('edit'));
    await fireEvent.click(await screen.findByText('spaces_edit'));

    expect(onEditSpace).toHaveBeenCalledOnce();
  });

  it('omits Reposition when there is no cover, since there is no image to drag', async () => {
    render(SpaceHero, {
      space: makeSpace({ thumbnailAssetId: null }),
      canEdit: true,
      onChangeCover: () => {},
      onEditSpace: () => {},
    });

    await fireEvent.click(within(screen.getByTestId('hero-edit-menu')).getByLabelText('edit'));

    expect(await screen.findByText('spaces_edit')).toBeInTheDocument();
    expect(screen.getByText('change_cover_photo')).toBeInTheDocument();
    expect(screen.queryByText('reposition')).not.toBeInTheDocument();
  });

  it('offers Reposition when there IS a cover', async () => {
    render(SpaceHero, {
      space: makeSpace({ thumbnailAssetId: 'a1' }),
      canEdit: true,
      onChangeCover: () => {},
      onReposition: () => {},
      onEditSpace: () => {},
    });

    await fireEvent.click(within(screen.getByTestId('hero-edit-menu')).getByLabelText('edit'));

    expect(await screen.findByText('reposition')).toBeInTheDocument();
  });

  it('shows no edit menu for a viewer, with or without a cover', async () => {
    const { rerender } = render(SpaceHero, { space: makeSpace({ thumbnailAssetId: 'a1' }), canEdit: false });
    expect(screen.queryByTestId('hero-edit-menu')).not.toBeInTheDocument();

    await rerender({ space: makeSpace({ thumbnailAssetId: null }), canEdit: false });
    expect(screen.queryByTestId('hero-edit-menu')).not.toBeInTheDocument();
  });

  it('still shows the empty-state Set cover button alongside the menu', () => {
    render(SpaceHero, {
      space: makeSpace({ thumbnailAssetId: null }),
      canEdit: true,
      onChangeCover: () => {},
      onEditSpace: () => {},
    });

    expect(screen.getByTestId('hero-edit-menu')).toBeInTheDocument();
    expect(screen.getByTestId('hero-set-cover-button')).toBeInTheDocument();
  });

  // --- Set cover prompt (no cover) ---

  it('shows a Set cover prompt when there is no cover and canEdit', () => {
    render(SpaceHero, { space: makeSpace({ thumbnailAssetId: null }), canEdit: true, onChangeCover: () => {} });
    expect(screen.getByTestId('hero-set-cover-button')).toBeInTheDocument();
  });

  it('does not show the Set cover prompt when not an editor', () => {
    render(SpaceHero, { space: makeSpace({ thumbnailAssetId: null }), canEdit: false });
    expect(screen.queryByTestId('hero-set-cover-button')).not.toBeInTheDocument();
  });

  it('does not show the Set cover prompt when a cover already exists', () => {
    render(SpaceHero, { space: makeSpace({ thumbnailAssetId: 'a1' }), canEdit: true, onChangeCover: () => {} });
    expect(screen.queryByTestId('hero-set-cover-button')).not.toBeInTheDocument();
  });

  it('calls onChangeCover when the Set cover prompt is clicked', () => {
    const onChangeCover = vi.fn();
    render(SpaceHero, { space: makeSpace({ thumbnailAssetId: null }), canEdit: true, onChangeCover });
    screen.getByTestId('hero-set-cover-button').click();
    expect(onChangeCover).toHaveBeenCalled();
  });

  // --- Reposition mode ---

  it('should show reposition overlay when repositioning is true', () => {
    render(SpaceHero, {
      space: makeSpace({ thumbnailAssetId: 'asset-1' }),
      repositioning: true,
      onSavePosition: vi.fn(),
      onCancelReposition: vi.fn(),
    });
    expect(screen.getByTestId('reposition-controls')).toBeInTheDocument();
    expect(screen.getByTestId('reposition-hint')).toBeInTheDocument();
  });

  it('should not show the title/role group during reposition mode', () => {
    render(SpaceHero, {
      space: makeSpace({ thumbnailAssetId: 'asset-1' }),
      currentRole: 'owner',
      repositioning: true,
      onSavePosition: vi.fn(),
      onCancelReposition: vi.fn(),
    });
    expect(screen.queryByTestId('hero-title')).not.toBeInTheDocument();
    expect(screen.queryByTestId('hero-role-badge')).not.toBeInTheDocument();
    expect(screen.queryByTestId('hero-set-cover-button')).not.toBeInTheDocument();
  });

  it('should call onSavePosition with the initial cropY when Save is clicked', () => {
    const onSavePosition = vi.fn();
    render(SpaceHero, {
      space: makeSpace({ thumbnailAssetId: 'asset-1', thumbnailCropY: 30 }),
      repositioning: true,
      onSavePosition,
      onCancelReposition: vi.fn(),
    });
    screen.getByTestId('reposition-save-button').click();
    expect(onSavePosition).toHaveBeenCalledWith(30);
  });

  it('should call onCancelReposition when Cancel is clicked', () => {
    const onCancelReposition = vi.fn();
    render(SpaceHero, {
      space: makeSpace({ thumbnailAssetId: 'asset-1' }),
      repositioning: true,
      onSavePosition: vi.fn(),
      onCancelReposition,
    });
    screen.getByTestId('reposition-cancel-button').click();
    expect(onCancelReposition).toHaveBeenCalled();
  });

  it('should apply the dragged crop position to the cover image during reposition (pointer drag)', async () => {
    render(SpaceHero, {
      space: makeSpace({ thumbnailAssetId: 'asset-1', thumbnailCropY: 50 }),
      repositioning: true,
      onSavePosition: vi.fn(),
      onCancelReposition: vi.fn(),
    });
    const img = screen.getByTestId('hero-cover-image') as HTMLImageElement;
    // happy-dom does not implement setPointerCapture; stub it so the drag handlers run.
    img.setPointerCapture = vi.fn();
    expect(img.style.objectPosition).toContain('50%');
    img.dispatchEvent(new PointerEvent('pointerdown', { clientY: 100, pointerId: 1, bubbles: true }));
    // Drag upward (deltaY < 0) → object-position moves toward the bottom (higher %).
    img.dispatchEvent(new PointerEvent('pointermove', { clientY: 0, pointerId: 1, bubbles: true }));
    img.dispatchEvent(new PointerEvent('pointerup', { clientY: 0, pointerId: 1, bubbles: true }));
    await tick();
    expect(img.style.objectPosition).not.toContain('50%');
  });

  // --- Height logic (tall / compact / collapsed) ---

  it('should be tall by default', () => {
    render(SpaceHero, { space: makeSpace() });
    expect(screen.getByTestId('space-hero').style.height).toBe('220px');
  });

  it('should be compact when compact is set', () => {
    render(SpaceHero, { space: makeSpace(), compact: true });
    expect(screen.getByTestId('space-hero').style.height).toBe('96px');
  });

  it('should be zero-height when collapsed', () => {
    render(SpaceHero, { space: makeSpace(), collapsed: true });
    expect(screen.getByTestId('space-hero').style.height).toBe('0px');
  });

  it('should stay tall while repositioning even if collapsed', () => {
    render(SpaceHero, {
      space: makeSpace({ thumbnailAssetId: 'asset-1' }),
      collapsed: true,
      repositioning: true,
      onSavePosition: vi.fn(),
      onCancelReposition: vi.fn(),
    });
    expect(screen.getByTestId('space-hero').style.height).toBe('220px');
  });
});
