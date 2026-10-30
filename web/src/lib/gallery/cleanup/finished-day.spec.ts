import { finishedDay } from '$lib/gallery/cleanup/finished-day';

describe('finishedDay', () => {
  it('hands the finished date over once', () => {
    finishedDay.set(1028);

    expect(finishedDay.take()).toBe(1028);
    expect(finishedDay.take()).toBeUndefined();
  });
});
