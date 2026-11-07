import { render } from 'vitest-browser-svelte';
import SettingSwitch from './SettingSwitch.svelte';

describe('SettingSwitch component', () => {
  // Gallery: the switch is also labelled by its title, not only described by its subtitle.
  it('labels the switch with its title', async () => {
    const screen = await render(SettingSwitch, {
      title: 'Enable feature',
      subtitle: 'Controls the feature state.',
    });

    const label = screen.getByText('Enable feature').element() as HTMLLabelElement;
    const switchElement = document.querySelector(`#${label.htmlFor}`);

    expect(label.htmlFor).not.toBe('');
    expect(label.id).not.toBe('');
    expect(switchElement).not.toBeNull();
    expect(switchElement?.getAttribute('aria-labelledby')).toBe(label.id);
  });
});
