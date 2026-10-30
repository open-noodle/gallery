import { rewindDirection } from '$lib/gallery/cleanup/rewind-direction';

describe('rewindDirection', () => {
  it('hands the direction over once, and 0 when nothing was set', () => {
    expect(rewindDirection.take()).toBe(0);

    rewindDirection.set(-1);
    expect(rewindDirection.take()).toBe(-1);
    expect(rewindDirection.take()).toBe(0);
  });
});
