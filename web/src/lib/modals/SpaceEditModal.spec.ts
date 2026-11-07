import { UserAvatarColor, type SharedSpaceResponseDto } from '@immich/sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';
import SpaceEditModal from './SpaceEditModal.svelte';

const updateSpaceDetailsMock = vi.hoisted(() => vi.fn());
vi.mock('#lib/services/space.service.js', () => ({ updateSpaceDetails: updateSpaceDetailsMock }));

const space = (o: Partial<SharedSpaceResponseDto> = {}): SharedSpaceResponseDto =>
  ({
    id: 's1',
    name: 'Family Trip',
    description: 'Our holiday photos',
    color: UserAvatarColor.Blue,
    ...o,
  }) as never;

const nameInput = () => page.getByTestId('space-edit-name');
const descriptionInput = () => page.getByTestId('space-edit-description');
// "Save" is capitalised because FormModal's submitText comes from @immich/ui's OWN translation
// service (dist/services/translation.svelte.js → `save: 'Save'`), not svelte-i18n — so it is real
// English here, unlike the raw i18n keys ('spaces_edit', 'name') that svelte-i18n yields in tests.
const saveButton = () => page.getByRole('button', { name: 'Save' });

beforeEach(() => {
  vi.clearAllMocks();
  updateSpaceDetailsMock.mockResolvedValue(true);
});

describe('SpaceEditModal', () => {
  it('prefills every field from the space', async () => {
    await render(SpaceEditModal, { space: space(), onClose: vi.fn() });

    await expect.element(nameInput()).toHaveValue('Family Trip');
    await expect.element(descriptionInput()).toHaveValue('Our holiday photos');
    await expect.element(page.getByTestId('color-swatch-blue')).toBeInTheDocument();
  });

  it('treats a null description as an empty field rather than the string "null"', async () => {
    await render(SpaceEditModal, { space: space({ description: null }), onClose: vi.fn() });

    await expect.element(descriptionInput()).toHaveValue('');
  });

  it('saves the edited name and closes with true, omitting the untouched description', async () => {
    const onClose = vi.fn();
    await render(SpaceEditModal, { space: space(), onClose });

    await userEvent.fill(nameInput(), 'Renamed Trip');
    await userEvent.click(saveButton());

    await vi.waitFor(() => {
      expect(updateSpaceDetailsMock).toHaveBeenCalledWith('s1', {
        name: 'Renamed Trip',
        color: UserAvatarColor.Blue,
      });
    });
    expect(onClose).toHaveBeenCalledWith(true);
  });

  it('omits the description key on a pure rename of a space whose description is null', async () => {
    const onClose = vi.fn();
    await render(SpaceEditModal, { space: space({ description: null }), onClose });

    await userEvent.fill(nameInput(), 'Renamed Trip');
    await userEvent.click(saveButton());

    await vi.waitFor(() => {
      expect(updateSpaceDetailsMock).toHaveBeenCalledWith('s1', {
        name: 'Renamed Trip',
        color: UserAvatarColor.Blue,
      });
    });
    const [, dto] = updateSpaceDetailsMock.mock.calls[0];
    expect(dto).not.toHaveProperty('description');
  });

  it('trims surrounding whitespace from the name before sending', async () => {
    await render(SpaceEditModal, { space: space(), onClose: vi.fn() });

    await userEvent.fill(nameInput(), '  Padded Name  ');
    await userEvent.click(saveButton());

    await vi.waitFor(() => {
      expect(updateSpaceDetailsMock).toHaveBeenCalledWith('s1', expect.objectContaining({ name: 'Padded Name' }));
    });
  });

  it('sends an emptied description as an empty string, not undefined', async () => {
    await render(SpaceEditModal, { space: space(), onClose: vi.fn() });

    await userEvent.fill(descriptionInput(), '');
    await userEvent.click(saveButton());

    await vi.waitFor(() => {
      expect(updateSpaceDetailsMock).toHaveBeenCalledWith('s1', expect.objectContaining({ description: '' }));
    });
  });

  it('sends the selected color', async () => {
    await render(SpaceEditModal, { space: space(), onClose: vi.fn() });

    // Targeted by data-testid, not aria-label: the ColorPicker's labels are raw lowercase
    // enum values, a pre-existing a11y wart this component does not own.
    await userEvent.click(page.getByTestId('color-swatch-green'));
    await userEvent.click(saveButton());

    await vi.waitFor(() => {
      expect(updateSpaceDetailsMock).toHaveBeenCalledWith(
        's1',
        expect.objectContaining({ color: UserAvatarColor.Green }),
      );
    });
  });

  it('submits unchanged values without error, omitting the untouched description', async () => {
    const onClose = vi.fn();
    await render(SpaceEditModal, { space: space(), onClose });

    await userEvent.click(saveButton());

    await vi.waitFor(() => {
      expect(updateSpaceDetailsMock).toHaveBeenCalledWith('s1', {
        name: 'Family Trip',
        color: UserAvatarColor.Blue,
      });
    });
    expect(onClose).toHaveBeenCalledWith(true);
  });

  it('disables save for an empty name', async () => {
    await render(SpaceEditModal, { space: space(), onClose: vi.fn() });

    await userEvent.fill(nameInput(), '');

    await expect.element(saveButton()).toBeDisabled();
  });

  it('disables save for a whitespace-only name, which native `required` would let through', async () => {
    await render(SpaceEditModal, { space: space(), onClose: vi.fn() });

    await userEvent.fill(nameInput(), ' '.repeat(3));

    await expect.element(saveButton()).toBeDisabled();
  });

  it('re-enables save once a valid name is restored', async () => {
    await render(SpaceEditModal, { space: space(), onClose: vi.fn() });

    await userEvent.fill(nameInput(), '');
    await expect.element(saveButton()).toBeDisabled();

    await userEvent.fill(nameInput(), 'Back');
    await expect.element(saveButton()).not.toBeDisabled();
  });

  it('caps the inputs at the server bounds so an over-length value cannot be submitted', async () => {
    await render(SpaceEditModal, { space: space(), onClose: vi.fn() });

    await expect.element(nameInput()).toHaveAttribute('maxlength', '100');
    await expect.element(descriptionInput()).toHaveAttribute('maxlength', '500');
  });

  it('selects the existing name on first focus so typing replaces it', async () => {
    await render(SpaceEditModal, { space: space(), onClose: vi.fn() });

    const input = nameInput().element() as HTMLInputElement;
    input.dispatchEvent(new FocusEvent('focus'));

    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe('Family Trip'.length);
  });

  it('stays open when the save fails', async () => {
    updateSpaceDetailsMock.mockResolvedValue(false);
    const onClose = vi.fn();
    await render(SpaceEditModal, { space: space(), onClose });

    await userEvent.click(saveButton());

    await vi.waitFor(() => {
      expect(updateSpaceDetailsMock).toHaveBeenCalled();
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('disables the submit button while a save is in flight, guarding against a double-click', async () => {
    let resolveUpdate: (value: boolean) => void = () => {};
    updateSpaceDetailsMock.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          resolveUpdate = resolve;
        }),
    );
    const onClose = vi.fn();
    await render(SpaceEditModal, { space: space(), onClose });

    await userEvent.click(saveButton());

    await expect.element(saveButton()).toBeDisabled();

    resolveUpdate(true);
    await vi.waitFor(() => {
      expect(onClose).toHaveBeenCalledWith(true);
    });
  });
});
