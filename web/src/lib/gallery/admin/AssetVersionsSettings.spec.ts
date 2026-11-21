import { reactiveProps } from '#lib/gallery/__mocks__/reactive-props.svelte.ts';
import AssetVersionsSettings from '#lib/gallery/admin/AssetVersionsSettings.svelte';
import { ManualJobName, type AdminConfigServerDto } from '@immich/sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';

// what the server reports about the saved setting, the dialog's answer and the job that is started
const mocks = vi.hoisted(() => ({
  features: undefined as { assetVersions?: boolean } | undefined,
  confirmed: true,
  showDialog: vi.fn(),
  handleCreateJob: vi.fn(),
}));

vi.mock('#lib/managers/feature-flags-manager.svelte.ts', () => ({
  featureFlagsManager: {
    get valueOrUndefined() {
      return mocks.features;
    },
  },
}));
vi.mock('#lib/services/job.service.ts', () => ({ handleCreateJob: mocks.handleCreateJob }));
vi.mock('@immich/ui', async (original) => ({
  ...(await original<typeof import('@immich/ui')>()),
  modalManager: { showDialog: mocks.showDialog },
}));

// SettingAccordion opens through accordionManager, which navigates; keep this section open instead.
vi.mock('#lib/managers/accordion-manager.svelte.ts', () => ({
  accordionManager: { isOpen: (key: string) => key === 'asset-versions', open: vi.fn(), close: vi.fn() },
}));

// a bound prop is written back only into a reactive object (see reactive-props.svelte.ts)
const makeProps = (enabled: boolean, detectEdits = false, disabled = false) =>
  reactiveProps({ server: { assetVersions: { enabled, detectEdits } } as AdminConfigServerDto, disabled });

const versionsSwitch = () => page.getByRole('switch').nth(0);
const editsSwitch = () => page.getByRole('switch').nth(1);
const undoButton = () => page.getByRole('button', { name: 'admin.asset_versions_undo', exact: true });

describe('AssetVersionsSettings', () => {
  it('renders the two switches under the Versions section', async () => {
    await render(AssetVersionsSettings, makeProps(true));
    expect(page.getByRole('switch').elements()).toHaveLength(2);
    await expect.element(page.getByText('admin.asset_versions_enabled', { exact: true })).toBeInTheDocument();
    await expect.element(page.getByText('admin.asset_versions_detect_edits', { exact: true })).toBeInTheDocument();
    await expect.element(versionsSwitch()).toBeEnabled();
    await expect.element(editsSwitch()).toBeEnabled();
  });

  it('shows nothing for an older server whose config has no asset versions', async () => {
    await render(AssetVersionsSettings, reactiveProps({ server: {} as AdminConfigServerDto, disabled: false }));
    expect(page.getByRole('switch').elements()).toHaveLength(0);
    await expect.element(page.getByText('admin.asset_versions_settings', { exact: true })).not.toBeInTheDocument();
  });

  it('disables the edits switch while versions are off', async () => {
    await render(AssetVersionsSettings, makeProps(false));
    await expect.element(versionsSwitch()).toBeEnabled();
    await expect.element(editsSwitch()).toBeDisabled();
  });

  it('shows edits as off while versions are off, and keeps the choice for when they are on again', async () => {
    const props = makeProps(false, true);
    await render(AssetVersionsSettings, props);
    await expect.element(editsSwitch()).not.toBeChecked();

    await versionsSwitch().click();

    expect(props.server.assetVersions).toEqual({ enabled: true, detectEdits: true });
    await expect.element(editsSwitch()).toBeChecked();
    await expect.element(editsSwitch()).toBeEnabled();
  });

  it('shows edits as on while versions are on', async () => {
    await render(AssetVersionsSettings, makeProps(true, true));
    await expect.element(editsSwitch()).toBeChecked();
  });

  it('updates the bound config when toggled', async () => {
    const props = makeProps(false);
    await render(AssetVersionsSettings, props);
    await versionsSwitch().click();
    expect(props.server.assetVersions).toEqual({ enabled: true, detectEdits: false });
  });

  it('turns edits on as a second switch once versions are on', async () => {
    const props = makeProps(true);
    await render(AssetVersionsSettings, props);
    await editsSwitch().click();
    expect(props.server.assetVersions).toEqual({ enabled: true, detectEdits: true });
  });

  it('disables every switch when the config is read-only', async () => {
    await render(AssetVersionsSettings, makeProps(true, false, true));
    await expect.element(versionsSwitch()).toBeDisabled();
    await expect.element(editsSwitch()).toBeDisabled();
  });

  describe('undoing versions', () => {
    beforeEach(() => {
      mocks.features = { assetVersions: false };
      mocks.showDialog.mockReset().mockImplementation(() => Promise.resolve(mocks.confirmed));
      mocks.handleCreateJob.mockReset();
      mocks.confirmed = true;
    });

    it('is offered while versions are off, with what it does', async () => {
      await render(AssetVersionsSettings, makeProps(false));
      await expect.element(undoButton()).toBeInTheDocument();
      await expect
        .element(page.getByText('admin.asset_versions_undo_description', { exact: true }))
        .toBeInTheDocument();
    });

    it('is not offered while versions are on', async () => {
      mocks.features = { assetVersions: true };
      await render(AssetVersionsSettings, makeProps(true));
      await expect.element(undoButton()).not.toBeInTheDocument();
    });

    it('is not offered while the saved setting and the switch disagree', async () => {
      // switched off here but not saved yet: versions are still on
      mocks.features = { assetVersions: true };
      const first = await render(AssetVersionsSettings, makeProps(false));
      await expect.element(undoButton()).not.toBeInTheDocument();
      await first.unmount();
      // switched on here but not saved yet: saving would combine the files again
      mocks.features = { assetVersions: false };
      await render(AssetVersionsSettings, makeProps(true));
      await expect.element(undoButton()).not.toBeInTheDocument();
    });

    it('is not offered by a server that does not report the feature', async () => {
      mocks.features = {};
      const first = await render(AssetVersionsSettings, makeProps(false));
      await expect.element(undoButton()).not.toBeInTheDocument();
      await first.unmount();
      mocks.features = undefined;
      await render(AssetVersionsSettings, makeProps(false));
      await expect.element(undoButton()).not.toBeInTheDocument();
    });

    it('asks first, and starts the undo job once confirmed', async () => {
      await render(AssetVersionsSettings, makeProps(false));
      await undoButton().click();
      expect(mocks.showDialog).toHaveBeenCalledWith(
        expect.objectContaining({ prompt: 'admin.asset_versions_undo_confirm' }),
      );
      await vi.waitFor(() =>
        expect(mocks.handleCreateJob).toHaveBeenCalledWith({ name: ManualJobName.AssetVersionUndo }),
      );
    });

    it('starts nothing when the question is declined', async () => {
      mocks.confirmed = false;
      await render(AssetVersionsSettings, makeProps(false));
      await undoButton().click();
      await vi.waitFor(() => expect(mocks.showDialog).toHaveBeenCalled());
      expect(mocks.handleCreateJob).not.toHaveBeenCalled();
    });
  });
});
