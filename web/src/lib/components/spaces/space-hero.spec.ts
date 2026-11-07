// The hover edit control mounts a ButtonContextMenu → IconButton → Tooltip, which needs a
// TooltipProvider in context. The wrapper supplies it and forwards SpaceHero's props verbatim.
import SpaceHero from '#lib/components/spaces/space-hero.test-wrapper.svelte';
import type { SharedSpaceResponseDto } from '@immich/sdk';
import { tick } from 'svelte';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';

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

  it('should render the space name', async () => {
    await render(SpaceHero, { space: makeSpace({ name: 'Alps Hiking' }) });
    expect(page.getByTestId('hero-title').element()).toMatchTextContent('Alps Hiking');
  });

  it('should display description when present', async () => {
    await render(SpaceHero, { space: makeSpace({ description: 'A lovely trip' }) });
    expect(page.getByTestId('hero-description').element()).toMatchTextContent('A lovely trip');
  });

  it('should not render a description block when there is no description', async () => {
    await render(SpaceHero, { space: makeSpace({ description: null }) });
    expect(page.getByTestId('hero-description').query()).not.toBeInTheDocument();
  });

  // --- Cover image vs gradient ---

  it('should render cover image when thumbnailAssetId is set', async () => {
    await render(SpaceHero, { space: makeSpace({ thumbnailAssetId: 'asset-1' }) });
    expect(page.getByTestId('hero-cover-image').element()).toBeInTheDocument();
    expect(page.getByTestId('hero-gradient').query()).not.toBeInTheDocument();
  });

  it('should render gradient background when no cover photo', async () => {
    await render(SpaceHero, {
      space: makeSpace({ thumbnailAssetId: null }),
      gradientClass: 'from-blue-400 to-blue-600',
    });
    expect(page.getByTestId('hero-gradient').element()).toBeInTheDocument();
    expect(page.getByTestId('hero-cover-image').query()).not.toBeInTheDocument();
  });

  // --- object-position from thumbnailCropY ---

  it('should apply default center position when thumbnailCropY is null', async () => {
    await render(SpaceHero, { space: makeSpace({ thumbnailAssetId: 'asset-1', thumbnailCropY: null }) });
    const img = page.getByTestId('hero-cover-image').element();
    expect(img.style.objectPosition).toContain('50%');
  });

  it('should apply custom position from thumbnailCropY', async () => {
    await render(SpaceHero, { space: makeSpace({ thumbnailAssetId: 'asset-1', thumbnailCropY: 25 }) });
    const img = page.getByTestId('hero-cover-image').element();
    expect(img.style.objectPosition).toContain('25%');
  });

  // --- Role badge ---

  it('renders the role badge', async () => {
    await render(SpaceHero, { space: makeSpace(), currentRole: 'owner' });
    expect(page.getByTestId('hero-role-badge').element()).toBeInTheDocument();
  });

  // The badge used to print the raw SharedSpaceRole enum, which is English-only in every locale
  // (#946). `$t` has no dictionary under test, so it echoes the key back — a badge reading
  // `role_editor` rather than `editor` is the proof that the value went through i18n at all.
  it('should display a translated role label, not the raw enum value, for an editor', async () => {
    await render(SpaceHero, { space: makeSpace(), currentRole: 'editor' });
    expect(page.getByTestId('hero-role-badge').element()).toMatchTextContent(/^role_editor$/);
  });

  it('should display a translated role label, not the raw enum value, for a viewer', async () => {
    await render(SpaceHero, { space: makeSpace(), currentRole: 'viewer' });
    expect(page.getByTestId('hero-role-badge').element()).toMatchTextContent(/^role_viewer$/);
  });

  it('should not display role badge when currentRole is not provided', async () => {
    await render(SpaceHero, { space: makeSpace() });
    expect(page.getByTestId('hero-role-badge').query()).not.toBeInTheDocument();
  });

  // --- The old pill row is gone ---

  it('does NOT render the old pill row (photo/member counts, manage-people, chevron)', async () => {
    await render(SpaceHero, { space: makeSpace(), currentRole: 'owner' });
    expect(page.getByTestId('hero-photo-count').query()).not.toBeInTheDocument();
    expect(page.getByTestId('hero-member-count').query()).not.toBeInTheDocument();
    expect(page.getByTestId('hero-manage-people').query()).not.toBeInTheDocument();
    expect(page.getByTestId('hero-collapse-toggle').query()).not.toBeInTheDocument();
  });

  // --- Photo count on the cover ---

  it('renders the photo count on the cover when assetCount is provided', async () => {
    await render(SpaceHero, { space: makeSpace(), assetCount: 35 });
    expect(page.getByTestId('hero-photo-count').element()).toMatchTextContent('35');
  });

  it('does not render a photo count when assetCount is not provided', async () => {
    await render(SpaceHero, { space: makeSpace() });
    expect(page.getByTestId('hero-photo-count').query()).not.toBeInTheDocument();
  });

  // --- Edit control (✎) ---

  // #946: the cover is a photo, not a themed surface, so a control tinted with a theme colour is
  // a coin toss. `variant="ghost"` painted the ✎ with `text-dark` — near-black in the light theme —
  // on a transparent background, which vanished against a dark cover. An opaque chip brings its own
  // background, so it contrasts with itself whatever the photo underneath happens to be.
  it('paints the edit control as an opaque chip rather than dark ink on the bare cover', async () => {
    await render(SpaceHero, {
      space: makeSpace({ thumbnailAssetId: 'a1' }),
      canEdit: true,
      onChangeCover: () => {},
      onReposition: () => {},
    });
    const button = page
      .elementLocator(page.getByTestId('hero-edit-menu').element())
      .getByLabelText('edit', { exact: true })
      .element();
    expect(button.className).not.toContain('text-dark');
    expect(button.className).toMatch(/(^|\s)bg-\S/);
  });

  it('shows the edit control immediately for an editor with a cover, with no hover interaction', async () => {
    await render(SpaceHero, {
      space: makeSpace({ thumbnailAssetId: 'a1' }),
      canEdit: true,
      onChangeCover: () => {},
      onReposition: () => {},
    });
    const menu = page.getByTestId('hero-edit-menu').element();
    expect(menu).toBeInTheDocument();
    expect(page.elementLocator(menu).getByLabelText('edit', { exact: true }).element()).toBeEnabled();
  });

  it('shows the edit control only when canEdit', async () => {
    const { rerender } = await render(SpaceHero, { space: makeSpace({ thumbnailAssetId: 'a1' }), canEdit: false });
    expect(page.getByTestId('hero-edit-menu').query()).not.toBeInTheDocument();
    await rerender({
      space: makeSpace({ thumbnailAssetId: 'a1' }),
      canEdit: true,
      onChangeCover: () => {},
      onReposition: () => {},
    });
    expect(page.getByTestId('hero-edit-menu').element()).toBeInTheDocument();
  });

  it('shows the edit menu even when there is no cover, so renaming stays reachable', async () => {
    await render(SpaceHero, {
      space: makeSpace({ thumbnailAssetId: null }),
      canEdit: true,
      onChangeCover: () => {},
      onEditSpace: () => {},
    });
    expect(page.getByTestId('hero-edit-menu').element()).toBeInTheDocument();
  });

  it('does not show the hover edit control during reposition mode', async () => {
    await render(SpaceHero, {
      space: makeSpace({ thumbnailAssetId: 'a1' }),
      canEdit: true,
      onChangeCover: () => {},
      onReposition: () => {},
      repositioning: true,
      onSavePosition: vi.fn(),
      onCancelReposition: vi.fn(),
    });
    expect(page.getByTestId('hero-edit-menu').query()).not.toBeInTheDocument();
  });

  it('offers Edit space in the hero menu for an editor', async () => {
    await render(SpaceHero, {
      space: makeSpace({ thumbnailAssetId: 'a1' }),
      canEdit: true,
      onChangeCover: () => {},
      onReposition: () => {},
      onEditSpace: () => {},
    });

    await userEvent.click(
      page.elementLocator(page.getByTestId('hero-edit-menu').element()).getByLabelText('edit', { exact: true }),
    );

    expect(await vi.waitFor(() => page.getByText('spaces_edit', { exact: true }).element())).toBeInTheDocument();
  });

  it('calls onEditSpace when Edit space is chosen', async () => {
    const onEditSpace = vi.fn();
    await render(SpaceHero, {
      space: makeSpace({ thumbnailAssetId: 'a1' }),
      canEdit: true,
      onChangeCover: () => {},
      onReposition: () => {},
      onEditSpace,
    });

    await userEvent.click(
      page.elementLocator(page.getByTestId('hero-edit-menu').element()).getByLabelText('edit', { exact: true }),
    );
    await userEvent.click(await vi.waitFor(() => page.getByText('spaces_edit', { exact: true }).element()));

    expect(onEditSpace).toHaveBeenCalledOnce();
  });

  it('omits Reposition when there is no cover, since there is no image to drag', async () => {
    await render(SpaceHero, {
      space: makeSpace({ thumbnailAssetId: null }),
      canEdit: true,
      onChangeCover: () => {},
      onEditSpace: () => {},
    });

    await userEvent.click(
      page.elementLocator(page.getByTestId('hero-edit-menu').element()).getByLabelText('edit', { exact: true }),
    );

    expect(await vi.waitFor(() => page.getByText('spaces_edit', { exact: true }).element())).toBeInTheDocument();
    expect(page.getByText('change_cover_photo', { exact: true }).element()).toBeInTheDocument();
    expect(page.getByText('reposition', { exact: true }).query()).not.toBeInTheDocument();
  });

  it('offers Reposition when there IS a cover', async () => {
    await render(SpaceHero, {
      space: makeSpace({ thumbnailAssetId: 'a1' }),
      canEdit: true,
      onChangeCover: () => {},
      onReposition: () => {},
      onEditSpace: () => {},
    });

    await userEvent.click(
      page.elementLocator(page.getByTestId('hero-edit-menu').element()).getByLabelText('edit', { exact: true }),
    );

    expect(await vi.waitFor(() => page.getByText('reposition', { exact: true }).element())).toBeInTheDocument();
  });

  it('shows no edit menu for a viewer, with or without a cover', async () => {
    const { rerender } = await render(SpaceHero, { space: makeSpace({ thumbnailAssetId: 'a1' }), canEdit: false });
    expect(page.getByTestId('hero-edit-menu').query()).not.toBeInTheDocument();

    await rerender({ space: makeSpace({ thumbnailAssetId: null }), canEdit: false });
    expect(page.getByTestId('hero-edit-menu').query()).not.toBeInTheDocument();
  });

  it('still shows the empty-state Set cover button alongside the menu', async () => {
    await render(SpaceHero, {
      space: makeSpace({ thumbnailAssetId: null }),
      canEdit: true,
      onChangeCover: () => {},
      onEditSpace: () => {},
    });

    expect(page.getByTestId('hero-edit-menu').element()).toBeInTheDocument();
    expect(page.getByTestId('hero-set-cover-button').element()).toBeInTheDocument();
  });

  // --- Set cover prompt (no cover) ---

  it('shows a Set cover prompt when there is no cover and canEdit', async () => {
    await render(SpaceHero, { space: makeSpace({ thumbnailAssetId: null }), canEdit: true, onChangeCover: () => {} });
    expect(page.getByTestId('hero-set-cover-button').element()).toBeInTheDocument();
  });

  it('does not show the Set cover prompt when not an editor', async () => {
    await render(SpaceHero, { space: makeSpace({ thumbnailAssetId: null }), canEdit: false });
    expect(page.getByTestId('hero-set-cover-button').query()).not.toBeInTheDocument();
  });

  it('does not show the Set cover prompt when a cover already exists', async () => {
    await render(SpaceHero, { space: makeSpace({ thumbnailAssetId: 'a1' }), canEdit: true, onChangeCover: () => {} });
    expect(page.getByTestId('hero-set-cover-button').query()).not.toBeInTheDocument();
  });

  it('calls onChangeCover when the Set cover prompt is clicked', async () => {
    const onChangeCover = vi.fn();
    await render(SpaceHero, { space: makeSpace({ thumbnailAssetId: null }), canEdit: true, onChangeCover });
    await userEvent.click(page.getByTestId('hero-set-cover-button'));
    expect(onChangeCover).toHaveBeenCalled();
  });

  // --- Reposition mode ---

  it('should show reposition overlay when repositioning is true', async () => {
    await render(SpaceHero, {
      space: makeSpace({ thumbnailAssetId: 'asset-1' }),
      repositioning: true,
      onSavePosition: vi.fn(),
      onCancelReposition: vi.fn(),
    });
    expect(page.getByTestId('reposition-controls').element()).toBeInTheDocument();
    expect(page.getByTestId('reposition-hint').element()).toBeInTheDocument();
  });

  it('should not show the title/role group during reposition mode', async () => {
    await render(SpaceHero, {
      space: makeSpace({ thumbnailAssetId: 'asset-1' }),
      currentRole: 'owner',
      repositioning: true,
      onSavePosition: vi.fn(),
      onCancelReposition: vi.fn(),
    });
    expect(page.getByTestId('hero-title').query()).not.toBeInTheDocument();
    expect(page.getByTestId('hero-role-badge').query()).not.toBeInTheDocument();
    expect(page.getByTestId('hero-set-cover-button').query()).not.toBeInTheDocument();
  });

  it('should call onSavePosition with the initial cropY when Save is clicked', async () => {
    const onSavePosition = vi.fn();
    await render(SpaceHero, {
      space: makeSpace({ thumbnailAssetId: 'asset-1', thumbnailCropY: 30 }),
      repositioning: true,
      onSavePosition,
      onCancelReposition: vi.fn(),
    });
    await userEvent.click(page.getByTestId('reposition-save-button'));
    expect(onSavePosition).toHaveBeenCalledWith(30);
  });

  it('should call onCancelReposition when Cancel is clicked', async () => {
    const onCancelReposition = vi.fn();
    await render(SpaceHero, {
      space: makeSpace({ thumbnailAssetId: 'asset-1' }),
      repositioning: true,
      onSavePosition: vi.fn(),
      onCancelReposition,
    });
    await userEvent.click(page.getByTestId('reposition-cancel-button'));
    expect(onCancelReposition).toHaveBeenCalled();
  });

  it('should apply the dragged crop position to the cover image during reposition (pointer drag)', async () => {
    await render(SpaceHero, {
      space: makeSpace({ thumbnailAssetId: 'asset-1', thumbnailCropY: 50 }),
      repositioning: true,
      onSavePosition: vi.fn(),
      onCancelReposition: vi.fn(),
    });
    const img = page.getByTestId('hero-cover-image').element() as HTMLImageElement;
    // A synthetic pointer is not an active pointer, so the real setPointerCapture throws; stub it.
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

  it('should be tall by default', async () => {
    await render(SpaceHero, { space: makeSpace() });
    expect(page.getByTestId('space-hero').element().style.height).toBe('220px');
  });

  it('should be compact when compact is set', async () => {
    await render(SpaceHero, { space: makeSpace(), compact: true });
    expect(page.getByTestId('space-hero').element().style.height).toBe('96px');
  });

  it('should be zero-height when collapsed', async () => {
    await render(SpaceHero, { space: makeSpace(), collapsed: true });
    expect(page.getByTestId('space-hero').element().style.height).toBe('0px');
  });

  it('should stay tall while repositioning even if collapsed', async () => {
    await render(SpaceHero, {
      space: makeSpace({ thumbnailAssetId: 'asset-1' }),
      collapsed: true,
      repositioning: true,
      onSavePosition: vi.fn(),
      onCancelReposition: vi.fn(),
    });
    expect(page.getByTestId('space-hero').element().style.height).toBe('220px');
  });
});
