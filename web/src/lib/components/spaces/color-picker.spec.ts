import ColorPicker from '#lib/components/spaces/color-picker.svelte';
import type { UserAvatarColor } from '@immich/sdk';
import { expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';

// UserAvatarColor enum values are just lowercase strings
const Primary = 'primary' as UserAvatarColor;
const Pink = 'pink' as UserAvatarColor;
const Red = 'red' as UserAvatarColor;
const Yellow = 'yellow' as UserAvatarColor;
const Blue = 'blue' as UserAvatarColor;
const Green = 'green' as UserAvatarColor;
const Purple = 'purple' as UserAvatarColor;
const Orange = 'orange' as UserAvatarColor;
const Gray = 'gray' as UserAvatarColor;
const Amber = 'amber' as UserAvatarColor;

const allColors = [Primary, Pink, Red, Yellow, Blue, Green, Purple, Orange, Gray, Amber];

describe('ColorPicker', () => {
  it('should render all 10 color swatches', async () => {
    await render(ColorPicker, { value: Primary, onchange: vi.fn() });
    expect(page.getByRole('button').elements()).toHaveLength(10);
  });

  it('should render a swatch for each color value', async () => {
    await render(ColorPicker, { value: Primary, onchange: vi.fn() });
    for (const color of allColors) {
      await expect.element(page.getByTestId(`color-swatch-${color}`)).toBeInTheDocument();
    }
  });

  it('should apply ring classes to the selected color', async () => {
    await render(ColorPicker, { value: Blue, onchange: vi.fn() });
    const selected = page.getByTestId(`color-swatch-${Blue}`).element();
    expect(selected.className).toContain('ring-2');
    expect(selected.className).toContain('scale-110');
  });

  it('should not apply ring classes to unselected colors', async () => {
    await render(ColorPicker, { value: Blue, onchange: vi.fn() });
    const unselected = page.getByTestId(`color-swatch-${Red}`).element();
    expect(unselected.className).not.toContain('ring-2');
    expect(unselected.className).not.toContain('scale-110');
  });

  it('should show check icon only on the selected color', async () => {
    await render(ColorPicker, { value: Green, onchange: vi.fn() });
    const selectedButton = page.getByTestId(`color-swatch-${Green}`).element();
    const unselectedButton = page.getByTestId(`color-swatch-${Red}`).element();
    expect(selectedButton.querySelector('svg')).not.toBeNull();
    expect(unselectedButton.querySelector('svg')).toBeNull();
  });

  it('should set aria-label to the color value', async () => {
    await render(ColorPicker, { value: Primary, onchange: vi.fn() });
    await expect.element(page.getByTestId(`color-swatch-${Purple}`)).toHaveAttribute('aria-label', Purple);
  });

  it('should call onchange with the clicked color value', async () => {
    const onchange = vi.fn();
    await render(ColorPicker, { value: Primary, onchange });

    await userEvent.click(page.getByTestId(`color-swatch-${Orange}`));
    expect(onchange).toHaveBeenCalledWith(Orange);
  });

  it('should call onchange when clicking the already-selected color', async () => {
    const onchange = vi.fn();
    await render(ColorPicker, { value: Red, onchange });

    await userEvent.click(page.getByTestId(`color-swatch-${Red}`));
    expect(onchange).toHaveBeenCalledWith(Red);
  });
});
