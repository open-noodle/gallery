import type { AdminConfigDto } from '@immich/sdk';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import PersonCoverSettings from './person-cover-settings.svelte';

const makeConfig = (covers?: { enabled: boolean }) =>
  ({
    machineLearning: { enabled: true, facialRecognition: { enabled: true, ...(covers && { covers }) } },
  }) as AdminConfigDto;

const coverSwitch = () => page.getByRole('switch', { name: 'admin.machine_learning_person_covers_setting' });

describe('PersonCoverSettings', () => {
  it('binds the switch to machineLearning.facialRecognition.covers.enabled', async () => {
    const configToEdit = makeConfig({ enabled: true });
    await render(PersonCoverSettings, { configToEdit, disabled: false });

    await expect.element(coverSwitch()).toBeChecked();
    await coverSwitch().click();

    expect(configToEdit.machineLearning.facialRecognition.covers?.enabled).toBe(false);
  });

  it('follows the page being disabled', async () => {
    await render(PersonCoverSettings, { configToEdit: makeConfig({ enabled: true }), disabled: true });

    await expect.element(coverSwitch()).toBeDisabled();
  });

  it('hides the switch against an older server that sends no covers block', async () => {
    await render(PersonCoverSettings, { configToEdit: makeConfig(), disabled: false });

    await expect.element(coverSwitch()).not.toBeInTheDocument();
  });
});
