import { factory } from '#test/unit/factories.ts';
import { renderWithTooltips } from '#test/unit/helpers.ts';
import { describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import RenameFileButton from './RenameFileButton.svelte';

describe('RenameFileButton', () => {
  it('is offered to the owner', async () => {
    await renderWithTooltips(RenameFileButton, { asset: factory.asset({ isTrashed: false }), isOwner: true });

    await expect.element(page.getByTestId('detail-panel-rename-button')).toBeInTheDocument();
  });

  // A space editor edits the photo, not its file: the file belongs to its owner.
  it('is not offered to anyone else', async () => {
    await renderWithTooltips(RenameFileButton, { asset: factory.asset({ isTrashed: false }), isOwner: false });

    expect(page.getByTestId('detail-panel-rename-button').query()).toBeNull();
  });

  it('is not offered for an asset in the trash', async () => {
    await renderWithTooltips(RenameFileButton, { asset: factory.asset({ isTrashed: true }), isOwner: true });

    expect(page.getByTestId('detail-panel-rename-button').query()).toBeNull();
  });
});
