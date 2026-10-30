let pending: number | undefined;

/**
 * The date the user just finished in rewind, handed to the hub once so its calendar cell can turn green with
 * a pop. Module state rather than navigation state: finishing may route through the next date first.
 */
export const finishedDay = {
  set: (monthDay: number) => {
    pending = monthDay;
  },
  take: (): number | undefined => {
    const monthDay = pending;
    pending = undefined;
    return monthDay;
  },
};
