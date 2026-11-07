import { renderWithTooltips } from '#test/unit/helpers.ts';
import { ImageCarousel } from '@immich/ui';
import { expect } from 'vitest';

describe('ImageCarousel', () => {
  it('constrains long card titles inside the card', async () => {
    const screen = await renderWithTooltips(ImageCarousel, {
      items: [
        {
          id: 'memory-id',
          title: 'Your recent trip to South Africa',
          href: '/memory?id=asset-id',
          src: '/thumbnail.jpg',
          alt: 'Trip photo',
        },
      ],
    });

    await expect
      .element(screen.getByText('Your recent trip to South Africa'))
      .toHaveClass('w-[calc(100%-2rem)]', 'whitespace-normal');
  });
});
